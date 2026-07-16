// Pizza Works server state: players, walk-in customers, the order pipeline,
// shared cars, ingredient bins, and per-player lifetime earnings (persisted).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINS, BIN_MAX, CARS } from '../../shared/pizza/world.js';

let nextId = 1;
export const genId = (p = 'pz') => `${p}${(nextId++).toString(36)}`;

const DATA_DIR = process.env.CLAUDEBOX_DATA_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'pizza.json');

function loadSaves() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { cash: {} }; }
}

export const state = {
  players: new Map(),                  // ws id -> player
  npcs: new Map(),                     // id -> customer
  orders: new Map(),                   // id -> order
  ovens: new Map(),                    // ovenId -> { orderId, doneAt }
  bench: [],                           // cooked pizzas waiting to be boxed [orderId]
  boxing: null,                        // { orderId, by, doneAt }
  shelf: [],                           // boxed orders waiting for a driver [orderId]
  cars: CARS.map((c) => ({ ...c, driver: null })),
  bins: Object.fromEntries(BINS.map((b) => [b.id, BIN_MAX])),
  saves: loadSaves(),
  lastCustomerAt: 0,
};

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(state.saves));
    } catch {}
  }, 400);
}

export function clock() { return Date.now() / 1000; }

export function cashOf(nameLower) { return Math.max(0, Math.round(state.saves.cash?.[nameLower] || 0)); }
export function addCash(nameLower, amt) {
  if (!state.saves.cash) state.saves.cash = {};
  state.saves.cash[nameLower] = cashOf(nameLower) + amt;
  save();
  return state.saves.cash[nameLower];
}

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    pos: p.pos, ry: p.ry, anim: p.anim,
    job: p.job, carry: p.carry ? { kind: p.carry.kind, orderId: p.carry.orderId || null } : null,
    carId: p.carId || null, cash: cashOf(p.nameLower),
  };
}

export function publicOrder(o) {
  return { id: o.id, steps: o.steps, next: o.stepAt, stage: o.stage, chef: o.chefName || null, house: o.house || null };
}

export function publicNpc(n) {
  return { id: n.id, name: n.name, x: +n.x.toFixed(2), z: +n.z.toFixed(2), ry: +n.ry.toFixed(2), anim: n.anim, avatar: n.avatar };
}
