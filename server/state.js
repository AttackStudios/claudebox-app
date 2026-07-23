// Live game state. The server is authoritative for everything except
// player movement (clients report their own positions — fine on a friendly LAN).

import { loadSaves, scheduleSave } from './save.js';

let nextId = 1;
export const genId = (prefix) => `${prefix}${(nextId++).toString(36)}`;

export const state = {
  players: new Map(),   // id -> player
  items: new Map(),     // id -> { id, kind, x, y, z, heldBy }
  npcs: new Map(),      // id -> npc
  offspring: new Map(), // id -> AI baby (see offspring.js)
  saves: loadSaves(),   // { players: {nameLower: {...}}, flocks: {name: {...}} }
};

export function save() {
  scheduleSave(state.saves);
}

export function playerByName(nameLower) {
  for (const p of state.players.values()) {
    if (p.nameLower === nameLower) return p;
  }
  return null;
}

export function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    creatureName: p.creatureName || '',
    description: p.description || '',
    realm: p.realm || '',
    feathers: p.feathers || 0,
    bird: p.bird,
    nameStyle: p.nameStyle,
    pos: p.pos,
    ry: p.ry,
    anim: p.anim,
    carrying: p.carrying,
    carriedBy: p.carriedBy,
    flock: p.flock,
    flockRole: flockRoleLabel(p),
    nest: state.saves.players[p.nameLower]?.nest || null,
  };
}

// The role shown over a bird's head: Leader for the flock leader, otherwise
// the assigned role from the flock's roles map (default "Member").
export function flockRoleLabel(p) {
  if (!p.flock) return '';
  const f = state.saves.flocks[p.flock];
  if (!f) return '';
  if (f.leader === p.nameLower) return 'Leader';
  return (f.roles && f.roles[p.nameLower]) || 'Member';
}

export function flockOf(p) {
  return p.flock ? state.saves.flocks[p.flock] : null;
}

export function publicFlock(name) {
  const f = state.saves.flocks[name];
  if (!f) return null;
  return { name, color: f.color, leader: f.leader, members: f.members, roles: f.roles || {} };
}
