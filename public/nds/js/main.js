// Natural Disaster Survival — client. Graphically-simple 3D survival sim.
// Lobby (glass-ringed spawn + spiral stair + Multi-Disaster Machine) → island
// where server-chosen disasters strike. Movement is client-authoritative; we
// detect our own death (water / disaster) and report it.
import * as THREE from 'three';
import { WORLD, DISASTERS } from '/shared/nds/config.js';

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

// ============================ WORLD ============================
const R_ISLAND = WORLD.islandRadius;
const WATER_Y = WORLD.waterY;
const LOBBY = { x: 0, z: -118, lowerY: 0, upperY: 14, radius: 9 };
const solids = [];   // { type:'disc'|'box', ... top }  for ground height
const walls = [];    // { x, z, r, yMin, yMax }  cylinder keep-in

// water (huge plane)
const waterGeo = new THREE.PlaneGeometry(3000, 3000);
const water = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({ color: '#2f7fd0', transparent: true, opacity: 0.86 }));
water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; scene.add(water);

// island (grass disc)
const island = new THREE.Mesh(new THREE.CylinderGeometry(R_ISLAND, R_ISLAND + 2, 3, 48), LM('#54c46e'));
island.position.y = -1.5; scene.add(island);
const beach = new THREE.Mesh(new THREE.CylinderGeometry(R_ISLAND + 2.4, R_ISLAND + 3, 0.6, 48), LM('#d8c98a'));
beach.position.y = -0.3; scene.add(beach);
solids.push({ type: 'disc', x: 0, z: 0, r: R_ISLAND, top: 0 });

// high-ground rocks (survive floods / tsunamis by climbing these)
const rocks = [];
for (let i = 0; i < 7; i++) {
  const a = (i / 7) * Math.PI * 2 + 0.4, d = rndBetween(8, 24), h = rndBetween(3.5, 8);
  const rx = Math.cos(a) * d, rz = Math.sin(a) * d, rr = rndBetween(3, 5.5);
  const rock = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.7, rr, h, 8), LM('#8f9aa6'));
  rock.position.set(rx, h / 2 - 0.5, rz); scene.add(rock);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.72, rr * 0.72, 0.4, 8), LM('#54c46e'));
  cap.position.set(rx, h - 0.5, rz); scene.add(cap);
  solids.push({ type: 'disc', x: rx, z: rz, r: rr * 0.7, top: h - 0.5 });
  rocks.push({ x: rx, z: rz, r: rr * 0.7, top: h - 0.5 });
}

// ---- LOBBY: spawn building ----
function buildLobby() {
  const g = new THREE.Group(); g.position.set(LOBBY.x, 0, LOBBY.z);
  const glassMat = new THREE.MeshLambertMaterial({ color: '#bfe4ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide });
  const pillarMat = LM('#c9d3e0');
  // lower platform
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(LOBBY.radius, LOBBY.radius, 1, 40), LM('#d6dde8'));
  lower.position.y = -0.5; g.add(lower);
  solids.push({ type: 'disc', x: LOBBY.x, z: LOBBY.z, r: LOBBY.radius, top: 0 });
  // glass ring (lower)
  const ring1 = new THREE.Mesh(new THREE.CylinderGeometry(LOBBY.radius, LOBBY.radius, 3.2, 40, 1, true), glassMat);
  ring1.position.y = 1.6; g.add(ring1);
  walls.push({ x: LOBBY.x, z: LOBBY.z, r: LOBBY.radius - 0.4, yMin: -1, yMax: 3.5 });
  // upper platform
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(LOBBY.radius, LOBBY.radius, 1, 40), LM('#d6dde8'));
  upper.position.y = LOBBY.upperY - 0.5; g.add(upper);
  solids.push({ type: 'disc', x: LOBBY.x, z: LOBBY.z, r: LOBBY.radius, top: LOBBY.upperY });
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
  const steps = 44, rStair = 6.2, turns = 2;
  for (let i = 0; i < steps; i++) {
    const t = i / steps, ang = t * turns * Math.PI * 2, y = t * LOBBY.upperY;
    const sx = Math.cos(ang) * rStair, sz = Math.sin(ang) * rStair;
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 1.5), LM(i % 2 ? '#b7c0cd' : '#c9d3e0'));
    step.position.set(sx, y, sz); step.rotation.y = -ang; g.add(step);
    solids.push({ type: 'box', x: LOBBY.x + sx, z: LOBBY.z + sz, w: 2.4, d: 1.5, ry: -ang, top: y + 0.18 });
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
const ISLAND_SPAWN = () => { const a = Math.random() * Math.PI * 2, d = Math.random() * (R_ISLAND - 6); return { x: Math.cos(a) * d, y: 1.4, z: Math.sin(a) * d }; };

