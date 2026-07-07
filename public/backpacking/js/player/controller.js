// On-foot movement: walk/run/jump on the heightfield, dock platforms and
// soft tree-trunk collision; swimming float on the lakes. Same conventions
// as Feather Friends (input x=+1 right, z=+1 forward, camYaw-relative).

import { groundAt, waterAt, WORLD } from '/shared/bp/worldgen.js';

const GRAVITY = 32;   // snappier, Roblox-like (less hang time)

export class FootController {
  constructor(game) {
    this.game = game;
    this.pos = { x: 0, y: 8, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.ry = 0;
    this.grounded = false;
    this.swimming = false;
    this.anim = 'idle';
    this.jumpQueued = false;
    this.sprint = false;
    this.locked = false;       // seated / driving / roasting hold / dead
  }

  spawnAt(x, z) {
    this.pos.x = x; this.pos.z = z;
    this.pos.y = this.groundY(x, z) + 0.4;
    this.vel = { x: 0, y: 0, z: 0 };
  }

  groundY(x, z) {
    let g = groundAt(x, z);
    for (const p of this.game.platforms || []) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && p.y > g) {
        // only stand on a platform if we're near/above it (no teleport from below)
        if (this.pos.y > p.y - 1.2) g = p.y;
      }
    }
    const s = this.game.itemSurface?.(x, z, this.pos.y);
    if (s != null && s > g) g = s;
    return g;
  }

  queueJump() { this.jumpQueued = true; }

  update(dt, input, camYaw) {
    if (this.locked) { this.anim = this.game.lockedAnim || 'sit'; this.jumpQueued = false; return; }

    const mag = Math.min(1, Math.hypot(input.x, input.z));
    let dirX = 0, dirZ = 0;
    if (mag > 0.05) {
      const a = camYaw - Math.atan2(input.x, input.z);
      dirX = Math.sin(a) * mag;
      dirZ = Math.cos(a) * mag;
      this.ry = Math.atan2(dirX, dirZ);
    }

    const ground = this.groundY(this.pos.x, this.pos.z);
    const water = waterAt(this.pos.x, this.pos.z);
    this.swimming = !!water && water.surface > ground + 0.9;

    const run = this.sprint && mag > 0.05;
    let speed = (run ? 10.5 : 6) * (this.swimming ? 0.5 : 1);

    this.vel.x += (dirX * speed - this.vel.x) * Math.min(1, dt * 10);
    this.vel.z += (dirZ * speed - this.vel.z) * Math.min(1, dt * 10);

    if (this.swimming) {
      const target = water.surface - 0.55;
      this.pos.y += (target - this.pos.y) * Math.min(1, dt * 6);
      this.vel.y = 0;
      this.grounded = true;
      if (this.jumpQueued) { this.vel.y = 7; this.pos.y += 0.2; this.grounded = false; }
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.jumpQueued && this.grounded) {
        this.vel.y = 7.4;     // lower hop (~0.85u) to match Roblox
        this.grounded = false;
        this.game.audio?.playJump();
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
        this.grounded = this.pos.y - g < 0.08;
      }
    }

    // soft collision: trees, lodge walls, placed items, parked vans
    for (const t of this.game.colliders || []) {
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < t.r && d > 0.001 && this.pos.y < (t.top ?? Infinity)) {
        this.pos.x = t.x + (dx / d) * t.r;
        this.pos.z = t.z + (dz / d) * t.r;
      }
    }

    const m = WORLD_LIMIT;
    this.pos.x = Math.max(-m, Math.min(m, this.pos.x));
    this.pos.z = Math.max(-m, Math.min(m, this.pos.z));

    if (this.swimming) this.anim = 'walk';
    else if (!this.grounded) this.anim = this.vel.y > 1 ? 'jump' : 'fall';
    else if (mag > 0.05) this.anim = run ? 'run' : 'walk';
    else this.anim = 'idle';

    this.jumpQueued = false;
  }
}

const WORLD_LIMIT = WORLD.half - 12;   // keep just inside the world edge (4096 map)
