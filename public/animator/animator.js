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
import { ease, EASE_ORDER, EASE_LABEL } from '/shared/anim/ease.js';
import { makeGizmo, jointsFor, AXIS_COLOR } from '/animator/gizmo.js';
import { addOutline, removeOutline, setOutlineStyle, setCelShaded } from '/shared/outline.js';

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
// Selection holds the keyframe OBJECTS, mapped to the channel they live on.
// Indices would be wrong the moment a drag re-sorts a track; object identity
// survives sorting, deletion elsewhere, and paste.
let sel = new Map();        // keyObject -> channel name
let clipboard = null;       // [{ ch, dt, v, e }] relative to the earliest key
const selCount = () => sel.size;
const clearSel = () => { if (sel.size) { sel = new Map(); paintTimeline(); } };
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
  sel = new Map();
  $('clip').value = clipName;
  $('set-name').value = set.name;
  $('cam-follow').checked = !!set.camera.followHead;
  $('cam-global').checked = !!set.camera.applyGlobally;
  $('cam-max').value = set.camera.maxOffset;
  $('cam-max-val').textContent = Number(set.camera.maxOffset).toFixed(2);
  const c = clip();
  $('dur').value = c.duration;
  $('loop').checked = c.loop !== false;
  speed = c.speed || 1;
  $('speed').value = speed;
  $('speed-val').textContent = `${speed.toFixed(2)}×`;
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
  if (canon && canon.startsWith('prop:')) {
    const o = propObjs.get(canon.slice(5));
    if (!o) return null;
    // a selected limb resolves to that dummy's bone; otherwise its whole group
    if (selJoint && o.ctrl) {
      if (selJoint === 'root') return o.group;
      const rig = jointsFor(o.def.model || 'boy');
      const bn = rig[selJoint]?.bone;
      const b = bn ? o.ctrl.bones?.[bn] : null;
      if (b) return b;
    }
    return o.group;
  }
  if (!ctrl) return null;
  if (canon === 'root') return ctrl.group;
  const name = joints[canon]?.bone;
  return name ? ctrl.bones?.[name] || null : null;
}

