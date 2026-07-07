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
    return { items: raw.items || {} };
  } catch {
    return { items: {} };
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
  saves: loadSaves(),   // { items: { id: { owner, kind, x, y, z, ry, color } } }
};

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
