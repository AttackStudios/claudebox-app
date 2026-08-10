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
import { makeBlockMesh, makeHazardMesh, tintDamaged, Particles, waterTexture, blockMaterial } from './art.js';
import * as sfx from './sfx.js';
import {
  BLOCKS, BLOCK_BY_ID, STARTER_BLOCKS, PLOT, RIVER,
  STAGES, STAGE_LEN, STAGE_GOLD, TREASURE_GOLD, TOTAL_LEN, TREASURE_AT,
  HAZARDS, hazardsFor, stageIndexAt, BAND_COLOR, goldForRun, DEFAULT_SAVE,
  blockLimit, CHAMPION_ONLY, GOLD_PACK, isPremiumRank, plotSize,
  PACK_SIZE, STARTER_INVENTORY, STARTING_GOLD, canBuy, TIER_OF,
  MAPS, mapFor, mapsForRank, stagesOf, totalLen, treasureAt,
} from '/shared/bab/config.js';

// Memoised: the HUD ran ~12 querySelector calls per frame, and every
// textContent write forced a style recalculation. These nodes never change.
const _els = new Map();
const $ = (sel) => {
  let e = _els.get(sel);
  if (e === undefined || !e.isConnected) { e = document.querySelector(sel); _els.set(sel, e); }
  return e;
};
// only touch the DOM when the value actually changed
const setText = (el, v) => { if (el && el.__v !== v) { el.__v = v; el.textContent = v; } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- renderer
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Phones are fill-rate bound long before they are geometry bound. Capping the
// pixel ratio at 1.5 on touch devices roughly halves the pixels drawn.
const COARSE = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.5 : 2));
renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fd2ff');
scene.fog = new THREE.Fog('#8fd2ff', 60, 260);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // widen the vertical fov in portrait so the horizontal view stays usable
  camera.fov = camera.aspect < 1 ? 84 : 62;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight('#cfefff', '#2c4a5a', 1.05));
const sun = new THREE.DirectionalLight('#fff4d6', 1.0);
sun.position.set(-40, 70, -30); scene.add(sun);

// ---------------------------------------------------------------- the world
const WATER_TOP = 0;
const HARBOUR_Z = -18;

// water: one big plane we scroll a subtle ripple across
const waterTex = waterTexture();
waterTex.repeat.set(60, 120);
const waterMat = new THREE.MeshLambertMaterial({ color: '#2f9fd0', map: waterTex });
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

// the treasure itself, waiting at the end (repositioned when the map changes)
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
// The build volume is a cube sized by rank (25 / 50 / 100 a side). PS is the
// live value; everything that maps grid cells to world space reads it.
let PS = plotSize('');
const PLOT_GAP = 32;
let myPlot = 0;
// YOUR plot always sits at the river mouth (x = 0) so the voyage runs straight
// ahead; everyone else's plot is laid out relative to yours along the harbour.
const plotOrigin = (i) => ({ x: (i - myPlot) * (PS + 8), z: HARBOUR_Z });
const padMat = new THREE.MeshLambertMaterial({ color: '#5c72ff', transparent: true, opacity: 0.35 });
let pad = new THREE.Mesh(new THREE.BoxGeometry(PS, 0.3, PS), padMat);
pad.position.set(0, WATER_TOP + 0.15, HARBOUR_Z);
scene.add(pad);

// ---------------------------------------------------------------- boat model
// blocks: Map "gx,gy,gz" -> { id, gx, gy, gz, hp, mesh }
const blocks = new Map();
const boatGroup = new THREE.Group();
scene.add(boatGroup);

const key = (x, y, z) => `${x},${y},${z}`;

// grid -> local position inside the boat group
const localPos = (gx, gy, gz) => new THREE.Vector3(
  gx - (PS - 1) / 2,
  gy + 0.5,
  gz - (PS - 1) / 2);

// Resize the plot when the rank changes. Creations never survive a run, so
// there is nothing to migrate — just swap the pad and re-centre.
function applyPlotSize() {
  const next = plotSize(rank);
  if (next === PS && pad.geometry.parameters.width === next) return;
  PS = next;
  scene.remove(pad);
  pad.geometry.dispose();
  pad = new THREE.Mesh(new THREE.BoxGeometry(PS, 0.3, PS), padMat);
  pad.position.set(0, WATER_TOP + 0.15, HARBOUR_Z);
  pad.visible = mode === 'build';
  scene.add(pad);
}

function addBlock(id, gx, gy, gz, free = false) {
  if (blocks.size >= blockLimit()) return false;   // safety ceiling, not a rank limit
  if (!free && have(id) <= 0) return false;   // out of stock
  if (gx < 0 || gx >= PS || gy < 0 || gy >= PS || gz < 0 || gz >= PS) return false;
  const k = key(gx, gy, gz);
  if (blocks.has(k)) return false;
  const def = BLOCK_BY_ID[id]; if (!def) return false;
  const mesh = makeBlockMesh(id);     // textured cube, or a small assembly
  mesh.position.copy(localPos(gx, gy, gz));
  mesh.userData.k = k;
  boatGroup.add(mesh);
  blocks.set(k, { id, gx, gy, gz, hp: def.hp, mesh });
  if (!free) inv[id] = have(id) - 1;
  return true;
}

// `refund` returns the block to your stock (taking it off on the plot);
// hazards destroying it at sea do not.
function removeBlock(k, refund = false) {
  const b = blocks.get(k); if (!b) return;
  if (refund) inv[b.id] = have(b.id) + 1;
  boatGroup.remove(b.mesh);
  blocks.delete(k);
}

// ---- structural support ------------------------------------------------
// A block only stays attached if you can walk face-to-face from it down to the
// waterline layer (gy 0). Knock out what was holding a tower up and the tower
// comes off with it, instead of hanging in mid-air.
const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const _wp = new THREE.Vector3();
const falling = [];        // detached pieces tumbling into the water

