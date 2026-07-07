// Rivals match engine: the round state machine (vote → teleport → freeze →
// live → round end → first-to-5 → podium), authoritative combat (hitscan
// raycasts vs map + fighters, melee, grenades), and world queries shared with
// the bot AI.

import { state, genId, clock, publicFighter } from './state.js';
import { MOVE, ROUND, WEAPONS, TIPS } from '../../shared/rivals/config.js';
import { MAPS, VOTE_OPTIONS } from '../../shared/rivals/maps.js';

// ---------------- geometry helpers ----------------
export function boxesOf(mapId) { return (MAPS[mapId] || MAPS.arena).boxes; }

// slab-method ray vs AABB list. Returns nearest hit dist or Infinity.
export function rayMapDist(boxes, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const b of boxes) {
    const minX = b.x - b.sx / 2, maxX = b.x + b.sx / 2;
    const minY = b.y - b.sy / 2, maxY = b.y + b.sy / 2;
    const minZ = b.z - b.sz / 2, maxZ = b.z + b.sz / 2;
    let t0 = 0, t1 = best;
    let ok = true;
    for (const [o, d, mn, mx] of [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } continue; }
      let ta = (mn - o) / d, tb = (mx - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < best) best = t0;
  }
  return best;
}

// ray vs one fighter's AABB; returns { dist, head } or null
function rayFighter(f, ox, oy, oz, dx, dy, dz, maxDist) {
  const h = f.crouch ? MOVE.heightCrouch : MOVE.heightStand;
  const cx = f.pos.x, cz = f.pos.z, cy = f.pos.y + h / 2;
  const ex = MOVE.radius + 0.08, ey = h / 2, ez = MOVE.radius + 0.08;
  let t0 = 0, t1 = maxDist;
  for (const [o, d, c, e] of [[ox, dx, cx, ex], [oy, dy, cy, ey], [oz, dz, cz, ez]]) {
    if (Math.abs(d) < 1e-9) { if (o < c - e || o > c + e) return null; continue; }
    let ta = (c - e - o) / d, tb = (c + e - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  const hitY = oy + dy * t0;
  const head = hitY > f.pos.y + h * 0.78;
  return { dist: t0, head };
}

export function hasLOS(boxes, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  return rayMapDist(boxes, ax, ay, az, dx / len, dy / len, dz / len, len) >= len - 0.05;
}

export function eyeY(f) { return f.pos.y + (f.crouch ? MOVE.eyeCrouch : MOVE.eyeStand); }

// ---------------- match construction ----------------
const BOT_NAMES = ['Blitz', 'Vex', 'Nova', 'Rogue', 'Titan', 'Echo', 'Frost', 'Havoc', 'Zed', 'Piston'];
const BOT_COLORS = ['#e0503c', '#7c5cff', '#2ec5e0', '#59d185', '#ffcf5c', '#ff7eb6'];
function makeBotAvatar() {
  const c = BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)];
  return { body: Math.random() < 0.5 ? 'boy' : 'girl', shirtColor: c, pantsColor: '#22242c', skin: '#e8b48a' };
}

function makeFighter(base) {
  return {
    ...base,
    hp: ROUND.maxHp, dead: false,
    pos: { x: 0, y: 0, z: 0 }, ry: 0, pitch: 0, anim: 'idle', crouch: false,
    weapon: 'ar', fireAt: 0, meleeAt: 0, dashAt: 0, grenades: WEAPONS.grenade.count,
    stats: { elims: 0, deaths: 0, assists: 0, dmgDealt: 0, dmgTaken: 0 },
    lastDamagedBy: null, assistBy: null,
    bot: base.bot || null, botMem: {},
  };
}

