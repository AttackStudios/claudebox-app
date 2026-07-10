// Rivals — first-person arena duels for ClaudeBox, modeled on the real thing:
// queue → map vote → TELEPORTING → freeze countdown → first to 5, with slide
// and Scythe-dash movement, hitscan gunplay, grenades, bots, and a podium.

import * as THREE from 'three';
import { Net } from './net.js';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { drawAvatarHead } from '/hub/avatarModel.js';
import { MOVE, WEAPONS, LOADOUT, ROUND } from '/shared/rivals/config.js';
import { SKINS, SKIN_BY_ID, SKINS_BY_WEAPON, SKIN_WEAPONS, RARITY_COLOR, CASE_PRICE } from '/shared/rivals/skins.js';
import { MAPS, LOBBY } from '/shared/rivals/maps.js';
import { loadAudio, resumeAudio, playOne, playLoop, stopLoop } from './audio.js';

const $ = (s) => document.querySelector(s);
const status = (t) => { const el = $('#load-status'); if (el) el.textContent = t; };
const clockNow = () => Date.now() / 1000;

// ============================ boot ============================
status('Fetching your loadout…');
const identity = await loadIdentity();
const net = new Net();

const canvas = $('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const BASE_FOV = 78;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.08, 400);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMax?.();
  camera.updateProjectionMatrix();
});

const game = {
  phase: 'lobby',          // lobby | vote | teleport | freeze | live | roundEnd | podium
  mapId: 'lobby',
  roster: [],              // match.start roster
  myTeam: 'A',
  score: { A: 0, B: 0 },
  stateUntil: 0,
  queued: null, queuedSince: 0,
  gotFirstElim: false,
};
window.__rivals = {
  game, net, camera, get scene() { return scene; }, get me() { return me; }, get others() { return others; },
  get anim() { return vmAnim; },
  fns: {
    startReload: (...a) => startReload(...a), switchWeapon: (...a) => switchWeapon(...a), setRight: (v) => { rightDown = !!v; },
    spawnDummy: (g, w, ry, dx, dz) => { const fid = 'dummy_' + g + '_' + (w || 'ar') + '_' + (ry || 0); addOther({ id: fid, name: 'Dummy', avatar: { body: g }, team: 'B', pos: { x: me.pos.x + (dx || 0), y: 0, z: me.pos.z + (dz || 6) }, ry: ry || 0, anim: 'idle', weapon: w || 'ar', hp: 100 }); return fid; },
  },
};

// ============================ sounds (synth) ============================
const AC = window.AudioContext || window.webkitAudioContext;
let ac = null;
const A = () => { if (!ac && AC) { ac = new AC(); } if (ac?.state === 'suspended') ac.resume(); return ac; };
function tone(f, dur, type = 'sine', vol = 0.15, glide = 0, delay = 0) {
  const c = A(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
}
function noiseBurst(dur, vol = 0.15, freq = 1800, type = 'bandpass') {
  const c = A(); if (!c) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(c.destination); src.start();
}
const sfx = {
  shot(w) { if (w === 'handgun') { noiseBurst(0.09, 0.2, 2400); tone(320, 0.06, 'square', 0.1, 90); } else if (w === 'sniper') { noiseBurst(0.22, 0.32, 900, 'lowpass'); tone(140, 0.18, 'sawtooth', 0.2, 40); tone(1200, 0.05, 'square', 0.06); } else { noiseBurst(0.07, 0.18, 1900); tone(210, 0.05, 'sawtooth', 0.12, 70); } },
  distantShot() { noiseBurst(0.06, 0.05, 900); },
  swing() { noiseBurst(0.12, 0.08, 500, 'lowpass'); tone(300, 0.1, 'sine', 0.06, 120); },
  reload() { tone(700, 0.05, 'square', 0.07); tone(500, 0.05, 'square', 0.07, 0, 0.14); tone(900, 0.05, 'square', 0.08, 0, 0.5); },
  hit() { tone(1100, 0.05, 'sine', 0.14); },
  headshot() { tone(1500, 0.07, 'sine', 0.16); tone(1900, 0.06, 'sine', 0.1, 0, 0.05); },
  hurt() { tone(160, 0.14, 'sawtooth', 0.12, 90); },
  elim() { tone(880, 0.08, 'triangle', 0.16); tone(1174, 0.1, 'triangle', 0.16, 0, 0.08); },
  death() { tone(220, 0.4, 'sawtooth', 0.14, 60); },
  slide() { noiseBurst(0.25, 0.06, 500, 'lowpass'); },
  dash() { noiseBurst(0.18, 0.1, 1200); tone(500, 0.14, 'sine', 0.08, 900); },
  boom() { noiseBurst(0.5, 0.3, 300, 'lowpass'); tone(70, 0.4, 'sine', 0.25, 34); },
  beep() { tone(660, 0.09, 'square', 0.1); },
  roundStart() { tone(523, 0.1, 'triangle', 0.14); tone(784, 0.16, 'triangle', 0.16, 0, 0.1); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.15, 0, i * 0.09)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sine', 0.12, 0, i * 0.12)); },
  click() { tone(900, 0.03, 'square', 0.05); },
};
addEventListener('pointerdown', () => { A(); resumeAudio(); }, { once: true });
addEventListener('keydown', () => resumeAudio(), { once: true });
loadAudio();

// ============================ world building ============================
const ambientLight = new THREE.AmbientLight('#c4ccd8', 1.35);
scene.add(ambientLight);
const sun = new THREE.DirectionalLight('#fff2dc', 1.7);
sun.position.set(30, 60, 20); scene.add(sun);
const fill = new THREE.DirectionalLight('#8fb8e8', 0.5);
fill.position.set(-25, 30, -30); scene.add(fill);
// sky-to-ground ambient gradient — makes tops read cool and bounces warm below
const hemi = new THREE.HemisphereLight('#dcebff', '#5a6070', 0.6);
scene.add(hemi);

// vertical gradient sky (screen-space, cheap) — far nicer than a flat colour
function skyTex(top, mid, bot) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(0.52, mid); g.addColorStop(1, bot);
  x.fillStyle = g; x.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// ground texture: big tile grid + soft radial glow toward the centre
function groundTex(base, line, accent) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  const rg = x.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S / 2);
  rg.addColorStop(0, accent); rg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = rg; x.fillRect(0, 0, S, S);
  x.strokeStyle = line; x.lineWidth = 2;
  for (let i = 0; i <= 8; i++) { const p = (i / 8) * S; x.beginPath(); x.moveTo(p, 0); x.lineTo(p, S); x.moveTo(0, p); x.lineTo(S, p); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// white tiled-panel texture with grid seams — the signature RIVALS-arena look
const _gridBase = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
  const gr = x.createLinearGradient(0, 0, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.015)'); gr.addColorStop(1, 'rgba(0,0,0,0.06)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(96,106,122,0.4)'; x.lineWidth = 4;
  x.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
function panelTex(w, h) {
  const t = _gridBase.clone();
  t.needsUpdate = true;
  t.repeat.set(Math.max(1, Math.round(w / 2.2)), Math.max(1, Math.round(h / 2.2)));
  return t;
}

let mapGroup = null;
let mapBoxes = [];
let rangeTargets = [];   // lobby shooting-range dummies

function buildMap(def) {
  if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  mapGroup = new THREE.Group();
  const panels = def.id !== 'lobby';
  // gradient sky + horizon-matched fog
  const sky = def.sky2 || [def.sky, def.sky, def.sky];
  scene.background = skyTex(sky[0], sky[1], sky[2]);
  scene.fog = new THREE.FogExp2(sky[2], def.fog || 0.01);
  // ground — textured grid with a soft centre glow (flat colour for the lobby)
  const gt = def.ground.tex;
  const gmat = gt
    ? (() => { const t = groundTex(gt[0], gt[1], gt[2]); t.repeat.set(def.ground.size / 8, def.ground.size / 8); return new THREE.MeshLambertMaterial({ color: '#ffffff', map: t }); })()
    : new THREE.MeshLambertMaterial({ color: def.ground.color });
  const g = new THREE.Mesh(new THREE.BoxGeometry(def.ground.size, 1, def.ground.size), gmat);
  g.position.y = -0.5;
  mapGroup.add(g);
  // centre emblem decal (match maps) — a subtle painted ring on the floor
  if (def.emblem) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'); x.clearRect(0, 0, 256, 256);
    x.strokeStyle = def.emblem; x.lineWidth = 10; x.globalAlpha = 0.5;
    x.beginPath(); x.arc(128, 128, 92, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 4; x.beginPath(); x.arc(128, 128, 60, 0, Math.PI * 2); x.stroke();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02; mapGroup.add(disc);
  }
  // boxes — match maps get the tiled-panel treatment; glow boxes are emissive
  for (const b of def.boxes) {
    const mat = b.glow
      ? new THREE.MeshBasicMaterial({ color: b.color })
      : new THREE.MeshLambertMaterial({ color: b.color, map: panels && !b.plain ? panelTex(Math.max(b.sx, b.sz), Math.max(b.sy, 1)) : null });
    if (b.ramp) {   // a SOLID wedge (ramp with a base) — its top face is the slope
      const axis = b.ramp.axis, up = b.ramp.up, rise = b.ramp.rise;
      const len = axis === 'x' ? b.sx : b.sz, wid = axis === 'x' ? b.sz : b.sx;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(up >= 0 ? len : 0, rise); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: wid, bevelEnabled: false });
      geo.translate(-len / 2, 0, -wid / 2);
      const wedge = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: b.color }));
      wedge.position.set(b.x, b.y - b.sy / 2, b.z);
      if (axis === 'z') wedge.rotation.y = Math.PI / 2;
      mapGroup.add(wedge);
      continue;
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.sx, b.sy, b.sz), mat);
    mesh.position.set(b.x, b.y, b.z);
    mapGroup.add(mesh);
  }
  // flat, bright, even light in matches (like the original's arenas)
  ambientLight.intensity = panels ? 1.7 : 1.1;
  sun.intensity = panels ? 1.0 : 1.4;
  fill.intensity = panels ? 0.5 : 0.5;
  hemi.intensity = panels ? 0.9 : 0.35;
  hemi.color.set(sky[0]); hemi.groundColor.set(def.ground.color);
  // the lobby is an interior — give it its own neon mood lighting
  if (def.id === 'lobby') {
    const l1 = new THREE.PointLight('#6ee7ff', 30, 26); l1.position.set(0, 5.4, -8);
    const l2 = new THREE.PointLight('#ff7eb6', 22, 24); l2.position.set(11, 5, 4);
    const l3 = new THREE.PointLight('#ffffff', 16, 22); l3.position.set(-8, 5.6, 6);
    mapGroup.add(l1, l2, l3);
  }
  scene.add(mapGroup);
  mapBoxes = def.boxes.filter((b) => !b.glow);
  // shooting range dummies (lobby only)
  rangeTargets = [];
  if (def.targets) {
    for (const tg of def.targets) {
      const grp = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.35), new THREE.MeshLambertMaterial({ color: '#e0503c' }));
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.35), new THREE.MeshLambertMaterial({ color: '#f06b5c' }));
      head.position.y = 0.75; grp.add(torso, head);
      grp.position.set(tg.x, tg.y, tg.z);
      scene.add(grp);
      rangeTargets.push({ grp, alive: true, respawnAt: 0, base: { ...tg } });
    }
  }
}

// ============================ player controller ============================
const me = {
  pos: { x: LOBBY.spawnsA[0].x, y: 0, z: LOBBY.spawnsA[0].z },
  vel: { x: 0, y: 0, z: 0 },
  ry: LOBBY.spawnsA[0].ry, pitch: 0,
  grounded: true, crouch: false, sliding: false, slideVel: { x: 0, z: 0 },
  dashUntil: 0, dashAt: -99, dashVec: { x: 0, z: 0 },
  hp: 100, dead: false,
  weapon: 'ar', ads: 0,
  ammo: { ar: { mag: 20, res: 100 }, handgun: { mag: 15, res: 90 }, sniper: { mag: 5, res: 25 } },
  grenades: WEAPONS.grenade.count,
  reloading: 0, lastFire: 0, swingAt: 0,
};
const keys = new Set();
let locked = false;

