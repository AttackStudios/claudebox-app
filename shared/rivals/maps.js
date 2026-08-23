// Rivals — map geometry. Pure AABB boxes ({x,y,z} = CENTER, {sx,sy,sz} = full
// size) so the server can do cheap collision + hitscan and the client renders
// the same data. Ramps are stair-stacks of boxes to stay AABB-only.

const B = (x, y, z, sx, sy, sz, color, opts = {}) => ({ x, y, z, sx, sy, sz, color, ...opts });

// A SLOPE (smooth ramp) centred at (cx,cz), base height y0, `len` long along
// `axis` ('x'|'z'), `rise` tall, `w` wide. up=+1 rises toward +axis, -1 toward
// -axis. One box carrying `ramp` metadata; collision interpolates the floor
// height along it and the client renders a tilted plank.
function slope(cx, y0, cz, axis, len, rise, w, up, color) {
  const sx = axis === 'x' ? len : w;
  const sz = axis === 'z' ? len : w;
  return B(cx, y0 + rise / 2, cz, sx, rise, sz, color, { ramp: { axis, up, rise } });
}

// a "table": a flat WALKABLE slab on four thin legs — cover you can duck under
// or hop onto (the arena's signature raised platforms).
function table(x, z, sx, sz, topY, color, legColor = color) {
  const t = 0.5, lw = 0.5;
  const lx = sx / 2 - 0.6, lz = sz / 2 - 0.6;
  const legH = topY - t / 2, legY = legH / 2;
  return [
    B(x, topY, z, sx, t, sz, color, { walk: true }),
    B(x - lx, legY, z - lz, lw, legH, lw, legColor),
    B(x + lx, legY, z - lz, lw, legH, lw, legColor),
    B(x - lx, legY, z + lz, lw, legH, lw, legColor),
    B(x + lx, legY, z + lz, lw, legH, lw, legColor),
  ];
}

// ================= ARENA — floating white greybox box (Rivals-style) =====
const AR_W = '#eef1f6', AR_W2 = '#d9dee6', AR_ACC = '#c6ccd6';
const TEAM_A = '#2fa4ff', TEAM_B = '#ff7a34';   // blue side vs orange side
// A floating portrait box: tall white walls all round, a grid floor, and a
// scattered field of white greybox cover (slabs, cubes, angled blocks, tables).
// Laid out with 180° rotational symmetry so the two diagonal spawns are fair.
export const ARENA = {
  id: 'arena', name: 'Arena',
  sky: '#cfe3f4', sky2: ['#7db9ec', '#b7d8f0', '#e8f1f8'], fog: 0.006, clouds: true,
  ground: { color: '#eef1f6', sizeX: 46, sizeZ: 62, thick: 4, tex: ['#eef1f6', 'rgba(120,135,160,0.34)', 'rgba(150,175,205,0.12)'] },
  emblem: '#8fa7c4',
  boxes: [
    // ---- perimeter walls ----
    B(0, 7, -31, 46, 14, 1.2, AR_W), B(0, 7, 31, 46, 14, 1.2, AR_W),
    B(-23, 7, 0, 1.2, 14, 62, AR_W), B(23, 7, 0, 1.2, 14, 62, AR_W),
    // ---- central cluster (tall chunky greybox cover) ----
    ...table(0, 0, 6, 4.5, 3.4, AR_W2, AR_ACC),          // centre raised platform
    B(0, 1.6, -9, 5, 3.2, 3, AR_ACC), B(0, 1.6, 9, 5, 3.2, 3, AR_ACC),
    B(-6, 2.1, -5, 6.5, 4.2, 2.4, AR_W2, { ry: 0.5 }), B(6, 2.1, 5, 6.5, 4.2, 2.4, AR_W2, { ry: 0.5 }),
    // ---- chunky cubes ----
    B(-9, 2.6, 3, 3, 5.2, 3, AR_W2), B(9, 2.6, -3, 3, 5.2, 3, AR_W2),
    B(-7, 2.0, 13, 2.8, 4, 2.8, AR_ACC), B(7, 2.0, -13, 2.8, 4, 2.8, AR_ACC),
    // ---- angled slabs ----
    B(-6, 1.9, 18, 6, 3.8, 2.4, AR_W2, { ry: -0.6 }), B(6, 1.9, -18, 6, 3.8, 2.4, AR_W2, { ry: -0.6 }),
    // ---- tall pillars near the side walls ----
    B(-18, 3.0, 6, 3, 6, 3, AR_W2), B(18, 3.0, -6, 3, 6, 3, AR_W2),
    B(-19, 2.2, -4, 2.6, 4.4, 2.6, AR_ACC), B(19, 2.2, 4, 2.6, 4.4, 2.6, AR_ACC),
    // ---- long blocks along z (angled) ----
    B(12, 2.2, -11, 2.4, 4.4, 7, AR_W2, { ry: -0.15 }), B(-12, 2.2, 11, 2.4, 4.4, 7, AR_W2, { ry: -0.15 }),
    // ---- second pair of tables ----
    ...table(-13, 12, 4.5, 3, 3.0, AR_W2, AR_ACC), ...table(13, -12, 4.5, 3, 3.0, AR_W2, AR_ACC),
    // ---- mid-far platforms (on-axis) ----
    B(0, 1.6, -22, 7, 3.2, 3, AR_ACC), B(0, 1.6, 22, 7, 3.2, 3, AR_ACC),
    // ---- short ramps in front of each spawn, rising toward the OPPOSITE side ----
    slope(15, 0, 18, 'z', 14, 5, 5, -1, AR_W2), slope(-15, 0, -18, 'z', 14, 5, 5, 1, AR_W2),
    // ---- cover flanking the spawns ----
    B(-9, 1.5, -24, 4, 3, 2.4, AR_W2), B(9, 1.5, 24, 4, 3, 2.4, AR_W2),
    // ---- subtle team-colour floor pads at each spawn (only glow on the map) ----
    B(-17, 0.05, -25, 6, 0.1, 6, TEAM_A, { glow: true }), B(17, 0.05, 25, 6, 0.1, 6, TEAM_B, { glow: true }),
  ],
  // ry chosen so spawns FACE the arena centre (forward = (-sin ry, -cos ry))
  spawnsA: [{ x: -16, z: -25, ry: -2.57 }, { x: -19, z: -22, ry: -2.43 }],
  spawnsB: [{ x: 16, z: 25, ry: 0.57 }, { x: 19, z: 22, ry: 0.71 }],
};

