// Elemental Tycoon — client. Third-person shooter controller, a client-run
// tycoon economy on your own plot, unlockable elemental powers, and
// server-authoritative PvP (projectiles / damage / respawns).

import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import {
  PLOTS, CENTER, GROUND, ELEMENTS, ELEMENT_BY_ID, BUTTONS, BUTTON_BY_ID,
  BASE_INCOME, DROP_INTERVAL, MAX_HP, RESPAWN,
} from '/shared/tycoon/world.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const START_CASH = 80;
const WALK = 4.4, RUN = 8.0;
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ---------------- renderer / scene ----------------
const canvas = $('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1030);
scene.fog = new THREE.Fog(0x0c1030, 120, 300);
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 900);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3a446a, 1.25); scene.add(hemi);
scene.add(new THREE.AmbientLight(0x66708f, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.position.set(60, 90, 40); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -140; sun.shadow.camera.right = 140;
sun.shadow.camera.top = 140; sun.shadow.camera.bottom = -140; sun.shadow.camera.far = 260;
scene.add(sun);

// ---------------- world ----------------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(GROUND, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x1a2140, roughness: 1 }));
ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(GROUND * 2, 60, 0x33407a, 0x232a52);
grid.material.transparent = true; grid.material.opacity = 0.35; grid.position.y = 0.02; scene.add(grid);

// center arena ring
const ring = new THREE.Mesh(
  new THREE.RingGeometry(40, 44, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x5a6cff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
ring.position.y = 0.05; scene.add(ring);
const arenaTxt = makeSprite('⚔ BATTLE ARENA ⚔', 46, '#aab6ff');
arenaTxt.position.set(0, 6, 0); arenaTxt.scale.set(16, 4, 1); scene.add(arenaTxt);

// ---------------- plots ----------------
// Each plot renders locally; interaction is enabled only on the player's own.
const plots = PLOTS.map((def) => buildPlot(def));
const ownerPlot = new Map(); // playerId -> plot index

function buildPlot(def) {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z); g.rotation.y = def.ry;
  // local +Z = outward (back), -Z = toward centre (front)
  const pad = new THREE.Mesh(new THREE.BoxGeometry(22, 0.4, 22),
    new THREE.MeshStandardMaterial({ color: 0x222a4d, roughness: 0.95 }));
  pad.position.set(0, 0.2, 3); pad.receiveShadow = true; g.add(pad);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(22.4, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x3a4680 }));
  rim.position.set(0, 0.25, -8); g.add(rim);

  // dropper machine (back)
  const dropper = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 3.2),
    new THREE.MeshStandardMaterial({ color: 0x4a5488, metalness: 0.4, roughness: 0.5 }));
  dropper.position.set(-7, 1.9, 9); dropper.castShadow = true; g.add(dropper);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x2a3358 }));
  nozzle.position.set(-7, 0.7, 9); g.add(nozzle);
  // conveyor
  const conv = new THREE.Mesh(new THREE.BoxGeometry(13, 0.4, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x181d38 }));
  conv.position.set(-0.5, 0.55, 9); g.add(conv);
  // collector bin (front-ish)
  const bin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2, 2.6),
    new THREE.MeshStandardMaterial({ color: 0xffcf5c, emissive: 0x3a2a00, metalness: 0.3, roughness: 0.5 }));
  bin.position.set(6.6, 1, 9); bin.castShadow = true; g.add(bin);

  // name banner
  const banner = makeSprite('Open Plot', 40, '#9fb0e0');
  banner.position.set(0, 6.2, 9.4); banner.scale.set(10, 2.4, 1); g.add(banner);

  // button discs — row across the front (local -Z)
  const pads = new Map();
  BUTTONS.forEach((b, i) => {
    const x = -8.4 + i * 2.4;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.3, 24),
      new THREE.MeshStandardMaterial({ color: 0x39406e, emissive: 0x11142c, roughness: 0.6 }));
    disc.position.set(x, 0.35, -4.5); g.add(disc);
    const label = makeSprite(`${b.emoji}\n${short(b.cost)}`, 34, '#ffffff');
    label.position.set(x, 2.1, -4.5); label.scale.set(2.4, 2.4, 1); g.add(label);
    pads.set(b.id, { disc, label, b, x });
  });

  scene.add(g);
  return {
    def, group: g, dropper, conv, bin, banner, pads,
    ownerId: null, orbs: [],
    setOwner(name, mine) {
      setSprite(banner, mine ? `⭐ ${name} (You)` : name, mine ? '#ffd76a' : '#cfe0ff');
    },
    reset() {
      this.ownerId = null; setSprite(banner, 'Open Plot', '#9fb0e0');
      for (const [, p] of pads) markPad(p, false);
      for (const o of this.orbs) g.remove(o); this.orbs = [];
    },
    setUnlocks(list) { for (const id of list) { const p = pads.get(id); if (p) markPad(p, true); } },
    markUnlock(id) { const p = pads.get(id); if (p) markPad(p, true); },
  };
}
function markPad(p, done) {
  p.disc.material.color.set(done ? colorFor(p.b) : 0x39406e);
  p.disc.material.emissive.set(done ? colorFor(p.b) : 0x11142c);
  p.disc.material.emissiveIntensity = done ? 0.5 : 1;
  setSprite(p.label, done ? `${p.b.emoji}\n✓` : `${p.b.emoji}\n${short(p.cost || p.b.cost)}`, done ? '#8affa0' : '#ffffff');
}
function colorFor(b) {
  if (b.kind === 'power') return new THREE.Color(ELEMENT_BY_ID[b.element].color);
  return new THREE.Color(0xffcf5c);
}
function short(n) { return n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : '' + n; }

