// RS2 server simulation, ticked at 12Hz: NPC customers (arrive → seat →
// order → wait → eat → pay → leave), staff bots (waiter / chef / delivery),
// rating drift, NPC house orders, and the cash trickle.

import { state, genId, save, publicOrder } from './state.js';
import { DISHES, STAFF, stationSpeed, ITEMS } from '../../shared/rs2/catalog.js';
import { PLOTS, HOUSES, buildingFrame } from '../../shared/rs2/world.js';

const rng = Math.random;

// set by server/index.js so spawns announce themselves
let simBroadcast = () => {};
export function setSimBroadcast(fn) { simBroadcast = fn; }

// ---------- helpers over restaurant layouts ----------
function frameFor(plotId, r) {
  return buildingFrame(PLOTS[plotId], r.expansion);
}

// world position of an item's grid cell
function itemWorld(plotId, r, item) {
  const f = frameFor(plotId, r);
  const def = ITEMS[item.kind];
  const w = item.rot % 2 ? def.d : def.w;
  const d = item.rot % 2 ? def.w : def.d;
  const a = f.cellToWorld(item.gx, item.gz);
  const b = f.cellToWorld(item.gx + w - 1, item.gz + d - 1);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function tablesOf(plotId, r) {
  return Object.entries(r.items).filter(([, it]) => ITEMS[it.kind]?.seats);
}

function stationsOf(plotId, r, type) {
  return Object.entries(r.items).filter(([, it]) => ITEMS[it.kind]?.station === type);
}

function ownersOnline(r) {
  for (const p of state.players.values()) {
    if (p.joined && r.owners.includes(p.nameLower)) return true;
  }
  return false;
}

function isOpen(r) {
  // open if an owner is online, or fully bot-staffed (chef + waiter)
  return ownersOnline(r) || (r.staff.chef && r.staff.waiter);
}

// which tables are free (no live customer assigned)
function freeTable(plotId, r) {
  const occupied = new Set();
  for (const c of state.customers.values()) {
    if (c.kind === 'customer' && c.plotId === plotId && c.tableId) occupied.add(c.tableId);
  }
  const tables = tablesOf(plotId, r).filter(([id]) => !occupied.has(id));
  return tables.length ? tables[Math.floor(rng() * tables.length)] : null;
}

// ---------- NPC bodies ----------
const SKINS = ['#f5d3b3', '#e8b48a', '#c98e62', '#9a6844', '#6e4a30'];
const COLORS = ['#c0564a', '#4a7ec0', '#4f8a55', '#c08ec5', '#d9c95c', '#e8902a', '#5a6a7a'];
function randomAvatar() {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return {
    body: rng() > 0.5 ? 'a' : 'b', skin: pick(SKINS),
    hair: pick(['short', 'long', 'spiky', 'bun', 'curly']), hairColor: pick(['#2a2a2e', '#5d4037', '#8a5a30', '#caa84e', '#7a7a82']),
    shirt: pick(['tee', 'hoodie', 'jacket', 'tank']), shirtColor: pick(COLORS),
    pants: pick(['long', 'shorts']), pantsColor: pick(['#3a4a5d', '#2e3138', '#6e5a4a']),
    shoes: 'sneakers', shoeColor: '#2e3138',
    hat: rng() > 0.8 ? pick(['cap', 'beanie']) : 'none', hatColor: pick(COLORS),
    face: pick(['happy', 'cool', 'surprised']),
  };
}

function spawnNpc(kind, plotId, x, z, extra = {}) {
  const npc = {
    id: genId('n'), kind, plotId,
    avatar: extra.avatar || randomAvatar(),
    x, z, y: 2.05, ry: 0,
    anim: 'idle', target: null, speed: 3.2,
    state: 'idle', stateT: 0,
    ...extra,
  };
  state.customers.set(npc.id, npc);
  simBroadcast({ t: 'npc.add', npc: npcPublicSim(npc) });
  return npc;
}

function walkTo(npc, x, z) {
  npc.target = { x, z };
  npc.anim = 'walk';
}

// queue a multi-point route (e.g. through the door, not through walls)
function walkPath(npc, points) {
  npc.path = points.slice(1);
  walkTo(npc, points[0].x, points[0].z);
}

function doorPoints(plotId, r) {
  const f = frameFor(plotId, r);
  const door = f.doorWorld();
  return {
    outside: { x: door.x, z: door.z + f.f * 2.4 },
    inside: { x: door.x, z: door.z - f.f * 1.8 },
  };
}

// find a chair adjacent to the table so customers actually sit on seats
function seatFor(plotId, r, tableId, tItem) {
  const tableW = itemWorld(plotId, r, tItem);
  let best = null, bd = 2.6;
  for (const [, it] of Object.entries(r.items)) {
    if (it.kind !== 'chair') continue;
    const cw = itemWorld(plotId, r, it);
    const d = Math.hypot(cw.x - tableW.x, cw.z - tableW.z);
    if (d < bd) { bd = d; best = cw; }
  }
  const seat = best || { x: tableW.x + 1.1, z: tableW.z };
  return { seat, faceRy: Math.atan2(tableW.x - seat.x, tableW.z - seat.z), tableW };
}

function stepNpc(npc, dt) {
  if (!npc.target) return false;
  const dx = npc.target.x - npc.x, dz = npc.target.z - npc.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) {
    if (npc.path && npc.path.length) {
      const next = npc.path.shift();
      walkTo(npc, next.x, next.z);
      return false;
    }
    npc.target = null;
    npc.anim = 'idle';
    return true;
  }
  npc.ry = Math.atan2(dx, dz);
  npc.x += (dx / d) * npc.speed * dt;
  npc.z += (dz / d) * npc.speed * dt;
  return false;
}