// ============ BATTLEGROUND — big outdoor industrial ========
// Retheme to the series' own arena language: near-white panelled greybox with
// two greys for depth and one cool accent. The old green-field/purple-wall pass
// fought the weapons for attention — a bright, near-monochrome arena is what
// lets a saturated gun and a player silhouette read instantly at range.
const BG_P = '#e6eaf1', BG_P2 = '#d5dbe5', BG_G = '#c8cfda', BG_C = '#b9c2ce', BG_B = '#aab4c2';
const BG_NEON = '#57e0ff', BG_NEON2 = '#9ad9ff';
export const BATTLEGROUND = {
  id: 'battleground', name: 'Battleground',
  sky: '#cfe3f4', sky2: ['#7db9ec', '#b7d8f0', '#eef6fc'], fog: 0.0028, clouds: true,
  ground: { color: '#f7f8fa', size: 124, tex: ['#fafbfd', 'rgba(126,140,164,0.26)', 'rgba(160,185,215,0.08)'] },
  emblem: '#ffd24a',
  boxes: [
    // perimeter
    B(0, 5, -31, 90, 10, 1.5, BG_P), B(0, 5, 31, 90, 10, 1.5, BG_P),
    B(-45, 5, 0, 1.5, 10, 63, BG_P2), B(45, 5, 0, 1.5, 10, 63, BG_P2),
    // two buildings (walkable roofs)
    B(-21, 3, -15, 16, 6, 12, BG_G, { walk: true }),
    B(21, 3, 15, 16, 6, 12, BG_G, { walk: true }),
    B(-21, 6.6, -15, 17, 1.2, 13, BG_B), B(21, 6.6, 15, 17, 1.2, 13, BG_B),
    slope(-5.5, 0, -21, 'x', 12, 6, 3.5, 1, BG_B),
    slope(5.5, 0, 21, 'x', 12, 6, 3.5, -1, BG_B),
    // central crate yards
    B(0, 1, 0, 2.6, 2, 2.6, BG_C), B(3, 0.75, 0.8, 1.6, 1.5, 1.6, BG_C),
    B(-4.5, 1.4, 4.5, 2.2, 2.8, 2.2, BG_C), B(9, 1, -7.5, 2.6, 2, 2.6, BG_C),
    B(-12, 1, 12, 2.6, 2, 2.6, BG_C), B(13.5, 1.6, 4.5, 2.2, 3.2, 2.2, BG_G),
    B(-28, 1, 9, 3.5, 2, 2.5, BG_C), B(28, 1, -9, 3.5, 2, 2.5, BG_C),
    B(-9, 1.2, -12, 2.4, 2.4, 2.4, BG_C), B(9, 1.2, 12, 2.4, 2.4, 2.4, BG_C),
    B(-34, 1.3, -14, 3, 2.6, 3, BG_G), B(34, 1.3, 14, 3, 2.6, 3, BG_G),
    B(0, 1, 20, 4, 2, 2, BG_C), B(0, 1, -20, 4, 2, 2, BG_C),
    B(-20, 0.9, 24, 3, 1.8, 2, BG_C), B(20, 0.9, -24, 3, 1.8, 2, BG_C),
    // long pipe rack mid
    B(0, 2.6, -19.5, 24, 0.7, 0.7, '#c8ccd4'),
    B(-10.5, 1.3, -19.5, 0.6, 2.6, 0.6, BG_B), B(10.5, 1.3, -19.5, 0.6, 2.6, 0.6, BG_B),
    // ---- decorative emissive trim (glow → not solid) ----
    // perimeter neon along the wall tops
    B(0, 10.05, -31, 90, 0.34, 0.7, BG_NEON, { glow: true }), B(0, 10.05, 31, 90, 0.34, 0.7, BG_NEON, { glow: true }),
    B(-45, 10.05, 0, 0.7, 0.34, 62, BG_NEON, { glow: true }), B(45, 10.05, 0, 0.7, 0.34, 62, BG_NEON, { glow: true }),
    // building roof-edge light strips (facing the yard)
    B(-21, 7.28, -9.2, 17, 0.16, 0.3, BG_NEON2, { glow: true }), B(21, 7.28, 9.2, 17, 0.16, 0.3, BG_NEON2, { glow: true }),
    // glowing caps on the mid pipe-rack posts
    B(-10.5, 2.72, -19.5, 0.9, 0.22, 0.9, BG_NEON2, { glow: true }), B(10.5, 2.72, -19.5, 0.9, 0.22, 0.9, BG_NEON2, { glow: true }),
  ],
  spawnsA: [{ x: -39, z: 21, ry: -1.08 }, { x: -39, z: -21, ry: -2.06 }],
  spawnsB: [{ x: 39, z: -21, ry: 2.06 }, { x: 39, z: 21, ry: 1.08 }],
};

