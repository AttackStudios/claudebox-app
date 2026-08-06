// movement.js — momentum-based FPS movement for ClaudeBox Rivals.
//
// WHY THIS EXISTS
// The stock Rivals mover snaps horizontal velocity straight to your input
// (vel = wishdir * speed) every frame. That is responsive but it throws away
// momentum, so there is no strafe-jumping, no bunny-hop, and air input can only
// ever redirect you at walking pace. This module replaces that with the
// accelerate/friction model every momentum shooter descends from: you never set
// velocity, you only ever ADD to it, and the amount you may add is capped by how
// much of your speed already points where you are asking to go.
//
// The whole trick lives in `accelerate()`: the cap is measured along wishdir
// only, so velocity perpendicular to your input is never counted and never
// removed. Air-strafing falls out of that for free — hold a strafe key, sweep
// the mouse, and your wishdir stays roughly perpendicular to your velocity, so
// the projection stays near zero and you keep getting to add speed every frame.
//
// Original implementation, written for this repo. No collision or gravity here:
// the host owns those. This only decides what horizontal velocity should be.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
// World scale note: Rivals runs ~1 unit = 1 metre, walk 6.4, gravity 17.
// Quake-family numbers are quoted in units-per-second where 320ups = run, so
// the conversion used throughout is roughly 1 Rivals unit = 50 Quake units.

export const DEFAULTS = {
  // --- ground ---
  maxSpeed: 8.0,        // speed ground acceleration will push you toward
  crouchSpeed: 4.0,
  accel: 11,            // unitless; higher = reaches maxSpeed sooner
  friction: 6.0,        // unitless; higher = stops harder
  stopSpeed: 2.0,       // below this, friction is applied as if you were at it
                        // (stops the asymptotic crawl to zero)

  // --- air ---
  airAccel: 12,         // acceleration available while airborne
  airWishCap: 1.2,      // THE strafe knob. Air acceleration only ever tries to
                        // reach THIS speed along wishdir, not maxSpeed. Small
                        // cap + perpendicular wishdir = unbounded strafe gain.
                        // 0.6 ~= 30ups (classic Source/CS); raised here because
                        // the tight value feels like ice — this trades a little
                        // strafe purity for steering you can actually feel.
  airControl: 0.0,      // CPM-style redirect (rotate velocity toward wishdir at
                        // constant speed) — only with forward-only input.
                        // 0 = Source feel, 1.5+ = Quake CPM feel.
  airControlMax: 0.75,  // fraction of maxSpeed above which redirect fades out

  // --- jumping ---
  jumpVel: 8.6,
  autoBhop: true,       // holding jump re-jumps on landing (no perfect timing)
  jumpBuffer: 0.12,     // press this long before landing and it still fires
  coyote: 0.10,         // jump this long after walking off a ledge
  landFrictionSkip: 0.05, // skip friction for this long after touchdown when a
                          // jump is queued — this is what makes hops keep speed

  // --- limits ---
  hardCap: 0,           // absolute horizontal clamp; 0 = uncapped (recommended)

  // --- slide ---
  // SLIDE — the core movement primitive. Pressing crouch COMMITS you: releasing
  // the key does nothing, the slide runs its full length, and the only way out
  // early is to jump, which pays you a momentum BOOST for doing it. That makes
  // slide -> jump -> air-strafe -> land -> slide a chain rather than a stop.
  slide: true,
  slideDuration: 1.5,   // committed lifetime in seconds; release cannot cancel
  slideBurst: 10,       // speed a slide is set to on entry
  slideKeep: 1.0,       // fraction of your speed carried in if already faster
                        // (1.0 = a slide never brakes you; from normal running
                        // speed the burst wins, so a slide reads ~10 u/s)
  slideFriction: 1.4,   // gentle bleed across the slide (never ends it).
                        // With slideHopKeep this sets where a slide-jump chain
                        // settles: equilibrium ~= slideFriction*slideDuration
                        // / (slideHopKeep - 1).
  slideMin: 7.5,        // floor the bleed stops at (NOT an exit condition)
  slideEntry: 3.2,      // minimum speed required to start a slide
  slideCooldown: 0.25,
  slideSteer: 2.4,      // how hard you may curve a slide (0 = rails)
  slideHopKeep: 1.15,   // jump-out multiplier. >1 = leaving early PAYS you.
  slideHopWindow: 0.2,  // jump within this long after a slide ends, still hops
};

