// ClaudeBox Studio — a generic 3D level editor + live play-test runtime.
// Edit primitive parts (box/ramp/cylinder/sphere) with transforms, colour,
// collision and BEHAVIORS (triggers), then toggle Play to walk the level with a
// real avatar and run the triggers. Levels save per-slot to the server.

import * as THREE from 'three';
import { fpFade } from '/js/fpzoom.js';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { BEHAVIORS, PALETTE, SHAPES, newPart, sanitizeLevel, starterLevel } from '/shared/studio/format.js';
import { parseRbxlx } from './rbxlx.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#view');

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fd6f2');
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight('#ffffff', '#5a708a', 1.05));
const sun = new THREE.DirectionalLight('#fff4e0', 1.0);
sun.position.set(60, 120, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120; sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120; sun.shadow.camera.far = 500;
scene.add(sun, sun.target);
const grid = new THREE.GridHelper(400, 80, 0x335577, 0x223344);
grid.position.y = 0.02; scene.add(grid);
const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

// spawn marker
const spawnMarker = new THREE.Group();
{
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8), lam('#ffffff'));
  pole.position.y = 1.2; const flag = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 4), lam('#2f7fd6'));
  flag.position.set(0.35, 2.0, 0); flag.rotation.z = -Math.PI / 2; spawnMarker.add(pole, flag);
}
scene.add(spawnMarker);

