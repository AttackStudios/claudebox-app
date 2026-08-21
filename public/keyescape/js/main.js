// +1 Speed Keyboard Escape — a ClaudeBox original, built after the Roblox game
// of the same name (see its wiki for the stage list this follows).
//
// The loop: run across a giant keyboard, every fresh key you touch is +1 Speed
// and a click, and speed is the only thing that gets you past the later stages.

import * as THREE from 'three';
import { preloadAvatars, makeAvatar, useGameAnimations } from '/shared/avatar3d.js';
import { buildStage, WORLDS, stageAt } from '/keyescape/js/stages.js';
import { makeAudio } from '/keyescape/js/audio.js';
import { TRAILS, AURAS, MAX_REBIRTHS, rebirthReq, blankSave, trailOf, auraOf,
         rebirthMult, totalMult, actualSpeed, fmt, fmtMult } from '/keyescape/js/progress.js';

useGameAnimations('keyescape').catch(() => {});

const $ = (id) => document.getElementById(id);
const name = localStorage.getItem('claudebox.user') || '';
const hdrs = () => ({ 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' });

// ---------------------------------------------------------------- state
let save = blankSave();
let cur = { world: 1, n: 1 };
let stage = null;            // the built stage
let running = false;
let keysThisRun = 0, levelAtStart = 0, runStart = 0;
const audio = makeAudio();

async function loadSave() {
  if (!name) return;
  try {
    const r = await fetch(`/api/gamesave/keyescape?name=${encodeURIComponent(name)}`, { headers: hdrs() });
    const j = await r.json();
    if (j.data) save = { ...blankSave(), ...j.data };
  } catch {}
}
let saveT;
function persist() {
  if (!name) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    fetch('/api/gamesave', { method: 'POST', headers: hdrs(),
      body: JSON.stringify({ name, game: 'keyescape', data: save }) }).catch(() => {});
  }, 700);
}

// ---------------------------------------------------------------- scene
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
const hemi = new THREE.HemisphereLight('#ffffff', '#7a4a68', 1.45);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3e2', 1.5);
sun.position.set(30, 70, 20);
scene.add(sun);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- player
const player = { x: 0, y: 6, z: 0, vy: 0, ry: 0, grounded: false, dead: false, slide: 0 };
let avatar = null;

async function makePlayer() {
  await preloadAvatars(['boy', 'girl', 'r6']).catch(() => {});
  let profile = {};
  if (name) {
    try { profile = (await (await fetch(`/api/avatar/${encodeURIComponent(name)}`, { headers: hdrs() })).json()).avatar || {}; }
    catch {}
  }
  avatar = makeAvatar(profile);
  scene.add(avatar.group);
}

// The trail is a ribbon of fading pips — cheap, and it sells the speed.
const trailPips = [];
const trailGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
let trailT = 0;
function trailColour() {
  const t = trailOf(save);
  if (t.colour === 'rainbow') return new THREE.Color().setHSL((performance.now() / 900) % 1, 0.9, 0.62);
  return new THREE.Color(t.colour);
}
function emitTrail(dt) {
  if (save.trail === 'none') return;
  trailT -= dt;
  if (trailT > 0) return;
  trailT = 0.028;
  const m = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
    color: trailColour(), transparent: true, opacity: 0.85, depthWrite: false }));
  m.position.set(player.x, player.y + 1.1, player.z);
  scene.add(m);
  trailPips.push({ m, life: 0.55 });
  if (trailPips.length > 90) { const o = trailPips.shift(); scene.remove(o.m); o.m.material.dispose(); }
}
function updateTrail(dt) {
  for (let i = trailPips.length - 1; i >= 0; i--) {
    const p = trailPips[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); p.m.material.dispose(); trailPips.splice(i, 1); continue; }
    p.m.material.opacity = p.life * 1.5;
    p.m.scale.setScalar(0.35 + p.life);
  }
}
function clearTrail() {
  for (const p of trailPips) { scene.remove(p.m); p.m.material.dispose(); }
  trailPips.length = 0;
}

// The aura is a shell that hangs around you; it multiplies wins, so it should
// be visible enough to feel earned.
let auraMesh = null;
function refreshAura() {
  if (auraMesh) { scene.remove(auraMesh); auraMesh.material.dispose(); auraMesh.geometry.dispose(); auraMesh = null; }
  const a = auraOf(save);
  if (a.id === 'none' || !avatar) return;
  auraMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 18, 14),
    new THREE.MeshBasicMaterial({ color: a.colour, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.BackSide }));
  scene.add(auraMesh);
}

