// Feather Friends — client entry point.
// Boots the renderer + world, runs the menu, then joins the LAN server.

import * as THREE from 'three';
import { WORLD, groundAt as height, canDrinkAt, waterAt, lavaAt } from '/shared/worldgen.js';
import { device, effectiveMode } from './device.js';
import { audio } from './audio.js';
import { loadSettings, saveSettings, buildSettingsPanel } from './ui/settings.js';
import { runMenu } from './ui/menu.js';
import { Net, InterpBuffer } from './net.js';
import { PlayerController } from './player/controller.js';
import { OrbitCamera } from './player/camera.js';
import { DesktopControls } from './controls/desktop.js';
import { MobileControls } from './controls/mobile.js';
import { buildTerrain } from './world/terrain.js';
import { buildWater } from './world/water.js';
import { buildProps } from './world/props.js';
import { buildSky } from './world/sky.js';
import { buildBird } from './birds/factory.js';
import { animateBird, makeAnimState } from './birds/animate.js';
import { BREEDS, defaultColors } from './birds/breeds.js';
import { Nametag } from './ui/nametags.js';
import { Chat, toast } from './ui/chat.js';
import { Hud } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { buildFlockPanel } from './ui/flocks.js';
import { buildNestPanel } from './ui/nest.js';
import { buildCustomizePanel } from './ui/customize.js';
import { buildRealmPanel } from './ui/realms.js';
import { buildWarpPanel } from './ui/warp.js';
import { buildCardPanel } from './ui/namecard.js';
import { buildActionsPanel } from './ui/actions.js';
import { FxSystem } from './fx.js';

const LAST_KEY = 'featherfriends.lastProfile';

// PWA: lets the game install as a home-screen/dock app with no browser UI
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ============================== game object ==============================
const game = {
  settings: loadSettings(),
  me: null,                 // { id, name, bird, nameStyle, flock, carriedBy, carrying }
  players: new Map(),       // id -> remote player record
  npcs: new Map(),
  items: new Map(),
  nests: new Map(),         // ownerName(lower) -> { data, group }
  flocks: new Map(),        // name -> { name, color, leader, members }
  trunks: [],
  speedScale: 1,
  inWorld: false,
  audio,
};
window.__game = game; // handy for debugging

// ============================== renderer ==============================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // soft, cozy shadow edges
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, WORLD.size * 3.6);
camera.position.set(0, 30, 40);

game.renderer = renderer;
game.scene = scene;
game.camera = camera;

function applyQuality() {
  const q = game.settings.quality;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'low' ? 1 : 2));
}
game.applyQuality = applyQuality;
applyQuality();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ============================== world ==============================
const terrain = buildTerrain(game.settings.quality);
scene.add(terrain);
const water = buildWater();
scene.add(water);
const props = buildProps(game.settings.quality);
scene.add(props);
game.trunks = props.userData.trunks || [];
const sky = buildSky(scene, game.settings.quality);
const fx = new FxSystem(scene);
game.fx = fx;

// ============================== helpers ==============================

function tintedColors(breed, tint) {
  const base = defaultColors(breed);
  const out = { ...base };
  const c = new THREE.Color();
  for (const slot of ['body', 'wings', 'head', 'belly']) {
    c.set(base[slot]).offsetHSL((tint - 0.5) * 0.14, 0, (tint - 0.5) * 0.1);
    out[slot] = '#' + c.getHexString();
  }
  return out;
}

function birdRecord(birdData, isNpc = false) {
  const rec = {
    data: birdData,
    group: new THREE.Group(),
    bird: null,
    animState: makeAnimState(),
    interp: new InterpBuffer(),
    nametag: isNpc ? null : new Nametag(),
    isNpc,
  };
  rec.group.rotation.order = 'YXZ';   // yaw, then pitch, then roll (flight attitude)
  scene.add(rec.group);
  rebuildRecBird(rec);
  return rec;
}

function rebuildRecBird(rec) {
  if (rec.bird) rec.group.remove(rec.bird.group);
  const d = rec.data;
  const colors = rec.isNpc ? tintedColors(d.breed, d.tint) : d.bird.colors;
  const breed = rec.isNpc ? d.breed : d.bird.breed;
  const stage = rec.isNpc ? 'adult' : d.bird.stage;
  rec.bird = buildBird(breed, colors, stage);
  const tagY = tagHeight(rec.bird); // measure while unparented = local space
  rec.group.add(rec.bird.group);
  if (rec.nametag) {
    rec.group.add(rec.nametag.sprite);
    rec.nametag.sprite.position.y = tagY;
    refreshTag(rec);
  }
}

function tagHeight(bird) {
  // top of the actual model — the sprite is bottom-anchored, so the tag
  // text starts just above the mesh and grows upward
  const box = new THREE.Box3().setFromObject(bird.group);
  const top = isFinite(box.max.y) ? box.max.y : bird.standH + bird.size;
  return top + 0.15;
}

function refreshTag(rec) {
  if (!rec.nametag) return;
  const d = rec.data;
  const flock = d.flock ? game.flocks.get(d.flock) : null;
  rec.nametag.update({
    name: (d.creatureName || d.name),
    description: d.description || '',
    realm: d.realm || '',
    nameStyle: d.nameStyle,
    breed: d.bird.breed,
    stage: d.bird.stage,
    flockName: flock?.name || null,
    flockColor: flock?.color || null,
    flockRole: d.flockRole || (flock && flock.leader === d.name.toLowerCase() ? 'Leader' : flock ? 'Member' : ''),
  });
}

