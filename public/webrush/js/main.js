// Web Rush — Spider-style web-swinging across a city, with crime-scene combat.
import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import { GROUND, SPAWN, BUILDINGS, CRIMES, MAX_HP, GRAVITY, WEB_RANGE } from '/shared/webrush/city.js';

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
scene.background = new THREE.Color(0x9fc3e8);
scene.fog = new THREE.Fog(0x9fc3e8, 260, 620);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 2000);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xdcecff, 0x5a6478, 1.4));
scene.add(new THREE.AmbientLight(0x8a94aa, 0.35));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.3); sun.position.set(120, 240, 80); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -180; sun.shadow.camera.right = 180; sun.shadow.camera.top = 180; sun.shadow.camera.bottom = -180; sun.shadow.camera.far = 700;
scene.add(sun);

// ---------------- city ----------------
const streets = new THREE.Mesh(new THREE.PlaneGeometry(GROUND * 2, GROUND * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 1 }));
streets.receiveShadow = true; scene.add(streets);
const grid = new THREE.GridHelper(GROUND * 2, 130, 0x444a55, 0x363b44); grid.position.y = 0.03; grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);

const buildingGroup = new THREE.Group(); scene.add(buildingGroup);
const winTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#7a8498'; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = Math.random() < 0.5 ? '#dcefff' : '#556074'; x.fillRect(i * 8 + 1.5, j * 8 + 1.5, 5, 5); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
for (const b of BUILDINGS) {
  const tex = winTex.clone(); tex.needsUpdate = true; tex.repeat.set(Math.max(1, b.w / 6), Math.max(1, b.h / 6));
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.85, map: tex }));
  m.position.set(b.x, b.h / 2, b.z); m.castShadow = true; m.receiveShadow = true;
  m.userData.b = b; buildingGroup.add(m);
  // roof cap for a cleaner top
  const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.6, 1.2, b.d + 0.6), new THREE.MeshStandardMaterial({ color: 0x2f3541 })); cap.position.set(b.x, b.h + 0.6, b.z); buildingGroup.add(cap);
}

// ---- rooftop props (water towers / antennas / AC units) ----
const propGroup = new THREE.Group(); scene.add(propGroup);
const blinkTips = [];
BUILDINGS.forEach((b, i) => {
  if (b.h < 45) return;
  if (i % 3 === 0) {                                   // water tower
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.4, 10), new THREE.MeshStandardMaterial({ color: 0x7a5a40, roughness: 0.9 }));
    tank.position.y = 3.1; tank.castShadow = true; g.add(tank);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0x5a4230 }));
    cone.position.y = 5.6; g.add(cone);
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 5), new THREE.MeshStandardMaterial({ color: 0x3a3f47 })); leg.position.set(Math.cos(a) * 1.6, 0.8, Math.sin(a) * 1.6); g.add(leg); }
    g.position.set(b.x + b.w * 0.22, b.h, b.z - b.d * 0.2); propGroup.add(g);
  } else if (i % 3 === 1) {                            // antenna with a blinking beacon
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 9, 6), new THREE.MeshStandardMaterial({ color: 0x9aa2b0 }));
    mast.position.set(b.x - b.w * 0.25, b.h + 4.5, b.z + b.d * 0.22); propGroup.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true }));
    tip.position.set(b.x - b.w * 0.25, b.h + 9.2, b.z + b.d * 0.22); propGroup.add(tip); blinkTips.push(tip);
  } else {                                             // AC boxes
    for (let k = 0; k < 2; k++) { const ac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 1.8), new THREE.MeshStandardMaterial({ color: 0x8b93a5, roughness: 0.8 })); ac.position.set(b.x + (k ? -1 : 1) * b.w * 0.18, b.h + 0.6, b.z + (k ? 1 : -1) * b.d * 0.15); ac.castShadow = true; propGroup.add(ac); }
  }
});

// static geometry never moves — freeze matrices (saves per-frame work on ~900 objects)
for (const g of [buildingGroup, propGroup]) g.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
streets.updateMatrix(); streets.matrixAutoUpdate = false; grid.updateMatrix(); grid.matrixAutoUpdate = false;

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
addEventListener('keydown', (e) => { if (chatOpen) return; keys.add(e.code); if (e.code === 'KeyF') webStun(); });
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', (e) => {
  if (!isTouch && document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) punch();
});
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

