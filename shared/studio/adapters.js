// Adapters: convert a generic ClaudeBox Studio level into the bespoke world
// format each game's engine already understands. This is how a level designed in
// the editor becomes "live" inside a real game.

// ---- Obby: course = { platforms, checkpoints, movers, spinners, killY, finishStage, length, start } ----
// Studio box/ramp/cylinder/sphere → Obby axis-aligned platforms (box top = y+h/2).
// Triggers: kill→lava platform, finish→finish platform, checkpoint→checkpoint,
// move→oscillating mover. (Obby is jump-based, so trampoline/launch/etc. just act
// as normal platforms.)
export function toObbyCourse(level) {
  if (!level || !Array.isArray(level.parts) || !level.parts.length) return null;
  const platforms = [], checkpoints = [], movers = [];
  const sp = level.spawn || { x: 0, y: 4, z: 0 };
  const start = { x: sp.x, y: sp.y, z: sp.z };
  checkpoints.push({ x: start.x, y: start.y, z: start.z, n: 0 });

  let minBottom = Infinity, maxX = 0;
  const cpParts = [], finishParts = [];
  for (const p of level.parts) {
    const has = (t) => p.behaviors?.some((b) => b.type === t);
    const move = p.behaviors?.find((b) => b.type === 'move');
    const kind = has('finish') ? 'finish' : has('kill') ? 'kill' : 'normal';
    if (!p.solid && kind === 'normal') continue;   // pure decoration
    const o = { x: p.pos[0], y: p.pos[1], z: p.pos[2], w: p.size[0], h: p.size[1], d: p.size[2], color: p.color, kind };
    if (move) movers.push({ ...o, axis: move.axis === 'y' ? 'y' : move.axis === 'z' ? 'z' : 'x', range: move.dist, speed: move.speed, phase: 0 });
    else platforms.push(o);
    minBottom = Math.min(minBottom, p.pos[1] - p.size[1] / 2);
    maxX = Math.max(maxX, Math.abs(p.pos[0]) + p.size[0]);
    if (has('checkpoint')) cpParts.push(p);
    if (has('finish')) finishParts.push(p);
  }
  // numbered checkpoints, then finish as the final stage
  cpParts.forEach((p, i) => checkpoints.push({ x: p.pos[0], y: p.pos[1] + p.size[1] / 2 + 1, z: p.pos[2], n: i + 1 }));
  const finishStage = cpParts.length + 1;
  finishParts.forEach((p) => checkpoints.push({ x: p.pos[0], y: p.pos[1] + p.size[1] / 2 + 1, z: p.pos[2], n: finishStage }));

  return {
    platforms, checkpoints, movers, spinners: [],
    killY: (isFinite(minBottom) ? minBottom : 0) - 24,
    finishStage, length: maxX + 20, start,
  };
}

// ---- Wibit: world = { parts, colliders, wiggles, logs, swings, iceberg, spawn } ----
// Studio parts → Wibit prim render parts + colliders (Wibit's supportUnder handles
// box/obox/circle/ramp). Triggers: trampoline→'tramp' (bounce), launch→'blast'
// (catapult). The level floats on Wibit's water — fall off and you swim.
export function toWibitWorld(level) {
  if (!level || !Array.isArray(level.parts) || !level.parts.length) return null;
  const parts = [], colliders = []; let pid = 0;
  const sp = level.spawn || { x: 0, y: 4, z: 0 };
  for (const p of level.parts) {
    const has = (t) => p.behaviors?.some((b) => b.type === t);
    const launch = p.behaviors?.find((b) => b.type === 'launch');
    const tramp = has('trampoline');
    if (!p.solid && !tramp && !launch) continue;
    const [w, h, d] = p.size, [x, y, z] = p.pos, top = y + h / 2;
    parts.push({ id: 'wp' + (pid++), kind: 'prim', shape: p.shape, x, y, z, w, h, d, rotY: p.rotY, color: p.color });
    let kind = 'deck', ref = null;
    if (tramp) kind = 'tramp';
    else if (launch) { kind = 'blast'; ref = { dir: Math.atan2(launch.fz, launch.fx) || 0, vh: Math.hypot(launch.fx, launch.fz), vv: launch.fy }; }
    if (p.shape === 'cylinder') colliders.push({ shape: 'circle', x, z, r: w / 2, top, kind, ref });
    else if (p.shape === 'sphere') colliders.push({ shape: 'circle', x, z, r: w / 2, top: y + w / 2, kind, ref });
    else if (p.shape === 'ramp') colliders.push({ shape: 'ramp', x, z, w: d, len: w, dir: -p.rotY, topHi: y + h / 2, topLo: y - h / 2, kind: 'slide', ref: null });
    else if (p.rotY) colliders.push({ shape: 'obox', x, z, w, d, dir: -p.rotY, top, kind, ref });
    else colliders.push({ shape: 'box', x, z, w, d, top, kind, ref });
  }
  return { parts, colliders, wiggles: [], logs: [], swings: [], iceberg: null, spawn: { x: sp.x, y: sp.y, z: sp.z } };
}
