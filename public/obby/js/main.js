// Obby — a parkour tower. Reuses the ClaudeBox avatar + the shared course.
// Walk/run/jump across platforms over a void; checkpoints save progress; fall
// (or touch lava) and you respawn. Staff/Owner get ;fly and a Troll menu.

import * as THREE from 'three';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import { COURSE, START, moverPos, spinAngle, KILL_Y, checkpointById, FINISH_STAGE, applyCourse } from '/shared/obby/course.js';
import { toObbyCourse } from '/shared/studio/adapters.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game-canvas');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1626');
scene.fog = new THREE.Fog('#0e1626', 60, 240);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1200);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight('#bcd8ff', '#243049', 0.95); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 1.0);
sun.position.set(60, 120, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120; sun.shadow.camera.far = 400;
scene.add(sun); scene.add(sun.target);

// starfield backdrop
{
  const g = new THREE.BufferGeometry();
  const n = 600, arr = new Float32Array(n * 3);
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) { arr[i*3] = (rnd()*2-1)*600; arr[i*3+1] = rnd()*400 - 60; arr[i*3+2] = (rnd()*2-1)*600; }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#9fb6e0', size: 1.3, sizeAttenuation: false })));
}

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

// ---------- build the course ----------
function buildCourse() {
  for (const p of COURSE.platforms) {
    const mat = p.kind === 'kill' ? new THREE.MeshLambertMaterial({ color: '#c0241a', emissive: '#5a0d06' })
      : p.kind === 'finish' ? new THREE.MeshLambertMaterial({ color: '#ffd84a', emissive: '#6b5300' })
      : lam(p.color);
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mat);
    m.position.set(p.x, p.y, p.z); m.receiveShadow = true; m.castShadow = true;
    scene.add(m);
  }
  // checkpoint beacons + numbers
  for (const c of COURSE.checkpoints) {
    if (c.n === 0) continue;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 8),
      new THREE.MeshBasicMaterial({ color: c.n >= COURSE.finishStage ? '#ffd84a' : '#5fe08a', transparent: true, opacity: 0.32 }));
    beam.position.set(c.x, c.y + 7, c.z); scene.add(beam);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({ map: numberTex(c.n), transparent: true, side: THREE.DoubleSide }));
    flag.position.set(c.x, c.y + 4, c.z); scene.add(flag);
    flag.userData.spin = true; spinFlags.push(flag);
  }
  // movers
  for (const m of COURSE.movers) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(m.w, m.h, m.d), lam('#cfd8e6'));
    mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    moverMeshes.push({ spec: m, mesh });
  }
  // spinners
  for (const s of COURSE.spinners) {
    const pivot = new THREE.Group(); pivot.position.set(s.x, s.y, s.z); scene.add(pivot);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 8), lam('#444b58'));
    post.position.y = -1; pivot.add(post);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(s.len, s.h, 0.7), new THREE.MeshLambertMaterial({ color: '#e8563f', emissive: '#3a0f08' }));
    bar.castShadow = true; pivot.add(bar);
    spinnerMeshes.push({ spec: s, pivot });
  }
}
const spinFlags = [], moverMeshes = [], spinnerMeshes = [];

function numberTex(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(10,16,28,.0)'; x.fillRect(0, 0, 128, 128);
  x.beginPath(); x.arc(64, 64, 54, 0, 7); x.fillStyle = n >= COURSE.finishStage ? '#ffd84a' : '#5fe08a'; x.fill();
  x.fillStyle = '#0c1422'; x.font = 'bold 70px Trebuchet MS'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c); return t;
}
// buildCourse() is deferred to boot(), after any custom Studio level is loaded

// ---------- player controller ----------
const R = 0.35, G = 30, JUMP = 13.4, MOVE = 7.8, RUN = 11.5, FLY = 20;
const player = {
  pos: { x: START.x, y: START.y, z: START.z }, vel: { x: 0, y: 0, z: 0 },
  ry: 0, grounded: false, anim: 'idle', flying: false, sprint: false,
};
const game = { dead: false, dying: false, won: false, stage: 0, carried: false, frozenUntil: 0, staff: false, owner: false, role: 'player', scale: 1 };