// ---------- geometry helpers ----------
function wedge(sx, sy, sz) {
  // right-triangle prism: top slopes from +sy/2 at x=-sx/2 down to -sy/2 at x=+sx/2
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const v = [
    -hx, hy, hz, -hx, -hy, hz, hx, -hy, hz,      // front tri 0,1,2
    -hx, hy, -hz, -hx, -hy, -hz, hx, -hy, -hz,   // back tri 3,4,5
  ];
  const idx = [
    0, 1, 2, 5, 4, 3,                 // front, back
    0, 2, 5, 0, 5, 3,                 // slope
    1, 4, 5, 1, 5, 2,                 // bottom
    0, 3, 4, 0, 4, 1,                 // back wall
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function geomFor(shape, s) {
  if (shape === 'cylinder') return new THREE.CylinderGeometry(s[0] / 2, s[0] / 2, s[1], 22);
  if (shape === 'sphere') return new THREE.SphereGeometry(s[0] / 2, 20, 14);
  if (shape === 'ramp') return wedge(s[0], s[1], s[2]);
  return new THREE.BoxGeometry(s[0], s[1], s[2]);
}

// ---------- state ----------
const params = new URLSearchParams(location.search);
const state = {
  level: { name: 'Untitled', sky: '#8fd6f2', spawn: { x: 0, y: 4, z: 0 }, parts: [] },
  built: new Map(),     // id -> { spec, mesh }
  selected: null,
  mode: 'edit',
  slug: (params.get('play') || params.get('slug') || 'playground'),
};

function applyMesh(rec) {
  const s = rec.spec;
  rec.mesh.geometry.dispose();
  rec.mesh.geometry = geomFor(s.shape, s.size);
  rec.mesh.material.color.set(s.color);
  rec.mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
  rec.mesh.rotation.y = s.rotY;
  rec.mesh.material.emissive.set(rec === state.built.get(state.selected) ? '#2a4a6a' : '#000000');
}
function addMesh(spec) {
  const mesh = new THREE.Mesh(geomFor(spec.shape, spec.size), lam(spec.color));
  mesh.castShadow = mesh.receiveShadow = true; mesh.userData.id = spec.id;
  scene.add(mesh);
  const rec = { spec, mesh };
  state.built.set(spec.id, rec);
  applyMesh(rec);
  return rec;
}
function rebuildAll() {
  for (const rec of state.built.values()) { scene.remove(rec.mesh); rec.mesh.geometry.dispose(); }
  state.built.clear();
  for (const spec of state.level.parts) addMesh(spec);
  spawnMarker.position.set(state.level.spawn.x, state.level.spawn.y - 2.2, state.level.spawn.z);
  refreshInspector();
}

// ---------- selection + inspector ----------
function select(id) {
  state.selected = id;
  for (const rec of state.built.values()) applyMesh(rec);   // refresh emissive
  refreshInspector();
}
const inspBody = $('#insp-body'), inspEmpty = $('#insp-empty');
function refreshInspector() {
  const rec = state.built.get(state.selected);
  if (!rec) { inspBody.classList.add('hidden'); inspEmpty.classList.remove('hidden'); return; }
  inspEmpty.classList.add('hidden'); inspBody.classList.remove('hidden');
  const s = rec.spec;
  const numRow = (lbl, arr, idx, step = 0.5) => `<div class="field"><label>${lbl}</label><div class="row3">${
    [0, 1, 2].map((i) => `<input type="number" step="${step}" data-${idx}="${i}" value="${+arr[i].toFixed(2)}">`).join('')}</div></div>`;
  inspBody.innerHTML = `
    <div class="field"><label>Shape</label><select data-shape>${SHAPES.map((sh) => `<option ${sh === s.shape ? 'selected' : ''}>${sh}</option>`).join('')}</select></div>
    ${numRow('Position (x y z)', s.pos, 'pos')}
    ${numRow('Size (x y z)', s.size, 'size')}
    <div class="field"><label>Rotate Y (°)</label><input type="number" step="5" data-roty value="${Math.round(s.rotY * 180 / Math.PI)}"></div>
    <div class="field"><label>Colour</label><input type="color" data-color value="${s.color}"></div>
    <label class="chk"><input type="checkbox" data-solid ${s.solid ? 'checked' : ''}> Solid (collision)</label>
    <h3>Triggers</h3><div id="beh-list"></div>
    <select id="beh-add"><option value="">+ add trigger…</option>${Object.entries(BEHAVIORS).map(([k, b]) => `<option value="${k}">${b.emoji} ${b.label}</option>`).join('')}</select>
  `;
  // wire transform inputs
  inspBody.querySelectorAll('[data-pos]').forEach((el) => el.oninput = () => { s.pos[+el.dataset.pos] = +el.value; applyMesh(rec); syncSpawnIfNeeded(); });
  inspBody.querySelectorAll('[data-size]').forEach((el) => el.oninput = () => { s.size[+el.dataset.size] = Math.max(0.1, +el.value); applyMesh(rec); });
  inspBody.querySelector('[data-shape]').onchange = (e) => { s.shape = e.target.value; applyMesh(rec); };
  inspBody.querySelector('[data-roty]').oninput = (e) => { s.rotY = (+e.target.value) * Math.PI / 180; applyMesh(rec); };
  inspBody.querySelector('[data-color]').oninput = (e) => { s.color = e.target.value; applyMesh(rec); };
  inspBody.querySelector('[data-solid]').onchange = (e) => { s.solid = e.target.checked; };
  inspBody.querySelector('#beh-add').onchange = (e) => { if (e.target.value) { s.behaviors.push(behDefaults(e.target.value)); refreshInspector(); } };
  renderBehaviors(s);
}
function behDefaults(type) { return { type, ...JSON.parse(JSON.stringify(BEHAVIORS[type].params)) }; }
function renderBehaviors(s) {
  const host = $('#beh-list'); host.innerHTML = '';
  s.behaviors.forEach((b, i) => {
    const def = BEHAVIORS[b.type];
    const div = document.createElement('div'); div.className = 'beh';
    div.innerHTML = `<div class="beh-head"><span>${def.emoji} ${def.label}</span><button data-rm="${i}">✕</button></div>` +
      Object.keys(def.params).map((k) => {
        const dv = def.params[k];
        if (typeof dv === 'number') return `<div class="field"><label>${k}</label><input type="number" step="0.5" data-k="${k}" value="${b[k]}"></div>`;
        if (typeof dv === 'string') return `<div class="field"><label>${k}</label><input type="text" data-k="${k}" value="${(b[k] || '').replace(/"/g, '&quot;')}"></div>`;
        return '';
      }).join('');
    div.querySelector('[data-rm]').onclick = () => { s.behaviors.splice(i, 1); refreshInspector(); };
    div.querySelectorAll('[data-k]').forEach((el) => el.oninput = () => {
      b[el.dataset.k] = el.type === 'number' ? +el.value : el.value;
    });
    host.appendChild(div);
  });
}
function syncSpawnIfNeeded() {}

// ---------- palette + edit actions ----------
const palList = $('#palette-list');
PALETTE.forEach((p) => {
  const b = document.createElement('button'); b.className = 'pal-btn';
  b.innerHTML = `<span class="e">${p.emoji}</span><span class="l">${p.label}</span>`;
  b.onclick = () => {
    const t = camTarget();
    const spec = newPart({ shape: p.shape, size: [...p.size], color: p.color, pos: [Math.round(t.x), p.size[1] / 2, Math.round(t.z)] });
    state.level.parts.push(spec); addMesh(spec); select(spec.id); status('Added ' + p.label);
  };
  palList.appendChild(b);
});
$('#btn-del').onclick = () => deleteSel();
$('#btn-dupe').onclick = () => dupeSel();
$('#btn-spawn').onclick = () => {
  const rec = state.built.get(state.selected); if (!rec) return status('Select a part first');
  state.level.spawn = { x: rec.spec.pos[0], y: rec.spec.pos[1] + rec.spec.size[1] / 2 + 2, z: rec.spec.pos[2] };
  spawnMarker.position.set(state.level.spawn.x, state.level.spawn.y - 2.2, state.level.spawn.z); status('Spawn set');
};
function deleteSel() {
  const rec = state.built.get(state.selected); if (!rec) return;
  scene.remove(rec.mesh); rec.mesh.geometry.dispose(); state.built.delete(rec.spec.id);
  state.level.parts = state.level.parts.filter((p) => p.id !== rec.spec.id);
  select(null); status('Deleted');
}
function dupeSel() {
  const rec = state.built.get(state.selected); if (!rec) return;
  const spec = newPart({ ...JSON.parse(JSON.stringify(rec.spec)) }); spec.pos[0] += 3; spec.pos[2] += 3;
  state.level.parts.push(spec); addMesh(spec); select(spec.id); status('Duplicated');
}

// ---------- camera ----------
const orbit = { yaw: Math.PI * 0.75, pitch: 0.7, dist: 40, target: new THREE.Vector3(0, 2, 0) };
function camTarget() { return orbit.target; }
function updateCamera() {
  const cp = Math.cos(orbit.pitch);
  camera.position.set(
    orbit.target.x + Math.sin(orbit.yaw) * cp * orbit.dist,
    orbit.target.y + Math.sin(orbit.pitch) * orbit.dist,
    orbit.target.z + Math.cos(orbit.yaw) * cp * orbit.dist,
  );
  camera.lookAt(orbit.target);
}

// ---------- editor pointer (select / move / orbit) ----------
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
let dragging = null;  // 'orbit' | 'move'
let last = { x: 0, y: 0 };
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pickPart(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([...state.built.values()].map((r) => r.mesh), false)[0];
  return hit ? hit.object.userData.id : null;
}
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'edit') return;
  last = { x: e.clientX, y: e.clientY };
  if (e.button === 2 || e.button === 1) { dragging = 'orbit'; return; }
  const id = pickPart(e);
  if (id) { select(id); dragging = 'move'; } else { select(null); dragging = 'orbit'; }
});
addEventListener('pointermove', (e) => {
  if (!dragging || state.mode !== 'edit') return;
  if (dragging === 'orbit') {
    orbit.yaw -= (e.clientX - last.x) * 0.006; orbit.pitch += (e.clientY - last.y) * 0.006;
    orbit.pitch = Math.max(0.05, Math.min(1.45, orbit.pitch));
  } else if (dragging === 'move') {
    const rec = state.built.get(state.selected); if (!rec) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    dragPlane.constant = -rec.spec.pos[1];   // plane y = part y
    const hitP = new THREE.Vector3();
    if (ray.ray.intersectPlane(dragPlane, hitP)) {
      let x = hitP.x, z = hitP.z;
      if ($('#snap').checked) { x = Math.round(x); z = Math.round(z); }
      rec.spec.pos[0] = x; rec.spec.pos[2] = z; applyMesh(rec); refreshInspector();
    }
  }
  last = { x: e.clientX, y: e.clientY };
});
addEventListener('pointerup', () => { dragging = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.mode === 'play') orbit.dist = Math.max(0.3, Math.min(300, orbit.dist + e.deltaY * 0.01));   // 0.3 = first-person
  else orbit.dist = Math.max(6, Math.min(300, orbit.dist + e.deltaY * 0.03));
}, { passive: false });

