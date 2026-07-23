// Music + sound effects.
// Menu: IntroReprise on loop. In world: randomly alternate the two BG tracks.
// SFX are synthesized with WebAudio so we need no extra files.

const TRACKS = {
  menu: '/Soundtrack/Feather Family BG Music(IntroReprise).mp3',
  world: [
    '/Soundtrack/Feather Family Soundtrack ~ Dreams and Fantasies.mp3',
    '/Soundtrack/Feather Family BG Music(Forgotten Time).mp3',
  ],
};

// Which synthesized voice each breed uses (see call() below).
const CALL_FAMILY = {
  robin: 'songbird', cardinal: 'songbird', sparrow: 'songbird', chickadee: 'songbird',
  duck: 'duck', chicken: 'chicken', owl: 'owl',
  flamingo: 'honk', dodo: 'honk', penguin: 'penguin',
  toucan: 'squawk', parrot: 'squawk', peacock: 'peacock',
  eagle: 'raptor', falcon: 'raptor', vulture: 'raptor', raven: 'raven',
  phoenix: 'mythical', griffin: 'mythical', cockatrice: 'mythical', peryton: 'mythical',
};

class AudioManager {
  constructor() {
    this.musicVolume = 0.6;
    this.sfxVolume = 0.8;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.mode = null;          // 'menu' | 'world'
    this.lastWorldIdx = -1;
    this.unlocked = false;
    this.ctx = null;

    this.el.addEventListener('ended', () => {
      if (this.mode === 'world') this.playNextWorldTrack();
    });
  }

