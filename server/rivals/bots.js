// Rivals bot AI: strafing gunfights with human-ish aim error and reaction
// time. Bots share the same weapon stats and damage path as players.

import { MOVE, WEAPONS } from '../../shared/rivals/config.js';
import { boxesOf, hasLOS, eyeY, fireHitscan, meleeSwing, throwGrenade } from './match.js';
import { clock } from './state.js';

const SKILLS = {
  easy:   { aimErr: 0.16, reaction: 0.85, burst: 3, pause: 0.7, speed: 0.75 },
  normal: { aimErr: 0.065, reaction: 0.4, burst: 6, pause: 0.35, speed: 0.92 },
};

function collideXZ(boxes, x, z, y) {
  // push a fighter-sized AABB out of map boxes (feet y..y+height).
  // Two passes: adjacent boxes' padded volumes can overlap, and a single pass
  // can push out of one box straight into its neighbour (bots wedge forever).
  const r = MOVE.radius;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (y + 1.6 < b.y - b.sy / 2 || y > b.y + b.sy / 2) continue;
      const minX = b.x - b.sx / 2 - r, maxX = b.x + b.sx / 2 + r;
      const minZ = b.z - b.sz / 2 - r, maxZ = b.z + b.sz / 2 + r;
      if (x > minX && x < maxX && z > minZ && z < maxZ) {
        const dl = x - minX, dr = maxX - x, dn = z - minZ, df = maxZ - z;
        const m = Math.min(dl, dr, dn, df);
        if (m === dl) x = minX; else if (m === dr) x = maxX; else if (m === dn) z = minZ; else z = maxZ;
      }
    }
  }
  return { x, z };
}

export function tickBots(m, dt) {
  const boxes = boxesOf(m.map);
  const now = clock();
  for (const f of m.fighters.values()) {
    if (!f.bot || f.dead) continue;
    const mem = f.botMem;
    const skill = SKILLS[f.bot.skill] || SKILLS.normal;

    // pick nearest living enemy
    let enemy = null, ed = Infinity;
    for (const e of m.fighters.values()) {
      if (e.team === f.team || e.dead) continue;
      const d = Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z);
      if (d < ed) { ed = d; enemy = e; }
    }
    if (!enemy) { f.anim = 'idle'; continue; }

    const los = hasLOS(boxes, f.pos.x, eyeY(f), f.pos.z, enemy.pos.x, eyeY(enemy), enemy.pos.z);
    if (los) { mem.sawAt = mem.sawAt || now; mem.lastSeen = { ...enemy.pos }; }
    else mem.sawAt = null;

    // ---- movement: approach to mid range, then strafe ----
    if (!mem.strafeUntil || now > mem.strafeUntil) {
      mem.strafeDir = Math.random() < 0.5 ? -1 : 1;
      mem.strafeUntil = now + 0.6 + Math.random() * 0.9;
    }
    const tx = mem.lastSeen?.x ?? enemy.pos.x, tz = mem.lastSeen?.z ?? enemy.pos.z;
    const dx = tx - f.pos.x, dz = tz - f.pos.z;
    const dist = Math.hypot(dx, dz) || 1e-4;
    const fwdX = dx / dist, fwdZ = dz / dist;
    const strafeX = -fwdZ * mem.strafeDir, strafeZ = fwdX * mem.strafeDir;
    let moveX, moveZ;
    if (mem.detourUntil && now < mem.detourUntil) {           // unstuck detour
      moveX = Math.cos(mem.detourAng); moveZ = Math.sin(mem.detourAng);
    }
    else if (!los) { moveX = fwdX; moveZ = fwdZ; }            // hunt
    else if (dist > 18) { moveX = fwdX * 0.8 + strafeX * 0.5; moveZ = fwdZ * 0.8 + strafeZ * 0.5; }
    else if (dist < 6 && f.weapon !== 'scythe') { moveX = -fwdX * 0.5 + strafeX; moveZ = -fwdZ * 0.5 + strafeZ; }
    else { moveX = strafeX; moveZ = strafeZ; }
    const sp = MOVE.sprint * skill.speed;
    const ml = Math.hypot(moveX, moveZ) || 1;
    let nx = f.pos.x + (moveX / ml) * sp * dt;
    let nz = f.pos.z + (moveZ / ml) * sp * dt;
    const solved = collideXZ(boxes, nx, nz, f.pos.y);
    if (Math.hypot(solved.x - f.pos.x, solved.z - f.pos.z) < sp * dt * 0.25) {
      mem.strafeDir *= -1; mem.strafeUntil = now + 0.5;
    }
    f.pos.x = solved.x; f.pos.z = solved.z;
    // progress watchdog: if we've barely moved in 1.5s and can't see the
    // enemy, pick a random detour direction to route around whatever we hit
    if (!mem.progAt || now - mem.progAt > 1.5) {
      const moved = mem.progPos ? Math.hypot(f.pos.x - mem.progPos.x, f.pos.z - mem.progPos.z) : 99;
      if (moved < 1.2 && !los) {
        mem.detourAng = Math.random() * Math.PI * 2;
        mem.detourUntil = now + 0.9;
      }
      mem.progAt = now; mem.progPos = { x: f.pos.x, z: f.pos.z };
    }
    // simple jump arc (random hops while strafing in LOS)
    if (f.pos.y <= 0.001 && los && Math.random() < 0.006) mem.vy = MOVE.jumpVel * 0.9;
    if (mem.vy !== undefined) {
      f.pos.y += mem.vy * dt; mem.vy -= MOVE.gravity * dt;
      if (f.pos.y <= 0) { f.pos.y = 0; delete mem.vy; }
    }
    f.anim = los && dist < 18 ? 'run' : 'run';
    f.ry = Math.atan2(-(enemy.pos.x - f.pos.x), -(enemy.pos.z - f.pos.z));

    // ---- weapon choice ----
    if (dist < 3.2 && los) f.weapon = 'scythe';
    else if (dist > 3.8 && f.weapon === 'scythe') f.weapon = 'ar';

    // ---- combat ----
    if (los && mem.sawAt && now - mem.sawAt >= skill.reaction) {
      if (f.weapon === 'scythe') { meleeSwing(m, f, 'scythe'); continue; }
      // burst-fire management
      if (mem.pauseUntil && now < mem.pauseUntil) continue;
      mem.shots = mem.shots || 0;
      const ax = enemy.pos.x - f.pos.x;
      const ay = eyeY(enemy) - 0.18 - eyeY(f);
      const az = enemy.pos.z - f.pos.z;
      const al = Math.hypot(ax, ay, az) || 1;
      const err = skill.aimErr * (0.6 + Math.random() * 0.8);
      const dirX = ax / al + (Math.random() - 0.5) * err;
      const dirY = ay / al + (Math.random() - 0.5) * err;
      const dirZ = az / al + (Math.random() - 0.5) * err;
      fireHitscan(m, f, dirX, dirY, dirZ, 'ar');
      mem.shots++;
      if (mem.shots >= skill.burst) { mem.shots = 0; mem.pauseUntil = now + skill.pause; }
      // occasional grenade at range
      if (dist > 10 && dist < 24 && f.grenades > 0 && Math.random() < 0.002) {
        throwGrenade(m, f, ax / al, 0.45, az / al);
      }
    }
  }
}