// returns highest support top under (x,z) that you were standing at/above
function supportUnder(x, z, fromY, time) {
  let best = -Infinity, plat = null, moverHit = null;
  for (const p of COURSE.platforms) {
    if (x > p.x - p.w/2 - R && x < p.x + p.w/2 + R && z > p.z - p.d/2 - R && z < p.z + p.d/2 + R) {
      const top = p.y + p.h/2;
      if (top <= fromY + 0.6 && top > best) { best = top; plat = p; moverHit = null; }
    }
  }
  for (const mm of moverMeshes) {
    const m = mm.spec, wp = moverPos(m, time);
    if (x > wp.x - m.w/2 - R && x < wp.x + m.w/2 + R && z > wp.z - m.d/2 - R && z < wp.z + m.d/2 + R) {
      const top = wp.y + m.h/2;
      if (top <= fromY + 0.6 && top > best) { best = top; plat = null; moverHit = { m, wp }; }
    }
  }
  return { top: best, plat, moverHit };
}

let standMover = null, standMoverPrev = null;
function updatePlayer(dt, input, time) {
  if (game.dead || game.carried) return;
  const frozen = Date.now() < game.frozenUntil;
  // camera-relative move dir
  let mx = 0, mz = 0;
  if (!frozen) { mx = input.x; mz = input.z; }
  const len = Math.hypot(mx, mz) || 1;
  const yaw = orbit.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const wishX = (fx * mz + rx * mx) / (Math.hypot(mx, mz) > 0.01 ? len : 1);
  const wishZ = (fz * mz + rz * mx) / (Math.hypot(mx, mz) > 0.01 ? len : 1);
  const moving = Math.hypot(mx, mz) > 0.05;

  if (player.flying) {
    const sp = FLY * (player.sprint ? 2 : 1);
    player.vel.x = wishX * sp; player.vel.z = wishZ * sp;
    player.vel.y = (input.up ? 1 : 0) * sp - (input.down ? 1 : 0) * sp;
    player.pos.x += player.vel.x * dt; player.pos.y += player.vel.y * dt; player.pos.z += player.vel.z * dt;
    if (moving) player.ry = Math.atan2(wishX, wishZ);
    player.anim = (input.up || input.down || moving) ? 'fly' : 'fly';
    return;
  }

  const sp = (player.sprint ? RUN : MOVE);
  player.vel.x = wishX * sp; player.vel.z = wishZ * sp;
  if (moving) player.ry = Math.atan2(wishX, wishZ);

  // ride a mover horizontally
  standMoverPrev = standMover;

  const prevY = player.pos.y;
  player.vel.y -= G * dt;
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;

  const sup = supportUnder(player.pos.x, player.pos.z, prevY, time);
  player.grounded = false; standMover = null;
  if (player.vel.y <= 0 && sup.top > -Infinity && player.pos.y <= sup.top && prevY >= sup.top - 0.5) {
    player.pos.y = sup.top; player.vel.y = 0; player.grounded = true;
    if (sup.plat?.kind === 'kill') return die('lava');
    if (sup.plat?.kind === 'finish') win();
    if (sup.moverHit) standMover = sup.moverHit;
  }
  // carry along the mover you're standing on
  if (standMover && standMoverPrev && standMover.m === standMoverPrev.m) {
    player.pos.x += standMover.wp.x - standMoverPrev.wp.x;
    player.pos.z += standMover.wp.z - standMoverPrev.wp.z;
  }

  // jump: buffered (press registers up to 0.15s early) + coyote (0.1s grace
  // after stepping off) so jumps never feel eaten
  const nowS = performance.now() / 1000;
  if (player.grounded) coyoteUntil = nowS + 0.1;
  const recentlyPressed = jumpAt >= 0 && nowS - jumpAt < 0.15;
  if (recentlyPressed && nowS < coyoteUntil && !frozen) {
    player.vel.y = JUMP; player.grounded = false; coyoteUntil = 0; jumpAt = -1;
  }

  // spinner fling
  for (const sm of spinnerMeshes) {
    const s = sm.spec;
    const dx = player.pos.x - s.x, dz = player.pos.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.8 && d < s.r && Math.abs(player.pos.y - (s.y)) < 1.6) {
      const barAng = spinAngle(s, time);
      const pAng = Math.atan2(dz, dx);
      let da = pAng - barAng; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283;
      // bar lies along ±barAng; if near the bar line, fling outward
      if (Math.abs(Math.sin(da)) < 0.22) {
        const out = 1 / (d || 1);
        player.vel.x = dx * out * 22; player.vel.z = dz * out * 22; player.vel.y = 9;
        player.grounded = false;
      }
    }
  }

  // anim
  if (!player.grounded) player.anim = player.vel.y > 1 ? 'jump' : 'fall';
  else if (moving) player.anim = player.sprint ? 'run' : 'walk';
  else player.anim = 'idle';

  // fall death
  if (player.pos.y < COURSE.killY) die('fell');

  // checkpoint pass-through
  for (const c of COURSE.checkpoints) {
    if (c.n > game.stage && Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 6 && Math.abs(c.y - player.pos.y) < 4) {
      net.send({ t: 'checkpoint', n: c.n });
    }
  }
}

