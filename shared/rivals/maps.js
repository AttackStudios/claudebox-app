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

// ================= ARENA — bright white box with team-colour trim =====
const AR_W = '#eef1f6', AR_W2 = '#d9dee6', AR_ACC = '#c6ccd6';
const TEAM_A = '#2fa4ff', TEAM_B = '#ff7a34';   // blue side vs orange side
export const ARENA = {
  id: 'arena', name: 'Arena',
  sky: '#cfe3f4', sky2: ['#7db9ec', '#b7d8f0', '#e8f1f8'], fog: 0.008,
  ground: { color: '#e9edf3', size: 96, tex: ['#e9edf3', 'rgba(110,125,150,0.30)', 'rgba(140,190,255,0.18)'] },
  emblem: '#2fa4ff',
  boxes: [
    // outer walls
    B(0, 4.5, -23, 70, 9, 1, AR_W), B(0, 4.5, 23, 70, 9, 1, AR_W),
    B(-35, 4.5, 0, 1, 9, 47, AR_W), B(35, 4.5, 0, 1, 9, 47, AR_W),
    // center monolith + flanks
    B(0, 1.75, 0, 8, 3.5, 2.5, AR_W2),
    B(0, 4.1, 0, 8, 1.2, 2.5, AR_ACC),
    B(-13, 1.25, -9, 5, 2.5, 5, AR_W2), B(13, 1.25, 9, 5, 2.5, 5, AR_W2),
    B(-13, 1.0, 10, 4, 2, 4, AR_ACC), B(13, 1.0, -10, 4, 2, 4, AR_ACC),
    // side platforms + their stairs
    B(-26, 1.5, 0, 10, 3, 14, AR_W2, { walk: true }),
    B(26, 1.5, 0, 10, 3, 14, AR_W2, { walk: true }),
    slope(-22, 0, -12, 'x', 6, 3, 5, -1, AR_ACC),
    slope(22, 0, 12, 'x', 6, 3, 5, 1, AR_ACC),
    // scattered cover across the bigger floor
    B(-6, 0.75, 15, 4, 1.5, 2, AR_ACC), B(6, 0.75, -15, 4, 1.5, 2, AR_ACC),
    B(0, 0.6, -11, 2.5, 1.2, 2.5, AR_W2), B(0, 0.6, 11, 2.5, 1.2, 2.5, AR_W2),
    B(-20, 1, -17, 3, 2, 3, AR_W2), B(20, 1, 17, 3, 2, 3, AR_W2),
    B(-8, 0.9, -5, 2, 1.8, 2, AR_ACC), B(8, 0.9, 5, 2, 1.8, 2, AR_ACC),
    B(-27, 0.9, 16, 3, 1.8, 2, AR_ACC), B(27, 0.9, -16, 3, 1.8, 2, AR_ACC),
    B(0, 1.4, -18.5, 5, 2.8, 1.5, AR_W2), B(0, 1.4, 18.5, 5, 2.8, 1.5, AR_W2),
    // ---- decorative emissive trim (glow → not solid) ----
    // wall-top neon, team-coloured per side (blue west, orange east)
    B(-17.5, 9.05, -23, 34, 0.32, 0.5, TEAM_A, { glow: true }), B(17.5, 9.05, -23, 34, 0.32, 0.5, TEAM_B, { glow: true }),
    B(-17.5, 9.05, 23, 34, 0.32, 0.5, TEAM_A, { glow: true }), B(17.5, 9.05, 23, 34, 0.32, 0.5, TEAM_B, { glow: true }),
    B(-35, 9.05, 0, 0.5, 0.32, 46, TEAM_A, { glow: true }), B(35, 9.05, 0, 0.5, 0.32, 46, TEAM_B, { glow: true }),
    // glowing corner posts
    B(-35, 9.3, -23, 1.1, 0.7, 1.1, TEAM_A, { glow: true }), B(-35, 9.3, 23, 1.1, 0.7, 1.1, TEAM_A, { glow: true }),
    B(35, 9.3, -23, 1.1, 0.7, 1.1, TEAM_B, { glow: true }), B(35, 9.3, 23, 1.1, 0.7, 1.1, TEAM_B, { glow: true }),
    // platform inner-edge light lines + monolith crown
    B(-21, 3.06, 0, 0.3, 0.16, 14, TEAM_A, { glow: true }), B(21, 3.06, 0, 0.3, 0.16, 14, TEAM_B, { glow: true }),
    B(0, 4.76, 0, 8.1, 0.16, 2.6, '#eaf4ff', { glow: true }),
  ],
  // ry chosen so spawns FACE the arena centre (forward = (-sin ry, -cos ry))
  spawnsA: [{ x: -31, z: -17, ry: -2.07 }, { x: -31, z: 17, ry: -1.07 }],
  spawnsB: [{ x: 31, z: 17, ry: 1.07 }, { x: 31, z: -17, ry: 2.07 }],
};

// ============ BATTLEGROUND — big outdoor industrial ========
const BG_P = '#8a4fd0', BG_P2 = '#6d3ba8', BG_G = '#9aa3ad', BG_C = '#c69a5a', BG_B = '#586170';
const BG_NEON = '#c17bff', BG_NEON2 = '#57e0ff';
export const BATTLEGROUND = {
  id: 'battleground', name: 'Battleground',
  sky: '#9cc6ee', sky2: ['#4f96e4', '#8fc0ee', '#d3e6f6'], fog: 0.006,
  ground: { color: '#6f9e56', size: 124, tex: ['#6f9e56', 'rgba(40,70,30,0.32)', 'rgba(170,215,130,0.14)'] },
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

// ================= LOBBY — neon hub + shooting range =================
const LB_D = '#2a2e38', LB_D2 = '#343947', NEON = '#38b6e8';
export const LOBBY = {
  id: 'lobby', name: 'Lobby', sky: '#12141c', fog: 0.014,
  ground: { color: '#3a3f4c', size: 44 },
  boxes: [
    B(0, 3.5, -14, 30, 7, 1, LB_D), B(0, 3.5, 14, 30, 7, 1, LB_D),
    B(-15, 3.5, 0, 1, 7, 29, LB_D), B(15, 3.5, 0, 1, 7, 29, LB_D2),
    // duel pad plinth
    B(0, 0.15, -8, 6, 0.3, 6, '#101218', { pad: true }),
    // range divider + target wall
    B(5, 1.6, 4, 0.6, 3.2, 12, LB_D2),
    B(12, 2.2, 4, 0.8, 4.4, 14, LB_D),
    // neon trims (client renders emissive)
    B(0, 6.6, -13.7, 30, 0.15, 0.15, NEON, { glow: true }),
    B(0, 0.06, -8, 6.4, 0.12, 6.4, NEON, { glow: true }),
    B(11.5, 4.3, 4, 0.15, 0.15, 13, '#ff7eb6', { glow: true }),
  ],
  // shooting-range dummies (client-side breakables)
  targets: [
    { x: 10.9, y: 1.1, z: 0 }, { x: 10.9, y: 2.2, z: 3 },
    { x: 10.9, y: 1.4, z: 6 }, { x: 10.9, y: 2.6, z: 8.5 },
  ],
  spawnsA: [{ x: -6, z: 8, ry: -0.36 }],   // facing the duel pad
  spawnsB: [{ x: -6, z: 8, ry: -0.36 }],
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

export const MAPS = { arena: ARENA, battleground: BATTLEGROUND, frontier: FRONTIER, colossus: COLOSSUS };
export const WAVE_MAPS = ['frontier', 'colossus'];
export const VOTE_OPTIONS = ['random', 'arena', 'battleground'];
