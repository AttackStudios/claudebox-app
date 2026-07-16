// Backpacking — the wilderness, v2. A large (4096-unit) road-trip continent
// shared by server (bears, vans, persistence) and client (terrain, roads,
// minimap, physics). One deterministic heightfield + road network.
//
// Layout: Pinewood Lodge clearing in the south (spawn), a vast pine forest
// across the centre, the snowy Peaks range in the north with a flat-topped
// mountain that has a parking lot + a drive-through tunnel + a cave, a
// smoking Volcano in the east with a caldera and a road tunnel, red Canyon
// mesas in the SE with a winding gorge, big lakes with a dock, and a paved
// road loop with two roundabouts and parking lots binding it together.
// North = -Z. Sea level 0.

import { Simplex2D } from '../noise.js';

export const WORLD = {
  seed: 20260614,
  size: 4096,
  half: 2048,
  shoreStart: 1640,
  shoreEnd: 1880,
  seaLevel: 0,

  lodge: { x: -200, z: 1160, ry: 0.4 },
  lakeWest: { x: -360, z: 120, r: 300, surface: 2 },
  lakeSouth: { x: 240, z: 900, r: 200, surface: 1.4 },
  // the Peaks range (north) + the flat-topped "Table Mountain" with parking
  peaks: { x: -360, z: -1120, r: 920, height: 290 },
  tableMtn: { x: 220, z: -780, r: 230, top: 150 },   // flat shoulder for a lot + cave
  cave: { x: 250, z: -700, r: 34 },                    // cave in Table Mountain's south face
  volcano: { x: 1080, z: -260, r: 520, rimH: 190, craterR: 150, floor: 60, lavaLevel: 70 },
  canyon: { x: 1060, z: 760, r: 700, plateau: 40 },
  gorge: [{ x: 820, z: 360 }, { x: 980, z: 560 }, { x: 1120, z: 820 }, { x: 1020, z: 1120 }],

  // road tunnels (terrain stays high, the road runs under): one through Table
  // Mountain, one through the Volcano's south flank
  tunnels: [
    { ax: 120, az: -640, bx: 320, bz: -640, r: 26 },
    { ax: 760, az: 40, bx: 900, bz: 240, r: 24 },
  ],

  spawn: { x: -200, z: 1200 },
};

// Road network: polyline waypoints. The big main loop + spurs + roundabouts.
export const ROADS = [
  { id: 'main', width: 12, pts: [
    [-200, 1120], [-420, 1000], [-560, 760], [-560, 460], [-470, 200],   // SW down the west lake shore
    [-520, -120], [-620, -420], [-520, -720], [-300, -900],              // up toward the Peaks foot
    [-60, -940], [120, -640], [320, -640],                                // Table Mountain tunnel stretch
    [520, -560], [740, -420], [760, 40], [900, 240],                      // east toward the Volcano (tunnel)
    [1060, 420], [1180, 740], [1120, 1060], [900, 1240],                  // down past the Canyon
    [560, 1320], [200, 1320], [-120, 1280], [-200, 1120],                 // back along the south
  ]},
  { id: 'lakeSpur', width: 8, pts: [[-470, 200], [-420, 60], [-300, -20], [-180, 10]] },
  { id: 'dockSpur', width: 8, pts: [[200, 1320], [220, 1120], [240, 1000]] },
  { id: 'caveSpur', width: 8, pts: [[320, -640], [300, -700], [262, -716]] },
  { id: 'canyonSpur', width: 8, pts: [[1180, 740], [1320, 700], [1440, 720]] },
  { id: 'volcanoSpur', width: 8, pts: [[1060, 420], [1140, 320], [1200, 180]] },
];

// Roundabouts: circular ring-roads at major junctions (appended to ROADS so
// the height/mesh/collision systems treat them as roads). Rendered with a
// grassy island in props.
// Roundabouts retired: the giant ring-junctions read as broken "rings on the
// roads" and their grading gouged the terrain. Junctions are now plain
// crossings. Kept as an (empty) export for the props/minimap code.
export const ROUNDABOUTS = [];

