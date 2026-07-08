// ClaudeBox platform: profiles, avatars, friends, presence, and the games
// library. Persists to data/platform.json. Presence combines a hub heartbeat
// (the dashboard polling /api/social) with live Feather Friends sessions.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { state, save as saveGame } from './state.js';
import { applyCourse as obApplyCourse } from '../shared/obby/course.js';
import { applyWorld as wbApplyWorld } from '../shared/wibit/park.js';
import { toObbyCourse, toWibitWorld } from '../shared/studio/adapters.js';
import { CHALLENGES, CHALLENGE_BY_ID, SHOP_BY_ID, CUBE_RATE, CURRENCY, POINTS, AVATAR_SHOP, AVATAR_SHOP_BY_ID } from '../shared/rewards.js';

const DATA_DIR = process.env.CLAUDEBOX_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DATA_DIR, 'platform.json');

// ---- access lock ----
// Set the ACCESS_CODE env var (e.g. on Render) to lock the whole platform
// behind one invite code. Unset = open (home LAN default). Checked on hub
// login, personal API routes, and every game's WebSocket join.
export const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();
export const checkAccess = (code) => !ACCESS_CODE || String(code || '') === ACCESS_CODE;

// Flip to true (and restart) to close Feather Friends during an update.
export const FF_MAINTENANCE = false;
// Flip to true (and restart) to close Backpacking during an update.
export const BP_MAINTENANCE = false;

const GAMES = [
  {
    id: 'feather-friends',
    title: 'Feather Friends',
    tagline: 'Live your best bird life',
    art: '/icons/game-feather-friends.png',
    url: '/games/feather-friends',
    tags: ['Adventure', 'Animals', 'Multiplayer'],
    playable: true,
    maintenance: FF_MAINTENANCE,
  },
  {
    id: 'backpacking',
    title: 'Backpacking',
    tagline: 'Pack up. Drive out. Camp under the stars.',
    art: '/icons/game-backpacking.png',
    url: '/games/backpacking',
    tags: ['Camping', 'Driving', 'Multiplayer'],
    playable: true,
    maintenance: BP_MAINTENANCE,
  },
  {
    id: 'restaurant-sim-2',
    title: 'Restaurant Simulator 2',
    tagline: 'Build it. Cook it. Deliver it.',
    art: '/icons/game-restaurant-sim-2.png',
    url: '/games/restaurant-sim-2',
    tags: ['Simulation', 'Cooking', 'Multiplayer'],
    playable: true,
  },
  {
    id: 'obby',
    title: 'Obby',
    tagline: 'Jump, climb, don\'t fall. Beat the tower.',
    art: '/icons/game-obby.png',
    url: '/games/obby',
    tags: ['Parkour', 'Obstacle', 'Multiplayer'],
    playable: true,
  },
  {
    id: 'wibit',
    title: 'Wibit Simulator',
    tagline: 'Bounce, climb, splash. Survive the Wipeout.',
    art: '/icons/game-wibit.png',
    url: '/games/wibit',
    tags: ['Water Park', 'Physics', 'Multiplayer'],
    playable: true,
  },
  {
    id: 'rivals',
    title: 'Rivals',
    tagline: 'Lock in. First to five wins the duel.',
    art: '/icons/game-rivals.png',
    url: '/games/rivals',
    tags: ['FPS', 'PvP', 'Multiplayer'],
    playable: true,
  },
  {
    id: 'playground',
    title: 'Playground',
    tagline: 'Play levels built in ClaudeBox Studio.',
    art: '/icons/game-playground.png',
    url: '/games/playground?play=playground',
    tags: ['Sandbox', 'Custom Levels'],
    playable: true,
  },
  {
    id: 'studio',
    title: 'ClaudeBox Studio',
    tagline: 'Build your own 3D levels with triggers.',
    art: '/icons/game-studio.png',
    url: '/studio',
    tags: ['Editor', 'Tools'],
    playable: true,
  },
];

