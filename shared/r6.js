// ClaudeBox R6 — the classic blocky six-part avatar. Two render paths:
//  1. HQ: a user-supplied rigged GLB (/models/r6.glb) cloned per instance,
//     with its six bones driven directly by our own procedural animations.
//  2. Fallback: an original box build with the same joints, used until the
//     GLB loads (or if it can't).
// Both expose the same controller: { group, bones:{R_Wrist,L_Wrist,R_Elbow},
// setAnim, update, setColors, dispose } so weapon mounting works either way.
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '/vendor/SkeletonUtils.js';

export const R6_DEFAULT = {
  head: '#f5cd30', torso: '#0f6cbd', armL: '#f5cd30', armR: '#f5cd30',
  legL: '#3aa03a', legR: '#3aa03a', accessory: 'none', face: 'smile',
};
export const R6_ACCESSORIES = ['none', 'cap', 'tophat', 'headphones', 'halo', 'horns', 'crown'];
export const R6_FACES = ['smile', 'grin', 'serious', 'wink', 'shades'];

const S = 0.31;                    // stud → world scale (classic figure ≈ 5.8 studs)
const TARGET_H = 5.8 * S;
const LIM = (c) => new THREE.MeshLambertMaterial({ color: c });

// GLTFLoader sanitizes names (spaces → underscores)
const HQ_BONES = { Torso_00: 'torso', Head_01: 'head', Left_Arm_02: 'armL', Right_Arm_03: 'armR', Left_Leg_04: 'legL', Right_Leg_05: 'legR' };
const HQ_ENDS = { Left_Arm_end_07: 'wristL', Right_Arm_end_08: 'wristR' };
const PART_OF_JOINT = [];          // joint index -> part name (filled at load)

let hqTpl = null, hqTried = false; // { scene, scale, groundY }
export function preloadR6() {
  if (hqTried) return Promise.resolve(hqTpl);
  hqTried = true;
  return new Promise((resolve) => {
    try {
      new GLTFLoader().load('/models/r6.glb', (g) => {
        try {
          const scene = g.scene;
          scene.updateMatrixWorld(true);
          const bb = new THREE.Box3().setFromObject(scene);
          const h = Math.max(0.001, bb.max.y - bb.min.y);
          hqTpl = { scene, scale: TARGET_H / h, groundY: bb.min.y };
          // record joint->part for vertex tinting
          scene.traverse((o) => {
            if (o.isSkinnedMesh && !PART_OF_JOINT.length) {
              o.skeleton.bones.forEach((b, i) => { PART_OF_JOINT[i] = HQ_BONES[b.name] || null; });
            }
          });
        } catch { hqTpl = null; }
        resolve(hqTpl);
      }, undefined, () => resolve(null));
    } catch { resolve(null); }
  });
}

function faceTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.fillStyle = '#1a1a1a';
  const eye = (cx) => { x.beginPath(); x.ellipse(cx, 52, 7, 11, 0, 0, Math.PI * 2); x.fill(); };
  if (kind === 'shades') { x.fillRect(28, 42, 30, 14); x.fillRect(70, 42, 30, 14); x.fillRect(56, 46, 16, 5); }
  else if (kind === 'wink') { eye(44); x.fillRect(74, 50, 18, 5); }
  else { eye(44); eye(84); }
  x.strokeStyle = '#1a1a1a'; x.lineWidth = 6; x.lineCap = 'round';
  if (kind === 'serious') { x.beginPath(); x.moveTo(46, 84); x.lineTo(82, 84); x.stroke(); }
  else { x.beginPath(); x.arc(64, 72, kind === 'grin' ? 26 : 22, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function box(w, h, d, color) { return new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), LIM(color)); }

