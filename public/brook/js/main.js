// Brooktown RP — an original town roleplay game for ClaudeBox.
// Third-person multiplayer: walk the town, drive cars, enter houses, chat.
import * as THREE from 'three';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import { fpFade } from '/js/fpzoom.js';
import { SPAWN, CARS, BUILDINGS, ROADS, GROUND } from '/shared/brook/town.js';
import { sfx, toggleRadio, radioIsOn } from './sfx.js';

const $ = (s) => document.querySelector(s);
const status = (t) => { const e = $('#load-status'); if (e) e.textContent = t; };

// ---------------- renderer / scene ----------------
const canvas = $('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9d8f5');
scene.fog = new THREE.Fog('#bfe2f5', 180, 520);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight('#eaf4ff', '#6a7d55', 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff2d8', 1.5);
sun.position.set(60, 120, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 10; sc.far = 400;
scene.add(sun, sun.target);

// ---------------- town ----------------
const COLLIDERS = [];   // { x, z, hw, hd }  (XZ AABB, treated as full-height walls)
const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function collider(x, z, w, d) { COLLIDERS.push({ x, z, hw: w / 2, hd: d / 2 }); }

function buildGround() {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(GROUND * 2, GROUND * 2), lam('#6ea862'));
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  // roads
  for (const r of ROADS) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), lam('#3b3f46'));
    road.rotation.x = -Math.PI / 2; road.position.set(r.x, 0.02, r.z); road.receiveShadow = true; scene.add(road);
    // sidewalk trim
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(r.w + 4, r.d + 4), lam('#9aa0a8'));
    sw.rotation.x = -Math.PI / 2; sw.position.set(r.x, 0.01, r.z); sw.receiveShadow = true; scene.add(sw);
    // center dashes (only along the long axis)
    const along = r.w >= r.d, len = along ? r.w : r.d;
    for (let o = -len / 2 + 6; o < len / 2 - 6; o += 10) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(along ? 3 : 0.4, along ? 0.4 : 3), lam('#e7d24a'));
      dash.rotation.x = -Math.PI / 2; dash.position.set(along ? r.x + o : r.x, 0.03, along ? r.z : r.z + o); scene.add(dash);
    }
  }
  // plaza
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(14, 32), lam('#c7bfae'));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.03; plaza.receiveShadow = true; scene.add(plaza);
  // fountain
  const f = new THREE.Group();
  f.add(box(3.4, 0.6, 3.4, '#b7c0cc', 0, 0.3, 0));
  const water = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 20), lam('#5bb8e0'));
  water.position.y = 0.55; f.add(water);
  f.add(box(0.4, 1.4, 0.4, '#dfe6ee', 0, 1.1, 0));
  scene.add(f); collider(0, 0, 3.6, 3.6);
}

function labelSprite(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  x.font = 'bold 52px Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#fff'; x.strokeStyle = 'rgba(10,20,30,.85)'; x.lineWidth = 8;
  x.strokeText(text, 256, 52); x.fillText(text, 256, 52);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true }));
  s.scale.set(12, 2.25, 1); return s;
}
function buildBuilding(b) {
  const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
  if (b.kind === 'block') {
    g.add(box(b.w, b.h, b.d, b.color, 0, b.h / 2, 0));
    // roof slab
    const roof = box(b.w + 1.2, 0.6, b.d + 1.2, b.roof || '#6a4a3a', 0, b.h + 0.3, 0);
    g.add(roof);
    // door + windows (decorative)
    g.add(box(2.4, 3, 0.2, '#3a2c22', 0, 1.5, b.d / 2 + 0.05));
    for (let wx = -b.w / 2 + 4; wx < b.w / 2 - 2; wx += 5) {
      g.add(box(2, 1.6, 0.2, '#bfe3ff', wx, b.h * 0.6, b.d / 2 + 0.05));
    }
    const sign = labelSprite(b.label || ''); sign.position.set(0, b.h + 2.4, 0); g.add(sign);
    collider(b.x, b.z, b.w, b.d);
  } else {
    // hollow enterable house: floor, pitched roof, 4 walls with a door gap
    const t = 0.4, w = b.w, d = b.d, h = b.h, half = 3.4; // door gap half? gap width = 3.2
    g.add(box(w, 0.2, d, '#8a7a68', 0, 0.1, 0));                 // floor
    // roof (pyramid via cone with 4 segments)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 3, 4), lam(b.roofColor || '#9c4a3a'));
    roof.rotation.y = Math.PI / 4; roof.position.y = h + 1.5; roof.castShadow = true; g.add(roof);
    // walls, splitting whichever side is the door
    const gap = 3.2;
    const wall = (cx, cy, cz, ww, hh, dd) => { g.add(box(ww, hh, dd, b.color, cx, cy, cz)); };
    const addSide = (side) => {
      const isDoor = b.door === side;
      if (side === 'south' || side === 'north') {
        const z = (side === 'south' ? 1 : -1) * d / 2;
        if (isDoor) { const seg = (w - gap) / 2; wall(-(gap / 2 + seg / 2), h / 2, z, seg, h, t); wall(gap / 2 + seg / 2, h / 2, z, seg, h, t); wall(0, h - 0.6, z, gap, 1.2, t); }
        else wall(0, h / 2, z, w, h, t);
      } else {
        const x = (side === 'east' ? 1 : -1) * w / 2;
        if (isDoor) { const seg = (d - gap) / 2; wall(x, h / 2, -(gap / 2 + seg / 2), t, h, seg); wall(x, h / 2, gap / 2 + seg / 2, t, h, seg); wall(x, h - 0.6, 0, t, 1.2, gap); }
        else wall(x, h / 2, x === 0 ? 0 : 0, t, h, d);
      }
    };
    for (const s of ['south', 'north', 'east', 'west']) addSide(s);
    // simple interior furniture
    g.add(box(2.4, 0.9, 1.2, '#7a5230', -w / 2 + 2.5, 0.55, -d / 2 + 2)); // bed/table
    g.add(box(1.4, 1.4, 0.4, '#c0c8d2', w / 2 - 1.5, 0.9, 0));            // fridge/shelf
    // colliders: approximate the 4 walls (door gaps are walk-throughs, so we
    // add wall segments as colliders except we leave the door side's gap open)
    const cw = (cx, cz, cw2, cd2) => collider(b.x + cx, b.z + cz, cw2, cd2);
    for (const s of ['south', 'north', 'east', 'west']) {
      const isDoor = b.door === s;
      if (s === 'south' || s === 'north') {
        const z = (s === 'south' ? 1 : -1) * d / 2;
        if (isDoor) { const seg = (w - gap) / 2; cw(-(gap / 2 + seg / 2), z, seg, t); cw(gap / 2 + seg / 2, z, seg, t); }
        else cw(0, z, w, t);
      } else {
        const x = (s === 'east' ? 1 : -1) * w / 2;
        if (isDoor) { const seg = (d - gap) / 2; cw(x, -(gap / 2 + seg / 2), t, seg); cw(x, gap / 2 + seg / 2, t, seg); }
        else cw(x, 0, t, d);
      }
    }
  }
  scene.add(g);
}

