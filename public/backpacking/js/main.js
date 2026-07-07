// Backpacking — client entry point.
// Boot: ClaudeBox identity → world → join /bp-ws → game loop.

import * as THREE from 'three';
import {
  WORLD, height, groundAt, waterAt, lavaAt, regionAt, inLodge,
} from '/shared/bp/worldgen.js';
import { device, effectiveMode } from '/js/device.js';
import { audio } from './audio.js';
import { Net, InterpBuffer } from './net.js';
import { loadIdentity, buildPlayerAvatar, makePlayerAnimState, animatePlayer, makeRagdoll } from './player/avatar.js';
import { FootController } from './player/controller.js';
import { OrbitCamera } from './player/camera.js';
import { DesktopControls } from './controls/desktop.js';
import { MobileControls } from './controls/mobile.js';
import { buildTerrain } from './world/terrain.js';
import { buildRoads } from './world/roads.js';
import { buildProps, buildWater } from './world/props.js';
import { Sky } from './world/sky.js';
import { buildVanMesh, VanSim, SEATS } from './systems/vans.js';
import { buildBearMesh, makeBearAnim, animateBear } from './systems/bears.js';
import {
  buildItemMesh, buildHeldMesh, setMallowRoast, placementValid, catalogEntry,
} from './systems/items.js';
import { Nametag } from './ui/nametags.js';
import { Chat, toast } from './ui/chat.js';
import { Hud } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { Inventory } from './ui/inventory.js';
import { MapUI } from './ui/minimap.js';

const status = (s) => { const el = document.getElementById('load-status'); if (el) el.textContent = s; };

// ============================ identity ============================
const identity = await loadIdentity();

// ============================ renderer ============================
status('Pitching the tents…');
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, WORLD.size * 3.4);

const game = {
  renderer, scene, camera,
  me: { id: null, name: identity.name, avatar: identity.avatar },
  players: new Map(),
  bears: new Map(),
  vans: new Map(),
  items: new Map(),
  colliders: [],
  platforms: [],
  itemSurface: null,
  driving: false,
  vanSim: null,
  seated: null,
  lockedAnim: null,
  roast: { stage: 'raw', t: 0 },
  clock: 0.18,
  audio,
  settings: loadLocalSettings(),
};
window.__game = game;

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- graphics quality ----------
// The world is heavy (a 10k-tree instanced forest + a big terrain). On a
// constrained browser — notably Opera GX with its GX Control RAM/GPU limiter,
// or any setup with hardware acceleration off — that can starve the GPU and
// the map/colliders silently never render. So we pick a quality tier, let the
// player force Low, and recover if the GPU context is lost.
function glRenderer() {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '').toLowerCase();
  } catch { return ''; }
}
function resolveQuality() {
  const pref = game.settings.graphics || 'auto';
  if (pref === 'high' || pref === 'low') return pref;
  if (sessionStorage.getItem('bp.forceLow') === '1') return 'low';           // set after a context loss
  if (/swiftshader|llvmpipe|software|basic render/.test(glRenderer())) return 'low'; // no hardware GPU
  if ((navigator.deviceMemory || 8) <= 4 && (navigator.hardwareConcurrency || 8) <= 4) return 'low';
  return 'high';
}
function showWorldError(_err, q, autoLow) {
  const veil = document.getElementById('loading');
  const card = veil && veil.querySelector('.load-card');
  if (!veil || !card) return;
  veil.classList.remove('hidden');
  if (autoLow) {
    card.innerHTML = '<div class="load-logo">🗺️</div><h1>Loading a lighter map…</h1>'
      + '<p>Your browser ran low on graphics memory — switching to Low detail.</p>';
    setTimeout(() => location.reload(), 1600);
    return;
  }
  const bs = 'margin:10px 6px 0;padding:11px 20px;border:none;border-radius:11px;font:inherit;font-weight:bold;cursor:pointer;background:#2f7fd6;color:#fff';
  card.innerHTML = '<div class="load-logo">😵‍💫</div><h1>The map couldn\'t load</h1>'
    + '<p style="opacity:.82;max-width:340px;line-height:1.5">Your browser\'s graphics look limited'
    + (q === 'low' ? ' (even on Low)' : '') + '. In <b>Opera GX</b>, open <b>GX Control</b> and turn the '
    + 'RAM/CPU limiters <b>off</b>, make sure <b>hardware acceleration</b> is on, then reload.</p>';
  const reload = document.createElement('button'); reload.textContent = '🔄 Reload'; reload.style.cssText = bs;
  reload.onclick = () => location.reload();
  const home = document.createElement('button'); home.textContent = '🎮 Home'; home.style.cssText = bs + ';background:#3a4656';
  home.onclick = () => { location.href = '/'; };
  card.appendChild(reload); card.appendChild(home);
}
// A lost GPU context (common the moment a RAM cap is hit) → drop to Low + reload once.
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const alreadyLow = game.settings.graphics === 'low' || sessionStorage.getItem('bp.forceLow') === '1';
  if (!alreadyLow) { sessionStorage.setItem('bp.forceLow', '1'); showWorldError(e, 'auto', true); }
  else showWorldError(e, 'low', false);
});

