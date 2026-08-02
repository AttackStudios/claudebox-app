// Junior Guards Simulator 🏖️ — Capitola Junior Guards beach RP.
// Original ClaudeBox game: server browser → lobby → the beach.
import * as THREE from 'three';
import { makeR6, preloadR6, R6_DEFAULT } from '/shared/r6.js';
import { STRETCHES, STRETCH_BY_ID, WEATHER } from '/shared/juniorguards/config.js';
import { loadIdentity } from '/backpacking/js/player/avatar.js';

const $ = (q) => document.querySelector(q);
const identity = await loadIdentity();
$('#title-name').textContent = identity.name;

// ============================ net ============================
const net = {
  ws: null, id: null, handlers: {},
  on(t, fn) { this.handlers[t] = fn; },
  send(m) { try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); } catch {} },
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/jg-ws`);
    this.ws.onopen = () => this.send({ t: 'join', name: identity.name, avatar: identity.avatar });
    this.ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      this.handlers[m.t]?.(m);
    };
    this.ws.onclose = () => setTimeout(() => this.connect(), 2500);
  },
};

function toast(t, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = t;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ============================ three ============================
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight('#dfeaf2', '#8a7f66', 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff2dc', 0.35); sun.position.set(60, 90, -40); scene.add(sun);
const ambient = new THREE.AmbientLight('#cfd8e0', 0.55); scene.add(ambient);

const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
function box(w, h, d, c, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(c));
  m.position.set(x, y, z); m.rotation.y = ry; return m;
}

// speckled sand texture (drawn, not flat)
function sandTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#e6cf9a'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const s = Math.random();
    x.fillStyle = s < 0.5 ? 'rgba(160,130,80,.35)' : s < 0.8 ? 'rgba(255,244,210,.5)' : 'rgba(120,96,60,.3)';
    x.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 6);
  return t;
}
function textPanel(text, color = '#ffffff') {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, 512, 128);
  x.font = '900 64px Trebuchet MS'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#1c2c3c'; x.fillText(text, 258, 68);
  x.fillStyle = color; x.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
  return m;
}
function makeFlag(color = '#e33d3d', pole = '#8a6844', h = 4) {
  const g = new THREE.Group();
  g.add(box(0.14, h, 0.14, pole, 0, h / 2, 0));
  const fabric = box(1.6, 0.9, 0.05, color, 0.9, h - 0.55, 0);
  g.add(fabric);
  g.userData.fabric = fabric;
  return g;
}
function makeTower() {
  const g = new THREE.Group();
  for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) g.add(box(0.22, 3, 0.22, '#b98c58', x, 1.5, z));
  g.add(box(3, 0.25, 3, '#d9b06c', 0, 3.1, 0));
  g.add(box(3.2, 1.4, 0.16, '#e8e2d2', 0, 3.9, -1.5));
  g.add(box(3.2, 1.4, 0.16, '#e8e2d2', 0, 3.9, 1.5));
  g.add(box(0.16, 1.4, 3.2, '#e8e2d2', -1.6, 3.9, 0));
  g.add(box(3.7, 0.22, 3.7, '#c8543c', 0, 4.75, 0));   // roof = rain shelter
  return g;
}

// ============================ worlds ============================
const lobbyG = new THREE.Group(); scene.add(lobbyG);
const beachG = new THREE.Group(); scene.add(beachG); beachG.visible = false;
let waters = [];      // AABBs {x,y,z,w,h,d}
let shelters = [];    // AABBs whose footprint blocks rain
let beachSpawn = { x: 0, y: 2, z: -14 };
let groundFn = () => 0;

// lobby: a sunny little staging plaza, separate from the beach
{
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 1, 40), lam('#7fbf6a'));
  ground.position.y = -0.5; lobbyG.add(ground);
  lobbyG.add(box(10, 0.2, 6, '#d9cba8', 0, 0.02, -6));
  const sign = textPanel('JUNIOR GUARDS', '#ffe9b0'); sign.position.set(0, 3.4, -10); lobbyG.add(sign);
  lobbyG.add(box(0.3, 3.2, 0.3, '#8a6844', -2.6, 1.6, -10));
  lobbyG.add(box(0.3, 3.2, 0.3, '#8a6844', 2.6, 1.6, -10));
  for (let i = 0; i < 4; i++) lobbyG.add(box(3, 0.3, 0.9, '#c8a06a', -6 + i * 4, 0.55, 4));
  const f = makeFlag('#e33d3d'); f.position.set(-7, 0, -8); lobbyG.add(f);
  const f2 = makeFlag('#f2c20c'); f2.position.set(7, 0, -8); lobbyG.add(f2);
}

// the built-in Capitola beach (used unless a Studio level replaces it)
function sampleBeachHeight(x, z) {
  // esplanade sits high at the back (z<-20), sand slopes down to the ocean at z>26
  let y = 0;
  y += Math.sin(x * 0.11) * 0.35 + Math.cos(z * 0.13 + 1.7) * 0.3;         // dunes
  y += Math.sin(x * 0.031 + 2.2) * 0.6;
  if (z > 8) y -= (z - 8) * 0.16;                                           // slope into the surf
  if (z < -18) y += Math.min(1.6, (-18 - z) * 0.25);                        // back beach rise
  return y;
}
function buildDefaultBeach() {
  // sand: displaced plane with a real texture + heightmap
  const geo = new THREE.PlaneGeometry(240, 150, 90, 60);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, sampleBeachHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const sand = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: sandTexture(), color: '#f0dcae' }));
  sand.position.z = -8; beachG.add(sand);
  groundFn = (x, z) => sampleBeachHeight(x, z + 8);

  // the Pacific: a swimmable water volume
  const oceanBox = { x: 0, y: -2.4, z: 68, w: 240, h: 5, d: 90 };
  const ocean = new THREE.Mesh(new THREE.BoxGeometry(oceanBox.w, oceanBox.h, oceanBox.d),
    new THREE.MeshLambertMaterial({ color: '#2e8ec8', transparent: true, opacity: 0.82 }));
  ocean.position.set(oceanBox.x, oceanBox.y, oceanBox.z); beachG.add(ocean);
  const foam = box(240, 0.12, 3, '#eef6f8', 0, 0.02, 24); beachG.add(foam);
  waters = [{ ...oceanBox, y: oceanBox.y + oceanBox.h / 2 }];

  // Esplanade: the famous colourful beach houses along the back
  const colors = ['#e8797c', '#f2c744', '#7fc9e8', '#8fd08a', '#c99ae8', '#f2a35c'];
  colors.forEach((c, i) => {
    const x = -37 + i * 15;
    const house = box(12, 7, 9, c, x, 5.2, -47);
    beachG.add(house);
    beachG.add(box(13, 1, 10, '#f2ede2', x, 9.2, -47));
    beachG.add(box(12.6, 0.3, 3.4, '#fff', x, 6.8, -41.4));    // awning = shelter
    shelters.push({ x, y: 6.8, z: -41.4, w: 12.6, h: 0.3, d: 3.4 }, { x, y: 9.2, z: -47, w: 13, h: 1, d: 10 });
  });
  const sign = textPanel('CAPITOLA BEACH', '#ffe9b0'); sign.position.set(0, 8.5, -40); sign.rotation.y = 0; beachG.add(sign);

  // wharf on the west side
  for (let i = 0; i < 9; i++) {
    beachG.add(box(6, 0.5, 8, '#b98c58', -66, 1.6, -6 + i * 8));
    beachG.add(box(0.5, 4, 0.5, '#8a6844', -68.5, -0.2, -3 + i * 8));
    beachG.add(box(0.5, 4, 0.5, '#8a6844', -63.5, -0.2, -3 + i * 8));
  }

  // lifeguard tower + JG flags
  const tower = makeTower(); tower.position.set(14, groundFn(14, 2), 2); beachG.add(tower);
  shelters.push({ x: 14, y: 4.75 + groundFn(14, 2), z: 2, w: 3.7, h: 0.22, d: 3.7 });
  const f1 = makeFlag('#e33d3d'); f1.position.set(10, groundFn(10, 6), 6); beachG.add(f1);
  const f2 = makeFlag('#35b24a'); f2.position.set(18, groundFn(18, 6), 6); beachG.add(f2);
  beachSpawn = { x: 0, y: groundFn(0, -14) + 1.5, z: -14 };
}
function buildStudioWorld(w, G) {
  for (const o of w.solids) { G.add(box(o.w, o.h, o.d, o.color, o.x, o.y, o.z, o.rotY)); }
  for (const o of w.waters) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshLambertMaterial({ color: o.color, transparent: true, opacity: 0.8 }));
    m.position.set(o.x, o.y, o.z); G.add(m);
  }
  waters = w.waters.map((o) => ({ x: o.x, y: o.y + o.h / 2, z: o.z, w: o.w, h: o.h, d: o.d }));
  for (const o of w.sands) {
    const geo = new THREE.PlaneGeometry(o.w, o.d, 32, 32); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.sin(pos.getX(i) * 0.4) * 0.25 + Math.cos(pos.getZ(i) * 0.5) * 0.2);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: sandTexture(), color: o.color }));
    m.position.set(o.x, o.y + o.h / 2, o.z); G.add(m);
  }
  for (const o of w.flags) { const f = makeFlag(o.color, o.color2, Math.max(2, o.h)); f.position.set(o.x, o.y - o.h / 2, o.z); G.add(f); }
  for (const o of w.texts) { const t = textPanel(o.text || '·', o.color); t.position.set(o.x, o.y, o.z); t.rotation.y = o.rotY; G.add(t); }
  shelters = w.shelters.concat(w.solids.filter((s) => s.h > 0.5 && s.y > 2.5));
  return { spawn: { ...w.spawn }, sands: w.sands };
}
let studioBeach = null, studioLobby = null, lobbySpawn = null;

// ============================ players ============================
const others = new Map();
let myCtrl = null;
const me = {
  pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ry: 0, grounded: true,
  wet: false, wetSunStart: 0, sitting: false, swimming: false,
  equip: { wetsuit: false, hat: false },
  pack: { carried: true, items: [] },
  stretch: null,
  room: null, isHost: false, started: false, zone: 'lobby',
};

function makeGuard(avatar) {
  const ctrl = makeR6(avatar?.r6 || R6_DEFAULT);
  scene.add(ctrl.group);
  // hat + backpack props
  const hat = new THREE.Group();
  hat.add(box(0.42, 0.16, 0.42, '#d8442e', 0, 1.72, 0));
  hat.add(box(0.5, 0.05, 0.62, '#d8442e', 0, 1.66, 0.08));
  hat.visible = false; ctrl.group.add(hat);
  const pack = box(0.5, 0.62, 0.26, '#7a5c34', 0, 1.05, 0.34);
  ctrl.group.add(pack);
  return { ctrl, hat, pack, drips: [], dripAt: 0, baseColors: avatar?.r6 || R6_DEFAULT };
}

function setWetLook(rec, wet) { /* drips are handled per-frame; flag lives on data */ }
function setEquipLook(rec, equip) {
  rec.hat.visible = !!equip.hat;
  const prof = rec.baseColors;
  if (equip.wetsuit) rec.ctrl.setColors?.({ ...prof, torso: '#16202c', armL: '#1b2a3a', armR: '#1b2a3a', legL: '#16202c', legR: '#16202c' });
  else rec.ctrl.setColors?.(prof);
}

// water drips while wet
function tickDrips(rec, pos, wet, dt, now) {
  if (wet && now - rec.dripAt > 0.16) {
    rec.dripAt = now;
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshBasicMaterial({ color: '#9fd2f2', transparent: true, opacity: 0.85 }));
    d.position.set(pos.x + (Math.random() - 0.5) * 0.5, pos.y + 0.6 + Math.random() * 0.9, pos.z + (Math.random() - 0.5) * 0.4);
    scene.add(d); rec.drips.push({ m: d, vy: 0 });
  }
  for (let i = rec.drips.length - 1; i >= 0; i--) {
    const dr = rec.drips[i];
    dr.vy -= 9 * dt; dr.m.position.y += dr.vy * dt; dr.m.material.opacity -= dt * 1.4;
    if (dr.m.material.opacity <= 0) { scene.remove(dr.m); rec.drips.splice(i, 1); }
  }
}

// ============================ stretches ============================
// poses for the r6 setPose API — rootRx tips the whole body (lying down etc.)
const P0 = { armL: { x: 0, z: 0.05 }, armR: { x: 0, z: 0.05 }, legL: { x: 0 }, legR: { x: 0 }, torso: { x: 0 }, rootRx: 0, rootY: 0 };
const pose = (o) => ({ ...P0, ...o });
const STRETCH_POSES = {
  jacks: { a: pose({ armL: { x: 0, z: 0.1 }, armR: { x: 0, z: 0.1 } }), b: pose({ armL: { x: 0, z: 3.0 }, armR: { x: 0, z: 3.0 }, rootY: 0.18 }) },
  rlegfwd: { a: pose({ legR: { x: 0.75 }, legL: { x: -0.45 }, torso: { x: 0.3 }, armL: { x: -0.5, z: 0.1 }, armR: { x: -0.5, z: 0.1 } }) },
  llegfwd: { a: pose({ legL: { x: 0.75 }, legR: { x: -0.45 }, torso: { x: 0.3 }, armL: { x: -0.5, z: 0.1 }, armR: { x: -0.5, z: 0.1 } }) },
  seagull: { a: pose({ rootRx: 0.85, rootY: -0.5, armL: { x: -2.6, z: 0.15 }, armR: { x: -2.6, z: 0.15 }, torso: { x: 0.4 } }) },
  rlegout: { a: pose({ rootY: -0.72, legR: { x: 1.5 }, legL: { x: 0.6 }, torso: { x: 0.45 }, armL: { x: -1.1, z: 0.1 }, armR: { x: -1.1, z: 0.1 } }) },
  llegout: { a: pose({ rootY: -0.72, legL: { x: 1.5 }, legR: { x: 0.6 }, torso: { x: 0.45 }, armL: { x: -1.1, z: 0.1 }, armR: { x: -1.1, z: 0.1 } }) },
  butterfly: { a: pose({ rootY: -0.72, legL: { x: 1.15 }, legR: { x: 1.15 }, torso: { x: 0.2 }, armL: { x: -0.85, z: 0.1 }, armR: { x: -0.85, z: 0.1 } }) },
  corpser: { a: pose({ rootRx: -1.5, rootY: -0.62, legR: { x: 1.7 }, armL: { x: -1.4, z: 0.1 }, armR: { x: -1.4, z: 0.1 } }) },
  corpsel: { a: pose({ rootRx: -1.5, rootY: -0.62, legL: { x: 1.7 }, armL: { x: -1.4, z: 0.1 }, armR: { x: -1.4, z: 0.1 } }) },
  corpse: { a: pose({ rootRx: -1.5, rootY: -0.62 }) },
  vups: { a: pose({ rootRx: -1.5, rootY: -0.62 }), b: pose({ rootRx: -1.5, rootY: -0.55, torso: { x: 0.9 }, legL: { x: 1.35 }, legR: { x: 1.35 }, armL: { x: -1.6, z: 0.1 }, armR: { x: -1.6, z: 0.1 } }) },
  twistups: { a: pose({ rootRx: -1.5, rootY: -0.62, armL: { x: -1.6, z: 0.1 } }), b: pose({ rootRx: -1.5, rootY: -0.55, torso: { x: 0.8 }, armR: { x: -1.6, z: 0.1 }, legL: { x: 0.9 }, legR: { x: 0.9 } }) },
  curls: { a: pose({ rootRx: -1.5, rootY: -0.62, legL: { x: 0.8 }, legR: { x: 0.8 } }), b: pose({ rootRx: -1.5, rootY: -0.58, torso: { x: 0.6 }, legL: { x: 0.8 }, legR: { x: 0.8 } }) },
  cobra: { a: pose({ rootRx: 1.35, rootY: -0.58, torso: { x: -0.55 }, armL: { x: -0.5, z: 0.15 }, armR: { x: -0.5, z: 0.15 } }) },
  pushups: { a: pose({ rootRx: 1.42, rootY: -0.42, armL: { x: -1.5, z: 0.12 }, armR: { x: -1.5, z: 0.12 } }), b: pose({ rootRx: 1.42, rootY: -0.6, armL: { x: -0.7, z: 0.3 }, armR: { x: -0.7, z: 0.3 } }) },
};
function stretchPoseAt(id, elapsed) {
  const def = STRETCH_BY_ID[id]; if (!def) return null;
  const key = def.as || def.id;
  const ps = STRETCH_POSES[key]; if (!ps) return null;
  if (def.kind === 'reps' && ps.b) {
    const cycle = Math.floor(elapsed / 0.9);
    if (cycle >= def.reps * 2) return { pose: ps.a, done: true, count: def.reps };
    return { pose: (cycle % 2 === 1) ? ps.b : ps.a, count: Math.floor(cycle / 2) };
  }
  return { pose: ps.a };
}

function startStretch(id) {
  me.stretch = { id, at: performance.now() / 1000 };
  net.send({ t: 'stretch.set', id });
  $('#stretchui').classList.add('hidden');
}
function stopStretch() {
  me.stretch = null;
  myCtrl?.ctrl.setPose(null);
  net.send({ t: 'stretch.set', id: null });
  $('#stretch-chip').classList.add('hidden');
}

// ============================ weather ============================
const weather = { phase: 'lobby', rain: null };
// beach clock: 1 in-game minute passes every 20 real seconds
const SECS_PER_GAME_MIN = 20;
let clockBase = 7.5 * 60, clockStart = performance.now() / 1000;
function setClockForPhase(phase) {
  clockBase = phase === 'fog' ? 8 * 60 : phase === 'rain' ? 9.5 * 60 : phase === 'sun' ? 11 * 60 : 7.5 * 60;
  clockStart = performance.now() / 1000;
}
function clockText(now) {
  const mins = Math.floor(clockBase + (now - clockStart) / SECS_PER_GAME_MIN);
  const h24 = Math.floor(mins / 60) % 24, m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = ((h24 + 11) % 12) + 1;
  return `🕐 ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function applyWeather(phase) {
  weather.phase = phase;
  setClockForPhase(phase);
  const chip = $('#weather-chip');
  chip.classList.remove('hidden');
  if (phase === 'fog') {
    scene.fog = new THREE.FogExp2('#c2ccd2', 0.02);
    scene.background = new THREE.Color('#bcc8d0');
    sun.intensity = 0.12; hemi.intensity = 0.55; ambient.intensity = 0.5;
    chip.textContent = '🌫️ Marine layer';
  } else if (phase === 'rain') {
    scene.fog = new THREE.FogExp2('#9aa8b2', 0.012);
    scene.background = new THREE.Color('#8f9ea8');
    sun.intensity = 0.08; hemi.intensity = 0.5; ambient.intensity = 0.45;
    chip.textContent = '🌧️ Rain!';
    startRain();
  } else if (phase === 'sun') {
    scene.fog = new THREE.FogExp2('#cfe6f2', 0.0022);
    scene.background = new THREE.Color('#8fd6f2');
    sun.intensity = 1.05; hemi.intensity = 0.95; ambient.intensity = 0.62;
    chip.textContent = '☀️ Sun\'s out!';
  } else {
    scene.fog = null;
    scene.background = new THREE.Color('#8fd6f2');
    sun.intensity = 0.9; hemi.intensity = 0.9; ambient.intensity = 0.6;
    chip.classList.add('hidden');
  }
  if (phase !== 'rain') stopRain();
}
function startRain() {
  if (weather.rain) return;
  const n = 900, geo = new THREE.BufferGeometry();
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = (Math.random() - 0.5) * 160; arr[i * 3 + 1] = Math.random() * 40; arr[i * 3 + 2] = (Math.random() - 0.5) * 160; }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#bcd6ea', size: 0.16, transparent: true, opacity: 0.7 }));
  scene.add(pts); weather.rain = pts;
}
function stopRain() { if (weather.rain) { scene.remove(weather.rain); weather.rain = null; } }
function isSheltered() {
  for (const s of shelters) {
    if (Math.abs(me.pos.x - s.x) <= s.w / 2 && Math.abs(me.pos.z - s.z) <= s.d / 2 && s.y > me.pos.y) return true;
  }
  return false;
}