// ---------------- sprites / tags ----------------
function makeSprite(text, px, color) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  setSprite(spr, text, color, px); return spr;
}
function setSprite(spr, text, color = '#fff', px = 36) {
  const cvs = document.createElement('canvas'); const s = 2; cvs.width = 256; cvs.height = 128;
  const c = cvs.getContext('2d'); c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `800 ${px * s / 2}px -apple-system, system-ui, sans-serif`;
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const y = 64 + (i - (lines.length - 1) / 2) * px * s / 2 * 1.05;
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(ln, 128, y);
    c.fillStyle = color; c.fillText(ln, 128, y);
  });
  const tex = new THREE.CanvasTexture(cvs); tex.anisotropy = 4;
  if (spr.material.map) spr.material.map.dispose();
  spr.material.map = tex; spr.material.needsUpdate = true;
}
// overhead name + hp tag for remotes
function makeTag(name) {
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 96;
  const ctx = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(3, 1.12, 1); spr.position.y = 2.9;
  function draw(hp = MAX_HP, dead = false) {
    ctx.clearRect(0, 0, 256, 96);
    ctx.textAlign = 'center'; ctx.font = '800 34px system-ui'; ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(name, 128, 34);
    ctx.fillStyle = dead ? '#ff8a8a' : '#fff'; ctx.fillText(name, 128, 34);
    // bar
    const w = 180, x = 38, y = 54, h = 14, f = clamp(hp / MAX_HP, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; roundRect(ctx, x, y, w, h, 7); ctx.fill();
    ctx.fillStyle = f > 0.5 ? '#41d17a' : f > 0.25 ? '#ffcf5c' : '#ff5a4a';
    roundRect(ctx, x, y, w * f, h, 7); ctx.fill();
    tex.needsUpdate = true;
  }
  draw();
  return { sprite: spr, setHp: draw };
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

// ---------------- local player + camera ----------------
const player = { pos: { x: 0, y: 0, z: 0 }, vy: 0, ry: 0, anim: 'idle', onGround: true, hp: MAX_HP, dead: false };
let myAvatar = null;
let camYaw = 0, camPitch = -0.15;
const keys = new Set();

// economy state (persisted per user)
let cash = START_CASH;
const unlocks = new Set();
let dropTimer = 0;
let saveName = 'guest';

function income() {
  let inc = BASE_INCOME;
  for (const id of unlocks) { const b = BUTTON_BY_ID[id]; if (b?.kind === 'income') inc = Math.max(inc, b.income); }
  return inc;
}
function unlockedPowers() { return ELEMENTS.filter((e) => unlocks.has(powerBtnId(e.id))); }
function powerBtnId(el) { return BUTTONS.find((b) => b.element === el)?.id; }

function loadSave() {
  try {
    const raw = JSON.parse(localStorage.getItem('tycoon.save.' + saveName) || '{}');
    if (typeof raw.cash === 'number') cash = raw.cash;
    if (Array.isArray(raw.unlocks)) raw.unlocks.forEach((u) => { if (BUTTON_BY_ID[u]) unlocks.add(u); });
  } catch {}
}
function save() { try { localStorage.setItem('tycoon.save.' + saveName, JSON.stringify({ cash, unlocks: [...unlocks] })); } catch {} }
function setCash(v) { cash = Math.max(0, Math.round(v)); $('#cash').textContent = short(cash); }

// ---------------- remotes ----------------
const remotes = new Map();
function makeRemote(d) {
  const ctrl = makeAvatar(d.avatar || {});
  const tag = makeTag(d.name);
  ctrl.group.add(tag.sprite);
  scene.add(ctrl.group);
  const rec = { ctrl, group: ctrl.group, tag, interp: new InterpBuffer(), hp: d.hp ?? MAX_HP, dead: !!d.dead };
  remotes.set(d.id, rec);
  // plot ownership
  if (d.plot != null && plots[d.plot]) { plots[d.plot].ownerId = d.id; plots[d.plot].setOwner(d.name, false); plots[d.plot].setUnlocks(d.unlocks || []); ownerPlot.set(d.id, d.plot); }
  return rec;
}
function dropRemote(id) {
  const r = remotes.get(id); if (r) { scene.remove(r.group); remotes.delete(id); }
  const pi = ownerPlot.get(id); if (pi != null && plots[pi]?.ownerId === id) plots[pi].reset();
  ownerPlot.delete(id);
}

// ---------------- projectiles ----------------
const projMeshes = new Map(); // pid -> { mesh, x,y,z, vx,vy,vz, t }
function projMat(el) {
  const c = new THREE.Color(el.color);
  return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.4 });
}
function makeProj(el) {
  let mesh;
  if (el.kind === 'rock') mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(el.radius * 1.3, 0), projMat(el));
  else if (el.kind === 'bolt') mesh = new THREE.Mesh(new THREE.OctahedronGeometry(el.radius * 1.4, 0), projMat(el));
  else mesh = new THREE.Mesh(new THREE.SphereGeometry(el.radius, 16, 16), projMat(el));
  if (el.id === 'fire' || el.id === 'lightning') {
    const l = new THREE.PointLight(el.color, 1.6, 12); mesh.add(l);
  }
  scene.add(mesh); return mesh;
}

