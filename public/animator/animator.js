// ClaudeBox Animator.
//
// Authoring works on the canonical channels the rigs already share, which is
// what lets one set drive the boy, the girl, R6 and Steven without ever naming
// a bone. A clip is keyframes on those channels; the runtime samples them. That
// design is also why nothing is exported: a set is data, saved to the server
// and picked up by a game on its next load.
//
// You pose by grabbing the model. Clicking a body part selects its joint, the
// gizmo shows only the axes that joint can actually move, and dragging writes a
// keyframe at the playhead.

import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { POSES, RIGS } from '/shared/anim/humanoid.js';
import { packFromSet } from '/shared/anim/custom.js';
import { makeGizmo, jointsFor, AXIS_COLOR } from '/animator/gizmo.js';

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
let set = null;
let clipName = 'idle';
let playing = false, time = 0, speed = 1, dirty = false;
let selKey = null;          // { ch, i } — the keyframe under the cursor
let selJoint = null;        // canonical joint name, e.g. 'armL'
let mode = 'rotate';        // 'rotate' | 'move'
let world = 'flat';
let joints = {};            // rig-specific joint table

// ---- undo / redo ----
// Snapshots of the whole set. A set is plain JSON and small, so cloning it is
// cheaper and far less error-prone than trying to invert every edit.
//
// The one thing that needs care is continuous edits: a gizmo drag calls setKey
// on every mouse move, and one undo step per frame would be useless. Drags
// therefore open a change once and close it on release; everything discrete
// pushes its own step.
const undoStack = [], redoStack = [];
let changeOpen = false;
const HISTORY_MAX = 80;

const snapshot = (label) => ({ label, clipName, state: structuredClone(set) });

function pushUndo(label) {
  undoStack.push(snapshot(label));
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  redoStack.length = 0;
  paintHistory();
}
/** Begin a continuous edit — one undo step for the whole drag. */
function openChange(label) { if (!changeOpen) { pushUndo(label); changeOpen = true; } }
function closeChange() { changeOpen = false; }

function restore(entry) {
  const modelChanged = entry.state.model !== set.model;
  set = entry.state;
  clipName = entry.clipName;
  selKey = null;
  $('clip').value = clipName;
  $('set-name').value = set.name;
  $('cam-follow').checked = !!set.camera.followHead;
  $('cam-global').checked = !!set.camera.applyGlobally;
  $('cam-max').value = set.camera.maxOffset;
  $('cam-max-val').textContent = Number(set.camera.maxOffset).toFixed(2);
  const c = clip();
  $('dur').value = c.duration;
  $('loop').checked = c.loop !== false;
  $('clip-label').textContent = clipName;
  paintModels(); paintScope();
  markDirty();
  if (modelChanged) buildAvatar();
  else { applyPreview(); refreshGizmo(); }
  paintTimeline(); paintChannels(); paintRuler(); paintHistory();
}

function undo() {
  if (!undoStack.length) { toast('Nothing to undo'); return; }
  const entry = undoStack.pop();
  redoStack.push(snapshot(entry.label));
  restore(entry);
  toast(`Undid ${entry.label}`);
}
function redo() {
  if (!redoStack.length) { toast('Nothing to redo'); return; }
  const entry = redoStack.pop();
  undoStack.push(snapshot(entry.label));
  restore(entry);
  toast(`Redid ${entry.label}`);
}
function paintHistory() {
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
  $('undo').title = undoStack.length ? `Undo ${undoStack[undoStack.length - 1].label} (${modKey()}Z)` : 'Nothing to undo';
  $('redo').title = redoStack.length ? `Redo ${redoStack[redoStack.length - 1].label} (${modKey()}⇧Z)` : 'Nothing to redo';
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const modKey = () => (isMac ? '\u2318' : 'Ctrl+');

const clip = () => (set.clips[clipName] ||= { duration: 1, loop: true, tracks: {} });
const markDirty = (v = true) => { dirty = v; $('dirty').classList.toggle('hidden', !v); };
const rigName = () => (set.model === 'any' ? 'boy' : set.model);

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
  if (kind === 'steps') for (let i = 0; i < 6; i++) box(3, 0.4, 1.4, '#1e2836', 0, 0.2 + i * 0.4, -1.5 - i * 1.4);
  if (kind === 'course') {
    box(3, 0.4, 6, '#1e2836', 0, 0.2, -5);
    box(0.6, 4, 3, '#243040', 3.2, 2, 0);
    for (let i = 0; i < 4; i++) box(1.6, 0.4, 1.6, '#1e2836', -3.4, 0.2 + i * 0.5, -1.6 - i * 2.1);
  }
}
buildWorld(world);