export function createMatch(mode, playerIds, botsNeeded, botSkill) {
  const m = {
    id: genId('m'), mode, state: 'vote', stateUntil: clock() + ROUND.voteSecs,
    map: 'arena', votes: {}, score: { A: 0, B: 0 }, round: 0,
    fighters: new Map(), grenades: [], pendingSnap: 0,
  };
  // humans alternate teams; bots fill the rest
  playerIds.forEach((pid, i) => {
    const p = state.players.get(pid);
    if (!p) return;
    const f = makeFighter({ id: p.id, name: p.name, avatar: p.avatar, team: i % 2 === 0 ? 'A' : 'B' });
    m.fighters.set(f.id, f);
    p.matchId = m.id;
  });
  for (let i = 0; i < botsNeeded; i++) {
    const teamCounts = { A: 0, B: 0 };
    for (const f of m.fighters.values()) teamCounts[f.team]++;
    const team = teamCounts.A <= teamCounts.B ? 'A' : 'B';
    const f = makeFighter({
      id: genId('bot'), name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + '_' + Math.floor(Math.random() * 99),
      avatar: makeBotAvatar(), team, bot: { skill: botSkill || 'normal' },
    });
    m.fighters.set(f.id, f);
  }
  state.matches.set(m.id, m);
  return m;
}

export function matchRoster(m) {
  return [...m.fighters.values()].map((f) => ({ id: f.id, name: f.name, avatar: f.avatar, team: f.team, bot: !!f.bot }));
}

// send to all human fighters of a match
export function matchSend(m, msg) {
  const raw = JSON.stringify(msg);
  for (const f of m.fighters.values()) {
    if (f.bot) continue;
    const p = state.players.get(f.id);
    if (p?.ws?.readyState === 1) p.ws.send(raw);
  }
}

function spawnFighters(m) {
  const map = MAPS[m.map] || MAPS.arena;
  const idx = { A: 0, B: 0 };
  for (const f of m.fighters.values()) {
    const list = f.team === 'A' ? map.spawnsA : map.spawnsB;
    const s = list[idx[f.team] % list.length]; idx[f.team]++;
    f.pos = { x: s.x + (Math.random() - 0.5), y: 0, z: s.z + (Math.random() - 0.5) };
    f.ry = s.ry; f.pitch = 0; f.hp = ROUND.maxHp; f.dead = false; f.anim = 'idle';
    f.weapon = 'ar'; f.grenades = WEAPONS.grenade.count; f.lastDamagedBy = null; f.assistBy = null;
    f.botMem = {};
  }
  m.grenades = [];
}

function startRound(m) {
  m.round++;
  spawnFighters(m);
  m.state = 'freeze'; m.stateUntil = clock() + ROUND.freezeSecs;
  matchSend(m, { t: 'round.freeze', round: m.round, score: m.score, until: m.stateUntil, fighters: [...m.fighters.values()].map(publicFighter) });
}

function resolveVote(m) {
  const counts = {};
  for (const v of Object.values(m.votes)) counts[v] = (counts[v] || 0) + 1;
  let pick = VOTE_OPTIONS.reduce((a, b) => ((counts[a] || 0) >= (counts[b] || 0) ? a : b));
  if (!Object.keys(counts).length) pick = 'random';
  if (pick === 'random') pick = Math.random() < 0.5 ? 'arena' : 'battleground';
  m.map = pick;
}

// ---------------- combat ----------------
export function applyDamage(m, target, amount, source, weapon, head) {
  if (target.dead || m.state !== 'live') return 0;
  const dealt = Math.min(target.hp, amount);
  target.hp -= dealt;
  target.stats.dmgTaken += dealt;
  if (source && source !== target) {
    source.stats.dmgDealt += dealt;
    if (target.lastDamagedBy && target.lastDamagedBy !== source.id) target.assistBy = target.lastDamagedBy;
    target.lastDamagedBy = source.id;
  }
  matchSend(m, { t: 'hp', id: target.id, hp: Math.round(target.hp) });
  if (source && !source.bot) {
    const p = state.players.get(source.id);
    if (p?.ws?.readyState === 1) p.ws.send(JSON.stringify({ t: 'dmg', target: target.id, amount: Math.round(dealt), head: !!head, x: target.pos.x, y: eyeY(target), z: target.pos.z }));
  }
  if (!target.bot && source && source !== target) {
    const tp = state.players.get(target.id);
    if (tp?.ws?.readyState === 1) tp.ws.send(JSON.stringify({ t: 'hurt', amount: Math.round(dealt), fx: source.pos.x, fz: source.pos.z }));
  }
  if (target.hp <= 0) elim(m, target, source, weapon);
  return dealt;
}

