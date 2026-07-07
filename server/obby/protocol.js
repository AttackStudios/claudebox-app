// Obby message handling: joins, movement, chat + admin commands (;fly, ;staff…),
// checkpoints, the shared death/respawn flow, and the staff "troll" actions
// (carry/drop, laser, fling, freeze, tiny/giant, kill, bring).

import { state, genId, save, roleOf, isStaff, publicPlayer, OWNER_DEFAULT } from './state.js';
import { COURSE, START, checkpointById } from '../../shared/obby/course.js';
import { ensurePlatformUser } from '../hub.js';

const clean = (s, max = 24) => String(s ?? '').replace(/[ -]/g, '').trim().slice(0, max);
const TROLL_KINDS = new Set(['carry', 'drop', 'laser', 'fling', 'freeze', 'kill', 'tiny', 'giant', 'reset', 'bring']);
const CARRY_UP = 6;

export function makeBroadcaster(getClients) {
  return (msg, exceptId = null) => {
    const raw = JSON.stringify(msg);
    for (const p of getClients()) {
      if (p.id === exceptId) continue;
      if (p.ws && p.ws.readyState === 1) p.ws.send(raw);
    }
  };
}

export function killPlayer(p, cause, broadcast) {
  if (p.dead) return;
  p.dead = true;
  p.diedAt = Date.now();
  if (p.carriedBy) releaseCarry(p, broadcast);
  broadcast({ t: 'player.death', id: p.id, cause: cause || 'fell' });
}

function releaseCarry(victim, broadcast) {
  victim.carriedBy = null;
  broadcast({ t: 'troll.released', id: victim.id });
}

function findByName(nameLower) {
  for (const p of state.players.values()) if (p.joined && p.nameLower === nameLower) return p;
  return null;
}

export function handleMessage(p, msg, ctx) {
  const { broadcast, send } = ctx;
  switch (msg?.t) {
    case 'join': return onJoin(p, msg, ctx);

    case 'move': {
      if (!p.joined || p.dead) return;
      if (p.carriedBy || (p.frozenUntil && Date.now() < p.frozenUntil)) return; // server owns position
      p.pos = { x: +msg.x || 0, y: +msg.y || 0, z: +msg.z || 0 };
      p.ry = +msg.ry || 0;
      p.anim = clean(msg.anim, 12) || 'idle';
      return;
    }

    case 'checkpoint': {
      if (!p.joined) return;
      const n = msg.n | 0;
      const cp = COURSE.checkpoints.find((c) => c.n === n);
      if (!cp) return;
      if (n > (p.stage || 0) && Math.hypot(cp.x - p.pos.x, cp.z - p.pos.z) < 9) {
        p.stage = n;
        send({ t: 'checkpoint.ok', n });
        broadcast({ t: 'chat', id: 'sys', name: '🏁', text: `${p.name} reached checkpoint ${n}!` });
        if (n >= COURSE.finishStage) broadcast({ t: 'chat', id: 'sys', name: '🏆', text: `${p.name} finished the obby! 🎉` });
      }
      return;
    }

    case 'die': {
      if (!p.joined || p.dead) return;
      killPlayer(p, clean(msg.cause, 12) || 'fell', broadcast);
      return;
    }

    case 'respawn': {
      if (!p.joined) return;
      const cp = checkpointById(p.stage || 0);
      p.dead = false;
      p.pos = { x: cp.x + (Math.random() * 2 - 1), y: cp.y + 1.2, z: cp.z + (Math.random() * 2 - 1) };
      broadcast({ t: 'player.respawn', id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z });
      return;
    }

    case 'chat': {
      if (!p.joined) return;
      const text = clean(msg.text, 160);
      if (!text) return;
      if (text.startsWith(';')) return runCommand(p, text.slice(1).trim(), ctx);
      broadcast({ t: 'chat', id: p.id, name: p.name, text, role: p.role });
      return;
    }

    case 'fly': {  // client echoes its fly toggle so others animate it
      if (!p.joined || !isStaff(p.nameLower)) return;
      p.flying = !!msg.on;
      broadcast({ t: 'player.update', player: publicPlayer(p) });
      return;
    }

    case 'troll': return runTroll(p, msg, ctx);
  }
}

