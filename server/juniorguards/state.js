// Junior Guards Simulator — server state: a SERVER BROWSER of player-made rooms.
let _id = 0;
export const genId = (p) => p + (Date.now().toString(36)) + (_id++).toString(36);

export const state = {
  players: new Map(),   // id -> player (all connected sockets, roomed or not)
  rooms: new Map(),     // id -> room
};

export function makeRoom(host, { name, mode, offline }) {
  const room = {
    id: genId('r'),
    name: String(name || `${host.name}'s server`).slice(0, 40),
    hostId: host.id,
    hostName: host.name,
    hostLower: host.nameLower,
    mode: mode === 'normal' ? 'normal' : 'rp',
    offline: !!offline,          // offline rooms never show in the browser
    started: false,
    invited: new Set(),          // nameLower allowed to join after start
    weather: null,               // set on start: { plan, phase, until }
    packs: new Map(),            // dropped backpacks: id -> {id, owner, x, y, z, items}
    towels: new Map(),           // placed towels: id -> {id, owner, x, y, z, color}
    createdAt: Date.now(),
  };
  state.rooms.set(room.id, room);
  return room;
}

export function roomPlayers(room) {
  return [...state.players.values()].filter((p) => p.room === room.id && p.joined);
}

export function publicRoom(room) {
  return {
    id: room.id, name: room.name, host: room.hostName, mode: room.mode,
    started: room.started, players: roomPlayers(room).length,
  };
}

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar, role: p.role,
    x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim,
    wet: p.wet, equip: p.equip, stretch: p.stretch, sitting: p.sitting,
    pack: p.pack ? p.pack.carried !== false : true,
  };
}