// two-finger pinch zoom (play mode only — editor pointer handling untouched)
let pinchDist = 0;
canvas.addEventListener('touchstart', (e) => {
  if (state.mode === 'play' && e.touches.length === 2) {
    pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (state.mode !== 'play' || e.touches.length !== 2 || !pinchDist) return;
  e.preventDefault();
  const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  if (d > 0) orbit.dist = Math.max(0.3, Math.min(300, orbit.dist * (pinchDist / d)));   // spread = zoom in
  pinchDist = d;
}, { passive: false });
canvas.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinchDist = 0; });
canvas.addEventListener('touchcancel', () => { pinchDist = 0; });

addEventListener('keydown', (e) => {
  if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.code === 'Escape' && state.mode === 'play') { stopPlay(); return; }
  if (state.mode !== 'edit') return;
  const rec = state.built.get(state.selected);
  if (e.code === 'Delete' || e.code === 'Backspace') deleteSel();
  if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); dupeSel(); }
  if (rec) {
    if (e.code === 'KeyQ') { rec.spec.pos[1] -= 0.5; applyMesh(rec); refreshInspector(); }
    if (e.code === 'KeyE') { rec.spec.pos[1] += 0.5; applyMesh(rec); refreshInspector(); }
    if (e.code === 'BracketLeft') { rec.spec.rotY -= Math.PI / 12; applyMesh(rec); refreshInspector(); }
    if (e.code === 'BracketRight') { rec.spec.rotY += Math.PI / 12; applyMesh(rec); refreshInspector(); }
  }
});