function refreshAllTags() {
  for (const rec of game.players.values()) refreshTag(rec);
  refreshTag(meRec);
}

// ---------------- items ----------------
const itemMats = {};
function im(hex) {
  if (!itemMats[hex]) itemMats[hex] = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
  return itemMats[hex];
}

function makeItemMesh(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'mouse': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 5), im('#9a8d80'));
      body.scale.set(1, 0.8, 1.4);
      body.position.y = 0.16;
      const ear1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), im('#c4aa9d'));
      ear1.position.set(-0.09, 0.32, 0.2);
      const ear2 = ear1.clone();
      ear2.position.x = 0.09;
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.012, 0.42, 4), im('#c4aa9d'));
      tail.rotation.x = Math.PI / 2 - 0.4;
      tail.position.set(0, 0.12, -0.4);
      g.add(body, ear1, ear2, tail);
      break;
    }
    case 'fruit': {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), im('#e2483b'));
      f.position.y = 0.22;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 4), im('#5d4a38'));
      stem.position.y = 0.46;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), im('#59d185'));
      leaf.scale.set(1.4, 0.4, 0.8);
      leaf.position.set(0.1, 0.48, 0);
      g.add(f, stem, leaf);
      break;
    }
    case 'cactusfruit': {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), im('#e84f8a'));
      f.scale.y = 1.3;
      f.position.y = 0.24;
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 5), im('#bf3a6e'));
      top.position.y = 0.52;
      g.add(f, top);
      break;
    }
    case 'fish': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 7, 5), im('#6fa8d8'));
      body.scale.set(0.7, 0.8, 1.5);
      body.position.y = 0.18;
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.26, 4), im('#5d90bd'));
      tail.rotation.x = Math.PI / 2 + 0.3;
      tail.position.set(0, 0.18, -0.42);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 4), im('#1c1c1c'));
      eye.position.set(0.12, 0.24, 0.22);
      g.add(body, tail, eye);
      break;
    }
    case 'mushroom': {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.3, 5), im('#e8e0d0'));
      stem.position.y = 0.15;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), im('#d2453a'));
      cap.position.y = 0.28;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 4, 4), im('#ffffff'));
      dot.position.set(0.08, 0.4, 0.08);
      g.add(stem, cap, dot);
      break;
    }
    case 'banana': {
      const b = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 6, 8, Math.PI * 1.15), im('#f2d23a'));
      b.rotation.z = 0.6;
      b.position.y = 0.2;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), im('#6e5a28'));
      tip.position.set(-0.16, 0.34, 0);
      g.add(b, tip);
      break;
    }
    case 'snowberry': {
      const cluster = im('#7ab8f0');
      for (const [bx, by] of [[0, 0.14], [0.13, 0.2], [-0.12, 0.22], [0.02, 0.3]]) {
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), cluster);
        berry.position.set(bx, by, 0);
        g.add(berry);
      }
      const frost = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), im('#ffffff'));
      frost.position.set(0, 0.36, 0.06);
      g.add(frost);
      break;
    }
    case 'emberfruit': {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
        new THREE.MeshLambertMaterial({ color: '#ff7a30', emissive: '#7a2008', flatShading: true }));
      f.position.y = 0.22;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 5),
        new THREE.MeshLambertMaterial({ color: '#ffd23a', emissive: '#b86a10', flatShading: true }));
      flame.position.y = 0.5;
      g.add(f, flame);
      break;
    }
    case 'starfruit': {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0),
        new THREE.MeshLambertMaterial({ color: '#f8f4c8', emissive: '#8a7a3a', flatShading: true }));
      star.position.y = 0.26;
      star.scale.set(0.8, 1.3, 0.8);
      g.add(star);
      break;
    }
    case 'snake': {
      // a coiled snake: segmented body following a tightening spiral
      const segs = 14;
      for (let i = 0; i < segs; i++) {
        const t = i / segs;
        const ang = t * Math.PI * 4;
        const rad = 0.42 * (1 - t * 0.7);
        const seg = new THREE.Mesh(new THREE.SphereGeometry(0.14 * (1 - t * 0.4), 7, 6), im(i % 2 ? '#5d8a3c' : '#76a84a'));
        seg.position.set(Math.cos(ang) * rad, 0.12 + t * 0.06, Math.sin(ang) * rad);
        g.add(seg);
      }
      // head + tongue on the last segment
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), im('#76a84a'));
      head.scale.set(1.1, 0.8, 1.4);
      head.position.set(0.06, 0.2, 0.02);
      const tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4), im('#e23b3b'));
      tongue.rotation.x = Math.PI / 2;
      tongue.position.set(0.06, 0.2, 0.18);
      g.add(head, tongue);
      break;
    }
  }
  return g;
}

function addItem(item) {
  if (game.items.has(item.id)) return;
  const mesh = makeItemMesh(item.kind);
  const w = waterAt(item.x, item.z, item.y);
  const y = w ? w.surface : item.y;
  mesh.position.set(item.x, y, item.z);
  scene.add(mesh);
  game.items.set(item.id, { data: item, mesh, target: { x: item.x, y, z: item.z } });
}