// ---------------- input ----------------
addEventListener('keydown', (e) => {
  if (e.code === 'Enter') { toggleChat(); return; }
  if (chatOpen) return;
  keys.add(e.code);
  if (e.code >= 'Digit1' && e.code <= 'Digit5') selectPower(+e.code.slice(5) - 1);
  if (e.code === 'KeyE') tryBuy();
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', (e) => {
  if (chatOpen) return;
  if (!isTouch && document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) castSelected();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) { camYaw -= e.movementX * 0.0026; camPitch = clamp(camPitch - e.movementY * 0.0022, -1.15, 0.85); }
});
// drag-look fallback (no pointer lock)
let dragId = null, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (isTouch) return; // touch handled below
});

// ---------------- power hotbar UI ----------------
let selected = 0;
function buildHotbar() {
  const bar = $('#hotbar'); bar.innerHTML = '';
  ELEMENTS.forEach((el, i) => {
    const s = document.createElement('div');
    s.className = 'slot'; s.dataset.el = el.id;
    s.innerHTML = `<span class="k">${i + 1}</span><span class="em">${el.emoji}</span><div class="cd" style="transform:scaleY(0)"></div>`;
    s.addEventListener('click', () => selectPower(i));
    bar.appendChild(s);
  });
  refreshHotbar();
}
function refreshHotbar() {
  const slots = $('#hotbar').children;
  ELEMENTS.forEach((el, i) => {
    const has = unlocks.has(powerBtnId(el.id));
    slots[i].style.opacity = has ? '1' : '0.32';
    slots[i].classList.toggle('sel', has && i === selected);
  });
}
function selectPower(i) { if (unlocks.has(powerBtnId(ELEMENTS[i].id))) { selected = i; refreshHotbar(); sfx('tick'); } }
const cdUntil = {};
function castSelected() {
  const el = ELEMENTS[selected];
  if (player.dead || !unlocks.has(powerBtnId(el.id))) return;
  const now = performance.now() / 1000;
  if (now < (cdUntil[el.id] || 0)) return;
  cdUntil[el.id] = now + el.cd;
  animateCd(selected, el.cd);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  net.send({ t: 'cast', el: el.id, x: player.pos.x, y: player.pos.y, z: player.pos.z, dx: dir.x, dy: dir.y, dz: dir.z });
  muzzle(el, dir);
  sfx('cast-' + el.id);
}
function animateCd(i, dur) {
  const cd = $('#hotbar').children[i].querySelector('.cd');
  const t0 = performance.now();
  (function step() {
    const k = clamp((performance.now() - t0) / (dur * 1000), 0, 1);
    cd.style.transform = `scaleY(${1 - k})`;
    if (k < 1) requestAnimationFrame(step);
  })();
}
function muzzle(el, dir) {
  const m = new THREE.PointLight(el.color, 3, 8);
  m.position.set(player.pos.x + dir.x * 1.4, player.pos.y + 1.2 + dir.y, player.pos.z + dir.z * 1.4);
  scene.add(m); setTimeout(() => scene.remove(m), 90);
}