function detachBlock(k, b, refund) {
  const m = b.mesh;
  m.getWorldPosition(_wp);
  boatGroup.remove(m);
  m.position.copy(_wp);
  m.rotation.copy(boatGroup.rotation);
  scene.add(m);
  falling.push({
    mesh: m, vy: 1.5,
    vx: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3,
    sx: (Math.random() - 0.5) * 6, sz: (Math.random() - 0.5) * 6, t: 0,
  });
  blocks.delete(k);
  if (refund) inv[b.id] = have(b.id) + 1;   // your mistake on the plot is not a punishment
}

// Returns how many blocks came away. `refund` is true on the plot, false at sea.
function settleStructure(refund) {
  if (!blocks.size) return 0;
  const seen = new Set();
  const queue = [];
  for (const b of blocks.values()) {
    if (b.gy === 0) { const k = key(b.gx, b.gy, b.gz); seen.add(k); queue.push(b); }
  }
  while (queue.length) {
    const b = queue.pop();
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const k = key(b.gx + dx, b.gy + dy, b.gz + dz);
      if (seen.has(k)) continue;
      const nb = blocks.get(k);
      if (!nb) continue;
      seen.add(k); queue.push(nb);
    }
  }
  let dropped = 0;
  for (const [k, b] of [...blocks.entries()]) {
    if (seen.has(k)) continue;
    detachBlock(k, b, refund);
    dropped++;
  }
  return dropped;
}

function stepFalling(dt) {
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    f.t += dt;
    f.vy -= 22 * dt;
    f.mesh.position.x += f.vx * dt;
    f.mesh.position.y += f.vy * dt;
    f.mesh.position.z += f.vz * dt;
    f.mesh.rotation.x += f.sx * dt;
    f.mesh.rotation.z += f.sz * dt;
    // splash as it hits the water, then sink out of sight
    if (f.mesh.position.y < WATER_TOP && !f.splashed) {
      f.splashed = true;
      parts.burst(f.mesh.position, '#bfe6ff', 5, { spread: 3, up: 3, size: 0.7, life: 0.5 });
    }
    if (f.t > 2.2 || f.mesh.position.y < -8) {
      scene.remove(f.mesh);
      falling.splice(i, 1);
    }
  }
}

// clearing on the plot hands every block back; wiping after a run does not
function clearBoat(refund = false) { for (const k of [...blocks.keys()]) removeBlock(k, refund); refreshVitals(); }

// A brand-new player gets a raft so there is something to launch immediately.
function starterRaft() {
  clearBoat();
  // drawn from stock; if you have none left you simply start with a bare plot
  const c = Math.floor(PS / 2);
  for (let x = c - 2; x <= c + 2; x++) for (let z = c - 2; z <= c + 2; z++) addBlock('wood', x, 0, z);
  addBlock('seat', c, 1, c);
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
let gold = STARTING_GOLD;
// blocks are stock now, not permanent unlocks: { blockId: count }
let inv = { ...STARTER_INVENTORY };
const have = (id) => inv[id] | 0;
let mapId = 'standard';
const curMap = () => mapFor(mapId);
let best = 0, runs = 0;
let myName = null;
let rank = '';             // '' | 'champion' | 'legend' — granted by the owner
let myBux = 0;
const champion = () => isPremiumRank(rank);   // both ranks get the premium shop
const limit = () => blockLimit(rank);

const codeHdr = () => ({ 'x-cbx-code': localStorage.getItem('claudebox.code') || '' });

async function loadSave(name) {
  try {
    const r = await fetch('/api/gamesave/bab?name=' + encodeURIComponent(name), { headers: codeHdr() });
    const { data } = await r.json();
    const s = data || DEFAULT_SAVE();
    gold = Number.isFinite(s.gold) ? s.gold : STARTING_GOLD;
    best = s.best || 0; runs = s.runs || 0;
    if (s.inv && typeof s.inv === 'object') {
      inv = { ...s.inv };
    } else if (Array.isArray(s.owned)) {
      // migrate the old one-time-unlock saves: every unlocked block becomes a
      // pack of stock so nobody loses what they had already bought
      inv = { ...STARTER_INVENTORY };
      for (const id of s.owned) inv[id] = Math.max(inv[id] | 0, PACK_SIZE);
    } else inv = { ...STARTER_INVENTORY };
    if (MAPS[s.map]) mapId = s.map;
    starterRaft();
  } catch { starterRaft(); }
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!myName) return;
    fetch('/api/gamesave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...codeHdr() },
      body: JSON.stringify({ name: myName, game: 'bab', data: { gold, inv, best, runs, map: mapId } }),
    }).catch(() => {});
  }, 700);
}

// ---------------------------------------------------------------- HUD
function setGold(v) { gold = Math.max(0, Math.round(v)); $('#gold').textContent = gold.toLocaleString(); }

let capToastAt = 0;
function atCapToast() {
  if (clockNowMs() - capToastAt < 2500) return;    // do not spam on held taps
  capToastAt = clockNowMs();
  toast(rank === 'legend' ? `Outside your ${PS}×${PS}×${PS} build volume`
    : `Outside your ${PS}×${PS}×${PS} volume — ${rank === 'champion' ? 'Legends get 100³' : 'Champions get 50³, Legends 100³'}`);
}
const clockNowMs = () => performance.now();

// Ask the platform whether this account holds the Champion rank. The answer
// also carries the ClaudeBux balance, and collects the daily stipend.
async function refreshChampion() {
  try {
    const r = await fetch('/api/champion/me?name=' + encodeURIComponent(myName), { headers: codeHdr() });
    const j = await r.json();
    rank = j.rank || (j.champion ? 'champion' : '');
    myBux = j.cubes || 0;
  } catch { rank = ''; }
  document.body.classList.toggle('champion', champion());
  document.body.classList.toggle('legend', rank === 'legend');
  const tab = $('#champ-tab');
  tab.classList.toggle('hidden', !champion());
  $('#legend-tab').classList.toggle('hidden', rank !== 'legend');
  if (!mapsForRank(rank).some((m) => m.id === mapId)) mapId = 'standard';   // rank removed
  applyPlotSize();                                   // 25 / 50 / 100 a side
  // boot() builds the river once after the save loads — doing it here too meant
  // constructing all 452 hazards twice on startup
  refreshVitals();
}