// Paved parking lots (rendered with a pergola + marked spaces + lights).
// Every lot has an explicit pad height (y): terrain is flattened EXACTLY to it
// (see height()), so pads can never float or sink. Positions chosen on flat,
// road-adjacent ground.
export const PARKING_LOTS = [
  { x: -240, z: 1080, y: 11,   w: 58, d: 40, ry: 0.3, label: 'Lodge Lot' },
  { x: 270,  z: -800, y: 150,  w: 46, d: 34, ry: 0.2, label: 'Mountain Lot' },   // Table Mountain plateau
  { x: 1460, z: 640,  y: 68.5, w: 50, d: 36, ry: 0.1, label: 'Canyon Lot' },
  { x: -300, z: -20,  y: 3.5,  w: 44, d: 32, ry: 1.2, label: 'Lakeside Lot' },
  { x: 1120, z: 260,  y: 44.5, w: 44, d: 32, ry: -0.4, label: 'Volcano Lot' },
];

// Where vans park (map's car-spawn pins). ry = facing.
export const CAR_SPAWNS = [
  { x: -252, z: 1066, ry: 0.3 }, { x: -240, z: 1080, ry: 0.3 }, { x: -228, z: 1094, ry: 0.3 },
  { x: -300, z: -20, ry: 1.2 }, { x: 230, z: 1010, ry: -0.6 }, { x: 1460, z: 640, ry: 0.1 },
  { x: 270, z: -800, ry: 0.2 }, { x: 1120, z: 260, ry: -0.4 }, { x: -200, z: 1280, ry: 1.57 },
];

// Flat campsite clearings along the roads (map's tent pins).
export const CAMPSITES = [
  { x: -540, z: 300, r: 20 }, { x: -560, z: -300, r: 20 }, { x: -120, z: -880, r: 22 },
  { x: 520, z: -540, r: 20 }, { x: 1140, z: 560, r: 20 }, { x: 760, z: 1240, r: 22 },
  { x: -60, z: 1240, r: 18 }, { x: -380, z: 700, r: 18 },
];

const noise = new Simplex2D(WORLD.seed);
const noiseB = new Simplex2D(WORLD.seed * 3 + 7);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- road geometry ----------
// spatial grid: bucket road segments into cells so roadInfo only tests the
// handful of segments near a query point (vital at 4096-scale terrain builds)
const RG_CELL = 90;
let ROAD_GRID = null;
function buildRoadGrid() {
  ROAD_GRID = new Map();
  for (let ri = 0; ri < ROADS.length; ri++) {
    const p = ROADS[ri].pts;
    const reach = ROADS[ri].width * 3 + 10;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
      const minx = Math.min(ax, bx) - reach, maxx = Math.max(ax, bx) + reach;
      const minz = Math.min(az, bz) - reach, maxz = Math.max(az, bz) + reach;
      for (let cx = Math.floor(minx / RG_CELL); cx <= Math.floor(maxx / RG_CELL); cx++) {
        for (let cz = Math.floor(minz / RG_CELL); cz <= Math.floor(maxz / RG_CELL); cz++) {
          const key = cx + ',' + cz;
          let arr = ROAD_GRID.get(key);
          if (!arr) ROAD_GRID.set(key, arr = []);
          arr.push(ri, i);
        }
      }
    }
  }
}

export function roadInfo(x, z) {
  if (!ROAD_GRID) buildRoadGrid();
  const best = { dist: Infinity, width: 12, t: 0, road: 0, seg: 0, px: 0, pz: 0 };
  const cell = ROAD_GRID.get(Math.floor(x / RG_CELL) + ',' + Math.floor(z / RG_CELL));
  if (!cell) return best;
  for (let k = 0; k < cell.length; k += 2) {
    const ri = cell[k], i = cell[k + 1];
    const p = ROADS[ri].pts;
    const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.dist) { best.dist = d; best.width = ROADS[ri].width; best.t = t; best.road = ri; best.seg = i; best.px = px; best.pz = pz; }
  }
  return best;
}