// ============================ PLAYER ============================
const me = { pos: LOBBY_SPAWN(), vel: { x: 0, y: 0, z: 0 }, ry: 0, grounded: true, dead: false, anim: 'idle', eye: 1.4 };
me.pos.y = 0;
let camYaw = 0, camPitch = 0.35, camDist = 8;
const keys = new Set();
let locked = false;
addEventListener('keydown', (e) => { if (e.repeat) return; keys.add(e.code); if (e.code === 'KeyE') tryInteract(); });
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('click', () => { if (!locked) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
addEventListener('mousemove', (e) => { if (!locked) return; camYaw -= e.movementX * 0.0024; camPitch = Math.max(-0.5, Math.min(1.1, camPitch + e.movementY * 0.0022)); });
addEventListener('wheel', (e) => { camDist = Math.max(4, Math.min(16, camDist + Math.sign(e.deltaY))); });

function surfaceAt(x, z, feetY) {
  let best = -Infinity;
  for (const s of solids) {
    if (s.type === 'disc') { if (Math.hypot(x - s.x, z - s.z) <= s.r) { if (s.top <= feetY + 0.65 && s.top > best) best = s.top; } }
    else { // rotated box
      const dx = x - s.x, dz = z - s.z, c = Math.cos(-s.ry), sn = Math.sin(-s.ry);
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      if (Math.abs(lx) <= s.w / 2 + 0.3 && Math.abs(lz) <= s.d / 2 + 0.3) { if (s.top <= feetY + 0.65 && s.top > best) best = s.top; }
    }
  }
  return best;
}

// ============================ AVATARS (simple blocky) ============================
function buildAvatar(av) {
  const g = new THREE.Group();
  const shirt = (av && av.shirtColor) || '#38b6e8';
  const skin = (av && av.skin) || '#f0c9a0';
  const pants = (av && av.pantsColor) || '#3a4a5d';
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), LM(shirt)); torso.position.y = 1.15; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), LM(skin)); head.position.y = 1.9; g.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.8, 0.32), LM(pants)); legL.position.set(-0.18, 0.4, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.18; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.28), LM(shirt)); armL.position.set(-0.48, 1.15, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.48; g.add(armR);
  g.userData = { legL, legR, armL, armR, walk: 0 };
  return g;
}
function animAvatar(g, moving, dt) {
  const u = g.userData; u.walk += dt * (moving ? 9 : 2);
  const s = Math.sin(u.walk) * (moving ? 0.5 : 0.05);
  u.legL.rotation.x = s; u.legR.rotation.x = -s; u.armL.rotation.x = -s; u.armR.rotation.x = s;
}
const myAvatar = buildAvatar(loadAv()); scene.add(myAvatar);
function loadAv() { try { return JSON.parse(localStorage.getItem('featherfriends.lastProfile') || '{}').avatar || {}; } catch { return {}; } }

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
      myId = m.id; roundNum = m.round || 0; $('loading').style.display = 'none';
      applyPhase(m.phase, m.until, m.disasters || [], m.stacks || 0, false);
      for (const p of m.players || []) addOther(p);
      break;
    case 'player.join': if (m.player.id !== myId) addOther(m.player); break;
    case 'player.leave': removeOther(m.id); break;
    case 'round': if (m.round) roundNum = m.round; applyPhase(m.phase, m.until, m.disasters || activeSpecs, m.stacks ?? stacks, true); if (m.survivors) showSurvivors(m.survivors); break;
    case 'stacks': stacks = m.stacks; toast(`${m.by} stacked a disaster! Next round: ${1 + stacks} 🌪️`); break;
    case 'wallet': setCubes(m.cubes); break;
    case 'dead': { const o = others.get(m.id); if (o) o.alive = false; break; }
    case 'snap': applySnap(m.players); break;
    case 'toast': toast(m.text); break;
  }
}
let activeSpecs = [];
function applyPhase(ph, until, disasters, stk, animate) {
  phase = ph; phaseUntil = until; stacks = stk;
  if (disasters && disasters.length) activeSpecs = disasters;
  if (ph === 'warning') {
    me.dead = false; me.pos = ISLAND_SPAWN(); me.pos.y = 6; me.vel = { x: 0, y: 0, z: 0 };
    $('dead-overlay').classList.remove('show'); $('dead-tag').style.display = 'none';
    const names = activeSpecs.map((d) => DISASTERS[d.id]?.name).filter(Boolean).join(' + ');
    banner(`⚠️ ${names || 'Disaster'} incoming!`);
    clearDisasters();
  } else if (ph === 'disaster') {
    if (me.pos.z < -60 || me.dead) { me.dead = false; me.pos = ISLAND_SPAWN(); me.pos.y = 4; me.vel = { x: 0, y: 0, z: 0 }; $('dead-overlay').classList.remove('show'); $('dead-tag').style.display = 'none'; }   // teleport late joiners onto the island
    spawnDisasters(activeSpecs); disasterStart = performance.now() / 1000;
    banner('SURVIVE!');
  } else if (ph === 'aftermath') {
    banner(me.dead ? '💀 Eliminated' : '🏆 You survived!');
  } else if (ph === 'intermission') {
    me.dead = false; me.pos = LOBBY_SPAWN(); me.pos.y = 0; me.vel = { x: 0, y: 0, z: 0 };
    $('dead-overlay').classList.remove('show'); $('dead-tag').style.display = 'none';
    clearDisasters(); banner('Intermission — head to the machine!');
  }
}

