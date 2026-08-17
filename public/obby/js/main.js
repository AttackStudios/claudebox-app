// Obby — a parkour tower. Reuses the ClaudeBox avatar + the shared course.
// Walk/run/jump across platforms over a void; checkpoints save progress; fall
// (or touch lava) and you respawn. Staff/Owner get ;fly and a Troll menu.

import * as THREE from 'three';
import { fpFade } from '/js/fpzoom.js';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import { COURSE, START, moverPos, spinAngle, KILL_Y, checkpointById, FINISH_STAGE, applyCourse,
         blinkOn, blinkPhase, pendulumPos, laserOn } from '/shared/obby/course.js';
import { GEAR, GEAR_BY_ID } from '/shared/obby/gear.js';
import { RAINBOW } from '/shared/obby/course.js';
import * as sfx from './sfx.js';
import { toObbyCourse } from '/shared/studio/adapters.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game-canvas');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
// Bright cyan sky and near-flat lighting: this style reads by pure saturated
// colour, so shading is kept minimal on purpose.
scene.background = new THREE.Color('#7fd8f2');
scene.fog = new THREE.Fog('#a8e6fa', 220, 620);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1200);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight('#ffffff', '#cfeaf5', 1.35); scene.add(hemi);
scene.add(new THREE.AmbientLight('#ffffff', 0.55));
const sun = new THREE.DirectionalLight('#ffffff', 0.65);
sun.position.set(60, 120, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120; sun.shadow.camera.far = 400;
scene.add(sun); scene.add(sun.target);

// soft clouds drifting under a daylight sky (the starfield suited the old night look)
const clouds = [];
{
  let s2 = 7;
  const rnd = () => ((s2 = (s2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92 });
  for (let i = 0; i < 60; i++) {
    const g = new THREE.Group();
    const puffs = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < puffs; k++) {
      const r = 6 + rnd() * 9;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), cloudMat);
      m.position.set((rnd() - 0.5) * 22, (rnd() - 0.5) * 5, (rnd() - 0.5) * 12);
      m.scale.y = 0.62;
      g.add(m);
    }
    g.position.set(rnd() * 8600 - 200, 55 + rnd() * 90, (rnd() - 0.5) * 700);
    scene.add(g);
    clouds.push(g);
  }
}

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
// 900+ course objects — share buffers or the GPU upload alone stalls the load
const _geo = new Map(), _mat = new Map();
const boxGeo = (w, h, d) => { const k = `b${w}|${h}|${d}`; if (!_geo.has(k)) _geo.set(k, new THREE.BoxGeometry(w, h, d)); return _geo.get(k); };
// A long lane painted with rainbow bands. Drawn once to a canvas and repeated
// along the platform, so a striped lane still costs exactly one draw call.
let _stripeTex = null;
function stripeTex() {
  if (_stripeTex) return _stripeTex;
  const n = RAINBOW.length, px = 32;
  const c = document.createElement('canvas');
  c.width = n * px; c.height = px;
  const g = c.getContext('2d');
  RAINBOW.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * px, 0, px, px); });
  _stripeTex = new THREE.CanvasTexture(c);
  _stripeTex.wrapS = _stripeTex.wrapT = THREE.RepeatWrapping;
  _stripeTex.magFilter = THREE.NearestFilter;
  return _stripeTex;
}
const _stripeMats = new Map();
function stripedMat(reps) {
  const k = Math.max(1, Math.round(reps));
  if (!_stripeMats.has(k)) {
    const t = stripeTex().clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(k, 1);
    _stripeMats.set(k, new THREE.MeshLambertMaterial({ map: t }));
  }
  return _stripeMats.get(k);
}

const matFor = (c, o) => { const k = c + JSON.stringify(o || {}); if (!_mat.has(k)) _mat.set(k, lam(c, o)); return _mat.get(k); };