// ---------- save / load / export / import ----------
$('#slot').value = state.slug;
$('#slot').onchange = () => { state.slug = $('#slot').value; loadSlot(); };
$('#level-name').oninput = (e) => { state.level.name = e.target.value; };
$('#btn-save').onclick = async () => {
  state.level = sanitizeLevel(state.level);
  try {
    const res = await fetch('/api/level/' + state.slug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: state.level }) });
    const d = await res.json();
    status(d.ok ? `Saved to "${state.slug}" — it's live!` : 'Save failed');
    if (d.ok) window.ClaudeBox?.completeChallenge('studio-publish');
  } catch { status('Save failed (offline?)'); }
};
$('#btn-load').onclick = loadSlot;
async function loadSlot() {
  $('#slot').value = state.slug;
  try {
    const { level } = await (await fetch('/api/level/' + state.slug)).json();
    state.level = sanitizeLevel(level || { parts: [] });
  } catch { state.level = sanitizeLevel({ parts: [] }); }
  $('#level-name').value = state.level.name;
  state.selected = null; rebuildAll(); frameCameraOnLevel(); status('Loaded "' + state.slug + '"');
}
$('#btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(sanitizeLevel(state.level), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (state.level.name || 'level') + '.json'; a.click();
};
$('#btn-import').onclick = () => $('#file-input').click();
$('#file-input').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    const text = String(r.result);
    try {
      if (/\.rbxlx$/i.test(f.name) || text.startsWith('<roblox ') || text.startsWith('<roblox>')) {
        // a Roblox Studio place saved as XML — convert parts to studio primitives
        const { level, stats } = parseRbxlx(text);
        level.name = f.name.replace(/\.rbxlx$/i, '');
        state.level = sanitizeLevel(level);
        status(`Imported ${stats.imported} parts`
          + (stats.skipped ? ` · ${stats.skipped} skipped (meshes/scripts/terrain)` : '')
          + (stats.flattened ? ` · ${stats.flattened} tilts flattened to yaw` : '')
          + (stats.truncated ? ` · ${stats.truncated} over the 2000-part cap` : ''));
      } else if (text.startsWith('<roblox!')) {
        return status('That\'s the BINARY .rbxl format — in Roblox Studio use File → Save As → .rbxlx');
      } else {
        state.level = sanitizeLevel(JSON.parse(text));
        status('Imported');
      }
      $('#level-name').value = state.level.name;
      state.selected = null;
      rebuildAll();
      frameCameraOnLevel();
    } catch (err) { status('Bad file — ' + (err?.message || 'could not read it')); }
  };
  r.readAsText(f);
};
function frameCameraOnLevel() {
  if (!state.level.parts.length) { orbit.target.set(0, 2, 0); orbit.dist = 40; return; }
  const box = new THREE.Box3();
  for (const rec of state.built.values()) box.expandByObject(rec.mesh);
  const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
  orbit.target.copy(c); orbit.dist = Math.max(20, Math.max(sz.x, sz.z) * 1.3);
}

