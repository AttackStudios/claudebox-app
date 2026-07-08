// Rivals — first-person arena duels for ClaudeBox, modeled on the real thing:
// queue → map vote → TELEPORTING → freeze countdown → first to 5, with slide
// and Scythe-dash movement, hitscan gunplay, grenades, bots, and a podium.

import * as THREE from 'three';
import { Net } from './net.js';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { drawAvatarHead } from '/hub/avatarModel.js';
import { MOVE, WEAPONS, LOADOUT, ROUND } from '/shared/rivals/config.js';
import { MAPS, LOBBY } from '/shared/rivals/maps.js';

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
  fns: { startReload: (...a) => startReload(...a), switchWeapon: (...a) => switchWeapon(...a), setRight: (v) => { rightDown = !!v; } },
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
addEventListener('pointerdown', () => A(), { once: true });

// ============================ world building ============================
scene.add(new THREE.AmbientLight('#aeb8c8', 1.35));
const sun = new THREE.DirectionalLight('#fff2dc', 1.7);
sun.position.set(30, 60, 20); scene.add(sun);
const fill = new THREE.DirectionalLight('#8fb8e8', 0.5);
fill.position.set(-25, 30, -30); scene.add(fill);

let mapGroup = null;
let mapBoxes = [];
let rangeTargets = [];   // lobby shooting-range dummies

function buildMap(def) {
  if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  mapGroup = new THREE.Group();
  scene.background = new THREE.Color(def.sky);
  scene.fog = new THREE.FogExp2(def.sky, def.fog || 0.01);
  // ground
  const g = new THREE.Mesh(
    new THREE.BoxGeometry(def.ground.size, 1, def.ground.size),
    new THREE.MeshLambertMaterial({ color: def.ground.color })
  );
  g.position.y = -0.5;
  mapGroup.add(g);
  // boxes
  for (const b of def.boxes) {
    const mat = b.glow
      ? new THREE.MeshBasicMaterial({ color: b.color })
      : new THREE.MeshLambertMaterial({ color: b.color });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.sx, b.sy, b.sz), mat);
    mesh.position.set(b.x, b.y, b.z);
    mapGroup.add(mesh);
  }
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

canvas.addEventListener('click', () => { if (!locked) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const sens = 0.0021 * (me.ads > 0.5 ? (me.weapon === 'sniper' ? 0.32 : 0.7) : 1);
  me.ry -= e.movementX * sens;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * sens));
});

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyE' && game.phase === 'lobby') toggleModes();
  if (e.code === 'KeyR') startReload();
  if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) switchWeapon(LOADOUT[+e.code.slice(5) - 1]);
  if (e.code === 'ControlLeft' || e.code === 'KeyC') tryCrouch(true);
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'ControlLeft' || e.code === 'KeyC') tryCrouch(false);
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