const ITEM_LABEL = {
  mouse: 'mouse', fruit: 'fruit', cactusfruit: 'cactus fruit', fish: 'fish', mushroom: 'mushroom',
  banana: 'banana', snowberry: 'snowberry', emberfruit: 'emberfruit', starfruit: 'starfruit', snake: 'snake',
};
// a richer label for prey, e.g. "snake (13m)"
function itemLabel(item) {
  const base = ITEM_LABEL[item.kind] || 'it';
  if (item.kind === 'snake' && item.length) return `${base} (${item.length}m)`;
  return base;
}

// ---------------- nests ----------------
function makeNestMesh(nest, ownerName) {
  const g = new THREE.Group();
  const twigMat = new THREE.MeshLambertMaterial({ color: nest.twig, flatShading: true });
  const liningMat = new THREE.MeshLambertMaterial({ color: nest.lining, flatShading: true });
  const type = nest.type || 'stick';

  // shared cozy lining bowl
  const lining = new THREE.Mesh(new THREE.CylinderGeometry(1.06, 0.85, 0.34, 14), liningMat);
  lining.position.y = 0.26;

  if (type === 'rock') {
    // a ring of boulders
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + (i % 3) * 0.12, 0), twigMat);
      rk.position.set(Math.cos(a) * 1.3, 0.3, Math.sin(a) * 1.3);
      rk.rotation.set(i, i * 1.7, i * 0.5);
      g.add(rk);
    }
    g.add(lining);
  } else if (type === 'dirt') {
    // a shallow scrape in a low dirt rim
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.4, 16), twigMat);
    rim.position.y = 0.2;
    g.add(rim, lining);
  } else if (type === 'burrow') {
    // a mounded burrow with a dark entrance hole
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), twigMat);
    mound.scale.y = 0.7;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.55, 14), new THREE.MeshBasicMaterial({ color: '#1a140e' }));
    hole.position.set(0, 0.34, 1.1);
    hole.rotation.x = -0.5;
    g.add(mound, hole);
  } else if (type === 'mound') {
    // a tall layered mound of mud/vegetation
    for (let i = 0; i < 3; i++) {
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(1.4 - i * 0.35, 1.6 - i * 0.35, 0.5, 12), i === 2 ? liningMat : twigMat);
      tier.position.y = 0.25 + i * 0.45;
      g.add(tier);
    }
  } else if (type === 'cavity') {
    // a hollow log/stump with a soft cavity
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 1.5, 14), twigMat);
    stump.position.y = 0.75;
    const hollow = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 14), new THREE.MeshBasicMaterial({ color: '#1a140e' }));
    hollow.position.y = 1.3;
    const bowl = lining.clone(); bowl.position.y = 1.15; bowl.scale.setScalar(0.85);
    g.add(stump, hollow, bowl);
  } else {
    // stick nest (default): woven twig ring + stray twigs
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.42, 7, 14), twigMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.34;
    for (let i = 0; i < 8; i++) {
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 4), twigMat);
      const a = (i / 8) * Math.PI * 2 + 0.4;
      tw.position.set(Math.cos(a) * 1.32, 0.52, Math.sin(a) * 1.32);
      tw.rotation.set(Math.PI / 2.3, 0, a + 0.8);
      g.add(tw);
    }
    g.add(ring, lining);
  }

  // floating label
  const tag = new Nametag();
  tag.update({ name: `${ownerName}'s Nest`, nameStyle: { color: '#ffe9b8', style: 'outline' }, breed: '', stage: 'adult' });
  tag.sprite.position.y = 1.1;
  tag.sprite.scale.multiplyScalar(0.8);
  g.add(tag.sprite);

  g.position.set(nest.x, nest.y, nest.z);
  return g;
}

function setNest(ownerName, nest) {
  const key = ownerName.toLowerCase();
  const old = game.nests.get(key);
  if (old) scene.remove(old.group);
  const group = makeNestMesh(nest, ownerName);
  scene.add(group);
  game.nests.set(key, { data: nest, group, ownerName });
}

game.myNest = () => game.nests.get(game.me?.name.toLowerCase())?.data || null;

// Nest collision surface: the twig rim (torus r=1.3, tube=0.42) is a step
// you climb onto; inside, you settle onto the lining a little lower.
const NEST_OUTER = 1.78, NEST_INNER = 0.85, NEST_RIM_TOP = 0.74, NEST_BOWL_TOP = 0.42;
game.nestSurface = (x, z) => {
  let top = null;
  for (const { data } of game.nests.values()) {
    const d = Math.hypot(x - data.x, z - data.z);
    if (d > NEST_OUTER) continue;
    const h = data.y + (d < NEST_INNER ? NEST_BOWL_TOP : NEST_RIM_TOP);
    if (top === null || h > top) top = h;
  }
  return top;
};

// ============================== boot ==============================

const profile = await runMenu();

game.me = {
  id: null,
  name: profile.name,
  bird: { breed: profile.breed, stage: profile.stage, colors: profile.colors },
  nameStyle: profile.nameStyle,
  flock: null,
  carrying: null,
  carriedBy: null,
};

// my own bird + tag
const meRec = {
  data: game.me,
  group: new THREE.Group(),
  bird: null,
  animState: makeAnimState(),
  nametag: new Nametag(),
  isNpc: false,
};
meRec.group.rotation.order = 'YXZ';   // yaw, then pitch, then roll
scene.add(meRec.group);
rebuildRecBird(meRec);

