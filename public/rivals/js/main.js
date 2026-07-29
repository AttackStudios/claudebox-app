// Rivals — first-person arena duels for ClaudeBox, modeled on the real thing:
// queue → map vote → TELEPORTING → freeze countdown → first to 5, with slide
// and Scythe-dash movement, hitscan gunplay, grenades, bots, and a podium.

import * as THREE from 'three';
import { Net } from './net.js';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { makeR6, R6_DEFAULT, preloadR6 } from '/shared/r6.js';
import { drawAvatarHead } from '/hub/avatarModel.js';
import { MOVE, WEAPONS, LOADOUT, ROUND } from '/shared/rivals/config.js';
import { SKINS, SKIN_BY_ID, SKINS_BY_WEAPON, SKIN_WEAPONS, RARITY_COLOR, CASE_PRICE } from '/shared/rivals/skins.js';
import { MAPS, LOBBY, RANGE } from '/shared/rivals/maps.js';
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
  phase: 'lobby',          // lobby | vote | teleport | freeze | live | roundEnd | podium | break (wave)
  mapId: 'lobby',
  roster: [],              // match.start roster
  myTeam: 'A',
  score: { A: 0, B: 0 },
  stateUntil: 0,
  queued: null, queuedSince: 0,
  gotFirstElim: false,
  loadout: null,           // wave mode: the guns you actually own (null = standard LOADOUT)
  waveMode: false, wave: 0, waveTotal: 10, botsLeft: 0,
};
// the player's chosen loadout: [primary, secondary, melee, utility] on keys 1-4
let myPickedLoadout = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('rivals.loadout') || 'null');
    if (Array.isArray(saved) && saved.every((id) => WEAPONS[id])) return saved;
  } catch {}
  return ['ar', 'handgun', 'scythe', 'grenade'];
})();
const myLoadout = () => game.loadout || myPickedLoadout;

// what device is this player on? (shown next to names in duels)
function platformKind() {
  const ua = navigator.userAgent;
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const short = Math.min(screen.width, screen.height);
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'tablet';
  if (touch && short >= 700) return 'tablet';
  if (/iPhone|Android/.test(ua) || touch) return 'phone';
  if (/Macintosh|Mac OS X/.test(ua)) return 'laptop';
  return 'pc';
}
const PLATFORM_ICONS = { phone: '📱', tablet: '📱', laptop: '💻', pc: '🖥️' };
const platIcon = (k) => (k ? `<span class="plat" title="Playing on ${k}">${PLATFORM_ICONS[k] || ''}${k === 'tablet' ? '⁺' : ''}</span>` : '');
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
let placedPads = [];     // deployed jump pads: { id, x,y,z, nx,ny,nz, group, core, cd }
let localPadSeq = 0;     // ids for client-only practice-arena pads
let localNades = [];     // client-only grenades/satchels thrown in the practice arena
let clawTrails = [];     // white transparent cat-paw claw slashes
const PRACTICE_CLEAR_SECS = 300;   // practice arena wipes placed pads/objects every 5 min
let lobbyClearAt = 0;
let rangeTargets = [];   // lobby shooting-range dummies

// Ray against the current map's meshes → { point, normal } of the first hit,
// or null. Used to stick a jump pad to whatever surface you aim at.
const _padRC = new THREE.Raycaster();
function raycastMap(origin, dir, maxDist) {
  if (!mapGroup) return null;
  _padRC.set(origin, new THREE.Vector3(dir.x, dir.y, dir.z).normalize());
  _padRC.far = maxDist;
  const hits = _padRC.intersectObject(mapGroup, true);
  for (const h of hits) {
    if (!h.face) continue;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
    return { point: h.point, normal: n };
  }
  return null;
}

// A Rivals-style jump pad, oriented so its face points along `normal` (so it
// sticks flat on floors, walls or ceilings and launches you outward).
function buildPad(px, py, pz, normal) {
  const group = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 2.4), new THREE.MeshLambertMaterial({ color: '#aebccd' }));
  plate.position.y = 0.15; group.add(plate);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 0.6), new THREE.MeshLambertMaterial({ color: '#c6d3e2' }));
    c.position.set(sx * 0.9, 0.21, sz * 0.9); group.add(c);
  }
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.34, 0.95), new THREE.MeshBasicMaterial({ color: '#6fd8ff' }));
  core.position.y = 0.18; group.add(core);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 1.15), new THREE.MeshBasicMaterial({ color: '#37e0ff' }));
    bar.position.set(Math.cos(a) * 0.78, 0.19, Math.sin(a) * 0.78);
    bar.rotation.y = a + Math.PI / 4;
    group.add(bar);
  }
  group.position.set(px, py, pz);
  // aim the pad's local +Y along the surface normal
  if (normal) group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(normal.x, normal.y, normal.z).normalize());
  return { group, core };
}

function buildMap(def) {
  if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
  mapGroup = new THREE.Group();
  const panels = def.id !== 'lobby';
  // gradient sky + horizon-matched fog
  const sky = def.sky2 || [def.sky, def.sky, def.sky];
  scene.background = skyTex(sky[0], sky[1], sky[2]);
  scene.fog = new THREE.FogExp2(sky[2], def.fog || 0.01);
  // ground — textured grid with a soft centre glow (flat colour for the lobby)
  const gW = def.ground.sizeX || def.ground.size, gL = def.ground.sizeZ || def.ground.size;
  const gt = def.ground.tex;
  const gmat = gt
    ? (() => { const t = groundTex(gt[0], gt[1], gt[2]); t.repeat.set(gW / 8, gL / 8); return new THREE.MeshLambertMaterial({ color: '#ffffff', map: t }); })()
    : new THREE.MeshLambertMaterial({ color: def.ground.color });
  // a floating platform gets real thickness so you see its underside edge
  const gThick = def.ground.thick || 1;
  const g = new THREE.Mesh(new THREE.BoxGeometry(gW, gThick, gL), gmat);
  g.position.y = -gThick / 2;
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
    if (b.invisible) continue;   // out-of-bounds barrier: solid but not drawn
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
      // -90° (not +90°) so the visible slope runs the SAME way as the ramp's
      // collision surface (rampSurfaceY) — +90° mirrored it along z.
      if (axis === 'z') wedge.rotation.y = -Math.PI / 2;
      mapGroup.add(wedge);
      continue;
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.sx, b.sy, b.sz), mat);
    mesh.position.set(b.x, b.y, b.z);
    if (b.ry) mesh.rotation.y = b.ry;   // cosmetic yaw (collision stays AABB)
    mapGroup.add(mesh);
  }
  // flat, bright, even light in matches (like the original's arenas)
  ambientLight.intensity = panels ? 1.7 : 1.1;
  sun.intensity = panels ? 1.0 : 1.4;
  fill.intensity = panels ? 0.5 : 0.5;
  hemi.intensity = panels ? 0.9 : 0.35;
  hemi.color.set(sky[0]); hemi.groundColor.set(def.ground.color);
  // the lobby is the FACILITY — warm hall lights, purple duels glow, range light
  if (def.id === 'lobby') {
    ambientLight.intensity = 2.1; hemi.intensity = 0.9;   // the facility is well-lit like the original
    const l1 = new THREE.PointLight('#fff2dc', 26, 30); l1.position.set(0, 6.5, 0);
    const l1b = new THREE.PointLight('#fff2dc', 22, 30); l1b.position.set(0, 6.5, -22);
    const l2 = new THREE.PointLight('#b06aff', 24, 22); l2.position.set(-15, 6, 0);      // duels alcove
    const l3 = new THREE.PointLight('#ffe9a8', 26, 30); l3.position.set(24, 6.5, 3);     // range
    const l4 = new THREE.PointLight('#ffca7a', 30, 30); l4.position.set(0, 7, -42);      // wood hall
    mapGroup.add(l1, l1b, l2, l3, l4);
    // canvas sign helper
    const sign = (w, h, draw) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
      draw(c.getContext('2d'), c.width, c.height);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
    };
    const text = (x2, W2, H2, label, bg, fg, size) => { if (bg) { x2.fillStyle = bg; x2.fillRect(0, 0, W2, H2); } x2.fillStyle = fg; x2.font = `italic 900 ${size || 110}px Arial Black, sans-serif`; x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.fillText(label, W2 / 2, H2 / 2 + 6); };
    // DUELS — purple tilted sign over the alcove opening
    const duels = sign(7, 2.2, (x2, W2, H2) => { text(x2, W2, H2, 'DUELS', '#7a2fe0', '#fff'); x2.strokeStyle = '#fff'; x2.lineWidth = 10; x2.strokeRect(6, 6, W2 - 12, H2 - 12); });
    duels.position.set(-8.6, 6.6, 0); duels.rotation.y = Math.PI / 2; duels.rotation.z = 0.07; mapGroup.add(duels);
    // SHOOTING RANGE — yellow sign over the east opening
    const range = sign(8, 1.8, (x2, W2, H2) => { text(x2, W2, H2, 'SHOOTING RANGE', '#e8c83a', '#16181e', 64); });
    range.position.set(8.6, 6.6, 3); range.rotation.y = -Math.PI / 2; mapGroup.add(range);
    // RIVALS logo — end of the wood hall
    const logo = sign(14, 3.4, (x2, W2, H2) => { text(x2, W2, H2, 'RIVALS', null, '#fff'); x2.strokeStyle = 'rgba(0,0,0,.35)'; x2.lineWidth = 8; x2.strokeText('RIVALS', W2 / 2, H2 / 2 + 6); });
    logo.position.set(0, 6, -51.9); mapGroup.add(logo);
    // WIN STREAKS leaderboard — alcove south wall
    const board = sign(6.5, 4.6, (x2, W2, H2) => {
      x2.fillStyle = '#14161c'; x2.fillRect(0, 0, W2, H2);
      x2.fillStyle = '#ffd24a'; x2.font = 'italic 900 54px Arial Black'; x2.textAlign = 'center'; x2.fillText('WIN STREAKS', W2 / 2, 64);
      x2.font = '700 34px Arial'; x2.textAlign = 'left';
      ['AttackFace15', 'KitKat', 'EmGamerOG', 'Declan', 'LilBugTrainer'].forEach((n, i) => {
        x2.fillStyle = i === 0 ? '#ffd24a' : '#cfd6e2'; x2.fillText(`${i + 1}.  ${n}`, 40, 130 + i * 48);
        x2.fillStyle = '#6ee7a0'; x2.textAlign = 'right'; x2.fillText(`${9 - i * 2}🔥`, W2 - 40, 130 + i * 48); x2.textAlign = 'left';
      });
    });
    board.position.set(-15, 3.6, 7.9); board.rotation.y = Math.PI; mapGroup.add(board);
    // kiosk screen
    const kioskScr = sign(1.5, 1.1, (x2, W2, H2) => { x2.fillStyle = '#0c0e12'; x2.fillRect(0, 0, W2, H2); for (let i = 0; i < 8; i++) { x2.fillStyle = ['#e04a9a', '#38b6e8', '#ffd24a', '#6ee7a0'][i % 4]; x2.fillRect(30 + (i % 4) * 115, 40 + Math.floor(i / 4) * 130, 90, 100); } });
    kioskScr.position.set(4.9, 1.9, -24); kioskScr.rotation.y = -Math.PI / 2; mapGroup.add(kioskScr);
    // ---- QUEUE PADS: walk on to queue (the original's duel pads) ----
    lobbyPads = [];
    const PAD_DEFS = [
      { mode: 'beginner', label: '🎓 Beginner', color: '#6ee7a0', x: -12, z: -3.8 },
      { mode: 'duo', label: '⚔️ 1v1', color: '#38b6e8', x: -18, z: -3.8 },
      { mode: 'squad', label: '👥 2v2', color: '#ff7eb6', x: -18, z: 3.8 },
      { mode: 'wave', label: '🌊 Waves', color: '#b06aff', x: -12, z: 3.8 },
    ];
    for (const pd of PAD_DEFS) {
      const g2 = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.75, 0.16, 26), new THREE.MeshLambertMaterial({ color: '#cfe8ff' }));
      disc.position.y = 0.08;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.09, 8, 26), new THREE.MeshBasicMaterial({ color: pd.color }));
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.18;
      const lbl = sign(2.6, 0.7, (x2, W2, H2) => text(x2, W2, H2, pd.label, 'rgba(12,14,20,.85)', pd.color, 64));
      lbl.position.y = 2.6;
      g2.add(disc, rim, lbl);
      g2.position.set(pd.x, 0, pd.z);
      mapGroup.add(g2);
      lobbyPads.push({ ...pd, rim, holdT: 0 });
    }
  }
  // deployed jump pads reset on map change (they're placed live via the net)
  clearPads();
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
let lobbyPads = [];
let padQueueCd = 0;
// zone: 'lobby' = third-person social space (no guns), 'range' = FPS practice
game.zone = 'lobby';
const lobbyCam = { yaw: 0, pitch: 0.25, dist: 6.5, dragging: false };   // camera starts BEHIND the spawn, looking down the carpet
let myR6 = null;
function ensureMyR6() {
  if (myR6) return myR6;
  myR6 = makeR6(myR6Profile);
  scene.add(myR6.group);
  return myR6;
}
const inLobbyMode = () => game.phase === 'lobby' && game.zone === 'lobby';

canvas.addEventListener('click', () => { if (!locked && !isTouch && !inLobbyMode() && !bfe.open) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', (e) => {
  if (typeof bfeRecActive === 'function' && bfeRecActive()) {   // recording: mouse IS the knife
    const R = bfeRec.vals, lim = 2.1;
    if (bfeRec.twist) R.pRz = Math.max(-lim, Math.min(lim, R.pRz + e.movementX * 0.005));
    else R.pRy = Math.max(-lim, Math.min(lim, R.pRy + e.movementX * 0.005));
    R.pRx = Math.max(-lim, Math.min(lim, R.pRx + e.movementY * 0.005));
    return;
  }
  if (inLobbyMode()) {
    if (lobbyCam.dragging) {
      lobbyCam.yaw -= e.movementX * 0.007;
      lobbyCam.pitch = Math.max(-0.15, Math.min(1.1, lobbyCam.pitch + e.movementY * 0.006));
    }
    return;
  }
  if (!locked) return;
  // scoped/ADS look speed is nerfed in proportion to the zoom — the more
  // zoomed in you are, the slower the camera turns (sniper slows the most)
  const w = WEAPONS[me.weapon];
  const zoom = (me.ads > 0.02 && w && w.adsZoom) ? w.adsZoom : 1;
  const sens = 0.0021 * (1 - me.ads * (1 - 1 / zoom));
  me.ry -= e.movementX * sens;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * sens));
});

// ---------------- rebindable keybinds ----------------
const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft', reload: 'KeyR', queue: 'KeyE', inspect: 'KeyF',
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
let devTools = (() => { try { return localStorage.getItem('rivals.devtools') === '1'; } catch { return false; } })();
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
  for (let i = 1; i <= 6; i++) if (c === binds['weapon' + i]) switchWeapon(myLoadout()[i - 1]);
  if (c === binds.sprint || c === binds.crouch) tryCrouch(true);   // Shift OR Ctrl = slide/crouch
  if (c === binds.jump) tryAirJump();                              // Daggers: mid-air double jump
  if (c === (binds.inspect || 'KeyF') && !me.dead && !me.reloading
      && vmAnim.bfInspectT >= 1 && vmAnim.swingT >= 1 && vmAnim.bfStabT >= 1 && vmAnim.equipT >= 1 && vmAnim.throwT >= 1) {
    vmAnim.inspectDur = INSPECT_DUR[inspectClassFor(me.weapon)];   // every weapon gets an inspect
    vmAnim.bfInspectT = 0; vmAnim.bfInspectPrev = 0;
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === binds.sprint) tryCrouch(false);
  if (e.code === binds.crouch) tryCrouch(false);
});

let mouseDown = false, rightDown = false;
addEventListener('mousedown', (e) => {
  if (inLobbyMode()) {
    if (e.button === 2) { if (typeof bfe !== 'undefined' && bfe.open) return; lobbyCam.dragging = true; try { canvas.requestPointerLock?.(); } catch {} }
    return;
  }
  if (!locked) return;
  if (e.button === 0) { mouseDown = true; tryFire(); }
  if (e.button === 2) { rightDown = true; onRightDown(); }
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) { if (inLobbyMode() && lobbyCam.dragging) { try { document.exitPointerLock?.(); } catch {} } lobbyCam.dragging = false; }
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
      const sens = 0.006 * (me.ads > 0.5 ? (WEAPONS[me.weapon]?.scoped ? 0.5 : 0.72) : 1);
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
  // warmup arena: keep fire/jump/crouch up in the lobby (shoot + slide freely)
  // but drop aim/reload there so the small screen doesn't get crowded
  for (const id of ['#m-fire', '#m-jump', '#m-crouch'])
    $(id).style.display = 'flex';
  for (const id of ['#m-aim', '#m-reload'])
    $(id).style.display = lobby ? 'none' : 'flex';
}

// Daggers double-jump: a fresh jump PRESS while airborne (holding daggers) gives
// one extra mid-air jump. Reset when you touch the ground.
function tryAirJump() {
  if (me.grounded || me.dead) return;
  if (!WEAPONS[me.weapon]?.doubleJump) return;
  if ((me.airJumps || 0) >= 1) return;
  const frozen = game.phase === 'freeze' || game.phase === 'vote' || game.phase === 'teleport' || game.phase === 'podium';
  if (frozen) return;
  me.airJumps = (me.airJumps || 0) + 1;
  me.vel.y = MOVE.jumpVel * 0.92;
  me.sliding = false;
  sfx.dash?.();
}
function tryCrouch(on) {
  if (on) {
    // pressing slide AGAIN while already sliding cancels it early (stand up)
    if (me.sliding) { me.sliding = false; me.crouch = false; me.slideEndAt = clockNow(); return; }
    me.slidePressAt = clockNow();   // fresh press — buffers a slide onto landing
    // SLIDE — crouch while moving on the ground bursts you forward, then decays
    const speed = Math.hypot(me.vel.x, me.vel.z);
    if (me.grounded && !me.sliding && speed > MOVE.walk * 0.5) {
      me.sliding = true;
      const l = speed || 1;
      me.slideVel = { x: (me.vel.x / l) * MOVE.slideBurst, z: (me.vel.z / l) * MOVE.slideBurst };
      sfx.slide();
      window.ClaudeBox?.completeChallenge('rivals-slide');
    }
    me.crouch = true;
  } else {
    // releasing does NOT cancel a slide — once you slide it plays out fully
    // (a tap = a full slide); only a jump ends it early. Just drop the crouch.
    me.crouch = false;
  }
}

function onRightDown() {
  vmAnim.bfInspectT = 1;   // aiming/alt-fire cancels an inspect
  if (me.weapon === 'warper') {
    const now2 = clockNow();
    if (me.dead || now2 - me.lastFire < WEAPONS.warper.rate) return;
    me.lastFire = now2;
    placePortal('B');
    return;
  }
  if (me.weapon === 'butterfly') {
    // HEAVY STAB — flip to reverse icepick grip and drive down. Same server
    // melee (backstab from behind still one-shots); heavier animation + lockout.
    const now = clockNow();
    const w = WEAPONS.butterfly;
    if (now - me.swingAt < w.rate * 1.8 || me.dead || game.phase === 'freeze' || game.phase === 'podium') return;
    me.swingAt = now + w.rate * 0.7;             // longer lockout than a slash
    vmAnim.bfStabT = 0; vmAnim.bfInspectT = 1;
    playOne('knife', 0.9);
    if (game.phase === 'live') net.send({ t: 'melee', weapon: 'butterfly' });
    else rangeMelee();
    return;
  }
  if (me.weapon === 'scythe') {
    // DASH
    const now = clockNow();
    if (now - me.dashAt < MOVE.dashCooldown || me.dead || game.phase === 'freeze') return;
    me.dashAt = now; me.dashUntil = now + MOVE.dashTime;
    me.dashVec = { x: -Math.sin(me.ry) * MOVE.dashSpeed, z: -Math.cos(me.ry) * MOVE.dashSpeed };
    sfx.dash(); net.send({ t: 'dash' });
    return;
  }
  if (me.weapon === 'satchel') {
    // RED BUTTON — a slide-jump you can trigger anywhere, even mid-air, on a
    // short cooldown. Flings you along where you're looking (horizontally) plus
    // an upward pop; spam it every 0.3s to fly across the map.
    const now = clockNow();
    const W = WEAPONS.satchel;
    if (now - (me.satchelBtnAt || -9) < W.btnCd || me.dead || game.phase === 'freeze' || game.phase === 'podium') return;
    me.satchelBtnAt = now;
    vmAnim.satchelBtnT = 0;   // left hand slams the detonator button
    const dirX = -Math.sin(me.ry), dirZ = -Math.cos(me.ry);
    me.vel.x = dirX * W.btnBoost; me.vel.z = dirZ * W.btnBoost;
    me.vel.y = Math.max(me.vel.y, W.btnUp);
    me.grounded = false; me.sliding = false;
    me.slideVel = { x: me.vel.x, z: me.vel.z }; me.slideEndAt = now;   // keep momentum into a real jump
    sfx.dash(); net.send({ t: 'dash' });
    return;
  }
  // guns: ADS handled continuously via rightDown
}

// is a point inside any solid map box? (grenade/satchel wall detonation)
function pointInMap(x, y, z) {
  for (const b of mapBoxes) {
    if (x > b.x - b.sx / 2 && x < b.x + b.sx / 2 &&
        y > b.y - b.sy / 2 && y < b.y + b.sy / 2 &&
        z > b.z - b.sz / 2 && z < b.z + b.sz / 2) return true;
  }
  return false;
}