// ============================ world objects (packs/towels) ============================
const packMeshes = new Map(), towelMeshes = new Map();
function addPackMesh(pk) {
  const m = new THREE.Group();
  m.add(box(0.7, 0.8, 0.4, '#7a5c34', 0, 0.4, 0));
  m.add(box(0.5, 0.3, 0.44, '#5d452a', 0, 0.75, 0));
  m.position.set(pk.x, pk.y, pk.z);
  scene.add(m); packMeshes.set(pk.id, { m, pk });
}
function addTowelMesh(tw) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.2), new THREE.MeshLambertMaterial({ color: tw.color, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(tw.x, tw.y + 0.06, tw.z);
  scene.add(m); towelMeshes.set(tw.id, { m, tw });
}

// ============================ UI flow ============================
let camYaw = 0.6, camPitch = 0.4, camDist = 9, dragging = false;
$('#title-play').addEventListener('click', () => {
  $('#title').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  refreshServers();
});
function refreshServers() { net.send({ t: 'servers.list' }); }
$('#srv-refresh').addEventListener('click', refreshServers);
$('#srv-create').addEventListener('click', () => { $('#menu').classList.add('hidden'); $('#create').classList.remove('hidden'); $('#cr-name').value = `${identity.name}'s beach`; });
$('#cr-back').addEventListener('click', () => { $('#create').classList.add('hidden'); $('#menu').classList.remove('hidden'); });
$('#cr-go').addEventListener('click', () => net.send({ t: 'server.create', name: $('#cr-name').value, mode: 'rp' }));
$('#srv-offline').addEventListener('click', () => net.send({ t: 'server.create', name: 'Offline', mode: 'rp', offline: true }));
document.querySelector('[data-mode="normal"]').addEventListener('click', () => toast('Normal mode is coming soon — RP first! 🎭'));
function renderServers(list) {
  const host = $('#srv-list'); host.innerHTML = '';
  if (!list.length) { host.innerHTML = '<div class="empty">No servers yet — create one!</div>'; return; }
  for (const r of list) {
    const row = document.createElement('div'); row.className = 'srv';
    row.innerHTML = `<b>${r.name}</b><small>by ${r.host} · ${r.mode.toUpperCase()} · ${r.players} 🧍</small><span class="spacer"></span>` +
      (r.started ? '<span class="started">IN PROGRESS</span>' : '');
    const btn = document.createElement('button'); btn.textContent = 'Join';
    btn.addEventListener('click', () => net.send({ t: 'server.join', id: r.id }));
    row.appendChild(btn); host.appendChild(row);
  }
}
setInterval(() => { if (!$('#menu').classList.contains('hidden')) refreshServers(); }, 4000);

function enterWorld(zone) {
  me.zone = zone;
  lobbyG.visible = zone === 'lobby';
  beachG.visible = zone === 'beach';
  if (zone === 'beach') {
    if (!beachG.userData.built) {
      beachG.userData.built = true;
      if (studioBeach) {
        const r = buildStudioWorld(studioBeach, beachG);
        beachSpawn = r.spawn;
        const flat = r.sands[0];
        groundFn = (x, z) => (flat ? flat.y + flat.h / 2 : 0);
        if (studioBeach.sky) scene.background = new THREE.Color(studioBeach.sky);
      } else buildDefaultBeach();
    }
    me.pos = { ...beachSpawn };
  } else {
    if (studioLobby && !lobbyG.userData.built) {
      lobbyG.userData.built = true;
      lobbyG.clear();
      const r = buildStudioWorld(studioLobby, lobbyG);
      lobbySpawn = r.spawn;
    }
    me.pos = lobbySpawn ? { ...lobbySpawn } : { x: (Math.random() - 0.5) * 8, y: 1, z: (Math.random() - 0.5) * 6 };
    applyWeather('lobby');
  }
  me.vel = { x: 0, y: 0, z: 0 };
}

$('#host-start').addEventListener('click', () => net.send({ t: 'server.start' }));
$('#host-invite').addEventListener('click', () => {
  const who = prompt('Invite which friend? (exact name)');
  if (who) net.send({ t: 'server.invite', name: who });
});
$('#act-leave').addEventListener('click', () => { net.send({ t: 'server.leave' }); backToMenu('You left the server.'); });
function backToMenu(msg) {
  for (const [, o] of others) { o.rec.ctrl.dispose?.(); scene.remove(o.rec.ctrl.group); }
  others.clear();
  for (const [, r] of packMeshes) scene.remove(r.m); packMeshes.clear();
  for (const [, r] of towelMeshes) scene.remove(r.m); towelMeshes.clear();
  me.room = null; me.stretch = null; me.sitting = false;
  $('#hud').classList.add('hidden'); $('#rolepick').classList.add('hidden');
  $('#packui').classList.add('hidden'); $('#stretchui').classList.add('hidden');
  $('#host-bar').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  enterWorld('lobby'); applyWeather('lobby');
  if (msg) toast(msg);
  refreshServers();
}

// backpack UI
$('#act-pack').addEventListener('click', () => {
  if (me.pack.carried) { net.send({ t: 'pack.drop' }); }
  else toast('Your backpack is on the ground — walk to it!');
});
function renderPack(pk) {
  const host = $('#pack-items'); host.innerHTML = '';
  for (const it of pk.items) {
    const row = document.createElement('div'); row.className = 'item';
    row.innerHTML = `<span style="font-size:22px">${it.emoji}</span><b>${it.name}</b>`;
    const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', fn); row.appendChild(b); };
    if (it.kind === 'equip') {
      const on = me.equip[it.id];
      mk(on ? 'Unequip' : 'Equip', () => {
        me.equip[it.id] = !me.equip[it.id];
        setEquipLook(myCtrl, me.equip);
        net.send({ t: 'equip.set', ...me.equip });
        if (it.id === 'hat' && me.equip.hat) toast('🧢 No sunburn for you!');
        renderPack(pk);
      });
    } else if (it.kind === 'towel') {
      if (me.wet) mk('Dry off', () => { me.wet = false; toast('🧻 All dry!'); renderPack(pk); });
      mk('Place on sand', () => net.send({ t: 'item.use', pack: pk.id, item: it.id, action: 'place' }));
    } else if (it.kind === 'snack') {
      mk('Eat', () => { net.send({ t: 'item.use', pack: pk.id, item: it.id }); toast(`${it.emoji} Yum!`); });
    }
    host.appendChild(row);
  }
  if (!pk.items.length) host.innerHTML = '<div class="empty">Empty!</div>';
}
$('#pack-close').addEventListener('click', () => $('#packui').classList.add('hidden'));

// stretch UI
{
  const host = $('#stretch-list');
  for (const st of STRETCHES) {
    const row = document.createElement('div'); row.className = 'stretchrow';
    row.innerHTML = `<b>${st.name}</b><small>${st.kind === 'reps' ? '× ' + st.reps : 'hold'}</small>`;
    row.addEventListener('click', () => startStretch(st.id));
    host.appendChild(row);
  }
}
$('#act-stretch').addEventListener('click', () => {
  if (me.stretch) { stopStretch(); return; }
  $('#stretchui').classList.toggle('hidden');
});
$('#stretch-close').addEventListener('click', () => $('#stretchui').classList.add('hidden'));

// role pick
$('#role-instructor').addEventListener('click', () => { net.send({ t: 'role.set', role: 'instructor' }); $('#rolepick').classList.add('hidden'); toast('🧑‍🏫 You are an Instructor'); });
$('#role-student').addEventListener('click', () => { net.send({ t: 'role.set', role: 'student' }); $('#rolepick').classList.add('hidden'); toast('🧒 You are a Student'); });

// context actions (near dropped pack / towel)
function updateCtx() {
  const host = $('#ctx-actions'); host.innerHTML = '';
  const near = (o) => Math.hypot(me.pos.x - o.x, me.pos.z - o.z) < 2.2;
  for (const [, { pk }] of packMeshes) {
    if (pk.owner === net.id && near(pk)) {
      const open = document.createElement('button'); open.textContent = '🎒 Open backpack';
      open.addEventListener('click', () => { renderPack(pk); $('#packui').classList.remove('hidden'); });
      const grab = document.createElement('button'); grab.textContent = '⬆️ Pick up';
      grab.addEventListener('click', () => net.send({ t: 'pack.pickup', id: pk.id }));
      host.append(open, grab);
    }
  }
  for (const [, { tw }] of towelMeshes) {
    if (near(tw)) {
      const sit = document.createElement('button'); sit.textContent = me.sitting ? '🧍 Stand up' : '🪑 Sit on towel';
      sit.addEventListener('click', () => { me.sitting = !me.sitting; });
      host.append(sit);
      if (tw.owner === net.id) {
        const grab = document.createElement('button'); grab.textContent = '🧻 Pick up towel';
        grab.addEventListener('click', () => net.send({ t: 'towel.pickup', id: tw.id }));
        host.append(grab);
      }
    }
  }
}
setInterval(updateCtx, 500);

// ============================ net handlers ============================
net.on('welcome', (m) => { net.id = m.id; renderServers(m.servers); if (m.beach) studioBeach = m.beach; if (m.lobby) studioLobby = m.lobby; });
net.on('servers', (m) => renderServers(m.servers));
net.on('jg.err', (m) => toast('⚠️ ' + m.err));
net.on('jg.info', (m) => toast(m.info));
net.on('room.joined', (m) => {
  me.room = m.room.id; me.isHost = m.youAreHost; me.started = m.started;
  $('#menu').classList.add('hidden'); $('#create').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#host-bar').classList.toggle('hidden', !me.isHost || m.started);
  enterWorld(m.started ? 'beach' : 'lobby');
  if (m.started && m.weather) applyWeather(m.weather.phase);
  if (m.room.mode === 'rp') $('#rolepick').classList.remove('hidden');
  for (const q of m.players) addOther(q);
  for (const pk of m.packs) addPackMesh(pk);
  for (const tw of m.towels) addTowelMesh(tw);
  toast(me.isHost ? 'Your server is up! Press ▶ Start when everyone is here.' : `Joined ${m.room.name}`);
});
net.on('room.closed', (m) => backToMenu('Server closed: ' + m.reason));
net.on('room.left', () => {});
net.on('game.start', (m) => {
  me.started = true;
  $('#host-bar').classList.toggle('hidden', !me.isHost);
  $('#host-start').classList.add('hidden');
  enterWorld('beach');
  applyWeather(m.weather.phase);
  toast('🏖️ Welcome to Capitola Beach — line up for stretches!');
});
net.on('weather', (m) => applyWeather(m.phase));
net.on('player.join', (m) => addOther(m.p));
net.on('player.leave', (m) => {
  const o = others.get(m.id);
  if (o) { o.rec.ctrl.dispose?.(); scene.remove(o.rec.ctrl.group); for (const d of o.rec.drips) scene.remove(d.m); others.delete(m.id); }
});
net.on('player.role', () => {});
net.on('player.stretch', (m) => { const o = others.get(m.id); if (o) o.data.stretch = m.stretch ? { id: m.stretch.id, at: performance.now() / 1000 } : null; });
net.on('player.equip', (m) => { const o = others.get(m.id); if (o) { o.data.equip = m.equip; setEquipLook(o.rec, m.equip); } });
net.on('pack.dropped', (m) => { addPackMesh(m.pack); if (m.pack.owner === net.id) { me.pack.carried = false; toast('🎒 Backpack set down'); } });
net.on('pack.gone', (m) => { const r = packMeshes.get(m.id); if (r) { if (r.pk.owner === net.id) { me.pack.carried = true; toast('🎒 Backpack picked up'); } scene.remove(r.m); packMeshes.delete(m.id); } });
net.on('pack.update', (m) => { const r = packMeshes.get(m.id); if (r) { r.pk.items = m.items; if (!$('#packui').classList.contains('hidden')) renderPack(r.pk); } });
net.on('towel.placed', (m) => addTowelMesh(m.towel));
net.on('towel.gone', (m) => { const r = towelMeshes.get(m.id); if (r) { scene.remove(r.m); towelMeshes.delete(m.id); } });
net.on('chat', (m) => toast(`${m.name}: ${m.text}`, 3500));
net.on('snap', (m) => {
  for (const q of m.players) {
    if (q.id === net.id) continue;
    const o = others.get(q.id);
    if (!o) { addOther(q); continue; }
    o.data.tx = q.x; o.data.ty = q.y; o.data.tz = q.z; o.data.try = q.ry;
    o.data.anim = q.anim; o.data.wet = q.wet;
    o.rec.pack.visible = q.pack !== false;
    if (JSON.stringify(o.data.equip) !== JSON.stringify(q.equip)) { o.data.equip = q.equip; setEquipLook(o.rec, q.equip); }
  }
});

function addOther(q) {
  if (others.has(q.id) || q.id === net.id) return;
  const rec = makeGuard(q.avatar);
  const data = { tx: q.x, ty: q.y, tz: q.z, try: q.ry, anim: q.anim || 'idle', wet: q.wet, equip: q.equip || {}, stretch: q.stretch ? { id: q.stretch.id, at: performance.now() / 1000 } : null };
  rec.ctrl.group.position.set(q.x, q.y, q.z);
  rec.pack.visible = q.pack !== false;
  setEquipLook(rec, data.equip);
  others.set(q.id, { rec, data });
}

// ============================ movement + camera ============================
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  camYaw -= e.movementX * 0.006;
  camPitch = Math.max(0.08, Math.min(1.25, camPitch + e.movementY * 0.005));
});
addEventListener('wheel', (e) => { camDist = Math.max(1.0, Math.min(18, camDist + e.deltaY * 0.01)); }, { passive: true });   // zoom all the way in = first person

