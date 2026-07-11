// Web Rush — Spider-style web-swinging across a city, with crime-scene combat.
import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import { GROUND, SPAWN, BUILDINGS, CRIMES, MAX_HP, GRAVITY, WEB_RANGE, BLOCK, ROAD, SPAN, N, PLAZAS } from '/shared/webrush/city.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const RUN = 9, JUMP = 12, PR = 1.2;

// ---------------- renderer / scene ----------------
const canvas = $('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbcd4ec, 320, 900);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 3000);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---- gradient sky dome + sun ----
const skyTex = (() => {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2f5a9e'); g.addColorStop(0.42, '#5b8ec9'); g.addColorStop(0.72, '#a8cbe8'); g.addColorStop(1, '#e6d3c0');
  x.fillStyle = g; x.fillRect(0, 0, 8, 256); return new THREE.CanvasTexture(c);
})();
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
scene.add(sky);
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 6, 64, 64, 64); g.addColorStop(0, 'rgba(255,250,225,1)'); g.addColorStop(0.3, 'rgba(255,240,200,.8)'); g.addColorStop(1, 'rgba(255,240,200,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })(), transparent: true, fog: false, depthWrite: false }));
sunSprite.scale.set(340, 340, 1); sunSprite.position.set(560, 620, -900); scene.add(sunSprite);

scene.add(new THREE.HemisphereLight(0xdcecff, 0x5a6478, 1.35));
scene.add(new THREE.AmbientLight(0x8a94aa, 0.35));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.35); sun.position.set(180, 300, 120); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -200; sun.shadow.camera.right = 200; sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200; sun.shadow.camera.far = 800; sun.shadow.bias = -0.0004;
scene.add(sun);

// ---------------- city ----------------
// ---- streets: one big canvas street-map (roads, lane lines, sidewalks, crosswalks) ----
const streetTex = (() => {
  const S = 2048, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const W2 = GROUND, toPx = (w) => (w + W2) / (2 * W2) * S, len = (w) => w / (2 * W2) * S;
  x.fillStyle = '#24272d'; x.fillRect(0, 0, S, S);                       // asphalt
  x.strokeStyle = '#c9a83c'; x.lineWidth = Math.max(1.5, len(0.6)); x.setLineDash([len(4.5), len(4.5)]);
  for (let k = -N - 1; k <= N; k++) { const rc = k * SPAN + SPAN / 2;    // dashed lane lines down road centres
    x.beginPath(); x.moveTo(toPx(rc), 0); x.lineTo(toPx(rc), S); x.stroke();
    x.beginPath(); x.moveTo(0, toPx(rc)); x.lineTo(S, toPx(rc)); x.stroke(); }
  x.setLineDash([]);
  for (let bx = -N; bx <= N; bx++) for (let bz = -N; bz <= N; bz++) {   // blocks: sidewalk ring + lot
    const cx = bx * SPAN, cz = bz * SPAN, sd = 5;
    x.fillStyle = '#5c616b'; x.fillRect(toPx(cx - BLOCK / 2), toPx(cz - BLOCK / 2), len(BLOCK), len(BLOCK));
    x.fillStyle = '#33373e'; x.fillRect(toPx(cx - BLOCK / 2 + sd), toPx(cz - BLOCK / 2 + sd), len(BLOCK - 2 * sd), len(BLOCK - 2 * sd));
    x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = len(0.5); x.strokeRect(toPx(cx - BLOCK / 2), toPx(cz - BLOCK / 2), len(BLOCK), len(BLOCK));
  }
  // crosswalk zebra bars at each intersection (both road directions)
  x.fillStyle = 'rgba(232,238,246,.5)';
  for (let ix = -N - 1; ix <= N; ix++) for (let iz = -N - 1; iz <= N; iz++) {
    const cx = ix * SPAN + SPAN / 2, cz = iz * SPAN + SPAN / 2;
    for (let s = 0; s < 5; s++) { const o = (s - 2) * 3.2;
      x.fillRect(toPx(cx + o - 0.7), toPx(cz - (BLOCK / 2 + ROAD)), len(1.4), len(ROAD - 1));      // vertical road crossings
      x.fillRect(toPx(cx - (BLOCK / 2 + ROAD)), toPx(cz + o - 0.7), len(ROAD - 1), len(1.4)); }    // horizontal
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
})();
const streets = new THREE.Mesh(new THREE.PlaneGeometry(GROUND * 2, GROUND * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: streetTex, roughness: 0.95 }));
streets.receiveShadow = true; scene.add(streets);

// ---- per-style window textures ----
function winTexFor(style) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  if (style === 'glass') { x.fillStyle = '#38536f'; x.fillRect(0, 0, 64, 64); for (let j = 0; j < 8; j++) { x.fillStyle = `rgba(198,224,255,${0.14 + 0.5 * Math.random()})`; x.fillRect(0, j * 8 + 1, 64, 5); } for (let i = 1; i < 8; i++) { x.fillStyle = 'rgba(20,30,45,.35)'; x.fillRect(i * 8, 0, 1, 64); } }
  else if (style === 'brick') { x.fillStyle = '#6f4030'; x.fillRect(0, 0, 64, 64); for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = Math.random() < 0.55 ? '#caa877' : '#2e1f16'; x.fillRect(i * 8 + 2, j * 8 + 2, 4, 5); } }
  else if (style === 'stone') { x.fillStyle = '#82826f'; x.fillRect(0, 0, 64, 64); for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = Math.random() < 0.5 ? '#e0dcc0' : '#54544a'; x.fillRect(i * 8 + 1.5, j * 8 + 1.5, 5, 5); } }
  else { x.fillStyle = '#606676'; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 8; i++) { x.fillStyle = `rgba(208,224,246,${0.18 + 0.4 * Math.random()})`; x.fillRect(i * 8 + 2, 0, 4, 64); } for (let j = 1; j < 8; j++) { x.fillStyle = 'rgba(20,25,35,.3)'; x.fillRect(0, j * 8, 64, 1); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const STYLE_TEX = { glass: winTexFor('glass'), concrete: winTexFor('concrete'), brick: winTexFor('brick'), stone: winTexFor('stone') };
const capMat = new THREE.MeshStandardMaterial({ color: 0x2c313c, roughness: 0.9 });
const spireMat = new THREE.MeshStandardMaterial({ color: 0x9aa2b2, metalness: 0.5, roughness: 0.4 });
const storeMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, emissive: 0x2a2416, emissiveIntensity: 0.9 });

const buildingGroup = new THREE.Group(); scene.add(buildingGroup);
for (const b of BUILDINGS) {
  const y0 = b.y0 || 0, h = b.h - y0;
  const style = b.style || 'concrete';
  const tex = STYLE_TEX[style].clone(); tex.needsUpdate = true; tex.repeat.set(Math.max(1, b.w / 6), Math.max(1, h / 6));
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, h, b.d), new THREE.MeshStandardMaterial({ color: b.color, roughness: style === 'glass' ? 0.35 : 0.85, metalness: style === 'glass' ? 0.35 : 0.04, map: tex }));
  m.position.set(b.x, y0 + h / 2, b.z); m.castShadow = true; m.receiveShadow = true; m.userData.b = b; buildingGroup.add(m);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.6, 1.2, b.d + 0.6), capMat); cap.position.set(b.x, b.h + 0.6, b.z); buildingGroup.add(cap);
  if (y0 === 0) {   // lit ground-floor storefront band
    const st = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.3, 3.2, b.d + 0.3), storeMat); st.position.set(b.x, 1.7, b.z); buildingGroup.add(st);
  }
  if (b.crown) {    // spire / mast crown
    const spire = new THREE.Mesh(new THREE.ConeGeometry(Math.min(b.w, b.d) * 0.18, 10 + b.h * 0.05, 6), spireMat);
    spire.position.set(b.x, b.h + 5 + b.h * 0.025, b.z); buildingGroup.add(spire);
  }
}