function die(cause) {
  if (game.dead || game.dying) return;
  game.dying = true;
  net.send({ t: 'die', cause });
}
function win() {
  if (game.won) return; game.won = true;
  window.ClaudeBox?.completeChallenge('obby-finish');
  net.send({ t: 'checkpoint', n: COURSE.finishStage });
  $('#win-veil').classList.remove('hidden');
  setTimeout(() => $('#win-veil').classList.add('hidden'), 4000);
}

// ---------- camera (third-person orbit) ----------
const orbit = { yaw: Math.PI, pitch: 0.42, dist: 9 };
function updateCamera() {
  // camera framing tracks your size: tiny → close & low, giant → far & high
  const s = game.scale;
  const dist = orbit.dist * s;
  const tx = player.pos.x, ty = player.pos.y + 1.4 * s, tz = player.pos.z;
  const cp = Math.cos(orbit.pitch);
  const cx = tx + Math.sin(orbit.yaw) * cp * dist;
  const cy = ty + Math.sin(orbit.pitch) * dist;
  const cz = tz + Math.cos(orbit.yaw) * cp * dist;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.6);
  camera.lookAt(tx, ty, tz);
  const targetFov = 60 + (s - 1) * 9;   // giant widens the view, tiny narrows it
  if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * 0.12; camera.updateProjectionMatrix(); }
}

// ---------- avatars ----------
const myAvatar = { ctrl: null, group: null };
const remotes = new Map(); // id -> { ctrl, group, interp, data, nameSprite }

function nameSprite(name, role) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px Trebuchet MS'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const col = role === 'owner' ? '#ffb12e' : role === 'staff' ? '#37d6ff' : '#eaf2ff';
  if (role === 'owner' || role === 'staff') {
    x.fillStyle = role === 'owner' ? 'rgba(70,40,0,.6)' : 'rgba(4,34,58,.6)';
    x.fillRect(8, 4, 240, 26);
    x.fillStyle = col; x.font = 'bold 16px Trebuchet MS'; x.fillText(role.toUpperCase(), 128, 17);
  }
  x.font = 'bold 30px Trebuchet MS'; x.fillStyle = col;
  x.strokeStyle = 'rgba(0,0,0,.7)'; x.lineWidth = 4; x.strokeText(name, 128, 46); x.fillText(name, 128, 46);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  spr.scale.set(3.2, 0.8, 1); spr.position.y = 2.7;
  return spr;
}