// collision vs current mapBoxes (feet-based AABB)
function collideMove(nx, ny, nz) {
  const r = MOVE.radius;
  const h = me.crouch || me.sliding ? MOVE.heightCrouch : MOVE.heightStand;
  // horizontal push-out per axis
  const rampSurfaceY = (b, x, z) => {
    const len = b.ramp.axis === 'x' ? b.sx : b.sz;
    let f = ((b.ramp.axis === 'x' ? x - b.x : z - b.z) + len / 2) / len;
    if (b.ramp.up < 0) f = 1 - f;
    return (b.y - b.sy / 2) + Math.max(0, Math.min(1, f)) * b.ramp.rise;
  };
  const solveAxis = (x, z) => {
    for (const b of mapBoxes) {
      if (b.ramp) {
        // slopes are walkable — but only where you can actually step up onto
        // the surface. Walking into the TALL side/underside is a wall, not a
        // door (you could phase straight through the wedge before).
        const minX = b.x - b.sx / 2 - r, maxX = b.x + b.sx / 2 + r;
        const minZ = b.z - b.sz / 2 - r, maxZ = b.z + b.sz / 2 + r;
        if (x > minX && x < maxX && z > minZ && z < maxZ) {
          const hh = rampSurfaceY(b, x, z);
          if (hh - ny > 0.75 && ny + h > b.y - b.sy / 2 + 0.05) {
            const dl = x - minX, dr = maxX - x, dn = z - minZ, df = maxZ - z;
            const m2 = Math.min(dl, dr, dn, df);
            if (m2 === dl) x = minX; else if (m2 === dr) x = maxX; else if (m2 === dn) z = minZ; else z = maxZ;
          }
        }
        continue;
      }
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
  // ADS amount — any gun (non-melee, non-utility) can aim down sights
  const adsW = WEAPONS[me.weapon];
  const wantAds = rightDown && adsW && !adsW.melee && !adsW.utility && adsW.adsZoom && !me.reloading && !frozen;
  me.ads += ((wantAds ? 1 : 0) - me.ads) * Math.min(1, dt * 12);
  camera.fov = BASE_FOV / (1 + me.ads * ((WEAPONS[me.weapon]?.adsZoom || 1.3) - 1));
  camera.updateProjectionMatrix();

  let mx = 0, mz = 0;
  if (!frozen && (locked || mobileOn || inLobbyMode())) {   // lobby: keyboard works with a free cursor
    mx = (keys.has(binds.right) ? 1 : 0) - (keys.has(binds.left) ? 1 : 0);
    mz = (keys.has(binds.forward) ? 1 : 0) - (keys.has(binds.back) ? 1 : 0);
    if (mobileMove.x || mobileMove.z) { mx = mobileMove.x; mz = mobileMove.z; }   // joystick overrides
  }
  // in the third-person lobby, movement is CAMERA-relative and the character
  // turns to face where it's walking; everywhere else it's aim-relative
  const baseYaw = inLobbyMode() ? lobbyCam.yaw : me.ry;
  const fx = -Math.sin(baseYaw), fz = -Math.cos(baseYaw);
  const rx = Math.cos(baseYaw), rz = -Math.sin(baseYaw);
  let wishX = fx * mz + rx * mx, wishZ = fz * mz + rz * mx;
  if (inLobbyMode() && (mx || mz)) me.ry = Math.atan2(-wishX, -wishZ);
  const wl = Math.hypot(wishX, wishZ) || 1; wishX /= wl; wishZ /= wl;
  const speed = me.crouch && !me.sliding ? MOVE.crouch : MOVE.walk;   // no sprint

  if (now < me.dashUntil) {                     // dash overrides
    me.vel.x = me.dashVec.x; me.vel.z = me.dashVec.z;
  } else if (me.sliding) {                       // slide decays slowly
    const l = Math.hypot(me.slideVel.x, me.slideVel.z);
    const nl = Math.max(0, l - MOVE.slideFriction * dt);
    if (nl <= MOVE.slideMin) { me.sliding = false; me.slideEndAt = now; }
    else { me.slideVel.x *= nl / (l || 1); me.slideVel.z *= nl / (l || 1); }
    me.vel.x = me.slideVel.x; me.vel.z = me.slideVel.z;
  } else if (me.grounded) {
    me.vel.x = (mx || mz) ? wishX * speed : 0;
    me.vel.z = (mx || mz) ? wishZ * speed : 0;
  } else if (mx || mz) {                         // air: steer toward input but
    // only ACCELERATE toward wish (don't scrub away slide-jump momentum)
    const cur = Math.hypot(me.vel.x, me.vel.z);
    me.vel.x += (wishX * speed - me.vel.x) * MOVE.airControl * dt * 8;
    me.vel.z += (wishZ * speed - me.vel.z) * MOVE.airControl * dt * 8;
    const nn = Math.hypot(me.vel.x, me.vel.z);
    if (nn < cur) { me.vel.x *= cur / (nn || 1); me.vel.z *= cur / (nn || 1); }   // keep top speed
  }
  if (keys.has(binds.jump) && me.grounded && !frozen) {
    me.vel.y = MOVE.jumpVel; me.grounded = false;
    // SLIDE-HOP: jump out of a slide (or within a moment of one) and carry its
    // momentum — this is what makes slide→jump fling you far
    const canHop = me.slideVel && (me.sliding || (now - (me.slideEndAt || -9) < 0.2));
    if (canHop) {
      me.vel.x = me.slideVel.x * MOVE.slideHopKeep;
      me.vel.z = me.slideVel.z * MOVE.slideHopKeep;
    }
    me.sliding = false;
  }

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
    me.airJumps = 0;   // touching ground refreshes the daggers double-jump
    if (wasAirborne && fallSpeed > 5) vmAnim.landK = Math.min(1, fallSpeed / 16); // landing dip
    // CHAIN slide-hops: only if you PRESSED slide within the last moment (a
    // fresh tap buffered onto the landing) — NOT merely holding it. Holding
    // slide through a plain jump must not auto-slide every time you land.
    if (wasAirborne && !me.sliding && !frozen && (now - (me.slidePressAt || -9) < 0.25)) {
      const sp = Math.hypot(me.vel.x, me.vel.z);
      if (sp > MOVE.walk * 0.5) {
        me.sliding = true;
        me.slideVel = { x: (me.vel.x / sp) * MOVE.slideBurst, z: (me.vel.z / sp) * MOVE.slideBurst };
        sfx.slide?.();
      }
    }
  }
  else me.grounded = false;

  // jump pads: pulse the core, and launch you along the pad's face if you
  // touch one (works on floors, walls and ceilings)
  const W_PAD = WEAPONS.jumppad;
  for (const p of placedPads) {
    if (p.core) { const s = 1 + Math.sin(now * 4 + p.x) * 0.12; p.core.scale.set(s, 1, s); }
    if (me.dead) continue;
    if (p.cd && now - p.cd < 0.35) continue;
    const dx = me.pos.x - p.x, dy = (me.pos.y + 0.9) - p.y, dz = me.pos.z - p.z;
    if (Math.hypot(dx, dy, dz) < (W_PAD.padRadius || 1.4) + 0.5) {
      me.vel.x = p.nx * W_PAD.launch;
      me.vel.y = p.ny * W_PAD.launch + (p.ny > 0.4 ? 0 : 3);   // a little lift off wall pads
      me.vel.z = p.nz * W_PAD.launch;
      me.grounded = false; me.sliding = false; p.cd = now;
      sfx.dash?.();
    }
  }

  // practice arena: local grenades/satchels — arc, explode on ground/contact/fuse,
  // and self-launch you (grenade/satchel-jump practice)
  for (let i = localNades.length - 1; i >= 0; i--) {
    const g = localNades[i], w = WEAPONS[g.wid];
    g.vy -= MOVE.gravity * 0.8 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    let impact = g.y < 0.12 || pointInMap(g.x, g.y, g.z);   // ground OR any wall/cover
    g.y = Math.max(0.12, g.y); g.mesh.position.set(g.x, g.y, g.z);
    if (!impact && now >= g.armAt && Math.hypot(me.pos.x - g.x, (me.pos.y + 0.9) - g.y, me.pos.z - g.z) < 1.6) impact = true;
    if (impact || now >= g.explodeAt) {
      scene.remove(g.mesh); localNades.splice(i, 1); boomFx(g.x, g.y, g.z);
      const dx = me.pos.x - g.x, dy = (me.pos.y + 0.9) - g.y, dz = me.pos.z - g.z;
      const d = Math.hypot(dx, dy, dz);
      if (!me.dead && d < w.radius) {
        const dd = Math.hypot(dx, dz) || 0.001, power = 13 * (1 - d / w.radius) + 5;
        me.vel.x += (dx / dd) * power; me.vel.z += (dz / dd) * power;
        me.vel.y = Math.max(me.vel.y, Math.max(11, 9 + (1 - d / w.radius) * 8));
        me.grounded = false; me.sliding = false; sfx.dash?.();
      }
    }
  }
  tickClawTrails(dt);
  // practice arena: wipe everything players placed every 5 minutes
  if (game.phase === 'lobby' && lobbyClearAt && now >= lobbyClearAt) {
    if (placedPads.length || localNades.length) toast?.('Practice arena cleared');
    clearPads(); clearLocalNades();
    lobbyClearAt = now + PRACTICE_CLEAR_SECS;
  }

  // camera — eye height eases down smoothly while sliding/crouching
  const eyeTarget = me.crouch || me.sliding ? MOVE.eyeCrouch : MOVE.eyeStand;
  if (me.eye == null) me.eye = eyeTarget;
  me.eye += (eyeTarget - me.eye) * Math.min(1, dt * 14);
  if (inLobbyMode()) {
    // third-person social camera: orbit the character, cursor free, RMB to look.
    // The camera pulls IN when a wall is behind you (step-march collision).
    const cy = Math.cos(lobbyCam.pitch), sy = Math.sin(lobbyCam.pitch);
    const fx = Math.sin(lobbyCam.yaw) * cy, fz = Math.cos(lobbyCam.yaw) * cy;
    const tx = me.pos.x, ty = me.pos.y + 1.35, tz = me.pos.z;
    let dWant = lobbyCam.dist;
    for (let step = 0.6; step <= lobbyCam.dist; step += 0.1) {
      if (pointInMap(tx + fx * step, ty + sy * step + 0.3, tz + fz * step)) { dWant = Math.max(1.1, step - 0.45); break; }
    }
    // smooth with HYSTERESIS: ignore sub-15cm flicker at wall boundaries,
    // ease in when a wall intrudes, drift back out slowly
    if (lobbyCam.curD == null) lobbyCam.curD = dWant;
    const dDiff = dWant - lobbyCam.curD;
    if (dDiff < -0.02) lobbyCam.curD += dDiff * Math.min(1, dt * 14);
    else if (dDiff > 0.15) lobbyCam.curD += dDiff * Math.min(1, dt * 3);
    const d = lobbyCam.curD;
    camera.position.set(tx + fx * d, ty + sy * d + 0.4, tz + fz * d);
    camera.lookAt(tx, ty, tz);
  } else {
    camera.position.set(me.pos.x, me.pos.y + me.eye, me.pos.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(me.ry);
    camera.rotateX(me.pitch);
    camera.rotateZ(vmAnim.roll * 0.4);   // subtle strafe lean, like the original
    // recoil kick decay
    camera.rotateX(recoil); recoil *= Math.pow(0.0001, dt);
  }
  // my own R6 body: visible only in the third-person lobby
  const r6 = ensureMyR6();
  r6.group.visible = inLobbyMode() && !bfe.open;
  if (r6.group.visible) {
    r6.group.position.set(me.pos.x, me.pos.y, me.pos.z);
    r6.group.rotation.y = me.ry + Math.PI;
    const sp2d = Math.hypot(me.vel.x, me.vel.z);
    r6.setAnim(me.sliding ? 'slide' : !me.grounded ? (me.vel.y > 1 ? 'jump' : 'fall') : sp2d > 8 ? 'run' : sp2d > 0.5 ? 'walk' : 'idle');
    r6.update(dt);
  }
}

// ============================ weapons ============================
let recoil = 0;
const viewRoot = new THREE.Group();
camera.add(viewRoot);
// hands/guns render in their OWN depth-cleared pass — they can never clip into walls
const vmScene = new THREE.Scene();
vmScene.add(camera);   // viewRoot rides the camera; only vmScene draws it
vmScene.add(new THREE.AmbientLight('#c4ccd8', 1.5));
{ const vmSun = new THREE.DirectionalLight('#fff2dc', 1.3); vmSun.position.set(2, 4, 1); vmScene.add(vmSun); }
const viewmodels = {};
function vmMat(c) { return new THREE.MeshLambertMaterial({ color: c }); }

// your avatar's colours on YOUR hands — like the original's viewmodels
const myR6Profile = identity.avatar?.r6 || R6_DEFAULT;
const VM_SHIRT = myR6Profile.armR || identity.avatar?.shirtColor || '#2f5fd0';
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
function makeBalisong() {   // the REAL articulated balisong — shared by the viewmodel and the Anim Studio preview
  const pivot = new THREE.Group();
  const bladeG = new THREE.Group();
  for (const m of [
    box(0.05, 0.05, 0.055, STEEL, 0, 0, 0.01),               // tang + pin boss
    box(0.03, 0.06, 0.3, '#e2e8f2', 0, 0, -0.19),            // blade
    box(0.018, 0.045, 0.1, '#f4f7fc', 0, 0.006, -0.38),      // clip point
    box(0.012, 0.02, 0.26, '#aeb6c6', 0, -0.026, -0.17),     // edge grind line
  ]) bladeG.add(m);
  // channel handles, like the real thing: each handle's two rails straddle the
  // blade's FLAT (x) so the folded blade nests inside; the handles themselves sit
  // above/below the blade (y) on vertically offset pins — they surround it
  // vertically in the spin plane, not side-by-side
  const mkHandle = (side, c1, c2, latch) => {
    const h = new THREE.Group();
    for (const m of [
      box(0.016, 0.05, 0.3, c1, -0.023, side * 0.007, 0.17),   // rail
      box(0.016, 0.05, 0.3, c2, 0.023, side * 0.007, 0.17),    // rail
      box(0.05, 0.044, 0.045, c1, 0, side * 0.007, 0.315),     // pommel spacer
      box(0.044, 0.02, 0.05, STEEL, 0, side * 0.02, 0.05),     // pin plate
    ]) h.add(m);
    if (latch) h.add(box(0.014, 0.03, 0.05, STEEL, 0, side * -0.03, 0.33));   // latch on the bite handle
    return h;
  };
  const hB = mkHandle(-1, '#23252c', '#33363f', false);      // safe handle (stays in the palm)
  const hA = mkHandle(1, '#2a2d35', '#3b3f4a', true);        // bite handle (the one that fans)
  hA.position.y = 0.02; hB.position.y = -0.02;               // offset pins, like the real tang
  // spin-blur disc: streaked circle in the spin plane — keyframable 'blur' channel
  const bc = document.createElement('canvas'); bc.width = bc.height = 128;
  const bx = bc.getContext('2d'); bx.translate(64, 64);
  for (let i = 0; i < 9; i++) {
    bx.strokeStyle = `rgba(226,232,242,${0.35 + (i % 3) * 0.2})`;
    bx.lineWidth = 3 + (i % 3) * 2;
    bx.beginPath(); bx.arc(0, 0, 18 + i * 5, i * 2.3, i * 2.3 + 1.1 + (i % 2) * 0.5); bx.stroke();
  }
  const blurTex = new THREE.CanvasTexture(bc);
  const blurWrap = new THREE.Group(); blurWrap.rotation.y = Math.PI / 2;
  const blurMesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.43, 40),
    new THREE.MeshBasicMaterial({ map: blurTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  blurMesh.visible = false;
  blurWrap.add(blurMesh);
  pivot.add(bladeG, hA, hB, blurWrap);
  return { pivot, bladeG, hA, hB, blurMesh };
}
function buildViewmodels() {
  // ---- assault rifle: stock/body/grip/mag/handguard/barrel/sights ----
  {
    const g = new THREE.Group();
    const arBolt = box(0.028, 0.04, 0.26, DARK, 0, 0.08, -0.02);   // charging handle / top rail (cycles on fire)
    const arMag = box(0.065, 0.18, 0.1, DARK, 0, -0.15, -0.06, 0.12);
    arBolt.userData.z0 = arBolt.position.z;
    rigWeapon(g, [
      box(0.07, 0.11, 0.2, DARK, 0, -0.01, 0.32),          // stock
      box(0.09, 0.12, 0.48, GOLD, 0, 0, 0),                // receiver
      box(0.06, 0.13, 0.07, DARK, 0, -0.12, 0.12, 0.3),    // pistol grip
      arMag,                                               // magazine
      box(0.075, 0.085, 0.22, GOLD, 0, 0, -0.34),          // handguard
      box(0.04, 0.04, 0.3, DARK, 0, 0.02, -0.58),          // barrel
      box(0.055, 0.055, 0.06, GREY, 0, 0.02, -0.74),       // muzzle
      arBolt,                                              // top rail
      box(0.02, 0.05, 0.02, DARK, 0, 0.085, -0.42),        // front post
    ], [0.06, -0.16, 0.22], [0.5, -0.12, 0], [-0.08, -0.1, -0.3], [0.35, 0.35, 0.1]);
    g.userData.fx = { bolt: arBolt, mag: arMag };
    viewmodels.ar = g;
  }
  // ---- handgun ----
  {
    const g = new THREE.Group();
    const hgSlide = box(0.07, 0.075, 0.3, GREY, 0, 0.02, -0.02);
    const hgSerr = box(0.074, 0.06, 0.06, STEEL, 0, 0.02, 0.1);
    hgSlide.userData.z0 = hgSlide.position.z; hgSerr.userData.z0 = hgSerr.position.z;
    rigWeapon(g, [
      hgSlide,                                             // slide (blows back on fire)
      hgSerr,                                              // rear serrations
      box(0.065, 0.05, 0.26, DARK, 0, -0.03, -0.02),       // frame
      box(0.06, 0.16, 0.085, DARK, 0, -0.13, 0.09, 0.22),  // grip
      box(0.02, 0.025, 0.02, STEEL, 0, 0.068, -0.15),      // front sight
    ], [0.045, -0.17, 0.17], [0.45, 0, 0], [-0.085, -0.18, 0.13], [0.45, 0.3, 0.2]);
    g.userData.fx = { slide: hgSlide, serr: hgSerr };
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
      (() => { const l = box(0.025, 0.1, 0.05, STEEL, 0.415, -0.06, -0.02, 0.25); g.__lever = l; return l; })(),   // lever
      (() => { const pin = box(0.05, 0.02, 0.02, '#d8dbe0', 0.35, -0.005, -0.06); pin.userData.x0 = pin.position.x; pin.userData.y0 = pin.position.y; g.__pin = pin; return pin; })(),  // pin ring
    ], [0.38, -0.26, 0.08], [0.6, -0.35, 0.15], [-0.58, -0.28, -0.02], [0.6, 0.55, -0.15]);
    g.userData.fx = { lever: g.__lever, pin: g.__pin };
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
      (() => { const b = box(0.09, 0.035, 0.035, STEEL, 0.08, 0.02, 0.12); b.userData.z0 = b.position.z; b.userData.y0 = b.position.y; g.__bolt = b; return b; })(),   // bolt (cycles after each shot)
      tube, objective,
    ], [0.05, -0.16, 0.24], [0.5, -0.1, 0], [-0.085, -0.11, -0.32], [0.35, 0.3, 0]);
    g.userData.fx = { bolt: g.__bolt };
    viewmodels.sniper = g;
  }
  // ---- fists: two big shirt-colour cubes ----
  {
    const g = new THREE.Group();
    rigWeapon(g, [],
      [0.58, -0.26, -0.04], [0.7, -0.45, -0.2], [-0.6, -0.25, -0.1], [0.7, 0.45, 0.2]);
    viewmodels.fists = g;
  }
  // ---- katana: long single-edged blade, two-handed grip ----
  {
    const g = new THREE.Group();
    rigWeapon(g, [
      box(0.052, 0.09, 0.24, '#15161b', 0.36, -0.16, 0.06),    // wrapped handle
      box(0.05, 0.05, 0.05, '#0e0f13', 0.36, -0.16, 0.19),     // pommel
      box(0.12, 0.03, 0.12, GOLD, 0.36, -0.16, -0.08),         // tsuba (guard)
      box(0.028, 0.075, 0.82, '#dbe2ec', 0.36, -0.145, -0.54), // long blade
      box(0.02, 0.05, 0.14, '#f2f5fa', 0.36, -0.125, -1.0),    // angled tip
    ], [0.36, -0.24, 0.1], [0.5, -0.3, 0.14], [-0.26, -0.28, -0.12], [0.55, 0.5, -0.05]);
    viewmodels.katana = g;
  }
  // ---- bat: chunky baseball bat, both hands on the grip ----
  {
    const g = new THREE.Group();
    rigWeapon(g, [
      box(0.05, 0.05, 0.22, '#6b4423', 0.3, -0.16, 0.08),      // handle
      box(0.065, 0.065, 0.05, '#4a2f18', 0.3, -0.16, 0.2),     // knob
      box(0.08, 0.08, 0.3, '#a9772f', 0.3, -0.16, -0.18),      // taper
      box(0.118, 0.118, 0.42, '#c08a3a', 0.3, -0.16, -0.56),   // barrel
      box(0.12, 0.12, 0.06, '#c08a3a', 0.3, -0.16, -0.8),      // end cap
    ], [0.3, -0.24, 0.1], [0.5, -0.3, 0.1], [-0.32, -0.28, -0.02], [0.55, 0.4, 0.0]);
    viewmodels.bat = g;
  }
  // ---- butterfly knife (balisong): fully ARTICULATED — the blade and both
  // handles each pivot on the tang pin, so flips/fans/twirls are real motion ----
  {
    const g = new THREE.Group();
    const { pivot, bladeG, hA, hB, blurMesh } = makeBalisong();
    pivot.position.set(0.5, -0.135, -0.15);   // pin rides the OUTER edge of the fist — flips sweep beside the hand, not through it
    rigWeapon(g, [pivot], [0.4, -0.26, 0.06], [0.6, -0.35, 0.15], [-0.58, -0.28, -0.02], [0.6, 0.55, -0.15]);
    g.userData.bf = { pivot, blade: bladeG, hA, hB, blur: blurMesh };
    viewmodels.butterfly = g;
  }
  // ---- The Warper: white portal gun, blue + orange prongs ----
  {
    const g = new THREE.Group();
    const prongA = box(0.022, 0.05, 0.16, '#4db8ff', 0.035, 0.045, -0.42);
    const prongB = box(0.022, 0.05, 0.16, '#ff9a3d', -0.035, 0.045, -0.42);
    rigWeapon(g, [
      box(0.09, 0.1, 0.34, '#eef1f6', 0, 0, -0.06),          // white shell
      box(0.07, 0.07, 0.16, '#c9d2e0', 0, 0.01, -0.28),      // snout
      (() => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.016, 8, 18), vmMat('#2a2e38')); r.position.set(0, 0.01, -0.38); return r; })(),   // barrel ring
      box(0.06, 0.14, 0.08, '#2a2e38', 0, -0.11, 0.06, 0.25),// grip
      box(0.05, 0.04, 0.2, '#8f99ad', 0, 0.065, 0.02),       // spine
      prongA, prongB,
    ], [0.045, -0.17, 0.17], [0.45, 0, 0], [-0.085, -0.18, 0.13], [0.45, 0.3, 0.2]);
    g.userData.fx = { prongA, prongB };
    viewmodels.warper = g;
  }
  // ---- daggers: a small knife in EACH hand ----
  {
    const g = new THREE.Group();
    const dagger = (x) => [
      box(0.04, 0.05, 0.13, DARK, x, -0.16, 0.0),              // handle
      box(0.06, 0.06, 0.03, STEEL, x, -0.16, -0.1),            // guard
      box(0.026, 0.052, 0.24, '#cfd6e0', x, -0.155, -0.26),    // blade
      box(0.014, 0.03, 0.07, '#eef2f8', x, -0.15, -0.41),      // point
    ];
    rigWeapon(g, [...dagger(0.4), ...dagger(-0.4)],
      [0.4, -0.26, 0.06], [0.55, -0.32, 0.12], [-0.4, -0.26, 0.06], [0.55, 0.32, -0.12]);
    viewmodels.daggers = g;
  }
  // ---- jump pad: a small pad held flat, one hand gripping each side ----
  {
    const g = new THREE.Group();
    const glow = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(roundedBoxGeo(w, h, d, Math.min(w, h, d) * 0.3), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); return m; };
    const CY = -0.14;
    rigWeapon(g, [
      box(0.66, 0.09, 0.52, '#aebccd', 0, CY, -0.16),          // plate
      box(0.12, 0.12, 0.12, '#c6d3e2', 0.26, CY + 0.03, -0.02),// corner nubs
      box(0.12, 0.12, 0.12, '#c6d3e2', -0.26, CY + 0.03, -0.02),
      box(0.12, 0.12, 0.12, '#c6d3e2', 0.26, CY + 0.03, -0.3),
      box(0.12, 0.12, 0.12, '#c6d3e2', -0.26, CY + 0.03, -0.3),
      glow(0.28, 0.11, 0.26, '#6fd8ff', 0, CY + 0.05, -0.16),  // glowing core
      glow(0.05, 0.1, 0.32, '#37e0ff', 0.17, CY + 0.04, -0.16),// glow bars
      glow(0.05, 0.1, 0.32, '#37e0ff', -0.17, CY + 0.04, -0.16),
      glow(0.32, 0.1, 0.05, '#37e0ff', 0, CY + 0.04, -0.02),
      glow(0.32, 0.1, 0.05, '#37e0ff', 0, CY + 0.04, -0.3),
    ], [0.54, -0.23, 0.06], [0.28, -0.55, 0.6], [-0.54, -0.23, 0.06], [0.28, 0.55, -0.6]);
    viewmodels.jumppad = g;
  }
  // ---- satchel: a red explosive in the RIGHT hand + a detonator box with a
  // red plunger button in the LEFT hand (hands animate throw + button-press) ----
  {
    const g = new THREE.Group();
    const gun = new THREE.Group();                    // unused holder (satisfies base-reset)
    const rArm = mkArm(); rArm.position.set(0.42, -0.24, 0.06); rArm.rotation.set(0.55, -0.32, 0.14);
    const lArm = mkArm(); lArm.position.set(-0.42, -0.24, 0.06); lArm.rotation.set(0.5, 0.34, -0.16);
    // explosive bundle riding in the right hand
    const explosive = new THREE.Group();
    explosive.add(box(0.13, 0.19, 0.13, '#c23b3b', 0, 0, -0.44));       // red charge
    explosive.add(box(0.145, 0.07, 0.145, '#8a2a2a', 0, 0.06, -0.44));  // tape band
    explosive.add(box(0.145, 0.07, 0.145, '#8a2a2a', 0, -0.06, -0.44)); // tape band
    explosive.add(box(0.03, 0.1, 0.03, '#e8c96a', 0, 0.15, -0.44));     // fuse stub
    rArm.add(explosive);
    // detonator box + plunger in the left hand
    const det = new THREE.Group();
    det.add(box(0.22, 0.13, 0.28, '#24272e', 0, 0, -0.42));             // box body
    det.add(box(0.22, 0.03, 0.28, '#3a3f48', 0, 0.07, -0.42));          // lid trim
    const plunger = new THREE.Group();
    plunger.add(box(0.09, 0.05, 0.09, '#d64545', 0, 0, 0));             // red button cap
    plunger.add(box(0.03, 0.08, 0.03, '#9a9fa8', 0, -0.06, 0));         // shaft
    plunger.position.set(0, 0.12, -0.42);
    det.add(plunger);
    det.add(box(0.02, 0.02, 0.16, '#4a4a4a', 0.05, -0.02, -0.26));      // wire
    lArm.add(det);
    g.add(gun, rArm, lArm);
    g.userData = {
      gun, rArm, lArm,
      base: {
        gun: { p: gun.position.clone(), r: gun.rotation.clone() },
        rArm: { p: rArm.position.clone(), r: rArm.rotation.clone() },
        lArm: { p: lArm.position.clone(), r: lArm.rotation.clone() },
      },
      explosive, plunger, plungerY: plunger.position.y,
    };
    viewmodels.satchel = g;
  }
  // ---- CAT PAW (unique skin model): a cartoon orange-tabby cat paw with white
  // toes, pink paw pads, and curved 3D claws — the most detailed item in game ----
  {
    const g = new THREE.Group();
    const FUR = '#e0913f', FUR2 = '#c9762d', FUR3 = '#f0b070', TOE = '#f6efe6', PAD = '#eb8d95', PAD2 = '#d96f79', CLAW = '#f4ecda';
    const rb = (w, h, d, c, x, y, z, rx = 0) => { const m = new THREE.Mesh(roundedBoxGeo(w, h, d, Math.min(w, h, d) * 0.42), vmMat(c)); m.position.set(x, y, z); if (rx) m.rotation.x = rx; return m; };
    const sph = (r, c, x, y, z, sy = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), vmMat(c)); m.position.set(x, y, z); m.scale.y = sy; return m; };
    const paw = new THREE.Group();                 // everything below rides in the right hand
    const CX = 0.42;
    // --- FOREARM raised straight UP out of the hand ---
    const arm = new THREE.Group();
    arm.add(sph(0.12, FUR2, 0, -0.04, 0, 1.1));                    // wrist joint (bottom)
    arm.add(rb(0.16, 0.44, 0.15, FUR, 0, 0.2, 0));               // vertical forearm
    arm.add(sph(0.115, FUR2, 0, 0.44, 0, 1.15));                 // fluffy elbow at the top
    arm.add(rb(0.185, 0.03, 0.05, FUR2, 0, 0.1, 0));            // tabby stripes
    arm.add(rb(0.185, 0.03, 0.05, FUR2, 0, 0.24, 0));
    arm.add(rb(0.185, 0.03, 0.05, FUR2, 0, 0.36, 0));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; arm.add(rb(0.045, 0.045, 0.045, i % 2 ? FUR3 : FUR2, Math.cos(a) * 0.09, 0.2 + Math.sin(a) * 0.2, 0.08)); }
    arm.position.set(CX, -0.4, 0.14);                             // base low → rises up into view
    paw.add(arm);
    // --- WRIST folds the paw forward OVER the top of the arm (>100°) ---
    const wrist = new THREE.Group();
    wrist.position.set(CX, 0.0, 0.14);                            // at the top of the forearm
    wrist.rotation.x = -0.55;                                     // droop the paw forward past horizontal
    paw.add(wrist);
    // plump paw pad hanging forward-down from the wrist
    const pad = new THREE.Group();
    pad.add(sph(0.16, FUR, 0, 0.0, -0.14, 0.85));                // fluffy back of paw
    pad.add(sph(0.15, TOE, 0, -0.04, -0.24, 0.75));             // white paw front
    pad.add(sph(0.12, PAD, 0, -0.12, -0.2, 0.6));               // big pink palm bean
    pad.add(sph(0.05, PAD2, -0.07, -0.13, -0.14, 0.6));         // side beans
    pad.add(sph(0.05, PAD2, 0.07, -0.13, -0.14, 0.6));
    wrist.add(pad);
    // --- TOES: four splayed toe groups hanging off the front (each flexes) ---
    const claws = [], toes = [];
    for (let i = 0; i < 4; i++) {
      const toe = new THREE.Group();
      const fan = (i - 1.5) * 0.22;                               // splay out
      toe.add(sph(0.062, TOE, 0, 0, -0.09, 1.15));              // white toe
      toe.add(sph(0.05, FUR3, 0, 0.035, -0.03, 1.0));          // fur on top
      toe.add(sph(0.04, PAD2, 0, -0.052, -0.12, 0.85));        // pink toe bean
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.023, 0.15, 10), vmMat(CLAW));
      claw.rotation.x = -Math.PI / 2 - 0.5;                      // hook forward+down
      claw.position.set(0, -0.005, -0.19);
      claw.userData.tip = new THREE.Vector3(0, 0.075, 0);
      toe.add(claw); claws.push(claw);
      toe.position.set(Math.sin(fan) * 0.12, -0.14, -0.3 - Math.cos(fan) * 0.02);
      toe.rotation.y = fan;
      toe.userData.baseRX = 0; toe.userData.phase = i * 1.3;      // for idle flex
      wrist.add(toe); toes.push(toe);
    }
    g.add(paw);
    const rArm = mkArm(); rArm.position.set(0.4, -0.34, 0.24); rArm.rotation.set(0.62, -0.22, 0.12);
    g.add(rArm);
    g.userData = {
      gun: paw, rArm, lArm: rArm,   // reuse rArm as lArm to satisfy base-reset
      base: {
        gun: { p: paw.position.clone(), r: paw.rotation.clone() },
        rArm: { p: rArm.position.clone(), r: rArm.rotation.clone() },
        lArm: { p: rArm.position.clone(), r: rArm.rotation.clone() },
      },
      claws, toes, isCatPaw: true,
    };
    viewmodels.catpaw = g;
  }
  for (const [k, g] of Object.entries(viewmodels)) { g.visible = false; g.scale.setScalar(0.68); viewRoot.add(g); }
}
buildViewmodels();
// wave-mode guns: tinted/scaled variants of the base viewmodels
function vmVariant(srcKey, scale, tint) {
  const src = viewmodels[srcKey];
  if (!src) return null;
  const g = src.clone(true);
  g.traverse((n) => {
    if (n.isMesh && n.material) {
      n.material = n.material.clone();
      if (tint && n.material.color) n.material.color.lerp(new THREE.Color(tint), 0.45);
    }
  });
  // clone(true) preserves child order but mangles userData — the cloned group's
  // gun/rArm/lArm refs still point at the source's parts (or a broken JSON copy).
  // Re-map them to THIS clone's own children so the per-frame part animation
  // (frame() ~line 2399) doesn't crash every tick on a variant weapon.
  const su = src.userData;
  if (su?.gun) {
    const gi = src.children.indexOf(su.gun);
    const ri = src.children.indexOf(su.rArm);
    const li = src.children.indexOf(su.lArm);
    g.userData = {
      gun: gi >= 0 ? g.children[gi] : g.children[0],
      rArm: ri >= 0 ? g.children[ri] : undefined,
      lArm: li >= 0 ? g.children[li] : undefined,
      base: su.base,   // identical local rig transforms; used read-only as copy() source
    };
  }
  g.scale.setScalar(0.68 * scale);
  g.visible = false;
  viewRoot.add(g);
  return g;
}
viewmodels.smg = vmVariant('ar', 0.8, '#57e0ff');
viewmodels.shotgun = vmVariant('ar', 0.95, '#ff9a3c');
viewmodels.dmr = vmVariant('sniper', 0.9, '#59d185');
viewmodels.minigun = vmVariant('ar', 1.3, '#39404e');
// extra selectable weapons — reuse base viewmodels, behaviour-only for now
viewmodels.burst = vmVariant('ar', 0.92, '#c0c8d4');
viewmodels.revolver = vmVariant('handgun', 1.08, '#caa46a');
viewmodels.uzi = vmVariant('handgun', 0.9, '#2ec5e0');
viewmodels.shorty = vmVariant('handgun', 1.0, '#8a6a44');
// katana / bat / butterfly / daggers / jumppad now have their own real models (built above)
// roster expansion — guns reuse base gun models
viewmodels.carbine = vmVariant('ar', 0.86, '#8ea0b8');
viewmodels.battle = vmVariant('ar', 1.05, '#3f4653');
viewmodels.autosniper = vmVariant('sniper', 0.95, '#4a5568');
viewmodels.deagle = vmVariant('handgun', 1.12, '#c9a24a');
// satchel now has its own two-handed model (built above)

