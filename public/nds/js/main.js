// Natural Disaster Survival — client. Graphically-simple 3D survival sim.
// Lobby (glass-ringed spawn + spiral stair + Multi-Disaster Machine) → island
// where server-chosen disasters strike. Movement is client-authoritative; we
// detect our own death (water / disaster) and report it.
import * as THREE from 'three';
import { WORLD, DISASTERS, MAPS } from '/shared/nds/config.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#9fc4e8', 0.0016);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2000);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---- sky ----
function skyTex(a, b) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; return t;
}
let skyNormal = skyTex('#7db9ec', '#dcecf8');
scene.background = skyNormal;
scene.add(new THREE.HemisphereLight('#eaf4ff', '#4a5a44', 1.05));
const sun = new THREE.DirectionalLight('#fff4e0', 1.0); sun.position.set(60, 120, 40); scene.add(sun);

const LM = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const rndBetween = (a, b) => a + Math.random() * (b - a);

const oofSfx = new Audio('/backpacking/audio/oof.mp3');
oofSfx.preload = 'auto'; oofSfx.volume = 0.9;
function playOof() { oofSfx.currentTime = 0; oofSfx.play().catch(() => {}); }

// ============================ WORLD ============================
let R_ISLAND = 30;             // rough bounding radius (disasters)
const WATER_Y = WORLD.waterY;
const LOBBY = { x: 0, z: -82, lowerY: 0, upperY: 4.6, radius: 9, hole: 4.2 };
const lobbySolids = [];        // lobby collision (discs/boxes)
const walls = [];              // lobby keep-in cylinders

// water
const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: '#2f7fd0', transparent: true, opacity: 0.86 }));
water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; scene.add(water);

// ---- destructible MAP PIECES with real AABB collision ----
let pieces = [];
let currentMap = null;
function clearMap() { for (const p of pieces) { scene.remove(p.mesh); p.mesh.geometry && p.mesh.geometry.dispose(); p.mesh.material && p.mesh.material.dispose(); } pieces = []; }
function buildMap(mapId) {
  const M = MAPS[mapId]; if (!M || currentMap === mapId) return;
  currentMap = mapId; R_ISLAND = M.ground / 2;
  clearMap();
  scene.background = skyTex(M.sky[0], M.sky[1]); scene.fog = new THREE.FogExp2(M.fog, 0.0016); water.material.color.set(M.water);
  for (const d of M.pieces) {
    const mat = d.t === 'glass'
      ? new THREE.MeshLambertMaterial({ color: d.c, transparent: true, opacity: 0.5 })
      : new THREE.MeshLambertMaterial({ color: d.c });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), mat);
    mesh.position.set(d.x, d.y, d.z); scene.add(mesh);
    pieces.push({ mesh, x: d.x, y: d.y, z: d.z, w: d.w, h: d.h, d: d.d, hp: d.s || 0, maxHp: d.s || 0, solid: !d.ns, t: d.t, broken: false });
  }
}
function groundAt(x, z, feetY) {
  let best = -Infinity;
  for (const p of pieces) { if (!p.solid || p.broken) continue; const top = p.y + p.h / 2; if (top <= feetY + 0.65 && top > best && Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) best = top; }
  for (const s of lobbySolids) {
    if (s.type === 'disc') { if (Math.hypot(x - s.x, z - s.z) <= s.r && s.top <= feetY + 0.65 && s.top > best) best = s.top; }
    else if (s.type === 'ring') { const dd = Math.hypot(x - s.x, z - s.z); if (dd <= s.r && dd >= s.inner && s.top <= feetY + 0.65 && s.top > best) best = s.top; }
    else { const dx = x - s.x, dz = z - s.z, c = Math.cos(-s.ry), sn = Math.sin(-s.ry), lx = dx * c - dz * sn, lz = dx * sn + dz * c; if (Math.abs(lx) <= s.w / 2 + 0.3 && Math.abs(lz) <= s.d / 2 + 0.3 && s.top <= feetY + 0.65 && s.top > best) best = s.top; }
  }
  return best;
}
function collideWalls(px, pz, feetY) {
  const r = 0.5, headY = feetY + 1.7, footY = feetY + 0.25;
  for (const p of pieces) {
    if (!p.solid || p.broken) continue;
    const top = p.y + p.h / 2, bot = p.y - p.h / 2;
    if (top <= feetY + 0.65) continue;
    if (headY < bot || footY > top) continue;
    const nx = Math.max(p.x - p.w / 2, Math.min(px, p.x + p.w / 2));
    const nz = Math.max(p.z - p.d / 2, Math.min(pz, p.z + p.d / 2));
    const dx = px - nx, dz = pz - nz, dd = Math.hypot(dx, dz);
    if (dd < r) { if (dd < 1e-4) px += r; else { px = nx + dx / dd * r; pz = nz + dz / dd * r; } }
  }
  return { x: px, z: pz };
}
function breakPiece(p) { if (p.broken) return; p.broken = true; p.solid = false; p.vx = (Math.random() - 0.5) * 4; p.vz = (Math.random() - 0.5) * 4; p.vy = 1 + Math.random() * 3; p.sx = (Math.random() - 0.5) * 6; p.sz = (Math.random() - 0.5) * 6; p.fall = 0; p.mesh.material.transparent = true; }
function damagePiece(p, amt) { if (p.hp <= 0 || p.broken) return; p.hp -= amt; if (p.hp <= 0) breakPiece(p); }
function damageArea(x, z, radius, amt) { for (const p of pieces) { if (p.broken || p.hp <= 0) continue; if (Math.hypot(p.x - x, p.z - z) < radius) damagePiece(p, amt); } }
function tickBroken(dt) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]; if (!p.broken) continue;
    p.fall += dt; p.vy -= 22 * dt;
    p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.x += p.sx * dt; p.mesh.rotation.z += p.sz * dt;
    if (p.fall > 2) p.mesh.material.opacity = Math.max(0, (p.mesh.material.opacity == null ? 1 : p.mesh.material.opacity) - dt * 1.2);
    if (p.fall > 3.4 || p.mesh.position.y < WATER_Y - 8) { scene.remove(p.mesh); pieces.splice(i, 1); }
  }
}

