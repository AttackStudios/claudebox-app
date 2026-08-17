// ClaudeBox Character Lab — a tuning bench for the character-movement games.
//
// The point of a lab is that the numbers you tune here are the numbers the game
// actually runs, so the physics below deliberately mirrors the obby controller
// (gravity, buffered jump, coyote time, instant ground accel) rather than being
// a tidier reimplementation that would feel different.
//
// It shows two kinds of readout, which is the useful part:
//   derived  — what the maths says the jump height/airtime/distance will be
//   measured — what the character ACTUALLY achieved on the course just now
// When those disagree, the tuning is fighting something (a ceiling, a slope,
// the step-up), and that gap is what you want to see while tuning.

import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { POSES } from '/shared/anim/humanoid.js';

const $ = (id) => document.getElementById(id);
const KEY = 'claudebox.movetune';

// ---- the tunable set. `why` is shown under each slider. ----
const KNOBS = [
  { id: 'G',       group: 'k-jump',  label: 'Gravity',        min: 10,  max: 200, step: 0.1,  def: 30,
    why: 'Higher = snappier arc. Roblox is 196.2 at a 5-stud character.' },
  { id: 'JUMP',    group: 'k-jump',  label: 'Jump velocity',  min: 4,   max: 45,  step: 0.05, def: 13.4,
    why: 'Launch speed, not height. Height is JUMP² / 2G.' },
  { id: 'MOVE',    group: 'k-speed', label: 'Walk speed',     min: 1,   max: 30,  step: 0.05, def: 7.8 },
  { id: 'RUN',     group: 'k-speed', label: 'Run speed',      min: 1,   max: 40,  step: 0.05, def: 11.5 },
  { id: 'STEP',    group: 'k-feel',  label: 'Step-up',        min: 0,   max: 2,   step: 0.01, def: 0.6,
    why: 'How high a ledge you walk onto without jumping. Roblox clears 0.4 character heights.' },
  { id: 'COYOTE',  group: 'k-feel',  label: 'Coyote time',    min: 0,   max: 0.4, step: 0.005, def: 0.1,
    why: 'Grace after stepping off a ledge. Roblox has none; it is pure kindness.' },
  { id: 'BUFFER',  group: 'k-feel',  label: 'Jump buffer',    min: 0,   max: 0.4, step: 0.005, def: 0.15,
    why: 'How early a press still counts when you land.' },
  { id: 'AIRCTL',  group: 'k-feel',  label: 'Air control',    min: 0,   max: 1,   step: 0.01, def: 1,
    why: '1 = full steering mid-air, which is what Roblox does. 0 = committed to your launch.' },
];

const PRESETS = {
  'Obby (live)':  { G: 30, JUMP: 13.4, MOVE: 7.8, RUN: 11.5, STEP: 0.6, COYOTE: 0.1, BUFFER: 0.15, AIRCTL: 1 },
  'Brookhaven':   { G: 26, JUMP: 11.5, MOVE: 7,   RUN: 12.5, STEP: 0.6, COYOTE: 0.1, BUFFER: 0.15, AIRCTL: 1 },
  // same jump height and distance as Obby, resolved in Roblox's 0.255s apex
  'Roblox tempo': { G: 92.16, JUMP: 23.49, MOVE: 13.67, RUN: 20.16, STEP: 0.76, COYOTE: 0.1, BUFFER: 0.15, AIRCTL: 1 },
  'Floaty':       { G: 18, JUMP: 11, MOVE: 7.8, RUN: 11.5, STEP: 0.6, COYOTE: 0.14, BUFFER: 0.18, AIRCTL: 1 },
};

const T = { ...PRESETS['Obby (live)'] };
try { Object.assign(T, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}

// ---- scene ----
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1020');
scene.fog = new THREE.Fog('#0b1020', 40, 120);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
scene.add(new THREE.HemisphereLight('#cfe4ff', '#20304a', 1.5));
const sun = new THREE.DirectionalLight('#fff6e0', 1.5); sun.position.set(12, 26, 8); scene.add(sun);

const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const plats = [];
function pad(x, y, z, w, d, color = '#2b3a5a', h = 1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z); scene.add(m);
  plats.push({ x, y, z, w, h, d });
  return m;
}
// a runway, a ladder of steps, and a spread of gaps — enough to answer
// "what can I actually clear at these numbers?"
pad(0, -0.5, 0, 26, 14, '#243350');
const GAPS = [2, 3, 4, 5, 6, 7, 8, 9];
let gx = 16;
const gapLabels = [];
for (const g of GAPS) { pad(gx, -0.5, 0, 4, 14, '#2b4a5a'); gapLabels.push({ x: gx, gap: g }); gx += 4 + g; }
pad(gx, -0.5, 0, 6, 14, '#2b4a5a');
const STEPS = [0.3, 0.6, 0.9, 1.2, 1.6, 2.0, 2.6];
STEPS.forEach((h, i) => pad(-14 - i * 3, -0.5 + h, 0, 3, 14, '#3a5a3a', 1));
for (let i = 0; i < 12; i++) pad(4, -0.5 + i * 1.0, -16 - i * 0.01, 8, 2, '#4a3a5a');   // a wall of ledges