function makeTree(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(box(0.7, 3, 0.7, '#6b4a2c', 0, 1.5, 0));
  const f = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), lam('#3f8a44'));
  f.position.y = 4.4; f.castShadow = true; g.add(f);
  scene.add(g); collider(x, z, 1, 1);
}
const lampHeads = [];
function makeLamp(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(box(0.3, 5, 0.3, '#2a2e36', 0, 2.5, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe6a0', transparent: true, opacity: 0.15 }));
  head.position.y = 5; g.add(head); lampHeads.push(head);
  scene.add(g);
}
function makeBush(x, z) {
  const f = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), lam('#4a9a4e'));
  f.position.set(x, 0.9, z); f.scale.y = 0.7; f.castShadow = true; scene.add(f);
}
function makeHydrant(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(box(0.5, 0.9, 0.5, '#d13b3b', 0, 0.45, 0)); g.add(box(0.6, 0.2, 0.6, '#b02f2f', 0, 0.95, 0));
  scene.add(g);
}
function makeMailbox(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(box(0.15, 1, 0.15, '#5a4a3a', 0, 0.5, 0)); g.add(box(0.5, 0.4, 0.7, '#3a6a9c', 0, 1.05, 0));
  scene.add(g);
}
function buildProps() {
  // trees filling the blocks (kept clear of roads)
  const trees = [];
  for (let x = -130; x <= 130; x += 26) for (let z = -110; z <= 110; z += 28) {
    if (Math.abs(x) < 12 || Math.abs(z) < 12) continue;            // main roads
    if (Math.abs(Math.abs(z) - 52) < 10 || Math.abs(Math.abs(x) - 60) < 10) continue;  // side roads
    if ((x + z) % 3 === 0) trees.push([x + (x % 7) - 3, z + (z % 5) - 2]);
  }
  for (const [x, z] of trees) makeTree(x, z);
  // streetlights along the main roads
  for (let x = -120; x <= 120; x += 30) { makeLamp(x, 11); makeLamp(x, -11); }
  for (let z = -100; z <= 100; z += 30) { if (Math.abs(z) < 12) continue; makeLamp(11, z); makeLamp(-11, z); }
  // small clutter: bushes, hydrants, mailboxes near sidewalks
  for (let x = -100; x <= 100; x += 20) { makeBush(x, 13); makeBush(x + 6, -13); }
  for (const [x, z] of [[-30, 10], [30, 10], [-30, -10], [30, -10], [-90, 12], [90, -12]]) makeHydrant(x, z);
  for (const [x, z] of [[-18, 10], [18, 10], [-18, -10], [18, -10], [-72, 13], [72, -13]]) makeMailbox(x, z);
}

buildGround();
for (const b of BUILDINGS) buildBuilding(b);
buildProps();

// ---------------- cars ----------------
function makeCar(color) {
  const g = new THREE.Group();
  g.add(box(2.2, 0.7, 4.4, color, 0, 0.7, 0));            // body
  const cabin = box(1.9, 0.8, 2.2, '#20242c', 0, 1.35, -0.2); g.add(cabin);
  g.add(box(1.95, 0.5, 1.6, '#8fd0ff', 0, 1.35, -0.2));  // windows tint
  for (const [wx, wz] of [[-1.05, 1.4], [1.05, 1.4], [-1.05, -1.4], [1.05, -1.4]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12), lam('#15171c'));
    wheel.rotation.z = Math.PI / 2; wheel.position.set(wx, 0.5, wz); g.add(wheel);
  }
  g.add(box(0.5, 0.3, 0.2, '#ffe6a0', -0.6, 0.7, 2.25)); // headlights
  g.add(box(0.5, 0.3, 0.2, '#ffe6a0', 0.6, 0.7, 2.25));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
const cars = new Map();   // id -> { mesh, x, z, ry, driver, interp }
for (const c of CARS) {
  const mesh = makeCar(c.color); mesh.position.set(c.x, 0, c.z); mesh.rotation.y = c.ry; scene.add(mesh);
  cars.set(c.id, { mesh, x: c.x, z: c.z, ry: c.ry, driver: null, interp: new InterpBuffer(), color: c.color });
}

// ---------------- collision ----------------
const R = 0.5;
function collideXZ(px, pz, rad = R) {
  let x = px, z = pz;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of COLLIDERS) {
      const dx = x - c.x, dz = z - c.z;
      const px2 = c.hw + rad - Math.abs(dx), pz2 = c.hd + rad - Math.abs(dz);
      if (px2 > 0 && pz2 > 0) {
        if (px2 < pz2) x += px2 * Math.sign(dx || 1);
        else z += pz2 * Math.sign(dz || 1);
      }
    }
  }
  return { x, z };
}

// ---------------- local player ----------------
const G = 26, JUMP = 11.5, WALK = 7, RUN = 12.5;
const player = { pos: { x: SPAWN.x, y: 0, z: SPAWN.z }, vel: { x: 0, y: 0, z: 0 }, ry: Math.PI, grounded: true, anim: 'idle' };
let myAvatar = { ctrl: null, group: null };

// ---------------- camera ----------------
const orbit = { yaw: Math.PI, pitch: 0.45, dist: 9 };
function clampPitch() { orbit.pitch = Math.max(-0.15, Math.min(1.2, orbit.pitch)); }
function clampDist(d) { return Math.max(0.3, Math.min(20, d)); }   // 0.3 = first-person on foot (car cam is fixed at 12)
function updateCamera() {
  let tx, ty, tz, dist = orbit.dist;
  if (game.car) { tx = game.car.x; ty = 1.6; tz = game.car.z; dist = 12; }
  else { tx = player.pos.x; ty = player.pos.y + 1.6; tz = player.pos.z; }
  const cp = Math.cos(orbit.pitch);
  const cx = tx + Math.sin(orbit.yaw) * cp * dist;
  const cy = ty + Math.sin(orbit.pitch) * dist;
  const cz = tz + Math.cos(orbit.yaw) * cp * dist;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.5);
  camera.lookAt(tx, ty, tz);
}

