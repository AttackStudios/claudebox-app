// Pizza Works — a cooperative pizzeria. Pick a job at the board, then keep
// the pies moving: cashiers take walk-in orders, chefs build and bake them,
// boxers fold them up, drivers run them to the glowing house, and suppliers
// keep the ingredient bins full. Every finished task pays out on the spot.

import * as THREE from 'three';
import { loadIdentity, buildPlayerAvatar, makePlayerAnimState, animatePlayer } from '/backpacking/js/player/avatar.js';
import { Net, InterpBuffer } from './net.js';
import {
  JOBS, JOB_META, PAY, REGISTERS, QUEUE_SLOTS, DOOR, TICKET_BOARD, BINS, OVENS,
  BOX_BENCH, PICKUP_SHELF, JOB_BOARD, SUPPLY_TRUCK, HOUSES, ROAD_LOOP, ROAD_W,
  CARS, SHOP, PLAYER_SPAWN, TOPPING_COLORS,
} from '/shared/pizza/world.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ============================ scene ============================
const canvas = $('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#ffd9a0');
scene.fog = new THREE.Fog('#ffd9a0', 90, 220);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 600);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
renderer.setSize(innerWidth, innerHeight);

scene.add(new THREE.HemisphereLight('#fff2dd', '#7a6a50', 1.1));
const sun = new THREE.DirectionalLight('#ffe8c0', 1.3);
sun.position.set(45, 70, 30); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90; sun.shadow.camera.far = 260;
scene.add(sun);

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const box = (w, h, d, color, x, y, z, ry = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  return m;
};

// ============================ world ============================
const COLLIDERS = [];   // { x, z, hw, hd } XZ walls
const col = (x, z, w, d) => COLLIDERS.push({ x, z, hw: w / 2, hd: d / 2 });
const ovenMeshes = new Map(), houseBeacons = new Map(), carMeshes = new Map();
let benchStack, shelfStack;
const binLabels = new Map();

function labelSprite(text, color = '#fff') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 80;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '800 34px Trebuchet MS';
  x.lineWidth = 8; x.strokeStyle = 'rgba(20,14,8,.9)';
  x.strokeText(text, 128, 40); x.fillStyle = color; x.fillText(text, 128, 40);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(4.6, 1.45, 1);
  return s;
}