function elim(m, victim, killer, weapon) {
  victim.dead = true; victim.anim = 'death';
  victim.stats.deaths++;
  if (killer && killer !== victim) killer.stats.elims++;
  const assist = victim.assistBy && victim.assistBy !== killer?.id ? m.fighters.get(victim.assistBy) : null;
  if (assist) assist.stats.assists++;
  matchSend(m, { t: 'elim', victim: victim.id, killer: killer?.id || null, weapon: weapon || 'ar' });
  // round over?
  const alive = { A: 0, B: 0 };
  for (const f of m.fighters.values()) if (!f.dead) alive[f.team]++;
  if (m.state === 'live' && (alive.A === 0 || alive.B === 0)) {
    const winner = alive.A > 0 ? 'A' : 'B';
    endRound(m, winner, 'wipe');
  }
}

function endRound(m, winner, reason) {
  if (winner) m.score[winner]++;
  m.state = 'roundEnd'; m.stateUntil = clock() + 3;
  matchSend(m, { t: 'round.end', winner, reason, score: m.score });
  if (m.score.A >= ROUND.winScore || m.score.B >= ROUND.winScore) {
    m.state = 'podium'; m.stateUntil = clock() + ROUND.podiumSecs;
    const stats = [...m.fighters.values()].map((f) => ({
      id: f.id, name: f.name, avatar: f.avatar, team: f.team, bot: !!f.bot, ...f.stats,
    }));
    matchSend(m, { t: 'match.end', winner: m.score.A >= ROUND.winScore ? 'A' : 'B', score: m.score, stats });
  }
}

export function fireHitscan(m, shooter, dirX, dirY, dirZ, weaponId) {
  const w = WEAPONS[weaponId];
  if (!w || w.melee || w.utility) return;
  const now = clock();
  if (now - shooter.fireAt < w.rate * 0.85) return; // rate limit (lenient for latency)
  shooter.fireAt = now;
  const boxes = boxesOf(m.map);
  const ox = shooter.pos.x, oy = eyeY(shooter), oz = shooter.pos.z;
  const len = Math.hypot(dirX, dirY, dirZ) || 1; dirX /= len; dirY /= len; dirZ /= len;
  const wallDist = rayMapDist(boxes, ox, oy, oz, dirX, dirY, dirZ, w.range);
  let best = null, bestDist = wallDist;
  for (const f of m.fighters.values()) {
    if (f.id === shooter.id || f.dead || f.team === shooter.team) continue;
    const hit = rayFighter(f, ox, oy, oz, dirX, dirY, dirZ, w.range);
    if (hit && hit.dist < bestDist) { best = { f, head: hit.head }; bestDist = hit.dist; }
  }
  matchSend(m, { t: 'shot', id: shooter.id, weapon: weaponId, dist: bestDist });
  if (best) {
    const dmg = Math.round(w.dmg * (best.head ? w.headMult : 1));
    applyDamage(m, best.f, dmg, shooter, weaponId, best.head);
  }
}

export function meleeSwing(m, attacker) {
  const w = WEAPONS.scythe;
  const now = clock();
  if (now - attacker.meleeAt < w.rate * 0.85) return;
  attacker.meleeAt = now;
  matchSend(m, { t: 'shot', id: attacker.id, weapon: 'scythe', dist: w.range });
  const fx = -Math.sin(attacker.ry), fz = -Math.cos(attacker.ry);
  for (const f of m.fighters.values()) {
    if (f.id === attacker.id || f.dead || f.team === attacker.team) continue;
    const dx = f.pos.x - attacker.pos.x, dz = f.pos.z - attacker.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > w.range) continue;
    const dot = (dx / (d || 1)) * fx + (dz / (d || 1)) * fz;
    if (dot > 0.35 || d < 1.0) applyDamage(m, f, w.dmg, attacker, 'scythe', false);
  }
}