function makeRemote(d) {
  const ctrl = makeAvatar(d.avatar || {});
  ctrl.group.scale.setScalar(d.scale || 1);
  const spr = nameSprite(d.name, d.role);
  ctrl.group.add(spr);
  scene.add(ctrl.group);
  const rec = { ctrl, group: ctrl.group, interp: new InterpBuffer(), data: d, nameSprite: spr };
  remotes.set(d.id, rec);
  return rec;
}
function refreshRemoteTag(rec) {
  rec.group.remove(rec.nameSprite);
  rec.nameSprite = nameSprite(rec.data.name, rec.data.role);
  rec.group.add(rec.nameSprite);
  rec.group.scale.setScalar(rec.data.scale || 1);
  rec.ctrl.setColors(rec.data.avatar || {});
}

// ---------- networking ----------
const net = new Net();
let identity = null;

net.on('welcome', (msg) => {
  game.staff = msg.staff; game.owner = msg.owner; game.role = msg.you.role;
  for (const d of msg.players) makeRemote(d);
  showRole();
  $('#loading').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  toast(game.owner ? '👑 Welcome, Owner!' : game.staff ? '🛡️ Welcome, Staff!' : 'Reach the top! 🧗');
});
net.on('player.join', (m) => { if (m.player.id !== net.id && !remotes.has(m.player.id)) makeRemote(m.player); });
net.on('player.leave', (m) => { const r = remotes.get(m.id); if (r) { scene.remove(r.group); remotes.delete(m.id); } });
net.on('player.update', (m) => {
  const d = m.player;
  if (d.id === net.id) {
    game.role = d.role; game.staff = d.role !== 'player'; game.owner = d.role === 'owner'; player.flying = d.flying;
    game.scale = d.scale || 1;
    if (myAvatar.group) myAvatar.group.scale.setScalar(game.scale);
    if (game.scale < 1) toast('🐜 Shrunk!'); else if (game.scale > 1) toast('🦣 Embiggened!');
    showRole(); return;
  }
  const r = remotes.get(d.id); if (!r) return;
  Object.assign(r.data, d); refreshRemoteTag(r);
});
net.on('snapshot', (m) => {
  serverTime = m.clock;
  for (const row of m.players) {
    const [id, x, y, z, ry, anim] = row;
    if (id === net.id) { if (game.carried) { player.pos.x = x; player.pos.y = y; player.pos.z = z; } continue; }
    const r = remotes.get(id); if (!r) continue;
    r.interp.push([x, y, z, ry, anim]);
  }
});
net.on('player.respawn', (m) => {
  if (m.id === net.id) {
    player.pos = { x: m.x, y: m.y, z: m.z }; player.vel = { x: 0, y: 0, z: 0 };
    game.dead = false; game.dying = false; game.carried = false; $('#death-veil').classList.add('hidden');
  } else { const r = remotes.get(m.id); if (r) r.interp.push([m.x, m.y, m.z, r.data.ry || 0, 'idle']); }
});
net.on('player.death', (m) => {
  if (m.id === net.id) {
    if (game.dead) return;
    game.dead = true; game.carried = false;
    $('#death-veil').querySelector('p').textContent = m.cause === 'lava' ? 'Burned!' : m.cause === 'laser' ? 'Zapped!' : m.cause === 'admin' ? 'Admin smite!' : 'You fell!';
    $('#death-veil').classList.remove('hidden');
    setTimeout(() => net.send({ t: 'respawn' }), 2000);
  }
});
net.on('checkpoint.ok', (m) => { game.stage = m.n; $('#stage-num').textContent = m.n; toast(`Checkpoint ${m.n}! ✅`); if (m.n < COURSE.finishStage) window.ClaudeBox?.completeChallenge('obby-check'); });
net.on('fly', (m) => { player.flying = m.on; if (m.on) { player.vel = { x: 0, y: 0, z: 0 }; } $('#fly-pill').classList.toggle('hidden', !m.on); });
net.on('toast', (m) => toast(m.text));
net.on('chat', (m) => addChat(m));
net.on('troll.carried', (m) => { if (m.id === net.id) { game.carried = true; toast('😇 You have been ASCENDED'); } });
net.on('troll.released', (m) => { if (m.id === net.id) { game.carried = false; player.vel.y = 0; player.grounded = false; } });
net.on('troll.fling', (m) => { if (m.id === net.id) { player.vel.x = m.vx; player.vel.y = m.vy; player.vel.z = m.vz; player.grounded = false; game.carried = false; } });
net.on('troll.freeze', (m) => { if (m.id === net.id) { game.frozenUntil = m.until; toast('🥶 Frozen!'); } });
net.on('troll.fx', (m) => { if (m.kind === 'laser') laserFx(m.by, m.target); });
net.on('_disconnect', () => toast('Disconnected — refresh to rejoin.'));