// ---------- orders ----------
export function createOrder({ plotId, dishId, type, tableId, customerId, houseId, forName, payBonus = 0 }) {
  const dish = DISHES[dishId];
  const order = {
    id: genId('o'), plotId, dishId, type,
    steps: dish.steps, stepIdx: 0,
    state: 'queued',           // queued → cooking (per-step) → ready → served/intransit → done
    tableId, customerId, houseId, forName,
    pay: dish.price + payBonus,
    claimedBy: null,           // chef bot working on it
    stationBusyUntil: 0,
    createdAt: Date.now(),
  };
  state.orders.set(order.id, order);
  return order;
}

export function orderStepDone(order) {
  order.stepIdx++;
  if (order.stepIdx >= order.steps.length) {
    order.state = 'ready';
    order.claimedBy = null;
  } else {
    order.state = 'queued';
  }
}

// ---------- the tick ----------
let trickleAcc = 0;

export function tickRS2(dt, ctx) {
  const { broadcast } = ctx;

  // cash trickle: +5 every 10s to every online player
  trickleAcc += dt;
  if (trickleAcc >= 10) {
    trickleAcc -= 10;
    for (const p of state.players.values()) {
      if (!p.joined) continue;
      const rec = state.saves.players[p.nameLower];
      if (rec) {
        rec.cash += 5;
        ctx.sendTo(p, { t: 'cash', cash: rec.cash, reason: 'trickle' });
      }
    }
    save();
  }

  // ---- customer spawning per open restaurant ----
  for (const [plotIdStr, r] of Object.entries(state.saves.restaurants)) {
    const plotId = Number(plotIdStr);
    if (!isOpen(r) || !r.menu.length) continue;
    const guests = [...state.customers.values()].filter((c) => c.kind === 'customer' && c.plotId === plotId).length;
    const tables = tablesOf(plotId, r).length;
    if (guests >= tables) continue;
    // arrival probability scales with rating
    const rate = (0.012 + r.rating * 0.01) * dt * 12;
    if (rng() < rate) {
      const plot = PLOTS[plotId];
      const table = freeTable(plotId, r);
      if (table) {
        const [tableId, tItem] = table;
        const { seat, faceRy } = seatFor(plotId, r, tableId, tItem);
        const npc = spawnNpc('customer', plotId, plot.entryX, plot.entryZ, {
          tableId, seat, seatRy: faceRy,
          dish: r.menu[Math.floor(rng() * r.menu.length)],
          patience: 35 + r.rating * 10,
        });
        npc.state = 'walking_in';
        const dp = doorPoints(plotId, r);
        walkPath(npc, [dp.outside, dp.inside, seat]);
      }
    }
  }

  // ---- NPC state machines ----
  for (const npc of state.customers.values()) {
    npc.stateT += dt;
    if (npc.kind === 'customer') tickCustomer(npc, dt, ctx);
    else if (npc.kind === 'waiter') tickWaiter(npc, dt, ctx);
    else if (npc.kind === 'chef') tickChef(npc, dt, ctx);
    else if (npc.kind === 'delivery') tickDeliveryBot(npc, dt, ctx);
  }

  // ---- bot chefs work their claimed orders' timers ----
  for (const order of state.orders.values()) {
    if (order.state === 'cooking' && order.cookUntil && Date.now() >= order.cookUntil) {
      order.cookUntil = null;
      orderStepDone(order);
      broadcast({ t: 'order.update', order: publicOrder(order) });
    }
  }

  // ---- NPC house orders: keep delivery drivers busy ----
  if (rng() < 0.004 * dt * 12) {
    const open = Object.entries(state.saves.restaurants).filter(([pid, r]) => isOpen(r) && r.staff.delivery);
    if (open.length) {
      const [plotIdStr, r] = open[Math.floor(rng() * open.length)];
      const liveHouseIds = new Set(Object.values(state.saves.players).map((p) => p.houseId));
      const candidates = HOUSES.filter((h) => !liveHouseIds.has(h.id));
      if (candidates.length && r.menu.length) {
        const house = candidates[Math.floor(rng() * candidates.length)];
        const order = createOrder({
          plotId: Number(plotIdStr),
          dishId: r.menu[Math.floor(rng() * r.menu.length)],
          type: 'delivery', houseId: house.id, forName: 'A hungry neighbor', payBonus: 6,
        });
        broadcast({ t: 'order.update', order: publicOrder(order) });
      }
    }
  }
}

