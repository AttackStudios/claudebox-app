// ClaudeBox R6 — an original blocky six-part avatar (head, torso, two arms,
// two legs) in the classic brick-figure style, with per-part colours,
// accessories, and procedural animations written from scratch to evoke the
// familiar look: stiff pendulum limbs, straight-arm tool hold, arms-up freefall.
//
//   import { makeR6, R6_DEFAULT, R6_ACCESSORIES } from '/shared/r6.js';
//   const ctrl = makeR6(profile);        // profile: { head, torso, armL, armR, legL, legR, accessory, face }
//   scene.add(ctrl.group);
//   ctrl.setAnim('walk'); ctrl.update(dt);
//   ctrl.bones.R_Wrist                   // attachment for held items (charms/weapons)
import * as THREE from 'three';

export const R6_DEFAULT = {
  head: '#f5cd30', torso: '#0f6cbd', armL: '#f5cd30', armR: '#f5cd30',
  legL: '#3aa03a', legR: '#3aa03a', accessory: 'none', face: 'smile',
};
export const R6_ACCESSORIES = ['none', 'cap', 'tophat', 'headphones', 'halo', 'horns', 'crown'];
export const R6_FACES = ['smile', 'grin', 'serious', 'wink', 'shades'];

// stud scale: a classic figure is 5 units tall; we fit ~1.5m world height
const S = 0.31;
const LIM = (c) => new THREE.MeshLambertMaterial({ color: c });

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
  if (kind === 'grin') { x.beginPath(); x.arc(64, 74, 24, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke(); x.beginPath(); x.arc(64, 74, 24, 0.15 * Math.PI, 0.85 * Math.PI); x.fillStyle = '#fff'; x.fill(); }
  else if (kind === 'serious') { x.beginPath(); x.moveTo(46, 84); x.lineTo(82, 84); x.stroke(); }
  else { x.beginPath(); x.arc(64, 72, 22, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function box(w, h, d, color) { return new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), LIM(color)); }

function buildAccessory(kind, headColor) {
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

export function makeR6(profile = {}) {
  const p = { ...R6_DEFAULT, ...(profile || {}) };
  const group = new THREE.Group();

  // torso: 2x2x1, pivot at its base sitting on the legs (legs are 2 tall)
  const torso = box(2, 2, 1, p.torso); torso.position.y = 3 * S; group.add(torso);
  // head: 1.2 cube on top, with a face decal on -z
  const headG = new THREE.Group(); headG.position.y = 4.6 * S; group.add(headG);
  const head = box(1.2, 1.2, 1.2, p.head); headG.add(head);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.05 * S, 1.05 * S),
    new THREE.MeshBasicMaterial({ map: faceTexture(p.face), transparent: true }));
  face.position.z = -0.62 * S; face.rotation.y = Math.PI; headG.add(face);
  headG.add(buildAccessory(p.accessory, p.head));

  // limbs pivot at their TOP (shoulder / hip)
  const mkLimb = (w, h, d, color, px, py) => {
    const pivot = new THREE.Group(); pivot.position.set(px, py, 0);
    const m = box(w, h, d, color); m.position.y = -h / 2 * S; pivot.add(m);
    group.add(pivot);
    return pivot;
  };
  const armL = mkLimb(1, 2, 1, p.armL, 1.5 * S, 4 * S);
  const armR = mkLimb(1, 2, 1, p.armR, -1.5 * S, 4 * S);
  const legL = mkLimb(1, 2, 1, p.legL, 0.5 * S, 2 * S);
  const legR = mkLimb(1, 2, 1, p.legR, -0.5 * S, 2 * S);

  // attachment points the weapon-mounting code expects
  const R_Wrist = new THREE.Group(); R_Wrist.position.y = -1.8 * S; armR.add(R_Wrist);
  const L_Wrist = new THREE.Group(); L_Wrist.position.y = -1.8 * S; armL.add(L_Wrist);
  const R_Elbow = new THREE.Group(); R_Elbow.position.y = -0.9 * S; armR.add(R_Elbow);

  // ---- procedural animation (original, classic-blocky style) ----
  let anim = 'idle', t = 0, blend = 12;
  const target = { armL: { x: 0, z: 0 }, armR: { x: 0, z: 0 }, legL: { x: 0 }, legR: { x: 0 }, head: { x: 0, y: 0 }, torsoY: 0 };
  const POSES = {
    // arms hang, tiny breathing sway
    idle: (tt) => { target.armL.x = Math.sin(tt * 1.6) * 0.045; target.armR.x = -Math.sin(tt * 1.6) * 0.045; target.armL.z = 0.05; target.armR.z = -0.05; target.legL.x = 0; target.legR.x = 0; target.head.x = 0; },
    // the stiff pendulum walk: opposite arm/leg, straight limbs
    walk: (tt) => { const sw = Math.sin(tt * 7) * 0.75; target.armL.x = sw; target.armR.x = -sw; target.legL.x = -sw; target.legR.x = sw; target.armL.z = 0.06; target.armR.z = -0.06; },
    run: (tt) => { const sw = Math.sin(tt * 10.5) * 1.0; target.armL.x = sw; target.armR.x = -sw; target.legL.x = -sw; target.legR.x = sw; target.armL.z = 0.08; target.armR.z = -0.08; },
    // jump: legs tuck slightly, arms trail back
    jump: () => { target.armL.x = -0.35; target.armR.x = -0.35; target.legL.x = 0.25; target.legR.x = -0.15; },
    // freefall: BOTH arms straight up — the iconic silhouette
    fall: () => { target.armL.x = Math.PI; target.armR.x = Math.PI; target.armL.z = 0.25; target.armR.z = -0.25; target.legL.x = 0.12; target.legR.x = -0.12; },
    death: () => { target.armL.x = 0.4; target.armR.x = 0.4; target.legL.x = 0.1; target.legR.x = 0.1; },
    // straight right arm out at 90° — the classic tool hold
    toolhold: (tt) => { POSES.idle(tt); target.armR.x = Math.PI / 2; target.armR.z = 0; },
    knifeidle: (tt) => { POSES.idle(tt); target.armR.x = Math.PI * 0.32; },
    pistolidle: (tt) => { POSES.idle(tt); target.armR.x = Math.PI / 2; },
    rifleidle: (tt) => { POSES.idle(tt); target.armR.x = Math.PI / 2; target.armL.x = Math.PI * 0.42; target.armL.z = -0.55; },
    riflerun: (tt) => { const sw = Math.sin(tt * 9) * 0.85; target.legL.x = -sw; target.legR.x = sw; target.armR.x = Math.PI / 2; target.armL.x = Math.PI * 0.42; target.armL.z = -0.55; target.armR.z = 0; },
    pistolrun: (tt) => { const sw = Math.sin(tt * 9) * 0.85; target.legL.x = -sw; target.legR.x = sw; target.armR.x = Math.PI / 2; target.armR.z = 0; target.armL.x = sw * 0.5; target.armL.z = 0.06; },
    riflefire: (tt) => { POSES.rifleidle(tt); target.armR.x = Math.PI / 2 + Math.sin(tt * 40) * 0.06; },
    // a full overhead chop
    knifestab: (tt) => { POSES.idle(tt); target.armR.x = Math.PI * 0.9 - Math.min(1, (t % 0.7) / 0.35) * Math.PI * 0.75; },
    wave: (tt) => { POSES.idle(tt); target.armR.x = Math.PI; target.armR.z = Math.sin(tt * 8) * 0.35; },
  };
  const walkish = { walk: 1, run: 1 };

  function setAnim(name) {
    if (!POSES[name]) name = name === 'fallLoop' ? 'fall' : 'idle';
    if (anim !== name) { anim = name; if (!walkish[anim]) t = 0; }
  }
  function update(dt) {
    t += dt;
    (POSES[anim] || POSES.idle)(t);
    const k = Math.min(1, dt * blend);
    armL.rotation.x += (target.armL.x - armL.rotation.x) * k;
    armR.rotation.x += (target.armR.x - armR.rotation.x) * k;
    armL.rotation.z += (target.armL.z - armL.rotation.z) * k;
    armR.rotation.z += (target.armR.z - armR.rotation.z) * k;
    legL.rotation.x += (target.legL.x - legL.rotation.x) * k;
    legR.rotation.x += (target.legR.x - legR.rotation.x) * k;
    // bob while moving
    const bobA = anim === 'run' ? 0.055 : anim === 'walk' ? 0.035 : 0;
    group.position.y = group.userData.baseY || 0;
    torso.position.y = 3 * S + Math.abs(Math.sin(t * (anim === 'run' ? 10.5 : 7))) * bobA * S * 2;
    headG.position.y = 4.6 * S + (torso.position.y - 3 * S);
  }
  function setColors(np) {
    const map = { head, torso };
    if (np.head) head.material.color.set(np.head);
    if (np.torso) torso.material.color.set(np.torso);
    if (np.armL) armL.children[0].material.color.set(np.armL);
    if (np.armR) armR.children[0].material.color.set(np.armR);
    if (np.legL) legL.children[0].material.color.set(np.legL);
    if (np.legR) legR.children[0].material.color.set(np.legR);
  }
  function dispose() {
    group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
  }

  return {
    group,
    bones: { R_Wrist, L_Wrist, R_Elbow },
    parts: { head, headG, torso, armL, armR, legL, legR },
    setAnim, update, setColors, dispose,
    isR6: true,
  };
}
