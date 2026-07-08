// Restaurant Simulator 2 — client entry point.
// Boot: ClaudeBox identity → town → join /rs2-ws → game loop.

import * as THREE from 'three';
import {
  WORLD, PLOTS, HOUSES, PLAZA, SPAWN, groundAt, plotAt, houseAt, EXPANSIONS,
} from '/shared/rs2/world.js';
import * as catalogMod from '/shared/rs2/catalog.js';
import { device, effectiveMode } from '/js/device.js';
import { audio } from './audio.js';
import { Net, InterpBuffer } from './net.js';
import { loadIdentity, buildPlayerAvatar, makePlayerAnimState, animatePlayer } from '/backpacking/js/player/avatar.js';
import { DesktopControls } from './desktop-controls.js';
import { MobileControls } from './mobile-controls.js';
import { buildLighting, buildTerrain, buildRoadsAndPads, buildPlaza, buildHouses } from './world/town.js';
import { buildRestaurantShell } from './world/building.js';
import { buildFurniture, buildFoodMesh, buildBagMesh, buildCashPile } from './systems/furniture.js';
import { buildMopedMesh, MopedSim } from './systems/moped.js';
import { BuildMode } from './systems/buildmode.js';
import { Nametag } from './ui/nametags.js';
import { Chat, toast } from './ui/chat.js';
import { Panels } from './ui/panels.js';
import {
  buildShopPanel, buildManagePanel, buildOrderPanel, buildDeliveryChooser, buildWarpPanel,
} from './ui/menus.js';

const status = (s) => { const el = document.getElementById('load-status'); if (el) el.textContent = s; };
const GROUND = 2.05;

// map server anims onto the BP avatar animator's poses
const ANIM_MAP = { chop: 'roast', drive: 'drive', sit: 'sitchair', walk: 'walk', run: 'run', idle: 'idle', eat: 'roast' };

// ============================ identity ============================
const identity = await loadIdentity();

// ============================ renderer ============================
status('Setting the tables…');
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2200);

const game = {
  renderer, scene, camera,
  catalog: { ...catalogMod, EXPANSIONS },
  me: { id: null, name: identity.name, avatar: identity.avatar },
  cash: 0, plotId: null, houseId: null,
  players: new Map(),
  npcs: new Map(),
  restaurants: new Map(),   // plotId -> { r, shell, itemMeshes, lampRecs, colliders }
  orders: new Map(),
  piles: new Map(),
  colliders: [],
  riding: null,             // MopedSim while riding
  hasBag: null,
  audio,
  settings: loadLocalSettings(),
};
window.__game = game;

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ============================ town ============================
const lights = buildLighting(scene);
scene.add(buildTerrain());
status('Paving Main Street…');
scene.add(buildRoadsAndPads());
scene.add(buildPlaza(lights));
status('Building the neighborhood…');
const housesGroup = buildHouses(lights);
scene.add(housesGroup);
game.colliders.push(...(housesGroup.userData.colliders || []));
const houseDoors = housesGroup.userData.doorPivots || [];

// per-plot shared mopeds
const plotMopeds = new Map();
for (const p of PLOTS) {
  const m = buildMopedMesh();
  m.group.position.set(p.mopedX, GROUND, p.mopedZ);
  m.group.rotation.y = p.mopedRy;
  scene.add(m.group);
  plotMopeds.set(p.id, m);
}

// ============================ restaurants ============================
function rebuildRestaurant(plotId, r) {
  const old = game.restaurants.get(plotId);
  if (old) {
    scene.remove(old.shell.group);
    for (const rec of Object.values(old.itemMeshes)) scene.remove(rec.mesh);
    for (const lamp of old.lampRecs) lights.removeLamp(lamp);
    game.colliders = game.colliders.filter((c) => c.plot !== plotId);
  }
  const shell = buildRestaurantShell(PLOTS[plotId], r);
  scene.add(shell.group);
  const lampRecs = [];
  const itemMeshes = {};
  for (const [id, it] of Object.entries(r.items)) {
    const def = catalogMod.ITEMS[it.kind];
    if (!def) continue;
    const mesh = buildFurniture(it.kind, it.tier || 0);
    const fw = it.rot % 2 ? def.d : def.w;
    const fd = it.rot % 2 ? def.w : def.d;
    const a = shell.frame.cellToWorld(it.gx, it.gz);
    const b = shell.frame.cellToWorld(it.gx + fw - 1, it.gz + fd - 1);
    const wx = (a.x + b.x) / 2, wz = (a.z + b.z) / 2;
    mesh.position.set(wx, GROUND + 0.12, wz);
    mesh.rotation.y = it.rot * Math.PI / 2 + (shell.frame.f < 0 ? Math.PI : 0);
    scene.add(mesh);
    itemMeshes[id] = { mesh, it, def, world: { x: wx, z: wz } };
    if (mesh.userData.lampSpec) {
      lampRecs.push(lights.addLamp({ x: wx, z: wz, y: GROUND + mesh.userData.lampSpec.y, ...mesh.userData.lampSpec }));
    }
    if (def.station || def.seats || def.pickup) {
      game.colliders.push({ x: wx, z: wz, r: 0.8, plot: plotId });
    }
  }
  for (const c of shell.colliders) game.colliders.push({ ...c, plot: plotId });
  game.restaurants.set(plotId, { plotId, r, shell, itemMeshes, lampRecs });
  shell.group.userData.setRating(r.rating);
}

game.myRestaurantRec = () => (game.plotId != null ? game.restaurants.get(game.plotId) : null);