$('#btn-help').onclick = () => $('#help').classList.remove('hidden');
$('#help-close').onclick = () => $('#help').classList.add('hidden');

let statusT = null;
function status(t) { const el = $('#status'); el.textContent = t; el.classList.add('show'); clearTimeout(statusT); statusT = setTimeout(() => el.classList.remove('show'), 1800); }

// ================= PLAY MODE =================
const play = {
  avatar: null, identity: null,
  player: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ry: 0, grounded: false, anim: 'idle' },
  keys: new Set(), respawn: { x: 0, y: 4, z: 0 }, speedUntil: 0, speedMult: 1, touchCd: new Map(),
  paused: false, now: 0,
};
const PLAY = { R: 0.4, G: 30, JUMP: 13.2, MOVE: 8, RUN: 12 };
// Real Bits are only charged when a published level is played (the Playground
// lives under /games/…). In the editor (/studio) test-play runs purchases free.
const IN_GAME = location.pathname.startsWith('/games/');
let avatarsReady = false;
preloadAvatars(['boy', 'girl']).then(() => { avatarsReady = true; }).catch(() => {});

$('#btn-play').onclick = () => state.mode === 'play' ? stopPlay() : startPlay();

async function startPlay() {
  state.level = sanitizeLevel(state.level);
  if (!avatarsReady) { try { await preloadAvatars(['boy', 'girl']); avatarsReady = true; } catch {} }
  if (!play.identity) { try { play.identity = await loadIdentity(); } catch { play.identity = { name: 'You', avatar: {} }; } }
  if (!play.avatar) { play.avatar = makeAvatar(play.identity.avatar || {}); scene.add(play.avatar.group); }
  state.mode = 'play'; select(null);
  document.querySelectorAll('#palette,#inspector,#topbar').forEach((e) => e.style.opacity = 0.0);
  document.querySelectorAll('#palette,#inspector').forEach((e) => e.style.pointerEvents = 'none');
  $('#playhud').classList.remove('hidden'); $('#btn-play').textContent = '⏹ Stop';
  $('#topbar').style.opacity = 1;
  play.respawn = { ...state.level.spawn };
  respawnPlayer();
  // snapshot mesh transforms so we can restore after play (movers/spinners mutate)
  for (const rec of state.built.values()) rec._base = { p: rec.mesh.position.clone(), r: rec.mesh.rotation.clone() };
}
function stopPlay() {
  state.mode = 'edit';
  document.querySelectorAll('.shop-modal').forEach((m) => m.remove());
  play.paused = false;
  document.querySelectorAll('#palette,#inspector,#topbar').forEach((e) => { e.style.opacity = 1; e.style.pointerEvents = 'auto'; });
  $('#playhud').classList.add('hidden'); $('#btn-play').textContent = '▶ Play';
  if (play.avatar) { fpFade(play.avatar.group, 10); play.avatar.group.visible = false; }   // un-fade, then hide
  orbit.dist = Math.max(6, orbit.dist);   // editor keeps its own zoom range
  for (const rec of state.built.values()) if (rec._base) { rec.mesh.position.copy(rec._base.p); rec.mesh.rotation.copy(rec._base.r); }
}
function respawnPlayer() {
  play.player.pos = { ...play.respawn }; play.player.vel = { x: 0, y: 0, z: 0 };
  if (play.avatar) play.avatar.group.visible = true;
}
function ptoast(t) { const d = document.createElement('div'); d.className = 'ptoast'; d.textContent = t; $('#play-toasts').appendChild(d); setTimeout(() => d.remove(), 2200); }

