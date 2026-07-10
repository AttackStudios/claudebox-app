// Elemental Tycoon — server state. Players get a plot on join; the economy
// (droppers/cash/unlocks) is client-run and relayed so others see your plot
// grow, while PvP (projectiles, hp, deaths) is server-authoritative.

import { PLOTS, MAX_HP } from '../../shared/tycoon/world.js';

let nextId = 1;
export const genId = (p) => `${p}${(nextId++).toString(36)}`;

export const state = {
  players: new Map(),      // id -> player
  plotOwners: new Map(),   // plotIndex -> playerId
  projectiles: [],         // { id, owner, ownerName, el, x,y,z, vx,vy,vz, dmg, r, until, kb }
};

export function clock() { return Date.now() / 1000; }

// Give the joining player the lowest free plot; if the ring is full, share the
// least-recently-used index so nobody is locked out.
export function assignPlot(p) {
  for (let i = 0; i < PLOTS.length; i++) {
    if (!state.plotOwners.has(i)) { state.plotOwners.set(i, p.id); return i; }
  }
  const i = (nextId - 1) % PLOTS.length;
  return i;
}
export function releasePlot(p) {
  if (p.plot != null && state.plotOwners.get(p.plot) === p.id) state.plotOwners.delete(p.plot);
}

export function spawnPos(p) {
  const plot = PLOTS[p.plot] ?? PLOTS[0];
  return { x: plot.x + (Math.random() * 4 - 2), y: 0, z: plot.z + (Math.random() * 4 - 2) };
}

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    pos: p.pos, ry: p.ry, anim: p.anim,
    plot: p.plot, unlocks: p.unlocks, element: p.element,
    hp: p.hp, dead: p.dead,
  };
}

export function makePlayer(ws) {
  return {
    id: genId('p'), ws, joined: false,
    name: '', nameLower: '', avatar: null,
    pos: { x: 0, y: 0, z: 0 }, ry: 0, anim: 'idle',
    plot: null, unlocks: [], element: null,
    hp: MAX_HP, dead: false, respawnAt: 0,
    lastCast: {},   // element id -> clock of last cast (server-side cooldown)
  };
}