// 5 ClaudeBux -> 1,000 gold. Spent server-side so it cannot come apart.
async function buyGoldPack() {
  try {
    const r = await fetch('/api/bab/buygold', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...codeHdr() },
      body: JSON.stringify({ name: myName }),
    });
    const j = await r.json();
    if (!j.ok) { sfx.deny(); toast(j.error === 'not enough ClaudeBux' ? 'Not enough ClaudeBux' : (j.error || 'Purchase failed')); return; }
    myBux = j.cubes;
    setGold(j.gold);
    sfx.buy();
    toast(`+${GOLD_PACK.gold.toLocaleString()} gold`);
    buildShop();
  } catch { toast('Purchase failed'); }
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

let selected = 'wood';
function buildPalette() {
  const pal = $('#palette'); pal.innerHTML = '';
  const list = BLOCKS.filter((b) => have(b.id) > 0);
  if (!list.length) {
    pal.innerHTML = '<div class="pal-empty">Out of blocks — open the 🛒 Shop</div>';
    return;
  }
  list.forEach((b, i) => {
    const el = document.createElement('button');
    const n = have(b.id);
    el.className = 'slot cbx-tile' + (b.id === selected ? ' on' : '') + (n <= 5 ? ' low' : '');
    el.innerHTML = `<span class="key">${i < 9 ? i + 1 : ''}</span>${b.emoji}<small>${b.name.split(' ')[0]}</small><span class="qty">${n}</span>`;
    el.addEventListener('click', () => { selected = b.id; sfx.pick(); buildPalette(); refreshGhost(); });
    pal.appendChild(el);
  });
}

function refreshVitals() {
  const s = boatStats();
  const sinking = s.float < 1;
  setText($('#block-count'), String(s.count));
  $('#vitals').classList.toggle('sinking', sinking);
  setText($('#float-state'), sinking ? 'SINKING' : 'afloat');

  // build-mode readout: the actual numbers, so "why did I sink" is answerable
  setText($('#st-count'), String(s.count));
  setText($('#st-vol'), `${PS}³`);
  $('#boatstats').classList.toggle('atcap', s.count >= blockLimit());
  setText($('#st-weight'), s.weight.toFixed(1));
  setText($('#st-buoy'), s.buoy.toFixed(1));
  setText($('#st-float'), s.count ? s.float.toFixed(2) : '—');
  $('#boatstats').classList.toggle('sinking', sinking && s.count > 0);
  // the meter tops out at 1.5 so the 1.0 waterline notch sits at two thirds
  const right = `${(1 - clamp(s.float / 1.5, 0, 1)) * 100}%`;
  const fill = $('#float-fill');
  if (fill.__r !== right) { fill.__r = right; fill.style.right = right; }
}