// client-side placement validation (mirrors the server)
game.placementOkClient = (r, kind, gx, gz, rot, ignoreId = null) => {
  const def = catalogMod.ITEMS[kind];
  if (!def) return false;
  const { w: W, d: D } = EXPANSIONS[r.expansion];
  const w = rot % 2 ? def.d : def.w;
  const d = rot % 2 ? def.w : def.d;
  if (gx < 0 || gz < 0 || gx + w > W || gz + d > D) return false;
  if (def.flat) return true;
  for (const [id, it] of Object.entries(r.items)) {
    if (id === ignoreId) continue;
    const odef = catalogMod.ITEMS[it.kind];
    if (!odef || odef.flat) continue;
    const ow = it.rot % 2 ? odef.d : odef.w;
    const od = it.rot % 2 ? odef.w : odef.d;
    if (gx < it.gx + ow && gx + w > it.gx && gz < it.gz + od && gz + d > it.gz) return false;
  }
  return true;
};

// ============================ my avatar + movement ============================
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
let myMoped = null; // mesh while riding

// simple flat-town controller (BP conventions)
const player = {
  pos: { x: SPAWN.x, y: groundAt(SPAWN.x, SPAWN.z), z: SPAWN.z },
  vel: { x: 0, y: 0, z: 0 },
  ry: 0, sprint: false, grounded: true, anim: 'idle', locked: false,
  jumpQueued: false,
  queueJump() { this.jumpQueued = true; },
  update(dt, input, camYaw) {
    if (this.locked) { this.jumpQueued = false; return; }
    const mag = Math.min(1, Math.hypot(input.x, input.z));
    let dirX = 0, dirZ = 0;
    if (mag > 0.05) {
      const a = camYaw - Math.atan2(input.x, input.z);
      dirX = Math.sin(a) * mag;
      dirZ = Math.cos(a) * mag;
      this.ry = Math.atan2(dirX, dirZ);
    }
    const speed = this.sprint && mag > 0.05 ? 9.5 : 5.5;
    this.vel.x += (dirX * speed - this.vel.x) * Math.min(1, dt * 10);
    this.vel.z += (dirZ * speed - this.vel.z) * Math.min(1, dt * 10);
    this.vel.y -= 24 * dt;
    if (this.jumpQueued && this.grounded) { this.vel.y = 8; this.grounded = false; }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    const g = groundAt(this.pos.x, this.pos.z);
    if (this.pos.y <= g) { this.pos.y = g; this.vel.y = 0; this.grounded = true; }
    for (const c of game.colliders) {
      if (this.pos.y >= (c.top ?? Infinity)) continue;
      if (c.box) {
        if (this.pos.x > c.minX && this.pos.x < c.maxX && this.pos.z > c.minZ && this.pos.z < c.maxZ) {
          // push out along the axis of least penetration
          const pushW = this.pos.x - c.minX, pushE = c.maxX - this.pos.x;
          const pushN = this.pos.z - c.minZ, pushS = c.maxZ - this.pos.z;
          const m = Math.min(pushW, pushE, pushN, pushS);
          if (m === pushW) this.pos.x = c.minX;
          else if (m === pushE) this.pos.x = c.maxX;
          else if (m === pushN) this.pos.z = c.minZ;
          else this.pos.z = c.maxZ;
        }
      } else {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < c.r && d > 0.001) {
          this.pos.x = c.x + (dx / d) * c.r;
          this.pos.z = c.z + (dz / d) * c.r;
        }
      }
    }
    const lim = 500;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
    this.anim = !this.grounded ? 'jump' : mag > 0.05 ? (this.sprint ? 'run' : 'walk') : 'idle';
    this.jumpQueued = false;
  },
};
game.player = player;

// camera (BP orbit pattern)
const orbit = {
  yaw: Math.PI, pitch: 0.4, dist: 9, sensitivity: game.settings.camSensitivity, invertY: false,
  target: { x: SPAWN.x, y: 4, z: SPAWN.z },
  rotate(dx, dy) {
    const s = 0.0042 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch = Math.max(-0.4, Math.min(1.3, this.pitch + dy * s));
  },
  zoom(d) { this.dist = Math.max(3, Math.min(26, this.dist * (1 + d * 0.0014))); },
  update(dt, pos) {
    const k = Math.min(1, dt * 10);
    this.target.x += (pos.x - this.target.x) * k;
    this.target.y += (pos.y + 1.7 - this.target.y) * k;
    this.target.z += (pos.z - this.target.z) * k;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dirX = Math.sin(this.yaw) * cp, dirY = sp, dirZ = Math.cos(this.yaw) * cp;
    // march outward and stop before passing through a wall
    let usable = this.dist;
    const steps = 10;
    for (let s = 1; s <= steps; s++) {
      const d = (this.dist * s) / steps;
      const px = this.target.x + dirX * d;
      const py = this.target.y + dirY * d;
      const pz = this.target.z + dirZ * d;
      let blocked = false;
      for (const c of game.colliders) {
        if (py >= (c.top ?? Infinity)) continue;
        if (c.box) {
          if (px > c.minX && px < c.maxX && pz > c.minZ && pz < c.maxZ) { blocked = true; break; }
        } else if (Math.hypot(px - c.x, pz - c.z) < c.r) { blocked = true; break; }
      }
      if (blocked) { usable = Math.max(1.6, (this.dist * (s - 1)) / steps - 0.3); break; }
    }
    let cx = this.target.x + dirX * usable;
    let cy = this.target.y + dirY * usable;
    let cz = this.target.z + dirZ * usable;
    const gy = groundAt(cx, cz) + 0.4;
    if (cy < gy) cy = gy;
    camera.position.set(cx, cy, cz);
    camera.lookAt(this.target.x, this.target.y, this.target.z);
  },
};
game.orbit = orbit;

