// Backpacking message handling. Server owns: joins, chat, item placement,
// van seats, bear kills, spray, deaths/respawns. Movement is client-reported
// (except while seated in a van — the van's driver streams the van).

import { state, genId, save, publicPlayer, publicVan, clock01 } from './state.js';
import { sprayAt } from './bears.js';
import { botItems } from './bots.js';
import { WORLD, height, lavaAt } from '../../shared/bp/worldgen.js';
import { ensurePlatformUser, BP_MAINTENANCE } from '../hub.js';

const clean = (s, max = 24) => String(s ?? '').replace(/[ -]/g, '').trim().slice(0, max);
const cleanColor = (c, fb) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : fb);

// Every placeable kind (must match the client CATALOG in systems/items.js).
const ITEM_KINDS = new Set(['tent', 'campfire', 'torch', 'stringlights', 'chair', 'table',
  'sleepingbag', 'bed', 'cooler', 'blanket', 'fence', 'grill', 'stump',
  'sofa', 'armchair', 'bench', 'hammock', 'rug', 'tv', 'bookshelf', 'planter', 'lamp',
  'hottub', 'pool', 'lantern', 'sign', 'flagpole']);

export function makeBroadcaster(getClients) {
  return (msg, exceptId = null) => {
    const raw = JSON.stringify(msg);
    for (const p of getClients()) {
      if (p.id === exceptId) continue;
      if (p.ws && p.ws.readyState === 1) p.ws.send(raw);   // bots have no ws
    }
  };
}

export function killPlayer(p, cause, broadcast) {
  if (p.dead) return;
  p.dead = true;
  p.diedAt = Date.now();
  leaveVan(p, broadcast, true);
  broadcast({ t: 'player.death', id: p.id, cause });
}

export function handleMessage(p, msg, ctx) {
  const { broadcast, send } = ctx;
  switch (msg.t) {
    case 'join': return onJoin(p, msg, ctx);
    case 'move': {
      if (!p.joined || p.dead || p.vanId != null) return;
      p.pos = { x: +msg.x || 0, y: +msg.y || 0, z: +msg.z || 0 };
      p.ry = +msg.ry || 0;
      p.anim = clean(msg.anim, 12) || 'idle';
      return;
    }
    case 'chat': {
      const text = clean(msg.text, 160);
      if (text) broadcast({ t: 'chat', id: p.id, name: p.name, text });
      return;
    }
    case 'place': {
      if (!p.joined || p.dead) return;
      if (!ITEM_KINDS.has(msg.kind)) return;
      const x = +msg.x || 0, z = +msg.z || 0;
      if (Math.hypot(x - p.pos.x, z - p.pos.z) > 14) return;
      const id = genId('i');
      const item = {
        owner: p.nameLower, kind: msg.kind,
        x, y: height(x, z), z, ry: +msg.ry || 0,
        color: cleanColor(msg.color, '#4f8a55'),
      };
      state.saves.items[id] = item;
      save();
      broadcast({ t: 'item.add', id, item });
      return;
    }
    case 'pickup': {
      const item = state.saves.items[msg.id];
      if (!item || item.owner !== p.nameLower) return;
      if (Math.hypot(item.x - p.pos.x, item.z - p.pos.z) > 9) return;
      delete state.saves.items[msg.id];
      save();
      broadcast({ t: 'item.remove', id: msg.id });
      return;
    }
    case 'van.enter': {
      if (!p.joined || p.dead || p.vanId != null) return;
      const van = state.vans.find((v) => v.id === msg.vanId);
      if (!van) return;
      if (Math.hypot(van.x - p.pos.x, van.z - p.pos.z) > 9) return;
      const seat = van.seats.indexOf(null);
      if (seat === -1) return send({ t: 'toast', text: 'That van is full!' });
      van.seats[seat] = p.id;
      p.vanId = van.id;
      p.seat = seat;
      broadcast({ t: 'van.seats', vanId: van.id, seats: van.seats });
      broadcast({ t: 'player.update', player: publicPlayer(p) });
      return;
    }
    case 'van.exit': return leaveVan(p, broadcast, false);
    case 'van.state': {
      const van = state.vans.find((v) => v.id === p.vanId);
      if (!van || van.seats[0] !== p.id) return; // only the driver streams
      van.x = +msg.x || van.x; van.y = +msg.y || van.y; van.z = +msg.z || van.z;
      van.ry = +msg.ry || 0; van.pitch = +msg.pitch || 0; van.roll = +msg.roll || 0;
      van.speed = +msg.speed || 0;
      // the driver's own position rides along
      p.pos = { x: van.x, y: van.y, z: van.z };
      return;
    }
    case 'van.reset': {
      const van = state.vans.find((v) => v.id === msg.vanId);
      if (!van) return;
      if (van.seats.some(Boolean) && van.seats[0] !== p.id) return;
      resetVan(van, broadcast);
      return;
    }
    case 'ranover': {
      // driver reports hitting a pedestrian; validate it's plausible
      const van = state.vans.find((v) => v.id === p.vanId);
      const victim = state.players.get(msg.playerId);
      if (!van || van.seats[0] !== p.id || !victim || victim.dead || victim.vanId != null) return;
      if (van.speed < 7) return;
      if (Math.hypot(victim.pos.x - van.x, victim.pos.z - van.z) > 8) return;
      killPlayer(victim, 'ranover', broadcast);
      return;
    }
    case 'die': {
      // client-reported environmental death (lava is verifiable)
      if (!p.joined || p.dead) return;
      if (msg.cause === 'lava' && !lavaAt(p.pos.x, p.pos.z)) return;
      killPlayer(p, msg.cause === 'lava' ? 'lava' : 'unknown', broadcast);
      return;
    }
    case 'respawn': {
      if (!p.dead || Date.now() - p.diedAt < 1500) return;
      p.dead = false;
      p.pos = { x: WORLD.spawn.x + (Math.random() * 4 - 2), y: height(WORLD.spawn.x, WORLD.spawn.z) + 1, z: WORLD.spawn.z + (Math.random() * 4 - 2) };
      broadcast({ t: 'player.respawn', id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z });
      return;
    }
    case 'spray': {
      if (!p.joined || p.dead) return;
      const scared = sprayAt(p.pos.x, p.pos.z, +msg.dirX || 0, +msg.dirZ || 1);
      broadcast({ t: 'spray.fx', id: p.id, x: p.pos.x, z: p.pos.z, dirX: +msg.dirX || 0, dirZ: +msg.dirZ || 1, scared: scared.length });
      return;
    }
    case 'pose': {
      // cosmetic broadcast poses: roast / eat / sit / lie / stand
      if (!['roast', 'eat', 'sit', 'lie', 'stand', 'spraypose'].includes(msg.kind)) return;
      broadcast({ t: 'pose.fx', id: p.id, kind: msg.kind }, p.id);
      return;
    }
  }
}

