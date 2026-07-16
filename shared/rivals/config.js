// Rivals — shared tuning. Imported by BOTH the client (feel/prediction) and
// the server (validation, bots), so the numbers can never drift.

// ---- movement (the RIVALS-y part) ----
export const MOVE = {
  walk: 9.6,
  sprint: 14.4,
  crouch: 5.2,
  slideBurst: 21,       // slide = crouch while sprinting: burst that decays…
  slideFriction: 7.5,   // …at this rate; slide ends when speed < crouch speed
  dashSpeed: 28,        // Scythe MB2: forward impulse
  dashTime: 0.18,       // seconds of dash force
  dashCooldown: 3.0,
  jumpVel: 8.6,
  gravity: 17,          // floatier falls
  eyeStand: 1.62,
  eyeCrouch: 1.05,
  radius: 0.42,         // collision capsule-ish AABB half-width
  heightStand: 1.85,
  heightCrouch: 1.25,
  airControl: 0.35,
};

export const ROUND = {
  winScore: 5,          // first to 5 (like the original)
  freezeSecs: 3,        // red countdown at round start
  roundSecs: 90,
  voteSecs: 8,
  podiumSecs: 12,
  botFillSecs: 8,       // queue fills with a bot after this
  maxHp: 100,
};

// ---- weapons ----
// slots: 1 primary, 2 secondary, 3 melee, 4 utility
export const WEAPONS = {
  ar: {
    slot: 1, name: 'Assault Rifle', auto: true,
    dmg: 15, headMult: 1.5, rate: 0.1, mag: 20, reserve: 100,
    reload: 1.8, range: 120, spread: 0.011, adsSpread: 0.004, adsZoom: 1.35,
    pellets: 1,
  },
  handgun: {
    slot: 2, name: 'Handgun', auto: false,
    dmg: 25, headMult: 1.6, rate: 0.18, mag: 15, reserve: 90,
    reload: 1.3, range: 90, spread: 0.008, adsSpread: 0.003, adsZoom: 1.25,
    pellets: 1,
  },
  scythe: {
    slot: 3, name: 'Knife', auto: false, melee: true,
    dmg: 45, rate: 0.5, range: 3.4, backstabOneshot: true,
  },
  fists: {
    slot: 6, name: 'Fists', auto: true, melee: true,
    dmg: 18, rate: 0.26, range: 2.6, backstabMult: 2,
  },
  grenade: {
    slot: 4, name: 'Grenade', auto: false, utility: true,
    count: 3, throwVel: 17, fuse: 1.4, radius: 6.5, maxDmg: 85, rate: 0.8,
  },
  sniper: {
    slot: 5, name: 'Sniper', auto: false,
    dmg: 70, headMult: 2, rate: 1.15, mag: 5, reserve: 25,
    reload: 2.3, range: 260, spread: 0.05, adsSpread: 0.0006, adsZoom: 4.6,
    pellets: 1, scoped: true,
  },
  // ---- wave-mode arsenal (dropped by bots; picked up off the ground) ----
  smg: {
    slot: 1, name: 'SMG', auto: true,
    dmg: 9, headMult: 1.5, rate: 0.06, mag: 30, reserve: 180,
    reload: 1.5, range: 80, spread: 0.02, adsSpread: 0.009, adsZoom: 1.2,
    pellets: 1,
  },
  shotgun: {
    slot: 1, name: 'Shotgun', auto: false,
    dmg: 9, headMult: 1.4, rate: 0.85, mag: 6, reserve: 36,
    reload: 2.2, range: 34, spread: 0.055, adsSpread: 0.045, adsZoom: 1.15,
    pellets: 7,
  },
  dmr: {
    slot: 1, name: 'Marksman Rifle', auto: false,
    dmg: 42, headMult: 1.8, rate: 0.5, mag: 8, reserve: 48,
    reload: 2.0, range: 200, spread: 0.012, adsSpread: 0.0018, adsZoom: 2.6,
    pellets: 1,
  },
  minigun: {
    slot: 1, name: 'Minigun', auto: true,
    dmg: 8, headMult: 1.3, rate: 0.045, mag: 90, reserve: 180,
    reload: 3.2, range: 100, spread: 0.032, adsSpread: 0.02, adsZoom: 1.1,
    pellets: 1,
  },
};

export const LOADOUT = ['ar', 'handgun', 'scythe', 'grenade', 'sniper', 'fists'];

// ---- WAVE SURVIVAL (co-op horde) ----
export const WAVE = {
  waves: 10,               // clear all 10 (and stay alive) to win
  intermission: 25,        // seconds between waves
  readySecs: 5,            // countdown before wave 1
  maxLiveSecs: 300,        // failsafe: a wave can never run longer than this
  botCount: (w) => Math.min(4 + w * 2, 24),
  botHp: (w) => 80 + w * 12,
  // bots get progressively smarter — interpolated by wave
  botSkill: (w) => {
    const t = (w - 1) / 9;
    const lerp = (a, b) => a + (b - a) * t;
    return { aimErr: lerp(0.2, 0.045), reaction: lerp(0.95, 0.26), burst: Math.round(lerp(3, 8)), pause: lerp(0.85, 0.25), speed: lerp(0.5, 0.95) };
  },
  // which guns bots carry (and drop!) at each wave
  botWeapons: (w) => {
    const pool = ['handgun', 'smg'];
    if (w >= 3) pool.push('ar', 'shotgun');
    if (w >= 5) pool.push('dmr');
    if (w >= 7) pool.push('sniper', 'minigun');
    return pool;
  },
  meleeChance: (w) => (w >= 4 ? 0.18 : 0),   // some knife-rushers in later waves
  dropLifeSecs: 60,
  startArsenal: ['handgun', 'fists'],
};

// queue modes (Beginner = instant easy bot; others bot-fill after botFillSecs)
export const MODES = {
  beginner: { label: 'Beginner 1v1', team: 1, bots: 'easy', instant: true },
  duo:      { label: '1v1',          team: 1, bots: 'normal' },
  squad:    { label: '2v2',          team: 2, bots: 'normal' },
  wave:     { label: 'Wave Survival', coop: true, instant: true },
};

// loading-screen tips (straight out of the vibe of the original)
export const TIPS = [
  'Your choice of Melee could completely change how you play',
  'Slide by sprinting and then crouching',
  'Dash with the Knife using right-click',
  'Aim down sights for tighter spread',
  'Grenades bounce — cook your throws around corners',
  'Headshots deal bonus damage',
  'The Sniper one-shots on headshots — but hipfire is a prayer',
  'The round timer favors whoever keeps more health',
  'Win duels to earn Stars for the ClaudeBox shop',
  'Wave Survival: bots drop their weapons — grab them off the ground!',
  'Wave Survival: friends can join mid-round from the lobby',
  'Later waves bring smarter bots with heavier guns — keep moving',
];
