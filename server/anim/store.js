// Animation sets — authored on the site, stored on the server, played by games.
//
// The whole point of this system is that nothing is exported. An animation is
// keyframes on the canonical channels every rig already speaks (arm swing, leg
// swing, spine, and so on), so a set authored once can drive the boy, the girl,
// R6 or Steven, in one game or in all of them, and a game picks it up on its
// next load with no build step and no file passed around.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEase } from '../../shared/anim/ease.js';

const DATA_DIR = process.env.CLAUDEBOX_DATA_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'animations.json');

// Channels an animation may drive. Anything outside this list is dropped rather
// than stored, so a malformed set can never reach a game's render loop.
export const CHANNELS = [
  'armLS', 'armRS', 'armLL', 'armRL', 'foreL', 'foreR',
  'legLS', 'legRS', 'shinL', 'shinR', 'footL', 'footR',
  'spine', 'head', 'bob', 'rootPitch', 'rootX', 'rootZ',
];
// Poses a set may replace. These are the names the games ask for by state.
export const CLIPS = ['idle', 'walk', 'run', 'jump', 'fall', 'sit', 'swim', 'tread', 'climb', 'dance', 'death',
  // the four an animation pack supplies to the emote wheel
  'emote1', 'emote2', 'emote3', 'emote4'];
export const MODELS = ['any', 'boy', 'girl', 'r6', 'steven'];

// Props are scene objects an animation can carry: blocking cubes, spheres, and
// dummies (a fully rigged stand-in wearing someone's actual avatar). They get
// their own channels because a prop moves in space, where a limb only rotates.
export const PROP_KINDS = ['box', 'sphere', 'dummy'];
export const PROP_CHANNELS = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sc'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, max = 60) => String(v ?? '').slice(0, max);

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { sets: {} }; }
}
let db = load();
let dirty = false;
export function save() { dirty = true; }
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db));
  } catch (e) { console.error('[anim] save failed', e.message); }
}, 2000).unref?.();