// gizmo + pick proxies
const giz = makeGizmo(THREE);
scene.add(giz.group);
giz.group.visible = false;
const proxyGroup = new THREE.Group(); scene.add(proxyGroup);
let proxies = [];

let ctrl = null;
async function buildAvatar() {
  await preloadAvatars(['boy', 'girl', 'r6']);
  if (ctrl) { scene.remove(ctrl.group); ctrl.dispose?.(); }
  ctrl = makeAvatar({ body: rigName(), shirtColor: '#2f7fd0', pantsColor: '#2a3140', shoes: 'sneakers', hair: 'short' });
  ctrl.moveSpeed = 8;
  scene.add(ctrl.group);
  joints = jointsFor(rigName());
  buildProxies();
  if (selJoint && !joints[selJoint]) selJoint = null;
  applyPreview();
  refreshGizmo();
}

// Invisible pick targets. These cover the whole visible limb, not the pivot:
// a joint's pivot sits inside the body, so proxies at pivots meant that clicking
// the arm you can see selected nothing. Each joint gets a capsule spanning the
// bone to its child (the limb), plus a ball at the pivot itself.
//
// Raycasting the skinned mesh and working back to a bone would be the obvious
// alternative, but it behaves differently across the four rigs — and Steven is
// not skinned at all — so explicit proxies are the portable answer.
function buildProxies() {
  for (const p of proxies) { p.geometry.dispose(); p.material.dispose(); }
  proxies = []; proxyGroup.clear();
  const scale = modelScale();
  const hidden = () => new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0, depthTest: false });

  for (const [canon, j] of Object.entries(joints)) {
    const o = jointObject(canon);
    if (!o) continue;
    const isRoot = canon === 'root';
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), hidden());
    ball.userData = { joint: canon, kind: 'ball', r: scale * (isRoot ? 0.10 : canon === 'spine' ? 0.13 : 0.062) };
    ball.renderOrder = 998;
    proxyGroup.add(ball); proxies.push(ball);
    if (isRoot) continue;

    // the limb this joint drives: bone -> first child bone
    const child = o.children?.find((ch) => ch.isBone) || null;
    // Steven's parts are plain meshes under a group, so measure those instead
    const ownMesh = !child && o.children?.some((ch) => ch.isMesh);
    if (child) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), hidden());
      cap.userData = { joint: canon, kind: 'seg', child, r: scale * 0.055 };
      cap.renderOrder = 998;
      proxyGroup.add(cap); proxies.push(cap);
    } else if (ownMesh) {
      const box = new THREE.Box3();
      for (const ch of o.children) if (ch.isMesh) box.expandByObject(ch);
      const size = new THREE.Vector3(), centre = new THREE.Vector3();
      box.getSize(size); box.getCenter(centre);
      if (size.lengthSq() > 1e-6) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), hidden());
        m.userData = { joint: canon, kind: 'box', offset: o.worldToLocal(centre.clone()) };
        m.renderOrder = 998;
        proxyGroup.add(m); proxies.push(m);
      }
    }
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const modelScale = () => {
  const b = new THREE.Box3().setFromObject(ctrl.group);
  const h = b.max.y - b.min.y;
  return isFinite(h) && h > 0.2 ? h : 1.8;
};