canvas.addEventListener('click', () => { if (!locked && !isTouch) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const sens = 0.0021 * (me.ads > 0.5 ? (me.weapon === 'sniper' ? 0.48 : 0.7) : 1);
  me.ry -= e.movementX * sens;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * sens));
});

// ---------------- rebindable keybinds ----------------
const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft', reload: 'KeyR', queue: 'KeyE',
  weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3', weapon4: 'Digit4', weapon5: 'Digit5', weapon6: 'Digit6',
};
let binds = (() => {
  const out = { ...DEFAULT_BINDS };
  try {
    const saved = JSON.parse(localStorage.getItem('rivals.binds') || '{}');
    // only apply NON-empty saved binds so an accidentally-unbound action
    // (e.g. jump) always falls back to its default instead of being dead
    for (const k in DEFAULT_BINDS) if (saved[k]) out[k] = saved[k];
  } catch {}
  return out;
})();
function saveBinds() { try { localStorage.setItem('rivals.binds', JSON.stringify(binds)); } catch {} }
let rebinding = null;   // action id currently capturing a key
// sprint mode: hold (default) vs toggle (press once to lock sprint on/off)
let sprintToggle = (() => { try { return localStorage.getItem('rivals.sprintToggle') === '1'; } catch { return false; } })();
let sprintOn = false, mobileSprint = false;
const isSprinting = () => mobileSprint || (sprintToggle ? sprintOn : keys.has(binds.sprint));

addEventListener('keydown', (e) => {
  if (rebinding) { e.preventDefault(); captureRebind(e.code); return; }
  if (chatting) return;   // typing in chat — ignore game keys
  if (e.code === 'Enter' && ['lobby', 'freeze', 'live', 'roundEnd'].includes(game.phase)) { e.preventDefault(); openChat(); return; }
  if (e.repeat) return;
  keys.add(e.code);
  const c = e.code;
  if (c === binds.queue && game.phase === 'lobby') toggleModes();
  if (c === binds.reload) startReload();
  for (let i = 1; i <= 6; i++) if (c === binds['weapon' + i]) switchWeapon(LOADOUT[i - 1]);
  if (c === binds.sprint && sprintToggle) sprintOn = !sprintOn;
  if (c === binds.crouch) tryCrouch(true);
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === binds.crouch) tryCrouch(false);
});

let mouseDown = false, rightDown = false;
addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) { mouseDown = true; tryFire(); }
  if (e.button === 2) { rightDown = true; onRightDown(); }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) rightDown = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());

// ==================== mobile touch controls ====================
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const mobileMove = { x: 0, z: 0 };
let mobileOn = false;
function setupMobile() {
  if (!isTouch) return;
  mobileOn = true;
  const wrap = $('#mobile'); wrap.classList.remove('hidden');
  const moveZone = $('#move-zone'), lookZone = $('#look-zone');
  const joy = $('#joy'), knob = $('#joy-knob');
  const $b = (id) => $(id);

  // --- movement: dynamic joystick on the left half ---
  let moveId = null, jcx = 0, jcy = 0;
  moveZone.addEventListener('touchstart', (e) => {
    if (moveId !== null) return;
    const t = e.changedTouches[0]; moveId = t.identifier;
    jcx = t.clientX; jcy = t.clientY;
    joy.style.left = jcx + 'px'; joy.style.top = jcy + 'px'; joy.classList.remove('hidden');
    knob.style.left = '50%'; knob.style.top = '50%';
  }, { passive: true });
  const moveUpdate = (e) => {
    for (const t of e.changedTouches) if (t.identifier === moveId) {
      let dx = t.clientX - jcx, dy = t.clientY - jcy; const max = 52, d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.left = (50 + dx / max * 42) + '%'; knob.style.top = (50 + dy / max * 42) + '%';
      mobileMove.x = dx / max; mobileMove.z = -dy / max;
      const mag = Math.hypot(mobileMove.x, mobileMove.z);
      mobileSprint = mag > 0.85 && mobileMove.z > 0.1;
    }
  };
  moveZone.addEventListener('touchmove', moveUpdate, { passive: true });
  const moveEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === moveId) {
      moveId = null; mobileMove.x = mobileMove.z = 0; joy.classList.add('hidden'); mobileSprint = false;
    }
  };
  moveZone.addEventListener('touchend', moveEnd, { passive: true });
  moveZone.addEventListener('touchcancel', moveEnd, { passive: true });

  // --- look: drag anywhere on the right half ---
  let lookId = null, lx = 0, ly = 0;
  lookZone.addEventListener('touchstart', (e) => {
    if (lookId !== null) return;
    const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: true });
  lookZone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      const sens = 0.006 * (me.ads > 0.5 ? (me.weapon === 'sniper' ? 0.5 : 0.72) : 1);
      me.ry -= (t.clientX - lx) * sens;
      me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - (t.clientY - ly) * sens));
      lx = t.clientX; ly = t.clientY;
    }
  }, { passive: true });
  const lookEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
  lookZone.addEventListener('touchend', lookEnd, { passive: true });
  lookZone.addEventListener('touchcancel', lookEnd, { passive: true });

  // --- action buttons ---
  const hold = (id, on, off) => {
    const el = $b(id); if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); off && off(); }, { passive: false });
  };
  hold('#m-fire', () => { mouseDown = true; tryFire(); }, () => { mouseDown = false; });
  hold('#m-aim', () => { rightDown = true; onRightDown(); }, () => { rightDown = false; });
  hold('#m-jump', () => keys.add(binds.jump), () => keys.delete(binds.jump));
  hold('#m-crouch', () => tryCrouch(true), () => tryCrouch(false));
  $b('#m-reload').addEventListener('touchstart', (e) => { e.preventDefault(); startReload(); }, { passive: false });
  $b('#m-play').addEventListener('touchstart', (e) => { e.preventDefault(); toggleModes(); }, { passive: false });
}
// swap between lobby (Play button) and in-match (combat buttons) layouts
function updateMobileHud() {
  if (!mobileOn) return;
  const lobby = game.phase === 'lobby';
  $('#m-play').classList.toggle('hidden', !lobby);
  for (const id of ['#m-fire', '#m-jump', '#m-aim', '#m-crouch', '#m-reload'])
    $(id).style.display = lobby ? 'none' : 'flex';
}

function tryCrouch(on) {
  if (on) {
    const speed = Math.hypot(me.vel.x, me.vel.z);
    const sprinting = isSprinting() && speed > MOVE.walk * 0.9;
    if (sprinting && me.grounded && !me.sliding) {
      // SLIDE — signature move
      me.sliding = true;
      const l = speed || 1;
      me.slideVel = { x: (me.vel.x / l) * MOVE.slideBurst, z: (me.vel.z / l) * MOVE.slideBurst };
      sfx.slide();
      window.ClaudeBox?.completeChallenge('rivals-slide');
    }
    me.crouch = true;
  } else { me.crouch = false; me.sliding = false; }
}

function onRightDown() {
  if (me.weapon === 'scythe') {
    // DASH
    const now = clockNow();
    if (now - me.dashAt < MOVE.dashCooldown || me.dead || game.phase === 'freeze') return;
    me.dashAt = now; me.dashUntil = now + MOVE.dashTime;
    me.dashVec = { x: -Math.sin(me.ry) * MOVE.dashSpeed, z: -Math.cos(me.ry) * MOVE.dashSpeed };
    sfx.dash(); net.send({ t: 'dash' });
  }
  // guns: ADS handled continuously via rightDown
}

// collision vs current mapBoxes (feet-based AABB)
function collideMove(nx, ny, nz) {
  const r = MOVE.radius;
  const h = me.crouch || me.sliding ? MOVE.heightCrouch : MOVE.heightStand;
  // horizontal push-out per axis
  const solveAxis = (x, z) => {
    for (const b of mapBoxes) {
      if (b.ramp) continue;   // slopes are walkable floors — never block horizontally
      const top = b.y + b.sy / 2, bot = b.y - b.sy / 2;
      if (ny + h < bot + 0.01 || ny > top - 0.28) continue;   // can step onto low tops
      const minX = b.x - b.sx / 2 - r, maxX = b.x + b.sx / 2 + r;
      const minZ = b.z - b.sz / 2 - r, maxZ = b.z + b.sz / 2 + r;
      if (x > minX && x < maxX && z > minZ && z < maxZ) {
        const dl = x - minX, dr = maxX - x, dn = z - minZ, df = maxZ - z;
        const m = Math.min(dl, dr, dn, df);
        if (m === dl) x = minX; else if (m === dr) x = maxX; else if (m === dn) z = minZ; else z = maxZ;
      }
    }
    return { x, z };
  };
  const s = solveAxis(nx, nz);
  return { x: s.x, z: s.z };
}
function groundAt(x, z, fromY) {
  let g = 0;
  const r = MOVE.radius * 0.8;
  for (const b of mapBoxes) {
    if (b.ramp) {   // interpolate the slope height under the player
      if (x > b.x - b.sx / 2 - r && x < b.x + b.sx / 2 + r && z > b.z - b.sz / 2 - r && z < b.z + b.sz / 2 + r) {
        const len = b.ramp.axis === 'x' ? b.sx : b.sz;
        let f = ((b.ramp.axis === 'x' ? x - b.x : z - b.z) + len / 2) / len;
        if (b.ramp.up < 0) f = 1 - f;
        const hh = (b.y - b.sy / 2) + Math.max(0, Math.min(1, f)) * b.ramp.rise;
        if (hh <= fromY + 0.45 && hh > g) g = hh;
      }
      continue;
    }
    const top = b.y + b.sy / 2;
    if (top > fromY + 0.45) continue;
    if (x > b.x - b.sx / 2 - r && x < b.x + b.sx / 2 + r &&
        z > b.z - b.sz / 2 - r && z < b.z + b.sz / 2 + r && top > g) g = top;
  }
  return g;
}