function buildWorld() {
  // ground + sidewalk + road loop
  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 48).rotateX(-Math.PI / 2), lam('#8fbf6a'));
  ground.receiveShadow = true; scene.add(ground);
  for (let i = 0; i < ROAD_LOOP.length - 1; i++) {
    const [ax, az] = ROAD_LOOP[i], [bx, bz] = ROAD_LOOP[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, len + ROAD_W * 0.9).rotateX(-Math.PI / 2), lam('#4a4a50'));
    seg.position.set((ax + bx) / 2, 0.02, (az + bz) / 2);
    seg.rotation.y = Math.atan2(bx - ax, bz - az);
    seg.receiveShadow = true; scene.add(seg);
  }
  // driveway from loop to the shop parking
  const drive = new THREE.Mesh(new THREE.PlaneGeometry(10, 34).rotateX(-Math.PI / 2), lam('#4a4a50'));
  drive.position.set(28, 0.025, 28); drive.rotation.y = 0.35; drive.receiveShadow = true; scene.add(drive);
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(16, 22).rotateX(-Math.PI / 2), lam('#55555c'));
  lot.position.set(27, 0.03, 16); lot.receiveShadow = true; scene.add(lot);

  // ---------------- the pizzeria ----------------
  const { x: sx, z: sz, w, d, wallH } = SHOP;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), lam('#caa26a'));
  floor.position.set(sx, 0.04, sz); floor.receiveShadow = true; scene.add(floor);
  // checker accent
  for (let i = -3; i <= 3; i++) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2), lam(i % 2 ? '#b8905a' : '#d8b078'));
    t.position.set(sx + i * 2.6, 0.05, sz + 8); scene.add(t);
  }
  const wall = (ww, wd, x, z) => { scene.add(box(ww, wallH, wd, '#d8574a', x, wallH / 2, z)); col(x, z, ww, wd); };
  wall(w, 0.6, sx, sz - d / 2);                                        // back
  wall(0.6, d, sx - w / 2, sz);                                        // west
  wall(0.6, d, sx + w / 2, sz);                                        // east
  const gap = 5;                                                        // front door gap
  wall((w - gap) / 2, 0.6, sx - (gap / 2 + (w - gap) / 4), sz + d / 2);
  wall((w - gap) / 2, 0.6, sx + (gap / 2 + (w - gap) / 4), sz + d / 2);
  // roof band + big sign
  scene.add(box(w + 2, 1.2, d + 2, '#a83a30', sx, wallH + 0.6, sz));
  const sign = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.7, 24), lam('#f2c14a'));
  sign.rotation.x = Math.PI / 2;
  sign.position.set(sx, wallH + 4, sz + d / 2 - 2); scene.add(sign);
  const pep = lam('#c0392b');
  for (const [ox, oy] of [[-1.4, 0.9], [1.1, 1.3], [0.2, -1.2], [-0.9, -0.6], [1.6, -0.2]]) {
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.72, 10), pep);
    dot.rotation.x = Math.PI / 2;
    dot.position.set(sx + ox, wallH + 4 + oy, sz + d / 2 - 2); scene.add(dot);
  }
  const title = labelSprite('🍕 PIZZA WORKS', '#fff3d8');
  title.scale.set(9, 2.8, 1);
  title.position.set(sx, wallH + 7.2, sz + d / 2 - 2); scene.add(title);

  // front counter with registers
  scene.add(box(16, 1.15, 1.4, '#8a5a3a', sx, 0.58, 4)); col(sx, 4, 16, 1.4);
  for (const r of REGISTERS) {
    scene.add(box(1.1, 0.7, 0.9, '#3a3f4c', r.x, 1.5, 4));
    const t = labelSprite('Register', '#9fd0ff'); t.position.set(r.x, 3, 4); t.scale.set(3.2, 1, 1); scene.add(t);
  }

  // ticket board
  scene.add(box(3.4, 2.2, 0.3, '#6a4a30', TICKET_BOARD.x, 1.9, TICKET_BOARD.z - 0.4));
  const tb = labelSprite('📋 Tickets', '#f2c14a'); tb.position.set(TICKET_BOARD.x, 3.4, TICKET_BOARD.z); scene.add(tb);

  // ingredient bins
  for (const b of BINS) {
    scene.add(box(2.2, 1.3, 2.2, '#7a5230', b.x, 0.65, b.z));
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.5, 12), lam(b.color));
    fill.position.set(b.x, 1.35, b.z); scene.add(fill);
    const lb = labelSprite(b.label, '#ffe9c0'); lb.position.set(b.x, 2.7, b.z); lb.scale.set(3.4, 1.05, 1); scene.add(lb);
    binLabels.set(b.id, lb);
    col(b.x, b.z, 2.2, 2.2);
  }

  // ovens
  for (const ov of OVENS) {
    const g = new THREE.Group();
    g.add(box(3, 2.6, 2, '#55555c', 0, 1.3, 0));
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.1), new THREE.MeshBasicMaterial({ color: '#2a2018' }));
    door.position.set(0, 1.1, 1.02); g.add(door);
    g.position.set(ov.x, 0, ov.z); scene.add(g);
    ovenMeshes.set(ov.id, door);
    col(ov.x, ov.z, 3, 2);
  }

  // boxing bench + pickup shelf
  scene.add(box(3.6, 1.1, 2, '#8a5a3a', BOX_BENCH.x, 0.55, BOX_BENCH.z)); col(BOX_BENCH.x, BOX_BENCH.z, 3.6, 2);
  const bl = labelSprite('📦 Boxing', '#ffd9a0'); bl.position.set(BOX_BENCH.x, 2.6, BOX_BENCH.z); scene.add(bl);
  benchStack = new THREE.Group(); benchStack.position.set(BOX_BENCH.x, 1.1, BOX_BENCH.z); scene.add(benchStack);
  scene.add(box(3, 2.2, 1.2, '#6a4a30', PICKUP_SHELF.x, 1.1, PICKUP_SHELF.z)); col(PICKUP_SHELF.x, PICKUP_SHELF.z, 3, 1.2);
  const sl = labelSprite('🛵 Pickup', '#9fd0ff'); sl.position.set(PICKUP_SHELF.x, 3.2, PICKUP_SHELF.z); scene.add(sl);
  shelfStack = new THREE.Group(); shelfStack.position.set(PICKUP_SHELF.x, 2.3, PICKUP_SHELF.z); scene.add(shelfStack);

  // job board
  scene.add(box(3, 2.4, 0.35, '#3a3f4c', JOB_BOARD.x, 1.7, JOB_BOARD.z)); col(JOB_BOARD.x, JOB_BOARD.z, 3, 0.5);
  const jb = labelSprite('💼 Jobs', '#8fd18a'); jb.position.set(JOB_BOARD.x, 3.5, JOB_BOARD.z); scene.add(jb);

  // supply truck
  const truck = new THREE.Group();
  truck.add(box(4, 3, 7, '#e8e2d5', 0, 2, -0.6));
  truck.add(box(3.4, 1.6, 2.4, '#d8574a', 0, 1.2, 4));
  for (const [wx, wz] of [[-1.7, 2.6], [1.7, 2.6], [-1.7, -2.6], [1.7, -2.6]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 12).rotateZ(Math.PI / 2), lam('#22242c'));
    wheel.position.set(wx, 0.7, wz); truck.add(wheel);
  }
  truck.position.set(SUPPLY_TRUCK.x, 0, SUPPLY_TRUCK.z);
  truck.rotation.y = 0.3;
  scene.add(truck);
  const tl = labelSprite('🚚 Supplies', '#ffe9c0'); tl.position.set(SUPPLY_TRUCK.x, 4.6, SUPPLY_TRUCK.z); scene.add(tl);
  col(SUPPLY_TRUCK.x, SUPPLY_TRUCK.z, 5, 8);

  // ---------------- houses ----------------
  for (const h of HOUSES) {
    const g = new THREE.Group();
    g.add(box(7, 4, 6, h.color, 0, 2, 0));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.6, 4), lam('#6a4a30'));
    roof.rotation.y = Math.PI / 4; roof.position.y = 5.3; g.add(roof);
    g.add(box(1.4, 2.4, 0.2, '#4a3220', 0, 1.2, 3.05));
    g.position.set(h.x, 0, h.z);
    g.rotation.y = h.door;
    scene.add(g);
    col(h.x, h.z, 7, 6);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 16, 10),
      new THREE.MeshBasicMaterial({ color: '#8fd18a', transparent: true, opacity: 0.0 }));
    beam.position.set(h.x, 8, h.z); scene.add(beam);
    houseBeacons.set(h.id, beam);
  }

  // ---------------- shared delivery cars ----------------
  for (const c of CARS) {
    const g = new THREE.Group();
    g.add(box(2.2, 0.8, 4.2, c.color, 0, 0.75, 0));
    g.add(box(1.9, 0.7, 2.1, '#dff3ff', 0, 1.45, -0.2));
    for (const [wx, wz] of [[-1.05, 1.4], [1.05, 1.4], [-1.05, -1.4], [1.05, -1.4]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 12).rotateZ(Math.PI / 2), lam('#22242c'));
      wheel.position.set(wx, 0.45, wz); g.add(wheel);
    }
    const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 16), lam('#f2c14a'));
    slice.position.set(0, 2.1, -0.2); g.add(slice);
    g.position.set(c.x, 0, c.z); g.rotation.y = c.ry;
    scene.add(g);
    carMeshes.set(c.id, { group: g, interp: new InterpBuffer(), driver: null });
  }
}