// ---------------- input ----------------
const keys = new Set();
let dragging = false, lastX = 0, lastY = 0, locked = false;
const typing = () => { const e = document.activeElement; return e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA'); };
canvas.addEventListener('click', (e) => {
  if (decorating >= 0) { decoPlaceAt(e.clientX, e.clientY); return; }
  if (!locked && !typing() && !('ontouchstart' in window)) canvas.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
canvas.addEventListener('mousedown', (e) => { if (!locked) { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', (e) => {
  if (decorating >= 0 && ghost && decoType) { const p = floorPoint(e.clientX, e.clientY); if (p) { ghost.position.set(p.x, 0, p.z); ghost.rotation.y = decoRot; } }
  if (locked) { orbit.yaw -= e.movementX * 0.0024; orbit.pitch += e.movementY * 0.0024; clampPitch(); return; }
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastX) * 0.005; orbit.pitch += (e.clientY - lastY) * 0.005; clampPitch();
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = clampDist(orbit.dist + e.deltaY * 0.01); }, { passive: false });
addEventListener('keydown', (e) => {
  if (typing()) { if (e.code === 'Enter') sendChat(); else if (e.code === 'Escape') closeChat(); return; }
  if (e.code === 'Enter') { openChat(); e.preventDefault(); return; }
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyH') horn();
  if (e.code === 'KeyP') togglePhone();
  if (e.code === 'KeyR' && decorating >= 0) { decoRot += Math.PI / 8; if (ghost) ghost.rotation.y = decoRot; }
  if (e.code === 'KeyG') { const i = currentHouseIndex(); if (decorating >= 0) exitDecorate(); else if (i >= 0) enterDecorate(i); }
  if (e.code === 'Escape' && decorating >= 0) exitDecorate();
});
addEventListener('keyup', (e) => keys.delete(e.code));

// mobile joystick
let stick = null;
(function setupMobile() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  $('#move-cluster').classList.remove('hidden');
  const base = $('#joystick-base'), knob = $('#joystick-knob'); const s = { x: 0, z: 0 };
  let tid = null, cx = 0, cy = 0;
  const zone = $('#joystick-zone');
  zone.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; tid = t.identifier; const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; }, { passive: true });
  zone.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === tid) { let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy), max = 46; if (d > max) { dx *= max / d; dy *= max / d; } knob.style.left = (32 + dx) + 'px'; knob.style.top = (32 + dy) + 'px'; s.x = dx / max; s.z = -dy / max; } }, { passive: true });
  zone.addEventListener('touchend', () => { tid = null; s.x = s.z = 0; knob.style.left = '32px'; knob.style.top = '32px'; }, { passive: true });
  const look = $('#look-zone'); let lid = null, lx = 0, ly = 0;
  const pinch = new Map(); let pinchDist = 0;   // two-finger pinch = zoom
  const pinchSpan = () => { const [a, b] = [...pinch.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  look.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) pinch.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (pinch.size >= 2) { pinchDist = pinchSpan(); lid = null; }
    else { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; }
  }, { passive: true });
  look.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (pinch.has(t.identifier)) pinch.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (pinch.size >= 2) { const d = pinchSpan(); if (pinchDist && d) orbit.dist = clampDist(orbit.dist * (pinchDist / d)); pinchDist = d; return; }
    for (const t of e.changedTouches) if (t.identifier === lid) { orbit.yaw -= (t.clientX - lx) * 0.006; orbit.pitch += (t.clientY - ly) * 0.006; clampPitch(); lx = t.clientX; ly = t.clientY; }
  }, { passive: true });
  look.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) { pinch.delete(t.identifier); if (t.identifier === lid) lid = null; }
    if (pinch.size < 2) pinchDist = 0;
    if (pinch.size === 1 && lid === null) { const [[id, p]] = [...pinch.entries()]; lid = id; lx = p.x; ly = p.y; }
  }, { passive: true });
  look.addEventListener('touchcancel', () => { pinch.clear(); pinchDist = 0; lid = null; }, { passive: true });
  $('#btn-jump').addEventListener('touchstart', (e) => { e.preventDefault(); keys.add('Space'); }, { passive: false });
  $('#btn-jump').addEventListener('touchend', () => keys.delete('Space'), { passive: false });
  $('#btn-action').addEventListener('touchstart', (e) => { e.preventDefault(); interact(); }, { passive: false });
  $('#btn-chat').addEventListener('touchstart', (e) => { e.preventDefault(); openChat(); }, { passive: false });
  $('#btn-phone-m').addEventListener('touchstart', (e) => { e.preventDefault(); togglePhone(); }, { passive: false });
  $('#btn-horn').addEventListener('touchstart', (e) => { e.preventDefault(); horn(); }, { passive: false });
  stick = s;
})();

function readInput() {
  let x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let z = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  if (stick) { x += stick.x; z += stick.z; }
  return { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) };
}

// ---------------- car system ----------------
const game = { car: null, nearCar: null };
function nearestFreeCar() {
  let best = null, bd = 5 * 5;
  for (const [id, c] of cars) {
    if (c.driver) continue;
    const dx = c.x - player.pos.x, dz = c.z - player.pos.z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = { id, c }; }
  }
  return best;
}
// ---------------- jobs, benches, interact ----------------
const JOBS = [
  { x: -54, z: -36, name: 'Teacher', emoji: '🍎', pay: 45 },
  { x: 54, z: -36, name: 'Doctor', emoji: '🩺', pay: 60 },
  { x: 56, z: 40, name: 'Officer', emoji: '🚓', pay: 55 },
  { x: -56, z: 42, name: 'Cashier', emoji: '🛒', pay: 35 },
  { x: 0, z: -64, name: 'Chef', emoji: '🍔', pay: 40 },
  { x: 66, z: -6, name: 'Mechanic', emoji: '🔧', pay: 50 },
];
const BENCHES = [
  { x: -10, z: 12, ry: 0 }, { x: 10, z: 12, ry: 0 },
  { x: -10, z: -12, ry: Math.PI }, { x: 10, z: -12, ry: Math.PI },
];
function buildBenches() {
  for (const b of BENCHES) {
    const g = new THREE.Group(); g.position.set(b.x, 0, b.z); g.rotation.y = b.ry;
    g.add(box(2.6, 0.25, 0.9, '#8a5a34', 0, 0.5, 0));
    g.add(box(2.6, 0.7, 0.2, '#7a4f2c', 0, 0.9, -0.35));
    g.add(box(0.2, 0.5, 0.9, '#5a3a1c', -1.1, 0.25, 0)); g.add(box(0.2, 0.5, 0.9, '#5a3a1c', 1.1, 0.25, 0));
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }
}
let money = (() => { try { return Math.max(0, +localStorage.getItem('brook.money') || 0); } catch { return 0; } })();
function setMoney(v) { money = Math.max(0, Math.round(v)); try { localStorage.setItem('brook.money', money); } catch {} const el = $('#money-amt'); if (el) el.textContent = money.toLocaleString(); }
let lastJobAt = 0;
let sitting = null;   // bench being sat on