// ---------- customer lifecycle ----------
function tickCustomer(npc, dt, ctx) {
  const { broadcast } = ctx;
  const r = state.saves.restaurants[npc.plotId];
  if (!r) { despawn(npc, ctx); return; }

  switch (npc.state) {
    case 'walking_in': {
      if (stepNpc(npc, dt)) {
        npc.state = 'seated';
        npc.anim = 'sit';
        npc.ry = npc.seatRy ?? npc.ry;
        npc.y = 1.9;   // origin drops so the hips land on the chair seat
        npc.stateT = 0;
        broadcast({ t: 'npc.bubble', id: npc.id, text: '🤔' });
      }
      break;
    }
    case 'seated': {
      // waits for a waiter (bot or owner takes the order via protocol)
      if (npc.stateT > 4 && !npc.orderId && !npc.orderTaken) {
        broadcast({ t: 'npc.bubble', id: npc.id, text: DISHES[npc.dish].emoji + '?' });
        npc.orderTaken = false;
        npc.state = 'waiting_order_taken';
        npc.stateT = 0;
      }
      break;
    }
    case 'waiting_order_taken':
    case 'waiting_food': {
      if (npc.stateT > npc.patience) {
        // angry leave: rating hit
        r.rating = Math.max(1, r.rating - 0.15);
        broadcast({ t: 'npc.bubble', id: npc.id, text: '😡' });
        broadcast({ t: 'restaurant.rating', plotId: npc.plotId, rating: r.rating });
        if (npc.orderId) {
          const o = state.orders.get(npc.orderId);
          if (o) { o.state = 'done'; state.orders.delete(o.id); broadcast({ t: 'order.remove', id: o.id }); }
        }
        leave(npc, ctx);
        save();
      }
      break;
    }
    case 'eating': {
      npc.anim = 'sit';
      if (npc.stateT > 7) {
        // pay: pile on the table + rating bump by speed
        const speedFactor = Math.max(0.5, 1.4 - npc.servedAfter / 60);
        const tip = Math.round(DISHES[npc.dish].price * 0.4 * speedFactor);
        const amount = DISHES[npc.dish].price + tip;
        const pileId = genId('pile');
        state.piles.set(pileId, { id: pileId, plotId: npc.plotId, tableId: npc.tableId, amount, x: npc.seat.x, z: npc.seat.z });
        broadcast({ t: 'pile.add', pile: state.piles.get(pileId) });
        r.rating = Math.min(5, r.rating + 0.06 * speedFactor);
        r.served++;
        broadcast({ t: 'restaurant.rating', plotId: npc.plotId, rating: r.rating });
        broadcast({ t: 'npc.bubble', id: npc.id, text: '😋' });
        leave(npc, ctx);
        save();
      }
      break;
    }
    case 'leaving': {
      if (stepNpc(npc, dt)) despawn(npc, ctx);
      break;
    }
  }
}