// Presets are starting points, not truths — the feel you are chasing lives in
// airWishCap / airAccel / airControl / friction. Tune by hand in movelab.html.
export const PRESETS = {
  // Fast, forgiving, strong redirect. Auto-bhop and a snappy slide.
  velocity: {
    // Tuned by hand in movelab.html and baked in — every value below differs
    // from DEFAULTS except autoBhop/hardCap/slide*, which are pinned on purpose.
    maxSpeed: 8.6, accel: 13, friction: 5.4, stopSpeed: 2.2,
    // airWishCap 4.45 is the tuned value: a wide window, so air input keeps
    // biting well past walking speed and strafe gain ramps fast. It stays a CAP
    // on speed-along-wishdir, so holding forward still adds nothing.
    airAccel: 18, airWishCap: 4.45, airControl: 1.1,
    jumpVel: 8.8, autoBhop: true, hardCap: 0,
    slideBurst: 10, slideFriction: 1.4, slideHopKeep: 1.15, slideSteer: 3.0, slideDuration: 1.5,
  },
  // Vanilla Quake 3: no wish cap to speak of, low air accel. Strafe-jumping
  // rewards a smooth mouse and nothing else.
  quake: {
    maxSpeed: 6.4, accel: 10, friction: 6, stopSpeed: 2.0,
    airAccel: 1.0, airWishCap: 6.4, airControl: 0,
    jumpVel: 5.6, autoBhop: false, hardCap: 0,
    slide: false,
  },
  // CPM / Defrag: air control lets you turn on a dime while holding forward.
  cpm: {
    maxSpeed: 6.4, accel: 15, friction: 8, stopSpeed: 2.0,
    airAccel: 1.0, airWishCap: 0.6, airControl: 2.5, airControlMax: 0.75,
    jumpVel: 5.6, autoBhop: true, hardCap: 0,
    slide: false,
  },
  // Source-engine bunny-hop: the 30ups cap, high air accel, hard speed limit
  // is what the original games clamp with (left off here).
  source: {
    maxSpeed: 6.4, accel: 10, friction: 4, stopSpeed: 2.0,
    airAccel: 12, airWishCap: 0.6, airControl: 0,
    jumpVel: 6.0, autoBhop: true, hardCap: 0,
  },
  // The stock Rivals mover, for A/B. Instant velocity, no momentum.
  arcade: {
    maxSpeed: 6.4, accel: 999, friction: 999, stopSpeed: 99,
    airAccel: 999, airWishCap: 6.4, airControl: 0,
    jumpVel: 8.6, autoBhop: false, hardCap: 6.4,
  },
};

export function tuning(name, over) {
  return { ...DEFAULTS, ...(PRESETS[name] || {}), ...(over || {}) };
}

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

// Add speed along wishdir, but only up to `wishSpeed` MEASURED ALONG WISHDIR.
// Speed you already carry sideways is invisible to this cap, which is the
// entire reason strafe-jumping accumulates instead of saturating.
function accelerate(vel, wx, wz, wishSpeed, accel, dt) {
  const projected = vel.x * wx + vel.z * wz;
  const room = wishSpeed - projected;
  if (room <= 0) return;
  const add = Math.min(room, accel * wishSpeed * dt);
  vel.x += wx * add;
  vel.z += wz * add;
}

// Scale horizontal velocity down. Uses stopSpeed as a floor so low speeds bleed
// off in finite time instead of approaching zero forever.
function applyFriction(vel, friction, stopSpeed, dt) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-4) { vel.x = 0; vel.z = 0; return; }
  const control = speed < stopSpeed ? stopSpeed : speed;
  const drop = control * friction * dt;
  const scale = Math.max(0, speed - drop) / speed;
  vel.x *= scale;
  vel.z *= scale;
}