function nearestInteractable() {
  const px = player.pos.x, pz = player.pos.z;
  let best = null, bd = 25;   // 5^2
  for (const [id, c] of cars) { if (c.driver) continue; const d = (c.x - px) ** 2 + (c.z - pz) ** 2; if (d < bd) { bd = d; best = { kind: 'car', id, c, hint: '🚗 Press E to drive' }; } }
  if (!activeJob) for (const j of JOBS) { const d = (j.x - px) ** 2 + (j.z - pz) ** 2; if (d < bd) { bd = d; best = { kind: 'job', job: j, hint: `${j.emoji} Press E to start a ${j.name} shift` }; } }
  for (const b of BENCHES) { const d = (b.x - px) ** 2 + (b.z - pz) ** 2; if (d < 9) { best = { kind: 'bench', bench: b, hint: '🪑 Press E to sit' }; } }
  return best;
}
function interact() {
  // deliver if on a shift and standing on the marker
  if (activeJob && activeJob.target) {
    const dx = activeJob.target.x - player.pos.x, dz = activeJob.target.z - player.pos.z;
    if (dx * dx + dz * dz < 36) { deliverStep(); return; }
  }
  if (game.car) { exitCar(); return; }
  if (sitting) { sitting = null; player.anim = 'idle'; return; }
  const t = nearestInteractable();
  if (!t) return;
  if (t.kind === 'car') enterCar(t.id, t.c);
  else if (t.kind === 'job') { if (!activeJob) startShift(t.job); }
  else if (t.kind === 'bench') sitBench(t.bench);
}
function doJob(job) {
  const now = performance.now();
  if (now - lastJobAt < 1500) return;   // brief shift cooldown
  lastJobAt = now;
  setMoney(money + job.pay);
  sfx.cash();
  addChat('💼', `You worked as a ${job.name} and earned $${job.pay}!`, false);
  startEmote('cheer');
  window.ClaudeBox?.completeChallenge?.('brook-firstjob');
}
function sitBench(b) {
  sitting = b;
  player.pos = { x: b.x - Math.sin(b.ry) * 0.1, y: 0.55, z: b.z - Math.cos(b.ry) * 0.1 };
  player.ry = b.ry + Math.PI; player.vel = { x: 0, y: 0, z: 0 };
  player.anim = 'sit'; sfx.sit();
}
function enterCar(id, c) {
  game.car = { id, x: c.x, z: c.z, ry: c.ry, speed: 0 };
  c.driver = net.id || 'me';
  net.send({ t: 'enter-car', id });
  orbit.yaw = c.ry;
  hint('');
}
function exitCar() {
  const car = game.car; if (!car) return;
  const fx = Math.cos(car.ry), fz = -Math.sin(car.ry);   // step out to the side
  player.pos = { x: car.x + fx * 2.4, y: 0, z: car.z + fz * 2.4 };
  player.ry = car.ry; player.vel = { x: 0, y: 0, z: 0 }; player.grounded = true;
  const c = cars.get(car.id); if (c) c.driver = null;
  net.send({ t: 'exit-car', x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3) });
  game.car = null;
}
function updateCar(dt) {
  const car = game.car; const inp = readInput();
  const throttle = inp.z;               // W forward, S back
  const accel = 26, maxF = 30, maxR = 10;
  car.speed += throttle * accel * dt;
  car.speed *= (1 - 2.2 * dt);          // drag
  car.speed = Math.max(-maxR, Math.min(maxF, car.speed));
  if (Math.abs(car.speed) < 0.2 && !throttle) car.speed = 0;
  const steer = -inp.x;                  // A left / D right
  car.ry += steer * 1.7 * dt * Math.min(1, Math.abs(car.speed) / 6) * Math.sign(car.speed || 1);
  const fx = -Math.sin(car.ry), fz = -Math.cos(car.ry);
  let nx = car.x + fx * car.speed * dt, nz = car.z + fz * car.speed * dt;
  const solved = collideXZ(nx, nz, 1.8);
  if (Math.hypot(solved.x - car.x, solved.z - car.z) < Math.abs(car.speed) * dt * 0.5) car.speed *= 0.3;
  car.x = solved.x; car.z = solved.z;
  const mesh = cars.get(car.id).mesh; mesh.position.set(car.x, 0, car.z); mesh.rotation.y = car.ry;
  // player rides inside
  player.pos = { x: car.x, y: 0, z: car.z }; player.ry = car.ry;
  if (myAvatar.group) { myAvatar.group.position.set(car.x, 0.6, car.z); myAvatar.group.rotation.y = car.ry; myAvatar.ctrl.setAnim('sit'); }
  // camera trails behind the car
  orbit.yaw += (car.ry - orbit.yaw) * Math.min(1, dt * 4);
}

// ---------------- walking ----------------
function updateWalk(dt) {
  const inp = readInput();
  const moving = Math.abs(inp.x) > 0.05 || Math.abs(inp.z) > 0.05;
  if (moving) { sitting = null; emoteAnim = null; emoteUntil = 0; }
  if (sitting) {
    player.anim = 'sit';
    if (myAvatar.group) { myAvatar.group.position.set(player.pos.x, 0.55, player.pos.z); myAvatar.group.rotation.y = player.ry; myAvatar.ctrl.setAnim('sit'); }
    return;
  }
  if (emoteAnim && performance.now() < emoteUntil) {
    player.anim = emoteAnim;
    if (myAvatar.group) { myAvatar.group.position.set(player.pos.x, player.pos.y, player.pos.z); myAvatar.group.rotation.y = player.ry; myAvatar.ctrl.setAnim(emoteAnim); }
    return;
  }
  if (emoteAnim) emoteAnim = null;
  const fx = -Math.sin(orbit.yaw), fz = -Math.cos(orbit.yaw);
  const rx = Math.cos(orbit.yaw), rz = -Math.sin(orbit.yaw);
  let wx = fx * inp.z + rx * inp.x, wz = fz * inp.z + rz * inp.x;
  const wl = Math.hypot(wx, wz) || 1; wx /= wl; wz /= wl;
  const mag = Math.min(1, Math.hypot(inp.x, inp.z));
  const run = keys.has('ShiftLeft') || mag > 0.85;
  const speed = (run ? RUN : WALK) * mag;
  if (moving) player.ry = Math.atan2(wx, wz);
  player.vel.x = wx * speed; player.vel.z = wz * speed;
  if (keys.has('Space') && player.grounded) { player.vel.y = JUMP; player.grounded = false; }
  player.vel.y -= G * dt;
  const nx = player.pos.x + player.vel.x * dt, nz = player.pos.z + player.vel.z * dt;
  const solved = collideXZ(nx, nz);
  player.pos.x = solved.x; player.pos.z = solved.z;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.vel.y = 0; player.grounded = true; }
  // anim
  if (!player.grounded) player.anim = player.vel.y > 0 ? 'jump' : 'fall';
  else if (moving) player.anim = run ? 'run' : 'walk';
  else player.anim = 'idle';
  if (myAvatar.group) {
    myAvatar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
    myAvatar.group.rotation.y = player.ry;
    myAvatar.ctrl.setAnim(player.anim);
    myAvatar.ctrl.moveSpeed = Math.hypot(player.vel.x, player.vel.z);
  }
}