/** A prop presents the same shape as a joint, so one gizmo serves both. */
function propJoint(id) {
  const def = (set.props || []).find((p) => p.id === id);
  if (!def) return null;
  return {
    label: def.name,
    bone: null,
    rot: [{ channel: 'rx', axis: 'x', sign: 1 },
          { channel: 'ry', axis: 'y', sign: 1 },
          { channel: 'rz', axis: 'z', sign: 1 }],
    move: [{ channel: 'px', axis: 'x' }, { channel: 'py', axis: 'y' }, { channel: 'pz', axis: 'z' }],
  };
}
const isPropChannel = (ch) => PROP_CH.includes(ch);

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
  // Move means "move this object". A limb cannot translate — only rotate — so
  // in move mode a selected limb falls back to translating the thing it belongs
  // to: the dummy, or your own body. Showing nothing at all was the old
  // behaviour and it just looked broken.
  if (mode === 'move' && selProp) {
    const pj = propJoint(selProp);
    if (pj) {
      const o = propObjs.get(selProp);
      giz.build(pj, 'move', modelScale() * 0.17);
      giz.group.visible = true;
      const limb = selJoint && o ? jointsFor(o.def.model || 'boy')[selJoint] : null;
      $('sel-label').innerHTML = `<b>${pj.label}${limb ? ` · ${limb.label}` : ''}</b> `
        + `<em>moving the whole ${o?.def.kind === 'dummy' ? 'dummy' : 'prop'}</em> · `
        + pj.move.map((r) => `<i style="color:#${AXIS_COLOR[r.axis].toString(16).padStart(6, '0')}">${r.channel}</i>`).join(' ');
      return;
    }
  }
  if (mode === 'move' && !selProp && selJoint && selJoint !== 'root' && joints.root) {
    // a limb on your own character: translate the body instead
    giz.build(joints.root, 'move', modelScale() * 0.17);
    giz.group.visible = true;
    $('sel-label').innerHTML = `<b>${joints[selJoint]?.label || 'Limb'}</b> `
      + `<em>moving the whole body</em> · `
      + joints.root.move.map((r) => `<i style="color:#${AXIS_COLOR[r.axis].toString(16).padStart(6, '0')}">${r.channel}</i>`).join(' ');
    return;
  }
  if (selProp && selJoint) {
    // a limb on a dummy — same rig table as the main model
    const o = propObjs.get(selProp);
    const rig = o ? jointsFor(o.def.model || 'boy') : null;
    const j = rig?.[selJoint];
    if (j) {
      const usable = j.rot;
      giz.build(usable.length ? j : null, mode, modelScale() * 0.17);
      giz.group.visible = usable.length > 0;
      $('sel-label').innerHTML = `<b>${o.def.name} · ${j.label}</b> · ${usable.map((r) =>
        `<i style="color:#${AXIS_COLOR[r.axis].toString(16).padStart(6, '0')}">${r.channel}</i>`).join(' ')}`;
      return;
    }
  }
  if (selProp) {
    const pj = propJoint(selProp);
    if (pj) {
      const usable = mode === 'move' ? pj.move : pj.rot;
      giz.build(pj, mode, modelScale() * 0.17);
      giz.group.visible = true;
      $('sel-label').innerHTML = `<b>${pj.label}</b> · ${usable.map((r) =>
        `<i style="color:#${AXIS_COLOR[r.axis].toString(16).padStart(6, '0')}">${r.channel}</i>`).join(' ')}`;
      return;
    }
  }
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
  if (!giz.group.visible) return;
  let o;
  if (mode === 'move' && selProp) o = propObjs.get(selProp)?.group;
  else if (mode === 'move' && selJoint && selJoint !== 'root') o = jointObject('root');
  else o = jointObject(selProp ? `prop:${selProp}` : selJoint);
  if (!o) return;
  if (!o) return;
  o.getWorldPosition(_p);
  if (!selProp && (selJoint === 'root' || mode === 'move')) _p.y += modelScale() * 0.5;
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
  // props first: a dummy standing in front of the model should win the click
  const pp = r.intersectObjects(propProxies.filter((p) => p.visible), false)[0];
  const bh = r.intersectObjects(proxies.filter((p) => p.visible), false)[0];
  if (pp && (!bh || pp.distance <= bh.distance)) {
    selProp = pp.object.userData.prop;
    selJoint = pp.object.userData.joint || null;
    paintProps(); refreshGizmo(); paintChannels(); paintTimeline();
    return;
  }
  if (bh) {
    selJoint = bh.object.userData.joint;
    selProp = null; paintProps();
    refreshGizmo(); paintChannels(); paintTimeline();
    return;
  }
  // nothing hit: deselect, and fall through to orbiting
  if (!e.shiftKey) { selJoint = null; selProp = null; paintProps(); refreshGizmo(); paintChannels(); paintTimeline(); }
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
  // in move mode we translate the OBJECT, so aim at its group / the body root
  const target = mode === 'move'
    ? (selProp ? `prop:${selProp}` : 'root')
    : (selProp ? `prop:${selProp}` : selJoint);
  const o = mode === 'move' && selProp
    ? propObjs.get(selProp)?.group
    : jointObject(target);
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
    drag = { ...data, centre, start: curValue(data.channel), angle0: 0 };
  } else {
    axisWorld.copy(axisVec(data.axis)).applyQuaternion(ctrl.group.quaternion).normalize();
    const t = closestOnAxis(pointerNDC(e).ray, centre, axisWorld);
    if (t === null) return;
    drag = { ...data, centre, start: curValue(data.channel), t0: t };
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

// Route by WHAT IS SELECTED, not by which channel it is. Routing on channel
// type meant posing a dummy's arm wrote armLS onto the main model — the dummy
// never moved, and the character you were not looking at did.
const curValue = (ch) => targetValue(ch, time);
const writeValue = (ch, v) => targetSetKey(ch, time, v);

function moveDrag(e) {
  if (!drag) return;
  const r = pointerNDC(e).ray;
  if (drag.kind === 'rotate') {
    if (!r.intersectPlane(plane, hitPt)) return;
    rel.copy(hitPt).sub(drag.centre);
    const ang = Math.atan2(rel.dot(basisV), rel.dot(basisU));
    // the bone is rotated by (channel * sign), so undo the sign to keep the
    // model following the pointer rather than mirroring it
    writeValue(drag.channel, drag.start + ang * (drag.sign || 1));
  } else {
    const t = closestOnAxis(r, drag.centre, axisWorld);
    if (t === null) return;
    writeValue(drag.channel, drag.start + (t - drag.t0));
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
    // Play only the kept slice, so the trim is something you hear and see
    // rather than a promise about what will happen later.
    const tr = c.trim || { in: 0, out: 1 };
    const lo = tr.in * c.duration, hi = tr.out * c.duration;
    time += dt * speed;
    if (time < lo) time = lo;
    if (c.loop) { if (time > hi) time = lo + ((time - lo) % Math.max(0.001, hi - lo)); }
    else time = Math.min(time, hi);
  }
  if (ctrl) {
    ctrl.anim?.setAnim?.(clipName);
    ctrl.anim?.setSpeed?.(8);
    ctrl.anim?.setPhase?.(time);   // exact-time scrub, set before the pose is evaluated
    ctrl.update(0);
    ctrl.group.updateMatrixWorld(true);
    syncProxies();
    syncPropProxies();
    for (const [id, o] of propObjs) {
      syncProp(id, time);
      if (o.ctrl) {
        // Same rig, same channels, same sampling as the model you are editing —
        // a dummy is a second character, not a puppet with its own rules.
        o.ctrl.setCustomPack?.(dummyPack(id));
        o.ctrl.setAnim(o.def.clip || clipName);
        o.ctrl.anim?.setPhase?.(time);
        o.ctrl.update(0);
      }
    }
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
// what server/anim/store.js will accept for a key value
const CH_LIMIT = 6.5;
const CH_LABEL = {
  armLS: 'L arm swing', armRS: 'R arm swing', armLL: 'L arm lift', armRL: 'R arm lift',
  foreL: 'L forearm', foreR: 'R forearm', legLS: 'L leg swing', legRS: 'R leg swing',
  shinL: 'L knee', shinR: 'R knee', footL: 'L ankle', footR: 'R ankle',
  spine: 'Spine', head: 'Head', bob: 'Body up/down', rootPitch: 'Body pitch',
  rootX: 'Body sideways', rootZ: 'Body forward',
};

// ---------------------------------------------------------------- selection
// The right-hand sliders and the timeline lanes both describe ONE target. A
// cube has seven transform channels; the body has eighteen pose channels; a
// dummy is a character that also travels, so it has both.
function selTarget() {
  if (!selProp) return { kind: 'body', channels: META.channels, label: 'Character' };
  const def = (set.props || []).find((p) => p.id === selProp);
  if (!def) return { kind: 'body', channels: META.channels, label: 'Character' };
  return def.kind === 'dummy'
    ? { kind: 'dummy', propId: selProp, def, channels: [...PROP_CH, ...META.channels], label: def.name }
    : { kind: 'prop', propId: selProp, def, channels: [...PROP_CH], label: def.name };
}
/** Read a channel for whatever is selected. */
function targetValue(ch, t) {
  const tg = selTarget();
  if (tg.kind === 'body') return valueAt(ch, t);
  return propValueAt(tg.propId, ch, t);
}
/** Write a channel for whatever is selected. */
function targetSetKey(ch, t, v) {
  const tg = selTarget();
  if (tg.kind === 'body') setKey(ch, t, v);
  else setPropKey(tg.propId, ch, t, v);
}

function paintChannels() {
  const host = $('channels');
  // Never rebuild under a field being typed into: the 300ms repaint would drop
  // the caret and discard the half-entered number.
  if (host.contains(document.activeElement) && document.activeElement !== document.body) return;
  host.innerHTML = '';
  const c = clip();
  const tg = selTarget();
  const banner = document.createElement('div');
  banner.className = 'ch-target';
  banner.innerHTML = `<b>${tg.label}</b><small>${
    tg.kind === 'body' ? 'the model you are animating'
      : tg.kind === 'dummy' ? 'dummy — moves and poses' : 'prop — moves only'}</small>`;
  host.appendChild(banner);
  for (const ch of tg.channels) {
    const has = tg.kind === 'body'
      ? !!c.tracks[ch]?.length
      : !!c.props?.[tg.propId]?.tracks?.[ch]?.length;
    const el = document.createElement('div');
    el.className = 'ch' + (has ? ' active' : '');
    const v = targetValue(ch, time);
    const isXf = PROP_CH.includes(ch) && tg.kind !== 'body';
    const lo = isXf ? -30 : -3.2, hi = isXf ? 30 : 3.2;
    el.innerHTML = `<div class="ch-top"><b>${CH_LABEL[ch] || ch}</b>
        <input class="ch-val" type="number" step="0.01" min="${-CH_LIMIT}" max="${CH_LIMIT}"
               value="${v.toFixed(2)}" title="Type an exact value"></div>
      <input class="ch-slider" type="range" min="${lo}" max="${hi}" step="0.01" value="${v}">
      <div class="n">${ch}${has ? ' · keyed' : ''}
        ${has && tg.kind === 'body' ? '<button class="ch-clear" title="Delete this channel’s keys">clear</button>' : ''}</div>`;
    const inp = el.querySelector('.ch-slider');
    const box = el.querySelector('.ch-val');
    inp.addEventListener('pointerdown', () => openChange('slider'));
    inp.addEventListener('keydown', () => openChange('slider'));
    inp.addEventListener('change', closeChange);
    inp.addEventListener('input', () => {
      targetSetKey(ch, time, +inp.value);
      box.value = (+inp.value).toFixed(2);
    });

    // Typed entry. The slider is fine for finding a pose and useless for
    // reproducing one, so the readout is the input: type a number, get exactly
    // that number. The slider's range is narrower than what a set can store, so
    // it just pins at its end rather than rewriting what you typed.
    const commit = () => {
      const n = parseFloat(box.value);
      if (!isFinite(n)) { box.value = targetValue(ch, time).toFixed(2); return; }
      const cap = isXf ? 60 : CH_LIMIT;
      const clamped = Math.max(-cap, Math.min(cap, n));
      box.value = clamped.toFixed(2);
      inp.value = String(clamped);
      targetSetKey(ch, time, clamped);
    };
    box.addEventListener('focus', () => box.select());
    box.addEventListener('change', commit);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); box.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); box.value = targetValue(ch, time).toFixed(2); box.blur(); }
      // Let Delete and space edit the text rather than the timeline, but leave
      // the shortcuts alone so Cmd+Z still undoes the edit, not the typing.
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
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
  // Ticks render into their own layer. Writing them straight into .ruler-track
  // wiped the trim handles that live there — they vanished the moment the clip
  // length changed.
  const host = document.querySelector('.ruler-ticks');
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
  if (keys?.length) return sample(keys, (t % c.duration) / c.duration, c.loop !== false);
  const probe = {}; for (const k of META.channels) probe[k] = 0;
  (POSES[clipName] || POSES.idle)(probe, t);
  return probe[ch] || 0;
}
// Mirrors sampleTrack in shared/anim/custom.js — the editor must show exactly
// what a game will play, seam included, or the preview is a lie.
function sample(keys, p, loop = true) {
  if (!keys.length) return 0;
  if (keys.length === 1) return keys[0].v;
  const first = keys[0], last = keys[keys.length - 1];
  // the stretch from the last key back round to the first is a real segment for
  // a cycling clip; holding then snapping is what a loop seam looks like
  if (p >= last.t || p <= first.t) {
    if (!loop) return p >= last.t ? last.v : first.v;
    const span = (1 - last.t) + first.t;
    if (span <= 1e-6) return first.v;
    if (last.e === 'step') return last.v;
    const raw = (p >= last.t ? p - last.t : p + 1 - last.t) / span;
    return last.v + (first.v - last.v) * ease(last.e, raw);
  }
  let i = 0; while (i < keys.length - 1 && keys[i + 1].t <= p) i++;
  const a = keys[i], b = keys[i + 1], span = b.t - a.t;
  if (span <= 0) return b.v;
  const raw = (p - a.t) / span;
  if (a.e === 'step') return a.v;
  return a.v + (b.v - a.v) * ease(a.e, raw);
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
  sel.delete(keys[i]);
  markDirty(); applyPreview(); paintTimeline(); paintChannels();
  return true;
}
function clearChannel(ch) {
  const c = clip();
  if (!c.tracks[ch]) return;
  pushUndo('clear channel');
  delete c.tracks[ch];
  for (const [k, c2] of [...sel]) if (c2 === ch) sel.delete(k);
  markDirty(); applyPreview(); paintTimeline(); paintChannels();
  toast(`Deleted every key on ${ch}`);
}
function deleteSelected() {
  if (sel.size) {
    pushUndo(`delete ${sel.size} key${sel.size > 1 ? 's' : ''}`);
    const c = clip();
    const n = sel.size;
    for (const [k, ch] of sel) {
      const keys = c.tracks[ch];
      if (!keys) continue;
      const i = keys.indexOf(k);
      if (i >= 0) keys.splice(i, 1);
      if (!keys.length) delete c.tracks[ch];
    }
    sel = new Map();
    markDirty(); applyPreview(); paintTimeline(); paintChannels();
    toast(`Deleted ${n} key${n > 1 ? 's' : ''}`);
    return;
  }
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
function copySel(cut = false) {
  if (!sel.size) { toast('Select some keyframes first'); return; }
  const items = [...sel].map(([k, ch]) => ({ ch, t: k.t, v: k.v, e: k.e }));
  const t0 = Math.min(...items.map((i) => i.t));
  // stored relative to the earliest key, so a paste keeps the shape of what you
  // copied wherever you drop it
  clipboard = items.map((i) => ({ ch: i.ch, dt: i.t - t0, v: i.v, e: i.e }));
  toast(`${cut ? 'Cut' : 'Copied'} ${items.length} key${items.length > 1 ? 's' : ''}`);
  if (cut) deleteSelected();
}
function pasteSel() {
  if (!clipboard?.length) { toast('Nothing copied'); return; }
  pushUndo('paste');
  const c = clip();
  const base = (time % c.duration) / c.duration;
  const landed = new Map();
  for (const it of clipboard) {
    const t = Math.max(0, Math.min(1, +(base + it.dt).toFixed(4)));
    const keys = (c.tracks[it.ch] ||= []);
    const at = keys.find((k) => Math.abs(k.t - t) < 0.004);
    if (at) { at.v = it.v; at.e = it.e; landed.set(at, it.ch); }
    else { const k = { t, v: it.v, e: it.e }; keys.push(k); landed.set(k, it.ch); }
    keys.sort((a, b) => a.t - b.t);
  }
  sel = landed;                     // leave the paste selected, ready to nudge
  markDirty(); applyPreview(); paintTimeline(); paintChannels();
  toast(`Pasted ${clipboard.length} key${clipboard.length > 1 ? 's' : ''} at ${time.toFixed(2)}s`);
}
function selectAllKeys() {
  const c = clip();
  sel = new Map();
  for (const ch of META.channels) for (const k of (c.tracks[ch] || [])) sel.set(k, ch);
  paintTimeline();
  toast(sel.size ? `Selected ${sel.size} keys` : 'No keys in this clip');
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
  // clipboard, but only when the caret is not in a field — Cmd+C in the set
  // name box should copy text, not keyframes
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if ((e.ctrlKey || e.metaKey) && !typing) {
    const k = e.key.toLowerCase();
    if (k === 'c') { e.preventDefault(); copySel(); return; }
    if (k === 'x') { e.preventDefault(); copySel(true); return; }
    if (k === 'v') { e.preventDefault(); pasteSel(); return; }
    if (k === 'a') { e.preventDefault(); selectAllKeys(); return; }
  }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (e.key === 'r' || e.key === 'e') setMode('rotate');
  else if (e.key === 'g' || e.key === 'w') setMode('move');
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Escape') clearSel();
});

// Dragging rebuilds nothing: it only moves the pips that already exist. A full
// paintTimeline() per mouse move would destroy the element under the cursor and
// drop the drag.
function paintTimelinePositions() {
  const c = clip();
  for (const lane of $('tl-lanes').children) {
    const ch = lane.dataset.ch;
    const keys = c.tracks[ch] || [];
    const pips = lane.querySelectorAll('.kf');
    for (let i = 0; i < pips.length && i < keys.length; i++) pips[i].style.left = `${keys[i].t * 100}%`;
  }
}

function paintTimeline() {
  const host = $('tl-lanes'); host.innerHTML = '';
  const c = clip();
  const tg = selTarget();
  let total = 0;

  // Lanes describe whatever is selected. Showing the body's channels while a
  // cube is selected was the reason the panels felt disconnected from the
  // viewport — you were editing one thing and looking at another.
  const readKeys = (ch) => (tg.kind === 'body'
    ? (c.tracks[ch] || [])
    : (c.props?.[tg.propId]?.tracks?.[ch] || []));
  const ensure = (ch) => {
    if (tg.kind === 'body') return (c.tracks[ch] ||= []);
    c.props = c.props || {};
    c.props[tg.propId] = c.props[tg.propId] || { tracks: {} };
    return (c.props[tg.propId].tracks[ch] ||= []);
  };
  const label = (ch) => (PROP_CH.includes(ch) && tg.kind !== 'body'
    ? (PROP_LABEL[ch] || ch)
    : (CH_LABEL[ch] || ch));

  for (const ch of tg.channels) {
    const keys = readKeys(ch);
    total += keys.length;
    const lane = document.createElement('div');
    lane.className = 'lane' + (keys.length ? ' has' : '');
    lane.dataset.ch = ch;
    lane.innerHTML = `<div class="lane-name">${label(ch)}</div><div class="lane-track"></div>`;
    const track = lane.querySelector('.lane-track');
    track.addEventListener('click', (e) => {
      if (e.target.classList.contains('kf') || e.shiftKey) return;
      const r = track.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      targetSetKey(ch, p * c.duration, targetValue(ch, p * c.duration));
    });
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const d = document.createElement('div');
      d.className = `kf ${k.e}` + (sel.has(k) ? ' sel' : '');
      d.style.left = `${k.t * 100}%`;
      d.title = `${k.v.toFixed(2)} @ ${(k.t * c.duration).toFixed(2)}s (${k.e})\n`
        + 'shift-click to add to the selection · drag to move every selected key · double-click to delete';
      d.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const r = track.getBoundingClientRect();
        if (e.shiftKey) { sel.has(k) ? sel.delete(k) : sel.set(k, ch); paintTimeline(); return; }
        if (!sel.has(k)) sel = new Map([[k, ch]]);
        paintTimeline();
        const start = new Map(); for (const [kk] of sel) start.set(kk, kk.t);
        const t0 = (e.clientX - r.left) / r.width;
        let moved = false;
        const move = (ev) => {
          if (!(r.width > 0)) return;
          if (!moved) openChange(sel.size > 1 ? `move ${sel.size} keys` : 'move key');
          moved = true;
          let dt = (ev.clientX - r.left) / r.width - t0;
          let lo = 1, hi = 0;
          for (const [, s0] of start) { lo = Math.min(lo, s0); hi = Math.max(hi, s0); }
          dt = Math.max(-lo, Math.min(1 - hi, dt));
          for (const [kk, s0] of start) kk.t = s0 + dt;
          markDirty(); paintTimelinePositions();
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          closeChange();
          if (moved) { keys.sort((a, b) => a.t - b.t); applyPreview(); paintTimeline(); }
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
      d.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        pushUndo('delete key');
        const arr = ensure(ch);
        const j = arr.indexOf(k);
        if (j >= 0) arr.splice(j, 1);
        sel.delete(k);
        markDirty(); applyPreview(); paintTimeline(); paintChannels();
      });
      d.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openEaseMenu(e.clientX, e.clientY, k, () => { applyPreview(); paintTimeline(); });
      });
      track.appendChild(d);
    }
    host.appendChild(lane);
  }

  paintTrim();
  $('keycount').textContent = sel.size
    ? `${sel.size} selected · ${total} keys on ${tg.label}`
    : `${total} keys on ${tg.label} · ${clipName}`;
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
// The transport speed is the clip's own speed, not a preview rate — it saves
// with the set and games play it back at exactly this tempo.
$('speed').addEventListener('input', (e) => {
  const v = Math.max(0.1, Math.min(4, +e.target.value || 1));
  if (!changeOpen) pushUndo('clip speed');
  clip().speed = v;
  speed = v;
  $('speed-val').textContent = `${v.toFixed(2)}×`;
  markDirty(); applyPreview();
});
$('speed').addEventListener('pointerdown', () => openChange('clip speed'));
$('speed').addEventListener('change', closeChange);
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
  set.clips[clipName] = { duration: clip().duration, loop: clip().loop, tracks: {}, props: {} };
  sel = new Map();
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
    el.innerHTML = `<span class="nm">${esc(s.name)}</span>
      <span class="tag ${s.published ? 'pub' : ''}">${s.published ? 'live' : 'draft'}</span>
      <button class="ren" title="Rename (or double-click the name)">✎</button>
      <button class="del" title="Delete this set">✕</button>`;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.del, .ren') || e.target.tagName === 'INPUT') return;
      loadSet(s);
    });
    el.querySelector('.ren').addEventListener('click', (e) => { e.stopPropagation(); beginRename(el, s); });
    el.querySelector('.nm').addEventListener('dblclick', (e) => { e.stopPropagation(); beginRename(el, s); });
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
/**
 * Rename a set in place. Renaming works on any set in the list, loaded or not —
 * having to open something first just to retitle it is the kind of small tax
 * that stops you tidying up. Commits straight to the server, so there is no
 * separate save step for a rename.
 */
