// Natural Disaster Survival — shared tuning (client render + server logic agree).
// Original implementation inspired by the classic; all geometry is our own.
// Maps are built from PIECES: {x,y,z,w,h,d,c,s} where s = strength/HP
// (0 = indestructible; lower = weaker). Disasters damage pieces in range and
// weak ones break off & fall — the map falls apart around you.

export const WORLD = { waterY: -1.4, islandY: 0, islandRadius: 34 };

export const ROUND = {
  intermission: 14, warning: 30, disaster: 27, aftermath: 6,
  reward: { stars: 2, cubes: 1 },
  machineCost: 5,
};

// full disaster roster
export const DISASTERS = {
  flood:        { id: 'flood',        name: 'Flood',            emoji: '🌊', color: '#2f7fd0' },
  wildfire:     { id: 'wildfire',     name: 'Fire',             emoji: '🔥', color: '#ff4d1a' },
  meteors:      { id: 'meteors',      name: 'Meteor Shower',    emoji: '☄️', color: '#ff6a2a' },
  quake:        { id: 'quake',        name: 'Earthquake',       emoji: '🌎', color: '#7a5a3a' },
  tornado:      { id: 'tornado',      name: 'Tornado',          emoji: '🌪️', color: '#8a8f98' },
  tsunami:      { id: 'tsunami',      name: 'Tsunami',          emoji: '🌊', color: '#1f6fb0' },
  acid:         { id: 'acid',         name: 'Acid Rain',        emoji: '🧪', color: '#7de04a' },
  thunderstorm: { id: 'thunderstorm', name: 'Thunderstorm',     emoji: '⛈️', color: '#c8d0e0' },
  blizzard:     { id: 'blizzard',     name: 'Blizzard',         emoji: '❄️', color: '#bfe4ff' },
  sandstorm:    { id: 'sandstorm',    name: 'Sandstorm',        emoji: '🏜️', color: '#d9b46a' },
  volcano:      { id: 'volcano',      name: 'Volcanic Eruption', emoji: '🌋', color: '#e03a10' },
  hail:         { id: 'hail',         name: 'Hailstorm',        emoji: '🧊', color: '#bfe4ff' },
  heat:         { id: 'heat',         name: 'Heat Wave',        emoji: '☀️', color: '#ffb03d' },
  toxic:        { id: 'toxic',        name: 'Toxic Fog',        emoji: '☣️', color: '#7de04a' },
  avalanche:    { id: 'avalanche',    name: 'Avalanche',        emoji: '🪨', color: '#c8d0da' },
  ufo:          { id: 'ufo',          name: 'UFO Invasion',     emoji: '🛸', color: '#7affd0' },
};
export const DISASTER_IDS = Object.keys(DISASTERS);

// strength tiers
const INDEST = 0, STRONG = 420, MED = 120, WEAK = 55, GLASS = 22, FURN = 14, WOOD = 45;

// ---- shared building helpers ----
function floorWithHole(P, y, w, d, hx, hz, hw, hd, col, thick = 0.6) {
  const add = (x, z, sw, sd) => { if (sw > 0.1 && sd > 0.1) P.push({ x, y, z, w: sw, h: thick, d: sd, c: col, s: INDEST, t: 'floor' }); };
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const hxa = hx - hw / 2, hxb = hx + hw / 2, hza = hz - hd / 2, hzb = hz + hd / 2;
  add((x0 + hxa) / 2, 0, hxa - x0, d);
  add((hxb + x1) / 2, 0, x1 - hxb, d);
  add(hx, (z0 + hza) / 2, hxb - hxa, hza - z0);
  add(hx, (hzb + z1) / 2, hxb - hxa, z1 - hzb);
}
// real switchback stairwell in a 6x6 shaft: up lane A (west), landing, back down lane B (east).
// Pair with a floor hole over lane B only (hx = cx+1.5, hw = 3) — exit the top step westward onto solid floor.
function switchback(P, cx, cz, fromY, toY, col) {
  const mid = (fromY + toY) / 2, n = 6, run = 5.5 / n;
  for (let i = 0; i < n; i++) { const top = fromY + ((mid - fromY) / n) * (i + 1); P.push({ x: cx - 1.5, y: fromY + (top - fromY) / 2, z: cz - 2.75 + run * (i + 0.5), w: 2.6, h: top - fromY, d: run + 0.06, c: col, s: INDEST, t: 'stair' }); }
  P.push({ x: cx, y: fromY + ((fromY + toY) / 2 - fromY) / 2, z: cz + 2.4, w: 5.9, h: (toY - fromY) / 2, d: 1.2, c: col, s: INDEST, t: 'stair' });   // landing
  for (let i = 0; i < n; i++) { const top = mid + ((toY - mid) / n) * (i + 1); P.push({ x: cx + 1.5, y: fromY + (top - fromY) / 2, z: cz + 2.75 - run * (i + 0.5), w: 2.6, h: top - fromY, d: run + 0.06, c: col, s: INDEST, t: 'stair' }); }
}
const add = (P, x, y, z, w, h, d, c, s, o) => P.push(Object.assign({ x, y, z, w, h, d, c, s }, o || {}));

// ===================== GLASS OFFICE (48 x 34, 3 floors) =====================
function officeMap() {
  const P = [];
  const slab = '#c2c7cf', steel = '#7f8894', glass = '#a9d6ef', core = '#39414c', desk = '#8a6a44', rail = '#6a7280', accent = '#3a6ea5';
  const FL = 3, FH = 6, W = 48, D = 34, HX = 11, HZ = -7;
  add(P, 0, -1, 0, W + 30, 2, D + 30, '#aeb4be', INDEST, { t: 'plaza' });   // plaza (ground)
  add(P, 0, 0.4, D / 2 + 8, 14, 0.8, 3, '#4f7a4f', INDEST, { t: 'planter' });
  add(P, 0, 0.4, -D / 2 - 8, 14, 0.8, 3, '#4f7a4f', INDEST, { t: 'planter' });
  add(P, -W / 2 - 8, 0.4, 0, 3, 0.8, 12, '#4f7a4f', INDEST, { t: 'planter' });
  for (let f = 0; f <= FL; f++) {
    const y = f * FH;
    if (f === 0) add(P, 0, y, 0, W, 0.6, D, slab, INDEST, { t: 'floor' });
    else floorWithHole(P, y, W, D, HX + 1.5, HZ, 3, 6, slab);   // hole over stair lane B only
    if (f < FL) {
      for (const cx of [-W / 2 + 1.5, -12, 0, 12, W / 2 - 1.5]) for (const cz of [-D / 2 + 1.5, 0, D / 2 - 1.5]) add(P, cx, y + FH / 2, cz, 0.7, FH, 0.7, steel, INDEST, { t: 'col' });
      const nx = 15, nz = 11, ph = FH - 1.2;
      // curtain wall — center pane on each long side is an OPEN entrance on the ground floor
      for (let i = 0; i < nx; i++) { const px = -W / 2 + (i + 0.5) * (W / nx); const doorway = f === 0 && i === 7; if (!doorway) add(P, px, y + FH / 2, -D / 2, W / nx - 0.18, ph, 0.18, glass, GLASS, { t: 'glass' }); if (!doorway) add(P, px, y + FH / 2, D / 2, W / nx - 0.18, ph, 0.18, glass, GLASS, { t: 'glass' }); if (doorway) for (const dz of [-D / 2, D / 2]) { add(P, px - 1.6, y + FH / 2, dz, 0.3, ph, 0.3, steel, STRONG, { t: 'jamb' }); add(P, px + 1.6, y + FH / 2, dz, 0.3, ph, 0.3, steel, STRONG, { t: 'jamb' }); } }
      for (let i = 0; i < nz; i++) { const pz = -D / 2 + (i + 0.5) * (D / nz); add(P, -W / 2, y + FH / 2, pz, 0.18, ph, D / nz - 0.18, glass, GLASS, { t: 'glass' }); add(P, W / 2, y + FH / 2, pz, 0.18, ph, D / nz - 0.18, glass, GLASS, { t: 'glass' }); }
      add(P, HX, y + FH / 2, HZ - 3.3, 7, FH, 0.4, core, STRONG, { t: 'wall' });   // stairwell wall (south)
      add(P, HX + 3.3, y + FH / 2, HZ, 0.4, FH, 7, core, STRONG, { t: 'wall' });   // stairwell wall (east)
      // office partitions (breakable)
      add(P, -6, y + FH / 2, 4, 0.25, FH - 1.2, 16, slab, MED, { t: 'wall' });
      add(P, -12, y + FH / 2, -3, 14, FH - 1.2, 0.25, slab, MED, { t: 'wall' });
      add(P, 10, y + FH / 2, 6, 0.25, FH - 1.2, 10, slab, MED, { t: 'wall' });
      add(P, 16, y + FH / 2, -2, 8, FH - 1.2, 0.25, slab, MED, { t: 'wall' });
      for (const [dx, dz] of [[-18, -10], [-18, -2], [-10, -12], [-8, 6], [5, 10], [18, -12], [16, 8], [-2, -14], [8, 12], [-20, 10]]) add(P, dx, y + 1.1, dz, 2.2, 1, 1.1, desk, FURN, { t: 'furn' });
      // interior railings — split with a center gap so they never block the entrances
      for (const rz of [D / 2 - 0.35, -D / 2 + 0.35]) { add(P, -12.15, y + 1, rz, 20.7, 1, 0.16, rail, WEAK, { t: 'rail' }); add(P, 12.15, y + 1, rz, 20.7, 1, 0.16, rail, WEAK, { t: 'rail' }); }
      switchback(P, HX, HZ, y, y + FH, steel);
    }
  }
  const ry = FL * FH;
  add(P, -12, ry + 1.6, -8, 5, 3, 4, steel, STRONG, { t: 'ac' });
  add(P, 10, ry + 1.1, 10, 4, 2, 4, steel, STRONG, { t: 'ac' });
  add(P, 0, ry + 0.45, 0, 14, 0.3, 14, accent, INDEST, { t: 'helipad', ns: 1 });
  return P;
}

