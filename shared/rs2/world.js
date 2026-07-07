// Restaurant Simulator 2 — the town. A sunny, near-flat map: a main street
// of 8 restaurant plots, a residential street of 8 cottages, a plaza with a
// fountain between them, all on a textured road grid. Shared by server
// (assignment, sim pathing) and client (terrain, buildings, physics).
// North = -Z. Main street runs E-W at z=0; homes line z=250.

import { Simplex2D } from '../noise.js';

export const WORLD = {
  seed: 20260612,
  size: 1024,
  half: 512,
};

// ---------- roads (straight segments, flat town) ----------
export const ROADS = [
  { id: 'main', width: 11, pts: [[-430, 0], [430, 0]] },
  { id: 'residential', width: 9, pts: [[-430, 250], [430, 250]] },
  { id: 'westConn', width: 9, pts: [[-260, 0], [-260, 250]] },
  { id: 'eastConn', width: 9, pts: [[160, 0], [160, 250]] },
  { id: 'plazaLoop', width: 7, pts: [[-60, 0], [-60, 125], [60, 125], [60, 0]] },
];

// ---------- restaurant plots ----------
// Pads face the main street. North-side plots face +z (south); south-side face -z.
// Building sits at the back of the pad; moped pad on the right side.
function plot(id, x, z, faceSouth) {
  const ry = faceSouth ? 0 : Math.PI;       // building front direction (door looks toward street)
  const f = faceSouth ? 1 : -1;
  return {
    id, x, z, ry, padW: 30, padD: 24,
    doorX: x, doorZ: z + f * 12,            // pad-edge door point (building front)
    entryX: x, entryZ: z + f * 17,          // where customers spawn/leave (sidewalk)
    mopedX: x + 13, mopedZ: z + f * 9, mopedRy: faceSouth ? Math.PI / 2 : -Math.PI / 2,
  };
}
export const PLOTS = [
  plot(0, -330, -26, true), plot(1, -160, -26, true), plot(2, 40, -26, true), plot(3, 260, -26, true),
  plot(4, -330, 26, false), plot(5, -160, 26, false), plot(6, 40, 26, false), plot(7, 260, 26, false),
];

// ---------- houses ----------
// Cottages on the south side of the residential street, doors facing north.
function house(id, x) {
  return {
    id, x, z: 282, ry: Math.PI,             // front faces -z (the street)
    doorX: x, doorZ: 275.5,
    porchX: x, porchZ: 272,
    mopedStopX: x, mopedStopZ: 262,         // where deliverers park
  };
}
export const HOUSES = [-360, -265, -170, -75, 75, 170, 265, 360].map((x, i) => house(i, x));

export const PLAZA = { x: 0, z: 125, r: 48 };

export const SPAWN = { x: 0, z: 70 };       // plaza north edge, between the streets

const noise = new Simplex2D(WORLD.seed);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- road distance ----------
export function roadInfo(x, z) {
  let best = { dist: Infinity, width: 9 };
  for (const road of ROADS) {
    const p = road.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      t = clamp(t, 0, 1);
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best.dist) best = { dist: d, width: road.width };
    }
  }
  return best;
}

// ---------- terrain ----------
export function height(x, z) {
  // gentle rolling lawn, flattened hard around all built things
  let h = 2 + noise.fbm(x * 0.006, z * 0.006, 3) * 1.4;

  let flat = 0; // 0..1 how strongly we flatten to the town level
  for (const p of PLOTS) {
    const d = Math.max(Math.abs(x - p.x) - p.padW / 2, Math.abs(z - p.z) - p.padD / 2);
    flat = Math.max(flat, smoothstep(8, -2, d));
  }
  for (const hs of HOUSES) {
    const d = Math.max(Math.abs(x - hs.x) - 11, Math.abs(z - hs.z) - 10);
    flat = Math.max(flat, smoothstep(8, -2, d));
  }
  const pd = Math.hypot(x - PLAZA.x, z - PLAZA.z);
  flat = Math.max(flat, smoothstep(PLAZA.r + 10, PLAZA.r - 4, pd));
  const ri = roadInfo(x, z);
  flat = Math.max(flat, smoothstep(ri.width * 1.6, ri.width * 0.6, ri.dist));

  h = lerp(h, 2, flat);

  // soft edge falloff so the map ends in low rolling meadow, no cliffs
  const r = Math.hypot(x, z);
  h += smoothstep(430, 512, r) * 2.5 * (noise.fbm(x * 0.01, z * 0.01, 2) + 1);
  return h;
}

export function groundAt(x, z) {
  return height(x, z);
}

// which plot pad contains (x,z)? returns the plot or null (used for music)
export function plotAt(x, z) {
  for (const p of PLOTS) {
    if (Math.abs(x - p.x) <= p.padW / 2 + 2 && Math.abs(z - p.z) <= p.padD / 2 + 2) return p;
  }
  return null;
}

export function houseAt(x, z) {
  for (const hs of HOUSES) {
    if (Math.abs(x - hs.x) <= 13 && Math.abs(z - hs.z) <= 13) return hs;
  }
  return null;
}

// expansion tiers: interior floor size (cells are 1u)
export const EXPANSIONS = [
  { w: 12, d: 10, price: 0, label: 'Cozy' },
  { w: 16, d: 13, price: 1500, label: 'Roomy' },
  { w: 20, d: 16, price: 4000, label: 'Grand' },
  { w: 24, d: 18, price: 9000, label: 'Famous' },
];

// building origin: interior grid (gx,gz) → world. The building back wall sits
// at the pad's back edge; the door is centered on the front wall.
export function buildingFrame(plot, expansion) {
  const { w, d } = EXPANSIONS[expansion];
  const f = plot.ry === 0 ? 1 : -1; // front direction sign (+z or -z)
  // center of the building floor
  const cx = plot.x;
  const cz = plot.z - f * (plot.padD / 2 - d / 2 - 1) * 0; // keep centered on pad
  return {
    w, d, cx, cz: plot.z, f,
    // grid cell (gx 0..w-1, gz 0..d-1) → world center of that cell
    cellToWorld(gx, gz) {
      return {
        x: cx - w / 2 + gx + 0.5,
        z: plot.z - f * (d / 2) + f * (gz + 0.5),
      };
    },
    doorWorld() {
      return { x: cx, z: plot.z + f * (d / 2) };
    },
  };
}
