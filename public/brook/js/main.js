// Brooktown RP — an original town roleplay game for ClaudeBox.
// Third-person multiplayer: walk the town, drive cars, enter houses, chat.
import * as THREE from 'three';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import { SPAWN, CARS, BUILDINGS, ROADS, GROUND } from '/shared/brook/town.js';

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

scene.add(new THREE.HemisphereLight('#eaf4ff', '#6a7d55', 1.05));
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
function makeLamp(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(box(0.3, 5, 0.3, '#2a2e36', 0, 2.5, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe6a0' }));
  head.position.y = 5; g.add(head);
  scene.add(g);
}
function buildProps() {
  // trees around the edges + between blocks (kept off roads)
  const spots = [[-90, -70], [-90, 70], [90, -70], [90, 70], [-40, 20], [40, 20], [-40, -18], [40, -18], [-100, 0], [100, 0], [0, 90], [0, -100], [-70, -78], [70, 78]];
  for (const [x, z] of spots) makeTree(x, z);
  for (let x = -80; x <= 80; x += 40) { makeLamp(x, 10); makeLamp(x, -10); }
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
canvas.addEventListener('click', () => { if (!locked && !typing() && !('ontouchstart' in window)) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
canvas.addEventListener('mousedown', (e) => { if (!locked) { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', (e) => {
  if (locked) { orbit.yaw -= e.movementX * 0.0024; orbit.pitch += e.movementY * 0.0024; clampPitch(); return; }
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastX) * 0.005; orbit.pitch += (e.clientY - lastY) * 0.005; clampPitch();
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.max(4, Math.min(20, orbit.dist + e.deltaY * 0.01)); }, { passive: false });
addEventListener('keydown', (e) => {
  if (typing()) { if (e.code === 'Enter') sendChat(); else if (e.code === 'Escape') closeChat(); return; }
  if (e.code === 'Enter') { openChat(); e.preventDefault(); return; }
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyE') toggleCar();
  if (e.code === 'Space') keys.add('Space');
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
  look.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; }, { passive: true });
  look.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === lid) { orbit.yaw -= (t.clientX - lx) * 0.006; orbit.pitch += (t.clientY - ly) * 0.006; clampPitch(); lx = t.clientX; ly = t.clientY; } }, { passive: true });
  look.addEventListener('touchend', () => lid = null, { passive: true });
  $('#btn-jump').addEventListener('touchstart', (e) => { e.preventDefault(); keys.add('Space'); }, { passive: false });
  $('#btn-jump').addEventListener('touchend', () => keys.delete('Space'), { passive: false });
  $('#btn-action').addEventListener('touchstart', (e) => { e.preventDefault(); toggleCar(); }, { passive: false });
  $('#btn-chat').addEventListener('touchstart', (e) => { e.preventDefault(); openChat(); }, { passive: false });
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
function toggleCar() {
  if (game.car) { exitCar(); return; }
  const n = nearestFreeCar();
  if (n) enterCar(n.id, n.c);
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
    // nearby-car hint
    if (!game.car) { const n = nearestFreeCar(); hint(n ? '🚗 Press E to drive' : ''); }
    sun.position.set(player.pos.x + 60, 120, player.pos.z + 40); sun.target.position.set(player.pos.x, 0, player.pos.z);
  }
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
  renderer.render(scene, camera);
}

// ---------------- boot ----------------
(async function boot() {
  status('Waking the town…');
  let identity;
  try { identity = await loadIdentity(); } catch { return; }
  await preloadAvatars(['boy', 'girl']);
  myAvatar.ctrl = makeAvatar(identity.avatar || {});
  myAvatar.group = myAvatar.ctrl.group; scene.add(myAvatar.group);
  camera.position.set(SPAWN.x, 8, SPAWN.z + 12);
  net.connect();
  net.join({ name: identity.name, avatar: identity.avatar, code: localStorage.getItem('claudebox.code') || '' });
  net.startMovementStream(() => game.car
    ? { t: 'car-move', id: game.car.id, x: +game.car.x.toFixed(2), z: +game.car.z.toFixed(2), ry: +game.car.ry.toFixed(3) }
    : { t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim });
  requestAnimationFrame(frame);
  window.__brook = { net, player, game, cars, remotes, scene, camera };
})();