// ---- rooftop props (water towers / antennas / AC) — only on crowned summits ----
const propGroup = new THREE.Group(); scene.add(propGroup);
const blinkTips = [];
let pk = 0;
for (const b of BUILDINGS) {
  if (!b.crown || b.h < 45) continue;
  const kind = (pk++) % 3;
  const ox = b.w * 0.28, oz = b.d * 0.24;
  if (kind === 0) {
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3.2, 10), new THREE.MeshStandardMaterial({ color: 0x7a5a40, roughness: 0.9 })); tank.position.y = 3; g.add(tank);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.4, 10), new THREE.MeshStandardMaterial({ color: 0x5a4230 })); cone.position.y = 5.3; g.add(cone);
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.5, 5), new THREE.MeshStandardMaterial({ color: 0x3a3f47 })); leg.position.set(Math.cos(a) * 1.5, 0.75, Math.sin(a) * 1.5); g.add(leg); }
    g.position.set(b.x + ox, b.h, b.z - oz); g.traverse((o) => o.castShadow = true); propGroup.add(g);
  } else if (kind === 1) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 9, 6), new THREE.MeshStandardMaterial({ color: 0x9aa2b0 })); mast.position.set(b.x - ox, b.h + 4.5, b.z + oz); propGroup.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true })); tip.position.set(b.x - ox, b.h + 9.2, b.z + oz); propGroup.add(tip); blinkTips.push(tip);
  } else {
    for (let k = 0; k < 2; k++) { const ac = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.6), new THREE.MeshStandardMaterial({ color: 0x8b93a5, roughness: 0.8 })); ac.position.set(b.x + (k ? -ox : ox), b.h + 0.55, b.z + (k ? oz : -oz)); ac.castShadow = true; propGroup.add(ac); }
  }
}

// ---- plazas: green parks with trees where blocks were left open ----
const plazaGroup = new THREE.Group(); scene.add(plazaGroup);
for (const pz of PLAZAS) {
  const grass = new THREE.Mesh(new THREE.BoxGeometry(BLOCK - 8, 0.4, BLOCK - 8), new THREE.MeshStandardMaterial({ color: 0x3f7a44, roughness: 1 }));
  grass.position.set(pz.x, 0.2, pz.z); grass.receiveShadow = true; plazaGroup.add(grass);
  for (let t = 0; t < 5; t++) {
    const tx = pz.x + (Math.sin(t * 2.1) * (BLOCK / 2 - 8)), tz = pz.z + (Math.cos(t * 3.3) * (BLOCK / 2 - 8));
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x5a3f28 })); trunk.position.set(tx, 1.2, tz); trunk.castShadow = true; plazaGroup.add(trunk);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0x39813f })); leaf.position.set(tx, 3.4, tz); leaf.scale.y = 0.85; leaf.castShadow = true; plazaGroup.add(leaf);
  }
}

// ---- streetlights at some intersections ----
const lampGroup = new THREE.Group(); scene.add(lampGroup);
let li = 0;
for (let ix = -N; ix < N; ix++) for (let iz = -N; iz < N; iz++) {
  if ((li++) % 2) continue;
  const cx = ix * SPAN + SPAN / 2, cz = iz * SPAN + SPAN / 2;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const bx = cx + dx * (ROAD / 2 - 1), bz = cz + dz * (ROAD / 2 - 1);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a2e36 })); pole.position.set(bx, 4, bz); lampGroup.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a12, emissive: 0xffdf9a, emissiveIntensity: 1.1 })); head.position.set(bx - dx * 0.8, 8, bz - dz * 0.8); lampGroup.add(head);
  }
}

// static geometry never moves — freeze matrices
for (const g of [buildingGroup, propGroup, plazaGroup, lampGroup]) g.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
streets.updateMatrix(); streets.matrixAutoUpdate = false;

// ---- drifting clouds ----
const cloudTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 12, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,.92)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const clouds = [];
for (let i = 0; i < 14; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.55, depthWrite: false }));
  const sc = 90 + Math.random() * 150; s.scale.set(sc, sc * 0.4, 1);
  s.position.set((Math.random() * 2 - 1) * GROUND, 175 + Math.random() * 130, (Math.random() * 2 - 1) * GROUND);
  scene.add(s); clouds.push({ s, v: 1.5 + Math.random() * 2.5 });
}

// ---- street traffic ----
const cars = [];
{
  const carGroup = new THREE.Group(); scene.add(carGroup);
  const ROADS = []; for (let b = -4; b < 4; b++) ROADS.push(b * 82 + 41);
  const COLORS = [0xd14b3c, 0xe8c33a, 0x4a7ec0, 0xd8dde3, 0x3ca35a, 0x8a5ac0];
  for (let i = 0; i < 34; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 4.6), new THREE.MeshStandardMaterial({ color: COLORS[i % COLORS.length], roughness: 0.5, metalness: 0.3 }));
    body.position.y = 0.55; g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 2.2), new THREE.MeshStandardMaterial({ color: 0x20242c }));
    top.position.set(0, 1.35, -0.2); g.add(top);
    const axis = i % 2 ? 'x' : 'z'; const dir = i % 4 < 2 ? 1 : -1;
    g.userData = { axis, dir, road: ROADS[i % ROADS.length] + dir * 3.4, sp: 13 + Math.random() * 11, off: (Math.random() * 2 - 1) * 340 };
    g.rotation.y = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    carGroup.add(g); cars.push(g);
  }
}
function tickCars(dt) {
  for (const c of cars) {
    const u = c.userData; u.off += u.dir * u.sp * dt;
    if (u.off > 345) u.off = -345; else if (u.off < -345) u.off = 345;
    if (u.axis === 'x') c.position.set(u.off, 0, u.road); else c.position.set(u.road, 0, u.off);
  }
}

// ---- crime beacons: a red light pillar over every open crime ----
const beacons = new Map();
for (const c of CRIMES) {
  const g = new THREE.Group(); g.position.set(c.x, 0, c.z);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 240, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3b4e, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
  pillar.position.y = 120; g.add(pillar);
  const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b4e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.position.y = 0.1; g.add(ring);
  const light = new THREE.PointLight(0xff2a3c, 0, 55); light.position.y = 7; g.add(light);
  scene.add(g); beacons.set(c.id, { g, pillar, ring, light });
}

// ---------------- local player ----------------
const player = { pos: new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z), vel: new THREE.Vector3(), ry: 0, hp: MAX_HP, dead: false, onGround: false, swinging: false, anchor: null, ropeLen: 0, wall: null };
let myAvatar = null;
let camYaw = 0, camPitch = -0.05;
const keys = new Set();

// ---- web rope: a real 3D strand (not a 1px line) ----
const _ropeUp = new THREE.Vector3(0, 1, 0), _ropeDir = new THREE.Vector3();
function makeRope() {
  const geo = new THREE.CylinderGeometry(0.055, 0.055, 1, 5, 1, true);
  geo.translate(0, 0.5, 0);   // pivot at the base, extends +Y
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf4f6fa }));
  m.visible = false; m.frustumCulled = false; scene.add(m);
  return m;
}
function updateRope(m, from, to) {
  _ropeDir.copy(to).sub(from); const len = _ropeDir.length() || 0.001;
  m.position.copy(from);
  m.quaternion.setFromUnitVectors(_ropeUp, _ropeDir.multiplyScalar(1 / len));
  m.scale.set(1, len, 1); m.visible = true;
}
function flashRope(from, to, ms = 130) { const m = makeRope(); updateRope(m, from, to); setTimeout(() => scene.remove(m), ms); }
const webRope = makeRope();

// ---- floating combat popups (damage numbers, KO!, combos) ----
const popups = [];
function popup(text, pos, color = '#ffffff', size = 2.4) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d'); x.textAlign = 'center'; x.font = '900 38px system-ui';
  x.lineWidth = 7; x.strokeStyle = 'rgba(0,0,0,.85)'; x.strokeText(text, 64, 44); x.fillStyle = color; x.fillText(text, 64, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(size, size / 2, 1); s.position.copy(pos); scene.add(s);
  popups.push({ s, t: 0 });
}
function tickPopups(dt) {
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i]; p.t += dt;
    p.s.position.y += dt * 2.2; p.s.material.opacity = 1 - p.t / 0.95;
    if (p.t > 0.95) { scene.remove(p.s); popups.splice(i, 1); }
  }
}

// ---- landing shockwave ring ----
function landFX(pos, strength) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.75, 22).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xdde6f2, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.position.set(pos.x, pos.y + 0.12, pos.z); scene.add(ring);
  const t0 = performance.now();
  (function ex() { const k = (performance.now() - t0) / 420; if (k < 1) { ring.scale.setScalar(1 + k * strength); ring.material.opacity = 0.85 * (1 - k); requestAnimationFrame(ex); } else scene.remove(ring); })();
}

// ---------------- input ----------------
// Space = jump · hold Right-Click = web-swing · LMB = punch · Q dodge · E yank · F stun
let rmb = false;
addEventListener('keydown', (e) => {
  if (chatOpen) return; keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyF') webStun();
  if (e.code === 'KeyE') webYank();
  if (e.code === 'KeyQ') dodge();
  if (e.code === 'KeyU') toggleSuits();
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', (e) => {
  if (!isTouch && document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) punch();
  if (e.button === 2) rmb = true;
});
addEventListener('mouseup', (e) => { if (e.button === 2) rmb = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas) rmb = false; });
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { const sn = (window.ClaudeBox?.settings?.sensitivity) || 1; camYaw -= e.movementX * 0.0024 * sn; camPitch = clamp(camPitch - e.movementY * 0.002 * sn, -1.2, 0.9); } });