export const DEFAULT_AVATAR = {
  body: 'a',
  skin: '#e8b48a',
  hair: 'short', hairColor: '#5d4037',
  shirt: 'tee', shirtColor: '#38b6e8',
  pants: 'long', pantsColor: '#3a4a5d',
  shoes: 'sneakers', shoeColor: '#22242c',
  hat: 'none', hatColor: '#d2453a',
  back: 'none', backColor: '#4a7ec0',
  face2: 'none', faceColor: '#222222',
  suit: 'none', suitColor: '#19a3d6',
  face: 'happy',
};

function loadPlatform() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { users: raw.users || {}, gameStats: raw.gameStats || {}, dms: raw.dms || {} };
  } catch {
    return { users: {}, gameStats: {}, dms: {} };
  }
}

// Per-game social stats (Roblox-style): total plays ("visits") + likes.
function gameStat(id) {
  if (!platform.gameStats[id]) platform.gameStats[id] = { plays: 0, likes: [] };
  const s = platform.gameStats[id];
  if (typeof s.plays !== 'number') s.plays = 0;
  if (!Array.isArray(s.likes)) s.likes = [];
  return s;
}
// GAMES with live stats merged in, for the hub cards.
function gamesWithStats() {
  return GAMES.map((g) => {
    const s = gameStat(g.id);
    return { ...g, plays: s.plays, likes: s.likes.length };
  });
}
function likedGamesOf(nameLower) {
  return GAMES.filter((g) => gameStat(g.id).likes.includes(nameLower)).map((g) => g.id);
}

const platform = loadPlatform();
const lastHubSeen = new Map(); // nameLower -> ms timestamp (not persisted)

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(platform, null, 1));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error('[platform] save failed:', err.message);
    }
  }, 1200);
}

const clean = (s, max = 20) => String(s ?? '').replace(/[ -]/g, '').trim().slice(0, max);
// game ids contain hyphens (feather-friends), so they need a cleaner that
// KEEPS hyphens — `clean` above strips them (its /[ -]/ is a space-to-hyphen range).
const cleanGameId = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
const cleanColor = (c, fb) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : fb);

function sanitizeAvatar(a = {}) {
  const pick = (v, list, fb) => (list.includes(v) ? v : fb);
  return {
    // body type for the 3D model ('a'/'b' kept for legacy saves → render as boy)
    body: pick(a.body, ['a', 'b', 'boy', 'girl'], 'boy'),
    skin: cleanColor(a.skin, DEFAULT_AVATAR.skin),
    hair: pick(a.hair, ['none', 'short', 'long', 'spiky', 'bun', 'curly'], 'short'),
    hairColor: cleanColor(a.hairColor, DEFAULT_AVATAR.hairColor),
    shirt: pick(a.shirt, ['tee', 'hoodie', 'jacket', 'tank'], 'tee'),
    shirtColor: cleanColor(a.shirtColor, DEFAULT_AVATAR.shirtColor),
    pants: pick(a.pants, ['long', 'shorts', 'skirt'], 'long'),
    pantsColor: cleanColor(a.pantsColor, DEFAULT_AVATAR.pantsColor),
    shoes: pick(a.shoes, ['sneakers', 'boots', 'sandals', 'none'], 'sneakers'),
    shoeColor: cleanColor(a.shoeColor, DEFAULT_AVATAR.shoeColor),
    // clothing for the 3D model (ids must match avatar3d.js CLOTHING catalog)
    hat: pick(a.hat, ['none', 'cap', 'beanie', 'tophat', 'crown', 'cowboy', 'headphones', 'halo', 'horns', 'wizard', 'bandana', 'flower', 'pirate', 'party', 'chef', 'football', 'propeller'], 'none'),
    hatColor: cleanColor(a.hatColor, DEFAULT_AVATAR.hatColor),
    back: pick(a.back, ['none', 'backpack', 'wings', 'cape', 'jetpack', 'sword', 'angelwings', 'balloon', 'guitar'], 'none'),
    backColor: cleanColor(a.backColor, '#4a7ec0'),
    face2: pick(a.face2, ['none', 'glasses', 'shades', 'mask', 'monocle', 'eyepatch', 'threed'], 'none'),
    faceColor: cleanColor(a.faceColor, '#222222'),
    suit: pick(a.suit, ['none', 'swim'], 'none'),
    suitColor: cleanColor(a.suitColor, DEFAULT_AVATAR.suitColor),
    face: pick(a.face, ['happy', 'cool', 'surprised', 'sleepy'], 'happy'),
  };
}