function inWater() {
  for (const w of waters) {
    if (Math.abs(me.pos.x - w.x) <= w.w / 2 && Math.abs(me.pos.z - w.z) <= w.d / 2 && me.pos.y < w.y + 0.4) return w;
  }
  return null;
}

function stepMe(dt, now) {
  if (me.stretch || me.sitting) { me.vel.x = me.vel.z = 0; return; }
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const sp = (me.swimming ? 4.2 : run ? 10.5 : 6) ;
  let mx = 0, mz = 0;
  if (keys.has('KeyW')) mz -= 1; if (keys.has('KeyS')) mz += 1;
  if (keys.has('KeyA')) mx -= 1; if (keys.has('KeyD')) mx += 1;
  const len = Math.hypot(mx, mz) || 1;
  const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
  const wx = (mx * cos + mz * sin) / len, wz = (mz * cos - mx * sin) / len;   // W = away from camera
  if (mx || mz) {
    me.vel.x = wx * sp; me.vel.z = wz * sp;
    me.ry = Math.atan2(wx, wz);
  } else { me.vel.x *= 0.8; me.vel.z *= 0.8; }

  const w = inWater();
  me.swimming = !!w;
  if (w) {
    me.wet = true; me.wetSunStart = 0;
    me.pos.y += ((w.y - 0.65) - me.pos.y) * Math.min(1, dt * 5);
    me.vel.y = 0; me.grounded = false;
    if (keys.has('Space')) me.pos.y += dt * 2;
  } else {
    me.vel.y -= 26 * dt;
    if (keys.has('Space') && me.grounded) { me.vel.y = 9.5; me.grounded = false; }
  }
  me.pos.x += me.vel.x * dt; me.pos.z += me.vel.z * dt;
  me.pos.y += me.vel.y * dt;
  const gy = me.zone === 'beach' ? groundFn(me.pos.x, me.pos.z) : 0;
  if (!w && me.pos.y <= gy) { me.pos.y = gy; me.vel.y = 0; me.grounded = true; }
  if (me.zone === 'lobby') {
    const r = Math.hypot(me.pos.x, me.pos.z);
    if (r > 24) { me.pos.x *= 24 / r; me.pos.z *= 24 / r; }
  }
  // rain wets you unless you're under something
  if (weather.phase === 'rain' && !isSheltered()) { me.wet = true; me.wetSunStart = 0; }
  // the sun dries you out after two minutes
  if (me.wet && weather.phase === 'sun' && !w) {
    if (!me.wetSunStart) me.wetSunStart = now;
    if (now - me.wetSunStart > WEATHER.drySunSecs) { me.wet = false; toast('☀️ The sun dried you off!'); }
  }
}

