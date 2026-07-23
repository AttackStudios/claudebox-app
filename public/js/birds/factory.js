// Procedural bird builder v3: high-poly smooth-shaded textured birds,
// redesigned against the reference sheet. Bodies are lathed profiles (or
// horizontal quadruped torsos for Griffin/Peryton), wings and tails are fans
// of textured flight feathers, faces carry per-species marking overlays, and
// every part is keyed to a customizable color slot.
// Pivot names/semantics are unchanged so animate.js drives these directly
// (quadrupeds add legBL/legBR rear-leg pivots).
// Returns { group, parts, setColors, breed, stage, def, size, standH }.

import * as THREE from 'three';
import { BREEDS, COLOR_SLOTS, defaultColors } from './breeds.js';
import { bodyTexture, featherTexture, eggTexture, smoothTexture } from './textures.js';

// breeds with streaky/speckled plumage
const SPECKLED = new Set(['robin', 'sparrow', 'owl', 'falcon', 'vulture', 'chicken']);

const matCache = new Map();
function material(hex, texKind = 'plain', emissiveBoost = 0) {
  const key = `${hex}:${texKind}:${emissiveBoost}`;
  if (!matCache.has(key)) {
    const opts = { color: hex, flatShading: false };
    let map = null;
    if (texKind === 'feather') map = featherTexture();
    else if (texKind === 'egg') map = eggTexture();
    else if (texKind === 'smooth') map = smoothTexture();
    else if (texKind !== 'none') map = bodyTexture(texKind);
    if (map) opts.map = map;
    if (texKind === 'feather') {
      opts.alphaTest = 0.5;
      opts.side = THREE.DoubleSide;
    }
    const m = new THREE.MeshLambertMaterial(opts);
    // the painted plumage doubles as a heightmap: scallops, barbs and
    // speckles rise off the surface instead of reading as flat print
    if (map && (typeof window === 'undefined' || window.__ffBumps !== false)) {
      m.bumpMap = map;
      m.bumpScale = { feather: 0.02, fluff: 0.018, egg: 0.008, smooth: 0.004 }[texKind] ?? 0.012;
    }
    if (emissiveBoost > 0) m.emissive = new THREE.Color(hex).multiplyScalar(emissiveBoost);
    matCache.set(key, m);
  }
  return matCache.get(key);
}

function mesh(geo, hex, slot, texKind = 'plain', emissiveBoost = 0) {
  const m = new THREE.Mesh(geo, material(hex, texKind, emissiveBoost));
  m.userData.slot = slot;
  m.userData.tex = texKind;
  m.userData.em = emissiveBoost;
  m.castShadow = true;
  return m;
}

// ---------- shared geometries (built once) ----------
const GEO = {};
function geoBody() {
  if (GEO.body) return GEO.body;
  // bird body profile, lathed: tail point -> full breast -> neck base
  const pts = [
    [0.02, -0.62], [0.13, -0.54], [0.27, -0.40], [0.40, -0.20],
    [0.475, 0.00], [0.50, 0.16], [0.46, 0.30], [0.36, 0.42],
    [0.22, 0.50], [0.08, 0.54], [0.0, 0.55],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 24);
  g.rotateX(Math.PI / 2); // axis: +z = front
  GEO.body = g;
  return g;
}
// A real 3-D flight feather: a tapered leaf-shaped vane with actual
// thickness and a raised central shaft, gently curled toward the tip.
// Unit feather extends +x (quill at origin), width along z, thickness along
// y — matching the old orientation so all wing/tail/crest code is unchanged.
function geoFeather() {
  if (GEO.feather) return GEO.feather;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);                                  // quill base
  sh.bezierCurveTo(0.18, 0.46, 0.62, 0.5, 1, 0.05); // leading edge → tip
  sh.bezierCurveTo(0.62, -0.5, 0.18, -0.46, 0, 0);  // trailing edge → base
  const vane = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false, steps: 1 });
  vane.translate(0, 0, -0.035);
  vane.rotateX(-Math.PI / 2);   // length→x, width→z, thickness→y
  // raised central shaft (a slim half-tube down the spine)
  const shaft = new THREE.CylinderGeometry(0.035, 0.018, 1, 5, 1);
  shaft.rotateZ(Math.PI / 2);
  shaft.translate(0.5, 0.03, 0);
  const merged = mergeGeos([vane, shaft]);
  // curl: droop the tip a little so feathers read as curved, not flat
  const pos = merged.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setY(i, pos.getY(i) - 0.14 * x * x);
  }
  pos.needsUpdate = true;
  merged.computeVertexNormals();
  GEO.feather = merged;
  return merged;
}
const sphere = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);
const cyl = (r1, r2, len, seg = 10) => new THREE.CylinderGeometry(r1, r2, len, seg);
const cone = (r, len, seg = 12) => new THREE.ConeGeometry(r, len, seg);

// tiny BufferGeometry merge (positions only need to share attributes; all our
// source geos are non-indexed-friendly, so expand to non-indexed and concat)
function mergeGeos(geos) {
  const arrays = geos.map((g) => g.toNonIndexed().attributes.position.array);
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}

// a single flight feather mesh (solid 3-D vane)
function feather(len, width, hex, slot, em = 0) {
  const f = mesh(geoFeather(), hex, slot, 'none', em);
  f.scale.set(len, Math.min(len, 0.8), width);
  return f;
}