// ============ LOBBY — the facility: red-carpet hallway, duel pads, range wing ============
// Modeled on the original's spawn: grey bulkhead corridor with a red carpet
// spine, DUELS pad alcove (west), shooting-range wing (east), and a warm
// wood event hall at the far end.
const LB_W = '#59606e', LB_W2 = '#4a515c', LB_D = '#343a44', LB_DK = '#23272f';
const WD = '#8a6a48', WD2 = '#6b5138', CARPET = '#c81f2e', PIPE = '#4ae06a';
// ============ SHOOTING RANGE — standalone practice map ============
// Firing lanes with counters, a target backstop, a colourful dummy field,
// and a pink/green practice corner. Enter from the lobby's east door;
// the glowing pad by the spawn takes you back.
const RG_W = '#4d5462', RG_W2 = '#3d434f', RG_D = '#23272f';
export const RANGE = {
  id: 'range', name: 'Shooting Range', sky: '#161a22', fog: 0.008,
  ground: { color: '#31363f', sizeX: 100, sizeZ: 76 },
  exitPad: { x: -27, z: 8 },
  boxes: [
    // room shell 66 x 48
    B(0, 4.5, -24.6, 68, 9, 1.2, RG_W), B(0, 4.5, 24.6, 68, 9, 1.2, RG_W),
    B(-33.6, 4.5, 0, 1.2, 9, 50, RG_W2), B(33.6, 4.5, 0, 1.2, 9, 50, RG_W2),
    B(0, 9.2, 0, 68, 0.5, 50, RG_D),                       // ceiling
    // firing counters (west side, shooting east)
    B(-14, 0.65, -14, 3, 1.3, 2.4, RG_D), B(-14, 0.65, -6, 3, 1.3, 2.4, RG_D),
    B(-14, 0.65, 2, 3, 1.3, 2.4, RG_D), B(-14, 0.65, 10, 3, 1.3, 2.4, RG_D),
    // lane dividers
    B(-3, 1.5, -10, 20, 3, 0.4, RG_W2), B(-3, 1.5, -2, 20, 3, 0.4, RG_W2), B(-3, 1.5, 6, 20, 3, 0.4, RG_W2),
    // target backstop
    B(22, 3, -2, 1, 6, 34, RG_D),
    // colourful dummy field (north-east): rainbow tiles
    B(12, 0.031, -19, 16, 0.06, 8, '#e05a4a', { glow: true }),
    B(4, 0.031, -19, 4, 0.06, 8, '#e8c83a', { glow: true }),
    B(18, 0.031, -14.8, 8, 0.06, 2, '#5abd6a', { glow: true }),
    B(6, 0.031, -14.8, 8, 0.06, 2, '#3d8bff', { glow: true }),
    // pink/green practice corner (south-east)
    B(24, 2.2, 20, 18, 4.4, 1, '#ff7eb6', { plain: true }),
    B(32.6, 2.2, 14, 1, 4.4, 12, '#6ee7a0', { plain: true }),
    B(24, 0.031, 17, 17, 0.06, 13, '#ff9ac8', { glow: true }),
    B(28, 0.031, 10, 9, 0.06, 6, '#8af0b8', { glow: true }),
    // loadout bins by the spawn (the original's trash-can stations)
    B(-27, 1, -6, 1.6, 2, 1.6, '#2a2e38'), B(-27, 1, -2.5, 1.6, 2, 1.6, '#2a2e38'),
    // EXIT pad
    B(-27, 0.031, 8, 3.4, 0.06, 3.4, '#38b6e8', { glow: true }),
    // scatter cover blocks mid-range
    B(4, 1, 12, 2.6, 2, 2.6, RG_W2), B(8, 1.3, -6, 2.6, 2.6, 2.6, RG_W2),
  ],
  targets: [
    // backstop row (varied heights)
    { x: 20.8, y: 1.1, z: -14 }, { x: 20.8, y: 2.4, z: -9 }, { x: 20.8, y: 1.4, z: -4 },
    { x: 20.8, y: 2.8, z: 1 }, { x: 20.8, y: 1.1, z: 6 }, { x: 20.8, y: 1.9, z: 11 },
    // colourful field cluster — MANY dummies
    { x: 8, y: 1.1, z: -18 }, { x: 12, y: 1.1, z: -20 }, { x: 15, y: 1.1, z: -17 },
    { x: 10, y: 1.1, z: -15 }, { x: 17, y: 1.1, z: -21 }, { x: 6, y: 1.1, z: -21 },
    // pink/green corner pair
    { x: 26, y: 1.1, z: 16 }, { x: 30, y: 1.1, z: 13 },
  ],
  spawnsA: [{ x: -26, z: 2, ry: -Math.PI / 2 }],
  spawnsB: [{ x: -26, z: 2, ry: -Math.PI / 2 }],
};

export const LOBBY = {
  id: 'lobby', name: 'Lobby', sky: '#12141c', fog: 0.012,
  ground: { color: '#2e333c', sizeX: 100, sizeZ: 140 },
  boxes: [
    // ---- main hallway (spine along z) ----
    B(0, 4, 23, 16, 8, 1.2, LB_W),                       // south wall (behind spawn)
    B(-7.6, 4, 15.5, 1.2, 8, 15, LB_W),                  // west wall (south of alcove)
    B(-7.6, 4, -19, 1.2, 8, 22, LB_W2),                  // west wall (north of alcove)
    B(7.6, 4, -20, 1.2, 8, 20, LB_W),                    // east wall (north of range)
    B(7.6, 4, 19.5, 1.2, 8, 7, LB_W2),                   // east wall (south of range)
    // bulkhead door frames across the hall
    B(-6.2, 3.5, 8, 1.4, 7, 1, LB_D), B(6.2, 3.5, 8, 1.4, 7, 1, LB_D), B(0, 7.2, 8, 14, 1.6, 1, LB_D),
    B(-6.2, 3.5, -12, 1.4, 7, 1, LB_D), B(6.2, 3.5, -12, 1.4, 7, 1, LB_D), B(0, 7.2, -12, 14, 1.6, 1, LB_D),
    // ---- DUELS alcove (west) ----
    B(-22.6, 4, 0, 1.2, 8, 17.2, LB_W),
    B(-15, 4, -8.6, 16, 8, 1.2, LB_W2),
    B(-15, 4, 8.6, 16, 8, 1.2, LB_W2),
    // ---- shooting-range wing (east) ----
    B(34.6, 4, 3, 1.2, 8, 27.2, LB_W),
    B(21, 4, -10.6, 28, 8, 1.2, LB_W2),
    B(21, 4, 16.6, 28, 8, 1.2, LB_W),
    B(32, 2.6, 3, 0.8, 5.2, 24, LB_DK),                  // target backstop
    B(19, 1, -2, 9, 2, 0.5, LB_W2), B(19, 1, 8, 9, 2, 0.5, LB_W2),   // lane dividers
    B(11, 1.1, 13.5, 2, 2.2, 2, LB_DK),                  // loadout station (like the range trash cans)
    // ---- event hall (warm wood, far north) ----
    B(-11, 4, -30.6, 8.5, 8, 1.2, LB_W), B(11, 4, -30.6, 8.5, 8, 1.2, LB_W),
    B(-14.6, 4.5, -41.5, 1.2, 9, 23, WD), B(14.6, 4.5, -41.5, 1.2, 9, 23, WD),
    B(0, 4.5, -52.6, 30.4, 9, 1.2, WD2),
    B(0, 0.6, -46, 12, 1.2, 8, WD2, { walk: true }),     // stage
    B(0, 1.9, -48.5, 2, 1.4, 2, LB_DK),                  // trophy plinth
    // arcade kiosk in the hallway
    B(5.8, 1.5, -24, 1.6, 3, 2.4, '#16181e'),
    // ---- ceilings ----
    B(0, 8.6, -3.5, 16.4, 0.5, 54, LB_DK),
    B(-15, 8.6, 0, 16, 0.5, 18.4, LB_DK),
    B(21, 8.6, 3, 28.4, 0.5, 28.4, LB_DK),
    B(0, 9.7, -41.5, 30.4, 0.6, 23.4, WD2),
    // ---- decor: red carpet spine + green pipe trim + posters (non-solid glow / plain) ----
    B(0, 0.031, -15, 5, 0.06, 74, CARPET, { glow: true }),
    B(-15, 0.031, 0, 14, 0.06, 4, CARPET, { glow: true }),
    B(-6.9, 6.5, 2, 0.12, 0.16, 40, PIPE, { glow: true }),
    B(6.9, 6.5, -14, 0.12, 0.16, 32, PIPE, { glow: true }),
    B(-7.0, 3.4, 12.5, 0.16, 2.4, 3.4, '#e04a9a', { plain: true }),   // posters
    B(-7.0, 3.6, -24, 0.16, 2.2, 3, '#e8c83a', { plain: true }),
    B(7.0, 3.4, 18.8, 0.16, 2.2, 3, '#3fd1c4', { plain: true }),
  ],
  // range dummies: lanes shoot east toward the backstop
  targets: [
    { x: 30.8, y: 1.1, z: -6 }, { x: 30.8, y: 2.2, z: -2 },
    { x: 30.8, y: 1.4, z: 2 }, { x: 30.8, y: 2.6, z: 6 },
    { x: 30.8, y: 1.1, z: 10 }, { x: 30.8, y: 3.1, z: 13 },
    { x: 26, y: 1.1, z: 0 }, { x: 24, y: 1.1, z: 9 },
  ],
  spawnsA: [{ x: 0, z: 16, ry: 0 }],   // south end, facing down the red carpet
  spawnsB: [{ x: 0, z: 19, ry: 0 }],
};