// ---------------- web anchoring ----------------
const ray = new THREE.Raycaster(); ray.far = WEB_RANGE;
const _d = new THREE.Vector3(), _f = new THREE.Vector3();
function findAnchor() {
  camera.getWorldDirection(_f);
  // fan of rays biased upward-forward so you swing from above
  const dirs = [
    _d.copy(_f).addScaledVector(UP, 0.55).normalize().clone(),
    _d.copy(_f).addScaledVector(UP, 0.9).normalize().clone(),
    _f.clone().normalize(),
    UP.clone(),
  ];
  let best = null, bestD = Infinity;
  for (const dir of dirs) {
    ray.set(player.pos, dir);
    const hit = ray.intersectObjects(buildingGroup.children, false)[0];
    if (hit && hit.point.y > player.pos.y - 4 && hit.distance < bestD) { best = hit.point.clone(); bestD = hit.distance; }
  }
  if (best) return best;
  // fallback: nearest tall building top within range, ahead-ish
  for (const b of BUILDINGS) {
    const dx = b.x - player.pos.x, dz = b.z - player.pos.z; const dh = Math.hypot(dx, dz);
    if (dh < WEB_RANGE && b.h > player.pos.y + 6) { const top = new THREE.Vector3(b.x, b.h, b.z); const dd = top.distanceTo(player.pos); if (dd < bestD) { best = top; bestD = dd; } }
  }
  return best;
}
const UP = new THREE.Vector3(0, 1, 0);

function shootWeb() {
  const a = findAnchor();
  if (!a) return false;
  player.anchor = a; player.ropeLen = Math.max(6, player.pos.distanceTo(a) * 0.98); player.swinging = true; player.wall = null;
  sfx('web'); firstSwingReward();
  return true;
}
function releaseWeb(pop = false) {
  if (pop && player.swinging && player.vel.y > -4) {
    // releasing on the upswing flings you — reward good timing
    player.vel.y += 3.2;
    const hv = Math.hypot(player.vel.x, player.vel.z);
    if (hv > 4) { player.vel.x *= 1.07; player.vel.z *= 1.07; }
  }
  player.swinging = false; player.anchor = null; webRope.visible = false;
}
function webZip() {
  const a = findAnchor(); if (!a) return;
  _d.copy(a).sub(player.pos).normalize();
  player.vel.addScaledVector(_d, 34); player.swinging = false; player.anchor = null; webRope.visible = false; sfx('zip');
  flashRope(new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z), a);
}

// ---------------- collision vs buildings (setback-tier aware) ----------------
function collide() {
  player.wall = null;
  const px = player.pos.x, pz = player.pos.z; let py = player.pos.y;
  // 1) land on the highest roof directly under the player (handles setback ledges)
  let support = -Infinity;
  for (const b of BUILDINGS) {
    if (Math.abs(px - b.x) > b.w / 2 + PR + 1 || Math.abs(pz - b.z) > b.d / 2 + PR + 1) continue;
    if (px > b.x - b.w / 2 && px < b.x + b.w / 2 && pz > b.z - b.d / 2 && pz < b.z + b.d / 2 && b.h <= py + 0.3 && b.h > support) support = b.h;
  }
  if (support > -Infinity && py <= support + 0.3 && py >= support - 2.8 && player.vel.y <= 0.1) {
    const fall = -player.vel.y; player.pos.y = support; player.vel.y = 0; player.onGround = true; py = support;
    if (player.swinging) releaseWeb();
    if (diveSlam) { diveSlam = false; slamAOE(); }
    else if (fall > 13) { landFX(player.pos, clamp(fall / 8, 2, 6)); sfx('land'); }
  }
  // 2) walls: push out of any tier whose vertical band we're inside
  for (const b of BUILDINGS) {
    const y0 = b.y0 || 0;
    if (py < y0 - 0.1 || py > b.h - 0.1) continue;
    if (Math.abs(px - b.x) > b.w / 2 + PR || Math.abs(pz - b.z) > b.d / 2 + PR) continue;
    const minX = b.x - b.w / 2, maxX = b.x + b.w / 2, minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
    const dl = px - (minX - PR), dr = (maxX + PR) - px, dn = pz - (minZ - PR), df = (maxZ + PR) - pz, m = Math.min(dl, dr, dn, df);
    if (m === dl) { player.pos.x = minX - PR; if (player.vel.x > 0) player.vel.x = 0; player.wallNx = -1; player.wallNz = 0; }
    else if (m === dr) { player.pos.x = maxX + PR; if (player.vel.x < 0) player.vel.x = 0; player.wallNx = 1; player.wallNz = 0; }
    else if (m === dn) { player.pos.z = minZ - PR; if (player.vel.z > 0) player.vel.z = 0; player.wallNx = 0; player.wallNz = -1; }
    else { player.pos.z = maxZ + PR; if (player.vel.z < 0) player.vel.z = 0; player.wallNx = 0; player.wallNz = 1; }
    player.wall = b;
  }
}

