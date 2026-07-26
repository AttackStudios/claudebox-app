// Natural Disaster Survival — shared tuning (client render + server logic agree).
// Original implementation inspired by the classic; all geometry is our own.
// Maps are built from PIECES: {x,y,z,w,h,d,c,s} where s = strength/HP
// (0 = indestructible; lower = weaker). Disasters damage pieces in range and
// weak ones break off & fall — the map falls apart around you.

export const WORLD = { waterY: -1.4 };

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

// ===================== FURIOUS STATION (gas station) =====================
function stationMap() {
  const P = [];
  const grass = '#6faa54', lot = '#b7b3a8', curb = '#8f8a7e', wall = '#ece6da', pier = '#d8d2c4',
        storeRoof = '#455063', glass = '#bfe0f0', door = '#34424f',
        canopyTop = '#f2f2f2', trim = '#d2382c', post = '#c2c6ce',
        pump = '#dadada', pumpTop = '#c23a3a', screen = '#243040',
        signPole = '#8a8f98', signFace = '#e8b830', prop = '#3a4450';

  // ---- island: green grass + a paved forecourt ----
  add(P, 0, -1, 0, 60, 2, 60, grass, INDEST, { t: 'ground' });
  add(P, 0, 0.06, -1, 46, 0.12, 34, lot, INDEST, { t: 'deco', ns: 1 });          // asphalt forecourt
  add(P, 0, 0.14, -1, 44, 0.06, 0.3, '#e8e2d0', INDEST, { t: 'deco', ns: 1 });   // lot line
  add(P, 0, 0.14, -8, 44, 0.06, 0.3, '#e8e2d0', INDEST, { t: 'deco', ns: 1 });

  // ---- convenience store (back of the lot) ----
  const bx = 13, bz = 11, bw = 17, bd = 8, bh = 4.8, fz = bz - bd / 2;
  add(P, bx, 0.22, bz, bw, 0.5, bd, '#cfc9bd', INDEST, { t: 'floor' });
  add(P, bx, bh / 2, bz + bd / 2, bw, bh, 0.4, wall, STRONG, { t: 'wall' });      // back wall
  add(P, bx - bw / 2, bh / 2, bz, 0.4, bh, bd, wall, STRONG, { t: 'wall' });      // side walls
  add(P, bx + bw / 2, bh / 2, bz, 0.4, bh, bd, wall, STRONG, { t: 'wall' });
  add(P, bx - bw / 2 + 0.7, bh / 2, fz, 1.4, bh, 0.4, pier, STRONG, { t: 'wall' });   // front piers
  add(P, bx + bw / 2 - 0.7, bh / 2, fz, 1.4, bh, 0.4, pier, STRONG, { t: 'wall' });
  add(P, bx + bw / 2 - 4, bh / 2, fz, 2, bh, 0.35, door, WEAK, { t: 'door' });    // glass door
  // storefront glazing (breakable) between piers
  for (let i = 0; i < 5; i++) { const gx = bx - 5 + i * 2.4; if (Math.abs(gx - (bx + bw / 2 - 4)) < 1.4) continue; add(P, gx, 2.3, fz, 2.1, 3.4, 0.16, glass, GLASS, { t: 'glass' }); }
  add(P, bx, bh + 0.25, bz, bw + 1.4, 0.5, bd + 1.4, storeRoof, MED, { t: 'roof' });   // flat overhang roof
  add(P, bx, bh - 0.5, fz - 0.35, bw - 2, 1.3, 0.25, signFace, WEAK, { t: 'sign', ns: 1 });   // fascia sign
  // roof HVAC
  add(P, bx - 4, bh + 1, bz + 1, 2.4, 1.2, 2.2, post, WEAK, { t: 'furn' });

  // ---- fuel canopy (the big flat roof over the pumps) ----
  const cx = -5, cz = -3, cw = 24, cd = 15, cy = 5.4;
  for (const [dx, dz] of [[-cw / 2 + 2, -cd / 2 + 2], [cw / 2 - 2, -cd / 2 + 2], [-cw / 2 + 2, cd / 2 - 2], [cw / 2 - 2, cd / 2 - 2]]) {
    add(P, cx + dx, 0.5, cz + dz, 1.8, 1, 1.8, curb, STRONG, { t: 'curb' });      // post footing
    add(P, cx + dx, cy / 2 + 0.5, cz + dz, 0.8, cy, 0.8, post, STRONG, { t: 'col' });
  }
  add(P, cx, cy + 1, cz, cw, 0.8, cd, canopyTop, MED, { t: 'roof' });             // canopy deck (breakable)
  add(P, cx, cy + 0.4, cz - cd / 2, cw, 0.7, 0.35, trim, MED, { t: 'trim' });     // red fascia
  add(P, cx, cy + 0.4, cz + cd / 2, cw, 0.7, 0.35, trim, MED, { t: 'trim' });
  add(P, cx - cw / 2, cy + 0.4, cz, 0.35, 0.7, cd, trim, MED, { t: 'trim' });
  add(P, cx + cw / 2, cy + 0.4, cz, 0.35, 0.7, cd, trim, MED, { t: 'trim' });
  add(P, cx, cy + 2.1, cz - cd / 2 + 1, 7, 1.8, 0.5, signFace, WEAK, { t: 'sign', ns: 1 });   // brand sign on top

  // ---- pump islands under the canopy ----
  for (const px of [cx - 6, cx + 6]) {
    add(P, px, 0.45, cz, 4.4, 0.9, 2, curb, STRONG, { t: 'curb' });
    for (const s of [-1, 1]) {
      add(P, px + s * 1.3, 1.7, cz, 1.1, 2, 1.5, pump, FURN, { t: 'pump' });      // pump body (breakable)
      add(P, px + s * 1.3, 3, cz, 1.1, 0.5, 1.5, pumpTop, WEAK, { t: 'pumphat' });
      add(P, px + s * 1.3, 2.2, cz + 0.85, 0.7, 0.9, 0.12, screen, WEAK, { t: 'furn', ns: 1 });
    }
  }

  // ---- roadside price sign ----
  add(P, -24, 3, -22, 0.9, 6, 0.9, signPole, STRONG, { t: 'pole' });
  add(P, -24, 6.6, -22, 5, 3, 0.5, screen, WEAK, { t: 'sign' });
  add(P, -24, 6.6, -21.7, 4.2, 2.4, 0.3, signFace, WEAK, { t: 'sign', ns: 1 });

  // ---- scattered props (all breakable) ----
  add(P, bx - 10, 0.7, bz - 2, 1, 1.4, 1, prop, WEAK, { t: 'furn' });             // trash can
  add(P, 6, 0.7, -14, 1, 1.4, 1, prop, WEAK, { t: 'furn' });
  add(P, -18, 1, 4, 1.2, 2, 1.6, '#3a6ea5', WEAK, { t: 'furn' });                 // air/water box
  add(P, 18, 0.5, -12, 5, 1, 2.4, curb, STRONG, { t: 'curb' });                   // parking bumper strip
  // protective bollards around each pump island
  for (const px of [cx - 6, cx + 6]) for (const [ox, oz] of [[-2.4, 0], [2.4, 0], [0, -1.4], [0, 1.4]]) add(P, px + ox, 0.9, cz + oz, 0.45, 1.4, 0.45, pumpTop, WEAK, { t: 'bollard' });
  // canopy underside light strips
  for (const lz of [cz - 4, cz, cz + 4]) add(P, cx, cy + 0.55, lz, cw - 1.5, 0.12, 0.5, '#fff6cf', MED, { t: 'deco', ns: 1 });
  // storefront kickplate + window mullions
  add(P, bx, 0.7, fz, bw - 3, 1, 0.3, pier, STRONG, { t: 'wall' });
  for (let i = 0; i < 4; i++) add(P, bx - 3.6 + i * 2.4, 2.3, fz, 0.16, 3.4, 0.3, wall, WEAK, { t: 'mullion' });
  // vending machines + ice box against the store front
  add(P, bx - 6.5, 1.3, fz - 0.7, 1.3, 2.4, 0.9, '#c23a3a', WEAK, { t: 'furn' });
  add(P, bx - 5, 1.3, fz - 0.7, 1.3, 2.4, 0.9, '#3a6ea5', WEAK, { t: 'furn' });
  add(P, bx + 6.5, 0.9, fz - 0.7, 1.6, 1.6, 1, '#e8ecf0', WEAK, { t: 'furn' });   // ice box
  // planters + shrubs on the grass
  for (const [gx, gz] of [[-26, 20], [26, 20], [0, 24], [-26, -2]]) { add(P, gx, 0.5, gz, 3, 0.7, 3, curb, STRONG, { t: 'planter' }); add(P, gx, 1.5, gz, 2.4, 1.4, 2.4, '#4f8a45', WEAK, { t: 'shrub' }); }
  // propane cage by the store
  add(P, bx + bw / 2 + 2, 0.9, bz - 2, 1.8, 1.6, 1.8, '#8a8f98', WEAK, { t: 'furn' });
  return P;
}

export const MAPS = {
  glass:   { id: 'glass',   name: 'Glass Office',    spawnR: 12, sky: ['#7db9ec', '#dcecf8'], water: '#2f7fd0', fog: '#bcd6ee', ground: 60, pieces: officeMap() },
  school:  { id: 'school',  name: 'Heights School',  spawnR: 16, sky: ['#8fc0e8', '#e0eef8'], water: '#3a86c0', fog: '#c8dcc0', ground: 68, pieces: schoolMap() },
  station: { id: 'station', name: 'Furious Station', spawnR: 16, sky: ['#7db9ec', '#dcecf8'], water: '#2f7fd0', fog: '#c6ddc4', ground: 60, pieces: stationMap() },
};
export const MAP_IDS = Object.keys(MAPS);