function beginRename(row, s) {
  const nm = row.querySelector('.nm');
  if (!nm || row.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'nm-edit';
  input.value = s.name;
  input.maxLength = 48;
  nm.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const next = input.value.trim().slice(0, 48);
    if (!commit || !next || next === s.name) { paintSets(); return; }
    const before = s.name;
    s.name = next;
    // the loaded copy is a clone, so keep it and the header in step
    if (set.id === s.id) { set.name = next; $('set-name').value = next; }
    paintSets();
    try {
      const j = await api('/anim/save', { name: me, set: set.id === s.id ? set : { ...s, name: next } });
      const i = sets.findIndex((x) => x.id === j.set.id);
      if (i >= 0) sets[i] = j.set;
      if (set.id === j.set.id) markDirty(false);
      paintSets();
      toast(`Renamed to “${next}”`);
    } catch (err) {
      s.name = before;                       // put it back if the server said no
      if (set.id === s.id) { set.name = before; $('set-name').value = before; }
      paintSets();
      toast(err.message);
    }
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();                     // Delete/space belong to the field
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
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
  speed = c.speed || 1;
  $('speed').value = speed;
  $('speed-val').textContent = `${speed.toFixed(2)}×`;
  time = 0; sel = new Map();
  applyPreview(); paintTimeline(); paintChannels(); paintRuler(); paintTrim();
}
function syncAll() {
  $('set-name').value = set.name;
  $('cam-follow').checked = !!set.camera.followHead;
  $('cam-global').checked = !!set.camera.applyGlobally;
  $('cam-max').value = set.camera.maxOffset;
  $('cam-max-val').textContent = Number(set.camera.maxOffset).toFixed(2);
  paintModels(); paintScope(); paintSets(); syncClip(); buildAvatar();
  for (const id of [...propObjs.keys()]) disposeProp(id);
  selProp = null;
  (async () => { for (const def of (set.props || [])) await buildProp(def); paintProps(); })();
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
    get state() { return { clipName, mode, selJoint, selProp, selected: sel.size, time, playing }; },
    selectedTimes: () => [...sel.keys()].map((k) => +k.t.toFixed(4)).sort((a, b) => a - b),
    setTime(t) { time = t; },
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
    trim: () => ({ ...(clip().trim || { in: 0, out: 1 }) }),
    clipSpeed: () => clip().speed || 1,
    duration: () => clip().duration,
    gizmoVisible: () => giz.group.visible,
    gizmoHandles: () => giz.handles.map((h) => h.userData.channel + ':' + h.userData.kind),
    props: () => (set.props || []).map((p) => ({ id: p.id, kind: p.kind, name: p.name, model: p.model, who: p.who })),
    selectProp: (id) => { selProp = id; selJoint = null; paintProps(); refreshGizmo(); },
    screenOfProp(id, joint) {
      const o = propObjs.get(id); if (!o) return null;
      let node = o.group;
      if (joint && o.ctrl) { const rig = jointsFor(o.def.model || 'boy'); const bn = rig[joint]?.bone; node = (bn && o.ctrl.bones?.[bn]) || o.group; }
      const v = new THREE.Vector3(); node.getWorldPosition(v); v.project(cam);
      const r = $('view').getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (-v.y + 1) / 2 * r.height };
    },
    // world-space tip of a dummy's limb, for tests: a bone's own origin does
    // not move when it rotates, so probe a point down the limb
    boneTip(id, joint) {
      const o = propObjs.get(id); if (!o?.ctrl) return null;
      const rig = jointsFor(o.def.model || 'boy');
      const bn = rig[joint]?.bone; const b = bn ? o.ctrl.bones?.[bn] : null;
      if (!b) return null;
      const v = new THREE.Vector3(0, -1, 0); b.localToWorld(v);
      return { x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) };
    },
    propGroup: (id) => propObjs.get(id)?.group,
    propKeys: (id, ch) => ((clip().props?.[id]?.tracks?.[ch]) || []).map((k) => ({ ...k })),
    undo, redo,
    history: () => ({ undo: undoStack.map((e) => e.label), redo: redoStack.map((e) => e.label) }),
  };
  requestAnimationFrame(frame);
})();