// ---------------- remotes ----------------
const remotes = new Map();
function nameSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#eaf6ff'; x.strokeStyle = 'rgba(0,30,50,.85)'; x.lineWidth = 5;
  x.strokeText(name, 128, 40); x.fillText(name, 128, 40);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(3.2, 0.8, 1); s.position.y = 2.7; return s;
}
function makeRemote(d) {
  const ctrl = makeAvatar(d.avatar || {});
  ctrl.group.add(nameSprite(d.name));
  scene.add(ctrl.group);
  const rec = { ctrl, group: ctrl.group, interp: new InterpBuffer(), data: d };
  remotes.set(d.id, rec); return rec;
}

// ---------------- chat ----------------
let chatting = false;
function openChat() { chatting = true; $('#chat-row').classList.remove('hidden'); $('#chat-input').focus(); document.exitPointerLock?.(); }
function closeChat() { chatting = false; $('#chat-input').blur(); $('#chat-row').classList.add('hidden'); }
function sendChat() { const v = $('#chat-input').value.trim(); if (v) net.send({ t: 'chat', text: v }); $('#chat-input').value = ''; closeChat(); }
function addChat(name, text, self) {
  const log = $('#chat-log'); const line = document.createElement('div'); line.className = 'chat-line';
  const b = document.createElement('b'); b.textContent = name + ': '; if (self) b.style.color = '#ffd86b';
  const s = document.createElement('span'); s.textContent = text;
  line.append(b, s); log.appendChild(line);
  while (log.children.length > 30) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
$('#chat-send')?.addEventListener('click', sendChat);
$('#chat-input')?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Enter') sendChat(); else if (e.code === 'Escape') closeChat(); });

function hint(t) { const el = $('#action-hint'); if (!t) el.classList.add('hidden'); else { el.textContent = t; el.classList.remove('hidden'); } }

// ---------------- net ----------------
const net = new Net();
net.on('welcome', (msg) => {
  for (const d of msg.players) makeRemote(d);
  for (const cd of (msg.cars || [])) { const c = cars.get(cd.id); if (c) c.driver = cd.driver; }
  $('#loading').classList.add('hidden'); $('#hud').classList.remove('hidden');
});
net.on('player.join', (m) => { if (m.player.id !== net.id && !remotes.has(m.player.id)) makeRemote(m.player); });
net.on('player.leave', (m) => { const r = remotes.get(m.id); if (r) { scene.remove(r.group); remotes.delete(m.id); } });
net.on('snapshot', (m) => {
  for (const row of m.players) { const [id, x, y, z, ry, anim] = row; if (id === net.id) continue; const r = remotes.get(id); if (r) r.interp.push([x, y, z, ry, anim]); }
  for (const row of (m.cars || [])) { const [id, x, z, ry, driven] = row; const c = cars.get(id); if (!c) continue; c.driver = driven ? (c.driver || 'x') : null; if (!(game.car && game.car.id === id)) c.interp.push([x, z, ry]); }
});
net.on('car.driver', (m) => { const c = cars.get(m.id); if (c) c.driver = m.driver; });
net.on('chat', (m) => addChat(m.name, m.text, m.id === net.id));
net.on('toast', (m) => addChat('System', m.text, false));

// ---------------- loop ----------------
let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (myAvatar.ctrl) {
    if (game.car) updateCar(dt); else updateWalk(dt);
    myAvatar.ctrl.update(dt);
    // "Decorate" button when standing inside a house
    const hi = currentHouseIndex();
    $('#deco-open').classList.toggle('hidden', !(hi >= 0 && decorating < 0 && !game.car));
    // interact hint (delivery takes priority when on the marker)
    let near = false;
    if (activeJob && activeJob.target) { const dx = activeJob.target.x - player.pos.x, dz = activeJob.target.z - player.pos.z; if (dx * dx + dz * dz < 36) { hint('📦 Press E to deliver here'); near = true; } }
    if (!near) {
      if (game.car) hint('🚗 Press E to exit');
      else if (sitting) hint('🪑 Press E to stand');
      else if (decorating < 0) { const t = nearestInteractable(); hint(t ? t.hint : ''); }
      else hint('');
    }
  }
  if (activeJob && jobMarker && jobMarker.visible) {
    jobMarker.rotation.y += dt * 2; jobMarker.children[0].position.y = 3 + Math.sin(performance.now() / 300) * 0.3;
    const dx = activeJob.target.x - player.pos.x, dz = activeJob.target.z - player.pos.z;
    $('#job-task').textContent = `Deliver to ${activeJob.target.name} (${activeJob.count}/5) · ${Math.round(Math.hypot(dx, dz))}m away · $${activeJob.earned}`;
  }
  updateDayNight(dt);
  updateNPCs(dt);
  // remotes
  for (const [, r] of remotes) {
    const s = r.interp.sample([3]);
    if (s) { r.group.position.set(s[0], s[1], s[2]); r.group.rotation.y = s[3]; r.ctrl.setAnim(s[4]); r.ctrl.moveSpeed = s[4] === 'run' ? RUN : s[4] === 'walk' ? WALK : 0; }
    r.ctrl.update(dt);
  }
  // other cars (not mine)
  for (const [id, c] of cars) {
    if (game.car && game.car.id === id) continue;
    const s = c.interp.sample([2]);
    if (s) { c.mesh.position.set(s[0], 0, s[1]); c.mesh.rotation.y = s[2]; }
  }
  updateCamera();
  // first-person zoom: fade MY avatar out as the camera zooms in (on foot).
  // In a car the camera dist is fixed at 12, so this restores the seated avatar.
  if (myAvatar.group) fpFade(myAvatar.group, game.car ? 12 : orbit.dist);
  renderer.render(scene, camera);
}

// ---------------- emotes ----------------
let emoteUntil = 0, emoteAnim = null;
const EMOTES = [
  { id: 'dance', label: 'Dance', emoji: '🕺', clip: 'dance', hold: true },
  { id: 'sit', label: 'Sit', emoji: '🧎', clip: 'sit', hold: true },
  { id: 'cheer', label: 'Cheer', emoji: '🙌', clip: 'jump', hold: false, dur: 900 },
  { id: 'faint', label: 'Faint', emoji: '😵', clip: 'death', hold: false, dur: 1600 },
  { id: 'wave', label: 'Wave', emoji: '👋', clip: 'idle', hold: false, dur: 700 },
  { id: 'stop', label: 'Stop', emoji: '🛑', clip: null, hold: false, dur: 0 },
];
function startEmote(id) {
  const e = EMOTES.find((x) => x.id === id); if (!e) return;
  if (id === 'stop' || !e.clip) { emoteAnim = null; emoteUntil = 0; return; }
  emoteAnim = e.clip; emoteUntil = e.hold ? Infinity : performance.now() + (e.dur || 800);
  sfx.emote();
}

