// Build A Boat For Treasure — sound.
// Everything is synthesised in the browser: no audio files, and each material
// gets its own voice so a wooden hull and a gold hull sound different when hit.

let ctx = null;
let master = null;
let muted = false;

function A() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}
// browsers block audio until a gesture, so the first tap/click wakes it
export function unlock() { const c = A(); if (c && c.state === 'suspended') c.resume(); }
export function setMuted(v) { muted = v; if (master) master.gain.value = v ? 0 : 0.55; }

function tone(freq, dur, type = 'sine', vol = 0.2, glideTo = 0, delay = 0) {
  const c = A(); if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.03);
}

function noise(dur, vol = 0.2, filter = 900, type = 'lowpass', delay = 0, sweepTo = 0) {
  const c = A(); if (!c || muted) return;
  const t = c.currentTime + delay;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.8);
  const src = c.createBufferSource(); src.buffer = b;
  const f = c.createBiquadFilter(); f.type = type;
  f.frequency.setValueAtTime(filter, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

// ---- building -----------------------------------------------------------
// each material lands with a different thunk
const PLACE = {
  wood:     () => { tone(210, 0.09, 'square', 0.10, 120); noise(0.05, 0.10, 1500); },
  plastic:  () => { tone(520, 0.06, 'sine', 0.09, 380); noise(0.03, 0.06, 3000, 'highpass'); },
  brick:    () => { tone(150, 0.10, 'square', 0.11, 90);  noise(0.07, 0.14, 800); },
  ice:      () => { tone(880, 0.10, 'sine', 0.09, 620);   noise(0.05, 0.07, 4200, 'highpass'); },
  metal:    () => { tone(330, 0.14, 'triangle', 0.10, 190); noise(0.05, 0.09, 2600, 'highpass'); },
  gold:     () => { tone(420, 0.18, 'triangle', 0.11, 260); tone(630, 0.16, 'sine', 0.06, 400, 0.02); },
  balloon:  () => { tone(300, 0.13, 'sine', 0.09, 620); },
  thruster: () => { tone(120, 0.16, 'sawtooth', 0.09, 70); noise(0.09, 0.08, 700); },
  sail:     () => { noise(0.20, 0.11, 1400, 'lowpass', 0, 500); },
  seat:     () => { tone(260, 0.09, 'sine', 0.09, 170); },
};
export const place = (id) => (PLACE[id] || PLACE.wood)();
export const remove = () => { tone(420, 0.08, 'sine', 0.09, 180); noise(0.05, 0.07, 1800); };
export const pick = () => tone(660, 0.05, 'sine', 0.07, 880);
export const deny = () => { tone(180, 0.10, 'square', 0.09, 120); tone(140, 0.12, 'square', 0.08, 90, 0.06); };

// ---- economy ------------------------------------------------------------
export function buy() {
  [880, 1180, 1480].forEach((f, i) => tone(f, 0.13, 'sine', 0.10, f * 1.25, i * 0.05));
  noise(0.10, 0.05, 5000, 'highpass', 0.02);
}
export function coins(n = 6) {
  for (let i = 0; i < n; i++) {
    const f = 900 + Math.random() * 900;
    tone(f, 0.10, 'sine', 0.055, f * 1.3, i * 0.055);
  }
}

// ---- the voyage ---------------------------------------------------------
export function launch() {
  tone(160, 0.5, 'sawtooth', 0.16, 220);          // horn
  tone(240, 0.5, 'sawtooth', 0.10, 330, 0.02);
  noise(0.55, 0.16, 700, 'lowpass', 0.16, 250);   // splash / wash
}
// hitting a block: pitch and timbre follow the material that got struck
const HIT = {
  wood:     () => { tone(160, 0.12, 'square', 0.13, 80);  noise(0.10, 0.16, 1100); },
  plastic:  () => { tone(430, 0.09, 'sine', 0.10, 240);   noise(0.06, 0.10, 2600, 'highpass'); },
  brick:    () => { tone(110, 0.14, 'square', 0.14, 60);  noise(0.12, 0.20, 700); },
  ice:      () => { tone(1050, 0.12, 'sine', 0.12, 520);  noise(0.09, 0.14, 5200, 'highpass'); },
  metal:    () => { tone(520, 0.26, 'triangle', 0.14, 300); tone(790, 0.22, 'sine', 0.07, 460, 0.01); },
  gold:     () => { tone(600, 0.30, 'triangle', 0.14, 340); tone(910, 0.26, 'sine', 0.08, 520, 0.01); },
  balloon:  () => { tone(700, 0.10, 'sine', 0.12, 160); noise(0.09, 0.12, 2200, 'highpass'); },
  thruster: () => { tone(180, 0.16, 'sawtooth', 0.13, 90); noise(0.10, 0.14, 900); },
  sail:     () => { noise(0.16, 0.13, 1600, 'lowpass', 0, 600); },
  seat:     () => { tone(250, 0.12, 'sine', 0.11, 140); },
};
export const hit = (id) => (HIT[id] || HIT.wood)();
export function breakBlock() {
  noise(0.26, 0.22, 1800, 'lowpass', 0, 300);
  tone(190, 0.20, 'square', 0.11, 60);
}
export function stageUp() {
  [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.11, f, i * 0.07));
}
export function sink() {
  tone(300, 1.1, 'sine', 0.14, 55);                // pitch falling away
  noise(1.0, 0.16, 900, 'lowpass', 0.05, 120);     // gurgle
}
export function treasure() {
  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((f, i) => {
    tone(f, 0.42, 'triangle', 0.13, f, i * 0.11);
    tone(f * 2, 0.30, 'sine', 0.05, f * 2, i * 0.11 + 0.02);
  });
  coins(10);
}

// ---- ambience -----------------------------------------------------------
// a soft filtered-noise river bed, plus a thruster hum while under power
let riverSrc = null, riverGain = null, thrGain = null, thrOsc = null;
export function startAmbience() {
  const c = A(); if (!c || riverSrc) return;
  const n = Math.floor(c.sampleRate * 2);
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  riverSrc = c.createBufferSource(); riverSrc.buffer = b; riverSrc.loop = true;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  riverGain = c.createGain(); riverGain.gain.value = 0.05;
  riverSrc.connect(f); f.connect(riverGain); riverGain.connect(master);
  riverSrc.start();

  thrOsc = c.createOscillator(); thrOsc.type = 'sawtooth'; thrOsc.frequency.value = 62;
  const tf = c.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 260;
  thrGain = c.createGain(); thrGain.gain.value = 0;
  thrOsc.connect(tf); tf.connect(thrGain); thrGain.connect(master);
  thrOsc.start();
}
// 0..1 — how hard the river is rushing (scales with speed)
export function setRiver(v) { if (riverGain) riverGain.gain.value = 0.035 + v * 0.075; }
export function setThruster(v) { if (thrGain) thrGain.gain.value = Math.min(0.09, v * 0.05); }