function getUser(nameLower) {
  return platform.users[nameLower] || null;
}

// Called by game servers too, so anyone who has ever joined a game
// automatically exists on the platform and can be friended.
export function ensurePlatformUser(name) {
  return ensureUser(name);
}

function ensureUser(name) {
  const nameLower = name.toLowerCase();
  if (!platform.users[nameLower]) {
    platform.users[nameLower] = {
      name,
      avatar: { ...DEFAULT_AVATAR },
      friends: [],
      recentGames: [],
      created: new Date().toISOString(),
    };
    save();
  }
  return ensureWallet(platform.users[nameLower]);
}

// Lazily add the rewards economy fields to any profile (migrates old saves).
// stars = challenge points, cubes = spendable currency, challenges = { id: ISO
// timestamp } of completions, owned = purchased shop item ids, title/nameColor
// = equipped cosmetics.
function ensureWallet(u) {
  if (!u) return u;
  if (typeof u.stars !== 'number') u.stars = 0;
  if (typeof u.cubes !== 'number') u.cubes = 0;
  if (!u.challenges || typeof u.challenges !== 'object') u.challenges = {};
  if (!Array.isArray(u.owned)) u.owned = [];
  if (!Array.isArray(u.ownedAvatar)) u.ownedAvatar = [];
  if (typeof u.title !== 'string') u.title = '';
  if (typeof u.nameColor !== 'string') u.nameColor = '';
  return u;
}
// clothing ids that are FREE (usable without buying) — the starter basics
const FREE_AVATAR = {
  hat: new Set(['none', 'cap', 'beanie']),
  back: new Set(['none', 'backpack']),
  face2: new Set(['none', 'glasses']),
  suit: new Set(['none', 'swim']),
};
// map an owned avatar-shop item id set → the clothing values the user may equip
function ownedAvatarValues(u, slot) {
  const vals = new Set(FREE_AVATAR[slot] || ['none']);
  for (const id of (u.ownedAvatar || [])) {
    const it = AVATAR_SHOP_BY_ID[id];
    if (it && it.slot === slot) vals.add(it.value);
  }
  return vals;
}

// The wallet slice sent to clients.
function walletOf(u) {
  ensureWallet(u);
  return {
    stars: u.stars, cubes: u.cubes,
    challenges: u.challenges, owned: u.owned, ownedAvatar: u.ownedAvatar,
    title: u.title, nameColor: u.nameColor,
  };
}

// hub | game:<id> | offline
let bpStatePromise = null;
function bpPlayers() {
  // lazy import avoids a circular dependency at module load
  if (!bpStatePromise) bpStatePromise = import('./backpacking/state.js');
  return bpStatePromise.then((m) => m.state.players).catch(() => null);
}
let bpPlayersSync = null;
bpPlayers().then((p) => { bpPlayersSync = p; });
let rsPlayersSync = null;
import('./rs2/state.js').then((m) => { rsPlayersSync = m.state.players; }).catch(() => {});
let obPlayersSync = null;
import('./obby/state.js').then((m) => { obPlayersSync = m.state.players; }).catch(() => {});
let wbPlayersSync = null;
import('./wibit/state.js').then((m) => { wbPlayersSync = m.state.players; }).catch(() => {});
let rvPlayersSync = null;
import('./rivals/state.js').then((m) => { rvPlayersSync = m.state.players; }).catch(() => {});