addEventListener('keydown', (e) => { if (state.mode === 'play') play.keys.add(e.code); });
addEventListener('keyup', (e) => play.keys.delete(e.code));

function supportUnder(px, pz, fromY) {
  let best = -Infinity, hit = null;
  for (const rec of state.built.values()) {
    if (!rec.spec.solid) continue;
    const m = rec.mesh, s = rec.spec.size; const dx = px - m.position.x, dz = pz - m.position.z;
    let top = -Infinity, inside = false;
    if (rec.spec.shape === 'cylinder' || rec.spec.shape === 'sphere') {
      const r = s[0] / 2 + PLAY.R;
      if (dx * dx + dz * dz < r * r) { inside = true; top = m.position.y + (rec.spec.shape === 'sphere' ? s[0] / 2 : s[1] / 2); }
    } else {
      const c = Math.cos(m.rotation.y), sn = Math.sin(m.rotation.y);
      const lx = c * dx - sn * dz, lz = sn * dx + c * dz;
      if (Math.abs(lx) < s[0] / 2 + PLAY.R && Math.abs(lz) < s[2] / 2 + PLAY.R) {
        inside = true;
        if (rec.spec.shape === 'ramp') top = m.position.y + s[1] / 2 - ((Math.max(-s[0] / 2, Math.min(s[0] / 2, lx)) + s[0] / 2) / s[0]) * s[1];
        else top = m.position.y + s[1] / 2;
      }
    }
    if (inside && top <= fromY + 0.6 && top > best) { best = top; hit = rec; }
  }
  return { top: best, rec: hit };
}

function fireTouch(rec, b, t) {
  const key = rec.spec.id + b.type;
  const cd = play.touchCd.get(key) || 0;
  if (t < cd) return;
  const p = play.player;
  switch (b.type) {
    case 'trampoline': if (p.vel.y <= 1) { p.vel.y = b.power; play.touchCd.set(key, t + 0.25); } break;
    case 'launch': p.vel.x = b.fx; p.vel.y = b.fy; p.vel.z = b.fz; play.touchCd.set(key, t + 0.4); break;
    case 'kill': ptoast('💀 Reset'); respawnPlayer(); play.touchCd.set(key, t + 0.5); break;
    case 'checkpoint': play.respawn = { x: rec.mesh.position.x, y: rec.mesh.position.y + rec.spec.size[1] / 2 + 2, z: rec.mesh.position.z }; ptoast('🚩 Checkpoint!'); play.touchCd.set(key, t + 2); break;
    case 'finish': ptoast('🏁 You finished! 🎉'); play.touchCd.set(key, t + 3); setTimeout(respawnPlayer, 600); break;
    case 'teleport': p.pos.x = b.tx; p.pos.y = b.ty; p.pos.z = b.tz; p.vel = { x: 0, y: 0, z: 0 }; play.touchCd.set(key, t + 0.6); break;
    case 'speed': play.speedMult = b.mult; play.speedUntil = t + b.secs; ptoast('⚡ Speed!'); play.touchCd.set(key, t + 0.5); break;
    case 'message': ptoast(b.text); play.touchCd.set(key, t + 3); break;
    case 'buy': if (!play.paused) openShopPrompt(b, key); break;
  }
}