function onJoin(p, msg, ctx) {
  const { broadcast, send } = ctx;
  const name = clean(msg.name, 20) || 'Runner';
  p.name = name;
  p.nameLower = name.toLowerCase();
  // one session per name
  for (const q of state.players.values()) {
    if (q !== p && q.joined && q.nameLower === p.nameLower) {
      try { q.ws.close(4000, 'replaced'); } catch {}
      state.players.delete(q.id);
      broadcast({ t: 'player.leave', id: q.id });
    }
  }
  p.avatar = msg.avatar && typeof msg.avatar === 'object' ? msg.avatar : {};
  p.joined = true;
  p.dead = false;
  p.role = roleOf(p.nameLower);
  p.scale = 1;
  p.flying = false;
  p.stage = 0;
  p.carriedBy = null;
  p.frozenUntil = 0;
  p.pos = { x: START.x + (Math.random() * 3 - 1.5), y: START.y, z: START.z + (Math.random() * 3 - 1.5) };
  p.ry = 0; p.anim = 'idle';
  ensurePlatformUser(p.name);

  send({
    t: 'welcome',
    id: p.id,
    you: publicPlayer(p),
    players: [...state.players.values()].filter((q) => q.joined && q.id !== p.id).map(publicPlayer),
    staff: isStaff(p.nameLower),
    owner: p.role === 'owner',
  });
  broadcast({ t: 'player.join', player: publicPlayer(p) }, p.id);
  if (isStaff(p.nameLower)) send({ t: 'toast', text: `You are ${p.role.toUpperCase()} — type ;help for commands` });
}

// ----- chat admin commands -----
function runCommand(p, body, ctx) {
  const { send, broadcast } = ctx;
  const [cmd, ...rest] = body.split(/\s+/);
  const arg = rest.join(' ');
  const staff = isStaff(p.nameLower);
  const owner = p.role === 'owner';
  const cmdL = cmd.toLowerCase();

  if (cmdL === 'help') {
    send({ t: 'toast', text: staff
      ? 'Staff: ;fly ;unfly ;tp <name> ;bring <name> ;kill <name>' + (owner ? ' | Owner: ;staff <name> ;unstaff <name>' : '')
      : 'No staff powers. (Owner can /staff you.)' });
    return;
  }
  if (!staff) { send({ t: 'toast', text: 'Only staff can use commands.' }); return; }

  switch (cmdL) {
    case 'fly': p.flying = true; send({ t: 'fly', on: true }); broadcast({ t: 'player.update', player: publicPlayer(p) }); break;
    case 'unfly': p.flying = false; send({ t: 'fly', on: false }); broadcast({ t: 'player.update', player: publicPlayer(p) }); break;
    case 'tp': case 'goto': {
      const target = findByName(clean(arg, 20).toLowerCase());
      if (!target) return send({ t: 'toast', text: 'No such player here.' });
      p.pos = { ...target.pos, y: target.pos.y + 0.5 };
      broadcast({ t: 'player.respawn', id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z });
      break;
    }
    case 'bring': {
      const target = findByName(clean(arg, 20).toLowerCase());
      if (!target) return send({ t: 'toast', text: 'No such player here.' });
      target.pos = { ...p.pos, y: p.pos.y + 0.5 };
      broadcast({ t: 'player.respawn', id: target.id, x: target.pos.x, y: target.pos.y, z: target.pos.z });
      break;
    }
    case 'kill': {
      const target = findByName(clean(arg, 20).toLowerCase());
      if (!target) return send({ t: 'toast', text: 'No such player here.' });
      killPlayer(target, 'admin', broadcast);
      break;
    }
    case 'staff': case 'unstaff': case 'owner': {
      if (!owner) return send({ t: 'toast', text: 'Only the Owner can manage staff.' });
      const nl = clean(arg, 20).toLowerCase();
      if (!nl) return send({ t: 'toast', text: 'Usage: ;' + cmdL + ' <name>' });
      if (nl === OWNER_DEFAULT) return send({ t: 'toast', text: 'AttackFace15 is the permanent Owner.' });
      if (cmdL === 'unstaff') delete state.roles[nl];
      else state.roles[nl] = cmdL === 'owner' ? 'owner' : 'staff';
      save();
      const tp = findByName(nl);
      if (tp) { tp.role = roleOf(nl); broadcast({ t: 'player.update', player: publicPlayer(tp) }); }
      broadcast({ t: 'toast', text: `${arg} is now ${roleOf(nl).toUpperCase()}` });
      break;
    }
    default: send({ t: 'toast', text: `Unknown command ;${cmd}` });
  }
}