let shopCat = 'all';
function buildShop() {
  const list = $('#shop-list'); list.innerHTML = '';
  // buy gold with the platform currency
  const ex = document.createElement('div');
  ex.className = 'shop-row exchange';
  ex.innerHTML = `<span class="ico">🔷</span><span class="who"><b>${GOLD_PACK.gold.toLocaleString()} gold</b>`
    + `<small>costs ${GOLD_PACK.cost} ClaudeBux · you have ${myBux}</small></span>`;
  const exb = document.createElement('button');
  exb.className = 'cbx-btn buy ' + (myBux >= GOLD_PACK.cost ? 'go' : 'ghost');
  exb.textContent = `🔷 ${GOLD_PACK.cost}`;
  exb.addEventListener('click', buyGoldPack);
  ex.appendChild(exb);
  list.appendChild(ex);
  const ability = new Set(['balloon', 'thruster', 'sail', 'seat']);
  const shown = BLOCKS.filter((b) => {
    const tier = TIER_OF[b.id] || 'open';
    if (!canBuy(rank, b.id)) return false;                 // above your rank
    if (shopCat === 'champion') return tier === 'champion';
    if (shopCat === 'legend') return tier === 'legend';
    if (tier !== 'open') return shopCat === 'all';
    return shopCat === 'all' || (shopCat === 'ability' ? ability.has(b.id) : !ability.has(b.id));
  });
  shown.sort((a, b) => a.cost - b.cost);
  for (const b of shown) {
    const tier = TIER_OF[b.id] || 'open';
    const short = gold < b.cost;
    const row = document.createElement('div');
    row.className = 'shop-row' + (short ? ' cant' : '') + (tier !== 'open' ? ' champ' : '') + (tier === 'legend' ? ' legendrow' : '');
    const mark = tier === 'legend' ? ' <i class="champ-star legend">👑</i>' : tier === 'champion' ? ' <i class="champ-star">★</i>' : '';
    row.innerHTML = `
      <span class="ico">${b.emoji}</span>
      <span class="who"><b>${b.name}${mark}</b><small>${b.hp} hp · ${b.weight} weight · ${b.buoy} float${b.thrust ? ` · ${b.thrust} thrust` : ''} · you have ${have(b.id)}</small></span>`;
    const btn = document.createElement('button');
    btn.className = 'cbx-btn buy ' + (short ? 'ghost' : 'go');
    btn.innerHTML = `🪙 ${b.cost.toLocaleString()}<small class="pack">×${PACK_SIZE}</small>`;
    btn.addEventListener('click', () => {
      if (!canBuy(rank, b.id)) { sfx.deny(); toast(tier === 'legend' ? 'Legends only' : 'Champions only'); return; }
      if (gold < b.cost) { sfx.deny(); toast('Not enough gold — sail further!'); return; }
      setGold(gold - b.cost);
      inv[b.id] = have(b.id) + PACK_SIZE;      // a pack, not a permanent unlock
      sfx.buy();
      toast(`+${PACK_SIZE} ${b.name}`);
      buildShop(); buildPalette(); refreshVitals(); saveSoon();
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

$('#btn-shop').addEventListener('click', () => { sfx.unlock(); sfx.pick(); buildShop(); $('#shop').classList.remove('hidden'); });
$('#shop-close').addEventListener('click', () => { sfx.pick(); $('#shop').classList.add('hidden'); });
for (const t of document.querySelectorAll('.stab')) {
  t.addEventListener('click', () => {
    shopCat = t.dataset.cat; sfx.pick();
    for (const o of document.querySelectorAll('.stab')) o.classList.toggle('on', o === t);
    buildShop();
  });
}
$('#btn-clear').addEventListener('click', () => { sfx.pick(); $('#confirm').classList.remove('hidden'); });
$('#confirm-no').addEventListener('click', () => { sfx.pick(); $('#confirm').classList.add('hidden'); });
$('#confirm-yes').addEventListener('click', () => {
  $('#confirm').classList.add('hidden');
  clearBoat(); publishBoat(); saveSoon(); sfx.breakBlock();
  toast('Boat cleared');
});
// Build/erase toggle — the only way to remove a block on a touchscreen.
$('#btn-erase').addEventListener('click', () => {
  eraser = !eraser;
  $('#btn-erase').classList.toggle('on', eraser);
  $('#btn-erase').textContent = eraser ? '🧨 Erasing' : '🧱 Building';
  refreshGhost();
});

// ---------------------------------------------------------------- hazards
// Every hazard is a mesh plus a position function of time. Contact damages the
// nearest block; a per-hazard cooldown stops one saw deleting a whole hull.
const hazards = [];
function buildHazards() {
  for (const h of hazards) scene.remove(h.mesh);      // swapping maps rebuilds the river
  hazards.length = 0;
  const stages = stagesOf(mapId);
  for (let si = 0; si < stages.length; si++) {
    for (const h of hazardsFor(si, mapId)) {
      const def = HAZARDS[h.kind];
      const mesh = makeHazardMesh(h.kind);
      // Seat it in its own stage straight away. Only hazards near the boat get
      // their position stepped each frame, so without this every distant hazard
      // would sit at the world origin — right on top of the harbour.
      mesh.position.set(h.x, 1, h.z);
      mesh.visible = false;      // cullHazards() reveals the ones in range
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
const parts = new Particles(scene);
let shake = 0;             // impact kick, decays every frame
let bobT = 0;              // drives the idle bob/roll of a floating hull
let hudT = 0;              // HUD refresh accumulator (10Hz, not every frame)

// foam trail left behind the hull
const wake = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 26),
  new THREE.MeshBasicMaterial({ color: '#dff4ff', transparent: true, opacity: 0.3 }));
wake.rotation.x = -Math.PI / 2;
wake.visible = false;
scene.add(wake);

let mode = 'build';        // 'build' | 'sail'
const boat = { x: 0, y: 0, z: HARBOUR_Z, vy: 0, sunkT: 0 };
let stagesEntered = 0, lastStageIdx = -1, gotTreasure = false;
const keys = new Set();

function setMode(m) {
  mode = m;
  snapCamera();               // do not sweep the camera across the whole river
  $('#buildbar').classList.toggle('hidden', m !== 'build');
  $('#voyage').classList.toggle('hidden', m !== 'sail');
  if (m !== 'sail') $('#stage-banner').classList.add('hidden');
  $('#vitals').classList.toggle('hidden', m !== 'sail');
  pad.visible = m === 'build';
  ghost.visible = false;
  // lets the stylesheet declutter the top HUD on small screens while sailing
  document.body.classList.toggle('sailing', m === 'sail');
  // the steer arrows belong to sailing only; in build mode they overlapped the
  // Shop / Erase / Clear row on a phone
  $('#tilt').classList.toggle('hidden', !(isTouch && m === 'sail'));
  if (m !== 'sail') touchSteer = 0;
  $('#hints').textContent = m === 'build'
    ? (isTouch ? 'Tap to place · 🧱/🧨 toggles erase · drag to orbit · pinch to zoom'
               : 'Click to place · Right-click / Shift-click to remove · Drag to orbit · Scroll to zoom · 1-9 pick block')
    : (isTouch ? 'Tilt buttons steer · drag to look · pinch to zoom' : 'A / D to steer · your boat rides the current');
}

// Rebuild the visible river for the selected map: stage strips, gate posts and
// the treasure all move, and the hazard set is regenerated.
const stripGroup = new THREE.Group();
scene.add(stripGroup);
function buildRiver() {
  while (stripGroup.children.length) stripGroup.remove(stripGroup.children[0]);
  const stages = stagesOf(mapId);
  for (let i = 0; i < stages.length; i++) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(RIVER.width, STAGE_LEN),
      new THREE.MeshLambertMaterial({ color: stages[i].water }));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, WATER_TOP + 0.02, i * STAGE_LEN + STAGE_LEN / 2);
    stripGroup.add(strip);
    if (i > 0) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(2.5, 10, 2.5),
          new THREE.MeshLambertMaterial({ color: BAND_COLOR[stages[i].band] }));
        post.position.set(side * (RIVER.width / 2 - 1), 4, i * STAGE_LEN);
        stripGroup.add(post);
      }
    }
  }
  treasureChest.position.z = treasureAt(mapId) + 6;
  buildHazards();
  updatePips(-1);
}

function setMap(id) {
  if (!MAPS[id] || mapId === id) return;
  mapId = id;
  buildRiver();
  buildMapPicker();
  saveSoon();
  toast(`${curMap().emoji} ${curMap().name}`);
}

function buildMapPicker() {
  const wrap = $('#maps'); wrap.innerHTML = '';
  const list = mapsForRank(rank);
  wrap.classList.toggle('hidden', list.length < 2);
  for (const M of list) {
    const b = document.createElement('button');
    b.className = 'mapbtn cbx-tile' + (M.id === mapId ? ' on' : '') + (M.rank ? ' ' + M.rank : '');
    b.innerHTML = `${M.emoji} ${M.name}<small>${M.stages.length} stages</small>`;
    b.addEventListener('click', () => { sfx.pick(); setMap(M.id); });
    wrap.appendChild(b);
  }
}