function onJoin(p, msg, { send, broadcast }) {
  if (BP_MAINTENANCE && msg.dev !== 1) {
    send({ t: 'toast', text: '🔧 Backpacking is being upgraded — back soon!' });
    try { p.ws.close(4503, 'maintenance'); } catch {}
    return;
  }
  const name = clean(msg.name, 20) || 'Camper';
  p.name = name;
  p.nameLower = name.toLowerCase();
  // one live session per name
  for (const q of state.players.values()) {
    if (q !== p && q.joined && q.nameLower === p.nameLower) {
      try { q.ws.close(4000, 'replaced'); } catch {}
      state.players.delete(q.id);
      broadcast({ t: 'player.leave', id: q.id });
    }
  }
  p.avatar = msg.avatar && typeof msg.avatar === 'object' ? msg.avatar : {};
  p.joined = true;
  p.dead = false;
  p.vanId = null;
  p.seat = null;
  p.pos = { x: WORLD.spawn.x, y: height(WORLD.spawn.x, WORLD.spawn.z) + 1, z: WORLD.spawn.z };
  ensurePlatformUser(p.name);

  send({
    t: 'welcome',
    id: p.id,
    you: publicPlayer(p),
    players: [...state.players.values()].filter((q) => q.joined && q.id !== p.id).map(publicPlayer),
    items: { ...state.saves.items, ...Object.fromEntries(botItems) },
    vans: state.vans.map(publicVan),
    clock: clock01(),
  });
  broadcast({ t: 'player.join', player: publicPlayer(p) }, p.id);
}

export function leaveVan(p, broadcast, silent) {
  if (p.vanId == null) return;
  const van = state.vans.find((v) => v.id === p.vanId);
  if (van) {
    van.seats = van.seats.map((s) => (s === p.id ? null : s));
    if (!van.seats.some(Boolean)) van.emptySince = Date.now();
    broadcast({ t: 'van.seats', vanId: van.id, seats: van.seats });
  }
  p.vanId = null;
  p.seat = null;
  if (!silent) broadcast({ t: 'player.update', player: publicPlayer(p) });
}

export function resetVan(van, broadcast) {
  van.x = van.home.x; van.z = van.home.z; van.ry = van.home.ry;
  van.y = height(van.x, van.z);
  van.pitch = 0; van.roll = 0; van.speed = 0;
  broadcast({ t: 'van.teleport', van: publicVan(van) });
}

export function onDisconnect(p, ctx) {
  leaveVan(p, ctx.broadcast, true);
  state.players.delete(p.id);
  if (p.joined) ctx.broadcast({ t: 'player.leave', id: p.id });
}

// reclaim abandoned vans (unoccupied, far from home, for 4+ minutes)
export function tickVans(broadcast) {
  const now = Date.now();
  for (const van of state.vans) {
    if (van.seats.some(Boolean)) continue;
    const far = Math.hypot(van.x - van.home.x, van.z - van.home.z) > 60;
    if (far && now - van.emptySince > 240000) resetVan(van, broadcast);
  }
}