// ---- LOBBY: spawn building ----
function buildLobby() {
  const g = new THREE.Group(); g.position.set(LOBBY.x, 0, LOBBY.z);
  const glassMat = new THREE.MeshLambertMaterial({ color: '#bfe4ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide });
  const pillarMat = LM('#c9d3e0');
  // lower platform
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(LOBBY.radius, LOBBY.radius, 1, 40), LM('#d6dde8'));
  lower.position.y = -0.5; g.add(lower);
  lobbySolids.push({ type: 'disc', x: LOBBY.x, z: LOBBY.z, r: LOBBY.radius, top: 0 });
  // glass ring (lower)
  const ring1 = new THREE.Mesh(new THREE.CylinderGeometry(LOBBY.radius, LOBBY.radius, 3.2, 40, 1, true), glassMat);
  ring1.position.y = 1.6; g.add(ring1);
  walls.push({ x: LOBBY.x, z: LOBBY.z, r: LOBBY.radius - 0.4, yMin: -1, yMax: 3.5 });
  // upper floor — a RING with a central hole the spiral stair rises through
  const upper = new THREE.Mesh(new THREE.RingGeometry(LOBBY.hole, LOBBY.radius, 40), LM('#d6dde8'));
  upper.rotation.x = -Math.PI / 2; upper.position.y = LOBBY.upperY; g.add(upper);
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(LOBBY.hole, LOBBY.hole, 0.5, 40, 1, true), LM('#b7c0cd'));
  lip.position.y = LOBBY.upperY - 0.25; g.add(lip);
  const underside = new THREE.Mesh(new THREE.RingGeometry(LOBBY.hole, LOBBY.radius, 40), LM('#aeb8c6'));
  underside.rotation.x = Math.PI / 2; underside.position.y = LOBBY.upperY - 0.02; g.add(underside);
  lobbySolids.push({ type: 'ring', x: LOBBY.x, z: LOBBY.z, r: LOBBY.radius, inner: LOBBY.hole, top: LOBBY.upperY });
  // glass walls (upper — the invisible-walled viewing deck)
  const ring2 = new THREE.Mesh(new THREE.CylinderGeometry(LOBBY.radius, LOBBY.radius, 5, 40, 1, true), glassMat);
  ring2.position.y = LOBBY.upperY + 2; g.add(ring2);
  walls.push({ x: LOBBY.x, z: LOBBY.z, r: LOBBY.radius - 0.4, yMin: LOBBY.upperY - 1, yMax: LOBBY.upperY + 6 });
  // support pillars
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const px = Math.cos(a) * (LOBBY.radius - 0.6), pz = Math.sin(a) * (LOBBY.radius - 0.6); const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, LOBBY.upperY, 0.5), pillarMat); pil.position.set(px, LOBBY.upperY / 2, pz); g.add(pil); }
  // roof
  const roof = new THREE.Mesh(new THREE.ConeGeometry(LOBBY.radius + 1.2, 4, 40), LM('#8a5a3a'));
  roof.position.y = LOBBY.upperY + 6.5; g.add(roof);
  // ---- spiral staircase ----
  const steps = 22, rStair = 6.4, turns = 1.25;
  for (let i = 0; i < steps; i++) {
    const t = i / steps, ang = t * turns * Math.PI * 2, y = t * LOBBY.upperY;
    const sx = Math.cos(ang) * rStair, sz = Math.sin(ang) * rStair;
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 1.5), LM(i % 2 ? '#b7c0cd' : '#c9d3e0'));
    step.position.set(sx, y, sz); step.rotation.y = -ang; g.add(step);
    lobbySolids.push({ type: 'box', x: LOBBY.x + sx, z: LOBBY.z + sz, w: 2.4, d: 1.5, ry: -ang, top: y + 0.18 });
  }
  // center column
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, LOBBY.upperY, 16), pillarMat); col.position.y = LOBBY.upperY / 2; g.add(col);
  // ---- golden Multi-Disaster Machine (on the upper deck) ----
  const machine = new THREE.Group(); machine.position.set(4.5, LOBBY.upperY, 3);
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 1.8), new THREE.MeshStandardMaterial({ color: '#e8bf5a', metalness: 0.9, roughness: 0.25 })); base.position.y = 1.3; machine.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffd24a', metalness: 1, roughness: 0.2 })); dome.position.y = 2.6; machine.add(dome);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16), new THREE.MeshStandardMaterial({ color: '#e03a2a', emissive: '#7a1006', emissiveIntensity: 0.5 })); btn.position.set(0, 1.7, 1.0); btn.rotation.x = Math.PI / 2; machine.add(btn);
  const dish = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 8, 20), new THREE.MeshStandardMaterial({ color: '#fff0b0', metalness: 1, roughness: 0.15 })); dish.position.y = 3.5; dish.rotation.x = Math.PI / 2; machine.add(dish);
  g.add(machine);
  machinePos.set(LOBBY.x + 4.5, LOBBY.upperY, LOBBY.z + 3);
  g.userData.dish = dish; g.userData.machine = machine;
  scene.add(g);
  return g;
}
const machinePos = new THREE.Vector3();
const lobbyGroup = buildLobby();