  // Browsers block audio until a user gesture; call this from any tap/click.
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.mode && this.el.paused) this.el.play().catch(() => {});
  }

  setMusicVolume(v) { this.musicVolume = v; this.el.volume = v; }
  setSfxVolume(v) { this.sfxVolume = v; }

  playMenu() {
    this.mode = 'menu';
    this.el.loop = true;
    this.el.volume = this.musicVolume;
    this.el.src = encodeURI(TRACKS.menu);
    if (this.unlocked) this.el.play().catch(() => {});
  }

  playWorld() {
    this.mode = 'world';
    this.el.loop = false;
    this.playNextWorldTrack();
  }

  playNextWorldTrack() {
    // Random pick, biased against playing the same track twice in a row.
    let idx = Math.floor(Math.random() * TRACKS.world.length);
    if (idx === this.lastWorldIdx && Math.random() < 0.8) {
      idx = (idx + 1) % TRACKS.world.length;
    }
    this.lastWorldIdx = idx;
    this.el.volume = this.musicVolume;
    this.el.src = encodeURI(TRACKS.world[idx]);
    if (this.unlocked) this.el.play().catch(() => {});
  }

  stop() { this.mode = null; this.el.pause(); }

  // ---- synthesized SFX ----
  // Shared voice: a fresh output bus plus tone/noise primitives, used by both
  // the one-shot sfx() recipes and the per-breed call() recipes.
  _voice() {
    const t = this.ctx.currentTime;
    const out = this.ctx.createGain();
    out.gain.value = this.sfxVolume * 0.5;
    out.connect(this.ctx.destination);
    const tone = (freq, dur, type = 'sine', delay = 0, slide = 0, vol = 1) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + delay);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + delay + dur);
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(vol, t + delay + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
      o.connect(g); g.connect(out);
      o.start(t + delay); o.stop(t + delay + dur + 0.05);
    };
    const noise = (dur, delay = 0, vol = 0.5, low = false) => {
      const len = Math.ceil(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      let node = src;
      if (low) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 900;
        src.connect(f); node = f;
      }
      node.connect(g); g.connect(out);
      src.start(t + delay);
    };
    return { tone, noise };
  }

  sfx(name) {
    if (!this.ctx || this.sfxVolume <= 0) return;
    if (name.startsWith('call-')) return this.call(name.slice(5));
    const { tone, noise } = this._voice();

    switch (name) {
      case 'chirp': tone(1400, 0.09, 'sine', 0, 600); tone(1700, 0.12, 'sine', 0.11, -500); break;
      case 'chirp-big': tone(500, 0.18, 'square', 0, -180, 0.4); tone(420, 0.2, 'square', 0.2, -120, 0.4); break;
      case 'flap': noise(0.12, 0, 0.4, true); break;
      case 'jump': tone(300, 0.18, 'sine', 0, 260, 0.7); break;
      case 'crunch': noise(0.08, 0, 0.7, true); noise(0.07, 0.09, 0.55, true); noise(0.06, 0.18, 0.4, true); break;
      case 'gulp': tone(300, 0.12, 'sine', 0, -140, 0.8); tone(180, 0.16, 'sine', 0.14, 80, 0.8); break;
      case 'splash': noise(0.35, 0, 0.5, true); break;
      case 'crack': noise(0.05, 0, 0.9); noise(0.06, 0.1, 0.8); tone(900, 0.2, 'triangle', 0.16, -500, 0.5); break;
      case 'sparkle': for (let i = 0; i < 5; i++) tone(900 + i * 280, 0.18, 'sine', i * 0.06, 120, 0.4); break;
      case 'pickup': tone(700, 0.08, 'triangle', 0, 250, 0.6); break;
      case 'drop': tone(500, 0.1, 'triangle', 0, -200, 0.6); break;
      case 'click': tone(800, 0.05, 'square', 0, 0, 0.25); break;
      case 'pop': tone(440, 0.09, 'sine', 0, 320, 0.8); break;
      case 'whoosh': noise(0.3, 0, 0.35, true); break;
      case 'nest': noise(0.1, 0, 0.3, true); tone(520, 0.15, 'triangle', 0.1, 140, 0.5); break;
      case 'toast': tone(660, 0.1, 'sine', 0, 0, 0.4); tone(880, 0.14, 'sine', 0.1, 0, 0.4); break;
    }
  }

  // ---- per-breed bird calls ----
  // Each breed family gets its own synthesized voice. Also reachable as
  // sfx('call-<breed>'). Babies play a higher, quicker, smaller version:
  //   audio.call('duck', { baby: true })  — or pass { rate } to scale pitch.
  call(breed, opts = {}) {
    if (!this.ctx || this.sfxVolume <= 0) return;
    const rate = opts.rate || (opts.baby ? 1.7 : 1);
    const squish = opts.baby ? 0.72 : 1;   // babies are quicker too
    const loud = opts.baby ? 0.7 : 1;      // ...and quieter
    const { tone, noise } = this._voice();
    // rate-aware wrappers so one recipe serves adults and hatchlings
    const T = (freq, dur, type, delay = 0, slide = 0, vol = 1) =>
      tone(freq * rate, dur * squish, type, delay * squish, slide * rate, vol * loud);
    const N = (dur, delay = 0, vol = 0.5, low = false) =>
      noise(dur * squish, delay * squish, vol * loud, low);

    switch (CALL_FAMILY[breed] || 'songbird') {
      case 'songbird':   // bright 2-3 note trill
        T(1450, 0.08, 'sine', 0, 520, 0.7);
        T(1850, 0.07, 'sine', 0.1, -320, 0.65);
        T(1600, 0.11, 'sine', 0.19, 450, 0.6);
        break;
      case 'duck':       // low nasal quack-quack: two saw-y bursts w/ a nasal octave
        T(230, 0.14, 'sawtooth', 0, -55, 0.55); T(465, 0.13, 'sawtooth', 0, -110, 0.3);
        T(210, 0.16, 'sawtooth', 0.19, -50, 0.55); T(425, 0.15, 'sawtooth', 0.19, -100, 0.3);
        break;
      case 'chicken':    // clucky staccato triplet, last cluck rises
        T(430, 0.06, 'square', 0, -90, 0.4); N(0.03, 0, 0.25, true);
        T(400, 0.06, 'square', 0.12, -80, 0.4); N(0.03, 0.12, 0.25, true);
        T(480, 0.1, 'square', 0.24, 160, 0.45); N(0.04, 0.24, 0.25, true);
        break;
      case 'owl':        // soft low double hoot
        T(340, 0.3, 'sine', 0, -35, 0.6);
        T(300, 0.4, 'sine', 0.42, -45, 0.6);
        break;
      case 'honk':       // flamingo / dodo: one big goosey honk
        T(290, 0.32, 'sawtooth', 0, -85, 0.5);
        T(145, 0.32, 'sawtooth', 0, -40, 0.4);
        N(0.1, 0, 0.15, true);
        break;
      case 'penguin':    // bray-ish trumpet: fast alternating hee-haw notes
        T(330, 0.1, 'sawtooth', 0, 30, 0.4);
        T(255, 0.1, 'sawtooth', 0.11, -25, 0.4);
        T(330, 0.1, 'sawtooth', 0.22, 30, 0.4);
        T(255, 0.14, 'sawtooth', 0.33, -40, 0.4);
        break;
      case 'squawk':     // toucan / parrot: croaky double squawk
        T(880, 0.18, 'square', 0, -480, 0.35); N(0.14, 0, 0.25);
        T(780, 0.13, 'square', 0.23, -340, 0.3); N(0.1, 0.23, 0.2);
        break;
      case 'peacock':    // loud two-note wail: may-AWE
        T(840, 0.34, 'triangle', 0, 130, 0.85);
        T(640, 0.48, 'triangle', 0.38, -190, 0.85);
        break;
      case 'raptor':     // eagle / falcon / vulture: piercing falling screech
        T(2050, 0.5, 'sawtooth', 0, -950, 0.3);
        T(2050, 0.5, 'sine', 0.02, -950, 0.35);
        N(0.3, 0, 0.12);
        break;
      case 'raven':      // deeper gravelly croak-croak
        T(185, 0.2, 'sawtooth', 0, -45, 0.6); N(0.18, 0, 0.3, true);
        T(165, 0.22, 'sawtooth', 0.27, -40, 0.6); N(0.2, 0.27, 0.3, true);
        break;
      case 'mythical':   // layered shimmer screech
        T(1650, 0.5, 'sawtooth', 0, -720, 0.25);
        T(2450, 0.5, 'sine', 0.03, -850, 0.25);
        for (let i = 0; i < 4; i++) T(1200 + i * 320, 0.22, 'sine', i * 0.06, 160, 0.18);
        break;
    }
  }
}

export const audio = new AudioManager();
