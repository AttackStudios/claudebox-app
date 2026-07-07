// Ambient NPC birds: server-simulated wildlife so the island feels alive
// even with one player. Simple state machine: idle -> peck -> walk -> fly.

import { state, genId } from './state.js';
import { groundAt, biomeAt, WORLD } from '../shared/worldgen.js';

const NPC_BREEDS = ['robin', 'cardinal', 'duck', 'chicken', 'owl', 'sparrow',
  'chickadee', 'flamingo', 'penguin', 'dodo', 'toucan', 'parrot', 'raven',
  'eagle', 'falcon', 'peacock'];

// Where each breed likes to hang out (continent v4 biomes).
const HABITAT = {
  penguin: ['snow'],
  flamingo: ['lake', 'jungle'],
  duck: ['lake', 'beach'],
  dodo: ['desert', 'beach'],
  toucan: ['jungle'],
  parrot: ['jungle', 'beach'],
  owl: ['forest', 'autumn'],
  raven: ['volcano', 'snow'],
  chicken: ['meadow'],
  peacock: ['jungle', 'meadow'],
  eagle: ['snow', 'desert'],
  falcon: ['desert', 'meadow'],
  cardinal: ['forest', 'autumn'],
  robin: ['meadow', 'forest'],
  sparrow: ['meadow', 'autumn'],
  chickadee: ['forest', 'snow', 'autumn'],
};

const rng = Math.random;
const NPC_COUNT = 72;   // spread across the big continent

function randomHabitatPoint(breed) {
  const biomes = HABITAT[breed] || ['meadow', 'forest', 'beach'];
  for (let i = 0; i < 60; i++) {
    const x = (rng() * 2 - 1) * (WORLD.shoreStart + 10);
    const z = (rng() * 2 - 1) * (WORLD.shoreStart + 10);
    if (biomes.includes(biomeAt(x, z))) return { x, z };
  }
  return { x: 0, z: 0 };
}

export function spawnNpcs() {
  for (let i = 0; i < NPC_COUNT; i++) {
    const breed = NPC_BREEDS[Math.floor(rng() * NPC_BREEDS.length)];
    const home = randomHabitatPoint(breed);
    const npc = {
      id: genId('n'),
      breed,
      // hue shift lets the client tint each NPC differently but deterministically
      tint: rng(),
      x: home.x, z: home.z, y: Math.max(groundAt(home.x, home.z), 0.2),
      ry: rng() * Math.PI * 2,
      anim: 'idle',
      state: 'idle',
      stateTime: rng() * 4,
      target: null,
      flyHeight: 0,
      home,
    };
    state.npcs.set(npc.id, npc);
  }
}

export function tickNpcs(dt) {
  for (const npc of state.npcs.values()) {
    npc.stateTime -= dt;
    if (npc.stateTime <= 0) pickNewState(npc);

    if (npc.state === 'walk' && npc.target) moveToward(npc, dt, 2.2, false);
    else if (npc.state === 'fly' && npc.target) moveToward(npc, dt, 9, true);

    const ground = Math.max(groundAt(npc.x, npc.z), 0.2);
    if (npc.state === 'fly') {
      npc.y += (ground + npc.flyHeight - npc.y) * Math.min(1, dt * 1.5);
    } else {
      npc.y = ground;
    }
  }
}

function pickNewState(npc) {
  const roll = rng();
  if (roll < 0.35) {
    npc.state = 'idle'; npc.anim = 'idle'; npc.stateTime = 2 + rng() * 4;
  } else if (roll < 0.55) {
    npc.state = 'peck'; npc.anim = 'peck'; npc.stateTime = 1.5 + rng() * 2;
  } else if (roll < 0.85) {
    npc.state = 'walk'; npc.anim = 'walk'; npc.stateTime = 4 + rng() * 5;
    npc.target = { x: npc.home.x + (rng() * 2 - 1) * 30, z: npc.home.z + (rng() * 2 - 1) * 30 };
  } else {
    // Fly to a fresh hangout spot (occasionally far away).
    npc.state = 'fly'; npc.anim = 'fly'; npc.stateTime = 8 + rng() * 8;
    npc.flyHeight = 8 + rng() * 14;
    npc.home = rng() < 0.3 ? randomHabitatPoint(npc.breed) : npc.home;
    npc.target = { x: npc.home.x + (rng() * 2 - 1) * 20, z: npc.home.z + (rng() * 2 - 1) * 20 };
  }
}

// Players sprinting through scare nearby walkers into the air.
export function scareNpcsNear(x, z) {
  for (const npc of state.npcs.values()) {
    if (npc.state === 'fly') continue;
    if (Math.hypot(npc.x - x, npc.z - z) < 4) {
      npc.state = 'fly'; npc.anim = 'fly'; npc.stateTime = 5 + rng() * 4;
      npc.flyHeight = 10 + rng() * 8;
      npc.target = { x: npc.x + (rng() * 2 - 1) * 60, z: npc.z + (rng() * 2 - 1) * 60 };
    }
  }
}

function moveToward(npc, dt, speed, fly) {
  const dx = npc.target.x - npc.x;
  const dz = npc.target.z - npc.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.5) {
    if (npc.state === 'fly') { npc.state = 'idle'; npc.anim = 'idle'; npc.stateTime = 1 + rng() * 3; }
    npc.target = null;
    return;
  }
  npc.ry = Math.atan2(dx, dz);
  npc.x += (dx / d) * speed * dt;
  npc.z += (dz / d) * speed * dt;
}