// ============================ UI ============================
const panels = new Panels();
game.panels = panels;
const chat = new Chat(game);
game.chat = chat;
const buildMode = new BuildMode(game);
game.buildMode = buildMode;

document.getElementById('hud').classList.remove('hidden');
document.getElementById('hud-settings-btn').addEventListener('click', () => panels.toggle('settings', buildSettingsPanel));

let controls = null;
let controlsMode = null;
function applyControlsMode(mode) {
  if (mode === controlsMode) return;
  controls?.destroy?.();
  controlsMode = mode;
  controls = mode === 'mobile' ? new MobileControls(game) : new DesktopControls(game);
  game.controls = controls;
  if (mode === 'mobile') controls.setMode(game.riding ? 'drive' : 'foot');
}
game.applyControlsMode = applyControlsMode;
applyControlsMode(effectiveMode(game.settings.controlsMode));

addEventListener('pointerdown', () => audio.unlock(), { once: true });
addEventListener('keydown', () => audio.unlock(), { once: true });
addEventListener('touchstart', () => audio.unlock(), { once: true });

function loadLocalSettings() {
  try { return { musicVolume: 0.6, sfxVolume: 0.9, camSensitivity: 1, controlsMode: 'auto', ...JSON.parse(localStorage.getItem('rs2.settings') || '{}') }; }
  catch { return { musicVolume: 0.6, sfxVolume: 0.9, camSensitivity: 1, controlsMode: 'auto' }; }
}
function saveLocalSettings() { localStorage.setItem('rs2.settings', JSON.stringify(game.settings)); }
audio.setMusicVolume(game.settings.musicVolume);
audio.setSfxVolume(game.settings.sfxVolume);

