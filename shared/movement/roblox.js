// Roblox-feel character tuning.
//
// The thing that makes Roblox movement recognisable is not its speed or its
// jump height — it is how FAST the arc resolves. A Roblox humanoid reaches the
// top of its jump in about a quarter of a second. Most engines (this one very
// much included) hang in the air roughly twice that long, which reads as floaty
// no matter what the other numbers are.
//
// So the tuning here is a TIME rescale, not a rewrite:
//
//     velocities x k        gravity x k^2
//
//     height   = (kv)^2 / (2 k^2 g) = v^2 / 2g     unchanged
//     airtime  = kv / (k^2 g)       = t / k        k times snappier
//     distance = (k*speed) * (t/k)  = speed * t    unchanged
//
// Jump height and jump distance come out bit-identical, so existing level
// geometry stays exactly as solvable — no gap, ledge or wall needs resizing.
// Only the tempo changes. That is what let this be applied to a hundred
// generated obby stages without rebalancing a single one.

// ---- Roblox R6 defaults, for reference ----
export const ROBLOX = {
  charHeight: 5,        // studs, R6 humanoid
  walkSpeed: 16,        // studs/s
  gravity: 196.2,       // studs/s^2
  jumpPower: 50,        // studs/s of launch velocity
  hipHeight: 2,         // how far a humanoid steps up without jumping
  maxSlopeAngle: 89,    // degrees; you can walk up nearly anything
};
ROBLOX.jumpHeight = ROBLOX.jumpPower ** 2 / (2 * ROBLOX.gravity);   // 6.37 studs
ROBLOX.apex = ROBLOX.jumpPower / ROBLOX.gravity;                    // 0.255 s
ROBLOX.airtime = ROBLOX.apex * 2;
ROBLOX.jumpDistance = ROBLOX.walkSpeed * ROBLOX.airtime;

// The same numbers as fractions of character height, which is how they
// transfer to a world built at a different scale.
export const RATIO = {
  jumpHeight: ROBLOX.jumpHeight / ROBLOX.charHeight,     // 1.274 heights
  jumpDistance: ROBLOX.jumpDistance / ROBLOX.charHeight, // 1.631 heights
  speed: ROBLOX.walkSpeed / ROBLOX.charHeight,           // 3.20 heights/sec
  stepUp: ROBLOX.hipHeight / ROBLOX.charHeight,          // 0.40 heights
};

/**
 * Derive Roblox-tempo constants for a game, preserving its existing jump
 * height and jump distance exactly.
 *
 *   tuneToRoblox({ gravity: 30, jump: 13.4, speeds: { MOVE: 7.8, RUN: 11.5 } })
 *     -> { k, gravity, jump, speeds: { MOVE, RUN }, ... }
 *
 * Anything with units of distance-per-second (conveyor pushes, platform
 * speeds, mover rates) must be multiplied by `k` as well, or the world will
 * feel like it slowed down while the player got faster.
 */
export function tuneToRoblox({ gravity, jump, speeds = {} }) {
  const apex = jump / gravity;
  const k = apex / ROBLOX.apex;
  const out = { k, gravity: gravity * k * k, jump: jump * k, speeds: {} };
  for (const [name, v] of Object.entries(speeds)) out.speeds[name] = v * k;
  out.before = { gravity, jump, apex, height: jump * jump / (2 * gravity) };
  out.after = { apex: out.jump / out.gravity, height: out.jump * out.jump / (2 * out.gravity) };
  return out;
}

/** How far a character of this height should step up without jumping. */
export const stepUpFor = (charHeight) => charHeight * RATIO.stepUp;