// ---------- build the course ----------
function buildCourse() {
  for (const p of COURSE.platforms) {
    const mat = p.kind === 'kill' ? matFor('#ff1a1a', { emissive: '#7a0000' })
      : p.kind === 'finish' ? matFor('#ffee00', { emissive: '#7a6b00' })
      : p.striped ? stripedMat(Math.max(2, p.w / 3.2))
      : matFor(p.color);
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mat);
    m.position.set(p.x, p.y, p.z); m.receiveShadow = true; m.castShadow = true;
    scene.add(m);
    staticMeshes.push({ mesh: m, x: p.x });
  }
  // checkpoint beacons + numbers
  for (const c of COURSE.checkpoints) {
    if (c.n === 0) continue;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 8),
      new THREE.MeshBasicMaterial({ color: c.n >= COURSE.finishStage ? '#ffd84a' : '#5fe08a', transparent: true, opacity: 0.32 }));
    beam.position.set(c.x, c.y + 7, c.z); scene.add(beam);
    staticMeshes.push({ mesh: beam, x: c.x });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({ map: numberTex(c.n), transparent: true, side: THREE.DoubleSide }));
    flag.position.set(c.x, c.y + 4, c.z); scene.add(flag);
    flag.userData.spin = true; spinFlags.push(flag);
    staticMeshes.push({ mesh: flag, x: c.x });
  }
  // Big rainbow rings you pass through — the signature landmark of this style.
  for (const a of COURSE.arches || []) {
    const g = new THREE.Group();
    const step = (Math.PI * 2) / a.sides;
    // Concentric bands, outermost first, one colour each. They stop after the
    // last colour, so what is left in the middle is the opening you run through.
    for (let band = 0; band < RAINBOW.length; band++) {
      const rr = a.r - band * a.thick;
      const col = RAINBOW[band % RAINBOW.length];
      // Corner-to-corner length is set by the band's OUTER radius, so the
      // polygon closes without gaps.
      const segLen = 2 * (rr + a.thick / 2) * Math.tan(step / 2);
      for (let i = 0; i < a.sides; i++) {
        const ang = i * step;
        // Ring lies in the Y-Z plane (you run through it along X). Rotating a
        // box by +ang about X sends its local +Y radial and its +Z tangential,
        // so the box is (depth along the course, thickness, side length).
        const seg = new THREE.Mesh(boxGeo(3.4, a.thick, segLen), matFor(col));
        seg.position.set(0, Math.cos(ang) * rr, Math.sin(ang) * rr);
        seg.rotation.x = ang;
        g.add(seg);
      }
    }
    // Sit the ring so the bottom of the opening is just above the lane; the
    // lower bands bury themselves in the course, which is how these look.
    const hole = a.r - (RAINBOW.length - 1) * a.thick - a.thick / 2;
    g.position.set(a.x, a.y + hole + 0.7, a.z);
    scene.add(g);
    staticMeshes.push({ mesh: g, x: a.x });
  }

  // Decorative shapes flanking the lanes. Cached per (kind,size) bucket so a
  // few hundred of them still cost only a handful of geometries.
  const propGeo = (kind, size) => {
    const q = Math.round(size * 4) / 4;                 // bucket to 0.25 studs
    const key = kind + q;
    let g = _geo.get(key);
    if (!g) {
      g = kind === 'sphere'   ? new THREE.SphereGeometry(q, 16, 12)
        : kind === 'cone'     ? new THREE.ConeGeometry(q, q * 2, 18)
        : kind === 'cylinder' ? new THREE.CylinderGeometry(q * 0.7, q * 0.7, q * 2.4, 16)
        :                       new THREE.ConeGeometry(q, q * 1.5, 4);   // wedge
      _geo.set(key, g);
    }
    return g;
  };
  for (const pr of COURSE.props || []) {
    const mesh = new THREE.Mesh(propGeo(pr.kind, pr.size), matFor(pr.color));
    const h = pr.kind === 'sphere' ? pr.size
            : pr.kind === 'cylinder' ? pr.size * 1.2
            : pr.kind === 'cone' ? pr.size : pr.size * 0.75;
    mesh.position.set(pr.x, pr.y + h, pr.z);
    if (pr.kind === 'wedge') mesh.rotation.y = Math.PI / 4;
    mesh.castShadow = false; mesh.receiveShadow = true;
    scene.add(mesh);
    staticMeshes.push({ mesh, x: pr.x });
  }

  // conveyors — arrows show which way they shove you
  for (const c of COURSE.conveyors || []) {
    const mesh = new THREE.Mesh(boxGeo(c.w, c.h, c.d), matFor(c.color));
    mesh.position.set(c.x, c.y, c.z); mesh.receiveShadow = true;
    scene.add(mesh);
    const arrows = new THREE.Group();
    const n = Math.max(2, Math.round(c.w / 3.2));
    for (let i = 0; i < n; i++) {
      const a = new THREE.Mesh(boxGeo(1.5, 0.08, 0.5), matFor('#0d1422'));
      a.position.set(-c.w / 2 + 1.8 + i * (c.w - 3.2) / Math.max(1, n - 1), c.h / 2 + 0.06, 0);
      arrows.add(a);
    }
    arrows.position.set(c.x, c.y, c.z);
    scene.add(arrows);
    courseObjs.push({ kind: 'conveyor', spec: c, mesh, extra: arrows, x: c.x });
  }
  // blinkers — phase in and out
  for (const b of COURSE.blinkers || []) {
    const mesh = new THREE.Mesh(boxGeo(b.w, b.h, b.d),
      new THREE.MeshLambertMaterial({ color: b.color, transparent: true, opacity: 1 }));
    mesh.position.set(b.x, b.y, b.z); mesh.receiveShadow = true;
    scene.add(mesh);
    courseObjs.push({ kind: 'blinker', spec: b, mesh, x: b.x });
  }
  // walls — the only solid-sided geometry in the course, built for wall hopping
  for (const w of COURSE.walls || []) {
    const mesh = new THREE.Mesh(boxGeo(w.w, w.h, w.d), matFor(w.color));
    mesh.position.set(w.x, w.y, w.z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    staticMeshes.push({ mesh, x: w.x });
    // scuff bands up the face so the wall reads as something to climb rather
    // than a dead end
    const marks = new THREE.Group();
    const n = Math.max(2, Math.round(w.h / 2.6));
    for (let i = 0; i < n; i++) {
      const band = new THREE.Mesh(boxGeo(w.w * 1.05, 0.2, 2.0), matFor('#ffffff', { transparent: true, opacity: 0.55 }));
      band.position.set(w.x, w.y - w.h / 2 + 1.3 + i * (w.h - 2.2) / Math.max(1, n - 1), w.z);
      marks.add(band);
    }
    // a lighter lip on the crown, so from the ground you can see there IS a top
    const lip = new THREE.Mesh(boxGeo(w.w * 1.14, 0.36, w.d * 1.02), matFor('#ffffff', { transparent: true, opacity: 0.35 }));
    lip.position.set(w.x, w.y + w.h / 2 - 0.18, w.z);
    marks.add(lip);
    scene.add(marks);
    staticMeshes.push({ mesh: marks, x: w.x });
  }

  // pendulums — a swinging wrecking ball on a chain
  for (const pd of COURSE.pendulums || []) {
    const g = new THREE.Group();
    const anchor = new THREE.Mesh(boxGeo(1, 0.6, 1), matFor('#3a4150'));
    anchor.position.set(pd.x, pd.y, pd.z);
    scene.add(anchor);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(pd.r, 14, 12),
      new THREE.MeshLambertMaterial({ color: '#c0241a', emissive: '#3a0b06' }));
    ball.castShadow = true;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 6), matFor('#7a8394'));
    // Place them now: the per-frame update is skipped for distant pendulums, so
    // without this every off-screen ball sits piled at the world origin.
    const wp0 = pendulumPos(pd, 0);
    ball.position.set(wp0.x, wp0.y, wp0.z);
    chain.position.set((pd.x + wp0.x) / 2, (pd.y + wp0.y) / 2, (pd.z + wp0.z) / 2);
    g.add(ball, chain);
    scene.add(g);
    courseObjs.push({ kind: 'pendulum', spec: pd, mesh: g, ball, chain, anchor, x: pd.x });
  }
  // lasers — lethal while lit
  for (const l of COURSE.lasers || []) {
    const beam = new THREE.Mesh(boxGeo(l.w, l.h, l.d),
      new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: 0.75 }));
    beam.position.set(l.x, l.y, l.z);
    scene.add(beam);
    const emitters = new THREE.Group();
    for (const zz of [-l.d / 2, l.d / 2]) {
      const e = new THREE.Mesh(boxGeo(0.7, 0.7, 0.5), matFor('#3a4150'));
      e.position.set(l.x, l.y, l.z + zz);
      emitters.add(e);
    }
    scene.add(emitters);
    courseObjs.push({ kind: 'laser', spec: l, mesh: beam, extra: emitters, x: l.x });
  }
  // movers
  for (const m of COURSE.movers) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(m.w, m.h, m.d), lam('#cfd8e6'));
    mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    moverMeshes.push({ spec: m, mesh });
    staticMeshes.push({ mesh, x: m.x });
  }
  // spinners
  for (const s of COURSE.spinners) {
    const pivot = new THREE.Group(); pivot.position.set(s.x, s.y, s.z); scene.add(pivot);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 8), lam('#444b58'));
    post.position.y = -1; pivot.add(post);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(s.len, s.h, 0.7), new THREE.MeshLambertMaterial({ color: '#e8563f', emissive: '#3a0f08' }));
    bar.castShadow = true; pivot.add(bar);
    spinnerMeshes.push({ spec: s, pivot });
    staticMeshes.push({ mesh: pivot, x: s.x });
  }
}
const spinFlags = [], moverMeshes = [], spinnerMeshes = [];
// everything cullable, indexed by course X so we only draw what is near you
const courseObjs = [];
const staticMeshes = [];   // {mesh, x} for plain platforms
const DRAW = 130;          // how far along the course we render

function numberTex(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(10,16,28,.0)'; x.fillRect(0, 0, 128, 128);
  x.beginPath(); x.arc(64, 64, 54, 0, 7); x.fillStyle = n >= COURSE.finishStage ? '#ffd84a' : '#5fe08a'; x.fill();
  x.fillStyle = '#0c1422'; x.font = 'bold 70px Trebuchet MS'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c); return t;
}
// buildCourse() is deferred to boot(), after any custom Studio level is loaded

// ---------- player controller ----------
// Roblox-tempo movement (see shared/movement/roblox.js). These come from a
// uniform time rescale of the original numbers by k = 1.7527: velocities x k,
// gravity x k^2. Jump height (2.9927) and jump distance are bit-identical to
// before, so all 100 generated stages stay exactly as solvable — only the arc
// got twice as snappy, which is the whole difference between floaty and Roblox.
// Do not "tidy" these into round numbers; the geometry depends on them.
const R = 0.35, G = 92.16, JUMP = 23.49, MOVE = 13.67, RUN = 20.16, FLY = 35.05;
const STEP_UP = 0.76;      // 0.4 character heights, matching Roblox's HipHeight
const player = {
  pos: { x: START.x, y: START.y, z: START.z }, vel: { x: 0, y: 0, z: 0 },
  ry: 0, grounded: false, anim: 'idle', flying: false, sprint: false,
};
// ---------------------------------------------------------------- gear
// Owned gear comes from the server (see /api/obby/gear) so it cannot be faked.
const gear = {
  owned: new Set(),
  held: null,            // the 'hold' item currently in hand
  carpet: null,          // { mesh, until } while deployed
  carpetCdUntil: 0,
  skipCdUntil: 0,
  airJumps: 0,
  trail: [],
};
const hasGear = (id) => gear.owned.has(id);
const heldDef = () => (gear.held ? GEAR_BY_ID[gear.held] : null);

const game = { dead: false, dying: false, won: false, stage: 0, carried: false, frozenUntil: 0, staff: false, owner: false, role: 'player', scale: 1 };

