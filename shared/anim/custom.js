// Playing authored animation sets.
//
// A set is keyframes on the canonical channels, so turning one into something
// the animator can run is just sampling those tracks at a phase. That is why a
// set authored once drives every rig: it never mentions a bone.

import { POSES } from './humanoid.js';

const smooth = (t) => t * t * (3 - 2 * t);

/** Sample one track at phase p (0..1), honouring each key's easing. */
function sampleTrack(keys, p) {
  if (!keys.length) return 0;
  if (keys.length === 1 || p <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (p >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= p) i++;
  const a = keys[i], b = keys[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  const raw = (p - a.t) / span;
  if (a.e === 'step') return a.v;
  const k = a.e === 'linear' ? raw : smooth(raw);
  return a.v + (b.v - a.v) * k;
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
    pack[poseName] = (c, t) => {
      // `t` is the animator's running phase; a clip decides how that maps onto
      // its own timeline, so a two-second clip is not forced into one cycle
      let p = (t % dur) / dur;
      if (!loop) p = Math.min(1, t / dur);
      for (const [ch, keys] of tracks) c[ch] = sampleTrack(keys, p);
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

/** The default poses, exposed so the editor can start from them. */
export const DEFAULT_POSES = POSES;