// carryable meshes
function makeCarry(kind) {
  const g = new THREE.Group();
  if (kind === 'pizza-raw' || kind === 'pizza-cooked') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16), lam(kind === 'pizza-raw' ? '#e8d5a8' : '#e8a84a'));
    g.add(base);
    if (kind === 'pizza-cooked') for (let i = 0; i < 5; i++) {
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8), lam('#c0392b'));
      dot.position.set(Math.cos(i * 2.2) * 0.22, 0.05, Math.sin(i * 2.2) * 0.22); g.add(dot);
    }
  } else if (kind === 'box') {
    g.add(box(0.62, 0.14, 0.62, '#efe6d4', 0, 0, 0));
    const lid = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), lam('#c0392b'));
    lid.position.y = 0.08; g.add(lid);
  } else if (kind === 'crate') {
    g.add(box(0.6, 0.5, 0.6, '#8a5a3a', 0, 0, 0));
  }
  return g;
}

// ============================ players ============================
const net = new Net();
const me = {
  pos: new THREE.Vector3(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z), vel: new THREE.Vector3(),
  ry: Math.PI, anim: 'idle', job: 'cashier', carry: null, carId: null, cash: 0,
};
let myAvatar = null, myTag = null, myHeld = null;
let camYaw = Math.PI, camPitch = -0.34, camDist = 8;
const keys = new Set();
const others = new Map();
const npcRecs = new Map();

function nameSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.font = '800 30px Trebuchet MS';
  x.lineWidth = 6; x.strokeStyle = 'rgba(16,12,8,.9)'; x.strokeText(name, 128, 40);
  x.fillStyle = '#fff'; x.fillText(name, 128, 40);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(2.6, 0.65, 1); s.position.y = 2.25;
  return s;
}

function makeRemote(d) {
  const built = buildPlayerAvatar(d.avatar || {});
  const group = new THREE.Group();
  group.add(built.group);
  group.add(nameSprite(d.name));
  if (d.pos) group.position.set(d.pos.x, d.pos.y || 0, d.pos.z);
  scene.add(group);
  const rec = {
    group, parts: built.parts, anim: makePlayerAnimState(), interp: new InterpBuffer(),
    data: d, held: null,
  };
  setCarry(rec, d.carry?.kind || null);
  others.set(d.id, rec);
  return rec;
}
function dropRemote(id) {
  const r = others.get(id);
  if (r) { scene.remove(r.group); others.delete(id); }
}
function setCarry(rec, kind) {
  if (rec.heldKind === kind) return;
  rec.heldKind = kind;
  if (rec.held) { rec.parts.armR.remove(rec.held); rec.held = null; }
  if (kind) { rec.held = makeCarry(kind); rec.held.position.set(0, -0.1, 0.25); rec.parts.armR.add(rec.held); }
}

function makeNpc(d) {
  const built = buildPlayerAvatar(d.avatar || { shirtColor: '#d8a83c' });
  const group = new THREE.Group();
  group.add(built.group);
  group.add(nameSprite(d.name));
  group.position.set(d.x, 0, d.z);
  scene.add(group);
  const rec = { group, parts: built.parts, anim: makePlayerAnimState(), target: { x: d.x, z: d.z, ry: d.ry, anim: d.anim } };
  npcRecs.set(d.id, rec);
  return rec;
}

// ============================ HUD ============================
function toast(text, pay = false) {
  const el = document.createElement('div');
  el.className = 'pz-toast' + (pay ? ' pay' : '');
  el.textContent = text;
  $('#pz-toasts').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function setJobChip() {
  const m = JOB_META[me.job];
  $('#job-chip').textContent = `${m.emoji} ${m.label}`;
}
let orders = [];
function renderTickets() {
  const host = $('#ticket-list');
  host.innerHTML = '';
  if (!orders.length) { host.innerHTML = '<div class="ticket">No orders — take one at a register!</div>'; return; }
  for (const o of orders) {
    const el = document.createElement('div');
    el.className = 'ticket';
    const steps = o.steps.map((s, i) => i < o.next ? `<span class="tk-done">${s}✓</span>` : s).join(' → ');
    el.innerHTML = `<b>${o.stage.toUpperCase()}</b>${o.chef ? ' · ' + o.chef : ''}<div class="tk-steps">${steps}</div>` +
      (o.house ? `<div>🏠 → ${o.house}</div>` : '');
    host.appendChild(el);
  }
}
function addChatLine(name, text) {
  const log = $('#chat-log');
  const line = document.createElement('div');
  line.className = 'chat-line';
  const b = document.createElement('b'); b.textContent = name + ': ';
  const s = document.createElement('span'); s.textContent = text;
  line.append(b, s); log.appendChild(line);
  while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => line.remove(), 14000);
}

// job picker
let jobMenu = null;
function toggleJobMenu() {
  if (jobMenu) { jobMenu.remove(); jobMenu = null; return; }
  jobMenu = document.createElement('div');
  jobMenu.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:50;background:rgba(24,18,12,.96);border:1px solid rgba(255,200,120,.5);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:8px;width:min(320px,90vw)';
  jobMenu.innerHTML = '<b style="font-size:16px">💼 Pick your job</b>';
  for (const j of JOBS) {
    const m = JOB_META[j];
    const b = document.createElement('button');
    b.style.cssText = 'display:flex;gap:10px;align-items:center;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:11px;padding:10px 12px;color:#fff;cursor:pointer;text-align:left;font-family:inherit';
    b.innerHTML = `<span style="font-size:22px">${m.emoji}</span><span><b>${m.label}</b><br><small style="opacity:.75">${m.hint}</small></span>`;
    b.addEventListener('click', () => { net.send({ t: 'job', job: j }); jobMenu.remove(); jobMenu = null; });
    jobMenu.appendChild(b);
  }
  document.body.appendChild(jobMenu);
}