// returns highest support top under (x,z) that you were standing at/above
function supportUnder(x, z, fromY, time) {
  let best = -Infinity, plat = null, moverHit = null, conveyorHit = null;
  for (const p of COURSE.platforms) {
    if (x > p.x - p.w/2 - R && x < p.x + p.w/2 + R && z > p.z - p.d/2 - R && z < p.z + p.d/2 + R) {
      const top = p.y + p.h/2;
      if (top <= fromY + STEP_UP && top > best) { best = top; plat = p; moverHit = null; }
    }
  }
  // the top of a wall is walkable like anything else
  for (const w of COURSE.walls || []) {
    if (x > w.x - w.w/2 - R && x < w.x + w.w/2 + R && z > w.z - w.d/2 - R && z < w.z + w.d/2 + R) {
      const top = w.y + w.h/2;
      if (top <= fromY + STEP_UP && top > best) { best = top; plat = null; moverHit = null; conveyorHit = null; }
    }
  }
  // conveyors hold you up and shove you along
  for (const c of COURSE.conveyors || []) {
    if (x > c.x - c.w/2 - R && x < c.x + c.w/2 + R && z > c.z - c.d/2 - R && z < c.z + c.d/2 + R) {
      const top = c.y + c.h/2;
      if (top <= fromY + STEP_UP && top > best) { best = top; plat = null; moverHit = null; conveyorHit = c; }
    }
  }
  // a blinker only holds you while it is phased in
  for (const b of COURSE.blinkers || []) {
    if (!blinkOn(b, time)) continue;
    if (x > b.x - b.w/2 - R && x < b.x + b.w/2 + R && z > b.z - b.d/2 - R && z < b.z + b.d/2 + R) {
      const top = b.y + b.h/2;
      if (top <= fromY + STEP_UP && top > best) { best = top; plat = null; moverHit = null; conveyorHit = null; }
    }
  }
  for (const mm of moverMeshes) {
    const m = mm.spec, wp = moverPos(m, time);
    if (x > wp.x - m.w/2 - R && x < wp.x + m.w/2 + R && z > wp.z - m.d/2 - R && z < wp.z + m.d/2 + R) {
      const top = wp.y + m.h/2;
      if (top <= fromY + STEP_UP && top > best) { best = top; plat = null; moverHit = { m, wp }; }
    }
  }
  return { top: best, plat, moverHit, conveyorHit };
}

let standMover = null, standMoverPrev = null;
let onIce = false;

// ---- wall hopping (an intentional bug, faithfully reproduced) ----
// The classic Roblox wall hop: press into a wall, flick your character left or
// right so a shoulder clips inside the face, and the jump registers off the
// wall instead of thin air. Chain the flicks and you scale walls you have no
// business climbing. This is deliberate, not an oversight — the course builds
// walls around it from stage 5 on. Do not "fix" it.
const wallHop = { touchAt: -1, nx: 0, nz: 0, flickAt: -1, lastRy: 0, chain: 0 };
// Facing oblique to the wall face means a shoulder is buried in it — the same
// trick as the flick, held rather than snapped. A mouse can snap a facing in one
// frame; a thumbstick cannot, so without this the hop is desktop-only. Running
// straight at the wall (into ~ 1) still gives you nothing: it has to be angled.
function shoulderInWall() {
  const into = -(Math.sin(player.ry) * wallHop.nx + Math.cos(player.ry) * wallHop.nz);
  return into > 0.12 && into < 0.9;
}
// How fast a HUMAN can flick a mouse or a thumbstick, which has nothing to do
// with the game's gravity — so this does not scale with the tempo either.
const FLICK_RATE = 5.5;      // rad/s of turn that counts as a flick
// These two are human-reaction forgiveness windows, not physics windows, so
// they deliberately do NOT scale with the tempo — same reasoning as coyote time
// and the jump buffer. Shortening them with k made the wall hop unusable at
// speed, because a flick now carries you off the face 1.75x faster.
const WALL_GRACE = 0.28;     // how long wall contact stays usable
const FLICK_GRACE = 0.36;    // how long a flick stays usable

// Push the player out of any wall they have walked into, and report the face
// they hit. Walls are the only geometry with sides; platforms still support
// from above only, so the original stages behave exactly as before.
function resolveWalls() {
  let hit = null;
  const feet = player.pos.y, head = player.pos.y + 1.7;
  for (const w of COURSE.walls || []) {
    if (Math.abs(w.x - player.pos.x) > w.w / 2 + R + 1) continue;
    const top = w.y + w.h / 2, bot = w.y - w.h / 2;
    if (feet > top - 0.05 || head < bot) continue;        // standing on top, or clear below
    const dx = player.pos.x - w.x, dz = player.pos.z - w.z;
    const ox = w.w / 2 + R - Math.abs(dx);
    const oz = w.d / 2 + R - Math.abs(dz);
    if (ox <= 0 || oz <= 0) continue;
    if (ox < oz) {                                         // pushed out along X
      const sgn = dx >= 0 ? 1 : -1;
      player.pos.x = w.x + sgn * (w.w / 2 + R); player.vel.x = 0;
      hit = { nx: sgn, nz: 0 };
    } else {                                               // pushed out along Z
      const sgn = dz >= 0 ? 1 : -1;
      player.pos.z = w.z + sgn * (w.d / 2 + R); player.vel.z = 0;
      hit = { nx: 0, nz: sgn };
    }
  }
  return hit;
}

// a scuff of dust where the shoulder went through
const scuffs = [];
function wallScuff() {
  const m = new THREE.Mesh(boxGeo(0.28, 0.28, 0.28),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75 }));
  m.position.set(player.pos.x - wallHop.nx * 0.3, player.pos.y + 1.0, player.pos.z - wallHop.nz * 0.3);
  scene.add(m);
  scuffs.push({ mesh: m, t: 0 });
}