// ============================ world ============================
const quality = resolveQuality();
game.quality = quality;
const sky = new Sky(scene);
let water = null;
try {
  scene.add(buildTerrain(quality));
  status('Paving the roads…');
  scene.add(buildRoads());
  water = buildWater();
  scene.add(water);
  status('Growing the forest…');
  const props = buildProps(sky, quality);
  scene.add(props);
  game.colliders.push(...(props.userData.trunks || []));
  game.platforms.push(...(props.userData.platforms || []));
} catch (err) {
  console.error('[bp] world build failed at quality:', quality, err);
  // fall to Low automatically once; otherwise show a clear, actionable error.
  if (quality !== 'low' && sessionStorage.getItem('bp.forceLow') !== '1') {
    sessionStorage.setItem('bp.forceLow', '1');
    showWorldError(err, 'auto', true);
  } else {
    showWorldError(err, quality, false);
  }
  throw err; // halt boot so the error card stays up instead of a broken, empty world
}

// ============================ my avatar ============================
let myAvatar = buildPlayerAvatar(game.me.avatar);
const meGroup = new THREE.Group();
meGroup.add(myAvatar.group);
const myTag = new Nametag();
myTag.update(game.me.name);
myTag.sprite.position.y = 2.1;
meGroup.add(myTag.sprite);
scene.add(meGroup);
let myAnim = makePlayerAnimState();
let heldMesh = null;
let ragdolls = [];

// ---- flashlight: a held spotlight that lights the way at night ----
const flashlight = new THREE.SpotLight('#fff2cc', 0, 42, Math.PI / 7, 0.45, 1.1);
const flashTarget = new THREE.Object3D();
scene.add(flashlight, flashTarget);
flashlight.target = flashTarget;
game.flashlightOn = false;

const player = new FootController(game);
game.player = player;
player.spawnAt(WORLD.spawn.x, WORLD.spawn.z);

const orbit = new OrbitCamera(camera);
orbit.sensitivity = game.settings.camSensitivity;
game.orbit = orbit;

// ============================ UI ============================
const hud = new Hud(game);
const panels = new Panels();
game.panels = panels;
const chat = new Chat(game);
game.chat = chat;
const inventory = new Inventory(game);
game.inventory = inventory;
const mapUI = new MapUI(game);

document.getElementById('hud').classList.remove('hidden');
document.getElementById('hud-settings-btn').addEventListener('click', () => {
  panels.toggle('settings', buildSettingsPanel);
});

let controls = null;
let controlsMode = null;
function applyControlsMode(mode) {
  if (mode === controlsMode) return;
  controls?.destroy?.();
  controlsMode = mode;
  controls = mode === 'mobile' ? new MobileControls(game) : new DesktopControls(game);
  game.controls = controls;
  if (mode === 'mobile') controls.setMode(game.driving ? 'drive' : 'foot');
}
game.applyControlsMode = applyControlsMode;
applyControlsMode(effectiveMode(game.settings.controlsMode));

addEventListener('pointerdown', () => audio.unlock(), { once: true });
addEventListener('keydown', () => audio.unlock(), { once: true });
addEventListener('touchstart', () => audio.unlock(), { once: true });

// ============================ helpers ============================
function playerRecord(p) {
  const built = buildPlayerAvatar(p.avatar || {});
  const group = new THREE.Group();
  group.add(built.group);
  const tag = new Nametag();
  tag.update(p.name);
  tag.sprite.position.y = 2.1;
  group.add(tag.sprite);
  scene.add(group);
  return { data: p, group, avatarGroup: built.group, parts: built.parts, anim: makePlayerAnimState(), interp: new InterpBuffer(), tag, hidden: false };
}

function addItemToWorld(id, item) {
  if (game.items.has(id)) return;
  const mesh = buildItemMesh(item.kind, item.color, sky);
  mesh.position.set(item.x, item.y, item.z);
  mesh.rotation.y = item.ry;
  scene.add(mesh);
  const lampRecs = (mesh.userData.lampSpecs || []).map((spec) =>
    sky.addLamp({ ...spec, x: item.x, y: item.y + spec.y, z: item.z })
  );
  const colliders = [];
  if (mesh.userData.collider) {
    colliders.push({ x: item.x, z: item.z, r: mesh.userData.collider.r, top: item.y + mesh.userData.collider.top });
  }
  // multi-collider items (e.g. walk-in tent walls with a doorway gap): offsets
  // are local to the item and rotated by its facing
  const cos = Math.cos(item.ry), sin = Math.sin(item.ry);
  for (const c of mesh.userData.colliders || []) {
    colliders.push({
      x: item.x + c.dx * cos + c.dz * sin,
      z: item.z - c.dx * sin + c.dz * cos,
      r: c.r, top: item.y + c.top,
    });
  }
  colliders.forEach((c) => game.colliders.push(c));
  game.items.set(id, { data: item, mesh, lampRecs, colliders });
}

function removeItemFromWorld(id) {
  const rec = game.items.get(id);
  if (!rec) return;
  scene.remove(rec.mesh);
  rec.lampRecs.forEach((l) => sky.removeLamp(l));
  for (const c of rec.colliders || []) {
    const i = game.colliders.indexOf(c);
    if (i >= 0) game.colliders.splice(i, 1);
  }
  game.items.delete(id);
}

function vanRecord(v) {
  const built = buildVanMesh(game.vans.size, sky);
  built.group.rotation.order = 'YXZ';
  built.group.position.set(v.x, v.y, v.z);
  built.group.rotation.y = v.ry;
  scene.add(built.group);
  return { data: v, ...built, interp: new InterpBuffer(), seats: v.seats || [null, null, null, null, null, null], speed: v.speed || 0 };
}

function bearRecord(b) {
  const built = buildBearMesh(b.variant);
  built.group.position.set(b.x, b.y, b.z);
  scene.add(built.group);
  return { data: b, ...built, anim: makeBearAnim(), interp: new InterpBuffer(), serverAnim: 'walk' };
}