// ============ FRONTIER — HUGE canyon outpost (Wave Survival) ============
// ~4x the area of Battleground: a desert canyon town with a central fort,
// watchtowers, long sightlines and lots of room to run.
const FR_S = '#d8b078', FR_S2 = '#c49a5e', FR_R = '#a8683c', FR_W = '#8a6a48', FR_T = '#6a89a8';
const FR_NEON = '#ffd24a';
export const FRONTIER = {
  id: 'frontier', name: 'Frontier', huge: true,
  sky: '#f2d8a8', sky2: ['#e8b06a', '#f2d8a8', '#faf0d8'], fog: 0.0028,
  ground: { color: '#caa268', size: 320, tex: ['#caa268', 'rgba(120,80,40,0.25)', 'rgba(255,230,170,0.15)'] },
  emblem: '#ffd24a',
  boxes: [
    // canyon perimeter
    B(0, 7, -75, 224, 14, 3, FR_R), B(0, 7, 75, 224, 14, 3, FR_R),
    B(-112, 7, 0, 3, 14, 153, FR_R), B(112, 7, 0, 3, 14, 153, FR_R),
    // central fort (walkable roof) + ramps
    B(0, 3.5, 0, 22, 7, 16, FR_W, { walk: true }),
    B(0, 7.7, 0, 24, 1.4, 18, FR_S2),
    slope(-16, 0, 0, 'x', 10, 7, 5, 1, FR_S2),
    slope(16, 0, 0, 'x', 10, 7, 5, -1, FR_S2),
    // four watchtowers
    B(-70, 4, -45, 8, 8, 8, FR_W, { walk: true }), slope(-70, 0, -36, 'z', 10, 8, 4, -1, FR_S2),
    B(70, 4, 45, 8, 8, 8, FR_W, { walk: true }),   slope(70, 0, 36, 'z', 10, 8, 4, 1, FR_S2),
    B(-70, 4, 45, 8, 8, 8, FR_W, { walk: true }),  slope(-61, 0, 45, 'x', 10, 8, 4, -1, FR_S2),
    B(70, 4, -45, 8, 8, 8, FR_W, { walk: true }),  slope(61, 0, -45, 'x', 10, 8, 4, 1, FR_S2),
    // town buildings (walkable roofs)
    B(-45, 2.5, -12, 14, 5, 10, FR_S, { walk: true }), B(45, 2.5, 12, 14, 5, 10, FR_S, { walk: true }),
    B(-40, 2, 34, 12, 4, 9, FR_S2, { walk: true }),   B(40, 2, -34, 12, 4, 9, FR_S2, { walk: true }),
    B(-16, 2.2, -42, 10, 4.4, 8, FR_S, { walk: true }), B(16, 2.2, 42, 10, 4.4, 8, FR_S, { walk: true }),
    slope(-45, 0, -1.5, 'z', 9, 5, 4, -1, FR_S2), slope(45, 0, 1.5, 'z', 9, 5, 4, 1, FR_S2),
    // scattered canyon rocks + crates (cover everywhere)
    B(-85, 1.6, 10, 6, 3.2, 5, FR_R), B(85, 1.6, -10, 6, 3.2, 5, FR_R),
    B(-60, 1.2, -60, 5, 2.4, 5, FR_R), B(60, 1.2, 60, 5, 2.4, 5, FR_R),
    B(-25, 1, 18, 3, 2, 3, FR_S2), B(25, 1, -18, 3, 2, 3, FR_S2),
    B(-8, 0.9, 58, 3, 1.8, 3, FR_S2), B(8, 0.9, -58, 3, 1.8, 3, FR_S2),
    B(-55, 1, 55, 4, 2, 3, FR_S), B(55, 1, -55, 4, 2, 3, FR_S),
    B(-95, 1.2, -30, 4, 2.4, 4, FR_R), B(95, 1.2, 30, 4, 2.4, 4, FR_R),
    B(-30, 1.4, -70, 5, 2.8, 4, FR_R), B(30, 1.4, 70, 5, 2.8, 4, FR_R),
    B(0, 1, -30, 4, 2, 2.5, FR_S2), B(0, 1, 30, 4, 2, 2.5, FR_S2),
    B(-75, 0.9, -8, 2.5, 1.8, 2.5, FR_S), B(75, 0.9, 8, 2.5, 1.8, 2.5, FR_S),
    B(-50, 0.8, 20, 2.5, 1.6, 2.5, FR_S2), B(50, 0.8, -20, 2.5, 1.6, 2.5, FR_S2),
    B(-20, 1.1, 65, 3, 2.2, 3, FR_R), B(20, 1.1, -65, 3, 2.2, 3, FR_R),
    B(-98, 1, 55, 4, 2, 4, FR_R), B(98, 1, -55, 4, 2, 4, FR_R),
    // fort crown glow
    B(0, 8.5, 0, 24.2, 0.2, 0.4, FR_NEON, { glow: true }),
    B(0, 8.5, 0, 0.4, 0.2, 18.2, FR_NEON, { glow: true }),
  ],
  spawnsA: [
    { x: -4, z: 10, ry: 3.14 }, { x: 4, z: 10, ry: 3.14 },
    { x: -4, z: -10, ry: 0 }, { x: 4, z: -10, ry: 0 },
  ],
  spawnsB: [{ x: 0, z: -60, ry: 0 }],
  waveSpawns: [
    { x: -100, z: -60 }, { x: 100, z: 60 }, { x: -100, z: 60 }, { x: 100, z: -60 },
    { x: 0, z: -68 }, { x: 0, z: 68 }, { x: -104, z: 0 }, { x: 104, z: 0 },
    { x: -55, z: -68 }, { x: 55, z: 68 }, { x: 55, z: -68 }, { x: -55, z: 68 },
  ],
};