function tryCrouch(on) {
  if (on) {
    const speed = Math.hypot(me.vel.x, me.vel.z);
    const sprinting = keys.has('ShiftLeft') && speed > MOVE.walk * 0.9;
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
  if (!frozen && locked) {
    mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    mz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  }
  const fx = -Math.sin(me.ry), fz = -Math.cos(me.ry);
  const rx = Math.cos(me.ry), rz = -Math.sin(me.ry);
  let wishX = fx * mz + rx * mx, wishZ = fz * mz + rz * mx;
  const wl = Math.hypot(wishX, wishZ) || 1; wishX /= wl; wishZ /= wl;
  const sprinting = keys.has('ShiftLeft') && mz > 0 && !me.crouch;
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
  if (keys.has('Space') && me.grounded && !frozen) { me.vel.y = MOVE.jumpVel; me.grounded = false; me.sliding = false; }

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

// an arm whose origin sits AT the hand (forearm trails back toward the body)
function mkArm() {
  const g = new THREE.Group();
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.34), vmMat(VM_SHIRT));
  fore.position.set(0, 0, 0.17);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.09, 0.11), vmMat(VM_SKIN));
  hand.position.set(0, 0, -0.05);
  g.add(fore, hand);
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
function buildViewmodels() {
  // assault rifle — gold/tan, right hand on grip, left on the foregrip
  {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.68), vmMat('#caa14e'));
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.3), vmMat('#2a2d33'));
    barrel.position.set(0, 0.03, -0.48);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.12), vmMat('#2a2d33'));
    mag.position.set(0, -0.15, -0.05);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.06), vmMat('#1c1f24'));
    sight.position.set(0, 0.1, -0.1);
    rigWeapon(g, [body, barrel, mag, sight],
      [0.05, -0.13, 0.24], [0.5, -0.12, 0], [-0.065, -0.085, -0.22], [0.35, 0.35, 0.1]);
    viewmodels.ar = g;
  }
  // handgun — dark, two-hand support grip
  {
    const g = new THREE.Group();
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.3), vmMat('#33373f'));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.09), vmMat('#22252b'));
    grip.position.set(0, -0.11, 0.08); grip.rotation.x = 0.25;
    rigWeapon(g, [slide, grip],
      [0.03, -0.15, 0.19], [0.45, 0, 0], [-0.055, -0.17, 0.15], [0.45, 0.3, 0.2]);
    viewmodels.handgun = g;
  }
  // scythe — both hands on the shaft
  {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.0), vmMat('#d07f2f'));
    handle.rotation.x = 0.5;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.14), vmMat('#23262c'));
    blade.position.set(-0.2, 0.22, -0.42);
    rigWeapon(g, [handle, blade],
      [0.04, -0.12, 0.26], [0.55, 0, 0.1], [-0.04, 0.05, -0.14], [0.2, 0.3, -0.2]);
    viewmodels.scythe = g;
  }
  // grenade — held up in the right hand, left hand guarding at chest height
  {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.17, 0.14), vmMat('#3f7d3f'));
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.05), vmMat('#8b93a5'));
    cap.position.y = 0.11;
    rigWeapon(g, [body, cap],
      [0.02, -0.12, 0.12], [0.6, 0, 0], [-0.15, -0.14, 0.02], [0.5, 0.45, 0.25]);
    viewmodels.grenade = g;
  }
  // sniper — long dark rifle with a scope tube, both hands committed
  {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.12, 0.85), vmMat('#3a3125'));
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), vmMat('#23262c'));
    barrel.position.set(0, 0.03, -0.64);
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 10), vmMat('#15181d'));
    scopeTube.rotation.x = Math.PI / 2; scopeTube.position.set(0, 0.115, -0.08);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.1), vmMat('#23262c'));
    mag.position.set(0, -0.12, 0.02);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.035), vmMat('#8b93a5'));
    bolt.position.set(0.07, 0.03, 0.09);
    rigWeapon(g, [body, barrel, scopeTube, mag, bolt],
      [0.05, -0.13, 0.26], [0.5, -0.1, 0], [-0.055, -0.1, -0.28], [0.35, 0.3, 0]);
    viewmodels.sniper = g;
  }
  for (const [k, g] of Object.entries(viewmodels)) { g.visible = false; g.scale.setScalar(0.68); viewRoot.add(g); }
}
buildViewmodels();
const VM_HIP = { x: 0.28, y: -0.24, z: -0.5 };
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
  sfx.click();
  setTimeout(() => tone(1000, 0.05, 'square', 0.07), 220);  // the "chk" as hands seat
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
  sfx.reload();
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
  if (!locked || me.dead) return;
  if (game.phase === 'freeze' || game.phase === 'vote' || game.phase === 'teleport' || game.phase === 'podium') return;
  const now = clockNow();
  const w = WEAPONS[me.weapon];
  if (me.weapon === 'scythe') {
    if (now - me.swingAt < WEAPONS.scythe.rate) return;
    me.swingAt = now;
    vmAnim.swingT = 0; vmAnim.swingSide *= -1;   // big alternating arcs
    sfx.swing();
    if (game.phase === 'live') net.send({ t: 'melee' });
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
  recoil += me.weapon === 'sniper' ? 0.045 : 0.012 + (me.weapon === 'handgun' ? 0.008 : 0.004);
  vmKick = me.weapon === 'sniper' ? 1.8 : 1;
  sfx.shot(me.weapon);
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
  others.set(f.id, { ctrl, plate, data: f, target: { ...f.pos, ry: f.ry || 0 } });
  ctrl.group.position.set(f.pos.x, f.pos.y, f.pos.z);
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
const WEAPON_ICONS = { ar: '🔫', handgun: '🔫', scythe: '🪓', grenade: '💣', sniper: '🔭' };
function updateLoadoutHud() {
  hud.loadout.innerHTML = '';
  LOADOUT.forEach((id, i) => {
    const s = document.createElement('div');
    s.className = 'slot' + (me.weapon === id ? ' active' : '');
    s.innerHTML = `<small>${i + 1}</small>${WEAPON_ICONS[id]}` + (id === 'grenade' ? `<span class="cnt">${me.grenades}</span>` : '');
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
  $('#freeze-count').classList.remove('hidden');
  hud.scoreA.textContent = game.score[game.myTeam];
  hud.scoreB.textContent = game.score[game.myTeam === 'A' ? 'B' : 'A'];
  chipAvatars($('#chip-a-av'), game.roster, game.myTeam);
  chipAvatars($('#chip-b-av'), game.roster, game.myTeam === 'A' ? 'B' : 'A');
  updateHpHud(); updateAmmoHud();
  banner(`ROUND ${msg.round}`, 900);
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
  sfx.distantShot();
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
  $('#podium').classList.add('hidden');
  updateAmmoHud(); updateLoadoutHud();
}

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
  const cn = clockNow();

  stepMe(dt);

  // auto fire
  if (mouseDown && WEAPONS[me.weapon]?.auto) tryFire();
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

    let px = VM_HIP.x + (VM_ADS.x - VM_HIP.x) * k + bobX + vmAnim.swayYaw * 0.16 * loose;
    let py = VM_HIP.y + (VM_ADS.y - VM_HIP.y) * k + bobY + vmAnim.swayPitch * 0.14 * loose
           + vmKick * 0.02 - vmAnim.landK * 0.11 + vmAnim.airK * 0.024 * loose;
    let pz = VM_HIP.z + (VM_ADS.z - VM_HIP.z) * k + vmKick * 0.07;
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
    // scythe swing: a huge horizontal arc, alternating sides
    if (me.weapon === 'scythe' && vmAnim.swingT < 1) {
      const s = Math.sin(Math.pow(vmAnim.swingT, 0.75) * Math.PI);
      rz += vmAnim.swingSide * -1.5 * s;
      ry2 += vmAnim.swingSide * 1.15 * s;
      rx += 0.35 * s;
      px += vmAnim.swingSide * -0.22 * s;
      pz -= 0.1 * s;
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
    let dry = o.target.ry - o.ctrl.group.rotation.y;
    while (dry > Math.PI) dry -= Math.PI * 2;
    while (dry < -Math.PI) dry += Math.PI * 2;
    o.ctrl.group.rotation.y += dry * Math.min(1, dt * 10);
    o.ctrl.setAnim(o.data.dead ? 'death' : (o.data.anim || 'idle'));
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
updateAmmoHud(); updateLoadoutHud(); updateHpHud();
net.connect();
net.join({ name: identity.name, avatar: identity.avatar });
net.startMovementStream(() => ({
  t: 'move',
  x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2),
  ry: +me.ry.toFixed(3), pitch: +me.pitch.toFixed(3),
  anim: me.dead ? 'death' : me.sliding ? 'run' : Math.hypot(me.vel.x, me.vel.z) > 0.5 ? (keys.has('ShiftLeft') ? 'run' : 'walk') : 'idle',
  crouch: me.crouch || me.sliding,
}));
$('#loading').classList.add('hidden');
$('#hud').classList.remove('hidden');
$('#lobby-tip').classList.remove('hidden');
window.ClaudeBox?.setName?.(identity.name);
frame();
