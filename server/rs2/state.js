// RS2 server state + persistence. Restaurants are keyed by plot id and
// persist (layout, styles, staff, menu, music, rating, owners). Player
// records persist cash + plot/house assignment.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLOTS, HOUSES } from '../../shared/rs2/world.js';
import { templateLayout, FREE_DISHES } from '../../shared/rs2/catalog.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'rs2.json');

// music tracks come from whatever MP3s live in the game's audio folder
const AUDIO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'restaurant-sim-2', 'audio');
export const TRACKS = (() => {
  try {
    return fs.readdirSync(AUDIO_DIR).filter((f) => f.toLowerCase().endsWith('.mp3')).map((f) => ({
      id: f.replace(/\.mp3$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label: f.replace(/\.mp3$/i, '').replace(/Restaurant Tycoon 2 Music[_:]?\s*/i, '').trim() || f,
      url: '/restaurant-sim-2/audio/' + encodeURIComponent(f),
    }));
  } catch { return []; }
})();

let nextId = 1;
export const genId = (p) => `${p}${(nextId++).toString(36)}`;

function loadSaves() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { players: raw.players || {}, restaurants: raw.restaurants || {} };
  } catch {
    return { players: {}, restaurants: {} };
  }
}

export const state = {
  players: new Map(),     // live sessions: id -> { id, ws, joined, name, nameLower, avatar, pos, ry, anim, carryOrder, riding }
  orders: new Map(),      // orderId -> order
  customers: new Map(),   // npcId -> customer/staff bot entity (sim.js owns)
  piles: new Map(),       // pileId -> { plotId, tableId, amount, x, z }
  saves: loadSaves(),
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
      console.error('[rs2 save] failed:', err.message);
    }
  }, 1200);
}

export function playerRec(nameLower) {
  return state.saves.players[nameLower] || null;
}

export function restaurantOf(nameLower) {
  for (const [plotId, r] of Object.entries(state.saves.restaurants)) {
    if (r.owners.includes(nameLower)) return { plotId: Number(plotId), r };
  }
  return null;
}

export function ensurePlayer(name) {
  const nameLower = name.toLowerCase();
  let rec = state.saves.players[nameLower];
  if (!rec) {
    rec = { name, cash: 1000, houseId: nextFreeHouse() };
    state.saves.players[nameLower] = rec;
    // assign a plot + template restaurant unless they're already a co-owner
    if (!restaurantOf(nameLower)) {
      const plotId = nextFreePlot();
      if (plotId != null) {
        state.saves.restaurants[plotId] = freshRestaurant(name, nameLower);
      }
    }
    save();
  }
  return rec;
}

export function freshRestaurant(displayName, nameLower) {
  return {
    name: `${displayName}'s Diner`,
    owners: [nameLower],
    expansion: 0,
    wall: '#e8dcc8',
    floor: 'wood',
    awning: '#c0564a',
    music: null,
    items: templateLayout(),
    nextItem: 100,
    unlocked: [...FREE_DISHES],
    menu: [...FREE_DISHES].slice(0, 6),
    staff: {},            // { waiter: {tier}, chef: {tier}, delivery: {tier} }
    rating: 3.0,
    served: 0,
  };
}

function nextFreePlot() {
  for (const p of PLOTS) {
    if (!state.saves.restaurants[p.id]) return p.id;
  }
  return null;
}

function nextFreeHouse() {
  const taken = new Set(Object.values(state.saves.players).map((p) => p.houseId));
  for (const h of HOUSES) if (!taken.has(h.id)) return h.id;
  return HOUSES[Math.floor(Math.random() * HOUSES.length)].id; // share if full
}

export function publicPlayer(p) {
  const rec = playerRec(p.nameLower);
  const rest = restaurantOf(p.nameLower);
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    pos: p.pos, ry: p.ry, anim: p.anim,
    carryOrder: p.carryOrder || null, riding: p.riding || null,
    plotId: rest ? rest.plotId : null, houseId: rec?.houseId ?? null,
  };
}

export function publicRestaurants() {
  const out = {};
  for (const [plotId, r] of Object.entries(state.saves.restaurants)) {
    out[plotId] = r;
  }
  return out;
}

export function publicOrder(o) {
  return {
    id: o.id, plotId: o.plotId, dishId: o.dishId, type: o.type,
    state: o.state, stepIdx: o.stepIdx, steps: o.steps.length,
    tableId: o.tableId ?? null, houseId: o.houseId ?? null,
    forName: o.forName ?? null, customerId: o.customerId ?? null,
    carrier: o.carrier ?? null, pay: o.pay,
  };
}
