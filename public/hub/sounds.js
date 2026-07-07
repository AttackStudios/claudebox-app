// ClaudeBox sound engine — every sound is synthesized with the Web Audio API,
// so there are no asset files to load and nothing to cache. Sounds are gentle,
// short, and musical (a C-major-ish palette) so the menu feels alive without
// being annoying. Gated behind the first user gesture per browser autoplay
// rules, and fully muteable.

const NOTES = { C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.5 };

let ctx = null;
let master = null;
let enabled = true;
let unlocked = false;
let ambient = null; // { stop } when ambient pad is running

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  return ctx;
}

// A quick shaped tone. type/freq/dur plus optional attack/peak level & a
// glide target for little "whoop" flourishes.
function tone({ freq = 440, type = 'sine', dur = 0.14, peak = 0.18, attack = 0.008, glide = null, pan = 0, delay = 0 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glide), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = gain;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    gain.connect(p);
    node = p;
  }
  osc.connect(gain);
  node.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// Filtered noise burst — used for soft "pop"/"whoosh" textures.
function noise({ dur = 0.16, peak = 0.10, type = 'bandpass', freq = 1200, q = 0.7, glide = null, delay = 0 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * (dur + 0.02));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // deterministic-ish pseudo noise (no Math.random dependency needed, but fine)
  for (let i = 0; i < len; i++) data[i] = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  filter.Q.value = q;
  if (glide) filter.frequency.exponentialRampToValueAtTime(Math.max(40, glide), t0 + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter); filter.connect(gain); gain.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

// A soft ambient pad (two detuned oscillators through a slow filter). Quiet by
// design; toggled off by default.
function startAmbient() {
  if (!ctx || ambient) return;
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 3);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 700;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.06;
  lfoGain.gain.value = 220;
  lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
  const a = ctx.createOscillator(), b = ctx.createOscillator();
  a.type = b.type = 'sawtooth';
  a.frequency.value = NOTES.C4 / 2;
  b.frequency.value = NOTES.G4 / 2;
  b.detune.value = 6;
  a.connect(filt); b.connect(filt); filt.connect(g); g.connect(master);
  a.start(); b.start(); lfo.start();
  ambient = {
    stop() {
      try {
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
        setTimeoutSafe(() => { [a, b, lfo].forEach((n) => { try { n.stop(); } catch {} }); }, 1400);
      } catch {}
      ambient = null;
    },
  };
}
// setTimeout that survives (no Date.now needed)
function setTimeoutSafe(fn, ms) { return setTimeout(fn, ms); }

// ---- the public palette -------------------------------------------------
export const sfx = {
  // called from the first pointer/key gesture; resumes a suspended context
  unlock() {
    if (unlocked) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    unlocked = true;
  },
  setEnabled(v) {
    enabled = !!v;
    if (!enabled && ambient) ambient.stop();
  },
  isEnabled() { return enabled; },

  // subtle whisper on hover
  hover() { tone({ freq: NOTES.C6, type: 'sine', dur: 0.05, peak: 0.03, attack: 0.004 }); },
  // primary click — a crisp two-layer tick
  tap() {
    tone({ freq: NOTES.G5, type: 'triangle', dur: 0.06, peak: 0.10, attack: 0.003 });
    noise({ dur: 0.05, peak: 0.05, type: 'highpass', freq: 2600 });
  },
  // switching a tab / segment — a soft mallet note
  select() {
    tone({ freq: NOTES.E5, type: 'sine', dur: 0.14, peak: 0.12 });
    tone({ freq: NOTES.G5, type: 'sine', dur: 0.12, peak: 0.06, delay: 0.02 });
  },
  // toggle on/off
  toggleOn() { tone({ freq: NOTES.E5, type: 'sine', dur: 0.1, peak: 0.12, glide: NOTES.C6 }); },
  toggleOff() { tone({ freq: NOTES.E5, type: 'sine', dur: 0.1, peak: 0.1, glide: NOTES.C4 }); },
  // launching a game — a rising three-note flourish + airy whoosh
  launch() {
    tone({ freq: NOTES.C5, type: 'triangle', dur: 0.12, peak: 0.14 });
    tone({ freq: NOTES.E5, type: 'triangle', dur: 0.12, peak: 0.14, delay: 0.08 });
    tone({ freq: NOTES.G5, type: 'triangle', dur: 0.2, peak: 0.16, delay: 0.16 });
    tone({ freq: NOTES.C6, type: 'sine', dur: 0.3, peak: 0.1, delay: 0.24 });
    noise({ dur: 0.5, peak: 0.05, type: 'bandpass', freq: 500, glide: 4000 });
  },
  // happy confirmation — a bright major arpeggio
  success() {
    [NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6].forEach((f, i) =>
      tone({ freq: f, type: 'sine', dur: 0.22, peak: 0.13, delay: i * 0.06 }));
  },
  // a friend/toast appears — a gentle pop
  toast() {
    tone({ freq: NOTES.A4, type: 'sine', dur: 0.12, peak: 0.1, glide: NOTES.E5 });
    noise({ dur: 0.08, peak: 0.03, type: 'bandpass', freq: 900 });
  },
  // going back / closing — a soft descending note
  back() { tone({ freq: NOTES.G5, type: 'sine', dur: 0.12, peak: 0.1, glide: NOTES.C5 }); },
  // welcome sting on login success
  welcome() {
    [NOTES.C5, NOTES.G5, NOTES.E5, NOTES.C6].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.32, peak: 0.14, delay: i * 0.1 }));
  },
  // ambient pad control
  setAmbient(on) {
    if (!enabled) return;
    if (on) { ensureCtx(); startAmbient(); }
    else if (ambient) ambient.stop();
  },
};
