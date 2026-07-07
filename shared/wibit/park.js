// Wibit Simulator — the BIG, sprawling, multi-level inflatable water park.
//
// Everything floats on water at y = 0. A giant central mega-trampoline hub, eight
// spokes out to feature stations, an inner loop AND an elevated high-ring you run
// up to, towering action towers, a giant climbing iceberg, mega blob catapults
// that fling you onto floating SKY PLATFORMS, big slides, wiggle bridges, log
// gauntlets, balance beams and stepping pods. Reachable from a long beach dock.
//
// Single source of truth for both server (spawn/rounds) and client (meshes +
// physics). Static collision in COLLIDERS; moving parts (wiggle bridges, logs,
// swings) are computed from a shared clock. Blast pads carry their own launch
// power (vh/vv) so each catapult reliably reaches its target.

export const WATER_Y = 0;
export const DECK = 1.6;          // walkable height of a base (floating) walkway
export const THK = 1.3;           // inflatable thickness

// ---- palette (from the reference photos) ----
export const C = {
  green: '#5bbf3a', greenDk: '#3f9c2a', lime: '#a6d94b',
  blue: '#2f7fd6', blueDk: '#1f5fae', navy: '#163b6b',
  yellow: '#f2c20c', yellowDk: '#d99e08',
  ice: '#dfeefc', iceDk: '#b9d4ee', trim: '#1f5fae',
  trampMat: '#16324f', pink: '#e8478c', orange: '#f08a1d',
};

// ---------------------------------------------------------------- builders ----
let pid = 0;
export const PARTS = [];
export const COLLIDERS = [];
export const WIGGLES = [];
export const LOGS = [];
export const SWINGS = [];

function part(p) { p.id = 'wp' + (pid++); PARTS.push(p); return p; }
function boxCol(x, z, w, d, top, kind, ref) { COLLIDERS.push({ shape: 'box', x, z, w, d, top, kind: kind || 'deck', ref: ref || null }); }
function circleCol(x, z, r, top, kind, ref) { COLLIDERS.push({ shape: 'circle', x, z, r, top, kind: kind || 'deck', ref: ref || null }); }
function oboxCol(x, z, w, d, dir, top, kind, ref) { COLLIDERS.push({ shape: 'obox', x, z, w, d, dir, top, kind: kind || 'deck', ref: ref || null }); }
function rampCol(x, z, w, len, dir, topHi, topLo, kind, ref) { COLLIDERS.push({ shape: 'ramp', x, z, w, len, dir, topHi, topLo, kind: kind || 'slide', ref: ref || null }); }

const TAU = Math.PI * 2;
const polar = (a, r) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
const rad = (d) => (d * Math.PI) / 180;

// a flat floating/elevated rectangular deck (with support pillars if raised)
function deck(x, z, w, d, top, color, rot) {
  part({ kind: 'deck', shape: 'rect', x, z, w, d, top, color: color || C.green, trim: C.blue, rot: rot || 0 });
  if (rot) oboxCol(x, z, w, d, rot, top, 'deck'); else boxCol(x, z, w, d, top, 'deck');
  if (top > DECK + 1.5) {        // raised deck → add inflatable support columns
    const off = Math.min(w, d) / 2 - 1.4;
    for (const sx of [-off, off]) for (const sz of [-off, off]) {
      part({ kind: 'pillar', x: x + sx, z: z + sz, top, color: C.blueDk });
    }
  }
  return { x, z, top };
}

// straight walkway between two points
function walkway(ax, az, bx, bz, w, color, top) {
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const len = Math.hypot(bx - ax, bz - az), dir = Math.atan2(bz - az, bx - ax);
  top = top ?? DECK;
  part({ kind: 'deck', shape: 'rect', x: mx, z: mz, w: len, d: w, top, color: color || C.blue, trim: C.green, rot: dir });
  oboxCol(mx, mz, len, w, dir, top, 'deck');
  if (top > DECK + 1.5) {
    for (const t of [0.25, 0.75]) {
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      part({ kind: 'pillar', x: px, z: pz, top, color: C.blueDk });
    }
  }
  return { mx, mz, dir, len };
}

