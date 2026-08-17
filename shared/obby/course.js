// Obby course — a chain of themed stages running along +X over a void.
//
// Built to the classic obstacle-course shape: every stage ends in a checkpoint
// that becomes your respawn, kill bricks and the void send you back, and the
// difficulty ramps as you climb. Everything here is deterministic (fixed seed,
// clock-driven motion) so the server and every client build an identical course
// and agree on where a moving platform is at any instant.
//
// Obstacle kinds:
//   platform  static box (normal / kill / finish / start / ice / bouncy)
//   mover     slides along one axis on a sine
//   spinner   rotating bar you must duck or ride
//   conveyor  shoves you along while you stand on it
//   blinker   phases in and out; solid only while on
//   pendulum  swinging wrecking ball, lethal on contact
//   laser     beam that toggles, lethal while lit

export const KILL_Y = -26;
export const FINISH_STAGE = 100;   // 100 generated stages, room to grow

// one hue per stage so progress reads at a glance
// Full-saturation primaries, cycled per stage. Deliberately loud — this is the
// bright rainbow-obby look, not a muted one.
const STAGE_COLORS = [
  '#ff2d2d', '#ff7a00', '#ffc400', '#ffee00', '#8cdd00', '#00cc44',
  '#00c8a0', '#00c8ff', '#0080ff', '#2e3bff', '#7a2eff', '#c02eff',
  '#ff2ec0', '#ff2e7a', '#ff5a2e', '#ffa02e', '#e0e000', '#5ae000',
  '#00e0a0', '#00a0ff', '#ffffff',
];
// the rainbow used for striped surfaces and arches
export const RAINBOW = ['#ff2d2d', '#ff7a00', '#ffc400', '#ffee00', '#00cc44', '#00c8ff', '#2e3bff', '#c02eff'];

const platforms = [];
// Walls are the only geometry in the course with SIDE collision. Everything
// else supports you from above only, which is how the original 100 stages were
// tuned — keeping walls separate means adding them can't change any of them.
const walls = [];
const checkpoints = [];
const movers = [];
const spinners = [];
const conveyors = [];
const blinkers = [];
const pendulums = [];
const lasers = [];

const COL = (kind, stage) => kind === 'kill' ? '#c0241a'
  : kind === 'finish' ? '#ffd84a'
  : kind === 'start' ? '#dfe7f0'
  : kind === 'ice' ? '#bfe9ff'
  : kind === 'bouncy' ? '#ff5da8'
  : STAGE_COLORS[stage % STAGE_COLORS.length];

let cx = 0;   // build cursor along +X

function pad(x, y, z, w, d, kind, stage, h = 1) {
  const p = { x, y, z, w, h, d, color: COL(kind, stage), kind: kind || 'normal' };
  platforms.push(p);
  return p;
}
// A wall stands ON the surface: pass the surface height, get a slab whose base
// sits on it. Its top is walkable like any other platform.
function wallBlock(x, base, z, w, h, d, stage) {
  const o = { x, y: base + h / 2, z, w, h, d, color: STAGE_COLORS[stage % STAGE_COLORS.length] };
  walls.push(o);
  return o;
}

function checkpoint(x, y, z, n) {
  pad(x, y, z, 8, 8, 'normal', n);
  // a bright pad you can see from a stage away
  platforms.push({ x, y: y + 0.52, z, w: 6.6, h: 0.24, d: 6.6, color: '#ff2d2d', kind: 'cpEdge' });
  platforms.push({ x, y: y + 0.6, z, w: 5.4, h: 0.24, d: 5.4, color: '#ffffff', kind: 'cp' });
  checkpoints.push({ x, y: y + 1, z, n });
}
const mover = (o) => { movers.push(o); return o; };
const spinner = (o) => { spinners.push(o); return o; };

// deterministic PRNG — fixed layout, varied spacing
let seed = 90210;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ---------------------------------------------------------------- stages
// Each builder advances `cx` and leaves the cursor ready for the checkpoint.

function gapJumps(stage, y, count = 5, size = 3.4) {
  for (let i = 0; i < count; i++) {
    cx += 5.2 + rnd() * 2.4;
    pad(cx, y, (rnd() * 2 - 1) * 4.5, size, size, 'normal', stage);
  }
  cx += 6;
}

