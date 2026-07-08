// Rivals — map geometry. Pure AABB boxes ({x,y,z} = CENTER, {sx,sy,sz} = full
// size) so the server can do cheap collision + hitscan and the client renders
// the same data. Ramps are stair-stacks of boxes to stay AABB-only.

const B = (x, y, z, sx, sy, sz, color, opts = {}) => ({ x, y, z, sx, sy, sz, color, ...opts });

// stairs from (x,z) rising toward +dir ('x'|'z'), w wide, each step 0.5 tall/1 deep
function ramp(x, y0, z, dir, steps, w, color) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const h = 0.5 * (i + 1);
    if (dir === 'x') out.push(B(x + i, y0 + h / 2, z, 1, h, w, color));
    else out.push(B(x, y0 + h / 2, z + i, w, h, 1, color));
  }
  return out;
}

// ================= ARENA — big white tiled 1v1 box =============
const AR_W = '#e8eaee', AR_W2 = '#d5d9df', AR_ACC = '#c8cdd6';
export const ARENA = {
  id: 'arena', name: 'Arena', sky: '#bfd9ee', fog: 0.009,
  ground: { color: '#eef0f4', size: 96 },
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
    ...ramp(-19.5, 0, -12, 'x', 6, 5, AR_ACC).map((b) => ({ ...b, x: -19.5 - (b.x + 19.5) })),
    ...ramp(19.5, 0, 12, 'x', 6, 5, AR_ACC),
    // scattered cover across the bigger floor
    B(-6, 0.75, 15, 4, 1.5, 2, AR_ACC), B(6, 0.75, -15, 4, 1.5, 2, AR_ACC),
    B(0, 0.6, -11, 2.5, 1.2, 2.5, AR_W2), B(0, 0.6, 11, 2.5, 1.2, 2.5, AR_W2),
    B(-20, 1, -17, 3, 2, 3, AR_W2), B(20, 1, 17, 3, 2, 3, AR_W2),
    B(-8, 0.9, -5, 2, 1.8, 2, AR_ACC), B(8, 0.9, 5, 2, 1.8, 2, AR_ACC),
    B(-27, 0.9, 16, 3, 1.8, 2, AR_ACC), B(27, 0.9, -16, 3, 1.8, 2, AR_ACC),
    B(0, 1.4, -18.5, 5, 2.8, 1.5, AR_W2), B(0, 1.4, 18.5, 5, 2.8, 1.5, AR_W2),
  ],
  // ry chosen so spawns FACE the arena centre (forward = (-sin ry, -cos ry))
  spawnsA: [{ x: -31, z: -17, ry: -2.07 }, { x: -31, z: 17, ry: -1.07 }],
  spawnsB: [{ x: 31, z: 17, ry: 1.07 }, { x: 31, z: -17, ry: 2.07 }],
};

// ============ BATTLEGROUND — big outdoor industrial ========
const BG_P = '#8a4fd0', BG_P2 = '#6d3ba8', BG_G = '#9aa3ad', BG_C = '#c9a86a', BG_B = '#5e6773';
export const BATTLEGROUND = {
  id: 'battleground', name: 'Battleground', sky: '#7fb8e8', fog: 0.006,
  ground: { color: '#79a860', size: 124 },
  boxes: [
    // perimeter
    B(0, 5, -31, 90, 10, 1.5, BG_P), B(0, 5, 31, 90, 10, 1.5, BG_P),
    B(-45, 5, 0, 1.5, 10, 63, BG_P2), B(45, 5, 0, 1.5, 10, 63, BG_P2),
    // two buildings (walkable roofs)
    B(-21, 3, -15, 16, 6, 12, BG_G, { walk: true }),
    B(21, 3, 15, 16, 6, 12, BG_G, { walk: true }),
    B(-21, 6.6, -15, 17, 1.2, 13, BG_B), B(21, 6.6, 15, 17, 1.2, 13, BG_B),
    ...ramp(-11, 0, -21, 'x', 12, 3.5, BG_B),
    ...ramp(11, 0, 21, 'x', 12, 3.5, BG_B).map((b) => ({ ...b, x: 11 - (b.x - 11) })),
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

export const MAPS = { arena: ARENA, battleground: BATTLEGROUND };
export const VOTE_OPTIONS = ['random', 'arena', 'battleground'];