let serverTime = 0;

// ---------- laser fx ----------
const lasers = [];
function headPos(id) {
  if (id === net.id) return new THREE.Vector3(player.pos.x, player.pos.y + 1.7, player.pos.z);
  const r = remotes.get(id); return r ? new THREE.Vector3(r.group.position.x, r.group.position.y + 1.7, r.group.position.z) : null;
}
const UP = new THREE.Vector3(0, 1, 0);
function orientBeam(beam, a, b) {
  const dir = b.clone().sub(a); const len = Math.max(0.01, dir.length());
  beam.position.copy(a).add(b).multiplyScalar(0.5);
  beam.scale.set(1, len, 1);
  beam.quaternion.setFromUnitVectors(UP, dir.normalize());
}
function laserFx(by, target) {
  const a = headPos(by), b = headPos(target); if (!a || !b) return;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 1, 8),
    new THREE.MeshBasicMaterial({ color: '#ff2222', transparent: true, opacity: 0.95 })
  );
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 1, 8),
    new THREE.MeshBasicMaterial({ color: '#ff6060', transparent: true, opacity: 0.35, depthWrite: false })
  );
  beam.add(glow); beam.renderOrder = 999;
  orientBeam(beam, a, b);
  scene.add(beam);
  // a quick flash at the impact point
  const flash = new THREE.PointLight('#ff3030', 6, 12);
  flash.position.copy(b); scene.add(flash);
  lasers.push({ beam, flash, by, target, ttl: 0.55 });
}