export function buildBird(breedId, colors, stage = 'adult') {
  const def = BREEDS[breedId] || BREEDS.robin;
  const c = { ...defaultColors(breedId, stage), ...stripNull(colors) };
  if (stage === 'egg') {
    // eggs are eggshell with a whisper of the bird's tint — a robin's egg
    // should never render as a black robin-colored blob
    const shell = new THREE.Color('#f2ead8').lerp(new THREE.Color(c.body || '#f2ead8'), 0.22);
    const speck = new THREE.Color('#b8a890').lerp(new THREE.Color(c.accent || '#b8a890'), 0.3);
    return buildEgg({ ...c, body: '#' + shell.getHexString(), accent: '#' + speck.getHexString() }, def);
  }

  const group = new THREE.Group();
  const parts = {};
  const emissive = def.extras?.includes('emissive') ? 0.45 : 0;
  const bodyTex = def.extras?.includes('membraneWings') ? 'scales' : SPECKLED.has(breedId) ? 'speckled' : 'plain';

  const baby = stage === 'baby';
  const fledge = stage === 'fledgling';   // between chick and adult: 3/4 size, still a bit round
  const quad = def.plan === 'quad';
  const S = def.size * (baby ? 0.5 : fledge ? 0.75 : 1);
  const bodyW = def.body.w * (baby ? 1.15 : fledge ? 1.06 : 1);
  const bodyH = def.body.h * (baby ? 1.1 : fledge ? 1.04 : 1);
  const bodyL = def.body.len * (baby ? 0.8 : fledge ? 0.92 : 1);
  const headSize = def.headSize * (baby ? 1.5 : fledge ? 1.18 : 1);
  const legLen = def.legLen * (baby ? 0.62 : fledge ? 0.85 : 1) * S;
  const neckLen = def.neckLen * (baby ? 0.45 : fledge ? 0.75 : 1) * S;
  const upright = def.upright;

  const root = new THREE.Group();
  group.add(root);
  parts.root = root;

  // ---- body ----
  let neckBase;
  if (quad) {
    neckBase = buildQuadBody(root, def, c, S, bodyW, bodyH, bodyL, baby, emissive, bodyTex);
  } else {
    if (upright) {
      // penguins: a clean vertical capsule torso
      const body = mesh(new THREE.CapsuleGeometry(0.4 * S * bodyW, 0.62 * S * bodyH, 8, 18), c.body, 'body', baby ? 'fluff' : bodyTex, emissive);
      body.position.y = 0.05 * S;
      root.add(body);
      parts.body = body;
      const belly = mesh(sphere(0.42 * S, 18, 12), c.belly, 'belly', 'fluff');
      belly.scale.set(bodyW * 0.78, bodyH * 1.18, 0.62);
      belly.position.set(0, -0.02 * S, 0.17 * S);
      root.add(belly);
      parts.belly = belly;
      neckBase = { x: 0, y: (0.5 * bodyH + 0.12) * S, z: 0.05 * S };
    } else {
      const body = mesh(geoBody(), c.body, 'body', baby ? 'fluff' : bodyTex, emissive);
      body.scale.set(bodyW * S, bodyH * S, bodyL * S * 1.3);
      body.rotation.x = -0.18;
      root.add(body);
      parts.body = body;

      // belly: soft downy underside
      const belly = mesh(sphere(0.42 * S, 18, 12), c.belly, 'belly', 'fluff');
      belly.scale.set(bodyW * 0.8, bodyH * 0.85, bodyL * 1.0);
      belly.position.set(0, -0.12 * S, 0.14 * S);
      root.add(belly);
      parts.belly = belly;
      neckBase = { x: 0, y: 0.32 * bodyH * S, z: 0.48 * bodyL * S };
    }
  }

  // ---- neck & head ----
  const neckPivot = new THREE.Group();
  neckPivot.position.set(neckBase.x, neckBase.y, neckBase.z);
  root.add(neckPivot);
  parts.neck = neckPivot;

  let headBase = { x: 0, y: 0.18 * S, z: 0.05 * S };
  if (neckLen > 0.02) {
    const bend = def.neckCurve ? 0.3 * S : 0.08 * S;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, -0.08 * S, 0),
      new THREE.Vector3(0, neckLen * 0.55, bend * 1.4),
      new THREE.Vector3(0, neckLen, bend)
    );
    const neck = mesh(
      new THREE.TubeGeometry(curve, 10, 0.135 * S * Math.max(headSize, 0.8), 10),
      quad ? c.body : c.body, 'body', bodyTex, emissive
    );
    neckPivot.add(neck);
    headBase = { x: 0, y: neckLen + 0.1 * S, z: bend };
  }

  // hackle mane: a collar of swept-back feathers below the head
  if (def.mane && !baby) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 1.6;
      const f = feather(0.5 * S, 0.16 * S, c.head, 'head', emissive);
      f.position.set(Math.sin(a) * 0.14 * S, neckLen * 0.4, -0.06 * S);
      f.rotation.y = Math.PI / 2 + a * 0.7;
      f.rotation.z = 0.85;
      neckPivot.add(f);
    }
  }

  const headPivot = new THREE.Group();
  headPivot.position.set(headBase.x, headBase.y, headBase.z);
  neckPivot.add(headPivot);
  parts.head = headPivot;

  const head = mesh(sphere(0.3 * S * headSize), c.head, 'head', baby ? 'fluff' : bodyTex, emissive);
  head.scale.set(1, 0.95, 1.08);
  headPivot.add(head);

  // eyes with a glossy highlight (slit pupils for cockatrices)
  const eyelids = [];
  for (const side of [-1, 1]) {
    const eye = mesh(sphere(0.062 * S * headSize, 12, 9), c.eyes, 'eyes', 'none');
    eye.position.set(side * 0.2 * S * headSize, 0.08 * S * headSize, 0.2 * S * headSize);
    headPivot.add(eye);
    if (def.eyeKind === 'slit') {
      const pupil = mesh(sphere(0.026 * S * headSize, 8, 6), '#16181c', 'eyes', 'none');
      pupil.userData.slot = null;
      pupil.scale.set(0.5, 1.6, 0.5);
      pupil.position.copy(eye.position);
      pupil.position.x += side * 0.028 * S * headSize;
      pupil.position.z += 0.022 * S * headSize;
      headPivot.add(pupil);
    }
    const shine = mesh(sphere(0.02 * S * headSize, 8, 6), '#ffffff', 'eyes', 'none');
    shine.position.set(side * 0.22 * S * headSize, 0.1 * S * headSize, 0.24 * S * headSize);
    shine.userData.slot = null; // always white
    headPivot.add(shine);
    // eyelid: a head-colored cap that blinks (animate scales it)
    const lid = mesh(sphere(0.068 * S * headSize, 10, 7), c.head, 'head', 'none', emissive);
    lid.position.copy(eye.position);
    lid.scale.set(1, 0.12, 1);
    lid.position.y += 0.055 * S * headSize;
    headPivot.add(lid);
    eyelids.push(lid);
  }
  parts.eyelids = eyelids;

  // ---- beak ----
  const beakLen = def.beakLen * S * (baby ? 0.8 : 1);
  let beak;
  const beakY = -0.02 * S;
  switch (def.beak) {
    case 'hook': {
      beak = new THREE.Group();
      const base = mesh(cone(0.1 * S * headSize, beakLen, 14), c.beak, 'beak', 'smooth');
      base.rotation.x = Math.PI / 2;
      base.position.z = beakLen / 2;
      const hook = mesh(sphere(0.058 * S * headSize, 12, 9), c.beak, 'beak', 'smooth');
      hook.scale.set(0.8, 1.05, 1.15);
      hook.position.set(0, -0.018 * S, beakLen * 0.98);
      beak.add(base, hook);
      break;
    }
    case 'spoon': {
      beak = mesh(new THREE.CapsuleGeometry(0.1 * S, beakLen * 0.8, 6, 12), c.beak, 'beak', 'smooth');
      beak.scale.set(2.0, 0.5, 1);
      beak.rotation.x = Math.PI / 2;
      beak.position.z = beakLen / 2;
      break;
    }
    case 'long': {
      beak = mesh(cone(0.06 * S * headSize, beakLen, 12), c.beak, 'beak', 'smooth');
      beak.rotation.x = Math.PI / 2;
      beak.position.z = beakLen / 2;
      break;
    }
    case 'big': {
      beak = new THREE.Group();
      const main = mesh(cyl(0.085 * S, 0.155 * S, beakLen, 14), c.beak, 'beak', 'smooth');
      main.rotation.x = Math.PI / 2 + 0.12;
      main.position.z = beakLen / 2;
      // toco bill: black tip
      const tip = mesh(sphere(0.09 * S, 12, 9), '#1d1f24', null, 'smooth');
      tip.userData.slot = null;
      tip.position.set(0, -0.07 * S, beakLen * 0.96);
      beak.add(main, tip);
      break;
    }
    default: {
      beak = mesh(cone(0.085 * S * headSize, beakLen, 12), c.beak, 'beak', 'smooth');
      beak.rotation.x = Math.PI / 2;
      beak.position.z = beakLen / 2;
    }
  }
  beak.position.y = beakY;
  beak.position.z += 0.26 * S * headSize;
  headPivot.add(beak);
  parts.beak = beak;

  const beakTip = new THREE.Group();
  beakTip.position.set(0, beakY - 0.05 * S, 0.26 * S * headSize + beakLen + 0.05 * S);
  headPivot.add(beakTip);
  parts.beakTip = beakTip;

  // ---- crests ----
  buildCrest(def, headPivot, c, S, headSize, emissive, baby);
  if (def.wattle) {
    const w = mesh(sphere(0.06 * S, 12, 9), c.accent, 'accent', 'smooth');
    w.scale.y = 1.4;
    w.position.set(0, -0.18 * S, 0.2 * S * headSize);
    headPivot.add(w);
  }
  if (def.ruff) {
    const ruff = mesh(cyl(0.24 * S, 0.32 * S, 0.18 * S, 16), c.belly, 'belly', 'fluff');
    ruff.position.y = -0.05 * S;
    neckPivot.add(ruff);
  }

  // ---- antlers (adults only) ----
  if (def.antlers && !baby) {
    for (const side of [-1, 1]) {
      const antler = buildAntler(c, S, side);
      antler.position.set(side * 0.14 * S * headSize, 0.24 * S * headSize, -0.04 * S);
      headPivot.add(antler);
    }
  }

  // ---- face / body markings ----
  if (def.markings && !(baby && def.baby?.noMarkings)) {
    buildMarkings(def.markings, { headPivot, neckPivot, root, c, S, headSize, neckLen, emissive, baby });
  }

  // ---- wings: fans of layered flight feathers ----
  const membrane = def.extras?.includes('membraneWings');
  const span = def.wingSpan * S * (baby ? 0.62 : 1);
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    if (quad) pivot.position.set(side * 0.34 * bodyW * S, 0.32 * S, 0.18 * bodyL * S);
    else pivot.position.set(side * 0.4 * bodyW * S, (upright ? 0.25 : 0.2) * S, (upright ? 0 : 0.12) * S);
    root.add(pivot);

    const wing = new THREE.Group(); // contents extend +x, mirrored for the left
    if (def.flipper) {
      const flip = mesh(new THREE.CapsuleGeometry(0.14 * S, 0.5 * S, 6, 12), c.wings, 'wings', bodyTex);
      flip.scale.set(0.4, 1, 0.85);
      flip.rotation.z = Math.PI / 2 + 0.25;
      flip.position.set(0.2 * S, -0.18 * S, 0);
      wing.add(flip);
    } else if (membrane) {
      const armLen = span * 0.95;
      const arm = mesh(cyl(0.05 * S, 0.03 * S, armLen, 10), c.body, 'body', 'scales', emissive);
      arm.rotation.z = Math.PI / 2;
      arm.position.x = armLen / 2;
      // membrane: a fan of broad "skin" panels, scale-textured
      for (let i = 0; i < 4; i++) {
        const m = feather(armLen * (1 - i * 0.16), span * 0.34, c.wings, 'wings', emissive);
        m.position.y = -0.02 * S - i * 0.008 * S;
        m.rotation.y = 0.14 + i * 0.16;
        wing.add(m);
      }
      // wing spikes along the leading edge (cockatrice)
      for (let i = 0; i < 3; i++) {
        const spike = mesh(cone(0.035 * S, 0.16 * S, 8), c.beak, 'beak', 'smooth');
        spike.position.set(armLen * (0.4 + i * 0.28), 0.05 * S, 0.02 * S);
        wing.add(spike);
      }
      const claw = mesh(cone(0.035 * S, 0.14 * S, 8), c.beak, 'beak', 'smooth');
      claw.position.set(armLen, 0.02 * S, 0.04 * S);
      claw.rotation.x = Math.PI / 2;
      wing.add(arm, claw);
    } else {
      // a real feathered wing: a leading-edge bone with overlapping rows of
      // 3-D feathers — long primaries fanning off the tip, shorter secondaries
      // filling the inner trailing edge, and coverts smoothing the top.
      const armLen = span * 0.62;
      const arm = mesh(cyl(0.06 * S, 0.035 * S, armLen, 7), c.body, 'body', bodyTex, emissive);
      arm.rotation.z = Math.PI / 2;
      arm.position.x = armLen / 2;
      wing.add(arm);

      const nP = baby ? 6 : 11;                 // primaries + secondaries
      for (let i = 0; i < nP; i++) {
        const t = i / (nP - 1);
        // feathers root progressively out along the bone; outer ones longest
        const rootX = armLen * (0.25 + 0.72 * t);
        const len = span * (0.66 - 0.34 * t * t) * (i > nP * 0.55 ? 0.82 : 1);
        const a = 0.04 + 0.7 * t;               // sweep back toward the tail
        const f = feather(len, span * 0.26, c.wings, 'wings', emissive);
        f.position.set(rootX, -0.01 * S - i * 0.006 * S, 0.01 * S);
        f.rotation.y = a;
        f.rotation.z = -0.05 - 0.04 * i;        // each feather droops a touch (airfoil)
        wing.add(f);
        // contrasting tip on the longest outer primaries
        if (def.wingTips !== false && !baby && t > 0.45 && t < 0.92) {
          const tipF = feather(len * 0.34, span * 0.22, c.accent, 'accent', emissive);
          tipF.position.set(rootX + Math.cos(a) * len * 0.62, 0.004 * S - i * 0.006 * S, 0.01 * S - Math.sin(a) * len * 0.62);
          tipF.rotation.y = a;
          tipF.rotation.z = -0.05 - 0.04 * i;
          wing.add(tipF);
        }
      }
      // covert row: shorter body-colored feathers laid over the roots on top
      const nC = baby ? 4 : 7;
      for (let i = 0; i < nC; i++) {
        const t = i / (nC - 1);
        const f = feather(span * (0.42 - 0.16 * t), span * 0.2, c.body, 'body', emissive);
        f.position.set(armLen * (0.2 + 0.6 * t), 0.05 * S, 0.02 * S);
        f.rotation.y = 0.06 + 0.55 * t;
        f.rotation.z = -0.04;
        wing.add(f);
      }
      // rounded shoulder hides the quill roots where the wing meets the body
      const shoulder = mesh(sphere(0.16 * S, 14, 10), c.body, 'body', 'fluff', emissive);
      shoulder.scale.set(1.3, 0.8, 1.2);
      shoulder.position.x = 0.04 * S;
      wing.add(shoulder);
    }
    if (side === -1) wing.scale.x = -1;
    pivot.add(wing);
    parts[side === -1 ? 'wingL' : 'wingR'] = pivot;
  }

  // ---- tail ----
  const tailPivot = new THREE.Group();
  if (quad) tailPivot.position.set(0, 0.18 * S, -0.62 * bodyL * S);
  else tailPivot.position.set(0, (upright ? -0.38 : 0.14) * S, (upright ? -0.42 : -0.58) * bodyL * S);
  root.add(tailPivot);
  parts.tail = tailPivot;
  buildTail(def, tailPivot, c, S * (baby ? 0.7 : 1), emissive, baby);

  // ---- legs ----
  if (quad) {
    const stance = { fz: 0.42 * bodyL * S, rz: -0.4 * bodyL * S, x: 0.22 * bodyW * S, y: -0.3 * bodyH * S };
    for (const [name, side, z, type] of [
      ['legL', -1, stance.fz, def.legsFront || 'talon'],
      ['legR', 1, stance.fz, def.legsFront || 'talon'],
      ['legBL', -1, stance.rz, def.legsRear || 'paw'],
      ['legBR', 1, stance.rz, def.legsRear || 'paw'],
    ]) {
      const isRear = name.startsWith('legB');
      // griffins: white-feathered front legs ending in golden talons
      const legC = !isRear && type === 'talon' && def.legsRear === 'paw'
        ? { ...c, legs: c.accent } : c;
      const hip = buildLeg(type, legC, S, legLen, emissive, isRear);
      hip.position.set(side * stance.x, stance.y, z);
      root.add(hip);
      parts[name] = hip;
    }
  } else {
    for (const side of [-1, 1]) {
      const hip = buildLeg('talon', c, S, legLen, emissive, false);
      hip.position.set(side * 0.18 * bodyW * S, (upright ? -0.62 : -0.34) * bodyH * S, (upright ? 0 : -0.02) * S);
      root.add(hip);
      parts[side === -1 ? 'legL' : 'legR'] = hip;
    }
  }

  // ---- mythical particles ----
  if (def.extras?.includes('embers')) parts.particles = addParticles(group, 0xffa030, 0xff5010, S);
  if (def.extras?.includes('glow')) parts.particles = addParticles(group, 0x8a5df2, 0x3a1d72, S);

  const standH = quad
    ? legLen + 0.3 * bodyH * S + 0.1 * S
    : legLen + 0.12 * S + (upright ? 0.62 * bodyH : 0.34 * bodyH) * S;
  root.position.y = standH;
  group.userData = { breedId, stage, standH, size: S, def };

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return {
    group, parts, breed: breedId, stage, def, size: S, standH,
    setColors: (cols) => applyColors(group, { ...defaultColors(breedId, stage), ...stripNull(cols) }, emissive),
  };
}