function stepMe(dt) {
  const frozen = game.phase === 'freeze' || game.phase === 'vote' || game.phase === 'teleport' || me.dead;
  const now = clockNow();
  // ADS amount
  const wantAds = rightDown && (me.weapon === 'ar' || me.weapon === 'handgun' || me.weapon === 'sniper') && !me.reloading && !frozen;
  me.ads += ((wantAds ? 1 : 0) - me.ads) * Math.min(1, dt * 12);
  camera.fov = BASE_FOV / (1 + me.ads * ((WEAPONS[me.weapon]?.adsZoom || 1.3) - 1));
  camera.updateProjectionMatrix();

  let mx = 0, mz = 0;
  if (!frozen && (locked || mobileOn)) {
    mx = (keys.has(binds.right) ? 1 : 0) - (keys.has(binds.left) ? 1 : 0);
    mz = (keys.has(binds.forward) ? 1 : 0) - (keys.has(binds.back) ? 1 : 0);
    if (mobileMove.x || mobileMove.z) { mx = mobileMove.x; mz = mobileMove.z; }   // joystick overrides
  }
  const fx = -Math.sin(me.ry), fz = -Math.cos(me.ry);
  const rx = Math.cos(me.ry), rz = -Math.sin(me.ry);
  let wishX = fx * mz + rx * mx, wishZ = fz * mz + rz * mx;
  const wl = Math.hypot(wishX, wishZ) || 1; wishX /= wl; wishZ /= wl;
  const sprinting = isSprinting() && mz > 0 && !me.crouch;
  const speed = me.crouch && !me.sliding ? MOVE.crouch : sprinting ? MOVE.sprint : MOVE.walk;

  if (now < me.dashUntil) {                     // dash overrides
    me.vel.x = me.dashVec.x; me.vel.z = me.dashVec.z;
  } else if (me.sliding) {                       // slide decays
    const l = Math.hypot(me.slideVel.x, me.slideVel.z);
    const nl = Math.max(0, l - MOVE.slideFriction * dt);
    if (nl <= MOVE.crouch) { me.sliding = false; }
    else { me.slideVel.x *= nl / (l || 1); me.slideVel.z *= nl / (l || 1); }
    me.vel.x = me.slideVel.x; me.vel.z = me.slideVel.z;
  } else if (me.grounded) {
    me.vel.x = (mx || mz) ? wishX * speed : 0;
    me.vel.z = (mx || mz) ? wishZ * speed : 0;
  } else if (mx || mz) {                         // air control
    me.vel.x += (wishX * speed - me.vel.x) * MOVE.airControl * dt * 8;
    me.vel.z += (wishZ * speed - me.vel.z) * MOVE.airControl * dt * 8;
  }
  if (keys.has(binds.jump) && me.grounded && !frozen) { me.vel.y = MOVE.jumpVel; me.grounded = false; me.sliding = false; }

  me.vel.y -= MOVE.gravity * dt;
  let nx = me.pos.x + me.vel.x * dt;
  let nz = me.pos.z + me.vel.z * dt;
  const solved = collideMove(nx, me.pos.y, nz);
  me.pos.x = solved.x; me.pos.z = solved.z;
  me.pos.y += me.vel.y * dt;
  const g = groundAt(me.pos.x, me.pos.z, me.pos.y + 0.4);
  const wasAirborne = !me.grounded;
  const fallSpeed = -me.vel.y;
  if (me.pos.y <= g) {
    me.pos.y = g; me.vel.y = 0; me.grounded = true;
    if (wasAirborne && fallSpeed > 5) vmAnim.landK = Math.min(1, fallSpeed / 16); // landing dip
  }
  else me.grounded = false;

  // camera
  const eye = me.crouch || me.sliding ? MOVE.eyeCrouch : MOVE.eyeStand;
  camera.position.set(me.pos.x, me.pos.y + eye, me.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(me.ry);
  camera.rotateX(me.pitch);
  camera.rotateZ(vmAnim.roll * 0.4);   // subtle strafe lean, like the original
  // recoil kick decay
  camera.rotateX(recoil); recoil *= Math.pow(0.0001, dt);
}

// ============================ weapons ============================
let recoil = 0;
const viewRoot = new THREE.Group();
camera.add(viewRoot); scene.add(camera);
const viewmodels = {};
function vmMat(c) { return new THREE.MeshLambertMaterial({ color: c }); }

// your avatar's colours on YOUR hands — like the original's viewmodels
const VM_SHIRT = identity.avatar?.shirtColor || '#2f5fd0';
const VM_SKIN = identity.avatar?.skin || '#f5d3b3';

// arms are single chunky CUBES in your shirt colour — just like the original
function mkArm() {
  const g = new THREE.Group();
  const cube = new THREE.Mesh(roundedBoxGeo(0.18, 0.18, 0.78, 0.055), vmMat(VM_SHIRT));
  cube.position.set(0, 0, 0.26);
  g.add(cube);
  return g;
}
function rigWeapon(g, gunParts, rPos, rRot, lPos, lRot) {
  const gun = new THREE.Group();
  gunParts.forEach((p) => gun.add(p));
  const rArm = mkArm(); rArm.position.set(...rPos); rArm.rotation.set(...rRot);
  const lArm = mkArm(); lArm.position.set(...lPos); lArm.rotation.set(...lRot);
  g.add(gun, rArm, lArm);
  g.userData = {
    gun, rArm, lArm,
    base: {
      gun: { p: gun.position.clone(), r: gun.rotation.clone() },
      rArm: { p: rArm.position.clone(), r: rArm.rotation.clone() },
      lArm: { p: lArm.position.clone(), r: lArm.rotation.clone() },
    },
  };
}
const GOLD = '#caa14e', DARK = '#23262c', STEEL = '#8b93a5', GREY = '#3a3f47';
// cartoon-rounded box: subdivided box with every vertex clamped to an inner
// box and pushed back out to a corner radius — soft toy-like edges
function roundedBoxGeo(w, h, d, r) {
  r = Math.min(r, w / 2, h / 2, d / 2);
  const geo = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const pos = geo.attributes.position;
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(Math.max(-ix, Math.min(ix, v.x)), Math.max(-iy, Math.min(iy, v.y)), Math.max(-iz, Math.min(iz, v.z)));
    const dir = v.sub(c);
    const len = dir.length() || 1;
    pos.setXYZ(i, c.x + dir.x / len * r, c.y + dir.y / len * r, c.z + dir.z / len * r);
  }
  geo.computeVertexNormals();
  return geo;
}
function box(w, h, d, color, x, y, z, rx = 0) {
  const m = new THREE.Mesh(roundedBoxGeo(w, h, d, Math.min(w, h, d) * 0.32), vmMat(color));
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  return m;
}
function buildViewmodels() {
  // ---- assault rifle: stock/body/grip/mag/handguard/barrel/sights ----
  {
    const g = new THREE.Group();
    rigWeapon(g, [
      box(0.07, 0.11, 0.2, DARK, 0, -0.01, 0.32),          // stock
      box(0.09, 0.12, 0.48, GOLD, 0, 0, 0),                // receiver
      box(0.06, 0.13, 0.07, DARK, 0, -0.12, 0.12, 0.3),    // pistol grip
      box(0.065, 0.18, 0.1, DARK, 0, -0.15, -0.06, 0.12),  // magazine
      box(0.075, 0.085, 0.22, GOLD, 0, 0, -0.34),          // handguard
      box(0.04, 0.04, 0.3, DARK, 0, 0.02, -0.58),          // barrel
      box(0.055, 0.055, 0.06, GREY, 0, 0.02, -0.74),       // muzzle
      box(0.028, 0.04, 0.26, DARK, 0, 0.08, -0.02),        // top rail
      box(0.02, 0.05, 0.02, DARK, 0, 0.085, -0.42),        // front post
    ], [0.06, -0.16, 0.22], [0.5, -0.12, 0], [-0.08, -0.1, -0.3], [0.35, 0.35, 0.1]);
    viewmodels.ar = g;
  }
  // ---- handgun ----
  {
    const g = new THREE.Group();
    rigWeapon(g, [
      box(0.07, 0.075, 0.3, GREY, 0, 0.02, -0.02),         // slide
      box(0.074, 0.06, 0.06, STEEL, 0, 0.02, 0.1),         // rear serrations
      box(0.065, 0.05, 0.26, DARK, 0, -0.03, -0.02),       // frame
      box(0.06, 0.16, 0.085, DARK, 0, -0.13, 0.09, 0.22),  // grip
      box(0.02, 0.025, 0.02, STEEL, 0, 0.068, -0.15),      // front sight
    ], [0.045, -0.17, 0.17], [0.45, 0, 0], [-0.085, -0.18, 0.13], [0.45, 0.3, 0.2]);
    viewmodels.handgun = g;
  }
  // ---- knife (small pocket knife in the right hand) ----
  {
    const g = new THREE.Group();
    rigWeapon(g, [
      box(0.05, 0.06, 0.17, DARK, 0.4, -0.16, -0.1),
      box(0.055, 0.065, 0.03, STEEL, 0.4, -0.16, -0.2),
      box(0.03, 0.055, 0.24, '#c8ccd4', 0.4, -0.155, -0.33),
      box(0.03, 0.03, 0.05, '#c8ccd4', 0.4, -0.168, -0.47),
    ], [0.4, -0.26, 0.06], [0.6, -0.35, 0.15], [-0.58, -0.28, -0.02], [0.6, 0.55, -0.15]);
    viewmodels.scythe = g;
  }
  // ---- grenade (chunkier, lever + pin) ----
  {
    const g = new THREE.Group();
    rigWeapon(g, [
      (() => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 14), vmMat('#3f7d3f')); b.scale.y = 1.18; b.position.set(0.38, -0.14, -0.06); return b; })(),
      box(0.06, 0.05, 0.06, STEEL, 0.38, -0.03, -0.06),       // cap
      box(0.025, 0.1, 0.05, STEEL, 0.415, -0.06, -0.02, 0.25),// lever
      box(0.05, 0.02, 0.02, '#d8dbe0', 0.35, -0.005, -0.06),  // pin ring
    ], [0.38, -0.26, 0.08], [0.6, -0.35, 0.15], [-0.58, -0.28, -0.02], [0.6, 0.55, -0.15]);
    viewmodels.grenade = g;
  }
  // ---- sniper: long rifle + scope with objective ----
  {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 10), vmMat('#15181d'));
    tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.12, -0.06);
    const objective = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10), vmMat('#0c0e12'));
    objective.rotation.x = Math.PI / 2; objective.position.set(0, 0.12, -0.24);
    rigWeapon(g, [
      box(0.075, 0.12, 0.26, GREY, 0, -0.02, 0.36),        // stock
      box(0.085, 0.12, 0.72, '#3a3125', 0, 0, -0.05),      // body
      box(0.035, 0.035, 0.52, DARK, 0, 0.02, -0.65),       // barrel
      box(0.06, 0.06, 0.08, GREY, 0, 0.02, -0.92),         // brake
      box(0.06, 0.13, 0.09, DARK, 0, -0.13, 0.05, 0.25),   // grip
      box(0.055, 0.12, 0.09, DARK, 0, -0.12, -0.16),       // mag
      box(0.09, 0.035, 0.035, STEEL, 0.08, 0.02, 0.12),    // bolt
      tube, objective,
    ], [0.05, -0.16, 0.24], [0.5, -0.1, 0], [-0.085, -0.11, -0.32], [0.35, 0.3, 0]);
    viewmodels.sniper = g;
  }
  // ---- fists: two big shirt-colour cubes ----
  {
    const g = new THREE.Group();
    rigWeapon(g, [],
      [0.58, -0.26, -0.04], [0.7, -0.45, -0.2], [-0.6, -0.25, -0.1], [0.7, 0.45, 0.2]);
    viewmodels.fists = g;
  }
  for (const [k, g] of Object.entries(viewmodels)) { g.visible = false; g.scale.setScalar(0.68); viewRoot.add(g); }
}
buildViewmodels();

// ---- weapon skins: re-material a gun group with an equipped skin ----
let mySkins = { owned: [], equipped: {} };
const skinMat = (m) => new THREE.MeshStandardMaterial({ color: m.color, metalness: m.metalness == null ? 0.4 : m.metalness, roughness: m.roughness == null ? 0.5 : m.roughness, emissive: m.emissive || '#000000', emissiveIntensity: m.emissiveIntensity || 0 });
function applySkinToGroup(group, def) {
  group.traverse((o) => { if (!o.isMesh) return; if (!o.userData._orig) o.userData._orig = o.material; o.material = def ? skinMat(def.mat) : o.userData._orig; });
}
function skinFor(equipped, weapon) { const id = equipped && equipped[weapon]; return id ? SKIN_BY_ID[id] : null; }
function applyMyViewmodelSkins() { for (const w of SKIN_WEAPONS) { const vm = viewmodels[w]; if (vm && vm.userData.gun) applySkinToGroup(vm.userData.gun, skinFor(mySkins.equipped, w)); } }
async function loadMySkins() {
  try {
    const d = await fetch('/api/rivals/skins?name=' + encodeURIComponent(identity.name), { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } }).then((r) => r.json());
    if (d) { mySkins.owned = d.owned || []; mySkins.equipped = d.equipped || {}; mySkins.cubes = d.cubes || 0; }
  } catch {}
}