// ---------- chat / toast ----------
function addChat(m) {
  const log = $('#chat-log');
  const div = document.createElement('div'); div.className = 'chat-line';
  const roleCls = m.id === 'sys' ? 'sys' : (m.role === 'owner' ? 'owner' : m.role === 'staff' ? 'staff' : '');
  div.innerHTML = `<span class="nm ${roleCls}">${esc(m.name)}</span> ${esc(m.text)}`;
  log.appendChild(div);
  while (log.children.length > 9) log.removeChild(log.firstChild);
}
function toast(text) {
  const t = document.createElement('div'); t.className = 'ob-toast'; t.textContent = text;
  $('#ob-toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function showRole() {
  const b = $('#role-badge');
  if (game.owner) { b.className = 'owner'; b.textContent = '👑 OWNER'; b.classList.remove('hidden'); }
  else if (game.staff) { b.className = 'staff'; b.textContent = '🛡️ STAFF'; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}

// ---------- troll UI ----------
const TROLLS = [
  { kind: 'carry', e: '😇', l: 'Jesus (carry)' },
  { kind: 'drop', e: '😈', l: 'Drop them' },
  { kind: 'laser', e: '🦸', l: 'Laser eyes' },
  { kind: 'fling', e: '🚀', l: 'Fling' },
  { kind: 'freeze', e: '🥶', l: 'Freeze' },
  { kind: 'kill', e: '💀', l: 'Smite' },
  { kind: 'tiny', e: '🐜', l: 'Tiny' },
  { kind: 'giant', e: '🦣', l: 'Giant' },
  { kind: 'bring', e: '🧲', l: 'Bring to me' },
  { kind: 'reset', e: '♻️', l: 'Reset' },
];
let trollTargetId = null;
function buildTrollMenu() {
  const grid = $('#tm-grid'); grid.innerHTML = '';
  for (const t of TROLLS) {
    const d = document.createElement('div'); d.className = 'tm-item';
    d.innerHTML = `<span class="e">${t.e}</span><span class="l">${t.l}</span>`;
    d.onclick = () => { if (trollTargetId) net.send({ t: 'troll', kind: t.kind, target: trollTargetId }); };
    grid.appendChild(d);
  }
}
buildTrollMenu();
$('#tm-close').onclick = () => $('#troll-menu').classList.add('hidden');
$('#troll-btn').onclick = () => {
  if (!trollTargetId) return;
  const r = remotes.get(trollTargetId); if (!r) return;
  $('#tm-name').textContent = r.data.name;
  $('#troll-menu').classList.remove('hidden');
  unlock();
};
$('#reset-btn').onclick = () => die('reset');

// nearest other player to target for trolling
function updateTrollButton() {
  const btn = $('#troll-btn');
  if (!game.staff) { btn.classList.add('hidden'); return; }
  let best = null, bd = 7;
  for (const [id, r] of remotes) {
    const d = Math.hypot(r.group.position.x - player.pos.x, r.group.position.z - player.pos.z);
    if (d < bd) { bd = d; best = { id, name: r.data.name }; }
  }
  if (best && !$('#troll-menu').classList.contains('hidden') === false) {
    trollTargetId = best.id;
    btn.classList.remove('hidden');
    $('#troll-target').textContent = best.name;
  } else if (best) { trollTargetId = best.id; btn.classList.remove('hidden'); $('#troll-target').textContent = best.name; }
  else { btn.classList.add('hidden'); trollTargetId = null; }
}

// ---------- input ----------
const keys = new Set();
let jumpAt = -1, coyoteUntil = 0;     // jump-buffer + coyote time for snappy jumps
let dragging = false, lastX = 0, lastY = 0;
const typing = () => { const e = document.activeElement; return e && (e.tagName === 'INPUT'); };
addEventListener('keydown', (e) => {
  if (typing()) { if (e.code === 'Enter') sendChat(); if (e.code === 'Escape') $('#chat-input').blur(); return; }
  keys.add(e.code);
  if (e.code === 'Space') { jumpAt = performance.now() / 1000; e.preventDefault(); }
  if (e.code === 'Enter') openChat();
  if (e.code === 'KeyT' && game.staff) $('#troll-btn').click();
  if (e.code === 'KeyR') die('reset');
  if (e.code === 'Escape') $('#troll-menu').classList.add('hidden');
});
addEventListener('keyup', (e) => keys.delete(e.code));

// pointer lock: click the world to capture the mouse, move it to look, Esc to release
let locked = false;
canvas.addEventListener('click', () => {
  if (!locked && $('#troll-menu').classList.contains('hidden') && !typing()) {
    canvas.requestPointerLock?.();
  }
});
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
canvas.addEventListener('mousedown', (e) => { if (!locked) { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', (e) => {
  if (locked) {
    orbit.yaw -= e.movementX * 0.0024; orbit.pitch += e.movementY * 0.0024;
    orbit.pitch = Math.max(-0.3, Math.min(1.3, orbit.pitch));
    return;
  }
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastX) * 0.005; orbit.pitch += (e.clientY - lastY) * 0.005;
  orbit.pitch = Math.max(-0.3, Math.min(1.3, orbit.pitch));
  lastX = e.clientX; lastY = e.clientY;
});
function unlock() { if (locked) document.exitPointerLock?.(); }
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.max(4, Math.min(20, orbit.dist + e.deltaY * 0.01)); }, { passive: false });

function readInput() {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const z = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  player.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  return { x, z, jump: keys.has('Space'), up: keys.has('Space'), down: keys.has('ControlLeft') || keys.has('KeyC') };
}

// chat
function openChat() { unlock(); $('#chat-input-row').classList.remove('hidden'); $('#chat-input').focus(); }
function sendChat() {
  const inp = $('#chat-input'); const text = inp.value.trim();
  if (text) net.send({ t: 'chat', text });
  inp.value = ''; inp.blur(); $('#chat-input-row').classList.add('hidden');
}
$('#chat-send').onclick = sendChat;

