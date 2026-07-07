// Feather Friends server: static files over HTTP, game protocol over WebSocket.

import express from 'express';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { state, genId } from './state.js';
import { handleMessage, onDisconnect, makeBroadcaster, npcPublic } from './protocol.js';
import { topUpItems, tickItems } from './items.js';
import { spawnNpcs, tickNpcs } from './npcs.js';
import { hubRouter, FF_MAINTENANCE, BP_MAINTENANCE } from './hub.js';
import { startSync } from './persist.js';
import { state as bpState, genId as bpGenId, publicPlayer as bpPublicPlayer, publicVan, publicBear, clock01 } from './backpacking/state.js';
import { handleMessage as bpHandle, onDisconnect as bpDisconnect, makeBroadcaster as bpBroadcaster, killPlayer as bpKill, tickVans } from './backpacking/protocol.js';
import { spawnBears, tickBears } from './backpacking/bears.js';
import { state as rsState, genId as rsGenId } from './rs2/state.js';
import { handleMessage as rsHandle, onDisconnect as rsDisconnect, makeBroadcaster as rsBroadcaster } from './rs2/protocol.js';
import { tickRS2, setSimBroadcast } from './rs2/sim.js';
import { state as obState, genId as obGenId, publicPlayer as obPublicPlayer, clock as obClock } from './obby/state.js';
import { handleMessage as obHandle, onDisconnect as obDisconnect, makeBroadcaster as obBroadcaster, tickTrolls } from './obby/protocol.js';
import { applyCourse as obApplyCourse } from '../shared/obby/course.js';
import { applyWorld as wbApplyWorld } from '../shared/wibit/park.js';
import { toObbyCourse, toWibitWorld } from '../shared/studio/adapters.js';
import { state as wbState, genId as wbGenId, publicPlayer as wbPublicPlayer, clock as wbClock } from './wibit/state.js';
import { handleMessage as wbHandle, onDisconnect as wbDisconnect, makeBroadcaster as wbBroadcaster, tickRound as wbTickRound, getRoundInfo as wbRoundInfo } from './wibit/protocol.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8787;

const app = express();
app.get('/health', (req, res) => res.json({ ok: true, platform: 'claudebox', game: 'feather-friends' }));

// ClaudeBox hub owns the root; games live under /games/<id>
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'hub', 'index.html')));
app.get('/games/feather-friends', (req, res) => {
  if (FF_MAINTENANCE && req.query.dev !== '1') {   // ?dev=1 = maintenance bypass for testing
    return res.status(503).send(`<!doctype html><meta charset="utf-8">
      <title>Feather Friends — updating</title>
      <body style="margin:0;display:grid;place-items:center;height:100vh;background:#10141d;color:#e8eef8;font-family:'Trebuchet MS',sans-serif;text-align:center">
      <div><div style="font-size:64px">🔧🪶</div>
      <h1 style="margin:12px 0 6px">Feather Friends is being upgraded</h1>
      <p style="opacity:.7">New flight, new birds. Back soon!</p>
      <a href="/" style="color:#38b6e8">← Back to ClaudeBox</a></div>`);
  }
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});
app.get('/games/backpacking', (req, res) => {
  if (BP_MAINTENANCE && req.query.dev !== '1') {   // ?dev=1 = maintenance bypass for testing
    return res.status(503).send(`<!doctype html><meta charset="utf-8">
      <title>Backpacking — updating</title>
      <body style="margin:0;display:grid;place-items:center;height:100vh;background:#10141d;color:#e8eef8;font-family:'Trebuchet MS',sans-serif;text-align:center">
      <div><div style="font-size:64px">🔧⛺</div>
      <h1 style="margin:12px 0 6px">Backpacking is being upgraded</h1>
      <p style="opacity:.7">Bigger map, brighter nights, more to explore. Back soon!</p>
      <a href="/" style="color:#38b6e8">← Back to ClaudeBox</a></div>`);
  }
  res.sendFile(path.join(ROOT, 'public', 'backpacking', 'index.html'));
});
app.get('/games/restaurant-sim-2', (req, res) => res.sendFile(path.join(ROOT, 'public', 'restaurant-sim-2', 'index.html')));
app.get('/games/obby', (req, res) => res.sendFile(path.join(ROOT, 'public', 'obby', 'index.html')));
app.get('/games/wibit', (req, res) => res.sendFile(path.join(ROOT, 'public', 'wibit', 'index.html')));
app.get('/studio', (req, res) => res.sendFile(path.join(ROOT, 'public', 'studio', 'index.html')));
app.get('/games/playground', (req, res) => res.sendFile(path.join(ROOT, 'public', 'studio', 'index.html')));
app.use('/api', hubRouter());

