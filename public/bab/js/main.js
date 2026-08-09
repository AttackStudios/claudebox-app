// Build A Boat For Treasure — an original ClaudeBox take on the Roblox loop:
// bolt a boat together on your dock plot, pull the lever, and see how far down
// an eleven-stage river it survives. Gold buys sturdier blocks; sturdier blocks
// get you further; further gets you the treasure.
//
// Build and sail are both simulated here (client-authoritative, like the rest of
// the platform). The server hands out plots and relays boats so the harbour is
// full of other people's contraptions.

import * as THREE from 'three';
import { Net } from './net.js';
import {
  BLOCKS, BLOCK_BY_ID, STARTER_BLOCKS, PLOT, RIVER,
  STAGES, STAGE_LEN, STAGE_GOLD, TREASURE_GOLD, TOTAL_LEN, TREASURE_AT,
  HAZARDS, hazardsFor, stageIndexAt, BAND_COLOR, goldForRun, DEFAULT_SAVE,
} from '/shared/bab/config.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- renderer
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fd2ff');
scene.fog = new THREE.Fog('#8fd2ff', 60, 260);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight('#cfefff', '#2c4a5a', 1.05));
const sun = new THREE.DirectionalLight('#fff4d6', 1.0);
sun.position.set(-40, 70, -30); scene.add(sun);

// ---------------------------------------------------------------- the world
const WATER_TOP = 0;
const HARBOUR_Z = -18;

// water: one big plane we scroll a subtle ripple across
const waterMat = new THREE.MeshLambertMaterial({ color: '#2f9fd0', transparent: true, opacity: 0.92 });
const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 1800, 1, 1), waterMat);
water.rotation.x = -Math.PI / 2; water.position.set(0, WATER_TOP, 300);
scene.add(water);

// harbour deck the plots sit on
const deck = new THREE.Mesh(
  new THREE.BoxGeometry(200, 2, 20),
  new THREE.MeshLambertMaterial({ color: '#8a6a45' }));
deck.position.set(0, -0.6, HARBOUR_Z - 7);
scene.add(deck);

// river banks, from the harbour mouth all the way to the treasure
const bankMat = new THREE.MeshLambertMaterial({ color: '#6d7a55' });
for (const side of [-1, 1]) {
  const bank = new THREE.Mesh(new THREE.BoxGeometry(26, 7, TOTAL_LEN + 80), bankMat);
  bank.position.set(side * (RIVER.width / 2 + 13), 1.4, TOTAL_LEN / 2);
  scene.add(bank);
}

// per-stage colour bands painted on the water so the run reads at a glance
const stageStrips = [];
for (let i = 0; i < STAGES.length; i++) {
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(RIVER.width, STAGE_LEN),
    new THREE.MeshLambertMaterial({ color: STAGES[i].water, transparent: true, opacity: 0.85 }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, WATER_TOP + 0.02, i * STAGE_LEN + STAGE_LEN / 2);
  scene.add(strip); stageStrips.push(strip);
  // a gate wall marking the stage boundary, like the original's black walls
  if (i > 0) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(2.5, 10, 2.5),
        new THREE.MeshLambertMaterial({ color: BAND_COLOR[STAGES[i].band] }));
      post.position.set(side * (RIVER.width / 2 - 1), 4, i * STAGE_LEN);
      scene.add(post);
    }
  }
}

// the treasure itself, waiting at the end
const treasureChest = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 4.5, 5),
    new THREE.MeshLambertMaterial({ color: '#a06a30' }));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.6, 5.4),
    new THREE.MeshLambertMaterial({ color: '#ffc93c' }));
  lid.position.y = 3;
  treasureChest.add(body, lid);
  treasureChest.position.set(0, 2.4, TREASURE_AT + 6);
  scene.add(treasureChest);
}

// ---------------------------------------------------------------- plots
// Your plot pad is where blocks may be placed. Remote players get one too, so
// the harbour looks lived-in.
const PLOT_GAP = PLOT.w + 7;
let myPlot = 0;
// YOUR plot always sits at the river mouth (x = 0) so the voyage runs straight
// ahead; everyone else's plot is laid out relative to yours along the harbour.
const plotOrigin = (i) => ({ x: (i - myPlot) * PLOT_GAP, z: HARBOUR_Z });
const padMat = new THREE.MeshLambertMaterial({ color: '#5c72ff', transparent: true, opacity: 0.35 });
const pad = new THREE.Mesh(new THREE.BoxGeometry(PLOT.w, 0.3, PLOT.d), padMat);
pad.position.set(0, WATER_TOP + 0.15, HARBOUR_Z);
scene.add(pad);