// ---- skins shop UI (open cases, equip skins) ----
function buildSkinsUI() {
  if (document.getElementById('sk-open')) return;
  const st = document.createElement('style'); st.textContent = `
  #sk-open{position:fixed;right:14px;bottom:14px;z-index:40;background:rgba(20,24,34,.82);border:1px solid rgba(255,255,255,.14);color:#fff;font-weight:800;font-size:14px;padding:11px 16px;border-radius:12px;cursor:pointer;backdrop-filter:blur(8px);}
  #sk-open:hover{background:rgba(40,48,66,.9);}
  #sk-panel{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(6,8,14,.6);backdrop-filter:blur(6px);font-family:-apple-system,system-ui,sans-serif;}
  #sk-panel.hidden{display:none;}
  .sk-card{width:min(720px,94vw);max-height:90vh;overflow-y:auto;background:rgba(22,26,36,.97);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:20px;position:relative;color:#e9edf5;}
  .sk-close{position:absolute;top:14px;right:16px;background:none;border:none;color:#9aa4b8;font-size:22px;cursor:pointer;}
  .sk-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
  .sk-head h2{font-size:22px;} .sk-cubes{font-size:16px;font-weight:800;color:#7fbcff;}
  .sk-case{width:100%;background:linear-gradient(135deg,#2f6fed,#7b3ff0);border:none;color:#fff;font-weight:800;font-size:17px;padding:16px;border-radius:14px;cursor:pointer;display:flex;flex-direction:column;gap:3px;margin-bottom:22px;box-shadow:0 8px 24px rgba(90,60,240,.35);}
  .sk-case small{font-weight:600;opacity:.85;font-size:12px;}
  .sk-case:disabled{opacity:.5;cursor:default;}
  .sk-wsec{margin-bottom:18px;} .sk-wsec h3{font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#8a94a8;margin-bottom:8px;}
  .sk-grid{display:flex;flex-wrap:wrap;gap:8px;}
  .sk-chip{border:2px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);border-radius:11px;padding:9px 13px;cursor:pointer;font-weight:700;font-size:13px;min-width:96px;}
  .sk-chip small{display:block;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;opacity:.85;}
  .sk-chip.on{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.2) inset;}
  #sk-reveal{position:fixed;inset:0;z-index:70;display:none;place-items:center;background:rgba(4,6,12,.82);}
  #sk-reveal.show{display:grid;}
  .sk-rev-in{text-align:center;} .sk-rev-in h2{margin-bottom:16px;font-size:24px;}
  .sk-drops{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;}
  .sk-drop{width:150px;background:#1a1f2b;border:2px solid;border-radius:14px;padding:16px 12px;animation:skpop .4s cubic-bezier(.2,1.4,.4,1) backwards;}
  .sk-drop b{display:block;font-size:15px;margin-top:4px;} .sk-drop .w{color:#8a94a8;font-size:12px;} .sk-drop .r{font-size:11px;font-weight:800;text-transform:uppercase;}
  @keyframes skpop{from{transform:scale(.3);opacity:0}}
  .sk-rev-in button{margin-top:20px;background:#2f6fed;border:none;color:#fff;font-weight:800;padding:12px 28px;border-radius:12px;cursor:pointer;font-size:15px;}
  @media(max-width:640px){#sk-open{bottom:auto;top:10px;right:10px;}}`;
  document.head.appendChild(st);
  const btn = document.createElement('button'); btn.id = 'sk-open'; btn.textContent = '🎁 Skins';
  const panel = document.createElement('div'); panel.id = 'sk-panel'; panel.className = 'hidden';
  panel.innerHTML = `<div class="sk-card"><button class="sk-close">✕</button>
    <div class="sk-head"><h2>🎁 Weapon Skins</h2><div class="sk-cubes">🔷 <b id="sk-cubes">0</b></div></div>
    <button class="sk-case" id="sk-case">Open Skin Case · ${CASE_PRICE} 🔷<small>3 skins for 3 random weapons</small></button>
    <div id="sk-weps"></div></div>`;
  const reveal = document.createElement('div'); reveal.id = 'sk-reveal';
  document.body.append(btn, panel, reveal);
  btn.onclick = openSkins;
  panel.querySelector('.sk-close').onclick = () => panel.classList.add('hidden');
  panel.addEventListener('mousedown', (e) => { if (e.target === panel) panel.classList.add('hidden'); });
  panel.querySelector('#sk-case').onclick = openCase;
}
async function openSkins() {
  try { document.exitPointerLock && document.exitPointerLock(); } catch {}
  await loadMySkins(); renderSkins();
  document.getElementById('sk-panel').classList.remove('hidden');
}
function renderSkins() {
  document.getElementById('sk-cubes').textContent = mySkins.cubes || 0;
  const cs = document.getElementById('sk-case'); cs.disabled = (mySkins.cubes || 0) < CASE_PRICE;
  const weps = document.getElementById('sk-weps');
  weps.innerHTML = SKIN_WEAPONS.map((w) => {
    const owned = (SKINS_BY_WEAPON[w] || []).filter((s) => mySkins.owned.includes(s.id));
    const eq = mySkins.equipped[w];
    const chips = [`<div class="sk-chip ${!eq ? 'on' : ''}" data-w="${w}" data-s="none">Default</div>`]
      .concat(owned.map((s) => `<div class="sk-chip ${eq === s.id ? 'on' : ''}" data-w="${w}" data-s="${s.id}" style="border-color:${eq === s.id ? '#fff' : RARITY_COLOR[s.rarity]}"><small style="color:${RARITY_COLOR[s.rarity]}">${s.rarity}</small>${s.name}</div>`));
    return `<div class="sk-wsec"><h3>${WEAPONS[w] ? WEAPONS[w].name : w}${owned.length ? '' : ' · <span style="color:#6a7284">no skins yet</span>'}</h3><div class="sk-grid">${chips.join('')}</div></div>`;
  }).join('');
  weps.querySelectorAll('.sk-chip').forEach((c) => c.onclick = () => equipSkin(c.dataset.w, c.dataset.s));
}
async function equipSkin(weapon, skin) {
  const r = await fetch('/api/rivals/equip', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' }, body: JSON.stringify({ name: identity.name, weapon, skin }) }).then((x) => x.json()).catch(() => ({}));
  if (r && r.ok) { mySkins.equipped = r.equipped || {}; applyMyViewmodelSkins(); net.send && net.send({ t: 'skins', skins: mySkins.equipped }); renderSkins(); }
}
async function openCase() {
  const cs = document.getElementById('sk-case'); cs.disabled = true;
  const r = await fetch('/api/rivals/case', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' }, body: JSON.stringify({ name: identity.name }) }).then((x) => x.json()).catch(() => ({}));
  if (!r || !r.ok) { window.ClaudeBox?.toast?.({ title: 'Not enough ClaudeBux', emoji: '🔷' }); renderSkins(); return; }
  mySkins.owned = r.owned || mySkins.owned; mySkins.cubes = r.cubes;
  const drops = (r.drops || []).map((id) => SKIN_BY_ID[id]).filter(Boolean);
  const rev = document.getElementById('sk-reveal');
  rev.innerHTML = `<div class="sk-rev-in"><h2>🎁 Case opened!</h2><div class="sk-drops">${drops.map((s, i) => `<div class="sk-drop" style="border-color:${RARITY_COLOR[s.rarity]};animation-delay:${i * 0.15}s"><div class="r" style="color:${RARITY_COLOR[s.rarity]}">${s.rarity}</div><b>${s.name}</b><div class="w">${WEAPONS[s.weapon] ? WEAPONS[s.weapon].name : s.weapon}</div></div>`).join('')}</div><button id="sk-rev-ok">Nice!</button></div>`;
  rev.classList.add('show');
  rev.querySelector('#sk-rev-ok').onclick = () => { rev.classList.remove('show'); renderSkins(); };
}

const VM_HIP = { x: 0.28, y: -0.24, z: -0.5 };
// free-hand weapons anchor nearer the centre so the two arms read left + right
const VM_HIPS = {
  scythe: { x: 0.06, y: -0.22, z: -0.48 },
  grenade: { x: 0.06, y: -0.22, z: -0.48 },
  fists: { x: 0.03, y: -0.22, z: -0.46 },
};
const VM_ADS = { x: 0, y: -0.166, z: -0.38 };
let vmBob = 0, vmKick = 0;

// ---- swingy animation state (springs + one-shot clips) ----
const vmAnim = {
  swayYaw: 0, swayPitch: 0, roll: 0, sprintK: 0, slideK: 0, airK: 0, landK: 0,
  lastRy: 0, lastPitch: 0,
  equipT: 1,                    // 0→1 raise-with-flick on weapon swap
  reloadStart: 0, reloadDur: 0, // hand-animated reload
  swingT: 1, swingSide: 1,      // scythe arcs, alternating sides
  throwT: 1,                    // grenade overhand
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

function switchWeapon(id) {
  if (!id || id === me.weapon || me.reloading) return;
  me.weapon = id;
  vmAnim.equipT = 0;             // raise-with-flick
  net.send({ t: 'weapon', id });
  playOne('equip', 0.8);
  stopLoop('ar');   // cancel any AR fire loop when swapping off
  updateAmmoHud(); updateLoadoutHud();
}

function startReload() {
  const w = WEAPONS[me.weapon];
  if (!w || !w.mag || me.reloading) return;
  const a = me.ammo[me.weapon];
  if (a.mag >= w.mag || a.res <= 0) return;
  me.reloading = clockNow() + w.reload;
  vmAnim.reloadStart = clockNow();
  vmAnim.reloadDur = w.reload;
  $('#reload-hint').classList.remove('hidden');
  stopLoop('ar');
  playOne('reload', 0.85);
}
function finishReload() {
  const w = WEAPONS[me.weapon], a = me.ammo[me.weapon];
  const need = w.mag - a.mag, take = Math.min(need, a.res);
  a.mag += take; a.res -= take;
  me.reloading = 0;
  $('#reload-hint').classList.add('hidden');
  updateAmmoHud();
}

function tryFire() {
  if ((!locked && !mobileOn) || me.dead) return;
  if (game.phase === 'freeze' || game.phase === 'vote' || game.phase === 'teleport' || game.phase === 'podium') return;
  const now = clockNow();
  const w = WEAPONS[me.weapon];
  if (w?.melee) {
    if (now - me.swingAt < w.rate) return;
    me.swingAt = now;
    vmAnim.swingT = 0; vmAnim.swingSide *= -1;   // arcs / alternating jabs
    playOne(me.weapon === 'scythe' ? 'knife' : 'fists', 0.8);
    if (game.phase === 'live') net.send({ t: 'melee', weapon: me.weapon });
    return;
  }
  if (me.weapon === 'grenade') {
    if (me.grenades <= 0 || now - me.lastFire < WEAPONS.grenade.rate) return;
    me.lastFire = now; me.grenades--;
    vmAnim.throwT = 0;                            // wind-up + overhand whip
    const d = aimDir(0);
    if (game.phase === 'live') net.send({ t: 'nade', dx: d.x, dy: d.y + 0.18, dz: d.z });
    updateLoadoutHud();
    return;
  }
  if (me.reloading) return;
  const a = me.ammo[me.weapon];
  if (a.mag <= 0) { startReload(); return; }
  if (now - me.lastFire < w.rate) return;
  me.lastFire = now;
  a.mag--;
  const spread = me.ads > 0.5 ? w.adsSpread : w.spread;
  const d = aimDir(spread);
  recoil += me.weapon === 'sniper' ? 0.018 : 0.012 + (me.weapon === 'handgun' ? 0.008 : 0.004);
  vmKick = me.weapon === 'sniper' ? 1.25 : 1;
  // AR fires a continuous loop (handled in the frame); other guns are one-shots.
  if (me.weapon === 'handgun') playOne('handgun', 0.75);
  else if (me.weapon === 'sniper') playOne('sniper', 1.6);   // sniper is loud
  muzzleFlash();
  localTracer(d);
  if (game.phase === 'live') net.send({ t: 'fire', dx: d.x, dy: d.y, dz: d.z, weapon: me.weapon });
  else rangeShot(d); // lobby: shooting range
  updateAmmoHud();
  if (a.mag <= 0) startReload();
}

function aimDir(spread) {
  const v = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (spread) {
    v.x += (Math.random() - 0.5) * spread * 2;
    v.y += (Math.random() - 0.5) * spread * 2;
    v.z += (Math.random() - 0.5) * spread * 2;
    v.normalize();
  }
  return v;
}

// muzzle flash + tracers
const flashLight = new THREE.PointLight('#ffd28a', 0, 6);
scene.add(flashLight);
let flashUntil = 0;
function muzzleFlash() {
  flashLight.position.copy(camera.position);
  flashLight.intensity = 2.4;
  flashUntil = clockNow() + 0.04;
}
const tracers = [];
function spawnTracer(from, to, color = '#ffe6a8') {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line);
  tracers.push({ line, until: clockNow() + 0.07 });
}
function localTracer(dir) {
  const origin = camera.position.clone();
  const muzzle = origin.clone().add(dir.clone().multiplyScalar(0.6)).add(new THREE.Vector3(0, -0.12, 0));
  // visual ray vs map + fighters for endpoint
  let dist = rayBoxesDist(origin, dir, WEAPONS[me.weapon].range || 100);
  const end = origin.clone().add(dir.clone().multiplyScalar(dist));
  spawnTracer(muzzle, end);
}
function rayBoxesDist(origin, dir, maxDist) {
  let best = maxDist;
  for (const b of mapBoxes) {
    const t = rayAabb(origin, dir, b, best);
    if (t !== null && t < best) best = t;
  }
  return best;
}
function rayAabb(o, d, b, maxDist) {
  let t0 = 0, t1 = maxDist;
  const axes = [['x', 'sx'], ['y', 'sy'], ['z', 'sz']];
  for (const [ax, sx] of axes) {
    const mn = b[ax] - b[sx] / 2, mx = b[ax] + b[sx] / 2;
    const oo = o[ax], dd = d[ax];
    if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) return null; continue; }
    let ta = (mn - oo) / dd, tb = (mx - oo) / dd;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

// lobby shooting range
function rangeShot(dir) {
  const origin = camera.position.clone();
  for (const t of rangeTargets) {
    if (!t.alive) continue;
    const box = { x: t.grp.position.x, y: t.grp.position.y + 0.3, z: t.grp.position.z, sx: 0.8, sy: 1.6, sz: 0.5 };
    const hit = rayAabb(origin, dir, box, 60);
    const wallDist = rayBoxesDist(origin, dir, 60);
    if (hit !== null && hit < wallDist) {
      t.alive = false; t.respawnAt = clockNow() + 2.5;
      t.grp.rotation.x = -1.2;
      sfx.hit(); showHitmarker(false);
    }
  }
}

// ============================ remote fighters ============================
status('Loading avatars…');
await preloadAvatars(['boy', 'girl']).catch(() => {});
const others = new Map(); // id -> { ctrl, plate, target, data }

function plateFor(name, team) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.55, 1);
  return { cv, tex, sprite, name, team, hp: 100 };
}
function drawPlate(p) {
  const ctx = p.cv.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(p.name, 129, 29);
  ctx.fillStyle = p.team === game.myTeam ? '#8fd0ff' : '#ffd28a';
  ctx.fillText(p.name, 128, 27);
  // hp bar
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(48, 40, 160, 10);
  ctx.fillStyle = p.hp > 50 ? '#59d185' : p.hp > 25 ? '#ffcf5c' : '#f06b5c';
  ctx.fillRect(49, 41, 158 * Math.max(0, p.hp) / 100, 8);
  p.tex.needsUpdate = true;
}
// mini third-person weapons so you can SEE what everyone is holding
function makeHeldWeapon(id) {
  const g = new THREE.Group();
  if (id === 'ar') {
    g.add(box(0.07, 0.09, 0.44, GOLD, 0, 0, -0.06));
    g.add(box(0.035, 0.035, 0.2, DARK, 0, 0.015, -0.36));
    g.add(box(0.05, 0.12, 0.08, DARK, 0, -0.09, 0.08));
  } else if (id === 'handgun') {
    g.add(box(0.055, 0.06, 0.22, GREY, 0, 0, -0.04));
    g.add(box(0.05, 0.11, 0.07, DARK, 0, -0.07, 0.06, 0.2));
  } else if (id === 'sniper') {
    g.add(box(0.06, 0.08, 0.62, '#3a3125', 0, 0, -0.1));
    g.add(box(0.03, 0.03, 0.3, DARK, 0, 0.01, -0.5));
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 8), vmMat('#15181d'));
    t.rotation.x = Math.PI / 2; t.position.set(0, 0.08, -0.1); g.add(t);
  } else if (id === 'scythe') {
    g.add(box(0.035, 0.045, 0.13, DARK, 0, 0, 0.03));
    g.add(box(0.024, 0.042, 0.2, '#c8ccd4', 0, 0, -0.12));
  } else if (id === 'grenade') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), vmMat('#3f7d3f'));
    b.scale.y = 1.15; g.add(b);
  }
  return g; // fists = empty hands (scale applied at mount via GUN_ANCHORS)
}
// per-weapon grip geometry (mesh-local, matching makeHeldWeapon above):
//  grip = the point the RIGHT hand wraps (trigger/handle)
//  fore = a point up the BARREL that the LEFT hand should reach toward
//  scale = world size of the held model
const GUN_ANCHORS = {
  ar:      { grip: [0, -0.03, 0.08], fore: [0, 0, -0.34], scale: 1.7, twoHand: true },
  sniper:  { grip: [0, -0.03, 0.06], fore: [0, 0, -0.46], scale: 1.6, twoHand: true },
  handgun: { grip: [0, -0.04, 0.05], fore: [0, 0, -0.13], scale: 1.6, twoHand: false },
  scythe:  { grip: [0, 0, 0.05],     fore: [0, 0, -0.12], scale: 1.6, twoHand: false },
  grenade: { grip: [0, 0, 0],        fore: [0, 0, -0.07], scale: 1.5, twoHand: false },
};
// attach the held-weapon group to the avatar's right hand BONE so weapons
// ride the actual arm animation. Alignment is computed against the settled
// idle pose: we solve the holder quaternion so the gun points along the
// model's forward at mount time, then the hand's animation carries it.
// attach the held weapon to the right-hand bone and solve its grip:
// two-handed weapons lie along the right-hand→left-hand line (exactly where a
// rifle sits in the pose), one-handed weapons extend the forearm line. The
// solve runs against the settled WEAPON pose and re-runs on every swap.
function poseFor(w) {
  if (w === 'ar' || w === 'sniper') return 'rifleidle';
  if (w === 'handgun') return 'pistolidle';
  if (w === 'scythe' || w === 'grenade') return 'knifeidle';
  return 'idle';
}
function mountHeldToHand(o) {
  const bones = o.ctrl.bones || {};
  const rHand = bones['mixamorigRightHand'] || bones['R_Wrist'];
  const lHand = bones['mixamorigLeftHand'] || bones['L_Wrist'];
  const rElbow = bones['mixamorigRightForeArm'] || bones['R_Elbow'];
  const a = GUN_ANCHORS[o.heldId];
  if (!rHand || !a) {                        // fists, or no rig → fixed fallback
    if (o.held.parent !== o.ctrl.group) o.ctrl.group.add(o.held);
    o.held.position.set(0.34, 1.04, 0.24);
    o.held.quaternion.identity();
    o.held.scale.setScalar(1);
    return;
  }
  // settle into the pose this weapon is actually held in, so the hand bones
  // are where they'll be at rest before we solve the grip
  o.ctrl.setAnim(poseFor(o.heldId));
  o.ctrl.update(0.35);
  if (o.held.parent !== rHand) rHand.add(o.held);
  o.ctrl.group.updateWorldMatrix(true, true);
  const ws = new THREE.Vector3(); rHand.getWorldScale(ws);
  const s = (1 / (ws.x || 1)) * a.scale;     // undo bone scale, apply world size
  const grip = new THREE.Vector3().fromArray(a.grip);
  const fore = new THREE.Vector3().fromArray(a.fore);
  // where should the BARREL point? toward the left hand for two-handed weapons
  // (handle in the right hand, barrel reaching the left), else along the forearm
  const RW = new THREE.Vector3(); rHand.getWorldPosition(RW);
  let dirLocal = null;
  if (a.twoHand && lHand) {
    const LW = new THREE.Vector3(); lHand.getWorldPosition(LW);
    if (RW.distanceTo(LW) > 0.12) dirLocal = rHand.worldToLocal(LW.clone());
  }
  if (!dirLocal) {
    if (rElbow) { const E = new THREE.Vector3(); rElbow.getWorldPosition(E); dirLocal = rHand.worldToLocal(RW.clone().add(RW.clone().sub(E))); }
    else dirLocal = new THREE.Vector3(0, 0, -1);
  }
  dirLocal.normalize();
  // rotate the gun so its barrel axis (grip→fore) lands on that direction,
  // then translate so the grip point sits exactly at the right-hand origin
  const axis = fore.clone().sub(grip).normalize();
  const Q = new THREE.Quaternion().setFromUnitVectors(axis, dirLocal);
  o.held.quaternion.copy(Q);
  o.held.scale.setScalar(s);
  o.held.position.copy(grip).multiplyScalar(-s).applyQuaternion(Q);
}

