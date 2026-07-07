// Backpacking audio: the user's five tracks, wired to their exact rules.
// - soundtrack.mp3: loops always (starts on first gesture)
// - walk.mp3: loops while walking forward on the ground, stops on stop
// - jump.mp3: one-shot on jump
// - van.mp3: loops while your van is moving, stops when it stops
// - oof.mp3: on death

const BASE = '/backpacking/audio/';

class BpAudio {
  constructor() {
    this.music = new Audio(BASE + 'soundtrack.mp3');
    this.music.loop = true;
    this.walk = new Audio(BASE + 'walk.mp3');
    this.walk.loop = true;
    this.van = new Audio(BASE + 'van.mp3');
    this.van.loop = true;
    this.jumpSfx = new Audio(BASE + 'jump.mp3');
    this.oof = new Audio(BASE + 'oof.mp3');
    this.musicVolume = 0.5;
    this.sfxVolume = 0.9;
    this.unlocked = false;
    this.walking = false;
    this.driving = false;
    this.applyVolumes();
  }

  applyVolumes() {
    this.music.volume = this.musicVolume;
    this.walk.volume = this.sfxVolume * 0.7;
    this.van.volume = this.sfxVolume * 0.8;
    this.jumpSfx.volume = this.sfxVolume;
    this.oof.volume = this.sfxVolume;
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.music.play().catch(() => {});
    if (this.walking) this.walk.play().catch(() => {});
  }

  setMusicVolume(v) { this.musicVolume = v; this.applyVolumes(); }
  setSfxVolume(v) { this.sfxVolume = v; this.applyVolumes(); }

  setWalking(on) {
    if (on === this.walking) return;
    this.walking = on;
    if (!this.unlocked) return;
    if (on) { this.walk.currentTime = 0; this.walk.play().catch(() => {}); }
    else this.walk.pause();
  }

  setDriving(on, speed = 0) {
    if (on !== this.driving) {
      this.driving = on;
      if (!this.unlocked) return;
      if (on) this.van.play().catch(() => {});
      else this.van.pause();
    }
    if (on) this.van.playbackRate = Math.min(1.6, 0.85 + speed * 0.03);
  }

  playJump() {
    if (!this.unlocked) return;
    this.jumpSfx.currentTime = 0;
    this.jumpSfx.play().catch(() => {});
  }

  playOof() {
    if (!this.unlocked) return;
    this.oof.currentTime = 0;
    this.oof.play().catch(() => {});
  }
}

export const audio = new BpAudio();