export function takeOrderFrom(npc, ctx) {
  if (npc.kind !== 'customer' || npc.state !== 'waiting_order_taken') return null;
  const order = createOrder({
    plotId: npc.plotId, dishId: npc.dish, type: 'dine',
    tableId: npc.tableId, customerId: npc.id,
  });
  npc.orderId = order.id;
  npc.state = 'waiting_food';
  npc.stateT = 0;
  ctx.broadcast({ t: 'npc.bubble', id: npc.id, text: '📝' });
  ctx.broadcast({ t: 'order.update', order: publicOrder(order) });
  return order;
}

export function serveCustomer(order, ctx) {
  const npc = state.customers.get(order.customerId);
  if (npc) {
    npc.state = 'eating';
    npc.stateT = 0;
    npc.servedAfter = (Date.now() - order.createdAt) / 1000;
    ctx.broadcast({ t: 'npc.bubble', id: npc.id, text: '🍽️' });
  }
  order.state = 'done';
  state.orders.delete(order.id);
  ctx.broadcast({ t: 'order.remove', id: order.id, served: true });
}

function leave(npc, ctx) {
  const plot = PLOTS[npc.plotId];
  const r = state.saves.restaurants[npc.plotId];
  npc.state = 'leaving';
  npc.anim = 'walk';
  npc.y = 2.05;
  if (r) {
    const dp = doorPoints(npc.plotId, r);
    walkPath(npc, [dp.inside, dp.outside, { x: plot.entryX, z: plot.entryZ }]);
  } else {
    walkTo(npc, plot.entryX, plot.entryZ);
  }
}

function despawn(npc, ctx) {
  state.customers.delete(npc.id);
  ctx.broadcast({ t: 'npc.remove', id: npc.id });
}

// ---------- staff bots ----------
export function ensureStaffBots(plotId, r, ctx) {
  for (const role of ['waiter', 'chef', 'delivery']) {
    if (!r.staff[role]) continue;
    const exists = [...state.customers.values()].some((c) => c.kind === role && c.plotId === plotId);
    if (!exists) {
      const f = frameFor(plotId, r);
      const door = f.doorWorld();
      spawnNpc(role, plotId, door.x, door.z, {
        avatar: { ...randomAvatar(), shirt: 'jacket', shirtColor: role === 'chef' ? '#f4f0e8' : role === 'waiter' ? '#2e3138' : '#e8902a', hat: role === 'chef' ? 'none' : 'cap', hatColor: '#c0564a' },
        speed: 3.2 * (STAFF[role].speeds[r.staff[role].tier] || 1),
      });
    }
  }
}

