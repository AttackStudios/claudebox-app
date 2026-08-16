// Obby sound — everything synthesised, no audio files.
// Deliberately bright and toy-like to match the course.

let ctx = null, master = null, muted = false;
function A() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}
export function unlock() { const c = A(); if (c && c.state === 'suspended') c.resume(); }
export function setMuted(v) { muted = v; if (master) master.gain.value = v ? 0 : 0.5; }
export const isMuted = () => muted;

function tone(freq, dur, type = 'sine', vol = 0.18, glide = 0, delay = 0) {
  const c = A(); if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur, vol = 0.15, filter = 1200, type = 'lowpass', delay = 0, sweepTo = 0) {
  const c = A(); if (!c || muted) return;
  const t = c.currentTime + delay;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const src = c.createBufferSource(); src.buffer = b;
  const f = c.createBiquadFilter(); f.type = type;
  f.frequency.setValueAtTime(filter, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

// ---- movement ----
export const jump = () => { tone(430, 0.11, 'sine', 0.13, 700); noise(0.05, 0.05, 2200, 'highpass'); };
export const land = () => { tone(150, 0.09, 'sine', 0.12, 90); noise(0.06, 0.09, 700); };
export const step = () => noise(0.035, 0.03, 900);
export const doubleJump = () => { tone(620, 0.12, 'triangle', 0.12, 980); tone(880, 0.1, 'sine', 0.07, 1200, 0.03); };
export const bounce = () => { tone(300, 0.16, 'sine', 0.16, 1100); tone(520, 0.12, 'triangle', 0.08, 1500, 0.04); };
export const slip = () => noise(0.2, 0.05, 2600, 'highpass', 0, 900);

// ---- progress ----
export function checkpoint() {
  [660, 880, 1170].forEach((f, i) => tone(f, 0.2, 'triangle', 0.14, f, i * 0.07));
  noise(0.12, 0.05, 5200, 'highpass', 0.02);
}
export function die() {
  tone(320, 0.5, 'sawtooth', 0.14, 70);
  noise(0.4, 0.12, 900, 'lowpass', 0.02, 140);
}
export function lava() { noise(0.5, 0.16, 700, 'lowpass', 0, 120); tone(120, 0.45, 'sawtooth', 0.12, 50); }
export function win() {
  const notes = [523, 659, 784, 1047, 1319, 1568];
  notes.forEach((f, i) => {
    tone(f, 0.42, 'triangle', 0.14, f, i * 0.1);
    tone(f * 2, 0.28, 'sine', 0.05, f * 2, i * 0.1 + 0.02);
  });
}

// ---- shop / gear ----
export function buy() {
  [880, 1180, 1480].forEach((f, i) => tone(f, 0.14, 'sine', 0.12, f * 1.25, i * 0.05));
  noise(0.1, 0.05, 5000, 'highpass', 0.02);
}
export const deny = () => { tone(200, 0.11, 'square', 0.1, 130); tone(150, 0.13, 'square', 0.09, 95, 0.07); };
export const click = () => tone(720, 0.05, 'sine', 0.08, 960);
export const equip = () => { tone(520, 0.09, 'triangle', 0.1, 760); noise(0.04, 0.04, 3000, 'highpass'); };
export const carpet = () => { tone(280, 0.4, 'sine', 0.11, 560); tone(420, 0.35, 'triangle', 0.07, 700, 0.05); noise(0.3, 0.05, 1800, 'lowpass', 0, 600); };
export const warp = () => { tone(900, 0.28, 'sine', 0.12, 200); noise(0.22, 0.07, 3000, 'highpass', 0, 500); };

// ---- hazards ----
export const laserZap = () => { tone(1400, 0.09, 'sawtooth', 0.1, 500); noise(0.06, 0.06, 4000, 'highpass'); };
export const whoosh = () => noise(0.22, 0.08, 1400, 'lowpass', 0, 400);
