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

// ================= ARENA — white tiled 1v1 box (from the footage) =============
const AR_W = '#e8eaee', AR_W2 = '#d5d9df', AR_ACC = '#c8cdd6';
export const ARENA = {
  id: 'arena', name: 'Arena', sky: '#bfd9ee', fog: 0.012,
  ground: { color: '#eef0f4', size: 64 },
  boxes: [
    // outer walls
    B(0, 4, -15, 46, 8, 1, AR_W), B(0, 4, 15, 46, 8, 1, AR_W),
    B(-23, 4, 0, 1, 8, 31, AR_W), B(23, 4, 0, 1, 8, 31, AR_W),
    // center monolith + flanks
    B(0, 1.75, 0, 6, 3.5, 2, AR_W2),
    B(0, 4.1, 0, 6, 1.2, 2, AR_ACC),
    B(-9, 1.25, -6, 4, 2.5, 4, AR_W2), B(9, 1.25, 6, 4, 2.5, 4, AR_W2),
    B(-9, 1.0, 7, 3, 2, 3, AR_ACC), B(9, 1.0, -7, 3, 2, 3, AR_ACC),
    // side platforms + their stairs
    B(-17, 1.5, 0, 8, 3, 10, AR_W2, { walk: true }),
    B(17, 1.5, 0, 8, 3, 10, AR_W2, { walk: true }),
    ...ramp(-12.5, 0, -8, 'x', 6, 4, AR_ACC).map((b) => ({ ...b, x: -12.5 - (b.x + 12.5) })), // rise toward -x
    ...ramp(12.5, 0, 8, 'x', 6, 4, AR_ACC),
    // scattered low cover
    B(-4, 0.75, 10, 3, 1.5, 1.5, AR_ACC), B(4, 0.75, -10, 3, 1.5, 1.5, AR_ACC),
    B(0, 0.6, -7.5, 2, 1.2, 2, AR_W2), B(0, 0.6, 7.5, 2, 1.2, 2, AR_W2),
  ],
  // ry chosen so spawns FACE the arena centre (forward = (-sin ry, -cos ry))
  spawnsA: [{ x: -20, z: -11, ry: -2.07 }, { x: -20, z: 11, ry: -1.07 }],
  spawnsB: [{ x: 20, z: 11, ry: 1.07 }, { x: 20, z: -11, ry: 2.07 }],
};

// ============ BATTLEGROUND — outdoor industrial (purple walls, crates) ========
const BG_P = '#8a4fd0', BG_P2 = '#6d3ba8', BG_G = '#9aa3ad', BG_C = '#c9a86a', BG_B = '#5e6773';
export const BATTLEGROUND = {
  id: 'battleground', name: 'Battleground', sky: '#7fb8e8', fog: 0.008,
  ground: { color: '#79a860', size: 84 },
  boxes: [
    // perimeter
    B(0, 5, -21, 60, 10, 1.5, BG_P), B(0, 5, 21, 60, 10, 1.5, BG_P),
    B(-30, 5, 0, 1.5, 10, 43, BG_P2), B(30, 5, 0, 1.5, 10, 43, BG_P2),
    // two buildings
    B(-14, 3, -10, 12, 6, 9, BG_G, { walk: true }),
    B(14, 3, 10, 12, 6, 9, BG_G, { walk: true }),
    B(-14, 6.6, -10, 13, 1.2, 10, BG_B), B(14, 6.6, 10, 13, 1.2, 10, BG_B),
    ...ramp(-7, 0, -14.5, 'x', 12, 3, BG_B), // stairs up to left building roof
    ...ramp(7, 0, 14.5, 'x', 12, 3, BG_B).map((b) => ({ ...b, x: 7 - (b.x - 7) })),
    // crate yards (cover)
    B(0, 1, 0, 2.2, 2, 2.2, BG_C), B(2.4, 0.75, 0.6, 1.5, 1.5, 1.5, BG_C),
    B(-3, 1.4, 3, 2, 2.8, 2, BG_C), B(6, 1, -5, 2.2, 2, 2.2, BG_C),
    B(-8, 1, 8, 2.2, 2, 2.2, BG_C), B(9, 1.6, 3, 2, 3.2, 2, BG_G),
    B(-19, 1, 6, 3, 2, 2, BG_C), B(19, 1, -6, 3, 2, 2, BG_C),
    // long pipe rack mid (like the footage's silver pipe)
    B(0, 2.6, -13, 16, 0.7, 0.7, '#c8ccd4'),
    B(-7, 1.3, -13, 0.6, 2.6, 0.6, BG_B), B(7, 1.3, -13, 0.6, 2.6, 0.6, BG_B),
  ],
  spawnsA: [{ x: -26, z: 14, ry: -1.08 }, { x: -26, z: -14, ry: -2.06 }],
  spawnsB: [{ x: 26, z: -14, ry: 2.06 }, { x: 26, z: 14, ry: 1.08 }],
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
