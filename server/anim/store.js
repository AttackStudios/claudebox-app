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
export const CLIPS = ['idle', 'walk', 'run', 'jump', 'fall', 'sit', 'swim', 'tread', 'climb', 'dance', 'death'];
export const MODELS = ['any', 'boy', 'girl', 'r6', 'steven'];

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
          e: k.e === 'linear' || k.e === 'step' ? k.e : 'smooth',
        }))
        .sort((a, b) => a.t - b.t)
        .slice(0, 64);
      if (clean.length) tracks[ch] = clean;
    }
    if (!Object.keys(tracks).length) continue;
    clips[name] = {
      duration: clamp(num(c.duration, 1), 0.05, 20),
      loop: c.loop !== false,
      tracks,
    };
  }
  const scope = Array.isArray(raw.scope)
    ? raw.scope.map((g) => str(g, 24)).filter(Boolean).slice(0, 24)
    : 'global';
  return {
    id: str(raw.id, 40) || `set-${Date.now().toString(36)}`,
    name: str(raw.name, 48) || 'Untitled set',
    model: MODELS.includes(raw.model) ? raw.model : 'any',
    scope,
    published: !!raw.published,
    owner: str(owner, 24),
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

/** What a given game should load: published sets scoped to it or to everything. */
export function setsForGame(game) {
  return allSets().filter((s) => s.published
    && (s.scope === 'global' || (Array.isArray(s.scope) && s.scope.includes(game))));
}