let ROAD_HEIGHTS = null;
function relax(road, hs, pinned) {
  const grade = 0.085;   // gentler grade for the bigger map
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < hs.length; i++) {
      const d = Math.hypot(road.pts[i][0] - road.pts[i - 1][0], road.pts[i][1] - road.pts[i - 1][1]);
      hs[i] = clamp(hs[i], hs[i - 1] - d * grade, hs[i - 1] + d * grade);
    }
    for (let i = hs.length - 2; i >= 0; i--) {
      const d = Math.hypot(road.pts[i][0] - road.pts[i + 1][0], road.pts[i][1] - road.pts[i + 1][1]);
      hs[i] = clamp(hs[i], hs[i + 1] - d * grade, hs[i + 1] + d * grade);
    }
    for (const [idx, h] of pinned) hs[idx] = h;
  }
}
function buildRoadHeights() {
  const main = ROADS[0];
  const mainHs = main.pts.map(([x, z]) => rawHeight(x, z));
  relax(main, mainHs, [[0, mainHs[0]]]);
  mainHs[mainHs.length - 1] = mainHs[0];
  ROAD_HEIGHTS = [mainHs];
  for (let ri = 1; ri < ROADS.length; ri++) {
    const road = ROADS[ri];
    const hs = road.pts.map(([x, z]) => rawHeight(x, z));
    const pinned = [];
    // pin any waypoint coinciding with a main waypoint, plus glue the
    // roundabout ring to its local road level so it sits flat
    road.pts.forEach(([x, z], i) => {
      const mi = main.pts.findIndex(([mx, mz]) => mx === x && mz === z);
      if (mi >= 0) { hs[i] = mainHs[mi]; pinned.push([i, mainHs[mi]]); }
    });
    if (road.roundabout) {
      // flatten the whole ring to its nearest main-road elevation
      const near = roadInfo(road.pts[0][0], road.pts[0][1]);
      const lvl = lerp(mainHs[near.seg] ?? hs[0], mainHs[near.seg + 1] ?? hs[0], near.t);
      for (let i = 0; i < hs.length; i++) { hs[i] = lvl; pinned.push([i, lvl]); }
    }
    relax(road, hs, pinned);
    ROAD_HEIGHTS.push(hs);
  }
}

export function roadElevation(ri) {
  if (!ROAD_HEIGHTS) buildRoadHeights();
  const hs = ROAD_HEIGHTS[ri.road];
  return lerp(hs[ri.seg], hs[ri.seg + 1], ri.t);
}

export function onRoad(x, z) {
  const r = roadInfo(x, z);
  return r.dist < r.width * 0.5;
}

// is (x,z) inside a parking lot pad?
export function parkingAt(x, z) {
  for (const p of PARKING_LOTS) {
    const c = Math.cos(-p.ry), s = Math.sin(-p.ry);
    const dx = x - p.x, dz = z - p.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < p.w / 2 && Math.abs(lz) < p.d / 2) return p;
  }
  return null;
}

