// Playing authored animation sets.
//
// A set is keyframes on the canonical channels, so turning one into something
// the animator can run is just sampling those tracks at a phase. That is why a
// set authored once drives every rig: it never mentions a bone.

import { POSES } from './humanoid.js';
import { ease } from './ease.js';



/**
 * Sample one track at phase p (0..1), honouring each key's easing.
 *
 * `loop` matters at the ends. The stretch between the last key and the first is
 * a real segment for a cycling clip — it just happens to cross t=1 — so it is
 * interpolated through. Holding the last value there and then snapping back to
 * the first is precisely what a visible loop seam is: a flat spot followed by a
 * jump. A one-shot clip still holds, because that is what a one-shot should do.
 */
function sampleTrack(keys, p, loop = true) {
  if (!keys.length) return 0;
  if (keys.length === 1) return keys[0].v;
  const first = keys[0], last = keys[keys.length - 1];
  if (p >= last.t || p <= first.t) {
    if (!loop) return p >= last.t ? last.v : first.v;
    const span = (1 - last.t) + first.t;
    if (span <= 1e-6) return first.v;
    if (last.e === 'step') return last.v;
    const raw = (p >= last.t ? p - last.t : p + 1 - last.t) / span;
    return last.v + (first.v - last.v) * ease(last.e, raw);
  }
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= p) i++;
  const a = keys[i], b = keys[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  const raw = (p - a.t) / span;
  if (a.e === 'step') return a.v;
  return a.v + (b.v - a.v) * ease(a.e, raw);
}

/**
 * Turn a stored set into a pack the humanoid animator can use: a map of
 * pose name -> function(channels, phase).
 */
export function packFromSet(set) {
  const pack = {};
  for (const [poseName, clip] of Object.entries(set.clips || {})) {
    const tracks = Object.entries(clip.tracks || {});
    if (!tracks.length) continue;
    const dur = clip.duration || 1;
    const loop = clip.loop !== false;
    // A trimmed clip plays only its kept slice, and loops within it. The phase
    // still runs 0..1 over the WHOLE clip so the keys need no remapping — the
    // trim just decides which part of that the runtime ever visits.
    const tIn = clip.trim?.in ?? 0;
    const tOut = clip.trim?.out ?? 1;
    const span = Math.max(0.02, tOut - tIn);
    // Speed shortens the wall-clock time a cycle takes. Dividing here rather
    // than scaling the phase keeps trim and looping working unchanged.
    const spd = Math.max(0.1, Math.min(4, clip.speed || 1));
    pack[poseName] = (c, t) => {
      // `t` is the animator's running phase; a clip decides how that maps onto
      // its own timeline, so a two-second clip is not forced into one cycle
      const scaled = (dur * span) / spd;
      let k = (t % scaled) / scaled;
      if (!loop) k = Math.min(1, t / scaled);
      const p = tIn + k * span;
      for (const [ch, keys] of tracks) c[ch] = sampleTrack(keys, p, loop);
    };
  }
  return pack;
}

/** Merge several sets into one pack. Later sets win, so scope beats global. */
export function packFromSets(sets, model) {
  const out = {};
  for (const s of sets) {
    if (s.model && s.model !== 'any' && s.model !== model) continue;
    Object.assign(out, packFromSet(s));
  }
  return out;
}

/** The strongest camera rule across the applicable sets, or null. */
export function cameraRuleFor(sets) {
  let rule = null;
  for (const s of sets) {
    const c = s.camera;
    if (!c?.followHead) continue;
    // carry followHead explicitly: consumers check the field, and a rule that
    // only implied it by existing silently did nothing
    if (!rule || c.maxOffset < rule.maxOffset) {
      rule = { followHead: true, maxOffset: c.maxOffset, applyGlobally: !!c.applyGlobally };
    }
  }
  return rule;
}

/** Fetch and build the pack a game should run. Never throws; games must boot. */
export async function loadGameAnimations(game, model = 'any') {
  try {
    const r = await fetch(`/api/anim/for/${encodeURIComponent(game)}`, {
      headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' },
    });
    const j = await r.json();
    const sets = Array.isArray(j.sets) ? j.sets : [];
    return { pack: packFromSets(sets, model), camera: cameraRuleFor(sets), sets };
  } catch {
    return { pack: {}, camera: null, sets: [] };
  }
}

/**
 * Load one community animation pack by id and build a playable pack from it.
 * This is what a bought-and-equipped pack runs through — the same sampling as
 * a game-wide set, just addressed by id instead of by scope.
 */
const packCache = new Map();
export async function loadPack(id) {
  if (!id) return null;
  if (packCache.has(id)) return packCache.get(id);
  const p = (async () => {
    try {
      const r = await fetch(`/api/anim/pack/${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!j.pack) return null;
      return { pack: packFromSet(j.pack), meta: j.pack };
    } catch { return null; }
  })();
  packCache.set(id, p);
  return p;
}

/** The default poses, exposed so the editor can start from them. */
export const DEFAULT_POSES = POSES;