// ============================ interact scan ============================
let promptAction = null;
function scan() {
  let label = null, action = null;
  const p = me.pos;
  const nearXZ = (s, r) => Math.hypot(p.x - s.x, p.z - s.z) <= r;

  if (me.carId) {
    label = '🚗 Hop out'; action = () => { net.send({ t: 'car.exit' }); me.carId = null; };
    // delivering from the car seat
    if (me.carry?.kind === 'box') {
      const o = orders.find((x) => x.id === myCarryOrder);
      const h = o && HOUSES.find((x) => x.id === o.house);
      if (h && nearXZ(h, 8)) { label = '🍕 Deliver the pizza!'; action = () => net.send({ t: 'action' }); }
    }
  } else if (nearXZ(JOB_BOARD, 4)) { label = '💼 Pick a job'; action = toggleJobMenu; }
  else {
    for (const c of CARS) {
      const cm = carMeshes.get(c.id);
      const cp = cm.group.position;
      if (!cm.driver && nearXZ({ x: cp.x, z: cp.z }, 4)) { label = '🚗 Drive'; action = () => net.send({ t: 'car.enter', id: c.id }); break; }
    }
    if (!action) {
      if (me.carry?.kind === 'box') {
        const o = orders.find((x) => x.id === myCarryOrder);
        const h = o && HOUSES.find((x) => x.id === o.house);
        if (h && nearXZ(h, 7)) { label = '🍕 Deliver the pizza!'; action = () => net.send({ t: 'action' }); }
      }
      if (!action) for (const r of REGISTERS) {
        if (nearXZ({ x: r.x, z: r.z - 2.5 }, 2.8)) { label = '💁 Take the order'; action = () => net.send({ t: 'action' }); break; }
      }
      if (!action && nearXZ(TICKET_BOARD, 3.2)) { label = '📋 Claim a ticket'; action = () => net.send({ t: 'action' }); }
      if (!action) for (const b of BINS) {
        if (nearXZ(b, 2.8)) { label = me.carry?.kind === 'crate' ? `🚚 Restock ${b.label}` : `🧺 ${b.label}`; action = () => net.send({ t: 'action' }); break; }
      }
      if (!action) for (const ov of OVENS) {
        if (nearXZ(ov, 2.8)) { label = '🔥 Oven'; action = () => net.send({ t: 'action' }); break; }
      }
      if (!action && nearXZ(BOX_BENCH, 3.2)) { label = me.carry?.kind === 'pizza-cooked' ? '⬇️ Set pizza down' : '📦 Fold a box'; action = () => net.send({ t: 'action' }); }
      if (!action && nearXZ(PICKUP_SHELF, 3.2)) { label = '🛵 Grab a delivery'; action = () => net.send({ t: 'action' }); }
      if (!action && nearXZ(SUPPLY_TRUCK, 4.2)) { label = '🚚 Grab a crate'; action = () => net.send({ t: 'action' }); }
    }
  }
  promptAction = action;
  const pr = $('#prompt');
  if (label) { $('#prompt-label').textContent = label; pr.classList.remove('hidden'); $('#btn-action').textContent = '✋'; }
  else { pr.classList.add('hidden'); $('#btn-action').textContent = '👋'; }
}
let myCarryOrder = null;

// ============================ input ============================
addEventListener('keydown', (e) => {
  const chatting = document.activeElement === $('#chat-input');
  if (e.code === 'Enter') {
    e.preventDefault();
    const inp = $('#chat-input');
    if (chatting) {
      const text = inp.value.trim();
      if (text) net.send({ t: 'chat', text });
      inp.value = ''; inp.classList.add('hidden'); inp.blur();
    } else { inp.classList.remove('hidden'); inp.focus(); }
    return;
  }
  if (chatting) return;
  if (e.code === 'Tab') { e.preventDefault(); $('#tickets').classList.toggle('hidden'); return; }
  keys.add(e.code);
  if (e.code === 'KeyE' && promptAction) promptAction();
});
addEventListener('keyup', (e) => keys.delete(e.code));
$('#btn-action').addEventListener('touchstart', (e) => { e.preventDefault(); if (promptAction) promptAction(); }, { passive: false });
$('#btn-action').addEventListener('click', () => { if (promptAction) promptAction(); });
$('#btn-chat').addEventListener('touchstart', (e) => { e.preventDefault(); const inp = $('#chat-input'); inp.classList.remove('hidden'); inp.focus(); }, { passive: false });
if (isTouch) {
  $('#move-cluster').classList.remove('hidden');
  $('#btn-action').classList.remove('hidden');
  $('#btn-chat').classList.remove('hidden');
}