// ---------- heightfield ----------
function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 10 + noise.fbm(x * 0.0013, z * 0.0013, 4) * 26 + noise.fbm(x * 0.006, z * 0.006, 3) * 4;

  // Peaks range (north): big ridged mountains
  const pk = WORLD.peaks;
  const pd = Math.hypot(x - pk.x, z - pk.z);
  const pMask = Math.exp(-((pd / pk.r) ** 2) * 1.7);
  h += pk.height * pMask * (0.62 + 0.38 * noise.ridged(x * 0.0024, z * 0.0024, 5));

  // Table Mountain: a flat-topped mountain (parking lot + cave)
  const tm = WORLD.tableMtn;
  const td = Math.hypot(x - tm.x, z - tm.z);
  if (td < tm.r * 1.5) {
    const tMask = smoothstep(tm.r * 1.5, tm.r * 0.55, td);
    const flat = tm.top + noiseB.fbm(x * 0.02, z * 0.02, 2) * 2;
    h = lerp(h, Math.max(h, flat), tMask);
  }
  // cave alcove in Table Mountain's face
  const cv = WORLD.cave;
  const cd = Math.hypot(x - cv.x, z - cv.z);
  if (cd < cv.r * 2) h = lerp(tm.top - 28, h, smoothstep(cv.r * 0.8, cv.r * 2, cd));

  // Volcano: big cone + sunken caldera
  const v = WORLD.volcano;
  const vd = Math.hypot(x - v.x, z - v.z);
  if (vd < v.r * 1.6) {
    const cone = v.rimH * Math.exp(-(((Math.max(vd, v.craterR) - v.craterR) / (v.r * 0.55)) ** 2) * 1.9);
    let vh = cone * (0.85 + 0.15 * noise.ridged(x * 0.01, z * 0.01, 3));
    if (vd < v.craterR) vh = lerp(v.floor, vh, smoothstep(v.craterR * 0.45, v.craterR, vd));
    h = Math.max(h, vh + 8);
  }

  // Canyon SE: raised plateau with strata terraces + a carved gorge
  const cn = WORLD.canyon;
  const cnd = Math.hypot(x - cn.x, z - cn.z);
  if (cnd < cn.r * 1.25) {
    const t = (noiseB.fbm(x * 0.0042, z * 0.0042, 3) + 1) / 2;
    const terrace = Math.floor(t * 5) / 5;
    const ch = cn.plateau + terrace * 48 + noiseB.fbm(x * 0.03, z * 0.03, 2) * 2;
    h = lerp(h, ch, smoothstep(cn.r * 1.25, cn.r * 0.6, cnd));
  }
  let gd = Infinity;
  for (let i = 0; i < WORLD.gorge.length - 1; i++) {
    const a = WORLD.gorge[i], b = WORLD.gorge[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
    gd = Math.min(gd, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  if (gd < 110) h = lerp(Math.min(h, 8 + noiseB.fbm(x * 0.02, z * 0.02, 2) * 1.5), h, smoothstep(40, 110, gd));

  // lakes: depressions
  for (const L of [WORLD.lakeWest, WORLD.lakeSouth]) {
    const ld = Math.hypot(x - L.x, z - L.z);
    const depth = 10 * Math.exp(-((ld / (L.r * 0.85)) ** 2) * 1.6);
    h = Math.min(h, lerp(h, L.surface + 3, smoothstep(L.r * 1.5, L.r * 0.9, ld))) - depth;
  }

  // lodge clearing: flatten a pad
  const lg = WORLD.lodge;
  const lgd = Math.hypot(x - lg.x, z - lg.z);
  h = lerp(8, h, smoothstep(60, 150, lgd));


  // campsite clearings
  for (const c of CAMPSITES) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r * 2.2) h = lerp(rawAt(c.x, c.z), h, smoothstep(c.r, c.r * 2.2, d));
  }

  // island falloff to the sea
  const shore = smoothstep(WORLD.shoreStart, WORLD.shoreEnd, r);
  h = lerp(h, -14, shore);
  return h;
}

function rawAt(cx, cz) {
  return 9 + noise.fbm(cx * 0.0013, cz * 0.0013, 4) * 18;
}

export function height(x, z) {
  let h = rawHeight(x, z);
  // roads: cut/fill terrain toward the graded roadbed. Tunnels are cut-through
  // notches (a covering arch is rendered over them in props), so vehicles can
  // always drive at road level.
  const ri = roadInfo(x, z);
  const rel = roadElevation(ri);
  // widen the cut where terrain towers far above the roadbed, so mountain
  // roads carve gentle benches instead of narrow vertical gashes
  const reach = ri.width * 2.6 + Math.min(70, Math.max(0, h - rel) * 1.5);
  if (ri.dist < reach) {
    h = lerp(rel, h, smoothstep(ri.width * 0.55, reach, ri.dist));
  }
  // parking lots LAST: terrain inside a pad is exactly lot.y (flat), easing
  // back to natural ground over an 18-unit skirt. Roads can't re-carve pads.
  for (const lot of PARKING_LOTS) {
    const dx = x - lot.x, dz = z - lot.z;
    const c = Math.cos(-lot.ry), s = Math.sin(-lot.ry);
    const lx = Math.abs(dx * c - dz * s), lz2 = Math.abs(dx * s + dz * c);
    const dOut = Math.max(lx - lot.w / 2, lz2 - lot.d / 2, 0);
    if (dOut < 18) h = lerp(lot.y, h, smoothstep(0, 18, dOut));
  }
  return h;
}