const lookLockOn = () => !!(window.ClaudeBox?.settings?.lookLock);
function updatePlayer(dt, input, time) {
  if (game.dead || game.carried) return;
  const frozen = Date.now() < game.frozenUntil;
  // camera-relative move dir
  let mx = 0, mz = 0;
  if (!frozen) { mx = input.x; mz = input.z; }
  const len = Math.hypot(mx, mz) || 1;
  const yaw = orbit.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const wishX = (fx * mz + rx * mx) / (Math.hypot(mx, mz) > 0.01 ? len : 1);
  const wishZ = (fz * mz + rz * mx) / (Math.hypot(mx, mz) > 0.01 ? len : 1);
  const moving = Math.hypot(mx, mz) > 0.05;

  if (player.flying) {
    const sp = FLY * (player.sprint ? 2 : 1);
    player.vel.x = wishX * sp; player.vel.z = wishZ * sp;
    player.vel.y = (input.up ? 1 : 0) * sp - (input.down ? 1 : 0) * sp;
    player.pos.x += player.vel.x * dt; player.pos.y += player.vel.y * dt; player.pos.z += player.vel.z * dt;
    if (moving) player.ry = Math.atan2(wishX, wishZ);
    player.anim = (input.up || input.down || moving) ? 'fly' : 'fly';
    return;
  }

  const gd = heldDef();
  const speedMul = gd?.mult || 1;
  const sp = (player.sprint ? RUN : MOVE) * speedMul;
  // Ice keeps your momentum: you accelerate slowly and slide when you let go.
  if (onIce) {
    const grip = 2.4 * dt;
    player.vel.x += (wishX * sp - player.vel.x) * grip;
    player.vel.z += (wishZ * sp - player.vel.z) * grip;
    if (moving && Math.random() < dt * 3) sfx.slip();
  } else {
    player.vel.x = wishX * sp; player.vel.z = wishZ * sp;
  }
  // Look Lock turns you to face where the CAMERA is looking; otherwise you face
  // the way you are moving. The camera sits at (sin yaw, cos yaw) from the
  // player and looks back at them, so its view direction is the opposite —
  // without the half turn the model stands there facing its own camera.
  if (lookLockOn()) player.ry = orbit.yaw + Math.PI;
  else if (moving) player.ry = Math.atan2(wishX, wishZ);

  // A fast turn is the "flick" that clips a shoulder into a wall. Measured off
  // the facing itself, so it works whether you flick with strafe keys or by
  // swinging the camera in Look Lock.
  {
    let d = player.ry - wallHop.lastRy;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (dt > 0 && Math.abs(d) / dt > FLICK_RATE) wallHop.flickAt = performance.now() / 1000;
    wallHop.lastRy = player.ry;
  }

  // ride a mover horizontally
  standMoverPrev = standMover;

  const prevY = player.pos.y;
  player.vel.y -= G * (gd?.gravity ?? 1) * dt;
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;

  // walls block you horizontally — and being pressed against one is what makes
  // a wall hop possible
  const wallHit = resolveWalls();
  if (wallHit) {
    wallHop.touchAt = performance.now() / 1000;
    wallHop.nx = wallHit.nx; wallHop.nz = wallHit.nz;
    // nudge the player toward the trick once, the first time a wall stops them
    if (!wallHop.hinted) {
      wallHop.hinted = true;
      toast('Too tall to jump — flick left/right against it and jump to wall hop');
    }
  }

  const sup = supportUnder(player.pos.x, player.pos.z, prevY, time);
  player.grounded = false; standMover = null;
  const wasAir = !player.grounded;
  onIce = false;
  if (player.vel.y <= 0 && sup.top > -Infinity && player.pos.y <= sup.top && prevY >= sup.top - 0.5) {
    player.pos.y = sup.top; player.vel.y = 0; player.grounded = true;
    gear.airJumps = 0; wallHop.chain = 0;
    if (wasAir && player.vel.y > -1) sfx.land();
    if (sup.plat?.kind === 'kill') return die('lava');
    if (sup.plat?.kind === 'finish') win();
    if (sup.plat?.kind === 'ice') onIce = true;
    if (sup.plat?.kind === 'bouncy') {
      player.vel.y = JUMP * 1.85 * (gd?.jump || 1);
      player.grounded = false;
      sfx.bounce();
    }
    if (sup.moverHit) standMover = sup.moverHit;
    // a conveyor keeps shoving while you stand on it
    if (sup.conveyorHit) {
      player.pos.x += sup.conveyorHit.dx * dt;
      player.pos.z += sup.conveyorHit.dz * dt;
    }
  }
  // swinging balls and live lasers are lethal on contact
  const hx = player.pos.x, hy = player.pos.y + 0.9, hz = player.pos.z;
  for (const pd of COURSE.pendulums || []) {
    if (Math.abs(pd.x - hx) > 14) continue;
    const wp = pendulumPos(pd, time);
    if (Math.hypot(wp.x - hx, wp.y - hy, wp.z - hz) < pd.r + 0.55) return die('wrecked');
  }
  for (const l of COURSE.lasers || []) {
    if (Math.abs(l.x - hx) > 12 || !laserOn(l, time)) continue;
    if (Math.abs(hx - l.x) < l.w / 2 + 0.4 && Math.abs(hz - l.z) < l.d / 2
        && hy > l.y - l.h / 2 - 0.3 && hy < l.y + l.h / 2 + 0.9) { sfx.laserZap(); return die('lasered'); }
  }
  // carry along the mover you're standing on
  if (standMover && standMoverPrev && standMover.m === standMoverPrev.m) {
    player.pos.x += standMover.wp.x - standMoverPrev.wp.x;
    player.pos.z += standMover.wp.z - standMoverPrev.wp.z;
  }

  // jump: buffered (press registers up to 0.15s early) + coyote (0.1s grace
  // after stepping off) so jumps never feel eaten
  const nowS = performance.now() / 1000;
  if (player.grounded) coyoteUntil = nowS + 0.1;
  const recentlyPressed = jumpAt >= 0 && nowS - jumpAt < 0.15;
  if (recentlyPressed && nowS < coyoteUntil && !frozen) {
    const gj = heldDef();
    player.vel.y = JUMP * (gj?.jump || 1); player.grounded = false;
    coyoteUntil = 0; jumpAt = -1; sfx.jump();
  } else if (recentlyPressed && !frozen && !player.grounded
             && nowS - wallHop.touchAt < WALL_GRACE
             && (nowS - wallHop.flickAt < FLICK_GRACE || shoulderInWall())) {
    // Shoulder is inside the wall, so the jump finds "ground" and fires. Each
    // hop needs its own flick, which is what makes chaining them a skill.
    const gj = heldDef();
    player.vel.y = JUMP * (gj?.jump || 1);
    jumpAt = -1; wallHop.flickAt = -1; wallHop.chain++;
    // stay glued to the face, ready for the next flick
    player.pos.x -= wallHop.nx * 0.05;
    player.pos.z -= wallHop.nz * 0.05;
    sfx.jump(); wallScuff();
  } else if (recentlyPressed && !frozen && !player.grounded && hasGear('jump') && gear.airJumps < 1) {
    // Double Jump gear — one extra push per airtime
    gear.airJumps++; jumpAt = -1;
    const gj = heldDef();
    player.vel.y = JUMP * (gj?.jump || 1) * 0.92;
    sfx.doubleJump();
  }

  // spinner fling
  for (const sm of spinnerMeshes) {
    const s = sm.spec;
    const dx = player.pos.x - s.x, dz = player.pos.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.8 && d < s.r && Math.abs(player.pos.y - (s.y)) < 1.6) {
      const barAng = spinAngle(s, time);
      const pAng = Math.atan2(dz, dx);
      let da = pAng - barAng; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283;
      // bar lies along ±barAng; if near the bar line, fling outward
      if (Math.abs(Math.sin(da)) < 0.22) {
        const out = 1 / (d || 1);
        player.vel.x = dx * out * 38.6; player.vel.z = dz * out * 38.6; player.vel.y = 15.8;
        player.grounded = false;
      }
    }
  }

  // anim
  if (!player.grounded) player.anim = player.vel.y > 1 ? 'jump' : 'fall';
  else if (moving) player.anim = player.sprint ? 'run' : 'walk';
  else player.anim = 'idle';

  // fall death
  if (player.pos.y < COURSE.killY) die('fell');

  // checkpoint pass-through — 100 checkpoints, so only test the nearby ones
  for (const c of COURSE.checkpoints) {
    if (c.n <= game.stage || Math.abs(c.x - player.pos.x) > 12) continue;
    if (Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 6 && Math.abs(c.y - player.pos.y) < 4) {
      game.stage = c.n;                 // reflect it locally so the bar moves at once
      sfx.checkpoint();
      updateProgress();
      net.send({ t: 'checkpoint', n: c.n });
    }
  }
}

function updateProgress() {
  const fill = $('#progress-fill'), lab = $('#progress-label');
  if (!fill) return;
  const pct = Math.max(0, Math.min(1, (game.stage || 0) / FINISH_STAGE));
  fill.style.right = `${(1 - pct) * 100}%`;
  lab.textContent = `Stage ${game.stage || 0} / ${FINISH_STAGE}`;
}

function die(cause) {
  if (game.dead || game.dying) return;
  game.dying = true;
  if (cause === 'lava') sfx.lava(); else sfx.die();
  net.send({ t: 'die', cause });
}
function win() {
  if (game.won) return; game.won = true;
  sfx.win();
  window.ClaudeBox?.completeChallenge('obby-finish');
  net.send({ t: 'checkpoint', n: COURSE.finishStage });
  $('#win-veil').classList.remove('hidden');
  setTimeout(() => $('#win-veil').classList.add('hidden'), 4000);
}

// ---------- camera (third-person orbit) ----------
const orbit = { yaw: Math.PI, pitch: 0.42, dist: 9 };
// Jump — routed through here so gear (higher jump, an extra air jump) and the
// sound all live in one place.
function tryJump() {
  if (game.dead || player.flying) return;
  const gd = heldDef();
  const power = JUMP * (gd?.jump || 1);
  if (player.grounded) {
    player.vel.y = power; player.grounded = false; sfx.jump();
    return;
  }
  // Double Jump gear: one extra push per time you leave the ground
  if (hasGear('jump') && gear.airJumps < 1) {
    gear.airJumps++;
    player.vel.y = power * 0.92;
    sfx.doubleJump();
  }
}