// drag look (mouse + right-half touch). Exactly ONE pointer owns the camera:
// without tracking pointerId, the joystick finger also fires pointermove and
// the camera spins wildly on phones.
let dragId = null, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (dragId !== null) return;
  if (!isTouch || e.clientX > innerWidth * 0.45) { dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY; }
});
addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId) return;
  camYaw -= (e.clientX - lastX) * 0.0052;
  camPitch = Math.max(-1.1, Math.min(-0.06, camPitch - (e.clientY - lastY) * 0.004));
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointerup', (e) => { if (e.pointerId === dragId) dragId = null; });
addEventListener('pointercancel', (e) => { if (e.pointerId === dragId) dragId = null; });

// joystick
const joy = { x: 0, z: 0 };
{
  const zone = $('#joystick-zone'), knob = $('#joystick-knob');
  let id = null, cx = 0, cy = 0;
  zone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; id = t.identifier;
    const r = $('#joystick-base').getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
  }, { passive: true });
  zone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === id) {
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const max = 46, dd = Math.hypot(dx, dy);
      if (dd > max) { dx *= max / dd; dy *= max / dd; }
      knob.style.left = 24 + dx + 'px'; knob.style.top = 24 + dy + 'px';
      joy.x = dx / max; joy.z = dy / max;
    }
  }, { passive: true });
  const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; joy.x = joy.z = 0; knob.style.left = '50%'; knob.style.top = '50%'; } };
  zone.addEventListener('touchend', end, { passive: true });
  zone.addEventListener('touchcancel', end, { passive: true });
}

// ============================ movement ============================
function collide(x, z) {
  const r = 0.42;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of COLLIDERS) {
      const minX = b.x - b.hw - r, maxX = b.x + b.hw + r;
      const minZ = b.z - b.hd - r, maxZ = b.z + b.hd + r;
      if (x > minX && x < maxX && z > minZ && z < maxZ) {
        const dl = x - minX, dr = maxX - x, dn = z - minZ, df = maxZ - z;
        const m = Math.min(dl, dr, dn, df);
        if (m === dl) x = minX; else if (m === dr) x = maxX; else if (m === dn) z = minZ; else z = maxZ;
      }
    }
  }
  return { x, z };
}

let carSpeed = 0;
function update(dt) {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let inF = f, inR = r;
  if (joy.x || joy.z) { inR = joy.x; inF = -joy.z; }

  if (me.carId) {
    // arcade car: W/S accelerate, A/D steer
    const cm = carMeshes.get(me.carId);
    carSpeed += inF * 16 * dt;
    carSpeed *= (1 - Math.min(1, dt * (Math.abs(inF) > 0.05 ? 0.4 : 1.6)));
    carSpeed = Math.max(-8, Math.min(22, carSpeed));
    me.ry -= inR * 1.9 * dt * Math.max(-1, Math.min(1, carSpeed / 8));
    me.pos.x += Math.sin(me.ry) * carSpeed * dt;
    me.pos.z += Math.cos(me.ry) * carSpeed * dt;
    const lim = 150;
    me.pos.x = Math.max(-lim, Math.min(lim, me.pos.x));
    me.pos.z = Math.max(-lim, Math.min(lim, me.pos.z));
    cm.group.position.set(me.pos.x, 0, me.pos.z);
    cm.group.rotation.y = me.ry;
    me.anim = 'sit';
    if (myAvatar) myAvatar.group.visible = false;
  } else {
    if (myAvatar) myAvatar.group.visible = true;
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(inR, inF) > 0.9;
    const spd = running ? 10 : 6.4;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = Math.sin(camYaw - Math.PI / 2), rz = Math.cos(camYaw - Math.PI / 2);
    let wx = fx * inF + rx * inR, wz = fz * inF + rz * inR;
    const mag = Math.hypot(wx, wz);
    if (mag > 0.05) {
      wx /= Math.max(1, mag); wz /= Math.max(1, mag);
      const solved = collide(me.pos.x + wx * spd * dt, me.pos.z + wz * spd * dt);
      me.pos.x = solved.x; me.pos.z = solved.z;
      me.ry = Math.atan2(wx, wz);
      me.anim = running ? 'run' : 'walk';
    } else me.anim = 'idle';
    const lim = 150;
    me.pos.x = Math.max(-lim, Math.min(lim, me.pos.x));
    me.pos.z = Math.max(-lim, Math.min(lim, me.pos.z));
  }
}

