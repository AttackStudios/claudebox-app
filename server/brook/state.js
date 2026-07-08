// Brooktown RP server state. Movement is client-authoritative (the server just
// relays positions); it owns car ownership + car transforms.

import { CARS } from '../../shared/brook/town.js';

let nextId = 1;
export const genId = (p) => `${p}${(nextId++).toString(36)}`;

export const state = {
  players: new Map(),   // id -> player
  // car id -> { id, x, z, ry, driver }
  cars: new Map(CARS.map((c) => [c.id, { id: c.id, x: c.x, z: c.z, ry: c.ry, driver: null }])),
};

export function clock() { return Date.now() / 1000; }

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    pos: p.pos, ry: p.ry, anim: p.anim,
    carId: p.carId || null,
  };
}
