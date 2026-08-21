// The stage list.
//
// Stages 1–5 of World 1 follow the real game's layouts (gaps, the chaser, the
// rolling gumball, the turning course, the vanishing path); the rest escalate
// those primitives. A stage is data — a shape for the board plus a list of
// hazards — so a new one is a table row, not new code.

import * as THREE from 'three';
import { makeKeyField, KEY_SIZE, KEY_GAP, THEMES } from '/keyescape/js/keys.js';
import { makeChaser, makeRoller, makeSpinner, makeCrusher, makeDissolve, makeMover } from '/keyescape/js/hazards.js';

const PITCH = KEY_SIZE + KEY_GAP;

// ---- board shapes -------------------------------------------------------
// Each returns cells(c, r) -> null (gap) or { h } (a cap at height h).
const SHAPES = {
  flat: () => () => ({ h: 0 }),

  // bands of keys with gaps between them — jumpable early, walkable once fast
  gaps: ({ every = 9, width = 3 }) => (c, r) => (r % every < every - width ? { h: 0 } : null),


  // a long ramp; the rolling ball stages use this
  slope: ({ rows, rise = 14 }) => (c, r) => ({ h: (1 - r / rows) * rise }),

  // straight, left, straight, right, straight
  turns: ({ cols, rows }) => {
    const seg = rows / 5, mid = cols / 2, half = 2.2;
    return (c, r) => {
      const s = Math.floor(r / seg);
      let centre = mid;
      if (s === 1) centre = mid - cols * 0.22;
      else if (s === 2) centre = mid - cols * 0.22;
      else if (s === 3) centre = mid + cols * 0.22;
      else if (s === 4) centre = mid + cols * 0.22;
      // widen at the seams so the turns connect
      const w = (r % seg < 2.2) ? cols * 0.30 : half;
      return Math.abs(c - centre) <= w ? { h: 0 } : null;
    };
  },

  // a narrow beam with the void either side
  // The sine makes the beam weave. Clamped, because on a narrow board the
  // trough went negative and produced rows with no floor at all — an
  // unfinishable stage rather than a hard one.
  narrow: ({ cols, width = 4 }) => (c, r) =>
    (Math.abs(c - cols / 2) <= Math.max(1.1, width + Math.sin(r * 0.13) * 1.6) ? { h: 0 } : null),

  // stepping islands
  islands: ({ every = 7, size = 3 }) => (c, r) =>
    ((r % every < size) && (c % every < size + 1) ? { h: 0 } : null),

  // a staircase of key rows
  stairs: ({ step = 6, rise = 0.9 }) => (c, r) => ({ h: Math.floor(r / step) * rise }),
};

