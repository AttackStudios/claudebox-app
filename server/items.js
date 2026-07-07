// World items, themed per biome and spread across the big continent: mice in
// the meadows, fruit under the forest + autumn trees, bananas + starfruit in
// the jungle, cactus fruit in the desert, snowberries up in the snowy north,
// emberfruit on the volcano's ash flats, mushrooms in damp shade, fish in the
// lakes + shallows. The server keeps each kind topped up to its cap and
// shuffles mice around so they feel alive.

import { state, genId } from './state.js';
import { biomeAt, groundAt, randomPointIn } from '../shared/worldgen.js';

const rng = Math.random;

const SPAWN_TABLE = [
  { kind: 'mouse', biomes: ['meadow', 'forest', 'autumn'], cap: 28 },
  { kind: 'snake', biomes: ['jungle', 'desert', 'meadow'], cap: 14 },   // prey: worth the most
  { kind: 'fruit', biomes: ['forest', 'autumn', 'meadow'], cap: 26 },
  { kind: 'banana', biomes: ['jungle'], cap: 18 },
  { kind: 'cactusfruit', biomes: ['desert'], cap: 16 },
  { kind: 'fish', biomes: ['beach', 'lake'], cap: 18 },
  { kind: 'mushroom', biomes: ['jungle', 'forest'], cap: 16 },
  { kind: 'snowberry', biomes: ['snow'], cap: 16 },
  { kind: 'emberfruit', biomes: ['volcano'], cap: 12 },
  { kind: 'starfruit', biomes: ['jungle'], cap: 12 },
];

export function topUpItems(broadcast) {
  for (const row of SPAWN_TABLE) {
    const alive = [...state.items.values()].filter((i) => i.kind === row.kind).length;
    for (let n = alive; n < row.cap; n++) {
      const biome = row.biomes[Math.floor(rng() * row.biomes.length)];
      const pt = randomPointIn(biome, rng);
      if (!pt) continue;
      const item = { id: genId('i'), kind: row.kind, x: pt.x, y: Math.max(pt.y, 0.1), z: pt.z, heldBy: null };
      if (row.kind === 'snake') item.length = 3 + Math.floor(rng() * 13);   // 3–15 m
      state.items.set(item.id, item);
      broadcast({ t: 'item.spawn', item });
    }
  }
}

// Mice hop to a nearby spot every few seconds.
export function tickItems(broadcast) {
  for (const item of state.items.values()) {
    if (item.kind !== 'mouse' || item.heldBy) continue;
    if (rng() > 0.06) continue;
    const nx = item.x + (rng() * 2 - 1) * 6;
    const nz = item.z + (rng() * 2 - 1) * 6;
    const b = biomeAt(nx, nz);
    if (b !== 'meadow' && b !== 'forest' && b !== 'autumn') continue;
    item.x = nx; item.z = nz; item.y = Math.max(groundAt(nx, nz), 0.1);
    broadcast({ t: 'item.move', id: item.id, x: item.x, y: item.y, z: item.z });
  }
}