function buildSettingsPanel(panel) {
  const h = document.createElement('h2');
  h.textContent = '⚙️ Settings';
  panel.appendChild(h);
  const slider = (label, key, min, max, onChange) => {
    const row = panels.row(panel, label);
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = 0.05;
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
  slider('🎥 Camera', 'camSensitivity', 0.3, 2, (v) => { orbit.sensitivity = v; });
  const row = panels.row(panel);
  panels.button(row, '⛶ Fullscreen', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  panels.button(row, '🎮 ClaudeBox home', () => { location.href = '/'; }, 'gold');
}

// ============================ records ============================
function playerRecord(p) {
  const built = buildPlayerAvatar(p.avatar || {});
  const group = new THREE.Group();
  group.add(built.group);
  const tag = new Nametag();
  tag.update(p.name);
  tag.sprite.position.y = 2.1;
  group.add(tag.sprite);
  scene.add(group);
  const moped = buildMopedMesh('#4a7ec0');
  moped.group.visible = false;
  scene.add(moped.group);
  return { data: p, group, avatarGroup: built.group, parts: built.parts, anim: makePlayerAnimState(), interp: new InterpBuffer(), tag, moped, held: null };
}

function npcRecord(n) {
  const built = buildPlayerAvatar(n.avatar || {});
  const group = new THREE.Group();
  group.add(built.group);
  group.position.set(n.x, n.y ?? GROUND, n.z);
  scene.add(group);
  const moped = n.kind === 'delivery' ? buildMopedMesh('#e8902a') : null;
  if (moped) { moped.group.visible = false; scene.add(moped.group); }
  const tag = new Nametag();
  tag.sprite.position.y = 2.1;
  tag.update(n.kind === 'customer' ? '' : { waiter: 'Waiter', chef: 'Chef', delivery: 'Delivery' }[n.kind] || '');
  group.add(tag.sprite);
  return { data: n, group, avatarGroup: built.group, parts: built.parts, anim: makePlayerAnimState(), interp: new InterpBuffer(), tag, moped, held: null };
}

function setHeld(rec, what) {
  if (rec.held) { rec.held.parent?.remove(rec.held); rec.held = null; }
  if (!what) return;
  const mesh = what === 'bag' ? buildBagMesh() : buildFoodMesh(what);
  mesh.scale.setScalar(0.9);
  mesh.position.set(0, -0.55, 0.18);
  rec.parts.armR.add(mesh);
  rec.held = mesh;
}

function setMyHeld(what) {
  if (heldMesh) { heldMesh.parent?.remove(heldMesh); heldMesh = null; }
  if (!what) return;
  heldMesh = what === 'bag' ? buildBagMesh() : buildFoodMesh(what);
  heldMesh.scale.setScalar(0.9);
  heldMesh.position.set(0, -0.55, 0.18);
  myAvatar.parts.armR.add(heldMesh);
}

function pileRecord(pile) {
  const mesh = buildCashPile();
  // sit on the table surface if there is one
  const rest = game.restaurants.get(pile.plotId);
  let y = GROUND + 0.12;
  if (rest) {
    const tbl = rest.itemMeshes[pile.tableId];
    if (tbl) y = GROUND + 0.12 + (tbl.mesh.userData.surfaceY || 0.9);
  }
  mesh.position.set(pile.x, y, pile.z);
  scene.add(mesh);
  return { data: pile, mesh };
}

// ============================ warps ============================
game.warpToPlot = (plotId) => {
  const p = PLOTS[plotId];
  if (!p) return;
  player.pos.x = p.entryX; player.pos.z = p.entryZ;
  player.pos.y = groundAt(p.entryX, p.entryZ) + 0.3;
  toast('📍 ' + (game.restaurants.get(plotId)?.r.name || 'Restaurant'));
};
game.warpToHouse = () => {
  const h = HOUSES[game.houseId ?? 0];
  player.pos.x = h.porchX; player.pos.z = h.porchZ - 2;
  player.pos.y = groundAt(player.pos.x, player.pos.z) + 0.3;
  toast('🏠 Home sweet home');
};
game.warpToPlaza = () => {
  player.pos.x = PLAZA.x; player.pos.z = PLAZA.z + 14;
  player.pos.y = groundAt(player.pos.x, player.pos.z) + 0.3;
};

// ============================ actions ============================
game.actions = {
  primary() {
    const list = computeActions();
    const a = list.find((x) => x.kind === 'primary' || x.kind === 'urgent');
    a?.fn();
  },
  backpack() { panels.toggle('shop', (p) => buildShopPanel(p, game, panels)); },
  map() { panels.toggle('warp', (p) => buildWarpPanel(p, game, panels)); },
  vanToggle() { /* F = mount/dismount moped */ toggleMoped(); },
  unequip() { if (buildMode.active) buildMode.exit(); },
  hotbar() {},
};

function toggleMoped() {
  if (game.riding) {
    // dismount
    const sim = game.riding;
    game.riding = null;
    if (myMoped) {
      // leave the plot moped where we stopped
      myMoped.group.position.set(sim.x, GROUND, sim.z);
      myMoped.group.rotation.set(0, sim.ry, 0);
      myMoped = null;
    }
    player.pos.x = sim.x + Math.cos(sim.ry) * 1.2;
    player.pos.z = sim.z - Math.sin(sim.ry) * 1.2;
    player.locked = false;
    if (controlsMode === 'mobile') controls.setMode('foot');
    return;
  }
  // mount the nearest moped (plot mopeds only)
  let best = null, bd = 5;
  for (const [plotId, m] of plotMopeds) {
    const d = Math.hypot(m.group.position.x - player.pos.x, m.group.position.z - player.pos.z);
    if (d < bd) { bd = d; best = m; }
  }
  if (!best) return;
  game.riding = new MopedSim(best.group.position.x, best.group.position.z, best.group.rotation.y);
  myMoped = best;
  player.locked = true;
  audio.sfx('moped');
  if (controlsMode === 'mobile') controls.setMode('drive');
}

function nearestNpc(filter, maxD = 3.2) {
  let best = null, bd = maxD;
  for (const rec of game.npcs.values()) {
    if (!filter(rec.data)) continue;
    const d = Math.hypot(rec.group.position.x - player.pos.x, rec.group.position.z - player.pos.z);
    if (d < bd) { bd = d; best = rec; }
  }
  return best;
}

function nearestStation(type, maxD = 3) {
  const mine = game.myRestaurantRec();
  if (!mine) return null;
  let best = null, bd = maxD;
  for (const [id, rec] of Object.entries(mine.itemMeshes)) {
    if (rec.def.station !== type) continue;
    const d = Math.hypot(rec.world.x - player.pos.x, rec.world.z - player.pos.z);
    if (d < bd) { bd = d; best = { id, rec }; }
  }
  return best;
}

function nearestPile(maxD = 3) {
  let best = null, bd = maxD;
  for (const [id, rec] of game.piles) {
    const d = Math.hypot(rec.data.x - player.pos.x, rec.data.z - player.pos.z);
    if (d < bd) { bd = d; best = { id, rec }; }
  }
  return best;
}

function computeActions() {
  const list = [];
  const myPlot = plotAt(player.pos.x, player.pos.z);
  const myHouse = houseAt(player.pos.x, player.pos.z);
  const mine = game.myRestaurantRec();
  const onMyPlot = myPlot && mine && myPlot.id === mine.plotId;

  if (game.riding) {
    // delivering with a bag?
    const carried = [...game.orders.values()].find((o) => o.carrier === game.me.id && o.type === 'delivery');
    if (carried != null) {
      const house = HOUSES[carried.houseId];
      const d = Math.hypot(player.pos.x - house.doorX, player.pos.z - house.doorZ);
      list.push({ id: 'dist', label: `Deliver to house ${carried.houseId + 1} (${Math.round(d)}m)`, emoji: '🧭', fn: () => {} });
    }
    list.push({ id: 'moped', label: 'Hop off', emoji: '🛵', kind: 'primary', hotkey: 'F', fn: toggleMoped });
    return list;
  }

  if (buildMode.active) {
    list.push({ id: 'place', label: buildMode.movingId ? 'Move here' : 'Place', emoji: '📍', kind: 'primary', hotkey: 'E', fn: () => buildMode.confirm() });
    list.push({ id: 'rot', label: 'Rotate', emoji: '🔄', hotkey: 'R', fn: () => buildMode.rotate() });
    list.push({ id: 'exit', label: 'Done building', emoji: '✅', hotkey: 'Q', fn: () => buildMode.exit() });
    return list;
  }

  // carried order interactions
  const carried = [...game.orders.values()].find((o) => o.carrier === game.me.id);
  if (carried) {
    if (carried.type === 'dine') {
      const cust = nearestNpc((n) => n.id === carried.customerId, 3.4);
      if (cust) list.push({ id: 'serve', label: 'Serve customer', emoji: '🍽️', kind: 'primary', hotkey: 'E', fn: () => net.send({ t: 'order.serve', orderId: carried.id }) });
      else list.push({ id: 'find', label: 'Bring to the customer…', emoji: '🧭', fn: () => {} });
    } else if (carried.type === 'player') {
      const buyer = [...game.players.values()].find((q) => q.data.name === carried.forName);
      if (buyer && Math.hypot(buyer.group.position.x - player.pos.x, buyer.group.position.z - player.pos.z) < 3.4) {
        list.push({ id: 'hand', label: `Hand to ${carried.forName}`, emoji: '🤝', kind: 'primary', hotkey: 'E', fn: () => net.send({ t: 'order.serve', orderId: carried.id }) });
      } else list.push({ id: 'find', label: `Find ${carried.forName}…`, emoji: '🧭', fn: () => {} });
    } else if (carried.type === 'delivery') {
      const house = HOUSES[carried.houseId];
      if (Math.hypot(player.pos.x - house.doorX, player.pos.z - house.doorZ) < 5) {
        list.push({ id: 'door', label: 'Leave at door + ring bell', emoji: '🛎️', kind: 'primary', hotkey: 'E', fn: () => net.send({ t: 'order.deliver', orderId: carried.id }) });
      } else {
        list.push({ id: 'moped', label: 'Ride moped', emoji: '🛵', kind: 'primary', hotkey: 'F', fn: toggleMoped });
      }
    }
  }

  // my bag of food
  if (game.hasBag) {
    list.push({ id: 'eatbag', label: 'Eat your food', emoji: '😋', kind: carried ? '' : 'primary', hotkey: 'E', fn: () => {
      net.send({ t: 'bag.eat' });
      audio.sfx('eat');
      setMyHeld(null);
      game.hasBag = null;
    } });
  }

  if (onMyPlot && !carried) {
    // take orders from waiting customers
    const waiting = nearestNpc((n) => n.kind === 'customer' && n.plotId === mine.plotId, 3.2);
    if (waiting) {
      list.push({ id: 'take', label: 'Take order', emoji: '📝', kind: 'primary', hotkey: 'E', fn: () => net.send({ t: 'order.take', customerId: waiting.data.id }) });
    }
    // cook at the station you're standing at: each station type offers only
    // the steps it can perform
    let cookActions = 0;
    for (const stationType of ['counter', 'stove', 'oven', 'dispenser']) {
      if (cookActions >= 2) break;
      const st = nearestStation(stationType, 2.6);
      if (!st) continue;
      const order = [...game.orders.values()].find((o) => o.plotId === mine.plotId && o.state === 'queued' && o.stepDef?.station === stationType);
      if (order) {
        cookActions++;
        const stationLabel = catalogMod.ITEMS[st.rec.it.kind].label;
        list.push({
          id: 'cook' + stationType,
          label: `${order.stepDef.verb} ${catalogMod.DISHES[order.dishId].label}`,
          emoji: catalogMod.DISHES[order.dishId].emoji, kind: cookActions === 1 ? 'primary' : '', hotkey: cookActions === 1 ? 'E' : null,
          fn: () => {
            net.send({ t: 'cook.step', orderId: order.id, station: stationType });
            audio.sfx({ counter: 'chop', stove: 'sizzle', oven: 'ding', dispenser: 'pour' }[stationType]);
            net.send({ t: 'pose', kind: 'chop' });
          },
        });
      }
    }
    // pick up ready orders
    const ready = [...game.orders.values()].find((o) => o.plotId === mine.plotId && o.state === 'ready');
    if (ready) {
      list.push({ id: 'grab', label: ready.type === 'dine' ? 'Pick up plate' : 'Grab delivery bag', emoji: ready.type === 'dine' ? '🍽️' : '🛍️', kind: 'primary', hotkey: 'E', fn: () => net.send({ t: 'order.carry', orderId: ready.id }) });
    }
    // collect cash piles
    const pile = nearestPile();
    if (pile) {
      list.push({ id: 'cash', label: `Collect $${pile.rec.data.amount}`, emoji: '💵', kind: 'primary', hotkey: 'E', fn: () => { net.send({ t: 'pile.collect', id: pile.id }); } });
    }
    list.push({ id: 'shop', label: 'Shop', emoji: '🛒', hotkey: 'B', fn: () => panels.toggle('shop', (p) => buildShopPanel(p, game, panels)) });
    list.push({ id: 'edit', label: 'Edit item', emoji: '🔧', fn: () => {
      const own = buildMode.nearestOwnItem();
      if (!own) return toast('Stand near one of your items.');
      panels.open('edit', (panel) => {
        const h = document.createElement('h2');
        h.textContent = '🔧 ' + (catalogMod.ITEMS[own.rec.it.kind]?.label || 'Item');
        panel.appendChild(h);
        const row = panels.row(panel);
        panels.button(row, '↔️ Move', () => { panels.closeAll(); buildMode.startMove(own.id); }, 'gold');
        panels.button(row, `💰 Sell (+$${Math.round(catalogMod.tierPrice(own.rec.it.kind, own.rec.it.tier || 0) * 0.5)})`, () => {
          net.send({ t: 'build.sell', id: own.id });
          panels.closeAll();
        });
      });
    } });
    list.push({ id: 'manage', label: 'Manage', emoji: '📋', fn: () => panels.toggle('manage', (p) => buildManagePanel(p, game, panels)) });
  } else if (myPlot && !carried) {
    // someone else's restaurant: order food
    const rest = game.restaurants.get(myPlot.id);
    if (rest) {
      list.push({ id: 'order', label: `Order at ${rest.r.name}`, emoji: '🧾', kind: 'primary', hotkey: 'E', fn: () => panels.toggle('order', (p) => buildOrderPanel(p, game, panels, myPlot.id, 'table')) });
    }
  }

  // ready delivery bags anywhere (helpers may grab from any restaurant they're at)
  if (!carried && myPlot && !onMyPlot) {
    const readyDel = [...game.orders.values()].find((o) => o.plotId === myPlot.id && o.type === 'delivery' && o.state === 'ready');
    if (readyDel) {
      list.push({ id: 'helpgrab', label: 'Grab delivery bag (help out!)', emoji: '🛍️', kind: 'primary', hotkey: 'E', fn: () => net.send({ t: 'order.carry', orderId: readyDel.id }) });
    }
  }

  // at my house: order delivery
  if (myHouse && myHouse.id === game.houseId) {
    list.push({ id: 'orderhome', label: 'Order delivery', emoji: '🛵', kind: list.some((a) => a.kind === 'primary') ? '' : 'primary', hotkey: 'E', fn: () => panels.toggle('chooser', (p) => buildDeliveryChooser(p, game, panels)) });
  }

  // moped nearby
  if (!game.riding && !buildMode.active) {
    let nearMoped = false;
    for (const m of plotMopeds.values()) {
      if (Math.hypot(m.group.position.x - player.pos.x, m.group.position.z - player.pos.z) < 4) { nearMoped = true; break; }
    }
    if (nearMoped && !list.some((a) => a.id === 'moped')) {
      list.push({ id: 'moped', label: 'Ride moped', emoji: '🛵', hotkey: 'F', fn: toggleMoped });
    }
  }

  list.push({ id: 'warp', label: 'Warp', emoji: '✨', hotkey: 'M', fn: () => panels.toggle('warp', (p) => buildWarpPanel(p, game, panels)) });
  list.push({ id: 'chat', label: 'Chat', emoji: '💬', fn: () => chat.openInput() });
  return list;
}

// ============================ HUD: cash / rating / tickets ============================
const cashEl = document.getElementById('cash-amount');
const ratingEl = document.getElementById('rating-amount');
const ticketsEl = document.getElementById('tickets');
const stackEl = document.getElementById('action-stack');
let lastActionsKey = '';

function renderActions(actions) {
  const key = actions.map((a) => a.id + a.label).join('|');
  if (key === lastActionsKey) return;
  lastActionsKey = key;
  stackEl.innerHTML = '';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'action-btn' + (a.kind ? ' ' + a.kind : '');
    if (controlsMode === 'desktop' && a.hotkey) {
      const hint = document.createElement('span');
      hint.className = 'key-hint';
      hint.textContent = a.hotkey;
      btn.appendChild(hint);
    }
    btn.appendChild(document.createTextNode(`${a.emoji} ${a.label}`));
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); a.fn(); });
    stackEl.appendChild(btn);
  }
}