// a walkable up-ramp (NOT slippery) made of stepped pads, climbs from y0→y1
function staircase(x, z, dir, fromTop, toTop, steps, color) {
  const total = 14;                       // horizontal run
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x + Math.cos(dir) * total * t;
    const pz = z + Math.sin(dir) * total * t;
    const ty = fromTop + (toTop - fromTop) * t;
    part({ kind: 'step', x: px, z: pz, w: 6, d: 6, top: ty, color: color || C.yellow });
    boxCol(px, pz, 6, 6, ty, 'deck');
  }
  return polar(dir, 0); // unused
}

// a fast slide ramp (slippery) from a high lip down to a low end
function slide(x, z, dir, w, len, topHi, topLo, color, pipe) {
  const ex = x + Math.cos(dir) * len, ez = z + Math.sin(dir) * len;
  const mx = (x + ex) / 2, mz = (z + ez) / 2;
  part({ kind: 'slide', x: mx, z: mz, w, len, dir, topHi, topLo, color: color || C.yellow, pipe: !!pipe });
  rampCol(mx, mz, w, len, dir, topHi, topLo, 'slide');
  return { ex, ez };
}

// a big bouncy trampoline
function trampoline(x, z, size, top, color) {
  part({ kind: 'tramp', x, z, size, top, color: color || C.green });
  boxCol(x, z, size - 1.5, size - 1.5, top, 'tramp');
}

// a blast catapult that flings you with a given power (vh outward, vv up)
function blast(x, z, dir, vh, vv, h, color) {
  part({ kind: 'blast', x, z, w: 8, d: 9, top: DECK + h, dir, color: color || C.yellow });
  boxCol(x, z, 6, 5, DECK + h, 'blast', { dir, vh, vv });
  // ramp up onto the lip from the inward side
  const up = polar(dir + Math.PI, 6);
  slide(x + up.x, z + up.z, dir, 6, 6, DECK + h - 0.2, DECK + 0.2, C.green);
}

// ===================================================================
//  BEACH + LONG ENTRY DOCK (south)
// ===================================================================
export const SHORE_Z = 120;
export const SPAWN = { x: 0, y: DECK + 0.5, z: SHORE_Z - 10 };
export const ICEBERG = { x: 0, z: 0, baseR: 11, top: 13.5, climbR: 14 };

(function beach() {
  part({ kind: 'beach', x: 0, z: SHORE_Z + 24, w: 320, d: 120 });
  part({ kind: 'dock', x: 0, z: SHORE_Z - 8, w: 10, d: 44, top: DECK });
  boxCol(0, SHORE_Z - 8, 10, 44, DECK, 'deck');
})();

// ===================================================================
//  CENTRAL MEGA-TRAMPOLINE HUB
// ===================================================================
const HUB = 15;
deck(0, 0, HUB * 2, HUB * 2, DECK, C.green);
trampoline(0, 0, 18, DECK + 0.5, C.green);
// a central SKY PLATFORM directly above, reachable by a charged mega-bounce,
// with a giant slide back down to the ground.
const SKY_C = { x: 10, z: 0, y: 16 };
deck(SKY_C.x, SKY_C.z, 16, 16, SKY_C.y, C.lime);
slide(SKY_C.x + 7, SKY_C.z, 0, 6, 30, SKY_C.y - 0.5, DECK + 0.3, C.yellow);   // long slide east, to ground
part({ kind: 'swingframe', x: SKY_C.x, z: SKY_C.z + 6, top: SKY_C.y + 3, dir: Math.PI / 2 });
SWINGS.push({ id: 'swC', x: SKY_C.x, z: SKY_C.z + 6, baseY: SKY_C.y + 0.6, len: 4, dir: Math.PI / 2, amp: 1.2, speed: 1.5, phase: 0 });

// ===================================================================
//  EIGHT SPOKES + FEATURE STATIONS  (45° apart)
// ===================================================================
const SPOKE_IN = HUB;
const STATION_R = 44;            // station pad centre radius
const PAD = 8;                   // station pad half-extent
const SPOKE_W = 6;

// directions (degrees)
const DIR = { ice: 0, blob: 45, tower: 90, tramp: 135, stairs: 180, wiggle: 225, log: 270, beam: 315 };

