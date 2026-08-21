// ClaudeBox Animator.
//
// Authoring works on the canonical channels the rigs already share, which is
// what lets one set drive the boy, the girl, R6 and Steven without ever naming
// a bone. A clip is keyframes on those channels; the runtime samples them. That
// design is also why nothing is exported: a set is data, saved to the server
// and picked up by a game on its next load.

import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { POSES } from '/shared/anim/humanoid.js';
import { packFromSet } from '/shared/anim/custom.js';

const $ = (id) => document.getElementById(id);
const api = async (path, body) => {
  const r = await fetch('/api' + path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' }, body: JSON.stringify(body) }
    : { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'request failed');
  return j;
};
let toastT;
const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); };

const me = localStorage.getItem('claudebox.user') || '';
$('who').textContent = me ? `signed in as ${me}` : 'not signed in — saving will fail';

// ---------------------------------------------------------------- state
let META = { channels: [], clips: [], models: [], games: [] };
let sets = [];
let set = null;          // the set being edited
let clipName = 'idle';
let playing = true, time = 0, speed = 1, dirty = false;
let selKey = null;       // { ch, i }
let world = 'flat';

const clip = () => (set.clips[clipName] ||= { duration: 1, loop: true, tracks: {} });
const markDirty = (v = true) => { dirty = v; $('dirty').classList.toggle('hidden', !v); };

function blankSet() {
  return {
    id: `set-${Date.now().toString(36)}`, name: 'New set', model: 'any',
    scope: 'global', published: false,
    camera: { followHead: false, maxOffset: 0.35, applyGlobally: false },
    clips: {},
  };
}

// ---------------------------------------------------------------- 3D
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0d13');
const cam = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
scene.add(new THREE.HemisphereLight('#cfe4ff', '#1a2030', 1.6));
const sun = new THREE.DirectionalLight('#fff4e2', 1.8); sun.position.set(4, 8, 5); scene.add(sun);

// A real place to look at the motion in, not a void. Ground gives the feet
// something to read against; the props give a sense of scale and travel.
const worldGroup = new THREE.Group(); scene.add(worldGroup);
function buildWorld(kind) {
  worldGroup.clear();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w, h, d, c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z); worldGroup.add(m); return m;
  };
  const grid = new THREE.GridHelper(40, 40, 0x2a3444, 0x1b222c);
  grid.position.y = 0.002; worldGroup.add(grid);
  box(40, 0.2, 40, '#141a24', 0, -0.1, 0);
  if (kind === 'flat') return;
  if (kind === 'steps') {
    for (let i = 0; i < 6; i++) box(3, 0.4, 1.4, '#1e2836', 0, 0.2 + i * 0.4, -1.5 - i * 1.4);
  }
  if (kind === 'course') {
    box(3, 0.4, 6, '#1e2836', 0, 0.2, -5);
    box(0.6, 4, 3, '#243040', 3.2, 2, 0);
    for (let i = 0; i < 4; i++) box(1.6, 0.4, 1.6, '#1e2836', -3.4, 0.2 + i * 0.5, -1.6 - i * 2.1);
  }
}
buildWorld(world);

let ctrl = null;
async function buildAvatar() {
  await preloadAvatars(['boy', 'girl', 'r6']);
  if (ctrl) { scene.remove(ctrl.group); ctrl.dispose?.(); }
  const body = set.model === 'any' ? 'boy' : set.model;
  ctrl = makeAvatar({ body, shirtColor: '#2f7fd0', pantsColor: '#2a3140', shoes: 'sneakers', hair: 'short' });
  ctrl.moveSpeed = 8;
  scene.add(ctrl.group);
  applyPreview();
}

// The set under edit is compiled and handed to the avatar exactly as a game
// would receive it, so the preview is the real runtime rather than a mock.
function applyPreview() {
  if (!ctrl) return;
  ctrl.setCustomPack?.(packFromSet(set));
  ctrl.setAnim(clipName);
}