function jointObject(canon) {
  if (!ctrl) return null;
  if (canon === 'root') return ctrl.group;
  const name = joints[canon]?.bone;
  return name ? ctrl.bones?.[name] || null : null;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
function syncProxies() {
  if (!ctrl) return;
  for (const m of proxies) {
    const d = m.userData;
    const o = jointObject(d.joint);
    if (!o) { m.visible = false; continue; }
    m.visible = true;
    o.getWorldPosition(_p);
    if (d.kind === 'ball') {
      if (d.joint === 'root') _p.y += modelScale() * 0.5;
      m.position.copy(_p);
      m.scale.setScalar(d.r);
    } else if (d.kind === 'seg') {
      d.child.getWorldPosition(_b);
      _a.copy(_p);
      _dir.copy(_b).sub(_a);
      const len = _dir.length();
      if (len < 1e-4) { m.visible = false; continue; }
      m.position.copy(_a).addScaledVector(_dir, 0.5);
      m.quaternion.setFromUnitVectors(UP, _dir.normalize());
      m.scale.set(d.r, len, d.r);
    } else {
      m.position.copy(o.localToWorld(d.offset.clone()));
      o.getWorldQuaternion(_q); m.quaternion.copy(_q);
      m.scale.setScalar(1);
    }
    const lit = showProxies ? 0.30 : d.joint === selJoint ? 0.20 : (hoverJoint === d.joint ? 0.12 : 0);
    m.material.opacity = lit;
  }
}

function refreshGizmo() {
  const j = selJoint && joints[selJoint];
  if (!j || !ctrl) { giz.group.visible = false; $('sel-label').textContent = 'nothing selected'; return; }
  const usable = mode === 'move' ? (j.move || []) : j.rot;
  giz.build(usable.length ? j : null, mode, modelScale() * 0.17);
  giz.group.visible = usable.length > 0;
  $('sel-label').innerHTML = usable.length
    ? `<b>${j.label}</b> · ${usable.map((r) => `<i style="color:#${AXIS_COLOR[r.axis].toString(16).padStart(6, '0')}">${r.channel}</i>`).join(' ')}`
    : `<b>${j.label}</b> · nothing to ${mode} here`;
}

function syncGizmo() {
  if (!giz.group.visible || !selJoint) return;
  const o = jointObject(selJoint);
  if (!o) return;
  o.getWorldPosition(_p);
  if (selJoint === 'root') _p.y += modelScale() * 0.5;
  giz.group.position.copy(_p);
  // rings must sit in the joint's LOCAL frame, since that is the frame the
  // channels rotate in; the move gizmo works in the model's frame instead
  o.getWorldQuaternion(_q);
  giz.group.quaternion.copy(mode === 'move' ? ctrl.group.quaternion : _q);
  // keep a constant on-screen size
  const d = cam.position.distanceTo(_p);
  giz.group.scale.setScalar(Math.max(0.35, d * 0.34));
}

function applyPreview() {
  if (!ctrl) return;
  ctrl.setCustomPack?.(packFromSet(set));
  ctrl.setAnim(clipName);
}

// ---------------------------------------------------------------- camera
const orbit = { yaw: 0.5, pitch: 0.22, dist: 4.6, drag: null };
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hoverJoint = null;
let showProxies = false;   // debug: reveal the pick volumes
let drag = null;   // active gizmo drag

function pointerNDC(e) {
  const r = $('view').getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  return ray;
}

$('view').addEventListener('pointerdown', (e) => {
  const r = pointerNDC(e);
  // gizmo first — it sits on top of everything and must win the click
  const gh = giz.group.visible ? r.intersectObjects(giz.handles, false)[0] : null;
  if (gh) { startDrag(gh.object.userData, e); return; }
  const ph = r.intersectObjects(proxies.filter((p) => p.visible), false)[0];
  if (ph) {
    selJoint = ph.object.userData.joint;
    refreshGizmo();
    return;
  }
  // nothing hit: deselect, and fall through to orbiting
  if (!e.shiftKey) { selJoint = null; refreshGizmo(); }
  orbit.drag = { x: e.clientX, y: e.clientY, yaw: orbit.yaw, pitch: orbit.pitch };
});
$('view').addEventListener('pointermove', (e) => {
  if (drag || orbit.drag) return;
  const hit = pointerNDC(e).intersectObjects(proxies.filter((p) => p.visible), false)[0];
  const j = hit ? hit.object.userData.joint : null;
  if (j !== hoverJoint) { hoverJoint = j; $('view').style.cursor = j ? 'pointer' : 'default'; }
});
addEventListener('pointerup', () => { orbit.drag = null; endDrag(); closeChange(); });
addEventListener('pointermove', (e) => {
  if (drag) { moveDrag(e); return; }
  if (!orbit.drag) return;
  orbit.yaw = orbit.drag.yaw - (e.clientX - orbit.drag.x) * 0.006;
  orbit.pitch = Math.max(-0.4, Math.min(1.2, orbit.drag.pitch + (e.clientY - orbit.drag.y) * 0.005));
});
$('view').addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.max(1.2, Math.min(14, orbit.dist + e.deltaY * 0.004)); }, { passive: false });
$('view').addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- dragging
const plane = new THREE.Plane();
const hitPt = new THREE.Vector3();
const axisWorld = new THREE.Vector3();
const basisU = new THREE.Vector3(), basisV = new THREE.Vector3(), rel = new THREE.Vector3();

