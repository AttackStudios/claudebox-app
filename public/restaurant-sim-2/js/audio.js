// RS2 audio: per-restaurant music that crossfades in when you step onto a
// plot and fades out when you leave (Web Audio gain ramps), plus
// synthesized kitchen/delivery SFX so no extra files are needed.

const FADE = 1.4; // seconds

class Rs2Audio {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.sfxVolume = 0.9;
    this.musicVolume = 0.6;
    this.tracks = [];            // [{ id, label, url }] from welcome
    this.current = null;         // { id, el, node, gain }
    this.elCache = new Map();
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.pendingTrack) {
      const t = this.pendingTrack;
      this.pendingTrack = null;
      this.fadeTo(t);
    }
  }

  setTracks(tracks) { this.tracks = tracks; }
  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.current) this.current.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }
  setSfxVolume(v) { this.sfxVolume = v; }

  // trackId or null → fade everything out
  fadeTo(trackId) {
    if (!this.unlocked) { this.pendingTrack = trackId; return; }
    if (this.current?.id === trackId) return;

    // fade out the old
    if (this.current) {
      const old = this.current;
      old.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      old.gain.gain.setTargetAtTime(0, this.ctx.currentTime, FADE / 3);
      setTimeout(() => { old.el.pause(); }, FADE * 1000 + 200);
      this.current = null;
    }
    if (!trackId) return;
    const track = this.tracks.find((t) => t.id === trackId);
    if (!track) return;

    let entry = this.elCache.get(trackId);
    if (!entry) {
      const el = new Audio(track.url);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      const node = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      node.connect(gain);
      gain.connect(this.ctx.destination);
      entry = { id: trackId, el, node, gain };
      this.elCache.set(trackId, entry);
    }
    entry.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    entry.gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    entry.gain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, FADE / 3);
    entry.el.play().catch(() => {});
    this.current = entry;
  }

  // ---------- synthesized SFX ----------
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
    const noise = (dur, delay = 0, vol = 0.5) => {
      const len = Math.ceil(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1600;
      src.connect(f); f.connect(g); g.connect(out);
      src.start(t + delay);
    };
    switch (name) {
      case 'chop': noise(0.05, 0, 0.8); tone(180, 0.06, 'square', 0.01, -60, 0.4); break;
      case 'sizzle': for (let i = 0; i < 4; i++) noise(0.1, i * 0.1, 0.3); break;
      case 'ding': tone(1320, 0.5, 'sine', 0, 0, 0.7); tone(1980, 0.4, 'sine', 0.02, 0, 0.3); break;
      case 'pour': noise(0.4, 0, 0.35); tone(420, 0.35, 'sine', 0, 160, 0.2); break;
      case 'register': tone(990, 0.07, 'square', 0, 0, 0.5); tone(1320, 0.12, 'square', 0.08, 0, 0.5); noise(0.06, 0.2, 0.4); break;
      case 'doorbell': tone(880, 0.35, 'sine', 0, 0, 0.8); tone(660, 0.5, 'sine', 0.25, 0, 0.8); break;
      case 'cash': tone(1200, 0.08, 'triangle', 0, 200, 0.6); tone(1600, 0.1, 'triangle', 0.07, 100, 0.6); break;
      case 'place': tone(500, 0.09, 'triangle', 0, -120, 0.6); break;
      case 'error': tone(220, 0.18, 'square', 0, -60, 0.4); break;
      case 'moped': noise(0.12, 0, 0.3); tone(110, 0.15, 'sawtooth', 0, 30, 0.3); break;
      case 'eat': noise(0.07, 0, 0.5); noise(0.07, 0.1, 0.4); noise(0.07, 0.2, 0.35); break;
      case 'click': tone(800, 0.05, 'square', 0, 0, 0.25); break;
    }
  }
}

export const audio = new Rs2Audio();
