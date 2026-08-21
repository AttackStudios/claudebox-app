// Progression: speed, wins, rebirths, and the two upgrade ladders.
//
// The ladders come from the game's own wiki. The numbers get silly fast, which
// is the point of the genre — the interesting engineering problem is keeping a
// 5,000,000x multiplier controllable, which is what actualSpeed() below is for.

export const TRAILS = [
  { id: 'none',        name: 'No Trail',     mult: 1,       cost: 0,            colour: '#ffffff' },
  { id: 'green',       name: 'Green',        mult: 1.5,     cost: 500,          colour: '#3ddc84' },
  { id: 'blue',        name: 'Blue',         mult: 2,       cost: 1500,         colour: '#4aa8ff' },
  { id: 'purple',      name: 'Purple',       mult: 3,       cost: 5000,         colour: '#a855f7' },
  { id: 'red',         name: 'Red',          mult: 4,       cost: 25000,        colour: '#ff4d5e' },
  { id: 'rainbow',     name: 'Rainbow',      mult: 5,       cost: 100000,       colour: 'rainbow' },
  { id: 'galaxy',      name: 'Galaxy',       mult: 10,      cost: 600000,       colour: '#7b5cff' },
  { id: 'cosmic',      name: 'Cosmic',       mult: 100,     cost: 5e6,          colour: '#ff7be5' },
  { id: 'void',        name: 'Void',         mult: 1000,    cost: 5e7,          colour: '#1b1b2e' },
  { id: 'supernova',   name: 'Supernova',    mult: 1e4,     cost: 5e8,          colour: '#ffb04a' },
  { id: 'godlike',     name: 'Godlike',      mult: 1e5,     cost: 5e9,          colour: '#ffe86b' },
  { id: 'divine',      name: 'Divine',       mult: 2e5,     cost: 1e10,         colour: '#fff6c9' },
  { id: 'celestial',   name: 'Celestial',    mult: 4e5,     cost: 2e10,         colour: '#9df1ff' },
  { id: 'eternal',     name: 'Eternal',      mult: 1e6,     cost: 5e10,         colour: '#c084fc' },
  { id: 'ascendant',   name: 'Ascendant',    mult: 1.5e6,   cost: 7.5e10,       colour: '#ff9ff3' },
  { id: 'transcendent',name: 'Transcendent', mult: 3e6,     cost: 1.5e11,       colour: '#7bffcd' },
  { id: 'infinity',    name: 'Infinity',     mult: 5e6,     cost: 3e11,         colour: '#ffffff' },
];

export const AURAS = [
  { id: 'none',      name: 'No Aura',   mult: 1,   cost: 0,      colour: '#ffffff' },
  { id: 'bright',    name: 'Bright',    mult: 1.2, cost: 5000,   colour: '#fff3a8' },
  { id: 'glow',      name: 'Glow',      mult: 1.5, cost: 40000,  colour: '#ffe066' },
  { id: 'water',     name: 'Water',     mult: 2,   cost: 250000, colour: '#4aa8ff' },
  { id: 'fire',      name: 'Fire',      mult: 3,   cost: 2e6,    colour: '#ff6b35' },
  { id: 'electric',  name: 'Electric',  mult: 4,   cost: 1.5e7,  colour: '#7bdfff' },
  { id: 'candy',     name: 'Candy',     mult: 5,   cost: 1e8,    colour: '#ff5fa8' },
  { id: 'chocolate', name: 'Chocolate', mult: 6,   cost: 6e8,    colour: '#8b5a2b' },
  { id: 'storm',     name: 'Storm',     mult: 7,   cost: 4e9,    colour: '#9aa7ff' },
  { id: 'rain',      name: 'Rain',      mult: 8,   cost: 2e10,   colour: '#6fd3ff' },
  { id: 'red',       name: 'Red',       mult: 15,  cost: 1e11,   colour: '#ff2d4d' },
  { id: 'cookie',    name: 'Cookie',    mult: 25,  cost: 8e11,   colour: '#c8964f' },
  { id: 'god',       name: 'God',       mult: 300, cost: 5e13,   colour: '#fff8d6' },
];

export const MAX_REBIRTHS = 25;
/** Each rebirth wants a deeper run than the last. */
export const rebirthReq = (n) => Math.round(120 * Math.pow(n + 1, 1.42));

export function blankSave() {
  return { level: 0, wins: 0, rebirths: 0, trail: 'none', aura: 'none',
           trails: ['none'], auras: ['none'], done: [], best: {} };
}

export const trailOf = (s) => TRAILS.find((t) => t.id === s.trail) || TRAILS[0];
export const auraOf  = (s) => AURAS.find((a) => a.id === s.aura) || AURAS[0];
export const rebirthMult = (s) => 1 + 0.5 * (s.rebirths || 0);
/** The number on the HUD: what all the upgrades multiply out to. */
export const totalMult = (s) => rebirthMult(s) * trailOf(s).mult;

/**
 * Metres per second from a speed stat that may run to the millions.
 *
 * A linear mapping is unplayable past a few hundred, and a hard cap makes every
 * upgrade past it worthless. A power curve keeps each purchase legible — you
 * always feel faster — while flattening enough to stay steerable, and the cap
 * is only there so the physics step never tunnels through a wall.
 */
export function actualSpeed(save) {
  const raw = (save.level || 0) * totalMult(save) + 1;
  // The exponent is the pacing dial. At 0.42 a single stage's worth of keys
  // roughly doubled your speed, which ran away from the player inside one run;
  // 0.30 spreads the same growth across many stages, so a stage makes you
  // noticeably quicker rather than uncontrollable.
  return Math.min(112, 11 + 2.2 * Math.pow(raw, 0.30));
}

const UNITS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
export function fmt(n) {
  n = Math.floor(n || 0);
  for (const [v, s] of UNITS) {
    if (n >= v) {
      const x = n / v;
      return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + s;
    }
  }
  return String(n);
}
/** Multipliers read better as 1.5x / 5Mx than as 1500000x. */
export const fmtMult = (m) => (m >= 1000 ? fmt(m) : m % 1 ? m.toFixed(1) : String(m)) + 'x';