// ---------------- movement ----------------
function update(dt) {
  if (player.dead) return;
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = Math.sin(camYaw - Math.PI / 2), rz = Math.cos(camYaw - Math.PI / 2);
  let inF = f, inR = r; if (mv.x || mv.y) { inR = mv.x; inF = -mv.y; }
  const wishX = fx * inF + rx * inR, wishZ = fz * inF + rz * inR;

  const swingPressed = rmb || tWeb;
  const jumpPressed = keys.has('Space') || tJump;
  const zipPressed = keys.has('ShiftLeft') || keys.has('ShiftRight');
  // start/stop swing
  if (swingPressed && !player.swinging && !player.onGround && !player.wall) { if (!shootWeb()) {} }
  if (!swingPressed && player.swinging) releaseWeb(true);   // release fling
  if (zipPressed && !zipLatch) { zipLatch = true; webZip(); }
  if (!zipPressed) zipLatch = false;
  // wall-jump: Space while clinging kicks off the wall
  if (jumpPressed && !jumpLatch && player.wall && !player.onGround) {
    jumpLatch = true;
    player.vel.x = player.wallNx * 13; player.vel.z = player.wallNz * 13; player.vel.y = 11;
    player.wall = null; sfx('land');
  }
  if (!jumpPressed) jumpLatch = false;

  // gravity
  if (!player.wall || !swingPressed) player.vel.y -= GRAVITY * dt;

  if (player.onGround) {
    // running on rooftops / street
    const spd = RUN * ((keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 1.5 : 1);
    player.vel.x = wishX * spd; player.vel.z = wishZ * spd;
    if (jumpPressed) { player.vel.y = JUMP; player.onGround = false; }            // jump
    else if (swingPressed) { player.vel.y = JUMP; player.onGround = false; }      // hop straight into a swing
    else player.vel.y = 0;   // don't let gravity accumulate while grounded
  } else if (player.swinging && player.anchor) {
    // pendulum + input pump
    player.vel.x += wishX * 20 * dt; player.vel.z += wishZ * 20 * dt;
    player.pos.addScaledVector(player.vel, dt);
    _d.copy(player.pos).sub(player.anchor); const dist = _d.length();
    if (dist > player.ropeLen) {
      _d.multiplyScalar(1 / dist); player.pos.copy(player.anchor).addScaledVector(_d, player.ropeLen);
      const radial = player.vel.dot(_d); if (radial > 0) player.vel.addScaledVector(_d, -radial);
      player.vel.multiplyScalar(0.999);
    }
    if (keys.has('KeyW')) player.ropeLen = Math.max(6, player.ropeLen - 14 * dt);   // reel up
  } else if (player.wall && swingPressed) {
    // cling + climb the wall
    player.vel.set(0, 0, 0); if (f) player.pos.y += f * 6 * dt; player.onGround = false;
    if (!tipWall) { tipWall = true; feed('🧗 Clinging! <b>W/S</b> climb · <b>Space</b> wall-jump · release <b>Right-Click</b> to drop'); }
  } else {
    // free air — steer the dive
    player.vel.x += wishX * 16 * dt; player.vel.z += wishZ * 16 * dt;
    const drag = 0.6 * dt; player.vel.x -= player.vel.x * drag; player.vel.z -= player.vel.z * drag;
  }

  if (!player.swinging) player.pos.addScaledVector(player.vel, dt);   // integrate ground + air (swing integrates itself)

  // world bounds
  player.pos.x = clamp(player.pos.x, -GROUND, GROUND); player.pos.z = clamp(player.pos.z, -GROUND, GROUND);
  // reset ground flag, then collide
  const wasGround = player.onGround; player.onGround = false;
  if (player.pos.y <= 0.05) {
    const fall = -player.vel.y; player.pos.y = 0;
    if (diveSlam) { diveSlam = false; slamAOE(); }
    else {
      if (fall > 42) hurt(Math.min(60, (fall - 42) * 1.6), 'the fall');
      if (fall > 13) { landFX(player.pos, clamp(fall / 7, 2, 7)); sfx('land'); }
    }
    player.vel.y = 0; player.onGround = true; if (player.swinging) releaseWeb();
  }
  collide();
  if (!player.onGround && wasGround && !swingPressed) {}

  // face + animate
  const hv = Math.hypot(player.vel.x, player.vel.z);
  if (hv > 0.5) player.ry = Math.atan2(player.vel.x, player.vel.z);
  else if (f || r) player.ry = Math.atan2(fx * f + rx * r, fz * f + rz * r);
  const anim = player.swinging ? 'run' : player.onGround ? (hv > 1 ? 'run' : 'idle') : (player.wall && swingPressed ? 'idle' : 'run');
  if (myAvatar) {
    myAvatar.group.position.copy(player.pos); myAvatar.group.rotation.y = player.ry;
    myAvatar.setAnim(anim); myAvatar.moveSpeed = hv; myAvatar.group.visible = !player.dead;
    // lean while swinging
    myAvatar.group.rotation.x = player.swinging ? clamp(-player.vel.y * 0.01, -0.5, 0.5) : 0;
  }
  player.anim = anim;
  // web rope
  if (player.swinging && player.anchor && myAvatar) {
    _f.set(player.pos.x, player.pos.y + 1.4, player.pos.z);
    updateRope(webRope, _f, player.anchor);
  } else webRope.visible = false;
}

// ---------------- camera (smoothed, FOV kicks with speed) ----------------
let shakeT = 0, hitstop = 0;
function shake(a) { shakeT = Math.min(1, shakeT + a); }
const camPos = new THREE.Vector3(); let camInit = false, curFov = 72;
function updateCamera(dt) {
  const tx = player.pos.x, ty = player.pos.y + 1.9, tz = player.pos.z;
  const spd = player.vel.length();
  const dist = 9 + clamp((spd - 14) * 0.06, 0, 2.4);   // pull back slightly at speed
  const cp = Math.cos(camPitch);
  let cx = tx - Math.sin(camYaw) * cp * dist, cy = ty - Math.sin(camPitch) * dist + 1.2, cz = tz - Math.cos(camYaw) * cp * dist;
  if (cy < 0.6) cy = 0.6;
  if (!camInit) { camPos.set(cx, cy, cz); camInit = true; }
  const k = 1 - Math.exp(-dt * 11);   // critically-damped-ish follow
  camPos.x += (cx - camPos.x) * k; camPos.y += (cy - camPos.y) * k; camPos.z += (cz - camPos.z) * k;
  camera.position.copy(camPos);
  if (shakeT > 0) {   // impact shake, decays fast
    camera.position.x += (Math.random() - 0.5) * shakeT * 0.55;
    camera.position.y += (Math.random() - 0.5) * shakeT * 0.45;
    shakeT = Math.max(0, shakeT - dt * 2.6);
  }
  camera.lookAt(tx, ty, tz);
  // FOV: base from menu settings, widened by speed for the rush
  const base = clamp((window.ClaudeBox?.settings?.fov) || 72, 60, 100);
  const target = base + clamp((spd - 12) * 0.55, 0, 16);
  curFov += (target - curFov) * (1 - Math.exp(-dt * 6));
  if (Math.abs(curFov - camera.fov) > 0.02) { camera.fov = curFov; camera.updateProjectionMatrix(); }
}

// ---------------- combat: thugs + crime scenes ----------------
const thugs = [];
let currentCrime = null; const cleared = new Set();
let score = 0;
function setChips() { $('#crime-chip').textContent = `🚨 ${cleared.size}/${CRIMES.length}`; $('#score-chip').textContent = `⭐ ${score}`; }
function nearestCrime() { let best = null, bd = Infinity; for (const c of CRIMES) { if (cleared.has(c.id)) continue; const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z); if (d < bd) { bd = d; best = c; } } return best; }

function thugBar() {   // little hp bar sprite above a thug's head
  const c = document.createElement('canvas'); c.width = 64; c.height = 10;
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(1.8, 0.28, 1); s.position.y = 2.7;
  const draw = (fr) => { const x = c.getContext('2d'); x.clearRect(0, 0, 64, 10); x.fillStyle = 'rgba(0,0,0,.65)'; x.fillRect(0, 0, 64, 10); x.fillStyle = fr > 0.5 ? '#41d17a' : fr > 0.25 ? '#ffcf5c' : '#ff5a4a'; x.fillRect(1, 1, 62 * Math.max(0, fr), 8); tex.needsUpdate = true; };
  draw(1); return { sprite: s, draw };
}
function webWrapSprite() {   // 🕸️ shown over a stunned thug
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.textAlign = 'center'; x.font = '46px system-ui'; x.fillText('🕸️', 32, 48);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(1.5, 1.5, 1); s.position.y = 1.5; s.visible = false; return s;
}
// thug archetypes: brutes hit hard but telegraph long; gunners keep range and
// fire dodgeable tracers; normals swarm.
const THUG_TYPES = {
  normal: { hp: 60,  speed: 3.4, dmg: 9,  reach: 2.6, windup: 0.5,  cool: 1.0, score: 25, shirt: '#3a3a44' },
  brute:  { hp: 150, speed: 2.3, dmg: 22, reach: 3.4, windup: 0.85, cool: 1.7, score: 60, shirt: '#5a2424', scale: 1.24 },
  gunner: { hp: 45,  speed: 2.8, dmg: 8,  reach: 24,  windup: 0.45, cool: 2.1, score: 40, shirt: '#26332a' },
};
function typesFor(n) {
  const t = Array(n).fill('normal');
  if (n >= 3) t[1] = 'gunner';
  if (n >= 4) t[2] = 'brute';
  if (n >= 5) t[3] = 'gunner';
  return t;
}
function spawnThugs(c) {
  const types = typesFor(c.thugs);
  for (let i = 0; i < c.thugs; i++) {
    const ty = THUG_TYPES[types[i]];
    const a = (i / c.thugs) * Math.PI * 2; const px = c.x + Math.cos(a) * 6, pz = c.z + Math.sin(a) * 6;
    const ctrl = makeAvatar({ body: 'a', shirtColor: ty.shirt, pantsColor: '#1a1a22', hair: 'short', hairColor: '#1a1410', hat: i % 2 ? 'beanie' : 'none', hatColor: '#111' });
    ctrl.group.position.set(px, 0, pz); if (ty.scale) ctrl.group.scale.setScalar(ty.scale); scene.add(ctrl.group);
    const bar = thugBar(); ctrl.group.add(bar.sprite);
    const wrap = webWrapSprite(); ctrl.group.add(wrap);
    thugs.push({ ctrl, group: ctrl.group, pos: new THREE.Vector3(px, 0, pz), type: types[i], ty, hp: ty.hp, maxHp: ty.hp, state: 'chase', stateT: 0, strafe: i * 2.1, dead: false, removed: false, dying: 0, stunUntil: 0, bar, wrap });
  }
  feed(`🚨 <b>${c.name}</b> — defeat ${c.thugs} thugs!`);
}
function clearThugs() { for (const t of thugs) scene.remove(t.group); thugs.length = 0; clearShots(); }

// ---- gunner tracers ----
const shots = [];
const shotGeo = new THREE.SphereGeometry(0.16, 6, 5);
const shotMat = new THREE.MeshBasicMaterial({ color: 0xffd25a });
function fireShot(from, to) {
  const m = new THREE.Mesh(shotGeo, shotMat); m.position.copy(from); scene.add(m);
  const vel = to.clone().sub(from).normalize().multiplyScalar(30);
  shots.push({ m, vel, ttl: 2.2 });
  sfx('shot');
}
function clearShots() { for (const s of shots) scene.remove(s.m); shots.length = 0; }
function tickShots(dt) {
  const now = performance.now() / 1000;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.m.position.addScaledVector(s.vel, dt); s.ttl -= dt;
    const dx = s.m.position.x - player.pos.x, dy = s.m.position.y - (player.pos.y + 1.1), dz = s.m.position.z - player.pos.z;
    if (!player.dead && dx * dx + dy * dy + dz * dz < 1.3) {
      if (now < dodgeUntil) popup('MISS', { x: player.pos.x, y: player.pos.y + 2.6, z: player.pos.z }, '#7fd0ff', 2);
      else hurt(8, 'a gunner');
      scene.remove(s.m); shots.splice(i, 1); continue;
    }
    if (s.ttl <= 0 || s.m.position.y < 0.05) { scene.remove(s.m); shots.splice(i, 1); }
  }
}