game.refreshMyBird = () => {
  rebuildRecBird(meRec);
  saveLastProfile();
};

function saveLastProfile() {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({
      name: game.me.name,
      stage: game.me.bird.stage,
      breed: game.me.bird.breed,
      colors: game.me.bird.colors,
      nameStyle: game.me.nameStyle,
    }));
  } catch {}
}

// player + camera + controls
const player = new PlayerController(game);
game.player = player;
player.spawnAt(WORLD.spawn.x + (Math.random() * 8 - 4), WORLD.spawn.z + (Math.random() * 8 - 4));

const orbit = new OrbitCamera(camera);
orbit.sensitivity = game.settings.camSensitivity;
orbit.invertY = game.settings.invertY;
game.orbit = orbit;

const hud = new Hud(game);
const panels = new Panels();
game.panels = panels;
const chat = new Chat(game);
game.chat = chat;

document.getElementById('hud').classList.remove('hidden');

// ---- bottom menu bar (panel launchers) ----
const MENU_BAR = [
  { id: 'realm', icon: '🌐', label: 'Realms', build: (p) => buildRealmPanel(p, game, panels) },
  { id: 'customize', icon: '🎨', label: 'Customize', build: (p) => buildCustomizePanel(p, game, panels) },
  { id: 'warp', icon: '✨', label: 'Teleport', build: (p) => buildWarpPanel(p, game, panels) },
  { id: 'card', icon: '🏷️', label: 'Name', build: (p) => buildCardPanel(p, game, panels) },
  { id: 'flock', icon: '🪶', label: 'Flocks', build: (p) => buildFlockPanel(p, game, panels) },
  { id: 'actions', icon: '🎭', label: 'Actions', build: (p) => buildActionsPanel(p, game, panels) },
  { id: 'nest', icon: '🪹', label: 'Nests', build: (p) => buildNestPanel(p, game, panels) },
];
{
  const bar = document.getElementById('menu-bar');
  for (const m of MENU_BAR) {
    const btn = document.createElement('button');
    btn.className = 'menu-bar-btn';
    btn.innerHTML = `<span class="mb-icon">${m.icon}</span>${m.label}`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); panels.toggle(m.id, m.build); });
    bar.appendChild(btn);
  }
}

// ---- feather currency counter ----
function updateFeatherCounter(gain) {
  const el = document.getElementById('feather-count');
  if (el) el.textContent = (game.me.feathers || 0).toLocaleString();
  if (gain) {
    const c = document.getElementById('feather-counter');
    c?.classList.remove('bump'); void c?.offsetWidth; c?.classList.add('bump');
    const pop = document.createElement('div');
    pop.className = 'feather-pop';
    pop.textContent = '+' + gain;
    document.body.appendChild(pop);
    setTimeout(() => pop.remove(), 1000);
  }
}
game.updateFeatherCounter = updateFeatherCounter;

document.getElementById('hud-settings-btn').addEventListener('click', () => {
  panels.toggle('settings', (p) => buildSettingsPanel(p, game, panels));
});
document.getElementById('menu-settings-btn')?.addEventListener('click', () => {
  panels.toggle('settings', (p) => buildSettingsPanel(p, game, panels));
});

let controls = null;
let controlsMode = null;
function applyControlsMode(mode) {
  if (mode === controlsMode) return;
  if (controls?.destroy) controls.destroy();
  controlsMode = mode;
  controls = mode === 'mobile' ? new MobileControls(game) : new DesktopControls(game);
  game.controls = controls;   // exposed for settings + test harnesses
  if (mode === 'mobile') controls.refreshFlightUI(player.flying);
}
game.applyControlsMode = applyControlsMode;
applyControlsMode(effectiveMode(game.settings.controlsMode));

game.onLanded = () => {
  if (controlsMode === 'mobile') controls.refreshFlightUI(false);
};

game.teleportTo = (x, z, y = null) => {
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = Math.max(height(x, z, y), 0) + 0.5;
  player.vel = { x: 0, y: 0, z: 0 };
  player.flying = false;
  fx.burst('poof', new THREE.Vector3(x, player.pos.y, z), 10, 2);
  audio.sfx('whoosh');
};

// ============================== actions ==============================
let actionAnim = null;       // { type, until }
function playActionAnim(type, secs) {
  actionAnim = { type, until: performance.now() / 1000 + secs };
}

game.actions = {
  toggleFly() {
    if (game.me.bird.stage === 'egg') return toast("Eggs can't fly... hatch first!");
    const flying = player.toggleFly();
    audio.sfx(flying ? 'whoosh' : 'flap');
    if (controlsMode === 'mobile') controls.refreshFlightUI(flying);
  },
  sit() {
    player.sitting = !player.sitting;
  },
  // play an emote: an animation pose (networked via currentAnim) plus an
  // italic action bubble over the head everyone can see
  emote(pose, secs, bubble) {
    if (game.me.bird.stage === 'egg') return;
    player.sitting = false;
    if (pose) playActionAnim(pose, secs);
    if (bubble) game.net.send({ t: 'chat', text: `*${bubble}*` });
  },
  drop() {
    if (game.me.carrying) game.net.send({ t: 'drop' });
  },
  primary() {
    // mirrors the first context action shown in the HUD
    const list = computeActions();
    const a = list.find((x) => x.kind === 'primary' || x.kind === 'urgent');
    a?.fn();
  },
};

