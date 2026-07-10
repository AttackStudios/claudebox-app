// Web Rush — server state. Movement + swinging are client-authoritative (like
// the rest of the platform); the server relays positions + web anchors so
// everyone sees each other swinging.
import { SPAWN } from '../../shared/webrush/city.js';

let nextId = 1;
export const genId = (p) => `${p}${(nextId++).toString(36)}`;
export const state = { players: new Map() };
export function clock() { return Date.now() / 1000; }

export function spawnPos() { return { x: SPAWN.x + (Math.random() * 20 - 10), y: SPAWN.y, z: SPAWN.z + (Math.random() * 20 - 10) }; }

export function publicPlayer(p) {
  return { id: p.id, name: p.name, avatar: p.avatar, pos: p.pos, ry: p.ry, anim: p.anim, web: p.web || null };
}