// ---------------- buy interaction ----------------
let hoverBtn = null;
function updatePrompt() {
  const el = $('#prompt');
  hoverBtn = null;
  const myPlot = plots.find((p) => p.ownerId === net.id);
  if (myPlot && !player.dead) {
    // find the nearest not-yet-owned pad within reach
    let best = 99;
    for (const [id, pd] of myPlot.pads) {
      if (unlocks.has(id)) continue;
      const wp = new THREE.Vector3(pd.x, 0.35, -4.5).applyEuler(myPlot.group.rotation).add(myPlot.group.position);
      const dx = player.pos.x - wp.x, dz = player.pos.z - wp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 11 && d2 < best) { best = d2; hoverBtn = { id, b: pd.b }; }
    }
  }
  if (hoverBtn) {
    const b = hoverBtn.b, ok = cash >= b.cost;
    el.classList.remove('hidden'); el.classList.toggle('cant', !ok);
    el.innerHTML = ok
      ? `${b.emoji} <b>${b.label}</b> · 💰${short(b.cost)} — <span class="buy-key">TAP</span> or press <span class="buy-key">E</span>`
      : `${b.emoji} <b>${b.label}</b> · need 💰${short(b.cost)} (you have ${short(cash)})`;
  } else el.classList.add('hidden');
  updateObjective();
}
function updateObjective() {
  const ob = $('#objective'); if (!ob) return;
  const powers = unlockedPowers().length;
  let txt;
  if (powers === 0) txt = '🏗️ Stand on a glowing pad and TAP to buy your first power';
  else if (powers < 5) txt = `⚔️ Press 1-${ELEMENTS.length}${isTouch ? ' / tap a slot' : ''} to pick a power, then ${isTouch ? 'tap 🔥' : 'click'} to blast rivals — buy more powers to get stronger`;
  else txt = '🌟 All powers unlocked! Rule the arena.';
  if (ob.textContent !== txt) ob.textContent = txt;
}
function tryBuy() {
  if (!hoverBtn) return;
  const b = BUTTON_BY_ID[hoverBtn.id];
  if (unlocks.has(b.id) || cash < b.cost) { sfx('deny'); return; }
  setCash(cash - b.cost); unlocks.add(b.id); save();
  const myPlot = plots.find((p) => p.ownerId === net.id); myPlot?.markUnlock(b.id);
  net.send({ t: 'unlock', id: b.id });
  sfx('buy');
  if (b.kind === 'power') {
    refreshHotbar();
    const idx = ELEMENTS.findIndex((e) => e.id === b.element); if (idx >= 0) selectPower(idx);
    window.ClaudeBox?.completeChallenge?.('tycoon-power');
    if (unlockedPowers().length >= 5) window.ClaudeBox?.completeChallenge?.('tycoon-max');
    feed(`You unlocked <b>${b.label}</b>!`);
  } else feed(`You upgraded to <b>${b.label}</b> (+income)`);
}