app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/Soundtrack', express.static(path.join(ROOT, 'Soundtrack')));
app.use(express.static(path.join(ROOT, 'public'), { index: false }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const bpWss = new WebSocketServer({ noServer: true });
const rsWss = new WebSocketServer({ noServer: true });
const obWss = new WebSocketServer({ noServer: true });
const wbWss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  else if (pathname === '/bp-ws') bpWss.handleUpgrade(req, socket, head, (ws) => bpWss.emit('connection', ws, req));
  else if (pathname === '/rs2-ws') rsWss.handleUpgrade(req, socket, head, (ws) => rsWss.emit('connection', ws, req));
  else if (pathname === '/obby-ws') obWss.handleUpgrade(req, socket, head, (ws) => obWss.emit('connection', ws, req));
  else if (pathname === '/wibit-ws') wbWss.handleUpgrade(req, socket, head, (ws) => wbWss.emit('connection', ws, req));
  else socket.destroy();
});

const joinedPlayers = () => [...state.players.values()].filter((p) => p.joined);
const broadcast = makeBroadcaster(joinedPlayers);

wss.on('connection', (ws) => {
  const p = {
    id: genId('p'),
    ws,
    joined: false,
    name: '', nameLower: '',
    bird: null, nameStyle: null,
    pos: { x: 0, y: 0, z: 0 }, ry: 0, anim: 'idle',
    carrying: null, carriedBy: null,
    allowPickup: true, flock: null,
  };
  state.players.set(p.id, p);

  const ctx = { broadcast, send: (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg)) };

  ws.on('message', (raw) => {
    if (raw.length > 4096) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { handleMessage(p, msg, ctx); } catch (err) {
      console.error('[protocol]', msg?.t, err);
    }
  });
  ws.on('close', () => onDisconnect(p, ctx));
  ws.on('error', () => {});
});

// World simulation + snapshots at 12 Hz.
spawnNpcs();
topUpItems(broadcast);
let last = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Math.min(0.25, Number(now - last) / 1e9);
  last = now;

  tickNpcs(dt);
  tickItems(broadcast);

  const players = joinedPlayers().map((p) => [
    p.id,
    +p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2),
    +p.ry.toFixed(3), p.anim,
    +(p.rx || 0).toFixed(3), +(p.rz || 0).toFixed(3),   // flight attitude
  ]);
  const npcs = [...state.npcs.values()].map((n) => [
    n.id, +n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2), +n.ry.toFixed(3), n.anim,
  ]);
  broadcast({ t: 'snapshot', players, npcs });
}, 1000 / 12);

// Keep item supply topped up as things get eaten.
setInterval(() => topUpItems(broadcast), 15000);

// ====================== Backpacking ======================
const bpJoined = () => [...bpState.players.values()].filter((p) => p.joined);
const bpBroadcast = bpBroadcaster(bpJoined);

bpWss.on('connection', (ws) => {
  const p = {
    id: bpGenId('p'), ws, joined: false,
    name: '', nameLower: '', avatar: null,
    pos: { x: 0, y: 0, z: 0 }, ry: 0, anim: 'idle',
    dead: false, diedAt: 0, vanId: null, seat: null,
  };
  bpState.players.set(p.id, p);
  const ctx = { broadcast: bpBroadcast, send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
  ws.on('message', (raw) => {
    if (raw.length > 4096) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { bpHandle(p, msg, ctx); } catch (err) { console.error('[bp]', msg?.t, err); }
  });
  ws.on('close', () => bpDisconnect(p, ctx));
  ws.on('error', () => {});
});

spawnBears();
let bpLast = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Math.min(0.25, Number(now - bpLast) / 1e9);
  bpLast = now;
  tickBears(dt, (victim, cause) => bpKill(victim, cause, bpBroadcast), bpBroadcast);
  const players = bpJoined().map((p) => [
    p.id, +p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2), +p.ry.toFixed(3), p.anim,
  ]);
  const bears = [...bpState.bears.values()].map((b) => [
    b.id, +b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), +b.ry.toFixed(3), b.anim,
  ]);
  const vans = bpState.vans.map((v) => [
    v.id, +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2), +v.ry.toFixed(3),
    +v.pitch.toFixed(3), +v.roll.toFixed(3), +v.speed.toFixed(1),
  ]);
  bpBroadcast({ t: 'snapshot', players, bears, vans, clock: clock01() });
}, 1000 / 12);
setInterval(() => tickVans(bpBroadcast), 20000);

function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, () => {
  console.log(`Feather Friends running:`);
  console.log(`  this computer:  http://localhost:${PORT}`);
  console.log(`  your network:   http://${lanIp()}:${PORT}`);
});
startSync(); // cloud data mirroring (no-op unless Upstash env is set)


// ====================== Restaurant Simulator 2 ======================
const rsJoined = () => [...rsState.players.values()].filter((p) => p.joined);
const rsBroadcast = rsBroadcaster(rsJoined);
setSimBroadcast(rsBroadcast);
const rsSendTo = (p, m) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); };

