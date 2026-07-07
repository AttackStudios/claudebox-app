// AI bot campers: autonomous "players" that wander the wilderness, react to
// what they find, flee bears, and set up camp (tent + fire) at night. They
// live in state.players like real players, so every client renders them with
// nametags + avatars and sees their chat. Their camp items are ephemeral
// (broadcast but never persisted) so they don't clutter the save file.

import { state, genId, publicPlayer, clock01 } from './state.js';
import {
  WORLD, CAMPSITES, height, waterAt, lavaAt, inLodge, regionAt, randomWildPoint,
} from '../../shared/bp/worldgen.js';

const BOT_COUNT = 5;

const NAMES = ['Sam', 'Riley', 'Jordan', 'Casey', 'Alex', 'Taylor', 'Morgan',
  'Quinn', 'Avery', 'Drew', 'Skyler', 'Reese', 'Hayden', 'Parker', 'Rowan'];
const SKINS = ['#f1c8a0', '#e8b48a', '#c98e63', '#8d5a3c', '#6b4226'];
const SHIRTS = ['#c0564a', '#4a7ec0', '#5a8a55', '#d9c95c', '#c08ec5', '#e8833a', '#3aa6a0'];
const PANTS = ['#3a4150', '#5a4632', '#2d3b4a', '#6b5138', '#414449'];
const HAIRCOL = ['#2a1c10', '#5a3a1a', '#0f0f12', '#caa05a', '#b5522e'];
const HAIRS = ['short', 'long', 'spiky', 'bun', 'short', 'short'];
const SHIRT_STYLE = ['tee', 'hoodie', 'jacket', 'tank'];

const rng = Math.random;
const pick = (a) => a[(rng() * a.length) | 0];

const WALK = 3.2;
const RUN = 10.5;          // == bear chase speed, so bots that react early escape
const FLEE_SIGHT = 30;
const ARRIVE = 3.5;
const RESPAWN_MS = 3200;

// chat reactions keyed by the region they just walked into
const REGION_LINES = {
  Peaks: ['Whoa, the view from up here! ⛰️', 'My legs are killing me but worth it 🥾', "Careful, it's slippery up here ❄️"],
  Canyon: ['These red rocks are unreal 🏜️', 'Echo! ... echo... 🗣️', 'Watch your step near the edge!'],
  Volcano: ['Is it just me or is it hot? 🌋', "I am NOT going near that lava", 'That glow is kinda beautiful 🔥'],
  Cave: ['Spooky in here... 🔦', 'Look at those crystals! ✨', 'Did you hear that? 👀'],
  'Table Mountain': ['Flat top up here, wild 🏔️', 'Bet you can see everything from here 👀', "Let's set up on the summit"],
  Lakes: ['Perfect spot for a swim 🏊', 'Look how clear the water is 💧', 'Anyone up for fishing? 🎣'],
  Forest: ['So peaceful out here 🌲', 'I love the smell of pine 🌲', 'Think I saw a deer over there 🦌'],
  Lodge: ['Back at the lodge! 🏡', 'Home base, sweet 🛖', 'Anyone got snacks?'],
  Shore: ['Beach day! 🏖️', 'Sand everywhere 😅', 'Listen to those waves 🌊'],
};
const AMBIENT = ['Beautiful day for a hike 🥾', 'Wait up, you two! 🏃', 'Anyone else hungry?',
  'This place is huge 🗺️', 'Best trip ever ⛺', "Let's find a good camp spot soon"];
const NIGHT_LINES = ["Nothing beats a campfire 🔥", 'Cozy night 🌙', "Who's telling the first ghost story? 👻",
  "I'm beat, turning in soon 😴", 'Marshmallows anyone? 🍡', 'The stars are incredible out here ✨'];
const BEAR_LINES = ['BEAR!! Run!! 🐻', 'Nope nope nope 😱', 'Get to the lodge!!', 'Where\'s the bear spray?! 🧯'];

function randomAvatar() {
  return {
    skin: pick(SKINS),
    shirt: pick(SHIRT_STYLE), shirtColor: pick(SHIRTS),
    pants: rng() < 0.25 ? 'shorts' : 'long', pantsColor: pick(PANTS),
    hair: pick(HAIRS), hairColor: pick(HAIRCOL),
  };
}

let bots = [];
// active bot-placed camp items (ephemeral — broadcast + shown to joiners, never saved)
export const botItems = new Map();