// ============================ net handlers ============================
net.on('welcome', (msg) => {
  for (const d of msg.players) makeRemote(d);
  for (const n of msg.npcs) makeNpc(n);
  orders = msg.orders; renderTickets();
  me.cash = msg.cash; $('#cash').textContent = me.cash;
  me.job = msg.you.job; setJobChip();
  for (const c of msg.cars) {
    const cm = carMeshes.get(c.id);
    if (cm) { cm.group.position.set(c.x, 0, c.z); cm.group.rotation.y = c.ry; cm.driver = c.driver; }
  }
  $('#loading').classList.add('hidden');
});
net.on('player.join', (m) => { if (m.player.id !== net.id && !others.has(m.player.id)) makeRemote(m.player); });
net.on('player.leave', (m) => dropRemote(m.id));
net.on('player.update', (m) => {
  const d = m.player;
  if (d.id === net.id) {
    me.job = d.job; setJobChip();
    const kind = d.carry?.kind || null;
    myCarryOrder = d.carry?.orderId || null;
    me.carry = kind ? { kind } : null;
    if (myAvatar) setCarry(myAvatarRec, kind);
    return;
  }
  const o = others.get(d.id);
  if (o) { o.data = d; setCarry(o, d.carry?.kind || null); }
});
net.on('orders', (m) => {
  orders = m.orders; renderTickets();
  // track my carried order + light beacons
  const mine = orders.find((o) => (o.stage === 'assembling' || o.stage === 'ready-to-bake') && o.chef === meName())
    || null;
  for (const [hid, beam] of houseBeacons) beam.material.opacity = 0;
  for (const o of orders) if (o.house && (o.stage === 'boxed' || o.stage === 'delivering')) {
    const beam = houseBeacons.get(o.house);
    if (beam) beam.material.opacity = 0.28;
  }
});
net.on('cash', (m) => {
  me.cash = m.cash; $('#cash').textContent = m.cash;
  toast(`+$${m.plus} — ${m.why}`, true);
  window.ClaudeBox?.completeChallenge?.('pizza-first');
  if (m.why === 'Pizza delivered!') window.ClaudeBox?.completeChallenge?.('pizza-deliver');
  if (m.cash >= 100) window.ClaudeBox?.completeChallenge?.('pizza-rich');
});
net.on('toast', (m) => toast(m.text));
net.on('bins', (m) => {
  for (const [id, lb] of binLabels) {
    const left = m.bins[id] ?? 0;
    lb.material.opacity = left <= 0 ? 0.35 : 1;
  }
});
net.on('ovens', (m) => {
  for (const ov of m.ovens) {
    const door = ovenMeshes.get(ov.id);
    if (door) door.material.color.set(ov.doneAt ? '#ff8a3c' : '#2a2018');
  }
});
net.on('ding', () => toast('🔔 Ding! A pizza is done.'));
net.on('bench', (m) => {
  benchStack.clear();
  for (let i = 0; i < Math.min(m.bench, 4); i++) {
    const pz = makeCarry('pizza-cooked'); pz.position.y = i * 0.14; benchStack.add(pz);
  }
});
net.on('shelf', (m) => {
  shelfStack.clear();
  for (let i = 0; i < Math.min(m.shelf, 4); i++) {
    const bx = makeCarry('box'); bx.position.y = i * 0.2; shelfStack.add(bx);
  }
});
net.on('delivered', (m) => toast(`🍕 ${m.by} delivered to ${m.house}!`));
net.on('car.driver', (m) => {
  const cm = carMeshes.get(m.id);
  if (cm) cm.driver = m.driver;
  if (m.driver === net.id) { me.carId = m.id; carSpeed = 0; }
  // hide/show remote drivers' avatars
  for (const [oid, o] of others) {
    if (o.data.carId === m.id && m.driver !== oid) o.data.carId = null;
    if (m.driver === oid) o.data.carId = m.id;
  }
});
net.on('chat', (m) => addChatLine(m.name, m.text));
net.on('snap', (m) => {
  for (const row of m.players) {
    const [id, x, y, z, ry, anim] = row;
    if (id === net.id) continue;
    const o = others.get(id);
    if (o) { o.interp.push([x, y, z, ry, anim]); }
  }
  for (const n of m.npcs) {
    const rec = npcRecs.get(n.id) || makeNpc(n);
    rec.target = { x: n.x, z: n.z, ry: n.ry, anim: n.anim };
  }
  for (const [id, rec] of [...npcRecs]) {
    if (!m.npcs.some((n) => n.id === id)) { scene.remove(rec.group); npcRecs.delete(id); }
  }
  for (const row of m.cars) {
    const [id, x, z, ry, driver] = row;
    const cm = carMeshes.get(id);
    if (!cm) continue;
    cm.driver = driver;
    if (driver !== net.id) cm.interp.push([x, 0, z, ry, '']);
  }
  for (const ov of m.ovens || []) {
    const door = ovenMeshes.get(ov.id);
    if (door) door.material.color.set(ov.doneAt ? '#ff8a3c' : '#2a2018');
  }
});
net.on('kicked', () => location.reload());
net.on('_disconnect', () => toast('Disconnected — refresh to rejoin.'));