// ---------------- economy tick ----------------
function tickEconomy(dt) {
  const myPlot = plots.find((p) => p.ownerId === net.id);
  if (!myPlot) return;
  dropTimer += dt;
  if (dropTimer >= DROP_INTERVAL) {
    dropTimer = 0;
    // spawn an orb at the dropper, slide it to the bin
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffcf5c, emissiveIntensity: 0.9 }));
    orb.userData.k = 0; myPlot.group.add(orb); myPlot.orbs.push(orb);
  }
  for (let i = myPlot.orbs.length - 1; i >= 0; i--) {
    const o = myPlot.orbs[i]; o.userData.k += dt / 1.4;
    const k = o.userData.k;
    o.position.set(-7 + k * 13.6, 1.4 + Math.sin(k * Math.PI) * 0.4, 9);
    if (k >= 1) {
      myPlot.group.remove(o); myPlot.orbs.splice(i, 1);
      setCash(cash + income()); coinPop(myPlot); save();
    }
  }
}
function coinPop(plot) {
  const wp = new THREE.Vector3(6.6, 2.4, 9).applyEuler(plot.group.rotation).add(plot.group.position);
  const s = makeSprite('+' + income(), 30, '#ffe08a'); s.position.copy(wp); s.scale.set(2, 1, 1); scene.add(s);
  const t0 = performance.now();
  (function up() { const k = (performance.now() - t0) / 700; s.position.y = wp.y + k * 1.5; s.material.opacity = 1 - k; if (k < 1) requestAnimationFrame(up); else scene.remove(s); })();
}

// ---------------- movement / camera ----------------
function moveInput() {
  let f = 0, r = 0;
  if (keys.has('KeyW')) f += 1; if (keys.has('KeyS')) f -= 1;
  if (keys.has('KeyD')) r += 1; if (keys.has('KeyA')) r -= 1;
  if (touchVec.x || touchVec.y) { r = touchVec.x; f = -touchVec.y; }
  return { f, r };
}
function updatePlayer(dt) {
  const { f, r } = moveInput();
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchRun;
  const spd = running ? RUN : WALK;
  const len = Math.hypot(f, r) || 1;
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  // right vector (D = strafe right). Uses -90° so A/D aren't inverted.
  const rx = Math.sin(camYaw - Math.PI / 2), rz = Math.cos(camYaw - Math.PI / 2);
  let moving = (f || r) && !player.dead;
  if (moving) {
    const vx = (fx * f + rx * r) / len * spd, vz = (fz * f + rz * r) / len * spd;
    player.pos.x += vx * dt; player.pos.z += vz * dt;
  }
  // knockback residual
  if (kb.x || kb.z) { player.pos.x += kb.x * dt; player.pos.z += kb.z * dt; kb.x *= 0.86; kb.z *= 0.86; if (Math.abs(kb.x) < 0.1) kb.x = 0; if (Math.abs(kb.z) < 0.1) kb.z = 0; }
  // bounds
  const lim = GROUND - 4; player.pos.x = clamp(player.pos.x, -lim, lim); player.pos.z = clamp(player.pos.z, -lim, lim);
  // jump / gravity
  if ((keys.has('Space') || touchJump) && player.onGround && !player.dead) { player.vy = 9.2; player.onGround = false; touchJump = false; }
  player.vy -= 24 * dt; player.pos.y += player.vy * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; player.onGround = true; }
  player.ry = camYaw;
  player.anim = !moving ? 'idle' : running ? 'run' : 'walk';
  if (myAvatar) {
    myAvatar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
    myAvatar.group.rotation.y = player.ry;
    myAvatar.setAnim(player.dead ? 'idle' : player.anim);
    myAvatar.moveSpeed = player.anim === 'run' ? RUN : player.anim === 'walk' ? WALK : 0;
    myAvatar.group.visible = !player.dead;
  }
}
function updateCamera() {
  const tx = player.pos.x, ty = player.pos.y + 1.7, tz = player.pos.z;
  const dist = 6.8, cp = Math.cos(camPitch);
  camera.position.set(tx - Math.sin(camYaw) * cp * dist, ty - Math.sin(camPitch) * dist + 0.2, tz - Math.cos(camYaw) * cp * dist);
  if (camera.position.y < 0.8) camera.position.y = 0.8;
  camera.lookAt(tx, ty, tz);
}