function launch() {
  if (blocks.size === 0) { sfx.deny(); toast('Build something first!'); return; }
  const s = boatStats();
  if (s.count && s.float < 0.6) toast('That is very heavy… good luck.');
  boat.x = 0; boat.y = 0; boat.z = 0; boat.vy = 0; boat.sunkT = 0;
  stagesEntered = 0; lastStageIdx = -1; gotTreasure = false;
  // full health again for the new run
  for (const b of blocks.values()) b.hp = BLOCK_BY_ID[b.id].hp;
  sfx.unlock(); sfx.startAmbience(); sfx.launch();
  CAM.sail.yaw = Math.PI; lastLook = -99;   // always set off facing down-river
  setMode('sail');
  net.send({ t: 'launch' });
  window.ClaudeBox?.completeChallenge?.('bab-launch');
}
$('#btn-launch').addEventListener('click', launch);

async function endRun(treasure) {
  const dist = Math.max(0, boat.z);
  const earned = goldForRun(dist, stagesEntered, treasure, mapId);
  setGold(gold + earned);
  best = Math.max(best, Math.round(dist)); runs++;
  net.send({ t: treasure ? 'finish' : 'sunk', dist });

  // Beating the Legend Stage pays real ClaudeBux, tapering 50 / 25 / 5.
  let buxLine = '';
  if (treasure && mapId === 'legend') {
    try {
      const r = await fetch('/api/bab/legendwin', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...codeHdr() },
        body: JSON.stringify({ name: myName }),
      });
      const j = await r.json();
      if (j.ok) {
        myBux = j.cubes;
        buxLine = `<div class="sum-row bux"><span>Legend reward (win #${j.wins})</span><b>+${j.payout} 🔷</b></div>`;
        sfx.coins(10);
      }
    } catch {}
  }

  const lost = blocks.size;
  // the harder runs pay a bigger purse — mirror config's goldForRun
  const purseMul = mapId === 'legend' ? 3 : mapId === 'champion' ? 2 : 1;
  $('#sum-title').textContent = treasure ? 'You reached the treasure!' : 'Your boat sank!';
  const si = stageIndexAt(dist, mapId);
  $('#sum-stage').textContent = `${curMap().emoji} ${stagesOf(mapId)[si].name}`;
  $('#sum-rows').innerHTML = `
    <div class="sum-row"><span>Distance</span><b>${Math.round(dist)}m</b></div>
    <div class="sum-row"><span>Stages reached</span><b>${stagesEntered} × ${STAGE_GOLD * purseMul}🪙</b></div>
    ${treasure ? `<div class="sum-row"><span>Treasure bonus</span><b>${TREASURE_GOLD * purseMul}🪙</b></div>` : ''}
    ${purseMul > 1 ? `<div class="sum-row"><span>${curMap().name} purse</span><b>×${purseMul}</b></div>` : ''}
    ${buxLine}
    <div class="sum-row"><span>Personal best</span><b>${best}m</b></div>
    <div class="sum-row"><span>Blocks lost with the boat</span><b>${lost}</b></div>`;
  $('#sum-gold').textContent = earned.toLocaleString();
  $('#summary').classList.remove('hidden');
  // Whatever survived goes down with the run: creations do not come home.
  clearBoat(false);
  buildPalette();
  saveSoon();
}

$('#sum-back').addEventListener('click', () => {
  $('#summary').classList.add('hidden');
  $('#treasure').classList.add('hidden');
  // back at the dock with a clean plot — build the next one out of your stock
  clearBoat(false);
  buildPalette();
  boat.x = 0; boat.y = 0; boat.z = HARBOUR_Z;
  boatGroup.rotation.set(0, 0, 0);
  setMode('build');
  refreshVitals();
  publishBoat();
});

// ---------------------------------------------------------------- camera rig
// Building and sailing keep SEPARATE orbits. Sharing one yaw meant that
// orbiting your boat on the plot — which the on-screen hint tells you to do —
// left the chase camera pointing sideways the instant you launched.
// yaw = Math.PI looks down the river (+Z), which is the default for both.
const CAM = {
  build: { yaw: Math.PI, pitch: 0.42, dist: 19 },
  sail:  { yaw: Math.PI, pitch: 0.30, dist: 26 },
};
const cam = () => CAM[mode];
let lastLook = -99;            // when the player last dragged, for auto-recentre

// shortest-way-round interpolation, so recentring never spins the long way
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch needs real multi-touch bookkeeping. The old code kept ONE lastX/lastY:
// a second finger overwrote it and then both fingers diffed against the same
// point, so every move jumped between them and the camera whipped around.
// Now each pointer tracks its own position; one finger orbits, two pinch-zoom.
const pointers = new Map();          // pointerId -> { x, y }
let pinchDist = 0;
let gestureMoved = 0, gestureStart = 0;
const isTouch = matchMedia('(pointer: coarse)').matches;
const TAP_SLOP = isTouch ? 16 : 6;   // a finger always wobbles more than a mouse
let eraser = false;                  // touch has no right-click, so it needs a mode
let touchSteer = 0;                  // -1 / 0 / +1 from the on-screen arrows

function twoFingerDist() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

let lastPX = null, lastPY = null;
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  lastPX = e.clientX; lastPY = e.clientY;
  updateGhost(e.clientX, e.clientY);
  canvas.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) { gestureMoved = 0; gestureStart = performance.now(); }
  if (pointers.size === 2) pinchDist = twoFingerDist();
});

