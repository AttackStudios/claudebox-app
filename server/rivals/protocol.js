// Rivals message handling: lobby presence, queueing (with bot fill), match
// input relay, and authoritative combat calls into match.js.

import { state, clock, publicPlayer, publicFighter } from './state.js';
import { ROUND, MODES, WEAPONS, LOADOUT, WAVE } from '../../shared/rivals/config.js';
import { createMatch, createWaveMatch, addWavePlayer, matchSend, matchRoster, tickMatch, fireHitscan, meleeSwing, throwGrenade } from './match.js';
import { tickBots } from './bots.js';
import { ensurePlatformUser, checkAccess, isBanned } from '../hub.js';

const clean = (s, max = 24) => String(s ?? '').replace(/[ -]/g, '').trim().slice(0, max);

export function makeBroadcaster(getClients) {
  return (msg, exceptId = null) => {
    const raw = JSON.stringify(msg);
    for (const p of getClients()) {
      if (p.id === exceptId) continue;
      if (p.ws && p.ws.readyState === 1) p.ws.send(raw);
    }
  };
}

const lobbyPlayers = () => [...state.players.values()].filter((p) => p.joined && !p.matchId);

function lobbySend(msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const p of lobbyPlayers()) {
    if (p.id === exceptId) continue;
    if (p.ws?.readyState === 1) p.ws.send(raw);
  }
}

function dequeue(id) {
  for (const q of Object.values(state.queues)) {
    const i = q.findIndex((e) => e.id === id);
    if (i >= 0) q.splice(i, 1);
  }
}

export function handleMessage(p, msg, ctx) {
  switch (msg?.t) {
    case 'join': return onJoin(p, msg, ctx);

    case 'skins': { if (p.joined) p.skins = msg.skins && typeof msg.skins === 'object' ? msg.skins : null; return; }

    case 'move': { // lobby OR match movement (client-authoritative, like the rest of the platform)
      if (!p.joined) return;
      const m = p.matchId && state.matches.get(p.matchId);
      if (m) {
        const f = m.fighters.get(p.id);
        if (!f || f.dead || m.state === 'freeze' || m.state === 'vote' || m.state === 'loading') return;
        f.pos = { x: +msg.x || 0, y: Math.max(0, +msg.y || 0), z: +msg.z || 0 };
        f.ry = +msg.ry || 0; f.pitch = +msg.pitch || 0;
        f.anim = clean(msg.anim, 12) || 'idle';
        f.crouch = !!msg.crouch;
      } else {
        p.pos = { x: +msg.x || 0, y: Math.max(0, +msg.y || 0), z: +msg.z || 0 };
        p.ry = +msg.ry || 0;
        p.anim = clean(msg.anim, 12) || 'idle';
      }
      return;
    }

    case 'queue.join': {
      if (!p.joined || p.matchId) return;
      const mode = MODES[msg.mode] ? msg.mode : 'duo';
      dequeue(p.id);
      if (mode === 'wave') {
        // a round only needs one player to start — and anyone can hop into a
        // round that's already running
        const live = state.waveMatchId && state.matches.get(state.waveMatchId);
        if (live && live.state !== 'podium') {
          joinWave(live, p);
        } else {
          const m = createWaveMatch([p.id]);
          lobbySend({ t: 'player.leave', id: p.id });
          matchSend(m, { t: 'match.start', matchId: m.id, mode: 'wave', map: m.map, roster: matchRoster(m), wave: m.wave, waveTotal: WAVE.waves, arsenal: WAVE.startArsenal });
        }
        return;
      }
      state.queues[mode].push({ id: p.id, since: clock() });
      p.ws.send(JSON.stringify({ t: 'queue.state', mode, since: clock() }));
      return;
    }
    case 'queue.leave': { dequeue(p.id); p.ws.send(JSON.stringify({ t: 'queue.state', mode: null })); return; }

    case 'vote': {
      const m = p.matchId && state.matches.get(p.matchId);
      if (!m || m.state !== 'vote') return;
      const map = ['random', 'arena', 'battleground'].includes(msg.map) ? msg.map : 'random';
      m.votes[p.id] = map;
      const counts = {};
      for (const v of Object.values(m.votes)) counts[v] = (counts[v] || 0) + 1;
      matchSend(m, { t: 'vote.state', counts, total: [...m.fighters.values()].filter((f) => !f.bot).length });
      return;
    }

    case 'weapon': {
      if (!WEAPONS[msg.id]) return;
      const m = p.matchId && state.matches.get(p.matchId);
      const f = m?.fighters.get(p.id);
      if (f && !f.dead) {
        if (m.mode === 'wave' && f.arsenal && !f.arsenal.includes(msg.id)) return;
        if (m.mode !== 'wave' && !LOADOUT.includes(msg.id)) return;
        f.weapon = msg.id;
      } else if (!m && LOADOUT.includes(msg.id)) p.weapon = msg.id;   // lobby: show what they're holding too
      return;
    }

    case 'fire': {
      const m = p.matchId && state.matches.get(p.matchId);
      const f = m?.fighters.get(p.id);
      if (!f || f.dead || m.state !== 'live') return;
      let wid = WEAPONS[msg.weapon] ? msg.weapon : 'ar';
      if (m.mode === 'wave' && f.arsenal && !f.arsenal.includes(wid)) wid = 'handgun';
      else if (m.mode !== 'wave' && !LOADOUT.includes(wid)) wid = 'ar';
      fireHitscan(m, f, +msg.dx || 0, +msg.dy || 0, +msg.dz || 0, wid);
      return;
    }
    case 'melee': {
      const m = p.matchId && state.matches.get(p.matchId);
      const f = m?.fighters.get(p.id);
      if (!f || f.dead || m.state !== 'live') return;
      meleeSwing(m, f, WEAPONS[msg.weapon]?.melee ? msg.weapon : 'scythe');
      return;
    }
    case 'dash': { // cosmetic relay; movement is client-side
      const m = p.matchId && state.matches.get(p.matchId);
      if (m) matchSend(m, { t: 'dash', id: p.id });
      return;
    }
    case 'nade': {
      const m = p.matchId && state.matches.get(p.matchId);
      const f = m?.fighters.get(p.id);
      if (!f || f.dead || m.state !== 'live') return;
      throwGrenade(m, f, +msg.dx || 0, +msg.dy || 0, +msg.dz || 0);
      return;
    }

    case 'chat': {
      const text = String(msg.text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140);
      if (!text || !p.joined) return;
      const out = { t: 'chat', id: p.id, name: p.name, text };
      const m = p.matchId && state.matches.get(p.matchId);
      if (m) { out.team = m.fighters.get(p.id)?.team || 'A'; matchSend(m, out); }
      else lobbySend(out);
      return;
    }
    case 'match.leave': return leaveMatch(p, ctx, true);
    case 'range.hit': return; // shooting-range targets are client-side
  }
}