// ---------------- combat feedback ----------------
const kb = { x: 0, z: 0 };
function setHealth(hp) {
  player.hp = hp; $('#health-fill').style.width = clamp(hp / MAX_HP * 100, 0, 100) + '%';
  $('#health-num').textContent = Math.max(0, Math.round(hp));
  $('#health-fill').style.background = hp > 50 ? 'linear-gradient(90deg,#34d17a,#7be6a2)' : hp > 25 ? 'linear-gradient(90deg,#ffcf5c,#ffe08a)' : 'linear-gradient(90deg,#ff5a4a,#ff9a8a)';
}
function flashDmg() { const f = $('#dmg-flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 120); }
let respawnTimer = 0;
function showDead(byName) {
  player.dead = true; $('#dead-overlay').classList.remove('hidden');
  $('#dead-by').textContent = byName ? `Defeated by ${byName}` : '';
  respawnTimer = RESPAWN;
}
function feed(html) {
  const line = document.createElement('div'); line.className = 'feed-line'; line.innerHTML = html;
  $('#feed').prepend(line);
  while ($('#feed').children.length > 4) $('#feed').lastChild.remove();
  setTimeout(() => line.remove(), 6000);
}

// ---------------- chat ----------------
let chatOpen = false;
function toggleChat() {
  const inp = $('#chat-input');
  if (!chatOpen) { chatOpen = true; inp.classList.add('open'); inp.focus(); }
  else { chatOpen = false; const t = inp.value.trim(); inp.value = ''; inp.blur(); inp.classList.remove('open'); if (t) net.send({ t: 'chat', text: t }); }
}
function addChat(name, text, self, sys) {
  const el = document.createElement('div'); el.className = 'cl' + (sys ? ' sys' : '');
  el.innerHTML = `<b>${esc(name)}</b> ${esc(text)}`;
  $('#chat-log').appendChild(el);
  while ($('#chat-log').children.length > 7) $('#chat-log').firstChild.remove();
}
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ---------------- sound (tiny Web Audio) ----------------
let actx = null;
function sfx(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
    const n = actx.currentTime; let f = 440, type = 'sine', dur = 0.15, vol = 0.14;
    if (kind === 'buy') { f = 700; type = 'triangle'; dur = 0.18; }
    else if (kind === 'deny') { f = 150; type = 'square'; dur = 0.12; }
    else if (kind === 'tick') { f = 520; dur = 0.05; vol = 0.08; }
    else if (kind === 'hit') { f = 220; type = 'square'; dur = 0.1; }
    else if (kind.startsWith('cast-')) {
      const el = kind.slice(5); type = el === 'lightning' ? 'sawtooth' : el === 'earth' ? 'square' : 'triangle';
      f = el === 'fire' ? 260 : el === 'water' ? 520 : el === 'earth' ? 120 : el === 'air' ? 700 : 900; dur = 0.2; vol = 0.16;
    }
    o.type = type; o.frequency.setValueAtTime(f, n);
    if (kind.startsWith('cast-')) o.frequency.exponentialRampToValueAtTime(f * 0.5, n + dur);
    g.gain.setValueAtTime(vol, n); g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
    o.start(n); o.stop(n + dur);
  } catch {}
}

// ---------------- touch controls ----------------
const touchVec = { x: 0, y: 0 }; let touchRun = false, touchJump = false;
function setupTouch() {
  $('#touch').classList.remove('hidden');
  const stick = $('#stick'), knob = stick.querySelector('i');
  let sid = null, cx = 0, cy = 0;
  stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === sid) {
      let dx = t.clientX - cx, dy = t.clientY - cy; const m = Math.hypot(dx, dy) || 1; const cl = Math.min(m, 54);
      dx = dx / m * cl; dy = dy / m * cl; knob.style.transform = `translate(${dx}px,${dy}px)`;
      touchVec.x = dx / 54; touchVec.y = dy / 54; touchRun = m > 40;
    }
  }, { passive: false });
  addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; knob.style.transform = ''; touchVec.x = touchVec.y = 0; touchRun = false; } });
  // look drag on right half
  let lid = null, lx = 0, ly = 0;
  canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; if (t.clientX > innerWidth / 2 && lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === lid) { camYaw -= (t.clientX - lx) * 0.006; camPitch = clamp(camPitch - (t.clientY - ly) * 0.005, -1.15, 0.85); lx = t.clientX; ly = t.clientY; } }, { passive: false });
  canvas.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; });
  $('#t-jump').addEventListener('touchstart', (e) => { touchJump = true; e.preventDefault(); }, { passive: false });
  $('#t-fire').addEventListener('touchstart', (e) => { castSelected(); e.preventDefault(); }, { passive: false });
  // tap plot button to buy
  $('#t-fire').addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
}