// equip / held item
function refreshHeld() {
  if (heldMesh) { heldMesh.parent?.remove(heldMesh); heldMesh = null; }
  const eq = inventory.equipped;
  if (!eq) return;
  const entry = catalogEntry(eq.kind);
  if (entry?.held) {
    heldMesh = buildHeldMesh(eq.kind);
    heldMesh.position.set(0, -0.6, 0.12);
    myAvatar.parts.armR.add(heldMesh);
    if (eq.kind === 'marshmallow') {
      game.roast = { stage: 'raw', t: 0 };
      setMallowRoast(heldMesh, 0);
    }
  } else {
    refreshGhost();
  }
}
game.onEquipChanged = () => { refreshHeld(); refreshGhost(); };

// placement ghost
let ghost = null;
function refreshGhost() {
  if (ghost) { scene.remove(ghost); ghost = null; }
  const eq = inventory.equipped;
  if (!eq) return;
  const entry = catalogEntry(eq.kind);
  if (!entry || entry.held) return;
  ghost = buildItemMesh(eq.kind, eq.color || '#4f8a55', sky);
  ghost.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.55;
    }
  });
  scene.add(ghost);
}

function ghostPos() {
  const a = player.ry;
  const d = 3.4;
  const x = player.pos.x + Math.sin(a) * d;
  const z = player.pos.z + Math.cos(a) * d;
  return { x, z, y: groundAt(x, z) };
}

// ============================ actions ============================
let roastTimer = 0;

game.actions = {
  primary() {
    const list = computeActions();
    const a = list.find((x) => x.kind === 'primary' || x.kind === 'urgent');
    a?.fn();
  },
  backpack() { inventory.toggle(); },
  map() { mapUI.toggleFull(); },
  flashlight() { game.flashlightOn = !game.flashlightOn; },
  hotbar(i) { if (inventory.hotbar[i]) inventory.setActive(i); },
  unequip() { inventory.clearActive(); },
  vanToggle() {
    if (game.driving || myVanId() != null) { net.send({ t: 'van.exit' }); return; }
    const van = nearestVan(7);
    if (van) { net.send({ t: 'van.enter', vanId: van.data.id }); window.ClaudeBox?.completeChallenge('bp-drive'); }
  },
};

function myVanId() {
  return game.meVanId ?? null;
}

function nearestVan(maxD) {
  let best = null, bd = maxD;
  for (const rec of game.vans.values()) {
    const d = Math.hypot(rec.group.position.x - player.pos.x, rec.group.position.z - player.pos.z);
    if (d < bd) { bd = d; best = rec; }
  }
  return best;
}

function nearestOwnItem(maxD) {
  let best = null, bd = maxD;
  for (const [id, rec] of game.items) {
    if (rec.data.owner !== game.me.name.toLowerCase()) continue;
    const d = Math.hypot(rec.data.x - player.pos.x, rec.data.z - player.pos.z);
    if (d < bd) { bd = d; best = { id, rec }; }
  }
  return best;
}

function nearestSittable(maxD) {
  let best = null, bd = maxD;
  for (const [id, rec] of game.items) {
    if (rec.mesh.userData.seatY == null) continue;
    const d = Math.hypot(rec.data.x - player.pos.x, rec.data.z - player.pos.z);
    if (d < bd) { bd = d; best = { id, rec }; }
  }
  return best;
}

function nearCampfire(maxD = 4.2) {
  for (const rec of game.items.values()) {
    if (rec.data.kind !== 'campfire') continue;
    if (Math.hypot(rec.data.x - player.pos.x, rec.data.z - player.pos.z) < maxD) return rec;
  }
  return false;
}