function tickWaiter(npc, dt, ctx) {
  const r = state.saves.restaurants[npc.plotId];
  if (!r || !r.staff.waiter) { despawn(npc, ctx); return; }

  if (npc.task === 'to_customer') {
    if (stepNpc(npc, dt)) {
      const target = state.customers.get(npc.taskTarget);
      if (target) takeOrderFrom(target, ctx);
      npc.task = null;
    }
    return;
  }
  if (npc.task === 'to_serve') {
    if (stepNpc(npc, dt)) {
      const order = state.orders.get(npc.taskTarget);
      if (order && order.state === 'carrying') serveCustomer(order, ctx);
      npc.task = null;
      npc.carryOrder = null;
      ctx.broadcast({ t: 'npc.carry', id: npc.id, order: null });
    }
    return;
  }

  // find work: an unTaken customer, or a ready dine order
  for (const c of state.customers.values()) {
    if (c.kind === 'customer' && c.plotId === npc.plotId && c.state === 'waiting_order_taken' && !c.waiterClaimed) {
      c.waiterClaimed = true;
      npc.task = 'to_customer';
      npc.taskTarget = c.id;
      walkTo(npc, c.seat.x + 0.8, c.seat.z);
      return;
    }
  }
  for (const o of state.orders.values()) {
    if (o.plotId === npc.plotId && o.type === 'dine' && o.state === 'ready') {
      const c = state.customers.get(o.customerId);
      if (!c) continue;
      o.state = 'carrying';
      npc.task = 'to_serve';
      npc.taskTarget = o.id;
      npc.carryOrder = o.dishId;
      ctx.broadcast({ t: 'npc.carry', id: npc.id, order: o.dishId });
      ctx.broadcast({ t: 'order.update', order: publicOrder(o) });
      walkTo(npc, c.seat.x + 0.8, c.seat.z);
      return;
    }
  }
}

function tickChef(npc, dt, ctx) {
  const r = state.saves.restaurants[npc.plotId];
  if (!r || !r.staff.chef) { despawn(npc, ctx); return; }

  if (npc.task === 'to_station') {
    if (stepNpc(npc, dt)) {
      const order = state.orders.get(npc.taskTarget);
      if (order && order.state === 'claimed') {
        order.state = 'cooking';
        const step = order.steps[order.stepIdx];
        const speed = (STAFF.chef.speeds[r.staff.chef.tier] || 1) * stationSpeed(npc.stationTier || 0);
        order.cookUntil = Date.now() + (step.time / speed) * 1000;
        npc.anim = 'chop';
        npc.cookingUntil = order.cookUntil;
        ctx.broadcast({ t: 'order.update', order: publicOrder(order) });
      }
      npc.task = null;
    }
    return;
  }
  if (npc.cookingUntil) {
    if (Date.now() >= npc.cookingUntil) {
      npc.cookingUntil = null;
      npc.anim = 'idle';
    } else return;
  }

  // claim the oldest queued order whose next station exists
  let best = null;
  for (const o of state.orders.values()) {
    if (o.plotId !== npc.plotId || o.state !== 'queued' || o.claimedBy) continue;
    if (!best || o.createdAt < best.createdAt) best = o;
  }
  if (best) {
    const step = best.steps[best.stepIdx];
    const stations = stationsOf(npc.plotId, r, step.station);
    if (stations.length) {
      const [, sItem] = stations[Math.floor(rng() * stations.length)];
      const sw = itemWorld(npc.plotId, r, sItem);
      best.claimedBy = npc.id;
      best.state = 'claimed';
      npc.task = 'to_station';
      npc.taskTarget = best.id;
      npc.stationTier = sItem.tier || 0;
      walkTo(npc, sw.x, sw.z + 1);
    }
  }
}

