// Web Rush — shared city layout. Deterministic so every client + the server
// agree on building positions (used for web-anchor raycasts and collision).

export const GROUND = 520;
export const SPAWN = { x: 0, y: 60, z: 8 };   // start on a rooftop, mid-fall into a swing

// tiny seeded PRNG so the city is identical everywhere
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Manhattan grid: blocks separated by roads; each block holds a few towers.
export const BUILDINGS = (() => {
  const r = lcg(0xC0FFEE);
  const out = [];
  const BLOCK = 62, ROAD = 20, N = 4;            // blocks from -N..N
  const PAL = [0x5a6272, 0x6b7486, 0x4a5160, 0x737d8f, 0x565e6e, 0x818b9c];
  for (let bx = -N; bx <= N; bx++) {
    for (let bz = -N; bz <= N; bz++) {
      const ox = bx * (BLOCK + ROAD), oz = bz * (BLOCK + ROAD);
      // 2x2 sub-lots per block, each maybe a tower
      for (let sx = 0; sx < 2; sx++) {
        for (let sz = 0; sz < 2; sz++) {
          if (r() < 0.12) continue;               // occasional gap / plaza
          const w = BLOCK / 2 - 4 - r() * 6, d = BLOCK / 2 - 4 - r() * 6;
          const cx = ox + (sx - 0.5) * (BLOCK / 2), cz = oz + (sz - 0.5) * (BLOCK / 2);
          const dist = Math.hypot(bx, bz);
          const tall = r() < 0.18;                 // some skyscrapers
          const h = tall ? 120 + r() * 130 : 30 + r() * 70 - dist * 4;
          out.push({ x: cx, z: cz, w, d, h: Math.max(18, h), color: PAL[(out.length + bx + bz + 6) % PAL.length] });
        }
      }
    }
  }
  // a couple of signature towers near the middle for epic swings
  out.push({ x: 30, z: -40, w: 26, d: 26, h: 300, color: 0x8892a4 });
  out.push({ x: -55, z: 40, w: 24, d: 24, h: 260, color: 0x7c8698 });
  return out;
})();

// crime scenes at street intersections — go there and clear the thugs.
export const CRIMES = [
  { id: 'c1', x: 41,   z: 41,   name: 'Bank Robbery',    thugs: 4 },
  { id: 'c2', x: -82,  z: 0,    name: 'Mugging',         thugs: 3 },
  { id: 'c3', x: 0,    z: -82,  name: 'Gang Fight',      thugs: 5 },
  { id: 'c4', x: 123,  z: -41,  name: 'Jewelry Heist',   thugs: 4 },
  { id: 'c5', x: -41,  z: 123,  name: 'Warehouse Deal',  thugs: 5 },
  { id: 'c6', x: 82,   z: 82,   name: 'Getaway Chase',   thugs: 4 },
];

export const MAX_HP = 100;
export const GRAVITY = 26;
export const WEB_RANGE = 130;    // max web-anchor distance