function presenceOf(nameLower) {
  for (const p of state.players.values()) {
    if (p.joined && p.nameLower === nameLower) return 'game:feather-friends';
  }
  if (bpPlayersSync) {
    for (const p of bpPlayersSync.values()) {
      if (p.joined && p.nameLower === nameLower) return 'game:backpacking';
    }
  }
  if (rsPlayersSync) {
    for (const p of rsPlayersSync.values()) {
      if (p.joined && p.nameLower === nameLower) return 'game:restaurant-sim-2';
    }
  }
  if (obPlayersSync) {
    for (const p of obPlayersSync.values()) {
      if (p.joined && p.nameLower === nameLower) return 'game:obby';
    }
  }
  if (wbPlayersSync) {
    for (const p of wbPlayersSync.values()) {
      if (p.joined && p.nameLower === nameLower) return 'game:wibit';
    }
  }
  if (rvPlayersSync) {
    for (const p of rvPlayersSync.values()) {
      if (p.joined && p.nameLower === nameLower) return 'game:rivals';
    }
  }
  const seen = lastHubSeen.get(nameLower);
  if (seen && Date.now() - seen < 30000) return 'hub';
  return 'offline';
}

function publicUser(nameLower) {
  const u = getUser(nameLower);
  if (!u) return null;
  ensureWallet(u);
  return { name: u.name, avatar: u.avatar, status: presenceOf(nameLower), title: u.title, nameColor: u.nameColor };
}

const LEVELS_DIR = path.join(DATA_DIR, 'levels');
const levelSlug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'sandbox';