rsWss.on('connection', (ws) => {
  const p = {
    id: rsGenId('p'), ws, joined: false,
    name: '', nameLower: '', avatar: null,
    pos: { x: 0, y: 0, z: 0 }, ry: 0, anim: 'idle',
    carryOrder: null, riding: null, hasBag: null,
  };
  rsState.players.set(p.id, p);
  const ctx = {
    broadcast: rsBroadcast,
    send: (m) => rsSendTo(p, m),
    sendTo: rsSendTo,
  };
  ws.on('message', (raw) => {
    if (raw.length > 8192) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { rsHandle(p, msg, ctx); } catch (err) { console.error('[rs2]', msg?.t, err); }
  });
  ws.on('close', () => rsDisconnect(p, { broadcast: rsBroadcast }));
  ws.on('error', () => {});
});

let rsLast = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Math.min(0.25, Number(now - rsLast) / 1e9);
  rsLast = now;
  tickRS2(dt, { broadcast: rsBroadcast, sendTo: rsSendTo });
  const players = rsJoined().map((p) => [
    p.id, +p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2), +p.ry.toFixed(3), p.anim, p.riding ? 1 : 0,
  ]);
  const npcs = [...rsState.customers.values()].map((n) => [
    n.id, +n.x.toFixed(2), +(n.y ?? 2.05).toFixed(2), +n.z.toFixed(2), +n.ry.toFixed(3), n.anim, n.riding ? 1 : 0,
  ]);
  rsBroadcast({ t: 'snapshot', players, npcs });
}, 1000 / 12);


// ====================== Obby (parkour) ======================
// If a level was designed for Obby in ClaudeBox Studio, make it the live course.
const DATA_DIR = process.env.CLAUDEBOX_DATA_DIR || path.join(ROOT, 'data');
function loadStudioLevel(slug) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'levels', slug + '.json'), 'utf8')); }
  catch { return null; }
}
{
  const course = toObbyCourse(loadStudioLevel('obby'));
  if (course) { obApplyCourse(course); console.log('[obby] loaded custom Studio level (' + course.platforms.length + ' platforms)'); }
}
const obJoined = () => [...obState.players.values()].filter((p) => p.joined);
const obBroadcast = obBroadcaster(obJoined);
obWss.on('connection', (ws) => {
  const p = {
    id: obGenId('p'), ws, joined: false,
    name: '', nameLower: '', avatar: null, role: 'player',
    pos: { x: 0, y: 0, z: 0 }, ry: 0, anim: 'idle',
    scale: 1, flying: false, dead: false, diedAt: 0, stage: 0, carriedBy: null, frozenUntil: 0,
  };
  obState.players.set(p.id, p);
  const ctx = { broadcast: obBroadcast, send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
  ws.on('message', (raw) => {
    if (raw.length > 4096) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { obHandle(p, msg, ctx); } catch (err) { console.error('[obby]', msg?.t, err); }
  });
  ws.on('close', () => obDisconnect(p, ctx));
  ws.on('error', () => {});
});
setInterval(() => {
  tickTrolls(obBroadcast);
  const players = obJoined().map((p) => [
    p.id, +p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2), +p.ry.toFixed(3), p.anim,
  ]);
  obBroadcast({ t: 'snapshot', players, clock: obClock() });
}, 1000 / 14);


// ====================== Wibit Simulator (water park) ======================
{
  const world = toWibitWorld(loadStudioLevel('wibit'));
  if (world) { wbApplyWorld(world); console.log('[wibit] loaded custom Studio level (' + world.parts.length + ' parts)'); }
}
const wbJoined = () => [...wbState.players.values()].filter((p) => p.joined);
const wbBroadcast = wbBroadcaster(wbJoined);
wbWss.on('connection', (ws) => {
  const p = {
    id: wbGenId('p'), ws, joined: false,
    name: '', nameLower: '', avatar: null,
    pos: { x: 0, y: 0, z: 0 }, ry: 0, anim: 'idle',
    swimming: false, out: false,
  };
  wbState.players.set(p.id, p);
  const ctx = { broadcast: wbBroadcast, send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
  ws.on('message', (raw) => {
    if (raw.length > 4096) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { wbHandle(p, msg, ctx); } catch (err) { console.error('[wibit]', msg?.t, err); }
  });
  ws.on('close', () => wbDisconnect(p, ctx));
  ws.on('error', () => {});
});
setInterval(() => {
  wbTickRound(wbBroadcast);
  const players = wbJoined().map((p) => [
    p.id, +p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2), +p.ry.toFixed(3), p.anim, p.swimming ? 1 : 0, p.out ? 1 : 0,
  ]);
  wbBroadcast({ t: 'snapshot', players, clock: wbClock(), round: wbRoundInfo() });
}, 1000 / 14);