// camera: orbit, plus the head-follow rule the set may declare
const orbit = { yaw: 0.5, pitch: 0.22, dist: 4.6, drag: null };
$('view').addEventListener('pointerdown', (e) => { orbit.drag = { x: e.clientX, y: e.clientY, yaw: orbit.yaw, pitch: orbit.pitch }; });
addEventListener('pointerup', () => { orbit.drag = null; });
addEventListener('pointermove', (e) => {
  if (!orbit.drag) return;
  orbit.yaw = orbit.drag.yaw - (e.clientX - orbit.drag.x) * 0.006;
  orbit.pitch = Math.max(-0.4, Math.min(1.2, orbit.drag.pitch + (e.clientY - orbit.drag.y) * 0.005));
});
$('view').addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.max(1.2, Math.min(14, orbit.dist + e.deltaY * 0.004)); }, { passive: false });

const headPos = new THREE.Vector3();
function headWorld() {
  if (!ctrl) return headPos.set(0, 1.4, 0);
  const b = ctrl.bones || {};
  const h = b.mixamorigHead || b.Head_01 || b.Neck || b.head;
  if (h?.getWorldPosition) h.getWorldPosition(headPos);
  else headPos.set(0, 1.4, 0);
  return headPos;
}

let viewW = 0, viewH = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const c = clip();
  if (playing) {
    time += dt * speed;
    if (c.loop) time %= c.duration; else time = Math.min(time, c.duration);
  }
  if (ctrl) {
    // drive the avatar from the timeline rather than its own clock, so the
    // viewport and the playhead can never disagree
    ctrl.anim?.setSpeed?.(8);
    ctrl.update(0);
    if (ctrl.anim) { ctrl.anim.setAnim(clipName); }
    stepTo(time);
  }
  // Watch both dimensions. Watching width alone means that if the first frame
  // lands before layout settles the canvas sizes to zero height and, because
  // the width then matches, never resizes again.
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  if (w > 0 && h > 0 && (w !== viewW || h !== viewH)) {
    viewW = w; viewH = h;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  // Head-follow: the orbit target is the head itself, and the camera is not
  // allowed to sit further from it than the rule permits. Zoom still works —
  // the clamp is on the offset the ANIMATION introduces, not on your distance.
  const head = headWorld();
  const target = set.camera.followHead
    ? head.clone()
    : new THREE.Vector3(0, 1.05, 0);
  if (set.camera.followHead) {
    const rest = new THREE.Vector3(0, head.y, 0);
    const off = target.clone().sub(rest);
    if (off.length() > set.camera.maxOffset) off.setLength(set.camera.maxOffset);
    target.copy(rest).add(off);
  }
  const cp = Math.cos(orbit.pitch);
  cam.position.set(
    target.x + Math.sin(orbit.yaw) * cp * orbit.dist,
    target.y + Math.sin(orbit.pitch) * orbit.dist,
    target.z + Math.cos(orbit.yaw) * cp * orbit.dist);
  cam.lookAt(target);
  renderer.render(scene, cam);

  $('frame-label').textContent = `${time.toFixed(2)}s`;
  const tr = trackRect();
  $('playhead').style.left = `${tr.left + (time / c.duration) * tr.width}px`;
}

// Push the avatar to an exact time by driving its animator's phase directly.
function stepTo(t) {
  if (!ctrl?.anim) return;
  const a = ctrl.anim;
  if (a.setPhase) a.setPhase(t);
}

