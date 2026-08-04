// Junior Guards Simulator — message handling + room lifecycle + weather.
import { state, genId, makeRoom, roomPlayers, publicRoom, publicPlayer } from './state.js';
import { rollBackpack, rollWeatherPlan, STRETCH_BY_ID } from '../../shared/juniorguards/config.js';
import { areFriends } from '../hub.js';

// worlds designed in ClaudeBox Studio — slug 'juniorguards' = the beach,
// sub-slot 'juniorguards-lobby' = the lobby. null = client builds the built-in map.
const worlds = { beach: null, lobby: null };
export function setWorld(which, w) {
  worlds[which] = w;
  // push it to everyone already playing — a Studio save should go live immediately
  for (const p of state.players.values()) {
    if (p.joined) { try { if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'world.update', which, world: w })); } catch {} }
  }
}
export function setBeachWorld(w) { worlds.beach = w; }

const send = (p, msg) => { try { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); } catch {} };
const roomSend = (room, msg, except) => { for (const p of roomPlayers(room)) if (p !== except) send(p, msg); };

function browserRooms() {
  return [...state.rooms.values()].filter((r) => !r.offline).map(publicRoom);
}

function leaveRoom(p, silent) {
  const room = p.room && state.rooms.get(p.room);
  p.room = null; p.role = null; p.stretch = null; p.sitting = false;
  if (!room) return;
  roomSend(room, { t: 'player.leave', id: p.id });
  // host left, or room emptied → close it (players get bounced to the browser)
  const left = roomPlayers(room);
  if (!left.length || p.id === room.hostId) {
    for (const q of left) { q.room = null; send(q, { t: 'room.closed', reason: p.id === room.hostId ? 'The host left' : 'empty' }); }
    state.rooms.delete(room.id);
  }
  if (!silent) send(p, { t: 'room.left' });
}

function joinRoom(p, room) {
  p.room = room.id; p.role = null; p.wet = false; p.stretch = null; p.sitting = false;
  p.equip = { wetsuit: false, hat: false };
  p.pack = { carried: true, items: rollBackpack() };
  p.x = 0; p.y = 2; p.z = 0; p.ry = 0; p.anim = 'idle';
  send(p, {
    t: 'room.joined',
    room: publicRoom(room),
    youAreHost: room.hostId === p.id,
    started: room.started,
    weather: room.weather ? { phase: room.weather.phase, left: Math.max(0, Math.round((room.weather.until - Date.now()) / 1000)) } : null,
    players: roomPlayers(room).filter((q) => q !== p).map(publicPlayer),
    packs: [...room.packs.values()],
    towels: [...room.towels.values()],
  });
  roomSend(room, { t: 'player.join', p: publicPlayer(p) }, p);
}