// ----- troll actions (staff only) -----
function runTroll(p, msg, ctx) {
  const { broadcast, send } = ctx;
  if (!p.joined || !isStaff(p.nameLower)) return;
  const kind = clean(msg.kind, 12);
  if (!TROLL_KINDS.has(kind)) return;
  const target = state.players.get(msg.target);
  if (!target || !target.joined || target.id === p.id) return;
  // must be reasonably close (except for releasing/freezing already-trolled)
  const near = Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) < 14;

  switch (kind) {
    case 'carry':
      if (!near) return send({ t: 'toast', text: 'Get closer to carry them.' });
      target.carriedBy = p.id; target.dead = false;
      broadcast({ t: 'troll.carried', id: target.id, by: p.id });
      broadcast({ t: 'chat', id: 'sys', name: '😇', text: `${p.name} ascended ${target.name}…` });
      break;
    case 'drop':
      if (target.carriedBy === p.id) { releaseCarry(target, broadcast); broadcast({ t: 'chat', id: 'sys', name: '😈', text: `${p.name} dropped ${target.name}!` }); }
      break;
    case 'laser':
      if (!near) return send({ t: 'toast', text: 'Too far for lasers.' });
      broadcast({ t: 'troll.fx', kind: 'laser', by: p.id, target: target.id });
      killPlayer(target, 'laser', broadcast);
      break;
    case 'fling': {
      if (!near) return;
      const a = Math.random() * 6.28;
      broadcast({ t: 'troll.fling', id: target.id, vx: Math.cos(a) * 16, vy: 26, vz: Math.sin(a) * 16 });
      break;
    }
    case 'freeze':
      target.frozenUntil = Date.now() + 5000;
      broadcast({ t: 'troll.freeze', id: target.id, until: target.frozenUntil });
      break;
    case 'tiny': target.scale = 0.4; broadcast({ t: 'player.update', player: publicPlayer(target) }); break;
    case 'giant': target.scale = 2.4; broadcast({ t: 'player.update', player: publicPlayer(target) }); break;
    case 'reset': target.scale = 1; if (target.carriedBy === p.id) releaseCarry(target, broadcast); broadcast({ t: 'player.update', player: publicPlayer(target) }); break;
    case 'kill': killPlayer(target, 'admin', broadcast); break;
    case 'bring': target.pos = { ...p.pos, y: p.pos.y + 0.5 }; broadcast({ t: 'player.respawn', id: target.id, x: target.pos.x, y: target.pos.y, z: target.pos.z }); break;
  }
}

// server-driven physics for carried victims (called each snapshot tick)
export function tickTrolls(broadcast) {
  for (const v of state.players.values()) {
    if (!v.carriedBy) continue;
    const carrier = state.players.get(v.carriedBy);
    if (!carrier || !carrier.joined) { releaseCarry(v, broadcast); continue; }
    v.pos = { x: carrier.pos.x, y: carrier.pos.y + CARRY_UP, z: carrier.pos.z };
    v.anim = 'fall';
  }
}

export function onDisconnect(p, ctx) {
  // release anyone this player was carrying
  for (const v of state.players.values()) if (v.carriedBy === p.id) releaseCarry(v, ctx.broadcast);
  state.players.delete(p.id);
  if (p.joined) ctx.broadcast({ t: 'player.leave', id: p.id });
}