function renderTickets() {
  ticketsEl.innerHTML = '';
  const mine = game.myRestaurantRec();
  for (const o of game.orders.values()) {
    const isMine = mine && o.plotId === mine.plotId;
    const isMyOrder = o.forName === game.me.name;
    if (!isMine && !isMyOrder) continue;
    const dish = catalogMod.DISHES[o.dishId];
    const div = document.createElement('div');
    div.className = 'ticket' + (o.state === 'ready' ? ' ready' : '') + (o.type === 'delivery' ? ' delivery' : '');
    const stepText = o.state === 'ready' ? (o.type === 'dine' ? 'READY — serve it!' : 'READY — bag it!')
      : o.state === 'cooking' || o.state === 'claimed' ? 'Cooking…'
      : o.state === 'carrying' || o.state === 'intransit' ? 'On the way'
      : o.stepDef ? `Next: ${o.stepDef.verb} @ ${o.stepDef.station}` : 'Queued';
    div.innerHTML = `<b>${dish.emoji} ${dish.label}</b> ${o.type === 'delivery' ? '🛵' : o.type === 'player' ? '🧑' : ''}<br><span class="tk-step">${stepText}</span>`;
    ticketsEl.appendChild(div);
  }
}

// ============================ networking ============================
status('Calling the health inspector…');
const net = new Net();
game.net = net;
net.connect();
net.join({ name: game.me.name, avatar: game.me.avatar, code: localStorage.getItem('claudebox.code') || '' });