// spawn points
const LOBBY_SPAWN = () => ({ x: LOBBY.x + rndBetween(-4, 4), y: 1.4, z: LOBBY.z + rndBetween(-4, 4) });
const ISLAND_SPAWN = () => { const M = MAPS[currentMap]; const r = (M && M.spawnR) || 12; const a = Math.random() * Math.PI * 2, dd = Math.random() * r; return { x: Math.cos(a) * dd, y: 3, z: Math.sin(a) * dd }; };

// ============================ PLAYER ============================
const me = { pos: LOBBY_SPAWN(), vel: { x: 0, y: 0, z: 0 }, ry: 0, grounded: true, dead: false, anim: 'idle', eye: 1.4 };
me.pos.y = 0;
let camYaw = Math.PI, camPitch = 0.32, camDist = 8;   // start looking toward the island
const keys = new Set();
let locked = false;
addEventListener('keydown', (e) => { if (e.repeat) return; keys.add(e.code); if (e.code === 'KeyE') tryInteract(); });
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('click', () => { if (!locked) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
addEventListener('mousemove', (e) => { if (!locked) return; camYaw -= e.movementX * 0.0024; camPitch = Math.max(-0.5, Math.min(1.1, camPitch + e.movementY * 0.0022)); });
addEventListener('wheel', (e) => { camDist = Math.max(4, Math.min(16, camDist + Math.sign(e.deltaY))); });



// ============================ AVATARS (Roblox-style shared models) ============================
function loadAv() { try { return JSON.parse(localStorage.getItem('featherfriends.lastProfile') || '{}').avatar || {}; } catch { return {}; } }
let myAvatar = null;   // controller { group, setAnim, update }
let myHpBar = null;

// ============================ NETWORK ============================
const identityName = (() => { try { return localStorage.getItem('claudebox.user') || 'Survivor'; } catch { return 'Survivor'; } })();
let myAvatarData = loadAv();
const others = new Map();   // id -> { group, target, name, alive }
let myId = null;
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
let ws = null, wsOpen = false;
function connect() {
  ws = new WebSocket(`${proto}//${location.host}/nds-ws`);
  ws.onopen = () => { wsOpen = true; send({ t: 'join', name: identityName, avatar: myAvatarData, code: localStorage.getItem('claudebox.code') || '' }); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => { wsOpen = false; setTimeout(connect, 1500); };
  ws.onerror = () => {};
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

let phase = 'intermission', phaseUntil = 0, roundNum = 0, stacks = 0;
let activeDisasters = [];   // live disaster instances
let disasterStart = 0;

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      // you ALWAYS join into the lobby, even mid-round — then spectate the
      // active round from the deck and jump in at the next warning.
      myId = m.id; roundNum = m.round || 0; $('loading').style.display = 'none';
      phase = m.phase; phaseUntil = m.until; stacks = m.stacks || 0;
      if (m.disasters && m.disasters.length) activeSpecs = m.disasters;
      if (m.map) buildMap(m.map);
      participating = false; me.dead = false; me.pos = LOBBY_SPAWN(); me.pos.y = 0; me.vel = { x: 0, y: 0, z: 0 };
      if (m.phase === 'disaster') { spawnDisasters(activeSpecs); disasterStart = performance.now() / 1000; }
      for (const p of m.players || []) addOther(p);
      break;
    case 'player.join': if (m.player.id !== myId) addOther(m.player); break;
    case 'player.leave': removeOther(m.id); break;
    case 'round': if (m.round) roundNum = m.round; applyPhase(m.phase, m.until, m.disasters || activeSpecs, m.stacks ?? stacks, m.map); if (m.survivors) showSurvivors(m.survivors); break;
    case 'stacks': stacks = m.stacks; toast(`${m.by} stacked a disaster! Next round: ${1 + stacks} 🌪️`); break;
    case 'wallet': setCubes(m.cubes); break;
    case 'dead': { const o = others.get(m.id); if (o) { o.alive = false; killOther(o); } break; }
    case 'snap': applySnap(m.players); break;
    case 'toast': toast(m.text); break;
  }
}
let activeSpecs = [];
let participating = false;     // am I playing this round (was in the lobby at warning)?
function applyPhase(ph, until, disasters, stk, map) {
  phase = ph; phaseUntil = until; stacks = stk;
  if (disasters && disasters.length) activeSpecs = disasters;
  if (map) buildMap(map);
  if (ph === 'warning') {
    // players in the lobby now join the round on the island
    participating = true; me.dead = false; me.pos = ISLAND_SPAWN(); me.pos.y = 6; me.vel = { x: 0, y: 0, z: 0 };
    clearGibs(); myHpBar && myHpBar.set(1);
    const names = activeSpecs.map((d) => DISASTERS[d.id]?.name).filter(Boolean).join(' + ');
    banner(`⚠️ ${names || 'Disaster'} on ${MAPS[currentMap]?.name || 'the island'}!`);
    clearDisasters();
  } else if (ph === 'disaster') {
    spawnDisasters(activeSpecs); disasterStart = performance.now() / 1000;
    banner(participating ? 'SURVIVE!' : `Watching — ${MAPS[currentMap]?.name || ''}`);
  } else if (ph === 'aftermath') {
    banner(!participating ? 'Round over — you join the next one!' : (me.dead ? '💀 Eliminated' : '🏆 You survived!'));
  } else if (ph === 'intermission') {
    participating = false; me.dead = false; me.pos = LOBBY_SPAWN(); me.pos.y = 0; me.vel = { x: 0, y: 0, z: 0 };
    clearGibs(); myHpBar && myHpBar.set(1); clearDisasters(); banner('Intermission — head to the machine!');
  }
}

function addOther(p) {
  if (others.has(p.id) || p.id === myId) return;
  const ctrl = makeAvatar(p.avatar || {}); scene.add(ctrl.group);
  ctrl.group.add(makeNameplate(p.name));
  const hpBar = makeHealthBar(); ctrl.group.add(hpBar.sprite);
  const rec = { ctrl, target: { x: p.x || 0, y: p.y || 0, z: p.z || 0, ry: p.ry || 0 }, alive: p.alive !== false, name: p.name, hpBar, avatar: p.avatar || {}, gibbed: false };
  if (p.alive === false) { hpBar.set(0); rec.gibbed = true; }
  others.set(p.id, rec);
}
function removeOther(id) { const o = others.get(id); if (o) { scene.remove(o.ctrl.group); o.ctrl.dispose && o.ctrl.dispose(); others.delete(id); } }
function killOther(o) {
  if (o.gibbed) return;
  o.gibbed = true;
  const g = o.ctrl.group;
  gib(g.position.x, g.position.y, g.position.z, o.avatar);
  o.hpBar && o.hpBar.set(0);
  g.visible = false;
  if (Math.hypot(g.position.x - me.pos.x, g.position.z - me.pos.z) < 40) playOof();
}
function applySnap(players) {
  for (const arr of players) {
    const [id, x, y, z, ry, anim, alive] = arr;
    if (id === myId) continue;
    const o = others.get(id);
    if (o) {
      const was = o.alive; o.target = { x, y, z, ry }; o.anim = anim; o.alive = !!alive;
      if (was && !o.alive) killOther(o);
      if (!was && o.alive) { o.gibbed = false; o.hpBar && o.hpBar.set(1); o.ctrl.group.visible = true; }
      o.ctrl.group.visible = o.alive || (!o.gibbed && phase !== 'disaster');
    }
  }
}
function makeNameplate(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = 'bold 30px system-ui'; x.textAlign = 'center'; x.fillStyle = '#000'; x.globalAlpha = 0.5; x.fillText(name, 129, 41);
  x.globalAlpha = 1; x.fillStyle = '#fff'; x.fillText(name, 128, 40);
  const t = new THREE.CanvasTexture(c); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); sp.scale.set(2.4, 0.6, 1); sp.position.y = 2.5; return sp;
}
function makeHealthBar() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const x = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  sp.scale.set(1.5, 0.19, 1); sp.position.y = 2.18;
  const set = (frac) => {
    x.clearRect(0, 0, 128, 16);
    x.fillStyle = '#a02a1a'; x.fillRect(2, 2, 124, 12);
    x.fillStyle = '#3fd141'; x.fillRect(2, 2, Math.round(124 * frac), 12);
    x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 2; x.strokeRect(1, 1, 126, 14);
    t.needsUpdate = true;
  };
  set(1);
  return { sprite: sp, set };
}

