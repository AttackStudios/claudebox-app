// Keyboard audio.
//
// The click is four separately rendered takes of the same switch, each pitched
// a fraction of a semitone apart, and every hit adds its own small detune and
// gain wobble on top. That is what stops a hundred keys in ten seconds from
// sounding like one sample on repeat — the ear picks up an identical waveform
// immediately, but not a family of near-identical ones.
//
// Every hit gets its own source node, so hits overlap instead of cutting each
// other off. Running up a keyboard should sound like a burst, not a metronome.

const VARIANTS = ['/keyescape/audio/key1.mp3', '/keyescape/audio/key2.mp3',
                  '/keyescape/audio/key3.mp3', '/keyescape/audio/key4.mp3'];

const MAX_VOICES = 18;      // a ceiling, so a huge combo cannot turn to mush

export function makeAudio() {
  let ctx = null, master = null, ready = false;
  const buffers = [];
  let voices = 0;
  let lastVariant = -1;
  let muted = false;

  async function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    const loaded = await Promise.all(VARIANTS.map(async (u) => {
      try {
        const r = await fetch(u);
        return await ctx.decodeAudioData(await r.arrayBuffer());
      } catch { return null; }
    }));
    for (const b of loaded) if (b) buffers.push(b);
    ready = buffers.length > 0;
  }

  // Browsers only allow audio after a gesture, so wake on the first input.
  const resume = () => { if (ctx?.state === 'suspended') ctx.resume(); };

  /**
   * One key press. `pan` is -1..1 for stereo placement, `rush` 0..1 raises the
   * pitch slightly as you speed up so a fast run sounds more urgent.
   */
  function key(pan = 0, rush = 0) {
    if (!ready || muted || voices >= MAX_VOICES) return;
    resume();
    // Never play the same take twice in a row; a repeat is the one thing the
    // ear reliably notices.
    let i = Math.floor(Math.random() * buffers.length);
    if (i === lastVariant) i = (i + 1) % buffers.length;
    lastVariant = i;

    const src = ctx.createBufferSource();
    src.buffer = buffers[i];
    src.playbackRate.value = 1 + (Math.random() * 0.06 - 0.03) + rush * 0.05;

    const g = ctx.createGain();
    g.gain.value = 0.55 + Math.random() * 0.3;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); src.connect(g).connect(p).connect(master); }
    else src.connect(g).connect(master);

    voices++;
    src.onended = () => { voices--; };
    src.start();
  }

  // Simple synthesised one-offs, so the game has a voice beyond the keys.
  function tone({ freq = 440, to = null, dur = 0.18, type = 'sine', vol = 0.25, delay = 0 }) {
    if (!ctx || muted) return;
    resume();
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  const jump    = () => tone({ freq: 380, to: 720, dur: 0.13, type: 'triangle', vol: 0.16 });
  const land    = () => tone({ freq: 200, to: 110, dur: 0.10, type: 'sine', vol: 0.14 });
  const die     = () => { tone({ freq: 320, to: 90, dur: 0.5, type: 'sawtooth', vol: 0.2 }); };
  const levelUp = () => tone({ freq: 880, to: 1320, dur: 0.12, type: 'square', vol: 0.07 });
  const win     = () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ freq: f, dur: 0.28, type: 'triangle', vol: 0.22, delay: i * 0.085 }));
  };
  const buy     = () => { tone({ freq: 660, to: 990, dur: 0.16, type: 'triangle', vol: 0.2 }); };
  const rebirth = () => {
    [392, 523, 659, 784, 1046, 1318].forEach((f, i) =>
      tone({ freq: f, dur: 0.4, type: 'sine', vol: 0.2, delay: i * 0.1 }));
  };

  return {
    init, key, jump, land, die, levelUp, win, buy, rebirth, resume,
    get ready() { return ready; },
    setMuted(v) { muted = !!v; if (master) master.gain.value = v ? 0 : 0.85; },
    get muted() { return muted; },
  };
}