function axisVec(axis) {
  return new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
}

function startDrag(data, e) {
  if (playing) { playing = false; $('play').textContent = '▶'; }
  openChange(mode === 'move' ? 'move' : 'rotate');
  const o = jointObject(selJoint);
  if (!o) return;
  const centre = giz.group.position.clone();
  if (data.kind === 'rotate') {
    o.getWorldQuaternion(_q);
    axisWorld.copy(axisVec(data.axis)).applyQuaternion(_q).normalize();
    plane.setFromNormalAndCoplanarPoint(axisWorld, centre);
    if (!pointerNDC(e).ray.intersectPlane(plane, hitPt)) return;
    // a stable basis in the drag plane, so the swept angle is unambiguous
    basisU.copy(hitPt).sub(centre).normalize();
    basisV.copy(axisWorld).cross(basisU).normalize();
    drag = { ...data, centre, start: valueAt(data.channel, time), angle0: 0 };
  } else {
    axisWorld.copy(axisVec(data.axis)).applyQuaternion(ctrl.group.quaternion).normalize();
    const t = closestOnAxis(pointerNDC(e).ray, centre, axisWorld);
    if (t === null) return;
    drag = { ...data, centre, start: valueAt(data.channel, time), t0: t };
  }
  $('view').setPointerCapture?.(e.pointerId);
}

// Closest point along an infinite axis to the pointer ray, as a scalar.
function closestOnAxis(r, centre, dir) {
  const w0 = new THREE.Vector3().subVectors(centre, r.origin);
  const a = dir.dot(dir), b = dir.dot(r.direction), c = r.direction.dot(r.direction);
  const d = dir.dot(w0), eD = r.direction.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-8) return null;
  return (b * eD - c * d) / den;
}

function moveDrag(e) {
  if (!drag) return;
  const r = pointerNDC(e).ray;
  if (drag.kind === 'rotate') {
    if (!r.intersectPlane(plane, hitPt)) return;
    rel.copy(hitPt).sub(drag.centre);
    const ang = Math.atan2(rel.dot(basisV), rel.dot(basisU));
    // the bone is rotated by (channel * sign), so undo the sign to keep the
    // model following the pointer rather than mirroring it
    setKey(drag.channel, time, drag.start + ang * (drag.sign || 1));
  } else {
    const t = closestOnAxis(r, drag.centre, axisWorld);
    if (t === null) return;
    setKey(drag.channel, time, drag.start + (t - drag.t0));
  }
}
function endDrag() { closeChange(); if (drag) { drag = null; paintChannels(); } }