function setHeld(o, id) {
  if (o.heldId === id) return;
  o.heldId = id;
  while (o.held.children.length) {
    const c = o.held.children.pop();
    c.traverse?.((n) => { n.geometry?.dispose(); n.material?.dispose?.(); });
    o.held.remove(c);
  }
  o.held.add(makeHeldWeapon(id));
  const sk = skinFor(o.data && o.data.skins, id);
  if (sk) applySkinToGroup(o.held, sk);
}

function addOther(f) {
  if (others.has(f.id) || f.id === net.id) return;
  const ctrl = makeAvatar(f.avatar || {});
  ctrl.setAnim(f.anim || 'idle');
  scene.add(ctrl.group);
  const plate = plateFor(f.name, f.team || 'A');
  plate.hp = f.hp ?? 100;
  drawPlate(plate);
  plate.sprite.position.y = 2.35;
  ctrl.group.add(plate.sprite);
  const held = new THREE.Group();
  const rec = { ctrl, plate, data: f, target: { ...f.pos, ry: f.ry || 0 }, held, heldId: null };
  others.set(f.id, rec);
  setHeld(rec, f.weapon || 'ar');
  mountHeldToHand(rec);
  ctrl.group.position.set(f.pos.x, f.pos.y, f.pos.z);
}
// weapon-aware pose: standing/running with a rifle/pistol/knife LOOKS like it
function displayAnim(o) {
  const d = o.data;
  if (d.dead) return 'death';
  if (d.actionUntil && clockNow() < d.actionUntil) return d.actionAnim;
  const base = d.anim || 'idle';
  const w = o.heldId;
  if (w === 'ar' || w === 'sniper') { if (base === 'idle') return 'rifleidle'; if (base === 'run' || base === 'walk') return 'riflerun'; }
  else if (w === 'handgun') { if (base === 'idle') return 'pistolidle'; if (base === 'run' || base === 'walk') return 'pistolrun'; }
  else if (w === 'scythe' || w === 'grenade') { if (base === 'idle') return 'knifeidle'; }
  return base;
}
function removeOther(id) {
  const o = others.get(id);
  if (!o) return;
  scene.remove(o.ctrl.group);
  o.ctrl.dispose?.();
  others.delete(id);
}
function clearOthers() { for (const id of [...others.keys()]) removeOther(id); }