// ============ COLOSSUS — HUGE neon mega-yard (Wave Survival) ============
const CO_D = '#3a4152', CO_D2 = '#2c3240', CO_G = '#9aa3ad', CO_C = '#c69a5a';
const CO_N1 = '#57e0ff', CO_N2 = '#c17bff';
export const COLOSSUS = {
  id: 'colossus', name: 'Colossus', huge: true,
  sky: '#1c2334', sky2: ['#151b2a', '#283452', '#4a5a86'], fog: 0.003,
  ground: { color: '#4a5161', size: 300, tex: ['#4a5161', 'rgba(20,25,40,0.35)', 'rgba(120,190,255,0.10)'] },
  emblem: '#57e0ff',
  boxes: [
    // perimeter
    B(0, 7, -70, 210, 14, 3, CO_D), B(0, 7, 70, 210, 14, 3, CO_D),
    B(-105, 7, 0, 3, 14, 143, CO_D2), B(105, 7, 0, 3, 14, 143, CO_D2),
    // grand central platform + twin ramps
    B(0, 2.5, 0, 30, 5, 20, CO_G, { walk: true }),
    slope(-20, 0, 0, 'x', 10, 5, 6, 1, CO_D2),
    slope(20, 0, 0, 'x', 10, 5, 6, -1, CO_D2),
    // four warehouse blocks (walkable)
    B(-60, 3.5, -35, 20, 7, 14, CO_D2, { walk: true }), slope(-60, 0, -25, 'z', 8, 7, 4, -1, CO_G),
    B(60, 3.5, 35, 20, 7, 14, CO_D2, { walk: true }),   slope(60, 0, 25, 'z', 8, 7, 4, 1, CO_G),
    B(-60, 3.5, 35, 20, 7, 14, CO_D2, { walk: true }),  slope(-49, 0, 35, 'x', 8, 7, 4, -1, CO_G),
    B(60, 3.5, -35, 20, 7, 14, CO_D2, { walk: true }),  slope(49, 0, -35, 'x', 8, 7, 4, 1, CO_G),
    // crate mazes
    B(-30, 1, -15, 3, 2, 3, CO_C), B(30, 1, 15, 3, 2, 3, CO_C),
    B(-35, 1.4, 15, 3.5, 2.8, 3.5, CO_C), B(35, 1.4, -15, 3.5, 2.8, 3.5, CO_C),
    B(-15, 1, 40, 3, 2, 3, CO_C), B(15, 1, -40, 3, 2, 3, CO_C),
    B(0, 1.2, -55, 4, 2.4, 3, CO_C), B(0, 1.2, 55, 4, 2.4, 3, CO_C),
    B(-85, 1.2, 20, 4, 2.4, 4, CO_G), B(85, 1.2, -20, 4, 2.4, 4, CO_G),
    B(-85, 1, -50, 3.5, 2, 3.5, CO_C), B(85, 1, 50, 3.5, 2, 3.5, CO_C),
    B(-45, 0.9, 55, 2.5, 1.8, 2.5, CO_C), B(45, 0.9, -55, 2.5, 1.8, 2.5, CO_C),
    B(-20, 1.6, -30, 2.2, 3.2, 2.2, CO_G), B(20, 1.6, 30, 2.2, 3.2, 2.2, CO_G),
    B(-95, 1, 0, 3, 2, 3, CO_C), B(95, 1, 0, 3, 2, 3, CO_C),
    B(-50, 1.1, -58, 3, 2.2, 3, CO_C), B(50, 1.1, 58, 3, 2.2, 3, CO_C),
    // long pipe racks
    B(0, 2.6, -45, 40, 0.7, 0.7, '#c8ccd4'),
    B(-18, 1.3, -45, 0.6, 2.6, 0.6, CO_D2), B(18, 1.3, -45, 0.6, 2.6, 0.6, CO_D2),
    B(0, 2.6, 45, 40, 0.7, 0.7, '#c8ccd4'),
    B(-18, 1.3, 45, 0.6, 2.6, 0.6, CO_D2), B(18, 1.3, 45, 0.6, 2.6, 0.6, CO_D2),
    // neon
    B(0, 14.05, -70, 210, 0.4, 0.8, CO_N1, { glow: true }), B(0, 14.05, 70, 210, 0.4, 0.8, CO_N1, { glow: true }),
    B(-105, 14.05, 0, 0.8, 0.4, 142, CO_N2, { glow: true }), B(105, 14.05, 0, 0.8, 0.4, 142, CO_N2, { glow: true }),
    B(0, 5.28, 0, 30.2, 0.18, 0.4, CO_N1, { glow: true }), B(0, 5.28, 0, 0.4, 0.18, 20.2, CO_N2, { glow: true }),
  ],
  spawnsA: [
    { x: -5, z: 8, ry: 3.14 }, { x: 5, z: 8, ry: 3.14 },
    { x: -5, z: -8, ry: 0 }, { x: 5, z: -8, ry: 0 },
  ],
  spawnsB: [{ x: 0, z: -55, ry: 0 }],
  waveSpawns: [
    { x: -95, z: -58 }, { x: 95, z: 58 }, { x: -95, z: 58 }, { x: 95, z: -58 },
    { x: 0, z: -64 }, { x: 0, z: 64 }, { x: -98, z: 0 }, { x: 98, z: 0 },
    { x: -50, z: 64 }, { x: 50, z: -64 }, { x: 50, z: 64 }, { x: -50, z: -64 },
  ],
};

// Ring the map edge with tall INVISIBLE walls so you can't slide/pad/launch
// out of bounds. `invisible` boxes are solid (collision) but not rendered.
function withBarriers(map) {
  const sx = (map.ground?.sizeX || map.ground?.size || 96) / 2 - 0.5;
  const sz = (map.ground?.sizeZ || map.ground?.size || 96) / 2 - 0.5;
  const h = 60;
  map.boxes.push(
    B(0, h / 2, -sz, sx * 2, h, 1, '#000000', { invisible: true }),
    B(0, h / 2, sz, sx * 2, h, 1, '#000000', { invisible: true }),
    B(-sx, h / 2, 0, 1, h, sz * 2, '#000000', { invisible: true }),
    B(sx, h / 2, 0, 1, h, sz * 2, '#000000', { invisible: true }),
  );
  return map;
}
[ARENA, BATTLEGROUND, LOBBY, FRONTIER, COLOSSUS].forEach(withBarriers);


// ============================================================================
// The rest of the vote roster. Every one is 180-degree rotationally symmetric
// so the two spawns are mirror images and neither side owns a better angle.
// Each keeps the same greybox language — chunky readable cover, a raised
// centre worth contesting, ramps that push you toward the opposite side — and
// changes only palette and silhouette, so learning one map teaches you all of
// them.
// ============================================================================