function updateCamera() {
  // camera framing tracks your size: tiny → close & low, giant → far & high
  const s = game.scale;
  const dist = orbit.dist * s;
  const tx = player.pos.x, ty = player.pos.y + 1.4 * s, tz = player.pos.z;
  const cp = Math.cos(orbit.pitch);
  let cx = tx + Math.sin(orbit.yaw) * cp * dist;
  const cy = ty + Math.sin(orbit.pitch) * dist;
  let cz = tz + Math.cos(orbit.yaw) * cp * dist;
  // Look Lock: slide the camera off to one side so your character is not
  // sitting under the crosshair, and aim at the same offset so the reticle
  // stays true to where you are pointing.
  let lx = tx, lz = tz;
  if (lookLockOn()) {
    const sx = Math.cos(orbit.yaw), sz = -Math.sin(orbit.yaw);   // camera-right
    const off = 1.15 * s;
    cx += sx * off; cz += sz * off;
    lx += sx * off; lz += sz * off;
  }
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.6);
  camera.lookAt(lx, ty, lz);
  const targetFov = 60 + (s - 1) * 9;   // giant widens the view, tiny narrows it
  if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * 0.12; camera.updateProjectionMatrix(); }
}

// ---------- avatars ----------
const myAvatar = { ctrl: null, group: null };
const remotes = new Map(); // id -> { ctrl, group, interp, data, nameSprite }

function nameSprite(name, role) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px Trebuchet MS'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const col = role === 'owner' ? '#ffb12e' : role === 'staff' ? '#37d6ff' : '#eaf2ff';
  if (role === 'owner' || role === 'staff') {
    x.fillStyle = role === 'owner' ? 'rgba(70,40,0,.6)' : 'rgba(4,34,58,.6)';
    x.fillRect(8, 4, 240, 26);
    x.fillStyle = col; x.font = 'bold 16px Trebuchet MS'; x.fillText(role.toUpperCase(), 128, 17);
  }
  x.font = 'bold 30px Trebuchet MS'; x.fillStyle = col;
  x.strokeStyle = 'rgba(0,0,0,.7)'; x.lineWidth = 4; x.strokeText(name, 128, 46); x.fillText(name, 128, 46);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  spr.scale.set(3.2, 0.8, 1); spr.position.y = 2.7;
  return spr;
}

function makeRemote(d) {
  const ctrl = makeAvatar(d.avatar || {});
  ctrl.group.scale.setScalar(d.scale || 1);
  const spr = nameSprite(d.name, d.role);
  ctrl.group.add(spr);
  scene.add(ctrl.group);
  const rec = { ctrl, group: ctrl.group, interp: new InterpBuffer(), data: d, nameSprite: spr };
  remotes.set(d.id, rec);
  return rec;
}
function refreshRemoteTag(rec) {
  rec.group.remove(rec.nameSprite);
  rec.nameSprite = nameSprite(rec.data.name, rec.data.role);
  rec.group.add(rec.nameSprite);
  rec.group.scale.setScalar(rec.data.scale || 1);
  rec.ctrl.setColors(rec.data.avatar || {});
}

// ---------- networking ----------
const net = new Net();
let identity = null;

net.on('welcome', (msg) => {
  game.staff = msg.staff; game.owner = msg.owner; game.role = msg.you.role;
  for (const d of msg.players) makeRemote(d);
  showRole();
  $('#loading').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  toast(game.owner ? '👑 Welcome, Owner!' : game.staff ? '🛡️ Welcome, Staff!' : 'Reach the top! 🧗');
});
net.on('player.join', (m) => { if (m.player.id !== net.id && !remotes.has(m.player.id)) makeRemote(m.player); });
net.on('player.leave', (m) => { const r = remotes.get(m.id); if (r) { scene.remove(r.group); remotes.delete(m.id); } });
net.on('player.update', (m) => {
  const d = m.player;
  if (d.id === net.id) {
    game.role = d.role; game.staff = d.role !== 'player'; game.owner = d.role === 'owner'; player.flying = d.flying;
    game.scale = d.scale || 1;
    if (myAvatar.group) myAvatar.group.scale.setScalar(game.scale);
    if (game.scale < 1) toast('🐜 Shrunk!'); else if (game.scale > 1) toast('🦣 Embiggened!');
    showRole(); return;
  }
  const r = remotes.get(d.id); if (!r) return;
  Object.assign(r.data, d); refreshRemoteTag(r);
});
net.on('snapshot', (m) => {
  serverTime = m.clock;
  for (const row of m.players) {
    const [id, x, y, z, ry, anim] = row;
    if (id === net.id) { if (game.carried) { player.pos.x = x; player.pos.y = y; player.pos.z = z; } continue; }
    const r = remotes.get(id); if (!r) continue;
    r.interp.push([x, y, z, ry, anim]);
  }
});
net.on('player.respawn', (m) => {
  if (m.id === net.id) {
    player.pos = { x: m.x, y: m.y, z: m.z }; player.vel = { x: 0, y: 0, z: 0 };
    game.dead = false; game.dying = false; game.carried = false; $('#death-veil').classList.add('hidden');
  } else { const r = remotes.get(m.id); if (r) r.interp.push([m.x, m.y, m.z, r.data.ry || 0, 'idle']); }
});
net.on('player.death', (m) => {
  if (m.id === net.id) {
    if (game.dead) return;
    game.dead = true; game.carried = false;
    $('#death-veil').querySelector('p').textContent = m.cause === 'lava' ? 'Burned!' : m.cause === 'laser' ? 'Zapped!' : m.cause === 'admin' ? 'Admin smite!' : 'You fell!';
    $('#death-veil').classList.remove('hidden');
    setTimeout(() => net.send({ t: 'respawn' }), 2000);
  }
});
net.on('checkpoint.ok', (m) => { game.stage = m.n; $('#stage-num').textContent = m.n; toast(`Checkpoint ${m.n}! ✅`); if (m.n < COURSE.finishStage) window.ClaudeBox?.completeChallenge('obby-check'); });
net.on('fly', (m) => { player.flying = m.on; if (m.on) { player.vel = { x: 0, y: 0, z: 0 }; } $('#fly-pill').classList.toggle('hidden', !m.on); });
net.on('toast', (m) => toast(m.text));
net.on('chat', (m) => addChat(m));
net.on('troll.carried', (m) => { if (m.id === net.id) { game.carried = true; toast('😇 You have been ASCENDED'); } });
net.on('troll.released', (m) => { if (m.id === net.id) { game.carried = false; player.vel.y = 0; player.grounded = false; } });
net.on('troll.fling', (m) => { if (m.id === net.id) { player.vel.x = m.vx; player.vel.y = m.vy; player.vel.z = m.vz; player.grounded = false; game.carried = false; } });
net.on('troll.freeze', (m) => { if (m.id === net.id) { game.frozenUntil = m.until; toast('🥶 Frozen!'); } });
net.on('troll.fx', (m) => { if (m.kind === 'laser') laserFx(m.by, m.target); });
net.on('_disconnect', () => toast('Disconnected — refresh to rejoin.'));

let serverTime = 0;

// ---------- laser fx ----------
const lasers = [];
function headPos(id) {
  if (id === net.id) return new THREE.Vector3(player.pos.x, player.pos.y + 1.7, player.pos.z);
  const r = remotes.get(id); return r ? new THREE.Vector3(r.group.position.x, r.group.position.y + 1.7, r.group.position.z) : null;
}
const UP = new THREE.Vector3(0, 1, 0);
function orientBeam(beam, a, b) {
  const dir = b.clone().sub(a); const len = Math.max(0.01, dir.length());
  beam.position.copy(a).add(b).multiplyScalar(0.5);
  beam.scale.set(1, len, 1);
  beam.quaternion.setFromUnitVectors(UP, dir.normalize());
}
function laserFx(by, target) {
  const a = headPos(by), b = headPos(target); if (!a || !b) return;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 1, 8),
    new THREE.MeshBasicMaterial({ color: '#ff2222', transparent: true, opacity: 0.95 })
  );
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 1, 8),
    new THREE.MeshBasicMaterial({ color: '#ff6060', transparent: true, opacity: 0.35, depthWrite: false })
  );
  beam.add(glow); beam.renderOrder = 999;
  orientBeam(beam, a, b);
  scene.add(beam);
  // a quick flash at the impact point
  const flash = new THREE.PointLight('#ff3030', 6, 12);
  flash.position.copy(b); scene.add(flash);
  lasers.push({ beam, flash, by, target, ttl: 0.55 });
}