function hydrateOrder(o) {
  // derive current step definition from catalog
  const dish = catalogMod.DISHES[o.dishId];
  o.stepDef = o.stepIdx < dish.steps.length ? dish.steps[o.stepIdx] : null;
  return o;
}

net.on('welcome', (msg) => {
  game.me.id = msg.id;
  game.cash = msg.cash;
  game.plotId = msg.plotId;
  game.houseId = msg.houseId;
  cashEl.textContent = msg.cash;
  audio.setTracks(msg.tracks || []);
  for (const [plotIdStr, r] of Object.entries(msg.restaurants)) rebuildRestaurant(Number(plotIdStr), r);
  for (const p of msg.players) game.players.set(p.id, playerRecord(p));
  for (const n of msg.npcs) game.npcs.set(n.id, npcRecord(n));
  for (const o of msg.orders) game.orders.set(o.id, hydrateOrder(o));
  for (const pile of msg.piles) game.piles.set(pile.id, pileRecord(pile));
  if (game.plotId != null) {
    const mine = game.restaurants.get(game.plotId);
    ratingEl.textContent = mine ? mine.r.rating.toFixed(1) : '—';
  } else ratingEl.textContent = '—';
  renderTickets();
  net.startMovementStream(() => {
    if (game.riding) {
      return { t: 'move', x: +game.riding.x.toFixed(2), y: +game.riding.y.toFixed(2), z: +game.riding.z.toFixed(2), ry: +game.riding.ry.toFixed(3), anim: 'drive', riding: true };
    }
    return { t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim };
  });
  document.getElementById('loading').classList.add('hidden');
  game.warpToPlot(game.plotId ?? 0);
  toast(`Welcome, Chef ${game.me.name}! 👨‍🍳`);
});

net.on('player.join', (msg) => { game.players.set(msg.player.id, playerRecord(msg.player)); toast(`${msg.player.name} came to town!`); });
net.on('player.leave', (msg) => {
  const rec = game.players.get(msg.id);
  if (!rec) return;
  rec.tag.dispose();
  scene.remove(rec.group);
  scene.remove(rec.moped.group);
  game.players.delete(msg.id);
});
net.on('player.update', (msg) => {
  if (msg.player.id === game.me.id) {
    game.plotId = msg.player.plotId;
    const carried = msg.player.carryOrder;
    setMyHeld(carried);
    return;
  }
  const rec = game.players.get(msg.player.id);
  if (rec) {
    rec.data = msg.player;
    setHeld(rec, msg.player.carryOrder);
  }
});