// ---------------- net ----------------
const net = new Net();
net.on('welcome', (msg) => {
  for (const d of msg.players) makeRemote(d);
  // spawn where the server put us (at our own plot) — not stuck at world origin
  if (msg.you.pos) { player.pos.x = msg.you.pos.x; player.pos.y = msg.you.pos.y || 0; player.pos.z = msg.you.pos.z; }
  // my plot
  if (msg.you.plot != null && plots[msg.you.plot]) {
    plots[msg.you.plot].ownerId = net.id; plots[msg.you.plot].setOwner(msg.you.name, true);
    plots[msg.you.plot].setUnlocks([...unlocks]); ownerPlot.set(net.id, msg.you.plot);
    // face our plot's buy pads (toward the centre arena)
    camYaw = PLOTS[msg.you.plot].ry + Math.PI;
    // replay saved unlocks to the server so others see my built plot
    for (const u of unlocks) net.send({ t: 'unlock', id: u });
  }
  refreshHotbar();
  // pick a default selected power if any owned
  const firstOwned = ELEMENTS.findIndex((e) => unlocks.has(powerBtnId(e.id))); if (firstOwned >= 0) selected = firstOwned;
  $('#loading').classList.add('hidden'); $('#hud').classList.remove('hidden'); $('#crosshair').classList.remove('hidden');
  feed('Welcome! Grow your plot, unlock powers, then fight in the arena.');
});
net.on('player.join', (m) => { if (m.player.id !== net.id && !remotes.has(m.player.id)) { makeRemote(m.player); addChat('System', `${m.player.name} joined`, false, true); } });
net.on('player.leave', (m) => dropRemote(m.id));
net.on('player.unlock', (m) => { const pi = ownerPlot.get(m.id); if (pi != null) plots[pi].markUnlock(m.btn); });
net.on('snapshot', (m) => {
  for (const row of m.players) { const [id, x, y, z, ry, anim, hp, dead] = row; if (id === net.id) { if (typeof hp === 'number' && !player.dead) setHealth(hp); continue; } const r = remotes.get(id); if (r) { r.interp.push([x, y, z, ry, anim]); if (r.hp !== hp) { r.hp = hp; r.tag.setHp(hp, !!dead); } r.dead = !!dead; r.group.visible = !dead; } }
  // projectiles
  const live = new Set();
  for (const row of m.proj) {
    const [pid, elId, x, y, z, vx, vy, vz] = row; live.add(pid);
    let p = projMeshes.get(pid);
    if (!p) { const mesh = makeProj(ELEMENT_BY_ID[elId] || ELEMENTS[0]); p = { mesh }; projMeshes.set(pid, p); }
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.t = performance.now() / 1000;
  }
  for (const [pid, p] of projMeshes) if (!live.has(pid)) { scene.remove(p.mesh); projMeshes.delete(pid); }
});
net.on('hit', (m) => {
  if (m.id === net.id) {
    setHealth(m.hp); flashDmg(); sfx('hit');
    if (m.kx || m.kz) { kb.x += m.kx; kb.z += m.kz; }
  } else { const r = remotes.get(m.id); if (r) { r.hp = m.hp; r.tag.setHp(m.hp, false); } }
  // impact spark
  const r = remotes.get(m.id); const pos = m.id === net.id ? player.pos : r?.group.position;
  if (pos) { const el = ELEMENT_BY_ID[m.el] || ELEMENTS[0]; const l = new THREE.PointLight(el.color, 3, 8); l.position.set(pos.x, pos.y + 1.2, pos.z); scene.add(l); setTimeout(() => scene.remove(l), 120); }
});
net.on('died', (m) => {
  const meVictim = m.id === net.id, meKiller = m.by === net.id;
  const vName = meVictim ? 'You' : remotes.get(m.id) ? tagName(m.id) : 'Someone';
  feed(`<b>${esc(m.byName || 'Someone')}</b> defeated <b>${esc(vName)}</b> ⚔️`);
  if (meVictim) showDead(m.byName);
  if (meKiller && !meVictim) { window.ClaudeBox?.completeChallenge?.('tycoon-elim'); sfx('buy'); }
});
net.on('respawn', (m) => {
  if (m.id === net.id) { player.dead = false; player.pos.x = m.x; player.pos.y = m.y; player.pos.z = m.z; player.vy = 0; setHealth(MAX_HP); $('#dead-overlay').classList.add('hidden'); }
  else { const r = remotes.get(m.id); if (r) { r.dead = false; r.group.visible = true; r.hp = MAX_HP; r.tag.setHp(MAX_HP, false); } }
});
net.on('chat', (m) => addChat(m.name, m.text, m.id === net.id));
net.on('toast', (m) => addChat('System', m.text, false, true));
net.on('_disconnect', () => feed('Disconnected — refresh to rejoin.'));
function tagName(id) { const cvs = remotes.get(id); return cvs ? 'a rival' : 'Someone'; }