function plainSpoke(a, color) {
  const i = polar(a, SPOKE_IN), o = polar(a, STATION_R - PAD);
  walkway(i.x, i.z, o.x, o.z, SPOKE_W, color || C.blue);
}
function stationPad(a, top, color) {
  const c = polar(a, STATION_R);
  return deck(c.x, c.z, PAD * 2, PAD * 2, top ?? DECK, color || C.green);
}

// ---- 0° EAST: GIANT CLIMBING ICEBERG -----------------------------
{
  const a = rad(DIR.ice);
  plainSpoke(a, C.blue);
  const pad = stationPad(a);
  const ice = polar(a, STATION_R + 24);
  ICEBERG.x = ice.x; ICEBERG.z = ice.z;
  walkway(pad.x, pad.z, (pad.x + ice.x) / 2, (pad.z + ice.z) / 2, 5, C.blue);
}

// ---- 45° NE: MEGA BLOB CATAPULT → SKY PLATFORM -------------------
{
  const a = rad(DIR.blob);
  plainSpoke(a, C.blue);
  const pad = stationPad(a, DECK, C.lime);
  // blast straight-ish up & outward onto a big sky platform along the arc
  blast(pad.x, pad.z, a, 24, 34, 3.2, C.orange);
  const sky = polar(a, STATION_R + 34);
  deck(sky.x, sky.z, 18, 18, 17, C.lime);
  // slide from the sky platform back down to the outer ring
  const down = polar(a, STATION_R + 20);
  slide(sky.x, sky.z, a + Math.PI, 6, 26, 16.5, DECK + 0.3, C.yellow);
}

// ---- 90° NORTH: MEGA ACTION TOWER (3 tiers) + giant slide + swing -
{
  const a = rad(DIR.tower);
  plainSpoke(a, C.blue);
  const pad = stationPad(a, DECK, C.green);
  // climb: staircase from pad up to tier 1, ramps/steps to tier 2 & 3
  const t1 = 5, t2 = 9.5, t3 = 14;
  staircase(pad.x - 4, pad.z, a, DECK, t1, 4, C.yellow);
  const tierC = polar(a, STATION_R + 6);
  deck(tierC.x, tierC.z, 12, 12, t1, C.green);
  deck(tierC.x, tierC.z, 9, 9, t2, C.lime);
  deck(tierC.x, tierC.z, 6, 6, t3, C.green);
  staircase(tierC.x - 3, tierC.z - 5, a + Math.PI / 2, t1, t2, 4, C.yellow);
  staircase(tierC.x + 3, tierC.z - 5, a - Math.PI / 2, t2, t3, 4, C.yellow);
  part({ kind: 'tower', x: tierC.x, z: tierC.z, w: 12, d: 12, top: t3 });
  // GIANT slide from the very top all the way down to the water's edge
  slide(tierC.x, tierC.z, a, 6, 38, t3 - 0.5, DECK + 0.2, C.yellow);
  // a high swing off the top tier
  part({ kind: 'swingframe', x: tierC.x, z: tierC.z + 5, top: t3 + 3, dir: a });
  SWINGS.push({ id: 'swT', x: tierC.x, z: tierC.z + 5, baseY: t3 + 0.6, len: 4.2, dir: a, amp: 1.25, speed: 1.5, phase: 1 });
}

// ---- 135° NW: TRAMPOLINE LADDER (escalating bounces) up to a high pad
{
  const a = rad(DIR.tramp);
  plainSpoke(a, C.blue);
  const pad = stationPad(a, DECK, C.green);
  // three trampolines, then a high catch-pad you bounce up to
  for (let i = 0; i < 3; i++) {
    const p = polar(a, STATION_R + 6 + i * 7);
    trampoline(p.x, p.z, 8, DECK + 0.4 + i * 0.2, i % 2 ? C.lime : C.green);
  }
  const high = polar(a, STATION_R + 30);
  deck(high.x, high.z, 12, 12, 9, C.lime);
  slide(high.x, high.z, a + Math.PI, 5, 24, 8.5, DECK + 0.3, C.yellow);
}