// ---------------- collision vs buildings ----------------
function collide() {
  player.wall = null;
  const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
  for (const b of BUILDINGS) {
    if (Math.abs(px - b.x) > b.w / 2 + PR + 2 || Math.abs(pz - b.z) > b.d / 2 + PR + 2) continue;
    const minX = b.x - b.w / 2, maxX = b.x + b.w / 2, minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
    const insideXZ = px > minX - PR && px < maxX + PR && pz > minZ - PR && pz < maxZ + PR;
    if (!insideXZ) continue;
    // land on roof
    if (py <= b.h + 0.2 && py >= b.h - 2.2 && player.vel.y <= 0 && px > minX && px < maxX && pz > minZ && pz < maxZ) {
      const fall = -player.vel.y;
      player.pos.y = b.h; player.vel.y = 0; player.onGround = true; if (player.swinging) releaseWeb();
      if (fall > 13) { landFX(player.pos, clamp(fall / 8, 2, 6)); sfx('land'); }
      return;
    }
    if (py < b.h - 0.1) {
      // side push-out (wall)
      const dl = px - (minX - PR), dr = (maxX + PR) - px, dn = pz - (minZ - PR), df = (maxZ + PR) - pz;
      const m = Math.min(dl, dr, dn, df);
      if (m === dl) { player.pos.x = minX - PR; if (player.vel.x > 0) player.vel.x = 0; }
      else if (m === dr) { player.pos.x = maxX + PR; if (player.vel.x < 0) player.vel.x = 0; }
      else if (m === dn) { player.pos.z = minZ - PR; if (player.vel.z > 0) player.vel.z = 0; }
      else { player.pos.z = maxZ + PR; if (player.vel.z < 0) player.vel.z = 0; }
      player.wall = b; // touching a wall
    }
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

  const swingPressed = keys.has('Space') || tWeb;
  const zipPressed = keys.has('ShiftLeft') || keys.has('ShiftRight');
  // start/stop swing
  if (swingPressed && !player.swinging && !player.onGround && !player.wall) { if (!shootWeb()) {} }
  if (!swingPressed && player.swinging) releaseWeb(true);   // release fling
  if (zipPressed && !zipLatch) { zipLatch = true; webZip(); }
  if (!zipPressed) zipLatch = false;

  // gravity
  if (!player.wall || !swingPressed) player.vel.y -= GRAVITY * dt;

  if (player.onGround) {
    // running on rooftops / street
    const spd = RUN * ((keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 1.5 : 1);
    player.vel.x = wishX * spd; player.vel.z = wishZ * spd;
    if (swingPressed || tWeb) { player.vel.y = JUMP; player.onGround = false; }   // jump into a swing
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
    if (!tipWall) { tipWall = true; feed('🧗 Clinging! <b>W/S</b> to climb, release <b>Space</b> to drop'); }
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
    if (fall > 42) hurt(Math.min(60, (fall - 42) * 1.6), 'the fall');
    if (fall > 13) { landFX(player.pos, clamp(fall / 7, 2, 7)); sfx('land'); }
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
  camera.position.copy(camPos); camera.lookAt(tx, ty, tz);
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
function spawnThugs(c) {
  for (let i = 0; i < c.thugs; i++) {
    const a = (i / c.thugs) * Math.PI * 2; const px = c.x + Math.cos(a) * 6, pz = c.z + Math.sin(a) * 6;
    const ctrl = makeAvatar({ body: 'a', shirtColor: ['#3a3a44', '#4a2a2a', '#2a2a3a', '#3a2a1a'][i % 4], pantsColor: '#1a1a22', hair: 'short', hairColor: '#1a1410', hat: i % 2 ? 'beanie' : 'none', hatColor: '#111' });
    ctrl.group.position.set(px, 0, pz); scene.add(ctrl.group);
    const bar = thugBar(); ctrl.group.add(bar.sprite);
    const wrap = webWrapSprite(); ctrl.group.add(wrap);
    thugs.push({ ctrl, group: ctrl.group, pos: new THREE.Vector3(px, 0, pz), hp: 60, maxHp: 60, atk: 0, dead: false, removed: false, dying: 0, stunUntil: 0, bar, wrap });
  }
  feed(`🚨 <b>${c.name}</b> — defeat ${c.thugs} thugs!`);
}
function clearThugs() { for (const t of thugs) scene.remove(t.group); thugs.length = 0; }
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
    if (stunned) { t.ctrl.setAnim('idle'); t.ctrl.moveSpeed = 0; }
    else if (d > 2.2) { t.pos.x += (dx / d) * 3.2 * dt; t.pos.z += (dz / d) * 3.2 * dt; t.ctrl.setAnim('walk'); t.ctrl.moveSpeed = 3.2; }
    else { t.ctrl.setAnim('idle'); t.ctrl.moveSpeed = 0; if (now > t.atk && !player.dead && player.pos.y < 3) { t.atk = now + 1.1; hurt(9, 'a thug'); } }
    t.group.position.copy(t.pos); t.group.rotation.y = Math.atan2(dx, dz);
    t.ctrl.update(dt);
  }
}

let lastPunch = 0, combo = 0, comboT = 0;
function punch() {
  if (player.dead) return;
  const now = performance.now() / 1000;
  if (now - lastPunch < 0.32) return;   // punch rate limit
  lastPunch = now;
  // lunge slightly forward
  player.vel.x += Math.sin(player.ry) * 3; player.vel.z += Math.cos(player.ry) * 3;
  let hit = false;
  for (const t of thugs) {
    if (t.dead || t.removed) continue;
    const d = Math.hypot(t.pos.x - player.pos.x, t.pos.z - player.pos.z);
    if (d < 4.5 && Math.abs(t.pos.y - player.pos.y) < 4) {
      const stunned = now < t.stunUntil;
      const dmg = stunned ? 68 : 34;    // webbed thugs take double
      t.hp -= dmg; hit = true; t.bar.draw(Math.max(0, t.hp) / t.maxHp);
      const kx = (t.pos.x - player.pos.x) / (d || 1), kz = (t.pos.z - player.pos.z) / (d || 1);
      t.pos.x += kx * 1.6; t.pos.z += kz * 1.6;
      popup(stunned ? `💥${dmg}!` : `${dmg}`, { x: t.pos.x, y: t.pos.y + 2.4, z: t.pos.z }, stunned ? '#ffd76a' : '#ffffff');
      if (t.hp <= 0) {
        t.dead = true; t.dying = 0; t.bar.sprite.visible = false; t.wrap.visible = false;
        score += 25; setChips();
        popup('KO!', { x: t.pos.x, y: t.pos.y + 3, z: t.pos.z }, '#7fffb0', 3);
        feed('👊 Thug down! <b>+25</b>');
      }
    }
  }
  if (hit) {
    combo = (now - comboT < 1.8) ? combo + 1 : 1; comboT = now;
    if (combo >= 2) popup('x' + combo, { x: player.pos.x, y: player.pos.y + 3, z: player.pos.z }, '#7fd0ff', 2);
  }
  sfx(hit ? 'hit' : 'whiff');
  if (thugs.length && thugs.every((t) => t.dead)) crimeCleared();
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
    o.type = type; o.frequency.setValueAtTime(f, n);
    if (kind === 'zip' || kind === 'web' || kind === 'stun') o.frequency.exponentialRampToValueAtTime(f * 0.5, n + dur);
    g.gain.setValueAtTime(vol * uv, n); g.gain.exponentialRampToValueAtTime(0.0001, n + dur); o.start(n); o.stop(n + dur);
  } catch {}
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
const mv = { x: 0, y: 0 }; let tWeb = false;
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
  $('#t-punch').addEventListener('touchstart', (e) => { punch(); e.preventDefault(); }, { passive: false });
  $('#t-stun').addEventListener('touchstart', (e) => { webStun(); e.preventDefault(); }, { passive: false });
}

// ---------------- loop ----------------
let zipLatch = false, tipWall = false, last = performance.now();
let worldT = 0, reticleT = 0;
const _rHand = new THREE.Vector3(), _rAnchor = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); const dt = Math.min(0.04, (now - last) / 1000); last = now;
  worldT += dt;
  if (respawnT > 0) { respawnT -= dt; $('#respawn-n').textContent = Math.ceil(respawnT); if (respawnT <= 0) respawn(); }
  update(dt); updateThugs(dt); updateCrime(); updateCamera(dt);
  if (myAvatar) myAvatar.update(dt);
  tickPopups(dt); tickCars(dt);

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
  await preloadAvatars(['boy', 'girl']);
  myAvatar = makeAvatar(profile); scene.add(myAvatar.group);
  setHealth(); if (isTouch) setupTouch();
  net.connect();
  net.join({ name: localStorage.getItem('claudebox.user'), avatar: profile, code: localStorage.getItem('claudebox.code') || '' });
  net.startMovementStream(() => ({ t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim, web: player.swinging && player.anchor ? { x: +player.anchor.x.toFixed(1), y: +player.anchor.y.toFixed(1), z: +player.anchor.z.toFixed(1) } : null }));
  requestAnimationFrame(frame);
  window.__webrush = { player, remotes, net, scene };
  window.ClaudeBox?.registerGame?.({
    players: () => [...remotes.values()].map((r) => ({ name: r.data?.name })).filter((p) => p.name),
    resetCharacter: respawn,
    keybinds: [{ keys: 'Space', action: 'Web-swing (hold)' }, { keys: 'WASD', action: 'Steer / run' }, { keys: 'W (swinging)', action: 'Reel up' }, { keys: 'Click', action: 'Punch' }, { keys: 'F', action: 'Web-stun a thug' }, { keys: 'Shift', action: 'Web-zip' }, { keys: 'Mouse', action: 'Look' }],
    help: 'Hold Space to shoot a web and swing — release on the upswing for a boost. F webs up a thug (they take double damage). Follow the waypoint to crime scenes and Click to punch. Clear all 6 to save the city.',
  });
}
boot();
