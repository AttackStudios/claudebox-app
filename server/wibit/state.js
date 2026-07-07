// Wibit Simulator server state: connected players and the shared Wipeout round.
// No admin roles, no persistence — it's a drop-in playground.

let nextId = 1;
export const genId = (p) => `${p}${(nextId++).toString(36)}`;

export const state = {
  players: new Map(),        // id -> player
  round: {
    phase: 'intermission',   // 'intermission' | 'active'
    endsAt: 0,               // ms timestamp the current phase ends
    alive: new Set(),        // player ids still standing this round
    startedWith: 0,          // how many were in when the round began
    lastWinner: null,        // name of last round's winner
  },
};

export function clock() { return Date.now() / 1000; }

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar,
    pos: p.pos, ry: p.ry, anim: p.anim,
    swimming: p.swimming, out: p.out,
  };
}
