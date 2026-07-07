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
  sfx(name) {
    if (!this.ctx || this.sfxVolume <= 0) return;
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
}

export const audio = new AudioManager();