// ---------- quadruped torso (griffin, peryton) ----------
function buildQuadBody(root, def, c, S, bodyW, bodyH, bodyL, baby, emissive, bodyTex) {
  const L = bodyL * S * 1.05;
  const tex = baby ? 'fluff' : bodyTex;
  // main torso: horizontal capsule, slightly tapered to the rump
  const torso = mesh(new THREE.CapsuleGeometry(0.34 * S * bodyW, L, 8, 14), c.body, 'body', tex, emissive);
  torso.rotation.x = Math.PI / 2;
  torso.position.y = 0.02 * S;
  root.add(torso);

  // feathered chest (front) — the griffin's white front half
  const chest = mesh(sphere(0.38 * S * bodyW, 18, 12), c.belly, 'belly', 'fluff');
  chest.scale.set(1, 1.1, 1.05);
  chest.position.set(0, -0.02 * S, L * 0.42);
  root.add(chest);

  // rump (rear haunches use the leg color: lion brown / deer brown)
  const rump = mesh(sphere(0.36 * S * bodyW, 18, 12), def.legsRear === 'paw' ? c.legs : c.body,
    def.legsRear === 'paw' ? 'legs' : 'body', tex, emissive);
  rump.scale.set(1.05, 1.05, 1.15);
  rump.position.set(0, 0.02 * S, -L * 0.42);
  root.add(rump);

  return { x: 0, y: 0.26 * S * bodyH, z: L * 0.52 };
}