// ---------------- loop ----------------
let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!player.dead) updatePlayer(dt); else { if (myAvatar) myAvatar.group.visible = false; }
  if (respawnTimer > 0) { respawnTimer -= dt; $('#respawn-n').textContent = Math.ceil(respawnTimer); }
  if (myAvatar) myAvatar.update(dt);
  tickEconomy(dt);
  updatePrompt();
  // remotes
  for (const [, r] of remotes) {
    const s = r.interp.sample([3]);
    if (s) { r.group.position.set(s[0], s[1], s[2]); r.group.rotation.y = s[3]; r.ctrl.setAnim(s[4]); r.ctrl.moveSpeed = s[4] === 'run' ? RUN : s[4] === 'walk' ? WALK : 0; }
    r.ctrl.update(dt);
  }
  // projectiles extrapolate
  const tnow = performance.now() / 1000;
  for (const [, p] of projMeshes) {
    const e = tnow - p.t;
    p.mesh.position.set(p.x + p.vx * e, p.y + p.vy * e, p.z + p.vz * e);
    p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 5;
  }
  updateCamera();
  renderer.render(scene, camera);
}

// ---------------- boot ----------------
async function boot() {
  const name = localStorage.getItem('claudebox.user');
  if (!name) { location.href = '/'; return; }
  saveName = name.toLowerCase();
  let profile = {};
  try {
    const res = await fetch('/api/avatar/' + encodeURIComponent(name), { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } });
    if (!res.ok) throw 0; const data = await res.json(); profile = data.avatar || {};
    localStorage.setItem('claudebox.user', data.name);
  } catch { location.href = '/'; return; }
  $('#load-msg').textContent = 'Loading avatars…';
  await preloadAvatars(['boy', 'girl']);
  myAvatar = makeAvatar(profile); scene.add(myAvatar.group);
  loadSave(); setCash(cash); buildHotbar();
  // buying works by tapping/clicking the prompt (so phones can buy too) or pressing E
  $('#prompt').addEventListener('click', () => tryBuy());
  $('#prompt').addEventListener('touchend', (e) => { e.preventDefault(); tryBuy(); });
  if (isTouch) setupTouch();
  net.connect();
  net.join({ name: localStorage.getItem('claudebox.user'), avatar: profile, code: localStorage.getItem('claudebox.code') || '' });
  net.startMovementStream(() => ({ t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim }));
  requestAnimationFrame(frame);
  window.__tycoon = { player, plots, remotes, net, scene };
}
boot();
