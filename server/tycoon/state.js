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
  if (p.isBot) return { x: Math.random() * 50 - 25, y: 0, z: Math.random() * 50 - 25 };
  const plot = PLOTS[p.plot] ?? PLOTS[0];
  return { x: plot.x + (Math.random() * 4 - 2), y: 0, z: plot.z + (Math.random() * 4 - 2) };
}

// ---- AI bots that roam the centre arena and fight players ----
export const BOTS = [];
const BOT_NAMES = ['Blaze', 'Aqua', 'Boulder', 'Gale', 'Sparky', 'Cinder'];
const BOT_ELEMENTS = ['fire', 'water', 'earth', 'air', 'lightning', 'fire'];
const BOT_LOOKS = [
  { body: 'a', shirtColor: '#e0503c', pantsColor: '#3a2a2a', hair: 'short', hairColor: '#2a1a1a', hat: 'horns', hatColor: '#8a1b1b' },
  { body: 'a', shirtColor: '#2a86e0', pantsColor: '#243a4d', hair: 'short', hairColor: '#123', hat: 'none' },
  { body: 'a', shirtColor: '#7a5a34', pantsColor: '#3a2e1e', hair: 'short', hairColor: '#3a2a12', hat: 'none' },
  { body: 'girl', shirtColor: '#bfeaff', pantsColor: '#88b0c0', hair: 'long', hairColor: '#dfe8ff', hat: 'none' },
  { body: 'a', shirtColor: '#ffd23f', pantsColor: '#3a3520', hair: 'short', hairColor: '#a08010', hat: 'none' },
  { body: 'a', shirtColor: '#e0503c', pantsColor: '#2a2a2a', hair: 'short', hairColor: '#331', hat: 'cap', hatColor: '#111' },
];

function makeBot(i) {
  const name = '🤖 ' + BOT_NAMES[i % BOT_NAMES.length];
  const el = BOT_ELEMENTS[i % BOT_ELEMENTS.length];
  const b = {
    id: genId('bot'), ws: null, joined: true, isBot: true,
    name, nameLower: name.toLowerCase(), avatar: BOT_LOOKS[i % BOT_LOOKS.length],
    pos: { x: Math.random() * 40 - 20, y: 0, z: Math.random() * 40 - 20 }, ry: 0, anim: 'idle',
    plot: null, unlocks: [el], element: el,
    hp: MAX_HP, dead: false, respawnAt: 0, lastCast: {},
    ai: { seed: Math.random() * 6.28, tWander: 0, tx: 0, tz: 0 },
  };
  return b;
}
export function spawnBots(n = 3) {
  for (let i = 0; i < n; i++) { const b = makeBot(i); state.players.set(b.id, b); BOTS.push(b); }
}

// three practice bots always roam the arena
spawnBots(3);

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