// ============================ HUD ============================
const hud = {
  hp: $('#health-bar'), hpNum: $('#health-num'), hpWrap: $('#health-wrap'),
  ammoWrap: $('#ammo-wrap'), mag: $('#ammo-mag'), res: $('#ammo-res'), wname: $('#weapon-name'),
  loadout: $('#loadout'), clock: $('#round-clock'),
  scoreA: $('#score-a'), scoreB: $('#score-b'),
};
function toast(t) {
  const el = document.createElement('div');
  el.className = 'rv-toast'; el.textContent = t;
  $('#rv-toasts').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
const WEAPON_ICONS = { ar: '🔫', handgun: '🔫', scythe: '🔪', grenade: '💣', sniper: '🔭', fists: '👊' };
function updateLoadoutHud() {
  hud.loadout.innerHTML = '';
  LOADOUT.forEach((id, i) => {
    const s = document.createElement('div');
    s.className = 'slot' + (me.weapon === id ? ' active' : '');
    s.innerHTML = `<small>${i + 1}</small>${WEAPON_ICONS[id]}` + (id === 'grenade' ? `<span class="cnt">${me.grenades}</span>` : '');
    s.addEventListener('pointerdown', (e) => { e.preventDefault(); switchWeapon(id); }); // tap to equip (mobile + desktop)
    hud.loadout.appendChild(s);
  });
}
function updateAmmoHud() {
  const w = WEAPONS[me.weapon];
  if (w.mag) {
    const a = me.ammo[me.weapon];
    hud.mag.textContent = a.mag; hud.res.textContent = a.res;
  } else if (me.weapon === 'grenade') { hud.mag.textContent = me.grenades; hud.res.textContent = ''; }
  else { hud.mag.textContent = '—'; hud.res.textContent = ''; }
  hud.wname.textContent = w.name;
  updateLoadoutHud();
}
function updateHpHud() {
  const pct = Math.max(0, me.hp);
  hud.hp.style.width = pct + '%';
  hud.hp.className = pct > 50 ? '' : pct > 25 ? 'mid' : 'low';
  hud.hpNum.textContent = Math.max(0, Math.round(me.hp));
}
function showHitmarker(head) {
  const el = $('#hitmarker');
  el.classList.remove('show', 'head');
  void el.offsetWidth;
  if (head) el.classList.add('head');
  el.classList.add('show');
}
function dmgNumber(amount, head, wx, wy, wz) {
  const v = new THREE.Vector3(wx, wy, wz).project(camera);
  if (v.z > 1) return;
  const el = document.createElement('div');
  el.className = 'dmg-num' + (head ? ' head' : '');
  el.textContent = amount;
  el.style.left = ((v.x * 0.5 + 0.5) * innerWidth + (Math.random() * 22 - 11)) + 'px';
  el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight - 8) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 720);
}
function killfeed(killerName, victimName, weapon, meInvolved) {
  const el = document.createElement('div');
  el.className = 'kf';
  el.innerHTML = `<span class="${meInvolved === 'killer' ? 'me' : ''}">${killerName}</span><span class="wep">${WEAPON_ICONS[weapon] || '🔫'}</span><span class="${meInvolved === 'victim' ? 'me' : ''}">${victimName}</span>`;
  const feed = $('#killfeed');
  feed.appendChild(el);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => el.remove(), 6000);
}
function chipAvatars(el, roster, team) {
  el.innerHTML = '';
  for (const f of roster.filter((r) => r.team === team)) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    cv.dataset.fid = f.id;
    try { drawAvatarHead(cv.getContext('2d'), f.avatar || {}, 64); } catch {}
    el.appendChild(cv);
  }
}

// ============================ overlays ============================
function toggleModes() {
  $('#modes').classList.toggle('hidden');
  if (!$('#modes').classList.contains('hidden')) document.exitPointerLock?.();
}
$('#modes-close').addEventListener('click', () => $('#modes').classList.add('hidden'));
document.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => {
  net.send({ t: 'queue.join', mode: b.dataset.mode });
  $('#modes').classList.add('hidden');
  sfx.beep();
}));
$('#qb-cancel').addEventListener('click', () => { net.send({ t: 'queue.leave' }); });

document.querySelectorAll('.vote-card').forEach((b) => b.addEventListener('click', () => {
  net.send({ t: 'vote', map: b.dataset.map });
  document.querySelectorAll('.vote-card').forEach((x) => x.classList.toggle('picked', x === b));
  sfx.click();
}));

$('#pd-rematch').addEventListener('click', () => requeueFromPodium());
$('#pd-again').addEventListener('click', () => requeueFromPodium());
$('#pd-leave').addEventListener('click', () => { $('#podium').classList.add('hidden'); });
let lastMode = 'duo';
function requeueFromPodium() {
  $('#podium').classList.add('hidden');
  net.send({ t: 'queue.join', mode: lastMode });
  sfx.beep();
}

// ============================ net handlers ============================
const MODE_LABELS = { beginner: 'Beginner 1v1', duo: '1v1', squad: '2v2' };

net.on('welcome', (msg) => {
  clearOthers();
  for (const p of msg.players) addOther({ ...p, team: 'A' });
  enterLobby(false);
});
net.on('player.join', (msg) => { if (game.phase === 'lobby') addOther({ ...msg.player, team: 'A' }); });
net.on('player.leave', (msg) => removeOther(msg.id));
net.on('queue.state', (msg) => {
  if (msg.mode) {
    game.queued = msg.mode; game.queuedSince = clockNow();
    lastMode = msg.mode;
    $('#qb-mode').textContent = MODE_LABELS[msg.mode] || msg.mode;
    $('#queue-banner').classList.remove('hidden');
  } else {
    game.queued = null;
    $('#queue-banner').classList.add('hidden');
  }
});

net.on('match.start', (msg) => {
  game.phase = 'vote';
  game.roster = msg.roster;
  game.stateUntil = msg.voteEnds;
  const mine = msg.roster.find((r) => r.id === net.id);
  game.myTeam = mine?.team || 'A';
  game.score = { A: 0, B: 0 };
  game.queued = null;
  $('#queue-banner').classList.add('hidden');
  $('#vote').classList.remove('hidden');
  document.querySelectorAll('.vote-card').forEach((x) => x.classList.remove('picked'));
  document.querySelectorAll('.vc-pct').forEach((x) => x.textContent = '');
  document.exitPointerLock?.();
  clearOthers();
  sfx.roundStart();
});
net.on('vote.state', (msg) => {
  for (const opt of ['random', 'arena', 'battleground']) {
    const n = msg.counts[opt] || 0;
    $('#pct-' + opt).textContent = n ? `${Math.round(n / msg.total * 100)}%` : '';
  }
});
net.on('match.map', (msg) => {
  game.phase = 'teleport';
  game.mapId = msg.map;
  $('#vote').classList.add('hidden');
  $('#tp-tip').textContent = msg.tip || '';
  $('#teleport').classList.remove('hidden');
});
net.on('round.freeze', (msg) => {
  $('#teleport').classList.add('hidden');
  $('#podium').classList.add('hidden');
  if (game.mapId !== 'lobby' && (!mapGroup || game.builtMap !== game.mapId)) {
    buildMap(MAPS[game.mapId] || MAPS.arena);
    game.builtMap = game.mapId;
  }
  game.phase = 'freeze';
  game.score = msg.score;
  game.stateUntil = msg.until;
  // spawn everyone
  clearOthers();
  for (const f of msg.fighters) {
    if (f.id === net.id) {
      me.pos = { ...f.pos }; me.ry = f.ry; me.pitch = 0;
      me.vel = { x: 0, y: 0, z: 0 };
      me.hp = 100; me.dead = false;
      me.weapon = 'ar';
      me.ammo = { ar: { mag: 20, res: 100 }, handgun: { mag: 15, res: 90 }, sniper: { mag: 5, res: 25 } };
      me.grenades = WEAPONS.grenade.count;
      me.reloading = 0;
    } else addOther(f);
  }
  // HUD
  $('#match-top').classList.remove('hidden');
  $('#health-wrap').classList.remove('hidden');
  $('#ammo-wrap').classList.remove('hidden');
  $('#lobby-tip').classList.add('hidden');
  $('#kb-open')?.classList.add('hidden'); closeKeybinds();
  $('#freeze-count').classList.remove('hidden');
  hud.scoreA.textContent = game.score[game.myTeam];
  hud.scoreB.textContent = game.score[game.myTeam === 'A' ? 'B' : 'A'];
  chipAvatars($('#chip-a-av'), game.roster, game.myTeam);
  chipAvatars($('#chip-b-av'), game.roster, game.myTeam === 'A' ? 'B' : 'A');
  updateHpHud(); updateAmmoHud();
  if (msg.round === 1) {
    const card = $('#map-card');
    $('#map-card-name').textContent = (MAPS[game.mapId] || MAPS.arena).name;
    card.querySelector('.mc-art').className = 'mc-art ' + (game.mapId === 'battleground' ? 'bg' : 'arena');
    card.classList.remove('hidden');
    setTimeout(() => card.classList.add('hidden'), 2000);
  } else banner(`ROUND ${msg.round}`, 900);
  sfx.roundStart();
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {}
});
net.on('round.live', (msg) => {
  game.phase = 'live';
  game.stateUntil = msg.until;
  $('#freeze-count').classList.add('hidden');
  banner('GO!', 600);
  sfx.beep();
});
net.on('round.end', (msg) => {
  game.phase = 'roundEnd';
  game.score = msg.score;
  hud.scoreA.textContent = game.score[game.myTeam];
  hud.scoreB.textContent = game.score[game.myTeam === 'A' ? 'B' : 'A'];
  const won = msg.winner === game.myTeam;
  banner(msg.winner ? (won ? '✔ ROUND WON' : '✖ ROUND LOST') : 'ROUND DRAW', 1600);
  (won ? sfx.elim : sfx.hurt)();
});
net.on('match.end', (msg) => {
  game.phase = 'podium';
  const won = msg.winner === game.myTeam;
  $('#podium-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('#podium-title').className = won ? 'win' : 'lose';
  const winners = msg.stats.filter((s) => s.team === msg.winner).map((s) => s.name).join(' & ');
  $('#podium-sub').textContent = `${winners} take the duel ${msg.score.A}–${msg.score.B}`;
  const host = $('#podium-stats');
  host.innerHTML = '';
  const top = [...msg.stats].sort((a, b) => b.elims - a.elims);
  for (const s of top) {
    const row = document.createElement('div');
    row.className = 'pstat' + (s.team === msg.winner && s === top.find((x) => x.team === msg.winner) ? ' winner' : '');
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    try { drawAvatarHead(cv.getContext('2d'), s.avatar || {}, 64); } catch {}
    row.appendChild(cv);
    row.insertAdjacentHTML('beforeend',
      `<div class="pn">${s.name}${s.bot ? ' <small>BOT</small>' : ''}</div>` +
      `<div class="pv"><span>⚔ <b>${s.elims}</b></span><span>💀 <b>${s.deaths}</b></span><span>🤝 <b>${s.assists}</b></span><span>🗡 <b>${s.dmgDealt}</b></span></div>`);
    host.appendChild(row);
  }
  $('#podium').classList.remove('hidden');
  document.exitPointerLock?.();
  if (won) { sfx.win(); window.ClaudeBox?.completeChallenge('rivals-win'); }
  else sfx.lose();
});
net.on('lobby', (msg) => { enterLobby(true); for (const p of msg.players) addOther({ ...p, team: 'A' }); });

net.on('snap', (msg) => {
  if (msg.players) { // lobby snapshot
    for (const pl of msg.players) {
      if (pl.id === net.id) continue;
      const o = others.get(pl.id);
      if (!o) { addOther({ ...pl, team: 'A' }); continue; }
      o.target = { ...pl.pos, ry: pl.ry };
      o.data.anim = pl.anim;
      if (pl.weapon && o.heldId !== pl.weapon) { setHeld(o, pl.weapon); mountHeldToHand(o); }
    }
    return;
  }
  for (const f of msg.fighters || []) {
    if (f.id === net.id) {
      // trust server hp
      if (Math.abs(f.hp - me.hp) > 0.5) { me.hp = f.hp; updateHpHud(); }
      continue;
    }
    const o = others.get(f.id);
    if (!o) { addOther(f); continue; }
    o.target = { ...f.pos, ry: f.ry };
    o.data.anim = f.dead ? 'death' : f.anim;
    o.data.dead = f.dead;
    o.data.crouch = f.crouch;
    o.data.pitch = f.pitch;
    if (f.weapon && o.heldId !== f.weapon) { setHeld(o, f.weapon); mountHeldToHand(o); }
    o.held.visible = !f.dead;
    if (o.plate.hp !== f.hp) { o.plate.hp = f.hp; drawPlate(o.plate); }
  }
});

net.on('hp', (msg) => {
  if (msg.id === net.id) { me.hp = msg.hp; updateHpHud(); }
  else { const o = others.get(msg.id); if (o) { o.plate.hp = msg.hp; drawPlate(o.plate); } }
});
net.on('dmg', (msg) => { // I dealt damage
  showHitmarker(msg.head);
  dmgNumber(msg.amount, msg.head, msg.x, msg.y, msg.z);
  (msg.head ? sfx.headshot : sfx.hit)();
});
net.on('hurt', (msg) => { // I took damage — directional arc
  sfx.hurt();
  const ang = Math.atan2(msg.fx - me.pos.x, msg.fz - me.pos.z); // world dir to attacker
  const rel = ang - me.ry + Math.PI;
  const arc = $('#dmg-arc');
  arc.style.transform = `translate(-50%,-50%) rotate(${rel}rad)`;
  arc.classList.remove('show'); void arc.offsetWidth; arc.classList.add('show');
});
net.on('launch', (msg) => { // your own grenade rocket-jumps you
  me.vel.x += msg.vx; me.vel.z += msg.vz; me.vel.y = Math.max(me.vel.y, msg.vy);
  me.grounded = false; me.sliding = false;
  sfx.dash();
});
net.on('elim', (msg) => {
  const killer = msg.killer === net.id ? { name: identity.name } : game.roster.find((r) => r.id === msg.killer);
  const victim = msg.victim === net.id ? { name: identity.name } : game.roster.find((r) => r.id === msg.victim);
  killfeed(killer?.name || '—', victim?.name || '—', msg.weapon,
    msg.killer === net.id ? 'killer' : msg.victim === net.id ? 'victim' : null);
  // grey out chip avatar
  document.querySelectorAll(`.tc-avatars canvas[data-fid="${msg.victim}"]`).forEach((c) => c.classList.add('dead'));
  if (msg.victim === net.id) { me.dead = true; sfx.death(); banner('💀 ELIMINATED', 1500); }
  else if (msg.killer === net.id) {
    sfx.elim();
    if (!game.gotFirstElim) { game.gotFirstElim = true; window.ClaudeBox?.completeChallenge('rivals-elim'); }
    const o = others.get(msg.victim);
    if (o) o.data.dead = true;
  }
});
net.on('shot', (msg) => { // someone else fired — tracer from their eye
  if (msg.id === net.id) return;
  const o = others.get(msg.id);
  if (!o) return;
  if (msg.weapon === 'ar' || msg.weapon === 'handgun' || msg.weapon === 'sniper') playOne(msg.weapon, msg.weapon === 'sniper' ? 0.5 : 0.22);
  o.data.actionUntil = clockNow() + (msg.weapon === 'scythe' ? 0.7 : 0.3);
  o.data.actionAnim = msg.weapon === 'scythe' ? 'knifestab' : 'riflefire';
  if (msg.weapon === 'scythe') return;
  const eye = new THREE.Vector3(o.ctrl.group.position.x, o.ctrl.group.position.y + 1.55, o.ctrl.group.position.z);
  const d = o.data;
  const dir = new THREE.Vector3(-Math.sin(d.ry ?? 0) * Math.cos(d.pitch ?? 0), Math.sin(d.pitch ?? 0), -Math.cos(d.ry ?? 0) * Math.cos(d.pitch ?? 0));
  spawnTracer(eye, eye.clone().add(dir.multiplyScalar(msg.dist || 30)), '#ffd0d0');
});
net.on('dash', (msg) => { if (msg.id !== net.id) sfx.dash(); });

// grenades
const nades = new Map();
net.on('nade.spawn', (msg) => {
  const g = msg.g;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), new THREE.MeshLambertMaterial({ color: '#3f7d3f' }));
  mesh.position.set(g.x, g.y, g.z);
  scene.add(mesh);
  nades.set(g.id, { mesh, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz });
});
net.on('nade.boom', (msg) => {
  const n = nades.get(msg.id);
  if (n) { scene.remove(n.mesh); nades.delete(msg.id); }
  boomFx(msg.x, msg.y, msg.z);
});
function boomFx(x, y, z) {
  sfx.boom();
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 14), new THREE.MeshBasicMaterial({ color: '#ffcf5c', transparent: true, opacity: 0.95 }));
  s.position.set(x, y, z);
  scene.add(s);
  const born = clockNow();
  booms.push({ s, born });
  const d = Math.hypot(me.pos.x - x, me.pos.z - z);
  if (d < 12) shake = Math.min(1, 1.6 - d / 10);
}
const booms = [];
let shake = 0;

