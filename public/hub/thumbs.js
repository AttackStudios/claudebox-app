// Item thumbnails, rendered rather than drawn.
//
// The marketplace and the editor both show a grid of what things actually look
// like. Since every item in this catalogue is built from code at runtime, the
// honest way to picture one is to put it on a body and take a photograph — so
// that is what this does: one shared offscreen renderer, one small camera move
// per item, cached by key.
//
// Rendering ~60 of these up front would stall the tab, so callers ask for a
// thumbnail only when a card actually scrolls into view.

import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';

const SIZE = 220;
const cache = new Map();      // key -> dataURL
const pending = new Map();    // key -> Promise
let rig = null;

function stage() {
  if (rig) return rig;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  // Matches the flat grey the real cards sit on, so a thumbnail blends into the
  // card instead of sitting on a visible tile of its own.
  scene.add(new THREE.AmbientLight('#ffffff', 2.1));
  const key = new THREE.DirectionalLight('#fff6e8', 2.2); key.position.set(2.5, 4, 4); scene.add(key);
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.9); fill.position.set(-3, 1.5, -2); scene.add(fill);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
  rig = { canvas, renderer, scene, cam, ctrl: null };
  return rig;
}

// where to point the camera for each kind of item
const FRAMING = {
  head:  { y: 1.70, dist: 1.62, pitch: 0.05 },
  face:  { y: 1.68, dist: 1.30, pitch: 0.03 },
  torso: { y: 1.18, dist: 2.15, pitch: 0.06 },
  back:  { y: 1.2,  dist: 2.3,  pitch: 0.1, turn: Math.PI * 0.82 },
  feet:  { y: 0.26, dist: 1.25, pitch: 0.25 },
  full:  { y: 1.0,  dist: 3.5,  pitch: 0.07 },
};

/**
 * Render one item on a body and return a data URL.
 *   key     cache key
 *   profile the avatar profile to build (usually a bare body + the one item)
 *   frame   which FRAMING entry to use
 */
export async function itemThumb(key, profile, frame = 'full', pose = 'idle') {
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    await preloadAvatars(['boy', 'girl', 'r6']);
    const s = stage();
    if (s.ctrl) { s.scene.remove(s.ctrl.group); s.ctrl.dispose?.(); }
    let ctrl;
    try { ctrl = makeAvatar(profile); } catch { return ''; }
    ctrl.setAnim(pose);
    ctrl.moveSpeed = 8;
    // run the pose forward to a readable point in its cycle rather than
    // catching it at rest, which is where every animation looks the same
    const settle = pose === 'walk' || pose === 'run' ? 13 : 20;
    for (let i = 0; i < settle; i++) ctrl.update(1 / 60);
    s.scene.add(ctrl.group);
    s.ctrl = ctrl;

    const f = FRAMING[frame] || FRAMING.full;
    const turn = f.turn ?? Math.PI * 0.12;
    ctrl.group.rotation.y = turn;
    s.cam.position.set(Math.sin(0) * f.dist, f.y + f.pitch * f.dist, Math.cos(0) * f.dist);
    s.cam.lookAt(0, f.y, 0);
    s.renderer.render(s.scene, s.cam);
    const url = s.canvas.toDataURL('image/png');
    cache.set(key, url);
    pending.delete(key);
    return url;
  })();
  pending.set(key, job);
  return job;
}

/** Fill a card's thumbnail once it scrolls into view. */
export function lazyThumb(el, key, profile, frame, pose) {
  const io = new IntersectionObserver(async (entries, obs) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    obs.disconnect();
    const url = await itemThumb(key, profile, frame, pose);
    if (!url) return;
    const img = document.createElement('img');
    img.src = url; img.alt = '';
    el.innerHTML = '';
    el.appendChild(img);
  }, { rootMargin: '220px' });
  io.observe(el);
  return () => io.disconnect();
}