// ============================================================================
// Publishing a set as an animation pack.
//
// The preview below is not a mock-up of the Store: it loads the Store's own
// stylesheet and builds the Store's own markup (.mk-item, .mk-detail), so what
// you see while typing is the component that will actually render. A lookalike
// would drift the first time the Store changed.
// ============================================================================
const PK = {
  title: '', blurb: '', icon: '🎬', price: 50, tags: [], listed: false,
};
const money = (n) => (n === 0
  ? 'Free'
  : `<img class="cur-ico" src="/icons/claudebux.svg" alt="">${n}`);

function pkFromSet() {
  const m = set.market || {};
  PK.title = m.title || set.name || '';
  PK.blurb = m.blurb || '';
  PK.icon = m.icon || '🎬';
  PK.price = typeof m.price === 'number' ? m.price : 50;
  PK.tags = Array.isArray(m.tags) ? m.tags.slice() : [];
  PK.listed = !!m.listed;
  $('pk-title').value = PK.title;
  $('pk-blurb').value = PK.blurb;
  $('pk-icon').value = PK.icon;
  $('pk-price').value = PK.price;
  $('pk-tags').value = PK.tags.join(', ');
  $('pk-unlist').classList.toggle('hidden', !PK.listed);
  $('pk-list').textContent = PK.listed ? 'Update the listing' : 'List it in the Store';
  paintPack();
}