const meName = () => localStorage.getItem('claudebox.user') || '';

// ============================ main loop ============================
let myAvatarRec = null;
let last = performance.now() / 1000, scanT = 0, sendT = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  update(dt);

  // my avatar
  if (myAvatar) {
    myAvatar.group.position.set(me.pos.x, 0, me.pos.z);
    myAvatar.group.rotation.y = me.ry;
    myAvatarRec.anim.anim = me.anim;
    myAvatarRec.anim.speed = me.anim === 'run' ? 10 : me.anim === 'walk' ? 6.4 : 0;
    animatePlayer(myAvatarRec.parts, myAvatarRec.anim, dt);
  }

  // remotes
  for (const [, o] of others) {
    const s = o.interp.sample();
    if (s) { o.group.position.set(s[0], s[1], s[2]); o.group.rotation.y = s[3]; o.anim.anim = s[4] || 'idle'; }
    o.anim.speed = o.anim.anim === 'run' ? 10 : o.anim.anim === 'walk' ? 6.4 : 0;
    animatePlayer(o.parts, o.anim, dt);
    if (o.data.carId) o.group.visible = false; else o.group.visible = true;
  }
  // npcs
  for (const [, rec] of npcRecs) {
    const g = rec.group.position;
    g.x += (rec.target.x - g.x) * Math.min(1, dt * 8);
    g.z += (rec.target.z - g.z) * Math.min(1, dt * 8);
    let dr = rec.target.ry - rec.group.rotation.y;
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    rec.group.rotation.y += dr * Math.min(1, dt * 8);
    rec.anim.anim = rec.target.anim || 'idle';
    rec.anim.speed = rec.anim.anim === 'walk' ? 3.2 : 0;
    animatePlayer(rec.parts, rec.anim, dt);
  }
  // cars driven by others
  for (const [, cm] of carMeshes) {
    if (cm.driver && cm.driver !== net.id) {
      const s = cm.interp.sample();
      if (s) { cm.group.position.set(s[0], 0, s[2]); cm.group.rotation.y = s[3]; }
    }
  }
  // beacons pulse
  for (const [, beam] of houseBeacons) {
    if (beam.material.opacity > 0) beam.material.opacity = 0.2 + Math.sin(now * 4) * 0.1;
  }

  // camera
  const ty = me.carId ? 2.4 : 1.5;
  const cp = Math.cos(camPitch);
  const dist = me.carId ? 11 : camDist;
  const cx = me.pos.x - Math.sin(camYaw) * cp * dist;
  const cy = ty - Math.sin(camPitch) * dist;
  const cz = me.pos.z - Math.cos(camYaw) * cp * dist;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 10));
  camera.lookAt(me.pos.x, ty, me.pos.z);

  scanT += dt;
  if (scanT > 0.15) { scanT = 0; scan(); }
  sendT += dt;
  if (sendT > 0.1) {
    sendT = 0;
    net.send({ t: 'move', x: +me.pos.x.toFixed(2), y: 0, z: +me.pos.z.toFixed(2), ry: +me.ry.toFixed(3), anim: me.anim });
  }
  renderer.render(scene, camera);
}

// ============================ boot ============================
(async () => {
  const identity = await loadIdentity();
  buildWorld();
  const built = buildPlayerAvatar(identity.avatar || {});
  const group = new THREE.Group();
  group.add(built.group);
  group.add(nameSprite(identity.name));
  scene.add(group);
  myAvatar = { group };
  myAvatarRec = { parts: built.parts, anim: makePlayerAnimState(), heldKind: null, held: null };
  myAvatarRec.parts = built.parts;
  // reuse setCarry for my own held item
  myAvatarRec.parts.armR && (myAvatarRec.armRHost = true);
  net.connect();
  net.join({ name: identity.name, avatar: identity.avatar, code: localStorage.getItem('claudebox.code') || '' });
  window.__pizza = { me, others, net, scene, joy, get orders() { return orders; }, get camYaw() { return camYaw; } };
  frame();
})();
