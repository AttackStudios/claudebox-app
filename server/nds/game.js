// Natural Disaster Survival — round state machine, disaster spawning, rewards,
// and the Multi-Disaster Machine. Movement is client-authoritative; the server
// picks the disasters + their params so every client renders the same event,
// and clients report their own death (water/disaster) which the server tallies.

import { state, genId, nowSec } from './state.js';
import { ROUND, DISASTER_IDS, WORLD, MAPS, MAP_IDS } from '../../shared/nds/config.js';
import { ensurePlatformUser, grantReward, spendCubes } from '../hub.js';

let rand = mulberry(12345);
function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = (a, b) => a + rand() * (b - a);

export const joined = () => [...state.players.values()].filter((p) => p.joined);
function broadcast(msg) { const raw = JSON.stringify(msg); for (const p of state.players.values()) if (p.ws?.readyState === 1) p.ws.send(raw); }
export { broadcast as ndsBroadcast };

// ---- disaster param generation (server-authoritative, seeded) ----
function makeDisaster(id) {
  const R = MAPS[state.map]?.radius || WORLD.islandRadius;
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
    case 'thunderstorm': { const strikes = []; for (let i = 0; i < 15; i++) strikes.push({ x: rnd(-R, R), z: rnd(-R, R), t: rnd(1.5, ROUND.disaster - 2) }); return { id, strikes }; }
    case 'sandstorm': { const a = rnd(0, Math.PI * 2); return { id, windX: Math.cos(a), windZ: Math.sin(a) }; }
    case 'hail': { const stones = []; for (let i = 0; i < 44; i++) stones.push({ x: rnd(-R, R), z: rnd(-R, R), t: rnd(1.5, ROUND.disaster - 2), r: rnd(1, 2) }); return { id, stones }; }
    case 'heat': { const cool = { x: rnd(-R * 0.5, R * 0.5), z: rnd(-R * 0.5, R * 0.5), r: 5.5 }; return { id, cool, rampIn: 5 }; }
    case 'toxic': { const a = rnd(0, Math.PI * 2), rr = rnd(0, R * 0.5); return { id, x: Math.cos(a) * rr, z: Math.sin(a) * rr, rate: R / (ROUND.disaster - 6) }; }
    case 'avalanche': { const a = rnd(0, Math.PI * 2); const lanes = []; for (let i = 0; i < 7; i++) lanes.push({ off: rnd(-R * 0.9, R * 0.9), t: rnd(3, 12), r: rnd(2, 3.2) }); return { id, dirX: Math.cos(a), dirZ: Math.sin(a), speed: 16, lanes }; }
    case 'ufo': { const strikes = []; for (let i = 0; i < 12; i++) strikes.push({ x: rnd(-R * 0.85, R * 0.85), z: rnd(-R * 0.85, R * 0.85), t: rnd(3, ROUND.disaster - 3) }); return { id, strikes }; }
    default: return { id };
  }
}

// ============================ AI PLAYERS ============================
const BOT_NAMES = ['StormChaserMax', 'DisasterDan', 'TornadoTina', 'QuakeQuinn', 'FloodFiona', 'BlizzardBen', 'LavaLena', 'WindyWes'];
const BOT_COLORS = ['#e05a4a', '#5a8ae0', '#e0c85a', '#7ae05a', '#a05ae0', '#e08a5a', '#5ae0c8'];
let botSeq = 0;
const bots = () => [...state.players.values()].filter((p) => p.bot);
function mkBot() {
  const name = BOT_NAMES[botSeq % BOT_NAMES.length] + (botSeq >= BOT_NAMES.length ? '_' + botSeq : '');
  botSeq++;
  const p = {
    id: genId('b'), bot: true, joined: true, alive: true, onIsland: false,
    name, nameLower: name.toLowerCase(),
    avatar: { body: Math.random() < 0.45 ? 'girl' : 'boy',
      shirtColor: BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)],
      pantsColor: BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)] },
    pos: { x: (Math.random() - 0.5) * 8, y: 0, z: -82 + (Math.random() - 0.5) * 8 },
    ry: Math.random() * 6.28, anim: 'idle', wp: null, speed: 5 + Math.random() * 2, deathAt: 0, deathCause: '',
  };
  state.players.set(p.id, p);
  broadcast({ t: 'player.join', player: pub(p) });
  return p;
}
function ensureBots() {
  const humans = [...state.players.values()].filter((p) => p.joined && !p.bot).length;
  const want = humans >= 5 ? 2 : humans >= 3 ? 4 : 5;
  const cur = bots();
  for (let i = cur.length; i < want; i++) mkBot();
  for (let i = want; i < cur.length; i++) { state.players.delete(cur[i].id); broadcast({ t: 'player.leave', id: cur[i].id }); }
}
// static ground height for bots (ignores destruction — close enough)
function botGround(x, z) {
  const M = MAPS[state.map]; if (!M) return 0;
  let best = 0;
  for (const p of M.pieces) {
    if (p.ns) continue;
    const top = p.y + p.h / 2;
    if (top <= 3.2 && top > best && Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) best = top;
  }
  return best;
}
function botsUpdate(dt) {
  const now = nowSec();
  const M = MAPS[state.map];
  for (const b of bots()) {
    // death on schedule during the disaster
    if (state.phase === 'disaster' && b.alive && b.deathAt && now >= b.deathAt) {
      b.alive = false; b.anim = 'fall';
      broadcast({ t: 'dead', id: b.id, cause: b.deathCause || 'disaster' });
      continue;
    }
    if (!b.alive) continue;
    // pick a wander area by phase
    let cx = 0, cz = -82, r = 6, onIsland = false;
    if (state.phase === 'warning' || state.phase === 'disaster' || state.phase === 'aftermath') {
      const sp = M?.spawn || { x: 0, z: 0, r: 8 };
      cx = sp.x; cz = sp.z; r = (sp.r || 6) + (state.phase === 'disaster' ? 10 : 3);
      onIsland = true;
    }
    // flee the tornado if one is nearby
    if (state.phase === 'disaster') {
      for (const d of state.disasters) {
        if (d.id !== 'tornado') continue;
        const dx = b.pos.x - d.x, dz = b.pos.z - d.z, dd = Math.hypot(dx, dz);
        if (dd < 14 && dd > 0.1) { b.wp = { x: b.pos.x + dx / dd * 16, z: b.pos.z + dz / dd * 16 }; }
      }
    }
    if (!b.wp || Math.hypot(b.wp.x - b.pos.x, b.wp.z - b.pos.z) < 1.2 || Math.random() < dt * 0.15) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
      b.wp = { x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr };
    }
    const dx = b.wp.x - b.pos.x, dz = b.wp.z - b.pos.z, dd = Math.hypot(dx, dz);
    const sp2 = b.speed * (state.phase === 'disaster' ? 1.35 : 1);
    if (dd > 0.4) {
      b.pos.x += dx / dd * sp2 * dt; b.pos.z += dz / dd * sp2 * dt;
      b.ry = Math.atan2(-dx / dd, -dz / dd);
      b.anim = 'run';
    } else b.anim = 'idle';
    b.pos.y = onIsland ? botGround(b.pos.x, b.pos.z) : 0;
  }
}