// ---------- surfaces ----------
export function waterAt(x, z) {
  const h = height(x, z);
  for (const L of [WORLD.lakeWest, WORLD.lakeSouth]) {
    if (Math.hypot(x - L.x, z - L.z) < L.r && h < L.surface) return { surface: L.surface, kind: 'lake' };
  }
  if (h < WORLD.seaLevel + 0.1 && Math.hypot(x, z) > WORLD.shoreStart - 120) {
    return { surface: WORLD.seaLevel, kind: 'ocean' };
  }
  return null;
}

export function lavaAt(x, z) {
  const v = WORLD.volcano;
  if (Math.hypot(x - v.x, z - v.z) < v.craterR && height(x, z) < v.lavaLevel) {
    return { surface: v.lavaLevel };
  }
  return null;
}

export function groundAt(x, z) { return height(x, z); }

export function inLodge(x, z) {
  return Math.hypot(x - WORLD.lodge.x, z - WORLD.lodge.z) < 40;
}

// inside any road tunnel (for tunnel rendering + sky dimming)?
export function inTunnel(x, z) {
  for (const t of WORLD.tunnels) {
    const dx = t.bx - t.ax, dz = t.bz - t.az;
    const len2 = dx * dx + dz * dz;
    let k = clamp(((x - t.ax) * dx + (z - t.az) * dz) / len2, 0, 1);
    if (Math.hypot(x - (t.ax + dx * k), z - (t.az + dz * k)) < t.r) return true;
  }
  return false;
}

// ---------- regions (minimap label + spawn logic) ----------
export function regionAt(x, z) {
  if (Math.hypot(x - WORLD.lodge.x, z - WORLD.lodge.z) < 90) return 'Lodge';
  if (Math.hypot(x - WORLD.cave.x, z - WORLD.cave.z) < WORLD.cave.r * 1.5) return 'Cave';
  const v = WORLD.volcano;
  if (Math.hypot(x - v.x, z - v.z) < v.r * 1.1) return 'Volcano';
  if (Math.hypot(x - WORLD.tableMtn.x, z - WORLD.tableMtn.z) < WORLD.tableMtn.r * 1.05) return 'Table Mountain';
  const pk = WORLD.peaks;
  if (Math.hypot(x - pk.x, z - pk.z) < pk.r * 1.0) return 'Peaks';
  if (Math.hypot(x - WORLD.canyon.x, z - WORLD.canyon.z) < WORLD.canyon.r) return 'Canyon';
  for (const L of [WORLD.lakeWest, WORLD.lakeSouth]) {
    if (Math.hypot(x - L.x, z - L.z) < L.r * 1.3) return 'Lakes';
  }
  if (height(x, z) < 1.5) return 'Shore';
  return 'Forest';
}

export function randomWildPoint(rng) {
  for (let i = 0; i < 90; i++) {
    const x = (rng() * 2 - 1) * (WORLD.shoreStart - 80);
    const z = (rng() * 2 - 1) * (WORLD.shoreStart - 80);
    if (inLodge(x, z)) continue;
    if (Math.hypot(x - WORLD.lodge.x, z - WORLD.lodge.z) < 160) continue;
    if (waterAt(x, z) || lavaAt(x, z)) continue;
    const reg = regionAt(x, z);
    if (reg === 'Volcano' || reg === 'Shore') continue;
    return { x, y: height(x, z), z };
  }
  return { x: 400, y: height(400, -400), z: -400 };
}