// ---- the table ----------------------------------------------------------
// wins/rec follow the wiki where it records them.
const W1 = [
  { n: 1,  title: 'First Steps',      theme: 'candy',     shape: 'gaps',    opt: { every: 8, width: 3 }, wins: 1,    rec: 1,  diff: 'Easy',   rows: 74,  hazards: [] },
  { n: 2,  title: 'The Ballerina',    theme: 'chocolate', shape: 'flat',    opt: {},                       wins: 3,    rec: 8,  diff: 'Easy',   rows: 82,  hazards: [{ t: 'chaser', at: 0.42, speed: 5.2 }] },
  { n: 3,  title: 'Gumball Hill',     theme: 'candy',     shape: 'slope',   opt: { rise: 15 },             wins: 10,   rec: 10, diff: 'Easy',   rows: 88,  hazards: [{ t: 'roller', lane: 0.5, radius: 5.4, period: 6.2 }, { t: 'rest', at: 0.35 }, { t: 'rest', at: 0.7 }] },
  { n: 4,  title: 'The Course',       theme: 'chocolate', shape: 'turns',   opt: {},                       wins: 25,   rec: 14, diff: 'Medium', rows: 95,  hazards: [{ t: 'crusher', at: 0.3 }, { t: 'crusher', at: 0.68 }] },
  { n: 5,  title: 'Vanishing Path',   theme: 'candy',     shape: 'narrow',  opt: { width: 3 },             wins: 50,   rec: 20, diff: 'Medium', rows: 70,  hazards: [{ t: 'dissolve', from: 0.22, to: 0.86, fade: 3 }] },
  { n: 6,  title: 'Double Trouble',   theme: 'chocolate', shape: 'flat',    opt: {},                       wins: 80,   rec: 26, diff: 'Medium', rows: 92,  hazards: [{ t: 'chaser', at: 0.3, speed: 5.6 }, { t: 'chaser', at: 0.66, speed: 6.1 }] },
  { n: 7,  title: 'Spin Cycle',       theme: 'candy',     shape: 'flat',    opt: {},                       wins: 120,  rec: 32, diff: 'Medium', rows: 96,  hazards: [{ t: 'spinner', at: 0.25 }, { t: 'spinner', at: 0.5 }, { t: 'spinner', at: 0.75 }] },
  { n: 8,  title: 'The Long Drop',    theme: 'mint',      shape: 'islands', opt: { every: 6, size: 2 },    wins: 180,  rec: 40, diff: 'Hard',   rows: 90,  hazards: [] },
  { n: 9,  title: 'Rolling Thunder',  theme: 'candy',     shape: 'slope',   opt: { rise: 20 },             wins: 260,  rec: 48, diff: 'Hard',   rows: 100, hazards: [{ t: 'roller', lane: 0.34, radius: 5, period: 5.2 }, { t: 'roller', lane: 0.66, radius: 5, period: 5.2, offset: 2.6 }] },
  { n: 10, title: 'Cookie Crush',     theme: 'chocolate', shape: 'flat',    opt: {},                       wins: 380,  rec: 58, diff: 'Hard',   rows: 96,  hazards: [{ t: 'crusher', at: 0.22 }, { t: 'crusher', at: 0.44, off: 1 }, { t: 'crusher', at: 0.66, off: 2 }, { t: 'crusher', at: 0.86, off: 0.5 }] },
  { n: 11, title: 'Tightrope',        theme: 'mint',      shape: 'narrow',  opt: { width: 1.4 },             wins: 520,  rec: 70, diff: 'Hard',   rows: 88,  hazards: [{ t: 'spinner', at: 0.4 }, { t: 'spinner', at: 0.72 }] },
  { n: 12, title: 'Stair Sprint',     theme: 'candy',     shape: 'stairs',  opt: { step: 5, rise: 1.1 },   wins: 700,  rec: 84, diff: 'Hard',   rows: 94,  hazards: [{ t: 'chaser', at: 0.35, speed: 6.8 }] },
  { n: 13, title: 'Crossfire',        theme: 'chocolate', shape: 'flat',    opt: {},                       wins: 950,  rec: 100, diff: 'Insane', rows: 98, hazards: [{ t: 'spinner', at: 0.2 }, { t: 'crusher', at: 0.42 }, { t: 'chaser', at: 0.6, speed: 7 }, { t: 'spinner', at: 0.82 }] },
  { n: 14, title: 'The Gauntlet',     theme: 'mint',      shape: 'gaps',    opt: { every: 6, width: 3 },   wins: 1300, rec: 120, diff: 'Insane', rows: 100, hazards: [{ t: 'roller', lane: 0.5, radius: 6, period: 4.6 }, { t: 'chaser', at: 0.5, speed: 7.4 }] },
  { n: 15, title: 'Keyboard King',    theme: 'candy',     shape: 'flat',    opt: {},                       wins: 2000, rec: 150, diff: 'Insane', rows: 110, hazards: [{ t: 'chaser', at: 0.28, speed: 7.2, scale: 1.6 }, { t: 'crusher', at: 0.5 }, { t: 'spinner', at: 0.66 }, { t: 'roller', lane: 0.5, radius: 6.5, period: 4.2 }] },
];

// Worlds 2 and 3 reuse the primitives at a harsher tuning.
function derive(world, list, mult, themes) {
  return list.map((s, i) => ({
    ...s,
    world,
    title: s.title,
    theme: themes[i % themes.length],
    wins: Math.round(s.wins * mult),
    rec: Math.round(s.rec * mult),
    hazards: s.hazards.map((h) => ({
      ...h,
      speed: h.speed ? h.speed * 1.3 : undefined,
      period: h.period ? h.period * 0.72 : undefined,
    })),
  }));
}

const W2_TITLES = ['Cocoa Run', 'Sugar Rush', 'Bitter Slope', 'Wafer Way', 'Fading Fudge', 'Twin Terrors',
  'Whisk Away', 'Truffle Islands', 'Boulder Bakery', 'Press Factory', 'Praline Beam', 'Layer Cake',
  'Kitchen Chaos', 'Mixer Gauntlet', 'Cocoa Crown'];
const W3_TITLES = ['Minted', 'Frostbite', 'Glass Keys', 'The Last Board', 'Escape'];

