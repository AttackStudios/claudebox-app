// Natural Disaster Survival — round state machine, disaster spawning, rewards,
// and the Multi-Disaster Machine. Movement is client-authoritative; the server
// picks the disasters + their params so every client renders the same event,
// and clients report their own death (water/disaster) which the server tallies.

import { state, genId, nowSec } from './state.js';
import { ROUND, DISASTER_IDS, WORLD } from '../../shared/nds/config.js';
import { ensurePlatformUser, grantReward, spendCubes } from '../hub.js';

let rand = mulberry(12345);
function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = (a, b) => a + rand() * (b - a);

export const joined = () => [...state.players.values()].filter((p) => p.joined);
function broadcast(msg) { const raw = JSON.stringify(msg); for (const p of state.players.values()) if (p.ws?.readyState === 1) p.ws.send(raw); }
export { broadcast as ndsBroadcast };

// ---- disaster param generation (server-authoritative, seeded) ----
function makeDisaster(id) {
  const R = WORLD.islandRadius;
  const now = nowSec();
  switch (id) {
    case 'tornado': {
      const ang = rnd(0, Math.PI * 2);
      return { id, x: Math.cos(ang) * R * 0.8, z: Math.sin(ang) * R * 0.8, vx: rnd(-4, 4), vz: rnd(-4, 4), radius: 6 };
    }
    case 'meteors': {
      const impacts = [];
      for (let i = 0; i < 22; i++) impacts.push({ x: rnd(-R, R), z: rnd(-R, R), t: rnd(1.5, ROUND.disaster - 3), r: rnd(3.5, 6) });
      return { id, impacts };
    }
    case 'flood': return { id, rise: (WORLD.islandY + 4.5 - WORLD.waterY) / (ROUND.disaster - 4), delay: 3 };
    case 'quake': {
      const fissures = [];
      for (let i = 0; i < 5; i++) { const a = rnd(0, Math.PI); fissures.push({ x: rnd(-R * 0.6, R * 0.6), z: rnd(-R * 0.6, R * 0.6), ang: a, len: rnd(18, 34), w: 2.4, openAt: rnd(2, 8) }); }
      return { id, fissures };
    }
    case 'tsunami': { const ang = rnd(0, Math.PI * 2); return { id, dirX: Math.cos(ang), dirZ: Math.sin(ang), arriveIn: rnd(9, 14), height: 6 }; }
    case 'wildfire': { const seeds = []; for (let i = 0; i < 4; i++) seeds.push({ x: rnd(-R * 0.7, R * 0.7), z: rnd(-R * 0.7, R * 0.7) }); return { id, seeds, spread: 1.6, delay: 2 }; }
    case 'volcano': return { id, delay: 3, lavaRate: 1.4 };
    case 'blizzard': { const warm = { x: rnd(-R * 0.5, R * 0.5), z: rnd(-R * 0.5, R * 0.5), r: 5 }; return { id, warm, freezeIn: 5 }; }
    case 'acid': { const pools = []; for (let i = 0; i < 8; i++) pools.push({ x: rnd(-R, R), z: rnd(-R, R), r: rnd(2.5, 4), growAt: rnd(1, 10) }); return { id, pools }; }
    default: return { id };
  }
}

function startRound() {
  state.round++;
  rand = mulberry((state.round * 2654435761) >>> 0);
  const count = 1 + state.stacks;
  const picked = [];
  const pool = [...DISASTER_IDS];
  for (let i = 0; i < count; i++) { const idx = Math.floor(rand() * pool.length); picked.push(pool[idx] ?? DISASTER_IDS[0]); }
  state.disasters = picked.map(makeDisaster);
  state.stacks = 0;
  // everyone starts the round ALIVE on the island
  for (const p of joined()) { p.alive = true; p.onIsland = true; }
  state.phase = 'warning'; state.phaseUntil = nowSec() + ROUND.warning;
  broadcast({ t: 'round', phase: 'warning', round: state.round, until: state.phaseUntil, disasters: state.disasters, seed: state.round });
}