export function handleMessage(p, msg, ctx) {
  const room = p.room ? state.rooms.get(p.room) : null;
  switch (msg.t) {
    case 'join': {   // hello from the title screen
      p.joined = true;
      p.name = String(msg.name || 'Guard').slice(0, 24);
      p.nameLower = p.name.toLowerCase();
      p.avatar = msg.avatar || null;
      send(p, { t: 'welcome', id: p.id, servers: browserRooms(), beach: worlds.beach, lobby: worlds.lobby });
      break;
    }
    case 'servers.list':
      send(p, { t: 'servers', servers: browserRooms() });
      break;
    case 'server.create': {
      if (p.room) leaveRoom(p, true);
      const r = makeRoom(p, { name: msg.name, mode: msg.mode, offline: !!msg.offline });
      joinRoom(p, r);
      break;
    }
    case 'server.join': {
      const r = state.rooms.get(msg.id);
      if (!r || r.offline) { send(p, { t: 'jg.err', err: 'That server is gone.' }); break; }
      if (r.started && !r.invited.has(p.nameLower)) { send(p, { t: 'jg.err', err: 'Game already started — you need an invite from the host.' }); break; }
      if (p.room) leaveRoom(p, true);
      joinRoom(p, r);
      break;
    }
    case 'server.leave': leaveRoom(p); break;
    case 'server.start': {
      if (!room || room.hostId !== p.id || room.started) break;
      room.started = true;
      const plan = rollWeatherPlan();
      room.weather = { plan, phase: 'fog', until: Date.now() + plan.fog * 1000 };
      roomSend(room, { t: 'game.start', weather: { phase: 'fog', left: plan.fog } });
      break;
    }
    case 'weather.set': {   // host forces the sky
      if (!room || room.hostId !== p.id || !room.started) break;
      const phase = ['fog', 'rain', 'sun'].includes(msg.phase) ? msg.phase : 'sun';
      const plan = room.weather?.plan || { fog: 180, rain: 90 };
      // a forced phase holds until the host changes it again
      room.weather = { plan, phase, until: Infinity };
      roomSend(room, { t: 'weather', phase, left: 0 });
      break;
    }
    case 'server.invite': {
      if (!room || room.hostId !== p.id) break;
      const who = String(msg.name || '').toLowerCase();
      if (!who) break;
      if (!areFriends(p.nameLower, who)) { send(p, { t: 'jg.err', err: 'You can only invite friends.' }); break; }
      room.invited.add(who);
      send(p, { t: 'jg.info', info: `${msg.name} can now join your server.` });
      break;
    }
    case 'role.set': {   // RP: instructor or student
      if (!room || room.mode !== 'rp') break;
      p.role = msg.role === 'instructor' ? 'instructor' : 'student';
      roomSend(room, { t: 'player.role', id: p.id, role: p.role });
      break;
    }
    case 'move': {
      if (!room) break;
      p.x = +msg.x || 0; p.y = +msg.y || 0; p.z = +msg.z || 0;
      p.ry = +msg.ry || 0; p.anim = String(msg.anim || 'idle').slice(0, 12);
      p.wet = !!msg.wet; p.sitting = !!msg.sitting;
      break;
    }
    case 'stretch.set': {   // null or a stretch id — everyone sees your pose
      if (!room) break;
      p.stretch = msg.id && STRETCH_BY_ID[msg.id] ? { id: msg.id, at: Date.now() } : null;
      roomSend(room, { t: 'player.stretch', id: p.id, stretch: p.stretch }, p);
      break;
    }
    case 'equip.set': {
      if (!room) break;
      p.equip = { wetsuit: !!msg.wetsuit, hat: !!msg.hat };
      roomSend(room, { t: 'player.equip', id: p.id, equip: p.equip }, p);
      break;
    }
    case 'pack.drop': {   // put your backpack down at your feet
      if (!room || !p.pack?.carried) break;
      p.pack.carried = false;
      const pk = { id: genId('bp'), owner: p.id, ownerName: p.name, x: p.x, y: p.y, z: p.z, items: p.pack.items };
      room.packs.set(pk.id, pk);
      p.packId = pk.id;
      roomSend(room, { t: 'pack.dropped', pack: pk });
      break;
    }
    case 'pack.pickup': {
      if (!room) break;
      const pk = room.packs.get(msg.id);
      if (!pk || pk.owner !== p.id) break;
      room.packs.delete(pk.id);
      p.pack = { carried: true, items: pk.items };
      p.packId = null;
      roomSend(room, { t: 'pack.gone', id: pk.id });
      break;
    }
    case 'item.use': {   // consume a snack / toggle equip from YOUR dropped pack
      if (!room) break;
      const pk = room.packs.get(msg.pack);
      if (!pk || pk.owner !== p.id) break;
      const i = pk.items.findIndex((it) => it.id === msg.item);
      if (i < 0) break;
      const it = pk.items[i];
      if (it.kind === 'snack') { pk.items.splice(i, 1); roomSend(room, { t: 'pack.update', id: pk.id, items: pk.items }); }
      if (it.kind === 'towel' && msg.action === 'place') {
        pk.items.splice(i, 1);
        const tw = { id: genId('tw'), owner: p.id, x: p.x, y: p.y, z: p.z, color: '#e35d7c' };
        room.towels.set(tw.id, tw);
        roomSend(room, { t: 'pack.update', id: pk.id, items: pk.items });
        roomSend(room, { t: 'towel.placed', towel: tw });
      }
      break;
    }
    case 'towel.pickup': {
      if (!room) break;
      const tw = room.towels.get(msg.id);
      if (!tw || tw.owner !== p.id) break;
      room.towels.delete(tw.id);
      const pk = room.packs.get(p.packId);
      const item = { id: 'towel', name: 'Towel', emoji: '🧻', kind: 'towel' };
      if (pk) { pk.items.push(item); roomSend(room, { t: 'pack.update', id: pk.id, items: pk.items }); }
      else if (p.pack?.carried) p.pack.items.push(item);
      roomSend(room, { t: 'towel.gone', id: tw.id });
      break;
    }
    case 'chat': {
      if (!room) break;
      const text = String(msg.text || '').replace(/[\u0000-\u001f]/g, '').slice(0, 140);
      if (text) roomSend(room, { t: 'chat', id: p.id, name: p.name, text });
      break;
    }
  }
}

export function onDisconnect(p) {
  leaveRoom(p, true);
  state.players.delete(p.id);
}

// 12Hz per-room snapshots + weather ticking
export function tick() {
  const now = Date.now();
  for (const room of state.rooms.values()) {
    const ps = roomPlayers(room);
    if (!ps.length) { if (now - room.createdAt > 30000) state.rooms.delete(room.id); continue; }
    // weather machine: fog → (rain?) → sun
    const w = room.weather;
    if (w && now >= w.until) {
      if (w.phase === 'fog' && w.plan.rain > 0) { w.phase = 'rain'; w.until = now + w.plan.rain * 1000; }
      else if (w.phase !== 'sun') { w.phase = 'sun'; w.until = Infinity; }
      if (w.phase !== 'fogDone') roomSend(room, { t: 'weather', phase: w.phase, left: w.until === Infinity ? 0 : Math.round((w.until - now) / 1000) });
    }
    const snap = ps.map(publicPlayer);
    for (const p of ps) send(p, { t: 'snap', players: snap });
  }
}