// ---------- legs ----------
// type: 'talon' (bird), 'hoof' (deer), 'paw' (lion). Returns the hip pivot.
function buildLeg(type, c, S, legLen, emissive, isRear) {
  const hip = new THREE.Group();
  const total = legLen + 0.1 * S;

  // feathered/furred thigh
  const thighSlot = type === 'paw' ? 'legs' : type === 'hoof' ? 'body' : 'body';
  const thigh = mesh(sphere(type === 'talon' ? 0.11 * S : 0.14 * S, 12, 9), c[thighSlot], thighSlot, 'fluff', emissive);
  thigh.scale.set(0.9, 1.2, 1);
  thigh.position.y = -0.04 * S;
  hip.add(thigh);

  if (type === 'hoof') {
    // slim deer leg in body color with a dark hoof
    const leg = mesh(cyl(0.045 * S, 0.035 * S, total, 8), c.body, 'body', 'smooth');
    leg.position.y = -total / 2;
    hip.add(leg);
    const hoof = mesh(cyl(0.05 * S, 0.045 * S, 0.09 * S, 8), '#26262a', null, 'smooth');
    hoof.userData.slot = null;
    hoof.position.y = -total - 0.03 * S;
    hip.add(hoof);
  } else if (type === 'paw') {
    // thicker lion leg + round paw
    const leg = mesh(cyl(0.07 * S, 0.055 * S, total, 10), c.legs, 'legs', 'smooth');
    leg.position.y = -total / 2;
    hip.add(leg);
    const paw = mesh(sphere(0.085 * S, 10, 8), c.legs, 'legs', 'smooth');
    paw.scale.set(1.1, 0.7, 1.3);
    paw.position.set(0, -total, 0.03 * S);
    hip.add(paw);
    for (let i = -1; i <= 1; i++) {
      const clawTip = mesh(cone(0.018 * S, 0.05 * S, 6), '#26262a', null, 'smooth');
      clawTip.userData.slot = null;
      clawTip.rotation.x = Math.PI / 2;
      clawTip.position.set(i * 0.045 * S, -total - 0.02 * S, 0.13 * S);
      hip.add(clawTip);
    }
  } else {
    // bird leg with toes
    const leg = mesh(cyl(0.042 * S, 0.034 * S, total, 10), c.legs, 'legs', 'smooth');
    leg.position.y = -total / 2;
    hip.add(leg);
    const foot = new THREE.Group();
    foot.position.y = -total;
    for (const [ang, len] of [[-0.45, 0.2], [0, 0.24], [0.45, 0.2], [Math.PI, 0.12]]) {
      const toe = mesh(cyl(0.022 * S, 0.014 * S, len * S, 8), c.legs, 'legs', 'smooth');
      toe.rotation.x = Math.PI / 2;
      toe.rotation.z = -ang;
      toe.position.set(Math.sin(ang) * len * S * 0.5, 0.02 * S, Math.cos(ang) * len * S * 0.5);
      foot.add(toe);
    }
    hip.add(foot);
  }
  return hip;
}