// CPM air control: rotate velocity toward wishdir WITHOUT changing its
// magnitude. Applied only for forward-dominant input, otherwise it would
// cancel out the strafe gain that accelerate() just earned.
function airControl(vel, wx, wz, cfg, dt) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 0.05 || cfg.airControl <= 0) return;
  const vx = vel.x / speed, vz = vel.z / speed;
  const dot = vx * wx + vz * wz;
  if (dot <= 0) return;                       // never redirect backwards
  // fade the effect in only once you are actually moving fast
  const fade = clamp((speed / (cfg.maxSpeed || 1) - cfg.airControlMax) / 0.5, 0, 1);
  const k = 32 * cfg.airControl * fade * dot * dot * dt;
  let nx = vx * speed + wx * k;
  let nz = vz * speed + wz * k;
  const len = Math.hypot(nx, nz) || 1;
  vel.x = (nx / len) * speed;                 // renormalised: turn, do not gain
  vel.z = (nz / len) * speed;
}

// ---------------------------------------------------------------------------
// Mover
// ---------------------------------------------------------------------------

export function createMover(cfg) {
  const C = { ...DEFAULTS, ...(cfg || {}) };

  // per-player scratch, keyed off the state object the host already owns
  const mem = new WeakMap();
  const memo = (m) => {
    let s = mem.get(m);
    if (!s) {
      s = { jumpAt: -99, leftGroundAt: -99, landedAt: -99, slideEndAt: -99,
            slidePressAt: -99, wasGrounded: true, jumpHeldLast: false,
            jumpLock: false, slideStartAt: -99 };
      mem.set(m, s);
    }
    return s;
  };

  /**
   * @param m      { vel:{x,y,z}, grounded, crouch, sliding, slideVel } — mutated
   * @param input  { wishX, wishZ, forwardOnly, jumpHeld, crouchHeld, now,
   *                 frozen, canJump, canSlide }
   * @param dt     seconds
   * @returns      { jumped, slideStarted, slideEnded, hopped, speed }
   */
  function step(m, input, dt) {
    const s = memo(m);
    const now = input.now;
    const out = { jumped: false, slideStarted: false, slideEnded: false, hopped: false, speed: 0 };
    if (dt <= 0) return out;

    let wx = input.wishX || 0, wz = input.wishZ || 0;
    const wlen = Math.hypot(wx, wz);
    if (wlen > 1e-4) { wx /= wlen; wz /= wlen; } else { wx = 0; wz = 0; }
    const hasWish = wlen > 1e-4 && !input.frozen;

    // --- ground/air bookkeeping -------------------------------------------
    if (m.grounded && !s.wasGrounded) { s.landedAt = now; s.jumpLock = false; }
    if (m.grounded) s.jumpLock = false;
    if (!m.grounded && s.wasGrounded) s.leftGroundAt = now;
    s.wasGrounded = m.grounded;

    const jumpPressed = input.jumpHeld && !s.jumpHeldLast;
    if (jumpPressed) s.jumpAt = now;
    s.jumpHeldLast = input.jumpHeld;

    if (input.crouchHeld && !m.crouch) s.slidePressAt = now;
    m.crouch = !!input.crouchHeld;

    // A queued jump = pressed recently (buffer), or held with auto-bhop on.
    const jumpQueued = !input.frozen && input.canJump !== false &&
      (now - s.jumpAt < C.jumpBuffer || (C.autoBhop && input.jumpHeld));

    // --- slide entry -------------------------------------------------------
    const speedNow = Math.hypot(m.vel.x, m.vel.z);
    if (C.slide && input.canSlide !== false && !m.sliding && !input.frozen &&
        m.grounded && input.crouchHeld &&
        now - s.slidePressAt < 0.3 && now - s.slideEndAt > C.slideCooldown &&
        speedNow > C.slideEntry) {
      const target = Math.max(C.slideBurst, speedNow * C.slideKeep);
      const dirX = speedNow > 1e-4 ? m.vel.x / speedNow : wx;
      const dirZ = speedNow > 1e-4 ? m.vel.z / speedNow : wz;
      m.sliding = true;
      m.slideVel = { x: dirX * target, z: dirZ * target };
      s.slideStartAt = now;
      out.slideStarted = true;
    }
    // Leaving the ground drops the slide STATE but keeps every bit of speed.
    // Note there is no crouch-release check here on purpose: the slide is
    // committed, and only a jump (or its timer) gets you out.
    if (m.sliding && !m.grounded) {
      m.sliding = false;
      s.slideEndAt = now;
      out.slideEnded = true;
    }

    // --- horizontal velocity ----------------------------------------------
    if (m.sliding) {
      // Slides decay linearly and may be steered gently, never accelerated.
      const sv = m.slideVel;
      let len = Math.hypot(sv.x, sv.z);
      // bleed gently, but never below the floor — the TIMER ends the slide,
      // not the speed, so a committed slide always lasts its full length
      len = Math.max(C.slideMin, len - C.slideFriction * dt);
      if (now - s.slideStartAt >= C.slideDuration) {
        m.sliding = false;
        s.slideEndAt = now;
        out.slideEnded = true;
        const k = len / (Math.hypot(sv.x, sv.z) || 1);
        sv.x *= k; sv.z *= k;                   // keep it hoppable for a beat
        m.vel.x = sv.x; m.vel.z = sv.z;
      } else {
        const cur = Math.hypot(sv.x, sv.z) || 1;
        sv.x *= len / cur; sv.z *= len / cur;
        if (hasWish && C.slideSteer > 0) {          // curve, preserving speed
          sv.x += wx * C.slideSteer * dt * len;
          sv.z += wz * C.slideSteer * dt * len;
          const rl = Math.hypot(sv.x, sv.z) || 1;
          sv.x = (sv.x / rl) * len; sv.z = (sv.z / rl) * len;
        }
        m.vel.x = sv.x; m.vel.z = sv.z;
      }
    } else if (m.grounded) {
      // Skip friction on the frame we are about to leave the ground, and for a
      // beat after landing with a jump queued. Without this, a hop chain loses
      // a slice of speed on every touchdown and bunny-hopping cannot work.
      const hopping = jumpQueued && now - s.landedAt <= C.landFrictionSkip;
      if (!hopping) applyFriction(m.vel, C.friction, C.stopSpeed, dt);
      if (hasWish) {
        const target = m.crouch ? C.crouchSpeed : C.maxSpeed;
        accelerate(m.vel, wx, wz, target, C.accel, dt);
      }
    } else if (hasWish) {
      // Airborne: the cap is tiny, so gain only comes from wishdir being nearly
      // perpendicular to velocity. That is the strafe.
      accelerate(m.vel, wx, wz, C.airWishCap, C.airAccel, dt);
      if (C.airControl > 0 && input.forwardOnly) airControl(m.vel, wx, wz, C, dt);
    }

    // --- jump --------------------------------------------------------------
    // Coyote applies only to WALKING off a ledge. After a jump, jumpLock holds
    // until we touch ground again — without it, auto-bhop + coyote re-fires the
    // jump every frame while airborne and the player simply flies away.
    const coyoteOk = m.grounded || (!s.jumpLock && now - s.leftGroundAt < C.coyote);
    if (jumpQueued && coyoteOk && !input.frozen) {
      m.vel.y = C.jumpVel;
      m.grounded = false;
      s.jumpAt = -99;                    // consume the buffered press
      s.jumpLock = true;                 // no second jump until we land
      out.jumped = true;

      const fromSlide = m.sliding || now - s.slideEndAt < C.slideHopWindow;
      if (fromSlide && m.slideVel) {
        const sl = Math.hypot(m.slideVel.x, m.slideVel.z);
        const cur = Math.hypot(m.vel.x, m.vel.z);
        if (sl * C.slideHopKeep > cur) { // only ever a boost, never a brake
          m.vel.x = m.slideVel.x * C.slideHopKeep;
          m.vel.z = m.slideVel.z * C.slideHopKeep;
          out.hopped = true;
          out.hopSpeed = Math.hypot(m.vel.x, m.vel.z);
        }
      }
      if (m.sliding) { m.sliding = false; s.slideEndAt = now; out.slideEnded = true; }
    }

    // --- hard cap (off by default; capping kills the whole point) ----------
    if (C.hardCap > 0) {
      const sp = Math.hypot(m.vel.x, m.vel.z);
      if (sp > C.hardCap) { const k = C.hardCap / sp; m.vel.x *= k; m.vel.z *= k; }
    }

    out.speed = Math.hypot(m.vel.x, m.vel.z);
    return out;
  }

  return {
    cfg: C,
    step,
    set(patch) { Object.assign(C, patch); },
    reset(m) { mem.delete(m); },
  };
}

export default { createMover, tuning, PRESETS, DEFAULTS };