function buildAccessory(kind) {
  const g = new THREE.Group();
  if (kind === 'cap') {
    const c1 = box(1.3, 0.35, 1.3, '#c0392b'); c1.position.y = 0.68 * S; g.add(c1);
    const brim = box(0.9, 0.12, 0.7, '#c0392b'); brim.position.set(0, 0.55 * S, -0.9 * S); g.add(brim);
  } else if (kind === 'tophat') {
    const b1 = box(1.5, 0.14, 1.5, '#16181e'); b1.position.y = 0.6 * S; g.add(b1);
    const b2 = box(1.0, 1.0, 1.0, '#16181e'); b2.position.y = 1.15 * S; g.add(b2);
    const band = box(1.04, 0.2, 1.04, '#c0392b'); band.position.y = 0.78 * S; g.add(band);
  } else if (kind === 'headphones') {
    const band = box(1.35, 0.18, 0.25, '#23262e'); band.position.y = 0.72 * S; g.add(band);
    for (const sx of [-1, 1]) { const cup = box(0.28, 0.6, 0.6, '#23262e'); cup.position.set(sx * 0.72 * S, 0.1 * S, 0); g.add(cup); }
  } else if (kind === 'halo') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 * S, 0.09 * S, 8, 22), new THREE.MeshBasicMaterial({ color: '#ffd83d' }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.05 * S; g.add(ring);
  } else if (kind === 'horns') {
    for (const sx of [-1, 1]) { const h = box(0.22, 0.55, 0.22, '#c0392b'); h.position.set(sx * 0.42 * S, 0.75 * S, 0); h.rotation.z = -sx * 0.35; g.add(h); }
  } else if (kind === 'crown') {
    const base = box(1.15, 0.3, 1.15, '#e8b23a'); base.position.y = 0.65 * S; g.add(base);
    for (let i = 0; i < 4; i++) { const spike = box(0.2, 0.4, 0.2, '#e8b23a'); const a = i * Math.PI / 2; spike.position.set(Math.cos(a) * 0.45 * S, 0.95 * S, Math.sin(a) * 0.45 * S); g.add(spike); }
  }
  return g;
}

// tint a cloned skinned mesh per-part via vertex colors (dominant joint)
function tintByPart(inner, colors) {
  inner.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const geo = o.geometry = o.geometry.clone();          // per-instance copy
    geo.userData.shared = false;
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const part = PART_OF_JOINT[best];
      c.set(colors[part] || '#ffffff');
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    o.material = o.material.clone();
    o.material.vertexColors = true;
    o.material.color.set('#ffffff');
  });
}