// ---- player ----
const player = { pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), grounded: false, ry: 0 };
let avatar = null, body = 'boy', forcedPose = null;
async function setBody(b) {
  body = b;
  if (avatar) { scene.remove(avatar.group); avatar.dispose?.(); }
  avatar = makeAvatar({ body: b, shirt: 'tee', shirtColor: '#2f7fd0', shoes: 'sneakers', hair: 'short' });
  scene.add(avatar.group);
}

const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') { jumpAt = performance.now() / 1000; e.preventDefault(); } if (e.code === 'KeyR') reset(); });
addEventListener('keyup', (e) => keys.delete(e.code));
const orbit = { yaw: Math.PI, pitch: 0.28, dist: 9 };
let drag = null;
$('view').addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: orbit.yaw, pitch: orbit.pitch }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.yaw = drag.yaw - (e.clientX - drag.x) * 0.005;
  orbit.pitch = Math.max(-0.2, Math.min(1.2, drag.pitch + (e.clientY - drag.y) * 0.005));
});
addEventListener('wheel', (e) => { orbit.dist = Math.max(3, Math.min(28, orbit.dist + e.deltaY * 0.01)); }, { passive: true });

function reset() {
  player.pos.set(0, 0, 0); player.vel.set(0, 0, 0);
  peak = 0; measured = { h: 0, d: 0 }; bestGap = 0; bestStep = 0;
}

// ---- physics: mirrors the obby controller ----
let jumpAt = -1, coyoteUntil = 0;
let peak = 0, measured = { h: 0, d: 0 }, bestGap = 0, bestStep = 0;
let launch = null;   // {x,z,y} recorded when a jump starts, to measure the arc

function supportUnder(x, z, fromY) {
  let best = -Infinity;
  for (const p of plats) {
    if (x > p.x - p.w / 2 - 0.35 && x < p.x + p.w / 2 + 0.35 && z > p.z - p.d / 2 - 0.35 && z < p.z + p.d / 2 + 0.35) {
      const top = p.y + p.h / 2;
      if (top <= fromY + T.STEP && top > best) best = top;
    }
  }
  return best;
}

function step(dt) {
  const mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const mz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const len = Math.hypot(mx, mz) || 1;
  const yaw = orbit.yaw;
  const wishX = (-Math.sin(yaw) * mz + Math.cos(yaw) * mx) / len;
  const wishZ = (-Math.cos(yaw) * mz - Math.sin(yaw) * mx) / len;
  const moving = Math.hypot(mx, mz) > 0.05;
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const sp = sprint ? T.RUN : T.MOVE;

  // Air control is a blend toward the wished velocity rather than a hard set,
  // so 0 really does mean "committed to your launch".
  const k = player.grounded ? 1 : T.AIRCTL;
  player.vel.x += (wishX * sp - player.vel.x) * k;
  player.vel.z += (wishZ * sp - player.vel.z) * k;
  if (moving) player.ry = Math.atan2(wishX, wishZ);

  const prevY = player.pos.y;
  player.vel.y -= T.G * dt;
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;

  const wasAir = !player.grounded;
  const top = supportUnder(player.pos.x, player.pos.z, prevY);
  player.grounded = false;
  if (player.vel.y <= 0 && top > -Infinity && player.pos.y <= top && prevY >= top - 0.5) {
    if (wasAir && launch) {                       // an arc just finished — measure it
      measured.h = Math.max(measured.h, launch.peak - launch.y);
      measured.d = Math.max(measured.d, Math.hypot(player.pos.x - launch.x, player.pos.z - launch.z));
      for (const g of gapLabels) if (player.pos.x >= g.x - 2 && launch.x < g.x - 2) bestGap = Math.max(bestGap, g.gap);
      launch = null;
    }
    player.pos.y = top; player.vel.y = 0; player.grounded = true;
    bestStep = Math.max(bestStep, top + 0.5);
  }
  const nowS = performance.now() / 1000;
  if (player.grounded) coyoteUntil = nowS + T.COYOTE;
  if (jumpAt >= 0 && nowS - jumpAt < T.BUFFER && nowS < coyoteUntil) {
    player.vel.y = T.JUMP; player.grounded = false;
    coyoteUntil = 0; jumpAt = -1;
    launch = { x: player.pos.x, z: player.pos.z, y: player.pos.y, peak: player.pos.y };
    peak = player.pos.y;
  }
  if (player.pos.y > peak) peak = player.pos.y;
  if (launch && player.pos.y > launch.peak) launch.peak = player.pos.y;
  if (player.pos.y < -30) reset();

  if (avatar) {
    avatar.group.position.copy(player.pos);
    avatar.group.rotation.y = player.ry;
    avatar.moveSpeed = Math.hypot(player.vel.x, player.vel.z);
    avatar.setAnim(forcedPose || (!player.grounded ? (player.vel.y > 0.5 ? 'jump' : 'fall')
      : moving ? (sprint ? 'run' : 'walk') : 'idle'));
    avatar.update(dt);
  }
}