function toDisaster() {
  state.phase = 'disaster'; state.phaseUntil = nowSec() + ROUND.disaster;
  broadcast({ t: 'round', phase: 'disaster', round: state.round, until: state.phaseUntil, disasters: state.disasters });
}

function endRound() {
  // survivors = joined players still alive
  const survivors = joined().filter((p) => p.alive);
  for (const p of survivors) {
    try {
      ensurePlatformUser(p.name);
      grantReward(p.name, ROUND.reward.stars, ROUND.reward.cubes);
    } catch {}
  }
  state.phase = 'aftermath'; state.phaseUntil = nowSec() + ROUND.aftermath;
  broadcast({ t: 'round', phase: 'aftermath', round: state.round, until: state.phaseUntil, survivors: survivors.map((p) => p.id) });
}

function toIntermission() {
  state.phase = 'intermission'; state.phaseUntil = nowSec() + ROUND.intermission;
  state.disasters = [];
  for (const p of joined()) { p.alive = true; p.onIsland = false; }
  broadcast({ t: 'round', phase: 'intermission', round: state.round, until: state.phaseUntil, stacks: state.stacks });
}

export function tickNds() {
  const now = nowSec();
  if (now < state.phaseUntil) return;
  if (state.phase === 'intermission') return startRound();
  if (state.phase === 'warning') return toDisaster();
  if (state.phase === 'disaster') return endRound();
  if (state.phase === 'aftermath') return toIntermission();
}

// ---- per-connection message handling ----
export function handleMessage(p, msg, ctx) {
  switch (msg?.t) {
    case 'join': {
      p.name = String(msg.name || 'Survivor').replace(/[^\w \-]/g, '').slice(0, 20) || 'Survivor';
      p.nameLower = p.name.toLowerCase();
      p.avatar = msg.avatar && typeof msg.avatar === 'object' ? msg.avatar : {};
      p.code = msg.code || '';
      p.joined = true; p.alive = true; p.onIsland = false;
      try { ensurePlatformUser(p.name); } catch {}
      p.ws.send(JSON.stringify({ t: 'welcome', id: p.id, phase: state.phase, until: state.phaseUntil, round: state.round, disasters: state.disasters, stacks: state.stacks, players: joined().filter((q) => q.id !== p.id).map(pub) }));
      broadcast({ t: 'player.join', player: pub(p) });
      return;
    }
    case 'move': {
      if (!p.joined) return;
      p.pos = { x: +msg.x || 0, y: +msg.y || 0, z: +msg.z || 0 };
      p.ry = +msg.ry || 0; p.anim = String(msg.anim || 'idle').slice(0, 12);
      return;
    }
    case 'dead': {   // client detected its own death (water / disaster)
      if (!p.joined || !p.alive) return;
      p.alive = false;
      broadcast({ t: 'dead', id: p.id, cause: String(msg.cause || 'disaster').slice(0, 16) });
      return;
    }
    case 'machine': {   // buy an extra disaster for next round with ClaudeBux
      if (!p.joined) return;
      const res = spendCubes(p.name, ROUND.machineCost);
      if (res.ok) { state.stacks++; broadcast({ t: 'stacks', stacks: state.stacks, by: p.name }); p.ws.send(JSON.stringify({ t: 'wallet', cubes: res.cubes })); }
      else p.ws.send(JSON.stringify({ t: 'toast', text: `Need ${ROUND.machineCost} 🔷 to stack a disaster (you have ${res.cubes}).` }));
      return;
    }
  }
}

const pub = (p) => ({ id: p.id, name: p.name, avatar: p.avatar, x: p.pos?.x || 0, y: p.pos?.y || 0, z: p.pos?.z || 0, ry: p.ry || 0, anim: p.anim || 'idle', alive: p.alive });

export function onDisconnect(p) {
  state.players.delete(p.id);
  broadcast({ t: 'player.leave', id: p.id });
}

export function snapshotNds() {
  const players = joined().map((p) => [p.id, +(p.pos?.x || 0).toFixed(2), +(p.pos?.y || 0).toFixed(2), +(p.pos?.z || 0).toFixed(2), +(p.ry || 0).toFixed(3), p.anim || 'idle', p.alive ? 1 : 0]);
  broadcast({ t: 'snap', players });
}
