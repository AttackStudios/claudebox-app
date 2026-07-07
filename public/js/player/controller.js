// Local player movement: walking, jumping, swimming, egg-hopping — and a
// flight-sim flying model. In the air the bird has a full 3D attitude
// (yaw + pitch + roll) and an airspeed with momentum: dives gain speed,
// climbs bleed it, banking pulls you through turns, and holding roll takes
// you all the way around a barrel roll. Below stall speed the controls go
// soft and the nose eases down — flap (Space) to recover.
//
// Control layers (desktop pointer-lock / drag, mobile flight stick) write
// into `steer` {pitch,yaw,roll in -1..1}, `thrust`, `brake`; queueJump()
// doubles as the flap while airborne. Collision is the shared heightfield
// (sky-island aware) plus soft pushes from tree trunks.

import { groundAt as height, waterAt } from '/shared/worldgen.js';

const GRAVITY = 28;

// flight tuning (semi-sim)
const FLY = {
  maxThrust: 26,      // level top speed under power
  maxDive: 36,        // absolute cap (steep dives only)
  accel: 9,           // thrust acceleration
  brake: 14,
  drag: 0.35,         // per-second proportional drag
  gAlong: 8.5,        // gravity along the flight path (dive gain / climb bleed)
  pitchRate: 1.9,
  yawRate: 1.4,
  rollRate: 3.4,
  bankTurn: 1.35,     // how hard banking pulls the nose around
  stallSpeed: 5.5,
  sinkSlow: 6,        // how fast a stalled bird sinks
  flapBoost: 6,
  flapLift: 0.35,     // upward nudge per wingbeat (gain height by flapping)
  flapCooldown: 0.55,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// wrap an angle to [-PI, PI]
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class PlayerController {
  constructor(game) {
    this.game = game;
    this.pos = { x: 0, y: 5, z: -10 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.ry = 0;            // facing (yaw)
    this.pitch = 0;         // nose up > 0 (flight attitude, eases to 0 on land)
    this.roll = 0;          // right wing down > 0
    this.airspeed = 0;
    this.steer = { pitch: 0, yaw: 0, roll: 0 };   // -1..1, set by controls
    this.thrust = false;
    this.brake = false;
    this.flapCD = 0;
    this.flapPulse = 0;     // 1 on a wingbeat, decays — drives camera/FOV kick
    this.flare = 0;         // >0 briefly while flaring onto a landing
    this.flying = false;
    this.grounded = false;
    this.swimming = false;
    this.anim = 'idle';
    this.jumpQueued = false;
    this.hopCooldown = 0;
    this.sitting = false;
  }

  get stage() { return this.game.me.bird.stage; }

  // terrain height, raised by solid props like nests (rim is a step you
  // climb onto; the bowl inside is a little lower — cozy, but contained)
  groundY(x, z) {
    let g = height(x, z, this.pos.y);
    const n = this.game.nestSurface?.(x, z);
    if (n != null && n > g) g = n;
    return g;
  }

  spawnAt(x, z) {
    this.pos.x = x; this.pos.z = z;
    this.pos.y = Math.max(height(x, z), 0) + 1;
    this.vel = { x: 0, y: 0, z: 0 };
    this.flying = false;
    this.airspeed = 0;
    this.pitch = 0; this.roll = 0;
  }

  queueJump() { this.jumpQueued = true; }

  toggleFly() {
    if (this.stage === 'egg' || this.swimming) return false;
    this.flying = !this.flying;
    if (this.flying) {
      // leap into a cruise: enough airspeed to be controllable immediately
      this.pos.y += 0.7;
      this.grounded = false;
      this.airspeed = Math.max(11, Math.hypot(this.vel.x, this.vel.z) + 5);
      this.pitch = 0.2;
      this.roll = 0;
      this.flapCD = 0;
      // aim the camera level-ish so you climb gently out, not nose into the dirt
      if (this.game.orbit) this.game.orbit.pitch = -0.18;
      this.game.onFlightStart?.();
    } else {
      this.vel.x = Math.sin(this.ry) * this.airspeed * Math.cos(this.pitch);
      this.vel.z = Math.cos(this.ry) * this.airspeed * Math.cos(this.pitch);
      this.vel.y = 0;
      this.game.onFlightEnd?.();
    }
    return this.flying;
  }

  // input: { x, z } in [-1,1] (screen space), camYaw, ascend/descend booleans
  update(dt, input, camYaw) {
    const me = this.game.me;
    const carried = !!me.carriedBy;
    if (carried) {
      this.anim = 'carried';
      this.flying = false;
      this.levelOut(dt);
      return; // position is slaved to the carrier in main.js
    }
    if (this.sitting && (input.x || input.z || this.jumpQueued)) this.sitting = false;

    const baby = this.stage === 'baby';
    const egg = this.stage === 'egg';

    // movement direction in world space, relative to camera yaw
    // input convention: x = +1 right, z = +1 forward (away from camera)
    const len = Math.hypot(input.x, input.z);
    const mag = Math.min(1, len);
    let dirX = 0, dirZ = 0;
    if (mag > 0.05 && !this.flying) {
      const a = camYaw - Math.atan2(input.x, input.z);
      dirX = Math.sin(a) * mag;
      dirZ = Math.cos(a) * mag;
      this.ry = Math.atan2(dirX, dirZ);
    }

    const ground = height(this.pos.x, this.pos.z, this.pos.y);
    const water = waterAt(this.pos.x, this.pos.z, this.pos.y);
    this.swimming = !!water && !this.flying && (water.surface > ground + 0.45);

    if (egg) {
      this.flying = false;
      this.levelOut(dt);
      this.updateEgg(dt, dirX, dirZ, mag, ground, water);
    } else if (this.flying) {
      this.updateFlight(dt, baby);
    } else {
      this.levelOut(dt);
      this.updateWalk(dt, dirX, dirZ, mag, baby, ground, water);
    }

    // soft tree-trunk collision
    const trunks = this.game.trunks || [];
    for (const t of trunks) {
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < t.r && d > 0.001) {
        this.pos.x = t.x + (dx / d) * t.r;
        this.pos.z = t.z + (dz / d) * t.r;
      }
    }

    // keep inside the world
    const m = 1000;
    this.pos.x = Math.max(-m, Math.min(m, this.pos.x));
    this.pos.z = Math.max(-m, Math.min(m, this.pos.z));

    this.jumpQueued = false;
  }

  // on the ground (or carried) the attitude relaxes back to level
  levelOut(dt) {
    const k = Math.min(1, dt * 6);
    this.pitch -= this.pitch * k;
    this.roll = wrap(this.roll);
    this.roll -= this.roll * k;
    this.airspeed = 0;
    this.flare = Math.max(0, this.flare - dt);
  }

  // ---------------- camera-relative flying ----------------
  // The bird flies where the free-look camera points: you aim with the mouse
  // exactly like looking around, hold thrust, and the bird eases onto that
  // heading. W = thrust, S = brake, Q/E = manual roll (barrel rolls),
  // Space = flap. Semi-sim energy: dives gain speed, climbs bleed it.
  updateFlight(dt, baby) {
    const F = FLY;
    const scale = (baby ? 0.78 : 1) * this.game.speedScale;
    this.flapCD = Math.max(0, this.flapCD - dt);
    this.flapPulse = Math.max(0, this.flapPulse - dt * 2.4);
    this.flare = Math.max(0, this.flare - dt);
    const orbit = this.game.orbit;

    // -- aim: ease heading + pitch toward where the camera looks --
    if (orbit) {
      const targetYaw = wrap(orbit.yaw + Math.PI);   // fly away from the camera, into the view
      const targetPitch = clamp(-orbit.pitch, -1.45, 1.45);
      const aimK = Math.min(1, dt * 3.6);
      this.ry = wrap(this.ry + wrap(targetYaw - this.ry) * aimK);
      this.pitch += (targetPitch - this.pitch) * aimK;
    }
    this.pitch = clamp(this.pitch, -1.5, 1.5);

    // -- flap: burst of speed + a little lift, like a real wingbeat --
    if (this.jumpQueued && this.flapCD <= 0) {
      this.airspeed += F.flapBoost;
      this.pos.y += F.flapLift;            // wingbeat lifts you a touch
      this.flapCD = F.flapCooldown;
      this.flapPulse = 1;                  // lens/animation kick
      this.game.onFlap?.();
    }

    // -- manual roll (Q/E) layered on top; auto-levels when released --
    this.roll += this.steer.roll * F.rollRate * dt;
    if (Math.abs(this.steer.roll) < 0.05) {
      const r = wrap(this.roll);
      if (Math.abs(r) < 2.55) this.roll -= r * Math.min(1, dt * 3.2);
      else this.roll += (r > 0 ? 1 : -1) * F.rollRate * 0.55 * dt; // finish a committed roll
    }
    this.roll = wrap(this.roll);

    // -- energy model --
    if (this.thrust) this.airspeed += F.accel * scale * dt;
    if (this.brake) this.airspeed -= F.brake * dt;
    this.airspeed -= F.drag * this.airspeed * dt;
    this.airspeed -= Math.sin(this.pitch) * F.gAlong * dt;   // climb bleeds, dive gains
    const cap = this.pitch < -0.3 ? F.maxDive : F.maxThrust * scale;
    this.airspeed = clamp(this.airspeed, 0, cap);

    // -- integrate along the nose, plus stall sink when slow
    const cp = Math.cos(this.pitch);
    const fx = Math.sin(this.ry) * cp;
    const fy = Math.sin(this.pitch);
    const fz = Math.cos(this.ry) * cp;
    const sink = (1 - clamp(this.airspeed / 9, 0, 1)) * F.sinkSlow;
    this.pos.x += fx * this.airspeed * dt;
    this.pos.y += (fy * this.airspeed - sink) * dt;
    this.pos.z += fz * this.airspeed * dt;

    // expose motion hints for the animator (vy in u/s)
    this.vel.x = fx * this.airspeed;
    this.vel.y = fy * this.airspeed - sink;
    this.vel.z = fz * this.airspeed;

    // -- ceiling
    const ceiling = 190;
    if (this.pos.y > ceiling) {
      this.pos.y = ceiling;
      this.pitch = Math.min(this.pitch, 0.1);
    }

    // -- terrain: land softly when slow or flaring, otherwise scrape along
    const g = this.groundY(this.pos.x, this.pos.z);
    if (this.pos.y <= g + 0.05) {
      this.pos.y = g + 0.05;
      const flaring = this.pitch > 0.3;
      if (this.airspeed < 8.5 || flaring) {
        this.land(flaring);
        return;
      }
      // belly scrape: bleed speed fast, nose follows the ground
      this.airspeed *= 1 - Math.min(0.9, 2.2 * dt);
      this.pitch = Math.max(this.pitch, 0.04);
      if (this.airspeed < 8.5) { this.land(false); return; }
    }

    // -- water: skimming into water ends the flight in a splashdown
    const water = waterAt(this.pos.x, this.pos.z, this.pos.y);
    if (water && this.pos.y <= water.surface + 0.1) {
      this.pos.y = water.surface;
      this.flying = false;
      this.airspeed = 0;
      this.game.onFlightEnd?.();
      this.game.onSplashdown?.();
      return;
    }

    // -- animation pick
    const powered = this.thrust || this.flapCD > F.flapCooldown - 0.25;
    this.anim = powered || this.airspeed < F.stallSpeed + 2 ? 'fly' : 'glide';
  }

  land(flared) {
    this.flying = false;
    this.grounded = true;
    this.airspeed = 0;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.flare = flared ? 0.55 : 0.25;
    this.game.onLanded?.();
    this.game.onFlightEnd?.();
  }

  updateEgg(dt, dirX, dirZ, mag, ground) {
    this.hopCooldown -= dt;
    this.vel.y -= GRAVITY * dt;
    if (mag > 0.2 && this.grounded && this.hopCooldown <= 0) {
      // hop!
      this.vel.y = 6;
      this.vel.x = dirX * 3.2;
      this.vel.z = dirZ * 3.2;
      this.hopCooldown = 0.42;
      this.anim = 'wiggle';
    }
    if (this.jumpQueued && this.grounded && this.hopCooldown <= 0) {
      this.vel.y = 7.5;
      this.hopCooldown = 0.5;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    const g = Math.max(this.groundY(this.pos.x, this.pos.z), -0.2);
    if (this.pos.y <= g) {
      this.pos.y = g;
      this.vel.x *= 0.4; this.vel.z *= 0.4; this.vel.y = 0;
      this.grounded = true;
      if (this.hopCooldown < 0.2) this.anim = 'idle';
    } else {
      this.grounded = false;
    }
  }

  updateWalk(dt, dirX, dirZ, mag, baby, ground, water) {
    const run = mag > 0.85;
    let speed = (run ? 10.5 : 6) * (baby ? 0.8 : 1) * this.game.speedScale;
    if (this.swimming) speed *= 0.55;

    this.vel.x += (dirX * speed - this.vel.x) * Math.min(1, dt * 10);
    this.vel.z += (dirZ * speed - this.vel.z) * Math.min(1, dt * 10);

    if (this.swimming) {
      // bob at the surface
      const target = water.surface - 0.18;
      this.pos.y += (target - this.pos.y) * Math.min(1, dt * 6);
      this.vel.y = 0;
      this.grounded = true;
      if (this.jumpQueued) { this.vel.y = 8; this.pos.y += 0.2; this.grounded = false; }
      this.anim = mag > 0.1 ? 'swim' : 'swim';
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.jumpQueued && this.grounded) {
        this.vel.y = baby ? 8.5 : 10;
        this.grounded = false;
        this.game.audio?.sfx('jump');
      }
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const g = this.groundY(this.pos.x, this.pos.z);
    if (!this.swimming) {
      if (this.pos.y <= g) {
        this.pos.y = g;
        this.vel.y = 0;
        this.grounded = true;
      } else {
        this.grounded = this.pos.y - g < 0.05;
      }
    }

    if (this.sitting) this.anim = 'sit';
    else if (this.flare > 0) this.anim = 'flare';
    else if (!this.grounded && !this.swimming) this.anim = this.vel.y < -3 ? 'glide' : 'idle';
    else if (this.swimming) this.anim = 'swim';
    else if (mag > 0.05) this.anim = run ? 'run' : 'walk';
    else this.anim = 'idle';
  }
}