function narrowBeam(stage, y, len = 26, w = 1.5) {
  cx += 5;
  const p2 = pad(cx + len / 2, y, 0, len, w, 'normal', stage);
  p2.striped = true;                 // long lanes render as rainbow stripes
  cx += len + 5;
}

function zigzagBeams(stage, y, legs = 4) {
  for (let i = 0; i < legs; i++) {
    const len = 12;
    const z = i % 2 ? 6 : -6;
    cx += 3;
    pad(cx + len / 2, y, z, len, 1.6, 'normal', stage);
    cx += len;
    pad(cx, y, z / 2, 2.4, 8, 'normal', stage);   // the corner turn
  }
  cx += 6;
}

function lavaLeap(stage, y, pools = 3) {
  for (let i = 0; i < pools; i++) {
    cx += 4.5;
    pad(cx + 4, y - 0.6, 0, 9, 9, 'kill', stage, 0.6);   // the pool
    cx += 8;
    pad(cx, y, 0, 3.6, 3.6, 'normal', stage);            // the island
  }
  cx += 6;
}

function moverRow(stage, y, axis, count = 3) {
  for (let i = 0; i < count; i++) {
    cx += 8.5;
    mover({ x: cx, y, z: axis === 'z' ? 0 : (rnd() * 2 - 1) * 3, w: 4.4, h: 1, d: 4.4,
      color: COL('normal', stage), axis, range: axis === 'y' ? 4 : 6.5,
      speed: 0.8 + rnd() * 0.5, phase: rnd() * 6.28 });
  }
  cx += 9;
}

function spinnerGauntlet(stage, y, count = 3) {
  for (let i = 0; i < count; i++) {
    cx += 9;
    pad(cx, y, 0, 8, 8, 'normal', stage);
    spinner({ x: cx, y: y + 1.4, z: 0, r: 0.45, len: 13, h: 0.9,
      color: '#2b3242', speed: (i % 2 ? -1 : 1) * (1.1 + rnd() * 0.6) });
  }
  cx += 9;
}

function conveyorRun(stage, y, count = 3) {
  for (let i = 0; i < count; i++) {
    cx += 4;
    const len = 13;
    // alternate: some help you along, some shove you back
    const dir = i % 2 ? -1 : 1;
    conveyors.push({ x: cx + len / 2, y, z: 0, w: len, h: 1, d: 5.5,
      color: dir > 0 ? '#3fd6a0' : '#e88c3f', dx: dir * 7 * 1.7527, dz: 0 });
    cx += len + 3.5;
    pad(cx, y, 0, 4, 5.5, 'normal', stage);
  }
  cx += 6;
}

function blinkRun(stage, y, count = 6) {
  for (let i = 0; i < count; i++) {
    cx += 5.4;
    blinkers.push({ x: cx, y, z: (i % 2 ? 3 : -3), w: 4, h: 1, d: 4,
      color: COL('normal', stage), period: 2.6, on: 0.62, phase: (i * 0.42) % 1 });
  }
  cx += 7;
}

function pendulumAlley(stage, y, count = 4) {
  cx += 4;
  const len = 9 * count;
  const run = pad(cx + len / 2, y, 0, len, 6, 'normal', stage); run.striped = true;
  for (let i = 0; i < count; i++) {
    pendulums.push({ x: cx + 5 + i * 9, y: y + 9.5, z: 0, len: 8, r: 1.35,
      speed: 1.1 + rnd() * 0.4, phase: i * 1.1, swing: 1.05, color: '#2b3242' });
  }
  cx += len + 5;
}

function iceRink(stage, y) {
  cx += 4;
  const len = 30;
  const ice = pad(cx + len / 2, y, 0, len, 9, 'ice', stage); ice.striped = false;
  // a couple of shoves to make the slide matter
  spinner({ x: cx + 11, y: y + 1.3, z: 0, r: 0.4, len: 11, h: 0.8, color: '#7fb6d6', speed: 1.4 });
  spinner({ x: cx + 23, y: y + 1.3, z: 0, r: 0.4, len: 11, h: 0.8, color: '#7fb6d6', speed: -1.6 });
  cx += len + 5;
}