// ---- health packs dropped by KO'd thugs ----
const packs = [];
function dropPack(pos) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.textAlign = 'center'; x.font = '46px system-ui'; x.fillText('❤️', 32, 48);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  s.scale.set(1.2, 1.2, 1); s.position.set(pos.x, 1, pos.z); scene.add(s);
  packs.push({ s, t: 0 });
}
function tickPacks(dt) {
  for (let i = packs.length - 1; i >= 0; i--) {
    const p = packs[i]; p.t += dt;
    p.s.position.y = 1 + Math.sin(p.t * 3) * 0.2;
    const d = Math.hypot(p.s.position.x - player.pos.x, p.s.position.z - player.pos.z);
    if (d < 1.8 && player.pos.y < 3 && !player.dead && player.hp < MAX_HP) {
      player.hp = Math.min(MAX_HP, player.hp + 25); setHealth();
      popup('+25 ❤', { x: player.pos.x, y: player.pos.y + 2.4, z: player.pos.z }, '#7fffb0', 2.4);
      sfx('pack'); scene.remove(p.s); packs.splice(i, 1); continue;
    }
    if (p.t > 12) { p.s.material.opacity = 1 - (p.t - 12) / 1.5; if (p.t > 13.5) { scene.remove(p.s); packs.splice(i, 1); } }
  }
}

// shared damage path: hp bar, popups, KO, combo-scaled score, drops
function damageThug(t, dmg, { knock = 1.6, gold = false } = {}) {
  const now = performance.now() / 1000;
  const stunned = now < t.stunUntil;
  if (stunned) dmg *= 2;               // webbed thugs take double
  t.hp -= dmg; t.bar.draw(Math.max(0, t.hp) / t.maxHp);
  const dx = t.pos.x - player.pos.x, dz = t.pos.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
  t.pos.x += (dx / d) * knock; t.pos.z += (dz / d) * knock;
  if (t.state === 'windup' && dmg >= 26) { t.state = 'cool'; t.stateT = 0.7; }   // big hits interrupt attacks
  popup(stunned ? `💥${dmg}!` : `${dmg}`, { x: t.pos.x, y: t.pos.y + 2.4, z: t.pos.z }, stunned || gold ? '#ffd76a' : '#ffffff');
  if (t.hp <= 0 && !t.dead) {
    t.dead = true; t.dying = 0; t.bar.sprite.visible = false; t.wrap.visible = false;
    const mult = 1 + 0.15 * Math.max(0, combo - 1);
    const pts = Math.round(t.ty.score * Math.min(2.5, mult));
    score += pts; setChips();
    popup('KO!', { x: t.pos.x, y: t.pos.y + 3, z: t.pos.z }, '#7fffb0', 3);
    feed(`👊 ${t.type === 'brute' ? 'Brute' : t.type === 'gunner' ? 'Gunner' : 'Thug'} down! <b>+${pts}</b>${mult > 1 ? ` (x${mult.toFixed(1)} combo)` : ''}`);
    if (Math.random() < 0.35) dropPack(t.pos);
  }
  if (thugs.length && thugs.every((x) => x.dead)) crimeCleared();
}

function updateThugs(dt) {
  const now = performance.now() / 1000;
  for (const t of thugs) {
    if (t.removed) continue;
    if (t.dead) {                       // knockdown → lie flat → sink away
      t.dying += dt;
      if (t.dying < 0.38) t.group.rotation.x = -(t.dying / 0.38) * (Math.PI / 2);
      else if (t.dying > 1.1) t.group.position.y -= dt * 2.2;
      if (t.dying > 1.8) { scene.remove(t.group); t.removed = true; }
      continue;
    }
    const stunned = now < t.stunUntil;
    t.wrap.visible = stunned;
    const dx = player.pos.x - t.pos.x, dz = player.pos.z - t.pos.z, d = Math.hypot(dx, dz) || 1;
    const ty = t.ty;
    if (stunned) { t.ctrl.setAnim('idle'); t.ctrl.moveSpeed = 0; t.state = 'chase'; }
    else if (t.state === 'windup') {
      t.stateT -= dt; t.ctrl.setAnim('idle'); t.ctrl.moveSpeed = 0;
      if (t.stateT <= 0) {
        if (t.type === 'gunner') {
          // lead the shot slightly — swing sideways to make it miss
          const aim = new THREE.Vector3(player.pos.x + player.vel.x * 0.22, player.pos.y + 1.1 + player.vel.y * 0.1, player.pos.z + player.vel.z * 0.22);
          fireShot(new THREE.Vector3(t.pos.x, t.pos.y + 1.5, t.pos.z), aim);
        } else if (d < ty.reach + 0.8 && !player.dead && Math.abs(player.pos.y - t.pos.y) < 3) {
          if (now < dodgeUntil) popup('MISS', { x: player.pos.x, y: player.pos.y + 2.6, z: player.pos.z }, '#7fd0ff', 2);
          else {
            hurt(ty.dmg, t.type === 'brute' ? 'a brute' : 'a thug');
            if (t.type === 'brute') { player.vel.x += (dx / d) * 12; player.vel.z += (dz / d) * 12; player.vel.y += 4; shake(0.5); }
          }
        }
        t.state = 'cool'; t.stateT = ty.cool;
      }
    } else if (t.state === 'cool') {
      t.stateT -= dt; t.ctrl.setAnim('idle'); t.ctrl.moveSpeed = 0;
      if (t.stateT <= 0) t.state = 'chase';
    } else if (t.type === 'gunner') {
      // hold a firing band 9–17m out, strafing; shoot when player is in view
      let mx = 0, mz = 0;
      if (d > 17) { mx = dx / d; mz = dz / d; }
      else if (d < 9) { mx = -dx / d; mz = -dz / d; }
      else { const sa = now * 0.9 + t.strafe; mx = Math.cos(sa) * (-dz / d); mz = Math.cos(sa) * (dx / d); }
      t.pos.x += mx * ty.speed * dt; t.pos.z += mz * ty.speed * dt;
      t.ctrl.setAnim(Math.abs(mx) + Math.abs(mz) > 0.1 ? 'walk' : 'idle'); t.ctrl.moveSpeed = ty.speed;
      if (d < ty.reach && player.pos.y - t.pos.y < 26) { t.state = 'windup'; t.stateT = ty.windup; popup('🔫', { x: t.pos.x, y: t.pos.y + 2.6, z: t.pos.z }, '#ff5a4a', 2); }
    } else {
      // melee: chase, then telegraph a swing
      if (d > ty.reach * 0.85) { t.pos.x += (dx / d) * ty.speed * dt; t.pos.z += (dz / d) * ty.speed * dt; t.ctrl.setAnim('walk'); t.ctrl.moveSpeed = ty.speed; }
      else if (!player.dead && player.pos.y < 3) { t.state = 'windup'; t.stateT = ty.windup; popup('❗', { x: t.pos.x, y: t.pos.y + 2.6, z: t.pos.z }, '#ff5a4a', 2.2); }
      else { t.ctrl.setAnim('idle'); t.ctrl.moveSpeed = 0; }
    }
    t.group.position.copy(t.pos); t.group.rotation.y = Math.atan2(dx, dz);
    t.ctrl.update(dt);
  }
}

