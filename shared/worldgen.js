// The continent, v4 — a large land mass (4096 units across) built for long
// flights. Biomes are big region-based zones with noise-warped borders and
// natural transitions, motivated by elevation: a tall snowy mountain range
// in the north, a vast pine forest in the west, a terracotta desert canyon
// in the east, jungle wetlands in the south, a volcanic badland in the
// southwest, autumn woods in the northeast, and a central plains hub where
// you spawn — all ringed by ocean and beaches.
//
// One deterministic heightfield + biome map shared by the server (spawning)
// and client (terrain, water, props, physics). Coordinates: world is
// WORLD.size across, centered on (0,0). North = -Z, East = +X. Sea = y 0.

import { Simplex2D } from './noise.js';

export const WORLD = {
  seed: 20260613,
  size: 4096,
  half: 2048,
  seaLevel: 0,
  shoreStart: 1560,   // land fades to beach beyond here (after coastline warp)
  shoreEnd: 1880,     // open ocean beyond here
  spawn: { x: 0, z: 320 },

  // Large biome regions. Each point picks the nearest region (warped), and
  // elevation/water rules override on top. terrain.js blends colors by these.
  regions: [
    { biome: 'meadow', x: 0, z: 220, r: 880 },
    { biome: 'forest', x: -1180, z: -260, r: 900 },
    { biome: 'snow', x: -120, z: -1320, r: 1000 },
    { biome: 'desert', x: 1280, z: 180, r: 900 },
    { biome: 'jungle', x: 340, z: 1300, r: 880 },
    { biome: 'volcano', x: -1240, z: 1020, r: 620 },
    { biome: 'autumn', x: 1080, z: -1000, r: 640 },
  ],

  mountain: { x: -120, z: -1380, r: 1020, height: 300, snowLine: 120 },
  volcano: { x: -1240, z: 1020, r: 560, rim: 180, craterR: 150, floor: 44, lava: 50 },
  desertMesa: { x: 1320, z: 200, r: 820 },

  lakes: [
    { x: 240, z: 640, r: 360, surface: 5 },     // big central lake (Heron Lake)
    { x: -780, z: 360, r: 180, surface: 7 },     // forest-edge pond
    { x: 980, z: 760, r: 150, surface: 4 },      // jungle lagoon
  ],
  // ice lake in the snow basin — frozen sheet is walkable
  iceLake: { x: -260, z: -980, r: 280, surface: 8 },

  // rivers: polylines carved from the high country down to the sea/lake.
  // They cut a valley RELATIVE to the local terrain so the water always
  // follows the ground (depth = how deep the channel sits below the banks).
  rivers: [
    { pts: [{ x: -120, z: -980 }, { x: -40, z: -500 }, { x: 120, z: -60 }, { x: 220, z: 420 }, { x: 240, z: 600 }], width: 26, depth: 6 },
    { pts: [{ x: 980, z: -300 }, { x: 1180, z: 120 }, { x: 1320, z: 560 }, { x: 1500, z: 1000 }], width: 22, depth: 6 },
    { pts: [{ x: 240, z: 760 }, { x: 360, z: 1100 }, { x: 540, z: 1480 }, { x: 760, z: 1760 }], width: 30, depth: 5 },
  ],
};

const noise = new Simplex2D(WORLD.seed);
const noiseB = new Simplex2D(WORLD.seed * 7 + 3);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- rivers ----------

// Distance from (x,z) to the nearest river + that river's params and the
// nearest point ON the centerline (px,pz) so callers can sample the bed.
function nearestRiver(x, z) {
  let best = null;
  for (const r of WORLD.rivers) {
    const pts = r.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, width: r.width, depth: r.depth, px, pz };
    }
  }
  return best;
}

// Water surface y of a river at its centerline point (px,pz): the carved
// bed plus a shallow water depth — always relative to the terrain, so the
// ribbon can never float above the ground.
export function riverSurfaceAt(px, pz) {
  return height(px, pz) + 0.9;
}

// ---------- the heightfield ----------