function computeActions() {
  const list = [];
  if (game.dead) return list;

  if (game.driving) {
    if (game.vanSim?.tipped) {
      list.push({ id: 'reset', label: 'Reset van', emoji: '🔄', kind: 'urgent', fn: () => net.send({ t: 'van.reset', vanId: game.vanSim.id }) });
    }
    list.push({ id: 'exit', label: 'Park & exit', emoji: '🚪', kind: 'primary', hotkey: 'F', fn: () => game.actions.vanToggle() });
    return list;
  }
  if (myVanId() != null) {
    list.push({ id: 'exit', label: 'Hop out', emoji: '🚪', kind: 'primary', hotkey: 'F', fn: () => game.actions.vanToggle() });
    return list;
  }
  if (game.seated) {
    list.push({ id: 'stand', label: 'Stand up', emoji: '🧍', kind: 'primary', hotkey: 'E', fn: standUp });
    return list;
  }

  const eq = inventory.equipped;
  const entry = eq && catalogEntry(eq.kind);

  // marshmallow roasting
  if (eq?.kind === 'marshmallow') {
    const fire = nearCampfire();
    if (game.roast.stage === 'roasted') {
      list.push({ id: 'eat', label: 'Eat marshmallow', emoji: '😋', kind: 'primary', hotkey: 'E', fn: eatMallow });
    } else if (fire && game.roast.stage === 'raw') {
      list.push({ id: 'roast', label: 'Roast marshmallow', emoji: '🔥', kind: 'primary', hotkey: 'E', fn: startRoast });
    } else if (game.roast.stage === 'roasting') {
      list.push({ id: 'roasting', label: 'Roasting…', emoji: '⏳', fn: () => {} });
    } else if (!fire) {
      list.push({ id: 'needfire', label: 'Find a campfire…', emoji: '🔥', fn: () => {} });
    }
  } else if (eq?.kind === 'bearspray') {
    list.push({ id: 'spray', label: 'SPRAY!', emoji: '💨', kind: 'urgent', hotkey: 'E', fn: doSpray });
  } else if (entry && !entry.held) {
    const pos = ghostPos();
    const ok = placementValid(eq.kind, pos.x, pos.z);
    list.push({
      id: 'place', label: ok ? `Place ${entry.label}` : "Can't place here", emoji: ok ? '📍' : '🚫',
      kind: ok ? 'primary' : '', hotkey: 'E',
      fn: () => { if (ok) { net.send({ t: 'place', kind: eq.kind, x: pos.x, z: pos.z, ry: player.ry + Math.PI, color: eq.color }); if (eq.kind === 'tent') window.ClaudeBox?.completeChallenge('bp-camp'); } },
    });
  } else {
    const van = nearestVan(6.5);
    if (van) {
      const free = van.seats.filter((s) => s === null).length;
      list.push({ id: 'van', label: free ? `Enter van (${free} seats)` : 'Van is full', emoji: '🚐', kind: free ? 'primary' : '', hotkey: 'F', fn: () => game.actions.vanToggle() });
    }
    const sit = nearestSittable(3);
    if (sit) {
      list.push({ id: 'sit', label: sit.rec.mesh.userData.lie ? 'Lie down' : 'Sit', emoji: '🪑', kind: van ? '' : 'primary', hotkey: 'E', fn: () => sitOn(sit) });
    }
    const own = nearestOwnItem(4);
    if (own) {
      list.push({ id: 'pickup', label: `Pack up ${catalogEntry(own.rec.data.kind)?.label || 'item'}`, emoji: '🎒', hotkey: 'E', kind: van || sit ? '' : 'primary', fn: () => net.send({ t: 'pickup', id: own.id }) });
    }
  }

  list.push({ id: 'backpack', label: 'Backpack', emoji: '🎒', hotkey: 'B', fn: () => inventory.toggle() });
  list.push({ id: 'map', label: 'Map', emoji: '🗺️', hotkey: 'M', fn: () => mapUI.toggleFull() });
  list.push({ id: 'flashlight', label: game.flashlightOn ? 'Light off' : 'Flashlight', emoji: '🔦', hotkey: 'L', fn: () => game.actions.flashlight() });
  list.push({ id: 'chat', label: 'Chat', emoji: '💬', fn: () => chat.openInput() });
  return list;
}

function startRoast() {
  game.roast = { stage: 'roasting', t: 0 };
  game.lockedAnim = 'roast';
  player.locked = true;
  roastTimer = 4;
  net.send({ t: 'pose', kind: 'roast' });
}

function eatMallow() {
  game.roast = { stage: 'raw', t: 0 };
  setMallowRoast(heldMesh, 0);
  toast('Mmm… toasty! 😋');
  net.send({ t: 'pose', kind: 'eat' });
  net.send({ t: 'chat', text: '*eats a perfectly roasted marshmallow*' });
}

function doSpray() {
  const dirX = Math.sin(player.ry), dirZ = Math.cos(player.ry);
  net.send({ t: 'spray', dirX, dirZ });
  game.lockedAnim = 'spray';
  player.locked = true;
  setTimeout(() => { if (game.lockedAnim === 'spray') { player.locked = false; game.lockedAnim = null; } }, 700);
}

function sitOn(sit) {
  game.seated = sit;
  player.locked = true;
  const lie = sit.rec.mesh.userData.lie;
  game.lockedAnim = lie ? 'lie' : 'sit';
  const surface = sit.rec.data.y + sit.rec.mesh.userData.seatY;
  player.pos.x = sit.rec.data.x;
  player.pos.z = sit.rec.data.z;
  // the avatar's hips sit ~0.84 above its feet-origin, so a sitter must DROP
  // by that much to rest on the seat instead of floating above it; a lier
  // rests flat on the mattress (the render lays the body horizontal).
  player.pos.y = lie ? surface - 0.1 : surface - 0.78;
  player.ry = sit.rec.data.ry + Math.PI;
  // a lier's body extends from the feet-origin, so nudge back along the facing
  // to centre the body on the mattress instead of the head hanging off the end
  if (lie) { player.pos.x -= Math.sin(player.ry) * 0.85; player.pos.z -= Math.cos(player.ry) * 0.85; }
  net.send({ t: 'pose', kind: game.lockedAnim });
}

function standUp() {
  game.seated = null;
  player.locked = false;
  game.lockedAnim = null;
  player.pos.y = groundAt(player.pos.x, player.pos.z) + 0.3;
  net.send({ t: 'pose', kind: 'stand' });
}

// ============================ networking ============================
status('Radioing the ranger station…');
const net = new Net();
game.net = net;
net.connect();
net.join({ name: game.me.name, avatar: game.me.avatar });

net.on('welcome', (msg) => {
  game.me.id = msg.id;
  game.clock = msg.clock;
  for (const p of msg.players) {
    game.players.set(p.id, playerRecord(p));
    if (p.vanId) game.meVanIdRecheck = true;
  }
  for (const [id, item] of Object.entries(msg.items)) addItemToWorld(id, item);
  for (const v of msg.vans) game.vans.set(v.id, vanRecord(v));
  net.startMovementStream(() => {
    if (game.driving && game.vanSim) {
      const s = game.vanSim;
      return { t: 'van.state', x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), ry: +s.ry.toFixed(3), pitch: +s.pitch.toFixed(3), roll: +s.roll.toFixed(3), speed: +s.speed.toFixed(2) };
    }
    if (myVanId() != null || game.dead) return null;
    return { t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: currentAnim() };
  });
  document.getElementById('loading').classList.add('hidden');
  toast(`Welcome to Backpacking, ${game.me.name}! 🏕️`);
});