// ============================ main loop ============================
let last = performance.now() / 1000, sendAt = 0;
preloadR6();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last); last = now;

  if (!myCtrl) {
    myCtrl = makeGuard(identity.avatar);
    enterWorld('lobby'); applyWeather('lobby');
  }

  stepMe(dt, now);

  // my model
  const g = myCtrl.ctrl.group;
  g.position.set(me.pos.x, me.pos.y, me.pos.z);
  g.rotation.y = me.ry + Math.PI;
  const sp2 = Math.hypot(me.vel.x, me.vel.z);
  if (me.stretch) {
    const st = stretchPoseAt(me.stretch.id, now - me.stretch.at);
    if (st) {
      myCtrl.ctrl.setPose(st.pose);
      const def = STRETCH_BY_ID[me.stretch.id];
      const chip = $('#stretch-chip'); chip.classList.remove('hidden');
      chip.textContent = def.kind === 'reps' ? `${def.name} — ${Math.min(st.count, def.reps)} / ${def.reps}` : def.name;
      if (st.done) { toast(`💪 ${def.name} done!`); stopStretch(); }
    }
  } else if (me.sitting) {
    myCtrl.ctrl.setPose(pose({ rootY: -0.55, legL: { x: 1.35 }, legR: { x: 1.35 }, torso: { x: 0.1 } }));
  } else {
    myCtrl.ctrl.setPose(null);
    myCtrl.ctrl.setAnim(me.swimming ? 'fall' : !me.grounded ? 'jump' : sp2 > 7 ? 'run' : sp2 > 0.4 ? 'walk' : 'idle');
  }
  myCtrl.ctrl.update(dt);
  myCtrl.pack.visible = me.pack.carried;
  tickDrips(myCtrl, me.pos, me.wet, dt, now);
  $('#wet-chip').classList.toggle('hidden', !me.wet);

  // others
  for (const [, o] of others) {
    const d = o.data, gr = o.rec.ctrl.group;
    gr.position.x += (d.tx - gr.position.x) * Math.min(1, dt * 10);
    gr.position.y += (d.ty - gr.position.y) * Math.min(1, dt * 10);
    gr.position.z += (d.tz - gr.position.z) * Math.min(1, dt * 10);
    gr.rotation.y = (d.try || 0) + Math.PI;
    if (d.stretch) {
      const st = stretchPoseAt(d.stretch.id, now - d.stretch.at);
      if (st) o.rec.ctrl.setPose(st.pose);
      if (st?.done) { d.stretch = null; o.rec.ctrl.setPose(null); }
    } else {
      o.rec.ctrl.setPose(null);
      o.rec.ctrl.setAnim(d.anim || 'idle');
    }
    o.rec.ctrl.update(dt);
    tickDrips(o.rec, gr.position, d.wet, dt, now);
  }

  // rain falls
  if (weather.rain) {
    const arr = weather.rain.geometry.attributes.position;
    for (let i = 0; i < arr.count; i++) {
      let y = arr.getY(i) - dt * 26;
      if (y < 0) y = 38;
      arr.setY(i, y);
    }
    arr.needsUpdate = true;
    weather.rain.position.x = me.pos.x; weather.rain.position.z = me.pos.z;
  }

  // flags wave
  const wave = Math.sin(now * 2.2) * 0.18;
  for (const grp of [lobbyG, beachG]) grp.traverse((o) => { if (o.parent?.userData?.fabric === o) o.rotation.y = wave; });

  // camera — zooming all the way in enters first person
  const fp = camDist < 2;
  myCtrl.ctrl.group.visible = !fp;
  if (fp) {
    camera.position.set(me.pos.x, me.pos.y + 1.55, me.pos.z);
    camera.lookAt(
      me.pos.x - Math.sin(camYaw),
      me.pos.y + 1.55 - (camPitch - 0.35) * 1.3,
      me.pos.z - Math.cos(camYaw));
  } else {
    const cx = me.pos.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist;
    const cz = me.pos.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist;
    const cy = me.pos.y + 1.4 + Math.sin(camPitch) * camDist;
    camera.position.set(cx, cy, cz);
    camera.lookAt(me.pos.x, me.pos.y + 1.2, me.pos.z);
  }

  // network
  if (me.room && now - sendAt > 1 / 12) {
    sendAt = now;
    net.send({ t: 'move', x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), ry: +me.ry.toFixed(2), anim: me.swimming ? 'fall' : sp2 > 7 ? 'run' : sp2 > 0.4 ? 'walk' : 'idle', wet: me.wet, sitting: me.sitting });
  }

  const ck = $('#clock'); if (ck) ck.textContent = clockText(now);

  renderer.render(scene, camera);
}
window.__me = me; window.__cam = () => ({ yaw: camYaw });   // debug handles
net.connect();
frame();