// ---- weapon skins: re-material a gun group with an equipped skin ----
let mySkins = { owned: [], equipped: {} };
const skinMat = (m) => new THREE.MeshStandardMaterial({ color: m.color, metalness: m.metalness == null ? 0.4 : m.metalness, roughness: m.roughness == null ? 0.5 : m.roughness, emissive: m.emissive || '#000000', emissiveIntensity: m.emissiveIntensity || 0 });
function applySkinToGroup(group, def) {
  group.traverse((o) => { if (!o.isMesh) return; if (!o.userData._orig) o.userData._orig = o.material; o.material = def ? skinMat(def.mat) : o.userData._orig; });
}
function skinFor(equipped, weapon) { const id = equipped && equipped[weapon]; return id ? SKIN_BY_ID[id] : null; }
// model skins swap the whole viewmodel (not a material tint) — skip tinting for those
function applyMyViewmodelSkins() { for (const w of SKIN_WEAPONS) { const vm = viewmodels[w]; if (vm && vm.userData.gun) { const def = skinFor(mySkins.equipped, w); applySkinToGroup(vm.userData.gun, def && def.model ? null : def); } } }
const catpawEquipped = () => mySkins.equipped && mySkins.equipped.scythe === 'catpaw';
// cat-paw hit: LOUD scratch + white claw slashes. returns true if it handled the sfx.
function catpawHitFx() {
  if (me.weapon !== 'scythe' || !catpawEquipped()) return false;
  playOne('catscratch', 4.5);   // way louder than a normal hit
  spawnClawTrail();
  return true;
}
// a little cartoon cat-paw print drawn to a canvas (toast + skin chip thumbnail)
function catPawIcon(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); const s = size;
  const bean = (cx, cy, rx, ry, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill(); };
  // fur main pad
  bean(s * 0.5, s * 0.6, s * 0.3, s * 0.26, '#e0913f');
  bean(s * 0.5, s * 0.56, s * 0.24, s * 0.2, '#f0b070');
  bean(s * 0.5, s * 0.66, s * 0.17, s * 0.14, '#eb8d95');   // pink palm bean
  // 4 toes with claws
  for (let i = 0; i < 4; i++) {
    const tx = s * (0.26 + i * 0.16), ty = s * (i === 0 || i === 3 ? 0.34 : 0.27);
    bean(tx, ty, s * 0.085, s * 0.11, '#f0b070');
    bean(tx, ty + s * 0.03, s * 0.045, s * 0.055, '#d96f79');   // toe bean
    x.strokeStyle = '#f4ecda'; x.lineWidth = s * 0.035; x.lineCap = 'round';
    x.beginPath(); x.moveTo(tx, ty - s * 0.09); x.lineTo(tx, ty - s * 0.2); x.stroke();   // claw
  }
  return c.toDataURL();
}
// top-left card: "you obtained the skin" with an image of it
function showSkinUnlockToast(def) {
  if (!document.getElementById('skunlock-kf')) {
    const st = document.createElement('style'); st.id = 'skunlock-kf';
    st.textContent = '@keyframes skunlock{from{transform:translateX(-40px) scale(.9);opacity:0}}';
    document.head.appendChild(st);
  }
  const rc = RARITY_COLOR[def.rarity] || '#ff5fa8';
  const card = document.createElement('div');
  card.style.cssText = `position:fixed;left:14px;top:14px;z-index:200;display:flex;gap:12px;align-items:center;background:linear-gradient(135deg,#26192e,#182233);border:2px solid ${rc};border-radius:16px;padding:12px 16px 12px 12px;color:#fff;box-shadow:0 12px 34px rgba(0,0,0,.55),0 0 22px ${rc}55;font-family:-apple-system,system-ui,sans-serif;animation:skunlock .5s cubic-bezier(.2,1.4,.4,1);`;
  const img = document.createElement('img'); img.src = catPawIcon(72); img.width = 58; img.height = 58; img.style.cssText = 'border-radius:12px;background:#0e1320;';
  const txt = document.createElement('div');
  txt.innerHTML = `<div style="font-size:11px;color:${rc};font-weight:900;text-transform:uppercase;letter-spacing:.6px;">${def.rarity} skin obtained!</div><div style="font-size:19px;font-weight:900;line-height:1.1;">${def.name} 🐾</div><div style="font-size:11px;color:#9aa4b8;margin-top:2px;">Added to your ${((identity.name || '').toLowerCase() === 'lilbugtrainer') ? 'Your' : 'Unique'} Skins</div>`;
  card.append(img, txt);
  document.body.appendChild(card);
  setTimeout(() => { card.style.transition = 'opacity .5s,transform .5s'; card.style.opacity = '0'; card.style.transform = 'translateX(-24px)'; setTimeout(() => card.remove(), 520); }, 6000);
}
const iOwnCatpaw = () => Array.isArray(mySkins.owned) && mySkins.owned.includes('catpaw');
// which viewmodel to actually SHOW for the held weapon (cat paw replaces the knife)
function activeVmKey() { return (me.weapon === 'scythe' && catpawEquipped()) ? 'catpaw' : me.weapon; }
async function loadMySkins() {
  try {
    const d = await fetch('/api/rivals/skins?name=' + encodeURIComponent(identity.name), { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } }).then((r) => r.json());
    if (d) { mySkins.owned = d.owned || []; mySkins.equipped = d.equipped || {}; mySkins.cubes = d.cubes || 0; iHaveOwnerCharm = !!d.ownerCharm; syncCharm(); }
  } catch {}
}

// ============ OWNER CHARM: a mini-you keychain dangling off the fist. ============
// ============ Earned forever by sniping AttackFace15. Live-updates outfit. ============
let iHaveOwnerCharm = false;
let charmRoot = null, charmSwing = null, charmMini = null, charmProfileJson = '';
const charmPhys = { ax: 0, az: 0, vax: 0, vaz: 0, pvx: 0, pvy: 0, pvz: 0, pry: 0 };
let charmEquipped = localStorage.getItem('rivals.charm') !== 'off';   // owned charms show unless toggled off
function rebuildCharmMini(prof) {
  if (charmMini) { try { charmSwing.remove(charmMini.group); charmMini.dispose(); } catch {} charmMini = null; }
  charmProfileJson = JSON.stringify(prof || {});
  charmMini = makeR6(prof || R6_DEFAULT);
  charmMini.group.scale.setScalar(0.055);            // keychain-sized you
  charmMini.group.position.y = -0.19;                // feet-origin rig hangs below the last link
  charmMini.group.rotation.y = 0.18;                 // slight angle so you see the face
  charmMini.setAnim('idle');
  charmSwing.add(charmMini.group);
}
function syncCharm() {
  if (!iHaveOwnerCharm) { if (charmRoot) charmRoot.visible = false; return; }
  if (charmRoot) { charmRoot.visible = true; return; }
  charmRoot = new THREE.Group();
  charmRoot.position.set(0.47, -0.21, -0.62);        // just OUTSIDE the right fist — never crosses a weapon
  const gold = new THREE.MeshStandardMaterial({ color: '#e8b64c', metalness: 0.75, roughness: 0.35 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 8, 20), gold);
  charmRoot.add(ring);
  charmSwing = new THREE.Group();                    // everything below the ring swings as a pendulum
  charmRoot.add(charmSwing);
  for (let i = 0; i < 3; i++) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0038, 6, 14), gold);
    link.position.y = -0.026 - i * 0.021;
    link.rotation.y = (i % 2) * Math.PI / 2;
    charmSwing.add(link);
  }
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.015, 5), gold);
  crown.position.y = -0.083; crown.rotation.x = 0.1;
  charmSwing.add(crown);                             // tiny crown atop the mini's head — it IS the owner charm
  rebuildCharmMini(myR6Profile);
  viewRoot.add(charmRoot);
}
function tickCharm(dt) {
  if (!charmRoot) return;
  const show = iHaveOwnerCharm && charmEquipped && (window.__charmForce || (!inLobbyMode() && !me.dead));
  charmRoot.visible = show;
  if (!show) return;
  charmMini?.update(dt);
  // pendulum: your acceleration (walk/jump/turn) whips the charm around, spring pulls it back
  const P = charmPhys, idt = 1 / Math.max(dt, 0.001);
  const axw = (me.vel.x - P.pvx) * idt, ayw = (me.vel.y - P.pvy) * idt, azw = (me.vel.z - P.pvz) * idt;
  P.pvx = me.vel.x; P.pvy = me.vel.y; P.pvz = me.vel.z;
  const sn = Math.sin(-me.ry), cs = Math.cos(-me.ry);
  const lx = axw * cs - azw * sn;                    // view-space sideways accel
  const lz = axw * sn + azw * cs;                    // view-space forward accel
  const yawVel = (me.ry - P.pry) * idt; P.pry = me.ry;
  P.vax += (-16 * P.ax - 5.5 * P.vax - lz * 0.05 - ayw * 0.035) * dt;
  P.vaz += (-16 * P.az - 5.5 * P.vaz - lx * 0.05 - yawVel * 0.3) * dt;
  P.ax = Math.max(-0.85, Math.min(0.85, P.ax + P.vax * dt));
  P.az = Math.max(-0.85, Math.min(0.85, P.az + P.vaz * dt));
  charmSwing.rotation.x = P.ax;
  charmSwing.rotation.z = P.az;
}
window.__charmTest = () => { iHaveOwnerCharm = true; syncCharm(); };   // debug: preview the charm
// ---- Charms menu (opened from the Weapons panel's Charm button) ----
function buildCharmsUI() {
  if (document.getElementById('ch-panel')) return;
  const st = document.createElement('style'); st.textContent = `
  #ch-panel{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;background:rgba(5,7,10,.62);backdrop-filter:blur(4px);font-family:inherit;color:#fff;}
  #ch-panel.open{display:flex;}
  #ch-card{background:rgba(17,19,25,.97);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:18px 20px;width:min(420px,92vw);box-shadow:0 18px 50px rgba(0,0,0,.6);animation:qpIn .18s ease-out;}
  #ch-card h2{margin:0 0 12px;font-size:19px;font-weight:900;letter-spacing:.02em;}
  .ch-item{display:flex;gap:13px;align-items:center;background:#22262f;border:2px solid rgba(255,255,255,.08);border-radius:13px;padding:12px;}
  .ch-item.owned{border-color:#e8b64c;background:linear-gradient(135deg,#2b2617,#22262f 60%);}
  .ch-ico{width:58px;height:58px;border-radius:11px;background:#161920;display:flex;align-items:center;justify-content:center;font-size:29px;flex:none;}
  .ch-item.owned .ch-ico{background:radial-gradient(circle at 40% 32%,#4a3d1c,#161920 75%);}
  .ch-info{flex:1;min-width:0;}
  .ch-info b{display:block;font-size:15px;font-weight:900;color:#f0d48a;}
  .ch-info span{display:block;font-size:11.5px;color:#9aa4b8;line-height:1.35;margin-top:2px;}
  .ch-eq{flex:none;background:#e8b64c;color:#1c1608;border:0;border-radius:9px;font-weight:900;font-size:12px;padding:9px 13px;cursor:pointer;}
  .ch-eq.off{background:#3a3f4c;color:#cfd6e2;}
  .ch-lock{flex:none;font-size:11px;font-weight:800;color:#7b8497;text-align:center;max-width:86px;}
  #ch-close{margin-top:13px;width:100%;background:#2c313d;border:1px solid rgba(255,255,255,.1);color:#e8ecf4;font-weight:800;font-size:13px;padding:10px;border-radius:10px;cursor:pointer;}
  `; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.id = 'ch-panel';
  panel.innerHTML = `<div id="ch-card"><h2>🔑 Charms</h2><div id="ch-list"></div><button id="ch-close">Close</button></div>`;
  document.body.appendChild(panel);
  const render = () => {
    const list = panel.querySelector('#ch-list'); list.innerHTML = '';
    const it = document.createElement('div');
    it.className = 'ch-item' + (iHaveOwnerCharm ? ' owned' : '');
    it.innerHTML = `<div class="ch-ico">👑</div>
      <div class="ch-info"><b>Owner Charm</b><span>A mini-you on a golden chain, swinging off your fist. It copies your outfit — live.</span></div>`
      + (iHaveOwnerCharm
        ? `<button class="ch-eq${charmEquipped ? '' : ' off'}">${charmEquipped ? 'Equipped ✓' : 'Equip'}</button>`
        : `<div class="ch-lock">🔒 Snipe AttackFace15 with the Sniper</div>`);
    it.querySelector('.ch-eq')?.addEventListener('click', () => {
      charmEquipped = !charmEquipped;
      localStorage.setItem('rivals.charm', charmEquipped ? 'on' : 'off');
      if (charmEquipped) syncCharm();
      render(); sfx.click?.();
    });
    list.appendChild(it);
  };
  panel.addEventListener('mousedown', (e) => { if (e.target === panel) panel.classList.remove('open'); });
  panel.querySelector('#ch-close').addEventListener('click', () => panel.classList.remove('open'));
  window.__charmsUi = { open: () => { render(); panel.classList.add('open'); } };
}
// live-update: if you change your outfit in the hub, the charm follows
setInterval(async () => {
  if (!iHaveOwnerCharm || !charmRoot) return;
  try {
    const res = await fetch('/api/avatar/' + encodeURIComponent(identity.name), { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } });
    const d = await res.json();
    const prof = d?.avatar?.r6 || R6_DEFAULT;
    if (JSON.stringify(prof) !== charmProfileJson) rebuildCharmMini(prof);
  } catch {}
}, 15000);

// ---- loadout picker: choose one weapon per class (all unlocked) ----
const CLASS_ORDER = ['primary', 'secondary', 'melee', 'utility'];
const CLASS_LABEL = { primary: 'Primary', secondary: 'Secondary', melee: 'Melee', utility: 'Utility' };
function weaponsOfClass(cls) {
  return Object.entries(WEAPONS).filter(([, w]) => w.class === cls).map(([id, w]) => ({ id, w }));
}
function sendLoadout() {
  try { localStorage.setItem('rivals.loadout', JSON.stringify(myPickedLoadout)); } catch {}
  net.send({ t: 'loadout', ids: myPickedLoadout });
}
function buildLoadoutUI() {
  if (document.getElementById('ld-open')) return;
  // ============ RIVALS-style weapon picker: left list, in-hand preview, ============
  // ============ right detail card, bottom Leave/Skin/Wrap/Charm bar ============
  const st = document.createElement('style'); st.textContent = `
  #ld-open{position:fixed;right:120px;top:10px;z-index:40;background:rgba(20,24,34,.82);border:1px solid rgba(255,255,255,.14);color:#fff;font-weight:800;font-size:14px;padding:11px 16px;border-radius:12px;cursor:pointer;backdrop-filter:blur(8px);}
  #ld-open:hover{background:rgba(40,48,66,.9);}
  #ld-panel{position:fixed;inset:0;z-index:60;display:none;font-family:inherit;color:#fff;}
  #ld-panel.open{display:block;}
  #ld-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,7,10,.88) 0%,rgba(5,7,10,.55) 26%,rgba(5,7,10,.06) 45%,rgba(5,7,10,.06) 62%,rgba(5,7,10,.5) 84%,rgba(5,7,10,.75) 100%);}
  #ld-side{position:absolute;left:0;top:0;bottom:0;width:250px;padding:14px 0 90px 14px;display:flex;flex-direction:column;}
  #ld-career{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
  #ld-career button{background:rgba(28,32,41,.92);border:1.5px solid rgba(255,255,255,.14);border-radius:9px;color:#cfd6e2;font-weight:800;font-size:12.5px;padding:7px 13px;cursor:pointer;}
  #ld-filters{display:flex;gap:5px;margin-bottom:10px;}
  #ld-filters button{background:rgba(28,32,41,.92);border:1.5px solid rgba(255,255,255,.12);border-radius:8px;width:32px;height:30px;font-size:14px;cursor:pointer;opacity:.65;}
  #ld-filters button.on{opacity:1;border-color:#fff;}
  #ld-list{flex:1;overflow-y:auto;scrollbar-width:none;padding-right:10px;}
  #ld-list::-webkit-scrollbar{display:none;}
  .ldr-head{font-size:10.5px;font-weight:900;text-transform:uppercase;letter-spacing:.14em;color:#6b73a1;margin:12px 0 4px 34px;}
  .ldr{display:flex;align-items:center;gap:9px;padding:5px 6px;border-radius:8px;cursor:pointer;}
  .ldr i{font-style:normal;width:25px;text-align:center;font-size:16px;filter:grayscale(.4);opacity:.75;}
  .ldr b{font-weight:700;font-size:14.5px;color:#8d94a8;transition:color .08s;}
  .ldr:hover b{color:#e6eaf2;}
  .ldr:hover i{opacity:1;filter:none;}
  .ldr.eq b{color:#fff;font-weight:900;}
  .ldr.eq i{opacity:1;filter:none;}
  .ldr.eq::after{content:'';width:7px;height:7px;border-radius:50%;background:#3d8bff;margin-left:auto;}
  #ld-card{position:absolute;right:18px;top:50%;transform:translateY(-50%);width:288px;background:rgba(16,18,24,.96);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:15px 15px 11px;box-shadow:0 18px 50px rgba(0,0,0,.5);}
  #ldc-cls{font-size:10.5px;font-weight:800;letter-spacing:.04em;color:#8d94a8;}
  #ldc-name{font-size:19px;font-weight:900;margin:1px 0 3px;}
  #ldc-desc{font-size:11.5px;line-height:1.45;color:#9aa2b5;min-height:32px;}
  #ldc-max{margin:10px 0 12px;height:26px;border-radius:7px;background:linear-gradient(90deg,#2f7de0,#3d8bff);display:flex;align-items:center;justify-content:flex-end;padding:0 10px;font-style:italic;font-weight:900;font-size:14px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.25);}
  .ldc-row{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.045);border-radius:9px;padding:8px 9px;margin-top:7px;cursor:pointer;}
  .ldc-row:hover{background:rgba(255,255,255,.08);}
  .ldc-row .ic{width:30px;height:30px;border-radius:7px;background:rgba(255,255,255,.07);display:grid;place-items:center;font-size:15px;}
  .ldc-row .tx{flex:1;}
  .ldc-row .tx b{display:block;font-size:13px;font-weight:800;}
  .ldc-row .tx small{display:block;font-size:10.5px;color:#8d94a8;}
  .ldc-row .go{width:26px;height:26px;border-radius:7px;background:#3d8bff;display:grid;place-items:center;font-weight:900;font-size:13px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.3);}
  #ldc-stats{display:none;margin-top:8px;font-size:12px;color:#cfd6e2;background:rgba(255,255,255,.04);border-radius:9px;padding:9px 11px;line-height:1.7;}
  #ldc-stats.show{display:block;}
  #ld-actions{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:rgba(10,12,16,.92);border:1px solid rgba(255,255,255,.08);border-radius:15px;padding:8px 10px;}
  #ld-leave{background:#d92d3a;border:none;border-radius:10px;color:#fff;font-weight:900;font-size:13.5px;padding:10px 18px;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.3);}
  .ld-act{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:10px;color:#cfd6e2;cursor:pointer;padding:6px 12px;display:flex;flex-direction:column;align-items:center;gap:0px;min-width:52px;}
  .ld-act i{font-style:normal;font-size:16px;}
  .ld-act small{font-size:10px;font-weight:800;}
  .ld-act:hover{background:rgba(255,255,255,.11);color:#fff;}`;
  document.head.appendChild(st);

  const btn = document.createElement('button'); btn.id = 'ld-open'; btn.textContent = '🎯 Loadout';
  document.body.appendChild(btn);
  const panel = document.createElement('div'); panel.id = 'ld-panel';
  panel.innerHTML = `
    <div id="ld-shade"></div>
    <div id="ld-side">
      <div id="ld-career"><button>🎖 Career</button></div>
      <div id="ld-filters"></div>
      <div id="ld-list"></div>
    </div>
    <div id="ld-card">
      <div id="ldc-cls">Standard Primary</div>
      <div id="ldc-name">Assault Rifle</div>
      <div id="ldc-desc"></div>
      <div id="ldc-max">MAX</div>
      <div class="ldc-row" data-r="contracts"><div class="ic">📜</div><div class="tx"><b>Contracts</b><small>Earn free rewards</small></div><div class="go">→</div></div>
      <div class="ldc-row" data-r="overview"><div class="ic">👁</div><div class="tx"><b>Overview</b><small>View weapon metrics</small></div><div class="go">→</div></div>
      <div id="ldc-stats"></div>
      <div class="ldc-row" data-r="stats"><div class="ic">📊</div><div class="tx"><b>Statistics</b><small>See lifetime data</small></div><div class="go">→</div></div>
    </div>
    <div id="ld-actions">
      <button id="ld-leave">✕ Leave</button>
      <button class="ld-act" data-a="skin"><i>🎨</i><small>Skin</small></button>
      <button class="ld-act" data-a="wrap"><i>🎁</i><small>Wrap</small></button>
      <button class="ld-act" data-a="charm"><i>🔑</i><small>Charm</small></button>
      <button class="ld-act" data-a="finisher"><i>💥</i><small>Finisher</small></button>
    </div>`;
  document.body.appendChild(panel);

  let ldPrev = null, ldDragOn = false;
  const clearPrev = () => { if (ldPrev) { camera.remove(ldPrev); ldPrev.traverse((n) => { n.geometry?.dispose(); n.material?.dispose?.(); }); ldPrev = null; } };
  const showPrev = (id) => {
    clearPrev();
    if (!inLobbyMode()) return;             // in the range/freeze you see it in-hand instead
    ldPrev = makeHeldWeapon(id);
    ldPrev.scale.setScalar(2.4);
    ldPrev.position.set(0, -0.12, -1.35);
    ldPrev.rotation.y = 0.7;
    camera.add(ldPrev);                     // camera lives in vmScene → draws over the world
  };
  window.__ldPrevTick = (dt) => { if (ldPrev && !ldDragOn) ldPrev.rotation.y += dt * 0.5; };
  const DESC = {
    primary: 'A dependable main weapon, useful in all situations.',
    secondary: 'A quick sidearm for when the fight gets close.',
    melee: 'Silent and deadly up close — backstabs hit hardest.',
    utility: 'Equipment that changes how you move and fight.',
  };
  let filterCls = null, selId = null;
  const applyInHand = (id) => {
    if (!game.waveMode && game.phase !== 'live' && game.phase !== 'podium') {
      me.weapon = id; me.ammo = me.ammo || freshAmmo();
      updateLoadoutHud(); updateAmmoHud();
    }
  };
  window.__applyInHand = applyInHand;
  const showCard = (id) => {
    const w = WEAPONS[id]; if (!w) return;
    selId = id;
    showPrev(id);
    panel.querySelector('#ldc-cls').textContent = 'Standard ' + (CLASS_LABEL[w.class] || w.class);
    panel.querySelector('#ldc-name').textContent = w.name;
    panel.querySelector('#ldc-desc').textContent = DESC[w.class] || '';
    const stats = panel.querySelector('#ldc-stats');
    stats.innerHTML = w.melee
      ? `Damage <b>${w.dmg}</b> · Swing <b>${w.rate}s</b> · Range <b>${w.range}</b>${w.backstabOneshot ? ' · Backstab <b>ONE-SHOT</b>' : ''}`
      : w.mag ? `Damage <b>${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''}</b> · Fire rate <b>${w.rate}s</b> · Mag <b>${w.mag}</b> · Reload <b>${w.reload}s</b>`
      : `Count <b>${w.count || '∞'}</b> · Rate <b>${w.rate}s</b>`;
  };
  const render = () => {
    const list = panel.querySelector('#ld-list'); list.innerHTML = '';
    for (const cls of CLASS_ORDER) {
      if (filterCls && cls !== filterCls) continue;
      const head = document.createElement('div'); head.className = 'ldr-head'; head.textContent = CLASS_LABEL[cls];
      list.appendChild(head);
      for (const { id, w } of weaponsOfClass(cls)) {
        const row = document.createElement('div');
        row.className = 'ldr' + (myPickedLoadout.includes(id) ? ' eq' : '');
        row.innerHTML = `<i>${WEAPON_ICONS[id] || '🔫'}</i><b>${w.name}</b>`;
        row.addEventListener('mouseenter', () => showCard(id));
        row.addEventListener('click', () => {
          const slot = CLASS_ORDER.indexOf(cls);
          myPickedLoadout[slot] = id;
          sendLoadout();
          applyInHand(id);
          showCard(id);
          render();
          sfx.click?.();
        });
        list.appendChild(row);
      }
    }
    // class filter icons
    const flt = panel.querySelector('#ld-filters'); flt.innerHTML = '';
    const icons = { all: '☰', primary: '🔫', secondary: '🔫', melee: '🗡', utility: '💣' };
    for (const f of ['all', ...CLASS_ORDER]) {
      const b = document.createElement('button');
      b.textContent = icons[f] || '·'; b.title = f;
      b.className = (filterCls === f || (f === 'all' && !filterCls)) ? 'on' : '';
      b.addEventListener('click', () => { filterCls = f === 'all' ? null : f; render(); });
      flt.appendChild(b);
    }
  };
  panel.querySelector('#ld-career button').addEventListener('click', () => toast?.('Career — coming soon'));
  panel.querySelectorAll('.ldc-row').forEach((r) => r.addEventListener('click', () => {
    const k = r.dataset.r;
    if (k === 'overview') panel.querySelector('#ldc-stats').classList.toggle('show');
    else toast?.((k === 'contracts' ? 'Contracts' : 'Statistics') + ' — coming soon');
  }));
  panel.querySelectorAll('.ld-act').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.a === 'skin') { panel.classList.remove('open'); document.getElementById('sk-open')?.click(); }
    else if (b.dataset.a === 'charm') window.__charmsUi?.open();
    else toast?.(b.querySelector('small').textContent + 's — coming soon');
  }));
  const shade = panel.querySelector('#ld-shade');
  shade.style.pointerEvents = 'auto';
  shade.addEventListener('mousedown', () => { ldDragOn = true; });
  addEventListener('mouseup', () => { ldDragOn = false; });
  addEventListener('mousemove', (e) => { if (ldDragOn && ldPrev) ldPrev.rotation.y += e.movementX * 0.013; });
  const close = () => { panel.classList.remove('open'); clearPrev(); };
  panel.querySelector('#ld-leave').addEventListener('click', close);
  btn.addEventListener('click', () => { render(); showCard(myPickedLoadout[0] || 'ar'); panel.classList.add('open'); });
  window.__ldAuto = { open: () => { render(); showCard(myPickedLoadout[0] || 'ar'); panel.classList.add('open'); }, close };
  // show the button every round — not mid-fight / podium / wave mode
  const syncBtn = () => {
    const show = !game.waveMode && !['live', 'podium'].includes(game.phase);
    btn.style.display = show ? 'block' : 'none';
    if (!show && panel.classList.contains('open')) close();
  };
  setInterval(syncBtn, 200); syncBtn();
}

// ---- skins shop UI (open cases, equip skins) ----
function buildSkinsUI() {
  if (document.getElementById('sk-open')) return;
  const st = document.createElement('style'); st.textContent = `
  #sk-open{position:fixed;right:12px;top:10px;z-index:40;background:rgba(20,24,34,.82);border:1px solid rgba(255,255,255,.14);color:#fff;font-weight:800;font-size:14px;padding:11px 16px;border-radius:12px;cursor:pointer;backdrop-filter:blur(8px);}
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
  `;
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
  let html = '';
  // ---- unique / custom skins get their own section ----
  const myUnique = (mySkins.owned || []).map((id) => SKIN_BY_ID[id]).filter((s) => s && s.unique);
  const isOwner = (identity.name || '').toLowerCase() === 'lilbugtrainer';
  if (myUnique.length) {
    const secTitle = isOwner ? '⭐ Your Skins' : '💎 Unique Skins';
    const chips = myUnique.map((s) => {
      const eq = mySkins.equipped[s.weapon] === s.id;
      return `<div class="sk-chip ${eq ? 'on' : ''}" data-w="${s.weapon}" data-s="${eq ? 'none' : s.id}" style="border-color:${RARITY_COLOR[s.rarity]};display:flex;align-items:center;gap:9px;box-shadow:0 0 14px ${RARITY_COLOR[s.rarity]}55">`
        + `<img src="${catPawIcon(40)}" width="34" height="34" style="border-radius:7px;background:#0e1320">`
        + `<div style="text-align:left"><small style="color:${RARITY_COLOR[s.rarity]}">${s.rarity}</small>${s.name}${eq ? ' ✓' : ''}</div></div>`;
    }).join('');
    html += `<div class="sk-wsec"><h3 style="color:${RARITY_COLOR.unique}">${secTitle}</h3><div class="sk-grid">${chips}</div></div>`;
  }
  // ---- normal per-weapon material skins ----
  html += SKIN_WEAPONS.map((w) => {
    const owned = (SKINS_BY_WEAPON[w] || []).filter((s) => !s.unique && mySkins.owned.includes(s.id));
    const eq = mySkins.equipped[w];
    const eqUnique = SKIN_BY_ID[eq]?.unique;   // a unique skin is equipped → "Default" isn't the active material
    const chips = [`<div class="sk-chip ${(!eq || eqUnique) ? 'on' : ''}" data-w="${w}" data-s="none">Default</div>`]
      .concat(owned.map((s) => `<div class="sk-chip ${eq === s.id ? 'on' : ''}" data-w="${w}" data-s="${s.id}" style="border-color:${eq === s.id ? '#fff' : RARITY_COLOR[s.rarity]}"><small style="color:${RARITY_COLOR[s.rarity]}">${s.rarity}</small>${s.name}</div>`));
    return `<div class="sk-wsec"><h3>${WEAPONS[w] ? WEAPONS[w].name : w}${owned.length ? '' : ' · <span style="color:#6a7284">no skins yet</span>'}</h3><div class="sk-grid">${chips.join('')}</div></div>`;
  }).join('');
  weps.innerHTML = html;
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
  katana: { x: 0.06, y: -0.2, z: -0.5 },
  bat: { x: 0.07, y: -0.2, z: -0.5 },
  butterfly: { x: 0.06, y: -0.22, z: -0.48 },
  daggers: { x: 0.03, y: -0.22, z: -0.46 },
  jumppad: { x: 0.03, y: -0.24, z: -0.58 },
  satchel: { x: 0.02, y: -0.22, z: -0.5 },
  catpaw: { x: 0.05, y: -0.04, z: -0.64 },
};
const VM_ADS = { x: 0, y: -0.166, z: -0.38 };
let vmBob = 0, vmKick = 0;