function nearestItem(maxDist) {
  let best = null, bestD = maxDist;
  for (const it of game.items.values()) {
    if (it.data.heldBy) continue;
    const d = Math.hypot(it.mesh.position.x - player.pos.x, it.mesh.position.z - player.pos.z);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

function nearestCarryablePlayer(maxDist) {
  let best = null, bestD = maxDist;
  for (const rec of game.players.values()) {
    const d = rec.data;
    if (!['egg', 'baby'].includes(d.bird.stage) || d.carriedBy) continue;
    const dist = Math.hypot(rec.group.position.x - player.pos.x, rec.group.position.z - player.pos.z);
    if (dist < bestD) { bestD = dist; best = rec; }
  }
  return best;
}

function computeActions() {
  const me = game.me;
  const list = [];

  if (me.carriedBy) {
    list.push({ id: 'wiggle', label: 'Wiggle free!', emoji: '🐣', kind: 'urgent', hotkey: 'E', fn: () => game.net.send({ t: 'wiggle' }) });
    return list;
  }

  if (me.bird.stage === 'egg') {
    list.push({ id: 'hatch', label: 'Hatch!', emoji: '🐣', kind: 'primary', hotkey: 'E', fn: () => {
      me.bird.stage = 'baby';
      game.net.send({ t: 'stage', stage: 'baby' });
      game.refreshMyBird();
      fx.burst('hatch', meRec.group.position, 18);
      audio.sfx('crack');
    } });
  } else if (me.bird.stage === 'baby') {
    list.push({ id: 'grow', label: 'Grow up', emoji: '🐦', fn: () => {
      me.bird.stage = 'adult';
      game.net.send({ t: 'stage', stage: 'adult' });
      game.refreshMyBird();
      fx.burst('grow', meRec.group.position, 20);
      audio.sfx('sparkle');
    } });
  }

  if (me.carrying) {
    if (me.carrying.kind === 'item') {
      list.unshift({ id: 'eat', label: `Eat ${ITEM_LABEL[me.carrying.itemKind] || 'it'}`, emoji: '😋', kind: 'primary', hotkey: 'E', fn: () => {
        game.net.send({ t: 'eat' });
        playActionAnim('peck', 1.2);
      } });
      list.push({ id: 'drop', label: 'Drop', emoji: '🫳', hotkey: 'Q', fn: () => game.actions.drop() });
    } else {
      list.push({ id: 'putdown', label: 'Put down', emoji: '🫳', kind: 'primary', hotkey: 'Q', fn: () => game.actions.drop() });
    }
  } else if (me.bird.stage !== 'egg') {
    const it = nearestItem(4.2);
    if (it) {
      list.unshift({ id: 'pickup', label: `Pick up ${itemLabel(it.data)}`, emoji: '🤏', kind: 'primary', hotkey: 'E', fn: () => {
        game.net.send({ t: 'pickup', kind: 'item', id: it.data.id });
        audio.sfx('pickup');
      } });
    } else if (me.bird.stage === 'adult') {
      const target = nearestCarryablePlayer(5);
      if (target) {
        list.unshift({ id: 'pickupP', label: `Pick up ${target.data.name}`, emoji: '🤗', kind: 'primary', hotkey: 'E', fn: () => {
          game.net.send({ t: 'pickup', kind: 'player', id: target.data.id });
        } });
      }
    }
  }

  if (me.bird.stage !== 'egg' && !player.flying && canDrinkAt(player.pos.x, player.pos.z, player.pos.y)) {
    list.push({ id: 'drink', label: 'Drink', emoji: '💧', fn: () => {
      game.net.send({ t: 'drink' });
      playActionAnim('drink', 2.2);
      fx.burst('drink', meRec.group.position, 8, 1.5);
      audio.sfx('gulp');
    } });
  }

  if (me.bird.stage !== 'egg') {
    list.push({ id: 'chirp', label: 'Chirp', emoji: '🎵', fn: () => {
      audio.sfx((BREEDS[me.bird.breed]?.size || 1) > 1.2 ? 'chirp-big' : 'chirp');
      game.net.send({ t: 'chat', text: '*' + (['cockatrice', 'peryton', 'griffin', 'phoenix'].includes(me.bird.breed) ? 'screeches' : 'chirps') + '*' });
    } });
    list.push({ id: 'sit', label: player.sitting ? 'Stand up' : 'Sit', emoji: '🪑', hotkey: 'C', fn: () => game.actions.sit() });
  }

  if (controlsMode === 'desktop') {
    list.push({ id: 'fly', label: player.flying ? 'Land' : 'Fly', emoji: '🪽', hotkey: 'F', fn: () => game.actions.toggleFly() });
  }

  list.push({ id: 'chat', label: 'Chat', emoji: '💬', fn: () => chat.openInput() });
  // flock / nest / customize / realms / actions live in the bottom menu bar now

  return list;
}

// ============================== networking ==============================
const net = new Net();
game.net = net;
net.connect();
net.join({
  name: game.me.name,
  bird: game.me.bird,
  nameStyle: game.me.nameStyle,
  code: localStorage.getItem('claudebox.code') || '',
});

net.on('welcome', (msg) => {
  game.me.id = msg.id;
  game.me.flock = msg.you.flock;
  game.me.creatureName = msg.you.creatureName || '';
  game.me.description = msg.you.description || '';
  game.me.realm = msg.you.realm || '';
  game.me.flockRole = msg.you.flockRole || '';
  game.me.feathers = msg.you.feathers || 0;
  meRec.data.creatureName = game.me.creatureName;
  meRec.data.description = game.me.description;
  meRec.data.realm = game.me.realm;
  meRec.data.flockRole = game.me.flockRole;
  updateFeatherCounter();
  for (const f of msg.flocks) if (f) game.flocks.set(f.name, f);
  for (const p of msg.players) addPlayer(p);
  for (const item of msg.items) addItem(item);
  for (const n of msg.npcs) addNpc(n);
  for (const nestInfo of msg.nests) setNest(nestInfo.ownerName, nestInfo.nest);
  refreshAllTags();
  net.send({ t: 'settings', allowPickup: game.settings.allowPickup });
  net.startMovementStream(() => ({
    x: +player.pos.x.toFixed(2),
    y: +player.pos.y.toFixed(2),
    z: +player.pos.z.toFixed(2),
    ry: +player.ry.toFixed(3),
    rx: +player.pitch.toFixed(3),
    rz: +player.roll.toFixed(3),
    anim: currentAnim(),
  }));
  game.inWorld = true;
  audio.playWorld();
  toast(`Welcome to Feather Friends, ${game.me.name}! 🪶`);
});

function addPlayer(p) {
  if (game.players.has(p.id)) return;
  const rec = birdRecord(p, false);
  rec.group.position.set(p.pos.x, p.pos.y, p.pos.z);
  game.players.set(p.id, rec);
  if (p.nest) setNest(p.name, p.nest);
}

function addNpc(n) {
  const rec = birdRecord(n, true);
  rec.group.position.set(n.x, n.y, n.z);
  game.npcs.set(n.id, rec);
}

net.on('player.join', (msg) => {
  addPlayer(msg.player);
  toast(`${msg.player.name} flew in! 🐦`);
  audio.sfx('toast');
});

net.on('player.leave', (msg) => {
  const rec = game.players.get(msg.id);
  if (!rec) return;
  rec.nametag?.dispose();
  scene.remove(rec.group);
  game.players.delete(msg.id);
});

net.on('snapshot', (msg) => {
  for (const [id, x, y, z, ry, anim, rx, rz] of msg.players) {
    if (id === game.me.id) continue;
    const rec = game.players.get(id);
    if (!rec) continue;
    rec.interp.push(x, y, z, ry, rx || 0, rz || 0);
    rec.serverAnim = anim;
  }
  for (const [id, x, y, z, ry, anim] of msg.npcs) {
    const rec = game.npcs.get(id);
    if (!rec) continue;
    rec.interp.push(x, y, z, ry);
    rec.serverAnim = anim;
  }
});

net.on('player.update', (msg) => {
  const rec = msg.id === game.me.id ? meRec : game.players.get(msg.id);
  if (!rec) return;
  // creature-card / role / realm changes apply to everyone (incl. me)
  if (msg.creatureName !== undefined) rec.data.creatureName = msg.creatureName;
  if (msg.description !== undefined) rec.data.description = msg.description;
  if (msg.realm !== undefined) rec.data.realm = msg.realm;
  if (msg.flockRole !== undefined) rec.data.flockRole = msg.flockRole;
  if (msg.id === game.me.id) {
    game.me.creatureName = rec.data.creatureName;
    game.me.description = rec.data.description;
    game.me.realm = rec.data.realm;
    refreshTag(meRec);
    return;
  }
  const stageChanged = rec.data.bird.stage !== msg.bird.stage || rec.data.bird.breed !== msg.bird.breed;
  rec.data.bird = msg.bird;
  rec.data.nameStyle = msg.nameStyle;
  if (stageChanged) rebuildRecBird(rec);
  else rec.bird.setColors(msg.bird.colors);
  refreshTag(rec);
});

net.on('feathers', (msg) => {
  game.me.feathers = msg.total;
  updateFeatherCounter(msg.gain);
});

net.on('player.flock', (msg) => {
  if (msg.id === game.me.id) {
    game.me.flock = msg.flock;
    refreshTag(meRec);
    return;
  }
  const rec = game.players.get(msg.id);
  if (rec) {
    rec.data.flock = msg.flock;
    refreshTag(rec);
  }
});

net.on('chat', (msg) => {
  chat.addMessage(msg.name, msg.text, msg.id === game.me.id);
  const rec = msg.id === game.me.id ? meRec : game.players.get(msg.id);
  if (rec) {
    rec.nametag.setBubble(msg.text);
    refreshTag(rec);
  }
});

net.on('toast', (msg) => { toast(msg.text); audio.sfx('toast'); });

net.on('item.spawn', (msg) => addItem(msg.item));
net.on('item.move', (msg) => {
  const it = game.items.get(msg.id);
  if (!it) return;
  const w = waterAt(msg.x, msg.z, msg.y);
  it.target = { x: msg.x, y: w ? w.surface : msg.y, z: msg.z };
  it.data.heldBy = null;
});
net.on('item.remove', (msg) => {
  const it = game.items.get(msg.id);
  if (!it) return;
  scene.remove(it.mesh);
  game.items.delete(msg.id);
});

// server-authoritative position snap (used when a carried bird is set down)
net.on('place', (msg) => {
  player.pos.x = msg.x; player.pos.y = msg.y; player.pos.z = msg.z;
  player.vel = { x: 0, y: 0, z: 0 };
});

net.on('carry', (msg) => {
  // resolve carrier + payload on every client
  const isMeCarrier = msg.carrierId === game.me.id;
  const carrierRec = isMeCarrier ? meRec : game.players.get(msg.carrierId);
  const carrier = isMeCarrier ? game.me : carrierRec?.data;
  if (!carrier) return;

  // clear any previous carry state for this carrier
  if (carrier.carrying?.kind === 'player') {
    const prevId = carrier.carrying.id;
    const prev = prevId === game.me.id ? game.me : game.players.get(prevId)?.data;
    if (prev) prev.carriedBy = null;
    // the released bird's interp buffer is full of stale pickup-spot frames —
    // restart it from where they were just set down so they don't snap back
    const prevRec = game.players.get(prevId);
    if (prevRec) {
      prevRec.interp.frames.length = 0;
      prevRec.interp.push(
        prevRec.group.position.x, prevRec.group.position.y, prevRec.group.position.z,
        prevRec.group.rotation.y
      );
    }
  }
  carrier.carrying = msg.kind ? { kind: msg.kind, id: msg.id, itemKind: msg.itemKind } : null;

  if (msg.kind === 'item') {
    const it = game.items.get(msg.id);
    if (it) it.data.heldBy = msg.carrierId;
    audio.sfx('pickup');
  } else if (msg.kind === 'player') {
    const carried = msg.id === game.me.id ? game.me : game.players.get(msg.id)?.data;
    if (carried) carried.carriedBy = msg.carrierId;
    if (msg.id === game.me.id) toast(`${carrier.name} picked you up! 🤗`);
    audio.sfx('pop');
  } else {
    audio.sfx('drop');
  }
});

net.on('nest.set', (msg) => {
  setNest(msg.ownerName, msg.nest);
  if (msg.ownerId === game.me.id) toast('Nest ready! 🪹');
});

net.on('flock.update', (msg) => {
  game.flocks.set(msg.flock.name, msg.flock);
  refreshAllTags();
  panels.closeAll();
});
net.on('flock.remove', (msg) => {
  game.flocks.delete(msg.name);
  if (game.me.flock === msg.name) game.me.flock = null;
  refreshAllTags();
});
net.on('flock.invited', (msg) => {
  audio.sfx('toast');
  toast(`${msg.from} invited you to flock "${msg.flock.name}"!`, {
    invite: true,
    onAccept: () => net.send({ t: 'flock.respond', accept: true, flock: msg.flock.name }),
  });
});

net.on('fx', (msg) => {
  const rec = msg.id === game.me.id ? meRec : game.players.get(msg.id);
  if (!rec) return;
  const pos = rec.group.position;
  switch (msg.kind) {
    case 'hatch': if (msg.id !== game.me.id) { fx.burst('hatch', pos, 18); audio.sfx('crack'); } break;
    case 'grow': if (msg.id !== game.me.id) { fx.burst('grow', pos, 20); audio.sfx('sparkle'); } break;
    case 'eat': fx.burst('eat', pos, 10, 2); if (msg.id !== game.me.id) audio.sfx('crunch'); else audio.sfx('crunch'); break;
    case 'drink': if (msg.id !== game.me.id) fx.burst('drink', pos, 8, 1.5); break;
  }
});

net.on('_disconnect', () => {
  if (!game.inWorld) return;
  toast('Lost connection — reloading...');
  setTimeout(() => location.reload(), 1800);
});

// ============================== game loop ==============================
const input = { x: 0, z: 0, ascend: false, descend: false };
const sampled = { x: 0, y: 0, z: 0, ry: 0 };

function currentAnim() {
  const now = performance.now() / 1000;
  if (actionAnim && now < actionAnim.until) return actionAnim.type;
  actionAnim = null;
  return player.anim;
}

let lastTime = performance.now();
let hudTimer = 0;
let lavaSafeUntil = 0;
let nextAmbientChirp = performance.now() / 1000 + 8;
let prevRyMe = 0;

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// fills st.speed / st.vy / st.turn from how the mesh actually moved this frame
function feedMotion(rec, nx, ny, nz, nry, dt) {
  const st = rec.animState;
  const g = rec.group;
  st.speed = Math.hypot(nx - g.position.x, nz - g.position.z) / dt;
  st.vy = (ny - g.position.y) / dt;
  st.turn = angleDelta(nry, rec.prevRy ?? nry) / dt;
  rec.prevRy = nry;
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.06, (now - lastTime) / 1000);
  const nowS = now / 1000;
  lastTime = now;

  // ---- my movement ----
  controls.poll(input);
  player.update(dt, input, orbit.yaw + Math.PI);

  if (game.me.carriedBy) {
    // slave my position to my carrier's beak
    const carrierRec = game.players.get(game.me.carriedBy);
    if (carrierRec?.bird?.parts.beakTip) {
      const wp = new THREE.Vector3();
      carrierRec.bird.parts.beakTip.getWorldPosition(wp);
      player.pos.x = wp.x; player.pos.y = wp.y; player.pos.z = wp.z;
    }
  }

  meRec.group.position.set(player.pos.x, player.pos.y, player.pos.z);
  // full attitude: yaw + nose pitch + roll (YXZ; +pitch up, +roll right-wing-down)
  meRec.group.rotation.set(-player.pitch, player.ry, -player.roll);
  meRec.animState.anim = currentAnim();
  meRec.animState.speed = Math.hypot(player.vel.x, player.vel.z);
  meRec.animState.vy = player.vel.y;
  meRec.animState.turn = angleDelta(player.ry, prevRyMe) / dt;
  meRec.animState.roll = player.roll;
  meRec.animState.airspeed = player.airspeed;
  meRec.animState.hasAttitude = true;
  prevRyMe = player.ry;
  animateBird(meRec.bird, meRec.animState, dt);

  // ---- remote players ----
  for (const rec of game.players.values()) {
    if (rec.data.carriedBy) {
      const carrierRec = rec.data.carriedBy === game.me.id ? meRec : game.players.get(rec.data.carriedBy);
      if (carrierRec?.bird?.parts.beakTip) {
        const wp = new THREE.Vector3();
        carrierRec.bird.parts.beakTip.getWorldPosition(wp);
        rec.group.position.copy(wp);
      }
      rec.animState.anim = 'carried';
    } else if (rec.interp.sample(sampled)) {
      feedMotion(rec, sampled.x, sampled.y, sampled.z, sampled.ry, dt);
      rec.group.position.set(sampled.x, sampled.y, sampled.z);
      rec.group.rotation.set(-(sampled.rx || 0), sampled.ry, -(sampled.rz || 0));
      rec.animState.anim = rec.serverAnim || 'idle';
      rec.animState.roll = sampled.rz || 0;
      rec.animState.hasAttitude = true;
    }
    animateBird(rec.bird, rec.animState, dt);
    if (rec.nametag.tick(nowS)) refreshTag(rec);
  }
  if (meRec.nametag.tick(nowS)) refreshTag(meRec);

  // ---- npcs ----
  for (const rec of game.npcs.values()) {
    if (rec.interp.sample(sampled)) {
      feedMotion(rec, sampled.x, sampled.y, sampled.z, sampled.ry, dt);
      rec.group.position.set(sampled.x, sampled.y, sampled.z);
      rec.group.rotation.y = sampled.ry;
      rec.animState.anim = rec.serverAnim || 'idle';
    }
    animateBird(rec.bird, rec.animState, dt);
  }

  // ---- items ----
  for (const it of game.items.values()) {
    if (it.data.heldBy) {
      const carrierRec = it.data.heldBy === game.me.id ? meRec : game.players.get(it.data.heldBy);
      if (carrierRec?.bird?.parts.beakTip) {
        carrierRec.bird.parts.beakTip.getWorldPosition(it.mesh.position);
      }
    } else if (it.target) {
      it.mesh.position.x += (it.target.x - it.mesh.position.x) * Math.min(1, dt * 6);
      it.mesh.position.y += (it.target.y - it.mesh.position.y) * Math.min(1, dt * 6);
      it.mesh.position.z += (it.target.z - it.mesh.position.z) * Math.min(1, dt * 6);
      if (it.data.kind === 'mouse') {
        it.mesh.rotation.y = Math.atan2(it.target.x - it.mesh.position.x, it.target.z - it.mesh.position.z) || it.mesh.rotation.y;
      }
      if (it.data.kind === 'fish') {
        it.mesh.position.y += Math.sin(nowS * 2 + it.mesh.position.x) * 0.04;
      }
    }
  }

  // ---- lava is hot (unless you're a phoenix) ----
  if (!player.flying && !game.me.carriedBy && nowS > lavaSafeUntil && lavaAt(player.pos.x, player.pos.z)) {
    if (game.me.bird.breed === 'phoenix') {
      lavaSafeUntil = nowS + 5; // phoenixes bathe in it
    } else {
      lavaSafeUntil = nowS + 1.4;
      player.vel.y = 13;
      player.pos.y += 0.5;
      player.grounded = false;
      fx.burst('eat', meRec.group.position, 8, 2); // ember-colored scatter
      toast('🔥 Hot hot hot!');
      audio.sfx('splash');
    }
  }

  // ---- world ----
  water.userData.tick(nowS);
  sky.group.userData.tick(nowS, dt);

  // keep the sun's shadow box centered on the player so shadows stay crisp
  const sl = sky.sunLight;
  sl.position.set(player.pos.x + 103, player.pos.y + 155, player.pos.z - 118);
  sl.target.position.set(player.pos.x, player.pos.y, player.pos.z);
  sl.target.updateMatrixWorld();
  props.userData.tick?.(nowS, dt);
  fx.update(dt);

  // distant songbirds every so often
  if (nowS > nextAmbientChirp) {
    nextAmbientChirp = nowS + 7 + Math.random() * 12;
    if (game.inWorld) audio.sfx('chirp');
  }

  // ---- HUD (4x/sec is plenty) ----
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    hud.render(computeActions(), controlsMode === 'desktop');
  }

  // ---- camera ----
  orbit.update(dt, player.pos, meRec.bird.size, meRec.bird.stage === 'egg' ? 0.8 : 1.5, {
    flying: player.flying,
    yaw: player.ry,
    pitch: player.pitch,
    roll: player.roll,
    airspeed: player.airspeed,
    flap: player.flapPulse,
  });

  renderer.render(scene, camera);
}

frame();