// hovering with a mouse previews continuously; touch has no hover, so the
// preview follows your finger while the gesture could still become a tap
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (!isTouch) { lastPX = e.clientX; lastPY = e.clientY; updateGhost(e.clientX, e.clientY); }
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  const c = cam();

  if (pointers.size >= 2) {
    // two fingers pinch the zoom and never rotate — mixing the two is what
    // made the view spin on touch
    const d = twoFingerDist();
    if (pinchDist > 0) c.dist = clamp(c.dist * (pinchDist / d), 7, 90);
    pinchDist = d;
    gestureMoved = 1e9;              // a pinch is never a tap
    return;
  }

  gestureMoved += Math.abs(dx) + Math.abs(dy);
  lastPX = e.clientX; lastPY = e.clientY;
  if (gestureMoved < TAP_SLOP) updateGhost(e.clientX, e.clientY);   // still a tap
  else ghost.visible = false;                                       // now an orbit
  c.yaw -= dx * 0.006;
  c.pitch = clamp(c.pitch + dy * 0.005, 0.05, 1.42);
  lastLook = performance.now() / 1000;
});

function endPointer(e, cancelled) {
  const wasSingle = pointers.size === 1;
  if (isTouch) ghost.visible = false;
  pointers.delete(e.pointerId);
  canvas.releasePointerCapture?.(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (cancelled) { gestureMoved = 1e9; return; }
  // one finger, held briefly and barely moved = a build tap
  if (wasSingle && mode === 'build'
      && gestureMoved < TAP_SLOP && performance.now() - gestureStart < 700) {
    tryBuild(e.clientX, e.clientY, e.button === 2 || e.shiftKey || eraser);
  }
}
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
// without this an interrupted touch left the camera spinning from stale coords
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));

canvas.addEventListener('wheel', (e) => {
  const c = cam();
  c.dist = clamp(c.dist + Math.sign(e.deltaY) * 2.5, 7, 90);
}, { passive: true });

addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea')) return;
  keys.add(e.key.toLowerCase());
  const n = parseInt(e.key, 10);
  if (mode === 'build' && n >= 1 && n <= 9) {
    const list = BLOCKS.filter((b) => have(b.id) > 0);
    if (list[n - 1]) { selected = list[n - 1].id; buildPalette(); }
  }
  if (e.key === 'Enter' && mode === 'build') launch();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _nrm = new THREE.Matrix3();
const _wn = new THREE.Vector3();
const _lp = new THREE.Vector3();

// Placement preview: a white outlined box showing exactly which cell the next
// tap/click would fill. It lives inside boatGroup so it shares the grid's space.
const ghost = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false }));
ghost.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: '#ffffff' })));
ghost.visible = false;
ghost.renderOrder = 2;
boatGroup.add(ghost);

// Where would a click at these screen coords land? Returns the grid cell, or
// null. `remove` mode targets the block under the cursor instead of the space
// next to it. Shared by the ghost and the actual build so they never disagree.
function pickTarget(clientX, clientY, remove) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);

  const meshes = [];
  for (const b of blocks.values()) meshes.push(b.mesh);
  const hits = ray.intersectObjects(meshes, true);
  if (hits.length) {
    let root = hits[0].object;
    while (root && root.userData.k === undefined) root = root.parent;
    const b = root && blocks.get(root.userData.k);
    if (!b) return null;
    if (remove) return { gx: b.gx, gy: b.gy, gz: b.gz, remove: true };
    // take the hit face into world space, then snap to the dominant axis, so
    // the preview is right even on the rotated parts of a sail or thruster
    _wn.copy(hits[0].face.normal)
       .applyMatrix3(_nrm.getNormalMatrix(hits[0].object.matrixWorld)).normalize();
    const ax = Math.abs(_wn.x), ay = Math.abs(_wn.y), az = Math.abs(_wn.z);
    let dx = 0, dy = 0, dz = 0;
    if (ax >= ay && ax >= az) dx = Math.sign(_wn.x);
    else if (ay >= az) dy = Math.sign(_wn.y);
    else dz = Math.sign(_wn.z);
    return { gx: b.gx + dx, gy: b.gy + dy, gz: b.gz + dz };
  }
  if (remove) return null;
  const padHit = ray.intersectObject(pad, false)[0];
  if (!padHit) return null;
  boatGroup.worldToLocal(_lp.copy(padHit.point));
  return { gx: Math.round(_lp.x + (PS - 1) / 2), gy: 0, gz: Math.round(_lp.z + (PS - 1) / 2) };
}

const inPlot = (t) => t && t.gx >= 0 && t.gx < PS && t.gy >= 0 && t.gy < PS && t.gz >= 0 && t.gz < PS;

function updateGhost(clientX, clientY) {
  if (mode !== 'build' || clientX == null) { ghost.visible = false; return; }
  const t = pickTarget(clientX, clientY, eraser);
  const ok = inPlot(t) && (eraser
    ? t.remove                                     // something there to take off
    : !blocks.has(key(t.gx, t.gy, t.gz)) && have(selected) > 0 && blocks.size < blockLimit());
  ghost.visible = !!ok;
  if (!ok) return;
  ghost.position.copy(localPos(t.gx, t.gy, t.gz));
  // white to place, red to erase
  const col = eraser ? '#ff5d6c' : '#ffffff';
  ghost.material.color.set(col);
  ghost.children[0].material.color.set(col);
  ghost.material.opacity = eraser ? 0.3 : 0.25;
}

function tryBuild(clientX, clientY, remove) {
  const t = pickTarget(clientX, clientY, remove);
  if (!t) return;
    if (t.remove) {
    removeBlock(key(t.gx, t.gy, t.gz), true);
    const dropped = settleStructure(true);      // refunded: a build mistake costs nothing
    if (dropped) toast(`${dropped} unsupported block${dropped === 1 ? '' : 's'} came off`);
    sfx.remove(); afterEdit(); return;
  }
  if (addBlock(selected, t.gx, t.gy, t.gz)) { sfx.place(selected); afterEdit(); return; }
  sfx.deny();
  if (!inPlot(t)) atCapToast();                                   // outside the cube
  else if (have(selected) <= 0) toast(`Out of ${BLOCK_BY_ID[selected]?.name || 'blocks'}`);
  else if (blocks.size >= blockLimit()) toast('Boat is at the safety limit');
}

const refreshGhost = () => updateGhost(lastPX, lastPY);