export function throwGrenade(m, thrower, dirX, dirY, dirZ) {
  const w = WEAPONS.grenade;
  const now = clock();
  if (thrower.grenades <= 0 || now - (thrower.nadeAt || 0) < w.rate) return;
  thrower.nadeAt = now; thrower.grenades--;
  const len = Math.hypot(dirX, dirY, dirZ) || 1;
  const g = {
    id: genId('g'), owner: thrower.id, team: thrower.team,
    x: thrower.pos.x, y: eyeY(thrower), z: thrower.pos.z,
    vx: (dirX / len) * w.throwVel, vy: (dirY / len) * w.throwVel + 2.5, vz: (dirZ / len) * w.throwVel,
    explodeAt: now + w.fuse,
  };
  m.grenades.push(g);
  matchSend(m, { t: 'nade.spawn', g: { id: g.id, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz } });
}

function tickGrenades(m, dt) {
  const boxes = boxesOf(m.map);
  const now = clock();
  const w = WEAPONS.grenade;
  for (let i = m.grenades.length - 1; i >= 0; i--) {
    const g = m.grenades[i];
    g.vy -= MOVE.gravity * 0.8 * dt;
    // integrate with 1-axis bounce checks
    const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
    if (pointInBoxes(boxes, nx, g.y, g.z)) g.vx *= -0.42; else g.x = nx;
    if (ny < 0.12 || pointInBoxes(boxes, g.x, ny, g.z)) { g.vy *= -0.42; g.vx *= 0.8; g.vz *= 0.8; if (Math.abs(g.vy) < 1) g.vy = 0; }
    else g.y = ny;
    if (pointInBoxes(boxes, g.x, g.y, nz)) g.vz *= -0.42; else g.z = nz;
    if (g.y < 0.12) g.y = 0.12;

    if (now >= g.explodeAt) {
      m.grenades.splice(i, 1);
      matchSend(m, { t: 'nade.boom', id: g.id, x: g.x, y: g.y, z: g.z });
      const owner = m.fighters.get(g.owner);
      for (const f of m.fighters.values()) {
        if (f.dead) continue;
        const d = Math.hypot(f.pos.x - g.x, eyeY(f) - g.y, f.pos.z - g.z);
        if (d > w.radius) continue;
        const friendly = f.team === g.team && f.id !== g.owner;
        if (friendly) continue;
        let dmg = w.maxDmg * (1 - d / w.radius);
        if (f.id === g.owner) dmg *= 0.5;
        if (dmg >= 1) applyDamage(m, f, Math.round(dmg), owner, 'grenade', false);
      }
    }
  }
}

function pointInBoxes(boxes, x, y, z) {
  for (const b of boxes) {
    if (x > b.x - b.sx / 2 && x < b.x + b.sx / 2 &&
        y > b.y - b.sy / 2 && y < b.y + b.sy / 2 &&
        z > b.z - b.sz / 2 && z < b.z + b.sz / 2) return true;
  }
  return false;
}

// ---------------- per-tick state machine ----------------
export function tickMatch(m, dt, tickBots, endMatchCb) {
  const now = clock();
  switch (m.state) {
    case 'vote':
      if (now >= m.stateUntil) {
        resolveVote(m);
        m.state = 'loading'; m.stateUntil = now + 2.5;
        matchSend(m, { t: 'match.map', map: m.map, tip: TIPS[Math.floor(Math.random() * TIPS.length)] });
      }
      break;
    case 'loading':
      if (now >= m.stateUntil) startRound(m);
      break;
    case 'freeze':
      if (now >= m.stateUntil) {
        m.state = 'live'; m.stateUntil = now + ROUND.roundSecs;
        matchSend(m, { t: 'round.live', until: m.stateUntil });
      }
      break;
    case 'live': {
      tickBots(m, dt);
      tickGrenades(m, dt);
      if (now >= m.stateUntil) {
        // timeout: side with more remaining HP takes the round (tie = no point)
        let hpA = 0, hpB = 0;
        for (const f of m.fighters.values()) if (!f.dead) (f.team === 'A' ? hpA += f.hp : hpB += f.hp);
        endRound(m, hpA === hpB ? null : hpA > hpB ? 'A' : 'B', 'time');
      }
      break;
    }
    case 'roundEnd':
      if (now >= m.stateUntil && m.state === 'roundEnd') startRound(m);
      break;
    case 'podium':
      if (now >= m.stateUntil) endMatchCb(m);
      break;
  }
}
