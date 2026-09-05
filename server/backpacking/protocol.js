// Backpacking message handling. Server owns: joins, chat, item placement,
// van seats, bear kills, spray, deaths/respawns. Movement is client-reported
// (except while seated in a van — the van's driver streams the van).

import { state, genId, save, publicPlayer, publicVan, clock01, profileOf, publicProfile } from './state.js';
import { sprayAt } from './bears.js';
import { botItems } from './bots.js';
import { WORLD, height, lavaAt, waterAt } from '../../shared/bp/worldgen.js';
import { rollCatch, FISH_BY_ID, BITE_MIN_MS, BITE_MAX_MS, REACT_MS, CAST_COOLDOWN_MS } from '../../shared/bp/fish.js';
import { ensurePlatformUser, BP_MAINTENANCE, checkAccess, isBanned } from '../hub.js';

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

// a pending bite must not fire at a player who has left, died or recast
export function clearFishTimer(p) {
  if (p.fishTimer) { clearTimeout(p.fishTimer); p.fishTimer = null; }
}

export function killPlayer(p, cause, broadcast) {
  if (p.fishing) {
    clearFishTimer(p);
    p.fishing = null;
    try { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'fish.miss', reason: 'You lost the rod!' })); } catch {}
  }
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
    // ---- fishing ---------------------------------------------------------
    // The server decides what is on the hook the moment you cast, and when it
    // bites; the client only reports that the player reacted. That keeps the
    // rare fish out of reach of a patched client.
    case 'fish.cast': {
      if (!p.joined || p.dead || p.vanId != null) return;
      const now = Date.now();
      if (p.fishNextCast && now < p.fishNextCast) return;
      const x = +msg.x || 0, z = +msg.z || 0;
      // the bobber must land in water, and within a rod's reach of the player
      if (Math.hypot(x - p.pos.x, z - p.pos.z) > 26) {
        send({ t: 'fish.miss', reason: 'Too far — get closer to the water.' });
        return;
      }
      const w = waterAt(x, z);
      if (!w) { send({ t: 'fish.miss', reason: 'That is not water.' }); return; }
      if (lavaAt(x, z)) { send({ t: 'fish.miss', reason: 'Nothing lives in lava.' }); return; }

      const pr = profileOf(p.nameLower);
      const biteIn = BITE_MIN_MS + Math.random() * (BITE_MAX_MS - BITE_MIN_MS);
      clearFishTimer(p);
      p.fishing = {
        catch: rollCatch({ water: w.kind, clock: clock01(), luck: 1 }),
        biteAt: now + biteIn,
        expiresAt: 0,          // set when the bite is actually announced
        x, z,
      };
      p.fishNextCast = now + CAST_COOLDOWN_MS;
      pr.casts++;
      send({ t: 'fish.cast.ok', x, z });
      // The server announces the bite rather than the client running a long
      // timer of its own: a throttled tab or a slow frame would otherwise drift
      // the client past the reaction window and eat the catch.
      p.fishTimer = setTimeout(() => {
        p.fishTimer = null;
        if (!p.fishing || !p.joined) return;
        p.fishing.expiresAt = Date.now() + REACT_MS;
        try { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'fish.bite', reactMs: REACT_MS })); } catch {}
      }, biteIn);
      return;
    }
    case 'fish.reel': {
      if (!p.joined || !p.fishing) return;
      const f = p.fishing;
      const now = Date.now();
      p.fishing = null;
      clearFishTimer(p);
      if (!f.expiresAt) { send({ t: 'fish.miss', reason: 'Too early — wait for the bite.' }); return; }
      if (now > f.expiresAt) { send({ t: 'fish.miss', reason: 'Too slow — it got away.' }); return; }

      const fish = FISH_BY_ID[f.catch.id];
      const pr = profileOf(p.nameLower);
      pr.caught[f.catch.id] = (pr.caught[f.catch.id] || 0) + 1;
      const isRecord = f.catch.cm > (pr.records[f.catch.id] || 0);
      if (isRecord) pr.records[f.catch.id] = f.catch.cm;
      pr.marshmallows += f.catch.value;
      save();

      send({
        t: 'fish.caught',
        fish: f.catch.id, cm: f.catch.cm, shiny: f.catch.shiny,
        value: f.catch.value, record: isRecord,
        marshmallows: pr.marshmallows,
        first: pr.caught[f.catch.id] === 1,
      });
      // a legendary is worth telling the whole server about
      if (fish && (fish.rarity === 'legendary' || f.catch.shiny) && !fish.junk) {
        broadcast({
          t: 'chat', id: 'system', name: 'Camp Radio',
          text: `${p.name} landed a ${f.catch.shiny ? 'SHINY ' : ''}${fish.name} (${f.catch.cm}cm)!`,
        });
      }
      return;
    }
    case 'fish.cancel': {
      p.fishing = null;
      clearFishTimer(p);
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
  if (!checkAccess(msg.code)) { try { p.ws.send(JSON.stringify({ t: 'toast', text: 'Locked — open from the ClaudeBox hub with the invite code.' })); p.ws.close(4003, 'locked'); } catch {} return; }
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
  if (isBanned(p.name)) { try { p.ws.send(JSON.stringify({ t: 'toast', text: 'You are banned from ClaudeBox.' })); p.ws.close(4009, 'banned'); } catch {} return; }
  ensurePlatformUser(p.name);

  send({
    t: 'welcome',
    id: p.id,
    you: publicPlayer(p),
    players: [...state.players.values()].filter((q) => q.joined && q.id !== p.id).map(publicPlayer),
    items: { ...state.saves.items, ...Object.fromEntries(botItems) },
    vans: state.vans.map(publicVan),
    clock: clock01(),
    profile: publicProfile(profileOf(p.nameLower)),
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
  clearFishTimer(p);
  p.fishing = null;
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