export function spawnBots(broadcast) {
  const used = new Set([...state.players.values()].map((p) => p.nameLower));
  const pool = NAMES.filter((n) => !used.has(n.toLowerCase()));
  for (let i = 0; i < BOT_COUNT && pool.length; i++) {
    const name = pool.splice((rng() * pool.length) | 0, 1)[0];
    const sx = WORLD.spawn.x + (rng() * 16 - 8), sz = WORLD.spawn.z + (rng() * 16 - 8);
    const bot = {
      id: genId('bot'), ws: null, isBot: true, joined: true,
      name, nameLower: name.toLowerCase(), avatar: randomAvatar(),
      pos: { x: sx, y: height(sx, sz) + 1, z: sz }, ry: rng() * Math.PI * 2, anim: 'idle',
      dead: false, diedAt: 0, vanId: null, seat: null,
      brain: {
        mode: 'explore', target: null, timer: rng() * 3, say: 3 + rng() * 8,
        camp: null, region: '', goalName: '', seat: rng() * Math.PI * 2,
      },
    };
    state.players.set(bot.id, bot);
    bots.push(bot);
    broadcast({ t: 'player.join', player: publicPlayer(bot) });
  }
  console.log(`[bp] spawned ${bots.length} bot campers`);
}

function say(bot, text, broadcast) {
  broadcast({ t: 'chat', id: bot.id, name: bot.name, text });
  bot.brain.say = 6 + rng() * 12;
}

// ephemeral camp item: rendered by everyone, never saved
function placeCampItem(bot, kind, x, z, ry, color, broadcast) {
  const id = genId('bi');
  const item = { owner: bot.nameLower, kind, x, y: height(x, z), z, ry: ry || 0, color, ephemeral: true };
  botItems.set(id, item);
  broadcast({ t: 'item.add', id, item });
  return id;
}
function removeCampItem(id, broadcast) {
  botItems.delete(id);
  broadcast({ t: 'item.remove', id });
}