// ---------- chat / toast ----------
function addChat(m) {
  const log = $('#chat-log');
  const div = document.createElement('div'); div.className = 'chat-line';
  const roleCls = m.id === 'sys' ? 'sys' : (m.role === 'owner' ? 'owner' : m.role === 'staff' ? 'staff' : '');
  div.innerHTML = `<span class="nm ${roleCls}">${esc(m.name)}</span> ${esc(m.text)}`;
  log.appendChild(div);
  while (log.children.length > 9) log.removeChild(log.firstChild);
}
function toast(text) {
  const t = document.createElement('div'); t.className = 'ob-toast'; t.textContent = text;
  $('#ob-toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function showRole() {
  const b = $('#role-badge');
  if (game.owner) { b.className = 'owner'; b.textContent = '👑 OWNER'; b.classList.remove('hidden'); }
  else if (game.staff) { b.className = 'staff'; b.textContent = '🛡️ STAFF'; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}

// ---------- troll UI ----------
const TROLLS = [
  { kind: 'carry', e: '😇', l: 'Jesus (carry)' },
  { kind: 'drop', e: '😈', l: 'Drop them' },
  { kind: 'laser', e: '🦸', l: 'Laser eyes' },
  { kind: 'fling', e: '🚀', l: 'Fling' },
  { kind: 'freeze', e: '🥶', l: 'Freeze' },
  { kind: 'kill', e: '💀', l: 'Smite' },
  { kind: 'tiny', e: '🐜', l: 'Tiny' },
  { kind: 'giant', e: '🦣', l: 'Giant' },
  { kind: 'bring', e: '🧲', l: 'Bring to me' },
  { kind: 'reset', e: '♻️', l: 'Reset' },
];
let trollTargetId = null;
function buildTrollMenu() {
  const grid = $('#tm-grid'); grid.innerHTML = '';
  for (const t of TROLLS) {
    const d = document.createElement('div'); d.className = 'tm-item';
    d.innerHTML = `<span class="e">${t.e}</span><span class="l">${t.l}</span>`;
    d.onclick = () => { if (trollTargetId) net.send({ t: 'troll', kind: t.kind, target: trollTargetId }); };
    grid.appendChild(d);
  }
}
buildTrollMenu();
$('#tm-close').onclick = () => $('#troll-menu').classList.add('hidden');
$('#troll-btn').onclick = () => {
  if (!trollTargetId) return;
  const r = remotes.get(trollTargetId); if (!r) return;
  $('#tm-name').textContent = r.data.name;
  $('#troll-menu').classList.remove('hidden');
  unlock();
};
$('#reset-btn').onclick = () => die('reset');

// nearest other player to target for trolling
function updateTrollButton() {
  const btn = $('#troll-btn');
  if (!game.staff) { btn.classList.add('hidden'); return; }
  let best = null, bd = 7;
  for (const [id, r] of remotes) {
    const d = Math.hypot(r.group.position.x - player.pos.x, r.group.position.z - player.pos.z);
    if (d < bd) { bd = d; best = { id, name: r.data.name }; }
  }
  if (best && !$('#troll-menu').classList.contains('hidden') === false) {
    trollTargetId = best.id;
    btn.classList.remove('hidden');
    $('#troll-target').textContent = best.name;
  } else if (best) { trollTargetId = best.id; btn.classList.remove('hidden'); $('#troll-target').textContent = best.name; }
  else { btn.classList.add('hidden'); trollTargetId = null; }
}

// ---------- input ----------
const keys = new Set();
let jumpAt = -1, coyoteUntil = 0;     // jump-buffer + coyote time for snappy jumps
let dragging = false, lastX = 0, lastY = 0;
const typing = () => { const e = document.activeElement; return e && (e.tagName === 'INPUT'); };
addEventListener('keydown', (e) => {
  if (typing()) { if (e.code === 'Enter') sendChat(); if (e.code === 'Escape') $('#chat-input').blur(); return; }
  keys.add(e.code);
  if (e.code === 'Space') { jumpAt = performance.now() / 1000; e.preventDefault(); }
  if (e.code === 'Enter') openChat();
  if (e.code === 'KeyT' && game.staff) $('#troll-btn').click();
  if (e.code === 'KeyR') die('reset');
  sfx.unlock();
  // 1-9 pick gear you own
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9) {
    const mine = GEAR.filter((g) => hasGear(g.id) && g.slot !== 'passive');
    if (mine[n - 1]) equipGear(mine[n - 1].id);
  }
  if (e.code === 'KeyB') $('#shop').classList.toggle('hidden');
  if (e.code === 'Escape') $('#troll-menu').classList.add('hidden');
});
addEventListener('keyup', (e) => keys.delete(e.code));

// pointer lock: click the world to capture the mouse, move it to look, Esc to release
let locked = false;
canvas.addEventListener('click', () => {
  if (!locked && $('#troll-menu').classList.contains('hidden') && !typing()) {
    canvas.requestPointerLock?.();
  }
});
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
canvas.addEventListener('mousedown', (e) => { if (!locked) { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', (e) => {
  if (locked) {
    orbit.yaw -= e.movementX * 0.0024; orbit.pitch += e.movementY * 0.0024;
    orbit.pitch = Math.max(-0.3, Math.min(1.3, orbit.pitch));
    return;
  }
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastX) * 0.005; orbit.pitch += (e.clientY - lastY) * 0.005;
  orbit.pitch = Math.max(-0.3, Math.min(1.3, orbit.pitch));
  lastX = e.clientX; lastY = e.clientY;
});
function unlock() { if (locked) document.exitPointerLock?.(); }
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.max(0.3, Math.min(20, orbit.dist + e.deltaY * 0.01)); }, { passive: false });

// All camera touches in one place, tracked by the touches that BEGAN on the
// world canvas. Counting e.touches instead would include the finger parked on
// the joystick, so holding the stick made every look drag read as a two-finger
// pinch — you could never move and look at the same time, which makes a wall
// hop (hold into the wall, flick the camera) impossible.
// One canvas touch = look, two = pinch zoom. The canvas is touch-action:none,
// so these can stay passive.
const camTouches = new Map();
let pinchGap = 0;
const gapOf = () => { const [a, b] = [...camTouches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
canvas.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) camTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
  if (camTouches.size === 2) pinchGap = gapOf();
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    const p = camTouches.get(t.identifier);
    if (!p) continue;
    if (camTouches.size === 1) {
      orbit.yaw -= (t.clientX - p.x) * 0.006;
      orbit.pitch += (t.clientY - p.y) * 0.006;
      orbit.pitch = Math.max(-0.3, Math.min(1.3, orbit.pitch));
    }
    p.x = t.clientX; p.y = t.clientY;
  }
  if (camTouches.size === 2) {
    const gap = gapOf();
    if (pinchGap > 0 && gap > 0) orbit.dist = Math.max(0.3, Math.min(20, orbit.dist * (pinchGap / gap)));
    pinchGap = gap;
  }
}, { passive: true });
const endCamTouch = (e) => {
  for (const t of e.changedTouches) camTouches.delete(t.identifier);
  if (camTouches.size < 2) pinchGap = 0;
};
canvas.addEventListener('touchend', endCamTouch, { passive: true });
canvas.addEventListener('touchcancel', endCamTouch, { passive: true });

function readInput() {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const z = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  player.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  return { x, z, jump: keys.has('Space'), up: keys.has('Space'), down: keys.has('ControlLeft') || keys.has('KeyC') };
}

// chat
function openChat() { unlock(); $('#chat-input-row').classList.remove('hidden'); $('#chat-input').focus(); }
function sendChat() {
  const inp = $('#chat-input'); const text = inp.value.trim();
  if (text) net.send({ t: 'chat', text });
  inp.value = ''; inp.blur(); $('#chat-input-row').classList.add('hidden');
}
$('#chat-send').onclick = sendChat;

