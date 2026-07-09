// Rivals — real sound effects (user-provided files in /rivals/sounds).
// Web Audio: low-latency one-shots + looping channels (fire loop, footsteps).
let ctx = null;
const buffers = {};
const FILES = {
  ar: 'AssaultRifleShoot', handgun: 'HandgunShoot', sniper: 'snipershoot',
  fists: 'fistswing', knife: 'knifeswing', reload: 'reload', equip: 'WeaponEquip', foot: 'footsteps',
};

export async function loadAudio() {
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
    try {
      const r = await fetch('/rivals/sounds/' + f + '.mp3');
      const ab = await r.arrayBuffer();
      buffers[k] = await ctx.decodeAudioData(ab);
    } catch (e) { /* missing file → silent */ }
  }));
}
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

// one-shot (overlapping-safe)
export function playOne(name, vol = 1, rate = 1) {
  const b = buffers[name]; if (!ctx || !b) return;
  resumeAudio();
  const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(g); g.connect(ctx.destination); s.start();
}

// looping channel (one persistent source per name)
const loops = {};
export function playLoop(name, vol = 0.6, rate = 1) {
  const b = buffers[name]; if (!ctx || !b) return;
  let L = loops[name];
  if (!L) { L = loops[name] = { src: null, gain: ctx.createGain(), playing: false }; L.gain.connect(ctx.destination); }
  if (L.playing) { L.gain.gain.value = vol; if (rate && L.src) L.src.playbackRate.value = rate; return; }
  resumeAudio();
  L.src = ctx.createBufferSource(); L.src.buffer = b; L.src.loop = true;
  L.src.playbackRate.value = rate; L.gain.gain.value = vol;
  L.src.connect(L.gain); L.src.start(); L.playing = true;
}
export function stopLoop(name) {
  const L = loops[name]; if (L && L.playing) { try { L.src.stop(); } catch {} L.playing = false; }
}