// ---------------- phone ----------------
let phoneTab = 'emotes';
function togglePhone() { const p = $('#phone'); if (p.classList.contains('hidden')) openPhone(); else p.classList.add('hidden'); }
function openPhone() { $('#phone').classList.remove('hidden'); renderPhone(); sfx.ui(); }
function renderPhone() {
  document.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.tab === phoneTab));
  const body = $('#phone-body'); const title = $('#phone-title');
  if (phoneTab === 'emotes') {
    title.textContent = 'Emotes';
    body.innerHTML = `<div class="emote-grid">${EMOTES.map((e) => `<button class="emote-btn" data-e="${e.id}"><span>${e.emoji}</span>${e.label}</button>`).join('')}</div>`;
    body.querySelectorAll('.emote-btn').forEach((b) => b.addEventListener('click', () => startEmote(b.dataset.e)));
  } else if (phoneTab === 'teleport') {
    title.textContent = 'Teleport';
    body.innerHTML = `<div class="tp-list">${TELEPORTS.map((t) => `<button class="tp-btn" data-t="${t.name}"><span>${t.emoji}</span>${t.name}</button>`).join('')}</div>`;
    body.querySelectorAll('.tp-btn').forEach((b) => b.addEventListener('click', () => teleportTo(b.dataset.t)));
  } else if (phoneTab === 'music') {
    title.textContent = 'Radio';
    const on = radioIsOn();
    body.innerHTML = `<button class="music-toggle ${on ? '' : 'off'}" id="music-btn">${on ? '⏸ Stop Radio' : '▶ Play Radio'}</button><p class="info-p">Chill town radio — a mellow synth loop to vibe to while you drive around Brooktown.</p>`;
    $('#music-btn').addEventListener('click', () => { toggleRadio(); sfx.ui(); renderPhone(); });
  } else {
    title.textContent = 'Brooktown';
    body.innerHTML = `<p class="info-p"><b>Welcome to Brooktown!</b><br><br>🚶 <b>WASD</b> to walk, <b>Shift</b> run, <b>Space</b> jump.<br>🚗 <b>E</b> near a car to drive, work a job, or sit.<br>📢 <b>H</b> to honk.<br>💬 <b>Enter</b> to chat.<br>📱 <b>P</b> for this phone.<br><br>Work jobs to earn 💵, then show off your ride. Have fun & roleplay!</p>`;
  }
}
document.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => { phoneTab = b.dataset.tab; renderPhone(); sfx.ui(); }));
$('#phone-close')?.addEventListener('click', () => $('#phone').classList.add('hidden'));
$('#btn-phone')?.addEventListener('click', togglePhone);
$('#btn-horn2')?.addEventListener('click', () => horn());

// ---------------- teleport ----------------
const TELEPORTS = [
  { name: 'Town Plaza', emoji: '⛲', x: 0, z: 16 },
  { name: 'School', emoji: '🏫', x: -54, z: -34 },
  { name: 'Hospital', emoji: '🏥', x: 54, z: -34 },
  { name: 'Police', emoji: '🚓', x: 56, z: 40 },
  { name: 'Market', emoji: '🛒', x: -56, z: 40 },
  { name: 'Diner', emoji: '🍔', x: 0, z: -62 },
];
function teleportTo(name) {
  const t = TELEPORTS.find((x) => x.name === name); if (!t) return;
  if (game.car) exitCar();
  sitting = null; emoteAnim = null;
  player.pos = { x: t.x, y: 0, z: t.z }; player.vel = { x: 0, y: 0, z: 0 };
  $('#phone').classList.add('hidden'); sfx.enter();
}

// ---------------- horn ----------------
function horn() { sfx.horn(); if (net) net.send({ t: 'emote', emote: 'horn' }); }

// ---------------- day / night ----------------
const DAY_LEN = 300;   // seconds for a full day
let dayT = 0.35;       // start mid-morning (0=midnight, .5=noon)
const SKY_DAY = new THREE.Color('#a9d8f5'), SKY_DUSK = new THREE.Color('#f0a86a'), SKY_NIGHT = new THREE.Color('#0b1330');
function updateDayNight(dt) {
  dayT = (dayT + dt / DAY_LEN) % 1;
  const sunA = (dayT - 0.25) * Math.PI * 2;          // noon at top
  const height = Math.sin(sunA);                       // -1..1
  sun.position.set(Math.cos(sunA) * 120, Math.max(-20, height * 140), 40);
  sun.target.position.set(player.pos.x, 0, player.pos.z);
  const day = Math.max(0, height);                     // 0 at/under horizon, 1 at noon
  sun.intensity = 0.15 + day * 1.5;
  hemi.intensity = 0.35 + day * 0.9;
  // sky color: night → dusk → day
  const sky = SKY_NIGHT.clone();
  if (height > 0.15) sky.copy(SKY_NIGHT).lerp(SKY_DAY, Math.min(1, (height - 0.15) / 0.4));
  else if (height > -0.15) sky.copy(SKY_NIGHT).lerp(SKY_DUSK, (height + 0.15) / 0.3);
  scene.background.copy(sky); scene.fog.color.copy(sky);
  // HUD clock
  const mins = Math.floor(dayT * 24 * 60); const hh = Math.floor(mins / 60), mm = mins % 60;
  const el = $('#clock-time'); if (el) el.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  for (const h of lampHeads) h.material.opacity = day > 0.25 ? 0.15 : 1;
}

// ---------------- NPC townsfolk (client-side ambiance) ----------------
const npcs = [];
const NPC_NAMES = ['Max', 'Ivy', 'Leo', 'Zoe', 'Sam', 'Mia', 'Otto', 'Nia'];
function spawnNPCs() {
  for (let i = 0; i < 7; i++) {
    const ctrl = makeAvatar({ body: i % 2 ? 'girl' : 'boy', skin: ['#f5d3b3', '#c98e62', '#8a5a3a'][i % 3], shirtColor: ['#e0503c', '#3a7bd5', '#4ade80', '#ffcf5c', '#9b6bff'][i % 5] });
    ctrl.group.add(nameSprite(NPC_NAMES[i]));
    scene.add(ctrl.group);
    const p = { x: (Math.random() * 2 - 1) * 80, z: (Math.random() * 2 - 1) * 80 };
    npcs.push({ ctrl, x: p.x, z: p.z, ry: 0, tx: p.x, tz: p.z, wait: 0 });
  }
}
function updateNPCs(dt) {
  for (const n of npcs) {
    const dx = n.tx - n.x, dz = n.tz - n.z, d = Math.hypot(dx, dz);
    if (d < 1.2) {
      n.wait -= dt;
      if (n.wait <= 0) { n.tx = (Math.random() * 2 - 1) * 90; n.tz = (Math.random() * 2 - 1) * 90; n.wait = 1 + Math.random() * 3; }
      n.ctrl.setAnim('idle'); n.ctrl.moveSpeed = 0;
    } else {
      const ux = dx / d, uz = dz / d, sp = 3.2;
      const nx = n.x + ux * sp * dt, nz = n.z + uz * sp * dt;
      const s = collideXZ(nx, nz, 0.5);
      if (Math.hypot(s.x - n.x, s.z - n.z) < sp * dt * 0.4) { n.tx = (Math.random() * 2 - 1) * 90; n.tz = (Math.random() * 2 - 1) * 90; }
      n.x = s.x; n.z = s.z; n.ry = Math.atan2(ux, uz);
      n.ctrl.setAnim('walk'); n.ctrl.moveSpeed = sp;
    }
    n.ctrl.group.position.set(n.x, 0, n.z); n.ctrl.group.rotation.y = n.ry; n.ctrl.update(dt);
  }
}

