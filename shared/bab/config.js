// Build A Boat For Treasure — shared config (client + server).
//
// An ORIGINAL ClaudeBox implementation of the loop the Roblox game is famous
// for: buy blocks with gold, bolt a boat together on your plot, pull the lever,
// and ride it down a river of themed stages that are actively trying to break
// it apart. Every stage you reach pays out, and the far end holds the treasure.
// No assets, code or text are taken from the original — only the idea of the loop.

export const GRID = 1;                       // one block = one stud
// Build volume is a CUBE whose side depends on rank. There is no cap on how
// many blocks you place inside it — the space itself is the limit.
export const PLOT_SIZES = { '': 25, champion: 50, legend: 100 };
export const plotSize = (rank) => PLOT_SIZES[rank] || PLOT_SIZES[''];
export const PLOT = { w: 25, d: 25, h: 25 };   // the default (unranked) volume
export const RIVER = { width: 30 };
export const WATER_Y = 0;

// ---- BLOCKS -------------------------------------------------------------
// hp     — hits a block absorbs before it breaks off the boat
// weight — drags the boat down
// buoy   — holds it up. A boat floats while total buoy >= total weight.
// cost   — gold for a PACK of 25 of that block. Blocks are consumed as you
//          place them and returned if you take them off, so the shop keeps
//          mattering instead of being a one-time unlock.
export const BLOCKS = [
  { id: 'wood',     name: 'Wood Block',    emoji: '🪵', cost: 25,    hp: 1, weight: 1.0,  buoy: 1.35, color: '#b3803f', kind: 'solid' },
  { id: 'plastic',  name: 'Plastic Block', emoji: '🧊', cost: 70,   hp: 1, weight: 0.05, buoy: 0.95, color: '#e8eef5', kind: 'solid' },
  { id: 'brick',    name: 'Brick Block',   emoji: '🧱', cost: 160,  hp: 3, weight: 2.4,  buoy: 0.55, color: '#a8503c', kind: 'solid' },
  { id: 'ice',      name: 'Ice Block',     emoji: '❄️', cost: 240,  hp: 2, weight: 1.3,  buoy: 1.60, color: '#9fd8ff', kind: 'solid' },
  { id: 'metal',    name: 'Metal Block',   emoji: '⚙️', cost: 480,  hp: 5, weight: 4.0,  buoy: 0.30, color: '#9aa6b4', kind: 'solid' },
  { id: 'gold',     name: 'Gold Block',    emoji: '🟨', cost: 1300, hp: 9, weight: 6.0,  buoy: 0.15, color: '#ffc93c', kind: 'solid' },
  // ability blocks — the ones that change how a boat behaves
  { id: 'balloon',  name: 'Balloon',       emoji: '🎈', cost: 320,  hp: 1, weight: 0.1,  buoy: 7.0,  color: '#ff5d8f', kind: 'balloon' },
  { id: 'thruster', name: 'Thruster',      emoji: '🚀', cost: 780,  hp: 2, weight: 2.0,  buoy: 0.35, color: '#ff8a3c', kind: 'thruster', thrust: 5.5 },
  { id: 'sail',     name: 'Sail',          emoji: '⛵', cost: 210,  hp: 1, weight: 0.7,  buoy: 0.60, color: '#f2f4f8', kind: 'sail', thrust: 1.8 },
  { id: 'seat',     name: 'Seat',          emoji: '💺', cost: 60,    hp: 2, weight: 0.9,  buoy: 1.10, color: '#5c72ff', kind: 'seat' },

  // ---- PREMIUM STOCK -----------------------------------------------------
  // `tier` gates who may buy. Champions reach the 'champion' tier; Legends
  // reach that AND the 'legend' tier above it.
  { id: 'carbon',   name: 'Carbon Fibre',  emoji: '◼️', cost: 950, hp: 6,  weight: 0.6, buoy: 1.30, color: '#2b2f38', kind: 'solid', tier: 'champion' },
  { id: 'diamond',  name: 'Diamond Block', emoji: '💎', cost: 2600, hp: 14, weight: 3.2, buoy: 0.60, color: '#6ee7ff', kind: 'solid', tier: 'champion' },
  { id: 'obsidian', name: 'Obsidian',      emoji: '🗿', cost: 1700, hp: 11, weight: 5.0, buoy: 0.25, color: '#241b33', kind: 'solid', tier: 'champion' },
  { id: 'zeppelin', name: 'Zeppelin',      emoji: '🪂', cost: 1900, hp: 3,  weight: 0.4, buoy: 22.0, color: '#ffd76e', kind: 'balloon', tier: 'champion' },
  { id: 'jet',      name: 'Jet Engine',    emoji: '✈️', cost: 3200, hp: 5,  weight: 3.0, buoy: 0.40, color: '#ff4f9a', kind: 'thruster', thrust: 15, tier: 'champion' },

  // ---- LEGEND TIER: the best material in the game, Legends only ----------
  { id: 'adamant',  name: 'Adamant Plate', emoji: '🛡️', cost: 5200, hp: 22, weight: 4.2, buoy: 0.45, color: '#8ef0d0', kind: 'solid',    tier: 'legend' },
  { id: 'void',     name: 'Void Block',    emoji: '🌑', cost: 4400, hp: 12, weight: 0.15, buoy: 2.40, color: '#120a24', kind: 'solid',    tier: 'legend' },
  { id: 'aurora',   name: 'Aurora Sail',   emoji: '🌌', cost: 3000, hp: 6,  weight: 0.5, buoy: 1.20, color: '#a8ffe8', kind: 'sail',     thrust: 6,  tier: 'legend' },
  { id: 'skyhook',  name: 'Sky Hook',      emoji: '🪝', cost: 4800, hp: 5,  weight: 0.3, buoy: 40.0, color: '#ffd0f0', kind: 'balloon',  tier: 'legend' },
  { id: 'ion',      name: 'Ion Drive',     emoji: '⚡', cost: 7800, hp: 8,  weight: 2.4, buoy: 0.55, color: '#7cf6ff', kind: 'thruster', thrust: 32, tier: 'legend' },
];
export const BLOCK_BY_ID = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));
export const PACK_SIZE = 25;                 // blocks per purchase
export const STARTER_BLOCKS = ['wood', 'seat'];
// what a brand-new builder is handed so they can launch straight away
export const STARTER_INVENTORY = { wood: 40, seat: 2 };
export const STARTING_GOLD = 150;