const W2 = derive(2, W1, 9, ['chocolate', 'candy', 'mint']).map((s, i) => ({ ...s, title: W2_TITLES[i], n: i + 1 }));
const W3 = derive(3, W1.slice(10, 15), 60, ['mint', 'candy', 'chocolate']).map((s, i) => ({ ...s, title: W3_TITLES[i], n: i + 1 }));

export const WORLDS = [
  { id: 1, name: 'World 1 — Candy Kitchen', stages: W1.map((s) => ({ ...s, world: 1 })) },
  { id: 2, name: 'World 2 — Chocolate Factory', stages: W2 },
  { id: 3, name: 'World 3 — Mint Vault', stages: W3 },
];

export const allStages = () => WORLDS.flatMap((w) => w.stages);
export const stageAt = (world, n) => WORLDS.find((w) => w.id === world)?.stages.find((s) => s.n === n) || null;
export const stageIndex = (world, n) => allStages().findIndex((s) => s.world === world && s.n === n);

// ---- building a stage into the scene ------------------------------------
export function buildStage(scene, spec) {
  // A narrow board is the difficulty dial that costs nothing: less room to
  // drift around a hazard, and the edges are a real threat.
  const cols = 21;
  const rows = spec.rows || 90;
  const shape = SHAPES[spec.shape](({ ...spec.opt, cols, rows }));

  // A start apron and a finish apron are always solid, so you never spawn or
  // finish over a hole.
  const cells = (c, r) => {
    if (r < 5 || r > rows - 6) return { h: shapeHeight(c, r) };
    return shape(c, r);
  };
  const shapeHeight = (c, r) => {
    const cell = shape(c, Math.max(5, Math.min(rows - 6, r)));
    return cell ? cell.h : (spec.shape === 'slope' ? (1 - r / rows) * (spec.opt.rise || 14)
                          : spec.shape === 'stairs' ? Math.floor(r / (spec.opt.step || 6)) * (spec.opt.rise || 0.9) : 0);
  };

  const field = makeKeyField(scene, { cols, rows, cells, theme: spec.theme, origin: { x: 0, z: 0 } });
  const th = THEMES[spec.theme] || THEMES.candy;
  const width = cols * PITCH, length = rows * PITCH;
  const midX = width / 2;

  // ---- set dressing ----
  const decor = new THREE.Group();
  scene.add(decor);
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const wallH = 26;
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.5, wallH, length + 90), lam(th.wall));
    w.position.set(midX + side * (width / 2 + 5), wallH / 2 - 4, length / 2 - 12);
    decor.add(w);
  }
  // Far enough back that the chase camera — which sits ~19 units behind the
  // player, and the player starts near z=4 — never ends up on the wrong side of
  // it looking at plaster.
  const back = new THREE.Mesh(new THREE.BoxGeometry(width + 20, wallH, 2.5), lam(th.wall));
  back.position.set(midX, wallH / 2 - 4, -34); decor.add(back);
  // a base slab under the board so gaps read as depth, not as nothing
  // Sits under the board only. Extending it back toward the camera put a slab
  // of colour across the bottom of the screen at the start of every stage.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width + 14, 3, length + 8), lam(th.base));
  slab.position.set(midX, -11, length / 2 + 2); decor.add(slab);

  // themed props along the walls
  const rnd = (seed) => Math.abs(Math.sin(seed * 127.1) * 43758.5453) % 1;
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? 1 : -1;
    const z = (i / 22) * length + rnd(i) * 6;
    const x = midX + side * (width / 2 + 8.5);
    const y = 5 + rnd(i * 3) * 12;
    let prop;
    if (spec.theme === 'candy') {
      // cotton-candy clouds and lollipops
      if (i % 3 === 0) {
        prop = new THREE.Mesh(new THREE.SphereGeometry(2.4 + rnd(i * 5) * 1.6, 12, 9), lam(i % 2 ? '#ffb3e6' : '#e3b6ff'));
      } else {
        prop = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.5, 18), lam(i % 2 ? '#ff5fa8' : '#fff0f7'));
        disc.rotation.z = Math.PI / 2;
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 5, 8), lam('#fff6fb'));
        stick.position.y = -3.2;
        prop.add(disc, stick);
      }
    } else if (spec.theme === 'chocolate') {
      if (i % 3 === 0) {
        prop = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.55, 16), lam('#c8964f'));   // cookie
        prop.rotation.z = Math.PI / 2;
      } else {
        prop = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.2, 2.6), lam('#6b421f'));             // wafer
      }
    } else {
      prop = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 + rnd(i * 7) * 1.2, 0), lam(i % 2 ? '#9ff5d4' : '#e8fff8'));
    }
    prop.position.set(x, y, z);
    decor.add(prop);
  }

  // ---- start / finish ----
  // A safe zone over the start apron, like the real game's. Nothing can hurt you
  // inside it and chasers cannot enter, which is what stops a chaser parking on
  // the spawn and killing you the instant you respawn, forever.
  const safeZ = 9 * PITCH;
  const safePad = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.98, 0.3, safeZ),
    new THREE.MeshBasicMaterial({ color: 0x2fe58a, transparent: true, opacity: 0.16, depthWrite: false }));
  safePad.position.set(midX, shapeHeight(cols / 2, 4) + 1.0, safeZ / 2 - PITCH);
  scene.add(safePad);
  const safeSign = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, 2.4, 0.4),
    new THREE.MeshBasicMaterial({ color: 0x2fe58a, transparent: true, opacity: 0.4 }));
  safeSign.position.set(midX, shapeHeight(cols / 2, 4) + 5, safeZ);
  scene.add(safeSign);

  const spawn = { x: midX, z: 2 * PITCH, y: shapeHeight(cols / 2, 2) + 2 };
  const goalZ = (rows - 3) * PITCH;
  const goalY = shapeHeight(cols / 2, rows - 3);
  const goal = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.55, 0.5, 7),
    new THREE.MeshBasicMaterial({ color: 0x2fe58a, transparent: true, opacity: 0.55 }));
  goal.position.set(midX, goalY + 0.9, goalZ);
  scene.add(goal);
  const goalPost = new THREE.Mesh(new THREE.BoxGeometry(width * 0.55, 9, 0.7), lam('#2fe58a'));
  goalPost.position.set(midX, goalY + 5, goalZ + 3.4);
  goalPost.material.transparent = true; goalPost.material.opacity = 0.35;
  scene.add(goalPost);

  // ---- hazards ----
  const hazards = [];
  const rests = [];
  for (const h of (spec.hazards || [])) {
    const z = (h.at ?? 0.5) * length;
    if (h.t === 'chaser') {
      hazards.push(makeChaser(scene, {
        x: midX, z, speed: h.speed || 5.4, scale: h.scale || 1, chase: h.chase !== false,
        minZ: safeZ + 4,
        colour: spec.theme === 'chocolate' ? '#f0d9c0' : '#ffe6f2',
        dress: spec.theme === 'chocolate' ? '#7b4b2a' : '#ff5c8a',
      }));
    } else if (h.t === 'roller') {
      hazards.push(makeRoller(scene, {
        x: (h.lane ?? 0.5) * width, z0: length * 0.94, z1: length * 0.06,
        radius: h.radius || 5, period: h.period || 6, offset: h.offset || 0,
        colour: th.keys[2],
      }));
    } else if (h.t === 'spinner') {
      hazards.push(makeSpinner(scene, { x: midX, z, colour: th.accent, len: 13 }));
    } else if (h.t === 'crusher') {
      hazards.push(makeCrusher(scene, { x: midX, z, period: 3, offset: h.off || 0, colour: th.base }));
    } else if (h.t === 'dissolve') {
      hazards.push(makeDissolve(scene, { field, z0: (h.from ?? 0.25) * length, z1: (h.to ?? 0.85) * length, fade: h.fade || 3 }));
    } else if (h.t === 'mover') {
      hazards.push(makeMover(scene, { x0: midX - width * 0.3, x1: midX + width * 0.3, z, colour: th.keys[3] }));
    } else if (h.t === 'rest') {
      // a safe ledge the roller cannot reach
      const pad = new THREE.Mesh(new THREE.BoxGeometry(7, 1, 8), lam(th.accent));
      const py = shapeHeight(cols / 2, Math.round(z / PITCH));
      pad.position.set(midX + (rests.length % 2 ? 1 : -1) * (width * 0.36), py + 1.1, z);
      scene.add(pad);
      rests.push(pad);
    }
  }

  function dispose() {
    field.dispose();
    for (const h of hazards) h.dispose();
    for (const p of rests) scene.remove(p);
    scene.remove(decor); scene.remove(goal); scene.remove(goalPost);
    scene.remove(safePad); scene.remove(safeSign);
  }

  return { field, hazards, rests, spawn, safeZ, goal: { z: goalZ, y: goalY }, width, length, midX, cols, rows, theme: th, spec, dispose };
}
