// Backpacking server state: players, shared vans, bears, placed items,
// the day clock, and persistence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAR_SPAWNS, height } from '../../shared/bp/worldgen.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'backpacking.json');

export const DAY_LENGTH = 480; // seconds for a full day/night cycle

let nextId = 1;
export const genId = (p) => `${p}${(nextId++).toString(36)}`;

function loadSaves() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { items: raw.items || {}, profiles: raw.profiles || {} };
  } catch {
    return { items: {}, profiles: {} };
  }
}

export const state = {
  players: new Map(),   // id -> { id, ws, joined, name, nameLower, avatar, pos, ry, anim, dead, vanId, seat }
  bears: new Map(),     // id -> bear
  vans: CAR_SPAWNS.map((c, i) => ({
    id: 'van' + i,
    home: { x: c.x, z: c.z, ry: c.ry },
    x: c.x, y: height(c.x, c.z), z: c.z, ry: c.ry, pitch: 0, roll: 0, speed: 0,
    seats: [null, null, null, null, null, null], // seat 0 = driver
    emptySince: Date.now(),
  })),
  saves: loadSaves(),   // { items: { id: {...} }, profiles: { nameLower: {...} } }
};

// Per-camper progress, keyed by lowercased name so it survives reconnects and
// follows you between sessions. Marshmallows are Backpacking's own currency —
// deliberately separate from the platform wallet, like the original game.
export function profileOf(nameLower) {
  let pr = state.saves.profiles[nameLower];
  if (!pr) {
    pr = { marshmallows: 0, caught: {}, records: {}, owned: [], badges: [], casts: 0 };
    state.saves.profiles[nameLower] = pr;
  }
  pr.marshmallows = Math.max(0, Math.floor(pr.marshmallows || 0));
  pr.caught = pr.caught || {};      // fishId -> times caught
  pr.records = pr.records || {};    // fishId -> biggest cm
  pr.owned = pr.owned || [];        // shop item ids
  pr.badges = pr.badges || [];
  pr.casts = pr.casts || 0;
  return pr;
}

export function publicProfile(pr) {
  return {
    marshmallows: pr.marshmallows,
    caught: pr.caught,
    records: pr.records,
    owned: pr.owned,
    badges: pr.badges,
  };
}

let saveTimer = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state.saves, null, 1));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error('[bp save] failed:', err.message);
    }
  }, 1500);
}

export function clock01() {
  return (Date.now() / 1000 % DAY_LENGTH) / DAY_LENGTH;
}

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    pos: p.pos, ry: p.ry, anim: p.anim,
    dead: p.dead, vanId: p.vanId, seat: p.seat,
  };
}

export function publicVan(v) {
  return {
    id: v.id, x: v.x, y: v.y, z: v.z, ry: v.ry,
    pitch: v.pitch, roll: v.roll, speed: v.speed, seats: v.seats,
  };
}

export function publicBear(b) {
  return { id: b.id, x: b.x, y: b.y, z: b.z, ry: b.ry, anim: b.anim, variant: b.variant };
}