// ---------------------------------------------------------------- input
const held = new Set();
let jumpQueued = 0;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  held.add(k);
  if (k === ' ' || k === 'spacebar') { jumpQueued = 0.15; e.preventDefault(); }
  if (k === 'escape') { closeAll(); }
  audio.resume();
});
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());

const touch = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
function setupTouch() {
  if (!isTouch) return;
  $('stick').classList.remove('hidden');
  $('btn-jump').classList.remove('hidden');
  const stick = $('stick'), knob = $('stick-knob');
  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    const r = stick.getBoundingClientRect();
    touch.active = true; touch.id = t.identifier;
    touch.ox = r.left + r.width / 2; touch.oy = r.top + r.height / 2;
    e.preventDefault(); audio.resume();
  }, { passive: false });
  addEventListener('touchmove', (e) => {
    if (!touch.active) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.id) continue;
      const dx = t.clientX - touch.ox, dy = t.clientY - touch.oy;
      const d = Math.min(54, Math.hypot(dx, dy)) || 0;
      const a = Math.atan2(dy, dx);
      touch.dx = Math.cos(a) * (d / 54); touch.dy = Math.sin(a) * (d / 54);
      knob.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px)`;
    }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) if (t.identifier === touch.id) {
      touch.active = false; touch.dx = touch.dy = 0; knob.style.transform = '';
    }
  };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  $('btn-jump').addEventListener('touchstart', (e) => { jumpQueued = 0.15; e.preventDefault(); audio.resume(); }, { passive: false });
}

// ---------------------------------------------------------------- stage flow
function unload() {
  if (stage) { stage.dispose(); stage = null; }
  clearTrail();
}

function loadStage(world, n) {
  unload();
  const spec = stageAt(world, n);
  if (!spec) return;
  cur = { world, n };
  stage = buildStage(scene, spec);
  scene.background = new THREE.Color(stage.theme.sky);
  scene.fog = new THREE.Fog(stage.theme.fog, 90, 340);
  hemi.groundColor.set(stage.theme.base);
  respawn();
  keysThisRun = 0; levelAtStart = save.level; runStart = performance.now();
  $('stagename').textContent = `World ${world} · Stage ${n} — ${spec.title}`;
  running = true;
  $('hud').classList.remove('hidden');
  $('menu').classList.add('hidden');
  $('result').classList.add('hidden');
  refreshAura();
  hudSpeed();
}

function respawn() {
  if (!stage) return;
  player.x = stage.spawn.x; player.z = stage.spawn.z;
  player.y = stage.spawn.y + 2; player.vy = 0; player.dead = false;
  prevX = player.x; prevZ = player.z;
  clearTrail();
}

function die() {
  if (player.dead) return;
  player.dead = true;
  // Dying has to cost something or every hazard is just a short pause. You keep
  // the speed you arrived with — progress is never rolled back — but a third of
  // what you banked on this attempt is gone.
  const banked = save.level - levelAtStart;
  if (banked > 0) {
    const lost = Math.ceil(banked * 0.34);
    save.level -= lost;
    keysThisRun = Math.max(0, keysThisRun - lost);
    popup(`-${lost}`);
    hudSpeed();
  }
  audio.die();
  setTimeout(() => { if (stage) respawn(); }, 620);
}

function finish() {
  if (!stage || !running) return;
  running = false;
  const spec = stage.spec;
  const gained = Math.round(spec.wins * auraOf(save).mult);
  save.wins += gained;
  const key = `${cur.world}-${cur.n}`;
  if (!save.done.includes(key)) save.done.push(key);
  const secs = (performance.now() - runStart) / 1000;
  if (!save.best[key] || secs < save.best[key]) save.best[key] = secs;
  persist();
  audio.win();
  window.ClaudeBox?.completeChallenge?.('keyescape-first');
  if (save.done.length >= 5) window.ClaudeBox?.completeChallenge?.('keyescape-five');
  if (cur.world >= 2) window.ClaudeBox?.completeChallenge?.('keyescape-world2');

  $('rtitle').textContent = 'Stage Complete!';
  $('rsub').textContent = `${spec.title} — World ${cur.world}, Stage ${cur.n}`;
  $('rstats').innerHTML = `
    <div><b>+${fmt(gained)}</b><span>wins</span></div>
    <div><b>+${fmt(save.level - levelAtStart)}</b><span>speed</span></div>
    <div><b>${keysThisRun}</b><span>keys hit</span></div>
    <div><b>${secs.toFixed(1)}s</b><span>time</span></div>`;
  const nxt = nextStage();
  $('btn-next').textContent = nxt ? 'Next Stage ›' : 'Back to menu';
  $('result').classList.remove('hidden');
  hudWins();
}

function nextStage() {
  const w = WORLDS.find((x) => x.id === cur.world);
  if (cur.n < w.stages.length) return { world: cur.world, n: cur.n + 1 };
  const nw = WORLDS.find((x) => x.id === cur.world + 1);
  return nw ? { world: nw.id, n: 1 } : null;
}

const unlocked = (world, n) => {
  if (world === 1 && n === 1) return true;
  if (n > 1) return save.done.includes(`${world}-${n - 1}`);
  const prev = WORLDS.find((w) => w.id === world - 1);
  return prev ? save.done.includes(`${world - 1}-${prev.stages.length}`) : false;
};

// ---------------------------------------------------------------- HUD
const hudSpeed = () => {
  $('speed').textContent = fmt(save.level);
  $('rbmult').textContent = fmtMult(totalMult(save));
};
const hudWins = () => { $('wins').textContent = fmt(save.wins); };

let popT = 0;
function popup(text) {
  const now = performance.now();
  if (now - popT < 70) return;          // a popup per key would be a blizzard
  popT = now;
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = text;
  el.style.left = `${48 + Math.random() * 8}%`;
  el.style.top = `${52 + Math.random() * 8}%`;
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ---------------------------------------------------------------- panels
const closeAll = () => { $('stages').classList.add('hidden'); $('shop').classList.add('hidden'); };
document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));

let worldTab = 1;
function paintStages() {
  const tabs = $('worldtabs');
  tabs.innerHTML = '';
  for (const w of WORLDS) {
    const b = document.createElement('button');
    b.className = 'tab' + (w.id === worldTab ? ' on' : '');
    b.textContent = w.name;
    b.addEventListener('click', () => { worldTab = w.id; paintStages(); });
    tabs.appendChild(b);
  }
  const host = $('stagelist');
  host.innerHTML = '';
  const w = WORLDS.find((x) => x.id === worldTab);
  for (const s of w.stages) {
    const key = `${w.id}-${s.n}`;
    const open = unlocked(w.id, s.n);
    const done = save.done.includes(key);
    const el = document.createElement('div');
    el.className = 'scard' + (open ? '' : ' locked') + (done ? ' done' : '');
    // a little abstract keyboard as the thumbnail, tinted by the stage theme
    const th = { candy: ['#ff9fd6', '#c084fc'], chocolate: ['#a9744b', '#6f4425'], mint: ['#8ef0c8', '#4fc99a'] }[s.theme];
    let pips = '';
    for (let i = 0; i < 24; i++) {
      pips += `<i style="left:${(i % 8) * 12.5 + 1}%;top:${Math.floor(i / 8) * 33 + 4}%;width:10.5%;height:26%;background:${th[i % 2]}"></i>`;
    }
    el.innerHTML = `
      <div class="thumb" style="background:${s.theme === 'chocolate' ? '#4a2d15' : s.theme === 'mint' ? '#1f6b52' : '#7a2a63'}">${pips}</div>
      <div class="sn">Stage ${s.n}</div>
      <div class="st">${open ? s.title : '???'}</div>
      <div class="sm">
        <span class="pill ${s.diff.toLowerCase()}">${s.diff}</span>
        <span class="pill">🏆 ${fmt(s.wins)}</span>
        <span class="pill">⚡ ${fmt(s.rec)}</span>
      </div>
      ${done ? '<span class="badge">✅</span>' : open ? '' : '<span class="badge">🔒</span>'}`;
    if (open) el.addEventListener('click', () => { closeAll(); loadStage(w.id, s.n); });
    host.appendChild(el);
  }
}

let shopTab = 'trails';
document.querySelectorAll('[data-shop]').forEach((b) =>
  b.addEventListener('click', () => {
    shopTab = b.dataset.shop;
    document.querySelectorAll('[data-shop]').forEach((x) => x.classList.toggle('on', x === b));
    paintShop();
  }));

function paintShop() {
  $('shopwallet').innerHTML =
    `<span>🏆 <b>${fmt(save.wins)}</b> wins</span>
     <span>⚡ <b>${fmt(save.level)}</b> speed</span>
     <span>🔄 <b>${save.rebirths}</b> rebirths (${fmtMult(rebirthMult(save))})</span>`;
  const host = $('shoplist');
  host.innerHTML = '';

  if (shopTab === 'rebirth') {
    const n = save.rebirths;
    const req = rebirthReq(n);
    const can = n < MAX_REBIRTHS && save.level >= req;
    const el = document.createElement('div');
    el.className = 'scard' + (can ? '' : ' locked');
    el.style.gridColumn = '1 / -1';
    el.innerHTML = n >= MAX_REBIRTHS
      ? `<div class="st">All ${MAX_REBIRTHS} rebirths done</div><div class="sm">You are as fast as this keyboard goes.</div>`
      : `<div class="sn">Rebirth ${n + 1} of ${MAX_REBIRTHS}</div>
         <div class="st">Trade all your speed for +0.5x forever</div>
         <div class="sm">
           <span class="pill">Needs ⚡ ${fmt(req)}</span>
           <span class="pill">You have ⚡ ${fmt(save.level)}</span>
           <span class="pill">Now ${fmtMult(rebirthMult(save))} → ${fmtMult(rebirthMult(save) + 0.5)}</span>
         </div>`;
    if (can) el.addEventListener('click', () => {
      save.rebirths++; save.level = 0; persist();
      audio.rebirth(); paintShop(); hudSpeed();
      window.ClaudeBox?.completeChallenge?.('keyescape-rebirth');
    });
    host.appendChild(el);
    return;
  }

  const list = shopTab === 'trails' ? TRAILS : AURAS;
  const owned = shopTab === 'trails' ? save.trails : save.auras;
  const equipped = shopTab === 'trails' ? save.trail : save.aura;
  for (const it of list) {
    const has = owned.includes(it.id);
    const on = equipped === it.id;
    const el = document.createElement('div');
    el.className = 'scard' + (has ? ' owned' : '') + (on ? ' equipped' : '');
    const swatch = it.colour === 'rainbow'
      ? 'linear-gradient(90deg,#ff5e5e,#ffd35c,#3ddc84,#4aa8ff,#a855f7)' : it.colour;
    el.innerHTML = `
      <div class="thumb" style="background:${swatch}"></div>
      <div class="st">${it.name}</div>
      <div class="sm">
        <span class="pill">${shopTab === 'trails' ? '⚡' : '🏆'} ${fmtMult(it.mult)}</span>
        ${has ? `<span class="pill">${on ? 'Equipped' : 'Owned'}</span>` : `<span class="pill price">🏆 ${fmt(it.cost)}</span>`}
      </div>`;
    el.addEventListener('click', () => {
      if (has) {
        if (shopTab === 'trails') save.trail = it.id; else { save.aura = it.id; refreshAura(); }
        audio.buy();
      } else if (save.wins >= it.cost) {
        save.wins -= it.cost;
        owned.push(it.id);
        if (shopTab === 'trails') save.trail = it.id; else { save.aura = it.id; refreshAura(); }
        audio.buy();
        window.ClaudeBox?.completeChallenge?.('keyescape-upgrade');
      } else { return; }
      persist(); paintShop(); hudSpeed(); hudWins();
    });
    host.appendChild(el);
  }
}

$('btn-stages').addEventListener('click', () => { paintStages(); $('stages').classList.remove('hidden'); });
$('btn-menu-stages').addEventListener('click', () => { paintStages(); $('stages').classList.remove('hidden'); });
$('btn-shop').addEventListener('click', () => { paintShop(); $('shop').classList.remove('hidden'); });
$('btn-menu-shop').addEventListener('click', () => { paintShop(); $('shop').classList.remove('hidden'); });
$('btn-mute').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
});
$('btn-play').addEventListener('click', () => { audio.init(); firstUnbeaten(); });
$('btn-retry').addEventListener('click', () => { $('result').classList.add('hidden'); loadStage(cur.world, cur.n); });
$('btn-next').addEventListener('click', () => {
  const n = nextStage();
  $('result').classList.add('hidden');
  if (n) loadStage(n.world, n.n);
  else { running = false; $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); }
});

function firstUnbeaten() {
  for (const w of WORLDS) for (const s of w.stages) {
    if (!save.done.includes(`${w.id}-${s.n}`) && unlocked(w.id, s.n)) return loadStage(w.id, s.n);
  }
  loadStage(1, 1);
}

// ---------------------------------------------------------------- loop
const GRAV = -84, JUMP_V = 25.5;
let last = performance.now();
// yaw = PI puts forward at +Z, which is the direction the board runs
const orbit = { yaw: Math.PI, pitch: 0.34, dist: 19 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (stage) {
    stage.field.update(dt);
    for (const h of stage.hazards) h.update(dt, player, stage.field);
  }
  player.speed = fastNow;   // hazards pace themselves off this
  if (running && stage && !player.dead) step(dt);
  updateTrail(dt);
  updateCamera(dt);

  if (avatar) {
    avatar.group.position.set(player.x, player.y, player.z);
    avatar.group.rotation.y = player.ry;
    avatar.setAnim(!player.grounded ? (player.vy > 0 ? 'jump' : 'fall')
                 : (moving ? (fastNow > 26 ? 'run' : 'walk') : 'idle'));
    avatar.moveSpeed = fastNow;
    avatar.update(dt);
    if (auraMesh) auraMesh.position.set(player.x, player.y + 1.4, player.z);
  }
  renderer.render(scene, camera);
}

let moving = false, fastNow = 12;
let prevX = 0, prevZ = 0;   // last frame's position, for the swept key test
function step(dt) {
  const sp = actualSpeed(save);
  fastNow = sp;

  // ---- intent ----
  let ix = 0, iz = 0;
  if (held.has('a') || held.has('arrowleft')) ix -= 1;
  if (held.has('d') || held.has('arrowright')) ix += 1;
  if (held.has('w') || held.has('arrowup')) iz += 1;
  if (held.has('s') || held.has('arrowdown')) iz -= 1;
  if (touch.active) { ix += touch.dx; iz -= touch.dy; }
  const mag = Math.hypot(ix, iz);
  moving = mag > 0.08;
  if (moving) { ix /= mag; iz /= mag; }

  // Camera-relative, using Obby's exact basis. Doing this in world axes is what
  // made left and right come out swapped: the camera looks down +Z, and under a
  // right-handed basis +X is then screen-LEFT, so pushing right walked you left.
  const yaw = orbit.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);      // forward, away from the camera
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);       // camera-right
  const wx = fx * iz + rx * ix;
  const wz = fz * iz + rz * ix;
  if (moving) {
    player.x += wx * sp * dt;
    player.z += wz * sp * dt;
    player.ry = Math.atan2(wx, wz);
  }

  // ---- ground ----
  let ground = stage.field.heightAt(player.x, player.z);
  for (const h of stage.hazards) {
    if (h.surfaceAt) { const s = h.surfaceAt(player.x, player.z); if (s != null && (ground == null || s > ground)) ground = s; }
  }
  for (const pad of stage.rests) {
    if (Math.abs(player.x - pad.position.x) < 3.5 && Math.abs(player.z - pad.position.z) < 4)
      ground = Math.max(ground ?? -99, pad.position.y + 0.5);
  }
  // a dissolving section is simply not there while it is gone
  for (const h of stage.hazards) if (h.kind === 'dissolve' && h.gone && h.covers(player.z)) ground = null;

  jumpQueued = Math.max(0, jumpQueued - dt);
  if (player.grounded && jumpQueued > 0) { player.vy = JUMP_V; player.grounded = false; jumpQueued = 0; audio.jump(); }

  player.vy += GRAV * dt;
  player.y += player.vy * dt;

  if (ground != null && player.y <= ground + 0.05 && player.vy <= 0) {
    if (!player.grounded && player.vy < -18) audio.land();
    player.y = ground; player.vy = 0; player.grounded = true;
  } else player.grounded = false;

  // ---- keys ----
  // Sweep the whole path walked this frame. Every cap crossed counts, however
  // fast you are moving; only the click is rationed, because forty at once is
  // noise rather than feedback.
  if (player.grounded) {
    const fresh = stage.field.pressSegment(prevX, prevZ, player.x, player.z);
    if (fresh.length) {
      save.level += fresh.length;
      keysThisRun += fresh.length;
      const pan = ((player.x / stage.width) - 0.5) * 1.6;
      const rush = Math.min(1, sp / 90);
      for (let i = 0; i < Math.min(fresh.length, 4); i++) audio.key(pan + (i - 1.5) * 0.12, rush);
      if (Math.floor(keysThisRun / 10) !== Math.floor((keysThisRun - fresh.length) / 10)) audio.levelUp();
      popup(fresh.length > 1 ? `+${fresh.length}` : '+1');
      hudSpeed();
      $('combo').classList.remove('hidden');
      $('combonum').textContent = keysThisRun;
      if (keysThisRun % 25 < fresh.length) persist();
    }
  }
  prevX = player.x; prevZ = player.z;

  // ---- bounds, death, finish ----
  const half = stage.width / 2;
  player.x = Math.max(stage.midX - half - 2, Math.min(stage.midX + half + 2, player.x));
  player.z = Math.max(-4, Math.min(stage.length + 8, player.z));
  if (player.y < -22) die();
  for (const h of stage.hazards) if (h.hits && h.hits(player)) { die(); break; }
  if (player.z >= stage.goal.z - 1) finish();

  $('progfill').style.width = `${Math.max(0, Math.min(100, (player.z / stage.goal.z) * 100))}%`;
  emitTrail(dt);
}

function updateCamera(dt) {
  // Same orbit rig as Obby and Backpacking: you own the camera, it does not own
  // you. Yaw/pitch from the mouse or a finger, distance from the wheel or a
  // pinch, and the player runs relative to wherever you are looking.
  const s = 1;
  const dist = orbit.dist * s;
  const tx = player.x, ty = player.y + 2.2 * s, tz = player.z;
  const cp = Math.cos(orbit.pitch);
  const cx = tx + Math.sin(orbit.yaw) * cp * dist;
  const cy = ty + Math.sin(orbit.pitch) * dist;
  const cz = tz + Math.cos(orbit.yaw) * cp * dist;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 12));
  camera.lookAt(tx, ty, tz);
  // a gentle widening as you gather speed — enough to feel it, not enough to
  // fight the framing you chose
  const fov = 62 + Math.min(14, fastNow * 0.13);
  if (Math.abs(camera.fov - fov) > 0.2) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
}

// ---- camera input (mouse, pointer lock, wheel, touch) ----
let dragging = false, lastX = 0, lastY = 0, locked = false;
canvas.addEventListener('click', () => {
  if (!locked && $('stages').classList.contains('hidden') && $('shop').classList.contains('hidden')
      && $('result').classList.contains('hidden') && $('menu').classList.contains('hidden')) {
    try { canvas.requestPointerLock?.(); } catch {}   // unavailable in some embeds
  }
});
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
canvas.addEventListener('mousedown', (e) => { if (!locked) { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
addEventListener('mouseup', () => { dragging = false; });
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
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.dist = Math.max(4, Math.min(46, orbit.dist + e.deltaY * 0.02));
}, { passive: false });

// Only the touches that BEGAN on the canvas count, so the finger parked on the
// joystick never turns a look-drag into a pinch. One finger looks, two zoom.
const camTouches = new Map();
let pinchGap = 0;
const gapOf = () => { const [a, b] = [...camTouches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
canvas.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) camTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
  if (camTouches.size === 2) pinchGap = gapOf();
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    const p = camTouches.get(t.identifier);
    if (!p) continue;
    if (camTouches.size === 1) {
      orbit.yaw -= (t.clientX - p.x) * 0.006;
      orbit.pitch += (t.clientY - p.y) * 0.006;
      orbit.pitch = Math.max(-0.3, Math.min(1.3, orbit.pitch));
    }
    p.x = t.clientX; p.y = t.clientY;
  }
  if (camTouches.size === 2) {
    const gap = gapOf();
    if (pinchGap > 0 && gap > 0) orbit.dist = Math.max(4, Math.min(46, orbit.dist * (pinchGap / gap)));
    pinchGap = gap;
  }
}, { passive: true });
const camEnd = (e) => { for (const t of e.changedTouches) camTouches.delete(t.identifier); if (camTouches.size < 2) pinchGap = 0; };
canvas.addEventListener('touchend', camEnd, { passive: true });
canvas.addEventListener('touchcancel', camEnd, { passive: true });

// ---------------------------------------------------------------- boot
(async () => {
  await loadSave();
  await makePlayer();
  setupTouch();
  hudSpeed(); hudWins();
  refreshAura();
  audio.init().catch(() => {});
  $('loading').classList.add('hidden');
  requestAnimationFrame(frame);
  // a debug handle, matching the convention the other ClaudeBox games use
  window.__key = {
    get save() { return save; }, get player() { return player; }, get stage() { return stage; },
    load: loadStage, speed: () => actualSpeed(save), get orbit() { return orbit; },
    give(w) { save.wins += w; hudWins(); paintShop?.(); },
  };
})();