// ---- BACKROOMS: tight yellow corridors, low ceiling, no sky ----
const BR_W = '#d9c169', BR_W2 = '#c7ad55', BR_T = '#b89c46', BR_C = '#8f7833';
export const BACKROOMS = {
  id: 'backrooms', name: 'Backrooms',
  sky: '#c9b262', sky2: ['#b39b4e', '#c9b262', '#ddc87f'], fog: 0.02,
  ground: { color: '#c2a851', sizeX: 62, sizeZ: 62, thick: 3, tex: ['#c9b062', 'rgba(90,72,20,0.30)', 'rgba(255,240,170,0.10)'] },
  emblem: '#8f7833',
  ceiling: { y: 9, color: '#cbb257' },
  boxes: [
    // perimeter
    B(0, 4.5, -31, 62, 9, 1.2, BR_W), B(0, 4.5, 31, 62, 9, 1.2, BR_W),
    B(-31, 4.5, 0, 1.2, 9, 62, BR_W), B(31, 4.5, 0, 1.2, 9, 62, BR_W),
    // the maze: long partitions leaving offset doorways, mirrored 180 degrees
    B(-10, 4.5, -20, 22, 9, 1.1, BR_W2), B(10, 4.5, 20, 22, 9, 1.1, BR_W2),
    B(14, 4.5, -20, 12, 9, 1.1, BR_T), B(-14, 4.5, 20, 12, 9, 1.1, BR_T),
    B(-20, 4.5, -10, 1.1, 9, 20, BR_W2), B(20, 4.5, 10, 1.1, 9, 20, BR_W2),
    B(-20, 4.5, 14, 1.1, 9, 12, BR_T), B(20, 4.5, -14, 1.1, 9, 12, BR_T),
    B(-4, 4.5, -6, 1.1, 9, 18, BR_W2), B(4, 4.5, 6, 1.1, 9, 18, BR_W2),
    B(8, 4.5, -4, 16, 9, 1.1, BR_T), B(-8, 4.5, 4, 16, 9, 1.1, BR_T),
    // low cover in the open pockets
    B(-24, 1.1, 24, 3.2, 2.2, 3.2, BR_C), B(24, 1.1, -24, 3.2, 2.2, 3.2, BR_C),
    B(0, 1.1, -13, 4, 2.2, 2.6, BR_C), B(0, 1.1, 13, 4, 2.2, 2.6, BR_C),
    B(13, 1.1, 8, 2.6, 2.2, 5, BR_C), B(-13, 1.1, -8, 2.6, 2.2, 5, BR_C),
    // spawn pads
    B(-26, 0.05, -26, 5, 0.1, 5, TEAM_A, { glow: true }), B(26, 0.05, 26, 5, 0.1, 5, TEAM_B, { glow: true }),
  ],
  spawnsA: [{ x: -26, z: -26, ry: -2.36 }, { x: -23, z: -27, ry: -2.2 }],
  spawnsB: [{ x: 26, z: 26, ry: 0.78 }, { x: 23, z: 27, ry: 0.94 }],
};

// ---- CROSSROADS: open green crossing, four approach lanes ----
const CR_S = '#e3e8ee', CR_S2 = '#cfd6df', CR_G = '#7fb45f', CR_G2 = '#6aa04d', CR_A = '#b9c4d0';
export const CROSSROADS = {
  id: 'crossroads', name: 'Crossroads',
  sky: '#cfe3f4', sky2: ['#6fb0e8', '#a8d0ee', '#eaf3fa'], fog: 0.0032, clouds: true,
  ground: { color: '#7fb45f', size: 96, tex: ['#84b862', 'rgba(40,70,30,0.22)', 'rgba(200,240,170,0.12)'] },
  emblem: '#e3e8ee',
  boxes: [
    // perimeter
    B(0, 6, -46, 96, 12, 1.4, CR_S), B(0, 6, 46, 96, 12, 1.4, CR_S),
    B(-46, 6, 0, 1.4, 12, 92, CR_S), B(46, 6, 0, 1.4, 12, 92, CR_S),
    // the crossing itself: a raised stone plus-shape at the middle
    B(0, 1.0, 0, 26, 2, 9, CR_S2, { walk: true }), B(0, 1.0, 0, 9, 2, 26, CR_S2, { walk: true }),
    ...table(0, 0, 7, 7, 4.4, CR_S, CR_A),
    // ramps up onto the crossing from all four sides
    slope(0, 0, -18, 'z', 9, 2, 8, 1, CR_S2), slope(0, 0, 18, 'z', 9, 2, 8, -1, CR_S2),
    slope(-18, 0, 0, 'x', 9, 2, 8, 1, CR_S2), slope(18, 0, 0, 'x', 9, 2, 8, -1, CR_S2),
    // corner blockhouses with walkable roofs
    B(-22, 3, -22, 12, 6, 12, CR_S, { walk: true }), B(22, 3, 22, 12, 6, 12, CR_S, { walk: true }),
    B(22, 3, -22, 10, 6, 10, CR_S2, { walk: true }), B(-22, 3, 22, 10, 6, 10, CR_S2, { walk: true }),
    slope(-22, 0, -14, 'z', 8, 6, 5, -1, CR_A), slope(22, 0, 14, 'z', 8, 6, 5, 1, CR_A),
    // hedgerow cover along the lanes
    B(-12, 1.2, -32, 8, 2.4, 2.2, CR_G2), B(12, 1.2, 32, 8, 2.4, 2.2, CR_G2),
    B(32, 1.2, -12, 2.2, 2.4, 8, CR_G2), B(-32, 1.2, 12, 2.2, 2.4, 8, CR_G2),
    B(-14, 1.4, 8, 3, 2.8, 3, CR_A), B(14, 1.4, -8, 3, 2.8, 3, CR_A),
    B(8, 1.4, 16, 3, 2.8, 3, CR_A), B(-8, 1.4, -16, 3, 2.8, 3, CR_A),
    B(-34, 0.05, -34, 6, 0.1, 6, TEAM_A, { glow: true }), B(34, 0.05, 34, 6, 0.1, 6, TEAM_B, { glow: true }),
  ],
  spawnsA: [{ x: -34, z: -34, ry: -2.36 }, { x: -30, z: -36, ry: -2.2 }],
  spawnsB: [{ x: 34, z: 34, ry: 0.78 }, { x: 30, z: 36, ry: 0.94 }],
};