// ---- player attacks ----
let lastPunch = 0, combo = 0, comboT = 0, punchStage = 0, diveSlam = false;
let dodgeUntil = 0, dodgeCd = 0, yankCd = 0;
function punch() {
  if (player.dead) return;
  const now = performance.now() / 1000;
  if (now - lastPunch < 0.3) return;   // punch rate limit
  // airborne + falling → dive slam: crash down and hit everything around you
  if (!player.onGround && !player.swinging && player.vel.y < -6 && player.pos.y > 2) {
    if (!diveSlam) { diveSlam = true; player.vel.y -= 24; popup('⤵', { x: player.pos.x, y: player.pos.y + 1, z: player.pos.z }, '#7fd0ff', 2.4); sfx('zip'); }
    return;
  }
  lastPunch = now;
  // 3-hit chain: jab → cross → haymaker (bigger dmg, AOE knockback)
  punchStage = (now - comboT < 1.5) ? (punchStage % 3) + 1 : 1;
  const stageDmg = [0, 26, 30, 44][punchStage];
  const finisher = punchStage === 3;
  // lunge slightly forward
  player.vel.x += Math.sin(player.ry) * (finisher ? 5 : 3); player.vel.z += Math.cos(player.ry) * (finisher ? 5 : 3);
  let hit = false;
  for (const t of thugs) {
    if (t.dead || t.removed) continue;
    const d = Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z);
    if (d < (finisher ? 5.5 : 4.5) && Math.abs(t.pos.y - player.pos.y) < 4) {
      hit = true;
      damageThug(t, stageDmg, { knock: finisher ? 4 : 1.6, gold: finisher });
      if (!finisher) break;            // jab/cross hit one target; haymaker sweeps all in range
    }
  }
  if (hit) {
    combo = (now - comboT < 1.8) ? combo + 1 : 1; comboT = now;
    if (combo >= 2) popup('x' + combo, { x: player.pos.x, y: player.pos.y + 3, z: player.pos.z }, '#7fd0ff', 2);
    if (finisher) { shake(0.45); hitstop = 0.08; }
  } else punchStage = 0;
  sfx(hit ? (finisher ? 'finisher' : 'hit') : 'whiff');
}

function slamAOE() {
  landFX(player.pos, 6); shake(0.8); hitstop = 0.09; sfx('slam');
  const now = performance.now() / 1000;
  let any = false;
  for (const t of thugs) {
    if (t.dead || t.removed) continue;
    const d = Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z);
    if (d < 6.5 && Math.abs(t.pos.y - player.pos.y) < 4) { any = true; t.stunUntil = Math.max(t.stunUntil, now + 1.1); damageThug(t, 40, { knock: 4.5, gold: true }); }
  }
  if (any) { combo += 1; comboT = now; popup('SLAM!', { x: player.pos.x, y: player.pos.y + 3.2, z: player.pos.z }, '#ffd76a', 3.2); }
}

// dodge roll (Q / 🌀): burst of speed with brief invincibility — thugs and bullets miss
function dodge() {
  const now = performance.now() / 1000;
  if (now < dodgeCd || player.dead) return;
  dodgeCd = now + 1.3; dodgeUntil = now + 0.5;
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let dx, dz;
  if (f || r || mv.x || mv.y) {
    const inF = mv.x || mv.y ? -mv.y : f, inR = mv.x || mv.y ? mv.x : r;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = Math.sin(camYaw - Math.PI / 2), rz = Math.cos(camYaw - Math.PI / 2);
    const m = Math.hypot(fx * inF + rx * inR, fz * inF + rz * inR) || 1;
    dx = (fx * inF + rx * inR) / m; dz = (fz * inF + rz * inR) / m;
  } else { dx = -Math.sin(player.ry); dz = -Math.cos(player.ry); }   // no input → roll back
  player.vel.x = dx * 20; player.vel.z = dz * 20;
  if (player.onGround) player.vel.y = 3.5;
  sfx('dodge');
}

// web-yank (E): rip the furthest-forward thug off their feet and drag them to you
function webYank() {
  const now = performance.now() / 1000;
  if (now < yankCd || player.dead) return;
  let best = null, bd = 22;
  for (const t of thugs) { if (t.dead || t.removed) continue; const d = Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z); if (d < bd && d > 2.5) { bd = d; best = t; } }
  if (!best) return;
  yankCd = now + 2.5;
  flashRope(new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z), new THREE.Vector3(best.pos.x, best.pos.y + 1.3, best.pos.z), 200);
  const dx = player.pos.x - best.pos.x, dz = player.pos.z - best.pos.z, d = Math.hypot(dx, dz) || 1;
  best.pos.x += (dx / d) * (d - 2.2); best.pos.z += (dz / d) * (d - 2.2);   // drag to arm's length
  best.stunUntil = Math.max(best.stunUntil, now + 0.9); best.state = 'cool'; best.stateT = 0.9;
  popup('🕸️➡️', { x: best.pos.x, y: best.pos.y + 2.6, z: best.pos.z }, '#ffffff', 2.4);
  sfx('yank');
}

// web-stun: wrap the nearest thug in webbing (F / 🎯) — stunned 3s, takes double damage
let stunCd = 0;
function webStun() {
  const now = performance.now() / 1000;
  if (now < stunCd || player.dead) return;
  let best = null, bd = 26;
  for (const t of thugs) { if (t.dead || t.removed) continue; const d = Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z); if (d < bd) { bd = d; best = t; } }
  if (!best) return;
  stunCd = now + 4;
  best.stunUntil = now + 3;
  flashRope(new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z), new THREE.Vector3(best.pos.x, best.pos.y + 1.5, best.pos.z), 180);
  popup('🕸️', { x: best.pos.x, y: best.pos.y + 2.6, z: best.pos.z }, '#ffffff', 2.6);
  sfx('stun');
}

function crimeCleared() {
  if (!currentCrime) return; cleared.add(currentCrime.id);
  const b = beacons.get(currentCrime.id); if (b) { scene.remove(b.g); beacons.delete(currentCrime.id); }
  score += 150; setChips();
  popup('+150', { x: player.pos.x, y: player.pos.y + 3.4, z: player.pos.z }, '#ffd76a', 3);
  feed(`✅ <b>${currentCrime.name}</b> stopped! The city is safer.`);
  sfx('win');
  window.ClaudeBox?.completeChallenge?.('webrush-hero');
  if (cleared.size >= CRIMES.length) window.ClaudeBox?.completeChallenge?.('webrush-city');
  currentCrime = null;
}
function updateCrime() {
  if (!currentCrime) currentCrime = nearestCrime();
  const c = currentCrime;
  if (!c) { $('#ob-text').textContent = 'City saved! Swing free, hero. 🕸️'; $('#waypoint').classList.add('hidden'); clearThugs(); return; }
  const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
  if (d < 45 && !thugs.length) spawnThugs(c);
  if (d > 95 && thugs.length) clearThugs();   // left the scene — reset
  const alive = thugs.filter((t) => !t.dead).length;
  $('#ob-text').textContent = thugs.length ? `${c.name}: ${alive} thug${alive === 1 ? '' : 's'} left` : `Swing to ${c.name} (${Math.round(d)}m)`;
  // waypoint arrow
  const wp = $('#waypoint'); wp.classList.remove('hidden');
  const ang = Math.atan2(c.x - player.pos.x, c.z - player.pos.z) - camYaw;
  $('#wp-arrow').style.transform = `rotate(${-ang}rad)`; $('#wp-dist').textContent = Math.round(d) + 'm';
}

