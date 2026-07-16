// Platform voice signaling: one WebSocket, named rooms. Every game world is a
// room ('pizza', 'brook', …) and every DM pair gets a private room
// ('dm:alice|bob'). The server ONLY relays WebRTC signaling and tracks who is
// in the room — audio itself is peer-to-peer and never touches us.

import { checkAccess, isBanned } from './hub.js';

let nextId = 1;
const genId = () => 'vc' + (nextId++).toString(36);
const rooms = new Map();   // room -> Map<id, member>

const ROOM_RE = /^[a-z0-9|:_-]{1,80}$/i;
const MAX_ROOM = 12;

function roster(room) {
  const r = rooms.get(room);
  return r ? [...r.values()].map((m) => ({ id: m.id, name: m.name })) : [];
}
function roomSend(room, msg, exceptId = null) {
  const r = rooms.get(room);
  if (!r) return;
  const raw = JSON.stringify(msg);
  for (const m of r.values()) {
    if (m.id === exceptId) continue;
    if (m.ws.readyState === 1) m.ws.send(raw);
  }
}

export function voiceConnection(ws) {
  const member = { id: genId(), ws, room: null, name: '' };

  const leave = () => {
    if (!member.room) return;
    const r = rooms.get(member.room);
    if (r) {
      r.delete(member.id);
      if (!r.size) rooms.delete(member.room);
      else roomSend(member.room, { t: 'leave', id: member.id });
    }
    member.room = null;
  };

  ws.on('message', (raw) => {
    if (raw.length > 8192) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg?.t) {
      case 'join': {
        const room = String(msg.room || '');
        const name = String(msg.name || '').slice(0, 20);
        if (!ROOM_RE.test(room) || !name) return;
        if (!checkAccess(msg.code) || isBanned(name)) { try { ws.close(4003, 'no'); } catch {} return; }
        leave();
        member.room = room;
        member.name = name;
        if (!rooms.has(room)) rooms.set(room, new Map());
        const r = rooms.get(room);
        if (r.size >= MAX_ROOM) { try { ws.send(JSON.stringify({ t: 'full' })); } catch {} member.room = null; return; }
        r.set(member.id, member);
        ws.send(JSON.stringify({ t: 'joined', id: member.id, members: roster(room).filter((m) => m.id !== member.id) }));
        roomSend(room, { t: 'peer', id: member.id, name: member.name }, member.id);
        return;
      }
      case 'sig': {
        if (!member.room || !msg.to) return;
        const r = rooms.get(member.room);
        const target = r?.get(msg.to);
        if (target?.ws.readyState === 1) target.ws.send(JSON.stringify({ t: 'sig', from: member.id, data: msg.data }));
        return;
      }
      case 'leave': return leave();
    }
  });
  ws.on('close', leave);
  ws.on('error', () => {});
}
