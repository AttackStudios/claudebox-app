// Build A Boat For Treasure — message protocol.
// Client to server: join, move, boat, launch, progress, sunk, finish, chat
// Server to client: welcome, player.join, player.leave, player.boat, snapshot,
//                   launched, runover, chat, toast, kicked

import { checkAccess, isBanned } from '../hub.js';
import { state, clock, assignPlot, releasePlot, plotOrigin, publicPlayer, PLOT_COUNT } from './state.js';
import { TOTAL_LEN, STAGE_LEN, STAGES } from '../../shared/bab/config.js';

const STRIP = /[\u0000-\u001f]/g;
const cleanName = (s, max = 20) => String(s ?? '').replace(STRIP, '').trim().slice(0, max);
const cleanTxt  = (s, max = 140) => String(s ?? '').replace(STRIP, '').trim().slice(0, max);
const num = (v) => (Number.isFinite(+v) ? +v : 0);

export function makeBroadcaster(getClients) {
  return (msg, exceptId = null) => {
    const raw = JSON.stringify(msg);
    for (const p of getClients()) {
      if (p.id === exceptId) continue;
      if (p.ws && p.ws.readyState === 1) p.ws.send(raw);
    }
  };
}

export function handleMessage(p, msg, ctx) {
  switch (msg?.t) {
    case 'join':     return onJoin(p, msg, ctx);
    case 'move':     return onMove(p, msg);
    case 'boat':     return onBoat(p, msg, ctx);
    case 'launch':   return onLaunch(p, msg, ctx);
    case 'progress': return onProgress(p, msg);
    case 'sunk':     return onSunk(p, msg, ctx);
    case 'finish':   return onFinish(p, msg, ctx);
    case 'chat': {
      if (!p.joined) return;
      const text = cleanTxt(msg.text);
      if (text) ctx.broadcast({ t: 'chat', id: p.id, name: p.name, text });
      return;
    }
  }
}

function onJoin(p, msg, ctx) {
  if (!checkAccess(msg.code)) {
    try {
      p.ws.send(JSON.stringify({ t: 'toast', text: 'Locked - open from the ClaudeBox hub.' }));
      p.ws.close(4003, 'locked');
    } catch {}
    return;
  }
  const { broadcast, send } = ctx;
  p.name = cleanName(msg.name) || 'Builder';
  p.nameLower = p.name.toLowerCase();

  if (isBanned(p.nameLower)) {
    try { p.ws.send(JSON.stringify({ t: 'kicked', reason: 'You are banned from ClaudeBox.' })); p.ws.close(4001, 'banned'); } catch {}
    return;
  }

  // one session per name - the newest device wins
  for (const q of state.players.values()) {
    if (q !== p && q.joined && q.nameLower === p.nameLower) {
      try {
        q.ws.send(JSON.stringify({ t: 'kicked', reason: p.name + ' just joined from another device.' }));
        q.ws.close(4000, 'replaced');
      } catch {}
      releasePlot(q); state.players.delete(q.id);
      broadcast({ t: 'player.leave', id: q.id });
    }
  }

  p.avatar = msg.avatar && typeof msg.avatar === 'object' ? msg.avatar : {};
  p.joined = true;
  p.plot = assignPlot(p);
  const o = plotOrigin(p.plot);
  p.pos = { x: o.x, y: 1, z: o.z };
  p.sailing = false; p.dist = 0; p.sunk = false;

  send({
    t: 'welcome',
    id: p.id,
    plot: p.plot,
    plotCount: PLOT_COUNT,
    players: [...state.players.values()]
      .filter((q) => q.joined && q !== p)
      .map((q) => ({ ...publicPlayer(q), boat: q.boat })),
  });
  broadcast({ t: 'player.join', player: publicPlayer(p) }, p.id);
}

function onMove(p, msg) {
  if (!p.joined) return;
  p.pos = { x: num(msg.x), y: num(msg.y), z: num(msg.z) };
  p.ry = num(msg.ry);
  p.anim = cleanTxt(msg.anim, 12) || 'idle';
}

// The whole boat, published when the builder stops editing. Capped so one
// player cannot flood the room with a ten-thousand-block monster.
function onBoat(p, msg, ctx) {
  if (!p.joined) return;
  const raw = Array.isArray(msg.blocks) ? msg.blocks.slice(0, 3000) : [];
  const blocks = raw.map((b) => ({
    b: cleanTxt(b?.b, 12), x: num(b?.x) | 0, y: num(b?.y) | 0, z: num(b?.z) | 0,
  }));
  p.boat = blocks;
  p.blocks = blocks.length;
  ctx.broadcast({ t: 'player.boat', id: p.id, blocks }, p.id);
}

function onLaunch(p, msg, ctx) {
  if (!p.joined || p.sailing) return;
  p.sailing = true; p.sunk = false; p.dist = 0; p.launchedAt = clock();
  ctx.broadcast({ t: 'launched', id: p.id, name: p.name });
}

function onProgress(p, msg) {
  if (!p.joined || !p.sailing) return;
  // monotonic and speed-capped: distance cannot outrun a plausible boat
  const want = Math.max(0, Math.min(TOTAL_LEN, num(msg.dist)));
  const maxSoFar = (clock() - p.launchedAt) * 40 + 20;
  p.dist = Math.max(p.dist, Math.min(want, maxSoFar));
  p.blocks = Math.max(0, Math.min(3000, num(msg.blocks) | 0));
}

function onSunk(p, msg, ctx) {
  if (!p.joined || !p.sailing) return;
  p.sailing = false; p.sunk = true;
  const si = Math.floor(p.dist / STAGE_LEN);
  ctx.broadcast({
    t: 'runover', id: p.id, name: p.name, dist: Math.round(p.dist),
    stage: STAGES[Math.min(STAGES.length - 1, si)]?.name || '', treasure: false,
  });
}

function onFinish(p, msg, ctx) {
  if (!p.joined || !p.sailing) return;
  p.sailing = false; p.sunk = false;
  ctx.broadcast({ t: 'runover', id: p.id, name: p.name, dist: Math.round(p.dist), stage: 'Treasure Cove', treasure: true });
}

export function onDisconnect(p, ctx) {
  releasePlot(p);
  state.players.delete(p.id);
  if (p.joined) ctx.broadcast({ t: 'player.leave', id: p.id });
}

export function snapshot() {
  return { t: 'snapshot', players: [...state.players.values()].filter((p) => p.joined).map(publicPlayer) };
}