function afterEdit() {
  if (have(selected) <= 0) {                       // ran out — hop to something you do have
    const next = BLOCKS.find((b) => have(b.id) > 0);
    if (next) selected = next.id;
  }
  buildPalette(); refreshVitals(); publishBoat(); saveSoon(); refreshGhost();
}

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
  let steer = touchSteer;   // on-screen buttons; phones have no A/D
  if (keys.has('a') || keys.has('arrowleft')) steer -= 1;
  if (keys.has('d') || keys.has('arrowright')) steer += 1;
  steer = clamp(steer, -1, 1);
  boat.x += steer * 7 * dt;
  if (boat.z < STAGE_LEN) boat.x = lerp(boat.x, 0, 1 - Math.exp(-1.1 * dt));
  boat.x = clamp(boat.x, -RIVER.width / 2 + 1, RIVER.width / 2 - 1);

  // stage tracking + payout pips
  const stages = stagesOf(mapId);
  const si = stageIndexAt(boat.z, mapId);
  if (si !== lastStageIdx) {
    lastStageIdx = si;
    stagesEntered = si + 1;
    $('#stage-name').textContent = stages[si].name;
    $('#stage-name').style.color = BAND_COLOR[stages[si].band];
    announceStage(stages[si]);
    if (si > 0) sfx.stageUp();
    scene.background = new THREE.Color(stages[si].sky);
    scene.fog.color = new THREE.Color(stages[si].sky);
    updatePips(si);
    if (stages[si].band === 'red') window.ClaudeBox?.completeChallenge?.('bab-red');
  }

  // a floating hull rides the swell; a sinking one lists heavily
  bobT += dt * (1.6 + speed * 0.05);
  const heel = s.float >= 1 ? Math.sin(bobT * 0.7) * 0.045 : -0.35;
  boatGroup.rotation.z = lerp(boatGroup.rotation.z, heel + steer * -0.12, 1 - Math.exp(-4 * dt));
  boatGroup.rotation.x = lerp(boatGroup.rotation.x, Math.sin(bobT) * 0.03, 1 - Math.exp(-4 * dt));

  // foam trail behind the hull
  wake.visible = true;
  wake.position.set(boat.x, WATER_TOP + 0.05, boat.z - 13);
  wake.material.opacity = 0.14 + Math.min(0.3, speed * 0.02);
  wake.scale.x = 0.6 + Math.min(1.6, s.count / 22);

  // light the thruster flames in proportion to the power actually installed
  for (const b of blocks.values()) {
    if (BLOCK_BY_ID[b.id]?.kind !== 'thruster') continue;
    const f = b.mesh.getObjectByName?.('flame');
    if (f) { f.visible = true; f.scale.setScalar(0.8 + Math.sin(t * 26 + b.gx) * 0.22); }
  }
  sfx.setRiver(Math.min(1, speed / 26));
  sfx.setThruster(s.thrust);

  applyHazards(dt, t);

  if (boat.z >= treasureAt(mapId) && !gotTreasure) { gotTreasure = true; finishRun(true); return; }

  // HUD — 10Hz is plenty, and it keeps style recalculation off the frame path
  hudT += dt;
  if (hudT >= 0.1) {
    hudT = 0;
    const pct = clamp(boat.z / totalLen(mapId), 0, 1);
    const right = `${(1 - pct) * 100}%`;
    const pf = $('#progress-fill');
    if (pf.__r !== right) { pf.__r = right; pf.style.right = right; }
    setText($('#progress-label'), `${Math.round(boat.z)}m`);
    refreshVitals();
    net.send({ t: 'progress', dist: boat.z, blocks: s.count });
  }
}

let bannerTimer = null;
function announceStage(st) {
  const el = $('#stage-banner');
  $('#sb-name').textContent = st.name;
  $('#sb-band').textContent = st.band === 'end' ? 'FINAL STRETCH' : st.band + ' zone';
  $('#sb-name').style.color = BAND_COLOR[st.band];
  el.classList.remove('hidden', 'out');
  void el.offsetWidth;                     // restart the entrance animation
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.classList.add('hidden'), 480);
  }, 1600);
}

function updatePips(si) {
  const wrap = $('#stage-pips');
  const stages = stagesOf(mapId);
  if (wrap.children.length !== stages.length) {
    wrap.innerHTML = stages.map(() => '<i></i>').join('');
  }
  [...wrap.children].forEach((el, i) => {
    el.style.background = i <= si ? BAND_COLOR[stages[i].band] : 'rgba(255,255,255,.2)';
  });
}

// Only draw the stretch of river you can actually see. Without this the Legend
// Gauntlet renders all 452 hazards — several thousand meshes and a point light
// per fireball — every frame, which drags the whole sim into slow motion.
const HAZ_DRAW = COARSE ? 105 : 150;
function cullHazards() {
  const z = mode === 'sail' ? boat.z : 0;
  for (const h of hazards) {
    const near = Math.abs(h.z - z) < HAZ_DRAW;
    if (h.mesh.visible !== near) h.mesh.visible = near;
  }
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
      const wx = boat.x + (b.gx - (PS - 1) / 2);
      const wy = boat.y + b.gy + 0.5;
      const wz = boat.z + (b.gz - (PS - 1) / 2);
      const d = Math.hypot(wx - p.x, wy - p.y, wz - p.z);
      if (d < hitD) { hitD = d; hitK = b.mesh.userData.k; }
    }
    if (hitK && hitD < h.def.r) {
      const b = blocks.get(hitK);
      b.hp -= Math.max(1, Math.round(h.def.dmg * (h.dmgMul || 1)));
      h.nextHit = t + 0.55;
      const maxHp = BLOCK_BY_ID[b.id]?.hp || 1;
      const wp = new THREE.Vector3(
        boat.x + (b.gx - (PS - 1) / 2), boat.y + b.gy + 0.5, boat.z + (b.gz - (PS - 1) / 2));
      if (b.hp <= 0) {
        parts.burst(wp, BLOCK_BY_ID[b.id]?.color || '#b3803f', 12, { spread: 7, up: 6 });
        parts.burst(wp, '#bfe6ff', 6, { spread: 5, up: 5, size: 0.8 });
        sfx.breakBlock();
        removeBlock(hitK);
        // whatever that block was holding up is no longer attached
        const dropped = settleStructure(false);
        if (dropped) {
          shake = Math.min(1, shake + 0.35);
          if (dropped > 2) toast(`${dropped} blocks broke away!`);
        }
        shake = Math.min(1, shake + 0.55);
      } else {
        tintDamaged(b.mesh, b.hp / maxHp);
        parts.burst(wp, '#ffd9a0', 5, { spread: 4, up: 4, size: 0.7, life: 0.5 });
        sfx.hit(b.id);
        shake = Math.min(1, shake + 0.3);
      }
    }
  }
}

