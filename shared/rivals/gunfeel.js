// Rivals — how a gun FEELS to fire. Original implementation.
//
// Three ideas, all learnable by the player:
//   1. RECOIL PATTERN — every shot walks the view along a repeatable path, so a
//      good player learns to pull against it. Randomness is a small jitter on
//      top of a deterministic spine, never the whole story.
//   2. BLOOM — sustained fire opens the cone; it recovers when you let off.
//      This is what makes tapping better than holding at range.
//   3. RECOVERY — the view drifts back toward where it started after you stop,
//      so the pattern doesn't permanently steal your aim.
//
// Tuning lives in FEEL below; everything else is derived.

const D = {
  up: 0.011,          // radians of climb per shot at the pattern's peak
  upFirst: 0.45,      // first shot is softer (fraction of `up`)
  ramp: 4,            // shots to reach full climb
  side: 0.004,        // horizontal wander amplitude
  sideSeed: 1.7,      // shapes the horizontal walk (higher = tighter zigzag)
  jitter: 0.18,       // fraction of the step that is random
  recover: 6.5,       // how fast the view returns (higher = snappier)
  recoverDelay: 0.12, // seconds after the last shot before recovery starts
  bloom: 0.0022,      // spread added per shot
  bloomMax: 0.026,    // cap on added spread
  bloomDecay: 0.055,  // spread bled off per second once you stop
  adsMul: 0.42,       // recoil + bloom multiplier while aiming
  moveMul: 1.5,       // spread multiplier while running
  airMul: 2.1,        // spread multiplier while airborne
  kick: 1.0,          // viewmodel punch
  shake: 0.0016,      // tiny camera shake, separate from the pattern
};

// Per-weapon overrides. Anything omitted uses D.
const FEEL = {
  ar:        { up: 0.0105, side: 0.0042, ramp: 5, bloom: 0.0020, kick: 1.0 },
  smg:       { up: 0.0082, side: 0.0055, ramp: 7, sideSeed: 2.3, bloom: 0.0026, bloomMax: 0.032, kick: 0.85, jitter: 0.26 },
  carbine:   { up: 0.0112, side: 0.0038, ramp: 4, bloom: 0.0018, kick: 1.05 },
  battle:    { up: 0.0152, side: 0.0050, ramp: 3, bloom: 0.0024, kick: 1.25 },
  burst:     { up: 0.0128, side: 0.0036, ramp: 3, bloom: 0.0016, kick: 1.1 },
  minigun:   { up: 0.0060, side: 0.0068, ramp: 14, sideSeed: 2.9, bloom: 0.0030, bloomMax: 0.040, kick: 0.7, jitter: 0.34 },
  handgun:   { up: 0.0135, side: 0.0030, ramp: 2, upFirst: 0.7, bloom: 0.0028, recover: 8.5, kick: 1.0 },
  revolver:  { up: 0.0230, side: 0.0034, ramp: 1, upFirst: 1.0, bloom: 0.0030, recover: 7, kick: 1.5 },
  deagle:    { up: 0.0245, side: 0.0040, ramp: 1, upFirst: 1.0, bloom: 0.0032, recover: 7, kick: 1.55 },
  uzi:       { up: 0.0078, side: 0.0060, ramp: 8, sideSeed: 2.6, bloom: 0.0030, bloomMax: 0.034, kick: 0.8, jitter: 0.3 },
  shorty:    { up: 0.0290, side: 0.0075, ramp: 1, upFirst: 1.0, bloom: 0.0040, recover: 5.5, kick: 1.8 },
  shotgun:   { up: 0.0330, side: 0.0080, ramp: 1, upFirst: 1.0, bloom: 0.0045, recover: 5, kick: 2.0 },
  sniper:    { up: 0.0380, side: 0.0026, ramp: 1, upFirst: 1.0, bloom: 0.0050, recover: 4.2, kick: 2.2, shake: 0.0026 },
  autosniper:{ up: 0.0240, side: 0.0044, ramp: 2, upFirst: 0.9, bloom: 0.0040, recover: 5.5, kick: 1.7 },
  dmr:       { up: 0.0195, side: 0.0034, ramp: 2, upFirst: 0.9, bloom: 0.0032, recover: 6.5, kick: 1.4 },
};

export const feelFor = (id) => ({ ...D, ...(FEEL[id] || {}) });

// The deterministic spine of the pattern, plus a little jitter.
// `n` is the shot index since you started holding the trigger.
export function recoilStep(id, n, rand = Math.random) {
  const F = feelFor(id);
  const ramp = Math.min(1, (n + 1) / Math.max(1, F.ramp));
  const first = n === 0 ? F.upFirst : 1;
  const up = F.up * ramp * first;
  // horizontal walks a smooth pseudo-path so the pattern is memorable
  const side = Math.sin(n * F.sideSeed) * F.side * ramp
             + Math.sin(n * F.sideSeed * 0.37) * F.side * 0.4 * ramp;
  const j = (v) => v + (rand() - 0.5) * 2 * Math.abs(v) * F.jitter;
  return { up: j(up), side: j(side) };
}

// Spread actually used for a shot, given accumulated bloom and player state.
export function spreadFor(id, baseSpread, bloom, { ads = 0, moving = false, airborne = false } = {}) {
  const F = feelFor(id);
  let s = baseSpread + Math.min(bloom, F.bloomMax);
  if (airborne) s *= F.airMul;
  else if (moving) s *= F.moveMul;
  if (ads > 0.5) s *= F.adsMul;
  return s;
}
