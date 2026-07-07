// Bear AI: roam the wilderness, chase the nearest on-foot player at exactly
// player run speed, kill on contact, flee from bear spray.

import { state, genId, publicPlayer } from './state.js';
import { height, randomWildPoint, inLodge, waterAt, lavaAt } from '../../shared/bp/worldgen.js';

const BEAR_COUNT = 10;
const SIGHT = 40;
const WALK_SPEED = 3;
const CHASE_SPEED = 10.5;   // == player run speed
const FLEE_SPEED = 12;
const KILL_RANGE = 1.4;

const rng = Math.random;

export function spawnBears() {
  for (let i = 0; i < BEAR_COUNT; i++) {
    const pt = randomWildPoint(rng);
    state.bears.set('b' + i, {
      id: 'b' + i,
      variant: rng() < 0.3 ? 'black' : 'brown',
      x: pt.x, y: pt.y, z: pt.z, ry: rng() * Math.PI * 2,
      state: 'roam', anim: 'walk',
      target: null, stateTime: rng() * 6,
      fleeUntil: 0, fleeDir: null,
    });
  }
}

function huntablePlayers() {
  return [...state.players.values()].filter(
    (p) => p.joined && !p.dead && p.vanId == null && !inLodge(p.pos.x, p.pos.z)
  );
}

export function tickBears(dt, killPlayer, broadcast) {
  const now = Date.now();
  const prey = huntablePlayers();

  for (const bear of state.bears.values()) {
    // fleeing from spray
    if (now < bear.fleeUntil) {
      bear.anim = 'run';
      bear.ry = Math.atan2(bear.fleeDir.x, bear.fleeDir.z);
      moveBear(bear, bear.fleeDir.x, bear.fleeDir.z, FLEE_SPEED, dt);
      continue;
    }

    // find the nearest huntable player in sight
    let nearest = null, nd = SIGHT;
    for (const p of prey) {
      const d = Math.hypot(p.pos.x - bear.x, p.pos.z - bear.z);
      if (d < nd) { nd = d; nearest = p; }
    }

    if (nearest) {
      bear.state = 'chase';
      bear.anim = 'run';
      const dx = nearest.pos.x - bear.x, dz = nearest.pos.z - bear.z;
      const d = Math.hypot(dx, dz) || 1;
      bear.ry = Math.atan2(dx, dz);
      moveBear(bear, dx / d, dz / d, CHASE_SPEED, dt);
      if (d < KILL_RANGE && Math.abs(nearest.pos.y - bear.y) < 2.5) {
        killPlayer(nearest, 'bear');
      }
      continue;
    }

    // roam
    bear.stateTime -= dt;
    if (bear.stateTime <= 0 || !bear.target) {
      if (rng() < 0.35) {
        bear.state = 'idle'; bear.anim = 'idle'; bear.stateTime = 2 + rng() * 5; bear.target = null;
      } else {
        const pt = randomWildPoint(rng);
        // wander somewhere nearby-ish, not across the whole map
        bear.target = {
          x: bear.x + Math.max(-60, Math.min(60, pt.x - bear.x)),
          z: bear.z + Math.max(-60, Math.min(60, pt.z - bear.z)),
        };
        bear.state = 'roam'; bear.anim = 'walk'; bear.stateTime = 6 + rng() * 8;
      }
    }
    if (bear.target) {
      const dx = bear.target.x - bear.x, dz = bear.target.z - bear.z;
      const d = Math.hypot(dx, dz);
      if (d < 2) { bear.target = null; continue; }
      bear.ry = Math.atan2(dx, dz);
      moveBear(bear, dx / d, dz / d, WALK_SPEED, dt);
    }
  }
}

function moveBear(bear, dx, dz, speed, dt) {
  const nx = bear.x + dx * speed * dt;
  const nz = bear.z + dz * speed * dt;
  // bears won't swim, stand in lava, or enter the lodge
  if (waterAt(nx, nz) || lavaAt(nx, nz) || inLodge(nx, nz)) {
    bear.target = null;
    bear.fleeUntil = 0;
    return;
  }
  bear.x = nx; bear.z = nz;
  bear.y = height(nx, nz);
}

// bear spray: scare every bear in a cone in front of the sprayer
export function sprayAt(x, z, dirX, dirZ) {
  const scared = [];
  for (const bear of state.bears.values()) {
    const dx = bear.x - x, dz = bear.z - z;
    const d = Math.hypot(dx, dz);
    if (d > 9) continue;
    const dot = (dx * dirX + dz * dirZ) / (d || 1);
    if (dot < 0.35 && d > 2.2) continue; // outside the cone (close range always counts)
    bear.fleeUntil = Date.now() + 15000;
    const fd = Math.hypot(dx, dz) || 1;
    bear.fleeDir = { x: dx / fd, z: dz / fd };
    scared.push(bear.id);
  }
  return scared;
}