// ---------- mobile ----------
let mobileStick = null;
setupMobile();
function setupMobile() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  $('#move-cluster').classList.remove('hidden');
  const base = $('#joystick-base'), knob = $('#joystick-knob'); const stick = { x: 0, z: 0 };
  let touchId = null, cx = 0, cy = 0;
  const zone = $('#joystick-zone');
  zone.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; touchId = t.identifier; const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; }, { passive: true });
  zone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === touchId) {
      let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy), max = 50;
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.left = (35 + dx) + 'px'; knob.style.top = (35 + dy) + 'px';
      stick.x = dx / max; stick.z = -dy / max;
    }
  }, { passive: true });
  zone.addEventListener('touchend', () => { touchId = null; stick.x = stick.z = 0; knob.style.left = '35px'; knob.style.top = '35px'; }, { passive: true });
  $('#btn-jump').addEventListener('touchstart', () => keys.add('Space'), { passive: true });
  $('#btn-jump').addEventListener('touchend', () => keys.delete('Space'), { passive: true });
  mobileStick = stick;
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const time = serverTime || now / 1000;

  // animate course
  for (const f of spinFlags) f.rotation.y += dt * 1.5;
  for (const mm of moverMeshes) { const wp = moverPos(mm.spec, time); mm.mesh.position.set(wp.x, wp.y, wp.z); }
  for (const sm of spinnerMeshes) sm.pivot.rotation.y = spinAngle(sm.spec, time);

  // input + player
  const input = readInput();
  if (mobileStick) { input.x += mobileStick.x; input.z += mobileStick.z; }
  if (myAvatar.ctrl) {
    updatePlayer(dt, input, time);
    myAvatar.ctrl.setAnim(player.anim);
    myAvatar.ctrl.moveSpeed = Math.hypot(player.vel.x, player.vel.z);
    myAvatar.ctrl.update(dt);
    myAvatar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
    myAvatar.group.rotation.y = player.ry;
    sun.position.set(player.pos.x + 50, player.pos.y + 120, player.pos.z + 40);
    sun.target.position.set(player.pos.x, player.pos.y, player.pos.z);
  }
  updateCamera();
  updateTrollButton();

  // remote players
  for (const [, r] of remotes) {
    const s = r.interp.sample([3]);
    if (s) {
      r.group.position.set(s[0], s[1], s[2]); r.group.rotation.y = s[3];
      r.ctrl.setAnim(s[4]);
      r.ctrl.moveSpeed = s[4] === 'run' ? RUN : s[4] === 'walk' ? MOVE : 0;
    }
    r.ctrl.update(dt);
  }

  // lasers
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i]; L.ttl -= dt;
    const a = headPos(L.by), b = headPos(L.target);
    if (a && b) { orientBeam(L.beam, a, b); L.flash.position.copy(b); }
    L.beam.material.opacity = Math.max(0, L.ttl / 0.55) * 0.95;
    L.flash.intensity = Math.max(0, L.ttl / 0.55) * 6;
    if (L.ttl <= 0) { scene.remove(L.beam); scene.remove(L.flash); lasers.splice(i, 1); }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
(async function boot() {
  // if a course was designed for Obby in ClaudeBox Studio, make it live
  try {
    const { level } = await (await fetch('/api/level/obby')).json();
    applyCourse(toObbyCourse(level));   // null/empty → keeps the built-in course
  } catch {}
  buildCourse();
  player.pos = { x: START.x, y: START.y, z: START.z };

  identity = await loadIdentity();
  await preloadAvatars(['boy', 'girl']);
  myAvatar.ctrl = makeAvatar(identity.avatar || {});
  myAvatar.group = myAvatar.ctrl.group;
  scene.add(myAvatar.group);
  camera.position.set(START.x, START.y + 6, START.z + 10);
  net.connect();
  net.on('_open', () => {});
  net.join({ name: identity.name, avatar: identity.avatar });
  net.startMovementStream(() => {
    if (game.carried) return null;
    return { t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim };
  });
  requestAnimationFrame(frame);
  window.__obby = { net, player, remotes, game, scene, lasers };   // debug/test hook
})();
