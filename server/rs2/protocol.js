// RS2 message handling. Server owns: economy, build validation, orders,
// staff, co-owners, piles, deliveries. Movement is client-reported.

import { state, genId, save, publicPlayer, publicOrder, publicRestaurants, restaurantOf, ensurePlayer, freshRestaurant, playerRec, TRACKS } from './state.js';
import { ITEMS, DISHES, STAFF, WALL_COLORS, FLOOR_STYLES, tierPrice, FREE_DISHES } from '../../shared/rs2/catalog.js';
import { PLOTS, HOUSES, EXPANSIONS, buildingFrame, SPAWN, groundAt } from '../../shared/rs2/world.js';
import { createOrder, takeOrderFrom, serveCustomer, completeDelivery, ensureStaffBots, orderStepDone } from './sim.js';
import { ensurePlatformUser, checkAccess } from '../hub.js';

const clean = (s, max = 24) => String(s ?? '').replace(/[ -]/g, '').trim().slice(0, max);

export function makeBroadcaster(getClients) {
  return (msg, exceptId = null) => {
    const raw = JSON.stringify(msg);
    for (const p of getClients()) {
      if (p.id === exceptId) continue;
      if (p.ws.readyState === 1) p.ws.send(raw);
    }
  };
}

function chargePlayer(p, amount, ctx, reason) {
  const rec = playerRec(p.nameLower);
  if (!rec || rec.cash < amount) {
    ctx.send({ t: 'toast', text: `Not enough cash! (need $${amount})` });
    return false;
  }
  rec.cash -= amount;
  save();
  ctx.send({ t: 'cash', cash: rec.cash, reason });
  return true;
}

function myRestaurant(p) {
  return restaurantOf(p.nameLower);
}

// validate a footprint placement on the restaurant grid
function placementOk(r, plotId, kind, gx, gz, rot, ignoreId = null) {
  const def = ITEMS[kind];
  if (!def) return false;
  const { w: W, d: D } = EXPANSIONS[r.expansion];
  const w = rot % 2 ? def.d : def.w;
  const d = rot % 2 ? def.w : def.d;
  if (gx < 0 || gz < 0 || gx + w > W || gz + d > D) return false;
  // overlap check vs existing items (flat items like rugs don't block)
  if (def.flat) return true;
  for (const [id, it] of Object.entries(r.items)) {
    if (id === ignoreId) continue;
    const odef = ITEMS[it.kind];
    if (!odef || odef.flat) continue;
    const ow = it.rot % 2 ? odef.d : odef.w;
    const od = it.rot % 2 ? odef.w : odef.d;
    if (gx < it.gx + ow && gx + w > it.gx && gz < it.gz + od && gz + d > it.gz) return false;
  }
  return true;
}