function startRound() {
  state.round++;
  rand = mulberry((state.round * 2654435761) >>> 0);
  let mi = Math.floor(rand() * MAP_IDS.length);
  if (MAP_IDS[mi] === state.map) mi = (mi + 1) % MAP_IDS.length;   // never the same map twice in a row
  state.map = MAP_IDS[mi] || MAP_IDS[0];
  const count = 1 + state.stacks;
  const picked = [];
  const pool = [...DISASTER_IDS];
  for (let i = 0; i < count; i++) { const idx = Math.floor(rand() * pool.length); picked.push(pool[idx] ?? DISASTER_IDS[0]); }
  state.disasters = picked.map(makeDisaster);
  state.stacks = 0;
  // everyone in the lobby joins the round on the island
  for (const p of joined()) { p.alive = true; p.onIsland = true; }
  const sp = MAPS[state.map]?.spawn || { x: 0, z: 0, r: 8 };
  for (const b of bots()) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * (sp.r || 6);
    b.pos = { x: sp.x + Math.cos(a) * rr, y: 0, z: sp.z + Math.sin(a) * rr };
    b.wp = null; b.deathAt = 0; b.alive = true;
  }
  state.phase = 'warning'; state.phaseUntil = nowSec() + ROUND.warning;
  broadcast({ t: 'round', phase: 'warning', round: state.round, until: state.phaseUntil, disasters: state.disasters, map: state.map, seed: state.round });
}

function toDisaster() {
  state.phase = 'disaster'; state.phaseUntil = nowSec() + ROUND.disaster;
  // bots are not great at surviving: roughly half get a scripted demise
  for (const b of bots()) {
    if (Math.random() < 0.55) {
      b.deathAt = nowSec() + rnd(5, ROUND.disaster - 4);
      b.deathCause = state.disasters[Math.floor(Math.random() * state.disasters.length)]?.id || 'disaster';
    } else b.deathAt = 0;
  }
  broadcast({ t: 'round', phase: 'disaster', round: state.round, until: state.phaseUntil, disasters: state.disasters, map: state.map });
}

function endRound() {
  // survivors = joined players still alive
  const survivors = joined().filter((p) => p.alive);
  for (const p of survivors) {
    if (p.bot) continue;
    try {
      ensurePlatformUser(p.name);
      grantReward(p.name, ROUND.reward.stars, ROUND.reward.cubes);
    } catch {}
  }
  state.phase = 'aftermath'; state.phaseUntil = nowSec() + ROUND.aftermath;
  broadcast({ t: 'round', phase: 'aftermath', round: state.round, until: state.phaseUntil, map: state.map, survivors: survivors.map((p) => p.id) });
}

function toIntermission() {
  state.phase = 'intermission'; state.phaseUntil = nowSec() + ROUND.intermission;
  state.disasters = [];
  for (const p of joined()) { p.alive = true; p.onIsland = false; }
  for (const b of bots()) { b.pos = { x: (Math.random() - 0.5) * 8, y: 0, z: -82 + (Math.random() - 0.5) * 8 }; b.wp = null; }
  broadcast({ t: 'round', phase: 'intermission', round: state.round, until: state.phaseUntil, stacks: state.stacks });
}

export function tickNds() {
  const now = nowSec();
  ensureBots();
  botsUpdate(0.25);
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
      p.ws.send(JSON.stringify({ t: 'welcome', id: p.id, phase: state.phase, until: state.phaseUntil, round: state.round, disasters: state.disasters, map: state.map, stacks: state.stacks, players: joined().filter((q) => q.id !== p.id).map(pub) }));
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