// ============================ INTERACTION ============================
function tryInteract() {
  if (phase !== 'intermission') { if (nearMachine()) toast('The machine only works during intermission.'); return; }
  if (nearMachine()) send({ t: 'machine' });
}
function nearMachine() { return machinePos.distanceTo(new THREE.Vector3(me.pos.x, me.pos.y + 1, me.pos.z)) < 4; }

// ============================ HUD ============================
function banner(text) { const b = $('banner'); b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); setTimeout(() => b.classList.remove('show'), 2200); }
let toastT = 0; function toast(text) { const s = $('status'); s.textContent = text; toastT = performance.now() / 1000 + 3; }
function setCubes(n) { $('cubes').textContent = n; }
function showSurvivors(ids) { const n = ids.length; toast(`${n} survivor${n === 1 ? '' : 's'} this round`); }

// ============================ DISASTERS ============================
let floodLevel = WATER_Y, floodMesh = null;
function clearDisasters() { for (const d of activeDisasters) { if (d.mesh) scene.remove(d.mesh); if (d.extra) scene.remove(d.extra); } activeDisasters = []; if (floodMesh) { scene.remove(floodMesh); floodMesh = null; } floodLevel = WATER_Y; }
function spawnDisasters(specs) {
  clearDisasters();
  for (const spec of specs) {
    const d = { spec, mesh: null, id: spec.id, state: {} };
    if (spec.id === 'tornado') { d.state = { x: spec.x, z: spec.z, vx: spec.vx, vz: spec.vz }; d.mesh = makeTornado(spec.radius); scene.add(d.mesh); }
    else if (spec.id === 'flood') { floodMesh = new THREE.Mesh(new THREE.PlaneGeometry((R_ISLAND + 10) * 2, (R_ISLAND + 10) * 2), new THREE.MeshLambertMaterial({ color: '#2f7fd0', transparent: true, opacity: 0.7 })); floodMesh.rotation.x = -Math.PI / 2; floodMesh.position.y = WATER_Y; scene.add(floodMesh); }
    else if (spec.id === 'meteors') { d.state = { fired: new Array(spec.impacts.length).fill(false), meteors: [] }; }
    else if (spec.id === 'quake') { d.mesh = new THREE.Group(); for (const f of spec.fissures) { const cr = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.len), new THREE.MeshBasicMaterial({ color: '#120a06' })); cr.rotation.x = -Math.PI / 2; cr.rotation.z = f.ang; cr.position.set(f.x, 0.06, f.z); cr.scale.set(0.01, 1, 1); d.mesh.add(cr); } scene.add(d.mesh); }
    else if (spec.id === 'tsunami') { d.mesh = makeWave(); scene.add(d.mesh); }
    else if (spec.id === 'wildfire') { d.state = { fires: spec.seeds.map((s) => ({ x: s.x, z: s.z, r: 1.5 })) }; d.mesh = new THREE.Group(); scene.add(d.mesh); }
    else if (spec.id === 'volcano') { d.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#e03a10' })); d.mesh.rotation.x = -Math.PI / 2; d.mesh.position.y = 0.08; d.mesh.scale.setScalar(0.1); scene.add(d.mesh); const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 6, 16), LM('#5a3a2a')); cone.position.y = 2.5; scene.add(cone); d.state = { cone, r: 0 }; }
    else if (spec.id === 'blizzard') {
      scene.fog = new THREE.FogExp2('#dbe8f2', 0.055);   // whiteout haze
      d.state = { cold: 0 };
      // ---- warm campfire at the safe zone (visible so players can find it) ----
      const fire = new THREE.Group(); fire.position.set(spec.warm.x, 0, spec.warm.z);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(spec.warm.r, 28), new THREE.MeshBasicMaterial({ color: '#ff9a3a', transparent: true, opacity: 0.32, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.09; fire.add(glow);
      for (let i = 0; i < 5; i++) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 6), LM('#5a3a22')); const a = i / 5 * Math.PI * 2; log.position.set(Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5); log.rotation.z = Math.PI / 2; log.rotation.y = a; fire.add(log); }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.9, 8), new THREE.MeshBasicMaterial({ color: '#ff6a1a', transparent: true, opacity: 0.92 })); flame.position.y = 1.1; fire.add(flame);
      const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.15, 8), new THREE.MeshBasicMaterial({ color: '#ffd24a' })); flame2.position.y = 0.95; fire.add(flame2);
      const pl = new THREE.PointLight('#ff9a3a', 1.4, spec.warm.r * 3.5); pl.position.y = 1.3; fire.add(pl);
      scene.add(fire); d.mesh = fire; d.state.flame = flame; d.state.flame2 = flame2; d.state.light = pl;
      // ---- falling snow that follows the player ----
      const N = 1500, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 95; pos[i * 3 + 1] = Math.random() * 48; pos[i * 3 + 2] = (Math.random() - 0.5) * 95; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.5, transparent: true, opacity: 0.9, depthWrite: false }));
      snow.frustumCulled = false; scene.add(snow); d.extra = snow; d.state.snow = snow;
    }
    else if (spec.id === 'acid') { d.state = { pools: spec.pools.map((p) => ({ ...p, cur: 0.1 })) }; d.mesh = new THREE.Group(); scene.add(d.mesh); }
    else if (spec.id === 'thunderstorm') { d.state = { fired: new Array((spec.strikes || []).length).fill(false) }; scene.fog = new THREE.FogExp2('#8a94a8', 0.02); }
    else if (spec.id === 'sandstorm') { scene.fog = new THREE.FogExp2('#d9b46a', 0.05); d.state = {}; }
    activeDisasters.push(d);
  }
  // update HUD disaster label
  $('disasters').textContent = specs.map((s) => `${DISASTERS[s.id]?.emoji || ''} ${DISASTERS[s.id]?.name || ''}`).join('   ');
}
function makeTornado(radius) {
  const g = new THREE.Group();
  for (let i = 0; i < 10; i++) { const t = i / 10; const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * (0.3 + t * 0.9), 0.5 + t * 0.5, 6, 16), new THREE.MeshLambertMaterial({ color: '#9aa4b0', transparent: true, opacity: 0.5 })); ring.rotation.x = Math.PI / 2; ring.position.y = 1 + t * 16; g.add(ring); }
  g.userData.spin = 0; return g;
}
function makeWave() {
  const g = new THREE.Mesh(new THREE.BoxGeometry(R_ISLAND * 3, 8, 4), new THREE.MeshLambertMaterial({ color: '#1f6fb0', transparent: true, opacity: 0.85 }));
  return g;
}
let shake = 0;
function updateDisasters(dt, elapsed) {
  for (const d of activeDisasters) {
    const s = d.spec;
    if (s.id === 'tornado') {
      const st = d.state; st.x += st.vx * dt; st.z += st.vz * dt;
      if (Math.hypot(st.x, st.z) > R_ISLAND - 4) { st.vx *= -1; st.vz *= -1; }
      d.mesh.position.set(st.x, 0, st.z); d.mesh.userData.spin += dt * 6; d.mesh.rotation.y = d.mesh.userData.spin;
      damageArea(st.x, st.z, s.radius + 3, dt * 55);
      if (!me.dead && Math.hypot(me.pos.x - st.x, me.pos.z - st.z) < s.radius) { me.vel.y = 18; die('tornado'); }
    } else if (s.id === 'flood') {
      floodLevel = Math.min(WATER_Y + 12, WATER_Y + Math.max(0, elapsed - (s.delay || 3)) * s.rise);
      if (floodMesh) floodMesh.position.y = floodLevel;
      if (!me.dead && me.pos.y + me.eye < floodLevel + 0.2) die('flood');
    } else if (s.id === 'meteors') {
      for (let i = 0; i < s.impacts.length; i++) {
        const im = s.impacts[i];
        if (!d.state.fired[i] && elapsed > im.t - 1.1 && !d.state.meteors[i]) { const mm = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff6a2a' })); mm.position.set(im.x, 60, im.z); scene.add(mm); d.state.meteors[i] = mm; }
        const mm = d.state.meteors[i];
        if (mm && !d.state.fired[i]) { mm.position.y = 60 - (elapsed - (im.t - 1.1)) / 1.1 * 60; if (elapsed >= im.t) { d.state.fired[i] = true; scene.remove(mm); boom(im.x, 0, im.z, im.r); damageArea(im.x, im.z, im.r + 2, 9999); if (!me.dead && Math.hypot(me.pos.x - im.x, me.pos.z - im.z) < im.r) die('meteor'); } }
      }
    } else if (s.id === 'quake') {
      shake = 0.3;
      if (Math.random() < dt * 7) { const wk = pieces.filter((q) => !q.broken && q.maxHp > 0 && q.maxHp <= 130); if (wk.length) damagePiece(wk[(Math.random() * wk.length) | 0], 45); }
      d.mesh.children.forEach((cr, i) => { const f = s.fissures[i]; const o = Math.max(0, Math.min(1, (elapsed - f.openAt) / 1.5)); cr.scale.x = Math.max(0.01, o); });
      if (!me.dead) for (const f of s.fissures) { if (elapsed < f.openAt + 0.5) continue; const dx = me.pos.x - f.x, dz = me.pos.z - f.z, c = Math.cos(-f.ang), sn = Math.sin(-f.ang); const lx = dx * c - dz * sn, lz = dx * sn + dz * c; if (Math.abs(lx) < f.w / 2 && Math.abs(lz) < f.len / 2 && me.grounded) { me.grounded = false; me.vel.y = -2; if (me.pos.y < -3) die('fissure'); } }
    } else if (s.id === 'tsunami') {
      const prog = elapsed - s.arriveIn;
      const dist = -R_ISLAND * 1.6 + prog * 22;   // wave sweeps across
      const wx = s.dirX * -dist, wz = s.dirZ * -dist;
      d.mesh.position.set(wx, 2, wz); d.mesh.rotation.y = Math.atan2(s.dirX, s.dirZ);
      if (!me.dead && prog > 0) { const along = (me.pos.x * -s.dirX + me.pos.z * -s.dirZ); if (Math.abs(along - dist) < 3 && me.pos.y + me.eye < 5) die('tsunami'); }
    } else if (s.id === 'wildfire') {
      for (const f of d.state.fires) { if (elapsed > (s.delay || 2)) f.r = Math.min(10, f.r + s.spread * dt); }
      // redraw fire discs
      d.mesh.clear();
      for (const f of d.state.fires) { const fire = new THREE.Mesh(new THREE.CircleGeometry(f.r, 20), new THREE.MeshBasicMaterial({ color: '#ff4d1a', transparent: true, opacity: 0.55 })); fire.rotation.x = -Math.PI / 2; fire.position.set(f.x, 0.09, f.z); d.mesh.add(fire); }
      for (const f of d.state.fires) damageArea(f.x, f.z, f.r, dt * 18);
      if (!me.dead) for (const f of d.state.fires) if (Math.hypot(me.pos.x - f.x, me.pos.z - f.z) < f.r && me.pos.y < 1.5) die('wildfire');
    } else if (s.id === 'volcano') {
      d.state.r = Math.min(R_ISLAND, Math.max(0, elapsed - (s.delay || 3)) * s.lavaRate * 2);
      damageArea(0, 0, d.state.r, dt * 24);
      d.mesh.scale.setScalar(Math.max(0.1, d.state.r));
      if (!me.dead && Math.hypot(me.pos.x, me.pos.z) < d.state.r && me.pos.y < 1.5) die('lava');
    } else if (s.id === 'blizzard') {
      const warmD = Math.hypot(me.pos.x - s.warm.x, me.pos.z - s.warm.z);
      if (elapsed > (s.freezeIn || 5)) { if (warmD > s.warm.r) d.state.cold += dt; else d.state.cold = Math.max(0, d.state.cold - dt * 2); }
      $('status').textContent = warmD > s.warm.r ? `❄️ Freezing! Get to the fire (${(6 - d.state.cold).toFixed(0)}s)` : '🔥 Warm — stay here';
      if (!me.dead && d.state.cold > 6) die('frozen');
      // falling snow follows the player; recycle flakes that hit the ground
      const snow = d.state.snow;
      if (snow) { const arr = snow.geometry.attributes.position.array; for (let i = 0; i < arr.length; i += 3) { arr[i + 1] -= dt * 15; arr[i] += dt * 3; if (arr[i + 1] < 0) { arr[i + 1] = 48; arr[i] = (Math.random() - 0.5) * 95; arr[i + 2] = (Math.random() - 0.5) * 95; } } snow.geometry.attributes.position.needsUpdate = true; snow.position.set(me.pos.x, 0, me.pos.z); }
      if (d.state.flame) { d.state.flame.scale.y = 1 + Math.sin(elapsed * 20) * 0.14; d.state.flame2.scale.y = 1 + Math.cos(elapsed * 26) * 0.18; if (d.state.light) d.state.light.intensity = 1.2 + Math.sin(elapsed * 18) * 0.5; }
    } else if (s.id === 'acid') {
      d.mesh.clear();
      for (const p of d.state.pools) { if (elapsed > p.growAt) p.cur = Math.min(p.r, p.cur + dt * 0.8); const pool = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.1, p.cur), 18), new THREE.MeshBasicMaterial({ color: '#7de04a', transparent: true, opacity: 0.6 })); pool.rotation.x = -Math.PI / 2; pool.position.set(p.x, 0.07, p.z); d.mesh.add(pool); if (!me.dead && Math.hypot(me.pos.x - p.x, me.pos.z - p.z) < p.cur && me.pos.y < 1.5) die('acid'); }
    } else if (s.id === 'thunderstorm') {
      for (let i = 0; i < (s.strikes || []).length; i++) { const st = s.strikes[i]; if (!d.state.fired[i] && elapsed > st.t) { d.state.fired[i] = true; lightning(st.x, st.z); damageArea(st.x, st.z, 5, 9999); if (!me.dead && Math.hypot(me.pos.x - st.x, me.pos.z - st.z) < 5) die('lightning'); } }
    } else if (s.id === 'sandstorm') {
      me.pos.x += s.windX * dt * 4; me.pos.z += s.windZ * dt * 4;
      if (Math.random() < dt * 4) { const wk = pieces.filter((q) => !q.broken && q.t === 'glass'); if (wk.length) damagePiece(wk[(Math.random() * wk.length) | 0], 26); }
    }
  }
}
function lightning(x, z) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.1, 60, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true })); b.position.set(x, 30, z); scene.add(b); boom(x, 0, z, 4); let tt = 0; const iv = setInterval(() => { tt += 0.05; b.material.opacity = Math.max(0, 1 - tt * 4); if (tt > 0.3) { clearInterval(iv); scene.remove(b); } }, 22); }
function boom(x, y, z, r) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffaa40', transparent: true, opacity: 0.85 }));
  m.position.set(x, y + 0.5, z); scene.add(m);
  const scar = new THREE.Mesh(new THREE.CircleGeometry(r, 18), new THREE.MeshBasicMaterial({ color: '#2a1a10' })); scar.rotation.x = -Math.PI / 2; scar.position.set(x, 0.05, z); scene.add(scar);
  let t = 0; const iv = setInterval(() => { t += 0.05; m.scale.setScalar(1 + t * 1.5); m.material.opacity = Math.max(0, 0.85 - t * 1.5); if (t > 0.6) { clearInterval(iv); scene.remove(m); } }, 30);
}
let gibs = [];
function gib(x, y, z, av = {}) {
  const skin = av.skin || '#e8b48a', shirt = av.shirtColor || '#3a7bd5', pants = av.pantsColor || '#34404f';
  const parts = [
    [0.34, 0.34, 0.34, skin,  1.65],
    [0.48, 0.56, 0.26, shirt, 1.15],
    [0.16, 0.5,  0.16, skin,  1.25], [0.16, 0.5, 0.16, skin, 1.25],
    [0.2,  0.55, 0.2,  pants, 0.55], [0.2, 0.55, 0.2, pants, 0.55],
  ];
  for (const [w, h, d, col, py] of parts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col, transparent: true }));
    mesh.position.set(x + (Math.random() - 0.5) * 0.3, y + py, z + (Math.random() - 0.5) * 0.3);
    scene.add(mesh);
    const a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 3.5;
    gibs.push({ mesh, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 4.5 + Math.random() * 4,
      sx: (Math.random() - 0.5) * 10, sz: (Math.random() - 0.5) * 10, life: 0 });
  }
}
function tickGibs(dt) {
  for (let i = gibs.length - 1; i >= 0; i--) {
    const p = gibs[i]; p.life += dt; p.vy -= 22 * dt;
    p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.x += p.sx * dt; p.mesh.rotation.z += p.sz * dt;
    if (p.life > 2.2) p.mesh.material.opacity = Math.max(0, 1 - (p.life - 2.2) * 1.2);
    if (p.life > 3.2 || p.mesh.position.y < WATER_Y - 8) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); gibs.splice(i, 1); }
  }
}
function clearGibs() { for (const p of gibs) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); } gibs = []; }
function die(cause) {
  if (me.dead || !participating) return;
  me.dead = true;
  send({ t: 'dead', cause });
  gib(me.pos.x, me.pos.y, me.pos.z, myAvatarData);
  myHpBar && myHpBar.set(0);
  playOof();
  banner('💀 ' + cause.toUpperCase());
}