net.on('player.join', (msg) => {
  game.players.set(msg.player.id, playerRecord(msg.player));
  toast(`${msg.player.name} arrived at camp! 🏕️`);
});
net.on('player.leave', (msg) => {
  const rec = game.players.get(msg.id);
  if (!rec) return;
  rec.tag.dispose();
  scene.remove(rec.group);
  game.players.delete(msg.id);
});
net.on('player.update', (msg) => {
  if (msg.player.id === game.me.id) {
    game.meVanId = msg.player.vanId;
    game.meSeat = msg.player.seat;
    onMyVanChanged();
    return;
  }
  const rec = game.players.get(msg.player.id);
  if (rec) rec.data = msg.player;
});

net.on('snapshot', (msg) => {
  game.serverClock = msg.clock;
  for (const [id, x, y, z, ry, anim] of msg.players) {
    if (id === game.me.id) continue;
    const rec = game.players.get(id);
    if (!rec) continue;
    rec.interp.push([x, y, z, ry]);
    rec.serverAnim = anim;
  }
  for (const [id, x, y, z, ry, anim] of msg.bears) {
    let rec = game.bears.get(id);
    if (!rec) {
      rec = bearRecord({ id, variant: 'brown', x, y, z, ry });
      game.bears.set(id, rec);
    }
    rec.interp.push([x, y, z, ry]);
    rec.serverAnim = anim;
  }
  for (const [id, x, y, z, ry, pitch, roll, speed] of msg.vans) {
    const rec = game.vans.get(id);
    if (!rec) continue;
    rec.speed = speed;
    if (game.driving && game.vanSim?.id === id) continue; // I own this sim
    rec.interp.push([x, y, z, ry, pitch, roll]);
  }
});

net.on('van.seats', (msg) => {
  const rec = game.vans.get(msg.vanId);
  if (rec) rec.seats = msg.seats;
  const mySeat = msg.seats.indexOf(game.me.id);
  if (mySeat !== -1) {
    game.meVanId = msg.vanId;
    game.meSeat = mySeat;
    onMyVanChanged();
  } else if (game.meVanId === msg.vanId) {
    game.meVanId = null;
    game.meSeat = null;
    onMyVanChanged();
  }
});

net.on('van.teleport', (msg) => {
  const rec = game.vans.get(msg.van.id);
  if (!rec) return;
  rec.interp.frames.length = 0;
  rec.group.position.set(msg.van.x, msg.van.y, msg.van.z);
  rec.group.rotation.set(0, msg.van.ry, 0);
  if (game.vanSim?.id === msg.van.id) {
    game.vanSim.x = msg.van.x; game.vanSim.y = msg.van.y; game.vanSim.z = msg.van.z;
    game.vanSim.ry = msg.van.ry; game.vanSim.speed = 0; game.vanSim.pitch = 0; game.vanSim.roll = 0;
  }
});

net.on('item.add', (msg) => addItemToWorld(msg.id, msg.item));
net.on('item.remove', (msg) => removeItemFromWorld(msg.id));

net.on('chat', (msg) => {
  chat.addMessage(msg.name, msg.text, msg.id === game.me.id);
  const rec = msg.id === game.me.id ? { tag: myTag } : game.players.get(msg.id);
  rec?.tag.setBubble(msg.text);
  rec?.tag.update(msg.id === game.me.id ? game.me.name : rec.data?.name || '');
});
net.on('toast', (msg) => toast(msg.text));

net.on('pose.fx', (msg) => {
  const rec = game.players.get(msg.id);
  if (!rec) return;
  rec.poseOverride = { roast: 'roast', eat: 'roast', sit: 'sit', lie: 'lie', spraypose: 'spray' }[msg.kind] || null;
  if (msg.kind === 'stand') rec.poseOverride = null;
});

net.on('spray.fx', (msg) => {
  sprayBurst(msg.x, msg.z, msg.dirX, msg.dirZ);
  if (msg.id === game.me.id && msg.scared > 0) {
    toast(`${msg.scared} bear${msg.scared > 1 ? 's' : ''} ran off! 🐻💨`);
    window.ClaudeBox?.completeChallenge('bp-scare-bear');
  }
});

net.on('player.death', (msg) => {
  if (msg.id === game.me.id) {
    game.dead = true;
    player.locked = true;
    audio.playOof();
    audio.setWalking(false);
    document.getElementById('death-veil').classList.remove('hidden');
    myAvatar.group.visible = false;
    ragdolls.push(withTTL(makeRagdoll(scene, buildPlayerAvatar(game.me.avatar).group, meGroup.position.clone(), meGroup.rotation.y), 2.6));
    setTimeout(() => net.send({ t: 'respawn' }), 2600);
  } else {
    const rec = game.players.get(msg.id);
    if (rec) {
      rec.hidden = true;
      rec.group.visible = false;
      ragdolls.push(withTTL(makeRagdoll(scene, buildPlayerAvatar(rec.data.avatar || {}).group, rec.group.position.clone(), rec.group.rotation.y), 2.6));
    }
  }
});

net.on('player.respawn', (msg) => {
  if (msg.id === game.me.id) {
    game.dead = false;
    player.locked = false;
    game.lockedAnim = null;
    document.getElementById('death-veil').classList.add('hidden');
    player.spawnAt(msg.x, msg.z);
    myAvatar.group.visible = true;
  } else {
    const rec = game.players.get(msg.id);
    if (rec) {
      rec.hidden = false;
      rec.group.visible = true;
      rec.interp.frames.length = 0;
      rec.group.position.set(msg.x, msg.y, msg.z);
    }
  }
});