// ---- UI ----
function derived() {
  const h = T.JUMP * T.JUMP / (2 * T.G);
  const apex = T.JUMP / T.G, air = apex * 2;
  return { h, apex, air, dw: T.MOVE * air, dr: T.RUN * air };
}
function paintDerived() {
  const d = derived();
  const R_APEX = 0.2548;
  $('derived').innerHTML = `
    <div><span>jump height</span><b>${d.h.toFixed(3)}</b></div>
    <div><span>time to apex</span><b>${d.apex.toFixed(3)}s</b> <span class="cmp">roblox ${R_APEX.toFixed(3)}s</span></div>
    <div><span>airtime</span><b>${d.air.toFixed(3)}s</b></div>
    <div><span>jump distance (walk)</span><b>${d.dw.toFixed(2)}</b></div>
    <div><span>jump distance (run)</span><b>${d.dr.toFixed(2)}</b></div>`;
}
function buildKnobs() {
  for (const k of KNOBS) {
    const wrap = document.createElement('div'); wrap.className = 'sl';
    wrap.innerHTML = `<label>${k.label}<input class="num" id="n-${k.id}" value="${T[k.id]}"></label>
      <input type="range" id="s-${k.id}" min="${k.min}" max="${k.max}" step="${k.step}" value="${T[k.id]}">
      ${k.why ? `<div class="why">${k.why}</div>` : ''}`;
    $(k.group).appendChild(wrap);
    const s = $(`s-${k.id}`), n = $(`n-${k.id}`);
    const set = (v) => { T[k.id] = +v; s.value = v; n.value = (+v).toFixed(3).replace(/\.?0+$/, ''); paintDerived(); markPreset(); };
    s.addEventListener('input', () => set(s.value));
    n.addEventListener('change', () => set(n.value));
  }
}
function markPreset() {
  for (const b of $('presets').children) {
    const p = PRESETS[b.textContent];
    b.classList.toggle('on', !!p && Object.keys(p).every((k) => Math.abs(p[k] - T[k]) < 1e-6));
  }
}
function buildPresets() {
  for (const name of Object.keys(PRESETS)) {
    const b = document.createElement('button'); b.textContent = name;
    b.addEventListener('click', () => {
      Object.assign(T, PRESETS[name]);
      for (const k of KNOBS) { $(`s-${k.id}`).value = T[k.id]; $(`n-${k.id}`).value = T[k.id]; }
      paintDerived(); markPreset(); reset();
    });
    $('presets').appendChild(b);
  }
}
function buildBodies() {
  for (const b of ['boy', 'girl']) {
    const btn = document.createElement('button'); btn.textContent = b;
    btn.addEventListener('click', () => { setBody(b); for (const o of $('bodies').children) o.classList.toggle('on', o === btn); });
    $('bodies').appendChild(btn);
    if (b === 'boy') btn.classList.add('on');
  }
}
function buildPoses() {
  const names = ['auto', ...Object.keys(POSES)];
  for (const p of names) {
    const btn = document.createElement('button'); btn.textContent = p;
    btn.addEventListener('click', () => { forcedPose = p === 'auto' ? null : p; for (const o of $('poses').children) o.classList.toggle('on', o === btn); });
    $('poses').appendChild(btn);
    if (p === 'auto') btn.classList.add('on');
  }
}
$('apply').addEventListener('click', () => {
  localStorage.setItem(KEY, JSON.stringify(T));
  $('saved').classList.add('on'); setTimeout(() => $('saved').classList.remove('on'), 1800);
});
$('copy').addEventListener('click', () => navigator.clipboard?.writeText(JSON.stringify(T, null, 2)));
$('clear').addEventListener('click', () => { localStorage.removeItem(KEY); $('saved').textContent = 'override cleared'; $('saved').classList.add('on'); setTimeout(() => $('saved').classList.remove('on'), 1800); });

buildKnobs(); buildPresets(); buildBodies(); buildPoses(); paintDerived(); markPreset();
await preloadAvatars(['boy', 'girl']);
await setBody('boy');

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt);
  const w = innerWidth - 330, h = innerHeight;
  if (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const cp = Math.cos(orbit.pitch);
  camera.position.set(
    player.pos.x + Math.sin(orbit.yaw) * cp * orbit.dist,
    player.pos.y + 1.3 + Math.sin(orbit.pitch) * orbit.dist,
    player.pos.z + Math.cos(orbit.yaw) * cp * orbit.dist);
  camera.lookAt(player.pos.x, player.pos.y + 1.1, player.pos.z);
  renderer.render(scene, camera);

  $('speed').innerHTML = Math.hypot(player.vel.x, player.vel.z).toFixed(1) + '<small> U/S</small>';
  $('peak').textContent = peak.toFixed(2);
  $('mh').textContent = measured.h.toFixed(2);
  $('md').textContent = measured.d.toFixed(2);
  $('state').textContent = player.grounded ? 'grounded' : (player.vel.y > 0 ? 'rising' : 'falling');
  $('gap').textContent = bestGap ? bestGap.toFixed(0) : '—';
  $('step').textContent = bestStep > 0 ? bestStep.toFixed(2) : '—';
}
requestAnimationFrame(frame);