net.on('snapshot', (msg) => {
  for (const [id, x, y, z, ry, anim, riding] of msg.players) {
    if (id === game.me.id) continue;
    const rec = game.players.get(id);
    if (!rec) continue;
    rec.interp.push([x, y, z, ry]);
    rec.serverAnim = anim;
    rec.riding = !!riding;
  }
  for (const [id, x, y, z, ry, anim, riding, carry] of msg.npcs) {
    let rec = game.npcs.get(id);
    if (!rec) continue;
    rec.interp.push([x, y, z, ry]);
    rec.serverAnim = anim;
    rec.riding = !!riding;
  }
});

net.on('npc.add', (msg) => { if (!game.npcs.has(msg.npc.id)) game.npcs.set(msg.npc.id, npcRecord(msg.npc)); });
net.on('npc.remove', (msg) => {
  const rec = game.npcs.get(msg.id);
  if (!rec) return;
  rec.tag.dispose();
  scene.remove(rec.group);
  if (rec.moped) scene.remove(rec.moped.group);
  game.npcs.delete(msg.id);
});
net.on('npc.bubble', (msg) => {
  const rec = game.npcs.get(msg.id);
  if (rec) { rec.tag.setBubble(msg.text, 4); rec.tag.update(''); }
});
net.on('npc.carry', (msg) => {
  const rec = game.npcs.get(msg.id);
  if (rec) setHeld(rec, msg.order);
});
net.on('npc.ride', (msg) => {
  const rec = game.npcs.get(msg.id);
  if (rec) rec.riding = msg.riding;
});

net.on('restaurant.update', (msg) => {
  rebuildRestaurant(msg.plotId, msg.r);
  if (game.plotId === msg.plotId) ratingEl.textContent = msg.r.rating.toFixed(1);
  renderTickets();
});
net.on('restaurants', (msg) => {
  for (const [plotIdStr, r] of Object.entries(msg.restaurants)) rebuildRestaurant(Number(plotIdStr), r);
  // plots may have been released
  for (const plotId of [...game.restaurants.keys()]) {
    if (!msg.restaurants[plotId]) {
      const old = game.restaurants.get(plotId);
      scene.remove(old.shell.group);
      for (const rec of Object.values(old.itemMeshes)) scene.remove(rec.mesh);
      game.restaurants.delete(plotId);
    }
  }
});
net.on('restaurant.rating', (msg) => {
  const rec = game.restaurants.get(msg.plotId);
  if (rec) {
    rec.r.rating = msg.rating;
    rec.shell.group.userData.setRating(msg.rating);
    if (game.plotId === msg.plotId) ratingEl.textContent = msg.rating.toFixed(1);
  }
});

net.on('order.update', (msg) => {
  game.orders.set(msg.order.id, hydrateOrder(msg.order));
  renderTickets();
});
net.on('order.remove', (msg) => {
  const o = game.orders.get(msg.id);
  if (o?.carrier === game.me.id) setMyHeld(null);
  game.orders.delete(msg.id);
  if (msg.served) audio.sfx('ding');
  if (msg.served && o?.carrier === game.me.id) window.ClaudeBox?.completeChallenge('rs-serve');
  renderTickets();
});

net.on('pile.add', (msg) => { game.piles.set(msg.pile.id, pileRecord(msg.pile)); audio.sfx('cash'); });
net.on('pile.remove', (msg) => {
  const rec = game.piles.get(msg.id);
  if (rec) scene.remove(rec.mesh);
  game.piles.delete(msg.id);
});

net.on('cash', (msg) => {
  game.cash = msg.cash;
  cashEl.textContent = msg.cash;
  if (msg.reason !== 'trickle') audio.sfx('cash');
});

net.on('bag.receive', (msg) => {
  game.hasBag = msg.dishId;
  setMyHeld('bag');
  toast('🛍️ Here\'s your order!');
});

net.on('doorbell', (msg) => {
  audio.sfx('doorbell');
});

net.on('coowner.invited', (msg) => {
  panels.open('coinvite', (panel) => {
    const h = document.createElement('h2');
    h.textContent = '🤝 Co-owner invite';
    panel.appendChild(h);
    panel.appendChild(document.createTextNode(`${msg.from} wants you to co-own ${msg.name}! Your current plot will be released.`));
    const row = panels.row(panel);
    panels.button(row, 'Accept!', () => { net.send({ t: 'coowner.accept', plotId: msg.plotId }); panels.closeAll(); }, 'gold');
    panels.button(row, 'No thanks', () => panels.closeAll());
  });
});

net.on('chat', (msg) => {
  chat.addMessage(msg.name, msg.text, msg.id === game.me.id);
  const rec = msg.id === game.me.id ? { tag: myTag, name: game.me.name } : game.players.get(msg.id);
  if (rec) { rec.tag.setBubble(msg.text); rec.tag.update(msg.id === game.me.id ? game.me.name : rec.data.name); }
});
net.on('toast', (msg) => toast(msg.text));
net.on('pose.fx', (msg) => {
  const rec = game.players.get(msg.id);
  if (rec) rec.poseOverride = msg.kind === 'stand' ? null : ANIM_MAP[msg.kind] || null;
});
net.on('_disconnect', () => {
  toast('Lost connection — reloading…');
  setTimeout(() => location.reload(), 1800);
});

