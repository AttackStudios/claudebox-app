// Rivals server state: connected players, queues, and live matches.

let nextId = 1;
export const genId = (p = 'rv') => `${p}${(nextId++).toString(36)}`;

export const state = {
  players: new Map(),                        // ws id -> player (lobby + in-match)
  queues: { beginner: [], duo: [], squad: [] }, // arrays of player ids
  matches: new Map(),                        // match id -> match
};

export function clock() { return Date.now() / 1000; }

// what other clients need to render someone in the LOBBY
export function publicPlayer(p) {
  return { id: p.id, name: p.name, avatar: p.avatar, pos: p.pos, ry: p.ry, anim: p.anim, weapon: p.weapon || 'ar' };
}

// what match clients need to render a FIGHTER
export function publicFighter(f) {
  return {
    id: f.id, name: f.name, avatar: f.avatar, team: f.team, bot: !!f.bot,
    pos: f.pos, ry: f.ry, pitch: f.pitch, anim: f.anim, crouch: !!f.crouch,
    hp: Math.round(f.hp), weapon: f.weapon, dead: !!f.dead,
  };
}