export function handleMessage(p, msg, ctx) {
  const { broadcast, send } = ctx;
  switch (msg.t) {
    case 'join': return onJoin(p, msg, ctx);
    case 'move': {
      if (!p.joined) return;
      p.pos = { x: +msg.x || 0, y: +msg.y || 0, z: +msg.z || 0 };
      p.ry = +msg.ry || 0;
      p.anim = clean(msg.anim, 12) || 'idle';
      p.riding = msg.riding ? true : null;
      return;
    }
    case 'chat': {
      const text = clean(msg.text, 160);
      if (text) broadcast({ t: 'chat', id: p.id, name: p.name, text });
      return;
    }

    // ---------- build mode ----------
    case 'build.place': {
      const mine = myRestaurant(p);
      if (!mine) return;
      const { r, plotId } = mine;
      const kind = msg.kind;
      const tier = Math.min(2, Math.max(0, +msg.tier || 0));
      if (!ITEMS[kind]) return;
      if (!placementOk(r, plotId, kind, +msg.gx | 0, +msg.gz | 0, +msg.rot & 3)) {
        return send({ t: 'toast', text: "Doesn't fit there!" });
      }
      const price = tierPrice(kind, tier);
      if (!chargePlayer(p, price, ctx, 'bought ' + kind)) return;
      const id = 'i' + (r.nextItem++);
      r.items[id] = { kind, gx: +msg.gx | 0, gz: +msg.gz | 0, rot: +msg.rot & 3, tier };
      save();
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }
    case 'build.move': {
      const mine = myRestaurant(p);
      if (!mine) return;
      const { r, plotId } = mine;
      const it = r.items[msg.id];
      if (!it) return;
      if (!placementOk(r, plotId, it.kind, +msg.gx | 0, +msg.gz | 0, +msg.rot & 3, msg.id)) {
        return send({ t: 'toast', text: "Doesn't fit there!" });
      }
      it.gx = +msg.gx | 0; it.gz = +msg.gz | 0; it.rot = +msg.rot & 3;
      save();
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }
    case 'build.sell': {
      const mine = myRestaurant(p);
      if (!mine) return;
      const { r, plotId } = mine;
      const it = r.items[msg.id];
      if (!it) return;
      delete r.items[msg.id];
      const refund = Math.round(tierPrice(it.kind, it.tier || 0) * 0.5);
      const rec = playerRec(p.nameLower);
      rec.cash += refund;
      save();
      send({ t: 'cash', cash: rec.cash, reason: 'sold ' + it.kind });
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }
    case 'build.style': {
      const mine = myRestaurant(p);
      if (!mine) return;
      const { r, plotId } = mine;
      if (msg.wall && WALL_COLORS.includes(msg.wall)) r.wall = msg.wall;
      if (msg.floor && FLOOR_STYLES.includes(msg.floor)) r.floor = msg.floor;
      if (msg.awning && WALL_COLORS.includes(msg.awning)) r.awning = msg.awning;
      if (typeof msg.name === 'string' && clean(msg.name, 18)) r.name = clean(msg.name, 18);
      save();
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }
    case 'build.expand': {
      const mine = myRestaurant(p);
      if (!mine) return;
      const { r, plotId } = mine;
      const next = r.expansion + 1;
      if (next >= EXPANSIONS.length) return;
      if (!chargePlayer(p, EXPANSIONS[next].price, ctx, 'expansion')) return;
      r.expansion = next;
      save();
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }

    // ---------- shop: staff + dish unlocks ----------
    case 'hire': {
      const mine = myRestaurant(p);
      if (!mine || !STAFF[msg.role]) return;
      const { r, plotId } = mine;
      if (r.staff[msg.role]) {
        // upgrade
        if (r.staff[msg.role].tier >= 1) return;
        if (!chargePlayer(p, STAFF[msg.role].upgrade, ctx, 'staff upgrade')) return;
        r.staff[msg.role].tier = 1;
      } else {
        if (!chargePlayer(p, STAFF[msg.role].price, ctx, 'hired ' + msg.role)) return;
        r.staff[msg.role] = { tier: 0 };
      }
      save();
      ensureStaffBots(plotId, r, ctx);
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }
    case 'dish.unlock': {
      const mine = myRestaurant(p);
      if (!mine || !DISHES[msg.dishId]) return;
      const { r, plotId } = mine;
      if (r.unlocked.includes(msg.dishId)) return;
      if (!chargePlayer(p, DISHES[msg.dishId].unlock, ctx, 'recipe')) return;
      r.unlocked.push(msg.dishId);
      save();
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }
    case 'menu.set': {
      const mine = myRestaurant(p);
      if (!mine || !Array.isArray(msg.menu)) return;
      const { r, plotId } = mine;
      r.menu = msg.menu.filter((d) => r.unlocked.includes(d)).slice(0, 6);
      save();
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }
    case 'music.set': {
      const mine = myRestaurant(p);
      if (!mine) return;
      const { r, plotId } = mine;
      r.music = typeof msg.track === 'string' ? msg.track.slice(0, 80) : null;
      save();
      broadcast({ t: 'restaurant.update', plotId, r });
      return;
    }

    case 'restaurant.reset': {
      const mine = myRestaurant(p);
      if (!mine) return;
      const { plotId } = mine;
      // clear this plot's live orders + cash piles
      for (const [oid, o] of [...state.orders]) {
        if (o.plotId === plotId) { state.orders.delete(oid); broadcast({ t: 'order.remove', id: oid }); }
      }
      for (const [pid, pile] of [...state.piles]) {
        if (pile.plotId === plotId) { state.piles.delete(pid); broadcast({ t: 'pile.remove', id: pid }); }
      }
      // brand-new template restaurant, sole ownership, starter cash
      state.saves.restaurants[plotId] = freshRestaurant(p.name, p.nameLower);
      const rec = playerRec(p.nameLower);
      if (rec) rec.cash = 1000;
      save();
      broadcast({ t: 'restaurants', restaurants: publicRestaurants() });
      send({ t: 'cash', cash: 1000, reason: 'fresh start' });
      send({ t: 'toast', text: '✨ Fresh start! Your restaurant is brand new.' });
      return;
    }

    // ---------- co-owner ----------
    case 'coowner.invite': {
      const mine = myRestaurant(p);
      if (!mine) return;
      const target = [...state.players.values()].find((q) => q.joined && q.id === msg.playerId);
      if (!target || mine.r.owners.length >= 2 || mine.r.owners.includes(target.nameLower)) return;
      if (target.ws.readyState === 1) {
        target.ws.send(JSON.stringify({ t: 'coowner.invited', from: p.name, plotId: mine.plotId, name: mine.r.name }));
      }
      send({ t: 'toast', text: `Invited ${target.name} to co-own!` });
      return;
    }
    case 'coowner.accept': {
      const target = state.saves.restaurants[msg.plotId];
      if (!target || target.owners.length >= 2 || target.owners.includes(p.nameLower)) return;
      // release my own plot back to the pool
      const mine = myRestaurant(p);
      if (mine) delete state.saves.restaurants[mine.plotId];
      target.owners.push(p.nameLower);
      save();
      broadcast({ t: 'restaurants', restaurants: publicRestaurants() });
      broadcast({ t: 'player.update', player: publicPlayer(p) });
      send({ t: 'toast', text: `You're now a co-owner of ${target.name}! 🤝` });
      return;
    }

    // ---------- cooking (player-performed) ----------
    case 'order.take': {
      const npc = state.customers.get(msg.customerId);
      if (!npc) return;
      const mine = myRestaurant(p);
      if (!mine || mine.plotId !== npc.plotId) return;
      takeOrderFrom(npc, ctx);
      return;
    }
    case 'cook.step': {
      const order = state.orders.get(msg.orderId);
      const mine = myRestaurant(p);
      if (!order || !mine || order.plotId !== mine.plotId) return;
      if (order.state !== 'queued') return;
      const step = order.steps[order.stepIdx];
      if (step.station !== msg.station) return;
      order.state = 'cooking';
      order.cookUntil = Date.now() + step.time * 1000; // player cooks at base speed
      broadcast({ t: 'order.update', order: publicOrder(order) });
      return;
    }
    case 'order.carry': {
      // player picks up a ready order (plate for dine-in, bag for delivery/player)
      const order = state.orders.get(msg.orderId);
      if (!order || order.state !== 'ready') return;
      order.state = order.type === 'dine' ? 'carrying' : 'intransit';
      order.carrier = p.id;
      p.carryOrder = order.type === 'dine' ? order.dishId : 'bag';
      broadcast({ t: 'order.update', order: publicOrder(order) });
      broadcast({ t: 'player.update', player: publicPlayer(p) });
      return;
    }
    case 'order.serve': {
      const order = state.orders.get(msg.orderId);
      if (!order || order.carrier !== p.id) return;
      if (order.type === 'dine' && order.customerId) {
        serveCustomer(order, ctx);
      } else if (order.type === 'player') {
        // hand to the player at their table
        const buyer = [...state.players.values()].find((q) => q.joined && q.name === order.forName);
        if (buyer) {
          buyer.hasBag = order.dishId;
          ctx.sendTo(buyer, { t: 'bag.receive', dishId: order.dishId });
        }
        payOwners(order, ctx);
        order.state = 'done';
        state.orders.delete(order.id);
        broadcast({ t: 'order.remove', id: order.id, served: true });
      }
      p.carryOrder = null;
      broadcast({ t: 'player.update', player: publicPlayer(p) });
      return;
    }
    case 'order.deliver': {
      // player at the house door with the bag
      const order = state.orders.get(msg.orderId);
      if (!order || order.carrier !== p.id || order.type !== 'delivery') return;
      const house = HOUSES[order.houseId];
      if (!house || Math.hypot(p.pos.x - house.doorX, p.pos.z - house.doorZ) > 6) return;
      completeDelivery(order, p, ctx);
      p.carryOrder = null;
      broadcast({ t: 'doorbell', houseId: order.houseId });
      broadcast({ t: 'player.update', player: publicPlayer(p) });
      return;
    }

    // ---------- ordering food ----------
    case 'food.order': {
      // type 'table' (I'm at a restaurant) or 'delivery' (I'm at my house)
      const r = state.saves.restaurants[msg.plotId];
      if (!r || !r.unlocked.includes(msg.dishId) || !r.menu.includes(msg.dishId)) return;
      const price = DISHES[msg.dishId].price + (msg.kind === 'delivery' ? 5 : 0);
      if (!chargePlayer(p, price, ctx, 'ordered food')) return;
      const order = createOrder({
        plotId: +msg.plotId,
        dishId: msg.dishId,
        type: msg.kind === 'delivery' ? 'delivery' : 'player',
        houseId: msg.kind === 'delivery' ? (playerRec(p.nameLower)?.houseId ?? 0) : null,
        forName: p.name,
        payBonus: msg.kind === 'delivery' ? 5 : 0,
      });
      broadcast({ t: 'order.update', order: publicOrder(order) });
      // alert the owners that an order came in (with cook steps if unstaffed)
      for (const q of state.players.values()) {
        if (q.joined && r.owners.includes(q.nameLower)) {
          ctx.sendTo(q, { t: 'toast', text: `🧾 New ${msg.kind === 'delivery' ? 'DELIVERY' : 'table'} order: ${DISHES[msg.dishId].label}!` });
        }
      }
      send({ t: 'toast', text: r.staff.chef ? 'Order placed — the kitchen is on it!' : 'Order placed!' });
      return;
    }
    case 'bag.eat': {
      if (!p.hasBag) return;
      p.hasBag = null;
      broadcast({ t: 'pose.fx', id: p.id, kind: 'eat' });
      send({ t: 'toast', text: 'Delicious! 😋' });
      return;
    }

    // ---------- cash piles ----------
    case 'pile.collect': {
      const pile = state.piles.get(msg.id);
      if (!pile) return;
      const r = state.saves.restaurants[pile.plotId];
      if (!r || !r.owners.includes(p.nameLower)) return;
      if (Math.hypot(p.pos.x - pile.x, p.pos.z - pile.z) > 7) return;
      state.piles.delete(msg.id);
      const split = Math.floor(pile.amount / r.owners.length);
      for (const ownerLower of r.owners) {
        const rec = state.saves.players[ownerLower];
        if (rec) {
          rec.cash += ownerLower === p.nameLower ? pile.amount - split * (r.owners.length - 1) : split;
          const live = [...state.players.values()].find((q) => q.joined && q.nameLower === ownerLower);
          if (live) ctx.sendTo(live, { t: 'cash', cash: rec.cash, reason: 'table cash' });
        }
      }
      save();
      broadcast({ t: 'pile.remove', id: msg.id });
      return;
    }

    case 'pose': {
      if (['sit', 'eat', 'stand', 'chop'].includes(msg.kind)) {
        broadcast({ t: 'pose.fx', id: p.id, kind: msg.kind }, p.id);
      }
      return;
    }
  }
}

