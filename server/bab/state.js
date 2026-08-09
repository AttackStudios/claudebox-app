// Build A Boat For Treasure — server state.
// Every player gets a numbered plot on the dock. Building and sailing are
// simulated on the client (same client-authoritative model the rest of the
// platform uses); the server owns plot assignment and relays boats so you can
// watch everyone else's contraption fall apart alongside yours.

import { PLOT } from '../../shared/bab/config.js';

let nextId = 1;
export const genId = (p) => `${p}${(nextId++).toString(36)}`;

export const PLOT_COUNT = 8;
export const PLOT_GAP = PLOT.w + 7;

// plots sit in a row along the dock, all facing down the river
export const plotOrigin = (i) => ({ x: (i - (PLOT_COUNT - 1) / 2) * PLOT_GAP, z: -16 });

export const state = {
  players: new Map(),      // id -> player
  plotOwners: new Map(),   // plotIndex -> playerId
};

export function clock() { return Date.now() / 1000; }

export function assignPlot(p) {
  for (let i = 0; i < PLOT_COUNT; i++) {
    if (!state.plotOwners.has(i)) { state.plotOwners.set(i, p.id); return i; }
  }
  return (nextId - 1) % PLOT_COUNT;   // full house: double up rather than lock anyone out
}
export function releasePlot(p) {
  if (p.plot != null && state.plotOwners.get(p.plot) === p.id) state.plotOwners.delete(p.plot);
}

export function makePlayer(ws) {
  return {
    id: genId('p'), ws, joined: false,
    name: '', nameLower: '', avatar: null,
    plot: null,
    pos: { x: 0, y: 1, z: -16 }, ry: 0, anim: 'idle',
    sailing: false, dist: 0, blocks: 0, sunk: false,
    boat: null,          // last published block list, so joiners see it
    launchedAt: 0,
  };
}

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar, plot: p.plot,
    pos: p.pos, ry: p.ry, anim: p.anim,
    sailing: p.sailing, dist: p.dist, blocks: p.blocks, sunk: p.sunk,
  };
}