// Pop a "spend Bits?" prompt. Freezes the world until the player decides.
function openShopPrompt(b, key) {
  play.paused = true; play.keys.clear();
  const price = Math.max(0, Math.round(b.price || 0));
  const item = (b.item || 'this').toString();
  const wrap = document.createElement('div');
  wrap.className = 'shop-modal';
  wrap.innerHTML = `
    <div class="shop-card">
      <div class="shop-ico">🔷</div>
      <div class="shop-head">Spend <b>${price}</b> Bits?</div>
      <div class="shop-sub">for <b>${item.replace(/</g, '&lt;')}</b></div>
      <div class="shop-bal" id="shop-bal">${IN_GAME ? 'Checking your balance…' : '🧪 Editor test — free purchase'}</div>
      <div class="shop-actions">
        <button class="shop-no">No thanks</button>
        <button class="shop-buy">Buy 🔷${price}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); play.paused = false; play.touchCd.set(key, play.now + 1.5); };
  wrap.querySelector('.shop-no').onclick = close;

  // show live balance (real play only)
  if (IN_GAME && window.ClaudeBox?.getWallet) {
    window.ClaudeBox.getWallet().then((w) => {
      const el = wrap.querySelector('#shop-bal');
      if (el && w) el.textContent = `You have ${w.cubes} 🔷`;
    }).catch(() => {});
  }

  const buyBtn = wrap.querySelector('.shop-buy');
  buyBtn.onclick = async () => {
    buyBtn.disabled = true; buyBtn.textContent = 'Buying…';
    let ok = false, reason = '';
    if (!IN_GAME) { ok = true; reason = 'test'; }                    // free in the editor
    else if (!window.ClaudeBox?.getName?.()) { reason = 'nouser'; }
    else { const r = await window.ClaudeBox.spend(price, 'studio-shop:' + item); ok = !!r?.ok; if (!ok) reason = r?.error || 'poor'; }
    wrap.remove(); play.paused = false;
    if (ok) {
      if (b.mult && b.mult !== 1) { play.speedMult = b.mult; play.speedUntil = play.now + (b.secs || 5); }
      ptoast(`✅ Bought ${item}!${reason === 'test' ? ' (test)' : ''}`);
      if (b.msg) setTimeout(() => ptoast(b.msg), 400);
      play.touchCd.set(key, play.now + 3);
    } else {
      ptoast(reason === 'nouser' ? '🔷 Open from ClaudeBox to spend Bits' : '❌ Not enough Bits!');
      play.touchCd.set(key, play.now + 1.5);
    }
  };
}

function stepPlay(dt, t) {
  play.now = t;
  if (play.paused) return; // a shop prompt is open — freeze the world
  // animate continuous behaviors (movers/spinners)
  for (const rec of state.built.values()) {
    for (const b of rec.spec.behaviors) {
      if (b.type === 'spin') rec.mesh.rotation[b.axis] += b.speed * dt;
      else if (b.type === 'move' && rec._base) rec.mesh.position[b.axis] = rec._base.p[b.axis] + Math.sin(t * b.speed) * b.dist;
    }
  }
  const p = play.player;
  const k = play.keys;
  let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  const moving = mx || mz;
  const yaw = orbit.yaw; const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx; const wl = Math.hypot(wx, wz) || 1; wx /= wl; wz /= wl;
  const sp = (k.has('ShiftLeft') ? PLAY.RUN : PLAY.MOVE) * (t < play.speedUntil ? play.speedMult : 1);
  if (moving) { p.vel.x = wx * sp; p.vel.z = wz * sp; p.ry = Math.atan2(wx, wz); } else { p.vel.x = 0; p.vel.z = 0; }

  const prevY = p.pos.y;
  p.vel.y -= PLAY.G * dt;
  p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt; p.pos.y += p.vel.y * dt;
  const sup = supportUnder(p.pos.x, p.pos.z, prevY);
  p.grounded = false;
  if (p.vel.y <= 0 && sup.top > -Infinity && p.pos.y <= sup.top && prevY >= sup.top - 0.6) {
    p.pos.y = sup.top; p.vel.y = 0; p.grounded = true;
    // ride a moving platform: add its translation this frame to the player
    const mv = sup.rec && sup.rec._base && sup.rec.spec.behaviors.find((b) => b.type === 'move');
    if (mv) {
      const delta = (Math.sin(t * mv.speed) - Math.sin((t - dt) * mv.speed)) * mv.dist;
      if (mv.axis === 'x') p.pos.x += delta; else if (mv.axis === 'z') p.pos.z += delta;
    }
  }
  if ((k.has('Space')) && p.grounded) { p.vel.y = PLAY.JUMP; p.grounded = false; }

  // touch triggers (AABB overlap, rotation ignored for triggers)
  for (const rec of state.built.values()) {
    if (!rec.spec.behaviors.length) continue;
    const m = rec.mesh, s = rec.spec.size;
    if (Math.abs(p.pos.x - m.position.x) < s[0] / 2 + PLAY.R &&
        Math.abs(p.pos.z - m.position.z) < s[2] / 2 + PLAY.R &&
        p.pos.y + 1.9 > m.position.y - s[1] / 2 && p.pos.y < m.position.y + s[1] / 2 + 0.6) {
      for (const b of rec.spec.behaviors) if (BEHAVIORS[b.type].touch) fireTouch(rec, b, t);
    }
  }
  if (p.pos.y < -50) { ptoast('💦 Fell!'); respawnPlayer(); }

  // anim + place avatar
  p.anim = !p.grounded ? (p.vel.y > 1 ? 'jump' : 'fall') : (moving ? (k.has('ShiftLeft') ? 'run' : 'walk') : 'idle');
  if (play.avatar) {
    play.avatar.setAnim(p.anim); play.avatar.moveSpeed = Math.hypot(p.vel.x, p.vel.z); play.avatar.update(dt);
    play.avatar.group.position.set(p.pos.x, p.pos.y, p.pos.z); play.avatar.group.rotation.y = p.ry;
  }
  // camera follows
  orbit.target.set(p.pos.x, p.pos.y + 1.5, p.pos.z);
}

// ---------- main loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const t = now / 1000;
  spawnMarker.visible = state.mode === 'edit';
  grid.visible = state.mode === 'edit';
  if (state.mode === 'play') stepPlay(dt, t);
  // first-person zoom: fade MY avatar as the camera closes in (no nametag to hide — the play avatar has none)
  if (state.mode === 'play' && play.avatar) fpFade(play.avatar.group, orbit.dist);
  sun.position.set(orbit.target.x + 60, 120, orbit.target.z + 40); sun.target.position.copy(orbit.target);
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
(async function boot() {
  await loadSlot();
  if (!state.level.parts.length && state.slug === 'playground' && params.get('play')) {
    state.level = starterLevel(); rebuildAll(); frameCameraOnLevel();
  }
  if (params.get('play')) startPlay();
  else if (!localStorage.getItem('studio.seen')) { $('#help').classList.remove('hidden'); localStorage.setItem('studio.seen', '1'); }
  requestAnimationFrame(frame);
  window.__studio = { state, play, startPlay, stopPlay, addMesh, select };
})();