// ============================ game loop ============================
const input = { x: 0, z: 0, steer: 0, throttle: 0, brake: 0, handbrake: false };
let lastTime = performance.now();
let hudTimer = 0;
let currentMusicPlot = null;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.06, (now - lastTime) / 1000);
  const nowS = now / 1000;
  lastTime = now;

  controls.poll(input);

  // ---- movement / riding ----
  if (game.riding) {
    game.riding.update(dt, input);
    player.pos.x = game.riding.x;
    player.pos.y = game.riding.y;
    player.pos.z = game.riding.z;
    player.ry = game.riding.ry;
    if (myMoped) {
      myMoped.group.position.set(game.riding.x, game.riding.y, game.riding.z);
      myMoped.group.rotation.set(game.riding.pitch, game.riding.ry, game.riding.roll);
      for (const w of myMoped.wheels) {
        w.pivot.children[0].rotation.x += (game.riding.speed / 0.26) * dt;
        if (w.front) w.pivot.rotation.y = -game.riding.steerVis;
      }
      myMoped.handlePivot.rotation.y = -game.riding.steerVis;
    }
    if (Math.abs(game.riding.speed) > 1 && Math.random() < dt * 6) audio.sfx('moped');
    myAnim.anim = 'drive';
  } else {
    player.update(dt, input, orbit.yaw + Math.PI);
    myAnim.anim = player.anim;
  }

  // ---- my avatar ----
  meGroup.position.set(player.pos.x, player.pos.y + (game.riding ? 0.45 : 0), player.pos.z);
  meGroup.rotation.y = player.ry;
  myAnim.speed = Math.hypot(player.vel.x, player.vel.z);
  const bob = animatePlayer(myAvatar.parts, myAnim, dt);
  myAvatar.group.position.y = bob;
  if (myTag.tick(nowS)) myTag.update(game.me.name);

  // ---- build mode ghost ----
  buildMode.tick();

  // ---- remote players ----
  for (const rec of game.players.values()) {
    const s = rec.interp.sample([3]);
    if (s) {
      rec.group.position.set(s[0], s[1] + (rec.riding ? 0.45 : 0), s[2]);
      rec.group.rotation.y = s[3];
    }
    rec.moped.group.visible = !!rec.riding;
    if (rec.riding) {
      rec.moped.group.position.set(rec.group.position.x, rec.group.position.y - 0.45, rec.group.position.z);
      rec.moped.group.rotation.y = rec.group.rotation.y;
    }
    rec.anim.anim = rec.poseOverride || ANIM_MAP[rec.serverAnim] || rec.serverAnim || 'idle';
    const rbob = animatePlayer(rec.parts, rec.anim, dt);
    rec.avatarGroup.position.y = rbob;
    if (rec.tag.tick(nowS)) rec.tag.update(rec.data.name);
  }

  // ---- NPCs ----
  for (const rec of game.npcs.values()) {
    const s = rec.interp.sample([3]);
    if (s) {
      rec.group.position.set(s[0], (s[1] || GROUND) + (rec.riding ? 0.45 : 0), s[2]);
      rec.group.rotation.y = s[3];
    }
    if (rec.moped) {
      rec.moped.group.visible = !!rec.riding;
      if (rec.riding) {
        rec.moped.group.position.set(rec.group.position.x, rec.group.position.y - 0.45, rec.group.position.z);
        rec.moped.group.rotation.y = rec.group.rotation.y;
      }
    }
    rec.anim.anim = rec.riding ? 'drive' : ANIM_MAP[rec.serverAnim] || 'idle';
    const nbob = animatePlayer(rec.parts, rec.anim, dt);
    rec.avatarGroup.position.y = nbob;
    if (rec.tag.tick(nowS)) rec.tag.update(rec.data.kind === 'customer' ? '' : rec.tag.cached?.split('|')[0] || '');
  }

  // ---- restaurant music zones ----
  const onPlot = plotAt(player.pos.x, player.pos.z);
  const rest = onPlot ? game.restaurants.get(onPlot.id) : null;
  audio.fadeTo(rest?.r.music || null); // no-ops when unchanged

  // ---- stove flames / oven glows pulse when cooking at that restaurant ----
  // (simple ambient: flames flicker on stoves of restaurants with active cooking)
  // handled cheaply: flicker all flames
  if (Math.floor(nowS * 10) % 2 === 0) {
    for (const rest of game.restaurants.values()) {
      // which station types have an actively cooking step right now?
      const hot = new Set();
      for (const o of game.orders.values()) {
        if (o.plotId === rest.plotId && (o.state === 'cooking' || o.state === 'claimed') && o.stepDef) hot.add(o.stepDef.station);
      }
      for (const rec of Object.values(rest.itemMeshes)) {
        if (rec.mesh.userData.flames) {
          const on = hot.has('stove');
          rec.mesh.userData.flames.forEach((f) => { f.visible = on; f.scale.setScalar(1 + Math.sin(nowS * 11) * 0.2); });
        }
        if (rec.mesh.userData.glow) rec.mesh.userData.glow.visible = hot.has('oven');
      }
    }
  }

  // ---- HUD ----
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    renderActions(computeActions());
  }

  // house doors swing open for anyone close
  for (const d of houseDoors) {
    let near = Math.hypot(player.pos.x - d.x, player.pos.z - d.z) < 3;
    if (!near) {
      for (const rec of game.players.values()) {
        if (Math.hypot(rec.group.position.x - d.x, rec.group.position.z - d.z) < 3) { near = true; break; }
      }
    }
    const target = near ? -1.9 : 0;
    d.pivot.rotation.y += (target - d.pivot.rotation.y) * Math.min(1, dt * 6);
  }

  lights.tick(camera);
  orbit.update(dt, player.pos);
  renderer.render(scene, camera);
}

frame();