// ---- STAGES -------------------------------------------------------------
// Eleven stages, banded green → yellow → red → end, exactly like the original's
// difficulty colours. Each is STAGE_LEN long and pays STAGE_GOLD on entry.
export const STAGE_LEN = 62;
export const STAGE_GOLD = 8;
export const TREASURE_GOLD = 400;

const BASE_STAGES = [
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
// ---- MAPS ---------------------------------------------------------------
// Three runs. The Champion and Legend gauntlets bolt extra stages on before the
// treasure and crank the hazards up, and each is gated behind its rank.
const CHAMPION_EXTRA = [
  { id: 'storm',    name: 'Storm Front',   band: 'red', sky: '#3a4a60', water: '#1d4a68', hazards: ['laser', 'spike'] },
  { id: 'grinder',  name: 'The Grinder',   band: 'red', sky: '#5a4a44', water: '#2a5a78', hazards: ['saw', 'hammer'] },
  { id: 'magma',    name: 'Magma Falls',   band: 'end', sky: '#ff5a2a', water: '#7a2416', hazards: ['fireball', 'saw'] },
  { id: 'gate',     name: 'The Void Gate', band: 'end', sky: '#1e1236', water: '#141a3a', hazards: ['laser', 'whirl'] },
];
const LEGEND_EXTRA = [
  { id: 'abyss',    name: 'The Abyss',     band: 'end', sky: '#0a0a18', water: '#0d1430', hazards: ['whirl', 'laser'] },
  { id: 'shatter',  name: 'Shatter Zone',  band: 'end', sky: '#2a1a4a', water: '#1a2a5a', hazards: ['spike', 'saw', 'hammer'] },
  { id: 'inferno',  name: 'Inferno Core',  band: 'end', sky: '#ff3a1a', water: '#5a1408', hazards: ['fireball', 'laser'] },
  { id: 'maw',      name: 'The Maw',       band: 'end', sky: '#12061e', water: '#0a0416', hazards: ['saw', 'laser', 'whirl'] },
];
// the treasure always sits last, so the extras splice in just before it
const withExtras = (extra) => {
  const body = BASE_STAGES.slice(0, -1);
  const treasure = BASE_STAGES[BASE_STAGES.length - 1];
  return [...body, ...extra, treasure];
};

export const MAPS = {
  standard: { id: 'standard', name: 'The River',        emoji: '🌊', rank: '',         stages: BASE_STAGES,                                  dmgMul: 1,   densityMul: 1 },
  champion: { id: 'champion', name: 'Champion Stage',   emoji: '⭐', rank: 'champion', stages: withExtras(CHAMPION_EXTRA),                   dmgMul: 1.6, densityMul: 1.45 },
  legend:   { id: 'legend',   name: 'Legend Stage',     emoji: '👑', rank: 'legend',   stages: withExtras([...CHAMPION_EXTRA, ...LEGEND_EXTRA]), dmgMul: 2.3, densityMul: 1.9 },
};
export const mapFor = (id) => MAPS[id] || MAPS.standard;
// which maps a rank may enter (Legend can still play the easier runs)
export const mapsForRank = (rank) =>
  Object.values(MAPS).filter((m) => !m.rank || m.rank === rank
    || (rank === 'legend' && m.rank === 'champion'));

// The default map keeps the old exported names working.
export const STAGES = BASE_STAGES;
export const totalLen = (mapId) => mapFor(mapId).stages.length * STAGE_LEN;
export const treasureAt = (mapId) => totalLen(mapId) - STAGE_LEN * 0.45;
export const TOTAL_LEN = totalLen('standard');
export const TREASURE_AT = treasureAt('standard');

// ClaudeBux paid for finishing the Legend Stage: big the first time, then
// it tapers so it cannot be farmed.
export const LEGEND_WIN_BUX = [50, 25];      // 1st, 2nd
export const LEGEND_WIN_BUX_AFTER = 5;       // 3rd and every one after

export const BAND_COLOR = { green: '#48d98a', yellow: '#ffc94a', red: '#ff5d6c', end: '#c88bff' };

// which stage a distance falls in
export const stagesOf = (mapId) => mapFor(mapId).stages;
export const stageIndexAt = (dist, mapId = 'standard') => {
  const st = stagesOf(mapId);
  return Math.max(0, Math.min(st.length - 1, Math.floor(dist / STAGE_LEN)));
};
export const stageAt = (dist, mapId = 'standard') => stagesOf(mapId)[stageIndexAt(dist, mapId)];

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
export function hazardsFor(stageIndex, mapId = 'standard') {
  const M = mapFor(mapId);
  const st = M.stages[stageIndex];
  if (!st || !st.hazards.length) return [];
  const out = [];
  // a tiny seeded PRNG so the layout is stable per stage
  let seed = stageIndex * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const count = Math.round((5 + stageIndex) * M.densityMul);
  for (let i = 0; i < count; i++) {
    const kind = st.hazards[i % st.hazards.length];
    out.push({
      kind,
      z: stageIndex * STAGE_LEN + 8 + (i + rnd() * 0.7) * ((STAGE_LEN - 12) / count),
      x: (rnd() - 0.5) * (RIVER.width - 6),
      phase: rnd() * Math.PI * 2,
      dmgMul: M.dmgMul,
    });
  }
  return out;
}

// ---- ECONOMY ------------------------------------------------------------
export const goldForRun = (dist, stagesEntered, gotTreasure, mapId = 'standard') => {
  const M = mapFor(mapId);
  const bonus = M.id === 'legend' ? 3 : M.id === 'champion' ? 2 : 1;   // harder run, better purse
  return Math.floor(dist / 4) + stagesEntered * STAGE_GOLD * bonus + (gotTreasure ? TREASURE_GOLD * bonus : 0);
};

// ---- BUILD LIMIT --------------------------------------------------------
// Boats are capped so a run stays readable (and so the shop still matters).
// Champions get a bigger allowance as one of the perks of the rank.
// A purely defensive ceiling so one boat cannot take down the room's networking
// or the renderer. It sits far above anything a real build reaches.
export const SAFETY_BLOCK_CAP = 3000;
export const blockLimit = () => SAFETY_BLOCK_CAP;
// both ranks unlock the premium stock
export const isPremiumRank = (rank) => rank === 'champion' || rank === 'legend';

// Buying gold with the platform's premium currency.
export const GOLD_PACK = { cost: 5, gold: 1000 };   // 5 ClaudeBux -> 1,000 gold

// which ranks may buy which tier
export const TIER_OF = Object.fromEntries(BLOCKS.map((b) => [b.id, b.tier || 'open']));
export const RANK_TIERS = {
  '':         new Set(['open']),
  champion:   new Set(['open', 'champion']),
  legend:     new Set(['open', 'champion', 'legend']),   // Legends get both premium tiers
};
export const canBuy = (rank, blockId) =>
  (RANK_TIERS[rank] || RANK_TIERS['']).has(TIER_OF[blockId] || 'open');
export const CHAMPION_ONLY = new Set(BLOCKS.filter((b) => b.tier).map((b) => b.id));

export const DEFAULT_SAVE = () => ({ gold: STARTING_GOLD, inv: { ...STARTER_INVENTORY }, best: 0, runs: 0 });