// ---------------- combat feedback ----------------
function hurt(dmg, by) {
  if (player.dead) return; player.hp = Math.max(0, player.hp - dmg); setHealth(); flashDmg(); sfx('ouch');
  combo = 0; punchStage = 0; shake(0.3);   // taking a hit breaks your combo
  if (player.hp <= 0) die(by);
}
function setHealth() { $('#health-fill').style.width = clamp(player.hp / MAX_HP * 100, 0, 100) + '%'; $('#health-num').textContent = Math.max(0, Math.round(player.hp)); }
function flashDmg() { const f = $('#dmg-flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 130); }
let respawnT = 0;
function die(by) { player.dead = true; releaseWeb(); $('#dead-overlay').classList.remove('hidden'); $('#dead-by').textContent = by ? `Taken out by ${by}` : ''; respawnT = 3; }
function respawn() { player.dead = false; player.hp = MAX_HP; setHealth(); player.pos.set(SPAWN.x, SPAWN.y, SPAWN.z); player.vel.set(0, 0, 0); $('#dead-overlay').classList.add('hidden'); clearThugs(); currentCrime = null; }

function feed(html) { const l = document.createElement('div'); l.className = 'feed-line'; l.innerHTML = html; $('#feed').prepend(l); while ($('#feed').children.length > 4) $('#feed').lastChild.remove(); setTimeout(() => l.remove(), 5500); }
let rewardedSwing = false;
function firstSwingReward() { if (rewardedSwing) return; rewardedSwing = true; window.ClaudeBox?.completeChallenge?.('webrush-swing'); }

// ---------------- sound ----------------
let actx = null, windGain = null;
const userVol = () => (window.ClaudeBox?.settings?.volume ?? 1);
function ensureWind() {   // looping filtered noise; gain follows swing speed
  if (windGain || !actx) return;
  const len = actx.sampleRate * 2, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
  const filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 550;
  windGain = actx.createGain(); windGain.gain.value = 0;
  src.connect(filt); filt.connect(windGain); windGain.connect(actx.destination); src.start();
}
function sfx(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    ensureWind();
    const uv = userVol(); if (uv <= 0) return;
    const n = actx.currentTime;
    if (kind === 'win') {   // little victory arpeggio
      [523.25, 659.25, 783.99, 1046.5].forEach((fq, i) => {
        const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
        o.type = 'triangle'; o.frequency.value = fq; const t = n + i * 0.09;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14 * uv, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.start(t); o.stop(t + 0.32);
      });
      return;
    }
    const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
    let f = 400, type = 'sine', dur = 0.12, vol = 0.12;
    if (kind === 'web') { f = 900; type = 'triangle'; dur = 0.09; }
    else if (kind === 'zip') { f = 500; type = 'sawtooth'; dur = 0.18; }
    else if (kind === 'hit') { f = 200; type = 'square'; dur = 0.1; vol = 0.18; }
    else if (kind === 'whiff') { f = 300; type = 'sine'; dur = 0.06; vol = 0.07; }
    else if (kind === 'ouch') { f = 160; type = 'square'; dur = 0.14; }
    else if (kind === 'land') { f = 110; type = 'square'; dur = 0.09; vol = 0.1; }
    else if (kind === 'stun') { f = 740; type = 'triangle'; dur = 0.16; vol = 0.14; }
    else if (kind === 'finisher') { f = 150; type = 'square'; dur = 0.2; vol = 0.24; }
    else if (kind === 'slam') { f = 80; type = 'square'; dur = 0.3; vol = 0.26; }
    else if (kind === 'shot') { f = 1100; type = 'square'; dur = 0.05; vol = 0.08; }
    else if (kind === 'dodge') { f = 620; type = 'sine'; dur = 0.12; vol = 0.1; }
    else if (kind === 'yank') { f = 480; type = 'triangle'; dur = 0.2; vol = 0.15; }
    else if (kind === 'pack') { f = 880; type = 'sine'; dur = 0.14; vol = 0.13; }
    o.type = type; o.frequency.setValueAtTime(f, n);
    if (kind === 'zip' || kind === 'web' || kind === 'stun' || kind === 'slam' || kind === 'finisher') o.frequency.exponentialRampToValueAtTime(f * 0.5, n + dur);
    if (kind === 'yank' || kind === 'pack') o.frequency.exponentialRampToValueAtTime(f * 1.6, n + dur);
    g.gain.setValueAtTime(vol * uv, n); g.gain.exponentialRampToValueAtTime(0.0001, n + dur); o.start(n); o.stop(n + dur);
  } catch {}
}

// ---------------- suits ----------------
// Full-body hero suits: recolor mask (skin), torso and legs; hair/hat hide
// under the mask. Bought once with ClaudeBux, synced cross-device via gamesave.
const SUITS = [
  { id: 'none',     name: 'Street Clothes',  price: 0,  em: '🧢' },
  { id: 'hero',     name: 'Hero Classic',    price: 0,  em: '🕷️', skin: '#c8262e', shirt: '#c8262e', pants: '#22348f' },
  { id: 'scarlet',  name: 'Scarlet Hunter',  price: 12, em: '🔥', skin: '#b01c24', shirt: '#b01c24', pants: '#17171d' },
  { id: 'emerald',  name: 'Emerald Sting',   price: 14, em: '🐍', skin: '#186a40', shirt: '#186a40', pants: '#0e2c1e' },
  { id: 'midnight', name: 'Midnight',        price: 15, em: '🌙', skin: '#15151c', shirt: '#15151c', pants: '#8a1420' },
  { id: 'ghost',    name: 'Ghost White',     price: 18, em: '👻', skin: '#e8ecf4', shirt: '#e8ecf4', pants: '#3a4050' },
  { id: 'shadow',   name: 'Symbiote Shadow', price: 20, em: '🖤', skin: '#0c0c12', shirt: '#0c0c12', pants: '#0c0c12' },
  { id: 'future',   name: 'Iron Crimson',    price: 25, em: '🤖', skin: '#b01e2e', shirt: '#b01e2e', pants: '#d8a03c' },
  { id: 'aurum',    name: 'Golden Age',      price: 30, em: '🏆', skin: '#d8a83c', shirt: '#d8a83c', pants: '#f0ead8' },
];
let suitsOwned = new Set(['none', 'hero']);
let suitEq = 'hero';
let bootProfile = {};
const cbxHeaders = () => ({ 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' });

function loadSuitsLocal() {
  try { const d = JSON.parse(localStorage.getItem('webrush.suits') || 'null'); if (d) { d.owned?.forEach((id) => suitsOwned.add(id)); if (d.eq) suitEq = d.eq; } } catch {}
}
async function loadSuitsServer(name) {
  try {
    const res = await fetch(`/api/gamesave/webrush?name=${encodeURIComponent(name)}`, { headers: cbxHeaders() });
    const { data } = await res.json();
    if (data?.suits) { data.suits.owned?.forEach((id) => suitsOwned.add(id)); if (!localStorage.getItem('webrush.suits') && data.suits.eq) suitEq = data.suits.eq; }
  } catch {}
}
function saveSuits() {
  const data = { owned: [...suitsOwned], eq: suitEq };
  localStorage.setItem('webrush.suits', JSON.stringify(data));
  const name = window.ClaudeBox?.getName?.();
  if (name) fetch('/api/gamesave', { method: 'POST', headers: cbxHeaders(), body: JSON.stringify({ name, game: 'webrush', data: { suits: data } }) }).catch(() => {});
}
function curSuit() { return SUITS.find((s) => s.id === suitEq) || SUITS[0]; }
function suitedProfile() {
  const s = curSuit();
  if (!s.skin) return bootProfile;
  return { ...bootProfile, skin: s.skin, shirtColor: s.shirt, pantsColor: s.pants, hair: 'none', hat: 'none', suit: 'none' };
}
function applySuit() {
  if (!myAvatar) return;
  const p = suitedProfile();
  myAvatar.setColors(p);
  myAvatar.setClothing(p);
}

function toggleSuits() {
  const panel = $('#suits-panel');
  if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
  document.exitPointerLock?.();
  renderSuits(); panel.classList.remove('hidden');
}
function renderSuits() {
  const grid = $('#suits-grid'); grid.innerHTML = '';
  for (const s of SUITS) {
    const owned = suitsOwned.has(s.id), eq = suitEq === s.id;
    const card = document.createElement('button'); card.className = 'suit-card' + (eq ? ' eq' : '');
    const sw = s.skin
      ? `<span class="sw"><i style="background:${s.skin}"></i><i style="background:${s.shirt}"></i><i style="background:${s.pants}"></i></span>`
      : '<span class="sw">👕</span>';
    card.innerHTML = `<span class="s-em">${s.em}</span><b>${s.name}</b>${sw}<small>${eq ? 'Equipped' : owned ? 'Tap to equip' : `🔷 ${s.price}`}</small>`;
    card.addEventListener('click', async () => {
      if (eq) return;
      if (!owned) {
        const res = await window.ClaudeBox?.spend?.(s.price, 'Web Rush suit: ' + s.name);
        if (!res?.ok) { window.ClaudeBox?.toast?.(`Not enough ClaudeBux — ${s.name} costs 🔷 ${s.price}`); return; }
        suitsOwned.add(s.id);
        window.ClaudeBox?.toast?.(`Suit unlocked! ${s.em} ${s.name}`);
      }
      suitEq = s.id; saveSuits(); applySuit(); renderSuits();
      feed(`${s.em} Suited up: <b>${s.name}</b>`);
    });
    grid.appendChild(card);
  }
}

// ---------------- remotes ----------------
const remotes = new Map();
function makeRemote(d) {
  const ctrl = makeAvatar(d.avatar || {}); ctrl.group.add(nameTag(d.name)); scene.add(ctrl.group);
  const rope = makeRope();
  const rec = { ctrl, group: ctrl.group, interp: new InterpBuffer(), data: d, rope }; remotes.set(d.id, rec); return rec;
}
function dropRemote(id) { const r = remotes.get(id); if (r) { scene.remove(r.group); scene.remove(r.rope); remotes.delete(id); } }
function nameTag(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.textAlign = 'center'; x.font = '800 34px system-ui'; x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText(name, 128, 40); x.fillStyle = '#fff'; x.fillText(name, 128, 40);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false })); s.scale.set(3, 0.75, 1); s.position.y = 2.9; return s;
}

