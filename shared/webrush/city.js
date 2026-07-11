// Web Rush — shared city layout. Deterministic so every client + the server
// agree on building positions (used for web-anchor raycasts and collision).

export const GROUND = 520;
export const SPAWN = { x: 0, y: 60, z: 8 };   // start on a rooftop, mid-fall into a swing

// tiny seeded PRNG so the city is identical everywhere
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// city grid constants (shared with the client for streets + props)
export const BLOCK = 62, ROAD = 20, SPAN = BLOCK + ROAD, N = 4;   // blocks from -N..N
export const PLAZAS = [];   // {x,z} block centres left open (park/plaza)

const STYLE_COL = {
  glass:    [0x4a6a8a, 0x3a5a7a, 0x567a9a, 0x2f5270, 0x6a8aa8],
  concrete: [0x7a8090, 0x6a7080, 0x8a90a0, 0x727988],
  brick:    [0x8a5644, 0x784636, 0x9a6a50, 0x6e4030],
  stone:    [0x9a9a8a, 0x8a8a7c, 0xaaaa98, 0x807e70],
};
const STYLES = ['glass', 'glass', 'concrete', 'concrete', 'brick', 'stone'];

// Manhattan grid: blocks separated by roads; towers use setbacks (ziggurats).
export const BUILDINGS = (() => {
  const r = lcg(0xC0FFEE);
  const out = [];
  const push = (cx, cz, w, d, h, style, ci, y0 = 0, crown = false) =>
    out.push({ x: cx, z: cz, w, d, h, y0, style, crown, color: STYLE_COL[style][ci % STYLE_COL[style].length] });
  const tower = (cx, cz, w, d, h, style, ci) => {
    if (h > 108 && Math.min(w, d) > 15) {                 // setback ziggurat: 3 tiers
      const h1 = h * 0.5, h2 = h * 0.8;
      push(cx, cz, w, d, h1, style, ci);
      push(cx, cz, w * 0.72, d * 0.72, h2, style, ci, h1);
      push(cx, cz, w * 0.46, d * 0.46, h, style, ci, h2, true);
    } else push(cx, cz, w, d, h, style, ci, 0, h > 78 && r() < 0.45);
  };

  for (let bx = -N; bx <= N; bx++) {
    for (let bz = -N; bz <= N; bz++) {
      const ox = bx * SPAN, oz = bz * SPAN;
      const dist = Math.hypot(bx, bz);
      if (r() < 0.06) { PLAZAS.push({ x: ox, z: oz }); continue; }   // open plaza block
      const style = STYLES[Math.floor(r() * STYLES.length)];
      const ci = Math.floor(r() * 5);
      if (r() < 0.22) {                                   // one big block-filling tower
        const w = BLOCK - 8 - r() * 6, d = BLOCK - 8 - r() * 6;
        const h = (r() < 0.5 ? 130 + r() * 150 : 60 + r() * 60) - dist * 3;
        tower(ox, oz, w, d, Math.max(24, h), style, ci);
      } else {                                            // 2x2 sub-lots
        for (let sx = 0; sx < 2; sx++) for (let sz = 0; sz < 2; sz++) {
          if (r() < 0.12) continue;
          const w = BLOCK / 2 - 4 - r() * 8, d = BLOCK / 2 - 4 - r() * 8;
          const cx = ox + (sx - 0.5) * (BLOCK / 2), cz = oz + (sz - 0.5) * (BLOCK / 2);
          const tall = r() < 0.2;
          const h = Math.max(18, (tall ? 120 + r() * 140 : 28 + r() * 66) - dist * 4);
          tower(cx, cz, w, d, h, r() < 0.7 ? style : STYLES[Math.floor(r() * STYLES.length)], ci);
        }
      }
    }
  }
  // signature towers near the middle for epic swings
  tower(30, -40, 26, 26, 300, 'glass', 0);
  tower(-55, 40, 24, 24, 262, 'stone', 1);
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