function readPack() {
  PK.title = $('pk-title').value.trim();
  PK.blurb = $('pk-blurb').value.trim();
  PK.icon = $('pk-icon').value.trim() || '🎬';
  PK.price = Math.max(0, Math.min(100000, Math.round(+$('pk-price').value || 0)));
  PK.tags = $('pk-tags').value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4);
  $('pk-count').textContent = `${PK.blurb.length} / 160`;
  paintPack();
}

/** Which clips this pack actually carries — the thing a buyer is paying for. */
function pkClips() {
  return Object.entries(set.clips || {})
    .filter(([, c]) => Object.keys(c.tracks || {}).length)
    .map(([n]) => n);
}

function paintPack() {
  const clips = pkClips();
  const title = PK.title || 'Untitled pack';
  const author = me || 'you';

  $('pk-clips').innerHTML = clips.length
    ? clips.map((c) => `<span class="chip">${c}</span>`).join('')
    : '<span class="chip warn">no animated clips yet</span>';

  // ---- the Store tile, exactly as mkItemCard builds it ----
  $('pk-card').innerHTML = `<div class="rbx"><div class="mk-grid-one">
    <button class="mk-item">
      <div class="shot"><span class="emoji">${PK.icon}</span></div>
      <h4>${esc(title)}</h4>
      <div class="cost">${money(PK.price)}</div>
    </button></div></div>`;

  // ---- the item page, exactly as mk-detail is laid out ----
  $('pk-page').innerHTML = `<div class="rbx"><div class="mk-detail">
    <button class="mk-back">‹ Back to Marketplace</button>
    <div class="mk-detail-body">
      <div class="mk-detail-stage">
        <div class="pk-stage-emoji">${PK.icon}</div>
        <div class="mk-detail-actions"><button>Try On</button></div>
      </div>
      <div class="mk-detail-info">
        <h2>${esc(title)}</h2>
        <p class="mk-by">By <span>${esc(author)}</span></p>
        <hr>
        <div class="mk-price-row"><span>Price</span><b>${money(PK.price)}</b></div>
        <button class="mk-primary">Buy</button>
        <button class="mk-secondary">Add to cart</button>
        <dl class="mk-meta">
          <dt>Type</dt><dd>Animation pack</dd>
          <dt>Placement</dt><dd>Animation</dd>
          <dt>Creator</dt><dd>${esc(author)}</dd>
          <dt>Body</dt><dd>${set.model === 'any' ? 'Every body type' : set.model}</dd>
          <dt>Clips</dt><dd>${clips.length ? clips.join(', ') : '—'}</dd>
          <dt>Status</dt><dd>${PK.listed ? 'Listed in the Store' : 'Draft — not listed yet'}</dd>
        </dl>
        ${PK.blurb ? `<p class="mk-blurb">${esc(PK.blurb)}</p>` : ''}
        ${PK.tags.length ? `<div class="mk-tagrow">${PK.tags.map((t) => `<span class="mk-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
  </div></div>`;
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function listPack(listed) {
  if (!me) { toast('Sign in on ClaudeBox first'); return; }
  if (listed && !pkClips().length) { toast('Animate at least one clip before listing'); return; }
  if (listed && !PK.title) { toast('Give the pack a name'); return; }
  set.market = { ...(set.market || {}), listed, title: PK.title, blurb: PK.blurb,
                 icon: PK.icon, price: PK.price, tags: PK.tags };
  try {
    const j = await api('/anim/save', { name: me, set });
    set = j.set;
    const i = sets.findIndex((s) => s.id === set.id);
    if (i >= 0) sets[i] = j.set; else sets.push(j.set);
    markDirty(false); paintSets(); pkFromSet();
    toast(listed ? 'Listed — it is in the Store now' : 'Removed from the Store');
    loadEarnings();
  } catch (e) { toast(e.message); }
}

async function loadEarnings() {
  if (!me) return;
  try {
    const j = await api(`/anim/earnings/${encodeURIComponent(me)}`);
    const host = $('pk-earn');
    if (!j.packs?.length) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    host.innerHTML = `<h4>Your packs</h4>
      <p class="earn-total">${j.total} Bits earned in total</p>
      <table><tr><th>Pack</th><th>Price</th><th>Sales</th><th>Earned</th></tr>
      ${j.packs.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.price}</td><td>${p.sales}</td><td>${p.earned}</td></tr>`).join('')}
      </table>`;
  } catch {}
}

for (const id of ['pk-title', 'pk-blurb', 'pk-icon', 'pk-price', 'pk-tags']) {
  $(id).addEventListener('input', readPack);
}
$('btn-pack').addEventListener('click', () => {
  pkFromSet(); loadEarnings();
  $('pack').classList.remove('hidden');
});
$('pack-close').addEventListener('click', () => $('pack').classList.add('hidden'));
$('pack').addEventListener('click', (e) => { if (e.target === $('pack')) $('pack').classList.add('hidden'); });
$('pk-list').addEventListener('click', () => listPack(true));
$('pk-unlist').addEventListener('click', () => listPack(false));


// ---------------------------------------------------------------- easing menu
let easeMenuEl = null;
function closeEaseMenu() { easeMenuEl?.remove(); easeMenuEl = null; }
addEventListener('pointerdown', (e) => {
  if (easeMenuEl && !easeMenuEl.contains(e.target)) closeEaseMenu();
}, true);

/** A tiny sparkline of a curve, so you pick by shape rather than by name. */
function easeThumb(name) {
  const W = 34, H = 22, pad = 3;
  let d = '';
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const v = name === 'step' ? (t < 1 ? 0 : 1) : ease(name, t);
    const x = pad + t * (W - pad * 2);
    const y = H - pad - v * (H - pad * 2);
    d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

function openEaseMenu(x, y, key, after) {
  closeEaseMenu();
  const m = document.createElement('div');
  m.className = 'ease-menu';
  m.innerHTML = `<div class="ease-head">Easing out of this key</div>` +
    EASE_ORDER.map((n) => `<button class="ease-row${n === key.e ? ' on' : ''}" data-e="${n}">
      <span class="ease-ico">${easeThumb(n)}</span><span>${EASE_LABEL[n] || n}</span></button>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  m.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  m.addEventListener('click', (e) => {
    const b = e.target.closest('.ease-row');
    if (!b) return;
    pushUndo('easing');
    // apply to the whole selection when there is one, so you can shape a run
    // of keys in a single go
    const targets = sel.size && [...sel.keys()].includes(key) ? [...sel.keys()] : [key];
    for (const k of targets) k.e = b.dataset.e;
    markDirty();
    closeEaseMenu();
    after?.();
    toast(`${EASE_LABEL[b.dataset.e]}${targets.length > 1 ? ` on ${targets.length} keys` : ''}`);
  });
  easeMenuEl = m;
}

// ============================================================================
// Scene props — cubes, spheres, and rigged dummies.
//
// A prop is something the animation carries besides the body: a crate to vault,
// a marker to reach for, or a second character to play against. They keyframe on
// their own channels, because a prop travels through space where a limb only
// rotates about a joint.
//
// A dummy is the real avatar system (shared/avatar3d.js), not a stand-in for it,
// so whatever it wears and however it is rigged matches exactly what a player
// sees in game.
// ============================================================================
import { PROP_CHANNELS as PROP_CH } from '/animator/propmeta.js';

const propObjs = new Map();      // prop id -> { def, group, ctrl? }
let selProp = null;              // the prop id being edited

const PROP_LABEL = {
  px: 'X', py: 'Y', pz: 'Z', rx: 'Pitch', ry: 'Turn', rz: 'Roll', sc: 'Scale',
};

function newPropId() {
  let n = 1;
  while (set.props?.some((p) => p.id === `prop${n}`)) n++;
  return `prop${n}`;
}

async function addProp(kind, who = '') {
  set.props = set.props || [];
  if (set.props.length >= 16) { toast('16 props is the limit'); return; }
  pushUndo(`add ${kind}`);
  const id = newPropId();
  const def = {
    id, kind,
    name: kind === 'dummy' ? (who || 'Dummy') : kind === 'box' ? 'Cube' : 'Sphere',
    color: kind === 'box' ? '#6ee7ff' : kind === 'sphere' ? '#ffc94a' : '#9ad9ff',
    size: 1, model: 'boy', who: who || '', clip: 'idle',
    outline: { on: false, color: '#12141a', size: 0.03, toon: false },
    at: { x: kind === 'dummy' ? 1.6 : 1.2, y: kind === 'dummy' ? 0 : 0.6, z: 0, ry: 0 },
  };
  set.props.push(def);
  await buildProp(def);
  selProp = id; selJoint = null;
  markDirty(); paintProps(); paintTimeline(); refreshGizmo();
  if (kind === 'dummy' && who) toast(`Dummy wearing ${who}'s avatar`);
}

/** Fetch a player's avatar so a dummy can wear it, body type included. */
async function avatarOf(who) {
  if (!who) return null;
  try {
    const j = await api(`/avatar/${encodeURIComponent(who)}`);
    return j.avatar || null;
  } catch { return null; }
}

async function buildProp(def) {
  disposeProp(def.id);
  const group = new THREE.Group();
  let ctrl = null;

  if (def.kind === 'dummy') {
    // Copying a username copies the BODY TYPE too — wearing someone's shirt on
    // the wrong skeleton is not "what they look like".
    let profile = { body: def.model };
    if (def.who) {
      const a = await avatarOf(def.who);
      if (a) { profile = { ...a }; def.model = a.body || def.model; }
      else toast(`No player called ${def.who} — using a plain dummy`);
    }
    await preloadAvatars(['boy', 'girl', 'r6']).catch(() => {});
    ctrl = makeAvatar(profile);
    group.add(ctrl.group);
    ctrl.setAnim(def.clip || 'idle');
  } else {
    const geo = def.kind === 'box'
      ? new THREE.BoxGeometry(1, 1, 1)
      : new THREE.SphereGeometry(0.5, 20, 14);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: def.color }));
    group.add(m);
  }
  scene.add(group);
  applyOutline(def, group);
  propObjs.set(def.id, { def, group, ctrl });
  syncProp(def.id, 0);
  rebuildPropProxies();
  return group;
}