function bouncerChain(stage, y, count = 3) {
  for (let i = 0; i < count; i++) {
    cx += 9;
    pad(cx, y, 0, 5, 5, 'bouncy', stage);
    cx += 8;
    pad(cx, y + 3.5, (rnd() * 2 - 1) * 3, 4.5, 4.5, 'normal', stage);
    y += 3.5;
  }
  cx += 6;
  return y;
}

function laserGrid(stage, y, count = 4) {
  cx += 4;
  const len = 8 * count;
  const run2 = pad(cx + len / 2, y, 0, len, 7, 'normal', stage); run2.striped = true;
  for (let i = 0; i < count; i++) {
    lasers.push({ x: cx + 5 + i * 8, y: y + 1.6, z: 0, w: 0.4, h: 3.2, d: 8,
      period: 2.2, on: 0.5, phase: (i * 0.3) % 1, color: '#ff3a5e' });
  }
  cx += len + 5;
}

function climb(stage, y, steps = 5) {
  for (let i = 0; i < steps; i++) {
    cx += 5;
    y += 2.6;
    pad(cx, y, (i % 2 ? 3.5 : -3.5), 4, 4, 'normal', stage);
  }
  cx += 6;
  return y;
}

// ---------------------------------------------------------------- build
// 100 stages, generated from the segment library above. The seed is fixed, so
// the tower is identical for everybody, but no two stages are laid out the
// same: each picks its segments, spacing and parameters from the PRNG with
// difficulty ramping from stage 1 to 100.
pad(0, 0, 0, 18, 18, 'start', 0);
platforms.push({ x: 0, y: 0.55, z: 0, w: 8, h: 0.2, d: 8, color: '#ffffff', kind: 'cp' });
checkpoints.push({ x: 0, y: 1, z: 0, n: 0 });
export const START = { x: 0, y: 2.2, z: 0 };
cx = 13;

let y = 0;

// Every segment takes (stage, y, difficulty 0..1) and returns the new y.
// A run of walls too tall to jump. The only way over is the wall hop: press
// into the face, flick left/right so a shoulder clips inside, and jump off the
// wall itself. `hops` is how many flicks one wall needs back to back.
// One clean jump clears ~3 studs, and every hop buys another.
function wallHopRun(stage, yy, hops, count) {
  for (let i = 0; i < count; i++) {
    pad(cx + 5, yy, 0, 10, 11, 'normal', stage);
    cx += 11;
    wallBlock(cx, yy + 0.5, 0, 2.4, 2.1 + hops * 2.8, 12, stage);
    cx += 9;
  }
  pad(cx + 3, yy, 0, 10, 11, 'normal', stage);
  cx += 10;
  return yy;
}

