// Keyframe easing.
//
// One shared table, imported by both the editor and the runtime. When these
// lived as separate copies of `t*t*(3-2*t)` in two files, the preview and the
// game were one edit away from disagreeing about what an animation looked like.
//
// Every curve maps 0..1 to 0..1. `step` is the exception that holds its value
// until the next key — it returns 0 throughout, and the sampler reads that as
// "no progress yet".

const c1 = 1.70158;            // the standard overshoot constant
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;

export const EASES = {
  // the workhorses
  smooth:     (t) => t * t * (3 - 2 * t),        // smoothstep — the default
  linear:     (t) => t,
  step:       () => 0,

  // accelerate / decelerate
  inQuad:     (t) => t * t,
  outQuad:    (t) => 1 - (1 - t) * (1 - t),
  inOutQuad:  (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic:    (t) => t * t * t,
  outCubic:   (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inExpo:     (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo:    (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  // overshoot and settle — what makes a motion read as weight rather than a lerp
  inBack:     (t) => c3 * t * t * t - c1 * t * t,
  outBack:    (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  inOutBack:  (t) => (t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2),
  outElastic: (t) => (t === 0 || t === 1 ? t
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  outBounce:  (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

/** Ordered for the picker: the ones you reach for most, first. */
export const EASE_ORDER = [
  'smooth', 'linear', 'step',
  'inQuad', 'outQuad', 'inOutQuad',
  'inCubic', 'outCubic', 'inOutCubic',
  'inExpo', 'outExpo',
  'inBack', 'outBack', 'inOutBack',
  'outElastic', 'outBounce',
];

export const EASE_LABEL = {
  smooth: 'Smooth', linear: 'Linear', step: 'Step (hold)',
  inQuad: 'Ease in', outQuad: 'Ease out', inOutQuad: 'Ease in-out',
  inCubic: 'Ease in ×3', outCubic: 'Ease out ×3', inOutCubic: 'Ease in-out ×3',
  inExpo: 'Expo in', outExpo: 'Expo out',
  inBack: 'Anticipate', outBack: 'Overshoot', inOutBack: 'Anticipate + overshoot',
  outElastic: 'Elastic', outBounce: 'Bounce',
};

export const isEase = (e) => Object.prototype.hasOwnProperty.call(EASES, e);
/** Apply one, falling back to smooth for anything unknown. */
export const ease = (name, t) => (EASES[name] || EASES.smooth)(t);