// ---------- crests ----------
function buildCrest(def, headPivot, c, S, headSize, emissive, baby) {
  const scale = baby ? 0.6 : 1;
  switch (def.crest) {
    case 'spike': {
      for (let i = 0; i < 3; i++) {
        const f = feather((0.34 * S - i * 0.05 * S) * scale, 0.1 * S, c.head, 'head', emissive);
        f.position.set(0, 0.27 * S * headSize, (0.06 - i * 0.07) * S);
        f.rotation.z = 1.1 - i * 0.18; // sweep up & back
        f.rotation.y = Math.PI / 2;
        headPivot.add(f);
      }
      break;
    }
    case 'comb': {
      for (let i = 0; i < 3; i++) {
        const bump = mesh(sphere(0.07 * S * scale, 12, 9), c.accent, 'accent', 'smooth');
        bump.position.set(0, (0.3 - 0.015 * i) * S * headSize, (0.1 - i * 0.11) * S);
        headPivot.add(bump);
      }
      break;
    }
    case 'plume': {
      for (let i = -1; i <= 1; i++) {
        const stem = mesh(cyl(0.012 * S, 0.012 * S, 0.3 * S * scale, 6), c.beak, 'beak', 'smooth');
        stem.position.set(i * 0.07 * S, 0.38 * S * headSize, 0);
        stem.rotation.z = i * 0.25;
        const tip = mesh(sphere(0.05 * S, 10, 8), c.body, 'body', 'fluff', emissive);
        tip.position.y = 0.17 * S * scale;
        stem.add(tip);
        headPivot.add(stem);
      }
      break;
    }
    case 'ears': {
      for (const side of [-1, 1]) {
        const ear = mesh(cone(0.07 * S, 0.22 * S * scale, 10), c.head, 'head', 'plain', emissive);
        ear.position.set(side * 0.16 * S * headSize, 0.3 * S * headSize, 0);
        ear.rotation.z = -side * 0.25;
        headPivot.add(ear);
      }
      break;
    }
    case 'deerEars': {
      for (const side of [-1, 1]) {
        const ear = mesh(sphere(0.085 * S, 10, 8), c.body, 'body', 'fluff');
        ear.scale.set(0.55, 1.25, 0.35);
        ear.position.set(side * 0.24 * S * headSize, 0.22 * S * headSize, -0.05 * S);
        ear.rotation.z = -side * 0.8;
        headPivot.add(ear);
        const inner = mesh(sphere(0.05 * S, 8, 6), c.belly, 'belly', 'none');
        inner.scale.set(0.45, 1.1, 0.3);
        inner.position.copy(ear.position);
        inner.position.z += 0.02 * S;
        inner.rotation.z = ear.rotation.z;
        headPivot.add(inner);
      }
      break;
    }
    case 'flame': {
      // phoenix: a fan of flame feathers, yellow-tipped
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const f = feather((0.42 - 0.08 * Math.abs(t - 0.5) * 2) * S * scale, 0.09 * S, i % 2 ? c.accent : c.head, i % 2 ? 'accent' : 'head', emissive);
        f.position.set((t - 0.5) * 0.16 * S, 0.26 * S * headSize, 0.02 * S - t * 0.05 * S);
        f.rotation.z = 1.25 - t * 0.3;
        f.rotation.y = Math.PI / 2 + (t - 0.5) * 0.5;
        headPivot.add(f);
      }
      break;
    }
  }
}