// ---------------------------------------------------------------- UI: left
function paintSets() {
  const host = $('set-list'); host.innerHTML = '';
  if (!sets.length) host.innerHTML = '<p class="hint">No sets yet — make one.</p>';
  for (const s of sets) {
    const el = document.createElement('div');
    el.className = 'set-item' + (s.id === set.id ? ' on' : '');
    el.innerHTML = `<span>${s.name}</span>
      <span class="tag ${s.published ? 'pub' : ''}">${s.published ? 'live' : 'draft'}</span>
      <button class="del" title="Delete">✕</button>`;
    el.addEventListener('click', (e) => { if (e.target.classList.contains('del')) return; loadSet(s); });
    el.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${s.name}"?`)) return;
      await api('/anim/delete', { name: me, id: s.id });
      sets = sets.filter((x) => x.id !== s.id);
      if (set.id === s.id) { set = sets[0] ? structuredClone(sets[0]) : blankSet(); syncAll(); }
      paintSets(); toast('Deleted');
    });
    host.appendChild(el);
  }
}
function paintModels() {
  const host = $('model-row'); host.innerHTML = '';
  for (const m of META.models) {
    const b = document.createElement('button');
    b.textContent = m === 'any' ? 'Any' : m === 'r6' ? 'R6' : m[0].toUpperCase() + m.slice(1);
    b.className = set.model === m ? 'on' : '';
    b.addEventListener('click', () => { set.model = m; markDirty(); paintModels(); buildAvatar(); });
    host.appendChild(b);
  }
}
function paintScope() {
  const global = set.scope === 'global';
  $('scope-global').checked = global;
  const host = $('scope-games'); host.innerHTML = '';
  host.classList.toggle('hidden', global);
  for (const g of META.games) {
    const l = document.createElement('label'); l.className = 'check';
    const on = Array.isArray(set.scope) && set.scope.includes(g.id);
    l.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}> <span>${g.name}</span>`;
    l.querySelector('input').addEventListener('change', (e) => {
      if (!Array.isArray(set.scope)) set.scope = [];
      set.scope = e.target.checked ? [...set.scope, g.id] : set.scope.filter((x) => x !== g.id);
      markDirty();
    });
    host.appendChild(l);
  }
}
$('scope-global').addEventListener('change', (e) => { set.scope = e.target.checked ? 'global' : []; markDirty(); paintScope(); });
$('cam-follow').addEventListener('change', (e) => { set.camera.followHead = e.target.checked; markDirty(); });
$('cam-global').addEventListener('change', (e) => { set.camera.applyGlobally = e.target.checked; markDirty(); });
$('cam-max').addEventListener('input', (e) => { set.camera.maxOffset = +e.target.value; $('cam-max-val').textContent = (+e.target.value).toFixed(2); markDirty(); });

// ---------------------------------------------------------------- UI: channels
const CH_LABEL = {
  armLS: 'L arm swing', armRS: 'R arm swing', armLL: 'L arm lift', armRL: 'R arm lift',
  foreL: 'L forearm', foreR: 'R forearm', legLS: 'L leg swing', legRS: 'R leg swing',
  shinL: 'L knee', shinR: 'R knee', footL: 'L ankle', footR: 'R ankle',
  spine: 'Spine', head: 'Head', bob: 'Body bob', rootPitch: 'Body pitch',
};
function paintChannels() {
  const host = $('channels'); host.innerHTML = '';
  const c = clip();
  for (const ch of META.channels) {
    const has = !!c.tracks[ch]?.length;
    const el = document.createElement('div');
    el.className = 'ch' + (has ? ' active' : '');
    const v = valueAt(ch, time);
    el.innerHTML = `<div class="ch-top"><b>${CH_LABEL[ch] || ch}</b><span>${v.toFixed(2)}</span></div>
      <input type="range" min="-3.2" max="3.2" step="0.01" value="${v}">
      <div class="n">${ch}${has ? ` · ${c.tracks[ch].length} keys` : ''}</div>`;
    const inp = el.querySelector('input');
    inp.addEventListener('input', () => {
      setKey(ch, time, +inp.value);
      el.querySelector('span').textContent = (+inp.value).toFixed(2);
    });
    host.appendChild(el);
  }
}

// ---------------------------------------------------------------- keyframes
// Measure the real lane track rather than recomputing it from CSS numbers —
// the two drift apart the moment the stylesheet changes.
function trackRect() {
  const t = document.querySelector('.lane-track');
  const body = $('tl-body');
  if (!t || !body) return { left: 96, width: 600 };
  const r = t.getBoundingClientRect(), b = body.getBoundingClientRect();
  return { left: r.left - b.left, width: Math.max(40, r.width) };
}
function valueAt(ch, t) {
  const c = clip();
  const keys = c.tracks[ch];
  if (keys?.length) {
    const p = (t % c.duration) / c.duration;
    return sample(keys, p);
  }
  // nothing authored: show what the built-in pose is doing, so a slider starts
  // from the real value rather than zero
  const probe = {}; for (const k of META.channels) probe[k] = 0;
  (POSES[clipName] || POSES.idle)(probe, t);
  return probe[ch] || 0;
}
function sample(keys, p) {
  if (!keys.length) return 0;
  if (keys.length === 1 || p <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (p >= last.t) return last.v;
  let i = 0; while (i < keys.length - 1 && keys[i + 1].t <= p) i++;
  const a = keys[i], b = keys[i + 1], span = b.t - a.t;
  if (span <= 0) return b.v;
  const raw = (p - a.t) / span;
  if (a.e === 'step') return a.v;
  const k = a.e === 'linear' ? raw : raw * raw * (3 - 2 * raw);
  return a.v + (b.v - a.v) * k;
}
function setKey(ch, t, v) {
  const c = clip();
  const p = +(((t % c.duration) / c.duration).toFixed(4));
  const keys = (c.tracks[ch] ||= []);
  const at = keys.find((k) => Math.abs(k.t - p) < 0.004);
  if (at) at.v = v; else keys.push({ t: p, v, e: 'smooth' });
  keys.sort((a, b) => a.t - b.t);
  markDirty(); applyPreview(); paintTimeline();
}
function paintTimeline() {
  const host = $('tl-lanes'); host.innerHTML = '';
  const c = clip();
  let total = 0;
  for (const ch of META.channels) {
    const keys = c.tracks[ch] || [];
    total += keys.length;
    const lane = document.createElement('div');
    lane.className = 'lane' + (keys.length ? ' has' : '');
    lane.innerHTML = `<div class="lane-name">${CH_LABEL[ch] || ch}</div><div class="lane-track"></div>`;
    const track = lane.querySelector('.lane-track');
    track.addEventListener('click', (e) => {
      if (e.target.classList.contains('kf')) return;
      const r = track.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      setKey(ch, p * c.duration, valueAt(ch, p * c.duration));
    });
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const d = document.createElement('div');
      d.className = `kf ${k.e}` + (selKey && selKey.ch === ch && selKey.i === i ? ' sel' : '');
      d.style.left = `${k.t * 100}%`;
      d.title = `${k.v.toFixed(2)} @ ${(k.t * c.duration).toFixed(2)}s (${k.e})`;
      d.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); selKey = { ch, i };
        const r = track.getBoundingClientRect();
        const move = (ev) => {
          k.t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
          d.style.left = `${k.t * 100}%`;
          markDirty();
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          keys.sort((a, b) => a.t - b.t); applyPreview(); paintTimeline();
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
      d.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        keys.splice(i, 1);
        if (!keys.length) delete c.tracks[ch];
        markDirty(); applyPreview(); paintTimeline(); paintChannels();
      });
      d.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        k.e = k.e === 'smooth' ? 'linear' : k.e === 'linear' ? 'step' : 'smooth';
        markDirty(); applyPreview(); paintTimeline(); toast(`Easing: ${k.e}`);
      });
      track.appendChild(d);
    }
    host.appendChild(lane);
  }
  $('keycount').textContent = `${total} keys in ${clipName}`;
}

// ---------------------------------------------------------------- transport
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; });
$('stop').addEventListener('click', () => { playing = false; time = 0; $('play').textContent = '▶'; });
$('speed').addEventListener('input', (e) => { speed = +e.target.value; });
$('loop').addEventListener('change', (e) => { clip().loop = e.target.checked; markDirty(); });
$('dur').addEventListener('change', (e) => { clip().duration = Math.max(0.05, +e.target.value || 1); markDirty(); applyPreview(); paintTimeline(); });
$('clip').addEventListener('change', (e) => { clipName = e.target.value; syncClip(); });

// Seeding from the built-in pose is what makes this usable: you start from the
// real animation and adjust, instead of from an empty T-pose.
$('seed').addEventListener('click', () => {
  const c = clip();
  const N = 12;
  for (const ch of META.channels) c.tracks[ch] = [];
  for (let i = 0; i < N; i++) {
    const p = i / N;
    const probe = {}; for (const k of META.channels) probe[k] = 0;
    (POSES[clipName] || POSES.idle)(probe, p * c.duration);
    for (const ch of META.channels) {
      if (Math.abs(probe[ch]) < 0.002) continue;
      c.tracks[ch].push({ t: +p.toFixed(4), v: +probe[ch].toFixed(4), e: 'smooth' });
    }
  }
  for (const ch of Object.keys(c.tracks)) if (!c.tracks[ch].length) delete c.tracks[ch];
  markDirty(); applyPreview(); paintTimeline(); paintChannels();
  toast(`Seeded ${clipName} from the built-in pose`);
});
$('mirror').addEventListener('click', () => {
  const c = clip(), t = c.tracks;
  const swap = [['armLS', 'armRS'], ['armLL', 'armRL'], ['foreL', 'foreR'], ['legLS', 'legRS'], ['shinL', 'shinR'], ['footL', 'footR']];
  for (const [a, b] of swap) { const tmp = t[a]; if (t[b]) t[a] = t[b]; else delete t[a]; if (tmp) t[b] = tmp; else delete t[b]; }
  markDirty(); applyPreview(); paintTimeline(); paintChannels(); toast('Mirrored left and right');
});
$('clear-clip').addEventListener('click', () => {
  if (!confirm(`Clear all keys in "${clipName}"?`)) return;
  set.clips[clipName] = { duration: clip().duration, loop: clip().loop, tracks: {} };
  markDirty(); applyPreview(); paintTimeline(); paintChannels();
});
for (const [id, kind] of [['flat', 'flat'], ['steps', 'steps'], ['course', 'course']]) {
  const b = document.createElement('button');
  b.textContent = kind[0].toUpperCase() + kind.slice(1);
  b.className = world === kind ? 'on' : '';
  b.addEventListener('click', () => {
    world = kind; buildWorld(kind);
    [...$('world-pick').children].forEach((x) => x.classList.toggle('on', x === b));
  });
  $('world-pick').appendChild(b);
}

// ---------------------------------------------------------------- save
$('set-name').addEventListener('input', (e) => { set.name = e.target.value; markDirty(); });
async function persist(publish) {
  if (!me) { toast('Sign in on ClaudeBox first'); return; }
  try {
    set.published = publish ? true : set.published;
    const j = await api('/anim/save', { name: me, set });
    set = j.set;
    const i = sets.findIndex((s) => s.id === set.id);
    if (i >= 0) sets[i] = j.set; else sets.push(j.set);
    markDirty(false); paintSets();
    toast(publish ? 'Published — games will pick it up on next load' : 'Saved');
  } catch (e) { toast(e.message); }
}
$('save').addEventListener('click', () => persist(false));
$('publish').addEventListener('click', () => persist(true));

// ---------------------------------------------------------------- wiring
function syncClip() {
  const c = clip();
  $('clip-label').textContent = clipName;
  $('dur').value = c.duration;
  $('loop').checked = c.loop !== false;
  time = 0;
  applyPreview(); paintTimeline(); paintChannels();
}
function syncAll() {
  $('set-name').value = set.name;
  $('cam-follow').checked = !!set.camera.followHead;
  $('cam-global').checked = !!set.camera.applyGlobally;
  $('cam-max').value = set.camera.maxOffset;
  $('cam-max-val').textContent = Number(set.camera.maxOffset).toFixed(2);
  paintModels(); paintScope(); paintSets(); syncClip(); buildAvatar();
}
function loadSet(s) { set = structuredClone(s); markDirty(false); syncAll(); }
$('new-set').addEventListener('click', () => { set = blankSet(); markDirty(true); syncAll(); });

(async () => {
  META = await api('/anim/meta');
  $('clip').innerHTML = META.clips.map((c) => `<option>${c}</option>`).join('');
  try { sets = (await api('/anim/sets')).sets || []; } catch { sets = []; }
  set = sets.length ? structuredClone(sets[0]) : blankSet();
  syncAll();
  setInterval(() => paintChannels(), 260);   // keep the readouts live during playback
  requestAnimationFrame(frame);
})();