net.on('fighter.leave', (msg) => { removeOther(msg.id); toast('Opponent left the match'); });
net.on('_disconnect', () => { toast('Disconnected — refresh to rejoin'); });

// ============================ lobby / phases ============================
function enterLobby(fromMatch) {
  game.phase = 'lobby';
  game.mapId = 'lobby'; game.builtMap = 'lobby';
  buildMap(LOBBY);
  clearOthers();
  me.pos = { x: LOBBY.spawnsA[0].x, y: 0, z: LOBBY.spawnsA[0].z };
  me.ry = LOBBY.spawnsA[0].ry; me.pitch = 0;
  me.hp = 100; me.dead = false; me.weapon = 'ar';
  me.ammo = { ar: { mag: 20, res: 100 }, handgun: { mag: 15, res: 90 }, sniper: { mag: 5, res: 25 } };
  me.grenades = WEAPONS.grenade.count;
  $('#match-top').classList.add('hidden');
  $('#freeze-count').classList.add('hidden');
  $('#health-wrap').classList.add('hidden');
  $('#ammo-wrap').classList.remove('hidden');  // range shooting still shows ammo
  $('#lobby-tip').classList.remove('hidden');
  $('#kb-open')?.classList.remove('hidden');
  $('#podium').classList.add('hidden');
  updateAmmoHud(); updateLoadoutHud();
}

// ---------------- keybinds settings UI ----------------
const KB_ACTIONS = [
  ['forward', 'Move Forward'], ['back', 'Move Back'], ['left', 'Move Left'], ['right', 'Move Right'],
  ['jump', 'Jump'], ['sprint', 'Sprint'], ['crouch', 'Crouch / Slide'], ['reload', 'Reload'], ['queue', 'Open Queue'],
  ['weapon1', 'Slot 1 · Rifle'], ['weapon2', 'Slot 2 · Handgun'], ['weapon3', 'Slot 3 · Knife'],
  ['weapon4', 'Slot 4 · Grenade'], ['weapon5', 'Slot 5 · Sniper'], ['weapon6', 'Slot 6 · Fists'],
];
function keyLabel(code) {
  if (!code) return '—';
  const m = { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'L-Cmd', MetaRight: 'R-Cmd', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Escape: 'Esc', CapsLock: 'Caps', Minus: '-', Equal: '=', Backslash: '\\' };
  if (m[code]) return m[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
function renderKeybinds() {
  const host = $('#kb-list'); if (!host) return;
  host.innerHTML = '';
  // ---- options ----
  const optRow = document.createElement('div'); optRow.className = 'kb-row';
  const optName = document.createElement('span'); optName.className = 'kb-label'; optName.textContent = 'Toggle Sprint';
  const sw = document.createElement('button');
  sw.className = 'kb-switch' + (sprintToggle ? ' on' : ''); sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(sprintToggle)); sw.innerHTML = '<i></i>';
  sw.addEventListener('click', () => {
    sprintToggle = !sprintToggle; sprintOn = false;
    try { localStorage.setItem('rivals.sprintToggle', sprintToggle ? '1' : '0'); } catch {}
    sfx.click?.(); renderKeybinds();
  });
  optRow.append(optName, sw); host.appendChild(optRow);
  // ---- key rebinds ----
  for (const [id, label] of KB_ACTIONS) {
    const row = document.createElement('div'); row.className = 'kb-row';
    const name = document.createElement('span'); name.className = 'kb-label'; name.textContent = label;
    const btn = document.createElement('button');
    btn.className = 'kb-key' + (rebinding === id ? ' listening' : '');
    btn.textContent = rebinding === id ? 'Press a key…' : keyLabel(binds[id]);
    btn.addEventListener('click', () => startRebind(id));
    row.append(name, btn); host.appendChild(row);
  }
}
function startRebind(id) { rebinding = id; sfx.click?.(); renderKeybinds(); }
function captureRebind(code) {
  if (code === 'Escape') { rebinding = null; renderKeybinds(); return; }
  const prev = binds[rebinding];
  // SWAP with whatever else held this key, so no action is ever left unbound
  for (const k in binds) if (binds[k] === code && k !== rebinding) binds[k] = prev;
  binds[rebinding] = code; rebinding = null; saveBinds(); sfx.click?.(); renderKeybinds();
}
function openKeybinds() { renderKeybinds(); $('#keybinds').classList.remove('hidden'); document.exitPointerLock?.(); sfx.click?.(); }
function closeKeybinds() { rebinding = null; $('#keybinds').classList.add('hidden'); }
$('#kb-open')?.addEventListener('click', openKeybinds);
$('#kb-close')?.addEventListener('click', closeKeybinds);
$('#kb-reset')?.addEventListener('click', () => { binds = { ...DEFAULT_BINDS }; saveBinds(); renderKeybinds(); sfx.click?.(); });
$('#keybinds')?.addEventListener('click', (e) => { if (e.target.id === 'keybinds') closeKeybinds(); });

// ---------------- text chat ----------------
let chatting = false;
function openChat() {
  if (chatting) return;
  chatting = true; keys.clear();
  document.exitPointerLock?.();
  const inp = $('#chat-input'); inp.classList.remove('hidden'); inp.value = ''; inp.focus();
  $('#chat').classList.add('typing');
}
function closeChat() {
  chatting = false;
  const inp = $('#chat-input'); inp.classList.add('hidden'); inp.blur();
  $('#chat').classList.remove('typing');
}
function sendChat() {
  const inp = $('#chat-input'); const text = inp.value.trim();
  if (text) net.send({ t: 'chat', text });
  closeChat();
}
function addChatLine(name, text, team, self) {
  const log = $('#chat-log');
  const line = document.createElement('div');
  line.className = 'chat-line fresh';
  const nm = document.createElement('b');
  nm.className = 'chat-name' + (team === 'B' ? ' enemy' : team === 'A' ? ' ally' : '') + (self ? ' me' : '');
  nm.textContent = name + ': ';
  const tx = document.createElement('span'); tx.textContent = text;   // textContent = safe, no HTML injection
  line.append(nm, tx); log.appendChild(line);
  while (log.children.length > 40) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
  setTimeout(() => line.classList.remove('fresh'), 60);
}
$('#chat-input')?.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.code === 'Enter') { e.preventDefault(); sendChat(); }
  else if (e.code === 'Escape') { e.preventDefault(); closeChat(); }
});
$('#m-chat')?.addEventListener('touchstart', (e) => { e.preventDefault(); openChat(); }, { passive: false });
net.on('chat', (msg) => { addChatLine(msg.name, msg.text, msg.team, msg.id === net.id); });

function banner(text, ms) {
  const el = $('#round-banner');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(banner._t);
  banner._t = setTimeout(() => el.classList.add('hidden'), ms);
}