// ---------------------------------------------------------------- frame
const headPos = new THREE.Vector3();
function headWorld() {
  if (!ctrl) return headPos.set(0, 1.4, 0);
  const b = ctrl.bones || {};
  const h = b.mixamorigHead || b.Head_01 || b.Neck || b.head;
  if (h?.getWorldPosition) h.getWorldPosition(headPos); else headPos.set(0, 1.4, 0);
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
    ctrl.anim?.setAnim?.(clipName);
    ctrl.anim?.setSpeed?.(8);
    ctrl.anim?.setPhase?.(time);   // exact-time scrub, set before the pose is evaluated
    ctrl.update(0);
    ctrl.group.updateMatrixWorld(true);
    syncProxies();
    syncGizmo();
  }
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  if (w > 0 && h > 0 && (w !== viewW || h !== viewH)) {
    viewW = w; viewH = h;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  const head = headWorld();
  const target = set.camera.followHead ? head.clone() : new THREE.Vector3(0, 1.05, 0);
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

// ---------------------------------------------------------------- channels
const CH_LABEL = {
  armLS: 'L arm swing', armRS: 'R arm swing', armLL: 'L arm lift', armRL: 'R arm lift',
  foreL: 'L forearm', foreR: 'R forearm', legLS: 'L leg swing', legRS: 'R leg swing',
  shinL: 'L knee', shinR: 'R knee', footL: 'L ankle', footR: 'R ankle',
  spine: 'Spine', head: 'Head', bob: 'Body up/down', rootPitch: 'Body pitch',
  rootX: 'Body sideways', rootZ: 'Body forward',
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
      <div class="n">${ch}${has ? ` · ${c.tracks[ch].length} keys` : ''}
        ${has ? '<button class="ch-clear" title="Delete this channel’s keys">clear</button>' : ''}</div>`;
    const inp = el.querySelector('input');
    inp.addEventListener('pointerdown', () => openChange('slider'));
    inp.addEventListener('keydown', () => openChange('slider'));
    inp.addEventListener('change', closeChange);
    inp.addEventListener('input', () => {
      setKey(ch, time, +inp.value);
      el.querySelector('span').textContent = (+inp.value).toFixed(2);
    });
    el.querySelector('.ch-clear')?.addEventListener('click', () => clearChannel(ch));
    host.appendChild(el);
  }
}

// ---------------------------------------------------------------- keyframes
function trackRect() {
  // the ruler is the reference: it is always present, and unlike the lanes it
  // does not scroll, so the playhead cannot drift away from the keys
  const t = document.querySelector('.ruler-track');
  const area = $('tl-area');
  if (!t || !area) return { left: 96, width: 600 };
  const r = t.getBoundingClientRect(), b = area.getBoundingClientRect();
  return { left: r.left - b.left, width: Math.max(40, r.width), pageLeft: r.left };
}

// ---- scrubbing ----
// Drag the ruler or the playhead handle to move through the clip. Playback
// stops on grab, because scrubbing against a running clock fights you.
let scrubbing = false, wasPlaying = false;
function timeFromX(clientX) {
  const tr = trackRect();
  const p = Math.max(0, Math.min(1, (clientX - tr.pageLeft) / tr.width));
  return p * clip().duration;
}
function startScrub(e) {
  scrubbing = true;
  wasPlaying = playing;
  if (playing) { playing = false; $('play').textContent = '▶'; }
  document.body.classList.add('scrubbing');
  time = timeFromX(e.clientX);
  e.preventDefault();
}
function moveScrub(e) { if (scrubbing) time = timeFromX(e.clientX); }
function endScrub() {
  if (!scrubbing) return;
  scrubbing = false;
  document.body.classList.remove('scrubbing');
  paintChannels();
}
$('tl-ruler').addEventListener('pointerdown', startScrub);
document.querySelector('.ph-grab').addEventListener('pointerdown', (e) => { e.stopPropagation(); startScrub(e); });
addEventListener('pointermove', moveScrub);
addEventListener('pointerup', endScrub);

// Ruler ticks, spaced so the labels stay readable whatever the clip length.
function paintRuler() {
  const host = document.querySelector('.ruler-track');
  if (!host) return;
  const dur = clip().duration;
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5];
  const want = dur / 10;
  const step = steps.find((x) => x >= want) || 10;
  let html = '';
  // Count in whole steps. Accumulating `t += step` drifts (0.1 + 0.1 + 0.1 is
  // not 0.3), which silently dropped most of the labels.
  const n = Math.floor(dur / step + 1e-6);
  for (let i = 0; i <= n; i++) {
    const t = i * step;
    const pc = (t / dur) * 100;
    const major = i % 2 === 0;
    html += `<div class="tick${major ? ' major' : ''}" style="left:${pc}%"></div>`;
    if (major) html += `<div class="tlabel" style="left:${pc}%">${+t.toFixed(2)}s</div>`;
  }
  host.innerHTML = html;
}
function valueAt(ch, t) {
  const c = clip();
  const keys = c.tracks[ch];
  if (keys?.length) return sample(keys, (t % c.duration) / c.duration);
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
  if (!changeOpen) pushUndo('key change');
  const c = clip();
  const p = +(((t % c.duration) / c.duration).toFixed(4));
  const keys = (c.tracks[ch] ||= []);
  const at = keys.find((k) => Math.abs(k.t - p) < 0.004);
  if (at) at.v = v; else keys.push({ t: p, v, e: 'smooth' });
  keys.sort((a, b) => a.t - b.t);
  markDirty(); applyPreview(); paintTimeline();
}

// ---- deletion, in every form the editor offers ----
function deleteKey(ch, i) {
  const c = clip(), keys = c.tracks[ch];
  if (!keys || !keys[i]) return false;
  pushUndo('delete key');
  keys.splice(i, 1);
  if (!keys.length) delete c.tracks[ch];
  if (selKey && selKey.ch === ch) selKey = null;
  markDirty(); applyPreview(); paintTimeline(); paintChannels();
  return true;
}
function clearChannel(ch) {
  const c = clip();
  if (!c.tracks[ch]) return;
  pushUndo('clear channel');
  delete c.tracks[ch];
  if (selKey?.ch === ch) selKey = null;
  markDirty(); applyPreview(); paintTimeline(); paintChannels();
  toast(`Deleted every key on ${ch}`);
}
function deleteSelected() {
  if (selKey && deleteKey(selKey.ch, selKey.i)) { toast('Key deleted'); return; }
  // nothing picked in the timeline: fall back to the selected joint's channels
  // at the playhead, which is what "delete" means while you are posing
  if (!selJoint || !joints[selJoint]) { toast('Nothing selected to delete'); return; }
  const c = clip();
  const chans = [...(joints[selJoint].rot || []), ...(joints[selJoint].move || [])].map((r) => r.channel);
  let n = 0;
  const before = structuredClone(set);
  for (const ch of chans) {
    const keys = c.tracks[ch]; if (!keys) continue;
    const p = (time % c.duration) / c.duration;
    const i = keys.findIndex((k) => Math.abs(k.t - p) < 0.02);
    if (i >= 0) { keys.splice(i, 1); n++; if (!keys.length) delete c.tracks[ch]; }
  }
  if (n) {
    undoStack.push({ label: 'delete keys', clipName, state: before });
    redoStack.length = 0; paintHistory();
    markDirty(); applyPreview(); paintTimeline(); paintChannels(); toast(`Deleted ${n} key${n > 1 ? 's' : ''}`);
  }
  else toast('No key here to delete');
}
addEventListener('keydown', (e) => {
  // Undo works even from inside a field — it is muscle memory, and a text
  // caret is not a good reason for the shortcut to go dead.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (e.key === 'r' || e.key === 'e') setMode('rotate');
  else if (e.key === 'g' || e.key === 'w') setMode('move');
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
});

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
      d.title = `${k.v.toFixed(2)} @ ${(k.t * c.duration).toFixed(2)}s (${k.e}) — double-click or press Delete to remove`;
      d.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selKey = { ch, i };
        paintTimeline();
        const r = track.getBoundingClientRect();
        let moved = false;
        const move = (ev) => {
          if (!moved) openChange('move key');
          moved = true;
          k.t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
          d.style.left = `${k.t * 100}%`;
          markDirty();
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          closeChange();
          if (moved) { keys.sort((a, b) => a.t - b.t); applyPreview(); paintTimeline(); }
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
      d.addEventListener('dblclick', (e) => { e.stopPropagation(); deleteKey(ch, i); });
      d.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        pushUndo('easing');
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
function togglePlay() { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; }
function setMode(m) {
  mode = m;
  $('mode-rotate').classList.toggle('on', m === 'rotate');
  $('mode-move').classList.toggle('on', m === 'move');
  refreshGizmo();
}
$('mode-rotate').addEventListener('click', () => setMode('rotate'));
$('mode-move').addEventListener('click', () => setMode('move'));
$('play').addEventListener('click', togglePlay);
$('stop').addEventListener('click', () => { playing = false; time = 0; $('play').textContent = '▶'; });
$('speed').addEventListener('input', (e) => { speed = +e.target.value; });
$('loop').addEventListener('change', (e) => { pushUndo('loop'); clip().loop = e.target.checked; markDirty(); });
$('dur').addEventListener('change', (e) => { pushUndo('clip length'); clip().duration = Math.max(0.05, +e.target.value || 1); markDirty(); applyPreview(); paintTimeline(); paintRuler(); });
$('clip').addEventListener('change', (e) => { clipName = e.target.value; syncClip(); });
$('del-key').addEventListener('click', deleteSelected);
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);

$('seed').addEventListener('click', () => {
  pushUndo('seed');
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
  pushUndo('mirror');
  const c = clip(), t = c.tracks;
  const swap = [['armLS', 'armRS'], ['armLL', 'armRL'], ['foreL', 'foreR'], ['legLS', 'legRS'], ['shinL', 'shinR'], ['footL', 'footR']];
  for (const [a, b] of swap) { const tmp = t[a]; if (t[b]) t[a] = t[b]; else delete t[a]; if (tmp) t[b] = tmp; else delete t[b]; }
  markDirty(); applyPreview(); paintTimeline(); paintChannels(); toast('Mirrored left and right');
});
$('clear-clip').addEventListener('click', () => {
  if (!confirm(`Delete every key in "${clipName}"?`)) return;
  pushUndo('clear clip');
  set.clips[clipName] = { duration: clip().duration, loop: clip().loop, tracks: {} };
  selKey = null;
  markDirty(); applyPreview(); paintTimeline(); paintChannels();
  toast(`Cleared ${clipName}`);
});
for (const kind of ['flat', 'steps', 'course']) {
  const b = document.createElement('button');
  b.textContent = kind[0].toUpperCase() + kind.slice(1);
  b.className = world === kind ? 'on' : '';
  b.addEventListener('click', () => {
    world = kind; buildWorld(kind);
    [...$('world-pick').children].forEach((x) => x.classList.toggle('on', x === b));
  });
  $('world-pick').appendChild(b);
}

// ---------------------------------------------------------------- left panel
function paintSets() {
  const host = $('set-list'); host.innerHTML = '';
  if (!sets.length) host.innerHTML = '<p class="hint">No sets yet — make one.</p>';
  for (const s of sets) {
    const el = document.createElement('div');
    el.className = 'set-item' + (s.id === set.id ? ' on' : '');
    el.innerHTML = `<span>${s.name}</span>
      <span class="tag ${s.published ? 'pub' : ''}">${s.published ? 'live' : 'draft'}</span>
      <button class="del" title="Delete this set">✕</button>`;
    el.addEventListener('click', (e) => { if (e.target.classList.contains('del')) return; loadSet(s); });
    el.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete the set "${s.name}"? This cannot be undone.`)) return;
      try { await api('/anim/delete', { name: me, id: s.id }); }
      catch (err) { toast(err.message); return; }
      sets = sets.filter((x) => x.id !== s.id);
      if (set.id === s.id) { set = sets[0] ? structuredClone(sets[0]) : blankSet(); syncAll(); }
      paintSets(); toast('Set deleted');
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
    b.addEventListener('click', () => { if (set.model === m) return; pushUndo('model'); set.model = m; markDirty(); paintModels(); buildAvatar(); });
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
$('cam-follow').addEventListener('change', (e) => { pushUndo('camera rule'); set.camera.followHead = e.target.checked; markDirty(); });
$('cam-global').addEventListener('change', (e) => { set.camera.applyGlobally = e.target.checked; markDirty(); });
$('cam-max').addEventListener('input', (e) => { set.camera.maxOffset = +e.target.value; $('cam-max-val').textContent = (+e.target.value).toFixed(2); markDirty(); });
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
  time = 0; selKey = null;
  applyPreview(); paintTimeline(); paintChannels(); paintRuler();
}
function syncAll() {
  $('set-name').value = set.name;
  $('cam-follow').checked = !!set.camera.followHead;
  $('cam-global').checked = !!set.camera.applyGlobally;
  $('cam-max').value = set.camera.maxOffset;
  $('cam-max-val').textContent = Number(set.camera.maxOffset).toFixed(2);
  paintModels(); paintScope(); paintSets(); syncClip(); buildAvatar();
}
function loadSet(s) {
  set = structuredClone(s);
  undoStack.length = 0; redoStack.length = 0; paintHistory();
  markDirty(false); syncAll();
}
$('new-set').addEventListener('click', () => {
  set = blankSet();
  undoStack.length = 0; redoStack.length = 0; paintHistory();
  markDirty(true); syncAll();
});