function payOwners(order, ctx) {
  const r = state.saves.restaurants[order.plotId];
  if (!r) return;
  const split = Math.floor(order.pay / r.owners.length);
  for (const ownerLower of r.owners) {
    const rec = state.saves.players[ownerLower];
    if (rec) {
      rec.cash += split;
      const live = [...state.players.values()].find((q) => q.joined && q.nameLower === ownerLower);
      if (live) ctx.sendTo(live, { t: 'cash', cash: rec.cash, reason: 'order' });
    }
  }
  save();
}

function onJoin(p, msg, ctx) {
  if (!checkAccess(msg.code)) { try { p.ws.send(JSON.stringify({ t: 'toast', text: 'Locked — open from the ClaudeBox hub with the invite code.' })); p.ws.close(4003, 'locked'); } catch {} return; }
  const { send, broadcast } = ctx;
  const name = clean(msg.name, 20) || 'Cook';
  p.name = name;
  p.nameLower = name.toLowerCase();
  for (const q of state.players.values()) {
    if (q !== p && q.joined && q.nameLower === p.nameLower) {
      try { q.ws.close(4000, 'replaced'); } catch {}
      state.players.delete(q.id);
      broadcast({ t: 'player.leave', id: q.id });
    }
  }
  p.avatar = msg.avatar && typeof msg.avatar === 'object' ? msg.avatar : {};
  p.joined = true;
  p.pos = { x: SPAWN.x, y: groundAt(SPAWN.x, SPAWN.z), z: SPAWN.z };
  ensurePlatformUser(p.name);
  const rec = ensurePlayer(p.name);

  // make sure my restaurant's bots exist
  const mine = restaurantOf(p.nameLower);
  if (mine) ensureStaffBots(mine.plotId, mine.r, ctx);

  send({
    t: 'welcome',
    id: p.id,
    you: publicPlayer(p),
    cash: rec.cash,
    houseId: rec.houseId,
    plotId: mine ? mine.plotId : null,
    players: [...state.players.values()].filter((q) => q.joined && q.id !== p.id).map(publicPlayer),
    restaurants: publicRestaurants(),
    orders: [...state.orders.values()].map(publicOrder),
    piles: [...state.piles.values()],
    npcs: [...state.customers.values()].map(npcPublic),
    tracks: TRACKS,
  });
  broadcast({ t: 'player.join', player: publicPlayer(p) }, p.id);
}

export function npcPublic(n) {
  return {
    id: n.id, kind: n.kind, plotId: n.plotId, avatar: n.avatar,
    x: n.x, y: n.y, z: n.z, ry: n.ry, anim: n.anim,
    carryOrder: n.carryOrder || null, riding: n.riding || false,
    tableId: n.tableId ?? null,
  };
}

export function onDisconnect(p, ctx) {
  // drop any carried order back to ready
  for (const o of state.orders.values()) {
    if (o.carrier === p.id) {
      o.carrier = null;
      o.state = 'ready';
      ctx.broadcast({ t: 'order.update', order: publicOrder(o) });
    }
  }
  state.players.delete(p.id);
  if (p.joined) ctx.broadcast({ t: 'player.leave', id: p.id });
}