// delivery bot: grab ready delivery order → moped → house → doorbell → back
function tickDeliveryBot(npc, dt, ctx) {
  const r = state.saves.restaurants[npc.plotId];
  if (!r || !r.staff.delivery) { despawn(npc, ctx); return; }
  const plot = PLOTS[npc.plotId];

  switch (npc.task) {
    case 'to_moped': {
      if (stepNpc(npc, dt)) {
        npc.task = 'riding_out';
        npc.riding = true;
        npc.speed = 14 * (STAFF.delivery.speeds[r.staff.delivery.tier] || 1);
        npc.anim = 'drive';
        const house = HOUSES[npc.deliverHouse];
        walkTo(npc, house.mopedStopX, house.mopedStopZ);
        ctx.broadcast({ t: 'npc.ride', id: npc.id, riding: true });
      }
      return;
    }
    case 'riding_out': {
      if (stepNpc(npc, dt)) {
        npc.task = 'to_door';
        npc.riding = false;
        npc.speed = 3.5;
        npc.anim = 'walk';
        const house = HOUSES[npc.deliverHouse];
        walkTo(npc, house.doorX, house.doorZ - 1);
        ctx.broadcast({ t: 'npc.ride', id: npc.id, riding: false });
      }
      return;
    }
    case 'to_door': {
      if (stepNpc(npc, dt)) {
        const order = state.orders.get(npc.taskTarget);
        if (order) completeDelivery(order, null, ctx);
        npc.carryOrder = null;
        ctx.broadcast({ t: 'npc.carry', id: npc.id, order: null });
        ctx.broadcast({ t: 'doorbell', houseId: npc.deliverHouse });
        npc.task = 'riding_back';
        npc.riding = true;
        npc.speed = 14;
        npc.anim = 'drive';
        walkTo(npc, plot.mopedX, plot.mopedZ);
        ctx.broadcast({ t: 'npc.ride', id: npc.id, riding: true });
      }
      return;
    }
    case 'riding_back': {
      if (stepNpc(npc, dt)) {
        npc.task = null;
        npc.riding = false;
        npc.anim = 'idle';
        ctx.broadcast({ t: 'npc.ride', id: npc.id, riding: false });
      }
      return;
    }
  }

  // look for a ready delivery order nobody is carrying
  for (const o of state.orders.values()) {
    if (o.plotId === npc.plotId && o.type === 'delivery' && o.state === 'ready' && !o.carrier) {
      o.carrier = npc.id;
      o.state = 'intransit';
      npc.task = 'to_moped';
      npc.taskTarget = o.id;
      npc.deliverHouse = o.houseId;
      npc.carryOrder = 'bag';
      ctx.broadcast({ t: 'npc.carry', id: npc.id, order: 'bag' });
      ctx.broadcast({ t: 'order.update', order: publicOrder(o) });
      walkTo(npc, plot.mopedX, plot.mopedZ);
      return;
    }
  }
}

// shared by bot + player deliveries: pay the owners (and tip the helper)
export function completeDelivery(order, helperPlayer, ctx) {
  const r = state.saves.restaurants[order.plotId];
  if (r) {
    let ownersGet = order.pay;
    if (helperPlayer && !r.owners.includes(helperPlayer.nameLower)) {
      const tipCut = Math.round(order.pay * 0.25);
      ownersGet -= tipCut;
      const rec = state.saves.players[helperPlayer.nameLower];
      if (rec) {
        rec.cash += tipCut;
        ctx.sendTo(helperPlayer, { t: 'cash', cash: rec.cash, reason: 'delivery tip' });
      }
    }
    const split = Math.floor(ownersGet / r.owners.length);
    for (const ownerLower of r.owners) {
      const rec = state.saves.players[ownerLower];
      if (rec) {
        rec.cash += split;
        const live = [...state.players.values()].find((p) => p.joined && p.nameLower === ownerLower);
        if (live) ctx.sendTo(live, { t: 'cash', cash: rec.cash, reason: 'delivery' });
      }
    }
    save();
  }
  // if a real player ordered it, tell them dinner's here
  if (order.forName) {
    const buyer = [...state.players.values()].find((p) => p.joined && p.name === order.forName);
    if (buyer) ctx.sendTo(buyer, { t: 'toast', text: '🛎️ Your delivery is at the door!' });
  }
  order.state = 'done';
  state.orders.delete(order.id);
  ctx.broadcast({ t: 'order.remove', id: order.id, delivered: true });
}

export { isOpen, itemWorld, frameFor, randomAvatar };

function npcPublicSim(n) {
  return {
    id: n.id, kind: n.kind, plotId: n.plotId, avatar: n.avatar,
    x: n.x, y: n.y, z: n.z, ry: n.ry, anim: n.anim,
    carryOrder: n.carryOrder || null, riding: n.riding || false, tableId: n.tableId ?? null,
  };
}