/** Strip an incoming set down to exactly what the runtime can use. */
export function sanitizeSet(raw = {}, owner = '') {
  const clips = {};
  for (const name of CLIPS) {
    const c = raw.clips?.[name];
    if (!c || typeof c !== 'object') continue;
    const tracks = {};
    for (const ch of CHANNELS) {
      const keys = Array.isArray(c.tracks?.[ch]) ? c.tracks[ch] : null;
      if (!keys || !keys.length) continue;
      // keyframes are (time 0..1 through the clip, value in radians-ish, easing)
      const clean = keys
        .map((k) => ({
          t: clamp(num(k.t), 0, 1),
          v: clamp(num(k.v), -6.5, 6.5),
          e: isEase(k.e) ? k.e : 'smooth',
        }))
        .sort((a, b) => a.t - b.t)
        .slice(0, 64);
      if (clean.length) tracks[ch] = clean;
    }
    // prop tracks live beside the body's, keyed by prop id
    const pTracks = {};
    for (const [pid, pt] of Object.entries(c.props || {})) {
      if (!propIds.has(pid)) continue;          // drop tracks for deleted props
      const t = {};
      // A dummy is a character, not a crate: besides moving through space it
      // poses on the same canonical channels as the model being edited, so the
      // allowed set is the union for dummies and just the transform for solids.
      const isDummy = props.find((p) => p.id === pid)?.kind === 'dummy';
      const allowed = isDummy ? [...PROP_CHANNELS, ...CHANNELS] : PROP_CHANNELS;
      for (const ch of allowed) {
        const keys = Array.isArray(pt?.tracks?.[ch]) ? pt.tracks[ch] : null;
        if (!keys || !keys.length) continue;
        const clean = keys
          .map((k) => ({
            t: clamp(num(k.t), 0, 1),
            // transform channels travel in world units; pose channels are
            // radians and share the body's tighter clamp
            v: PROP_CHANNELS.includes(ch) ? clamp(num(k.v), -60, 60) : clamp(num(k.v), -6.5, 6.5),
            e: isEase(k.e) ? k.e : 'smooth',
          }))
          .sort((a, b) => a.t - b.t)
          .slice(0, 64);
        if (clean.length) t[ch] = clean;
      }
      if (Object.keys(t).length) pTracks[pid] = { tracks: t };
    }
    if (!Object.keys(tracks).length && !Object.keys(pTracks).length) continue;
    // Trim points, normalised 0..1 through the clip. Non-destructive: they say
    // which slice plays, so you can cut a fumbled start off without throwing the
    // keys away until you decide to.
    let tIn = clamp(num(c.trim?.in, 0), 0, 1);
    let tOut = clamp(num(c.trim?.out, 1), 0, 1);
    if (tOut - tIn < 0.02) { tIn = 0; tOut = 1; }      // a zero-width clip plays nothing
    clips[name] = {
      duration: clamp(num(c.duration, 1), 0.05, 20),
      // How fast this clip runs, per clip: a walk and an emote rarely want the
      // same tempo. Travels with the set, so a game plays it at the speed it
      // was authored at rather than the editor's preview rate.
      speed: clamp(num(c.speed, 1), 0.1, 4),
      loop: c.loop !== false,
      trim: { in: tIn, out: tOut },
      tracks,
      props: pTracks,
    };
  }
  // ---- scene props ----
  const props = (Array.isArray(raw.props) ? raw.props : []).slice(0, 16).map((p, i) => ({
    id: str(p?.id, 24) || `prop${i}`,
    kind: PROP_KINDS.includes(p?.kind) ? p.kind : 'box',
    name: str(p?.name, 28) || 'Prop',
    color: /^#[0-9a-fA-F]{6}$/.test(String(p?.color || '')) ? p.color : '#6ee7ff',
    size: clamp(num(p?.size, 1), 0.05, 20),
    // a dummy carries a body type and, optionally, whose outfit it is wearing
    model: MODELS.includes(p?.model) ? p.model : 'boy',
    who: str(p?.who, 24),
    clip: CLIPS.includes(p?.clip) ? p.clip : 'idle',
    // resting transform, before any keyframes
    at: {
      x: clamp(num(p?.at?.x, 0), -60, 60),
      y: clamp(num(p?.at?.y, 0), -60, 60),
      z: clamp(num(p?.at?.z, 0), -60, 60),
      ry: clamp(num(p?.at?.ry, 0), -Math.PI * 4, Math.PI * 4),
    },
  }));
  const propIds = new Set(props.map((p) => p.id));

  const scope = Array.isArray(raw.scope)
    ? raw.scope.map((g) => str(g, 24)).filter(Boolean).slice(0, 24)
    : 'global';
  // ---- marketplace fields ----
  // A set is a draft until its author lists it. Listing is what turns it into a
  // store item other players can buy; the sales counters live here too, because
  // the set IS the product and splitting them invites them to disagree.
  const prev = db.sets[str(raw.id, 40)] || {};
  const market = {
    listed: !!raw.market?.listed,
    title: str(raw.market?.title, 42) || str(raw.name, 42) || 'Untitled pack',
    blurb: str(raw.market?.blurb, 160),
    icon: str(raw.market?.icon, 8) || '🎬',
    // Priced in Bits. Capped so a listing cannot be used to park an absurd
    // number on someone's screen, and floored at 0 for free packs.
    price: Math.round(clamp(num(raw.market?.price, 50), 0, 100000)),
    tags: (Array.isArray(raw.market?.tags) ? raw.market.tags : [])
      .map((t) => str(t, 16)).filter(Boolean).slice(0, 4),
    // sales history is server-owned: a client may never write these
    sales: Math.max(0, Math.round(num(prev.market?.sales, 0))),
    earned: Math.max(0, Math.round(num(prev.market?.earned, 0))),
    listedAt: prev.market?.listedAt || (raw.market?.listed ? new Date().toISOString() : null),
  };

  return {
    id: str(raw.id, 40) || `set-${Date.now().toString(36)}`,
    name: str(raw.name, 48) || 'Untitled set',
    model: MODELS.includes(raw.model) ? raw.model : 'any',
    scope,
    published: !!raw.published,
    owner: str(owner, 24),
    props,
    market,
    updated: new Date().toISOString(),
    camera: {
      // the game-wide rule: how far the camera may sit from the head, and
      // whether it tracks head motion the animation itself produces
      followHead: !!raw.camera?.followHead,
      maxOffset: clamp(num(raw.camera?.maxOffset, 0.35), 0, 3),
      applyGlobally: !!raw.camera?.applyGlobally,
    },
    clips,
  };
}

export const allSets = () => Object.values(db.sets);
export const getSet = (id) => db.sets[id] || null;
export function putSet(set) { db.sets[set.id] = set; save(); return set; }
export function deleteSet(id) { delete db.sets[id]; save(); }

/** Every set its author has put up for sale. */
export const listedSets = () => allSets().filter((s) => s.market?.listed);

/** Record a purchase against a pack. Server-side only. */
export function recordSale(id, price) {
  const s = db.sets[id];
  if (!s || !s.market) return null;
  s.market.sales = (s.market.sales || 0) + 1;
  s.market.earned = (s.market.earned || 0) + Math.max(0, Math.round(price));
  save();
  return s;
}

/** What a given game should load: published sets scoped to it or to everything. */
export function setsForGame(game) {
  return allSets().filter((s) => s.published
    && (s.scope === 'global' || (Array.isArray(s.scope) && s.scope.includes(game))));
}