export function height(x, z) {
  // warp the coastline so the continent isn't a circle
  const wx = x + noise.fbm(x * 0.0007, z * 0.0007, 3) * 320;
  const wz = z + noise.fbm(x * 0.0007 + 11, z * 0.0007 - 7, 3) * 320;
  const r = Math.hypot(wx, wz);
  const cont = smoothstep(WORLD.shoreEnd, WORLD.shoreStart, r); // 1 interior → 0 ocean

  // base: deep ocean floor up to gentle interior plains
  let h = lerp(-46, 12, cont);
  // rolling hills, land only
  h += cont * (noise.fbm(x * 0.0014, z * 0.0014, 4) * 18 + noise.fbm(x * 0.005, z * 0.005, 2) * 3.5);

  // --- northern mountain range: ridged, very tall, masked to the north ---
  const m = WORLD.mountain;
  const md = Math.hypot(x - m.x, z - m.z);
  const mMask = Math.exp(-((md / m.r) ** 2) * 1.4) * cont;
  if (mMask > 0.002) {
    const ridge = noise.ridged(x * 0.0022, z * 0.0022, 5);
    h += m.height * mMask * (0.34 + 0.66 * ridge);
  }

  // --- volcano: broad cone with a sunken crater ---
  const v = WORLD.volcano;
  const vd = Math.hypot(x - v.x, z - v.z);
  if (vd < v.r * 1.7) {
    const cone = v.rim * Math.exp(-(((Math.max(vd, v.craterR) - v.craterR) / (v.r * 0.6)) ** 2) * 1.7);
    let vh = cone * (0.82 + 0.18 * noise.ridged(x * 0.006, z * 0.006, 3));
    if (vd < v.craterR) vh = lerp(v.floor, vh, smoothstep(v.craterR * 0.5, v.craterR, vd));
    h = Math.max(h, vh);
  }

  // --- desert: terraced mesas + a carved canyon feel ---
  const dm = WORLD.desertMesa;
  const dmd = Math.hypot(x - dm.x, z - dm.z);
  if (dmd < dm.r * 1.2) {
    const dMask = smoothstep(dm.r * 1.2, dm.r * 0.5, dmd) * cont;
    const band = (noiseB.fbm(x * 0.0024, z * 0.0024, 3) + 1) / 2;       // 0..1
    const terrace = Math.floor(band * 5) / 5;
    const mesa = 14 + terrace * 72 + noiseB.fbm(x * 0.012, z * 0.012, 2) * 4;
    h = lerp(h, mesa, dMask);
  }

  // --- lakes: scoop basins ---
  for (const L of WORLD.lakes) {
    const ld = Math.hypot(x - L.x, z - L.z);
    if (ld < L.r * 1.5) {
      const depth = 9 * Math.exp(-((ld / (L.r * 0.85)) ** 2) * 1.5);
      h = lerp(h, Math.min(h, L.surface + 2), smoothstep(L.r * 1.5, L.r * 0.85, ld)) - depth * smoothstep(L.r * 1.5, L.r, ld);
    }
  }
  // ice lake basin (shallow; ice sheet sits on top, walkable via groundAt)
  {
    const il = WORLD.iceLake;
    const d = Math.hypot(x - il.x, z - il.z);
    if (d < il.r * 1.4) h = Math.min(h, lerp(il.surface - 2, h, smoothstep(il.r * 0.8, il.r * 1.4, d)));
  }

  // --- rivers: carve a valley relative to the local ground (flat-ish bed in
  // the middle, sloping up to the banks) so the water always sits in it ---
  const rv = nearestRiver(x, z);
  if (rv && rv.d < rv.width * 2) {
    h -= rv.depth * smoothstep(rv.width * 2, rv.width * 0.3, rv.d);
  }

  // beaches: soften the land just above the waterline near the coast
  if (h > 0 && h < 5 && cont < 0.4) h *= 0.7;

  return h;
}

// ---------- liquids ----------

export function waterAt(x, z, y = null) {
  const h = height(x, z);

  // lakes
  for (const L of WORLD.lakes) {
    if (Math.hypot(x - L.x, z - L.z) < L.r && h < L.surface) return { surface: L.surface, kind: 'lake' };
  }
  // rivers (surface tracks the carved bed at the channel centerline)
  const rv = nearestRiver(x, z);
  if (rv && rv.d < rv.width) {
    const surface = riverSurfaceAt(rv.px, rv.pz);
    if (h < surface) return { surface, kind: 'river' };
  }

  // the ice lake is solid — walk on it, don't swim
  const il = WORLD.iceLake;
  if (Math.hypot(x - il.x, z - il.z) < il.r) return null;

  // ocean: anything below sea level out toward the coast
  const wx = x + noise.fbm(x * 0.0007, z * 0.0007, 3) * 320;
  const wz = z + noise.fbm(x * 0.0007 + 11, z * 0.0007 - 7, 3) * 320;
  if (h < WORLD.seaLevel + 0.2 && Math.hypot(wx, wz) > WORLD.shoreStart - 360) {
    return { surface: WORLD.seaLevel, kind: 'ocean' };
  }
  return null;
}