// ===================== HEIGHTS SCHOOL (64 x 36, 2 floors) =====================
function schoolMap() {
  const P = [];
  const brick = '#b5654a', brick2 = '#9a5238', slab = '#d8d2c4', win = '#bfe0f0', roof = '#5a4030', door = '#6a4a2a', locker = '#3a6a8a', floor = '#c9c2b0', gym = '#caa86a';
  const FL = 2, FH = 5.5, W = 64, D = 36;
  add(P, 0, -1, 0, W + 28, 2, D + 28, '#8faa6a', INDEST, { t: 'lawn' });   // grass lawn (ground)
  add(P, 0, 0.3, D / 2 + 9, 14, 0.6, 5, '#7f9a5a', INDEST, { t: 'field' });
  const HX = -24, HZ = 12;
  for (let f = 0; f <= FL; f++) {
    const y = f * FH;
    if (f === 0) add(P, 0, y, 0, W, 0.6, D, floor, INDEST, { t: 'floor' });
    else floorWithHole(P, y, W, D, HX + 1.5, HZ, 3, 6, floor);   // hole over stair lane B only
    if (f < FL) {
      // brick perimeter walls with window gaps → wall segments + windows
      const segN = 16, segW = W / segN;
      for (let i = 0; i < segN; i++) {
        const px = -W / 2 + (i + 0.5) * segW;
        const doorB = f === 0 && i === 7, doorF = f === 0 && i === 8;   // open entrances (ground floor)
        if (!doorB) add(P, px, y + FH * 0.28, -D / 2, segW - 0.1, FH * 0.56, 0.5, brick, STRONG, { t: 'wall' });     // sill
        add(P, px, y + FH * 0.85, -D / 2, segW - 0.1, FH * 0.3, 0.5, brick, STRONG, { t: 'wall' });      // lintel
        if (i % 2 === 0 && !doorB) add(P, px, y + FH * 0.56, -D / 2, segW - 1, FH * 0.32, 0.2, win, GLASS, { t: 'glass' });
        if (!doorF) add(P, px, y + FH * 0.28, D / 2, segW - 0.1, FH * 0.56, 0.5, brick, STRONG, { t: 'wall' });
        add(P, px, y + FH * 0.85, D / 2, segW - 0.1, FH * 0.3, 0.5, brick, STRONG, { t: 'wall' });
        if (i % 2 === 1 && !doorF) add(P, px, y + FH * 0.56, D / 2, segW - 1, FH * 0.32, 0.2, win, GLASS, { t: 'glass' });
      }
      const segD = 10; for (let i = 0; i < segD; i++) { const pz = -D / 2 + (i + 0.5) * (D / segD); add(P, -W / 2, y + FH / 2, pz, 0.5, FH, D / segD - 0.1, brick2, STRONG, { t: 'wall' }); add(P, W / 2, y + FH / 2, pz, 0.5, FH, D / segD - 0.1, brick2, STRONG, { t: 'wall' }); }
      // main hallway wall — door gaps at z≈±10 so both wings connect
      add(P, -6, y + FH / 2, -14.5, 0.3, FH - 0.6, 7, slab, MED, { t: 'wall' });
      add(P, -6, y + FH / 2, 0, 0.3, FH - 0.6, 18, slab, MED, { t: 'wall' });
      add(P, -6, y + FH / 2, 14.5, 0.3, FH - 0.6, 7, slab, MED, { t: 'wall' });
      // classroom dividers — each with a doorway gap so no room is sealed
      for (const wx of [-22, -14]) { add(P, wx, y + FH / 2, -13.5, 0.3, FH - 0.6, 5, slab, MED, { t: 'wall' }); add(P, wx, y + FH / 2, -4.4, 0.3, FH - 0.6, 8.8, slab, MED, { t: 'wall' }); }
      for (const wz of [-8, 2]) add(P, -14, y + FH / 2, wz, 16, FH - 0.6, 0.3, slab, MED, { t: 'wall' });
      // lockers along the hallway
      for (let i = 0; i < 9; i++) add(P, -4, y + 1.4, -14 + i * 2.8, 0.6, 2.6, 1.1, locker, WEAK, { t: 'furn' });
      // desks in classrooms
      for (const [dx, dz] of [[-27, -12], [-27, -4], [-18, -12], [-18, -4], [-10, -12], [-10, -4]]) add(P, dx, y + 1, dz, 1.6, 0.9, 1, door, FURN, { t: 'furn' });
      // gym floor accent on ground
      if (f === 0) add(P, 18, 0.35, 0, 20, 0.06, 24, gym, INDEST, { t: 'deco', ns: 1 });
      switchback(P, HX, HZ, y, y + FH, slab);
    }
  }
  // flat roof with parapet + bell tower
  const ry = FL * FH;
  for (const [ex, ez, ew, ed] of [[0, -D / 2, W, 0.8], [0, D / 2, W, 0.8], [-W / 2, 0, 0.8, D], [W / 2, 0, 0.8, D]]) add(P, ex, ry + 0.8, ez, ew, 1.6, ed, brick2, STRONG, { t: 'parapet' });
  add(P, -W / 2 + 5, ry + 3, 0, 4, 6, 4, brick, STRONG, { t: 'belltower' });
  add(P, -W / 2 + 5, ry + 6.5, 0, 3, 1.5, 3, roof, STRONG, { t: 'bell' });
  return P;
}