// ---- swingy animation state (springs + one-shot clips) ----
const vmAnim = {
  swayYaw: 0, swayPitch: 0, roll: 0, sprintK: 0, slideK: 0, airK: 0, landK: 0,
  lastRy: 0, lastPitch: 0,
  equipT: 1,                    // 0→1 raise-with-flick on weapon swap
  reloadStart: 0, reloadDur: 0, // hand-animated reload
  swingT: 1, swingSide: 1,      // melee arcs, alternating sides
  throwT: 1,                    // grenade / satchel overhand throw
  satchelBtnT: 1,               // satchel detonator button-press (right-click)
  bfEquipT: 1,                  // butterfly: flip-open on equip
  bfStabT: 1,                   // butterfly: reverse-grip heavy stab (right-click)
  bfInspectT: 1, bfInspectPrev: 1,   // butterfly: F inspect showcase
  boltT: 1,                     // sniper: work the bolt after every shot
  inspectDur: 5.5,              // duration of the running inspect (per weapon class)
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

// ---- keyframe tracks with per-segment speed curves ----
const EASES = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: easeOutBack,
  outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (Math.PI * 2 / 3)) + 1),
};
// keys: [{t, v, e}] — value at time t, eased INTO with curve e (each segment has its own speed curve)
function trackVal(keys, t) {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) { const a = keys[i - 1], b = keys[i]; const u = (t - a.t) / (b.t - a.t); return a.v + (b.v - a.v) * (EASES[b.e || 'inOutCubic'])(u); }
  }
  return keys[keys.length - 1].v;
}

