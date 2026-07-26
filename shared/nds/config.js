// Natural Disaster Survival — shared tuning (client render + server logic agree).
// Original implementation inspired by the classic; all geometry is our own.
// Maps are built from PIECES: {x,y,z,w,h,d,c,s} where s = strength/HP
// (0 = indestructible; lower = weaker). Disasters damage pieces in range and
// weak ones break off & fall — the map falls apart around you.

export const WORLD = { waterY: -1.4 };

export const ROUND = {
  intermission: 14, warning: 6, disaster: 27, aftermath: 6,
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
function stairs(P, x, z0, fromY, toY, w, dep, col) {
  const n = 12, rise = (toY - fromY) / n, run = dep / n;
  for (let i = 0; i < n; i++) { const top = fromY + rise * (i + 1), h = top - fromY; P.push({ x, y: fromY + h / 2, z: z0 - dep / 2 + run * (i + 0.5), w, h, d: run + 0.06, c: col, s: INDEST, t: 'stair' }); }
}
const add = (P, x, y, z, w, h, d, c, s, o) => P.push(Object.assign({ x, y, z, w, h, d, c, s }, o || {}));

// ===================== GLASS OFFICE =====================
function officeMap() {
  const P = [];
  const slab = '#c2c7cf', steel = '#7f8894', glass = '#a9d6ef', core = '#39414c', desk = '#8a6a44', rail = '#6a7280', accent = '#3a6ea5';
  const FL = 3, FH = 6, W = 34, D = 24, HX = 11, HZ = -7, HW = 6, HD = 6;
  add(P, 0, -1, 0, W + 26, 2, D + 26, '#aeb4be', INDEST, { t: 'plaza' });   // plaza (ground)
  add(P, 0, 0.4, D / 2 + 8, 12, 0.8, 3, '#4f7a4f', INDEST, { t: 'planter' });
  add(P, 0, 0.4, -D / 2 - 8, 12, 0.8, 3, '#4f7a4f', INDEST, { t: 'planter' });
  for (let f = 0; f <= FL; f++) {
    const y = f * FH;
    if (f === 0) add(P, 0, y, 0, W, 0.6, D, slab, INDEST, { t: 'floor' });
    else floorWithHole(P, y, W, D, HX, HZ, HW, HD, slab);
    if (f < FL) {
      for (const cx of [-W / 2 + 1.5, -W / 6, W / 6, W / 2 - 1.5]) for (const cz of [-D / 2 + 1.5, 0, D / 2 - 1.5]) add(P, cx, y + FH / 2, cz, 0.7, FH, 0.7, steel, INDEST, { t: 'col' });
      const nx = 11, nz = 8, ph = FH - 1.2;
      for (let i = 0; i < nx; i++) { const px = -W / 2 + (i + 0.5) * (W / nx); add(P, px, y + FH / 2, -D / 2, W / nx - 0.18, ph, 0.18, glass, GLASS, { t: 'glass' }); add(P, px, y + FH / 2, D / 2, W / nx - 0.18, ph, 0.18, glass, GLASS, { t: 'glass' }); }
      for (let i = 0; i < nz; i++) { const pz = -D / 2 + (i + 0.5) * (D / nz); add(P, -W / 2, y + FH / 2, pz, 0.18, ph, D / nz - 0.18, glass, GLASS, { t: 'glass' }); add(P, W / 2, y + FH / 2, pz, 0.18, ph, D / nz - 0.18, glass, GLASS, { t: 'glass' }); }
      add(P, HX, y + FH / 2, HZ - HD / 2 - 0.3, HW + 1, FH, 0.4, core, STRONG, { t: 'wall' });   // stairwell wall
      add(P, HX + HW / 2 + 0.3, y + FH / 2, HZ, 0.4, FH, HD + 1, core, STRONG, { t: 'wall' });
      add(P, -6, y + FH / 2, 4, 0.25, FH - 1.2, 11, slab, MED, { t: 'wall' });
      add(P, -12, y + FH / 2, -3, 9, FH - 1.2, 0.25, slab, MED, { t: 'wall' });
      for (const [dx, dz] of [[-14, -7], [-14, -2], [-2, 8], [5, 9], [-9, -9]]) add(P, dx, y + 1.1, dz, 2.2, 1, 1.1, desk, FURN, { t: 'furn' });
      add(P, 0, y + 1, D / 2 - 0.35, W - 3, 1, 0.16, rail, WEAK, { t: 'rail' });
      add(P, 0, y + 1, -D / 2 + 0.35, W - 3, 1, 0.16, rail, WEAK, { t: 'rail' });
      stairs(P, HX, HZ, y, y + FH, HW - 0.8, HD, steel);
    }
  }
  const ry = FL * FH;
  add(P, -8, ry + 1.6, -6, 5, 3, 4, steel, STRONG, { t: 'ac' });
  add(P, 7, ry + 1.1, 8, 4, 2, 4, steel, STRONG, { t: 'ac' });
  add(P, 0, ry + 1.7, 0, 12, 0.3, 12, accent, INDEST, { t: 'helipad', ns: 1 });
  return P;
}

// ===================== HEIGHTS SCHOOL =====================
function schoolMap() {
  const P = [];
  const brick = '#b5654a', brick2 = '#9a5238', slab = '#d8d2c4', win = '#bfe0f0', roof = '#5a4030', door = '#6a4a2a', locker = '#3a6a8a', floor = '#c9c2b0', gym = '#caa86a';
  const FL = 2, FH = 5.5, W = 46, D = 26;
  add(P, 0, -1, 0, W + 24, 2, D + 24, '#8faa6a', INDEST, { t: 'lawn' });   // grass lawn (ground)
  add(P, 0, 0.3, D / 2 + 9, 10, 0.6, 4, '#7f9a5a', INDEST, { t: 'field' });
  const HX = -17, HZ = 8, HW = 6, HD = 6;
  for (let f = 0; f <= FL; f++) {
    const y = f * FH;
    if (f === 0) add(P, 0, y, 0, W, 0.6, D, floor, INDEST, { t: 'floor' });
    else floorWithHole(P, y, W, D, HX, HZ, HW, HD, floor);
    if (f < FL) {
      // brick perimeter walls with window gaps → wall segments + windows
      const segN = 12, segW = W / segN;
      for (let i = 0; i < segN; i++) {
        const px = -W / 2 + (i + 0.5) * segW;
        add(P, px, y + FH * 0.28, -D / 2, segW - 0.1, FH * 0.56, 0.5, brick, STRONG, { t: 'wall' });     // sill
        add(P, px, y + FH * 0.85, -D / 2, segW - 0.1, FH * 0.3, 0.5, brick, STRONG, { t: 'wall' });      // lintel
        if (i % 2 === 0) add(P, px, y + FH * 0.56, -D / 2, segW - 1, FH * 0.32, 0.2, win, GLASS, { t: 'glass' });
        add(P, px, y + FH * 0.28, D / 2, segW - 0.1, FH * 0.56, 0.5, brick, STRONG, { t: 'wall' });
        add(P, px, y + FH * 0.85, D / 2, segW - 0.1, FH * 0.3, 0.5, brick, STRONG, { t: 'wall' });
        if (i % 2 === 1) add(P, px, y + FH * 0.56, D / 2, segW - 1, FH * 0.32, 0.2, win, GLASS, { t: 'glass' });
      }
      const segD = 8; for (let i = 0; i < segD; i++) { const pz = -D / 2 + (i + 0.5) * (D / segD); add(P, -W / 2, y + FH / 2, pz, 0.5, FH, D / segD - 0.1, brick2, STRONG, { t: 'wall' }); add(P, W / 2, y + FH / 2, pz, 0.5, FH, D / segD - 0.1, brick2, STRONG, { t: 'wall' }); }
      // interior: classrooms via partition walls (medium) + a big gym on the right (open)
      add(P, -4, y + FH / 2, 0, 0.3, FH - 0.6, D - 2, slab, MED, { t: 'wall' });   // main hallway wall
      for (const wx of [-14, -9]) add(P, wx, y + FH / 2, -6, 0.3, FH - 0.6, 12, slab, MED, { t: 'wall' });
      for (const wz of [-6, 2]) add(P, -9, y + FH / 2, wz, 10, FH - 0.6, 0.3, slab, MED, { t: 'wall' });
      // lockers along the hallway
      for (let i = 0; i < 8; i++) add(P, -2, y + 1.4, -10 + i * 2.4, 0.6, 2.6, 1.1, locker, WEAK, { t: 'furn' });
      // desks in classrooms
      for (const [dx, dz] of [[-13, -8], [-13, -3], [-8, -8], [-8, -3]]) add(P, dx, y + 1, dz, 1.6, 0.9, 1, door, FURN, { t: 'furn' });
      // gym floor accent on ground
      if (f === 0) add(P, 14, 0.35, 0, 14, 0.06, 18, gym, INDEST, { t: 'deco', ns: 1 });
      stairs(P, HX, HZ, y, y + FH, HW - 0.8, HD, slab);
    }
  }
  // sloped-ish roof (flat with parapet)
  const ry = FL * FH;
  for (const [ex, ez, ew, ed] of [[0, -D / 2, W, 0.8], [0, D / 2, W, 0.8], [-W / 2, 0, 0.8, D], [W / 2, 0, 0.8, D]]) add(P, ex, ry + 0.8, ez, ew, 1.6, ed, brick2, STRONG, { t: 'parapet' });
  add(P, -W / 2 + 5, ry + 3, 0, 4, 6, 4, brick, STRONG, { t: 'belltower' });
  add(P, -W / 2 + 5, ry + 6.5, 0, 3, 1.5, 3, roof, STRONG, { t: 'bell' });
  return P;
}

// ===================== FURIOUS STATION =====================
function stationMap() {
  const P = [];
  const plat = '#b8b0a2', edge = '#e0c040', steel = '#6a7280', canopy = '#3a4450', train = '#c23a3a', train2 = '#a02a2a', win = '#bfe0f0', bench = '#6a4a2a', rail = '#8a8f98', tie = '#5a4632';
  const L = 70, PW = 12;   // platform length + width
  add(P, 0, -1, 0, L + 20, 2, 60, '#7a7266', INDEST, { t: 'ground' });
  // two platforms with a track pit between
  for (const side of [-1, 1]) {
    const pz = side * 10;
    add(P, 0, 0, pz, L, 1, PW, plat, INDEST, { t: 'floor' });
    add(P, 0, 0.55, pz - side * (PW / 2 - 0.4), L, 0.2, 0.8, edge, INDEST, { t: 'edge', ns: 1 });   // warning line
    // canopy pillars + roof
    for (let i = 0; i < 8; i++) { const px = -L / 2 + (i + 0.5) * (L / 8); add(P, px, 4.5, pz, 0.6, 9, 0.6, steel, INDEST, { t: 'col' }); }
    add(P, 0, 9.2, pz, L, 0.5, PW + 2, canopy, STRONG, { t: 'roof' });
    add(P, 0, 9.7, pz, L, 0.6, 1, steel, STRONG, { t: 'ridge' });
    // benches + signs
    for (let i = 0; i < 5; i++) { const bx = -L / 2 + (i + 0.5) * (L / 5); add(P, bx, 1.2, pz + side * 1.5, 3, 0.5, 1, bench, WOOD, { t: 'furn' }); }
    add(P, -L / 2 + 6, 3, pz, 3, 1.4, 0.3, '#1a2230', WEAK, { t: 'sign' });
  }
  // track bed + rails + ties (center)
  add(P, 0, -0.4, 0, L, 0.6, 6, '#4a4436', INDEST, { t: 'trackbed' });
  for (let i = 0; i < 24; i++) add(P, -L / 2 + (i + 0.5) * (L / 24), -0.05, 0, 0.6, 0.25, 6, tie, INDEST, { t: 'tie', ns: 1 });
  for (const rz of [-2, 2]) add(P, 0, 0.05, rz, L, 0.2, 0.25, rail, INDEST, { t: 'rail', ns: 1 });
  // a train — several breakable cars
  for (let c = 0; c < 4; c++) {
    const cx = -L / 2 + 10 + c * 15;
    add(P, cx, 2.4, 0, 13, 3.4, 4.4, c % 2 ? train2 : train, MED, { t: 'car' });   // car body (breakable)
    add(P, cx, 4.3, 0, 12.4, 0.6, 4, steel, WEAK, { t: 'carroof' });
    for (let w = 0; w < 4; w++) add(P, cx - 5 + w * 3.2, 2.7, 2.22, 1.8, 1.4, 0.12, win, GLASS, { t: 'glass' });
    for (let w = 0; w < 4; w++) add(P, cx - 5 + w * 3.2, 2.7, -2.22, 1.8, 1.4, 0.12, win, GLASS, { t: 'glass' });
    add(P, cx, 0.6, 0, 12, 0.8, 3.6, '#2a2e36', STRONG, { t: 'chassis' });
  }
  // footbridge over the tracks
  add(P, 0, 6, 0, 5, 0.5, 8, steel, MED, { t: 'bridge' });
  stairs(P, 2.2, 10, 0, 6, 3, 8, steel);
  stairs(P, -2.2, -10, 0, 6, 3, 8, steel);
  return P;
}

export const MAPS = {
  glass:   { id: 'glass',   name: 'Glass Office',    spawnR: 12, sky: ['#7db9ec', '#dcecf8'], water: '#2f7fd0', fog: '#bcd6ee', ground: 60, pieces: officeMap() },
  school:  { id: 'school',  name: 'Heights School',  spawnR: 16, sky: ['#8fc0e8', '#e0eef8'], water: '#3a86c0', fog: '#c8dcc0', ground: 68, pieces: schoolMap() },
  station: { id: 'station', name: 'Furious Station', spawnR: 22, sky: ['#9aa8b8', '#d8e2ec'], water: '#3a4450', fog: '#aeb8c4', ground: 84, pieces: stationMap() },
};
export const MAP_IDS = Object.keys(MAPS);