// ===================== FURIOUS STATION (gas station, 90 x 90 island) =====================
function stationMap() {
  const P = [];
  const grass = '#6faa54', lot = '#b7b3a8', curb = '#8f8a7e', wall = '#ece6da', pier = '#d8d2c4',
        storeRoof = '#455063', glass = '#bfe0f0', door = '#34424f',
        canopyTop = '#f2f2f2', trim = '#d2382c', post = '#c2c6ce',
        pump = '#dadada', pumpTop = '#c23a3a', screen = '#243040',
        signPole = '#8a8f98', signFace = '#e8b830', prop = '#3a4450';

  // ---- island: green grass + a paved forecourt ----
  add(P, 0, -1, 0, 90, 2, 90, grass, INDEST, { t: 'ground' });
  add(P, 0, 0.06, -2, 64, 0.12, 44, lot, INDEST, { t: 'deco', ns: 1 });          // asphalt forecourt
  add(P, 0, 0.14, -4, 60, 0.06, 0.3, '#e8e2d0', INDEST, { t: 'deco', ns: 1 });   // lot lines
  add(P, 0, 0.14, -12, 60, 0.06, 0.3, '#e8e2d0', INDEST, { t: 'deco', ns: 1 });

  // ---- convenience store (back of the lot) ----
  const bx = 16, bz = 14, bw = 22, bd = 10, bh = 4.8, fz = bz - bd / 2;
  add(P, bx, 0.22, bz, bw, 0.5, bd, '#cfc9bd', INDEST, { t: 'floor' });
  add(P, bx, bh / 2, bz + bd / 2, bw, bh, 0.4, wall, STRONG, { t: 'wall' });      // back wall
  add(P, bx - bw / 2, bh / 2, bz, 0.4, bh, bd, wall, STRONG, { t: 'wall' });      // side walls
  add(P, bx + bw / 2, bh / 2, bz, 0.4, bh, bd, wall, STRONG, { t: 'wall' });
  add(P, bx - bw / 2 + 0.7, bh / 2, fz, 1.4, bh, 0.4, pier, STRONG, { t: 'wall' });   // front piers
  add(P, bx + bw / 2 - 0.7, bh / 2, fz, 1.4, bh, 0.4, pier, STRONG, { t: 'wall' });
  // OPEN doorway (walk in) — header above + jambs, no solid door blocking it
  const doorX = bx + 7;
  add(P, doorX, bh - 0.6, fz, 2.4, 1.2, 0.35, door, STRONG, { t: 'header' });
  add(P, doorX - 1.35, 2.1, fz, 0.3, 4.2, 0.35, pier, STRONG, { t: 'jamb' });
  add(P, doorX + 1.35, 2.1, fz, 0.3, 4.2, 0.35, pier, STRONG, { t: 'jamb' });
  // storefront glazing (breakable) between piers
  for (let i = 0; i < 6; i++) { const gx = bx - 7.5 + i * 2.7; if (Math.abs(gx - doorX) < 1.5) continue; add(P, gx, 2.3, fz, 2.3, 3.4, 0.16, glass, GLASS, { t: 'glass' }); }
  add(P, bx, bh + 0.25, bz, bw + 1.4, 0.5, bd + 1.4, storeRoof, MED, { t: 'roof' });   // flat overhang roof
  add(P, bx, bh - 0.5, fz - 0.35, bw - 2, 1.3, 0.25, signFace, WEAK, { t: 'sign', ns: 1 });   // fascia sign
  // roof HVAC
  add(P, bx - 4, bh + 1, bz + 1, 2.4, 1.2, 2.2, post, WEAK, { t: 'furn' });
  // storefront kickplate (split around the doorway) + window mullions
  add(P, bx - 1.85, 0.7, fz, 15.3, 1, 0.3, pier, STRONG, { t: 'wall' });
  add(P, bx + 8.85, 0.7, fz, 1.3, 1, 0.3, pier, STRONG, { t: 'wall' });
  for (let i = 0; i < 4; i++) add(P, bx - 6 + i * 3, 2.3, fz, 0.16, 3.4, 0.3, wall, WEAK, { t: 'mullion' });
  // store interior — counter + shelf aisles
  add(P, bx - 5, 1, bz + 2, 6, 1.1, 1.2, '#8a6a44', FURN, { t: 'counter' });
  add(P, bx + 1, 1.1, bz, 1, 2.2, 5, '#7a4f8a', WEAK, { t: 'shelf' });
  add(P, bx + 4.5, 1.1, bz, 1, 2.2, 5, '#3a8a6a', WEAK, { t: 'shelf' });
  // vending machines + ice box against the store front
  add(P, bx - 8, 1.3, fz - 0.7, 1.3, 2.4, 0.9, '#c23a3a', WEAK, { t: 'furn' });
  add(P, bx - 6.3, 1.3, fz - 0.7, 1.3, 2.4, 0.9, '#3a6ea5', WEAK, { t: 'furn' });
  add(P, bx + 9.2, 0.9, fz - 0.7, 1.6, 1.6, 1, '#e8ecf0', WEAK, { t: 'furn' });   // ice box

  // ---- fuel canopy (the big flat roof over the pumps) ----
  const cx = -8, cz = -2, cw = 30, cd = 18, cy = 5.4;
  for (const [dx, dz] of [[-cw / 2 + 2, -cd / 2 + 2], [cw / 2 - 2, -cd / 2 + 2], [-cw / 2 + 2, cd / 2 - 2], [cw / 2 - 2, cd / 2 - 2]]) {
    add(P, cx + dx, 0.5, cz + dz, 1.8, 1, 1.8, curb, STRONG, { t: 'curb' });      // post footing
    add(P, cx + dx, cy / 2 + 0.5, cz + dz, 0.8, cy, 0.8, post, STRONG, { t: 'col' });
  }
  add(P, cx, cy + 1, cz, cw, 0.8, cd, canopyTop, MED, { t: 'roof' });             // canopy deck (breakable)
  add(P, cx, cy + 0.4, cz - cd / 2, cw, 0.7, 0.35, trim, MED, { t: 'trim' });     // red fascia
  add(P, cx, cy + 0.4, cz + cd / 2, cw, 0.7, 0.35, trim, MED, { t: 'trim' });
  add(P, cx - cw / 2, cy + 0.4, cz, 0.35, 0.7, cd, trim, MED, { t: 'trim' });
  add(P, cx + cw / 2, cy + 0.4, cz, 0.35, 0.7, cd, trim, MED, { t: 'trim' });
  add(P, cx, cy + 2.1, cz - cd / 2 + 1, 8, 1.8, 0.5, signFace, WEAK, { t: 'sign', ns: 1 });   // brand sign on top
  // canopy underside light strips
  for (const lz of [cz - 6, cz, cz + 6]) add(P, cx, cy + 0.55, lz, cw - 1.5, 0.12, 0.5, '#fff6cf', MED, { t: 'deco', ns: 1 });

  // ---- pump islands under the canopy (3) ----
  for (const px of [cx - 9, cx, cx + 9]) {
    add(P, px, 0.45, cz, 4.4, 0.9, 2, curb, STRONG, { t: 'curb' });
    for (const s of [-1, 1]) {
      add(P, px + s * 1.3, 1.7, cz, 1.1, 2, 1.5, pump, FURN, { t: 'pump' });      // pump body (breakable)
      add(P, px + s * 1.3, 3, cz, 1.1, 0.5, 1.5, pumpTop, WEAK, { t: 'pumphat' });
      add(P, px + s * 1.3, 2.2, cz + 0.85, 0.7, 0.9, 0.12, screen, WEAK, { t: 'furn', ns: 1 });
    }
    for (const [ox, oz] of [[-2.4, 0], [2.4, 0], [0, -1.4], [0, 1.4]]) add(P, px + ox, 0.9, cz + oz, 0.45, 1.4, 0.45, pumpTop, WEAK, { t: 'bollard' });
  }

  // ---- roadside price sign ----
  add(P, -30, 3, -28, 0.9, 6, 0.9, signPole, STRONG, { t: 'pole' });
  add(P, -30, 6.6, -28, 5, 3, 0.5, screen, WEAK, { t: 'sign' });
  add(P, -30, 6.6, -27.7, 4.2, 2.4, 0.3, signFace, WEAK, { t: 'sign', ns: 1 });

  // ---- parked cars (breakable) ----
  add(P, 26, 0.9, -16, 4.6, 1.2, 2.2, '#3a6ea5', MED, { t: 'car' });
  add(P, 26, 1.9, -16, 2.4, 0.9, 2, '#bfe0f0', WEAK, { t: 'glass' });
  add(P, -26, 0.9, -18, 2.2, 1.2, 4.6, '#a03a2a', MED, { t: 'car' });
  add(P, -26, 1.9, -18, 2, 0.9, 2.4, '#bfe0f0', WEAK, { t: 'glass' });

  // ---- scattered props (all breakable) ----
  add(P, 4, 0.7, 11, 1, 1.4, 1, prop, WEAK, { t: 'furn' });                       // trash cans
  add(P, -2, 0.7, -20, 1, 1.4, 1, prop, WEAK, { t: 'furn' });
  add(P, -24, 1, 6, 1.2, 2, 1.6, '#3a6ea5', WEAK, { t: 'furn' });                 // air/water box
  add(P, 24, 0.5, -20, 5, 1, 2.4, curb, STRONG, { t: 'curb' });                   // parking bumper strip
  // planters + shrubs on the grass
  for (const [gx, gz] of [[-34, 28], [34, 28], [0, 36], [-34, -12], [30, 24]]) { add(P, gx, 0.5, gz, 3, 0.7, 3, curb, STRONG, { t: 'planter' }); add(P, gx, 1.5, gz, 2.4, 1.4, 2.4, '#4f8a45', WEAK, { t: 'shrub' }); }
  // ---- climb route: cage → crates → store roof → front AC → canopy (flood escape) ----
  add(P, bx + bw / 2 + 2, 0.75, bz - 3, 1.8, 1.5, 1.8, '#8a8f98', WEAK, { t: 'furn' });   // propane cage (step 1)
  add(P, bx + bw / 2 + 2, 1.35, bz + 0.5, 1.6, 2.7, 1.6, '#8a6a44', WOOD, { t: 'crate' });  // crate stack (step 2)
  add(P, bx + bw / 2 + 0.5, 1.95, bz + 3.5, 1.6, 3.9, 1.6, '#7a5a38', WOOD, { t: 'crate' }); // taller stack (step 3 → roof)
  add(P, bx - 9, bh + 0.85, fz + 1.5, 2.2, 1.2, 2, post, WEAK, { t: 'furn' });            // front AC (springboard to canopy)
  return P;
}