// ---------- mobile ----------
let mobileStick = null;
setupMobile();
function setupMobile() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  $('#move-cluster').classList.remove('hidden');
  const base = $('#joystick-base'), knob = $('#joystick-knob'); const stick = { x: 0, z: 0 };
  let touchId = null, cx = 0, cy = 0;
  const zone = $('#joystick-zone');
  zone.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; touchId = t.identifier; const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; }, { passive: true });
  zone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === touchId) {
      let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy), max = 50;
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.left = (35 + dx) + 'px'; knob.style.top = (35 + dy) + 'px';
      stick.x = dx / max; stick.z = -dy / max;
    }
  }, { passive: true });
  zone.addEventListener('touchend', () => { touchId = null; stick.x = stick.z = 0; knob.style.left = '35px'; knob.style.top = '35px'; }, { passive: true });
  // The jump itself is driven by `jumpAt` (buffered jump), not by the key set —
  // the touch button only added 'Space' to `keys`, which nothing reads for
  // jumping, so the button did nothing at all.
  $('#btn-jump').addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.add('Space');
    jumpAt = performance.now() / 1000;
  }, { passive: false });
  $('#btn-jump').addEventListener('touchend', () => keys.delete('Space'), { passive: true });
  $('#btn-jump').addEventListener('touchcancel', () => keys.delete('Space'), { passive: true });
  mobileStick = stick;
}

// ---------- main loop ----------
let last = performance.now();
// ---------------------------------------------------------------- gear
const codeHdr = () => ({ 'x-cbx-code': localStorage.getItem('claudebox.code') || '' });
const myName = () => localStorage.getItem('claudebox.user') || '';

async function loadGear() {
  try {
    const r = await fetch('/api/obby/gear?name=' + encodeURIComponent(myName()), { headers: codeHdr() });
    const j = await r.json();
    gear.owned = new Set(j.owned || []);
    myBux = j.cubes ?? myBux;
  } catch {}
  buildHotbar(); renderShop();
}

let myBux = 0;
async function buyGear(id) {
  const g = GEAR_BY_ID[id]; if (!g || hasGear(id)) return;
  try {
    const r = await fetch('/api/obby/gear/buy', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...codeHdr() },
      body: JSON.stringify({ name: myName(), gear: id }),
    });
    const j = await r.json();
    if (!j.ok) { sfx.deny(); toast(j.error === 'not enough' ? 'Not enough ClaudeBux' : (j.error || 'Purchase failed')); return; }
    gear.owned = new Set(j.owned || []);
    myBux = j.cubes;
    sfx.buy(); toast(`Bought ${g.name}!`);
    buildHotbar(); renderShop();
  } catch { toast('Purchase failed'); }
}

// hold-type gear toggles in and out of your hand
function equipGear(id) {
  const g = GEAR_BY_ID[id];
  if (!g || !hasGear(id)) { sfx.deny(); return; }
  if (g.slot === 'hold') {
    gear.held = (gear.held === id) ? null : id;
    sfx.equip();
  } else if (g.slot === 'deploy') deployCarpet();
  else if (g.slot === 'use') useSkip();
  buildHotbar();
}

// ---- Magic Carpet: a platform you ride, steered with your look ----
function deployCarpet() {
  const now = performance.now() / 1000;
  if (now < gear.carpetCdUntil) { sfx.deny(); toast('Carpet is recharging'); return; }
  if (gear.carpet) return;
  const g = GEAR_BY_ID.carpet;
  const grp = new THREE.Group();
  const rug = new THREE.Mesh(boxGeo(4.2, 0.25, 3), new THREE.MeshLambertMaterial({ color: '#8c5ae8' }));
  const trim = new THREE.Mesh(boxGeo(4.5, 0.12, 3.3), new THREE.MeshLambertMaterial({ color: '#ffd84a' }));
  trim.position.y = -0.1;
  grp.add(rug, trim);
  grp.position.set(player.pos.x, player.pos.y - 0.2, player.pos.z);
  scene.add(grp);
  gear.carpet = { mesh: grp, until: now + g.life };
  gear.carpetCdUntil = now + g.cooldown;
  sfx.carpet(); toast('🧞 Carpet deployed — stand on it and steer with your look');
  buildHotbar();
}

// ---- Stage Skip: warp to the next checkpoint ----
function useSkip() {
  const now = performance.now() / 1000;
  if (now < gear.skipCdUntil) {
    toast(`Skip recharging (${Math.ceil(gear.skipCdUntil - now)}s)`); sfx.deny(); return;
  }
  const next = COURSE.checkpoints.find((c) => c.n === (game.stage || 0) + 1);
  if (!next) { sfx.deny(); toast('No stage to skip to'); return; }
  gear.skipCdUntil = now + GEAR_BY_ID.skip.cooldown;
  player.pos.x = next.x; player.pos.y = next.y + 1.2; player.pos.z = next.z;
  player.vel.x = player.vel.y = player.vel.z = 0;
  game.stage = next.n; net.send({ t: 'checkpoint', n: next.n });
  sfx.warp(); toast(`⏭️ Skipped to stage ${next.n}`);
  buildHotbar();
}

function tickGear(dt, time) {
  const now = performance.now() / 1000;
  // carpet: ride it, steer with your look, and it expires
  if (gear.carpet) {
    const c = gear.carpet;
    const on = Math.abs(player.pos.x - c.mesh.position.x) < 2.3
            && Math.abs(player.pos.z - c.mesh.position.z) < 1.7
            && Math.abs(player.pos.y - (c.mesh.position.y + 0.32)) < 1.1;
    if (on) {
      const g = GEAR_BY_ID.carpet;
      const fx = -Math.sin(orbit.yaw), fz = -Math.cos(orbit.yaw);
      const inp = readInput();
      const drive = (inp.z || 0);
      c.mesh.position.x += fx * drive * g.flySpeed * dt;
      c.mesh.position.z += fz * drive * g.flySpeed * dt;
      c.mesh.position.y += ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * g.flySpeed * 0.6 * dt;
      c.mesh.rotation.y = orbit.yaw;
      // carry the rider
      player.pos.x = c.mesh.position.x; player.pos.z = c.mesh.position.z;
      player.pos.y = c.mesh.position.y + 0.32;
      player.vel.y = 0; player.grounded = true; gear.airJumps = 0;
    }
    if (now > c.until) { scene.remove(c.mesh); gear.carpet = null; buildHotbar(); toast('Carpet faded'); }
  }
  // rainbow trail. It only emits while you are actually moving — standing still
  // used to stack every puff on the same spot, which built a solid coloured
  // block glued to your chest (and sat dead centre of the Look Lock camera).
  const trailSpeed = Math.hypot(player.vel.x, player.vel.z);
  if (hasGear('trail') && !game.dead && trailSpeed > 1.5) {
    if (!tickGear._t || now - tickGear._t > 0.05) {
      tickGear._t = now;
      const hue = (now * 120) % 360;
      const puff = new THREE.Mesh(boxGeo(0.4, 0.4, 0.4),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(`hsl(${hue},90%,60%)`), transparent: true, opacity: 0.9 }));
      puff.position.set(player.pos.x, player.pos.y + 0.25, player.pos.z);
      scene.add(puff);
      gear.trail.push({ mesh: puff, t: 0 });
    }
  }
  for (let i = scuffs.length - 1; i >= 0; i--) {
    const sc = scuffs[i]; sc.t += dt;
    sc.mesh.material.opacity = Math.max(0, 0.75 - sc.t / 0.45);
    sc.mesh.scale.setScalar(1 + sc.t * 3);
    if (sc.t > 0.45) { scene.remove(sc.mesh); scuffs.splice(i, 1); }
  }
  for (let i = gear.trail.length - 1; i >= 0; i--) {
    const p2 = gear.trail[i]; p2.t += dt;
    p2.mesh.material.opacity = Math.max(0, 0.9 - p2.t / 0.9);
    p2.mesh.scale.setScalar(Math.max(0.05, 1 - p2.t));
    if (p2.t > 0.9) { scene.remove(p2.mesh); gear.trail.splice(i, 1); }
  }
}