// ================= HOUSE DECORATING =================
const FURNITURE = [
  { type: 'bed', emoji: '🛏️', label: 'Bed' }, { type: 'sofa', emoji: '🛋️', label: 'Sofa' },
  { type: 'table', emoji: '🍽️', label: 'Table' }, { type: 'chair', emoji: '🪑', label: 'Chair' },
  { type: 'tv', emoji: '📺', label: 'TV' }, { type: 'lamp', emoji: '💡', label: 'Lamp' },
  { type: 'rug', emoji: '🟫', label: 'Rug' }, { type: 'plant', emoji: '🪴', label: 'Plant' },
  { type: 'shelf', emoji: '📚', label: 'Shelf' }, { type: 'fridge', emoji: '🧊', label: 'Fridge' },
  { type: 'stove', emoji: '🍳', label: 'Stove' }, { type: 'piano', emoji: '🎹', label: 'Piano' },
];
function makeFurniture(type) {
  const g = new THREE.Group();
  const add = (w, h, d, c, x, y, z) => g.add(box(w, h, d, c, x, y, z));
  switch (type) {
    case 'bed': add(1.7, 0.4, 2.3, '#6b4a2c', 0, 0.3, 0); add(1.55, 0.28, 2.1, '#dfe6ee', 0, 0.6, 0.05); add(1.4, 0.22, 0.5, '#ff9ab0', 0, 0.75, -0.8); break;
    case 'sofa': add(2, 0.45, 0.9, '#4a6ea0', 0, 0.35, 0); add(2, 0.6, 0.22, '#3a5a88', 0, 0.7, -0.34); add(0.24, 0.55, 0.9, '#3a5a88', -0.88, 0.55, 0); add(0.24, 0.55, 0.9, '#3a5a88', 0.88, 0.55, 0); break;
    case 'table': add(1.5, 0.14, 0.95, '#8a5a34', 0, 0.75, 0); for (const [x, z] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) add(0.12, 0.72, 0.12, '#6b4425', x, 0.36, z); break;
    case 'chair': add(0.55, 0.1, 0.55, '#a06a3a', 0, 0.5, 0); add(0.55, 0.55, 0.12, '#8a5530', 0, 0.78, -0.22); for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) add(0.09, 0.5, 0.09, '#6b4425', x, 0.25, z); break;
    case 'tv': add(1.5, 0.5, 0.45, '#4a3a2c', 0, 0.4, 0); add(1.5, 0.9, 0.12, '#101318', 0, 1.15, 0.02); g.add(box(1.3, 0.72, 0.05, '#2a6bd0', 0, 1.15, 0.1)); break;
    case 'lamp': add(0.18, 1.6, 0.18, '#3a3e46', 0, 0.8, 0); { const s = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.5, 14), new THREE.MeshBasicMaterial({ color: '#ffe6a0' })); s.position.y = 1.75; g.add(s); } break;
    case 'rug': add(2.6, 0.05, 1.8, '#b5495b', 0, 0.06, 0); add(2.2, 0.06, 1.4, '#d8737f', 0, 0.07, 0); break;
    case 'plant': add(0.5, 0.5, 0.5, '#b5744a', 0, 0.25, 0); { const f = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), lam('#3f8a44')); f.position.y = 0.9; g.add(f); } break;
    case 'shelf': add(1.4, 2, 0.4, '#6b4425', 0, 1, 0); for (const y of [0.5, 1, 1.5]) { add(1.3, 0.06, 0.36, '#4a2f18', 0, y, 0.02); add(0.9, 0.3, 0.28, ['#c74b4b', '#4a8a3a', '#3a6bd0'][Math.floor(y) % 3], -0.1, y + 0.2, 0.02); } break;
    case 'fridge': add(0.95, 1.9, 0.85, '#dfe6ee', 0, 0.95, 0); add(0.1, 0.5, 0.1, '#9aa4b0', 0.38, 1.2, 0.45); break;
    case 'stove': add(0.95, 0.9, 0.85, '#3a3e46', 0, 0.45, 0); add(0.95, 0.08, 0.85, '#1a1c22', 0, 0.92, 0); for (const [x, z] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) { const b = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), lam('#111')); b.rotation.x = -Math.PI / 2; b.position.set(x, 0.97, z); g.add(b); } break;
    case 'piano': add(1.6, 1.1, 0.7, '#141418', 0, 0.55, 0); add(1.5, 0.12, 0.35, '#f4f4f4', 0, 0.8, 0.35); break;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const houseList = BUILDINGS.filter((b) => b.kind === 'house');
const houses = houseList.map((spec) => { const group = new THREE.Group(); scene.add(group); return { spec, group, layout: [] }; });
function currentHouseIndex() {
  const px = player.pos.x, pz = player.pos.z;
  for (let i = 0; i < houses.length; i++) { const b = houses[i].spec; if (Math.abs(px - b.x) < b.w / 2 - 0.4 && Math.abs(pz - b.z) < b.d / 2 - 0.4) return i; }
  return -1;
}
function addFurniture(hi, type, x, z, ry, save = true) {
  const m = makeFurniture(type); m.position.set(x, 0, z); m.rotation.y = ry; m.userData = { type, x, z, ry };
  houses[hi].group.add(m); houses[hi].layout.push(m);
  if (save) saveHouse(hi);
}
function saveHouse(hi) {
  try { localStorage.setItem('brook.house.' + hi, JSON.stringify(houses[hi].layout.map((m) => m.userData))); } catch {}
}
function loadHouses() {
  houses.forEach((h, hi) => { try { const arr = JSON.parse(localStorage.getItem('brook.house.' + hi) || '[]'); for (const it of arr) addFurniture(hi, it.type, it.x, it.z, it.ry, false); } catch {} });
}