function disposeProp(id) {
  const o = propObjs.get(id);
  if (!o) return;
  scene.remove(o.group);
  o.ctrl?.dispose?.();
  o.group.traverse?.((c) => { if (c.isMesh) { c.geometry?.dispose?.(); } });
  propObjs.delete(id);
}

function removeProp(id) {
  pushUndo('delete prop');
  set.props = (set.props || []).filter((p) => p.id !== id);
  for (const c of Object.values(set.clips || {})) if (c.props) delete c.props[id];
  disposeProp(id);
  rebuildPropProxies();
  if (selProp === id) selProp = null;
  markDirty(); paintProps(); paintTimeline(); refreshGizmo();
}

/** A prop's animated channel value at a time, falling back to its rest pose. */
function propValueAt(id, ch, t) {
  const c = clip();
  const keys = c.props?.[id]?.tracks?.[ch];
  if (keys?.length) return sample(keys, (t % c.duration) / c.duration, c.loop !== false);
  const def = (set.props || []).find((p) => p.id === id);
  if (!def) return 0;
  return ch === 'px' ? def.at.x : ch === 'py' ? def.at.y : ch === 'pz' ? def.at.z
       : ch === 'ry' ? def.at.ry : ch === 'sc' ? 1 : 0;
}

function syncProp(id, t) {
  const o = propObjs.get(id);
  if (!o) return;
  const g = o.group;
  g.position.set(propValueAt(id, 'px', t), propValueAt(id, 'py', t), propValueAt(id, 'pz', t));
  g.rotation.set(propValueAt(id, 'rx', t), propValueAt(id, 'ry', t), propValueAt(id, 'rz', t));
  const s = propValueAt(id, 'sc', t) * (o.def.size || 1);
  g.scale.setScalar(Math.max(0.02, s));
}