// ---- 180° WEST: GRAND STAIRCASE up to the HIGH RING --------------
const HIGH_RING_Y = 7;
{
  const a = rad(DIR.stairs);
  plainSpoke(a, C.blue);
  const pad = stationPad(a, DECK, C.green);
  staircase(pad.x, pad.z, a, DECK, HIGH_RING_Y, 6, C.yellow);
  const topC = polar(a, STATION_R + 16);
  deck(topC.x, topC.z, 12, 12, HIGH_RING_Y, C.lime);
}

// ---- 225° SW: LONG WIGGLE BRIDGE + STEPPING PODS ----------------
{
  const a = rad(DIR.wiggle);
  // the spoke is a long wobbling bridge
  const i = polar(a, SPOKE_IN), o = polar(a, STATION_R - PAD);
  const mx = (i.x + o.x) / 2, mz = (i.z + o.z) / 2;
  const len = Math.hypot(o.x - i.x, o.z - i.z), dir = Math.atan2(o.z - i.z, o.x - i.x);
  WIGGLES.push({ id: 'wg0', x: mx, z: mz, len, w: 5, dir, top: DECK, amp: 1.1, sway: 0.9, speed: 2.0, phase: 0 });
  const pad = stationPad(a, DECK, C.green);
  // stepping pods out past the pad over a big gap to a landing
  const land = polar(a, STATION_R + 26);
  for (let k = 0; k < 6; k++) {
    const r = STATION_R + PAD + 2 + k * 3.2;
    const p = polar(a, r);
    const off = ((k % 2) ? 1 : -1) * 2.0;
    const px = p.x + Math.cos(a + Math.PI / 2) * off, pz = p.z + Math.sin(a + Math.PI / 2) * off;
    part({ kind: 'pod', x: px, z: pz, r: 1.8, top: DECK + 0.1 + (k * 0.15), color: k % 2 ? C.yellow : C.lime });
    circleCol(px, pz, 1.8, DECK + 0.1 + (k * 0.15), 'pod');
  }
  deck(land.x, land.z, 10, 10, DECK, C.green);
}

// ---- 270° SOUTH: ENTRY DOCK + LOG ROLL GAUNTLET -----------------
{
  const a = rad(DIR.log);
  plainSpoke(a, C.blue);
  const pad = stationPad(a, DECK, C.green);
  // three rolling logs across gaps, with small landings between
  let r = STATION_R + PAD + 3;
  for (let k = 0; k < 3; k++) {
    const p = polar(a, r);
    LOGS.push({ id: 'lg' + k, x: p.x, z: p.z, len: 8, r: 1.3, top: DECK + 0.6, dir: a + Math.PI / 2, speed: 2.0 + k * 0.6, push: 7 });
    const land = polar(a, r + 6);
    deck(land.x, land.z, 7, 7, DECK, k % 2 ? C.lime : C.green);
    r += 10;
  }
  // connect the last landing back toward the entry dock
  const last = polar(a, r);
  walkway(last.x, last.z, 0, SHORE_Z - 30, 7, C.green);
}

// ---- 315° SE: BIG HALF-PIPE + DROP SLIDES -----------------------
{
  const a = rad(DIR.beam);
  // the spoke is a narrow balance beam
  const i = polar(a, SPOKE_IN), o = polar(a, STATION_R - PAD);
  const mx = (i.x + o.x) / 2, mz = (i.z + o.z) / 2;
  const len = Math.hypot(o.x - i.x, o.z - i.z), dir = Math.atan2(o.z - i.z, o.x - i.x);
  part({ kind: 'beam', x: mx, z: mz, len, w: 1.8, top: DECK + 0.3, dir, color: C.yellow });
  oboxCol(mx, mz, len, 1.8, dir, DECK + 0.3, 'beam');
  const pad = stationPad(a, DECK, C.green);
  // a big half-pipe slide that drops you into the water far out
  const lip = polar(a, STATION_R + PAD);
  slide(pad.x, pad.z, a, 8, 16, DECK + 0.2, -1.0, C.blue, true);
}

