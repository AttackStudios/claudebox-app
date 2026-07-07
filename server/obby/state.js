// Obby server state: players, admin roles (persisted), and a shared clock for
// moving obstacles. AttackFace15 is the permanent default Owner.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'obby.json');

export const OWNER_DEFAULT = 'attackface15';

let nextId = 1;
export const genId = (p) => `${p}${(nextId++).toString(36)}`;

function loadRoles() {
  let roles = {};
  try { roles = JSON.parse(fs.readFileSync(FILE, 'utf8')).roles || {}; } catch {}
  roles[OWNER_DEFAULT] = 'owner';   // always
  return roles;
}

export const state = {
  players: new Map(),   // id -> player
  roles: loadRoles(),   // nameLower -> 'owner' | 'staff'
};

let saveTimer = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ roles: state.roles }, null, 1));
      fs.renameSync(tmp, FILE);
    } catch (err) { console.error('[obby save]', err.message); }
  }, 1000);
}

export function roleOf(nameLower) {
  return state.roles[nameLower] || 'player';
}
export function isStaff(nameLower) {
  const r = roleOf(nameLower);
  return r === 'owner' || r === 'staff';
}

export function clock() { return Date.now() / 1000; }

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    pos: p.pos, ry: p.ry, anim: p.anim,
    role: p.role, scale: p.scale, flying: p.flying, dead: p.dead, stage: p.stage,
  };
}