// ===================== HAPPY HOME (classic suburban house) =====================
function homeMap() {
  const P = [];
  const brick = '#b5654a', siding = '#e8e2d0', roof = '#7a4a3a', wood = '#8a6a44', win = '#bfe0f0',
        floor = '#c9b98a', grass = '#6faa54', drive = '#9a958a', fence = '#d8d2c4', leaf = '#4f8a45';
  const W = 26, D = 18, FH = 5;
  add(P, 0, -1, 0, 70, 2, 70, grass, INDEST, { t: 'lawn' });
  add(P, -20, 0.06, 8, 10, 0.12, 26, drive, INDEST, { t: 'deco', ns: 1 });        // driveway
  // ---- ground floor ----
  add(P, 0, 0.3, 0, W, 0.6, D, floor, INDEST, { t: 'floor' });
  // brick walls w/ windows + open front/back doors
  const segN = 8, segW = W / segN;
  for (let i = 0; i < segN; i++) {
    const px = -W / 2 + (i + 0.5) * segW;
    const doorF = i === 3, doorB = i === 4;
    if (!doorF) add(P, px, FH * 0.28 + 0.3, D / 2, segW - 0.1, FH * 0.56, 0.5, brick, MED, { t: 'wall' });
    add(P, px, FH * 0.85 + 0.3, D / 2, segW - 0.1, FH * 0.3, 0.5, brick, MED, { t: 'wall' });
    if (i % 2 === 0 && !doorF) add(P, px, FH * 0.56 + 0.3, D / 2, segW - 1, FH * 0.3, 0.2, win, GLASS, { t: 'glass' });
    if (!doorB) add(P, px, FH * 0.28 + 0.3, -D / 2, segW - 0.1, FH * 0.56, 0.5, brick, MED, { t: 'wall' });
    add(P, px, FH * 0.85 + 0.3, -D / 2, segW - 0.1, FH * 0.3, 0.5, brick, MED, { t: 'wall' });
    if (i % 2 === 1 && !doorB) add(P, px, FH * 0.56 + 0.3, -D / 2, segW - 1, FH * 0.3, 0.2, win, GLASS, { t: 'glass' });
  }
  for (const sx of [-W / 2, W / 2]) for (let i = 0; i < 5; i++) { const pz = -D / 2 + (i + 0.5) * (D / 5); add(P, sx, FH / 2 + 0.3, pz, 0.5, FH, D / 5 - 0.1, brick, MED, { t: 'wall' }); }
  // interior: living room / kitchen split + furniture
  add(P, -2, FH / 2 + 0.3, -2, 0.3, FH - 0.6, 9, siding, WEAK, { t: 'wall' });
  add(P, -8, 1, 4, 3, 1, 1.2, '#7a5a8a', FURN, { t: 'sofa' });
  add(P, -9, 0.9, -4, 2, 0.8, 1, wood, FURN, { t: 'table' });
  add(P, 4, 1.1, -6.5, 4, 1.6, 1, siding, WEAK, { t: 'counter' });
  add(P, 8, 1.3, -6.5, 1.4, 2.2, 1, '#d8dde8', WEAK, { t: 'fridge' });
  add(P, 10, 1, 5, 1.8, 1.4, 0.5, '#20242e', FURN, { t: 'tv' });
  switchback(P, 8, 2, 0.3, FH + 0.3, wood);
  // ---- upper floor (bedrooms) ----
  floorWithHole(P, FH + 0.3, W, D, 9.5, 2, 3, 6, floor);
  const uh = FH * 0.8;
  for (let i = 0; i < segN; i++) {
    const px = -W / 2 + (i + 0.5) * segW;
    add(P, px, FH + 0.3 + uh * 0.32, D / 2, segW - 0.1, uh * 0.64, 0.4, siding, WEAK, { t: 'wall' });
    if (i % 2 === 0) add(P, px, FH + 0.3 + uh * 0.55, D / 2, segW - 1, uh * 0.3, 0.18, win, GLASS, { t: 'glass' });
    add(P, px, FH + 0.3 + uh * 0.32, -D / 2, segW - 0.1, uh * 0.64, 0.4, siding, WEAK, { t: 'wall' });
    if (i % 2 === 1) add(P, px, FH + 0.3 + uh * 0.55, -D / 2, segW - 1, uh * 0.3, 0.18, win, GLASS, { t: 'glass' });
  }
  for (const sx of [-W / 2, W / 2]) add(P, sx, FH + 0.3 + uh * 0.32, 0, 0.4, uh * 0.64, D, siding, WEAK, { t: 'wall' });
  add(P, -6, FH + 1.3, 3, 3, 0.9, 1.6, '#9a4a5a', FURN, { t: 'bed' });
  add(P, -10, FH + 1.3, -3, 3, 0.9, 1.6, '#4a6a9a', FURN, { t: 'bed' });
  // ---- gabled roof: stepped breakable slabs ----
  const ry = FH + 0.3 + uh * 0.64;
  for (let i = 0; i < 4; i++) {
    const inset = i * 2.4, h = ry + 0.35 + i * 0.9;
    add(P, 0, h, -(D / 2) + inset / 2 + 0.5, W + 1.2 - i * 0.6, 0.7, 2.6, roof, WEAK, { t: 'roof' });
    add(P, 0, h, (D / 2) - inset / 2 - 0.5, W + 1.2 - i * 0.6, 0.7, 2.6, roof, WEAK, { t: 'roof' });
  }
  add(P, 0, ry + 3.9, 0, W + 0.8, 0.7, 3.4, roof, WEAK, { t: 'roofcap' });
  // ---- porch + yard ----
  add(P, 0, 0.25, D / 2 + 2.2, 10, 0.5, 4, wood, WOOD, { t: 'porch' });
  for (const px of [-4, 4]) add(P, px, 1.8, D / 2 + 3.8, 0.4, 3.2, 0.4, siding, WOOD, { t: 'post' });
  add(P, 0, 3.5, D / 2 + 3, 10.5, 0.4, 4.6, roof, WEAK, { t: 'porchroof' });
  add(P, 18, 2.2, -10, 1.2, 4.4, 1.2, '#6a4a2a', WOOD, { t: 'trunk' });
  add(P, 18, 5.6, -10, 5, 3.4, 5, leaf, WEAK, { t: 'leaves' });
  for (let i = 0; i < 6; i++) add(P, -14 + i * 5.6, 0.8, -16, 2.6, 1.2, 0.25, fence, WOOD, { t: 'fence' });
  add(P, -16, 0.9, 16, 0.3, 1.4, 0.3, wood, WOOD, { t: 'mailpost' });
  add(P, -16, 1.7, 16, 0.8, 0.5, 0.5, '#3a6ea5', WEAK, { t: 'mailbox' });
  return P;
}

