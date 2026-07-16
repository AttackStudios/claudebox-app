// First-person zoom, shared by every game: when the camera zooms all the way
// in, the player's own character fades to transparent and the view becomes
// first-person. Games call fpFade(root, dist) every frame with their camera
// distance; the helper handles material fading + restore.
//
//   import { fpFade } from '/js/fpzoom.js';
//   const t = fpFade(me.group, camDist);   // t: 0 = first-person, 1 = normal
//
// Returns the visibility fraction so callers can e.g. hide a nametag or
// switch aim origin when t hits 0.

const cache = new WeakMap();

function collect(root) {
  const rec = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m) rec.push({ m, transparent: m.transparent, opacity: m.opacity ?? 1, depthWrite: m.depthWrite });
    }
  });
  return rec;
}

export function fpFade(root, dist, opts = {}) {
  const near = opts.near ?? 1.15;    // fading starts below this camera distance
  const full = opts.full ?? 0.45;    // fully first-person at / below this
  if (!root) return 1;
  const t = Math.max(0, Math.min(1, (dist - full) / (near - full)));
  let state = cache.get(root);
  if (t >= 1) {
    // fast path: fully visible — restore once, then do nothing
    if (state && state.faded) {
      for (const r of state.rec) { r.m.transparent = r.transparent; r.m.opacity = r.opacity; r.m.depthWrite = r.depthWrite; }
      state.faded = false;
    }
    if (root.visible === false) root.visible = true;
    return 1;
  }
  // re-collect if the rig changed since last time (clothing swap, respawn)
  let meshCount = 0;
  root.traverse((o) => { if (o.isMesh || o.isSprite) meshCount++; });
  if (!state || state.meshCount !== meshCount) {
    state = { rec: collect(root), meshCount, faded: false };
    cache.set(root, state);
  }
  for (const r of state.rec) {
    r.m.transparent = true;
    r.m.opacity = r.opacity * t;
    r.m.depthWrite = false;
  }
  state.faded = true;
  root.visible = t > 0.02;
  return t;
}