function addOther(p) {
  if (others.has(p.id) || p.id === myId) return;
  const group = buildAvatar(p.avatar); scene.add(group);
  const plate = makeNameplate(p.name); group.add(plate);
  others.set(p.id, { group, target: { x: p.x || 0, y: p.y || 0, z: p.z || 0, ry: p.ry || 0 }, alive: p.alive !== false, name: p.name });
}
function removeOther(id) { const o = others.get(id); if (o) { scene.remove(o.group); others.delete(id); } }
function applySnap(players) {
  for (const arr of players) {
    const [id, x, y, z, ry, anim, alive] = arr;
    if (id === myId) continue;
    const o = others.get(id);
    if (o) { o.target = { x, y, z, ry }; o.anim = anim; o.alive = !!alive; o.group.visible = !!alive || phase !== 'disaster'; }
  }
}
function makeNameplate(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = 'bold 30px system-ui'; x.textAlign = 'center'; x.fillStyle = '#000'; x.globalAlpha = 0.5; x.fillText(name, 129, 41);
  x.globalAlpha = 1; x.fillStyle = '#fff'; x.fillText(name, 128, 40);
  const t = new THREE.CanvasTexture(c); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); sp.scale.set(2.4, 0.6, 1); sp.position.y = 2.5; return sp;
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
function clearDisasters() { for (const d of activeDisasters) if (d.mesh) scene.remove(d.mesh); activeDisasters = []; if (floodMesh) { scene.remove(floodMesh); floodMesh = null; } floodLevel = WATER_Y; }
function spawnDisasters(specs) {
  clearDisasters();
  for (const spec of specs) {
    const d = { spec, mesh: null, id: spec.id, state: {} };
    if (spec.id === 'tornado') { d.state = { x: spec.x, z: spec.z, vx: spec.vx, vz: spec.vz }; d.mesh = makeTornado(spec.radius); scene.add(d.mesh); }
    else if (spec.id === 'flood') { floodMesh = new THREE.Mesh(new THREE.CircleGeometry(R_ISLAND + 3, 48), new THREE.MeshLambertMaterial({ color: '#2f7fd0', transparent: true, opacity: 0.7 })); floodMesh.rotation.x = -Math.PI / 2; floodMesh.position.y = WATER_Y; scene.add(floodMesh); }
    else if (spec.id === 'meteors') { d.state = { fired: new Array(spec.impacts.length).fill(false), meteors: [] }; }
    else if (spec.id === 'quake') { d.mesh = new THREE.Group(); for (const f of spec.fissures) { const cr = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.len), new THREE.MeshBasicMaterial({ color: '#120a06' })); cr.rotation.x = -Math.PI / 2; cr.rotation.z = f.ang; cr.position.set(f.x, 0.06, f.z); cr.scale.set(0.01, 1, 1); d.mesh.add(cr); } scene.add(d.mesh); }
    else if (spec.id === 'tsunami') { d.mesh = makeWave(); scene.add(d.mesh); }
    else if (spec.id === 'wildfire') { d.state = { fires: spec.seeds.map((s) => ({ x: s.x, z: s.z, r: 1.5 })) }; d.mesh = new THREE.Group(); scene.add(d.mesh); }
    else if (spec.id === 'volcano') { d.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#e03a10' })); d.mesh.rotation.x = -Math.PI / 2; d.mesh.position.y = 0.08; d.mesh.scale.setScalar(0.1); scene.add(d.mesh); const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 6, 16), LM('#5a3a2a')); cone.position.y = 2.5; scene.add(cone); d.state = { cone, r: 0 }; }
    else if (spec.id === 'blizzard') { scene.fog = new THREE.FogExp2('#dbe8f2', 0.05); d.state = { cold: 0 }; const warm = new THREE.Mesh(new THREE.CylinderGeometry(spec.warm.r, spec.warm.r, 0.2, 24), new THREE.MeshBasicMaterial({ color: '#ff9a3a', transparent: true, opacity: 0.4 })); warm.position.set(spec.warm.x, 0.1, spec.warm.z); scene.add(warm); d.mesh = warm; }
    else if (spec.id === 'acid') { d.state = { pools: spec.pools.map((p) => ({ ...p, cur: 0.1 })) }; d.mesh = new THREE.Group(); scene.add(d.mesh); }
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
        if (mm && !d.state.fired[i]) { mm.position.y = 60 - (elapsed - (im.t - 1.1)) / 1.1 * 60; if (elapsed >= im.t) { d.state.fired[i] = true; scene.remove(mm); boom(im.x, 0, im.z, im.r); if (!me.dead && Math.hypot(me.pos.x - im.x, me.pos.z - im.z) < im.r) die('meteor'); } }
      }
    } else if (s.id === 'quake') {
      shake = 0.25;
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
      if (!me.dead) for (const f of d.state.fires) if (Math.hypot(me.pos.x - f.x, me.pos.z - f.z) < f.r && me.pos.y < 1.5) die('wildfire');
    } else if (s.id === 'volcano') {
      d.state.r = Math.min(R_ISLAND, Math.max(0, elapsed - (s.delay || 3)) * s.lavaRate * 2);
      d.mesh.scale.setScalar(Math.max(0.1, d.state.r));
      if (!me.dead && Math.hypot(me.pos.x, me.pos.z) < d.state.r && me.pos.y < 1.5) die('lava');
    } else if (s.id === 'blizzard') {
      const warmD = Math.hypot(me.pos.x - s.warm.x, me.pos.z - s.warm.z);
      if (elapsed > (s.freezeIn || 5)) { if (warmD > s.warm.r) d.state.cold += dt; else d.state.cold = Math.max(0, d.state.cold - dt * 2); }
      $('status').textContent = warmD > s.warm.r ? `❄️ Freezing! Get to the fire (${(6 - d.state.cold).toFixed(0)}s)` : '🔥 Warm — stay here';
      if (!me.dead && d.state.cold > 6) die('frozen');
    } else if (s.id === 'acid') {
      d.mesh.clear();
      for (const p of d.state.pools) { if (elapsed > p.growAt) p.cur = Math.min(p.r, p.cur + dt * 0.8); const pool = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.1, p.cur), 18), new THREE.MeshBasicMaterial({ color: '#7de04a', transparent: true, opacity: 0.6 })); pool.rotation.x = -Math.PI / 2; pool.position.set(p.x, 0.07, p.z); d.mesh.add(pool); if (!me.dead && Math.hypot(me.pos.x - p.x, me.pos.z - p.z) < p.cur && me.pos.y < 1.5) die('acid'); }
    }
  }
}
function boom(x, y, z, r) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffaa40', transparent: true, opacity: 0.85 }));
  m.position.set(x, y + 0.5, z); scene.add(m);
  const scar = new THREE.Mesh(new THREE.CircleGeometry(r, 18), new THREE.MeshBasicMaterial({ color: '#2a1a10' })); scar.rotation.x = -Math.PI / 2; scar.position.set(x, 0.05, z); scene.add(scar);
  let t = 0; const iv = setInterval(() => { t += 0.05; m.scale.setScalar(1 + t * 1.5); m.material.opacity = Math.max(0, 0.85 - t * 1.5); if (t > 0.6) { clearInterval(iv); scene.remove(m); } }, 30);
}
function die(cause) {
  if (me.dead) return; me.dead = true;
  send({ t: 'dead', cause });
  $('dead-overlay').classList.add('show'); $('dead-tag').style.display = 'block';
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
    if (keys.has('Space') && me.grounded) { me.vel.y = 9; me.grounded = false; }
    me.vel.y -= 26 * dt;
    me.pos.x += me.vel.x * dt; me.pos.z += me.vel.z * dt; me.pos.y += me.vel.y * dt;
    // keep-in walls (lobby glass)
    for (const w of walls) { if (me.pos.y > w.yMin && me.pos.y < w.yMax) { const dx = me.pos.x - w.x, dz = me.pos.z - w.z, d = Math.hypot(dx, dz); if (d > w.r && d < w.r + 22) { me.pos.x = w.x + dx / d * w.r; me.pos.z = w.z + dz / d * w.r; } } }   // keep-in only near the lobby, not across the map
    // ground
    const gy = surfaceAt(me.pos.x, me.pos.z, me.pos.y);
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
  myAvatar.visible = !me.dead;
  myAvatar.position.set(me.pos.x, me.pos.y, me.pos.z); myAvatar.rotation.y = me.ry; animAvatar(myAvatar, moving, dt);

  // others
  for (const [, o] of others) { const g = o.group; g.position.x += (o.target.x - g.position.x) * Math.min(1, dt * 12); g.position.y += (o.target.y - g.position.y) * Math.min(1, dt * 12); g.position.z += (o.target.z - g.position.z) * Math.min(1, dt * 12); let d = o.target.ry - g.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; g.rotation.y += d * Math.min(1, dt * 10); animAvatar(g, o.anim === 'run', dt); }

  // disasters
  if (phase === 'disaster') updateDisasters(dt, now - disasterStart);

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
connect();
frame();