(async () => {
  try {
    META = await api('/anim/meta');
  } catch (e) {
    $('stage').insertAdjacentHTML('beforeend',
      `<div class="boot-error"><b>Can't load the animator</b>
       <p>${e.message}</p><p>Open the hub and sign in, then come back.</p>
       <a href="/">Go to ClaudeBox</a></div>`);
    return;
  }
  $('clip').innerHTML = META.clips.map((c) => `<option>${c}</option>`).join('');
  try { sets = (await api('/anim/sets')).sets || []; } catch { sets = []; }
  set = sets.length ? structuredClone(sets[0]) : blankSet();
  setMode('rotate');
  syncAll();
  paintHistory();
  setInterval(() => { if (!drag) paintChannels(); }, 300);
  // Debug handle, in the same spirit as rivals' window.__momentum: lets the
  // viewport be driven and inspected from the console (and from tests).
  window.__anim = {
    get state() { return { clipName, mode, selJoint, selKey, time, playing }; },
    screenOf(canon) {
      const o = jointObject(canon); if (!o) return null;
      const v = new THREE.Vector3(); o.getWorldPosition(v);
      if (canon === 'root') v.y += modelScale() * 0.5;
      v.project(cam);
      const r = $('view').getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (-v.y + 1) / 2 * r.height };
    },
    joints: () => Object.keys(joints),
    showProxies(v) { showProxies = !!v; },
    handleOf(channel) {
      const w = giz.pointOn(channel, THREE); if (!w) return null;
      const v = w.clone().project(cam);
      const r = $('view').getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (-v.y + 1) / 2 * r.height };
    },
    keys: (ch) => (clip().tracks[ch] || []).map((k) => ({ ...k })),
    tracks: () => clip().tracks,
    select(c) { selJoint = c; refreshGizmo(); },
    setMode,
    undo, redo,
    history: () => ({ undo: undoStack.map((e) => e.label), redo: redoStack.map((e) => e.label) }),
  };
  requestAnimationFrame(frame);
})();