const SEGMENTS = [
  { id: 'gaps',      min: 0.00, w: 1.0, f: (s, yy, d) => { gapJumps(s, yy, 3 + Math.round(d * 4), 4.4 - d * 1.7); return yy; } },
  { id: 'beam',      min: 0.00, w: 0.8, f: (s, yy, d) => { narrowBeam(s, yy, 20 + d * 22, 2.0 - d * 0.9); return yy; } },
  { id: 'lava',      min: 0.03, w: 0.9, f: (s, yy, d) => { lavaLeap(s, yy, 1 + Math.round(d * 3)); return yy; } },
  { id: 'moverZ',    min: 0.05, w: 1.0, f: (s, yy, d) => { moverRow(s, yy, 'z', 2 + Math.round(d * 3)); return yy; } },
  { id: 'moverY',    min: 0.28, w: 0.7, f: (s, yy, d) => { moverRow(s, yy, 'y', 2 + Math.round(d * 2)); return yy; } },
  { id: 'spinner',   min: 0.08, w: 1.0, f: (s, yy, d) => { spinnerGauntlet(s, yy, 1 + Math.round(d * 3)); return yy; } },
  { id: 'conveyor',  min: 0.12, w: 0.9, f: (s, yy, d) => { conveyorRun(s, yy, 1 + Math.round(d * 2)); return yy; } },
  { id: 'blink',     min: 0.16, w: 0.9, f: (s, yy, d) => { blinkRun(s, yy, 4 + Math.round(d * 4)); return yy; } },
  { id: 'climb',     min: 0.10, w: 0.8, f: (s, yy, d) => climb(s, yy, 3 + Math.round(d * 3)) },
  { id: 'pendulum',  min: 0.22, w: 0.9, f: (s, yy, d) => { pendulumAlley(s, yy, 2 + Math.round(d * 3)); return yy; } },
  { id: 'ice',       min: 0.20, w: 0.7, f: (s, yy, d) => { iceRink(s, yy); return yy; } },
  { id: 'bounce',    min: 0.18, w: 0.7, f: (s, yy, d) => bouncerChain(s, yy, 2 + Math.round(d * 2)) },
  { id: 'laser',     min: 0.30, w: 0.9, f: (s, yy, d) => { laserGrid(s, yy, 2 + Math.round(d * 3)); return yy; } },
  // diff = (stage-1)/99, so min 0.04 puts the first wall at stage 5
  { id: 'wallhop',   min: 0.04, w: 0.85, f: (s, yy, d) => wallHopRun(s, yy, 1 + Math.round(d * 2), d > 0.45 ? 2 : 1) },
  { id: 'zigzag',    min: 0.14, w: 0.8, f: (s, yy, d) => { zigzagBeams(s, yy, 2 + Math.round(d * 2)); return yy; } },
];

// pick a segment allowed at this difficulty, weighted, never the same twice in a row
function pickSegment(diff, avoid) {
  const pool = SEGMENTS.filter((sg) => diff >= sg.min && sg.id !== avoid);
  const use = pool.length ? pool : SEGMENTS;
  let total = 0; for (const sg of use) total += sg.w;
  let r = rnd() * total;
  for (const sg of use) { r -= sg.w; if (r <= 0) return sg; }
  return use[use.length - 1];
}

export const STAGE_COUNT = FINISH_STAGE;
export const stageMarks = [];   // where each checkpoint sits, for the minimap

for (let stage = 1; stage <= STAGE_COUNT; stage++) {
  const diff = (stage - 1) / (STAGE_COUNT - 1);
  // early stages are one idea each; later ones stack two or three
  const segs = 1 + (rnd() < 0.25 + diff * 0.5 ? 1 : 0) + (rnd() < diff * 0.35 ? 1 : 0);
  let last = null;
  for (let k = 0; k < segs; k++) {
    // Stage 5 always introduces the wall hop, so the mechanic has a fixed place
    // to be learned instead of turning up whenever the shuffle feels like it.
    const sg = (stage === 5 && k === 0) ? SEGMENTS.find((x) => x.id === 'wallhop') : pickSegment(diff, last);
    y = sg.f(stage, y, diff);
    last = sg.id;
  }
  cx += 4;
  checkpoint(cx, y, 0, stage);
  stageMarks.push({ n: stage, x: cx, y });
  cx += 9;
}

// ---- the finish: a bright tower you climb to win ----
cx += 5;
pad(cx, y, 0, 16, 16, 'normal', FINISH_STAGE);
for (let i = 0; i < 5; i++) pad(cx + 3 + i * 3.2, y + 2.2 + i * 2.4, 0, 4.2, 9, 'normal', FINISH_STAGE);
pad(cx + 20, y + 13, 0, 14, 14, 'finish', FINISH_STAGE);

// ---- decorative rainbow arches, the signature of this style ----
export const arches = [];
for (let i = 0; i < stageMarks.length; i += 7) {
  const m = stageMarks[i];
  // r is the OUTER radius; the bands stack inward one per rainbow colour and
  // stop, leaving an opening wide enough to run a lane through.
  arches.push({ x: m.x + 16, y: m.y, z: 0, r: 11, sides: 12, thick: 0.8 });
}