let decorating = -1, decoType = null, decoRemove = false, decoRot = 0, ghost = null;
const rc = new THREE.Raycaster();
function floorPoint(cx, cy) {
  rc.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  const pt = new THREE.Vector3();
  if (!rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1), pt)) return null;
  const b = houses[decorating].spec;
  pt.x = Math.max(b.x - b.w / 2 + 0.6, Math.min(b.x + b.w / 2 - 0.6, pt.x));
  pt.z = Math.max(b.z - b.d / 2 + 0.6, Math.min(b.z + b.d / 2 - 0.6, pt.z));
  return pt;
}
function makeGhost(type) {
  clearGhost();
  ghost = makeFurniture(type);
  ghost.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.5; o.castShadow = false; } });
  scene.add(ghost);
}
function clearGhost() { if (ghost) { scene.remove(ghost); ghost = null; } }
function renderPalette() {
  const host = $('#deco-palette'); host.innerHTML = '';
  for (const f of FURNITURE) {
    const b = document.createElement('button');
    b.className = 'deco-item' + (decoType === f.type ? ' sel' : '');
    b.innerHTML = `${f.emoji}<small>${f.label}</small>`;
    b.addEventListener('click', () => { decoRemove = false; decoType = f.type; decoRot = 0; makeGhost(f.type); $('#deco-remove').classList.remove('on'); renderPalette(); });
    host.appendChild(b);
  }
}
function enterDecorate(hi) {
  decorating = hi; decoType = null; decoRemove = false; decoRot = 0;
  $('#decorate-bar').classList.remove('hidden'); $('#deco-open').classList.add('hidden');
  document.exitPointerLock?.(); renderPalette(); sfx.ui();
}
function exitDecorate() { saveHouse(decorating); decorating = -1; decoType = null; clearGhost(); $('#decorate-bar').classList.add('hidden'); sfx.ui(); }
function decoPlaceAt(cx, cy) {
  if (decorating < 0) return;
  if (decoRemove) {
    rc.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
    const hits = rc.intersectObjects(houses[decorating].group.children, true);
    if (hits.length) { let o = hits[0].object; while (o.parent && o.parent !== houses[decorating].group) o = o.parent; houses[decorating].group.remove(o); houses[decorating].layout = houses[decorating].layout.filter((m) => m !== o); saveHouse(decorating); sfx.ui(); }
    return;
  }
  if (!decoType) return;
  const pt = floorPoint(cx, cy); if (!pt) return;
  addFurniture(decorating, decoType, pt.x, pt.z, decoRot); sfx.enter();
}
$('#deco-open')?.addEventListener('click', () => { const i = currentHouseIndex(); if (i >= 0) enterDecorate(i); });
$('#deco-done')?.addEventListener('click', exitDecorate);
$('#deco-remove')?.addEventListener('click', () => { decoRemove = !decoRemove; decoType = null; clearGhost(); $('#deco-remove').classList.toggle('on', decoRemove); renderPalette(); });
$('#deco-clear')?.addEventListener('click', () => { if (decorating < 0) return; const h = houses[decorating]; for (const m of h.layout) h.group.remove(m); h.layout = []; saveHouse(decorating); sfx.ui(); });

// ================= INTERACTIVE JOBS (delivery shifts) =================
let activeJob = null, jobMarker = null;
function makeMarker() {
  const g = new THREE.Group();
  const dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshBasicMaterial({ color: '#ffd24a' }));
  dia.position.y = 3; g.add(dia);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.35 }));
  beam.position.y = 3; g.add(beam);
  scene.add(g); return g;
}
const DROPS = [
  { name: 'the School', x: -54, z: -34 }, { name: 'the Hospital', x: 54, z: -34 },
  { name: 'the Police Station', x: 56, z: 40 }, { name: 'the Market', x: -56, z: 40 },
  { name: 'the Diner', x: 0, z: -62 }, { name: 'the Gas Station', x: 66, z: -8 },
  { name: 'a house on Oak St', x: -24, z: -20 }, { name: 'a house on Pine St', x: 24, z: 30 },
  { name: 'a house on Elm St', x: -78, z: 18 }, { name: 'the Town Plaza', x: 0, z: 16 },
];
function startShift(job) {
  activeJob = { name: job.name, emoji: job.emoji, pay: job.pay, earned: 0, count: 0, target: null };
  if (!jobMarker) jobMarker = makeMarker();
  jobMarker.visible = true;
  newDrop();
  $('#job-hud').classList.remove('hidden');
  addChat('💼', `Shift started as a ${job.name}! Head to the glowing marker to deliver.`, false);
  updateJobHud();
}
function newDrop() {
  let i = Math.floor(Math.random() * DROPS.length);
  if (activeJob.target && DROPS[i].name === activeJob.target.name) i = (i + 1) % DROPS.length;
  activeJob.target = DROPS[i]; jobMarker.position.set(DROPS[i].x, 0, DROPS[i].z);
}
function deliverStep() {
  activeJob.count++; activeJob.earned += activeJob.pay; setMoney(money + activeJob.pay);
  sfx.cash(); startEmote('cheer');
  addChat('💼', `Delivered to ${activeJob.target.name}! +$${activeJob.pay}`, false);
  window.ClaudeBox?.completeChallenge?.('brook-firstjob');
  if (activeJob.count >= 5) { endShift(true); return; }
  newDrop(); updateJobHud();
}
function endShift(done) {
  if (activeJob) addChat('💼', done ? `Shift complete! You earned $${activeJob.earned} as a ${activeJob.name}. 🎉` : 'Shift ended.', false);
  activeJob = null; if (jobMarker) jobMarker.visible = false; $('#job-hud').classList.add('hidden');
}
function updateJobHud() {
  if (!activeJob) return;
  $('#job-title').textContent = `${activeJob.emoji} ${activeJob.name}`;
  $('#job-task').textContent = `Deliver to ${activeJob.target.name} (${activeJob.count}/5) · earned $${activeJob.earned}`;
}
$('#job-end')?.addEventListener('click', () => endShift(false));

// ---------------- boot ----------------
(async function boot() {
  status('Waking the town…');
  let identity;
  try { identity = await loadIdentity(); } catch { return; }
  await preloadAvatars(['boy', 'girl']);
  myAvatar.ctrl = makeAvatar(identity.avatar || {});
  myAvatar.group = myAvatar.ctrl.group; scene.add(myAvatar.group);
  camera.position.set(SPAWN.x, 8, SPAWN.z + 12);
  buildBenches(); spawnNPCs(); setMoney(money); loadHouses();
  net.connect();
  net.join({ name: identity.name, avatar: identity.avatar, code: localStorage.getItem('claudebox.code') || '' });
  net.startMovementStream(() => game.car
    ? { t: 'car-move', id: game.car.id, x: +game.car.x.toFixed(2), z: +game.car.z.toFixed(2), ry: +game.car.ry.toFixed(3) }
    : { t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim });
  requestAnimationFrame(frame);
  window.__brook = { net, player, game, cars, remotes, scene, camera };
})();