net.on('_disconnect', () => {
  toast('Lost connection — reloading…');
  setTimeout(() => location.reload(), 1800);
});

function onMyVanChanged() {
  const driving = game.meVanId != null && game.meSeat === 0;
  game.driving = driving;
  if (driving) {
    const rec = game.vans.get(game.meVanId);
    game.vanSim = new VanSim({ id: game.meVanId, x: rec.group.position.x, y: rec.group.position.y, z: rec.group.position.z, ry: rec.group.rotation.y, speed: rec.speed });
  } else {
    game.vanSim = null;
    audio.setDriving(false);
  }
  if (game.meVanId == null) {
    // stepped out beside the van
    const rec = lastVanRec;
    if (rec) {
      const side = new THREE.Vector3(1.8, 0, 0).applyEuler(rec.group.rotation);
      player.spawnAt(rec.group.position.x + side.x, rec.group.position.z + side.z);
    }
    player.locked = false;
    game.lockedAnim = null;
  } else {
    player.locked = true;
    game.lockedAnim = game.meSeat === 0 ? 'drive' : 'sit';
    lastVanRec = game.vans.get(game.meVanId);
  }
  if (controlsMode === 'mobile') controls.setMode(driving ? 'drive' : 'foot');
}
let lastVanRec = null;

// spray particle burst
const sprayBursts = [];
function sprayBurst(x, z, dirX, dirZ) {
  const geo = new THREE.BufferGeometry();
  const count = 26;
  const pos = new Float32Array(count * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#e8f4f8', size: 0.3, transparent: true, opacity: 0.9 }));
  pts.frustumCulled = false;
  scene.add(pts);
  const y = groundAt(x, z) + 1.3;
  const seeds = Array.from({ length: count }, () => ({
    sp: 4 + Math.random() * 5, a: (Math.random() - 0.5) * 0.7, up: (Math.random() - 0.5) * 1.5,
  }));
  sprayBursts.push({ pts, geo, x, y, z, dirX, dirZ, seeds, t: 0 });
}

function withTTL(ragdoll, ttl) {
  ragdoll.ttl = ttl;
  return ragdoll;
}

// ============================ settings panel ============================
function loadLocalSettings() {
  const defaults = { musicVolume: 0.5, sfxVolume: 0.9, camSensitivity: 1, controlsMode: 'auto', graphics: 'auto' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('bp.settings') || '{}') };
  } catch { return defaults; }
}
function saveLocalSettings() { localStorage.setItem('bp.settings', JSON.stringify(game.settings)); }
audio.setMusicVolume(game.settings.musicVolume);
audio.setSfxVolume(game.settings.sfxVolume);