// ---------- antlers ----------
function buildAntler(c, S, side) {
  const g = new THREE.Group();
  const mat = (geo) => mesh(geo, c.accent, 'accent', 'smooth');
  // main beam sweeps up, out and back; tines fork forward off it
  const beamLen = 0.6 * S;
  const beam = mat(cyl(0.024 * S, 0.04 * S, beamLen, 7));
  beam.geometry = beam.geometry.clone();
  beam.geometry.translate(0, beamLen / 2, 0);
  beam.rotation.z = -side * 0.55;
  beam.rotation.x = 0.45;
  g.add(beam);
  for (const t of [0.35, 0.62, 0.88]) {
    const len = (0.34 - t * 0.12) * S;
    const tine = mat(cyl(0.012 * S, 0.02 * S, len, 6));
    tine.geometry = tine.geometry.clone();
    tine.geometry.translate(0, len / 2, 0);
    // position along the beam's local direction
    tine.position.set(side * Math.sin(0.55) * beamLen * t * -1, Math.cos(0.55) * Math.cos(0.45) * beamLen * t, -Math.sin(0.45) * beamLen * t);
    tine.rotation.z = -side * 0.15;
    tine.rotation.x = -0.75;   // tines rake forward
    g.add(tine);
  }
  return g;
}

// ---------- per-species marking overlays ----------
function buildMarkings(kind, ctx) {
  const { headPivot, neckPivot, root, c, S, headSize, neckLen, emissive } = ctx;
  const hs = S * headSize;
  const patch = (slot, r, sx, sy, sz, x, y, z, tex = 'plain') => {
    const p = mesh(sphere(r, 14, 10), c[slot] ?? slot, c[slot] !== undefined ? slot : null, tex, emissive);
    if (c[slot] === undefined) p.userData.slot = null;
    p.scale.set(sx, sy, sz);
    p.position.set(x, y, z);
    headPivot.add(p);
    return p;
  };

  switch (kind) {
    case 'robin': {
      // white eye-rings + pale chin
      for (const side of [-1, 1]) {
        const ring = mesh(new THREE.TorusGeometry(0.075 * hs, 0.016 * hs, 6, 14), c.accent, 'accent', 'none');
        ring.position.set(side * 0.2 * hs, 0.08 * hs, 0.2 * hs);
        ring.rotation.y = side * 0.5;
        headPivot.add(ring);
      }
      patch('accent', 0.09 * hs, 1.2, 0.7, 0.7, 0, -0.14 * hs, 0.24 * hs);
      break;
    }
    case 'cardinal': {
      // black mask wrapping the beak base and eyes
      patch('accent', 0.16 * hs, 1.45, 0.85, 0.85, 0, -0.015 * hs, 0.17 * hs);
      break;
    }
    case 'duck': {
      // white neck ring where the green head meets the body
      const ring = mesh(new THREE.TorusGeometry(0.14 * S, 0.028 * S, 8, 16), c.belly, 'belly', 'none');
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.16 * hs;
      headPivot.add(ring);
      break;
    }
    case 'sparrow': {
      // gray crown cap + white cheeks + black bib
      patch('body', 0.27 * hs, 1.04, 0.7, 1.0, 0, 0.13 * hs, -0.02 * hs);
      for (const side of [-1, 1]) patch('accent', 0.1 * hs, 1, 0.85, 0.8, side * 0.2 * hs, -0.03 * hs, 0.12 * hs);
      patch('beak', 0.1 * hs, 1.15, 0.9, 0.7, 0, -0.16 * hs, 0.2 * hs);
      break;
    }
    case 'chickadee': {
      // black cap + black bib over a white face
      patch('accent', 0.28 * hs, 1.05, 0.62, 1.05, 0, 0.15 * hs, -0.01 * hs);
      patch('accent', 0.11 * hs, 1.2, 0.85, 0.8, 0, -0.16 * hs, 0.18 * hs);
      break;
    }
    case 'owl': {
      // barn-owl face: a pale plate hugging the front of the head
      const plate = mesh(sphere(0.27 * hs, 16, 12), c.accent, 'accent', 'fluff');
      plate.scale.set(1.0, 1.12, 0.42);
      plate.position.set(0, 0.0, 0.1 * hs);
      headPivot.add(plate);
      break;
    }
    case 'falcon': {
      // white cheeks under the dark hood (the malar stripe reads between them)
      for (const side of [-1, 1]) patch('accent', 0.11 * hs, 1, 0.95, 0.75, side * 0.17 * hs, -0.07 * hs, 0.13 * hs);
      break;
    }
    case 'penguin': {
      // emperor ear patches + pale chin
      for (const side of [-1, 1]) patch('accent', 0.09 * hs, 1, 1.25, 0.9, side * 0.2 * hs, -0.02 * hs, -0.04 * hs);
      patch('belly', 0.12 * hs, 1.1, 1, 0.7, 0, -0.16 * hs, 0.14 * hs);
      break;
    }
    case 'macaw': {
      // big bare white face patch + dark lower mandible
      for (const side of [-1, 1]) patch('beak', 0.12 * hs, 0.75, 1.0, 0.38, side * 0.16 * hs, 0.04 * hs, 0.19 * hs, 'smooth');
      const jaw = mesh(sphere(0.07 * hs, 10, 8), '#1d1f24', null, 'smooth');
      jaw.userData.slot = null;
      jaw.scale.set(1, 0.6, 1.1);
      jaw.position.set(0, -0.12 * hs, 0.3 * hs);
      headPivot.add(jaw);
      break;
    }
    case 'toucan': {
      // white bib at the throat
      patch('belly', 0.16 * hs, 1.1, 1.15, 0.65, 0, -0.16 * hs, 0.12 * hs);
      break;
    }
    case 'peacock': {
      // white cheek swooshes
      for (const side of [-1, 1]) {
        const sw = mesh(sphere(0.05 * hs, 8, 6), '#f2f2ee', null, 'none');
        sw.userData.slot = null;
        sw.scale.set(0.8, 1.6, 0.5);
        sw.position.set(side * 0.18 * hs, 0.02 * hs, 0.16 * hs);
        headPivot.add(sw);
      }
      break;
    }
    case 'phoenix': {
      // golden eye mask
      for (const side of [-1, 1]) patch('accent', 0.075 * hs, 1.3, 0.8, 0.6, side * 0.18 * hs, 0.08 * hs, 0.16 * hs);
      break;
    }
    case 'griffin': {
      // pink inner ears
      for (const side of [-1, 1]) {
        const inner = mesh(sphere(0.045 * S, 8, 6), '#f2a8a8', null, 'none');
        inner.userData.slot = null;
        inner.scale.set(0.5, 1.1, 0.35);
        inner.position.set(side * 0.16 * hs, 0.3 * hs, 0.03 * S);
        headPivot.add(inner);
      }
      break;
    }
    case 'cockatrice': {
      // feathered brow ridges over the slit eyes
      for (const side of [-1, 1]) {
        const brow = feather(0.16 * S, 0.06 * S, c.head, 'head', emissive);
        brow.position.set(side * 0.16 * hs, 0.16 * hs, 0.12 * hs);
        brow.rotation.y = Math.PI / 2 + side * 0.5;
        brow.rotation.z = 0.5;
        headPivot.add(brow);
      }
      break;
    }
    case 'peryton': {
      // white skull-mask sits on a brown head: brown crown + nape behind it
      const crown = mesh(sphere(0.3 * hs, 14, 10), c.body, 'body', 'fluff');
      crown.scale.set(1.02, 0.9, 0.85);
      crown.position.set(0, 0.05 * hs, -0.1 * hs);
      headPivot.add(crown);
      // brown chest mane below the neck
      const mane = mesh(sphere(0.2 * S, 12, 9), c.body, 'body', 'fluff');
      mane.scale.set(1, 1.5, 0.9);
      mane.position.set(0, neckLen * 0.3, 0.06 * S);
      neckPivot.add(mane);
      break;
    }
  }
}