// ===================== TRAILER PARK (everything is barely bolted down) =====================
function trailerMap() {
  const P = [];
  const grass = '#7aa35a', gravel = '#9a958a', cinder = '#8f8a7e', steel = '#8a8f98',
        win = '#bfe0f0', wood = '#8a6a44', tank = '#d8dde8';
  add(P, 0, -1, 0, 75, 2, 75, grass, INDEST, { t: 'ground' });
  add(P, 0, 0.06, 0, 8, 0.12, 66, gravel, INDEST, { t: 'deco', ns: 1 });          // gravel lane
  // ---- five trailers, each a fragile home on cinder blocks ----
  const TR = [[-18, -18, '#c2d6e8', 0], [16, -20, '#e8d6c2', 0], [-20, 8, '#d6e8c2', 1], [18, 6, '#e8c2c8', 1], [-2, 22, '#e0e0d0', 0]];
  for (const [tx, tz, col, rot] of TR) {
    const w = rot ? 4.4 : 11, d = rot ? 11 : 4.4;
    for (const [ox, oz] of [[-w / 2 + 0.8, -d / 2 + 0.6], [w / 2 - 0.8, -d / 2 + 0.6], [-w / 2 + 0.8, d / 2 - 0.6], [w / 2 - 0.8, d / 2 - 0.6]])
      add(P, tx + ox, 0.35, tz + oz, 0.7, 0.7, 0.7, cinder, STRONG, { t: 'block' });
    add(P, tx, 0.85, tz, w, 0.3, d, steel, MED, { t: 'tfloor' });
    add(P, tx, 2.3, tz, w, 2.6, d, col, WEAK, { t: 'tbody' });                    // body — one good hit folds it
    add(P, tx, 3.8, tz, w + 0.5, 0.4, d + 0.5, '#b8b0a2', WEAK, { t: 'troof' });
    const wn = rot ? 3 : 4;
    for (let i = 0; i < wn; i++) {
      const off = -((rot ? d : w) / 2) + (i + 0.75) * ((rot ? d : w) / wn);
      if (rot) { add(P, tx + w / 2 + 0.01, 2.4, tz + off, 0.1, 1.1, 1.6, win, GLASS, { t: 'glass' }); }
      else { add(P, tx + off, 2.4, tz + d / 2 + 0.01, 1.6, 1.1, 0.1, win, GLASS, { t: 'glass' }); }
    }
    add(P, tx + (rot ? -w / 2 - 0.6 : w / 2 - 1.4), 0.45, tz + (rot ? 0 : d / 2 + 0.9), 1.6, 0.3, 1.6, wood, WOOD, { t: 'step' });
  }
  // ---- office shack + water tower (the flood refuge) ----
  add(P, 2, 0.25, -6, 7, 0.5, 6, wood, INDEST, { t: 'floor' });
  add(P, 2, 1.9, -8.8, 7, 3.2, 0.4, wood, MED, { t: 'wall' });
  add(P, -1.4, 1.9, -6, 0.4, 3.2, 6, wood, MED, { t: 'wall' });
  add(P, 5.4, 1.9, -6, 0.4, 3.2, 6, wood, MED, { t: 'wall' });
  add(P, 2, 3.6, -6, 8, 0.5, 7, '#6a5a48', MED, { t: 'shackroof' });
  add(P, 6.5, 0.75, -2.4, 1.6, 1.5, 1.6, wood, WOOD, { t: 'crate' });             // step 1 (1.5)
  add(P, 6.9, 1.35, -5.2, 1.6, 2.7, 1.6, '#7a5a38', WOOD, { t: 'crate' });        // step 2 (2.7) -> shack roof 3.85
  const wt = { x: -6, z: -24 };
  for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]])
    add(P, wt.x + ox, 3.4, wt.z + oz, 0.5, 6.8, 0.5, steel, STRONG, { t: 'leg' });
  add(P, wt.x, 7, wt.z, 5.4, 0.5, 5.4, steel, STRONG, { t: 'platform' });         // refuge platform (7.25)
  add(P, wt.x, 9, wt.z, 4, 3.6, 4, tank, MED, { t: 'tank' });
  add(P, wt.x + 3.4, 0.75, wt.z + 3.2, 1.6, 1.5, 1.6, wood, WOOD, { t: 'crate' });
  add(P, wt.x + 3.6, 1.35, wt.z + 0.6, 1.6, 2.7, 1.6, '#7a5a38', WOOD, { t: 'crate' });
  add(P, wt.x + 3.5, 1.95, wt.z - 2.2, 1.6, 3.9, 1.6, wood, WOOD, { t: 'crate' });   // 3.9
  add(P, wt.x + 1.8, 2.65, wt.z - 3.4, 1.6, 5.3, 1.6, '#7a5a38', WOOD, { t: 'crate' }); // 5.3
  add(P, wt.x - 0.4, 3.35, wt.z - 3.7, 1.6, 6.7, 1.6, wood, WOOD, { t: 'crate' });       // 6.7 -> platform 7.25
  // ---- props: propane, picnic, tires, mailboxes ----
  add(P, 10, 1, 12, 1.4, 2, 1.4, tank, WEAK, { t: 'propane' });
  add(P, -12, 1, -6, 1.4, 2, 1.4, tank, WEAK, { t: 'propane' });
  for (const [px2, pz2] of [[-8, 16], [12, -8]]) { add(P, px2, 0.7, pz2, 2.6, 0.5, 1, wood, WOOD, { t: 'picnic' }); add(P, px2, 1.1, pz2, 1.8, 0.3, 2.4, wood, WOOD, { t: 'picnic' }); }
  for (let i = 0; i < 5; i++) add(P, -26 + i * 1.4, 0.45, 26, 1.1, 0.9, 1.1, '#20242e', WEAK, { t: 'tire' });
  for (let i = 0; i < 5; i++) add(P, 5.6, 0.9, 14 + i * 1.5, 0.5, 0.6, 0.6, steel, WEAK, { t: 'mailbox' });
  return P;
}