export function makeR6(profile = {}) {
  const p = { ...R6_DEFAULT, ...(profile || {}) };
  const group = new THREE.Group();
  const isDefault = ['head', 'torso', 'armL', 'armR', 'legL', 'legR']
    .every((k) => (p[k] || '').toLowerCase() === R6_DEFAULT[k].toLowerCase());

  // ---------- HQ path: cloned skinned rig, bones driven directly ----------
  if (hqTpl) {
    const inner = cloneSkinned(hqTpl.scene);
    inner.scale.setScalar(hqTpl.scale);
    inner.position.y = -hqTpl.groundY * hqTpl.scale;
    group.add(inner);
    inner.traverse((o) => { if (o.isSkinnedMesh) { o.frustumCulled = false; if (o.geometry) o.geometry.userData.shared = true; } });
    // the body mesh is untextured grey by design — ALWAYS tint the parts.
    // A default head stays white so its face texture shows true colours.
    tintByPart(inner, { ...p, head: (p.head || '').toLowerCase() === R6_DEFAULT.head.toLowerCase() ? '#ffffff' : p.head });

    const bones = {}, rest = {}, ends = {};
    inner.traverse((o) => {
      if (!o.isBone) return;
      const part = HQ_BONES[o.name]; if (part) { bones[part] = o; rest[part] = o.quaternion.clone(); }
      const end = HQ_ENDS[o.name]; if (end) ends[end] = o;
    });
    // accessories ride the head bone (undo the model scale so studs stay studs)
    if (p.accessory && p.accessory !== 'none' && bones.head) {
      const accG = buildAccessory(p.accessory);
      accG.scale.setScalar(1 / hqTpl.scale);
      bones.head.add(accG);
    }

    let anim = 'idle', t = 0;
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    const target = { armL: { x: 0, z: 0 }, armR: { x: 0, z: 0 }, legL: { x: 0 }, legR: { x: 0 } };
    const POSES = buildPoses(target);
    const setPart = (part, rx, rz) => {
      const b = bones[part]; if (!b) return;
      e.set(rz || 0, 0, rx || 0);   // this rig's limbs swing about local Z; sideways lift is local X
      q.setFromEuler(e);
      b.quaternion.copy(rest[part]).multiply(q);
    };
    function setAnim(name) { if (!POSES[name]) name = 'idle'; if (anim !== name) anim = name; }
    function update(dt) {
      t += dt;
      (POSES[anim] || POSES.idle)(t);
      setPart('armL', target.armL.x, target.armL.z);
      setPart('armR', target.armR.x, -target.armR.z);
      setPart('legL', target.legL.x, 0);
      setPart('legR', target.legR.x, 0);
      const bobA = anim === 'run' ? 0.05 : anim === 'walk' ? 0.032 : 0;
      inner.position.y = -hqTpl.groundY * hqTpl.scale + Math.abs(Math.sin(t * (anim === 'run' ? 10.5 : 7))) * bobA;
    }
    function setColors(np) { tintByPart(inner, { ...p, ...np }); }
    function dispose() {
      group.traverse((o) => {
        if (o.geometry && o.geometry.userData?.shared === false) o.geometry.dispose();
        if (o.material && o.material.vertexColors) o.material.dispose?.();
      });
    }
    return {
      group,
      bones: { R_Wrist: ends.wristR || bones.armR, L_Wrist: ends.wristL || bones.armL, R_Elbow: bones.armR },
      setAnim, update, setColors, dispose, isR6: true, hq: true,
    };
  }

  // ---------- fallback: original box build ----------
  const torso = box(2, 2, 1, p.torso); torso.position.y = 3 * S; group.add(torso);
  const headG = new THREE.Group(); headG.position.y = 4.6 * S; group.add(headG);
  const head = box(1.2, 1.2, 1.2, p.head); headG.add(head);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.05 * S, 1.05 * S),
    new THREE.MeshBasicMaterial({ map: faceTexture(p.face), transparent: true }));
  face.position.z = -0.62 * S; face.rotation.y = Math.PI; headG.add(face);
  headG.add(buildAccessory(p.accessory));

  const mkLimb = (color, px, py) => {
    const pivot = new THREE.Group(); pivot.position.set(px, py, 0);
    const m = box(1, 2, 1, color); m.position.y = -1 * S; pivot.add(m);
    group.add(pivot);
    return pivot;
  };
  const armL = mkLimb(p.armL, 1.5 * S, 4 * S);
  const armR = mkLimb(p.armR, -1.5 * S, 4 * S);
  const legL = mkLimb(p.legL, 0.5 * S, 2 * S);
  const legR = mkLimb(p.legR, -0.5 * S, 2 * S);

  const R_Wrist = new THREE.Group(); R_Wrist.position.y = -1.8 * S; armR.add(R_Wrist);
  const L_Wrist = new THREE.Group(); L_Wrist.position.y = -1.8 * S; armL.add(L_Wrist);
  const R_Elbow = new THREE.Group(); R_Elbow.position.y = -0.9 * S; armR.add(R_Elbow);

  let anim = 'idle', t = 0;
  const target = { armL: { x: 0, z: 0 }, armR: { x: 0, z: 0 }, legL: { x: 0 }, legR: { x: 0 } };
  const POSES = buildPoses(target);
  function setAnim(name) { if (!POSES[name]) name = 'idle'; if (anim !== name) anim = name; }
  function update(dt) {
    t += dt;
    (POSES[anim] || POSES.idle)(t);
    const k = Math.min(1, dt * 12);
    armL.rotation.x += (target.armL.x - armL.rotation.x) * k;
    armR.rotation.x += (target.armR.x - armR.rotation.x) * k;
    armL.rotation.z += (target.armL.z - armL.rotation.z) * k;
    armR.rotation.z += (-target.armR.z - armR.rotation.z) * k;
    legL.rotation.x += (target.legL.x - legL.rotation.x) * k;
    legR.rotation.x += (target.legR.x - legR.rotation.x) * k;
    const bobA = anim === 'run' ? 0.055 : anim === 'walk' ? 0.035 : 0;
    const bob = Math.abs(Math.sin(t * (anim === 'run' ? 10.5 : 7))) * bobA * S * 2;
    torso.position.y = 3 * S + bob;
    headG.position.y = 4.6 * S + bob;
  }
  function setColors(np) {
    if (np.head) head.material.color.set(np.head);
    if (np.torso) torso.material.color.set(np.torso);
    if (np.armL) armL.children[0].material.color.set(np.armL);
    if (np.armR) armR.children[0].material.color.set(np.armR);
    if (np.legL) legL.children[0].material.color.set(np.legL);
    if (np.legR) legR.children[0].material.color.set(np.legR);
  }
  function dispose() {
    group.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
  }
  return { group, bones: { R_Wrist, L_Wrist, R_Elbow }, setAnim, update, setColors, dispose, isR6: true, hq: false };
}