function buildTail(def, pivot, c, S, emissive, baby) {
  const tailSlot = def.tailSlot || 'wings';
  const fan = (count, len, width, spread, slot = tailSlot, pitch = 0.32) => {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const f = feather(len * (0.82 + 0.18 * Math.sin(Math.PI * t)), width, c[slot], slot, emissive);
      f.rotation.y += Math.PI / 2 + (t - 0.5) * spread; // fan around -z
      f.position.y = (Math.abs(t - 0.5)) * -0.012 * S;
      f.rotation.z = pitch * (0.5 - Math.abs(t - 0.5));
      pivot.add(f);
    }
    pivot.rotation.x = 0.35;
  };

  if (baby && ['peacock', 'streamer', 'train', 'spikes'].includes(def.tail)) {
    // hatchlings get a stubby fan whatever the adult tail is
    fan(4, 0.4 * S, 0.13 * S, 0.6, def.tail === 'spikes' ? 'accent' : tailSlot);
    return;
  }

  switch (def.tail) {
    case 'long': fan(5, 0.85 * S, 0.16 * S, 0.5); break;
    case 'forked': {
      fan(2, 0.7 * S, 0.12 * S, 0.85);
      fan(2, 0.45 * S, 0.12 * S, 0.3);
      break;
    }
    case 'pin': fan(3, 0.32 * S, 0.1 * S, 0.4); break;
    case 'puff': {
      const t = mesh(sphere(0.18 * S, 14, 10), c.accent, 'accent', 'fluff');
      t.position.set(0, 0.08 * S, -0.1 * S);
      pivot.add(t);
      break;
    }
    case 'peacock': {
      fan(7, 1.5 * S, 0.2 * S, 0.6, 'accent');
      // eye-spots along the train
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const a = Math.PI / 2 + (t - 0.5) * 0.6;
        const d = 1.5 * S * (0.82 + 0.18 * Math.sin(Math.PI * t)) * 0.72;
        const dot = mesh(sphere(0.06 * S, 10, 8), c.body, 'body', 'none');
        dot.scale.set(1, 0.3, 1.4);
        dot.position.set(Math.cos(a) * d, 0.03 * S, -Math.sin(a) * d);
        pivot.add(dot);
      }
      pivot.rotation.x = 0.42;
      break;
    }
    case 'streamer': {
      // phoenix: layered flame fans + a long streamer ending in an arrowhead
      fan(5, 1.1 * S, 0.17 * S, 0.5, 'wings');
      fan(4, 0.85 * S, 0.15 * S, 0.38, 'accent');
      // streamer along dir (0, sin a, -cos a), a = upward trail angle
      const a = 0.18;
      const sLen = 1.7 * S;
      const dirY = Math.sin(a), dirZ = -Math.cos(a);
      const stem = mesh(cyl(0.012 * S, 0.02 * S, sLen, 6), c.body, 'body', 'smooth', emissive);
      stem.geometry = stem.geometry.clone();
      stem.geometry.translate(0, sLen / 2, 0);
      stem.rotation.x = -(Math.PI / 2 - a);
      stem.position.set(0, 0.05 * S, -0.1 * S);
      pivot.add(stem);
      const arrow = mesh(cone(0.11 * S, 0.3 * S, 4), c.accent, 'accent', 'smooth', emissive);
      arrow.rotation.x = -(Math.PI / 2 - a);
      arrow.rotation.y = Math.PI / 4;
      arrow.position.set(0, 0.05 * S + dirY * sLen, -0.1 * S + dirZ * sLen);
      pivot.add(arrow);
      const flame = feather(0.42 * S, 0.14 * S, c.accent, 'accent', emissive);
      flame.rotation.y = Math.PI / 2;
      flame.rotation.z = a;
      flame.position.set(0, 0.05 * S + dirY * sLen * 0.82, -0.1 * S + dirZ * sLen * 0.82);
      pivot.add(flame);
      break;
    }
    case 'spikes': {
      // cockatrice: long blue spike-feathers with red tips (fixed two-tone)
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const len = (1.15 - 0.3 * Math.abs(t - 0.5) * 2) * S;
        const up = 0.42 + Math.abs(t - 0.5) * 0.5;       // outer spikes rake higher
        const dirY = Math.sin(up), dirZ = -Math.cos(up);
        const a = (t - 0.5) * 0.7;                        // sideways fan
        const spike = mesh(cone(0.045 * S, len, 5), '#2455c8', null, 'smooth');
        spike.userData.slot = null;
        spike.geometry = spike.geometry.clone();
        spike.geometry.translate(0, len / 2, 0);
        spike.rotation.order = 'YXZ';
        spike.rotation.y = a;
        spike.rotation.x = -(Math.PI / 2 - up);
        spike.position.set(0, 0.08 * S, -0.05 * S);
        pivot.add(spike);
        const tip = mesh(cone(0.03 * S, 0.2 * S, 5), '#e23b3b', null, 'smooth');
        tip.userData.slot = null;
        tip.rotation.copy(spike.rotation);
        tip.position.set(Math.sin(a) * len * 0.95, 0.08 * S + dirY * len * 0.95, -0.05 * S + Math.cos(a) * dirZ * len * 0.95);
        pivot.add(tip);
      }
      break;
    }
    case 'train': {
      // peryton: a grand upright fan, dark feathers banded with light tips
      fan(9, 1.45 * S, 0.2 * S, 0.85, tailSlot);
      fan(7, 0.95 * S, 0.18 * S, 0.65, 'belly');
      pivot.rotation.x = 0.55;
      break;
    }
    case 'lion': {
      const rope = mesh(cyl(0.03 * S, 0.05 * S, 0.7 * S), c.legs, 'legs', 'smooth');
      rope.position.set(0, 0.08 * S, -0.32 * S);
      rope.rotation.x = -1.15;
      pivot.add(rope);
      const tuft = mesh(sphere(0.09 * S, 12, 9), c.accent, 'accent', 'fluff');
      tuft.position.set(0, 0.21 * S, -0.63 * S);
      pivot.add(tuft);
      break;
    }
    default: fan(6, 0.6 * S, 0.17 * S, 0.7); // fan tail
  }
}