// ============================ main loop ============================
let last = performance.now() / 1000;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  if (mobileOn) updateMobileHud();
  const cn = clockNow();

  stepMe(dt);

  // auto fire
  if (mouseDown && WEAPONS[me.weapon]?.auto) tryFire();
  // ---- real audio: AR fire loop (only while shooting) + footsteps ----
  const firingAR = mouseDown && me.weapon === 'ar' && !me.reloading && !me.dead && me.ammo.ar.mag > 0 && (game.phase === 'live' || game.phase === 'lobby');
  if (firingAR) playLoop('ar', 0.6); else stopLoop('ar');
  const flatSpeed = Math.hypot(me.vel.x, me.vel.z);
  if (me.grounded && !me.dead && flatSpeed > 1.8) playLoop('foot', 0.4, isSprinting() ? 1.75 : 1.05);
  else stopLoop('foot');
  // reload finish
  if (me.reloading && cn >= me.reloading) finishReload();
  // flash + tracers + booms
  if (flashUntil && cn > flashUntil) { flashLight.intensity = 0; flashUntil = 0; }
  for (let i = tracers.length - 1; i >= 0; i--) {
    if (cn > tracers[i].until) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1); }
  }
  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i], age = cn - b.born;
    if (age > 0.4) { scene.remove(b.s); booms.splice(i, 1); continue; }
    b.s.scale.setScalar(1 + age * 16);
    b.s.material.opacity = 0.95 * (1 - age / 0.4);
  }
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.14;
    camera.position.y += (Math.random() - 0.5) * shake * 0.14;
    shake *= Math.pow(0.001, dt);
  }
  // grenade local sim
  for (const n of nades.values()) {
    n.vy -= MOVE.gravity * 0.8 * dt;
    n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
    if (n.y < 0.15) { n.y = 0.15; n.vy *= -0.42; n.vx *= 0.8; n.vz *= 0.8; }
    n.mesh.position.set(n.x, n.y, n.z);
  }
  // range targets respawn
  for (const t of rangeTargets) {
    if (!t.alive && cn >= t.respawnAt) { t.alive = true; t.grp.rotation.x = 0; }
  }
  // ================= viewmodel: the swingy stuff =================
  for (const [k, g] of Object.entries(viewmodels)) g.visible = k === me.weapon;
  const speed2d = Math.hypot(me.vel.x, me.vel.z);
  const moving = speed2d > 0.5 && me.grounded;
  const sprinting2 = moving && speed2d > MOVE.walk * 1.1 && !me.sliding;
  vmBob += dt * (moving ? (sprinting2 ? 11.5 : 8.5) : 2);
  vmKick = Math.max(0, vmKick - dt * 8);

  // springs: look-lag sway (weapon trails your mouse), strafe roll, poses
  {
    let dRy = me.ry - vmAnim.lastRy, dPitch = me.pitch - vmAnim.lastPitch;
    while (dRy > Math.PI) dRy -= Math.PI * 2; while (dRy < -Math.PI) dRy += Math.PI * 2;
    vmAnim.lastRy = me.ry; vmAnim.lastPitch = me.pitch;
    const k = 1 - Math.exp(-11 * dt);
    vmAnim.swayYaw += (clamp(dRy * 2.4, -0.14, 0.14) - vmAnim.swayYaw) * k;
    vmAnim.swayPitch += (clamp(dPitch * 2.2, -0.12, 0.12) - vmAnim.swayPitch) * k;
    const rightVel = (me.vel.x * Math.cos(me.ry) - me.vel.z * Math.sin(me.ry)) / MOVE.sprint;
    vmAnim.roll += (clamp(-rightVel * 0.1, -0.09, 0.09) - vmAnim.roll) * k;
    vmAnim.sprintK += ((sprinting2 && me.ads < 0.3 ? 1 : 0) - vmAnim.sprintK) * (1 - Math.exp(-8 * dt));
    vmAnim.slideK += ((me.sliding ? 1 : 0) - vmAnim.slideK) * (1 - Math.exp(-10 * dt));
    vmAnim.airK += ((me.grounded ? 0 : 1) - vmAnim.airK) * (1 - Math.exp(-6 * dt));
    vmAnim.landK *= Math.exp(-6.5 * dt);
    vmAnim.equipT = Math.min(1, vmAnim.equipT + dt / 0.3);
    vmAnim.swingT = Math.min(1, vmAnim.swingT + dt / 0.38);
    vmAnim.throwT = Math.min(1, vmAnim.throwT + dt / 0.5);
  }

  // sniper scope: overlay + hide the rifle while fully scoped
  const scoped = me.weapon === 'sniper' && me.ads > 0.78;
  $('#scope').classList.toggle('hidden', !scoped);
  $('#crosshair').classList.toggle('hidden', scoped);

  const vm = viewmodels[me.weapon];
  if (vm) {
    vm.visible = !scoped;
    const k = me.ads;
    const loose = 1 - k * 0.85;                 // ADS tightens everything
    const bobAmt = (moving ? (sprinting2 ? 1.5 : 1) : 0) * loose;
    // figure-8 bob + idle breathing
    const bobX = Math.sin(vmBob) * 0.013 * bobAmt;
    const bobY = -Math.abs(Math.cos(vmBob)) * 0.016 * bobAmt + Math.sin(now * 1.6) * 0.0038 * loose;

    const HIP = VM_HIPS[me.weapon] || VM_HIP;
    let px = HIP.x + (VM_ADS.x - HIP.x) * k + bobX + vmAnim.swayYaw * 0.16 * loose;
    let py = HIP.y + (VM_ADS.y - HIP.y) * k + bobY + vmAnim.swayPitch * 0.14 * loose
           + vmKick * 0.02 - vmAnim.landK * 0.11 + vmAnim.airK * 0.024 * loose;
    let pz = HIP.z + (VM_ADS.z - HIP.z) * k + vmKick * 0.07;
    let rx = vmKick * 0.12 + vmAnim.swayPitch * 1.5 * loose + vmAnim.landK * 0.24 - vmAnim.airK * 0.07 * loose;
    let ry2 = vmAnim.swayYaw * 1.7 * loose;
    let rz = vmAnim.roll * 1.5 * loose + vmAnim.swayYaw * 0.7 * loose - vmAnim.slideK * 0.38;

    // sprint: cant the weapon in and down (with a bit of run sway)
    rx += vmAnim.sprintK * (0.14 + Math.sin(vmBob * 0.5) * 0.03);
    ry2 += vmAnim.sprintK * 0.34;
    py -= vmAnim.sprintK * 0.03;
    px -= vmAnim.sprintK * 0.03;
    // slide: shove it across your chest
    px -= vmAnim.slideK * 0.06; py -= vmAnim.slideK * 0.02;

    // equip: swing up from the hip with a twirl, then settle with a bounce
    if (vmAnim.equipT < 1) {
      const t = vmAnim.equipT;
      const rise = easeOutBack(sstep(0, 0.72, t));
      const settle = Math.sin(sstep(0.6, 1, t) * Math.PI) * 0.06;
      py -= (1 - rise) * 0.34 - settle * 0.4;
      px += (1 - rise) * 0.16;
      rx -= (1 - rise) * 1.05;
      ry2 -= (1 - rise) * 0.55;
      rz += (1 - rise) * 0.6 - settle;
    }
    // knife slash: quick compact arcs, alternating sides
    if (me.weapon === 'scythe' && vmAnim.swingT < 1) {
      const s = Math.sin(Math.pow(vmAnim.swingT, 0.7) * Math.PI);
      rz += vmAnim.swingSide * -0.7 * s;
      ry2 += vmAnim.swingSide * 0.55 * s;
      rx += 0.2 * s;
      px += vmAnim.swingSide * -0.1 * s;
      pz -= 0.2 * s;                       // stab forward
    }
    // grenade throw: wind back, then whip forward overhand
    if (me.weapon === 'grenade' && vmAnim.throwT < 1) {
      const t = vmAnim.throwT;
      const wind = sstep(0, 0.3, t) * (1 - sstep(0.3, 0.55, t));
      const whip = sstep(0.3, 0.55, t) * (1 - sstep(0.75, 1, t));
      rx += wind * 0.85 - whip * 1.9;
      py += wind * 0.1 - whip * 0.06;
      pz += wind * 0.16 - whip * 0.3;
    }

    vm.position.set(px, py, pz);
    vm.rotation.set(rx, ry2, rz);

    // ---- hand/part sub-animation (reset to base, then offset) ----
    const P = vm.userData;
    if (P?.base) {
      P.gun.position.copy(P.base.gun.p); P.gun.rotation.copy(P.base.gun.r);
      P.rArm.position.copy(P.base.rArm.p); P.rArm.rotation.copy(P.base.rArm.r);
      P.lArm.position.copy(P.base.lArm.p); P.lArm.rotation.copy(P.base.lArm.r);
      // firing: hands squeeze back with the gun
      P.gun.position.z += vmKick * 0.05;
      P.rArm.position.z += vmKick * 0.05;
      P.lArm.position.z += vmKick * 0.03;
      // equip: the left hand slaps on a beat late, then racks guns
      if (vmAnim.equipT < 1) {
        const t = vmAnim.equipT;
        const late = 1 - sstep(0.35, 0.7, t);          // left hand catches up late
        P.lArm.position.y -= late * 0.18;
        P.lArm.position.x -= late * 0.1;
        P.lArm.rotation.x -= late * 0.6;
        const isGun = me.weapon === 'ar' || me.weapon === 'handgun' || me.weapon === 'sniper';
        if (isGun) {                                   // rack the action
          const rack = Math.sin(sstep(0.62, 0.95, t) * Math.PI);
          P.lArm.position.z += rack * 0.11;
          P.gun.rotation.z -= rack * 0.12;
        }
      }
      // fists: straight alternating jabs
      if (me.weapon === 'fists' && vmAnim.swingT < 1) {
        const t2 = vmAnim.swingT;
        const jab = Math.sin(Math.pow(t2, 0.7) * Math.PI);
        const hand = vmAnim.swingSide > 0 ? P.rArm : P.lArm;
        const off = vmAnim.swingSide > 0 ? P.lArm : P.rArm;
        hand.position.z -= jab * 0.34;
        hand.position.y += jab * 0.06;
        hand.rotation.x -= jab * 0.5;
        off.position.z += jab * 0.06;
      }
      // reload: left hand rips the mag out (kept in frame), gun tips over
      if (me.reloading) {
        const rT = clamp((cn - vmAnim.reloadStart) / (vmAnim.reloadDur || 1), 0, 1);
        const out = sstep(0, 0.28, rT) * (1 - sstep(0.62, 0.92, rT));
        P.lArm.position.y -= out * 0.18;
        P.lArm.position.z += out * 0.16;               // pulls toward the camera, stays visible
        P.lArm.position.x += out * 0.04;
        P.lArm.rotation.x -= out * 1.0;
        P.gun.rotation.z += Math.sin(rT * Math.PI) * 0.45;
        P.gun.rotation.x += Math.sin(rT * Math.PI) * 0.12;
      }
      // grenade throw: the right hand does the throwing
      if (me.weapon === 'grenade' && vmAnim.throwT < 1) {
        const t = vmAnim.throwT;
        const whip = sstep(0.3, 0.55, t) * (1 - sstep(0.8, 1, t));
        P.rArm.position.z -= whip * 0.28;
        P.rArm.rotation.x -= whip * 1.2;
        P.gun.visible = t < 0.42 || t > 0.85;   // nade leaves the hand mid-throw
      } else if (P.gun) P.gun.visible = true;
    }
  }
  // interpolate others
  for (const o of others.values()) {
    const gp = o.ctrl.group.position;
    gp.x += (o.target.x - gp.x) * Math.min(1, dt * 12);
    gp.y += (o.target.y - gp.y) * Math.min(1, dt * 12);
    gp.z += (o.target.z - gp.z) * Math.min(1, dt * 12);
    let dry = (o.target.ry + Math.PI) - o.ctrl.group.rotation.y;   // model forward is opposite our camera-yaw convention
    while (dry > Math.PI) dry -= Math.PI * 2;
    while (dry < -Math.PI) dry += Math.PI * 2;
    o.ctrl.group.rotation.y += dry * Math.min(1, dt * 10);
    o.ctrl.setAnim(displayAnim(o));
    o.ctrl.update(dt);
  }
  // timers
  if (game.phase === 'freeze') {
    const left = Math.max(0, game.stateUntil - cn);
    $('#freeze-count').textContent = Math.ceil(left);
  } else if (game.phase === 'live') {
    const left = Math.max(0, game.stateUntil - cn);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    hud.clock.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    hud.clock.classList.toggle('urgent', left < 15);
  } else if (game.phase === 'vote') {
    const left = Math.max(0, game.stateUntil - cn);
    $('#vote-timer').textContent = Math.ceil(left) + 's';
  }
  // queue banner timer
  if (game.queued) {
    const el = Math.floor(cn - game.queuedSince);
    $('#qb-time').textContent = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`;
  }
  $('#crosshair').classList.toggle('ads', me.ads > 0.5);

  renderer.render(scene, camera);
}

// ============================ go ============================
status('Connecting…');
buildMap(LOBBY);
setupMobile(); updateMobileHud();
updateAmmoHud(); updateLoadoutHud(); updateHpHud();
await loadMySkins(); applyMyViewmodelSkins(); buildSkinsUI();
net.connect();
net.join({ name: identity.name, avatar: identity.avatar, code: localStorage.getItem('claudebox.code') || '', skins: mySkins.equipped });
net.startMovementStream(() => ({
  t: 'move',
  x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2),
  ry: +me.ry.toFixed(3), pitch: +me.pitch.toFixed(3),
  anim: me.dead ? 'death' : me.sliding ? 'run' : Math.hypot(me.vel.x, me.vel.z) > 0.5 ? (isSprinting() ? 'run' : 'walk') : 'idle',
  crouch: me.crouch || me.sliding,
}));
$('#loading').classList.add('hidden');
$('#hud').classList.remove('hidden');
$('#lobby-tip').classList.remove('hidden');
window.ClaudeBox?.setName?.(identity.name);
frame();