function setPropKey(id, ch, t, v) {
  if (!changeOpen) pushUndo('prop key');
  const c = clip();
  c.props = c.props || {};
  c.props[id] = c.props[id] || { tracks: {} };
  const keys = (c.props[id].tracks[ch] ||= []);
  const p = +(((t % c.duration) / c.duration).toFixed(4));
  const at = keys.find((k) => Math.abs(k.t - p) < 0.004);
  if (at) at.v = v; else keys.push({ t: p, v, e: 'smooth' });
  keys.sort((a, b) => a.t - b.t);
  markDirty(); paintTimeline();
}

/**
 * Compile a dummy's authored body channels into a pack the avatar controller
 * runs. Built per frame from the same clip data the timeline edits, so posing a
 * dummy's arm shows up immediately.
 */
const _dummyProbe = {};
function dummyPack(id) {
  const c = clip();
  const tracks = c.props?.[id]?.tracks;
  if (!tracks) return null;
  const body = META.channels.filter((ch) => tracks[ch]?.length);
  if (!body.length) return null;
  const o = propObjs.get(id);
  const poseName = o?.def.clip || clipName;
  const dur = c.duration || 1;
  const loop = c.loop !== false;
  return {
    [poseName]: (ch, t) => {
      const p = (t % dur) / dur;
      for (const name of body) ch[name] = sample(tracks[name], p, loop);
    },
  };
}

/** Put the object's outline / cel-shading into the state its settings describe. */
function applyOutline(def, group) {
  const o = def.outline || (def.outline = { on: false, color: '#12141a', size: 0.02, toon: false });
  setCelShaded(group, !!o.toon);
  if (o.on) addOutline(group, { color: o.color, thickness: o.size });
  else removeOutline(group);
}

function paintProps() {
  const host = $('prop-list');
  host.innerHTML = '';
  for (const p of (set.props || [])) {
    const el = document.createElement('div');
    el.className = 'prop-item' + (selProp === p.id ? ' on' : '');
    el.innerHTML = `<i class="sw" style="background:${p.color}"></i>
      <span>${p.name}${p.kind === 'dummy' ? ` · ${p.model}` : ''}</span>
      <button class="del" title="Remove">✕</button>`;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) return;
      selProp = selProp === p.id ? null : p.id;
      selJoint = null;
      paintProps(); refreshGizmo(); paintPropEdit();
    });
    el.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); removeProp(p.id); });
    host.appendChild(el);
  }
  paintPropEdit();
}

function paintPropEdit() {
  const host = $('prop-edit');
  const def = (set.props || []).find((p) => p.id === selProp);
  if (!def) { host.classList.add('hidden'); return; }
  host.classList.remove('hidden');
  host.innerHTML = `
    <label>Name</label><input id="pe-name" value="${def.name}" maxlength="28">
    <div class="row2">
      <div><label>Colour</label><input id="pe-color" type="color" value="${def.color}"></div>
      <div><label>Size</label><input id="pe-size" type="number" min="0.05" max="20" step="0.1" value="${def.size}"></div>
    </div>
    <div class="ol-block">
      <label class="chk"><input type="checkbox" id="pe-ol" ${def.outline?.on ? 'checked' : ''}> Outline</label>
      <div class="row2">
        <div><label>Ink</label><input id="pe-ol-col" type="color" value="${def.outline?.color || '#12141a'}"></div>
        <div><label>Weight</label><input id="pe-ol-size" type="number" min="0.002" max="0.5" step="0.005" value="${def.outline?.size ?? 0.02}"></div>
      </div>
      <label class="chk"><input type="checkbox" id="pe-toon" ${def.outline?.toon ? 'checked' : ''}> Cel shading</label>
    </div>
    ${def.kind === 'dummy' ? `
      <label>Body</label>
      <select id="pe-model">${['boy', 'girl', 'r6', 'steven'].map((m) =>
        `<option value="${m}"${def.model === m ? ' selected' : ''}>${m === 'r6' ? 'R6' : m[0].toUpperCase() + m.slice(1)}</option>`).join('')}</select>
      <label>Wear someone's avatar</label>
      <input id="pe-who" value="${def.who || ''}" maxlength="20" placeholder="username">
      <label>Plays</label>
      <select id="pe-clip">${META.clips.map((c) =>
        `<option value="${c}"${def.clip === c ? ' selected' : ''}>${c}</option>`).join('')}</select>` : ''}`;

  const rebuild = async () => { await buildProp(def); paintProps(); refreshGizmo(); };
  const reOutline = () => {
    const g = propObjs.get(def.id)?.group;
    if (g) applyOutline(def, g);
    markDirty();
  };
  $('pe-ol').addEventListener('change', (e) => { def.outline.on = e.target.checked; reOutline(); });
  $('pe-toon').addEventListener('change', (e) => { def.outline.toon = e.target.checked; reOutline(); });
  $('pe-ol-size').addEventListener('change', (e) => {
    def.outline.size = Math.max(0.002, Math.min(0.5, +e.target.value || 0.02));
    reOutline();                       // thickness is baked in, so rebuild the shell
  });
  $('pe-ol-col').addEventListener('input', (e) => {
    def.outline.color = e.target.value;
    // restyling does not need the geometry rebuilt
    const g = propObjs.get(def.id)?.group;
    if (!g || !setOutlineStyle(g, { color: def.outline.color })) reOutline();
    markDirty();
  });
  $('pe-name').addEventListener('input', (e) => { def.name = e.target.value; markDirty(); paintProps(); });
  $('pe-color').addEventListener('input', (e) => {
    def.color = e.target.value; markDirty();
    const o = propObjs.get(def.id);
    o?.group.traverse((c) => { if (c.isMesh && c.material?.color) c.material.color.set(def.color); });
  });
  $('pe-size').addEventListener('input', (e) => { def.size = Math.max(0.05, +e.target.value || 1); markDirty(); syncProp(def.id, time); });
  if (def.kind === 'dummy') {
    $('pe-model').addEventListener('change', async (e) => { def.model = e.target.value; def.who = ''; markDirty(); await rebuild(); });
    $('pe-who').addEventListener('change', async (e) => { def.who = e.target.value.trim(); markDirty(); await rebuild(); });
    $('pe-clip').addEventListener('change', (e) => {
      def.clip = e.target.value; markDirty();
      propObjs.get(def.id)?.ctrl?.setAnim(def.clip);
    });
  }
}

// ---- picking props in the viewport ----
// Selecting only from the side list meant you could see a dummy and not click
// it. Solids get one proxy; a dummy gets the same per-joint proxies the main
// model has, so you can grab its arm directly.
const propProxies = [];      // meshes raycast for prop selection