// ---------------------------------------------------------------- boat model
// blocks: Map "gx,gy,gz" -> { id, gx, gy, gz, hp, mesh }
const blocks = new Map();
const boatGroup = new THREE.Group();
scene.add(boatGroup);

const key = (x, y, z) => `${x},${y},${z}`;
const geoCache = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
function matFor(id) {
  if (!matCache.has(id)) {
    const def = BLOCK_BY_ID[id];
    matCache.set(id, new THREE.MeshLambertMaterial({ color: def?.color || '#b3803f' }));
  }
  return matCache.get(id);
}

// grid -> local position inside the boat group
const localPos = (gx, gy, gz) => new THREE.Vector3(
  gx - (PLOT.w - 1) / 2,
  gy + 0.5,
  gz - (PLOT.d - 1) / 2);

function addBlock(id, gx, gy, gz) {
  if (gx < 0 || gx >= PLOT.w || gy < 0 || gy >= PLOT.h || gz < 0 || gz >= PLOT.d) return false;
  const k = key(gx, gy, gz);
  if (blocks.has(k)) return false;
  const def = BLOCK_BY_ID[id]; if (!def) return false;
  const mesh = new THREE.Mesh(geoCache, matFor(id));
  mesh.position.copy(localPos(gx, gy, gz));
  // balloons and thrusters read better as non-cubes
  if (def.kind === 'balloon') mesh.scale.set(0.9, 1.15, 0.9);
  if (def.kind === 'thruster') mesh.scale.set(0.8, 0.8, 1);
  if (def.kind === 'sail') mesh.scale.set(0.12, 1.6, 1.2);
  mesh.userData.k = k;
  boatGroup.add(mesh);
  blocks.set(k, { id, gx, gy, gz, hp: def.hp, mesh });
  return true;
}

function removeBlock(k) {
  const b = blocks.get(k); if (!b) return;
  boatGroup.remove(b.mesh);
  blocks.delete(k);
}

function clearBoat() { for (const k of [...blocks.keys()]) removeBlock(k); refreshVitals(); }

// A brand-new player gets a raft so there is something to launch immediately.
function starterRaft() {
  clearBoat();
  for (let x = 5; x <= 9; x++) for (let z = 3; z <= 7; z++) addBlock('wood', x, 0, z);
  addBlock('seat', 7, 1, 5);
}

// aggregate stats the physics reads
function boatStats() {
  let weight = 0, buoy = 0, thrust = 0;
  for (const b of blocks.values()) {
    const d = BLOCK_BY_ID[b.id]; if (!d) continue;
    weight += d.weight; buoy += d.buoy; thrust += d.thrust || 0;
  }
  return { weight, buoy, thrust, count: blocks.size, float: weight > 0 ? buoy / weight : 1 };
}

// ---------------------------------------------------------------- save/load
let gold = 60;
let owned = new Set(STARTER_BLOCKS);
let best = 0, runs = 0;
let myName = null;

const codeHdr = () => ({ 'x-cbx-code': localStorage.getItem('claudebox.code') || '' });

async function loadSave(name) {
  try {
    const r = await fetch('/api/gamesave/bab?name=' + encodeURIComponent(name), { headers: codeHdr() });
    const { data } = await r.json();
    const s = data || DEFAULT_SAVE();
    gold = Number.isFinite(s.gold) ? s.gold : 60;
    owned = new Set(Array.isArray(s.owned) && s.owned.length ? s.owned : STARTER_BLOCKS);
    for (const id of STARTER_BLOCKS) owned.add(id);
    best = s.best || 0; runs = s.runs || 0;
    if (Array.isArray(s.boat) && s.boat.length) {
      clearBoat();
      for (const b of s.boat) addBlock(b.b, b.x, b.y, b.z);
    } else starterRaft();
  } catch { starterRaft(); }
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!myName) return;
    const boat = [...blocks.values()].map((b) => ({ b: b.id, x: b.gx, y: b.gy, z: b.gz }));
    fetch('/api/gamesave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...codeHdr() },
      body: JSON.stringify({ name: myName, game: 'bab', data: { gold, owned: [...owned], best, runs, boat } }),
    }).catch(() => {});
  }, 700);
}