// ---------------- net ----------------
const net = new Net();
net.on('welcome', (m) => { for (const d of m.players) makeRemote(d); if (m.you?.pos) player.pos.set(m.you.pos.x, m.you.pos.y, m.you.pos.z); setChips(); $('#loading').classList.add('hidden'); $('#hud').classList.remove('hidden'); $('#reticle').classList.remove('hidden'); feed('🕸️ Swing out and stop the crimes across the city!'); });
net.on('player.join', (m) => { if (m.player.id !== net.id && !remotes.has(m.player.id)) makeRemote(m.player); });
net.on('player.leave', (m) => dropRemote(m.id));
net.on('snapshot', (m) => { for (const row of m.players) { const [id, x, y, z, ry, anim, wx, wy, wz] = row; if (id === net.id) continue; const r = remotes.get(id); if (r) { r.interp.push([x, y, z, ry, anim]); r.web = (wx != null) ? [wx, wy, wz] : null; } } });
net.on('kicked', (m) => { document.body.innerHTML = `<div style="position:fixed;inset:0;display:grid;place-items:center;background:#0b1020;color:#fff;text-align:center;font-family:system-ui"><div><div style="font-size:54px">🚪</div><h1>Kicked</h1><p>${m.reason || ''}</p></div></div>`; });
net.on('toast', (m) => feed(m.text));
net.on('_disconnect', () => feed('Disconnected — refresh to rejoin.'));

// ---------------- touch ----------------
const mv = { x: 0, y: 0 }; let tWeb = false, tJump = false;
function setupTouch() {
  $('#touch').classList.remove('hidden'); const stick = $('#stick'), knob = stick.querySelector('i'); let sid = null, cx = 0, cy = 0;
  stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { let dx = t.clientX - cx, dy = t.clientY - cy; const mag = Math.hypot(dx, dy) || 1, cl = Math.min(mag, 50); dx = dx / mag * cl; dy = dy / mag * cl; knob.style.transform = `translate(${dx}px,${dy}px)`; mv.x = dx / 50; mv.y = dy / 50; } }, { passive: false });
  addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; knob.style.transform = ''; mv.x = mv.y = 0; } });
  let lid = null, lx = 0, ly = 0;
  canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; if (t.clientX > innerWidth / 2 && lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === lid) { camYaw -= (t.clientX - lx) * 0.006; camPitch = clamp(camPitch - (t.clientY - ly) * 0.005, -1.2, 0.9); lx = t.clientX; ly = t.clientY; } }, { passive: false });
  canvas.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; });
  $('#t-web').addEventListener('touchstart', (e) => { tWeb = true; e.preventDefault(); }, { passive: false });
  $('#t-web').addEventListener('touchend', (e) => { tWeb = false; e.preventDefault(); }, { passive: false });
  $('#t-jump').addEventListener('touchstart', (e) => { tJump = true; e.preventDefault(); }, { passive: false });
  $('#t-jump').addEventListener('touchend', (e) => { tJump = false; e.preventDefault(); }, { passive: false });
  $('#t-punch').addEventListener('touchstart', (e) => { punch(); e.preventDefault(); }, { passive: false });
  $('#t-stun').addEventListener('touchstart', (e) => { webStun(); e.preventDefault(); }, { passive: false });
  $('#t-dodge').addEventListener('touchstart', (e) => { dodge(); e.preventDefault(); }, { passive: false });
}

// ---------------- loop ----------------
let zipLatch = false, jumpLatch = false, tipWall = false, last = performance.now();
let worldT = 0, reticleT = 0;
const _rHand = new THREE.Vector3(), _rAnchor = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); const rawDt = Math.min(0.04, (now - last) / 1000); last = now;
  let dt = rawDt;
  if (hitstop > 0) { hitstop -= rawDt; dt = rawDt * 0.12; }   // hit-stop: the world freezes for a beat on big hits
  worldT += dt;
  if (respawnT > 0) { respawnT -= rawDt; $('#respawn-n').textContent = Math.ceil(respawnT); if (respawnT <= 0) respawn(); }
  update(dt); updateThugs(dt); updateCrime(); updateCamera(dt);
  if (myAvatar) myAvatar.update(dt);
  tickPopups(dt); tickCars(dt); tickShots(dt); tickPacks(dt);

  // ambient world life
  for (const c of clouds) { c.s.position.x += c.v * dt; if (c.s.position.x > GROUND) c.s.position.x = -GROUND; }
  for (let i = 0; i < blinkTips.length; i++) blinkTips[i].material.opacity = 0.35 + 0.65 * (Math.sin(worldT * 2.6 + i * 1.7) > 0 ? 1 : 0);
  for (const [id, b] of beacons) {
    const k = (Math.sin(worldT * 3.4) + 1) / 2;
    b.pillar.material.opacity = 0.1 + 0.09 * k;
    b.ring.scale.setScalar(1 + k * 0.35);
    const active = currentCrime && currentCrime.id === id && thugs.length;
    b.light.intensity = active ? 2.2 : 0;
    if (active) b.light.color.setHex(Math.sin(worldT * 9) > 0 ? 0xff2a3c : 0x2a6cff);   // police strobe
  }

  // speed HUD + wind (visual + audio) build with velocity
  const spd = player.vel.length();
  $('#speed').textContent = Math.round(spd * 2.2);
  $('#wind').style.opacity = clamp((spd - 18) / 32, 0, 0.85);
  if (windGain) windGain.gain.value = clamp((spd - 14) / 46, 0, 0.22) * userVol();

  // reticle glows when a web anchor is reachable (checked at 8Hz, not every frame)
  reticleT += dt;
  if (reticleT > 0.12) { reticleT = 0; $('#reticle').classList.toggle('ok', !player.onGround || player.pos.y > 2 ? !!findAnchor() : false); }

  for (const [, r] of remotes) {
    const s = r.interp.sample([3]); if (s) { r.group.position.set(s[0], s[1], s[2]); r.group.rotation.y = s[3]; r.ctrl.setAnim(s[4]); r.ctrl.moveSpeed = s[4] === 'run' ? 8 : s[4] === 'walk' ? 3 : 0; }
    r.ctrl.update(dt);
    if (r.web && s) { _rHand.set(s[0], s[1] + 1.4, s[2]); _rAnchor.set(r.web[0], r.web[1], r.web[2]); updateRope(r.rope, _rHand, _rAnchor); } else r.rope.visible = false;
  }
  renderer.render(scene, camera);
}

// ---------------- boot ----------------
const chatOpen = false;
async function boot() {
  const name = localStorage.getItem('claudebox.user'); if (!name) { location.href = '/'; return; }
  let profile = {};
  try { const res = await fetch('/api/avatar/' + encodeURIComponent(name), { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } }); if (!res.ok) throw 0; const data = await res.json(); profile = data.avatar || {}; localStorage.setItem('claudebox.user', data.name); } catch { location.href = '/'; return; }
  $('#load-msg').textContent = 'Loading hero…';
  bootProfile = profile;
  loadSuitsLocal();
  await loadSuitsServer(localStorage.getItem('claudebox.user'));
  await preloadAvatars(['boy', 'girl']);
  myAvatar = makeAvatar(suitedProfile()); scene.add(myAvatar.group);
  $('#suit-btn').addEventListener('click', toggleSuits);
  $('#suits-close').addEventListener('click', toggleSuits);
  setHealth(); if (isTouch) setupTouch();
  net.connect();
  net.join({ name: localStorage.getItem('claudebox.user'), avatar: suitedProfile(), code: localStorage.getItem('claudebox.code') || '' });
  net.startMovementStream(() => ({ t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim, web: player.swinging && player.anchor ? { x: +player.anchor.x.toFixed(1), y: +player.anchor.y.toFixed(1), z: +player.anchor.z.toFixed(1) } : null }));
  requestAnimationFrame(frame);
  window.__webrush = { player, remotes, net, scene };
  window.ClaudeBox?.registerGame?.({
    players: () => [...remotes.values()].map((r) => ({ name: r.data?.name })).filter((p) => p.name),
    resetCharacter: respawn,
    keybinds: [{ keys: 'Right-Click', action: 'Web-swing (hold)' }, { keys: 'Space', action: 'Jump / wall-jump' }, { keys: 'WASD', action: 'Steer / run' }, { keys: 'W (swinging)', action: 'Reel up' }, { keys: 'Click', action: 'Punch (3-hit combo)' }, { keys: 'Click (mid-air)', action: 'Dive slam' }, { keys: 'Q', action: 'Dodge roll' }, { keys: 'E', action: 'Web-yank a thug' }, { keys: 'F', action: 'Web-stun a thug' }, { keys: 'Shift', action: 'Web-zip' }, { keys: 'U', action: 'Suits' }, { keys: 'Mouse', action: 'Look' }],
    help: 'Hold Right-Click to web-swing — release on the upswing for a boost. Space jumps (and wall-jumps). Punch chains a 3-hit combo; punch mid-air to dive slam. Q dodges gunfire and swings, E yanks a thug to you, F webs one up for double damage. Buy suits with U.',
  });
}
boot();