export function lavaAt(x, z) {
  const v = WORLD.volcano;
  const h = height(x, z);
  if (Math.hypot(x - v.x, z - v.z) < v.craterR && h < v.lava) return { surface: v.lava };
  return null;
}

// Where feet rest. The ice lake's frozen sheet is solid ground.
export function groundAt(x, z, y = null) {
  const h = height(x, z);
  const il = WORLD.iceLake;
  if (Math.hypot(x - il.x, z - il.z) < il.r) return Math.max(h, il.surface);
  return h;
}

export function canDrinkAt(x, z, y = null) {
  if (waterAt(x, z, y)) return true;
  const step = 3;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
    if (waterAt(x + Math.cos(a) * step, z + Math.sin(a) * step, y)) return true;
  }
  return false;
}

// ---------- biomes ----------

// Soft region weights at (x,z): { biome: weight } summing ~1. Used by
// terrain.js for smooth color blends between regions.
export function regionWeights(x, z) {
  // warp so borders wiggle instead of forming straight Voronoi seams
  const wx = x + noiseB.fbm(x * 0.0012, z * 0.0012, 3) * 220;
  const wz = z + noiseB.fbm(x * 0.0012 + 5, z * 0.0012 - 9, 3) * 220;
  const out = {};
  let total = 0;
  for (const reg of WORLD.regions) {
    const d = Math.hypot(wx - reg.x, wz - reg.z);
    // inverse-distance-ish falloff scaled by the region's reach
    const w = 1 / (1 + (d / reg.r) ** 4);
    out[reg.biome] = (out[reg.biome] || 0) + w;
    total += w;
  }
  for (const k in out) out[k] /= total || 1;
  return out;
}

// Discrete biome for spawn tables + ambience.
export function biomeAt(x, z, y = null) {
  const h = height(x, z);

  // water first
  if (h < WORLD.seaLevel - 0.5) {
    const wx = x + noise.fbm(x * 0.0007, z * 0.0007, 3) * 320;
    const wz = z + noise.fbm(x * 0.0007 + 11, z * 0.0007 - 7, 3) * 320;
    if (Math.hypot(wx, wz) > WORLD.shoreStart - 360) return 'ocean';
  }
  for (const L of WORLD.lakes) if (Math.hypot(x - L.x, z - L.z) < L.r * 1.1) return 'lake';

  // volcano (region + lava)
  const v = WORLD.volcano;
  if (Math.hypot(x - v.x, z - v.z) < v.r * 1.1) return 'volcano';

  // high + snowy → snow regardless of region (the mountain cap)
  if (h > WORLD.mountain.snowLine) return 'snow';

  // pick the dominant region
  const w = regionWeights(x, z);
  let best = 'meadow', bw = -1;
  for (const k in w) if (w[k] > bw) { bw = w[k]; best = k; }

  // low coastal land reads as beach
  const wx = x + noise.fbm(x * 0.0007, z * 0.0007, 3) * 320;
  const wz = z + noise.fbm(x * 0.0007 + 11, z * 0.0007 - 7, 3) * 320;
  const cont = smoothstep(WORLD.shoreEnd, WORLD.shoreStart, Math.hypot(wx, wz));
  if (h < 4.5 && cont < 0.45 && best !== 'jungle') return 'beach';

  return best;
}

// Random ground point in a biome (rng supplied by caller).
export function randomPointIn(biome, rng, tries = 120) {
  for (let i = 0; i < tries; i++) {
    const x = (rng() * 2 - 1) * (WORLD.shoreStart - 60);
    const z = (rng() * 2 - 1) * (WORLD.shoreStart - 60);
    if (biomeAt(x, z) === biome && !lavaAt(x, z)) return { x, y: groundAt(x, z), z };
  }
  return null;
}