export function hubRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));   // levels can be large

  // whether this deployment is invite-locked (the hub shows a code field)
  r.get('/access', (req, res) => res.json({ locked: !!ACCESS_CODE }));

  // invite-code gate: when locked, everything personal/mutating needs the
  // code (sent as the x-cbx-code header by the hub/games, or in the body).
  const OPEN = new Set(['/access', '/games', '/rewards/catalog']);
  r.use((req, res, next) => {
    if (!ACCESS_CODE) return next();
    if (OPEN.has(req.path) || (req.method === 'GET' && req.path.startsWith('/level/'))) return next();
    const code = req.get('x-cbx-code') || req.body?.code;
    if (checkAccess(code)) return next();
    res.status(403).json({ error: 'This ClaudeBox is locked — enter the invite code.' });
  });

  r.get('/games', (req, res) => res.json({ games: gamesWithStats() }));

  // Like / unlike a game (Roblox-style thumbs up). Idempotent per user.
  r.post('/game/like', (req, res) => {
    const name = clean(req.body?.name);
    const gameId = cleanGameId(req.body?.gameId);
    const like = req.body?.like !== false;
    if (!name || !GAMES.some((g) => g.id === gameId)) return res.status(400).json({ ok: false });
    ensureUser(name);
    const s = gameStat(gameId);
    const nl = name.toLowerCase();
    const has = s.likes.includes(nl);
    if (like && !has) s.likes.push(nl);
    else if (!like && has) s.likes = s.likes.filter((n) => n !== nl);
    save();
    res.json({ ok: true, gameId, likes: s.likes.length, liked: s.likes.includes(nl) });
  });

  // ----- ClaudeBox Studio level storage (data/levels/<slug>.json) -----
  r.get('/level/:slug', (req, res) => {
    const slug = levelSlug(req.params.slug);
    try {
      const raw = fs.readFileSync(path.join(LEVELS_DIR, slug + '.json'), 'utf8');
      res.json({ slug, level: JSON.parse(raw) });
    } catch { res.json({ slug, level: null }); }
  });
  r.post('/level/:slug', (req, res) => {
    const slug = levelSlug(req.params.slug);
    const level = req.body?.level;
    if (!level || typeof level !== 'object') return res.status(400).json({ ok: false, error: 'no level' });
    try {
      fs.mkdirSync(LEVELS_DIR, { recursive: true });
      const tmp = path.join(LEVELS_DIR, slug + '.json.tmp');
      fs.writeFileSync(tmp, JSON.stringify(level));
      fs.renameSync(tmp, path.join(LEVELS_DIR, slug + '.json'));
      // hot-reload the live world for games that consume Studio levels
      // (null/empty reverts that game to its built-in level)
      if (slug === 'obby') { try { obApplyCourse(toObbyCourse(level)); } catch {} }
      if (slug === 'wibit') { try { wbApplyWorld(toWibitWorld(level)); } catch {} }
      res.json({ ok: true, slug });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  // lightweight avatar lookup for games (avatar transfer)
  r.get('/avatar/:name', (req, res) => {
    const u = getUser(clean(req.params.name).toLowerCase());
    if (!u) return res.status(404).json({ error: 'unknown user' });
    res.json({ name: u.name, avatar: u.avatar });
  });

  r.post('/login', (req, res) => {
    const name = clean(req.body?.name);
    if (!name) return res.status(400).json({ error: 'name required' });
    const u = ensureUser(name);
    lastHubSeen.set(name.toLowerCase(), Date.now());
    res.json({ profile: { name: u.name, avatar: u.avatar, friends: u.friends, recentGames: u.recentGames, wallet: walletOf(u), likedGames: likedGamesOf(name.toLowerCase()) } });
  });

  r.post('/avatar', (req, res) => {
    const name = clean(req.body?.name);
    if (!name) return res.status(400).json({ error: 'name required' });
    const u = ensureUser(name);
    const av = sanitizeAvatar(req.body?.avatar);
    // premium cosmetics require ownership — a slot set to an unowned paid item
    // silently reverts to 'none' so people can't equip what they didn't buy
    for (const slot of ['hat', 'back', 'face2', 'suit']) {
      if (!ownedAvatarValues(u, slot).has(av[slot])) av[slot] = 'none';
    }
    u.avatar = av;
    save();
    res.json({ ok: true, avatar: u.avatar });
  });

  // buy an avatar cosmetic with Bits → add to inventory + auto-equip it
  r.post('/avatarshop/buy', (req, res) => {
    const name = clean(req.body?.name);
    const item = AVATAR_SHOP_BY_ID[String(req.body?.item ?? '')];
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    if (!item) return res.status(404).json({ ok: false, error: 'unknown item' });
    const u = ensureUser(name);
    if (!u.ownedAvatar.includes(item.id)) {
      if (u.cubes < item.price) return res.status(400).json({ ok: false, error: `not enough ${CURRENCY.name}`, wallet: walletOf(u) });
      u.cubes -= item.price;
      u.ownedAvatar.push(item.id);
    }
    u.avatar = sanitizeAvatar({ ...u.avatar, [item.slot]: item.value });   // equip
    save();
    res.json({ ok: true, bought: item.id, avatar: u.avatar, wallet: walletOf(u) });
  });

  // equip / unequip an already-owned avatar cosmetic (or clear the slot)
  r.post('/avatarshop/equip', (req, res) => {
    const name = clean(req.body?.name);
    const slot = String(req.body?.slot ?? '');
    const value = String(req.body?.value ?? 'none');
    if (!name || !['hat', 'back', 'face2', 'suit'].includes(slot)) return res.status(400).json({ ok: false, error: 'bad request' });
    const u = ensureUser(name);
    if (!ownedAvatarValues(u, slot).has(value)) return res.status(400).json({ ok: false, error: 'not owned' });
    u.avatar = sanitizeAvatar({ ...u.avatar, [slot]: value });
    save();
    res.json({ ok: true, avatar: u.avatar, wallet: walletOf(u) });
  });

  r.post('/friends/add', (req, res) => {
    const name = clean(req.body?.name).toLowerCase();
    const friend = clean(req.body?.friend).toLowerCase();
    if (!name || !friend || name === friend) return res.status(400).json({ error: 'bad request' });
    const me = getUser(name);
    const them = getUser(friend);
    if (!me) return res.status(400).json({ error: 'log in first' });
    if (!them) return res.status(404).json({ error: `No one named "${req.body?.friend}" has joined ClaudeBox yet.` });
    if (!me.friends.includes(friend)) me.friends.push(friend);
    if (!them.friends.includes(name)) them.friends.push(name);
    save();
    res.json({ ok: true });
  });

  r.post('/friends/remove', (req, res) => {
    const name = clean(req.body?.name).toLowerCase();
    const friend = clean(req.body?.friend).toLowerCase();
    const me = getUser(name);
    const them = getUser(friend);
    if (me) me.friends = me.friends.filter((f) => f !== friend);
    if (them) them.friends = them.friends.filter((f) => f !== name);
    save();
    res.json({ ok: true });
  });

  // ---------------- direct messages ----------------
  const dmKey = (a, b) => [a, b].sort().join('|');
  const cleanDm = (s) => String(s ?? '').replace(/[ -]/g, '').trim().slice(0, 500);
  r.post('/dm/send', (req, res) => {
    const rawName = clean(req.body?.name), rawTo = clean(req.body?.to);
    const name = rawName.toLowerCase(), to = rawTo.toLowerCase();
    const text = cleanDm(req.body?.text);
    if (!name || !to || name === to || !text) return res.status(400).json({ ok: false, error: 'bad request' });
    ensureUser(rawName);
    if (!getUser(to)) return res.status(404).json({ ok: false, error: 'no such user' });
    if (!platform.dms) platform.dms = {};
    const k = dmKey(name, to);
    const thread = platform.dms[k] || (platform.dms[k] = []);
    thread.push({ from: name, text, ts: Date.now() });
    if (thread.length > 300) thread.splice(0, thread.length - 300);
    const me = getUser(name); if (me) { me.dmRead = me.dmRead || {}; me.dmRead[to] = Date.now(); }
    save();
    res.json({ ok: true, messages: thread });
  });
  r.get('/dm/thread', (req, res) => {
    const name = clean(req.query?.name).toLowerCase(), w = clean(req.query?.with).toLowerCase();
    if (!name || !w) return res.status(400).json({ ok: false });
    if (!platform.dms) platform.dms = {};
    const thread = platform.dms[dmKey(name, w)] || [];
    const me = getUser(name); if (me) { me.dmRead = me.dmRead || {}; me.dmRead[w] = Date.now(); save(); }
    res.json({ ok: true, messages: thread, with: getUser(w)?.name || req.query.with });
  });
  r.get('/dm/inbox', (req, res) => {
    const name = clean(req.query?.name).toLowerCase();
    if (!name) return res.status(400).json({ ok: false });
    if (!platform.dms) platform.dms = {};
    const me = getUser(name); const read = (me && me.dmRead) || {};
    const list = [], seen = new Set();
    for (const [k, thread] of Object.entries(platform.dms)) {
      const parts = k.split('|'); if (!parts.includes(name) || !thread.length) continue;
      const other = parts[0] === name ? parts[1] : parts[0];
      const last = thread[thread.length - 1];
      const unread = thread.filter((x) => x.from !== name && x.ts > (read[other] || 0)).length;
      const pu = publicUser(other); if (!pu) continue;
      list.push({ ...pu, last, unread }); seen.add(other);
    }
    if (me) for (const f of (me.friends || [])) { if (seen.has(f)) continue; const pu = publicUser(f); if (pu) list.push({ ...pu, last: null, unread: 0 }); }
    list.sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0));
    res.json({ ok: true, conversations: list, unread: list.reduce((s, x) => s + (x.unread || 0), 0) });
  });

  // Rename everywhere: platform profile, everyone's friends lists, and the
  // player's Feather Friends save (bird, nest, flock membership/leadership).
  r.post('/rename', (req, res) => {
    const oldName = clean(req.body?.name);
    const newName = clean(req.body?.newName);
    if (!oldName || !newName) return res.status(400).json({ error: 'both names required' });
    const ol = oldName.toLowerCase(), nl = newName.toLowerCase();
    const u = getUser(ol);
    if (!u) return res.status(404).json({ error: 'unknown user' });
    if (nl !== ol && (platform.users[nl] || state.saves.players[nl])) {
      return res.status(409).json({ error: `"${newName}" is already taken.` });
    }
    // platform profile + friends references
    delete platform.users[ol];
    u.name = newName;
    platform.users[nl] = u;
    for (const other of Object.values(platform.users)) {
      other.friends = other.friends.map((f) => (f === ol ? nl : f));
    }
    // Feather Friends save + flocks
    if (state.saves.players[ol]) {
      state.saves.players[nl] = state.saves.players[ol];
      state.saves.players[nl].name = newName;
      if (nl !== ol) delete state.saves.players[ol];
    }
    for (const f of Object.values(state.saves.flocks)) {
      f.members = f.members.map((m) => (m === ol ? nl : m));
      if (f.leader === ol) f.leader = nl;
    }
    const seen = lastHubSeen.get(ol);
    if (seen) { lastHubSeen.delete(ol); lastHubSeen.set(nl, seen); }
    save();
    saveGame();
    res.json({ ok: true, name: newName });
  });

  r.post('/played', (req, res) => {
    const name = clean(req.body?.name);
    const gameId = cleanGameId(req.body?.gameId);
    if (!name || !GAMES.some((g) => g.id === gameId && g.playable)) return res.json({ ok: false });
    const u = ensureUser(name);
    u.recentGames = [gameId, ...u.recentGames.filter((g) => g !== gameId)].slice(0, 8);
    gameStat(gameId).plays++;
    save();
    res.json({ ok: true });
  });

  // The dashboard polls this — it doubles as the hub presence heartbeat.
  r.get('/social/:name', (req, res) => {
    const nameLower = clean(req.params.name).toLowerCase();
    if (!nameLower) return res.status(400).json({ error: 'name required' });
    lastHubSeen.set(nameLower, Date.now());
    const me = getUser(nameLower);
    if (!me) return res.status(404).json({ error: 'unknown user' });

    const friends = me.friends.map(publicUser).filter(Boolean);
    // everyone else currently online (hub or in a game), for the Connect tab
    const online = [];
    for (const [key, u] of Object.entries(platform.users)) {
      if (key === nameLower || me.friends.includes(key)) continue;
      const status = presenceOf(key);
      if (status !== 'offline') online.push({ name: u.name, avatar: u.avatar, status });
    }
    res.json({
      me: { name: me.name, avatar: me.avatar, recentGames: me.recentGames, wallet: walletOf(me), likedGames: likedGamesOf(nameLower) },
      friends,
      online,
    });
  });

  // ===================== REWARDS ECONOMY =====================

  // Static catalog (challenges + shop + rate + currency names) for the hub.
  r.get('/rewards/catalog', (req, res) => {
    res.json({ challenges: CHALLENGES, cubeRate: CUBE_RATE, shop: Object.values(SHOP_BY_ID), avatarShop: AVATAR_SHOP, currency: CURRENCY, points: POINTS });
  });

  // A game reports that a player completed a challenge. Idempotent: Stars are
  // only awarded the first time. Called by public/js/claudebox.js.
  r.post('/challenge/complete', (req, res) => {
    const name = clean(req.body?.name);
    const id = String(req.body?.id ?? '').slice(0, 60);
    const ch = CHALLENGE_BY_ID[id];
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    if (!ch) return res.status(404).json({ ok: false, error: 'unknown challenge' });
    const u = ensureUser(name);
    if (u.challenges[id]) {
      return res.json({ ok: true, newly: false, challenge: ch, wallet: walletOf(u) });
    }
    u.challenges[id] = new Date().toISOString();
    u.stars += ch.stars;
    save();
    res.json({ ok: true, newly: true, awarded: ch.stars, challenge: ch, wallet: walletOf(u) });
  });

  // Mint currency from Stars at CUBE_RATE Stars each.
  r.post('/currency/convert', (req, res) => {
    const name = clean(req.body?.name);
    const cubes = Math.floor(Number(req.body?.cubes) || 0);
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    if (cubes < 1) return res.status(400).json({ ok: false, error: `convert at least 1 ${CURRENCY.one}` });
    const u = ensureUser(name);
    const cost = cubes * CUBE_RATE;
    if (u.stars < cost) return res.status(400).json({ ok: false, error: `not enough ${POINTS.name}`, wallet: walletOf(u) });
    u.stars -= cost;
    u.cubes += cubes;
    save();
    res.json({ ok: true, minted: cubes, spentStars: cost, wallet: walletOf(u) });
  });

  // Send currency to another ClaudeBox player.
  r.post('/currency/send', (req, res) => {
    const name = clean(req.body?.name);
    const toName = clean(req.body?.to);
    const amount = Math.floor(Number(req.body?.amount) || 0);
    if (!name || !toName) return res.status(400).json({ ok: false, error: 'name and recipient required' });
    const nl = name.toLowerCase(), tl = toName.toLowerCase();
    if (nl === tl) return res.status(400).json({ ok: false, error: `You can't send ${CURRENCY.name} to yourself.` });
    if (amount < 1) return res.status(400).json({ ok: false, error: `Send at least 1 ${CURRENCY.one}.` });
    const me = getUser(nl);
    if (!me) return res.status(400).json({ ok: false, error: 'log in first' });
    ensureWallet(me);
    const them = getUser(tl);
    if (!them) return res.status(404).json({ ok: false, error: `No one named "${toName}" has joined ClaudeBox yet.` });
    ensureWallet(them);
    if (me.cubes < amount) return res.status(400).json({ ok: false, error: `not enough ${CURRENCY.name}`, wallet: walletOf(me) });
    me.cubes -= amount;
    them.cubes += amount;
    save();
    res.json({ ok: true, sent: amount, to: them.name, wallet: walletOf(me) });
  });

  // Buy a shop cosmetic with Cubes (one-time; then it's in `owned`).
  r.post('/shop/buy', (req, res) => {
    const name = clean(req.body?.name);
    const item = SHOP_BY_ID[String(req.body?.item ?? '')];
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    if (!item) return res.status(404).json({ ok: false, error: 'unknown item' });
    const u = ensureUser(name);
    if (u.owned.includes(item.id)) return res.json({ ok: true, already: true, wallet: walletOf(u) });
    if (u.cubes < item.price) return res.status(400).json({ ok: false, error: `not enough ${CURRENCY.name}`, wallet: walletOf(u) });
    u.cubes -= item.price;
    u.owned.push(item.id);
    // auto-equip what you just bought
    if (item.kind === 'title') u.title = item.value;
    if (item.kind === 'color') u.nameColor = item.value;
    save();
    res.json({ ok: true, bought: item.id, wallet: walletOf(u) });
  });

  // Equip / clear an owned cosmetic. Pass { title } and/or { nameColor } as a
  // shop item id, or '' to clear.
  r.post('/shop/equip', (req, res) => {
    const name = clean(req.body?.name);
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const u = ensureUser(name);
    const equip = (val, kind, apply) => {
      if (val === undefined) return;
      if (val === '' || val === null) { apply(''); return; }
      const item = SHOP_BY_ID[String(val)];
      if (item && item.kind === kind && u.owned.includes(item.id)) apply(item.value);
    };
    equip(req.body?.title, 'title', (v) => { u.title = v; });
    equip(req.body?.nameColor, 'color', (v) => { u.nameColor = v; });
    save();
    res.json({ ok: true, wallet: walletOf(u) });
  });

  // Generic Cube spend for in-game shops. Games call this to charge a player;
  // returns the new balance so the game can gate a purchase.
  r.post('/currency/spend', (req, res) => {
    const name = clean(req.body?.name);
    const amount = Math.floor(Number(req.body?.amount) || 0);
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    if (amount < 1) return res.status(400).json({ ok: false, error: 'bad amount' });
    const u = ensureUser(name);
    if (u.cubes < amount) return res.status(400).json({ ok: false, error: `not enough ${CURRENCY.name}`, cubes: u.cubes });
    u.cubes -= amount;
    save();
    res.json({ ok: true, spent: amount, cubes: u.cubes });
  });

  return r;
}