function rebuildPropProxies() {
  for (const m of propProxies) { m.geometry.dispose(); m.material.dispose(); proxyGroup.remove(m); }
  propProxies.length = 0;
  const hidden = () => new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0, depthTest: false });
  for (const [id, o] of propObjs) {
    if (o.def.kind === 'dummy' && o.ctrl) {
      const rig = jointsFor(o.def.model || 'boy');
      for (const [canon, j] of Object.entries(rig)) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), hidden());
        m.userData = { prop: id, joint: canon, bone: j.bone, r: 0.09 };
        m.renderOrder = 998;
        proxyGroup.add(m); propProxies.push(m);
      }
    } else {
      const m = new THREE.Mesh(
        o.def.kind === 'sphere' ? new THREE.SphereGeometry(0.55, 14, 10) : new THREE.BoxGeometry(1.08, 1.08, 1.08),
        hidden());
      m.userData = { prop: id, joint: null };
      m.renderOrder = 998;
      proxyGroup.add(m); propProxies.push(m);
    }
  }
}

const _pp = new THREE.Vector3();
function syncPropProxies() {
  for (const m of propProxies) {
    const o = propObjs.get(m.userData.prop);
    if (!o) { m.visible = false; continue; }
    m.visible = true;
    if (m.userData.joint) {
      const bone = m.userData.bone ? o.ctrl?.bones?.[m.userData.bone] : null;
      const node = m.userData.joint === 'root' ? o.group : bone;
      if (!node) { m.visible = false; continue; }
      node.getWorldPosition(_pp);
      m.position.copy(_pp);
      m.scale.setScalar(m.userData.r * (o.def.size || 1) * 2.2);
    } else {
      m.position.copy(o.group.position);
      m.quaternion.copy(o.group.quaternion);
      m.scale.setScalar(o.def.size || 1);
    }
    const lit = selProp === m.userData.prop
      && (m.userData.joint || null) === (selJoint || null) ? 0.2 : 0;
    m.material.opacity = lit;
  }
}

$('add-box').addEventListener('click', () => addProp('box'));
$('add-sphere').addEventListener('click', () => addProp('sphere'));
$('add-dummy').addEventListener('click', () => {
  const who = $('dummy-who').value.trim();
  addProp('dummy', who);
  $('dummy-who').value = '';
});

// ============================================================================
// Trim — cut the start and end off a clip.
//
// Non-destructive by default: the handles say which slice plays, so a fumbled
// run-up or a stray frame at the end simply stops being visited. The keys stay
// put until you press Crop, which bakes the slice down and remaps what is left
// to fill the whole clip.
// ============================================================================
const trimOf = () => {
  const c = clip();
  c.trim = c.trim || { in: 0, out: 1 };
  return c.trim;
};

function paintTrim() {
  const t = trimOf();
  const inEl = $('trim-in'), outEl = $('trim-out');
  if (!inEl) return;
  inEl.style.left = `${t.in * 100}%`;
  outEl.style.left = `${t.out * 100}%`;
  $('trim-before').style.left = '0%';
  $('trim-before').style.width = `${t.in * 100}%`;
  $('trim-after').style.left = `${t.out * 100}%`;
  $('trim-after').style.width = `${(1 - t.out) * 100}%`;
  const trimmed = t.in > 0.001 || t.out < 0.999;
  $('trim-apply').classList.toggle('hidden', !trimmed);
  $('trim-reset').classList.toggle('hidden', !trimmed);
  // shade the cut regions on every lane as well
  for (const lane of $('tl-lanes').children) {
    lane.querySelectorAll('.cut').forEach((n) => n.remove());
    const track = lane.querySelector('.lane-track');
    if (!track || !trimmed) continue;
    if (t.in > 0.001) {
      const a = document.createElement('i');
      a.className = 'cut'; a.style.left = '0'; a.style.width = `${t.in * 100}%`;
      track.appendChild(a);
    }
    if (t.out < 0.999) {
      const b = document.createElement('i');
      b.className = 'cut'; b.style.left = `${t.out * 100}%`; b.style.width = `${(1 - t.out) * 100}%`;
      track.appendChild(b);
    }
  }
}

function dragTrim(which, e) {
  e.preventDefault(); e.stopPropagation();
  pushUndo('trim');
  const move = (ev) => {
    const tr = trackRect();
    const p = Math.max(0, Math.min(1, (ev.clientX - tr.pageLeft) / tr.width));
    const t = trimOf();
    // keep at least a sliver between them, or the clip would play nothing
    if (which === 'in') t.in = Math.min(p, t.out - 0.02);
    else t.out = Math.max(p, t.in + 0.02);
    t.in = Math.max(0, t.in); t.out = Math.min(1, t.out);
    // follow the handle so you can see the frame you are cutting to
    time = (which === 'in' ? t.in : t.out) * clip().duration;
    markDirty(); paintTrim(); paintChannels();
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    applyPreview();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
$('trim-in').addEventListener('pointerdown', (e) => dragTrim('in', e));
$('trim-out').addEventListener('pointerdown', (e) => dragTrim('out', e));

$('trim-reset').addEventListener('click', () => {
  pushUndo('reset trim');
  const c = clip();
  c.trim = { in: 0, out: 1 };
  markDirty(); paintTrim(); applyPreview(); paintTimeline();
  toast('Trim reset — the whole clip plays again');
});

/** Bake the trim: drop keys outside it and stretch what is left to fill. */
$('trim-apply').addEventListener('click', () => {
  const c = clip();
  const t = trimOf();
  const span = t.out - t.in;
  if (span >= 0.999) { toast('Nothing trimmed yet — drag the handles on the ruler'); return; }
  if (!confirm(`Crop "${clipName}" to the kept slice? Keys outside it are deleted.`)) return;
  pushUndo('crop');

  let dropped = 0;
  const remap = (tracks) => {
    for (const ch of Object.keys(tracks)) {
      const kept = [];
      for (const k of tracks[ch]) {
        if (k.t < t.in - 1e-6 || k.t > t.out + 1e-6) { dropped++; continue; }
        kept.push({ ...k, t: +Math.max(0, Math.min(1, (k.t - t.in) / span)).toFixed(4) });
      }
      // A channel whose keys were all outside the slice still needs a value, or
      // it would silently snap back to the built-in pose. Pin the value it held
      // at the cut instead.
      if (!kept.length) {
        const held = sample(tracks[ch], t.in, false);
        kept.push({ t: 0, v: +held.toFixed(4), e: 'smooth' });
      }
      kept.sort((a, b) => a.t - b.t);
      tracks[ch] = kept;
    }
  };
  remap(c.tracks || {});
  for (const p of Object.values(c.props || {})) remap(p.tracks || {});

  c.duration = Math.max(0.05, +(c.duration * span).toFixed(3));
  c.trim = { in: 0, out: 1 };
  sel = new Map();
  markDirty(); syncClip(); paintTrim();
  toast(`Cropped to ${c.duration.toFixed(2)}s${dropped ? ` · ${dropped} key${dropped > 1 ? 's' : ''} outside removed` : ''}`);
});