// ===================== SURF CENTRAL (beach + boardwalk + lifeguard tower) =====================
function surfMap() {
  const P = [];
  const sand = '#e8d8a8', wood = '#b08a5a', woodD = '#8a6a44', shack = '#5ab0c8', roof = '#e05a4a',
        win = '#bfe0f0', palm = '#6a4a2a', leaf = '#4f9a45', tower = '#e8e2d0';
  add(P, 0, -1, 0, 70, 2, 70, sand, INDEST, { t: 'beach' });
  // ---- surf shack ----
  const bx = -8, bz = 10, bw = 14, bd = 8, bh = 4;
  add(P, bx, 0.25, bz, bw, 0.5, bd, woodD, INDEST, { t: 'floor' });
  add(P, bx, bh / 2, bz + bd / 2, bw, bh, 0.4, shack, MED, { t: 'wall' });
  add(P, bx - bw / 2, bh / 2, bz, 0.4, bh, bd, shack, MED, { t: 'wall' });
  add(P, bx + bw / 2, bh / 2, bz, 0.4, bh, bd, shack, MED, { t: 'wall' });
  add(P, bx - 4.5, bh / 2, bz - bd / 2, 5, bh, 0.4, shack, MED, { t: 'wall' });   // front, door gap mid
  add(P, bx + 4.5, bh / 2, bz - bd / 2, 5, bh, 0.4, shack, MED, { t: 'wall' });
  add(P, bx - 1, 2.6, bz - bd / 2, 2, 1.6, 0.15, win, GLASS, { t: 'glass' });
  add(P, bx, bh + 0.3, bz, bw + 1.6, 0.6, bd + 1.6, roof, WEAK, { t: 'roof' });   // roof 4.6
  add(P, bx, 1, bz + 1.5, 5, 1.1, 1, woodD, FURN, { t: 'counter' });
  for (let i = 0; i < 4; i++) add(P, bx - bw / 2 - 1.2, 1.5, bz - 3 + i * 2, 0.3, 3, 0.5, ['#e05a4a', '#5a8ae0', '#e0c85a', '#7ae05a'][i], WEAK, { t: 'board' });   // surfboard rack
  add(P, bx + 5, 0.75, bz - 6.5, 1.6, 1.5, 1.6, woodD, WOOD, { t: 'crate' });     // 1.5
  add(P, bx + 6.8, 1.6, bz - 4.5, 1.6, 3.2, 1.6, wood, WOOD, { t: 'crate' });    // 3.2 -> roof 4.6
  // ---- boardwalk on stilts along the west edge ----
  for (let i = 0; i < 8; i++) {
    const pz = -28 + i * 8;
    add(P, -28, 1.9, pz, 8, 0.4, 8.0, wood, WOOD, { t: 'plank' });                // walkable 2.1, no cracks
    add(P, -31, 0.95, pz, 0.5, 1.9, 0.5, woodD, STRONG, { t: 'stilt' });
    add(P, -25, 0.95, pz, 0.5, 1.9, 0.5, woodD, STRONG, { t: 'stilt' });
    if (i % 2 === 0) add(P, -31.6, 2.8, pz, 0.25, 1.4, 7.6, woodD, WEAK, { t: 'rail' });
  }
  for (let i = 0; i < 4; i++) { const top = 2.1 * (i + 1) / 4; add(P, -22.4 + i * 0, 0 + top / 2, 27.5 - i * 1.1, 3, top, 1.15, wood, INDEST, { t: 'stair' }); }
  // ---- lifeguard tower (the classic flood refuge) ----
  const lt = { x: 16, z: -12 };
  for (const [ox, oz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]])
    add(P, lt.x + ox, 2.6, lt.z + oz, 0.45, 5.2, 0.45, tower, STRONG, { t: 'leg' });
  add(P, lt.x, 5.4, lt.z, 5.6, 0.5, 5.6, wood, STRONG, { t: 'deck' });            // deck 5.65
  add(P, lt.x, 6.6, lt.z + 2.6, 5.6, 2, 0.3, tower, MED, { t: 'wall' });
  add(P, lt.x - 2.6, 6.6, lt.z, 0.3, 2, 5.6, tower, MED, { t: 'wall' });
  add(P, lt.x + 2.6, 6.6, lt.z, 0.3, 2, 5.6, tower, MED, { t: 'wall' });
  add(P, lt.x, 8, lt.z, 6.4, 0.5, 6.4, roof, WEAK, { t: 'towerroof' });
  switchback(P, lt.x, lt.z - 5.5, 0, 5.65, wood);
  // ---- palms, umbrellas, volleyball ----
  for (const [px2, pz2] of [[6, 20], [26, 8], [-20, -8], [4, -24]]) {
    add(P, px2, 2.4, pz2, 1, 4.8, 1, palm, WOOD, { t: 'trunk' });
    add(P, px2, 5.4, pz2, 4.4, 1.6, 4.4, leaf, WEAK, { t: 'fronds' });
  }
  for (const [px2, pz2, c] of [[-2, -12, '#e05a4a'], [8, -4, '#5a8ae0'], [-14, -18, '#e0c85a']]) {
    add(P, px2, 1.1, pz2, 0.25, 2.2, 0.25, tower, WOOD, { t: 'pole' });
    add(P, px2, 2.4, pz2, 3, 0.4, 3, c, WEAK, { t: 'umbrella' });
  }
  add(P, 24, 1.4, 22, 0.3, 2.8, 0.3, tower, WOOD, { t: 'vpost' });
  add(P, 30, 1.4, 22, 0.3, 2.8, 0.3, tower, WOOD, { t: 'vpost' });
  add(P, 27, 2.2, 22, 6, 0.9, 0.12, '#f4f7fc', WEAK, { t: 'net', ns: 1 });
  return P;
}

// ===================== SUNNY RANCH (barn, silo, farmhouse) =====================
function ranchMap() {
  const P = [];
  const grass = '#7aae54', barnR = '#b5372a', barnT = '#e8e2d0', roof = '#6a4a3a', wood = '#8a6a44',
        hay = '#d8b84a', silo = '#c8ccd4', fence = '#c9b98a', win = '#bfe0f0';
  add(P, 0, -1, 0, 75, 2, 75, grass, INDEST, { t: 'field' });
  add(P, 18, 0.05, 0, 10, 0.1, 60, '#a89a7a', INDEST, { t: 'deco', ns: 1 });      // dirt track
  // ---- the big red barn ----
  const bx = -10, bz = 0, bw = 16, bd = 12, wh = 5;
  add(P, bx, 0.25, bz, bw, 0.5, bd, wood, INDEST, { t: 'floor' });
  add(P, bx, wh / 2, bz + bd / 2, bw, wh, 0.5, barnR, MED, { t: 'wall' });        // back
  add(P, bx - bw / 2, wh / 2, bz, 0.5, wh, bd, barnR, MED, { t: 'wall' });
  add(P, bx + bw / 2, wh / 2, bz, 0.5, wh, bd, barnR, MED, { t: 'wall' });
  add(P, bx - 5.5, wh / 2, bz - bd / 2, 5, wh, 0.5, barnR, MED, { t: 'wall' });   // front — big open door mid
  add(P, bx + 5.5, wh / 2, bz - bd / 2, 5, wh, 0.5, barnR, MED, { t: 'wall' });
  add(P, bx, wh + 0.9, bz - bd / 2, bw, 1.8, 0.5, barnT, MED, { t: 'gable' });
  add(P, bx, wh + 0.9, bz + bd / 2, bw, 1.8, 0.5, barnT, MED, { t: 'gable' });
  // hayloft (half-depth upper floor) + crate ladder
  add(P, bx, 3.9, bz + 3, bw - 1, 0.4, bd / 2 - 1, wood, WOOD, { t: 'loft' });    // loft 4.1
  add(P, bx - 6.4, 0.75, bz - 2.5, 1.6, 1.5, 1.6, hay, WOOD, { t: 'hay' });
  add(P, bx - 6.5, 1.35, bz + 0.4, 1.6, 2.7, 1.6, hay, WOOD, { t: 'hay' });
  add(P, bx - 6.4, 1.95, bz + 3.2, 1.6, 3.9, 1.6, hay, WOOD, { t: 'hay' });       // -> loft
  // gambrel-ish roof: stepped WEAK slabs, ridge = flood refuge
  for (let i = 0; i < 3; i++) {
    const inset = i * 2.6, h = wh + 1.6 + i * 1.15;
    add(P, bx - (bw / 2) + inset / 2 + 0.6, h, bz, 3, 0.6, bd + 1, roof, WEAK, { t: 'roof' });
    add(P, bx + (bw / 2) - inset / 2 - 0.6, h, bz, 3, 0.6, bd + 1, roof, WEAK, { t: 'roof' });
  }
  add(P, bx, wh + 4.6, bz, 4.4, 0.6, bd + 1, roof, WEAK, { t: 'ridge' });         // 9.9? wh5+4.6=9.6 top 9.9
  // loft -> roof crate
  add(P, bx + 6.6, 2.7, bz + 4, 1.5, 5.4, 1.5, hay, WOOD, { t: 'hay' });          // 5.4 from loft reach roof lower 7.0? loft 4.1 -> 5.4 crate ✓ -> roof slab 6.9
  // ---- silo ----
  add(P, 4, 5, -14, 3.4, 10, 3.4, silo, STRONG, { t: 'silo' });
  add(P, 4, 10.6, -14, 2.6, 1.2, 2.6, '#9aa2ae', MED, { t: 'silocap' });
  // ---- farmhouse ----
  const fx = 10, fz = 14, fw = 12, fd = 9, fh = 4.4;
  add(P, fx, 0.25, fz, fw, 0.5, fd, wood, INDEST, { t: 'floor' });
  add(P, fx, fh / 2, fz + fd / 2, fw, fh, 0.4, barnT, MED, { t: 'wall' });
  add(P, fx - fw / 2, fh / 2, fz, 0.4, fh, fd, barnT, MED, { t: 'wall' });
  add(P, fx + fw / 2, fh / 2, fz, 0.4, fh, fd, barnT, MED, { t: 'wall' });
  add(P, fx - 3.5, fh / 2, fz - fd / 2, 5, fh, 0.4, barnT, MED, { t: 'wall' });
  add(P, fx + 4.5, fh / 2, fz - fd / 2, 3, fh, 0.4, barnT, MED, { t: 'wall' });
  add(P, fx - 2, 2.5, fz - fd / 2, 1.8, 1.2, 0.15, win, GLASS, { t: 'glass' });
  add(P, fx, fh + 0.6, fz, fw + 1, 1.2, fd + 1, roof, WEAK, { t: 'roof' });
  add(P, fx - 2, 1, fz + 1, 2.4, 0.9, 1.2, wood, FURN, { t: 'table' });
  // ---- windmill (deco blades) + fences + trough + tractor ----
  for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) add(P, 22 + ox, 3, -20 + oz, 0.4, 6, 0.4, wood, WOOD, { t: 'leg' });
  add(P, 22, 6.4, -20, 2, 1.6, 2, wood, MED, { t: 'millhead' });
  add(P, 22, 6.4, -18.8, 0.3, 7, 1, barnT, WEAK, { t: 'blade', ns: 1 });
  add(P, 22, 6.4, -18.8, 7, 0.3, 1, barnT, WEAK, { t: 'blade', ns: 1 });
  for (let i = 0; i < 8; i++) add(P, -24 + i * 6.5, 0.8, 22, 3, 1.2, 0.25, fence, WOOD, { t: 'fence' });
  for (let i = 0; i < 6; i++) add(P, -28, 0.8, -18 + i * 6.5, 0.25, 1.2, 3, fence, WOOD, { t: 'fence' });
  add(P, -2, 0.6, 20, 3, 0.9, 1.2, '#8a8f98', WEAK, { t: 'trough' });
  add(P, 14, 1.1, -6, 3.6, 1.8, 2.2, '#3a7a3a', MED, { t: 'tractor' });
  add(P, 12.4, 1.5, -6, 1.2, 2.6, 2.2, '#2a5a2a', WEAK, { t: 'cab' });
  for (const [hx2, hz2] of [[-20, -12], [-16, -15], [24, 12]]) add(P, hx2, 0.8, hz2, 1.7, 1.6, 1.7, hay, WOOD, { t: 'hay' });
  return P;
}

