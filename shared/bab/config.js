// Build A Boat For Treasure — shared config (client + server).
//
// An ORIGINAL ClaudeBox implementation of the loop the Roblox game is famous
// for: buy blocks with gold, bolt a boat together on your plot, pull the lever,
// and ride it down a river of themed stages that are actively trying to break
// it apart. Every stage you reach pays out, and the far end holds the treasure.
// No assets, code or text are taken from the original — only the idea of the loop.

export const GRID = 1;                       // one block = one stud
export const PLOT = { w: 15, d: 11, h: 14 }; // build volume, in blocks
export const RIVER = { width: 30 };
export const WATER_Y = 0;

// ---- BLOCKS -------------------------------------------------------------
// hp     — hits a block absorbs before it breaks off the boat
// weight — drags the boat down
// buoy   — holds it up. A boat floats while total buoy >= total weight.
// cost   — gold. Buying is a ONE-TIME unlock; after that you place as many
//          copies as you like, which is how the original's shop works.
export const BLOCKS = [
  { id: 'wood',     name: 'Wood Block',    emoji: '🪵', cost: 0,    hp: 1, weight: 1.0,  buoy: 1.35, color: '#b3803f', kind: 'solid' },
  { id: 'plastic',  name: 'Plastic Block', emoji: '🧊', cost: 40,   hp: 1, weight: 0.05, buoy: 0.95, color: '#e8eef5', kind: 'solid' },
  { id: 'brick',    name: 'Brick Block',   emoji: '🧱', cost: 120,  hp: 3, weight: 2.4,  buoy: 0.55, color: '#a8503c', kind: 'solid' },
  { id: 'ice',      name: 'Ice Block',     emoji: '❄️', cost: 260,  hp: 2, weight: 1.3,  buoy: 1.60, color: '#9fd8ff', kind: 'solid' },
  { id: 'metal',    name: 'Metal Block',   emoji: '⚙️', cost: 600,  hp: 5, weight: 4.0,  buoy: 0.30, color: '#9aa6b4', kind: 'solid' },
  { id: 'gold',     name: 'Gold Block',    emoji: '🟨', cost: 2000, hp: 9, weight: 6.0,  buoy: 0.15, color: '#ffc93c', kind: 'solid' },
  // ability blocks — the ones that change how a boat behaves
  { id: 'balloon',  name: 'Balloon',       emoji: '🎈', cost: 300,  hp: 1, weight: 0.1,  buoy: 7.0,  color: '#ff5d8f', kind: 'balloon' },
  { id: 'thruster', name: 'Thruster',      emoji: '🚀', cost: 900,  hp: 2, weight: 2.0,  buoy: 0.35, color: '#ff8a3c', kind: 'thruster', thrust: 5.5 },
  { id: 'sail',     name: 'Sail',          emoji: '⛵', cost: 220,  hp: 1, weight: 0.7,  buoy: 0.60, color: '#f2f4f8', kind: 'sail', thrust: 1.8 },
  { id: 'seat',     name: 'Seat',          emoji: '💺', cost: 0,    hp: 2, weight: 0.9,  buoy: 1.10, color: '#5c72ff', kind: 'seat' },

  // ---- CHAMPION SHOP -----------------------------------------------------
  // Premium stock. Only players the owner has granted the Champion rank can
  // see or buy these; `champion: true` is what gates them.
  { id: 'carbon',   name: 'Carbon Fibre',  emoji: '◼️', cost: 1800, hp: 6,  weight: 0.6, buoy: 1.30, color: '#2b2f38', kind: 'solid',    champion: true },
  { id: 'diamond',  name: 'Diamond Block', emoji: '💎', cost: 5000, hp: 14, weight: 3.2, buoy: 0.60, color: '#6ee7ff', kind: 'solid',    champion: true },
  { id: 'obsidian', name: 'Obsidian',      emoji: '🗿', cost: 3200, hp: 11, weight: 5.0, buoy: 0.25, color: '#241b33', kind: 'solid',    champion: true },
  { id: 'zeppelin', name: 'Zeppelin',      emoji: '🪂', cost: 3600, hp: 3,  weight: 0.4, buoy: 22.0, color: '#ffd76e', kind: 'balloon',  champion: true },
  { id: 'jet',      name: 'Jet Engine',    emoji: '✈️', cost: 6500, hp: 5,  weight: 3.0, buoy: 0.40, color: '#ff4f9a', kind: 'thruster', thrust: 15, champion: true },
];
export const BLOCK_BY_ID = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));
export const STARTER_BLOCKS = BLOCKS.filter((b) => b.cost === 0).map((b) => b.id);

// ---- STAGES -------------------------------------------------------------
// Eleven stages, banded green → yellow → red → end, exactly like the original's
// difficulty colours. Each is STAGE_LEN long and pays STAGE_GOLD on entry.
export const STAGE_LEN = 62;
export const STAGE_GOLD = 8;
export const TREASURE_GOLD = 400;