function buildSettingsPanel(panel) {
  const h = document.createElement('h2');
  h.textContent = '⚙️ Settings';
  panel.appendChild(h);
  const slider = (label, key, min, max, onChange) => {
    const row = panels.row(panel, label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = 0.05;
    input.value = game.settings[key];
    input.addEventListener('input', () => {
      game.settings[key] = parseFloat(input.value);
      saveLocalSettings();
      onChange(game.settings[key]);
    });
    row.appendChild(input);
  };
  slider('🎵 Music', 'musicVolume', 0, 1, (v) => audio.setMusicVolume(v));
  slider('🔔 Sounds', 'sfxVolume', 0, 1, (v) => audio.setSfxVolume(v));
  slider('🎥 Camera speed', 'camSensitivity', 0.3, 2, (v) => { orbit.sensitivity = v; });
  {
    const row = panels.row(panel, '🕹️ Controls');
    const sel = document.createElement('select');
    for (const [v, label] of [['auto', 'Auto'], ['mobile', 'Touch'], ['desktop', 'Keyboard + mouse']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = game.settings.controlsMode;
    sel.addEventListener('change', () => {
      game.settings.controlsMode = sel.value;
      saveLocalSettings();
      applyControlsMode(effectiveMode(sel.value));
    });
    row.appendChild(sel);
  }
  {
    const row = panels.row(panel, '🖥️ Graphics');
    const sel = document.createElement('select');
    for (const [v, label] of [['auto', 'Auto'], ['high', 'High'], ['low', 'Low (faster)']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = game.settings.graphics || 'auto';
    sel.addEventListener('change', () => {
      game.settings.graphics = sel.value;
      sessionStorage.removeItem('bp.forceLow');
      saveLocalSettings();
      toast('Reloading to apply graphics…');
      setTimeout(() => location.reload(), 500);
    });
    row.appendChild(sel);
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;opacity:.6;margin-top:4px';
    hint.textContent = 'On Opera GX, pick Low if the map doesn’t appear.';
    panel.appendChild(hint);
  }
  const row = panels.row(panel);
  panels.button(row, '⛶ Fullscreen', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
    panels.closeAll();
  }, 'gold');
  panels.button(row, '🎮 ClaudeBox home', () => { location.href = '/'; });
}

// ============================ game loop ============================
const input = { x: 0, z: 0, steer: 0, throttle: 0, brake: 0, handbrake: false };
let lastTime = performance.now();
let hudTimer = 0;
let lavaCooldown = 0;
let runoverCooldown = 0;

function currentAnim() {
  if (game.lockedAnim) return game.lockedAnim;
  return player.anim;
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.06, (now - lastTime) / 1000);
  const nowS = now / 1000;
  lastTime = now;

  controls.poll(input);

  // ---- clock (smooth from server) ----
  if (game.clockOverride != null) {
    game.clock = game.clockOverride; // debug/screenshot hook
  } else if (game.serverClock != null) {
    let diff = game.serverClock - game.clock;
    if (diff < -0.5) diff += 1;
    game.clock = (game.clock + diff * 0.05 + dt / 480) % 1;
  } else {
    game.clock = (game.clock + dt / 480) % 1;
  }

  // ---- movement / driving ----
  if (game.driving && game.vanSim) {
    game.vanSim.update(dt, input);
    const rec = game.vans.get(game.meVanId);
    if (rec) {
      rec.group.position.set(game.vanSim.x, game.vanSim.y, game.vanSim.z);
      rec.group.rotation.set(game.vanSim.pitch, game.vanSim.ry, game.vanSim.roll);
      rec.speed = game.vanSim.speed;
    }
    audio.setDriving(Math.abs(game.vanSim.speed) > 0.6, Math.abs(game.vanSim.speed));
    audio.setWalking(false);

    // run-over check
    runoverCooldown -= dt;
    if (Math.abs(game.vanSim.speed) > 7 && runoverCooldown <= 0) {
      for (const [id, prec] of game.players) {
        if (prec.data.vanId != null || prec.hidden) continue;
        const d = Math.hypot(prec.group.position.x - game.vanSim.x, prec.group.position.z - game.vanSim.z);
        if (d < 2.4) {
          net.send({ t: 'ranover', playerId: id });
          runoverCooldown = 1;
          break;
        }
      }
    }
  } else {
    player.update(dt, input, orbit.yaw + Math.PI);
    // stand up when seated and trying to move
    if (game.seated && (Math.hypot(input.x, input.z) > 0.4 || player.jumpQueued)) standUp();
    const moving = Math.hypot(player.vel.x, player.vel.z) > 1.2;
    audio.setWalking(!game.dead && player.grounded && moving && !player.swimming);
    if (game.meVanId == null) audio.setDriving(false);
  }

  // passengers (and the driver) ride at their seat anchor
  if (game.meVanId != null) {
    const rec = game.vans.get(game.meVanId);
    if (rec) {
      const seat = SEATS[game.meSeat ?? 1];
      const wp = new THREE.Vector3(seat.x, seat.y, seat.z).applyEuler(rec.group.rotation).add(rec.group.position);
      player.pos.x = wp.x; player.pos.y = wp.y - 0.95; player.pos.z = wp.z;
      player.ry = rec.group.rotation.y;
      // engine sound for passengers too
      if (!game.driving) audio.setDriving(Math.abs(rec.speed) > 0.6, Math.abs(rec.speed));
    }
  }

  // ---- my avatar ----
  meGroup.position.set(player.pos.x, player.pos.y, player.pos.z);
  meGroup.rotation.y = player.ry;
  myAnim.anim = currentAnim();
  myAnim.speed = Math.hypot(player.vel.x, player.vel.z);
  const bob = animatePlayer(myAvatar.parts, myAnim, dt);
  const lying = myAnim.anim === 'lie';
  myAvatar.group.rotation.x += ((lying ? -Math.PI / 2 : 0) - myAvatar.group.rotation.x) * Math.min(1, dt * 8);
  myAvatar.group.position.y = bob + (lying ? 0.35 : 0);

  // roast progress
  if (game.roast.stage === 'roasting') {
    roastTimer -= dt;
    game.roast.t = 1 - roastTimer / 4;
    setMallowRoast(heldMesh, Math.min(1, game.roast.t * 0.62)); // golden, not burnt
    if (roastTimer <= 0) {
      game.roast.stage = 'roasted';
      player.locked = false;
      game.lockedAnim = null;
      toast('Golden brown! Eat it while it’s warm.');
    }
  }

  // lava is deadly
  lavaCooldown -= dt;
  if (!game.dead && !game.driving && lavaCooldown <= 0 && lavaAt(player.pos.x, player.pos.z)) {
    net.send({ t: 'die', cause: 'lava' });
    lavaCooldown = 3;
  }

  // ---- remote players ----
  for (const rec of game.players.values()) {
    if (rec.hidden) continue;
    if (rec.data.vanId != null) {
      const van = game.vans.get(rec.data.vanId);
      if (van) {
        const seat = SEATS[rec.data.seat ?? 1];
        const wp = new THREE.Vector3(seat.x, seat.y, seat.z).applyEuler(van.group.rotation).add(van.group.position);
        rec.group.position.set(wp.x, wp.y - 0.95, wp.z);
        rec.group.rotation.y = van.group.rotation.y;
        rec.anim.anim = rec.data.seat === 0 ? 'drive' : 'sit';
      }
    } else {
      const s = rec.interp.sample([3]);
      if (s) {
        rec.group.position.set(s[0], s[1], s[2]);
        rec.group.rotation.y = s[3];
      }
      rec.anim.anim = rec.poseOverride || rec.serverAnim || 'idle';
    }
    const rbob = animatePlayer(rec.parts, rec.anim, dt);
    const rlying = rec.anim.anim === 'lie';
    rec.avatarGroup.rotation.x += ((rlying ? -Math.PI / 2 : 0) - rec.avatarGroup.rotation.x) * Math.min(1, dt * 8);
    rec.avatarGroup.position.y = rbob + (rlying ? 0.35 : 0);
    if (rec.tag.tick(nowS)) rec.tag.update(rec.data.name);
  }
  if (myTag.tick(nowS)) myTag.update(game.me.name);

  // ---- bears ----
  for (const rec of game.bears.values()) {
    const s = rec.interp.sample([3]);
    if (s) {
      rec.group.position.set(s[0], s[1], s[2]);
      rec.group.rotation.y = s[3];
    }
    animateBear(rec.parts, rec.anim, rec.serverAnim, dt);
  }

  // ---- vans (remote-driven) ----
  for (const rec of game.vans.values()) {
    if (game.driving && game.vanSim?.id === rec.data.id) {
      // wheels from my sim
      spinWheels(rec, game.vanSim.speed, game.vanSim.steerVis, dt);
    } else {
      const s = rec.interp.sample([3]);
      if (s) {
        rec.group.position.set(s[0], s[1], s[2]);
        rec.group.rotation.set(s[4], s[3], s[5]);
      }
      if (Math.abs(rec.speed) < 0.5) {
        // parked: rest on the slope (pitch along heading, roll across it)
        const p = rec.group.position, ry = rec.group.rotation.y;
        const ahead = groundAt(p.x + Math.sin(ry) * 2, p.z + Math.cos(ry) * 2);
        const behind = groundAt(p.x - Math.sin(ry) * 2, p.z - Math.cos(ry) * 2);
        const right = groundAt(p.x + Math.cos(ry) * 1.1, p.z - Math.sin(ry) * 1.1);
        const left = groundAt(p.x - Math.cos(ry) * 1.1, p.z + Math.sin(ry) * 1.1);
        rec.group.rotation.x = -Math.atan2(ahead - behind, 4);
        rec.group.rotation.z = -Math.atan2(left - right, 2.2);
        rec.group.position.y = groundAt(p.x, p.z);
      }
      spinWheels(rec, rec.speed, 0, dt);
    }
    // headlight lamp follows the van, on at night when occupied
    const front = new THREE.Vector3(0, 1.15, 2.9).applyEuler(rec.group.rotation).add(rec.group.position);
    rec.lamp.x = front.x; rec.lamp.y = front.y; rec.lamp.z = front.z;
    rec.lamp.on = sky.elev < 0.06 && rec.seats.some(Boolean);
  }

  // ---- ghost preview ----
  if (ghost) {
    const pos = ghostPos();
    ghost.position.set(pos.x, pos.y, pos.z);
    ghost.rotation.y = player.ry + Math.PI;
    const ok = placementValid(inventory.equipped?.kind, pos.x, pos.z);
    ghost.traverse((o) => { if (o.isMesh) o.material.color?.offsetHSL(0, 0, 0); });
    ghost.visible = !game.driving && game.meVanId == null;
    const tintCol = ok ? null : new THREE.Color('#ff5544');
    ghost.traverse((o) => {
      if (o.isMesh) {
        if (!o.userData.baseColor) o.userData.baseColor = o.material.color.clone();
        o.material.color.copy(tintCol || o.userData.baseColor);
      }
    });
  }

  // ---- campfire flames flicker ----
  for (const rec of game.items.values()) {
    if (rec.mesh.userData.flames) {
      for (const f of rec.mesh.userData.flames) {
        f.scale.setScalar(1 + Math.sin(nowS * 9 + rec.data.x) * 0.16);
      }
    }
  }

  // ---- spray particles ----
  for (let i = sprayBursts.length - 1; i >= 0; i--) {
    const b = sprayBursts[i];
    b.t += dt;
    const pos = b.geo.attributes.position;
    for (let k = 0; k < b.seeds.length; k++) {
      const s = b.seeds[k];
      const d = s.sp * b.t;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      pos.setXYZ(k,
        b.x + (b.dirX * ca - b.dirZ * sa) * d,
        b.y + s.up * b.t * 2,
        b.z + (b.dirZ * ca + b.dirX * sa) * d);
    }
    pos.needsUpdate = true;
    b.pts.material.opacity = Math.max(0, 0.9 - b.t * 1.1);
    if (b.t > 0.9) {
      scene.remove(b.pts);
      sprayBursts.splice(i, 1);
    }
  }

  // ---- ragdolls ----
  for (let i = ragdolls.length - 1; i >= 0; i--) {
    const r = ragdolls[i];
    r.update(dt);
    r.ttl -= dt;
    if (r.ttl <= 0) { r.dispose(); ragdolls.splice(i, 1); }
  }

  // ---- world ----
  water?.userData?.tick?.(nowS);
  sky.tick(game.clock, camera, nowS);
  mapUI.tick();

  // ---- HUD ----
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    hud.render(computeActions(), controlsMode === 'desktop');
  }
  hud.setSpeed(game.driving, game.vanSim?.speed || 0);

  // ---- camera ----
  if (game.meVanId != null) {
    const rec = game.vans.get(game.meVanId);
    if (rec) orbit.update(dt, { x: rec.group.position.x, y: rec.group.position.y + 1, z: rec.group.position.z }, 2.2);
  } else {
    orbit.update(dt, player.pos, 1.6);
  }

  // ---- flashlight: shine from the player along the camera's look direction ----
  if (game.flashlightOn) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    flashlight.position.set(player.pos.x, player.pos.y + 1.5, player.pos.z);
    flashTarget.position.set(player.pos.x + fwd.x * 12, player.pos.y + 1.5 + fwd.y * 12, player.pos.z + fwd.z * 12);
    // brighter at night, a soft glow by day
    flashlight.intensity = 2.4 + (1 - (sky.dayAmount ?? 1)) * 4.5;
  } else {
    flashlight.intensity = 0;
  }

  renderer.render(scene, camera);
}

function spinWheels(rec, speed, steer, dt) {
  for (const w of rec.wheels) {
    w.wheel.rotation.x += (speed / 0.42) * dt;
    w.hub.rotation.x = w.wheel.rotation.x;
    if (w.front) w.pivot.rotation.y = -steer;
  }
}

frame();