// ---- hotbar + shop UI ----
function buildHotbar() {
  const bar = $('#gear-bar'); if (!bar) return;
  const mine = GEAR.filter((g) => hasGear(g.id) && g.slot !== 'passive');
  bar.innerHTML = '';
  bar.classList.toggle('hidden', mine.length === 0);
  mine.forEach((g, i) => {
    const b = document.createElement('button');
    b.className = 'gear-slot' + (gear.held === g.id ? ' on' : '');
    const now = performance.now() / 1000;
    const cd = g.id === 'skip' ? gear.skipCdUntil - now : g.id === 'carpet' ? gear.carpetCdUntil - now : 0;
    b.innerHTML = `<span class="k">${i + 1}</span><i>${g.emoji}</i><small>${g.name.split(' ')[0]}</small>`
      + (cd > 0 ? `<span class="cd">${Math.ceil(cd)}s</span>` : '');
    b.addEventListener('click', () => { sfx.click(); equipGear(g.id); });
    bar.appendChild(b);
  });
}
function renderShop() {
  const list = $('#shop-list'); if (!list) return;
  $('#shop-bux').textContent = myBux;
  list.innerHTML = '';
  for (const g of GEAR) {
    const owned = hasGear(g.id);
    const row = document.createElement('div');
    row.className = 'shop-row' + (owned ? ' owned' : '');
    row.innerHTML = `<span class="ico">${g.emoji}</span>
      <span class="who"><b>${g.name}</b><small>${g.blurb}</small></span>`;
    const btn = document.createElement('button');
    btn.className = 'buy' + (owned ? ' have' : '');
    btn.textContent = owned ? 'Owned' : `🔷 ${g.price}`;
    btn.disabled = owned;
    if (!owned) btn.addEventListener('click', () => buyGear(g.id));
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const time = serverTime || now / 1000;

  // ---- cull: 900+ objects over 8000 studs, so only draw what is near you ----
  const px = player.pos.x;
  for (const o of staticMeshes) {
    const near = Math.abs(o.x - px) < DRAW;
    if (o.mesh.visible !== near) o.mesh.visible = near;
  }
  for (const o of courseObjs) {
    const near = Math.abs(o.x - px) < DRAW;
    if (o.mesh.visible !== near) {
      o.mesh.visible = near;
      if (o.extra) o.extra.visible = near;
      if (o.anchor) o.anchor.visible = near;
    }
    if (!near) continue;
    if (o.kind === 'blinker') {
      // fade out over the last of the solid window, so you get a warning
      const ph = blinkPhase(o.spec, time);
      const on = blinkOn(o.spec, time);
      o.mesh.material.opacity = on ? (ph > 0.7 ? 1 - (ph - 0.7) / 0.3 * 0.75 : 1) : 0.14;
    } else if (o.kind === 'pendulum') {
      const wp = pendulumPos(o.spec, time);
      o.ball.position.set(wp.x, wp.y, wp.z);
      // stretch the chain between the anchor and the ball
      const ax = o.spec.x, ay = o.spec.y, az = o.spec.z;
      o.chain.position.set((ax + wp.x) / 2, (ay + wp.y) / 2, (az + wp.z) / 2);
      const dy = wp.y - ay, dz = wp.z - az;
      o.chain.scale.y = Math.hypot(dy, dz);
      o.chain.rotation.x = Math.atan2(dz, -dy);
    } else if (o.kind === 'laser') {
      const on = laserOn(o.spec, time);
      o.mesh.material.opacity = on ? 0.8 : 0.1;
      o.mesh.scale.x = on ? 1 : 0.35;
    } else if (o.kind === 'conveyor' && o.extra) {
      // slide the arrows to show the direction of travel
      const w = o.spec.w;
      o.extra.position.x = o.spec.x + (((time * o.spec.dx * 0.35) % 3.2) + 3.2) % 3.2 - 1.6;
    }
  }
  for (const c of clouds) { c.position.x -= dt * 1.6; if (c.position.x < player.pos.x - 900) c.position.x += 1800; }
  // animate course
  for (const f of spinFlags) f.rotation.y += dt * 1.5;
  for (const mm of moverMeshes) { const wp = moverPos(mm.spec, time); mm.mesh.position.set(wp.x, wp.y, wp.z); }
  for (const sm of spinnerMeshes) sm.pivot.rotation.y = spinAngle(sm.spec, time);
  tickGear(dt, time);

  // input + player
  const input = readInput();
  if (mobileStick) { input.x += mobileStick.x; input.z += mobileStick.z; }
  // A held jump re-arms in exactly two places: on the ground (bunny-hopping,
  // matching the keyboard's key repeat) and while pressed against a wall (so a
  // wall hop can be chained by holding the button instead of demanding a
  // frame-perfect mid-air tap). Anywhere else in the air it stays disarmed, so
  // this never becomes a free flight button.
  if (keys.has('Space')) {
    const t = performance.now() / 1000;
    if (player.grounded || (!player.grounded && t - wallHop.touchAt < WALL_GRACE)) jumpAt = t;
  }
  if (myAvatar.ctrl) {
    updatePlayer(dt, input, time);
    myAvatar.ctrl.setAnim(player.anim);
    myAvatar.ctrl.moveSpeed = Math.hypot(player.vel.x, player.vel.z);
    myAvatar.ctrl.update(dt);
    myAvatar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
    myAvatar.group.rotation.y = player.ry;
    sun.position.set(player.pos.x + 50, player.pos.y + 120, player.pos.z + 40);
    sun.target.position.set(player.pos.x, player.pos.y, player.pos.z);
    fpFade(myAvatar.group, orbit.dist);   // fade MY avatar out when zoomed to first-person
  }
  updateCamera();
  updateTrollButton();

  // remote players
  for (const [, r] of remotes) {
    const s = r.interp.sample([3]);
    if (s) {
      r.group.position.set(s[0], s[1], s[2]); r.group.rotation.y = s[3];
      r.ctrl.setAnim(s[4]);
      r.ctrl.moveSpeed = s[4] === 'run' ? RUN : s[4] === 'walk' ? MOVE : 0;
    }
    r.ctrl.update(dt);
  }

  // lasers
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i]; L.ttl -= dt;
    const a = headPos(L.by), b = headPos(L.target);
    if (a && b) { orientBeam(L.beam, a, b); L.flash.position.copy(b); }
    L.beam.material.opacity = Math.max(0, L.ttl / 0.55) * 0.95;
    L.flash.intensity = Math.max(0, L.ttl / 0.55) * 6;
    if (L.ttl <= 0) { scene.remove(L.beam); scene.remove(L.flash); lasers.splice(i, 1); }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
(async function boot() {
  // if a course was designed for Obby in ClaudeBox Studio, make it live
  try {
    const { level } = await (await fetch('/api/level/obby')).json();
    applyCourse(toObbyCourse(level));   // null/empty → keeps the built-in course
  } catch {}
  buildCourse();
  player.pos = { x: START.x, y: START.y, z: START.z };

  identity = await loadIdentity();
  await preloadAvatars(['boy', 'girl']);
  myAvatar.ctrl = makeAvatar(identity.avatar || {});
  myAvatar.group = myAvatar.ctrl.group;
  scene.add(myAvatar.group);
  camera.position.set(START.x, START.y + 6, START.z + 10);
  net.connect();
  net.on('_open', () => {});
  net.join({ name: identity.name, avatar: identity.avatar, code: localStorage.getItem('claudebox.code') || '' });
  net.startMovementStream(() => {
    if (game.carried) return null;
    return { t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim };
  });
  // shop wiring
  $('#shop-btn')?.addEventListener('click', () => { sfx.unlock(); sfx.click(); renderShop(); $('#shop').classList.remove('hidden'); });
  $('#shop-close')?.addEventListener('click', () => { sfx.click(); $('#shop').classList.add('hidden'); });
  $('#shop')?.addEventListener('click', (e) => { if (e.target.id === 'shop') $('#shop').classList.add('hidden'); });
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, () => sfx.unlock(), { once: true }));
  await loadGear();

  requestAnimationFrame(frame);
  window.__obby = { net, player, remotes, game, scene, orbit, camera, lasers, gear, GEAR, renderer,
    buyGear, equipGear, useSkip, deployCarpet, courseObjs, staticMeshes,
    lookLock: lookLockOn, wallHop, resolveWalls, __jumpAt: () => jumpAt };   // debug/test hook
})();