function joinWave(m, p) {
  const f = addWavePlayer(m, p.id, true);
  if (!f) return;
  lobbySend({ t: 'player.leave', id: p.id });
  p.ws.send(JSON.stringify({
    t: 'match.start', matchId: m.id, mode: 'wave', map: m.map, roster: matchRoster(m),
    wave: m.wave, waveTotal: WAVE.waves, arsenal: f.arsenal,
    joinLive: true, state: m.state, botsLeft: m.botsLeft, nextAt: m.stateUntil,
  }));
}

function onJoin(p, msg, ctx) {
  if (!checkAccess(msg.code)) { try { p.ws.send(JSON.stringify({ t: 'toast', text: 'Locked — open from the ClaudeBox hub with the invite code.' })); p.ws.close(4003, 'locked'); } catch {} return; }
  const name = clean(msg.name, 20) || 'Rival';
  p.name = name;
  p.nameLower = name.toLowerCase();
  for (const q of state.players.values()) {
    if (q !== p && q.joined && q.nameLower === p.nameLower) {
      try { q.ws.close(4000, 'replaced'); } catch {}
      cleanupPlayer(q, ctx);
    }
  }
  p.avatar = msg.avatar && typeof msg.avatar === 'object' ? msg.avatar : {};
  p.skins = msg.skins && typeof msg.skins === 'object' ? msg.skins : null;
  p.platform = ['phone', 'tablet', 'laptop', 'pc'].includes(msg.platform) ? msg.platform : null;
  p.joined = true;
  p.matchId = null;
  p.pos = { x: -6 + Math.random() * 2, y: 0, z: 8 + Math.random() * 2 };
  p.ry = -0.36; p.anim = 'idle';
  if (isBanned(p.name)) { try { p.ws.send(JSON.stringify({ t: 'toast', text: 'You are banned from ClaudeBox.' })); p.ws.close(4009, 'banned'); } catch {} return; }
  ensurePlatformUser(p.name);
  p.ws.send(JSON.stringify({
    t: 'welcome', id: p.id, you: publicPlayer(p),
    players: lobbyPlayers().filter((q) => q.id !== p.id).map(publicPlayer),
  }));
  lobbySend({ t: 'player.join', player: publicPlayer(p) }, p.id);
}