// ============================ MAIN LOOP ============================
let last = performance.now() / 1000;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000; const dt = Math.min(0.05, now - last); last = now;
  shake = Math.max(0, shake - dt);

  // movement (only while alive; dead = spectate float)
  const mv = new THREE.Vector3();
  if (locked || true) {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (f || s) { const yaw = camYaw; mv.x = (-Math.sin(yaw) * f + Math.cos(yaw) * s); mv.z = (-Math.cos(yaw) * f - Math.sin(yaw) * s); mv.normalize(); }
  }
  const moving = mv.lengthSq() > 0.01;
  const speed = me.dead ? 10 : 8;
  if (!me.dead) {
    me.vel.x = mv.x * speed; me.vel.z = mv.z * speed;
    if (keys.has('Space') && me.grounded) { me.vel.y = 9.5; me.grounded = false; }
    me.vel.y -= 26 * dt;
    me.pos.x += me.vel.x * dt; me.pos.z += me.vel.z * dt;
    const cw = collideWalls(me.pos.x, me.pos.z, me.pos.y); me.pos.x = cw.x; me.pos.z = cw.z;
    for (const w of walls) { if (me.pos.y > w.yMin && me.pos.y < w.yMax) { const dx = me.pos.x - w.x, dz = me.pos.z - w.z, d = Math.hypot(dx, dz); if (d > w.r && d < w.r + 22) { me.pos.x = w.x + dx / d * w.r; me.pos.z = w.z + dz / d * w.r; } } }
    me.pos.y += me.vel.y * dt;
    const gy = groundAt(me.pos.x, me.pos.z, me.pos.y);
    if (me.pos.y <= gy) { me.pos.y = gy; me.vel.y = 0; me.grounded = true; } else me.grounded = false;
    // face movement
    if (moving) me.ry = Math.atan2(-mv.x, -mv.z);
    // water death (fell off into the sea, or flood submerged handled in disasters)
    if (gy === -Infinity && me.pos.y < WATER_Y + 0.3) die('drowned');
    if (me.pos.y < -30) die('the void');
    send({ t: 'move', x: me.pos.x, y: me.pos.y, z: me.pos.z, ry: me.ry, anim: moving ? 'run' : 'idle' });
  } else {
    // spectate: gentle float
    me.pos.x += me.vel.x * dt * 0.4; me.pos.z += me.vel.z * dt * 0.4;
    me.vel.x = mv.x * speed; me.vel.z = mv.z * speed; me.pos.y = Math.max(me.pos.y, 3);
  }

  // my avatar
  if (myAvatar) { myAvatar.group.visible = !me.dead; myAvatar.group.position.set(me.pos.x, me.pos.y, me.pos.z); myAvatar.group.rotation.y = me.ry + Math.PI; myAvatar.setAnim(me.dead ? 'fall' : moving ? 'run' : 'idle'); myAvatar.update(dt); }

  // others
  for (const [, o] of others) { const g = o.ctrl.group; g.position.x += (o.target.x - g.position.x) * Math.min(1, dt * 12); g.position.y += (o.target.y - g.position.y) * Math.min(1, dt * 12); g.position.z += (o.target.z - g.position.z) * Math.min(1, dt * 12); let d = (o.target.ry + Math.PI) - g.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; g.rotation.y += d * Math.min(1, dt * 10); o.ctrl.setAnim(o.alive === false ? 'fall' : o.anim === 'run' ? 'run' : 'idle'); o.ctrl.update(dt); }

  // disasters
  if (phase === 'disaster') updateDisasters(dt, now - disasterStart);
  tickBroken(dt);
  tickGibs(dt);

  // machine prompt + dish spin
  lobbyGroup.userData.dish.rotation.z += dt * (1 + stacks) * 1.5;
  const p = $('prompt');
  if (phase === 'intermission' && nearMachine() && !me.dead) { p.style.display = 'block'; p.innerHTML = `Press <b>E</b> · Multi-Disaster Machine · 5 🔷 → +1 disaster next round (now ${1 + stacks})`; } else p.style.display = 'none';

  // camera (third-person orbit)
  const tgt = new THREE.Vector3(me.pos.x, me.pos.y + 1.4, me.pos.z);
  const cx = Math.sin(camYaw) * Math.cos(camPitch) * camDist, cy = Math.sin(camPitch) * camDist + 0.5, cz = Math.cos(camYaw) * Math.cos(camPitch) * camDist;
  camera.position.set(tgt.x + cx + (Math.random() - 0.5) * shake, tgt.y + cy + (Math.random() - 0.5) * shake, tgt.z + cz);
  camera.lookAt(tgt);

  // HUD
  const left = Math.max(0, Math.ceil(phaseUntil - Date.now() / 1000));
  $('timer').textContent = left;
  const labels = { intermission: '🏝️ Intermission — hang out & stack disasters', warning: '⚠️ Get ready…', disaster: '☠️ SURVIVE', aftermath: '🏁 Round over' };
  $('phase').textContent = (labels[phase] || phase) + `   ·   Round ${roundNum || ''}`;
  if (phase !== 'disaster') { if (now > toastT) $('status').textContent = phase === 'intermission' ? `Disasters next round: ${1 + stacks}` : ''; }
  if (phase !== 'disaster' && phase !== 'blizzard') { /* keep */ }
  if (phase === 'intermission') { scene.fog = new THREE.FogExp2('#9fc4e8', 0.0016); }

  renderer.render(scene, camera);
}
(async () => { try { await preloadAvatars(['boy', 'girl']); } catch {} myAvatar = makeAvatar(myAvatarData || {}); scene.add(myAvatar.group); myHpBar = makeHealthBar(); myAvatar.group.add(myHpBar.sprite); connect(); frame(); })();
