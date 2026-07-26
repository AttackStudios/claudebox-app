// Rivals bot AI: strafing gunfights with human-ish aim error and reaction
// time. Bots share the same weapon stats and damage path as players.

import { MOVE, WEAPONS } from '../../shared/rivals/config.js';
import { boxesOf, hasLOS, eyeY, fireHitscan, meleeSwing, throwGrenade } from './match.js';
import { clock } from './state.js';

// turn = max facing turn-rate (rad/s): low enough that a circle-strafing player
//        can get behind a bot and backstab it.
// track = how fast the aim converges on where you ACTUALLY are (lower = laggier
//         aim, so strafing throws off their shots — no more perfect tracking).
// forget = seconds after losing sight before the bot stops knowing your position.
// cone = min dot(facing, you) required to fire — a bot can only shoot what's in
//        front of it, so flanking makes it stop shooting until it turns to face you.
const SKILLS = {
  easy:   { aimErr: 0.22, reaction: 1.05, burst: 3, pause: 0.9, speed: 0.5, turn: 2.6, track: 4.5, forget: 2.0, cone: 0.5 },
  normal: { aimErr: 0.11, reaction: 0.6, burst: 5, pause: 0.55, speed: 0.66, turn: 3.9, track: 7, forget: 2.5, cone: 0.42 },
};