// ===================== FAMILY MALL (two floors of shopping) =====================
function mallMap() {
  const P = [];
  const lot = '#9a958a', wall2 = '#d8d2c8', glass = '#a9d6ef', floor = '#e0dcd2', store1 = '#e05a4a',
        store2 = '#5a8ae0', store3 = '#5ab06a', store4 = '#c85ac0', kiosk = '#e0c85a', plant = '#4f8a45';
  const W = 44, D = 28, FH = 5.5;
  add(P, 0, -1, 0, 84, 2, 60, lot, INDEST, { t: 'lot' });
  for (let i = 0; i < 5; i++) add(P, -30 + i * 4, 0.05, 22, 3, 0.1, 6, '#8a857a', INDEST, { t: 'deco', ns: 1 });   // parking stripes
  add(P, -22, 0.9, 20, 4.4, 1.2, 2.2, '#b5372a', MED, { t: 'car' });
  add(P, -14, 0.9, 20, 4.4, 1.2, 2.2, '#3a6aa0', MED, { t: 'car' });
  add(P, 12, 0.75, 20, 1.4, 1.5, 3, '#8a8f98', WEAK, { t: 'carts' });
  // ---- ground floor ----
  add(P, 0, 0.3, 0, W, 0.6, D, floor, INDEST, { t: 'floor' });
  // perimeter: back/side walls solid, front = glass entrance
  add(P, 0, FH / 2 + 0.3, -D / 2, W, FH, 0.5, wall2, STRONG, { t: 'wall' });
  add(P, -W / 2, FH / 2 + 0.3, 0, 0.5, FH, D, wall2, STRONG, { t: 'wall' });
  add(P, W / 2, FH / 2 + 0.3, 0, 0.5, FH, D, wall2, STRONG, { t: 'wall' });
  for (let i = 0; i < 10; i++) { const px = -W / 2 + (i + 0.5) * (W / 10); const door = i === 4 || i === 5; if (!door) add(P, px, FH / 2 + 0.3, D / 2, W / 10 - 0.15, FH - 0.8, 0.25, glass, GLASS, { t: 'glass' }); }
  add(P, 0, FH + 0.1, D / 2, W, 0.9, 0.4, store1, MED, { t: 'fascia', ns: 1 });
  // storefronts along the back (both floors get them)
  for (const f of [0, 1]) {
    const y = 0.3 + f * FH;
    const shops = [[-16, store1, 'wall'], [-5.5, store2, 'wall'], [5.5, store3, 'wall'], [16, store4, 'wall']];
    for (const [sx2, col] of shops) {
      add(P, sx2, y + 2.1, -D / 2 + 4.5, 8.5, 3.6, 0.3, col, WEAK, { t: 'shopfront' });   // colored fronts (breakable)
      add(P, sx2, y + 1.2, -D / 2 + 2.2, 3, 1.6, 1.6, kiosk, FURN, { t: 'shopgoods' });
    }
    // kiosks + planters down the middle
    add(P, -8, y + 1, 6, 2.2, 1.5, 2.2, kiosk, FURN, { t: 'kiosk' });
    add(P, 8, y + 1, 6, 2.2, 1.5, 2.2, kiosk, FURN, { t: 'kiosk' });
    for (const px2 of [-14, 0, 14]) { add(P, px2, y + 0.6, 9, 1.4, 0.9, 1.4, '#8f8a7e', STRONG, { t: 'planter' }); add(P, px2, y + 1.5, 9, 1.1, 1.1, 1.1, plant, WEAK, { t: 'shrub' }); }
  }
  // food court tables (ground, west end)
  for (const [tx2, tz2] of [[-17, 6], [-13, 9], [-17, 11], [-11, 5]]) add(P, tx2, 1, tz2, 1.6, 0.9, 1.6, wall2, FURN, { t: 'table' });
  // ---- upper floor: ring around an open atrium ----
  floorWithHole(P, FH + 0.3, W, D, 0, 3, 16, 10, floor);   // big atrium hole (center-front)
  // atrium railing
  for (const rx of [-8.6, 8.6]) add(P, rx, FH + 1.1, 3, 0.2, 1, 10.4, '#6a7280', WEAK, { t: 'rail' });
  add(P, 0, FH + 1.1, -2.2, 17.4, 1, 0.2, '#6a7280', WEAK, { t: 'rail' });
  add(P, 0, FH + 1.1, 8.2, 17.4, 1, 0.2, '#6a7280', WEAK, { t: 'rail' });
  // upper perimeter glass
  for (let i = 0; i < 10; i++) { const px = -W / 2 + (i + 0.5) * (W / 10); add(P, px, FH + 0.3 + (FH - 0.8) / 2, D / 2, W / 10 - 0.15, FH - 0.8, 0.2, glass, GLASS, { t: 'glass' }); }
  add(P, 0, FH + 0.3 + FH / 2, -D / 2, W, FH, 0.4, wall2, STRONG, { t: 'wall' });
  add(P, -W / 2, FH + 0.3 + FH / 2, 0, 0.4, FH, D, wall2, STRONG, { t: 'wall' });
  add(P, W / 2, FH + 0.3 + FH / 2, 0, 0.4, FH, D, wall2, STRONG, { t: 'wall' });
  // two switchback stairs (east + west)
  switchback(P, -19, 8, 0.3, FH + 0.3, floor);
  switchback(P, 19, 8, 0.3, FH + 0.3, floor);
  // roof (breakable — it should peel in a tornado) + skylight
  const ry = 2 * FH + 0.6;
  add(P, 0, ry + 0.3, 0, W + 1, 0.6, D + 1, '#b8b2a6', MED, { t: 'roof' });
  add(P, 0, ry + 0.75, 3, 14, 0.3, 8, glass, GLASS, { t: 'skylight' });
  return P;
}