function nearestCampsite(x, z) {
  let best = CAMPSITES[0], bd = Infinity;
  for (const c of CAMPSITES) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// a point of interest to explore toward
function pickDestination(bot) {
  const r = rng();
  const L = WORLD;
  if (r < 0.22) return { x: L.peaks.x + (rng() * 200 - 100), z: L.peaks.z + 260, name: 'Peaks' };
  if (r < 0.40) { const lk = rng() < 0.5 ? L.lakeSouth : L.lakeWest; return { x: lk.x + (rng() * 80 - 40), z: lk.z - lk.r * 0.7, name: 'Lake' }; }
  if (r < 0.52) return { x: L.cave.x + (rng() * 30 - 15), z: L.cave.z + 30, name: 'Cave' };
  if (r < 0.62) return { x: L.canyon.x + (rng() * 200 - 100), z: L.canyon.z, name: 'Canyon' };
  if (r < 0.78) { const c = pick(CAMPSITES); return { x: c.x + (rng() * 16 - 8), z: c.z + (rng() * 16 - 8), name: 'Camp' }; }
  const p = randomWildPoint(rng);
  return { x: p.x, z: p.z, name: 'wild' };
}

function moveBot(bot, dx, dz, speed, dt) {
  const d = Math.hypot(dx, dz) || 1;
  const nx = bot.pos.x + (dx / d) * speed * dt;
  const nz = bot.pos.z + (dz / d) * speed * dt;
  // bots stay out of deep water and lava; they may wade shallow shores
  if (lavaAt(nx, nz) || (waterAt(nx, nz) && height(nx, nz) < -1.5)) {
    bot.brain.target = null;          // blocked — rethink
    return false;
  }
  bot.ry = Math.atan2(dx, dz);
  bot.pos.x = nx; bot.pos.z = nz;
  bot.pos.y = height(nx, nz);
  return true;
}

function nearestBear(bot) {
  let best = null, bd = FLEE_SIGHT;
  for (const b of state.bears.values()) {
    const d = Math.hypot(b.x - bot.pos.x, b.z - bot.pos.z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function teardownCamp(bot, broadcast) {
  if (!bot.brain.camp) return;
  removeCampItem(bot.brain.camp.tent, broadcast);
  removeCampItem(bot.brain.camp.fire, broadcast);
  bot.brain.camp = null;
}

export function tickBots(dt, broadcast) {
  // drop any bot evicted from state (e.g. a real player took its name)
  if (bots.some((b) => !state.players.has(b.id))) {
    for (const b of bots) if (!state.players.has(b.id)) teardownCamp(b, broadcast);
    bots = bots.filter((b) => state.players.has(b.id));
  }
  if (!bots.length) return;
  const now = Date.now();
  const day = clock01();
  // phases of the 480s day: dawn .96-.06, day .06-.66, dusk .66-.76, night .76-.96
  const isNight = day > 0.76 || day < 0.06;
  const isDusk = day >= 0.66 && day <= 0.76;

  for (const bot of bots) {
    // respawn after death
    if (bot.dead) {
      if (now - bot.diedAt > RESPAWN_MS) {
        teardownCamp(bot, broadcast);
        bot.pos = { x: WORLD.spawn.x + (rng() * 10 - 5), y: height(WORLD.spawn.x, WORLD.spawn.z) + 1, z: WORLD.spawn.z + (rng() * 10 - 5) };
        bot.dead = false; bot.anim = 'idle';
        bot.brain.mode = 'explore'; bot.brain.target = null;
        broadcast({ t: 'player.respawn', id: bot.id, x: bot.pos.x, y: bot.pos.y, z: bot.pos.z });
      }
      continue;
    }

    const B = bot.brain;
    B.say -= dt;

    // 1) BEAR! drop everything and flee
    const bear = nearestBear(bot);
    if (bear) {
      B.mode = 'flee';
      if (B.say <= 0) say(bot, pick(BEAR_LINES), broadcast);
      const away = { x: bot.pos.x - bear.x, z: bot.pos.z - bear.z };
      bot.anim = 'run';
      moveBot(bot, away.x, away.z, RUN, dt);
      continue;
    }
    if (B.mode === 'flee') { B.mode = 'explore'; B.target = null; }

    // 2) NIGHT — set up / stay at camp
    if (isNight || isDusk) {
      if (!B.camp) {
        // travel to the nearest campsite, then pitch a tent + fire
        if (!B.target || B.goalName !== 'makecamp') {
          const cs = nearestCampsite(bot.pos.x, bot.pos.z);
          // fan out around the campsite so tents don't stack
          B.target = { x: cs.x + Math.cos(B.seat) * 9, z: cs.z + Math.sin(B.seat) * 9 }; B.goalName = 'makecamp';
        }
        const dx = B.target.x - bot.pos.x, dz = B.target.z - bot.pos.z;
        if (Math.hypot(dx, dz) < ARRIVE) {
          // pitch camp here
          const tx = bot.pos.x, tz = bot.pos.z;
          const fx = tx + Math.sin(bot.ry) * 3, fz = tz + Math.cos(bot.ry) * 3;
          B.camp = {
            tent: placeCampItem(bot, 'tent', tx, tz, bot.ry + Math.PI, pick(SHIRTS), broadcast),
            fire: placeCampItem(bot, 'campfire', fx, fz, 0, null, broadcast),
            fx, fz,
          };
          if (B.say <= 0) say(bot, 'Camp is set! 🏕️', broadcast);
          bot.anim = 'idle';
        } else {
          bot.anim = 'walk';
          moveBot(bot, dx, dz, WALK, dt);
        }
      } else {
        // relax by the fire: sit close, occasional cozy chat
        const dx = B.camp.fx - bot.pos.x, dz = B.camp.fz - bot.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.6) { bot.anim = 'walk'; moveBot(bot, dx, dz, WALK, dt); }
        else {
          bot.anim = 'sit';
          bot.ry = Math.atan2(B.camp.fx - bot.pos.x, B.camp.fz - bot.pos.z);
          if (B.say <= 0) say(bot, pick(NIGHT_LINES), broadcast);
        }
      }
      continue;
    }

    // 3) DAY — break camp, then explore POIs and react on arrival
    if (B.camp) { teardownCamp(bot, broadcast); if (B.say <= 0) say(bot, 'Morning! Let\'s pack up ☀️', broadcast); B.target = null; }

    if (!B.target || B.goalName === 'makecamp') {
      const dest = pickDestination(bot);
      B.target = { x: dest.x, z: dest.z }; B.goalName = dest.name; B.region = '';
    }
    const dx = B.target.x - bot.pos.x, dz = B.target.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ARRIVE) {
      // arrived — react to the place, then idle a beat before the next leg
      bot.anim = 'idle';
      B.timer -= dt;
      const region = regionAt(bot.pos.x, bot.pos.z);
      if (region !== B.region) {
        B.region = region;
        const lines = REGION_LINES[region] || AMBIENT;
        if (B.say <= 0) say(bot, pick(lines), broadcast);
      }
      if (B.timer <= 0) { B.target = null; B.timer = 2 + rng() * 4; }
    } else {
      // run if it's a long way, otherwise stroll; occasional ambient chatter
      const sp = dist > 90 ? RUN * 0.85 : WALK;
      bot.anim = sp > WALK ? 'run' : 'walk';
      moveBot(bot, dx, dz, sp, dt);
      if (B.say <= 0 && rng() < 0.02) say(bot, pick(AMBIENT), broadcast);
    }
  }
}
