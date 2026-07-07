// Rivals — shared tuning. Imported by BOTH the client (feel/prediction) and
// the server (validation, bots), so the numbers can never drift.

// ---- movement (the RIVALS-y part) ----
export const MOVE = {
  walk: 8.2,
  sprint: 12.4,
  crouch: 4.6,
  slideBurst: 18.5,     // slide = crouch while sprinting: burst that decays…
  slideFriction: 7.5,   // …at this rate; slide ends when speed < crouch speed
  dashSpeed: 26,        // Scythe MB2: forward impulse
  dashTime: 0.18,       // seconds of dash force
  dashCooldown: 3.0,
  jumpVel: 8.6,
  gravity: 24,
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
    slot: 3, name: 'Scythe', auto: false, melee: true,
    dmg: 45, rate: 0.5, range: 3.4,
  },
  grenade: {
    slot: 4, name: 'Grenade', auto: false, utility: true,
    count: 3, throwVel: 17, fuse: 1.4, radius: 6.5, maxDmg: 85, rate: 0.8,
  },
};

export const LOADOUT = ['ar', 'handgun', 'scythe', 'grenade'];

// queue modes (Beginner = instant easy bot; others bot-fill after botFillSecs)
export const MODES = {
  beginner: { label: 'Beginner 1v1', team: 1, bots: 'easy', instant: true },
  duo:      { label: '1v1',          team: 1, bots: 'normal' },
  squad:    { label: '2v2',          team: 2, bots: 'normal' },
};

// loading-screen tips (straight out of the vibe of the original)
export const TIPS = [
  'Your choice of Melee could completely change how you play',
  'Slide by sprinting and then crouching',
  'Dash with the Scythe using right-click',
  'Aim down sights for tighter spread',
  'Grenades bounce — cook your throws around corners',
  'Headshots deal bonus damage',
  'The round timer favors whoever keeps more health',
  'Win duels to earn Stars for the ClaudeBox shop',
];