// ---- DOCKS: stacked containers on a quay ----
const DK_C1 = '#e08a3c', DK_C2 = '#3b7fc4', DK_C3 = '#d6503f', DK_C4 = '#4aa86a';
const DK_S = '#cdd5df', DK_S2 = '#b4bdc9', DK_W = '#5f7f9c';
export const DOCKS = {
  id: 'docks', name: 'Docks',
  sky: '#cfe3f4', sky2: ['#6aa8dd', '#a6cbe6', '#e6f0f7'], fog: 0.004, clouds: true,
  ground: { color: '#c3ccd6', sizeX: 84, sizeZ: 84, thick: 3, tex: ['#c8d1da', 'rgba(70,90,110,0.30)', 'rgba(200,225,245,0.10)'] },
  emblem: '#5f7f9c',
  boxes: [
    B(0, 6, -42, 84, 12, 1.4, DK_S), B(0, 6, 42, 84, 12, 1.4, DK_S),
    B(-42, 6, 0, 1.4, 12, 84, DK_S), B(42, 6, 0, 1.4, 12, 84, DK_S),
    // container stacks — walkable tops, staggered so you can climb them
    B(-14, 1.6, -10, 12, 3.2, 5, DK_C1, { walk: true }), B(14, 1.6, 10, 12, 3.2, 5, DK_C1, { walk: true }),
    B(-14, 4.8, -10, 10, 3.2, 4.6, DK_C2, { walk: true }), B(14, 4.8, 10, 10, 3.2, 4.6, DK_C2, { walk: true }),
    B(-6, 1.6, 6, 5, 3.2, 12, DK_C3, { walk: true }), B(6, 1.6, -6, 5, 3.2, 12, DK_C3, { walk: true }),
    B(20, 1.6, -20, 12, 3.2, 5, DK_C4, { walk: true }), B(-20, 1.6, 20, 12, 3.2, 5, DK_C4, { walk: true }),
    B(20, 4.8, -20, 8, 3.2, 4.6, DK_C1, { walk: true }), B(-20, 4.8, 20, 8, 3.2, 4.6, DK_C1, { walk: true }),
    B(28, 1.6, 8, 5, 3.2, 14, DK_C2, { walk: true }), B(-28, 1.6, -8, 5, 3.2, 14, DK_C2, { walk: true }),
    // the quay: a long raised platform down the middle
    B(0, 1.0, 0, 30, 2, 8, DK_S2, { walk: true }),
    slope(-19, 0, 0, 'x', 8, 2, 7, 1, DK_S2), slope(19, 0, 0, 'x', 8, 2, 7, -1, DK_S2),
    // bollards / crates
    B(-32, 1.2, 30, 3, 2.4, 3, DK_S2), B(32, 1.2, -30, 3, 2.4, 3, DK_S2),
    B(8, 1.2, 26, 4, 2.4, 3, DK_W), B(-8, 1.2, -26, 4, 2.4, 3, DK_W),
    B(-30, 0.05, -30, 6, 0.1, 6, TEAM_A, { glow: true }), B(30, 0.05, 30, 6, 0.1, 6, TEAM_B, { glow: true }),
  ],
  spawnsA: [{ x: -30, z: -30, ry: -2.36 }, { x: -34, z: -27, ry: -2.5 }],
  spawnsB: [{ x: 30, z: 30, ry: 0.78 }, { x: 34, z: 27, ry: 0.64 }],
};

// ---- STATION: a covered platform hall, trains either side ----
const ST_W = '#d8ccc2', ST_W2 = '#c2b4a8', ST_R = '#9c4a3c', ST_M = '#6f7b88', ST_T = '#3f4956';
export const STATION = {
  id: 'station', name: 'Station',
  sky: '#e0dcd6', sky2: ['#b9b2a8', '#d3cdc4', '#eeeae4'], fog: 0.009,
  ground: { color: '#cfc6bc', sizeX: 70, sizeZ: 92, thick: 3, tex: ['#d4cbc1', 'rgba(80,66,54,0.28)', 'rgba(255,244,230,0.10)'] },
  emblem: '#9c4a3c',
  ceiling: { y: 15, color: '#b9b2a8' },
  boxes: [
    B(0, 7.5, -46, 70, 15, 1.4, ST_W), B(0, 7.5, 46, 70, 15, 1.4, ST_W),
    B(-35, 7.5, 0, 1.4, 15, 92, ST_R), B(35, 7.5, 0, 1.4, 15, 92, ST_R),
    // two train bodies flanking the platform — walkable roofs
    B(-22, 2.2, -12, 8, 4.4, 40, ST_T, { walk: true }), B(22, 2.2, 12, 8, 4.4, 40, ST_T, { walk: true }),
    B(-22, 4.7, -12, 8.6, 0.6, 40, ST_M), B(22, 4.7, 12, 8.6, 0.6, 40, ST_M),
    // platform edge strips
    B(-15, 0.6, 0, 3, 1.2, 88, ST_W2, { walk: true }), B(15, 0.6, 0, 3, 1.2, 88, ST_W2, { walk: true }),
    // roof pillars down the middle
    B(-6, 5, -28, 1.6, 10, 1.6, ST_M), B(6, 5, -28, 1.6, 10, 1.6, ST_M),
    B(-6, 5, 0, 1.6, 10, 1.6, ST_M), B(6, 5, 0, 1.6, 10, 1.6, ST_M),
    B(-6, 5, 28, 1.6, 10, 1.6, ST_M), B(6, 5, 28, 1.6, 10, 1.6, ST_M),
    // benches / kiosks as cover
    B(0, 1.3, -18, 7, 2.6, 3, ST_W2), B(0, 1.3, 18, 7, 2.6, 3, ST_W2),
    B(-9, 1.1, 8, 3, 2.2, 3, ST_R), B(9, 1.1, -8, 3, 2.2, 3, ST_R),
    ...table(0, 0, 8, 6, 3.2, ST_W2, ST_M),
    slope(-11, 0, -34, 'z', 8, 4.4, 5, 1, ST_M), slope(11, 0, 34, 'z', 8, 4.4, 5, -1, ST_M),
    B(0, 0.05, -40, 7, 0.1, 6, TEAM_A, { glow: true }), B(0, 0.05, 40, 7, 0.1, 6, TEAM_B, { glow: true }),
  ],
  spawnsA: [{ x: -2, z: -40, ry: Math.PI }, { x: 2, z: -40, ry: Math.PI }],
  spawnsB: [{ x: 2, z: 40, ry: 0 }, { x: -2, z: 40, ry: 0 }],
};