// ---------------------------------------------------------------- HUD
function setGold(v) { gold = Math.max(0, Math.round(v)); $('#gold').textContent = gold.toLocaleString(); }

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

let selected = 'wood';
function buildPalette() {
  const pal = $('#palette'); pal.innerHTML = '';
  const list = BLOCKS.filter((b) => owned.has(b.id));
  list.forEach((b, i) => {
    const el = document.createElement('button');
    el.className = 'slot cbx-tile' + (b.id === selected ? ' on' : '');
    el.innerHTML = `<span class="key">${i < 9 ? i + 1 : ''}</span>${b.emoji}<small>${b.name.split(' ')[0]}</small>`;
    el.addEventListener('click', () => { selected = b.id; buildPalette(); });
    pal.appendChild(el);
  });
}

function refreshVitals() {
  const s = boatStats();
  $('#block-count').textContent = s.count;
  const sinking = s.float < 1;
  $('#vitals').classList.toggle('sinking', sinking);
  $('#float-state').textContent = sinking ? 'SINKING' : 'afloat';
}

function buildShop() {
  const list = $('#shop-list'); list.innerHTML = '';
  for (const b of BLOCKS) {
    const has = owned.has(b.id);
    const row = document.createElement('div');
    row.className = 'shop-row' + (has ? ' owned' : '');
    row.innerHTML = `
      <span class="ico">${b.emoji}</span>
      <span class="who"><b>${b.name}</b><small>${b.hp} hp · ${b.weight} weight · ${b.buoy} float${b.thrust ? ` · ${b.thrust} thrust` : ''}</small></span>`;
    const btn = document.createElement('button');
    btn.className = 'cbx-btn buy ' + (has ? 'ghost' : 'go');
    btn.textContent = has ? 'Owned' : `🪙 ${b.cost.toLocaleString()}`;
    btn.disabled = has;
    btn.addEventListener('click', () => {
      if (owned.has(b.id)) return;
      if (gold < b.cost) { toast('Not enough gold — sail further!'); return; }
      setGold(gold - b.cost); owned.add(b.id);
      toast(`Bought ${b.name}!`);
      buildShop(); buildPalette(); saveSoon();
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

$('#btn-shop').addEventListener('click', () => { buildShop(); $('#shop').classList.remove('hidden'); });
$('#shop-close').addEventListener('click', () => $('#shop').classList.add('hidden'));
$('#btn-clear').addEventListener('click', () => { clearBoat(); publishBoat(); saveSoon(); });

// ---------------------------------------------------------------- hazards
// Every hazard is a mesh plus a position function of time. Contact damages the
// nearest block; a per-hazard cooldown stops one saw deleting a whole hull.
const hazards = [];
function buildHazards() {
  for (let si = 0; si < STAGES.length; si++) {
    for (const h of hazardsFor(si)) {
      const def = HAZARDS[h.kind];
      const mesh = new THREE.Mesh(
        h.kind === 'saw' ? new THREE.CylinderGeometry(def.r, def.r, 0.5, 16)
        : h.kind === 'whirl' ? new THREE.CylinderGeometry(def.r, def.r * 0.3, 1.4, 18)
        : h.kind === 'laser' ? new THREE.BoxGeometry(0.6, 0.6, RIVER.width)
        : new THREE.SphereGeometry(def.r * 0.8, 10, 8),
        new THREE.MeshLambertMaterial({ color: def.color }));
      if (h.kind === 'saw') mesh.rotation.z = Math.PI / 2;
      if (h.kind === 'whirl') mesh.rotation.x = Math.PI;
      // Seat it in its own stage straight away. Only hazards near the boat get
      // their position stepped each frame, so without this every distant hazard
      // would sit at the world origin — right on top of the harbour.
      mesh.position.set(h.x, 1, h.z);
      scene.add(mesh);
      hazards.push({ ...h, def, mesh, nextHit: 0, si });
    }
  }
}

// where a hazard is at time t
function hazardPos(h, t) {
  const m = h.def.motion;
  let x = h.x, y = 1.0, z = h.z;
  if (m === 'drift')  x = h.x + Math.sin(t * 0.8 + h.phase) * 4;
  if (m === 'swing')  { x = Math.sin(t * 1.5 + h.phase) * (RIVER.width / 2 - 2); y = 2.4; }
  if (m === 'fire')   { x = Math.sin(t * 1.1 + h.phase) * (RIVER.width / 2 - 1); y = 1.6; }
  if (m === 'slide')  { x = Math.sin(t * 1.9 + h.phase) * (RIVER.width / 2 - 3); y = 1.2; }
  if (m === 'arc')    { y = 1.2 + Math.abs(Math.sin(t * 1.3 + h.phase)) * 7; x = h.x; }
  if (m === 'sweep')  { z = h.z + Math.sin(t * 1.7 + h.phase) * 6; y = 1.4; x = 0; }
  if (m === 'pull')   { y = 0.4; }
  return { x, y, z };
}

// ---------------------------------------------------------------- game state
let mode = 'build';        // 'build' | 'sail'
const boat = { x: 0, y: 0, z: HARBOUR_Z, vy: 0, sunkT: 0 };
let stagesEntered = 0, lastStageIdx = -1, gotTreasure = false;
const keys = new Set();

function setMode(m) {
  mode = m;
  $('#buildbar').classList.toggle('hidden', m !== 'build');
  $('#voyage').classList.toggle('hidden', m !== 'sail');
  $('#vitals').classList.toggle('hidden', m !== 'sail');
  pad.visible = m === 'build';
  $('#hints').textContent = m === 'build'
    ? 'Click to place · Right-click / Shift-click to remove · Drag to orbit · Scroll to zoom · 1-9 pick block'
    : 'A / D to steer · your boat rides the current';
}

function launch() {
  if (blocks.size === 0) { toast('Build something first!'); return; }
  const s = boatStats();
  if (s.count && s.float < 0.6) toast('That is very heavy… good luck.');
  boat.x = 0; boat.y = 0; boat.z = 0; boat.vy = 0; boat.sunkT = 0;
  stagesEntered = 0; lastStageIdx = -1; gotTreasure = false;
  // full health again for the new run
  for (const b of blocks.values()) b.hp = BLOCK_BY_ID[b.id].hp;
  setMode('sail');
  net.send({ t: 'launch' });
  window.ClaudeBox?.completeChallenge?.('bab-launch');
}
$('#btn-launch').addEventListener('click', launch);

function endRun(treasure) {
  const dist = Math.max(0, boat.z);
  const earned = goldForRun(dist, stagesEntered, treasure);
  setGold(gold + earned);
  best = Math.max(best, Math.round(dist)); runs++;
  saveSoon();
  net.send({ t: treasure ? 'finish' : 'sunk', dist });

  $('#sum-title').textContent = treasure ? 'You reached the treasure!' : 'Your boat sank!';
  const si = stageIndexAt(dist);
  $('#sum-stage').textContent = `${treasure ? '🏆' : '📍'} ${STAGES[si].name}`;
  $('#sum-rows').innerHTML = `
    <div class="sum-row"><span>Distance</span><b>${Math.round(dist)}m</b></div>
    <div class="sum-row"><span>Stages reached</span><b>${stagesEntered} × ${STAGE_GOLD}🪙</b></div>
    ${treasure ? `<div class="sum-row"><span>Treasure bonus</span><b>${TREASURE_GOLD}🪙</b></div>` : ''}
    <div class="sum-row"><span>Personal best</span><b>${best}m</b></div>`;
  $('#sum-gold').textContent = earned.toLocaleString();
  $('#summary').classList.remove('hidden');
}

$('#sum-back').addEventListener('click', () => {
  $('#summary').classList.add('hidden');
  $('#treasure').classList.add('hidden');
  // rebuild the boat exactly as designed — blocks lost at sea come back on the plot
  const design = [...blocks.values()].map((b) => ({ b: b.id, x: b.gx, y: b.gy, z: b.gz }));
  clearBoat();
  for (const d of design) addBlock(d.b, d.x, d.y, d.z);
  if (blocks.size === 0) starterRaft();
  boat.x = 0; boat.y = 0; boat.z = HARBOUR_Z;
  setMode('build');
  refreshVitals();
});

// ---------------------------------------------------------------- build input
// Orbit camera around the plot while building; chase the boat while sailing.
// start looking DOWN the river from behind the dock, so the voyage ahead is
// the first thing you see while building
let camYaw = Math.PI, camPitch = 0.42, camDist = 19;
let dragging = false, dragMoved = 0, lastX = 0, lastY = 0;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  camYaw -= dx * 0.005;
  camPitch = clamp(camPitch + dy * 0.004, 0.06, 1.35);
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  canvas.releasePointerCapture?.(e.pointerId);
  // a click that did not really drag is a build action
  if (mode === 'build' && dragMoved < 6) {
    const remove = e.button === 2 || e.shiftKey;
    tryBuild(e.clientX, e.clientY, remove);
  }
});
canvas.addEventListener('wheel', (e) => {
  camDist = clamp(camDist + Math.sign(e.deltaY) * 2.5, 8, 70);
}, { passive: true });

addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea')) return;
  keys.add(e.key.toLowerCase());
  const n = parseInt(e.key, 10);
  if (mode === 'build' && n >= 1 && n <= 9) {
    const list = BLOCKS.filter((b) => owned.has(b.id));
    if (list[n - 1]) { selected = list[n - 1].id; buildPalette(); }
  }
  if (e.key === 'Enter' && mode === 'build') launch();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function tryBuild(clientX, clientY, remove) {
  ndc.x = (clientX / innerWidth) * 2 - 1;
  ndc.y = -(clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ndc, camera);

  const meshes = [...blocks.values()].map((b) => b.mesh);
  const hits = ray.intersectObjects(meshes, false);
  if (hits.length) {
    const hit = hits[0];
    const b = blocks.get(hit.object.userData.k);
    if (!b) return;
    if (remove) { removeBlock(b.mesh.userData.k); afterEdit(); return; }
    // place against the face we hit
    const n = hit.face.normal;
    if (addBlock(selected, b.gx + n.x, b.gy + n.y, b.gz + n.z)) afterEdit();
    return;
  }
  if (remove) return;
  // nothing hit — drop a block on the pad where the ray crosses the water
  const padHit = ray.intersectObject(pad, false)[0];
  if (!padHit) return;
  const local = boatGroup.worldToLocal(padHit.point.clone());
  const gx = Math.round(local.x + (PLOT.w - 1) / 2);
  const gz = Math.round(local.z + (PLOT.d - 1) / 2);
  if (addBlock(selected, gx, 0, gz)) afterEdit();
}

function afterEdit() { refreshVitals(); publishBoat(); saveSoon(); }

// ---------------------------------------------------------------- multiplayer
const net = new Net();
const remotes = new Map();   // id -> { group, plot, dist, sailing }

function publishBoat() {
  net.send({ t: 'boat', blocks: [...blocks.values()].map((b) => ({ b: b.id, x: b.gx, y: b.gy, z: b.gz })) });
}

function remoteFor(id) {
  if (!remotes.has(id)) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    remotes.set(id, { group, plot: 0, dist: 0, sailing: false });
  }
  return remotes.get(id);
}

function setRemoteBoat(id, list, plot) {
  const r = remoteFor(id);
  r.plot = plot ?? r.plot;
  while (r.group.children.length) r.group.remove(r.group.children[0]);
  for (const b of list || []) {
    const def = BLOCK_BY_ID[b.b]; if (!def) continue;
    const m = new THREE.Mesh(geoCache, new THREE.MeshLambertMaterial({ color: def.color, transparent: true, opacity: 0.75 }));
    m.position.copy(localPos(b.x, b.y, b.z));
    r.group.add(m);
  }
  r.group.visible = r.group.children.length > 0;
}

net.on('welcome', (m) => {
  myPlot = m.plot ?? 0;
  boat.x = 0; boat.z = HARBOUR_Z;
  boatGroup.position.set(0, 0, HARBOUR_Z);
  pad.position.set(0, WATER_TOP + 0.15, HARBOUR_Z);
  for (const p of m.players || []) {
    setRemoteBoat(p.id, p.boat, p.plot);
    const r = remoteFor(p.id); r.dist = p.dist || 0; r.sailing = !!p.sailing;
  }
  publishBoat();
});
net.on('player.join', (m) => { const r = remoteFor(m.player.id); r.plot = m.player.plot; });
net.on('player.leave', (m) => {
  const r = remotes.get(m.id);
  if (r) { scene.remove(r.group); remotes.delete(m.id); }
});
net.on('player.boat', (m) => setRemoteBoat(m.id, m.blocks));
net.on('snapshot', (m) => {
  for (const p of m.players || []) {
    if (p.id === net.id) continue;
    const r = remoteFor(p.id);
    r.plot = p.plot; r.dist = p.dist || 0; r.sailing = !!p.sailing;
  }
});
net.on('launched', (m) => { if (m.id !== net.id) toast(`⛵ ${m.name} launched!`); });
net.on('runover', (m) => {
  if (m.id === net.id) return;
  toast(m.treasure ? `🏆 ${m.name} reached the treasure!` : `💥 ${m.name} sank at ${m.dist}m`);
});
net.on('toast', (m) => toast(m.text));
net.on('kicked', (m) => { toast(m.reason || 'Disconnected'); });

// ---------------------------------------------------------------- sailing sim
const BASE_CURRENT = 8.5;

function stepSail(dt, t) {
  const s = boatStats();
  if (s.count === 0) { finishRun(false); return; }

  // buoyancy: float ratio above 1 keeps the deck dry, below 1 and you go under
  const target = s.float >= 1 ? 0 : -(1 - Math.min(s.float, 1)) * 9;
  boat.y = lerp(boat.y, target, 1 - Math.exp(-1.4 * dt));
  if (boat.y < -5.5) { finishRun(false); return; }

  // forward motion: the current plus whatever thrust is bolted on, scaled by
  // how well the hull actually floats
  const speed = (BASE_CURRENT + s.thrust) * clamp(s.float, 0.45, 1.35);
  boat.z += speed * dt;

  // steering, plus the drift out of the harbour toward the river centre
  let steer = 0;
  if (keys.has('a') || keys.has('arrowleft')) steer -= 1;
  if (keys.has('d') || keys.has('arrowright')) steer += 1;
  boat.x += steer * 7 * dt;
  if (boat.z < STAGE_LEN) boat.x = lerp(boat.x, 0, 1 - Math.exp(-1.1 * dt));
  boat.x = clamp(boat.x, -RIVER.width / 2 + 1, RIVER.width / 2 - 1);

  // stage tracking + payout pips
  const si = stageIndexAt(boat.z);
  if (si !== lastStageIdx) {
    lastStageIdx = si;
    stagesEntered = si + 1;
    $('#stage-name').textContent = STAGES[si].name;
    $('#stage-name').style.color = BAND_COLOR[STAGES[si].band];
    scene.background = new THREE.Color(STAGES[si].sky);
    scene.fog.color = new THREE.Color(STAGES[si].sky);
    updatePips(si);
    if (STAGES[si].band === 'red') window.ClaudeBox?.completeChallenge?.('bab-red');
  }

  applyHazards(dt, t);

  if (boat.z >= TREASURE_AT && !gotTreasure) { gotTreasure = true; finishRun(true); return; }

  // HUD
  const pct = clamp(boat.z / TOTAL_LEN, 0, 1);
  $('#progress-fill').style.right = `${(1 - pct) * 100}%`;
  $('#progress-label').textContent = `${Math.round(boat.z)}m`;
  refreshVitals();
  net.send({ t: 'progress', dist: boat.z, blocks: s.count });
}

function updatePips(si) {
  const wrap = $('#stage-pips');
  if (wrap.children.length !== STAGES.length) {
    wrap.innerHTML = STAGES.map(() => '<i></i>').join('');
  }
  [...wrap.children].forEach((el, i) => {
    el.style.background = i <= si ? BAND_COLOR[STAGES[i].band] : 'rgba(255,255,255,.2)';
  });
}

function applyHazards(dt, t) {
  for (const h of hazards) {
    // only the stage we are in and its neighbours can matter
    if (Math.abs(h.z - boat.z) > 45) continue;
    const p = hazardPos(h, t);
    h.mesh.position.set(p.x, p.y, p.z);
    if (h.def.motion === 'saw' || h.kind === 'saw') h.mesh.rotation.x += dt * 12;
    if (h.kind === 'whirl') h.mesh.rotation.y += dt * 3;

    // the whirlpool drags you sideways rather than only chewing blocks
    if (h.kind === 'whirl') {
      const d = Math.hypot(p.x - boat.x, p.z - boat.z);
      if (d < h.def.r * 2.5) boat.x = lerp(boat.x, p.x, 1 - Math.exp(-0.9 * dt));
    }

    if (t < h.nextHit) continue;

    // find the closest block to the hazard, in world space
    let hitK = null, hitD = Infinity;
    for (const b of blocks.values()) {
      const wx = boat.x + (b.gx - (PLOT.w - 1) / 2);
      const wy = boat.y + b.gy + 0.5;
      const wz = boat.z + (b.gz - (PLOT.d - 1) / 2);
      const d = Math.hypot(wx - p.x, wy - p.y, wz - p.z);
      if (d < hitD) { hitD = d; hitK = b.mesh.userData.k; }
    }
    if (hitK && hitD < h.def.r) {
      const b = blocks.get(hitK);
      b.hp -= h.def.dmg;
      h.nextHit = t + 0.55;
      if (b.hp <= 0) removeBlock(hitK);
      else b.mesh.material = b.mesh.material.clone(), b.mesh.material.color.offsetHSL(0, -0.2, -0.08);
    }
  }
}

function finishRun(treasure) {
  if (mode !== 'sail') return;
  setMode('build');
  if (treasure) {
    $('#treasure').classList.remove('hidden');
    window.ClaudeBox?.completeChallenge?.('bab-treasure');
    setTimeout(() => endRun(true), 1500);
  } else endRun(false);
}

// ---------------------------------------------------------------- frame loop
let lastT = performance.now() / 1000;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - lastT);
  lastT = now;

  if (mode === 'sail') stepSail(dt, now);

  // place the boat + camera
  boatGroup.position.set(boat.x, boat.y, boat.z);
  const focus = mode === 'build'
    ? new THREE.Vector3(0, 2.5, HARBOUR_Z + 2)
    : new THREE.Vector3(boat.x, boat.y + 4.5, boat.z);
  const dist = mode === 'build' ? camDist : Math.max(camDist, 22);
  camera.position.set(
    focus.x + Math.sin(camYaw) * Math.cos(camPitch) * dist,
    focus.y + Math.sin(camPitch) * dist,
    focus.z + Math.cos(camYaw) * Math.cos(camPitch) * dist - (mode === 'sail' ? 6 : 0));
  camera.lookAt(focus);

  // remote boats ride their own distance, nudged aside so they do not overlap
  for (const r of remotes.values()) {
    const o = plotOrigin(r.plot);
    if (r.sailing) r.group.position.set(clamp(o.x * 0.08, -11, 11), 0, r.dist);
    else r.group.position.set(o.x, 0, HARBOUR_Z);
  }

  // gentle water shimmer
  water.position.z = 300 + Math.sin(now * 0.3) * 0.5;
  treasureChest.rotation.y = now * 0.5;

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
async function boot() {
  const name = localStorage.getItem('claudebox.user');
  if (!name) { location.href = '/'; return; }
  myName = name;

  let profile = {};
  try {
    const res = await fetch('/api/avatar/' + encodeURIComponent(name), { headers: codeHdr() });
    if (!res.ok) throw 0;
    const data = await res.json();
    profile = data.avatar || {};
    localStorage.setItem('claudebox.user', data.name);
    myName = data.name;
  } catch { location.href = '/'; return; }

  $('#load-msg').textContent = 'Charting the river…';
  buildHazards();
  await loadSave(myName);
  setGold(gold);
  buildPalette();
  refreshVitals();
  updatePips(-1);
  setMode('build');

  net.connect();
  net.join({ name: myName, avatar: profile, code: localStorage.getItem('claudebox.code') || '' });

  $('#loading').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  requestAnimationFrame(frame);

  window.__bab = { boat, blocks, boatStats, hazards, launch, endRun, net, scene,
    get gold() { return gold; }, set gold(v) { setGold(v); },
    get mode() { return mode; } };

  window.ClaudeBox?.registerGame?.({
    players: () => [{ name: myName }, ...[...remotes.keys()].map(() => ({ name: '' }))].filter((p) => p.name),
    keybinds: [
      { keys: 'Click', action: 'Place block' },
      { keys: 'Right-click', action: 'Remove block' },
      { keys: 'Drag', action: 'Orbit camera' },
      { keys: 'Scroll', action: 'Zoom' },
      { keys: '1–9', action: 'Pick block' },
      { keys: 'Enter', action: 'Launch' },
      { keys: 'A / D', action: 'Steer while sailing' },
    ],
    help: 'Build a boat on your plot, then launch it down the river. Every stage you reach pays gold, and gold buys tougher blocks. Keep your float above 1 or you will sink — balloons lift, metal and gold are heavy but survive hits.',
  });
}
boot();