function finishRun(treasure) {
  if (mode !== 'sail') return;
  setMode('build');
  wake.visible = false;
  sfx.setThruster(0);
  if (treasure) {
    sfx.treasure();
    $('#treasure').classList.remove('hidden');
    window.ClaudeBox?.completeChallenge?.('bab-treasure');
    setTimeout(() => endRun(true), 1500);
  } else { sfx.sink(); endRun(false); }
}

// ---------------------------------------------------------------- camera
// Smoothed orbit rig. Both modes place the camera on a sphere around a focus
// point and ease toward it, so nothing ever snaps — including the long trip
// back from the treasure to the dock.
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
// scratch vectors, reused every frame so the camera allocates nothing
const _focus = new THREE.Vector3(), _want = new THREE.Vector3(), _look = new THREE.Vector3();
let camReady = false;
const snapCamera = () => { camReady = false; };

// While building, frame the BOAT rather than a fixed spot in space, so a tall
// or wide build stays centred instead of growing off the top of the screen.
function buildFocus(out) {
  const g = boatGroup.position;
  if (!blocks.size) return out.set(g.x, 2.5, g.z);
  let sx = 0, sy = 0, sz = 0, maxY = 0;
  for (const b of blocks.values()) {
    sx += b.gx; sy += b.gy; sz += b.gz;
    if (b.gy > maxY) maxY = b.gy;
  }
  const n = blocks.size;
  const l = localPos(sx / n, sy / n, sz / n);
  return out.set(g.x + l.x, Math.max(2, l.y + maxY * 0.3), g.z + l.z);
}

function updateCamera(dt, now) {
  const c = cam();

  // sailing: once you stop looking around, drift back to behind the boat
  if (mode === 'sail' && now - lastLook > 1.2 && pointers.size === 0) {
    c.yaw = angleLerp(c.yaw, Math.PI, 1 - Math.exp(-2.4 * dt));
  }

  const focus = mode === 'build'
    ? buildFocus(_focus)
    : _focus.set(boat.x, boat.y + 3.2, boat.z);

  // pure orbit around the focus — no world-space fudge, so rotating keeps the
  // subject dead centre at every yaw
  const want = _want.set(
    focus.x + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist,
    focus.y + Math.sin(c.pitch) * c.dist,
    focus.z + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist);
  want.y = Math.max(want.y, 1.5);        // never duck below the waterline

  // Look down the river so you can read what is coming — but only to the extent
  // you are actually facing that way. Applying the full lead at every yaw shoved
  // the boat off-centre whenever you looked at it side-on.
  const look = _look.copy(focus);
  if (mode === 'sail') look.z += 10 * Math.max(0, -Math.cos(c.yaw));

  if (!camReady) { camPos.copy(want); camLook.copy(look); camReady = true; }
  const k = 1 - Math.exp(-10 * dt);
  camPos.lerp(want, k);
  camLook.lerp(look, k);
  camera.position.copy(camPos);
  // impact kick — small, and always decaying, so it reads as a thump not a wobble
  if (shake > 0.001) {
    const k = shake * shake * 0.7;
    camera.position.x += (Math.random() - 0.5) * k;
    camera.position.y += (Math.random() - 0.5) * k;
  }
  camera.lookAt(camLook);
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
  parts.step(dt);
  stepFalling(dt);
  cullHazards();
  shake = Math.max(0, shake - dt * 2.6);
  updateCamera(dt, now);

  // remote boats ride their own distance, nudged aside so they do not overlap
  for (const r of remotes.values()) {
    const o = plotOrigin(r.plot);
    if (r.sailing) r.group.position.set(clamp(o.x * 0.08, -11, 11), 0, r.dist);
    else r.group.position.set(o.x, 0, HARBOUR_Z);
  }

  // gentle water shimmer
  waterTex.offset.y = (now * 0.06) % 1;    // the current, visibly running
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
  await refreshChampion();
  await loadSave(myName);
  buildRiver();
  buildMapPicker();
  setGold(gold);
  buildPalette();
  refreshVitals();
  updatePips(-1);
  setMode('build');

  // on-screen steering: a phone has no A/D keys
  if (isTouch) {
    for (const [id, dir] of [['tilt-l', -1], ['tilt-r', 1]]) {
      const b = $('#' + id);
      const set = (v) => (e) => { e.preventDefault(); touchSteer = v; };
      b.addEventListener('pointerdown', set(dir));
      b.addEventListener('pointerup', set(0));
      b.addEventListener('pointercancel', set(0));
      b.addEventListener('pointerleave', set(0));
    }
  }

  net.connect();
  net.join({ name: myName, avatar: profile, code: localStorage.getItem('claudebox.code') || '' });

  $('#loading').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  requestAnimationFrame(frame);

  window.__bab = { boat, blocks, boatStats, hazards, launch, endRun, net, scene,
    camera, CAM, buildFocus, THREE, addBlock, removeBlock, limit, limitOf: limit,
    get rank() { return rank; }, get inv() { return inv; }, get mapId() { return mapId; },
    get plotSize() { return PS; }, get pad() { return pad; },
    setMap, stages: () => stagesOf(mapId), treasureAt: () => treasureAt(mapId), buildPalette, renderer, ghost, pickTarget,
    settleStructure, falling, get lastLook() { return lastLook; }, set lastLook(v) { lastLook = v; },
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