// ---- CONSTRUCTION: scaffolding and half-built floors ----
const CN_F = '#d9dee6', CN_S = '#e8a13a', CN_B = '#9aa3ad', CN_D = '#7a828d', CN_W = '#c9a06a';
export const CONSTRUCTION = {
  id: 'construction', name: 'Construction',
  sky: '#dce6f0', sky2: ['#8ab4dd', '#bcd4e9', '#eef4fa'], fog: 0.005, clouds: true,
  ground: { color: '#cdd3db', sizeX: 76, sizeZ: 76, thick: 3, tex: ['#d2d8e0', 'rgba(70,80,95,0.26)', 'rgba(220,235,250,0.10)'] },
  emblem: '#e8a13a',
  boxes: [
    B(0, 7, -38, 76, 14, 1.4, CN_F), B(0, 7, 38, 76, 14, 1.4, CN_F),
    B(-38, 7, 0, 1.4, 14, 76, CN_F), B(38, 7, 0, 1.4, 14, 76, CN_F),
    // a half-built two-storey block in the middle
    B(0, 3.2, 0, 22, 0.7, 22, CN_B, { walk: true }),          // first floor slab
    B(-10, 1.6, -10, 1.4, 3.2, 1.4, CN_D), B(10, 1.6, -10, 1.4, 3.2, 1.4, CN_D),
    B(-10, 1.6, 10, 1.4, 3.2, 1.4, CN_D), B(10, 1.6, 10, 1.4, 3.2, 1.4, CN_D),
    B(0, 1.6, 0, 1.4, 3.2, 1.4, CN_D),
    B(0, 6.6, 0, 14, 0.7, 14, CN_B, { walk: true }),           // second floor
    B(-6, 5.0, -6, 1.2, 3.0, 1.2, CN_D), B(6, 5.0, 6, 1.2, 3.0, 1.2, CN_D),
    // ramps up to the first floor, mirrored
    slope(-16, 0, 6, 'z', 12, 3.5, 5, -1, CN_S), slope(16, 0, -6, 'z', 12, 3.5, 5, 1, CN_S),
    // scaffold towers in opposite corners
    B(-26, 2, -26, 8, 0.6, 8, CN_S, { walk: true }), B(26, 2, 26, 8, 0.6, 8, CN_S, { walk: true }),
    B(-26, 5, -26, 8, 0.6, 8, CN_S, { walk: true }), B(26, 5, 26, 8, 0.6, 8, CN_S, { walk: true }),
    slope(-26, 0, -19, 'z', 7, 2, 4, -1, CN_D), slope(26, 0, 19, 'z', 7, 2, 4, 1, CN_D),
    // pipe stacks and material piles
    B(24, 1.2, -18, 6, 2.4, 3, CN_W), B(-24, 1.2, 18, 6, 2.4, 3, CN_W),
    B(-16, 1.2, -22, 3, 2.4, 6, CN_W), B(16, 1.2, 22, 3, 2.4, 6, CN_W),
    B(8, 1.5, -26, 4, 3, 3, CN_B), B(-8, 1.5, 26, 4, 3, 3, CN_B),
    B(-30, 0.05, -30, 6, 0.1, 6, TEAM_A, { glow: true }), B(30, 0.05, 30, 6, 0.1, 6, TEAM_B, { glow: true }),
  ],
  spawnsA: [{ x: -30, z: -30, ry: -2.36 }, { x: -33, z: -27, ry: -2.5 }],
  spawnsB: [{ x: 30, z: 30, ry: 0.78 }, { x: 33, z: 27, ry: 0.64 }],
};

// ---- ONYX: the dark one, lit by its own edges ----
const OX_D = '#22262e', OX_D2 = '#2c313b', OX_D3 = '#3a414f', OX_N = '#57e0ff', OX_N2 = '#c17bff';
export const ONYX = {
  id: 'onyx', name: 'Onyx',
  sky: '#0d1016', sky2: ['#0a0d13', '#141924', '#232a38'], fog: 0.012,
  ground: { color: '#1b1f26', sizeX: 60, sizeZ: 76, thick: 3, tex: ['#1e222a', 'rgba(0,0,0,0.5)', 'rgba(90,200,255,0.10)'] },
  emblem: '#57e0ff',
  boxes: [
    B(0, 7, -38, 60, 14, 1.2, OX_D), B(0, 7, 38, 60, 14, 1.2, OX_D),
    B(-30, 7, 0, 1.2, 14, 76, OX_D), B(30, 7, 0, 1.2, 14, 76, OX_D),
    // centre dais with neon rim
    ...table(0, 0, 9, 7, 3.6, OX_D2, OX_D),
    B(0, 3.72, 0, 9.4, 0.12, 7.4, OX_N, { glow: true }),
    // monolith cover, mirrored
    B(-8, 2.4, -8, 3, 4.8, 3, OX_D2), B(8, 2.4, 8, 3, 4.8, 3, OX_D2),
    B(-13, 1.8, 4, 5, 3.6, 2.4, OX_D2, { ry: 0.5 }), B(13, 1.8, -4, 5, 3.6, 2.4, OX_D2, { ry: 0.5 }),
    B(-20, 3.0, -14, 3, 6, 3, OX_D2), B(20, 3.0, 14, 3, 6, 3, OX_D2),
    B(-6, 1.6, 18, 6, 3.2, 3, OX_D2), B(6, 1.6, -18, 6, 3.2, 3, OX_D2),
    B(18, 2.0, -24, 4, 4, 4, OX_D2), B(-18, 2.0, 24, 4, 4, 4, OX_D2),
    // neon floor strips marking the lanes
    B(-14, 0.05, 0, 0.4, 0.1, 60, OX_N2, { glow: true }), B(14, 0.05, 0, 0.4, 0.1, 60, OX_N2, { glow: true }),
    slope(-22, 0, 20, 'z', 12, 4, 5, -1, OX_D2), slope(22, 0, -20, 'z', 12, 4, 5, 1, OX_D2),
    B(-22, 0.05, -30, 6, 0.1, 6, TEAM_A, { glow: true }), B(22, 0.05, 30, 6, 0.1, 6, TEAM_B, { glow: true }),
  ],
  spawnsA: [{ x: -22, z: -30, ry: -2.5 }, { x: -18, z: -32, ry: -2.36 }],
  spawnsB: [{ x: 22, z: 30, ry: 0.64 }, { x: 18, z: 32, ry: 0.78 }],
};

export const MAPS = { arena: ARENA, battleground: BATTLEGROUND, backrooms: BACKROOMS, crossroads: CROSSROADS, docks: DOCKS, station: STATION, construction: CONSTRUCTION, onyx: ONYX, frontier: FRONTIER, colossus: COLOSSUS };
export const WAVE_MAPS = ['frontier', 'colossus'];
export const VOTE_OPTIONS = ['random', 'arena', 'backrooms', 'crossroads', 'docks', 'station', 'construction', 'onyx'];