// ===================== PRISON (cell block + yard + towers) =====================
function prisonMap() {
  const P = [];
  const conc = '#9aa0a8', dark = '#5a616b', bar = '#3a4048', fenceC = '#b8bec8', yard = '#8f9a84',
        orange = '#e08a3a', tower = '#c8ccd4', wood = '#8a6a44';
  add(P, 0, -1, 0, 75, 2, 75, yard, INDEST, { t: 'yard' });
  add(P, 12, 0.05, 8, 18, 0.1, 12, '#7a8570', INDEST, { t: 'deco', ns: 1 });      // basketball court
  // ---- cell block ----
  const W = 30, D = 16, FH = 5.2, bx = -8, bz = -8;
  add(P, bx, 0.3, bz, W, 0.6, D, conc, INDEST, { t: 'floor' });
  add(P, bx, FH / 2 + 0.3, bz - D / 2, W, FH, 0.6, conc, STRONG, { t: 'wall' });
  add(P, bx - W / 2, FH / 2 + 0.3, bz, 0.6, FH, D, conc, STRONG, { t: 'wall' });
  add(P, bx + W / 2, FH / 2 + 0.3, bz, 0.6, FH, D, conc, STRONG, { t: 'wall' });
  add(P, bx - 9, FH / 2 + 0.3, bz + D / 2, 11, FH, 0.6, conc, STRONG, { t: 'wall' });   // front — gate gap mid
  add(P, bx + 9, FH / 2 + 0.3, bz + D / 2, 11, FH, 0.6, conc, STRONG, { t: 'wall' });
  // cells along the back: barred fronts + bunks
  for (let i = 0; i < 5; i++) {
    const cx2 = bx - W / 2 + 3.2 + i * 5.6;
    add(P, cx2 + 2.6, 2.2 + 0.3, bz - 2, 0.25, 3.8, 5, dark, MED, { t: 'cellwall' });
    for (let j = 0; j < 4; j++) add(P, cx2 - 1.8 + j * 1.2, 2.2 + 0.3, bz - 0.5, 0.18, 3.8, 0.18, bar, WEAK, { t: 'bars' });
    add(P, cx2, 1, bz - 5.5, 2.2, 0.7, 1.1, orange, FURN, { t: 'bunk' });
  }
  add(P, bx, FH + 0.9, bz, W + 1, 0.7, D + 1, dark, MED, { t: 'roof' });          // roof 6.25 = refuge
  switchback(P, bx + 11, bz + 3, 0.3, FH + 0.6 + 0.3, conc);                       // stairs to roof... exits at 6.1 onto roof
  // ---- perimeter fence + gate ----
  const FR = 30;
  for (let i = 0; i < 14; i++) { const px2 = -FR + i * (FR * 2 / 14); if (Math.abs(px2 - 8) > 3) add(P, px2 + FR / 14, 1.5, FR, FR * 2 / 14 - 0.3, 3, 0.15, fenceC, WEAK, { t: 'fence', ns: 0 }); }
  for (let i = 0; i < 14; i++) { const pz2 = -FR + i * (FR * 2 / 14); add(P, FR, 1.5, pz2 + FR / 14, 0.15, 3, FR * 2 / 14 - 0.3, fenceC, WEAK, { t: 'fence' }); add(P, -FR, 1.5, pz2 + FR / 14, 0.15, 3, FR * 2 / 14 - 0.3, fenceC, WEAK, { t: 'fence' }); }
  for (let i = 0; i < 14; i++) { const px2 = -FR + i * (FR * 2 / 14); add(P, px2 + FR / 14, 1.5, -FR, FR * 2 / 14 - 0.3, 3, 0.15, fenceC, WEAK, { t: 'fence' }); }
  // ---- watchtowers (climbable refuges) ----
  for (const [tx2, tz2] of [[24, 24], [-24, -24]]) {
    for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) add(P, tx2 + ox, 2.9, tz2 + oz, 0.4, 5.8, 0.4, tower, STRONG, { t: 'leg' });
    add(P, tx2, 6, tz2, 4.6, 0.5, 4.6, tower, STRONG, { t: 'deck' });             // 6.25
    add(P, tx2, 7.3, tz2, 4.6, 0.4, 4.6, dark, WEAK, { t: 'towerroof' });
    add(P, tx2 - 3.4, 0.75, tz2 + 2.6, 1.5, 1.5, 1.5, wood, WOOD, { t: 'crate' });
    add(P, tx2 - 3.5, 1.35, tz2 + 0.2, 1.5, 2.7, 1.5, wood, WOOD, { t: 'crate' });
    add(P, tx2 - 3.4, 1.95, tz2 - 2.2, 1.5, 3.9, 1.5, wood, WOOD, { t: 'crate' });
    add(P, tx2 - 1.6, 2.65, tz2 - 3.3, 1.5, 5.3, 1.5, wood, WOOD, { t: 'crate' }); // 5.3 -> deck 6.25
  }
  // yard props: hoop, benches, weights
  add(P, 12, 2.2, 2.6, 0.3, 4.4, 0.3, tower, WOOD, { t: 'pole' });
  add(P, 12, 4.2, 3.3, 1.8, 1.4, 0.15, '#f4f7fc', WEAK, { t: 'backboard' });
  for (const [bx2, bz2] of [[6, 16], [18, 16]]) add(P, bx2, 0.6, bz2, 2.6, 0.5, 1, wood, WOOD, { t: 'bench' });
  add(P, -20, 0.6, 14, 2, 0.6, 1.4, dark, WEAK, { t: 'weights' });
  return P;
}

export const MAPS = {
  glass:   { id: 'glass',   name: 'Glass Office',    spawnR: 14, radius: 34, spawn: { x: 0, z: 22, r: 5 },   sky: ['#7db9ec', '#dcecf8'], water: '#2f7fd0', fog: '#bcd6ee', ground: 80, pieces: officeMap() },
  school:  { id: 'school',  name: 'Heights School',  spawnR: 18, radius: 40, spawn: { x: 0, z: 23, r: 5 },   sky: ['#8fc0e8', '#e0eef8'], water: '#3a86c0', fog: '#c8dcc0', ground: 92, pieces: schoolMap() },
  station: { id: 'station', name: 'Furious Station', spawnR: 18, radius: 38, spawn: { x: -8, z: -18, r: 6 }, sky: ['#7db9ec', '#dcecf8'], water: '#2f7fd0', fog: '#c6ddc4', ground: 90, pieces: stationMap() },
  home:    { id: 'home',    name: 'Happy Home',      spawnR: 16, radius: 32, spawn: { x: 0, z: 16, r: 5 },   sky: ['#8fd0ec', '#eaf4f8'], water: '#2f7fd0', fog: '#cfe4c8', ground: 70, pieces: homeMap() },
  trailer: { id: 'trailer', name: 'Trailer Park',    spawnR: 18, radius: 34, spawn: { x: 0, z: 0, r: 6 },    sky: ['#9ac4e0', '#e8f0f4'], water: '#3a86c0', fog: '#c8d4c0', ground: 75, pieces: trailerMap() },
  surf:    { id: 'surf',    name: 'Surf Central',    spawnR: 16, radius: 32, spawn: { x: 4, z: 2, r: 6 },    sky: ['#6ec4ec', '#f0f8fc'], water: '#28a0c8', fog: '#d8e8ec', ground: 70, pieces: surfMap() },
  ranch:   { id: 'ranch',   name: 'Sunny Ranch',     spawnR: 18, radius: 34, spawn: { x: 4, z: 8, r: 6 },    sky: ['#8fd0ec', '#f4f0d8'], water: '#3a86c0', fog: '#d4e0c0', ground: 75, pieces: ranchMap() },
  mall:    { id: 'mall',    name: 'Family Mall',     spawnR: 18, radius: 38, spawn: { x: 0, z: 19, r: 6 },   sky: ['#9ac4e0', '#eef2f6'], water: '#2f7fd0', fog: '#ccd4dc', ground: 84, pieces: mallMap() },
  prison:  { id: 'prison',  name: 'Prison',          spawnR: 18, radius: 34, spawn: { x: 8, z: 12, r: 6 },   sky: ['#8a9ab0', '#dce4ec'], water: '#3a4450', fog: '#b8c0c8', ground: 75, pieces: prisonMap() },
};
export const MAP_IDS = Object.keys(MAPS);