function leaveMatch(p, ctx, backToLobby) {
  const m = p.matchId && state.matches.get(p.matchId);
  p.matchId = null;
  if (m) {
    const f = m.fighters.get(p.id);
    if (f) { f.dead = true; f.leftMatch = true; }
    m.fighters.delete(p.id);
    matchSend(m, { t: 'fighter.leave', id: p.id });
    // no humans left → tear down
    if (![...m.fighters.values()].some((q) => !q.bot)) {
      state.matches.delete(m.id);
      if (state.waveMatchId === m.id) state.waveMatchId = null;
    }
  }
  if (backToLobby && p.ws?.readyState === 1) {
    p.pos = { x: -6 + Math.random() * 2, y: 0, z: 8 + Math.random() * 2 };
    p.ws.send(JSON.stringify({ t: 'lobby', players: lobbyPlayers().filter((q) => q.id !== p.id).map(publicPlayer) }));
    lobbySend({ t: 'player.join', player: publicPlayer(p) }, p.id);
  }
}

function cleanupPlayer(p, ctx) {
  dequeue(p.id);
  const m = p.matchId && state.matches.get(p.matchId);
  if (m) leaveMatch(p, ctx, false);
  state.players.delete(p.id);
  lobbySend({ t: 'player.leave', id: p.id });
}

export function onDisconnect(p, ctx) { cleanupPlayer(p, ctx); }

// ---------------- server ticks (called from index.js) ----------------
function tryMatchQueues() {
  const now = clock();
  // beginner: instant 1v1 vs an easy bot
  while (state.queues.beginner.length) {
    const e = state.queues.beginner.shift();
    if (!state.players.get(e.id)?.joined) continue;
    startMatch('beginner', [e.id], 1, 'easy');
  }
  // duo: pair humans, else bot after botFillSecs
  const duo = state.queues.duo;
  while (duo.length >= 2) {
    const [a, b] = [duo.shift(), duo.shift()];
    startMatch('duo', [a.id, b.id], 0, 'normal');
  }
  if (duo.length === 1 && now - duo[0].since >= ROUND.botFillSecs) {
    const e = duo.shift();
    if (state.players.get(e.id)?.joined) startMatch('duo', [e.id], 1, 'normal');
  }
  // squad (2v2): 4 humans, else fill with bots
  const sq = state.queues.squad;
  while (sq.length >= 4) {
    const four = sq.splice(0, 4);
    startMatch('squad', four.map((e) => e.id), 0, 'normal');
  }
  if (sq.length >= 1 && now - sq[0].since >= ROUND.botFillSecs) {
    const humans = sq.splice(0, Math.min(sq.length, 4)).map((e) => e.id);
    startMatch('squad', humans, 4 - humans.length, 'normal');
  }
}

function startMatch(mode, playerIds, botsNeeded, botSkill) {
  const live = playerIds.filter((id) => state.players.get(id)?.joined);
  if (!live.length) return;
  const m = createMatch(mode, live, botsNeeded, botSkill);
  for (const id of live) lobbySend({ t: 'player.leave', id });
  matchSend(m, {
    t: 'match.start', matchId: m.id, mode,
    roster: matchRoster(m), voteEnds: m.stateUntil,
  });
}

function endMatch(m) {
  state.matches.delete(m.id);
  for (const f of [...m.fighters.values()]) {
    if (f.bot) continue;
    const p = state.players.get(f.id);
    if (p) {
      p.matchId = null;
      p.pos = { x: -6 + Math.random() * 2, y: 0, z: 8 + Math.random() * 2 };
      if (p.ws?.readyState === 1) p.ws.send(JSON.stringify({ t: 'lobby', players: lobbyPlayers().filter((q) => q.id !== p.id).map(publicPlayer) }));
      lobbySend({ t: 'player.join', player: publicPlayer(p) }, p.id);
    }
  }
}

let lastTick = clock();
export function tickRivals() {
  const now = clock();
  const dt = Math.min(0.1, now - lastTick);
  lastTick = now;
  tryMatchQueues();
  for (const m of [...state.matches.values()]) tickMatch(m, dt, tickBots, endMatch);
}

export function snapshotRivals() {
  // lobby snapshot
  const lp = lobbyPlayers();
  if (lp.length) {
    const raw = JSON.stringify({ t: 'snap', players: lp.map(publicPlayer) });
    for (const p of lp) if (p.ws?.readyState === 1) p.ws.send(raw);
  }
  // per-match snapshots
  for (const m of state.matches.values()) {
    if (m.state === 'vote' || m.state === 'loading') continue;
    const snap = { t: 'snap', fighters: [...m.fighters.values()].map(publicFighter), until: m.stateUntil, state: m.state };
    if (m.mode === 'wave') { snap.wave = m.wave; snap.botsLeft = m.botsLeft; snap.waveTotal = WAVE.waves; }
    matchSend(m, snap);
  }
}