// ---- butterfly knife choreography (keyframed off the RIVALS showcase footage) ----
// channels: bRx = blade fold, hARx/hBRx = handle fan, pRx/pRy/pRz = whole-knife
// twirl/tilt, vx..vrz = viewmodel (arm) offsets. All angles in radians.
const BF_TRK = {
  // EQUIP (0.5s): everything moves from frame one — handle whips a full spin
  // WHILE the blade snaps open WHILE the wrist untwists on all three axes.
  equip: {
    bRx:  [{ t: 0, v: Math.PI }, { t: 0.45, v: -0.3, e: 'outExpo' }, { t: 0.7, v: 0.1, e: 'outBack' }, { t: 1, v: 0, e: 'outQuad' }],
    hARx: [{ t: 0, v: -0.8 }, { t: 0.55, v: 6.6, e: 'outExpo' }, { t: 0.8, v: 6.15, e: 'outBack' }, { t: 1, v: 6.283, e: 'outElastic' }],
    pRx:  [{ t: 0, v: -0.5 }, { t: 0.4, v: 0.25, e: 'outExpo' }, { t: 0.75, v: -0.06, e: 'outBack' }, { t: 1, v: 0 }],
    pRz:  [{ t: 0, v: 0.7 }, { t: 0.35, v: -0.35, e: 'outExpo' }, { t: 0.7, v: 0.08, e: 'outBack' }, { t: 1, v: 0 }],
    pRy:  [{ t: 0, v: -0.6 }, { t: 0.45, v: 0.22, e: 'outExpo' }, { t: 1, v: 0, e: 'outCubic' }],
  },
  // HEAVY STAB (right-click, 0.5s): grip-flip + raise happen TOGETHER, then an
  // accelerating drive down with a wrist twist, recover while flipping back.
  stab: {
    bRx:  [{ t: 0, v: 0 }, { t: 0.24, v: -2.9, e: 'outExpo' }, { t: 0.58, v: -2.9 }, { t: 0.82, v: 0.18, e: 'outExpo' }, { t: 1, v: 0, e: 'outBack' }],
    hARx: [{ t: 0, v: 0 }, { t: 0.26, v: -6.283, e: 'outExpo' }, { t: 0.6, v: -6.283 }, { t: 0.88, v: -12.57, e: 'outExpo' }, { t: 1, v: -12.57 }],
    // group motion stays small so the blade stays framed — the plunge is the
    // HAND driving down in part-space (gPy/gPz below)
    vy:   [{ t: 0, v: 0 }, { t: 0.26, v: 0.15, e: 'outExpo' }, { t: 0.38, v: 0.16 }, { t: 0.52, v: -0.03, e: 'inCubic' }, { t: 0.72, v: -0.02 }, { t: 1, v: 0, e: 'inOutCubic' }],
    vz:   [{ t: 0, v: 0 }, { t: 0.26, v: 0.08, e: 'outExpo' }, { t: 0.52, v: -0.16, e: 'inCubic' }, { t: 0.72, v: -0.11 }, { t: 1, v: 0, e: 'inOutCubic' }],
    vrx:  [{ t: 0, v: 0 }, { t: 0.26, v: 0.45, e: 'outExpo' }, { t: 0.52, v: -0.18, e: 'inCubic' }, { t: 0.72, v: -0.12 }, { t: 1, v: 0, e: 'inOutCubic' }],
    vry:  [{ t: 0, v: 0 }, { t: 0.26, v: -0.2, e: 'outExpo' }, { t: 0.55, v: 0.08, e: 'outExpo' }, { t: 1, v: 0 }],
    vrz:  [{ t: 0, v: 0 }, { t: 0.26, v: 0.25, e: 'outExpo' }, { t: 0.52, v: -0.12, e: 'inCubic' }, { t: 1, v: 0, e: 'inOutCubic' }],
    gPy:  [{ t: 0, v: 0 }, { t: 0.26, v: 0.17, e: 'outExpo' }, { t: 0.38, v: 0.18 }, { t: 0.52, v: -0.13, e: 'inCubic' }, { t: 0.72, v: -0.09 }, { t: 1, v: 0, e: 'inOutCubic' }],
    gPz:  [{ t: 0, v: 0 }, { t: 0.26, v: 0.06, e: 'outExpo' }, { t: 0.52, v: -0.2, e: 'inCubic' }, { t: 0.72, v: -0.14 }, { t: 1, v: 0, e: 'inOutCubic' }],
  },
  // INSPECT (F, 3.4s): non-stop combo — snap up + instant fan, double-flip
  // DURING a full twirl, second fan DURING a sweep, aerial twirl INTO the side
  // pose, latch-rattle snap home. At least two channels are moving at all times.
  inspect: {
    // 5.5s, the exact routine: raise -> ONE clean flip -> pause at open display
    // -> flip again, landing BLADE-DOWN -> hold it -> flip back to normal grip
    // -> settle. Grip planted the whole time; pauses are real, spins are clean.
    vx:   [{ t: 0, v: 0 }, { t: 0.06, v: -0.09, e: 'outExpo' }, { t: 0.86, v: -0.07, e: 'inOutCubic' }, { t: 0.96, v: 0, e: 'outBack' }, { t: 1, v: 0 }],
    vy:   [{ t: 0, v: 0 }, { t: 0.06, v: 0.16, e: 'outExpo' }, { t: 0.1, v: 0.11, e: 'outQuad' }, { t: 0.16, v: 0.16, e: 'outBack' }, { t: 0.3, v: 0.14, e: 'inOutCubic' }, { t: 0.38, v: 0.09, e: 'outQuad' }, { t: 0.46, v: 0.15, e: 'outBack' }, { t: 0.64, v: 0.16, e: 'inOutCubic' }, { t: 0.7, v: 0.11, e: 'outQuad' }, { t: 0.78, v: 0.15, e: 'outBack' }, { t: 0.96, v: 0, e: 'outBack' }, { t: 1, v: 0 }],
    vz:   [{ t: 0, v: 0 }, { t: 0.06, v: -0.4, e: 'outExpo' }, { t: 0.86, v: -0.36, e: 'inOutCubic' }, { t: 0.96, v: 0, e: 'outBack' }, { t: 1, v: 0 }],
    vrx:  [{ t: 0, v: 0 }, { t: 0.06, v: 0.12, e: 'outExpo' }, { t: 0.1, v: 0.28, e: 'outExpo' }, { t: 0.18, v: 0.1, e: 'outBack' }, { t: 0.38, v: 0.25, e: 'outExpo' }, { t: 0.46, v: 0.08, e: 'outBack' }, { t: 0.7, v: 0.22, e: 'outExpo' }, { t: 0.78, v: 0.06, e: 'outBack' }, { t: 1, v: 0, e: 'outBack' }],
    vry:  [{ t: 0, v: 0 }, { t: 0.08, v: 0.2, e: 'outExpo' }, { t: 0.4, v: 0.12, e: 'inOutCubic' }, { t: 0.7, v: 0.22, e: 'inOutCubic' }, { t: 0.96, v: 0, e: 'outBack' }, { t: 1, v: 0 }],
    vrz:  [{ t: 0, v: 0 }, { t: 0.08, v: -0.18, e: 'outExpo' }, { t: 0.16, v: 0.06, e: 'outBack' }, { t: 0.36, v: -0.15, e: 'outExpo' }, { t: 0.46, v: 0.05, e: 'outBack' }, { t: 0.68, v: -0.15, e: 'outExpo' }, { t: 0.78, v: 0.04, e: 'outBack' }, { t: 0.96, v: 0, e: 'outBack' }, { t: 1, v: 0 }],
    // wrist DRIVES each flip: cock back, SNAP through with the rotation, settle
    pRx:  [{ t: 0, v: 0 }, { t: 0.035, v: 0.22, e: 'outQuad' }, { t: 0.09, v: -0.62, e: 'outExpo' }, { t: 0.16, v: -0.28, e: 'outBack' }, { t: 0.28, v: -0.2, e: 'inOutCubic' }, { t: 0.315, v: 0.18, e: 'outQuad' }, { t: 0.38, v: -0.55, e: 'outExpo' }, { t: 0.46, v: 0.18, e: 'outBack' }, { t: 0.6, v: 0.15, e: 'inOutCubic' }, { t: 0.635, v: 0.35, e: 'outQuad' }, { t: 0.7, v: -0.5, e: 'outExpo' }, { t: 0.78, v: -0.15, e: 'outBack' }, { t: 0.96, v: 0, e: 'outBack' }, { t: 1, v: 0 }],
    pRy:  [{ t: 0, v: 0 }, { t: 0.12, v: 0.2, e: 'inOutCubic' }, { t: 0.24, v: -0.15, e: 'inOutCubic' }, { t: 0.4, v: 0.15, e: 'inOutCubic' }, { t: 0.56, v: -0.12, e: 'inOutCubic' }, { t: 0.72, v: 0.15, e: 'inOutCubic' }, { t: 0.9, v: -0.08, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    pRz:  [{ t: 0, v: 0 }, { t: 0.04, v: -0.15, e: 'outQuad' }, { t: 0.1, v: 0.3, e: 'outExpo' }, { t: 0.18, v: 0, e: 'outBack' }, { t: 0.3, v: -0.1, e: 'inOutCubic' }, { t: 0.36, v: 0.28, e: 'outExpo' }, { t: 0.46, v: -0.05, e: 'outBack' }, { t: 0.6, v: 0, e: 'inOutCubic' }, { t: 0.66, v: 0.25, e: 'outExpo' }, { t: 0.76, v: -0.08, e: 'outBack' }, { t: 0.9, v: 0.05, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    // blade: flip #1 lands open, flip #2 lands BLADE-DOWN (-14.13 = -1.57 mod 2pi),
    // flip #3 returns to open grip (-18.85 = -6pi). Overshoot + settle on each land.
    bRx:  [{ t: 0, v: 0 }, { t: 0.05, v: 0 }, { t: 0.16, v: -6.28, e: 'outExpo' }, { t: 0.19, v: -6.13, e: 'outBack' }, { t: 0.3, v: -6.28, e: 'inOutCubic' }, { t: 0.42, v: -14.35, e: 'outExpo' }, { t: 0.48, v: -14.13, e: 'outBack' }, { t: 0.62, v: -14.13 }, { t: 0.74, v: -18.6, e: 'outExpo' }, { t: 0.78, v: -18.95, e: 'outBack' }, { t: 0.84, v: -18.85, e: 'outQuad' }, { t: 1, v: -18.85 }],
    // bite handle chases the blade a beat behind, wiggles during the blade-down hold
    hARx: [{ t: 0, v: 0 }, { t: 0.06, v: 0 }, { t: 0.17, v: -6.28, e: 'outExpo' }, { t: 0.2, v: -6.1, e: 'outBack' }, { t: 0.3, v: -6.28, e: 'inOutCubic' }, { t: 0.43, v: -12.57, e: 'outExpo' }, { t: 0.5, v: -12.57 }, { t: 0.55, v: -12.4, e: 'inOutCubic' }, { t: 0.6, v: -12.57, e: 'inOutCubic' }, { t: 0.75, v: -18.85, e: 'outExpo' }, { t: 0.8, v: -18.55, e: 'outBack' }, { t: 0.88, v: -18.85, e: 'outQuad' }, { t: 0.96, v: -18.7, e: 'outExpo' }, { t: 1, v: -18.85, e: 'outElastic' }],
    hBRx: [{ t: 0, v: 0 }, { t: 0.17, v: 0.06, e: 'inOutCubic' }, { t: 0.3, v: 0, e: 'inOutCubic' }, { t: 0.43, v: -0.06, e: 'inOutCubic' }, { t: 0.62, v: 0, e: 'inOutCubic' }, { t: 0.76, v: 0.06, e: 'inOutCubic' }, { t: 1, v: 0, e: 'inOutCubic' }],   // held handle: planted
  },
};

// ---- generic inspects (F) for every other weapon class ----
const GEN_INSPECT = {
  gun: {   // 2.6s: raise, show the left face, roll to the right face, tip up, back
    vx:  [{ t: 0, v: 0 }, { t: 0.1, v: -0.12, e: 'outExpo' }, { t: 0.85, v: -0.1, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vy:  [{ t: 0, v: 0 }, { t: 0.1, v: 0.1, e: 'outExpo' }, { t: 0.75, v: 0.08, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vz:  [{ t: 0, v: 0 }, { t: 0.1, v: -0.18, e: 'outExpo' }, { t: 0.75, v: -0.16, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vrx: [{ t: 0, v: 0 }, { t: 0.1, v: 0.15, e: 'outExpo' }, { t: 0.35, v: 0.1, e: 'inOutCubic' }, { t: 0.6, v: 0.35, e: 'inOutCubic' }, { t: 0.8, v: 0.15, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vry: [{ t: 0, v: 0 }, { t: 0.12, v: 0.55, e: 'outExpo' }, { t: 0.35, v: 0.55 }, { t: 0.5, v: -0.75, e: 'inOutCubic' }, { t: 0.68, v: -0.75 }, { t: 0.85, v: -0.2, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vrz: [{ t: 0, v: 0 }, { t: 0.12, v: 0.35, e: 'outExpo' }, { t: 0.35, v: 0.3, e: 'inOutCubic' }, { t: 0.5, v: -0.3, e: 'inOutCubic' }, { t: 0.68, v: -0.35 }, { t: 1, v: 0, e: 'outBack' }],
  },
  melee: {   // 2.6s: raise, edge-on admire both sides, spin-flourish (part-level), back
    vx:  [{ t: 0, v: 0 }, { t: 0.1, v: -0.1, e: 'outExpo' }, { t: 0.85, v: -0.08, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vy:  [{ t: 0, v: 0 }, { t: 0.1, v: 0.14, e: 'outExpo' }, { t: 0.8, v: 0.11, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vz:  [{ t: 0, v: 0 }, { t: 0.1, v: -0.3, e: 'outExpo' }, { t: 0.8, v: -0.26, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vrx: [{ t: 0, v: 0 }, { t: 0.1, v: 0.2, e: 'outExpo' }, { t: 0.3, v: 0.1, e: 'inOutCubic' }, { t: 0.75, v: 0.15, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vry: [{ t: 0, v: 0 }, { t: 0.12, v: 0.5, e: 'outExpo' }, { t: 0.4, v: 0.5 }, { t: 0.55, v: -0.4, e: 'inOutCubic' }, { t: 0.75, v: -0.4 }, { t: 1, v: 0, e: 'outBack' }],
    vrz: [{ t: 0, v: 0 }, { t: 0.12, v: -0.25, e: 'outExpo' }, { t: 0.55, v: 0.3, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
  },
  util: {   // 2.2s: hold it up + (part-level turntable), small toss-catch, back
    vx:  [{ t: 0, v: 0 }, { t: 0.1, v: -0.12, e: 'outExpo' }, { t: 0.85, v: -0.1, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vy:  [{ t: 0, v: 0 }, { t: 0.1, v: 0.16, e: 'outExpo' }, { t: 0.8, v: 0.13, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vz:  [{ t: 0, v: 0 }, { t: 0.1, v: -0.28, e: 'outExpo' }, { t: 0.8, v: -0.24, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vrx: [{ t: 0, v: 0 }, { t: 0.1, v: 0.2, e: 'outExpo' }, { t: 0.8, v: 0.1, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vry: [{ t: 0, v: 0 }, { t: 0.15, v: 0.3, e: 'outExpo' }, { t: 0.7, v: -0.3, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
    vrz: [{ t: 0, v: 0 }, { t: 0.12, v: -0.12, e: 'outExpo' }, { t: 0.6, v: 0.12, e: 'inOutCubic' }, { t: 1, v: 0, e: 'outBack' }],
  },
  fists: {   // 1.8s: raise the fists, knuckle-flex (part-level does the work)
    vx:  [{ t: 0, v: 0 }, { t: 1, v: 0 }],
    vy:  [{ t: 0, v: 0 }, { t: 0.15, v: 0.05, e: 'outExpo' }, { t: 0.85, v: 0.04 }, { t: 1, v: 0, e: 'outBack' }],
    vz:  [{ t: 0, v: 0 }, { t: 0.15, v: -0.06, e: 'outExpo' }, { t: 0.85, v: -0.05 }, { t: 1, v: 0, e: 'outBack' }],
    vrx: [{ t: 0, v: 0 }, { t: 0.15, v: 0.1, e: 'outExpo' }, { t: 1, v: 0, e: 'outBack' }],
    vry: [{ t: 0, v: 0 }, { t: 1, v: 0 }],
    vrz: [{ t: 0, v: 0 }, { t: 1, v: 0 }],
  },
};
// ============ BUTTERFLY ANIM STUDIO (Dev Tools): hand-edit BF_TRK keyframes live ============
const BF_DEFAULT = JSON.parse(JSON.stringify(BF_TRK));
const BFE_CH = { bRx: 'Blade fold', hARx: 'Bite handle', hBRx: 'Safe handle', pRx: 'Wrist X', pRy: 'Wrist Y', pRz: 'Wrist Z', vx: 'Arm X', vy: 'Arm Y', vz: 'Arm Z', vrx: 'Arm rotX', vry: 'Arm rotY', vrz: 'Arm rotZ', gPy: 'Hand driveY', gPz: 'Hand driveZ', blur: 'Spin blur' };
const BFE_DUR = { equip: 0.5, stab: 0.5, inspect: 5.5 };
const bfe = { open: false, track: 'inspect', t: 0, playing: false, loop: true, speed: 1, sel: null };
// ---- undo/redo: Cmd-Z / Shift-Cmd-Z — snapshot before every gesture ----
const bfeUndo = { stack: [], redo: [] };
function bfeSnapshot() {
  bfeUndo.stack.push({ track: bfe.track, data: JSON.stringify(BF_TRK[bfe.track]) });
  if (bfeUndo.stack.length > 120) bfeUndo.stack.shift();
  bfeUndo.redo.length = 0;
}
function bfeRestore(from, to) {
  const snap = from.pop();
  if (!snap) { toast(from === bfeUndo.stack ? 'Nothing to undo' : 'Nothing to redo'); return; }
  to.push({ track: snap.track, data: JSON.stringify(BF_TRK[snap.track]) });
  bfe.track = snap.track;
  BF_TRK[snap.track] = JSON.parse(snap.data);
  bfe.sel = null;
  if (bfePanel) {
    bfePanel.querySelector('#bfe-ins').style.display = 'none';
    bfePanel.querySelectorAll('.bfe-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.trk === snap.track));
  }
  bfeBuildRows(); bfeSyncTransport();
}
addEventListener('keydown', (e) => {
  if (!bfe.open || e.code !== 'KeyZ' || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  e.shiftKey ? bfeRestore(bfeUndo.redo, bfeUndo.stack) : bfeRestore(bfeUndo.stack, bfeUndo.redo);
});
function applyBfAnim(anim) {
  if (!anim || typeof anim !== 'object') return;
  for (const trk of ['equip', 'stab', 'inspect']) {
    if (!anim[trk] || !BF_TRK[trk]) continue;
    for (const [ch, keys] of Object.entries(anim[trk]))
      if (Array.isArray(keys) && keys.length >= 2) BF_TRK[trk][ch] = keys.map((k) => ({ ...k }));
  }
}
(async () => {   // published anim first, then any local draft on top
  try { const d = await fetch('/api/rivals/bfanim', { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } }).then((r) => r.json()); applyBfAnim(d?.anim); } catch {}
  try { applyBfAnim(JSON.parse(localStorage.getItem('rivals.bfDraft') || 'null')); } catch {}
})();
let bfePanel = null;
const bfeStrips = new Map();   // ch -> canvas
function bfeChannels() { return Object.keys(BF_TRK[bfe.track]); }
function bfeDrawStrip(ch) {
  const cv = bfeStrips.get(ch); if (!cv) return;
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1a1d25'; ctx.fillRect(0, 0, W, H);
  const keys = BF_TRK[bfe.track][ch] || [];
  // value curve (normalized to this channel's own range)
  let lo = Infinity, hi = -Infinity;
  for (const k of keys) { lo = Math.min(lo, k.v); hi = Math.max(hi, k.v); }
  if (hi - lo < 0.001) { hi += 0.5; lo -= 0.5; }
  ctx.strokeStyle = 'rgba(120,190,255,.5)'; ctx.beginPath();
  for (let x = 0; x <= W; x += 3) {
    const v = trackVal(keys, x / W);
    const y = H - 3 - (v - lo) / (hi - lo) * (H - 6);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (const k of keys) {
    const x = k.t * W, y = H - 3 - (k.v - lo) / (hi - lo) * (H - 6);
    ctx.fillStyle = bfe.sel?.key === k ? '#ffd257' : '#e8ecf4';
    ctx.beginPath(); ctx.arc(x, y, bfe.sel?.key === k ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ff5d6c'; ctx.fillRect(bfe.t * W - 1, 0, 2, H);
}
function bfeRedraw() { for (const ch of bfeStrips.keys()) bfeDrawStrip(ch); }
function bfeSyncTransport() {
  if (!bfePanel) return;
  const sc = bfePanel.querySelector('#bfe-scrub'); if (sc && document.activeElement !== sc) sc.value = bfe.t;
  const tl = bfePanel.querySelector('#bfe-time'); if (tl) tl.textContent = (bfe.t * BFE_DUR[bfe.track]).toFixed(2) + 's';
  bfeRedraw(); bfeDrawPoses(); bfeSyncSliders();
}
function bfeSelect(ch, key) {
  bfe.sel = key ? { ch, key } : null;
  const ins = bfePanel.querySelector('#bfe-ins');
  if (!bfe.sel) { ins.style.display = 'none'; bfeRedraw(); return; }
  ins.style.display = 'block';
  bfePanel.querySelector('#bfe-ins-ch').textContent = (BFE_CH[ch] || ch) + ` (${ch})`;
  bfePanel.querySelector('#bfe-t').value = key.t;
  bfePanel.querySelector('#bfe-v').value = key.v;
  const sl = bfePanel.querySelector('#bfe-vs');
  sl.min = (key.v - 3.5).toFixed(2); sl.max = (key.v + 3.5).toFixed(2); sl.value = key.v;
  bfePanel.querySelector('#bfe-e').value = key.e || 'inOutCubic';
  bfeRedraw();
}
function bfeBuildRows() {
  const rows = bfePanel.querySelector('#bfe-rows'); rows.innerHTML = ''; bfeStrips.clear();
  for (const ch of bfeChannels()) {
    const row = document.createElement('div'); row.className = 'bfe-row';
    const lab = document.createElement('span'); lab.textContent = BFE_CH[ch] || ch; lab.title = ch;
    const cv = document.createElement('canvas'); cv.width = 236; cv.height = 26;
    let drag = null;
    const keyAt = (ev) => {
      const r = cv.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width;
      const keys = BF_TRK[bfe.track][ch];
      let best = null, bd = 0.045;
      for (const k of keys) { const d = Math.abs(k.t - x); if (d < bd) { bd = d; best = k; } }
      return { x, key: best };
    };
    cv.addEventListener('mousedown', (ev) => {
      const { x, key } = keyAt(ev);
      if (key) { bfeSnapshot(); bfeSelect(ch, key); drag = key; }
      else { bfe.t = Math.max(0, Math.min(1, x)); bfe.playing = false; bfeSyncTransport(); }
    });
    cv.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      const r = cv.getBoundingClientRect();
      drag.t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      BF_TRK[bfe.track][ch].sort((a, b) => a.t - b.t);
      bfePanel.querySelector('#bfe-t').value = drag.t.toFixed(3);
      bfeDrawStrip(ch);
    });
    addEventListener('mouseup', () => { drag = null; });
    cv.addEventListener('dblclick', (ev) => {
      const { x } = keyAt(ev);
      const keys = BF_TRK[bfe.track][ch];
      bfeSnapshot();
      const nk = { t: Math.max(0, Math.min(1, x)), v: trackVal(keys, x), e: 'inOutCubic' };
      keys.push(nk); keys.sort((a, b) => a.t - b.t);
      bfeSelect(ch, nk);
    });
    row.append(lab, cv); rows.appendChild(row);
    bfeStrips.set(ch, cv);
  }
  bfeRedraw();
}
// ---- SIMPLE MODE: friendly sliders that pose the knife at the playhead ----
const BFE_SLIDERS = [
  { ch: 'bRx', label: 'Blade spin', min: -4, max: 4, step: 0.05, unit: 'turns', toV: (x) => x * Math.PI * 2, fromV: (v) => v / (Math.PI * 2) },
  { ch: 'hARx', label: 'Handle spin', min: -4, max: 4, step: 0.05, unit: 'turns', toV: (x) => x * Math.PI * 2, fromV: (v) => v / (Math.PI * 2) },
  { ch: 'pRx', label: 'Tilt up/down', min: -120, max: 120, step: 1, unit: '°', toV: (x) => x * Math.PI / 180, fromV: (v) => v * 180 / Math.PI },
  { ch: 'pRy', label: 'Turn left/right', min: -120, max: 120, step: 1, unit: '°', toV: (x) => x * Math.PI / 180, fromV: (v) => v * 180 / Math.PI },
  { ch: 'pRz', label: 'Twist', min: -120, max: 120, step: 1, unit: '°', toV: (x) => x * Math.PI / 180, fromV: (v) => v * 180 / Math.PI },
  { ch: 'vx', label: 'Hand left/right', min: -0.5, max: 0.5, step: 0.01, unit: '', toV: (x) => x, fromV: (v) => v },
  { ch: 'vy', label: 'Hand up/down', min: -0.5, max: 0.5, step: 0.01, unit: '', toV: (x) => x, fromV: (v) => v },
  { ch: 'vz', label: 'Hand close/far', min: -0.7, max: 0.3, step: 0.01, unit: '', toV: (x) => x, fromV: (v) => v },
  { ch: 'blur', label: 'Spin blur ✨', min: 0, max: 1, step: 0.01, unit: '', toV: (x) => x, fromV: (v) => v },
];
// ---- 3D preview: the real balisong floating in view — drag to orbit, click a piece to select it ----
let bfePrev = null;
const BFE_PART_CH = { blade: 'bRx', hA: 'hARx', hB: 'hBRx' };
const BFE_PART_NAME = { blade: 'Blade', hA: 'Bite handle', hB: 'Safe handle', pivot: 'Whole knife' };
function bfeBuildPrev() {
  if (bfePrev) return;
  const { pivot, bladeG, hA, hB, blurMesh } = makeBalisong();
  const spin = new THREE.Group(); spin.add(pivot);
  const root = new THREE.Group();
  root.position.set(-0.34, 0.15, -1.02);
  root.scale.setScalar(1.4);
  root.visible = false;
  root.add(spin);
  // clone materials so selection highlights never touch the real viewmodel
  const seen = new Map();
  spin.traverse((m) => { if (m.isMesh) { if (!seen.has(m.material)) seen.set(m.material, m.material.clone()); m.material = seen.get(m.material); } });
  camera.add(root);
  bfePrev = { root, spin, pivot, blade: bladeG, hA, hB, blur: blurMesh, yaw: 0.7, pitch: 0.3, selPart: null };
}
function bfeHighlightPart(part) {
  if (!bfePrev) return;
  bfePrev.selPart = part;
  for (const [nm, grp] of [['blade', bfePrev.blade], ['hA', bfePrev.hA], ['hB', bfePrev.hB]])
    grp.traverse((m) => { if (m.isMesh && m.material.emissive) m.material.emissive.setHex(part === nm ? 0x8a6a1c : 0x000000); });
  bfePanel?.querySelectorAll('.bfe-sl').forEach((r) => r.classList.remove('hl'));
  const ch = BFE_PART_CH[part];
  const sl = ch && bfePanel?.querySelector(`[data-sl="${ch}"]`);
  if (sl) sl.closest('.bfe-sl').classList.add('hl');
  if (part) toast(`🎯 ${BFE_PART_NAME[part]} selected` + (part === 'hB' ? ' — it stays in your grip (edit in 🛠)' : ''));
}
function bfeTickPrev() {
  if (!bfePrev) return;
  const show = bfe.open && me.weapon === 'butterfly';
  bfePrev.root.visible = show;
  if (!show) return;
  bfePrev.spin.rotation.set(bfePrev.pitch, bfePrev.yaw, 0);
  const P2 = bfePrev;
  if (bfeRecActive()) {
    const R = bfeRec.vals;
    P2.blade.rotation.set(R.bRx, 0, 0); P2.hA.rotation.set(R.hARx, 0, 0); P2.hB.rotation.set(0, 0, 0);
    P2.pivot.rotation.set(R.pRx, R.pRy, R.pRz); P2.pivot.position.set(0, 0, 0);
    return;
  }
  const T = BF_TRK[bfe.track], t2 = bfe.t;
  P2.blade.rotation.set(0, 0, 0); P2.hA.rotation.set(0, 0, 0); P2.hB.rotation.set(0, 0, 0);
  P2.pivot.rotation.set(0, 0, 0); P2.pivot.position.set(0, 0, 0);
  if (T.bRx) P2.blade.rotation.x = trackVal(T.bRx, t2);
  if (T.hARx) P2.hA.rotation.x = trackVal(T.hARx, t2);
  if (T.hBRx) P2.hB.rotation.x = trackVal(T.hBRx, t2);
  if (T.pRx) P2.pivot.rotation.x = trackVal(T.pRx, t2);
  if (T.pRy) P2.pivot.rotation.y = trackVal(T.pRy, t2);
  if (T.pRz) P2.pivot.rotation.z = trackVal(T.pRz, t2);
  if (T.vx) P2.pivot.position.x = trackVal(T.vx, t2) * 0.45;
  if (T.vy) P2.pivot.position.y = trackVal(T.vy, t2) * 0.45;
  if (T.vz) P2.pivot.position.z = trackVal(T.vz, t2) * 0.45;
  if (P2.blur) {
    const bk = T.blur ? trackVal(T.blur, t2) : 0;
    const on = bk > 0.03, hide = bk > 0.5;
    P2.blur.visible = on;
    P2.blade.visible = !hide; P2.hA.visible = !hide; P2.hB.visible = !hide;
    if (on) {
      P2.blur.material.opacity = Math.min(1, bk) * (0.24 + 0.14 * (0.5 + 0.5 * Math.sin(performance.now() / 16)));
      P2.blur.rotation.z = (performance.now() / 22) % (Math.PI * 2);
    }
  }
}
{ // direct manipulation on the 3D preview: grab pieces with the mouse
  const bfeRay = new THREE.Raycaster();
  let bd = null;
  const bfePartAt = (e) => {
    camera.updateMatrixWorld();
    bfeRay.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hits = bfeRay.intersectObject(bfePrev.spin, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && o !== bfePrev.spin) {
      if (o === bfePrev.blade) return 'blade';
      if (o === bfePrev.hA) return 'hA';
      if (o === bfePrev.hB) return 'hB';
      o = o.parent;
    }
    return null;
  };
  canvas.addEventListener('contextmenu', (e) => { if (bfe.open || bfeRec) e.preventDefault(); });
  canvas.addEventListener('mousedown', (e) => {
   try {
    if (bfeRecActive()) { if (e.button === 2) bfeRec.twist = true; return; }
    if (!bfe.open || !bfePrev) return;
    bfe.playing = false;
    if (e.button === 0) {
      const part = bfePartAt(e);
      if (part) {   // grab the piece — dragging rotates IT and drops a key at the playhead
        bfeSnapshot();
        bfeHighlightPart(part);
        const ch = BFE_PART_CH[part];
        bd = { mode: 'part', ch, v: trackVal(bfeChanKeys(ch), bfe.t), x: e.clientX, y: e.clientY };
      } else bd = { mode: 'orbit', x: e.clientX, y: e.clientY, moved: false };
    } else if (e.button === 2) {
      bfeSnapshot();
      bd = { mode: 'wrist', x: e.clientX, y: e.clientY,
             rx: trackVal(bfeChanKeys('pRx'), bfe.t), ry: trackVal(bfeChanKeys('pRy'), bfe.t), rz: trackVal(bfeChanKeys('pRz'), bfe.t) };
    }
   } catch {}
  });
  addEventListener('mousemove', (e) => {
    if (!bd || !bfePrev) return;
    const dx = e.clientX - bd.x, dy = e.clientY - bd.y;
    if (bd.mode === 'orbit') {
      if (Math.abs(dx) + Math.abs(dy) > 3) bd.moved = true;
      bfePrev.yaw += dx * 0.011; bfePrev.pitch = Math.max(-1.4, Math.min(1.4, bfePrev.pitch + dy * 0.008));
      bd.x = e.clientX; bd.y = e.clientY;
    } else if (bd.mode === 'part') {
      bd.v -= dy * 0.02;   // drag up = swing open
      bfeUpsert(bd.ch, Math.round(bfe.t * 200) / 200, bd.v);
      bd.y = e.clientY; bd.x = e.clientX;
      bfeSyncSliders(); bfeRedraw(); bfeDrawPoses();
    } else if (bd.mode === 'wrist') {   // whole knife: tilt/turn, Shift = twist
      const t2 = Math.round(bfe.t * 200) / 200;
      if (e.shiftKey) { bd.rz += dx * 0.008; bfeUpsert('pRz', t2, Math.max(-2.1, Math.min(2.1, bd.rz))); }
      else { bd.ry += dx * 0.008; bfeUpsert('pRy', t2, Math.max(-2.1, Math.min(2.1, bd.ry))); }
      bd.rx += dy * 0.008; bfeUpsert('pRx', t2, Math.max(-2.1, Math.min(2.1, bd.rx)));
      bd.x = e.clientX; bd.y = e.clientY;
      bfeSyncSliders(); bfeRedraw(); bfeDrawPoses();
    }
  });
  addEventListener('mouseup', (e) => {
    if (bfeRec) { if (e.button === 2) bfeRec.twist = false; return; }
    if (!bd) return;
    if (bd.mode === 'orbit' && !bd.moved) bfeHighlightPart(null);   // empty click = deselect
    bd = null;
  });
}
// ---- LIVE RECORD: perform the trick with your mouse, the studio captures it ----
// move = wrist tilt/turn · hold RMB + move = twist · scroll = half-spin flips
let bfeRec = null;   // { started, dur, vals, targ, samples, countdownUntil }
function bfeRecActive() { return !!bfeRec && bfeRec.started; }
function bfeRecStart() {
  const dur = BFE_DUR[bfe.track] / bfe.speed;    // record in your chosen slow-mo
  bfeRec = {
    started: false, t0: 0, dur,
    vals: { pRx: 0, pRy: 0, pRz: 0, bRx: 0, hARx: 0 },
    targ: { bRx: 0, hARx: 0 },
    samples: { pRx: [], pRy: [], pRz: [], bRx: [], hARx: [] },
    twist: false,
  };
  try { canvas.requestPointerLock?.(); } catch {}
  let n = 3;
  const tick = () => {
    if (!bfeRec) return;
    if (n > 0) { banner(String(n), 800); sfx.beep?.(); n--; setTimeout(tick, 850); }
    else { banner('🔴 GO — DO YOUR TRICK', 1200); bfeRec.started = true; bfeRec.t0 = performance.now() / 1000; }
  };
  tick();
  const btn = bfePanel?.querySelector('#bfe-rec'); if (btn) { btn.textContent = '⏹ Stop'; btn.classList.add('on'); }
}
function bfeRecFinish(keep) {
  const rec = bfeRec; bfeRec = null;
  document.exitPointerLock?.();
  const btn = bfePanel?.querySelector('#bfe-rec'); if (btn) { btn.textContent = '⏺ Record'; btn.classList.remove('on'); }
  if (!rec || !keep || !rec.started) { if (rec) toast('Recording cancelled'); return; }
  // keyframe-simplify each performed channel (RDP), then it becomes the animation
  const rdp = (pts, eps) => {
    if (pts.length <= 2) return pts;
    const keepIdx = new Set([0, pts.length - 1]);
    const rec2 = (a, b) => {
      let mi = -1, md = 0;
      for (let i = a + 1; i < b; i++) {
        const t0 = pts[a], t1 = pts[b];
        const dv = t1.t === t0.t ? 0 : t0.v + (pts[i].t - t0.t) / (t1.t - t0.t) * (t1.v - t0.v);
        const d = Math.abs(pts[i].v - dv);
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps && mi > 0) { keepIdx.add(mi); rec2(a, mi); rec2(mi, b); }
    };
    rec2(0, pts.length - 1);
    return [...keepIdx].sort((x, y) => x - y).map((i) => pts[i]);
  };
  bfeSnapshot();   // a bad recording is one Cmd-Z away from gone
  const T = BF_TRK[bfe.track];
  for (const [ch, pts] of Object.entries(rec.samples)) {
    if (pts.length < 4) continue;
    let eps = ch === 'bRx' || ch === 'hARx' ? 0.09 : 0.035;
    let keys = rdp(pts, eps);
    while (keys.length > 58) { eps *= 1.5; keys = rdp(pts, eps); }
    T[ch] = keys.map((k) => ({ t: Math.round(k.t * 500) / 500, v: Math.round(k.v * 1000) / 1000, e: 'linear' }));
  }
  bfe.t = 0; bfeBuildRows(); bfeSyncTransport();
  toast('🎬 Recorded! Press ▶ to watch — sliders still work for touch-ups');
}
function bfeRecTick(dt) {
  if (!bfeRec) return;
  const R = bfeRec;
  if (!R.started) return;
  const now = performance.now() / 1000;
  const t = (now - R.t0) / R.dur;
  if (t >= 1) { bfeRecFinish(true); return; }
  const k = Math.min(1, dt * 15);   // flips snap toward their scroll target
  R.vals.bRx += (R.targ.bRx - R.vals.bRx) * k;
  R.vals.hARx += (R.targ.hARx - R.vals.hARx) * k;
  for (const ch of Object.keys(R.samples)) R.samples[ch].push({ t, v: R.vals[ch] });
  bfe.t = t; bfeSyncTransport();
}
addEventListener('wheel', (e) => {
  if (!bfeRecActive()) return;
  const d = e.deltaY > 0 ? -Math.PI : Math.PI;   // one notch = half a spin
  bfeRec.targ.bRx += d; bfeRec.targ.hARx += d;
  try { playOne('knife', 0.25); } catch {}
}, { passive: true });
document.addEventListener('pointerlockchange', () => {
  if (bfeRec && document.pointerLockElement !== canvas) bfeRecFinish(false);   // Esc = cancel
});
function bfeChanKeys(ch) {
  const trk = BF_TRK[bfe.track];
  if (!trk[ch]) trk[ch] = [{ t: 0, v: 0 }, { t: 1, v: 0 }];
  return trk[ch];
}
function bfeUpsert(ch, t, v) {
  const keys = bfeChanKeys(ch);
  const snappy = bfePanel?.querySelector('#bfe-snappy')?.checked;
  let k = keys.find((x) => Math.abs(x.t - t) < 0.02);
  if (k) { k.v = v; if (snappy) k.e = 'outExpo'; }
  else { keys.push({ t, v, e: snappy ? 'outExpo' : 'inOutCubic' }); keys.sort((a, b) => a.t - b.t); }
}
function bfePoseTimes() {
  const all = [];
  for (const keys of Object.values(BF_TRK[bfe.track])) for (const k of keys) all.push(k.t);
  all.sort((a, b) => a - b);
  const out = [];   // cluster within 0.03
  for (const t of all) { if (!out.length || t - out[out.length - 1].hi > 0.03) out.push({ lo: t, hi: t, c: t }); else { const c2 = out[out.length - 1]; c2.hi = t; c2.c = (c2.lo + c2.hi) / 2; } }
  return out;
}
function bfeDrawPoses() {
  const cv = bfePanel?.querySelector('#bfe-poses'); if (!cv) return;
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1a1d25'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2b3040'; ctx.fillRect(0, H / 2 - 1.5, W, 3);
  for (const p2 of bfePoseTimes()) {
    const x = p2.c * W, near = Math.abs(p2.c - bfe.t) < 0.02;
    ctx.fillStyle = near ? '#ffd257' : '#8fb6ff';
    ctx.beginPath(); ctx.moveTo(x, H / 2 - 8); ctx.lineTo(x + 6, H / 2); ctx.lineTo(x, H / 2 + 8); ctx.lineTo(x - 6, H / 2); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#ff5d6c'; ctx.fillRect(bfe.t * W - 1, 2, 2, H - 4);
}
function bfeSyncSliders() {
  if (!bfePanel) return;
  for (const def of BFE_SLIDERS) {
    const el = bfePanel.querySelector(`[data-sl="${def.ch}"]`); if (!el || document.activeElement === el) continue;
    const v = trackVal(bfeChanKeys(def.ch), bfe.t);
    el.value = def.fromV(v);
    const out = bfePanel.querySelector(`[data-slv="${def.ch}"]`);
    if (out) out.textContent = Number(el.value).toFixed(def.step >= 1 ? 0 : 2) + def.unit;
  }
}
function buildBfEditor() {
  if (bfePanel) return;
  const st = document.createElement('style'); st.textContent = `
  #bfe{position:fixed;right:12px;top:60px;bottom:12px;width:344px;z-index:80;display:none;flex-direction:column;gap:8px;background:rgba(15,17,22,.96);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px;color:#e8ecf4;font-family:inherit;font-size:12px;box-shadow:0 16px 48px rgba(0,0,0,.6);overflow-y:auto;}
  #bfe.open{display:flex;}
  #bfe h3{margin:0;font-size:14px;font-weight:900;}
  .bfe-tabs{display:flex;gap:5px;}
  .bfe-tabs button{flex:1;background:#262a34;border:1.5px solid rgba(255,255,255,.1);color:#cfd6e2;border-radius:8px;font-weight:800;font-size:11.5px;padding:6px;cursor:pointer;}
  .bfe-tabs button.on{background:#3b62d6;border-color:#6f92ff;color:#fff;}
  .bfe-tr{display:flex;gap:6px;align-items:center;}
  .bfe-tr button,.bfe-tr select{background:#262a34;border:1px solid rgba(255,255,255,.12);color:#e8ecf4;border-radius:7px;font-weight:800;font-size:12px;padding:5px 9px;cursor:pointer;}
  .bfe-tr button.on{background:#3b62d6;}
  #bfe-scrub{flex:1;}
  #bfe-poses{border-radius:7px;cursor:pointer;}
  .bfe-pbtn{display:flex;gap:6px;align-items:center;}
  .bfe-pbtn button{background:#262a34;border:1px solid rgba(255,255,255,.12);color:#e8ecf4;border-radius:7px;font-weight:800;font-size:11.5px;padding:6px 9px;cursor:pointer;}
  .bfe-pbtn button.on{background:#a3273b;border-color:#ff6f84;}
  .bfe-snapl{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:800;color:#9aa4b8;margin-left:auto;}
  .bfe-sl{display:flex;align-items:center;gap:7px;}
  .bfe-sl span{width:96px;flex:none;font-size:11px;font-weight:800;color:#aeb6c8;}
  .bfe-sl input{flex:1;}
  .bfe-sl b{width:52px;flex:none;text-align:right;font-size:10.5px;color:#7f8aa3;}
  .bfe-sl.hl{outline:2px solid #ffd257;outline-offset:2px;border-radius:6px;}
  .bfe-row{display:flex;gap:7px;align-items:center;}
  .bfe-row span{width:78px;flex:none;font-size:10.5px;font-weight:700;color:#9aa4b8;overflow:hidden;white-space:nowrap;}
  .bfe-row canvas{border-radius:6px;cursor:crosshair;}
  #bfe-ins{background:#1c2028;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:9px;display:none;}
  #bfe-ins label{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:11px;color:#9aa4b8;font-weight:700;}
  #bfe-ins input[type=number]{width:74px;background:#12151b;border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:6px;padding:4px 6px;font-size:12px;}
  #bfe-ins input[type=range]{flex:1;}
  #bfe-ins select{background:#12151b;border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:6px;padding:4px;font-size:11.5px;}
  .bfe-acts{display:flex;flex-wrap:wrap;gap:5px;}
  .bfe-acts button{background:#262a34;border:1px solid rgba(255,255,255,.12);color:#e8ecf4;border-radius:7px;font-weight:800;font-size:11px;padding:6px 8px;cursor:pointer;}
  #bfe-pub{background:#8a6a1c;}
  .bfe-hint{font-size:10px;color:#6f7890;line-height:1.4;}
  #bfe-adv{display:none;flex-direction:column;gap:6px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px;}
  #bfe-adv.show{display:flex;}
  `; document.head.appendChild(st);
  bfePanel = document.createElement('div'); bfePanel.id = 'bfe';
  bfePanel.innerHTML = `
    <h3>🦋 Butterfly Anim Studio</h3>
    <div class="bfe-tabs">` + ['equip', 'stab', 'inspect'].map((t) => `<button data-trk="${t}" class="${bfe.track === t ? 'on' : ''}">${t.toUpperCase()}</button>`).join('') + `</div>
    <div class="bfe-tr">
      <button id="bfe-play">▶</button>
      <button id="bfe-loop" class="on" title="Loop playback">🔁</button>
      <select id="bfe-speed"><option value="0.1">0.1×</option><option value="0.25">0.25×</option><option value="0.5" selected>0.5×</option><option value="1">1×</option></select>
      <input id="bfe-scrub" type="range" min="0" max="1" step="0.001" value="0">
      <b id="bfe-time">0.00s</b>
    </div>
    <canvas id="bfe-poses" width="308" height="34"></canvas>
    <div class="bfe-pbtn">
      <button id="bfe-rec" title="Perform the trick live with your mouse">⏺ Record</button>
      <button id="bfe-delpose">🗑 Delete pose</button>
      <label class="bfe-snapl"><input id="bfe-snappy" type="checkbox"> SNAP! (whippy)</label>
    </div>
    <div id="bfe-sliders">` + BFE_SLIDERS.map((d) => `
      <div class="bfe-sl"><span>${d.label}</span><input data-sl="${d.ch}" type="range" min="${d.min}" max="${d.max}" step="${d.step}"><b data-slv="${d.ch}"></b></div>`).join('') + `</div>
    <div class="bfe-acts">
      <button id="bfe-draft">💾 Save</button>
      <button id="bfe-reset">↺ Start over</button>
      <button id="bfe-pub" style="display:none;">⬆ Publish to game</button>
      <button id="bfe-advb" title="Advanced: keyframe lanes, export/import">🛠</button>
    </div>
    <div class="bfe-hint">GRAB the knife: drag a piece to swing it (blade or either handle), right-drag to tilt/turn the whole knife (hold Shift = twist), drag empty space to orbit your view. Every move drops a pose (♦) at the red line — scrub, pose, scrub, pose, then ▶ to watch it flow. Sliders do the same thing with numbers. Cmd-Z undoes any move (Shift-Cmd-Z redoes). SNAP! makes the next pose whippy. ⏺ Record = perform the whole trick live: mouse = wrist, right-click hold = twist, scroll = half-spin flips (your slow-mo speed applies).</div>
    <div id="bfe-adv">
      <div id="bfe-rows"></div>
      <div id="bfe-ins">
        <b id="bfe-ins-ch"></b>
        <label>t <input id="bfe-t" type="number" min="0" max="1" step="0.005"></label>
        <label>v <input id="bfe-v" type="number" step="0.01"><input id="bfe-vs" type="range" step="0.01"></label>
        <label>ease <select id="bfe-e">${Object.keys(EASES).map((e) => `<option>${e}</option>`).join('')}</select>
          <button id="bfe-del">🗑 key</button></label>
      </div>
      <div class="bfe-acts">
        <button id="bfe-add">＋ key @ playhead</button>
        <button id="bfe-exp">📋 Export</button>
        <button id="bfe-imp">📥 Import</button>
      </div>
    </div>`;
  document.body.appendChild(bfePanel);
  bfePanel.querySelectorAll('.bfe-tabs button').forEach((b) => b.addEventListener('click', () => {
    bfe.track = b.dataset.trk; bfe.t = 0; bfe.sel = null;
    bfePanel.querySelectorAll('.bfe-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    bfePanel.querySelector('#bfe-ins').style.display = 'none';
    bfeBuildRows(); bfeSyncTransport();
  }));
  bfePanel.querySelector('#bfe-play').addEventListener('click', () => {
    bfe.playing = !bfe.playing;
    if (bfe.playing && bfe.t >= 1) bfe.t = 0;
    bfePanel.querySelector('#bfe-play').textContent = bfe.playing ? '⏸' : '▶';
  });
  bfePanel.querySelector('#bfe-loop').addEventListener('click', (e) => { bfe.loop = !bfe.loop; e.target.classList.toggle('on', bfe.loop); });
  bfePanel.querySelector('#bfe-speed').addEventListener('change', (e) => { bfe.speed = Number(e.target.value); });
  bfePanel.querySelector('#bfe-scrub').addEventListener('input', (e) => { bfe.t = Number(e.target.value); bfe.playing = false; bfePanel.querySelector('#bfe-play').textContent = '▶'; bfeSyncTransport(); });
  // pose bar: click to jump (snaps to a nearby ♦)
  bfePanel.querySelector('#bfe-poses').addEventListener('mousedown', (ev) => {
    const cv = ev.target, r = cv.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const near = bfePoseTimes().find((p2) => Math.abs(p2.c - x) < 0.03);
    bfe.t = near ? near.c : x; bfe.playing = false;
    bfePanel.querySelector('#bfe-play').textContent = '▶';
    bfeSyncTransport();
  });
  bfePanel.querySelector('#bfe-rec').addEventListener('click', () => {
    if (bfeRec) { bfeRecFinish(true); return; }
    bfe.playing = false; bfePanel.querySelector('#bfe-play').textContent = '▶';
    bfeRecStart();
  });
  bfePanel.querySelector('#bfe-delpose').addEventListener('click', () => {
    const near = bfePoseTimes().find((p2) => Math.abs(p2.c - bfe.t) < 0.03);
    if (!near) { toast('Move the red line onto a ♦ first'); return; }
    bfeSnapshot();
    for (const ch of Object.keys(BF_TRK[bfe.track])) {
      const keys = BF_TRK[bfe.track][ch].filter((k) => k.t < near.lo - 0.001 || k.t > near.hi + 0.001);
      BF_TRK[bfe.track][ch] = keys.length >= 2 ? keys : [{ t: 0, v: keys[0]?.v ?? 0 }, { t: 1, v: keys[0]?.v ?? 0 }];
    }
    bfe.sel = null; bfeBuildRows(); bfeSyncTransport(); toast('Pose deleted');
  });
  // sliders: drag = pose the knife right at the playhead
  for (const def of BFE_SLIDERS) {
    const slEl = bfePanel.querySelector(`[data-sl="${def.ch}"]`);
    let inGesture = false;
    slEl.addEventListener('change', () => { inGesture = false; });
    slEl.addEventListener('input', (e) => {
      if (!inGesture) { bfeSnapshot(); inGesture = true; }
      const x = Number(e.target.value);
      bfeUpsert(def.ch, Math.round(bfe.t * 200) / 200, def.toV(x));
      const out = bfePanel.querySelector(`[data-slv="${def.ch}"]`);
      if (out) out.textContent = x.toFixed(def.step >= 1 ? 0 : 2) + def.unit;
      bfeRedraw(); bfeDrawPoses();
    });
  }
  const selKey = () => bfe.sel && (BF_TRK[bfe.track][bfe.sel.ch] || []).includes(bfe.sel.key) ? bfe.sel : null;
  bfePanel.querySelector('#bfe-t').addEventListener('input', (e) => { const s2 = selKey(); if (!s2) return; s2.key.t = Math.max(0, Math.min(1, Number(e.target.value) || 0)); BF_TRK[bfe.track][s2.ch].sort((a, b) => a.t - b.t); bfeRedraw(); bfeDrawPoses(); });
  const setV = (val) => { const s2 = selKey(); if (!s2) return; s2.key.v = Number(val) || 0; bfePanel.querySelector('#bfe-v').value = s2.key.v; bfeRedraw(); };
  bfePanel.querySelector('#bfe-v').addEventListener('input', (e) => setV(e.target.value));
  bfePanel.querySelector('#bfe-vs').addEventListener('input', (e) => setV(e.target.value));
  bfePanel.querySelector('#bfe-e').addEventListener('change', (e) => { const s2 = selKey(); if (s2) { s2.key.e = e.target.value; bfeRedraw(); } });
  bfePanel.querySelector('#bfe-del').addEventListener('click', () => {
    const s2 = selKey(); if (!s2) return;
    const keys = BF_TRK[bfe.track][s2.ch];
    if (keys.length <= 2) { toast('A lane needs at least 2 keys'); return; }
    bfeSnapshot();
    keys.splice(keys.indexOf(s2.key), 1); bfeSelect(s2.ch, null); bfeDrawPoses();
  });
  bfePanel.querySelector('#bfe-add').addEventListener('click', () => {
    const ch = bfe.sel?.ch || bfeChannels()[0];
    const keys = BF_TRK[bfe.track][ch];
    bfeSnapshot();
    const nk = { t: bfe.t, v: trackVal(keys, bfe.t), e: 'inOutCubic' };
    keys.push(nk); keys.sort((a, b) => a.t - b.t); bfeSelect(ch, nk); bfeDrawPoses();
  });
  bfePanel.querySelector('#bfe-draft').addEventListener('click', () => {
    try { localStorage.setItem('rivals.bfDraft', JSON.stringify(BF_TRK)); toast('Saved on this device 💾'); } catch {}
  });
  bfePanel.querySelector('#bfe-reset').addEventListener('click', () => {
    bfeSnapshot();
    BF_TRK[bfe.track] = JSON.parse(JSON.stringify(BF_DEFAULT[bfe.track]));
    bfe.sel = null; bfePanel.querySelector('#bfe-ins').style.display = 'none';
    bfeBuildRows(); bfeSyncTransport(); toast('Back to the default animation');
  });
  bfePanel.querySelector('#bfe-advb').addEventListener('click', () => bfePanel.querySelector('#bfe-adv').classList.toggle('show'));
  bfePanel.querySelector('#bfe-exp').addEventListener('click', () => { prompt('Copy your animation JSON:', JSON.stringify(BF_TRK)); });
  bfePanel.querySelector('#bfe-imp').addEventListener('click', () => {
    const j = prompt('Paste animation JSON:'); if (!j) return;
    try { bfeSnapshot(); applyBfAnim(JSON.parse(j)); bfeBuildRows(); bfeSyncTransport(); toast('Imported ✓'); } catch { toast('Bad JSON'); }
  });
  const pub = bfePanel.querySelector('#bfe-pub');
  if ((identity.name || '').toLowerCase() === 'attackface15') pub.style.display = 'block';
  pub.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/rivals/bfanim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' }, body: JSON.stringify({ name: identity.name, anim: BF_TRK }) });
      const d = await r.json();
      toast(d.ok ? '⬆ Published — this is now THE butterfly animation!' : (d.error || 'Publish failed'));
    } catch { toast('Publish failed'); }
  });
  bfeBuildRows();
}
function bfeOpen() {
  buildBfEditor();
  bfeBuildPrev();
  if (me.weapon !== 'butterfly') { try { switchWeapon('butterfly'); } catch {} }
  bfe.open = true; bfe.playing = false; bfe.t = 0;
  bfePanel.classList.add('open');
  bfePanel.querySelector('#bfe-play').textContent = '▶';
  document.exitPointerLock?.();
  bfeSyncTransport();
}
function bfeClose() {
  bfe.open = false;
  if (bfePrev) bfePrev.root.visible = false;
  bfePanel?.classList.remove('open');
  vmAnim.bfEquipT = 1; vmAnim.bfStabT = 1; vmAnim.bfInspectT = 1; vmAnim.bfInspectPrev = 1;
}
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyN' || !devTools) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (typeof chatting !== 'undefined' && chatting) return;
  if (bfe.open) { bfeClose(); return; }
  if (game.phase !== 'lobby') { toast('Anim Studio opens in the lobby'); return; }
  bfeOpen();
});

const inspectClassFor = (w) => (w === 'butterfly' ? 'butterfly' : WEAPONS[w]?.mag ? 'gun' : w === 'fists' ? 'fists' : WEAPONS[w]?.melee ? 'melee' : 'util');
const INSPECT_DUR = { butterfly: 5.5, gun: 2.6, melee: 2.6, fists: 1.8, util: 2.2 };

function freshAmmo() {
  const a = {};
  for (const [k, w] of Object.entries(WEAPONS)) if (w.mag) a[k] = { mag: w.mag, res: w.reserve };
  return a;
}
function switchWeapon(id) {
  if (!id || id === me.weapon || me.reloading) return;
  me.weapon = id;
  vmAnim.equipT = 0;             // raise-with-flick
  vmAnim.bfEquipT = 0; vmAnim.bfInspectT = 1;   // butterfly flips open; cancel inspect
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
  vmAnim.bfInspectT = 1;   // any attack intent cancels an inspect
  if (inLobbyMode()) {
    const now2 = clockNow();
    if (now2 > rangeHintAt) { toast('Weapons live in the SHOOTING RANGE — through the east door'); rangeHintAt = now2 + 3; }
    return;
  }
  if (me.weapon === 'warper') {
    const now2 = clockNow();
    if (me.dead || now2 - me.lastFire < WEAPONS.warper.rate) return;
    me.lastFire = now2;
    placePortal('A');
    return;
  }
  if ((!locked && !mobileOn) || me.dead) return;
  if (game.phase === 'freeze' || game.phase === 'vote' || game.phase === 'teleport' || game.phase === 'podium') return;
  const now = clockNow();
  const w = WEAPONS[me.weapon];
  if (w?.melee) {
    if (now - me.swingAt < w.rate) return;
    me.swingAt = now;
    vmAnim.swingT = 0; vmAnim.swingSide *= -1;   // arcs / alternating jabs
    vmAnim.bfInspectT = 1;                       // slashing cancels the inspect
    playOne(me.weapon === 'scythe' || me.weapon === 'butterfly' ? 'knife' : 'fists', 0.8);
    if (game.phase === 'live') net.send({ t: 'melee', weapon: me.weapon });
    else rangeMelee();   // lobby: swing hits practice dummies
    return;
  }
  if (me.weapon === 'grenade') {
    if (now - me.lastFire < WEAPONS.grenade.rate) return;
    if (game.phase === 'live' && me.grenades <= 0) return;
    me.lastFire = now; if (game.phase === 'live') me.grenades--;   // infinite in the range
    vmAnim.throwT = 0;                            // wind-up + overhand whip
    const d = aimDir(0);
    if (game.phase === 'live') net.send({ t: 'nade', dx: d.x, dy: d.y + 0.18, dz: d.z });
    else throwLocalNade('grenade', { x: d.x, y: d.y + 0.18, z: d.z });   // practice arena
    updateLoadoutHud();
    return;
  }
  if (me.weapon === 'satchel') {
    const W = WEAPONS.satchel;                     // infinite throws — no ammo
    if (now - me.lastFire < W.rate) return;
    me.lastFire = now;
    vmAnim.throwT = 0;
    const d = aimDir(0);
    if (game.phase === 'live') net.send({ t: 'nade', wid: 'satchel', dx: d.x, dy: d.y + 0.14, dz: d.z });
    else throwLocalNade('satchel', { x: d.x, y: d.y + 0.14, z: d.z });   // practice arena
    return;
  }
  if (me.weapon === 'jumppad') {
    const W = WEAPONS.jumppad;
    if (now - me.lastFire < W.rate) return;
    if (game.phase === 'live' && (me.pads ?? 0) <= 0) return;
    // aim a ray at the surface you're looking at; place the pad flat on it
    const hit = raycastMap(camera.position, aimDir(0), W.range);
    if (!hit) { sfx.reload?.(); return; }         // nothing in range to stick to
    me.lastFire = now; if (game.phase === 'live') me.pads = Math.max(0, (me.pads ?? 0) - 1);
    vmAnim.throwT = 0;
    if (game.phase === 'live') net.send({ t: 'pad', x: hit.point.x, y: hit.point.y, z: hit.point.z, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z });
    else placeLocalPad(hit);   // practice arena: place a local pad you can launch off
    updateLoadoutHud();
    return;
  }
  if (me.reloading) return;
  const a = me.ammo[me.weapon];
  if (a.mag <= 0) { startReload(); return; }
  if (now - me.lastFire < w.rate) return;
  me.lastFire = now;
  if (game.phase === 'live') a.mag--;   // infinite ammo in the lobby shooting range
  const spread = me.ads > 0.5 ? w.adsSpread : w.spread;
  const d = aimDir(spread);
  recoil += me.weapon === 'sniper' ? 0.018 : 0.012 + (me.weapon === 'handgun' ? 0.008 : 0.004);
  vmKick = me.weapon === 'sniper' ? 1.25 : 1;
  if (me.weapon === 'sniper') vmAnim.boltT = 0;   // cycle the bolt after the shot
  // AR fires a continuous loop (handled in the frame); other guns are one-shots.
  if (me.weapon === 'handgun') playOne('handgun', 0.75);
  else if (me.weapon === 'sniper') playOne('sniper', 1.6);   // sniper is loud
  muzzleFlash();
  localTracer(d);
  if (game.phase === 'live') net.send({ t: 'fire', dx: d.x, dy: d.y, dz: d.z, weapon: me.weapon });
  else rangeShot(d); // lobby: shooting range
  updateAmmoHud();
  if (a.mag <= 0) startReload();

  // burst weapons fire the rest of their burst automatically after this shot
  if (w.burst && w.burst > 1) {
    const wid = me.weapon;
    for (let k = 1; k < w.burst; k++) {
      setTimeout(() => {
        if (me.dead || me.weapon !== wid || me.reloading) return;
        const aa = me.ammo[wid];
        if (!aa || aa.mag <= 0) return;
        if (game.phase === 'live') aa.mag--;   // infinite in the range
        const dd = aimDir(me.ads > 0.5 ? w.adsSpread : w.spread);
        recoil += 0.012; vmKick = 1; muzzleFlash(); localTracer(dd);
        if (game.phase === 'live') net.send({ t: 'fire', dx: dd.x, dy: dd.y, dz: dd.z, weapon: wid });
        else rangeShot(dd);
        updateAmmoHud();
        if (aa.mag <= 0) startReload();
      }, k * (w.burstGap || 0.06) * 1000);
    }
  }
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
  const wallDist = rayBoxesDist(origin, dir, 80);
  for (const t of rangeTargets) {
    if (!t.alive) continue;
    const box = { x: t.grp.position.x, y: t.grp.position.y + 0.3, z: t.grp.position.z, sx: 0.8, sy: 1.6, sz: 0.5 };
    const hit = rayAabb(origin, dir, box, 60);
    if (hit !== null && hit < wallDist) {
      t.alive = false; t.respawnAt = clockNow() + 2.5;
      t.grp.rotation.x = -1.2;
      sfx.hit(); showHitmarker(false);
    }
  }
  // humanoid practice dummies: real damage numbers + a health plate that
  // drops, ragdoll-tips at 0, and respawns — so you can test any gun on them.
  for (const [id, o] of others) {
    if (!id.startsWith('rdummy_') || o.dummyDown) continue;
    const p = o.ctrl.group.position;
    const headBox = { x: p.x, y: p.y + 1.62, z: p.z, sx: 0.46, sy: 0.46, sz: 0.42 };
    const bodyBox = { x: p.x, y: p.y + 0.95, z: p.z, sx: 0.72, sy: 1.25, sz: 0.46 };
    const hh = rayAabb(origin, dir, headBox, 80);
    const bh = rayAabb(origin, dir, bodyBox, 80);
    const best = hh !== null && (bh === null || hh < bh) ? { d: hh, head: true } : (bh !== null ? { d: bh, head: false } : null);
    if (best && best.d < wallDist) hitDummy(o, best.head);
  }
}
// apply a hit to a practice dummy with the CURRENT weapon's damage
function hitDummy(o, head) {
  const w = WEAPONS[me.weapon] || WEAPONS.ar;
  const dmg = w.melee ? w.dmg : Math.round((w.dmg || 10) * (head ? (w.headMult || 1.5) : 1) * (w.pellets > 1 ? w.pellets : 1));
  o.plate.hp = Math.max(0, (o.plate.hp ?? 100) - dmg);
  drawPlate(o.plate);
  const p = o.ctrl.group.position;
  dmgNumber(dmg, head, p.x, p.y + 1.5, p.z);
  if (!catpawHitFx()) (head ? sfx.headshot : sfx.hit)();
  showHitmarker(head);
  if (o.plate.hp <= 0) { o.dummyDown = true; o.dummyRespawnAt = clockNow() + 2; o.data.dead = true; }   // displayAnim() shows the death pose
}
// lobby melee: swing hits any dummy within reach (so daggers/katana test too)
function rangeMelee() {
  const w = WEAPONS[me.weapon]; if (!w?.melee) return;
  for (const [id, o] of others) {
    if (!id.startsWith('rdummy_') || o.dummyDown) continue;
    const p = o.ctrl.group.position;
    const d = Math.hypot(p.x - me.pos.x, p.z - me.pos.z);
    if (d <= (w.range || 3)) hitDummy(o, false);
  }
}
function spawnRangeDummies() {
  const spots = [{ x: 8.4, z: 1, ry: 2.2 }, { x: 9.3, z: 4.6, ry: 2.4 }, { x: 7.6, z: 8, ry: 2.7 }];
  spots.forEach((s, i) => {
    addOther({ id: 'rdummy_' + i, name: 'Dummy', avatar: { body: i % 2 ? 'girl' : 'boy' }, team: 'B', pos: { x: s.x, y: 0, z: s.z }, ry: s.ry, anim: 'idle', weapon: 'fists', hp: 100 });
  });
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
const HELD_ALIAS = { smg: 'ar', shotgun: 'ar', minigun: 'ar', dmr: 'sniper', burst: 'ar', revolver: 'handgun', uzi: 'handgun', shorty: 'handgun', katana: 'scythe', bat: 'scythe', carbine: 'ar', battle: 'ar', autosniper: 'sniper', deagle: 'handgun', butterfly: 'scythe', satchel: 'grenade', daggers: 'scythe' };
function makeHeldWeapon(id) {
  id = HELD_ALIAS[id] || id;
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
  // Rivals forces the R6 model: use the player's saved R6 look, else default
  const ctrl = makeR6(f.avatar?.r6 || R6_DEFAULT);
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
  if (d.crouch && (d.anim === 'run' || d.anim === 'walk')) return 'slide';   // powersliding
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
// ============ QUICK-PICK GRID: compact tile picker at round start + in the range ============
// (distinct from the full career-style panel used in the lobby)
function buildQuickPick() {
  if (document.getElementById('qp-panel')) return;
  const st = document.createElement('style'); st.textContent = `
  #qp-panel{position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:55;display:none;flex-direction:column;align-items:center;gap:7px;font-family:inherit;}
  #qp-panel.open{display:flex;animation:qpIn .18s ease-out;}
  @keyframes qpIn{from{opacity:0;transform:translateX(-50%) translateY(-8px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}
  #qp-tip{background:rgba(12,14,18,.94);color:#eef1f7;font-weight:800;font-size:12.5px;padding:7px 15px;border-radius:9px;box-shadow:0 4px 16px rgba(0,0,0,.45);}
  #qp-grid{background:rgba(16,18,24,.93);border:1px solid rgba(255,255,255,.09);border-radius:13px;padding:9px;display:flex;flex-direction:column;gap:6px;box-shadow:0 12px 36px rgba(0,0,0,.55);backdrop-filter:blur(7px);}
  .qp-row{display:flex;gap:6px;justify-content:center;align-items:center;}
  .qp-cls{width:62px;flex:none;text-align:right;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#5d6578;padding-right:2px;}
  .qp-tile{width:54px;height:54px;border-radius:9px;background:#262a34;border:2px solid rgba(255,255,255,.07);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer;transition:transform .07s,background .07s;}
  .qp-tile i{font-style:normal;font-size:20px;line-height:1;}
  .qp-tile small{font-size:8px;font-weight:800;color:#8d95a8;letter-spacing:.02em;max-width:50px;overflow:hidden;white-space:nowrap;}
  .qp-tile:hover{transform:translateY(-2px);background:#333a4a;}
  .qp-tile.eq{background:#f2f4f8;border-color:#fff;}
  .qp-tile.eq small{color:#1c2028;}
  `; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.id = 'qp-panel';
  panel.innerHTML = '<div id="qp-tip"></div><div id="qp-grid"></div>';
  document.body.appendChild(panel);
  const render = () => {
    const grid = panel.querySelector('#qp-grid'); grid.innerHTML = '';
    for (const cls of CLASS_ORDER) {
      const row = document.createElement('div'); row.className = 'qp-row';
      const lab = document.createElement('small'); lab.className = 'qp-cls'; lab.textContent = CLASS_LABEL[cls] || cls;
      row.appendChild(lab);
      for (const { id, w } of weaponsOfClass(cls)) {
        const t = document.createElement('div');
        t.className = 'qp-tile' + (myPickedLoadout.includes(id) ? ' eq' : '');
        t.innerHTML = `<i>${WEAPON_ICONS[id] || '🔫'}</i><small>${w.name}</small>`;
        t.addEventListener('click', () => {
          myPickedLoadout[CLASS_ORDER.indexOf(cls)] = id;
          sendLoadout();
          window.__applyInHand?.(id);
          render(); sfx.click?.();
        });
        row.appendChild(t);
      }
      grid.appendChild(row);
    }
  };
  window.__qpAuto = {
    open(mode) {
      panel.querySelector('#qp-tip').textContent = mode === 'range'
        ? 'Try out any weapon here for free!'
        : 'Pick your loadout — locks when the round starts!';
      render(); panel.classList.add('open');
    },
    close: () => panel.classList.remove('open'),
  };
}

const WEAPON_ICONS = { ar: '🔫', handgun: '🔫', scythe: '🔪', grenade: '💣', jumppad: '🔼', sniper: '🔭', fists: '👊', smg: '🌀', shotgun: '💥', dmr: '🎯', minigun: '⚙️', burst: '🔫', revolver: '🔫', uzi: '🔫', shorty: '💥', katana: '🗡️', bat: '🏏', carbine: '🔫', battle: '🔫', autosniper: '🔭', deagle: '🔫', butterfly: '🦋', satchel: '🧨', daggers: '⚔️', warper: '🌀' };
function updateLoadoutHud() {
  hud.loadout.innerHTML = '';
  myLoadout().forEach((id, i) => {
    const s = document.createElement('div');
    s.className = 'slot' + (me.weapon === id ? ' active' : '');
    s.innerHTML = `<small>${i + 1}</small>${WEAPON_ICONS[id]}`
      + (id === 'grenade' ? `<span class="cnt">${me.grenades}</span>` : '')
      + (id === 'jumppad' ? `<span class="cnt">${me.pads ?? 0}</span>` : '')
      + (id === 'satchel' ? `<span class="cnt">∞</span>` : '');
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
  else if (me.weapon === 'satchel') { hud.mag.textContent = '∞'; hud.res.textContent = ''; }
  else if (me.weapon === 'warper') { hud.mag.textContent = '🌀'; hud.res.textContent = ''; }
  else { hud.mag.textContent = '—'; hud.res.textContent = ''; }
  hud.wname.textContent = w.name;
  updateLoadoutHud();
}
function updateHpHud() {
  const pct = Math.max(0, me.hp);
  hud.hp.style.width = pct + '%';
  hud.hp.className = pct > 50 ? '' : pct > 25 ? 'mid' : 'low';
  hud.hpNum.textContent = Math.max(0, Math.round(me.hp));
  const ghost = $('#hp-ghost');
  if (ghost) ghost.style.width = pct + '%';   // trails via its slow CSS transition — shows the chunk you just lost
  $('#low-vignette')?.classList.toggle('hidden', pct > 30 || me.dead);
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
    const wrap = document.createElement('span');
    wrap.className = 'chip-av';
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    cv.dataset.fid = f.id;
    try { drawAvatarHead(cv.getContext('2d'), f.avatar || {}, 64); } catch {}
    wrap.appendChild(cv);
    // platform badge: what device this player is on (bots get a chip icon)
    const plat = f.bot ? 'bot' : f.platform;
    if (plat) {
      const b = document.createElement('i');
      b.className = 'plat-badge';
      b.textContent = plat === 'bot' ? '\ud83e\udd16' : (PLATFORM_ICONS[plat] || '');
      b.title = plat === 'bot' ? 'Bot' : 'Playing on ' + plat;
      wrap.appendChild(b);
    }
    el.appendChild(wrap);
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
  net.send({ t: 'loadout', ids: myPickedLoadout });   // tell the server our chosen kit
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
  if (msg.mode === 'wave') return startWaveMatch(msg);
  clearPads();   // no stray jump pads carried into a fresh match
  game.waveMode = false; game.loadout = null;
  game.phase = 'vote';
  game.roster = msg.roster;
  game.stateUntil = msg.voteEnds;
  const mine = msg.roster.find((r) => r.id === net.id);
  game.myTeam = mine?.team || 'A';
  game.score = { A: 0, B: 0 };
  game.queued = null;
  $('#queue-banner').classList.add('hidden');
  $('#vote').classList.remove('hidden');
  syncVcBtn();
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
  clearAllPortals();
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
  clearAllPortals();
  taskState.duels++; saveTasks();
  window.__qpAuto?.open('match');   // compact grid picker while frozen — the only time it changes
  game.score = msg.score;
  game.stateUntil = msg.until;
  // spawn everyone
  clearOthers();
  for (const f of msg.fighters) {
    if (f.id === net.id) {
      me.pos = { ...f.pos }; me.ry = f.ry; me.pitch = 0;
      me.vel = { x: 0, y: 0, z: 0 };
      me.hp = 100; me.dead = false;
      const lo = myLoadout();
      me.weapon = lo.find((id) => WEAPONS[id]?.class === 'primary') || lo[0] || 'ar';
      me.ammo = freshAmmo();
      const util = lo.find((id) => WEAPONS[id]?.class === 'utility');
      me.grenades = util === 'grenade' ? WEAPONS.grenade.count : 0;
      me.pads = util === 'jumppad' ? WEAPONS.jumppad.count : 0;
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
  document.exitPointerLock?.();   // free cursor to click the picker during freeze
});
net.on('round.live', (msg) => {
  game.phase = 'live';
  window.__ldAuto?.close();
  window.__qpAuto?.close();
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {}
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
  if (msg.waveMode) {
    $('#podium-title').textContent = msg.victory ? 'VICTORY' : 'DEFEAT';
    $('#podium-title').className = msg.victory ? 'win' : 'lose';
    if (msg.victory && !taskState.win) { taskState.win = true; saveTasks(); }
    $('#podium-sub').textContent = msg.victory
      ? 'All ' + msg.total + ' waves defeated! ' + (msg.stats.filter((x) => x.survived).map((x) => x.name).join(' & ') || 'Nobody') + ' survived to the end'
      : 'The horde won on wave ' + msg.wave + ' of ' + msg.total + ' — try again!';
    const hostW = $('#podium-stats');
    hostW.innerHTML = '';
    for (const st of [...msg.stats].sort((a, b) => b.elims - a.elims)) {
      const row = document.createElement('div');
      row.className = 'pstat' + (st.survived && msg.victory ? ' winner' : '');
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      try { drawAvatarHead(cv.getContext('2d'), st.avatar || {}, 64); } catch {}
      row.appendChild(cv);
      row.insertAdjacentHTML('beforeend',
        '<div class="pn">' + st.name + (st.survived ? ' <small>SURVIVED</small>' : '') + '</div>' +
        '<div class="pv"><span>\u2694 <b>' + st.elims + '</b></span><span>\ud83d\udc80 <b>' + st.deaths + '</b></span></div>');
      hostW.appendChild(row);
    }
    $('#podium').classList.remove('hidden');
    $('#wave-top')?.classList.add('hidden');
    game.waveMode = false; game.loadout = null;
    document.exitPointerLock?.();
    if (msg.victory) { sfx.win(); window.ClaudeBox?.completeChallenge('rivals-win'); } else sfx.lose();
    return;
  }
  const won = msg.winner === game.myTeam;
  $('#podium-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('#podium-title').className = won ? 'win' : 'lose';
  if (won && !taskState.win) { taskState.win = true; saveTasks(); }
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


// ============================ VOICE CHAT ============================
// Peer-to-peer WebRTC audio between the humans in your match. The game
// socket relays the signaling; audio never touches the server. Opt-in via
// the 🎙️ button (asks for the mic), then the button toggles mute.
const vc = { on: false, muted: false, stream: null, peers: new Map(), remoteOn: new Set(), audios: new Map() };
const VC_RTC = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function vcHumans() {
  return (game.roster || []).filter((r) => !r.bot && r.id !== net.id).map((r) => r.id);
}
function vcBtn() {
  let b = document.getElementById('vc-btn');
  if (!b) {
    const st = document.createElement('style');
    st.textContent = `
    #vc-btn{position:fixed;left:14px;bottom:64px;z-index:95;display:none;align-items:center;gap:7px;touch-action:none;
      background:rgba(20,24,34,.82);border:1px solid rgba(255,255,255,.16);color:#fff;font-weight:800;font-size:13.5px;
      padding:10px 14px;border-radius:999px;cursor:pointer;backdrop-filter:blur(8px);}
    #vc-btn.on{border-color:rgba(90,220,140,.55);}
    #vc-btn.muted{border-color:rgba(255,160,90,.55);}
    #vc-btn .dot{width:8px;height:8px;border-radius:50%;background:#7f8898;}
    #vc-btn.on .dot{background:#5adc8c;box-shadow:0 0 8px #5adc8c;}
    #vc-btn.muted .dot{background:#ffa05a;}
    @media (pointer: coarse){#vc-btn{bottom:170px;}}`;
    document.head.appendChild(st);
    b = document.createElement('button');
    b.id = 'vc-btn';
    b.innerHTML = '<span class="dot"></span><span class="lbl">Join Voice</span>';
    b.addEventListener('click', vcToggle);
    document.body.appendChild(b);
  }
  return b;
}
function syncVcBtn() {
  const b = vcBtn();
  const inMatch = game.phase !== 'lobby' && game.roster?.length;
  const others = vcHumans().length;
  b.style.display = inMatch && others ? 'flex' : 'none';
  b.classList.toggle('on', vc.on && !vc.muted);
  b.classList.toggle('muted', vc.on && vc.muted);
  const n = [...vc.peers.values()].filter((p) => p.connectionState === 'connected').length;
  b.querySelector('.lbl').textContent = !vc.on ? '🎙️ Join Voice'
    : vc.muted ? `🔇 Muted${n ? ' · ' + n : ''}` : `🎙️ Voice on${n ? ' · ' + n : ''}`;
}
async function vcToggle() {
  if (!vc.on) {
    try {
      vc.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch { toast('Mic blocked — allow the microphone to use voice'); return; }
    vc.on = true; vc.muted = false;
    net.send({ t: 'vc.state', on: true });
    for (const id of vcHumans()) if (vc.remoteOn.has(id)) vcConnect(id);
    toast('Voice on! Click again to mute');
  } else {
    vc.muted = !vc.muted;
    for (const tr of vc.stream?.getAudioTracks() || []) tr.enabled = !vc.muted;
  }
  syncVcBtn();
}
function vcStop() {
  if (vc.on) net.send({ t: 'vc.state', on: false });
  for (const pc of vc.peers.values()) { try { pc.close(); } catch {} }
  vc.peers.clear();
  for (const a of vc.audios.values()) { try { a.srcObject = null; a.remove(); } catch {} }
  vc.audios.clear();
  vc.remoteOn.clear();
  for (const tr of vc.stream?.getTracks() || []) tr.stop();
  vc.stream = null; vc.on = false; vc.muted = false;
  syncVcBtn();
}
function vcPeer(id) {
  let pc = vc.peers.get(id);
  if (pc) return pc;
  pc = new RTCPeerConnection(VC_RTC);
  vc.peers.set(id, pc);
  for (const tr of vc.stream.getAudioTracks()) pc.addTrack(tr, vc.stream);
  pc.onicecandidate = (e) => { if (e.candidate) net.send({ t: 'vc.sig', to: id, data: { ice: e.candidate } }); };
  pc.ontrack = (e) => {
    let a = vc.audios.get(id);
    if (!a) { a = document.createElement('audio'); a.autoplay = true; document.body.appendChild(a); vc.audios.set(id, a); }
    a.srcObject = e.streams[0];
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { vc.peers.delete(id); vc.audios.get(id)?.remove(); vc.audios.delete(id); }
    syncVcBtn();
  };
  return pc;
}
async function vcConnect(id) {
  if (!vc.on || vc.peers.has(id)) return;
  if (net.id < id) {   // deterministic initiator avoids offer glare
    const pc = vcPeer(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    net.send({ t: 'vc.sig', to: id, data: { sdp: pc.localDescription } });
  }
}
net.on('vc.state', (msg) => {
  if (msg.id === net.id) return;
  if (msg.on) { vc.remoteOn.add(msg.id); if (vc.on) vcConnect(msg.id); }
  else {
    vc.remoteOn.delete(msg.id);
    vc.peers.get(msg.id)?.close(); vc.peers.delete(msg.id);
    vc.audios.get(msg.id)?.remove(); vc.audios.delete(msg.id);
  }
  syncVcBtn();
});
net.on('vc.sig', async (msg) => {
  if (!vc.on) return;
  const pc = vcPeer(msg.from);
  try {
    if (msg.data?.sdp) {
      await pc.setRemoteDescription(msg.data.sdp);
      if (msg.data.sdp.type === 'offer') {
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        net.send({ t: 'vc.sig', to: msg.from, data: { sdp: pc.localDescription } });
      }
    } else if (msg.data?.ice) {
      await pc.addIceCandidate(msg.data.ice);
    }
  } catch {}
});

// ============================ WAVE SURVIVAL ============================
function ensureWaveTop() {
  let el = $('#wave-top');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wave-top';
    el.innerHTML = '<b id="wt-wave"></b><span id="wt-bots"></span>';
    document.body.appendChild(el);
  }
  return el;
}
let wtLast = '';
function updateWaveTop() {
  if (!game.waveMode) { $('#wave-top')?.classList.add('hidden'); wtLast = ''; return; }
  const el = ensureWaveTop();
  el.classList.remove('hidden');
  let right;
  if (game.phase === 'live') right = '\ud83e\udd16 ' + game.botsLeft + ' left';
  else if (game.wave >= game.waveTotal) right = '';
  else {
    const secs = Math.max(0, Math.ceil(game.stateUntil - clockNow()));
    right = 'next wave in ' + secs + 's';
  }
  const txt = '\ud83c\udf0a Wave ' + Math.max(1, game.wave || 1) + '/' + game.waveTotal + '|' + right;
  if (txt !== wtLast) {
    wtLast = txt;
    el.querySelector('#wt-wave').textContent = txt.split('|')[0];
    el.querySelector('#wt-bots').textContent = txt.split('|')[1];
  }
}

function startWaveMatch(msg) {
  game.waveMode = true;
  game.phase = msg.state === 'live' ? 'live' : 'break';
  game.mapId = msg.map;
  game.roster = msg.roster;
  game.myTeam = 'A';
  game.score = { A: 0, B: 0 };
  game.queued = null;
  game.wave = msg.wave || 0; game.waveTotal = msg.waveTotal || 10;
  game.botsLeft = msg.botsLeft || 0;
  game.stateUntil = msg.nextAt || 0;
  game.loadout = [...(msg.arsenal || ['handgun', 'fists'])];
  $('#queue-banner').classList.add('hidden');
  $('#vote').classList.add('hidden');
  $('#teleport').classList.add('hidden');
  $('#podium').classList.add('hidden');
  buildMap(MAPS[game.mapId] || MAPS.arena);
  game.builtMap = game.mapId;
  clearOthers();
  const sp = (MAPS[game.mapId].spawnsA || [{ x: 0, z: 0, ry: 0 }])[0];
  me.pos = { x: sp.x, y: 0, z: sp.z }; me.ry = sp.ry || 0; me.pitch = 0;
  me.vel = { x: 0, y: 0, z: 0 };
  me.hp = 100; me.dead = false;
  me.weapon = 'handgun';
  me.ammo = freshAmmo();
  me.grenades = 1; me.pads = WEAPONS.jumppad.count; me.reloading = 0;
  $('#match-top').classList.add('hidden');
  $('#health-wrap').classList.remove('hidden');
  $('#ammo-wrap').classList.remove('hidden');
  $('#lobby-tip').classList.add('hidden');
  $('#kb-open')?.classList.add('hidden'); closeKeybinds();
  $('#freeze-count').classList.add('hidden');
  updateHpHud(); updateAmmoHud();
  updateWaveTop();
  banner(msg.joinLive ? 'YOU JOINED THE FIGHT!' : 'WAVE SURVIVAL', 1400);
  syncVcBtn();
  sfx.roundStart();
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {}
}

net.on('wave.start', (msg) => {
  if (!game.waveMode) return;
  game.phase = 'live';
  game.wave = msg.wave; game.waveTotal = msg.total; game.botsLeft = msg.botsLeft;
  clearOthers();
  for (const fdata of msg.fighters) {
    if (fdata.id === net.id) {
      if (me.dead || me.hp <= 0) {   // fallen heroes come back each wave
        me.pos = { ...fdata.pos }; me.ry = fdata.ry || 0;
        me.vel = { x: 0, y: 0, z: 0 };
        me.hp = 100; me.dead = false; me.reloading = 0;
        me.weapon = game.loadout?.includes(me.weapon) ? me.weapon : 'handgun';
        updateHpHud(); updateAmmoHud();
      }
      continue;
    }
    addOther(fdata);
  }
  banner('WAVE ' + msg.wave, 1100);
  updateWaveTop();
  sfx.roundStart();
});

net.on('wave.cleared', (msg) => {
  if (!game.waveMode) return;
  game.phase = 'break';
  game.wave = msg.wave; game.waveTotal = msg.total;
  game.stateUntil = msg.nextAt;
  game.botsLeft = 0;
  if (msg.wave > 0) { banner('WAVE ' + msg.wave + ' CLEARED!', 1600); sfx.win(); toast('Grab dropped weapons before the next wave!'); }
  else banner('GET READY…', 1400);
  updateWaveTop();
});

net.on('fighter.join', (msg) => {
  if (!game.waveMode || msg.fighter.id === net.id) return;
  addOther(msg.fighter);
  if (!msg.fighter.bot && !game.roster.some((r) => r.id === msg.fighter.id)) {
    game.roster.push({ id: msg.fighter.id, name: msg.fighter.name, avatar: msg.fighter.avatar, team: 'A', bot: false, platform: msg.fighter.platform });
  }
  syncVcBtn();
});

// ---- weapon drops (bots drop what they were holding) ----
const dropMeshes = new Map();
function makeDropLabel(weapon) {
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 72;
  const c = cvs.getContext('2d');
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '800 30px system-ui';
  c.lineWidth = 7; c.strokeStyle = 'rgba(10,14,22,.9)';
  const label = (WEAPON_ICONS[weapon] || '') + ' ' + (WEAPONS[weapon]?.name || weapon);
  c.strokeText(label, 128, 36); c.fillStyle = '#ffd24a'; c.fillText(label, 128, 36);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), transparent: true, depthTest: false }));
  spr.scale.set(2.6, 0.72, 1);
  return spr;
}
net.on('drop.spawn', (msg) => {
  if (!game.waveMode) return;
  const d = msg.d;
  const g = new THREE.Group();
  const gun = makeHeldWeapon(d.weapon);
  gun.scale.setScalar(3.2);
  g.add(gun);
  const label = makeDropLabel(d.weapon);
  label.position.y = 1.05;
  g.add(label);
  g.position.set(d.x, d.y, d.z);
  scene.add(g);
  dropMeshes.set(msg.d.id, g);
});
net.on('drop.take', (msg) => {
  const g = dropMeshes.get(msg.id);
  if (g) { scene.remove(g); dropMeshes.delete(msg.id); }
});
net.on('pickup', (msg) => {
  game.loadout = [...msg.arsenal];
  if (WEAPONS[msg.weapon]?.mag) me.ammo[msg.weapon] = { mag: WEAPONS[msg.weapon].mag, res: WEAPONS[msg.weapon].reserve };
  toast('Picked up ' + (WEAPONS[msg.weapon]?.name || msg.weapon) + '! Press ' + (game.loadout.indexOf(msg.weapon) + 1) + ' to equip');
  sfx.beep();
  updateLoadoutHud();
});

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
  if (game.waveMode && msg.wave !== undefined) {
    game.wave = msg.wave; game.botsLeft = msg.botsLeft; game.waveTotal = msg.waveTotal;
    if (msg.state === 'break' || msg.state === 'live') game.phase = msg.state;
    game.stateUntil = msg.until;
    updateWaveTop();
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
  if (!catpawHitFx()) (msg.head ? sfx.headshot : sfx.hit)();
});
// earned a unique skin (e.g. knife-killed LilBugTrainer for the Cat Paw)
net.on('skin.unlock', async (msg) => {
  const def = SKIN_BY_ID[msg.skin]; if (!def) return;
  if (!Array.isArray(mySkins.owned)) mySkins.owned = [];
  if (!mySkins.owned.includes(msg.skin)) mySkins.owned.push(msg.skin);
  showSkinUnlockToast(def);
  try { playOne('catscratch', 3); } catch {}
  try { await loadMySkins(); } catch {}
  if (document.getElementById('sk-open')) renderSkins();
});
net.on('charm.earned', () => {
  iHaveOwnerCharm = true; syncCharm();
  banner('👑 OWNER CHARM EARNED!', 2600);
  toast('You sniped the owner — a mini-them now hangs off your fist. Forever.');
  try { sfx.win?.(); } catch {}
});
net.on('toast', (msg) => { if (msg.text) toast(msg.text); });
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
let killStreak = 0, elimTimer = 0;
function showElimBanner(name, streak) {
  const el = $('#elim-banner');
  if (!el) return;
  el.innerHTML = `<small>ELIMINATED</small><b>${name}</b>` + (streak > 1 ? `<span class="streak">${streak} STREAK</span>` : '');
  el.classList.remove('hidden', 'pop'); void el.offsetWidth; el.classList.add('pop');
  clearTimeout(elimTimer); elimTimer = setTimeout(() => el.classList.add('hidden'), 1900);
}
net.on('elim', (msg) => {
  const killer = msg.killer === net.id ? { name: identity.name } : game.roster.find((r) => r.id === msg.killer);
  const victim = msg.victim === net.id ? { name: identity.name } : game.roster.find((r) => r.id === msg.victim);
  killfeed(killer?.name || '—', victim?.name || '—', msg.weapon,
    msg.killer === net.id ? 'killer' : msg.victim === net.id ? 'victim' : null);
  // grey out chip avatar
  document.querySelectorAll(`.tc-avatars canvas[data-fid="${msg.victim}"]`).forEach((c) => c.classList.add('dead'));
  if (msg.victim === net.id) { me.dead = true; killStreak = 0; sfx.death(); banner('💀 ELIMINATED', 1500); }
  else if (msg.killer === net.id) {
    sfx.elim();
    killStreak++;
    if (!taskState.elim) { taskState.elim = true; saveTasks(); }
    showElimBanner(victim?.name || 'enemy', killStreak);
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
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), new THREE.MeshLambertMaterial({ color: g.wid === 'satchel' ? '#d64545' : '#3f7d3f' }));
  mesh.position.set(g.x, g.y, g.z);
  scene.add(mesh);
  nades.set(g.id, { mesh, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz });
});
net.on('nade.boom', (msg) => {
  const n = nades.get(msg.id);
  if (n) { scene.remove(n.mesh); nades.delete(msg.id); }
  boomFx(msg.x, msg.y, msg.z);
});

// ---- deployed jump pads (placeable utility) ----
function clearPads() {
  for (const p of placedPads) { scene.remove(p.group); p.group.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); }); }
  placedPads = [];
}
function clearLocalNades() { for (const n of localNades) scene.remove(n.mesh); localNades = []; }
// four white transparent claw slashes in front of you (cat-paw hit fx)
function spawnClawTrail() {
  const d = aimDir(0);
  const fwd = new THREE.Vector3(d.x, d.y, d.z);
  const base = camera.position.clone().add(fwd.clone().multiplyScalar(2.0));
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.PlaneGeometry(0.07, 1.5);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(base).add(right.clone().multiplyScalar((i - 1.5) * 0.17));
    m.lookAt(camera.position);
    m.rotation.z += 0.6;   // diagonal rake
    m.renderOrder = 999;
    scene.add(m);
    clawTrails.push({ mesh: m, mat, age: 0, life: 0.32 });
  }
}
function tickClawTrails(dt) {
  for (let i = clawTrails.length - 1; i >= 0; i--) {
    const t = clawTrails[i]; t.age += dt;
    const k = t.age / t.life;
    t.mat.opacity = Math.max(0, 0.6 * (1 - k));
    t.mesh.scale.set(1, 1 + k * 0.5, 1);
    if (t.age >= t.life) { scene.remove(t.mesh); clawTrails.splice(i, 1); }
  }
}
// practice arena: pads/grenades are simulated CLIENT-SIDE (no server match)
function placeLocalPad(hit) {
  const pad = buildPad(hit.point.x, hit.point.y, hit.point.z, hit.normal);
  scene.add(pad.group);
  placedPads.push({ id: 'local_' + localPadSeq++, x: hit.point.x, y: hit.point.y, z: hit.point.z, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z, group: pad.group, core: pad.core, cd: 0 });
}
function throwLocalNade(wid, dir) {
  const w = WEAPONS[wid];
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), new THREE.MeshLambertMaterial({ color: wid === 'satchel' ? '#d64545' : '#3f7d3f' }));
  const p = camera.position;
  mesh.position.copy(p); scene.add(mesh);
  localNades.push({ mesh, x: p.x, y: p.y, z: p.z, vx: dir.x * w.throwVel, vy: dir.y * w.throwVel + 2.5, vz: dir.z * w.throwVel, wid, explodeAt: clockNow() + w.fuse, armAt: clockNow() + 0.14 });
}
net.on('pad.spawn', (msg) => {
  const pad = buildPad(msg.x, msg.y, msg.z, { x: msg.nx, y: msg.ny, z: msg.nz });
  scene.add(pad.group);
  placedPads.push({ id: msg.id, x: msg.x, y: msg.y, z: msg.z, nx: msg.nx, ny: msg.ny, nz: msg.nz, group: pad.group, core: pad.core, cd: 0 });
});
net.on('pad.remove', (msg) => {
  const i = placedPads.findIndex((p) => p.id === msg.id);
  if (i >= 0) { scene.remove(placedPads[i].group); placedPads.splice(i, 1); }
});
// server wipes deployed pads at round start / match end — mirror it on the client
net.on('pad.clearall', () => clearPads());
net.on('padcount', (msg) => { me.pads = msg.n | 0; updateLoadoutHud(); });

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
  vcStop();
  game.waveMode = false; game.loadout = null;
  $('#wave-top')?.classList.add('hidden');
  for (const g of dropMeshes.values()) scene.remove(g);
  dropMeshes.clear();
  // the FACILITY lobby: red-carpet hallway, duel pads, shooting-range wing
  game.zone = 'lobby';
  game.mapId = 'lobby'; game.builtMap = 'lobby';
  buildMap(LOBBY);
  clearOthers();
  clearPads(); clearLocalNades();
  lobbyClearAt = clockNow() + PRACTICE_CLEAR_SECS;   // auto-wipe placed stuff every 5 min
  const sp = LOBBY.spawnsA[0];
  me.pos = { x: sp.x, y: 0, z: sp.z };
  me.ry = sp.ry; me.pitch = 0;
  me.hp = 100; me.dead = false; me.weapon = 'ar';
  me.ammo = freshAmmo();
  me.grenades = WEAPONS.grenade.count; me.pads = WEAPONS.jumppad.count;
  $('#match-top').classList.add('hidden');
  $('#freeze-count').classList.add('hidden');
  $('#health-wrap').classList.add('hidden');
  $('#ammo-wrap').classList.remove('hidden');
  const tip = $('#lobby-tip'); if (tip) tip.textContent = 'Stand on a DUEL PAD to queue · Shooting Range through the east door · loadout changes at round start';
  tip?.classList.remove('hidden');
  $('#kb-open')?.classList.remove('hidden');
  $('#podium').classList.add('hidden');
  updateAmmoHud(); updateLoadoutHud();
}

// ---------------- keybinds settings UI ----------------
const KB_ACTIONS = [
  ['forward', 'Move Forward'], ['back', 'Move Back'], ['left', 'Move Left'], ['right', 'Move Right'],
  ['jump', 'Jump'], ['sprint', 'Sprint'], ['crouch', 'Crouch / Slide'], ['reload', 'Reload'], ['queue', 'Open Queue'],
  ['inspect', 'Inspect weapon'],
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
  // ---- dev tools toggle: unlocks the in-game Anim Studio (N) ----
  const devRow = document.createElement('div'); devRow.className = 'kb-row';
  const devName = document.createElement('span'); devName.className = 'kb-label'; devName.textContent = 'Dev Tools (N = Anim Studio)';
  const dsw = document.createElement('button');
  dsw.className = 'kb-switch' + (devTools ? ' on' : ''); dsw.setAttribute('role', 'switch');
  dsw.setAttribute('aria-checked', String(devTools)); dsw.innerHTML = '<i></i>';
  dsw.addEventListener('click', () => {
    devTools = !devTools;
    try { localStorage.setItem('rivals.devtools', devTools ? '1' : '0'); } catch {}
    if (devTools) toast('Dev Tools on — press N in the lobby with the Butterfly to open the Anim Studio');
    sfx.click?.(); renderKeybinds();
  });
  devRow.append(devName, dsw); host.appendChild(devRow);
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
// ============================ THE WARPER — portals ============================
const myPortals = { A: null, B: null };     // {pos, n, mesh}
const otherPortals = new Map();             // playerId -> {A, B}
let portalCd = 0;
const PORTAL_COLORS = { A: '#4db8ff', B: '#ff9a3d' };
function mkPortalMesh(which, dim) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.09, 10, 30),
    new THREE.MeshBasicMaterial({ color: PORTAL_COLORS[which], transparent: true, opacity: dim ? 0.5 : 0.95 }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 26),
    new THREE.MeshBasicMaterial({ color: PORTAL_COLORS[which], transparent: true, opacity: dim ? 0.12 : 0.3, side: THREE.DoubleSide, depthWrite: false }));
  g.add(ring, disc);
  g.scale.y = 1.35;                        // tall oval
  g.userData.spin = ring;
  return g;
}
function orientPortal(mesh, pos, n) {
  mesh.position.set(pos.x + n.x * 0.06, pos.y + n.y * 0.06, pos.z + n.z * 0.06);
  mesh.lookAt(pos.x + n.x, pos.y + n.y, pos.z + n.z);
}
function setPortal(store, which, pos, n, dim) {
  if (store[which]) scene.remove(store[which].mesh);
  const mesh = mkPortalMesh(which, dim);
  orientPortal(mesh, pos, n);
  mesh.scale.set(0.2, 0.27, 0.2);          // pop-in
  scene.add(mesh);
  store[which] = { pos, n, mesh, born: clockNow() };
}
// hitscan against the map: march the aim ray, find the face we hit
function placePortal(which) {
  const W = WEAPONS.warper;
  const dir = aimDir(0);
  const o = camera.position;
  let px = o.x, py = o.y, pz = o.z;
  for (let d = 0.4; d < W.range; d += 0.18) {
    const x = o.x + dir.x * d, y = o.y + dir.y * d, z = o.z + dir.z * d;
    if (y < 0.02) {   // ground plane
      setPortal(myPortals, which, { x, y: 0.02, z }, { x: 0, y: 1, z: 0 });
      net.send({ t: 'portal', which, x, y: 0.02, z, nx: 0, ny: 1, nz: 0 });
      playOne('equip', 0.6); vmKick = Math.max(vmKick, 0.5);
      return true;
    }
    if (pointInMap(x, y, z)) {
      const b = mapBoxes.find((bb) => Math.abs(x - bb.x) <= bb.w / 2 && Math.abs(y - (bb.y + bb.h / 2)) <= bb.h / 2 && Math.abs(z - bb.z) <= bb.d / 2);
      let n = { x: 0, y: 1, z: 0 };
      if (b) {
        const cx = (px - b.x) / (b.w / 2), cy = (py - (b.y + b.h / 2)) / (b.h / 2), cz = (pz - b.z) / (b.d / 2);
        const ax = Math.abs(cx), ay = Math.abs(cy), az = Math.abs(cz);
        if (ax >= ay && ax >= az) n = { x: Math.sign(cx), y: 0, z: 0 };
        else if (ay >= az) n = { x: 0, y: Math.sign(cy), z: 0 };
        else n = { x: 0, y: 0, z: Math.sign(cz) };
      }
      const hit = { x: px, y: py, z: pz };
      setPortal(myPortals, which, hit, n);
      net.send({ t: 'portal', which, x: hit.x, y: hit.y, z: hit.z, nx: n.x, ny: n.y, nz: n.z });
      playOne('equip', 0.6); vmKick = Math.max(vmKick, 0.5);
      return true;
    }
    px = x; py = y; pz = z;
  }
  return false;
}
function clearAllPortals() {
  for (const k of ['A', 'B']) { if (myPortals[k]) { scene.remove(myPortals[k].mesh); myPortals[k] = null; } }
  for (const [, st] of otherPortals) for (const k of ['A', 'B']) if (st[k]) scene.remove(st[k].mesh);
  otherPortals.clear();
}
function tickPortals(dt) {
  const cn = clockNow();
  // spin + pop-in
  for (const store of [myPortals, ...otherPortals.values()]) {
    for (const k of ['A', 'B']) {
      const P = store[k]; if (!P) continue;
      P.mesh.userData.spin.rotation.z += dt * 2.2;
      const grow = Math.min(1, (cn - P.born) / 0.22);
      const sc = 0.2 + 0.8 * (1 - Math.pow(1 - grow, 3));
      P.mesh.scale.set(sc, sc * 1.35, sc);
    }
  }
  // teleport ME through my portals, carrying momentum + a boost.
  // SWEPT check: compares this frame's position against last frame's, so even
  // at extreme chained speeds you can't step past the portal plane in one frame.
  const pp = tickPortals._prev || (tickPortals._prev = { x: me.pos.x, y: me.pos.y, z: me.pos.z });
  const prevX = pp.x, prevY = pp.y, prevZ = pp.z;
  pp.x = me.pos.x; pp.y = me.pos.y; pp.z = me.pos.z;
  if (!myPortals.A || !myPortals.B || me.dead || cn < portalCd) return;
  const W = WEAPONS.warper;
  for (const [a, bKey] of [['A', 'B'], ['B', 'A']]) {
    const P = myPortals[a], O = myPortals[bKey];
    const cxp = me.pos.x - P.pos.x, cyp = (me.pos.y + 0.9) - P.pos.y, czp = me.pos.z - P.pos.z;
    const dn = cxp * P.n.x + cyp * P.n.y + czp * P.n.z;           // distance out from the surface
    const dnPrev = (prevX - P.pos.x) * P.n.x + ((prevY + 0.9) - P.pos.y) * P.n.y + (prevZ - P.pos.z) * P.n.z;
    const crossed = dnPrev > 0 && dn < dnPrev - 0.05 && (dn < 0.6 || dn * dnPrev < 0);   // moving in, near or through the plane
    const lx = cxp - dn * P.n.x, ly = cyp - dn * P.n.y, lz = czp - dn * P.n.z;
    const latV = Math.abs(P.n.y) > 0.5 ? Math.hypot(lx, lz) : Math.abs(ly);   // vertical portals: height offset
    const latH = Math.abs(P.n.y) > 0.5 ? 0 : Math.hypot(lx * (1 - Math.abs(P.n.x)), lz * (1 - Math.abs(P.n.z)));
    const vdotn = me.vel.x * P.n.x + me.vel.y * P.n.y + me.vel.z * P.n.z;
    if ((Math.abs(dn) < 0.6 || crossed) && latV < 1.6 && latH < 1.15 && vdotn < -0.4) {
      const speed = Math.min(W.maxSpeed, Math.hypot(me.vel.x, me.vel.y, me.vel.z) * W.boost + 1.2);
      // exit: pushed out along the other portal's normal, momentum redirected
      me.pos.x = O.pos.x + O.n.x * 1.0;
      me.pos.z = O.pos.z + O.n.z * 1.0;
      me.pos.y = Math.abs(O.n.y) > 0.5 ? O.pos.y + O.n.y * 0.4 : O.pos.y - 0.9 + O.n.y;
      if (Math.abs(O.n.y) > 0.5) { me.vel.x *= 0.4; me.vel.z *= 0.4; me.vel.y = O.n.y * speed; }
      else { me.vel.x = O.n.x * speed; me.vel.z = O.n.z * speed; me.vel.y = Math.max(2.7, me.vel.y * 0.25); me.ry = Math.atan2(-O.n.x, -O.n.z); }
      me.grounded = false; me.sliding = false;
      portalCd = cn + 0.07;
      vmKick = Math.max(vmKick, 0.5);
      sfx.dash();
      break;
    }
  }
}
net.on('portal', (msg) => {
  if (msg.id === net.id) return;
  let st = otherPortals.get(msg.id);
  if (!st) { st = { A: null, B: null }; otherPortals.set(msg.id, st); }
  setPortal(st, msg.which, { x: msg.x, y: msg.y, z: msg.z }, { x: msg.nx, y: msg.ny, z: msg.nz }, true);
});

// ---- daily tasks (local, reset each day) + lobby UI ----
const taskState = (() => {
  const today = new Date().toDateString();
  let t; try { t = JSON.parse(localStorage.getItem('rivals.tasks') || 'null'); } catch {}
  if (!t || t.date !== today) t = { date: today, duels: 0, elim: false, win: false };
  return t;
})();
function saveTasks() { try { localStorage.setItem('rivals.tasks', JSON.stringify(taskState)); } catch {} renderTasks(); }
function renderTasks() {
  const done = taskState.duels >= 5 && taskState.elim && taskState.win;
  const bar = $('#lt-duels-bar'); if (bar) bar.style.width = Math.min(100, taskState.duels / 5 * 100) + '%';
  const n = $('#lt-duels-n'); if (n) { n.textContent = taskState.duels >= 5 ? '✔' : `${taskState.duels}/5`; n.style.color = taskState.duels >= 5 ? '#6ee7a0' : '#cfd6e2'; }
  const e = $('#lt-elim'); if (e) e.textContent = taskState.elim ? '✔' : '—';
  const w = $('#lt-win'); if (w) w.textContent = taskState.win ? '✔' : '—';
  $('#lb-tdot')?.classList.toggle('hidden', done);
}
async function refreshLobbyWallet() {
  try { const w = await window.ClaudeBox?.getWallet?.(); if (w) { $('#lb-stars').textContent = w.stars ?? 0; $('#lb-bits').textContent = w.cubes ?? 0; } } catch {}
}
function wireLobbyUi() {
  renderTasks(); refreshLobbyWallet();
  $('#lb-play').addEventListener('click', () => toggleModes());
  $('#lt-toduels').addEventListener('click', () => { me.pos = { x: -15, y: 0, z: 0 }; me.ry = 1.57; sfx.beep?.(); });
  document.querySelectorAll('#lb-bar button').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'weapons') window.__ldAuto?.open();
    else if (act === 'backpack' || act === 'shop') document.getElementById('sk-open')?.click();
    else if (act === 'settings') document.getElementById('kb-open')?.click();
    else if (act === 'tasks') $('#lb-tasks')?.classList.toggle('hidden');
    sfx.click?.();
  }));
}

// ---- lobby zones: stand on a duel pad to queue; loadout station in the range ----
const inRangeZone = () => me.pos.x > 7 && me.pos.z > -10 && me.pos.z < 16;
let rangeHintAt = 0;
function tickLobbyZones(dt) {
  const now = clockNow();
  // spin pad rims gently
  for (const pd of lobbyPads) if (pd.rim) pd.rim.rotation.z += dt * 1.2;
  if (game.phase !== 'lobby' || me.dead || now < padQueueCd) { for (const pd of lobbyPads) pd.holdT = 0; return; }
  if (!$('#queue-banner').classList.contains('hidden')) return;   // already queued
  for (const pd of lobbyPads) {
    const d = Math.hypot(me.pos.x - pd.x, me.pos.z - pd.z);
    if (d < 1.7) {
      pd.holdT += dt;
      if (pd.rim) pd.rim.scale.setScalar(1 + Math.sin(now * 6) * 0.06);
      if (pd.holdT > 0.9) {
        net.send({ t: 'queue.join', mode: pd.mode });
        sfx.beep?.();
        padQueueCd = now + 3;
        pd.holdT = 0;
      }
    } else { pd.holdT = 0; if (pd.rim) pd.rim.scale.setScalar(1); }
  }
  // loadout button only lives in the Shooting Range (like the original's bins)
  const ld = document.getElementById('ld-open');
  if (ld && game.phase === 'lobby') ld.style.display = game.zone === 'range' ? '' : 'none';
  // walking through the east door takes you to the Shooting Range map
  if (game.phase === 'lobby' && game.zone === 'lobby' && me.pos.x > 6.9 && me.pos.z > -10 && me.pos.z < 16) enterRange();
  else if (game.phase === 'lobby' && game.zone === 'range') {
    const xp = RANGE.exitPad;
    if (Math.hypot(me.pos.x - xp.x, me.pos.z - xp.z) < 1.6) exitRange();
  }
}
function enterRange() {
  game.zone = 'range';
  game.mapId = 'range'; game.builtMap = 'range';
  buildMap(RANGE);
  const sp = RANGE.spawnsA[0];
  me.pos = { x: sp.x, y: 0, z: sp.z }; me.vel = { x: 0, y: 0, z: 0 };
  me.ry = sp.ry; me.pitch = 0;
  me.ammo = freshAmmo(); me.hp = 100;
  toast('Shooting Range — click to aim · step on the glowing pad to leave');
  window.__qpAuto?.open('range');
}
function exitRange() {
  game.zone = 'lobby';
  window.__qpAuto?.close();
  game.mapId = 'lobby'; game.builtMap = 'lobby';
  buildMap(LOBBY);
  me.pos = { x: 4.5, y: 0, z: 3 }; me.vel = { x: 0, y: 0, z: 0 };
  me.ry = Math.PI / 2;
  document.exitPointerLock?.();
}
function tickLobbyUi(dt) {
  window.__ldPrevTick?.(dt || 0.016);
  $('#ammo-wrap')?.classList.toggle('hidden', inLobbyMode());   // no guns in the social lobby
  const inLobby = game.phase === 'lobby' && game.zone === 'lobby';
  const pickerOpen = document.getElementById('ld-panel')?.classList.contains('open');
  $('#lobby-ui')?.classList.toggle('hidden', !inLobby || !!pickerOpen);
  if (inLobby) $('#lobby-tip')?.classList.add('hidden');   // the lobby UI replaces the tip bar
  const sk = document.getElementById('sk-open'); if (sk) sk.style.display = inLobby ? 'none' : '';
  const kb = document.getElementById('kb-open'); if (kb) kb.classList.toggle('hidden', inLobby || game.phase !== 'lobby' && kb.classList.contains('hidden'));
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  if (mobileOn) updateMobileHud();
  tickPortals(dt);
  tickLobbyZones(dt);
  tickLobbyUi(dt);
  const cn = clockNow();

  stepMe(dt);
  tickCharm(dt);

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
  // practice dummies respawn (heal + stand back up)
  for (const [id, o] of others) {
    if (!id.startsWith('rdummy_') || !o.dummyDown) continue;
    if (cn >= o.dummyRespawnAt) { o.dummyDown = false; o.data.dead = false; o.plate.hp = 100; drawPlate(o.plate); }
  }
  // ================= viewmodel: the swingy stuff =================
  const vmKey = activeVmKey();   // cat paw replaces the knife when equipped
  for (const [k, g] of Object.entries(viewmodels)) g.visible = k === vmKey;
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
    const rightVel = (me.vel.x * Math.cos(me.ry) - me.vel.z * Math.sin(me.ry)) / (MOVE.slideBurst || 19);
    vmAnim.roll += (clamp(-rightVel * 0.1, -0.09, 0.09) - vmAnim.roll) * k;
    vmAnim.sprintK += ((sprinting2 && me.ads < 0.3 ? 1 : 0) - vmAnim.sprintK) * (1 - Math.exp(-8 * dt));
    vmAnim.slideK += ((me.sliding ? 1 : 0) - vmAnim.slideK) * (1 - Math.exp(-10 * dt));
    vmAnim.airK += ((me.grounded ? 0 : 1) - vmAnim.airK) * (1 - Math.exp(-6 * dt));
    vmAnim.landK *= Math.exp(-6.5 * dt);
    vmAnim.equipT = Math.min(1, vmAnim.equipT + dt / 0.3);
    vmAnim.swingT = Math.min(1, vmAnim.swingT + dt / 0.38);
    vmAnim.throwT = Math.min(1, vmAnim.throwT + dt / 0.5);
    vmAnim.satchelBtnT = Math.min(1, vmAnim.satchelBtnT + dt / 0.22);
    vmAnim.bfEquipT = Math.min(1, vmAnim.bfEquipT + dt / 0.5);
    vmAnim.bfStabT = Math.min(1, vmAnim.bfStabT + dt / 0.5);
    vmAnim.bfInspectT = Math.min(1, vmAnim.bfInspectT + dt / (vmAnim.inspectDur || 5.5));
    // Anim Studio drives the clock directly while open
    if (bfe.open && me.weapon === 'butterfly' && bfeRec) {
      vmAnim.bfEquipT = 1; vmAnim.bfStabT = 1; vmAnim.bfInspectT = 1; vmAnim.bfInspectPrev = 1;
      bfeRecTick(dt);
    } else if (bfe.open && me.weapon === 'butterfly') {
      if (bfe.playing) {
        bfe.t += dt * bfe.speed / BFE_DUR[bfe.track];
        if (bfe.t >= 1) bfe.t = bfe.loop ? bfe.t % 1 : 1;
        bfeSyncTransport();
      }
      if (bfe.track === 'equip') { vmAnim.bfEquipT = Math.min(bfe.t, 0.9999); vmAnim.bfStabT = 1; vmAnim.bfInspectT = 1; }
      else if (bfe.track === 'stab') { vmAnim.bfStabT = Math.min(bfe.t, 0.9999); vmAnim.bfEquipT = 1; vmAnim.bfInspectT = 1; }
      else { vmAnim.bfInspectT = Math.min(bfe.t, 0.9999); vmAnim.bfInspectPrev = vmAnim.bfInspectT; vmAnim.bfEquipT = 1; vmAnim.bfStabT = 1; }
    }
    bfeTickPrev();
    vmAnim.boltT = Math.min(1, vmAnim.boltT + dt / 0.55);
  }

  // sniper scope: overlay + hide the rifle while fully scoped
  const scoped = WEAPONS[me.weapon]?.scoped && me.ads > 0.78;
  $('#scope').classList.toggle('hidden', !scoped);
  $('#crosshair').classList.toggle('hidden', scoped || inLobbyMode());

  const vm = viewmodels[vmKey];
  if (vm) {
    vm.visible = !scoped && (!inLobbyMode() || bfe.open);   // lobby hides guns — unless the Anim Studio is previewing
    const k = me.ads;
    const loose = 1 - k * 0.85;                 // ADS tightens everything
    const bobAmt = (moving ? (sprinting2 ? 1.5 : 1) : 0) * loose;
    // figure-8 bob + idle breathing
    const bobX = Math.sin(vmBob) * 0.013 * bobAmt;
    const bobY = -Math.abs(Math.cos(vmBob)) * 0.016 * bobAmt + Math.sin(now * 1.6) * 0.0038 * loose;

    const HIP = VM_HIPS[vmKey] || VM_HIP;
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
    // melee swings — each weapon gets its own signature motion
    const mw = WEAPONS[me.weapon];
    if (mw?.melee && me.weapon !== 'fists' && vmAnim.swingT < 1) {
      const t = vmAnim.swingT, sd = vmAnim.swingSide;
      const s = Math.sin(Math.pow(t, 0.7) * Math.PI);          // 0→1→0 arc
      const wind = sstep(0, 0.22, t);                           // quick wind-up
      if (vmKey === 'catpaw') {
        // fast diagonal claw rake
        ry2 += (wind * 0.5 - s * 1.5) * sd;
        rz += (wind * 0.3 - s * 0.9) * sd;
        rx += -wind * 0.2 + s * 0.35;
        px += (wind * 0.06 - s * 0.28) * sd; pz -= s * 0.34;
      } else if (me.weapon === 'katana') {
        if (sd > 0) {
          // big diagonal overhead slash
          rz += (wind * 0.5 - s * 1.1) * sd;
          rx += -wind * 0.5 + s * 1.0;
          ry2 += (wind * 0.3 - s * 0.6) * sd;
          py += wind * 0.12 - s * 0.16; pz -= s * 0.28;
        } else {
          // alternate: a piercing two-hand THRUST straight through
          const drive = Math.sin(Math.pow(sstep(0.06, 0.72, t), 0.7) * Math.PI);
          rx += -wind * 0.2 + drive * 0.12;
          ry2 += wind * -0.25 + drive * 0.15;
          pz -= drive * 0.55; px -= drive * 0.1; py += drive * 0.03;
          rz += wind * 0.3 - drive * 0.25;
        }
      } else if (me.weapon === 'bat') {
        // flat home-run swing across the body
        ry2 += (wind * 0.6 - s * 1.7) * sd;
        rz += (wind * 0.2 - s * 0.5) * sd;
        px += (wind * 0.1 - s * 0.34) * sd; pz -= s * 0.18;
      } else if (me.weapon === 'butterfly') {
        // razor slash: cocked windup opposite side → whip across the screen
        // (outExpo attack, soft follow-through) — the handle fans a full turn
        // in the part-level block below
        // small group tilt only — the sweep itself happens at the HAND in
        // part-space (below), so the arms stay planted at the screen edge
        const wind = sstep(0, 0.12, t) * (1 - sstep(0.12, 0.3, t));
        const slash = Math.sin(Math.pow(sstep(0.06, 0.68, t), 0.75) * Math.PI);
        ry2 += (wind * 0.28 - slash * 0.55) * sd;
        rz += (wind * 0.22 - slash * 0.4) * sd;
        rx += -wind * 0.25 + slash * 0.5;
        px += (wind * 0.05 - slash * 0.14) * sd;
        py += wind * 0.05 - slash * 0.03;
        pz -= slash * 0.24;
      } else if (me.weapon === 'daggers') {
        // dual daggers: alternating cross-body stabs — the active-side blade
        // lunges forward while the rig twists into it
        const lunge = Math.sin(Math.pow(sstep(0.04, 0.7, t), 0.75) * Math.PI);
        ry2 += sd * (wind * 0.3 - lunge * 0.5);
        rz += sd * (wind * 0.25 - lunge * 0.35);
        rx += lunge * 0.3 - wind * 0.15;
        px += sd * (wind * 0.06 - lunge * 0.16); pz -= lunge * 0.42; py += lunge * 0.04;
      } else if (me.weapon === 'scythe') {
        // scythe: a big reaping crescent — high windup, low sweep-through
        const sweep = Math.sin(Math.pow(sstep(0.08, 0.8, t), 0.8) * Math.PI);
        ry2 += sd * (wind * 0.45 - sweep * 0.9);
        rz += sd * (wind * 0.35 - sweep * 0.65);
        rx += -wind * 0.45 + sweep * 0.7;
        px += sd * (wind * 0.08 - sweep * 0.22); py += wind * 0.12 - sweep * 0.1; pz -= sweep * 0.34;
      } else {
        // fallback: quick compact alternating arcs
        rz += sd * -0.7 * s; ry2 += sd * 0.55 * s;
        rx += 0.2 * s; px += sd * -0.1 * s; pz -= 0.2 * s;
      }
    }
    // throw: wind back, then whip forward overhand (grenade + satchel)
    if ((me.weapon === 'grenade' || me.weapon === 'satchel') && vmAnim.throwT < 1) {
      const t = vmAnim.throwT;
      const wind = sstep(0, 0.3, t) * (1 - sstep(0.3, 0.55, t));
      const whip = sstep(0.3, 0.55, t) * (1 - sstep(0.75, 1, t));
      rx += wind * 0.85 - whip * 1.9;
      py += wind * 0.1 - whip * 0.06;
      pz += wind * 0.16 - whip * 0.3;
    }
    // butterfly HEAVY STAB: raise in reverse grip, drive down, recover
    if (me.weapon === 'butterfly' && vmAnim.bfStabT < 1) {
      const t = vmAnim.bfStabT, T = BF_TRK.stab;
      py += trackVal(T.vy, t); pz += trackVal(T.vz, t);
      rx += trackVal(T.vrx, t); ry2 += trackVal(T.vry, t); rz += trackVal(T.vrz, t);
    }
    // INSPECT (every weapon): butterfly runs its balisong routine, the rest
    // run their class routine (gun examine / melee admire / util turntable / fists)
    if (vmAnim.bfInspectT < 1) {
      const t = vmAnim.bfInspectT;
      const cls = inspectClassFor(me.weapon);
      const T = cls === 'butterfly' ? BF_TRK.inspect : GEN_INSPECT[cls];
      px += trackVal(T.vx, t); py += trackVal(T.vy, t); pz += trackVal(T.vz, t);
      rx += trackVal(T.vrx, t); ry2 += trackVal(T.vry, t); rz += trackVal(T.vrz, t);
      const cues = cls === 'butterfly' ? [0.06, 0.16, 0.42, 0.48, 0.74, 0.8] : [0.08];
      for (const cue of cues) if (vmAnim.bfInspectPrev < cue && t >= cue) playOne(cls === 'butterfly' || cls === 'melee' ? 'knife' : 'equip', 0.35);
      vmAnim.bfInspectPrev = t;
    }

    vm.position.set(px, py, pz);
    vm.rotation.set(rx, ry2, rz);

    // ---- hand/part sub-animation (reset to base, then offset) ----
    const P = vm.userData;
    if (P?.base) {
      P.gun.position.copy(P.base.gun.p); P.gun.rotation.copy(P.base.gun.r);
      P.rArm.position.copy(P.base.rArm.p); P.rArm.rotation.copy(P.base.rArm.r);
      P.lArm.position.copy(P.base.lArm.p); P.lArm.rotation.copy(P.base.lArm.r);
      // cat paw: living, fluid motion — toes flex/breathe idle, curl+rake on swing
      if (P.isCatPaw && P.toes) {
        const swing = vmAnim.swingT < 1 ? Math.sin(Math.pow(vmAnim.swingT, 0.7) * Math.PI) : 0;
        for (const toe of P.toes) {
          const idle = Math.sin(now * 2.6 + toe.userData.phase) * 0.055;   // gentle toe wiggle
          toe.rotation.x = toe.userData.baseRX + idle - swing * 0.6;        // claws splay out on the rake
          toe.rotation.z = Math.sin(now * 1.8 + toe.userData.phase) * 0.03;
        }
        P.gun.position.y += Math.sin(now * 2.3) * 0.007;      // soft breathing
        P.gun.rotation.z += Math.sin(now * 1.25) * 0.025;     // lazy tail-like sway
        P.gun.rotation.x += Math.sin(now * 0.9) * 0.02;
      }
      // butterfly: articulated balisong — reset the pin parts, then layer
      // idle rattle + equip flip + slash fan + stab grip-flip + inspect
      if (P.bf && me.weapon === 'butterfly') {
        const B = P.bf;
        B.pivot.rotation.set(0, 0, 0); B.blade.rotation.set(0, 0, 0);
        B.hA.rotation.set(0, 0, 0); B.hB.rotation.set(0, 0, 0);
        // movement/idle: gentle handle rattle + wrist shimmer + sprint tilt
        B.hA.rotation.x += Math.sin(now * 2.1) * 0.012;
        B.pivot.rotation.z += Math.sin(now * 1.6) * 0.018;
        B.pivot.rotation.x += Math.sin(vmBob * 0.5) * 0.025 * vmAnim.sprintK;
        if (bfeRecActive()) {   // live record: your mouse IS the knife
          const R = bfeRec.vals;
          B.blade.rotation.x += R.bRx; B.hA.rotation.x += R.hARx;
          B.pivot.rotation.x += R.pRx; B.pivot.rotation.y += R.pRy; B.pivot.rotation.z += R.pRz;
        }
        if (vmAnim.bfEquipT < 1) {
          const t = vmAnim.bfEquipT, T = BF_TRK.equip;
          B.blade.rotation.x += trackVal(T.bRx, t); B.hA.rotation.x += trackVal(T.hARx, t);
          B.pivot.rotation.x += trackVal(T.pRx, t);
          B.pivot.rotation.z += trackVal(T.pRz, t); B.pivot.rotation.y += trackVal(T.pRy, t);
        }
        if (vmAnim.swingT < 1) {
          const t = vmAnim.swingT, sd = vmAnim.swingSide;
          const w2 = sstep(0, 0.12, t) * (1 - sstep(0.12, 0.3, t));
          const s2 = Math.sin(Math.pow(sstep(0.06, 0.68, t), 0.75) * Math.PI);
          B.hA.rotation.x += Math.PI * 2 * EASES.outExpo(t) * -sd;              // full handle fan per slash
          B.blade.rotation.x += Math.sin(sstep(0.15, 0.6, t) * Math.PI) * 0.14; // blade flex at impact
          B.pivot.rotation.z += Math.sin(t * Math.PI) * 0.35 * sd;
          // the actual sweep: hand + knife arc across the view, arm stays rooted
          P.gun.position.x += (w2 * 0.1 - s2 * 0.34) * sd;
          P.gun.position.z += -s2 * 0.24; P.gun.position.y += s2 * 0.05;
          P.rArm.position.x += (w2 * 0.08 - s2 * 0.26) * sd;
          P.rArm.position.z += -s2 * 0.18;
          P.rArm.rotation.z += s2 * 0.35 * sd;
          P.lArm.position.y -= s2 * 0.28; P.lArm.position.x -= s2 * 0.1;        // keep the off-hand tucked out of frame
        }
        if (vmAnim.bfStabT < 1) {
          const t = vmAnim.bfStabT, T = BF_TRK.stab;
          B.blade.rotation.x += trackVal(T.bRx, t); B.hA.rotation.x += trackVal(T.hARx, t);
          // the plunge: hand + knife drive down in part-space, blade stays framed
          const gy = trackVal(T.gPy, t), gz = trackVal(T.gPz, t);
          P.gun.position.y += gy; P.gun.position.z += gz;
          P.rArm.position.y += gy * 0.8; P.rArm.position.z += gz * 0.8;
          P.rArm.rotation.x += trackVal(T.vrx, t) * 0.5;
        }
        if (vmAnim.bfInspectT < 1) {
          const t = vmAnim.bfInspectT, T = BF_TRK.inspect;
          B.blade.rotation.x += trackVal(T.bRx, t);
          B.hA.rotation.x += trackVal(T.hARx, t); B.hB.rotation.x += trackVal(T.hBRx, t);
          B.pivot.rotation.x += trackVal(T.pRx, t); B.pivot.rotation.y += trackVal(T.pRy, t);
          B.pivot.rotation.z += trackVal(T.pRz, t);
          P.gun.position.y += 0.06 * Math.sin(t * Math.PI);   // gentle lift keeps it center-frame
          P.lArm.position.y -= 0.08 * Math.sin(t * Math.PI);  // off-hand stays low
        }
        // spin-blur: keyframe 'blur' 0→1 and the knife becomes a flickering streak-disc
        let blurK = 0;
        if (vmAnim.bfEquipT < 1 && BF_TRK.equip.blur) blurK = Math.max(blurK, trackVal(BF_TRK.equip.blur, vmAnim.bfEquipT));
        if (vmAnim.bfStabT < 1 && BF_TRK.stab.blur) blurK = Math.max(blurK, trackVal(BF_TRK.stab.blur, vmAnim.bfStabT));
        if (vmAnim.bfInspectT < 1 && BF_TRK.inspect.blur) blurK = Math.max(blurK, trackVal(BF_TRK.inspect.blur, vmAnim.bfInspectT));
        if (B.blur) {
          const on = blurK > 0.03, hide = blurK > 0.5;
          B.blur.visible = on;
          B.blade.visible = !hide; B.hA.visible = !hide; B.hB.visible = !hide;
          if (on) {
            B.blur.material.opacity = Math.min(1, blurK) * (0.24 + 0.14 * (0.5 + 0.5 * Math.sin(now * 62)));   // flicker
            B.blur.rotation.z = (now * 46) % (Math.PI * 2);   // streaks whirl
          }
        }
      }
      // ---- generic inspect part-flavor (non-butterfly) ----
      if (vmAnim.bfInspectT < 1 && me.weapon !== 'butterfly') {
        const t = vmAnim.bfInspectT;
        const cls = inspectClassFor(me.weapon);
        if (cls === 'gun') {
          // glance at the mag: left hand drops to it mid-inspect; AR's mag wiggles
          const check = Math.sin(sstep(0.55, 0.85, t) * Math.PI);
          P.lArm.position.y -= check * 0.1; P.lArm.rotation.x -= check * 0.35;
          const FXi = vm.userData.fx;
          if (FXi?.mag) { FXi.mag.position.y = -0.15 - check * 0.05; FXi.mag.rotation.z = check * 0.15; }
        } else if (cls === 'melee') {
          // one clean spin-flourish at the halfway mark
          P.gun.rotation.x += EASES.outExpo(sstep(0.45, 0.75, t)) * -6.283;
        } else if (cls === 'util') {
          // turntable the gadget + a tiny toss-catch at the end
          P.gun.rotation.y += EASES.inOutCubic(sstep(0.12, 0.75, t)) * 6.283;
          P.gun.position.y += Math.sin(sstep(0.78, 0.96, t) * Math.PI) * 0.09;
        } else if (cls === 'fists') {
          // raise both fists and roll the knuckles out
          const raise = sstep(0, 0.2, t) * (1 - sstep(0.8, 1, t));
          const knuck = Math.sin(sstep(0.25, 0.7, t) * Math.PI);
          for (const arm of [P.rArm, P.lArm]) { arm.position.y += raise * 0.16; arm.position.z -= raise * 0.2; arm.rotation.x -= raise * 0.55; }
          P.rArm.rotation.z += knuck * 0.85; P.lArm.rotation.z -= knuck * 0.85;
        }
      }
      // ---- universal idle breathing (per class) ----
      const wDef = WEAPONS[me.weapon] || {};
      if (!P.isCatPaw) {
        if (wDef.melee) { P.gun.rotation.x += Math.sin(now * 1.9) * 0.014; P.gun.rotation.z += Math.sin(now * 1.35) * 0.011; P.gun.position.y += Math.sin(now * 2.2) * 0.004; }
        else if (wDef.mag) { P.gun.rotation.z += Math.sin(now * 1.2) * 0.008; P.gun.position.y += Math.sin(now * 1.7) * 0.003; P.lArm.rotation.z += Math.sin(now * 1.2) * 0.01; }
        else { P.gun.rotation.z += Math.sin(now * 1.4) * 0.012; P.gun.position.y += Math.sin(now * 1.9) * 0.005; }
      }
      // ---- moving parts: slides/bolts kick with the shot ----
      const FX = vm.userData.fx;
      if (FX) {
        if (FX.slide) { FX.slide.position.z = FX.slide.userData.z0 + vmKick * 0.11; FX.serr.position.z = FX.serr.userData.z0 + vmKick * 0.11; }
        if (FX.bolt && vmKey === 'ar') FX.bolt.position.z = FX.bolt.userData.z0 + vmKick * 0.07;
        if (FX.mag && vmAnim.bfInspectT >= 1) { FX.mag.position.y = -0.15; FX.mag.rotation.z = 0; }   // reset after mag-check inspect
        // sniper: work the bolt between shots — hand comes up, bolt back + forward
        if (FX.bolt && vmKey === 'sniper') {
          if (vmAnim.boltT < 1 && !me.reloading) {
            const bt = vmAnim.boltT;
            const back = Math.sin(sstep(0.08, 0.6, bt) * Math.PI);
            FX.bolt.position.z = FX.bolt.userData.z0 + back * 0.15;
            FX.bolt.position.y = FX.bolt.userData.y0 + back * 0.025;
            P.gun.rotation.z += back * 0.16;
            P.lArm.position.z += back * 0.15; P.lArm.position.y += back * 0.09; P.lArm.rotation.x -= back * 0.55;
          } else { FX.bolt.position.z = FX.bolt.userData.z0; FX.bolt.position.y = FX.bolt.userData.y0; }
        }
        // grenade: pull the PIN on the windup, lever pops off with the whip
        if (FX.pin && me.weapon === 'grenade') {
          if (vmAnim.throwT < 1) {
            const tt = vmAnim.throwT;
            const pull = sstep(0.05, 0.28, tt);
            FX.pin.position.x = FX.pin.userData.x0 - pull * 0.16;
            FX.pin.position.y = FX.pin.userData.y0 + pull * 0.1;
            FX.lever.rotation.z = -sstep(0.3, 0.5, tt) * 1.4;
            P.lArm.position.x += pull * (1 - sstep(0.28, 0.45, tt)) * 0.28;   // left hand reaches over to yank it
            P.lArm.position.y += pull * (1 - sstep(0.28, 0.45, tt)) * 0.1;
          } else { FX.pin.position.x = FX.pin.userData.x0; FX.pin.position.y = FX.pin.userData.y0; FX.lever.rotation.z = 0; }
        }
      }
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
        const isGun = !!WEAPONS[me.weapon]?.mag;
        if (isGun) {                                   // rack the action
          const rack = Math.sin(sstep(0.62, 0.95, t) * Math.PI);
          P.lArm.position.z += rack * 0.11;
          P.gun.rotation.z -= rack * 0.12;
        }
        if (me.weapon === 'scythe' || me.weapon === 'daggers') {
          // knives spin-flourish into the grip
          P.gun.rotation.x -= (1 - sstep(0.1, 0.8, t)) * 6.283;
        } else if (me.weapon === 'katana') {
          // drawn from the hip: slides forward out of an imaginary sheath
          const draw = 1 - sstep(0.05, 0.8, t);
          P.gun.position.z += draw * 0.34; P.gun.position.x -= draw * 0.1;
          P.gun.rotation.z += draw * 0.5;
        } else if (me.weapon === 'bat') {
          // shoulder-load: comes up from behind the shoulder
          const load = 1 - sstep(0.1, 0.85, t);
          P.gun.rotation.x += load * 1.1; P.gun.position.y += load * 0.12; P.gun.position.z += load * 0.16;
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
      // reload: each gun reloads its own way
      if (me.reloading) {
        const rT = clamp((cn - vmAnim.reloadStart) / (vmAnim.reloadDur || 1), 0, 1);
        const w = me.weapon;
        if (w === 'revolver') {
          // cylinder swings OUT to the side, left hand feeds rounds, snaps shut
          const swing = Math.sin(sstep(0, 0.32, rT) * Math.PI * 0.5) * (1 - sstep(0.74, 1, rT));
          P.gun.rotation.z += swing * 1.05;
          P.gun.rotation.y += swing * 0.35;
          P.gun.position.x -= swing * 0.05;
          const load = Math.sin(sstep(0.28, 0.72, rT) * Math.PI);
          P.lArm.position.x += load * 0.12; P.lArm.position.z += load * 0.1;
          P.lArm.rotation.z += load * 0.5;
        } else if (w === 'shotgun' || w === 'shorty') {
          // rack the fore-end and thumb shells in (a few pumps)
          const pumps = w === 'shorty' ? 2 : 4;
          const pump = Math.abs(Math.sin(rT * Math.PI * pumps));
          P.lArm.position.z += pump * 0.2 - 0.06;
          P.gun.position.z += (1 - pump) * 0.05;
          P.gun.rotation.x += Math.sin(rT * Math.PI) * 0.1;
        } else if (w === 'sniper' || w === 'autosniper') {
          // work the bolt: left hand pulls back on top, then forward
          const back = Math.sin(sstep(0.12, 0.5, rT) * Math.PI);
          P.lArm.position.z += back * 0.17; P.lArm.position.y += back * 0.07;
          P.lArm.position.x += back * 0.05; P.lArm.rotation.x -= back * 0.55;
          P.gun.rotation.z += Math.sin(rT * Math.PI) * 0.18;
        } else if (w === 'minigun') {
          // barrels whir + fresh belt fed from below
          P.gun.rotation.z += Math.sin(rT * Math.PI * 12) * 0.13;
          const feed = sstep(0, 0.3, rT) * (1 - sstep(0.7, 1, rT));
          P.lArm.position.y -= feed * 0.12; P.lArm.position.z += feed * 0.12;
        } else {
          // default detachable-mag swap: left hand rips the mag, gun tips over
          const out = sstep(0, 0.28, rT) * (1 - sstep(0.62, 0.92, rT));
          P.lArm.position.y -= out * 0.18; P.lArm.position.z += out * 0.16;
          P.lArm.position.x += out * 0.04; P.lArm.rotation.x -= out * 1.0;
          P.gun.rotation.z += Math.sin(rT * Math.PI) * 0.45;
          P.gun.rotation.x += Math.sin(rT * Math.PI) * 0.12;
        }
      }
      // grenade / satchel throw: the RIGHT hand winds up and hurls the charge
      if ((me.weapon === 'grenade' || me.weapon === 'satchel') && vmAnim.throwT < 1) {
        const t = vmAnim.throwT;
        const whip = sstep(0.3, 0.55, t) * (1 - sstep(0.8, 1, t));
        P.rArm.position.z -= whip * 0.28;
        P.rArm.rotation.x -= whip * 1.2;
        // the charge leaves the hand mid-throw
        if (me.weapon === 'satchel' && P.explosive) P.explosive.visible = t < 0.42 || t > 0.9;
        else P.gun.visible = t < 0.42 || t > 0.85;
      } else { if (P.gun) P.gun.visible = true; if (P.explosive) P.explosive.visible = true; }
      // satchel detonator: the LEFT hand slams the red plunger button down
      if (me.weapon === 'satchel' && P.plunger) {
        P.plunger.position.y = P.plungerY;
        if (vmAnim.satchelBtnT < 1) {
          const t = vmAnim.satchelBtnT;
          const press = Math.sin(sstep(0, 0.3, t) * Math.PI * 0.5) * (1 - sstep(0.5, 1, t));
          P.plunger.position.y = P.plungerY - press * 0.08;   // button pushes down
          P.lArm.position.z -= press * 0.06;                  // thumb drives it
          P.lArm.rotation.x -= press * 0.4;
          P.rArm.rotation.z += press * 0.14;                  // little kick in the charge hand
        }
      }
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
  // wave survival: spinning weapon drops + top HUD countdown
  if (game.waveMode) {
    for (const g of dropMeshes.values()) { g.rotation.y += dt * 2.2; g.children[0].position.y = 0.12 + Math.sin(now * 2.4) * 0.08; }
    updateWaveTop();
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

  renderer.autoClear = false;
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();               // viewmodel always draws over the world
  renderer.render(vmScene, camera);
}

// ============================ go ============================
status('Connecting…');
buildMap(LOBBY);
setupMobile(); updateMobileHud();
updateAmmoHud(); updateLoadoutHud(); updateHpHud();
await loadMySkins(); applyMyViewmodelSkins(); buildSkinsUI(); buildLoadoutUI(); buildQuickPick(); buildCharmsUI();
net.connect();
net.join({ name: identity.name, avatar: identity.avatar, code: localStorage.getItem('claudebox.code') || '', skins: mySkins.equipped, platform: platformKind() });
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
wireLobbyUi();
preloadR6().then((hq) => {   // upgrade to the high-quality rig once it loads
  if (hq && myR6) { scene.remove(myR6.group); myR6.dispose?.(); myR6 = null; }
});
frame();
