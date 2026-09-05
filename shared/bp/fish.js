// Backpacking fishing: the species table, rarity tiers, and the roll.
//
// Shared by the server (which is authoritative — it decides what you hooked the
// moment you cast) and the client (which needs the same table to draw the
// fishing guide and the catch card). Nothing here touches the DOM or Node, so
// both sides import it directly.

export const RARITIES = {
  common:    { label: 'Common',    color: '#b6bdc9', mult: 1,  weight: 100 },
  uncommon:  { label: 'Uncommon',  color: '#54cf87', mult: 2,  weight: 44 },
  rare:      { label: 'Rare',      color: '#4fa3ff', mult: 4,  weight: 16 },
  epic:      { label: 'Epic',      color: '#b07cff', mult: 9,  weight: 5 },
  legendary: { label: 'Legendary', color: '#ffb43a', mult: 22, weight: 1.2 },
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Odds of any catch coming out shiny. Shinies are worth 3x and are the thing
// people screenshot, so they want to be rare enough to stay special.
export const SHINY_CHANCE = 1 / 40;

// `water` is where it bites: 'lake', 'ocean', or 'any'.
// `where` is the human hint shown in the guide.
// `min`/`max` are centimetres; `value` is the Marshmallow value of an average
// one, before the size, rarity and shiny multipliers.
export const FISH = [
  // ---- lakes -------------------------------------------------------------
  { id: 'sunfish',    name: 'Sunfish',        emoji: '🐟', rarity: 'common',    water: 'lake',  min: 10, max: 26, value: 6,  where: 'Lakes, all day' },
  { id: 'perch',      name: 'Yellow Perch',   emoji: '🐠', rarity: 'common',    water: 'lake',  min: 14, max: 34, value: 8,  where: 'Lakes, near the reeds' },
  { id: 'trout',      name: 'Rainbow Trout',  emoji: '🐟', rarity: 'uncommon',  water: 'lake',  min: 22, max: 52, value: 16, where: 'Lakes, cool water' },
  { id: 'bass',       name: 'Largemouth Bass',emoji: '🐟', rarity: 'uncommon',  water: 'lake',  min: 26, max: 60, value: 20, where: 'Lakes, by the shallows' },
  { id: 'pike',       name: 'Northern Pike',  emoji: '🐊', rarity: 'rare',      water: 'lake',  min: 45, max: 110, value: 42, where: 'Lakes, deep water' },
  { id: 'sturgeon',   name: 'Lake Sturgeon',  emoji: '🐡', rarity: 'epic',      water: 'lake',  min: 90, max: 210, value: 95, where: 'Lakes, the deepest part' },

  // ---- ocean / shore -----------------------------------------------------
  { id: 'sardine',    name: 'Sardine',        emoji: '🐟', rarity: 'common',    water: 'ocean', min: 8,  max: 20, value: 5,  where: 'Shore, anywhere' },
  { id: 'mackerel',   name: 'Mackerel',       emoji: '🐟', rarity: 'common',    water: 'ocean', min: 18, max: 40, value: 9,  where: 'Shore, all day' },
  { id: 'seabass',    name: 'Sea Bass',       emoji: '🐠', rarity: 'uncommon',  water: 'ocean', min: 30, max: 70, value: 22, where: 'Shore, past the surf' },
  { id: 'snapper',    name: 'Red Snapper',    emoji: '🐠', rarity: 'rare',      water: 'ocean', min: 35, max: 85, value: 46, where: 'Shore, rocky points' },
  { id: 'swordfish',  name: 'Swordfish',      emoji: '🗡️', rarity: 'epic',      water: 'ocean', min: 120, max: 300, value: 110, where: 'Shore, far out' },
  { id: 'sunfishmola',name: 'Ocean Sunfish',  emoji: '🌕', rarity: 'legendary', water: 'ocean', min: 180, max: 330, value: 280, where: 'Shore, very rare' },

  // ---- anywhere ----------------------------------------------------------
  { id: 'minnow',     name: 'Minnow',         emoji: '🐟', rarity: 'common',    water: 'any',   min: 4,  max: 12, value: 3,  where: 'Any water' },
  { id: 'catfish',    name: 'Catfish',        emoji: '🐈', rarity: 'uncommon',  water: 'any',   min: 30, max: 95, value: 24, where: 'Any water, after dark' },
  { id: 'eel',        name: 'Eel',            emoji: '🪱', rarity: 'rare',      water: 'any',   min: 40, max: 120, value: 50, where: 'Any water, after dark' },
  { id: 'goldenkoi',  name: 'Golden Koi',     emoji: '✨', rarity: 'legendary', water: 'any',   min: 20, max: 60, value: 240, where: 'Any water, very rare' },

  // ---- junk: the thing that makes a real catch feel good -----------------
  { id: 'boot',       name: 'Old Boot',       emoji: '🥾', rarity: 'common',    water: 'any',   min: 20, max: 30, value: 1,  junk: true, where: 'Sadly, anywhere' },
  { id: 'can',        name: 'Rusty Can',      emoji: '🥫', rarity: 'common',    water: 'any',   min: 8,  max: 14, value: 1,  junk: true, where: 'Sadly, anywhere' },
  { id: 'weeds',      name: 'Tangled Weeds',  emoji: '🌿', rarity: 'common',    water: 'any',   min: 10, max: 40, value: 1,  junk: true, where: 'Sadly, anywhere' },
];

export const FISH_BY_ID = Object.fromEntries(FISH.map((f) => [f.id, f]));

// Fish that can bite in a given water kind ('lake' | 'ocean').
export function poolFor(water) {
  return FISH.filter((f) => f.water === 'any' || f.water === water);
}

// Night runs roughly 0.75 -> 0.25 on the day clock; a couple of species only
// show up then, which gives people a reason to fish after dark.
export function isNight(clock01) {
  return clock01 > 0.78 || clock01 < 0.22;
}

const NIGHT_ONLY = new Set(['catfish', 'eel']);

// Rolls a catch. `rand` is injected so the server can use its own RNG and tests
// can be deterministic.
export function rollCatch({ water, clock = 0.5, luck = 1, rand = Math.random }) {
  const night = isNight(clock);
  const pool = poolFor(water).filter((f) => (NIGHT_ONLY.has(f.id) ? night : true));

  let total = 0;
  const weights = pool.map((f) => {
    let w = RARITIES[f.rarity].weight;
    if (f.junk) w = 34;                      // junk is common but not dominant
    else w *= luck;                          // better rods tilt the table
    if (NIGHT_ONLY.has(f.id)) w *= 2.2;      // they are the point of night fishing
    total += w;
    return w;
  });

  let r = rand() * total;
  let pick = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) { pick = pool[i]; break; }
  }

  // Size: triangular-ish so most fish sit mid-range and monsters are memorable.
  const t = (rand() + rand()) / 2;
  const cm = Math.round((pick.min + (pick.max - pick.min) * t) * 10) / 10;
  const shiny = !pick.junk && rand() < SHINY_CHANCE;

  return { id: pick.id, cm, shiny, value: valueOf(pick, cm, shiny) };
}

// Bigger is worth more, on a curve that tops out around 2x for a record fish.
export function valueOf(fish, cm, shiny) {
  const span = Math.max(1, fish.max - fish.min);
  const sizeFactor = 0.6 + 1.4 * Math.min(1, Math.max(0, (cm - fish.min) / span));
  const v = fish.value * sizeFactor * RARITIES[fish.rarity].mult * (shiny ? 3 : 1);
  return Math.max(1, Math.round(v));
}

// How long the fish takes to bite, and how long you have to react once it does.
export const BITE_MIN_MS = 1800;
export const BITE_MAX_MS = 7000;
export const REACT_MS = 2200;      // window to hit "Reel!" after the bobber dips —
                                   // generous enough for a phone on a slow connection
export const CAST_COOLDOWN_MS = 600;