// ---- the shared pose set (original, classic-blocky style):
// stiff pendulum limbs, straight-arm tool hold, arms-up freefall ----
function buildPoses(target) {
  const POSES = {
    idle: (tt) => { target.armL.x = Math.sin(tt * 1.6) * 0.045; target.armR.x = -Math.sin(tt * 1.6) * 0.045; target.armL.z = 0.05; target.armR.z = 0.05; target.legL.x = 0; target.legR.x = 0; },
    walk: (tt) => { const sw = Math.sin(tt * 7) * 0.75; target.armL.x = sw; target.armR.x = -sw; target.legL.x = -sw; target.legR.x = sw; target.armL.z = 0.06; target.armR.z = 0.06; },
    run: (tt) => { const sw = Math.sin(tt * 10.5) * 1.0; target.armL.x = sw; target.armR.x = -sw; target.legL.x = -sw; target.legR.x = sw; target.armL.z = 0.08; target.armR.z = 0.08; },
    jump: () => { target.armL.x = -0.35; target.armR.x = -0.35; target.legL.x = 0.25; target.legR.x = -0.15; },
    fall: () => { target.armL.x = Math.PI; target.armR.x = Math.PI; target.armL.z = 0.25; target.armR.z = 0.25; target.legL.x = 0.12; target.legR.x = -0.12; },
    death: () => { target.armL.x = 0.4; target.armR.x = 0.4; target.legL.x = 0.1; target.legR.x = 0.1; },
    toolhold: (tt) => { POSES.idle(tt); target.armR.x = Math.PI / 2; target.armR.z = 0; },
    knifeidle: (tt) => { POSES.idle(tt); target.armR.x = Math.PI * 0.32; },
    pistolidle: (tt) => { POSES.idle(tt); target.armR.x = Math.PI / 2; },
    rifleidle: (tt) => { POSES.idle(tt); target.armR.x = Math.PI / 2; target.armL.x = Math.PI * 0.42; target.armL.z = -0.55; },
    riflerun: (tt) => { const sw = Math.sin(tt * 9) * 0.85; target.legL.x = -sw; target.legR.x = sw; target.armR.x = Math.PI / 2; target.armL.x = Math.PI * 0.42; target.armL.z = -0.55; target.armR.z = 0; },
    pistolrun: (tt) => { const sw = Math.sin(tt * 9) * 0.85; target.legL.x = -sw; target.legR.x = sw; target.armR.x = Math.PI / 2; target.armR.z = 0; target.armL.x = sw * 0.5; target.armL.z = 0.06; },
    riflefire: (tt) => { POSES.rifleidle(tt); target.armR.x = Math.PI / 2 + Math.sin(tt * 40) * 0.06; },
    knifestab: (tt) => { POSES.idle(tt); target.armR.x = Math.PI * 0.9 - Math.min(1, (tt % 0.7) / 0.35) * Math.PI * 0.75; },
    wave: (tt) => { POSES.idle(tt); target.armR.x = Math.PI; target.armR.z = Math.sin(tt * 8) * 0.35; },
  };
  POSES.fallLoop = POSES.fall;
  return POSES;
}
