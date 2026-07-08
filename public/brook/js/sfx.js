// Brooktown RP — tiny synthesized sound kit (Web Audio, no assets).
let ac = null;
function ctx() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (ac && ac.state === 'suspended') ac.resume(); return ac; }
function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
  const c = ctx(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const sfx = {
  ui() { tone(660, 0.07, 'triangle', 0.12); },
  cash() { tone(880, 0.09, 'square', 0.12); tone(1320, 0.12, 'square', 0.1, null, 0.08); },
  horn() { tone(300, 0.35, 'sawtooth', 0.18); tone(360, 0.35, 'sawtooth', 0.14); },
  enter() { tone(220, 0.12, 'sine', 0.15, 440); },
  emote() { tone(520, 0.1, 'triangle', 0.12, 780); },
  sit() { tone(300, 0.12, 'sine', 0.1, 200); },
};

// ---- radio: a mellow synth loop toggled from the phone ----
let radioOn = false, radioTimer = null, radioStep = 0;
const SCALE = [0, 3, 5, 7, 10, 12, 7, 5];   // minor pentatonic-ish
export function toggleRadio() {
  radioOn = !radioOn;
  clearInterval(radioTimer);
  if (radioOn) {
    ctx();
    radioTimer = setInterval(() => {
      const c = ctx(); if (!c) return;
      const root = 220 * Math.pow(2, SCALE[radioStep % SCALE.length] / 12);
      tone(root, 0.32, 'triangle', 0.07);
      if (radioStep % 2 === 0) tone(root / 2, 0.5, 'sine', 0.05);
      radioStep++;
    }, 300);
  }
  return radioOn;
}
export function radioIsOn() { return radioOn; }