function collideXZ(boxes, x, z, y) {
  // push a fighter-sized AABB out of map boxes (feet y..y+height).
  // Two passes: adjacent boxes' padded volumes can overlap, and a single pass
  // can push out of one box straight into its neighbour (bots wedge forever).
  const r = MOVE.radius;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (b.ramp) {
        // block only the tall side of a slope (bots used to phase through)
        const minX = b.x - b.sx / 2 - r, maxX = b.x + b.sx / 2 + r;
        const minZ = b.z - b.sz / 2 - r, maxZ = b.z + b.sz / 2 + r;
        if (x > minX && x < maxX && z > minZ && z < maxZ) {
          const len = b.ramp.axis === 'x' ? b.sx : b.sz;
          let f = ((b.ramp.axis === 'x' ? x - b.x : z - b.z) + len / 2) / len;
          if (b.ramp.up < 0) f = 1 - f;
          const hh = (b.y - b.sy / 2) + Math.max(0, Math.min(1, f)) * b.ramp.rise;
          if (hh - y > 0.9) {
            const dl = x - minX, dr = maxX - x, dn = z - minZ, df = maxZ - z;
            const m2 = Math.min(dl, dr, dn, df);
            if (m2 === dl) x = minX; else if (m2 === dr) x = maxX; else if (m2 === dn) z = minZ; else z = maxZ;
          }
        }
        continue;
      }
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
    const skill = typeof f.bot.skill === 'object' ? f.bot.skill : (SKILLS[f.bot.skill] || SKILLS.normal);
    const myGun = f.bot.weapon && !WEAPONS[f.bot.weapon]?.melee ? f.bot.weapon : null;
    const knifer = f.bot.weapon === 'scythe';

    // pick nearest living enemy
    let enemy = null, ed = Infinity;
    for (const e of m.fighters.values()) {
      if (e.team === f.team || e.dead) continue;
      const d = Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z);
      if (d < ed) { ed = d; enemy = e; }
    }
    if (!enemy) { f.anim = 'idle'; continue; }

    const turnRate = skill.turn ?? 5, trackRate = skill.track ?? 8;
    const forget = skill.forget ?? 2.5, cone = skill.cone ?? 0.4;

    const los = hasLOS(boxes, f.pos.x, eyeY(f), f.pos.z, enemy.pos.x, eyeY(enemy), enemy.pos.z);
    if (los) {
      mem.sawAt = mem.sawAt || now;
      mem.lastSeen = { ...enemy.pos }; mem.lastSeenAt = now;
      // aim converges on your real position over time — laggy, so it can't
      // perfectly follow a strafe. Only tracks while it can actually SEE you.
      const eye = { x: enemy.pos.x, y: eyeY(enemy) - 0.18, z: enemy.pos.z };
      if (!mem.aimPos) mem.aimPos = { ...eye };
      const k = 1 - Math.exp(-trackRate * dt);
      mem.aimPos.x += (eye.x - mem.aimPos.x) * k;
      mem.aimPos.y += (eye.y - mem.aimPos.y) * k;
      mem.aimPos.z += (eye.z - mem.aimPos.z) * k;
    } else {
      mem.sawAt = null;
      // lose the trail a couple seconds after you break line of sight
      if (mem.lastSeenAt && now - mem.lastSeenAt > forget) { mem.lastSeen = null; mem.aimPos = null; }
    }

    // ---- movement: approach to mid range, then strafe ----
    if (!mem.strafeUntil || now > mem.strafeUntil) {
      mem.strafeDir = Math.random() < 0.5 ? -1 : 1;
      mem.strafeUntil = now + 0.6 + Math.random() * 0.9;
    }
    // where the bot THINKS you are: your real spot only while visible, else the
    // last place it saw you, else it has no idea — so it roams your general area
    // (fuzzy, not your exact position) until it spots you again.
    let tx, tz;
    if (los) { tx = enemy.pos.x; tz = enemy.pos.z; }
    else if (mem.lastSeen) { tx = mem.lastSeen.x; tz = mem.lastSeen.z; }
    else {
      if (!mem.roam || Math.hypot(f.pos.x - mem.roam.x, f.pos.z - mem.roam.z) < 2.5 || now > (mem.roamUntil || 0)) {
        mem.roam = { x: enemy.pos.x + (Math.random() - 0.5) * 22, z: enemy.pos.z + (Math.random() - 0.5) * 22 };
        mem.roamUntil = now + 3 + Math.random() * 3;
      }
      tx = mem.roam.x; tz = mem.roam.z;
    }
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
    else if (knifer) { moveX = fwdX; moveZ = fwdZ; }          // knife-rushers just charge
    else if (dist < 6 && f.weapon !== 'scythe') { moveX = -fwdX * 0.5 + strafeX; moveZ = -fwdZ * 0.5 + strafeZ; }
    else { moveX = strafeX; moveZ = strafeZ; }
    const sp = MOVE.walk * 1.25 * skill.speed;   // no sprint; bots move a touch quicker than walk
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
    f.anim = 'run';
    // facing now MATTERS: the bot can only fire at what's in front of it (cone
    // check below) and it turns at a limited rate — so it must actually rotate
    // to face you, and a quick flank leaves it looking the wrong way (backstab!).
    const moveLen = Math.hypot(moveX, moveZ);
    let desiredRy;
    if (los && mem.aimPos) desiredRy = Math.atan2(-(mem.aimPos.x - f.pos.x), -(mem.aimPos.z - f.pos.z));
    else if (moveLen > 0.01) desiredRy = Math.atan2(-moveX, -moveZ);
    else desiredRy = f.ry;
    let dRy = desiredRy - f.ry;
    while (dRy > Math.PI) dRy -= Math.PI * 2;
    while (dRy < -Math.PI) dRy += Math.PI * 2;
    const maxTurn = turnRate * dt;
    f.ry += Math.max(-maxTurn, Math.min(maxTurn, dRy));

    // is the enemy within the bot's forward view cone right now?
    const fFx = -Math.sin(f.ry), fFz = -Math.cos(f.ry);
    const eDx = enemy.pos.x - f.pos.x, eDz = enemy.pos.z - f.pos.z;
    const eDl = Math.hypot(eDx, eDz) || 1;
    const facingEnemy = ((eDx / eDl) * fFx + (eDz / eDl) * fFz) > cone;

    // ---- weapon choice ----
    if (f.bot.weapon) {
      f.weapon = f.bot.weapon;                        // wave bots keep their assigned gun (they drop it!)
    } else if (dist < 3.2 && los) f.weapon = 'scythe';
    else if (dist > 3.8 && f.weapon === 'scythe') f.weapon = 'ar';

    // ---- combat ---- (must see you, have reacted, AND be facing you)
    if (los && mem.sawAt && now - mem.sawAt >= skill.reaction && facingEnemy) {
      if (f.weapon === 'scythe') { if (dist < 3.4) meleeSwing(m, f, 'scythe'); continue; }
      // burst-fire management
      if (mem.pauseUntil && now < mem.pauseUntil) continue;
      mem.shots = mem.shots || 0;
      // aim at the LAGGED position, not your exact spot — strafing beats it
      const aim = mem.aimPos || { x: enemy.pos.x, y: eyeY(enemy) - 0.18, z: enemy.pos.z };
      const ax = aim.x - f.pos.x;
      const ay = aim.y - eyeY(f);
      const az = aim.z - f.pos.z;
      const al = Math.hypot(ax, ay, az) || 1;
      const err = skill.aimErr * (0.6 + Math.random() * 0.8);
      const dirX = ax / al + (Math.random() - 0.5) * err;
      const dirY = ay / al + (Math.random() - 0.5) * err;
      const dirZ = az / al + (Math.random() - 0.5) * err;
      fireHitscan(m, f, dirX, dirY, dirZ, myGun || 'ar');
      mem.shots++;
      if (mem.shots >= skill.burst) { mem.shots = 0; mem.pauseUntil = now + skill.pause; }
      // occasional grenade at range
      if (dist > 10 && dist < 24 && f.grenades > 0 && Math.random() < 0.002) {
        throwGrenade(m, f, ax / al, 0.45, az / al);
      }
    }
  }
}
