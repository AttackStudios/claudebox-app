// Obby course: a chain of stages running along +X over a void. Platforms are
// axis-aligned boxes you land on top of; checkpoints save your respawn; kill
// bricks (lava) and falling below killY send you back. Movers + spinners are
// computed from a shared clock so server and clients agree. All data here is
// deterministic so every client builds the identical course.

export const KILL_Y = -22;
export const FINISH_STAGE = 13;

// palette cycled per stage so progress reads at a glance
const STAGE_COLORS = ['#e8563f', '#e88c3f', '#e8c93f', '#8fd64b', '#4bd6a0',
  '#4bb6e8', '#5a7be8', '#8c5ae8', '#d65ad6', '#e85a8c', '#5fd6d6', '#9ad64b', '#e8a23f'];

const platforms = [];   // {x,y,z,w,h,d,color,kind}  kind: 'normal'|'kill'|'finish'|'start'
const checkpoints = [];  // {x,y,z,n}  respawn pads
const movers = [];      // {x,y,z,w,h,d,color,axis,range,speed,phase}
const spinners = [];    // {x,y,z,r,len,h,color,speed}

const COL = (kind, stage) => kind === 'kill' ? '#c0241a'
  : kind === 'finish' ? '#ffd84a'
  : kind === 'start' ? '#dfe7f0'
  : STAGE_COLORS[stage % STAGE_COLORS.length];

let cx = 0;             // build cursor (x), y, last stage color index
function pad(x, y, z, w, d, kind, stage) {
  const p = { x, y, z, w, h: 1, d, color: COL(kind, stage), kind: kind || 'normal' };
  platforms.push(p);
  return p;
}
function checkpoint(x, y, z, n) {
  pad(x, y, z, 7, 7, 'normal', n - 1);
  checkpoints.push({ x, y: y + 1, z, n });
}

// ---- start platform + checkpoint 0 ----
pad(0, 0, 0, 12, 12, 'start', 0);
checkpoints.push({ x: 0, y: 1, z: 0, n: 0 });
export const START = { x: 0, y: 2.2, z: 0 };
cx = 10;

// deterministic little PRNG so the layout is fixed but varied
let seed = 1337;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// stage builders -----------------------------------------------------------
function gapJumps(stage, count, y) {
  for (let i = 0; i < count; i++) {
    cx += 5 + rnd() * 2.5;
    const z = (rnd() * 2 - 1) * 4;
    pad(cx, y, z, 3.4, 3.4, 'normal', stage);
  }
  cx += 6;
}
function narrowBeam(stage, y) {
  cx += 5;
  const len = 22;
  pad(cx + len / 2, y, 0, len, 1.6, 'normal', stage);
  cx += len + 5;
}
function lavaLeap(stage, y) {
  for (let i = 0; i < 3; i++) {
    cx += 4.5;
    pad(cx, y, (rnd() * 2 - 1) * 3, 3, 3, 'normal', stage);
    // a kill brick beside the safe one
    pad(cx, y, (rnd() < 0.5 ? 4 : -4), 3, 3, 'kill', stage);
  }
  cx += 6;
}
function staircase(stage, y, up) {
  for (let i = 0; i < 6; i++) {
    cx += 3.2;
    pad(cx, y + i * up, 0, 3, 4, 'normal', stage);
  }
  return y + 5 * up;
}
function moverRow(stage, y, axis) {
  for (let i = 0; i < 2; i++) {
    cx += 8;
    movers.push({
      x: cx, y, z: axis === 'z' ? 0 : 0, w: 4, h: 1, d: 4,
      color: COL('normal', stage), axis, range: 6, speed: 1.1 + rnd() * 0.5, phase: rnd() * 6.28,
    });
  }
  cx += 8;
}
function spinnerGauntlet(stage, y) {
  const len = 26;
  pad(cx + len / 2 + 3, y, 0, len, 6, 'normal', stage);     // wide floor under the spinners
  for (let i = 0; i < 3; i++) {
    cx += 7;
    spinners.push({ x: cx, y: y + 1.4, z: 0, r: 5.2, len: 10.4, h: 0.7, color: '#2b2f38', speed: (i % 2 ? -1 : 1) * (1.4 + rnd() * 0.6) });
  }
  cx += 10;
}

// ---- assemble the 13 stages, checkpoint between each ----
let y = 0;
const STAGES = [
  () => gapJumps(1, 4, y),
  () => narrowBeam(2, y),
  () => lavaLeap(3, y),
  () => { y = staircase(4, y, 1.2); },
  () => moverRow(5, y, 'z'),
  () => gapJumps(6, 5, y),
  () => spinnerGauntlet(7, y),
  () => lavaLeap(8, y),
  () => moverRow(9, y, 'y' === 'y' ? 'z' : 'z'),
  () => { y = staircase(10, y, -0.8); },
  () => narrowBeam(11, y),
  () => gapJumps(12, 6, y),
  () => spinnerGauntlet(13, y),
];
STAGES.forEach((build, i) => {
  build();
  const n = i + 1;
  cx += 4;
  if (n === FINISH_STAGE) {
    pad(cx + 6, y, 0, 14, 14, 'finish', n);
    checkpoints.push({ x: cx + 6, y: y + 1, z: 0, n });
    cx += 14;
  } else {
    checkpoint(cx, y, 0, n);
    cx += 7;
  }
});

export const COURSE = { platforms, checkpoints, movers, spinners, killY: KILL_Y, finishStage: FINISH_STAGE, length: cx };

// Replace the live course with a custom one (e.g. from ClaudeBox Studio). Mutates
// the shared COURSE/START objects IN PLACE so every module that imported them
// (client renderer + physics, server protocol) sees the new course. Array
// contents are swapped in place so checkpointById (which closes over the local
// `checkpoints` array) stays correct.
// pristine default snapshot so saving an empty level reverts to the built-in course
const _DEFAULT = {
  platforms: [...platforms], checkpoints: [...checkpoints], movers: [...movers], spinners: [...spinners],
  killY: COURSE.killY, finishStage: COURSE.finishStage, length: COURSE.length,
  start: { x: START.x, y: START.y, z: START.z },
};
export function applyCourse(c) {
  const src = c || _DEFAULT;   // null/empty → restore the default course
  const swap = (arr, next) => { arr.length = 0; for (const x of (next || [])) arr.push(x); };
  swap(platforms, src.platforms); swap(checkpoints, src.checkpoints);
  swap(movers, src.movers); swap(spinners, src.spinners);
  COURSE.killY = src.killY; COURSE.finishStage = src.finishStage; COURSE.length = src.length;
  if (src.start) { START.x = src.start.x; START.y = src.start.y; START.z = src.start.z; }
}

// current world position of a mover at time t (seconds)
export function moverPos(m, t) {
  const off = Math.sin(t * m.speed + m.phase) * m.range;
  return {
    x: m.x + (m.axis === 'x' ? off : 0),
    y: m.y + (m.axis === 'y' ? off : 0),
    z: m.z + (m.axis === 'z' ? off : 0),
  };
}

// spinner bar angle at time t
export function spinAngle(s, t) { return t * s.speed; }

// highest checkpoint at or before a given progress, used for respawn ordering
export function checkpointById(n) {
  return checkpoints.find((c) => c.n === n) || checkpoints[0];
}