// ===================================================================
//  INNER RING — connect all eight station pads into a big loop
// ===================================================================
{
  const order = Object.values(DIR);
  for (let k = 0; k < order.length; k++) {
    const a0 = rad(order[k]), a1 = rad(order[(k + 1) % order.length]);
    const p0 = polar(a0, STATION_R), p1 = polar(a1, STATION_R);
    const am = (order[k] + 22.5) ;
    const mid = polar(rad(am), STATION_R + 6);
    walkway(p0.x, p0.z, mid.x, mid.z, 5, k % 2 ? C.green : C.blue);
    walkway(mid.x, mid.z, p1.x, p1.z, 5, k % 2 ? C.green : C.blue);
    deck(mid.x, mid.z, 6, 6, DECK, C.lime);
  }
}

// ===================================================================
//  HIGH RING — an elevated loop linking the tall decks (verticality!)
// ===================================================================
{
  // connect: grand-staircase top (180°), tower tier-1 (90°), tramp high pad (135°)
  const a = [rad(DIR.tower), rad(DIR.tramp), rad(DIR.stairs)];
  const pts = [polar(a[0], STATION_R + 6), polar(a[1], STATION_R + 30), polar(a[2], STATION_R + 16)];
  walkway(pts[0].x, pts[0].z, pts[1].x, pts[1].z, 5, C.lime, 6.5);
  walkway(pts[1].x, pts[1].z, pts[2].x, pts[2].z, 5, C.lime, 7);
}

// ===================================================================
//  ICEBERG render entry (x/z now set by the 0° spoke)
// ===================================================================
part({ kind: 'iceberg', ref: ICEBERG });
circleCol(ICEBERG.x, ICEBERG.z, 3, ICEBERG.top, 'icetop', ICEBERG);

// Replace the live park with a custom world (e.g. from ClaudeBox Studio).
// Mutates the shared arrays/objects IN PLACE so main.js (which imported them)
// sees the new world. Pass null/undefined to keep the default park.
// pristine default snapshot so saving an empty level reverts to the built-in park
const _DEFAULT = {
  parts: [...PARTS], colliders: [...COLLIDERS], wiggles: [...WIGGLES], logs: [...LOGS], swings: [...SWINGS],
  iceberg: { ...ICEBERG }, spawn: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
};
export function applyWorld(world) {
  const w = world || _DEFAULT;   // null/empty → restore the default park
  const swap = (arr, next) => { arr.length = 0; for (const x of (next || [])) arr.push(x); };
  swap(PARTS, w.parts); swap(COLLIDERS, w.colliders);
  swap(WIGGLES, w.wiggles); swap(LOGS, w.logs); swap(SWINGS, w.swings);
  if (world && !world.iceberg) Object.assign(ICEBERG, { x: 99999, z: 99999, baseR: 0, top: 0, climbR: 0 });  // custom w/o iceberg → disable cone
  else Object.assign(ICEBERG, w.iceberg);
  if (w.spawn) { SPAWN.x = w.spawn.x; SPAWN.y = w.spawn.y; SPAWN.z = w.spawn.z; }
}

// ===================================================================
//  DYNAMIC PART HELPERS (shared clock, seconds)
// ===================================================================
export function wiggleOffset(w, t) {
  return {
    dy: Math.sin(t * w.speed + w.phase) * w.amp,
    dx: Math.cos(t * w.speed * 0.8 + w.phase) * w.sway * Math.cos(w.dir + Math.PI / 2),
    dz: Math.cos(t * w.speed * 0.8 + w.phase) * w.sway * Math.sin(w.dir + Math.PI / 2),
  };
}
export function logAngle(l, t) { return t * l.speed; }
export function logPush(l) {
  return { x: Math.cos(l.dir + Math.PI / 2), z: Math.sin(l.dir + Math.PI / 2), mag: l.push };
}
export function swingState(s, t) {
  const ang = Math.sin(t * s.speed + s.phase) * s.amp;
  const fx = Math.cos(s.dir), fz = Math.sin(s.dir);
  return {
    ang,
    seatX: s.x + fx * Math.sin(ang) * s.len,
    seatZ: s.z + fz * Math.sin(ang) * s.len,
    seatY: s.baseY + 2.4 - Math.cos(ang) * s.len,
    fx, fz,
  };
}

export const PARK = {
  parts: PARTS, colliders: COLLIDERS, wiggles: WIGGLES, logs: LOGS, swings: SWINGS,
  iceberg: ICEBERG, waterY: WATER_Y, spawn: SPAWN, shoreZ: SHORE_Z, C,
};