// ---- decorative props: the spheres, cones and pillars that dress the course ----
// Purely visual and always well clear of the lane, so they never block a jump.
export const props = [];
{
  const KINDS = ['sphere', 'cone', 'cylinder', 'wedge'];
  let r = 4242;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const m of stageMarks) {
    if (m.n === 0) continue;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const size = 1.6 + rnd() * 3.4;
      const x = m.x + (rnd() - 0.5) * 34;
      const z = side * (14 + rnd() * 10);
      const kind = KINDS[Math.floor(rnd() * KINDS.length)];
      const color = RAINBOW[Math.floor(rnd() * RAINBOW.length)];
      // never poke through an arch, and never grow into a neighbour
      if (arches.some((a) => Math.abs(a.x - x) < size + 5 && Math.abs(z) < a.r + size)) continue;
      if (props.some((q) => Math.hypot(q.x - x, q.z - z) < q.size + size + 2)) continue;
      props.push({ kind, x, y: m.y - 0.5, z, size, color });
    }
  }
}

export const COURSE = {
  platforms, walls, checkpoints, movers, spinners, conveyors, blinkers, pendulums, lasers, arches, props,
  killY: KILL_Y, finishStage: FINISH_STAGE, length: cx + 28,
};

const _DEFAULT = {
  platforms: [...platforms], walls: [...walls], checkpoints: [...checkpoints], movers: [...movers],
  spinners: [...spinners], conveyors: [...conveyors], blinkers: [...blinkers],
  pendulums: [...pendulums], lasers: [...lasers], arches: [...arches], props: [...props],
  killY: COURSE.killY, finishStage: COURSE.finishStage, length: COURSE.length,
  start: { x: START.x, y: START.y, z: START.z },
};
export function applyCourse(c) {
  const src = c || _DEFAULT;   // null/empty → restore the default course
  const swap = (arr, next) => { arr.length = 0; for (const x of (next || [])) arr.push(x); };
  swap(platforms, src.platforms); swap(walls, src.walls); swap(checkpoints, src.checkpoints);
  swap(movers, src.movers); swap(spinners, src.spinners);
  swap(conveyors, src.conveyors); swap(blinkers, src.blinkers);
  swap(pendulums, src.pendulums); swap(lasers, src.lasers); swap(arches, src.arches);
  swap(props, src.props);
  COURSE.killY = src.killY ?? KILL_Y;
  COURSE.finishStage = src.finishStage ?? FINISH_STAGE;
  COURSE.length = src.length ?? 400;
  if (src.start) { START.x = src.start.x; START.y = src.start.y; START.z = src.start.z; }
}

// ---------------------------------------------------------------- motion
// All time-driven, so every client agrees without syncing state.

// The player controller was rescaled to Roblox's tempo (velocities x k,
// gravity x k^2 — see shared/movement/roblox.js). Every moving obstacle has to
// run at the same k or the world would feel like it slowed down while the
// player sped up, and every timing puzzle would get easier. Applying it inside
// these helpers means the client and the server scale identically without any
// call site having to know.
export const TIME_SCALE = 1.7527;

export function moverPos(m, t) {
  t *= TIME_SCALE;
  const off = Math.sin(t * m.speed + m.phase) * m.range;
  return {
    x: m.x + (m.axis === 'x' ? off : 0),
    y: m.y + (m.axis === 'y' ? off : 0),
    z: m.z + (m.axis === 'z' ? off : 0),
  };
}
export function spinAngle(s, t) { return t * TIME_SCALE * s.speed; }

// a blinker is solid for `on` of every `period`
export function blinkOn(b, t) {
  t *= TIME_SCALE;
  return (((t / b.period) + b.phase) % 1) < b.on;
}
// how far through its solid window it is (drives the fade-out warning)
export function blinkPhase(b, t) {
  t *= TIME_SCALE;
  return (((t / b.period) + b.phase) % 1) / b.on;
}
// swinging ball position
export function pendulumPos(p, t) {
  t *= TIME_SCALE;
  const a = Math.sin(t * p.speed + p.phase) * p.swing;
  return { x: p.x, y: p.y - Math.cos(a) * p.len, z: p.z + Math.sin(a) * p.len };
}
export function laserOn(l, t) {
  t *= TIME_SCALE;
  return (((t / l.period) + l.phase) % 1) < l.on;
}

export function checkpointById(n) {
  return checkpoints.find((c) => c.n === n) || checkpoints[0];
}