export const STAGES = [
  { id: 'dock',      name: 'The Dock',        band: 'green',  sky: '#8fd2ff', water: '#2f9fd0', hazards: [] },
  { id: 'rapids',    name: 'Rapids',          band: 'green',  sky: '#8fd2ff', water: '#2f9fd0', hazards: ['rock'] },
  { id: 'cove',      name: 'Barrel Cove',     band: 'green',  sky: '#a8dcff', water: '#2f9fd0', hazards: ['barrel'] },
  { id: 'hammers',   name: 'Hammer Alley',    band: 'yellow', sky: '#ffd98f', water: '#2f86c0', hazards: ['hammer'] },
  { id: 'cannons',   name: 'Cannon Bay',      band: 'yellow', sky: '#ffc87a', water: '#2f7fb8', hazards: ['cannon'] },
  { id: 'icebergs',  name: 'Iceberg Straits', band: 'yellow', sky: '#d8f0ff', water: '#4fb0d8', hazards: ['spike', 'rock'] },
  { id: 'sawmill',   name: 'The Sawmill',     band: 'red',    sky: '#c08a6a', water: '#2a6a94', hazards: ['saw'] },
  { id: 'volcano',   name: 'Volcano Run',     band: 'red',    sky: '#ff7a4a', water: '#8a3020', hazards: ['fireball'] },
  { id: 'whirlpool', name: 'The Whirlpool',   band: 'red',    sky: '#4a5a7a', water: '#1e4a70', hazards: ['whirl', 'rock'] },
  { id: 'lighthouse',name: 'The Lighthouse',  band: 'end',    sky: '#2a2050', water: '#16305a', hazards: ['laser', 'saw'] },
  { id: 'treasure',  name: 'Treasure Cove',   band: 'end',    sky: '#ffe9a8', water: '#2fb0d0', hazards: [] },
];
export const TOTAL_LEN = STAGES.length * STAGE_LEN;
export const TREASURE_AT = TOTAL_LEN - STAGE_LEN * 0.45;

export const BAND_COLOR = { green: '#48d98a', yellow: '#ffc94a', red: '#ff5d6c', end: '#c88bff' };

// which stage a distance falls in
export const stageAt = (dist) =>
  STAGES[Math.max(0, Math.min(STAGES.length - 1, Math.floor(dist / STAGE_LEN)))];
export const stageIndexAt = (dist) =>
  Math.max(0, Math.min(STAGES.length - 1, Math.floor(dist / STAGE_LEN)));

// ---- HAZARDS ------------------------------------------------------------
// dmg is per contact; `r` is the contact radius against a block's centre.
export const HAZARDS = {
  rock:     { emoji: '🪨', dmg: 1, r: 2.1, color: '#7a7268', motion: 'static' },
  barrel:   { emoji: '🛢️', dmg: 1, r: 1.5, color: '#8a5a2a', motion: 'drift' },
  hammer:   { emoji: '🔨', dmg: 2, r: 3.0, color: '#c04a3a', motion: 'swing' },
  cannon:   { emoji: '💣', dmg: 2, r: 1.4, color: '#2a2a30', motion: 'fire' },
  spike:    { emoji: '🧊', dmg: 2, r: 2.2, color: '#bfeaff', motion: 'static' },
  saw:      { emoji: '🪚', dmg: 3, r: 2.6, color: '#d8d8e0', motion: 'slide' },
  fireball: { emoji: '🔥', dmg: 3, r: 1.8, color: '#ff6a2a', motion: 'arc' },
  whirl:    { emoji: '🌀', dmg: 1, r: 4.5, color: '#2f6fa0', motion: 'pull' },
  laser:    { emoji: '⚡', dmg: 4, r: 1.6, color: '#ff3ad0', motion: 'sweep' },
};

// Deterministic hazard layout: same river for everybody in a server, and the
// client and server agree without shipping a level file back and forth.
export function hazardsFor(stageIndex) {
  const st = STAGES[stageIndex];
  if (!st || !st.hazards.length) return [];
  const out = [];
  // a tiny seeded PRNG so the layout is stable per stage
  let seed = stageIndex * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const count = 5 + stageIndex;
  for (let i = 0; i < count; i++) {
    const kind = st.hazards[i % st.hazards.length];
    out.push({
      kind,
      z: stageIndex * STAGE_LEN + 8 + (i + rnd() * 0.7) * ((STAGE_LEN - 12) / count),
      x: (rnd() - 0.5) * (RIVER.width - 6),
      phase: rnd() * Math.PI * 2,
    });
  }
  return out;
}

// ---- ECONOMY ------------------------------------------------------------
export const goldForRun = (dist, stagesEntered, gotTreasure) =>
  Math.floor(dist / 4) + stagesEntered * STAGE_GOLD + (gotTreasure ? TREASURE_GOLD : 0);

// ---- BUILD LIMIT --------------------------------------------------------
// Boats are capped so a run stays readable (and so the shop still matters).
// Champions get a bigger allowance as one of the perks of the rank.
export const MAX_BLOCKS = 75;
export const CHAMPION_BONUS_BLOCKS = 15;
export const blockLimit = (champion) => MAX_BLOCKS + (champion ? CHAMPION_BONUS_BLOCKS : 0);

// Buying gold with the platform's premium currency.
export const GOLD_PACK = { cost: 5, gold: 1000 };   // 5 ClaudeBux -> 1,000 gold

export const CHAMPION_ONLY = new Set(BLOCKS.filter((b) => b.champion).map((b) => b.id));

export const DEFAULT_SAVE = () => ({ gold: 60, owned: [...STARTER_BLOCKS], best: 0, boat: null, runs: 0 });