function addParticles(group, colorA, colorB, S) {
  const count = 26;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seeds = [];
  for (let i = 0; i < count; i++) {
    seeds.push({ a: Math.random() * Math.PI * 2, r: 0.3 + Math.random() * 0.7, s: 0.5 + Math.random(), o: Math.random() * 10 });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: colorA, size: 0.14 * S, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData = { seeds, S, colorA: new THREE.Color(colorA), colorB: new THREE.Color(colorB) };
  group.add(points);
  return points;
}

export function buildEgg(colors, def, scale = 1) {
  const group = new THREE.Group();
  const c = colors || {};
  const S = (def?.size || 1) * 0.5 * scale;
  const shell = mesh(sphere(0.42 * S, 26, 20), c.body || '#f2ead8', 'body', 'egg');
  shell.scale.y = 1.3;
  shell.position.y = 0.5 * S;
  group.add(shell);
  for (let i = 0; i < 7; i++) {
    const sp = mesh(sphere(0.04 * S, 8, 6), c.accent || '#b8a890', 'accent', 'none');
    const a = (i / 7) * Math.PI * 2;
    const ph = 0.5 + (i % 3) * 0.5;
    sp.scale.y = 0.5;
    sp.position.set(Math.cos(a) * 0.41 * S * Math.sin(ph), 0.5 * S + Math.cos(ph) * 0.52 * S, Math.sin(a) * 0.41 * S * Math.sin(ph));
    group.add(sp);
  }
  group.userData = { breedId: def ? Object.keys(BREEDS).find((k) => BREEDS[k] === def) : 'robin', stage: 'egg', standH: 0, size: S, def };
  return {
    group, parts: { root: group }, breed: group.userData.breedId, stage: 'egg', def, size: S, standH: 0,
    setColors: (cols) => applyColors(group, cols || {}, 0),
  };
}

function applyColors(group, colors, emissiveBoost) {
  group.traverse((o) => {
    if (!o.isMesh || !o.userData.slot) return;
    const hex = colors[o.userData.slot];
    if (hex) {
      const em = o.userData.em || (emissiveBoost && o.userData.slot !== 'eyes' ? emissiveBoost : 0);
      o.material = material(hex, o.userData.tex || 'plain', em);
    }
  });
}

function stripNull(obj) {
  if (!obj) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v) out[k] = v;
  return out;
}

export { COLOR_SLOTS };
