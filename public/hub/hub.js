// ClaudeBox home — login, tabs, social, the games library, a 3D avatar
// studio, and a synthesized sound layer. Talks to the same platform API as
// before (/api/login, /social, /games, /avatar, /friends/*, /rename, /played).

import * as THREE from 'three';
import { drawAvatarHead } from './avatarModel.js';
import { preloadAvatars, makeAvatar, CLOTHING } from '/shared/avatar3d.js';
import { lazyThumb } from './thumbs.js';
import { sfx } from './sounds.js';
import { CHALLENGES, SHOP, CUBE_RATE, CURRENCY, POINTS, AVATAR_SHOP, AVATAR_SHOP_BY_ID, AVATAR_CATS } from '/shared/rewards.js';
import { initVoice } from '/js/voice.js';
import { startMotion } from './motion.js';
import { initRbxUi, syncRbxUi, applyRbxUi } from './rbxui.js';
import { drawPfp } from './pfp.js';
import { openPfpEditor } from './pfpedit.js';

const USER_KEY = 'claudebox.user';

// persistent device id cookie — rides every API call so device bans stick
try {
  let did = localStorage.getItem('cbx.did');
  if (!did) {
    did = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem('cbx.did', did);
  }
  document.cookie = 'cbx_did=' + did + ';path=/;max-age=63072000;SameSite=Lax';
} catch {}
const SETTINGS_KEY = 'claudebox.settings';
const $ = (id) => document.getElementById(id);

// ---------------- per-device settings ----------------
const settings = (() => {
  const d = { accent: '#38b6e8', reduceMotion: false, sound: true, ambient: false, theme: 'dark', gyro: true, rblxsMaps: false, robloxUI: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return d; }
})();
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

// derive a readable "ink" colour + glow for any accent
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function applyAccent() {
  // Roblox mode owns its own palette; the accent would only leak into it.
  if (settings.robloxUI) return;
  const a = settings.accent;
  const [r, g, b] = hexToRgb(a);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const root = document.documentElement.style;
  root.setProperty('--accent', a);
  root.setProperty('--accent-2', `rgb(${Math.min(255, r + 45)},${Math.min(255, g + 45)},${Math.min(255, b + 45)})`);
  root.setProperty('--accent-glow', `rgba(${r},${g},${b},.45)`);
  root.setProperty('--accent-ink', lum > 0.62 ? '#06232e' : '#eafaff');
}
function applyMotion() { document.body.classList.toggle('reduce-motion', settings.reduceMotion); }

// tilt/parallax layer — gyro on phones, pointer on desktops (see motion.js).
// The settings switch greys out if the device turns out to have no gyroscope.
let tiltToasted = false;
const GYRO_STATUS_TEXT = {
  'waiting-tap': 'Tap anywhere, then Allow when iPhone asks for motion access.',
  asking: 'Asking for motion access…',
  granted: 'Motion access allowed — move your phone!',
  denied: 'Motion access is blocked. Flip this switch to ask again — if no prompt appears, clear this site under iPhone Settings → Safari → Advanced → Website Data, then reload.',
  error: 'Motion permission errored — reload and try again.',
  retrying: 'Waking up the sensors…',
  nodata: 'Motion is allowed but iOS isn’t sending tilt data. Fully close and reopen the app — or open ClaudeBox in Safari itself.',
};
const motionCtl = startMotion({
  gyro: settings.gyro,
  reduce: settings.reduceMotion,
  onSupport(ok) {
    const row = $('gyro-row');
    if (!row) return;
    row.classList.toggle('disabled', !ok);
    $('gyro-input').disabled = !ok;
    $('gyro-hint').classList.toggle('hidden', ok);
  },
  onStatus(s, live) {
    const el = $('gyro-status');
    if (el) {
      const txt = s === 'active'
        ? `Tilt active ✓${live ? `  (x ${(+live.x).toFixed(2)} · y ${(+live.y).toFixed(2)})` : ''}`
        : GYRO_STATUS_TEXT[s] || '';
      el.textContent = txt;
      el.classList.toggle('hidden', !txt);
    }
    if (s === 'active' && !tiltToasted) { tiltToasted = true; toast('Tilt effects on — move your phone', '📱'); }
  },
});
function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');
  applyRbxUi();   // keeps <meta theme-color> and the Roblox token set in step
}
applyAccent();
applyMotion();
applyTheme();
sfx.setEnabled(settings.sound);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const stateHub = { me: null, games: [], friends: [], online: [] };

// ---------------- sound plumbing ----------------
// Unlock the audio context on the very first gesture (browser autoplay policy)…
['pointerdown', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, () => { sfx.unlock(); if (settings.ambient) sfx.setAmbient(true); }, { once: true }));
// …and whisper on hover over anything interactive.
let lastHover = null;
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest?.('.game-tile,.tab,.chip,.friend-circle,.opt-btn,.icon-btn,.hero-cta,#me-chip,#hero,.person-row button,.skin-swatch');
  if (el && el !== lastHover) { lastHover = el; if (settings.sound) sfx.hover(); }
  else if (!el) lastHover = null;
});

// ---------------- toast ----------------
function toast(text, icon = '✨') {
  const el = document.createElement('div');
  el.className = 'hub-toast';
  el.innerHTML = `<span>${icon}</span><span>${text}</span>`;
  $('hub-toasts').appendChild(el);
  sfx.toast();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 3000);
}

async function api(path, body) {
  const codeHdr = { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' };
  const res = await fetch('/api' + path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...codeHdr }, body: JSON.stringify(body) }
    : { headers: codeHdr });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'request failed'); e.data = data; throw e; }
  return data;
}
function bannedScreen(reason) {
  document.body.innerHTML = `<div style="position:fixed;inset:0;display:grid;place-items:center;background:radial-gradient(800px 500px at 50% 0%,#2a1013,#0a0b12);color:#e9edf5;font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:24px">
    <div><div style="font-size:70px">🔨</div><h1 style="margin:10px 0 8px;font-size:30px">You're banned</h1>
    <p style="color:#c99;max-width:440px;margin:0 auto;line-height:1.5">${(reason || 'You have been banned from ClaudeBox.')}</p></div></div>`;
}

// ---------------- login ----------------
async function ensureLogin() {
  const saved = localStorage.getItem(USER_KEY);
  if (saved) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { const res = await api('/login', { name: saved }); stateHub.me = res.profile; return; }
      catch (e) { if (e.data && e.data.banned) { bannedScreen(e.data.reason); return; } await new Promise((r) => setTimeout(r, 600)); }
    }
  }
  $('login').classList.remove('hidden');
  await new Promise((resolve) => {
    $('login-toggle')?.addEventListener('click', () => {
      const ci = $('code-input'); const nowHidden = ci.classList.toggle('hidden');
      $('login-toggle').textContent = nowHidden ? 'First time? Use an invite code' : 'Hide invite code';
      if (!nowHidden) ci.focus();
    });
    const go = async () => {
      const name = $('login-input').value.trim().slice(0, 20);
      if (!name) return;
      const pw = $('pw-input')?.value || '';
      const code = $('code-input')?.value.trim();
      try {
        let res;
        if (pw) {
          // log in with a password — the server hands back the access code so
          // the hub + every game keep working exactly as before
          res = await api('/pwlogin', { name, password: pw });
          if (res.code != null) localStorage.setItem('claudebox.code', res.code);
        } else {
          if (code) localStorage.setItem('claudebox.code', code);
          res = await api('/login', { name });
        }
        stateHub.me = res.profile;
        localStorage.setItem(USER_KEY, res.profile.name);
        sfx.welcome();
        const card = $('login').querySelector('.login-card');
        card.style.transition = 'transform .4s var(--spring), opacity .4s';
        card.style.transform = 'scale(1.05)'; card.style.opacity = '0';
        setTimeout(() => { $('login').classList.add('hidden'); resolve(); }, 380);
      } catch (e) { if (e.data && e.data.banned) { bannedScreen(e.data.reason); return; } toast(e.message, '⚠️'); }
    };
    $('login-btn').addEventListener('click', go);
    $('login-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('login-input').focus();
  });
}

// ---------------- tabs (sliding pill) ----------------
const pill = document.querySelector('#tabs .pill');
function movePill() {
  const sel = document.querySelector('.tab.selected');
  if (!sel) return;
  pill.style.width = sel.offsetWidth + 'px';
  pill.style.transform = `translateX(${sel.offsetLeft}px)`;
}
function selectTab(name, withSound = true) {
  const btn = document.querySelector(`.tab[data-tab="${name}"]`);
  if (!btn || btn.classList.contains('selected')) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('selected', t === btn));
  document.querySelectorAll('.tab-page').forEach((p) => p.classList.add('hidden'));
  const page = $('tab-' + name);
  page.classList.remove('hidden');
  page.style.animation = 'none'; void page.offsetWidth; page.style.animation = '';
  movePill();
  if (withSound) sfx.select();
  if (name === 'avatar') avatarEditor.start(); else avatarEditor.stop();
  if (name === 'store') renderStore();
  syncRbxUi();
}
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => selectTab(tab.dataset.tab));
$('me-chip').addEventListener('click', () => { if (stateHub.me?.name) openProfile(stateHub.me.name); });
$('wallet-chip').addEventListener('click', () => selectTab('rewards'));
window.addEventListener('resize', movePill);
// keyboard: 1-4 jump to tabs
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const map = { 1: 'home', 2: 'rewards', 3: 'avatar', 4: 'connect', 5: 'settings' };
  if (map[e.key]) selectTab(map[e.key]);
});

// ---------------- thumbnails ----------------
// Accepts either a user record ({ avatar, pfp }) or a bare avatar, so older
// call sites keep working while profile pictures ride along where we have them.
function thumbInto(canvas, avatarOrUser, pfp) {
  const user = (avatarOrUser && avatarOrUser.avatar) ? avatarOrUser : { avatar: avatarOrUser, pfp };
  drawPfp(canvas, user, drawAvatarHead);
}

// ---------------- per-game theming (client-side flourish) ----------------
const GAME_THEME = {
  'feather-friends': { emoji: '🐦', from: '#1fa87a', to: '#0c5566', accent: '#34d6a8' },
  'backpacking':     { emoji: '🏕️', from: '#e0913c', to: '#6e3417', accent: '#ffbb52' },
  'restaurant-sim-2':{ emoji: '🍔', from: '#e0503c', to: '#6e1626', accent: '#ff7a5c' },
  'obby':            { emoji: '🧗', from: '#7c5cff', to: '#241566', accent: '#a58bff' },
  'wibit':           { emoji: '🌊', from: '#2ec5e0', to: '#144a70', accent: '#5be0ff' },
  'rivals':          { emoji: '🎯', from: '#e04b3c', to: '#3c1024', accent: '#ff6b5c' },
  'nds':             { emoji: '🌪️', from: '#5a6a7a', to: '#1a2230', accent: '#8fd0ff' },
  'brook':           { emoji: '🏘️', from: '#4fae6a', to: '#173a24', accent: '#7fe0a0' },
  'tycoon':          { emoji: '🔥', from: '#ff7a3a', to: '#2a1866', accent: '#ffb14a' },
  'bab':             { emoji: '🚤', from: '#2fb0d0', to: '#0d3a5a', accent: '#6ee7ff' },
  'webrush':         { emoji: '🕸️', from: '#e0303c', to: '#1a2140', accent: '#ff5a6c' },
  'playground':      { emoji: '🎡', from: '#ff5ca8', to: '#661650', accent: '#ff8fd0' },
  'studio':          { emoji: '🛠️', from: '#5c72ff', to: '#161f66', accent: '#8ba3ff' },
};
const themeOf = (id) => GAME_THEME[id] || { emoji: '🎮', from: '#3a3f4d', to: '#181a20', accent: '#8b93a5' };

// ---------------- home: friends ----------------
const STATUS_LABEL = { hub: 'online', offline: 'offline' };
function statusText(s) { return s?.startsWith('game') ? 'in a game' : (STATUS_LABEL[s] || 'offline'); }

function renderFriends() {
  const row = $('friends-row');
  row.innerHTML = '';
  $('friend-count').textContent = stateHub.friends.length ? `${stateHub.friends.length} total` : '';
  // an "add friend" launcher always sits first
  const add = document.createElement('button');
  add.className = 'friend-circle add-circle';
  add.innerHTML = `<span class="fc-ring"><span class="plus">+</span></span><span class="fname">Add</span><span class="fstatus">friend</span>`;
  add.addEventListener('click', () => selectTab('connect'));
  row.appendChild(add);

  const sorted = [...stateHub.friends].sort((a, b) => (a.status === 'offline') - (b.status === 'offline'));
  for (const f of sorted) {
    const el = document.createElement('button');
    const cls = f.status === 'hub' ? 'status-hub' : f.status.startsWith('game') ? 'status-game' : '';
    el.className = 'friend-circle ' + cls;
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    thumbInto(cv, f);
    el.innerHTML = `<span class="fc-ring"></span><span class="fname">${escapeHtml(f.name)}</span><span class="fstatus">${statusText(f.status)}</span>`;
    if (f.nameColor === 'rainbow') el.querySelector('.fname').classList.add('name-rainbow');
    else if (f.nameColor) el.querySelector('.fname').style.color = f.nameColor;
    const ring = el.querySelector('.fc-ring');
    ring.appendChild(cv);
    const dot = document.createElement('span'); dot.className = 'fc-dot'; ring.appendChild(dot);
    if (f.status.startsWith('game')) el.addEventListener('click', () => launchGame('feather-friends'));
    row.appendChild(el);
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------- home: game tiles ----------------
function playerCountFor(gameId) {
  return stateHub.friends.concat(stateHub.online).filter((p) => p.status === `game:${gameId}`).length;
}
function fmtNum(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return '' + n;
}
const likedGames = () => stateHub.me?.likedGames || [];

async function likeGame(gameId) {
  const liked = !likedGames().includes(gameId);
  try {
    const d = await api('/game/like', { name: stateHub.me.name, gameId, like: liked });
    if (!d.ok) return;
    stateHub.me.likedGames = liked ? [...likedGames(), gameId] : likedGames().filter((g) => g !== gameId);
    const g = stateHub.games.find((x) => x.id === gameId); if (g) g.likes = d.likes;
    (liked ? sfx.success : sfx.tap)();
    renderGames();
  } catch (e) { toast(e.message, '⚠️'); }
}

// person icon for the green player count (Roblox-style)
const PC_ICON = '<svg class="pc-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 8a3 3 0 100-6 3 3 0 000 6zm0 1.4c-3.2 0-5.6 1.6-5.6 3.6V14h11.2v-1c0-2-2.4-3.6-5.6-3.6z"/></svg>';
// a stable, plausible approval % from the like count (Roblox shows a % positive)
function approvalPct(game) {
  let h = 0;
  for (const c of String(game.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const base = 81 + (h % 15);   // each game gets its own stable 81–95
  return Math.min(99, base + Math.round(Math.log2((game.likes || 0) + 1) * 2));
}
function gameTile(game) {
  const t = themeOf(game.id);
  const open = game.playable && !game.maintenance;
  const tile = document.createElement('button');
  tile.className = 'game-tile' + (open ? '' : ' soon');
  tile.style.setProperty('--tile-accent', t.accent);
  tile.style.setProperty('--tile-glow', t.accent + '66');

  // ---- square thumbnail ----
  const art = document.createElement('div');
  art.className = 'art';
  const grad = `linear-gradient(150deg, ${t.from}, ${t.to})`;
  if (game.art) art.style.background = `url("${game.art}") center/cover, ${grad}`;
  else { art.classList.add('gradient'); art.style.background = grad; art.textContent = t.emoji; }
  const players = open ? playerCountFor(game.id) : 0;
  if (game.maintenance) art.insertAdjacentHTML('beforeend', `<span class="soon-badge">🔧 Updating</span>`);
  else if (!game.playable) art.insertAdjacentHTML('beforeend', `<span class="soon-badge">🔒 Soon</span>`);
  else if (players > 0) art.insertAdjacentHTML('beforeend', `<span class="live-badge"><span class="live-dot"></span>${fmtNum(players)}</span>`);
  if (open) art.insertAdjacentHTML('beforeend', '<div class="tile-play">▶</div>');
  tile.append(art);

  // ---- title below the thumbnail (Roblox layout) ----
  const title = document.createElement('div');
  title.className = 'gt-title'; title.textContent = game.title;
  tile.append(title);

  // ---- footer: green player/visit count + approval % ----
  const foot = document.createElement('div');
  foot.className = 'gt-foot';
  if (open) {
    const countTxt = players > 0 ? fmtNum(players) : (game.plays > 0 ? fmtNum(game.plays) : 'New');
    foot.innerHTML = `<span class="gt-players">${PC_ICON}${countTxt}</span>`;
    const like = document.createElement('span');
    like.className = 'gt-like' + (likedGames().includes(game.id) ? ' liked' : '');
    like.innerHTML = `<span class="gt-thumb">👍</span>${approvalPct(game)}%`;
    like.title = 'Like';
    like.addEventListener('click', (e) => { e.stopPropagation(); likeGame(game.id); });
    foot.append(like);
  } else {
    foot.innerHTML = `<span class="gt-soon">${escapeHtml(game.tagline || 'Coming soon')}</span>`;
  }
  tile.append(foot);

  tile.addEventListener('click', () => openGameDetail(game));
  return tile;
}

// ---------------- game detail page (Roblox-style experience card) ----------------
const FAVS_KEY = 'claudebox.favorites';
function favGames() { try { return JSON.parse(localStorage.getItem(FAVS_KEY) || '[]'); } catch { return []; } }
function toggleFav(id) { const f = favGames(); const i = f.indexOf(id); if (i >= 0) f.splice(i, 1); else f.push(id); localStorage.setItem(FAVS_KEY, JSON.stringify(f)); return f.includes(id); }
function themeGrad(g) { const t = themeOf(g.id); return `linear-gradient(150deg, ${t.from}, ${t.to})`; }
function gdDescription(g) {
  const tags = (g.tags || []).join(', ');
  return `${g.tagline || ''} ${g.title} is a ${tags ? tags.toLowerCase() + ' ' : ''}experience on ClaudeBox. Jump in with friends, climb the leaderboards, and earn Credits to spend in the Store. Welcome — have fun!`;
}
let gdEl = null, gdShots = [], gdShot = 0, gdGame = null;
function ensureGdEl() {
  if (gdEl) return gdEl;
  gdEl = document.createElement('div');
  gdEl.id = 'game-detail'; gdEl.className = 'gd-overlay hidden';
  gdEl.innerHTML =
    `<div class="gd-card">
      <button class="gd-close" aria-label="Close">✕</button>
      <div class="gd-top">
        <div class="gd-media">
          <button class="gd-arrow prev" aria-label="Previous">‹</button>
          <div class="gd-shot"></div>
          <button class="gd-arrow next" aria-label="Next">›</button>
        </div>
        <div class="gd-info">
          <h1 class="gd-title"></h1>
          <div class="gd-by">By <span class="gd-creators"></span></div>
          <div class="gd-maturity">Maturity: Mild</div>
          <button class="gd-play"><span class="gd-play-ico">▶</span></button>
          <div class="gd-actions">
            <button class="gd-fav"><span class="gd-star">☆</span><span>Favorite</span></button>
            <div class="gd-votes">
              <span class="gd-vote">👍 <b class="gd-likes">0</b></span>
              <div class="gd-bar"><i class="gd-bar-fill"></i></div>
              <span class="gd-vote"><b class="gd-dislikes">0</b> 👎</span>
            </div>
          </div>
        </div>
      </div>
      <div class="gd-tabs">
        <button class="gd-tab active" data-t="about">About</button>
        <button class="gd-tab" data-t="store">Store</button>
        <button class="gd-tab" data-t="servers">Servers</button>
      </div>
      <div class="gd-body"></div>
    </div>`;
  document.body.appendChild(gdEl);
  gdEl.querySelector('.gd-close').addEventListener('click', closeGameDetail);
  gdEl.addEventListener('click', (e) => { if (e.target === gdEl) closeGameDetail(); });
  gdEl.querySelector('.gd-arrow.prev').addEventListener('click', () => cycleShot(-1));
  gdEl.querySelector('.gd-arrow.next').addEventListener('click', () => cycleShot(1));
  gdEl.querySelector('.gd-play').addEventListener('click', () => { if (gdGame) launchGame(gdGame.id); });
  gdEl.querySelector('.gd-fav').addEventListener('click', () => {
    if (!gdGame) return; const on = toggleFav(gdGame.id); (on ? sfx.success : sfx.tap)();
    gdEl.querySelector('.gd-star').textContent = on ? '★' : '☆';
    gdEl.querySelector('.gd-fav').classList.toggle('on', on);
  });
  gdEl.querySelectorAll('.gd-tab').forEach((b) => b.addEventListener('click', () => setGdTab(b.dataset.t)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !gdEl.classList.contains('hidden')) closeGameDetail(); });
  return gdEl;
}
function cycleShot(d) { if (gdShots.length < 2) return; gdShot = (gdShot + d + gdShots.length) % gdShots.length; paintShot(); sfx.tap(); }
function paintShot() {
  const el = gdEl.querySelector('.gd-shot'); const s = gdShots[gdShot] || {};
  el.style.background = s.bg || '#14161c'; el.textContent = s.emoji || ''; el.classList.toggle('emoji', !!s.emoji);
}
function setGdTab(t) {
  gdEl.querySelectorAll('.gd-tab').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
  renderGdBody(t);
}
function renderGdBody(t) {
  const body = gdEl.querySelector('.gd-body'); const g = gdGame; if (!g) return;
  const players = playerCountFor(g.id);
  if (t === 'about') {
    const evArt = g.art ? `url('${g.art}') center/cover` : themeGrad(g);
    const events = [0, 1].map(() => `<div class="gd-event"><div class="gd-event-art" style="background:${evArt}"></div><span class="gd-event-badge">✦ New content</span></div>`).join('');
    body.innerHTML =
      `<h3 class="gd-h">Events</h3>
       <div class="gd-events">${events}</div>
       <h3 class="gd-h">Description</h3>
       <p class="gd-desc">${escapeHtml(gdDescription(g))}</p>
       <div class="gd-chipset">${(g.tags || []).map((x) => `<span>${escapeHtml(x)}</span>`).join('')}</div>
       <div class="gd-stats">
         <div><b>${players > 0 ? fmtNum(players) : '0'}</b><span>Active</span></div>
         <div><b>${fmtNum(g.plays || 0)}</b><span>Visits</span></div>
         <div><b>${fmtNum(g.likes || 0)}</b><span>Likes</span></div>
         <div><b>${approvalPct(g)}%</b><span>Rating</span></div>
       </div>`;
  } else if (t === 'store') {
    body.innerHTML = `<div class="gd-empty"><div class="gd-empty-emoji">🛒</div><p>Deck out your character with cosmetics in the ClaudeBox Store.</p><button class="gd-store-btn">Open Store</button></div>`;
    body.querySelector('.gd-store-btn').addEventListener('click', () => { closeGameDetail(); selectTab('store'); });
  } else {
    body.innerHTML =
      `<h3 class="gd-h">Servers</h3>
       <div class="gd-servers">
         <div class="gd-server">${players > 0 ? `<span class="live-dot"></span><b>${fmtNum(players)}</b>&nbsp;playing now` : `No one's playing right now — be the first in!`}</div>
         <button class="gd-join">▶ Join a Server</button>
       </div>`;
    body.querySelector('.gd-join').addEventListener('click', () => launchGame(g.id));
  }
}
function openGameDetail(game) {
  ensureGdEl(); gdGame = game;
  const t = themeOf(game.id);
  gdShots = [];
  if (game.art) gdShots.push({ bg: `url("${game.art}") center/cover` });
  gdShots.push({ bg: themeGrad(game), emoji: t.emoji });
  gdShot = 0; paintShot();
  const showArrows = gdShots.length > 1 ? '' : 'none';
  gdEl.querySelector('.gd-arrow.prev').style.display = showArrows;
  gdEl.querySelector('.gd-arrow.next').style.display = showArrows;
  gdEl.querySelector('.gd-title').textContent = `${t.emoji} ${game.title}`;
  renderCreators(gdEl.querySelector('.gd-creators'), game.creators || [{ name: 'ClaudeBox Studios', badge: 'verified' }]);
  const likes = game.likes || 0, pct = approvalPct(game);
  gdEl.querySelector('.gd-likes').textContent = fmtNum(likes);
  gdEl.querySelector('.gd-dislikes').textContent = fmtNum(likes ? Math.round(likes * (100 - pct) / Math.max(1, pct)) : 0);
  const barFill = gdEl.querySelector('.gd-bar-fill');
  barFill.style.width = likes ? pct + '%' : '0%';
  barFill.closest('.gd-bar').classList.toggle('empty', !likes);
  const fav = favGames().includes(game.id);
  gdEl.querySelector('.gd-star').textContent = fav ? '★' : '☆';
  gdEl.querySelector('.gd-fav').classList.toggle('on', fav);
  const play = gdEl.querySelector('.gd-play'), open = game.playable && !game.maintenance;
  play.querySelector('.gd-play-ico').textContent = open ? '▶' : (game.maintenance ? '🔧 Updating' : '🔒 Coming soon');
  play.classList.toggle('disabled', !open);
  setGdTab('about');
  gdEl.querySelector('.gd-card').scrollTop = 0;
  gdEl.classList.remove('hidden'); document.body.classList.add('gd-open');
  sfx.select();
}
function closeGameDetail() { if (gdEl) { gdEl.classList.add('hidden'); document.body.classList.remove('gd-open'); sfx.tap(); } }

// "Popular right now" shelf — playable games ranked by plays.
function renderPopular() {
  const host = $('popular-row'); if (!host) return;
  const pop = stateHub.games.filter((g) => g.playable && !g.maintenance)
    .sort((a, b) => (b.plays - a.plays) || (b.likes - a.likes)).slice(0, 8);
  host.innerHTML = '';
  for (const g of pop) host.appendChild(gameTile(g));
}

// "Charts" — a ranked top-list like Roblox's charts.
function renderCharts() {
  const host = $('charts'); if (!host) return;
  const ranked = stateHub.games.filter((g) => g.playable)
    .sort((a, b) => (b.plays - a.plays) || (b.likes - a.likes)).slice(0, 7);
  host.innerHTML = '';
  ranked.forEach((g, i) => {
    const t = themeOf(g.id);
    const row = document.createElement('button');
    row.className = 'chart-row';
    row.style.setProperty('--tile-accent', t.accent);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
    const art = g.art ? `url('${g.art}') center/cover` : `linear-gradient(150deg, ${t.from}, ${t.to})`;
    const players = playerCountFor(g.id);
    row.innerHTML =
      `<span class="chart-rank ${i < 3 ? 'medal' : ''}">${medal}</span>` +
      `<span class="chart-thumb" style="background:${art}"></span>` +
      `<span class="chart-info"><span class="chart-title">${escapeHtml(g.title)}</span>` +
      `<span class="chart-tag">${escapeHtml((g.tags || [])[0] || 'Game')}${players > 0 ? ` · <span class="ch-live">🟢 ${players} playing</span>` : ''}</span></span>` +
      `<span class="chart-stats"><b>▶ ${fmtNum(g.plays)}</b><span>👍 ${fmtNum(g.likes)}</span></span>` +
      `<span class="chart-go">▶</span>`;
    row.addEventListener('click', () => launchGame(g.id));
    host.appendChild(row);
  });
}

// ---------------- search + categories ----------------
let activeCat = 'All';
let searchText = '';
function allCategories() {
  const set = new Set();
  for (const g of stateHub.games) if (g.playable) (g.tags || []).forEach((t) => set.add(t));
  return ['All', ...[...set].sort()];
}
function renderChips() {
  const host = $('cat-chips');
  host.innerHTML = '';
  for (const c of allCategories()) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (c === activeCat ? ' on' : '');
    chip.textContent = c;
    chip.addEventListener('click', () => { activeCat = c; sfx.tap(); renderChips(); renderGames(); });
    host.appendChild(chip);
  }
}
$('game-search').addEventListener('input', (e) => { searchText = e.target.value.trim().toLowerCase(); renderGames(); });

function matchesFilter(g) {
  if (activeCat !== 'All' && !(g.tags || []).includes(activeCat)) return false;
  if (searchText) {
    const hay = `${g.title} ${g.tagline} ${(g.tags || []).join(' ')}`.toLowerCase();
    if (!hay.includes(searchText)) return false;
  }
  return true;
}

function renderGames() {
  const playable = stateHub.games.filter((g) => g.playable);
  const soon = stateHub.games.filter((g) => !g.playable);
  $('games-count').textContent = `${playable.length} to play`;

  const gr = $('games-row'); gr.innerHTML = '';
  const shown = playable.filter(matchesFilter);
  $('no-results').classList.toggle('hidden', shown.length > 0);
  for (const g of shown) gr.appendChild(gameTile(g));

  // continue / jump-back-in
  const cont = $('continue-row'); cont.innerHTML = '';
  const recents = (stateHub.me.recentGames || []).map((id) => stateHub.games.find((g) => g.id === id)).filter((g) => g && g.playable);
  $('continue-block').classList.toggle('hidden', recents.length === 0);
  for (const g of recents.slice(0, 6)) cont.appendChild(gameTile(g));

  // coming soon
  const sr = $('soon-row'); sr.innerHTML = '';
  $('soon-block').classList.toggle('hidden', soon.length === 0);
  for (const g of soon) sr.appendChild(gameTile(g));

  renderPopular();
}

// ---------------- hero (rotating featured) ----------------
let heroList = [], heroIdx = 0, heroTimer = null;
function renderHero() {
  const recents = (stateHub.me.recentGames || []).map((id) => stateHub.games.find((g) => g.id === id)).filter((g) => g && g.playable);
  const playable = stateHub.games.filter((g) => g.playable && !g.maintenance);
  // feature your most-recent first, then everything else, de-duplicated
  const seen = new Set();
  heroList = [...recents, ...playable].filter((g) => g && !seen.has(g.id) && seen.add(g.id)).slice(0, 5);
  const hero = $('hero');
  if (!heroList.length) { hero.classList.add('hidden'); return; }
  hero.classList.remove('hidden');
  if (heroIdx >= heroList.length) heroIdx = 0;
  paintHero();
  const dots = $('hero-dots'); dots.innerHTML = '';
  heroList.forEach((_, i) => {
    const d = document.createElement('i'); if (i === heroIdx) d.classList.add('on');
    d.addEventListener('click', (e) => { e.stopPropagation(); heroIdx = i; paintHero(); restartHeroTimer(); });
    dots.appendChild(d);
  });
  restartHeroTimer();
}
function paintHero() {
  const g = heroList[heroIdx]; if (!g) return;
  const t = themeOf(g.id);
  const hero = $('hero');
  hero.style.setProperty('--tile-accent', t.accent);
  const bg = hero.querySelector('.hero-bg');
  const grad = `linear-gradient(150deg, ${t.from}, ${t.to})`;
  bg.style.background = g.art ? `url("${g.art}") center/cover, ${grad}` : grad;
  const recent = (stateHub.me.recentGames || [])[0] === g.id;
  $('hero-eyebrow-text').textContent = recent ? 'Continue playing' : 'Featured';
  $('hero-title').textContent = g.title;
  $('hero-tagline').textContent = g.tagline || '';
  [...$('hero-dots').children].forEach((d, i) => d.classList.toggle('on', i === heroIdx));
}
function restartHeroTimer() {
  clearInterval(heroTimer);
  if (settings.reduceMotion || heroList.length < 2) return;
  heroTimer = setInterval(() => { heroIdx = (heroIdx + 1) % heroList.length; paintHero(); }, 7000);
}
$('hero')?.addEventListener('click', () => { const g = heroList[heroIdx]; if (g) launchGame(g.id); });

function launchGame(gameId) {
  const game = stateHub.games.find((g) => g.id === gameId);
  if (!game?.playable || game.maintenance) return;
  sfx.launch();
  api('/played', { name: stateHub.me.name, gameId }).catch(() => {});
  try {
    const key = 'featherfriends.lastProfile';
    const prof = JSON.parse(localStorage.getItem(key) || '{}');
    prof.name = stateHub.me.name;
    localStorage.setItem(key, JSON.stringify(prof));
  } catch {}
  // brief moment for the launch flourish to breathe
  document.body.style.transition = 'opacity .32s var(--ease)';
  document.body.style.opacity = '0.35';
  setTimeout(() => { location.href = game.url; }, 300);
}

// ---------------- skeleton loaders ----------------
function showSkeletons() {
  const gr = $('games-row');
  gr.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton sk-tile"></div>').join('');
  const fr = $('friends-row');
  fr.innerHTML = Array.from({ length: 5 }, () => '<div class="friend-circle"><span class="skeleton sk-circle"></span></div>').join('');
}

// ---------------- verification badges + profiles ----------------
function badgeSvg(badge) {
  // Champion: a plain gold disc with a white star, so it reads differently
  // from the scalloped verification badge at a glance.
  // Legend outranks Champion: a violet disc with a white crown, so the two
  // never read as the same thing at small sizes.
  if (badge === 'legend') {
    return '<svg class="vbadge legend" viewBox="0 0 22 22" role="img" aria-label="Legend">'
      + '<title>Legend</title>'
      + '<defs><linearGradient id="lgg" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="#c46bff"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>'
      + '<circle cx="11" cy="11" r="10" fill="url(#lgg)" stroke="#5b21b6" stroke-width="1"/>'
      + '<path fill="#fff" d="M5.2 14.6l-1-6.2 3.5 2.3L11 6.2l3.3 4.5 3.5-2.3-1 6.2z"/>'
      + '<rect x="5.2" y="15.2" width="11.6" height="1.7" rx=".6" fill="#fff"/>'
      + '</svg>';
  }
  if (badge === 'champion') {
    return '<svg class="vbadge champion" viewBox="0 0 22 22" role="img" aria-label="Champion">'
      + '<title>Champion</title>'
      + '<circle cx="11" cy="11" r="10" fill="#ffc107" stroke="#d99a12" stroke-width="1"/>'
      + '<path fill="#fff" d="M11 4.4l1.86 3.77 4.16.6-3.01 2.94.71 4.14L11 13.9l-3.72 1.95.71-4.14-3.01-2.94 4.16-.6z"/>'
      + '</svg>';
  }
  if (badge !== 'verified' && badge !== 'owner') return '';
  const col = badge === 'owner' ? '#e0393b' : '#1a9bf0';
  const label = badge === 'owner' ? 'Owner' : 'Verified';
  return `<svg class="vbadge ${badge}" viewBox="0 0 22 22" role="img" aria-label="${label}"><title>${label}</title><path fill="${col}" d="M11 1l2.7 1.9 3.3-.2 1 3.1 2.7 1.9-1 3.1 1 3.1-2.7 1.9-1 3.1-3.3-.2L11 21l-2.7-1.9-3.3.2-1-3.1L1.3 14.3l1-3.1-1-3.1 2.7-1.9 1-3.1 3.3.2z"/><path fill="#fff" d="M9.5 14.4l-2.6-2.6 1.2-1.2 1.4 1.4 3.6-3.6 1.2 1.2z"/></svg>`;
}
function renderCreators(container, creators) {
  if (!container) return;
  container.innerHTML = '';
  creators.forEach((c, i) => {
    if (i > 0) container.appendChild(document.createTextNode(' & '));
    const a = document.createElement('span'); a.className = 'creator-link'; a.textContent = c.name;
    a.addEventListener('click', (e) => { e.stopPropagation(); openProfile(c.name); });
    container.appendChild(a);
    if (c.badge) container.insertAdjacentHTML('beforeend', badgeSvg(c.badge));
  });
}

// a lazy 3D avatar preview for the profile card (own renderer)
const profileStage = (() => {
  let renderer = null, scene, cam, ctrl = null, running = false, ready = false, pending = undefined;
  const clock = new THREE.Clock();
  async function init(canvas) {
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(30, 1, 0.1, 30); cam.position.set(0, 1.05, 4.8); cam.lookAt(0, 0.95, 0);
    scene.add(new THREE.AmbientLight('#aab4c4', 1.5));
    const key = new THREE.DirectionalLight('#fff4dc', 2.0); key.position.set(2, 4, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(settings.accent, 0.9); rim.position.set(-3, 2, -2); scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.1, 40), new THREE.MeshLambertMaterial({ color: '#26282f' }));
    disc.position.y = -0.05; scene.add(disc);
    await preloadAvatars(['boy', 'girl']); ready = true;
    if (pending !== undefined) { setAvatar(pending); pending = undefined; }
  }
  function setAvatar(av) {
    if (!ready) { pending = av; return; }
    if (ctrl) { scene.remove(ctrl.group); ctrl.dispose?.(); }
    ctrl = makeAvatar(av || {}); ctrl.setAnim('idle'); scene.add(ctrl.group);
  }
  function frame(now) {
    if (!running) return; requestAnimationFrame(frame);
    const c = renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    const dt = clock.getDelta();
    if (ctrl) { ctrl.update(dt); ctrl.group.rotation.y = settings.reduceMotion ? 0 : Math.sin(now / 1000 * 0.4) * 0.6; }
    renderer.render(scene, cam);
  }
  return {
    async start(canvas, av) { if (!renderer) await init(canvas); setAvatar(av); running = true; requestAnimationFrame(frame); },
    stop() { running = false; },
  };
})();

let pfName = null;
function setFollowBtn(following) {
  const fb = $('pf-follow');
  fb.classList.toggle('following', following);
  fb.textContent = following ? '✓ Following' : '+ Follow';
}
async function openProfile(name) {
  if (!name) return;
  $('profile-overlay').classList.remove('hidden');
  $('pf-games').innerHTML = ''; $('pf-name').textContent = name;
  let data;
  try { data = await api('/profile/' + encodeURIComponent(name) + '?viewer=' + encodeURIComponent(stateHub.me.name)); }
  catch { closeProfile(); return; }
  pfName = data.name;
  const nm = $('pf-name'); nm.innerHTML = '';
  const t = document.createElement('span'); t.textContent = data.name; nm.appendChild(t);
  applyNameCosmetic(t, data.nameColor, '');
  nm.insertAdjacentHTML('beforeend', badgeSvg(data.badge));
  const st = $('pf-status'); st.textContent = data.status && data.status !== 'offline' ? (data.status === 'hub' ? '🟢 Online' : '🎮 In a game') : (data.isUser ? '⚫ Offline' : '⭐ Creator');
  $('pf-followers').textContent = fmtNum(data.followers);
  $('pf-following').textContent = fmtNum(data.following);
  $('pf-visits').textContent = fmtNum(data.totalVisits);
  const fb = $('pf-follow');
  fb.classList.remove('hidden');
  if (data.isSelf) {
    fb.classList.add('following'); fb.textContent = '✏️ Edit Avatar';
    fb.onclick = () => { closeProfile(); selectTab('avatar'); };
  } else {
    setFollowBtn(data.isFollowing);
    fb.onclick = async () => {
      const willFollow = !fb.classList.contains('following');
      try {
        const r = await api(willFollow ? '/follow' : '/unfollow', { name: stateHub.me.name, target: pfName });
        if (r?.ok) { setFollowBtn(r.following); $('pf-followers').textContent = fmtNum(r.followers); (willFollow ? sfx.success : sfx.tap)(); }
      } catch (e) { toast(e.message, '⚠️'); }
    };
  }
  const frB = $('pf-friend');
  if (data.isSelf || !data.isUser) frB.classList.add('hidden');
  else {
    frB.classList.remove('hidden');
    const reopen = () => openProfile(pfName);
    if (data.isFriend) { frB.textContent = '✓ Friends'; frB.className = 'pf-fr is'; frB.onclick = async () => { await friendAction('/friends/remove', pfName, `Removed ${pfName}`, '👋'); reopen(); }; }
    else if (data.friendReqIncoming) { frB.textContent = '✓ Accept'; frB.className = 'pf-fr accept'; frB.onclick = async () => { await friendAction('/friends/accept', pfName, `You're now friends with ${pfName}!`, '🎉'); reopen(); }; }
    else if (data.friendReqSent) { frB.textContent = 'Requested'; frB.className = 'pf-fr'; frB.onclick = async () => { await friendAction('/friends/cancel', pfName, `Canceled request to ${pfName}`, '↩️'); reopen(); }; }
    else { frB.textContent = '+ Add Friend'; frB.className = 'pf-fr'; frB.onclick = async () => { await sendFriendReq(pfName); reopen(); }; }
  }
  const gh = $('pf-games');
  if (!data.games.length) gh.innerHTML = '<div class="empty-note">No experiences yet.</div>';
  else for (const g of data.games) {
    const th = themeOf(g.id), grad = `linear-gradient(150deg, ${th.from}, ${th.to})`;
    const card = document.createElement('button'); card.className = 'pf-game';
    const artBg = g.art ? `url('${g.art}') center/cover, ${grad}` : grad;
    card.innerHTML = `<span class="pf-game-art" style="background:${artBg}">${g.art ? '' : th.emoji}</span>` +
      `<span class="pf-game-info"><b>${escapeHtml(g.title)}</b><span class="pf-game-visits">${PC_ICON}${fmtNum(g.plays)} visits</span></span>`;
    card.addEventListener('click', () => { const gm = stateHub.games.find((x) => x.id === g.id); if (gm) { closeProfile(); openGameDetail(gm); } });
    gh.appendChild(card);
  }
  profileStage.start($('pf-canvas'), data.avatar);
  sfx.select();
}
function closeProfile() { $('profile-overlay').classList.add('hidden'); profileStage.stop(); }
$('pf-close')?.addEventListener('click', closeProfile);
$('profile-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'profile-overlay') closeProfile(); });

// ---------------- direct messages ----------------
let dmWith = null, dmPoll = null;
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd';
}
async function openDMs(withName) {
  $('dm-overlay').classList.remove('hidden');
  await loadDmInbox();
  if (withName) openThread(withName); else showDmList();
  sfx.select();
}
function closeDMs() { $('dm-overlay').classList.add('hidden'); clearInterval(dmPoll); dmPoll = null; dmWith = null; updateDmBadge(); }
function showDmList() {
  dmWith = null; clearInterval(dmPoll); dmPoll = null;
  $('dm-thread-view').classList.add('hidden'); $('dm-list').classList.remove('hidden');
  $('dm-back').classList.add('hidden'); $('dm-call').classList.add('hidden'); $('dm-title').textContent = 'Messages';
}
async function loadDmInbox() {
  try {
    const data = await api('/dm/inbox?name=' + encodeURIComponent(stateHub.me.name));
    const host = $('dm-list'); host.innerHTML = '';
    if (!data.conversations?.length) { host.innerHTML = '<div class="empty-note">No conversations yet. Message a friend to start one!</div>'; return; }
    for (const c of data.conversations) {
      const row = document.createElement('button'); row.className = 'dm-conv';
      const cv = document.createElement('canvas'); cv.width = cv.height = 84; thumbInto(cv, c);
      const mid = document.createElement('div'); mid.className = 'dm-conv-mid';
      const nm = document.createElement('span'); nm.className = 'dm-conv-name'; nm.textContent = c.name;
      applyNameCosmetic(nm, c.nameColor, '');
      const prev = document.createElement('span'); prev.className = 'dm-conv-prev';
      prev.textContent = c.last ? (c.last.from === stateHub.me.name.toLowerCase() ? 'You: ' : '') + c.last.text : 'Say hi 👋';
      mid.append(nm, prev);
      const right = document.createElement('div'); right.className = 'dm-conv-right';
      right.innerHTML = `<span class="dm-time">${c.last ? timeAgo(c.last.ts) : ''}</span>` + (c.unread ? `<span class="dm-unread">${c.unread}</span>` : '');
      row.append(cv, mid, right);
      row.addEventListener('click', () => openThread(c.name));
      host.appendChild(row);
    }
  } catch (e) { toast(e.message, '⚠️'); }
}
async function openThread(name) {
  dmWith = name;
  $('dm-list').classList.add('hidden'); $('dm-thread-view').classList.remove('hidden');
  $('dm-back').classList.remove('hidden'); $('dm-title').textContent = name;
  $('dm-call').classList.remove('hidden');
  syncDmCallUi();
  await refreshThread();
  $('dm-input').focus();
  clearInterval(dmPoll); dmPoll = setInterval(refreshThread, 3000);
}

// beta gate for RBLXS Maps: the toggle only flips after this is acknowledged
function rblxsWarning() {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'rw-overlay';
    ov.innerHTML = `<div class="rw-card">
      <div class="rw-title">!WARNING!</div>
      <p><b>RBLXS Maps is a beta experiment.</b> Maps imported from Roblox Studio can be unstable — broken collision, flattened rotations, missing triggers, or a Playground that fails to load.</p>
      <p>If things break, turn this off and the regular map comes back. Nothing is lost.</p>
      <div class="rw-btns">
        <button class="rw-ok">I understand — turn it on</button>
        <button class="rw-no">Cancel</button>
      </div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('.rw-ok').addEventListener('click', () => { ov.remove(); resolve(true); });
    ov.querySelector('.rw-no').addEventListener('click', () => { ov.remove(); resolve(false); });
  });
}

// ---------------- DM voice calls ----------------
// Both people tap 📞 in the same chat to connect (P2P audio via /voice-ws).
// Starting a call drops a line in the chat so the other person knows to join.
let dmVc = null, dmVcWith = null;
const dmRoom = (a, b) => 'dm:' + [a, b].map((n) => n.toLowerCase().replace(/[^a-z0-9_-]/g, '-')).sort().join('|');
function endDmCall() {
  dmVc?.destroy(); dmVc = null; dmVcWith = null;
  syncDmCallUi();
}
async function startDmCall() {
  if (!dmWith) return;
  if (dmVc && dmVcWith === dmWith) return;   // already in this call — controls are in the bar
  endDmCall();
  const withName = dmWith;
  const vc = initVoice({ room: dmRoom(stateHub.me.name, withName), chip: false });
  dmVc = vc; dmVcWith = withName;
  vc.onUpdate(syncDmCallUi);
  await vc.join();
  if (!vc.joined) { if (dmVc === vc) endDmCall(); return; }   // mic denied
  syncDmCallUi();
  // if nobody's there yet after a moment, leave them a note in the chat
  setTimeout(() => {
    if (dmVc === vc && vc.joined && !vc.peers.length) {
      api('/dm/send', { name: stateHub.me.name, to: withName, text: '📞 Voice call started — open this chat and tap 📞 to join!' })
        .then((d) => { if (dmWith === withName) renderMessages(d.messages || []); }).catch(() => {});
    }
  }, 1500);
}
function syncDmCallUi() {
  const inThisCall = !!(dmVc && dmVc.joined && dmVcWith === dmWith);
  $('dm-call').classList.toggle('oncall', inThisCall);
  $('dm-callbar').classList.toggle('hidden', !inThisCall);
  if (inThisCall) {
    const peers = dmVc.peers;
    $('dm-call-status').textContent = peers.length ? `📞 In call with ${peers.join(', ')}` : '📞 Calling… waiting for them to join';
    $('dm-call-mute').textContent = dmVc.muted ? 'Unmute' : 'Mute';
    $('dm-call-mute').classList.toggle('muted', dmVc.muted);
  }
}
$('dm-call').addEventListener('click', startDmCall);
$('dm-call-mute').addEventListener('click', () => { dmVc?.toggleMute(); });
$('dm-call-end').addEventListener('click', endDmCall);
async function refreshThread() {
  if (!dmWith) return;
  try {
    const data = await api(`/dm/thread?name=${encodeURIComponent(stateHub.me.name)}&with=${encodeURIComponent(dmWith)}`);
    renderMessages(data.messages || []);
  } catch (e) { /* transient */ }
}
function renderMessages(msgs) {
  const host = $('dm-messages'); const meLower = stateHub.me.name.toLowerCase();
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 60;
  host.innerHTML = '';
  for (const m of msgs) {
    const b = document.createElement('div');
    b.className = 'dm-msg' + (m.from === meLower ? ' me' : '');
    b.innerHTML = `<span class="dm-bubble"></span>`;
    b.querySelector('.dm-bubble').textContent = m.text;
    host.appendChild(b);
  }
  if (atBottom || true) host.scrollTop = host.scrollHeight;
}
async function sendDm() {
  const inp = $('dm-input'); const text = inp.value.trim();
  if (!text || !dmWith) return;
  inp.value = '';
  try {
    const data = await api('/dm/send', { name: stateHub.me.name, to: dmWith, text });
    renderMessages(data.messages || []); sfx.tap();
  } catch (e) { toast(e.message, '⚠️'); inp.value = text; }
}
async function updateDmBadge() {
  try {
    const data = await api('/dm/inbox?name=' + encodeURIComponent(stateHub.me.name));
    const badge = $('dm-badge');
    if (data.unread > 0) { badge.textContent = data.unread > 99 ? '99+' : data.unread; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch {}
}
$('dm-btn').addEventListener('click', () => openDMs());
$('dm-close').addEventListener('click', closeDMs);
$('dm-back').addEventListener('click', () => { showDmList(); loadDmInbox(); });
$('dm-send').addEventListener('click', sendDm);
$('dm-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendDm(); });
$('dm-overlay').addEventListener('click', (e) => { if (e.target.id === 'dm-overlay') closeDMs(); });

// ---------------- connect tab ----------------
function personRow(person, mode) {
  const row = document.createElement('div');
  row.className = 'person-row';
  const cv = document.createElement('canvas'); cv.width = cv.height = 84; thumbInto(cv, person);
  const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = person.name;
  nm.style.cursor = 'pointer'; nm.title = 'View profile';
  nm.addEventListener('click', () => openProfile(person.name));
  if (person.badge) nm.insertAdjacentHTML('beforeend', badgeSvg(person.badge));
  const st = document.createElement('span');
  st.className = 'pstatus ' + (person.status === 'hub' ? 'hub' : person.status.startsWith('game') ? 'game' : '');
  st.textContent = statusText(person.status);
  row.append(cv, nm, st);
  applyNameCosmetic(nm, person.nameColor, person.title);
  if (person.status.startsWith('game')) {
    const join = document.createElement('button'); join.className = 'join'; join.textContent = 'Join';
    join.addEventListener('click', () => launchGame(person.status.split(':')[1] || 'feather-friends'));
    row.appendChild(join);
  }
  const mkBtn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', fn); row.appendChild(b); return b; };
  if (mode === 'friend') {
    const msg = document.createElement('button'); msg.className = 'dm-open'; msg.textContent = '💬 Message';
    msg.addEventListener('click', () => openDMs(person.name));
    row.appendChild(msg);
    mkBtn('Remove', '', () => friendAction('/friends/remove', person.name, `Removed ${person.name}`, '👋'));
  } else if (mode === 'request') {
    mkBtn('✓ Accept', 'accept', () => friendAction('/friends/accept', person.name, `You're now friends with ${person.name}!`, '🎉'));
    mkBtn('Decline', 'decline', () => friendAction('/friends/decline', person.name, `Declined ${person.name}`, '✖'));
  } else {
    if ((stateHub.sent || []).includes(person.name.toLowerCase()))
      mkBtn('Requested', 'requested', () => friendAction('/friends/cancel', person.name, `Canceled request to ${person.name}`, '↩️'));
    else mkBtn('Add Friend', '', () => sendFriendReq(person.name));
  }
  return row;
}
async function sendFriendReq(friend) {
  try {
    const r = await api('/friends/add', { name: stateHub.me.name, friend });
    if (r?.state === 'friends') { sfx.success(); toast(`You're now friends with ${friend}!`, '🎉'); }
    else { sfx.tap(); toast(`Friend request sent to ${friend}`, '📨'); }
    refreshSocial(); return r;
  } catch (e) { toast(e.message, '⚠️'); }
}
async function friendAction(path, friend, msg, emoji) {
  try { await api(path, { name: stateHub.me.name, friend }); sfx.tap(); toast(msg, emoji); refreshSocial(); }
  catch (e) { toast(e.message, '⚠️'); }
}
function renderConnect() {
  const fl = $('friend-list'); fl.innerHTML = '';
  const reqs = stateHub.requestsIn || [];
  if (reqs.length) {
    const h = document.createElement('div'); h.className = 'req-header'; h.textContent = `📨 Friend Requests · ${reqs.length}`;
    fl.appendChild(h);
    for (const r of reqs) fl.appendChild(personRow(r, 'request'));
    const h2 = document.createElement('div'); h2.className = 'req-header'; h2.textContent = 'Friends'; fl.appendChild(h2);
  }
  if (!stateHub.friends.length) fl.insertAdjacentHTML('beforeend', '<div class="empty-note">No friends yet. Send someone a request below!</div>');
  for (const f of stateHub.friends) fl.appendChild(personRow(f, 'friend'));
  const ol = $('online-list'); ol.innerHTML = '';
  if (!stateHub.online.length) ol.innerHTML = '<div class="empty-note">Nobody else is online right now.</div>';
  for (const p of stateHub.online) ol.appendChild(personRow(p, 'online'));
}
$('add-btn').addEventListener('click', async () => {
  const friend = $('add-input').value.trim();
  if (!friend) return;
  const r = await sendFriendReq(friend);
  if (r) $('add-input').value = '';
});
$('add-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('add-btn').click(); });

// ---- player directory: a live-search dropdown of everyone on the platform ----
{
  const input = $('add-input');
  const wrap = input.parentElement;
  wrap.style.position = 'relative';
  const drop = document.createElement('div');
  drop.id = 'user-drop';
  drop.className = 'hidden';
  wrap.appendChild(drop);
  let timer = null;
  const esc = (x) => String(x).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const search = async () => {
    try {
      const data = await api('/users?q=' + encodeURIComponent(input.value.trim()));
      const rows = (data.users || []).filter((u) => u.name.toLowerCase() !== stateHub.me.name.toLowerCase());
      if (!rows.length) { drop.classList.add('hidden'); return; }
      drop.innerHTML = rows.map((u) => `
        <button class="ud-row" data-n="${esc(u.name)}">
          <span class="ud-dot${u.online ? ' on' : ''}"></span>
          <span class="ud-name">${esc(u.name)}</span>
          ${u.badge === 'owner' ? '<span class="ud-badge">👑</span>' : u.badge === 'verified' ? '<span class="ud-badge">✔️</span>' : ''}
          ${u.banned ? '<span class="ud-badge" title="banned">🔨</span>' : ''}
        </button>`).join('') + `<div class="ud-total">${data.total} player${data.total === 1 ? '' : 's'} on ClaudeBox</div>`;
      drop.classList.remove('hidden');
      drop.querySelectorAll('.ud-row').forEach((b) => b.addEventListener('click', () => {
        input.value = b.dataset.n;
        drop.classList.add('hidden');
        openProfile(b.dataset.n);
      }));
    } catch {}
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 200); });
  input.addEventListener('focus', search);
  document.addEventListener('click', (e) => {
    if (!drop.contains(e.target) && e.target !== input) drop.classList.add('hidden');
  });
}

// ---------------- avatar editor (Roblox-style) ----------------
// Laid out like the real Avatar Editor: the character on the left over a warm
// stage, a row of category tabs on the right whose submenus drop out beneath
// them, and a grid of rendered item cards under a breadcrumb.
//
// The catalogue underneath is still ClaudeBox's own, so the tab tree maps our
// slots onto Roblox's shape rather than inventing categories we cannot fill.
const cloth = (cat) => CLOTHING[cat].map((i) => [i.id, `${i.emoji} ${i.label}`]);

const PALETTE = [
  '#ffffff', '#d7dce3', '#8b93a1', '#3a3f4a', '#15171c',
  '#e0453a', '#ff7a45', '#f0c23c', '#ffe14a', '#7bc043',
  '#2fa84f', '#19a3d6', '#2f6fd0', '#3b2c7a', '#8a4fd6',
  '#e05aa8', '#c98e62', '#8a6242', '#5a3d22', '#2b1c12',
];
const SKIN_TONES = ['#f5d3b3', '#e8b48a', '#c98e62', '#9a6844', '#6e4a30', '#54382a'];

// A page is one grid: either a clothing slot, a colour swatch set, or a choice.
// `frame` decides how its thumbnails are photographed.
const PAGES = {
  bodytype:  { title: 'Body', crumb: ['Body', 'Body Type'], kind: 'choice', key: 'body', frame: 'full',
               values: [['boy', 'Boy'], ['girl', 'Girl'], ['r6', 'R6 Classic'], ['steven', 'Steven']] },
  anims:     { title: 'Animation Packs', crumb: ['Avatars', 'Animations'], kind: 'choice', key: 'animPack', frame: 'full',
               values: [['none', 'Default'], ['girljump', 'Girl Jump Anim'], ['steven', 'Steven Animation Pack']] },
  mcskin:    { title: 'Minecraft Skin', crumb: ['Body', 'Minecraft Skin'], kind: 'skin' },
  skin:      { title: 'Skin Tone', crumb: ['Body', 'Skin Tone'], kind: 'swatch', key: 'skin', list: SKIN_TONES },
  hair:      { title: 'Hair', crumb: ['Body', 'Hair'], kind: 'item', cat: 'hair', key: 'hair',
               color: 'hairColor', color2: 'hairColor2', frame: 'head' },
  face:      { title: 'Expression', crumb: ['Makeup', 'Face'], kind: 'choice', key: 'face', frame: 'face',
               values: [['happy', 'Happy'], ['cool', 'Cool'], ['surprised', 'Surprised'], ['sleepy', 'Sleepy']] },
  faceacc:   { title: 'Eyes', crumb: ['Makeup', 'Eyes'], kind: 'item', cat: 'faces', key: 'face2',
               color: 'faceColor', color2: 'faceColor2', frame: 'face' },
  shirts:    { title: 'T-Shirts', crumb: ['Clothing', 'Tops', 'T-Shirts'], kind: 'item', cat: 'shirts', key: 'shirt',
               color: 'shirtColor', color2: 'shirtColor2', frame: 'torso' },
  pants:     { title: 'Pants', crumb: ['Clothing', 'Bottoms', 'Pants'], kind: 'swatch', key: 'pantsColor', list: PALETTE },
  shoes:     { title: 'Shoes', crumb: ['Clothing', 'Shoes'], kind: 'item', cat: 'shoes', key: 'shoes',
               color: 'shoeColor', color2: 'shoeColor2', frame: 'feet' },
  hats:      { title: 'Hats', crumb: ['Accessories', 'Hats'], kind: 'item', cat: 'hats', key: 'hat',
               color: 'hatColor', color2: 'hatColor2', frame: 'head' },
  back:      { title: 'Back', crumb: ['Accessories', 'Back'], kind: 'item', cat: 'backs', key: 'back',
               color: 'backColor', color2: 'backColor2', frame: 'back' },
  swim:      { title: 'Swimwear', crumb: ['Clothing', 'Swimwear'], kind: 'item', cat: 'suits', key: 'suit',
               color: 'suitColor', color2: 'suitColor2', frame: 'torso' },
  recent:    { title: 'Recently Added', crumb: ['Recent', 'Recently Added'], kind: 'recent', frame: 'full' },
  r6:        { title: 'R6 Colours', crumb: ['Body', 'R6 Parts'], kind: 'r6' },
};

// The tab strip, and what drops out of each tab.
const TABS = [
  { id: 'recent', label: 'Recent', page: 'recent' },
  { id: 'avatars', label: 'Avatars', groups: [
      ['Bodies', [['bodytype', 'Body Type']]],
      ['Animations', [['anims', 'Animation Packs']]],
    ] },
  { id: 'body', label: 'Body', groups: [
      ['Body', [['bodytype', 'Body Type'], ['skin', 'Skin Tone']]],
      ['Hair', [['hair', 'Hair']]],
      ['Classic', [['r6', 'R6 Parts']]],
      ['Minecraft', [['mcskin', 'Minecraft Skin']]],
    ] },
  { id: 'makeup', label: 'Makeup', groups: [
      ['Looks', [['face', 'Face']]],
      ['Eyes', [['faceacc', 'Eyewear']]],
    ] },
  { id: 'clothing', label: 'Clothing', groups: [
      ['Tops', [['shirts', 'T-Shirts']]],
      ['Bottoms', [['pants', 'Pants']]],
      ['Shoes', [['shoes', 'Shoes']]],
      ['Swim', [['swim', 'Swimwear']]],
    ] },
  { id: 'accessories', label: 'Accessories', groups: [
      ['Head', [['hats', 'Hats']]],
      ['Back', [['back', 'Back']]],
    ] },
];

const CAT_OF = { hair: 'hair', hat: 'hats', back: 'backs', face2: 'faces', suit: 'suits', shoes: 'shoes', shirt: 'shirts' };
// mirrors FREE_AVATAR on the server — a paid slot the player has not bought
// still shows, but wearing it is what the Marketplace is for
const FREE_AV = { hat: ['none', 'cap', 'beanie'], back: ['none', 'backpack'], face2: ['none', 'glasses'], suit: ['none', 'swim'],
  body: ['boy', 'girl', 'r6'], animPack: ['none'] };

const avatarEditor = (() => {
  let renderer = null, scene, cam, ctrl = null, running = false, ready = false;
  let page = 'recent', openTab = null, dirty = false, spin = true;
  const clock = new THREE.Clock();
  const view = { yaw: 0, dist: 3.6, drag: null };

  const av = () => stateHub.me.avatar;
  function markDirty() { dirty = true; $('avatar-save')?.classList.add('dirty'); }
  function markClean() { dirty = false; $('avatar-save')?.classList.remove('dirty'); }

  function rebuild() {
    if (!scene || !ready) return;
    if (ctrl) { scene.remove(ctrl.group); ctrl.dispose?.(); }
    ctrl = makeAvatar(av());
    ctrl.setAnim('idle');
    scene.add(ctrl.group);
  }

  async function init() {
    buildTabs(); showPage('recent');
    const canvas = $('avatar-canvas');
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    scene.add(new THREE.AmbientLight('#fff3e0', 2.0));
    const key = new THREE.DirectionalLight('#fff6e6', 2.1); key.position.set(2, 4, 4); scene.add(key);
    const rim = new THREE.DirectionalLight('#ffd9a0', 1.0); rim.position.set(-3, 2, -2); scene.add(rim);
    bindStage(canvas);
    await preloadAvatars(['boy', 'girl', 'r6']);
    ready = true; rebuild();
  }

  function bindStage(canvas) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { view.drag = { x: e.clientX, yaw: view.yaw }; spin = false; canvas.setPointerCapture?.(e.pointerId); });
    addEventListener('pointerup', () => { view.drag = null; });
    addEventListener('pointermove', (e) => { if (view.drag) view.yaw = view.drag.yaw + (e.clientX - view.drag.x) * 0.011; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = Math.max(2.2, Math.min(7, view.dist + e.deltaY * 0.004)); }, { passive: false });
    $('av-view').addEventListener('click', () => { spin = !spin; $('av-view').textContent = spin ? '3D' : '2D'; });
    $('av-redraw').addEventListener('click', () => { rebuild(); toast('Avatar redrawn', '🔄'); });
    $('av-getmore').addEventListener('click', () => selectTab('store'));
    $('avatar-save').addEventListener('click', save);
    const bt = $('av-bodytype');
    bt.value = av().bodyType ?? 0;
    $('av-bt-val').textContent = `${bt.value}%`;
    bt.addEventListener('input', () => {
      $('av-bt-val').textContent = `${bt.value}%`;
      av().bodyType = +bt.value; markDirty();
    });
  }

  async function save() {
    try {
      const { avatar } = await api('/avatar', { name: stateHub.me.name, avatar: av() });
      stateHub.me.avatar = avatar; thumbInto($('me-thumb'), stateHub.me);
      markClean(); sfx.success(); toast('Avatar saved!', '✨');
      showPage(page);
    } catch (e) { toast(e.message, '⚠️'); }
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const canvas = renderer.domElement, w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    const dt = clock.getDelta();
    if (ctrl) {
      ctrl.update(dt);
      const yaw = spin && !settings.reduceMotion ? Math.sin(now / 1000 * 0.35) * 0.55 : view.yaw;
      ctrl.group.rotation.y = yaw;
    }
    cam.position.set(0, 1.35, view.dist);
    cam.lookAt(0, 0.95, 0);
    renderer.render(scene, cam);
  }

  // ---- tabs + flyouts ----
  function buildTabs() {
    const host = $('av-tabs'); host.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.className = 'rbx-tab';
      b.innerHTML = `${t.label}${t.groups ? ' <span class="car">▾</span>' : ''}`;
      b.addEventListener('click', () => {
        if (!t.groups) { closeFlyout(); showPage(t.page); return; }
        openTab === t.id ? closeFlyout() : openFlyout(t);
      });
      host.appendChild(b);
    }
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.rbx-tabs') && !e.target.closest('.rbx-flyout')) closeFlyout();
    });
  }
  function closeFlyout() { openTab = null; $('av-flyout').classList.add('hidden'); paintTabs(); }
  function openFlyout(t) {
    openTab = t.id;
    const fly = $('av-flyout');
    fly.innerHTML = t.groups.map(([label, items]) => `
      <div class="rbx-fly-row">
        <div class="rbx-fly-lab">${label}</div>
        <div class="rbx-fly-items">${items.map(([id, name]) =>
          `<button data-page="${id}" class="${page === id ? 'on' : ''}">${name}</button>`).join('')}</div>
      </div>`).join('');
    fly.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      showPage(b.dataset.page); closeFlyout(); sfx.tap();
    }));
    fly.classList.remove('hidden');
    paintTabs();
  }
  function paintTabs() {
    const owner = TABS.find((t) => t.page === page || t.groups?.some(([, its]) => its.some(([id]) => id === page)));
    [...$('av-tabs').children].forEach((b, i) => {
      b.classList.toggle('on', TABS[i] === owner);
      b.classList.toggle('open', TABS[i].id === openTab);
    });
  }

  // ---- the grid ----
  function unlocked(slot) {
    const free = FREE_AV[slot];
    if (!free) return null;
    const set = new Set(free);
    const owned = new Set(wallet().ownedAvatar || []);
    for (const it of AVATAR_SHOP) if (it.slot === slot && owned.has(it.id)) set.add(it.value);
    return set;
  }

  function card({ label, on, locked, onClick, thumbKey, thumbProfile, frameKind, emoji, pose }) {
    const b = document.createElement('button');
    b.className = 'rbx-card' + (on ? ' on' : '');
    b.innerHTML = `<div class="rbx-thumb">${emoji ? `<span class="emoji">${emoji}</span>` : ''}${on ? '<span class="rbx-tick">✓</span>' : ''}</div>
      <div class="rbx-name">${label}</div>${locked ? '<div class="rbx-price locked">Locked</div>' : ''}`;
    if (thumbProfile) lazyThumb(b.querySelector('.rbx-thumb'), thumbKey, thumbProfile, frameKind, pose);
    b.addEventListener('click', onClick);
    return b;
  }

  // The Minecraft skin picker, used both on its own page and directly under the
  // skin-tone swatches — which is where someone choosing a skin colour would
  // reasonably expect to find it.
  function skinUploadUI(a, pageId, full) {
    const owns = (unlocked('body') || new Set()).has('steven');
    const wrap = document.createElement('div');
    wrap.className = 'rbx-skinblock';
    const row = document.createElement('div'); row.className = 'rbx-skinrow';
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png,image/jpeg';
    const pick = document.createElement('button');
    pick.className = 'rbx-dark-btn';
    pick.textContent = a.stevenSkin ? 'Change Minecraft skin' : 'Select a Minecraft skin file';
    pick.addEventListener('click', () => inp.click());
    row.appendChild(pick);
    if (a.stevenSkin) {
      const clear = document.createElement('button');
      clear.className = 'rbx-ghost-btn';
      clear.textContent = 'Use my clothing instead';
      clear.addEventListener('click', () => { delete a.stevenSkin; markDirty(); rebuild(); showPage(pageId); });
      row.appendChild(clear);
    }
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 16000) { toast('That file is too big for a skin — a 64×64 PNG is about 2 kB', '⚠️'); return; }
      const fr = new FileReader();
      fr.onload = () => {
        a.stevenSkin = String(fr.result);
        if (a.body !== 'steven' && owns) a.body = 'steven';   // a skin is useless on any other body
        markDirty(); rebuild(); showPage(pageId);
        toast(owns ? 'Skin applied' : 'Skin saved — buy Steven to wear it', '🧱');
      };
      fr.readAsDataURL(f);
    });
    row.appendChild(inp);
    wrap.appendChild(row);

    // Slim arms — the Alex build. Skins are drawn for one or the other, and a
    // slim skin on a classic body stretches its arm textures, so this is a
    // property of the wearer rather than something we can read off the file.
    const tog = document.createElement('button');
    tog.className = 'rbx-toggle' + (a.slimArms ? ' on' : '');
    tog.type = 'button';
    tog.setAttribute('role', 'switch');
    tog.setAttribute('aria-checked', a.slimArms ? 'true' : 'false');
    tog.innerHTML = `<i></i><span>Slim arms<small>3-pixel arms, for Alex-style skins</small></span>`;
    tog.addEventListener('click', () => {
      a.slimArms = !a.slimArms;
      markDirty(); rebuild(); showPage(pageId); sfx.tap();
    });
    wrap.appendChild(tog);
    if (a.stevenSkin) {
      const prev = document.createElement('div');
      prev.className = 'rbx-skinprev';
      // A skin that will not decode should say so rather than leaving a broken
      // image icon sitting in the editor.
      const img = document.createElement('img');
      img.alt = 'your skin';
      const cap = document.createElement('span');
      cap.textContent = `Current skin${a.body === 'steven' ? '' : ' — worn on Steven only'}`;
      img.addEventListener('error', () => {
        prev.classList.add('bad');
        cap.textContent = "That skin file could not be read — pick another";
        img.remove();
      });
      img.src = a.stevenSkin;
      prev.appendChild(img); prev.appendChild(cap);
      wrap.appendChild(prev);
    }
    if (!owns && full) {
      const buy = document.createElement('button');
      buy.className = 'rbx-ghost-btn'; buy.textContent = 'Get Steven in the Marketplace';
      buy.addEventListener('click', () => selectTab('store'));
      wrap.appendChild(buy);
    }
    return wrap;
  }

  function showPage(id) {
    page = id;
    const def = PAGES[id] || PAGES.recent;
    $('av-crumb').innerHTML = def.crumb.map((c, i, a) =>
      i === a.length - 1 ? `<b>${c}</b>` : `${c}<span>›</span>`).join('');
    const grid = $('av-grid');
    grid.innerHTML = '';
    grid.className = def.kind === 'swatch' || def.kind === 'r6' ? 'rbx-swatches' : 'rbx-grid';
    const a = av();

    if (def.kind === 'swatch') {
      for (const col of def.list) {
        const sw = document.createElement('button');
        sw.className = 'rbx-sw' + (a[def.key] === col ? ' on' : '');
        sw.style.background = col;
        sw.addEventListener('click', () => { a[def.key] = col; markDirty(); rebuild(); showPage(id); sfx.tap(); });
        grid.appendChild(sw);
      }
      const ci = document.createElement('input');
      ci.type = 'color'; ci.value = a[def.key] || '#888888';
      ci.addEventListener('input', () => { a[def.key] = ci.value; markDirty(); rebuild(); });
      grid.appendChild(ci);
      // Skin tone is where you would look for "what colour am I", so the
      // Minecraft skin file picker sits directly underneath it.
      if (def.key === 'skin') grid.appendChild(skinUploadUI(a, id, false));
      paintTabs(); return;
    }

    if (def.kind === 'r6') {
      const r6 = a.r6 = { head: '#f5cd30', torso: '#0f6cbd', armL: '#f5cd30', armR: '#f5cd30', legL: '#3aa03a', legR: '#3aa03a', ...(a.r6 || {}) };
      for (const [k, lab] of [['head', 'Head'], ['torso', 'Torso'], ['armL', 'L Arm'], ['armR', 'R Arm'], ['legL', 'L Leg'], ['legR', 'R Leg']]) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;font-size:12px;font-weight:700;';
        const ci = document.createElement('input');
        ci.type = 'color'; ci.value = r6[k];
        ci.addEventListener('input', () => { r6[k] = ci.value; markDirty(); rebuild(); });
        wrap.appendChild(ci); wrap.appendChild(document.createTextNode(lab));
        grid.appendChild(wrap);
      }
      paintTabs(); return;
    }

    if (def.kind === 'choice') {
      const allowC = unlocked(def.key);
      for (const [value, label] of def.values) {
        const locked = allowC ? !allowC.has(value) : false;
        grid.appendChild(card({
          label, on: (a[def.key] || def.values[0][0]) === value, locked,
          thumbKey: `${def.key}:${value}:${a.body}`,
          thumbProfile: { ...a, [def.key]: value },
          frameKind: def.frame,
          pose: def.key === 'animPack' ? ({ girljump: 'jump', steven: 'walk' }[value] || 'idle') : 'idle',
          onClick: () => {
            if (locked) { sfx.tap(); toast('Buy this in the Marketplace to use it', '🔒'); selectTab('store'); return; }
            a[def.key] = value; markDirty(); rebuild(); showPage(id); sfx.tap();
          },
        }));
      }
      paintTabs(); return;
    }

    // ---- uploading a Minecraft skin ----
    if (def.kind === 'skin') {
      grid.className = 'rbx-skinpage';
      grid.innerHTML = `
        <p class="rbx-note">Drop in a Minecraft skin PNG (64&times;64) and it is mapped onto Steven —
        head, body, arms and legs, plus the overlay layer. Skins only apply to the
        <b>Steven</b> body; on any other body they are kept but not shown.</p>`;
      grid.appendChild(skinUploadUI(a, id, true));
      paintTabs(); return;
    }

    if (def.kind === 'recent') {
      // a mixed shelf, the way the real editor opens on "Recently Added"
      const picks = [
        ['bodytype', 'Body Type'], ['hair', 'Hair'], ['shirts', 'T-Shirts'],
        ['hats', 'Hats'], ['shoes', 'Shoes'], ['back', 'Back'], ['faceacc', 'Eyewear'], ['face', 'Face'],
      ];
      for (const [pid, label] of picks) {
        const p = PAGES[pid];
        grid.appendChild(card({
          label, on: false, emoji: '',
          thumbKey: `page:${pid}:${JSON.stringify(a).length}`,
          thumbProfile: { ...a },
          frameKind: p.frame,
          onClick: () => { showPage(pid); sfx.tap(); },
        }));
      }
      paintTabs(); return;
    }

    // ---- an item slot ----
    const allow = unlocked(def.key);
    const items = CLOTHING[def.cat] || [];
    for (const it of items) {
      const locked = allow ? !allow.has(it.id) : false;
      const on = (a[def.key] || 'none') === it.id;
      grid.appendChild(card({
        label: it.label, on, locked,
        emoji: it.id === 'none' ? '🚫' : '',
        thumbKey: `${def.cat}:${it.id}:${a.body}:${a[def.color] || ''}:${a[def.color2] || ''}`,
        thumbProfile: it.id === 'none' ? null : {
          body: a.body, skin: a.skin,
          [def.key]: it.id,
          ...(def.color ? { [def.color]: a[def.color] || it.pri } : {}),
          ...(def.color2 ? { [def.color2]: a[def.color2] } : {}),
        },
        frameKind: def.frame,
        onClick: () => {
          if (locked) { sfx.tap(); toast('Buy this in the Marketplace to wear it', '🔒'); selectTab('store'); return; }
          a[def.key] = it.id;
          if (it.pri && def.color) { a[def.color] = it.pri; if (def.color2) a[def.color2] = it.sec; }
          markDirty(); rebuild(); showPage(id); sfx.tap();
        },
      }));
    }
    // the two colours for whatever is worn, shown under the grid
    if (def.color && (a[def.key] || 'none') !== 'none') {
      const worn = (CLOTHING[def.cat] || []).find((i) => i.id === a[def.key]);
      const bar = document.createElement('div');
      bar.style.cssText = 'grid-column:1/-1;display:flex;gap:26px;flex-wrap:wrap;margin-top:8px';
      const mk = (title, field, fallback) => {
        const col = document.createElement('div');
        col.innerHTML = `<div style="font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;margin-bottom:7px">${title}</div>`;
        const row = document.createElement('div'); row.className = 'rbx-swatches';
        for (const c of PALETTE) {
          const sw = document.createElement('button');
          sw.className = 'rbx-sw' + ((a[field] || fallback) === c ? ' on' : '');
          sw.style.background = c; sw.style.width = sw.style.height = '30px';
          sw.addEventListener('click', () => { a[field] = c; markDirty(); rebuild(); showPage(id); });
          row.appendChild(sw);
        }
        const ci = document.createElement('input');
        ci.type = 'color'; ci.value = a[field] || fallback || '#888888';
        ci.style.width = ci.style.height = '30px';
        ci.addEventListener('input', () => { a[field] = ci.value; markDirty(); rebuild(); });
        row.appendChild(ci);
        col.appendChild(row); return col;
      };
      bar.appendChild(mk('Colour', def.color, worn?.pri));
      if (def.color2) bar.appendChild(mk('Accent', def.color2, worn?.sec));
      grid.appendChild(bar);
    }
    paintTabs();
  }

  return {
    async start() {
      if (!stateHub.me) return;
      if (!renderer && !ready) await init();
      if (renderer && !running) { running = true; clock.getDelta(); requestAnimationFrame(frame); }
    },
    stop() { running = false; },
    refresh() { if (ready) { rebuild(); showPage(page); } },
  };
})();

// ---------------- profile picture ----------------
function editProfilePicture() {
  openPfpEditor(stateHub.me, async (pfp) => {
    const d = await api('/pfp', { name: stateHub.me.name, pfp });
    if (!d.ok) throw new Error(d.error || 'could not save');
    stateHub.me.pfp = d.pfp;
    thumbInto($('me-thumb'), stateHub.me);
    renderFriends();
    syncRbxUi();
    sfx.success();
    toast('Profile picture updated', '\u{1F5BC}\uFE0F');
  });
}

// ---------------- rewards: wallet, challenges, shop ----------------
const wallet = () => stateHub.me?.wallet || { stars: 0, cubes: 0, challenges: {}, owned: [], title: '', nameColor: '' };
let convAmount = 1;

// apply an owned name colour + title badge to a name element
function applyNameCosmetic(nameEl, nameColor, title) {
  if (!nameEl) return;
  nameEl.classList.remove('name-rainbow');
  nameEl.style.color = '';
  if (nameColor === 'rainbow') nameEl.classList.add('name-rainbow');
  else if (nameColor) nameEl.style.color = nameColor;
  // title badge: a sibling right after the name
  const next = nameEl.nextElementSibling;
  if (next && next.classList.contains('title-badge')) next.remove();
  if (title) {
    const b = document.createElement('span');
    b.className = 'title-badge';
    b.textContent = title;
    nameEl.after(b);
  }
}

function updateWalletChip(flash) {
  const w = wallet();
  const s = $('wc-stars'), c = $('wc-cubes');
  if (s) s.textContent = w.stars;
  if (c) c.textContent = w.cubes;
  if (flash) { [s, c].forEach((el) => { el?.classList.remove('flash'); void el?.offsetWidth; el?.classList.add('flash'); }); }
  // cosmetics on the top-right chip name
  applyNameCosmetic($('me-name'), w.nameColor, w.title);
}

const gameTitleOf = (id) => stateHub.games.find((g) => g.id === id)?.title || id;

function renderChallenges() {
  const host = $('challenge-list');
  if (!host) return;
  const w = wallet();
  const done = w.challenges || {};
  const total = CHALLENGES.length;
  const doneCount = CHALLENGES.filter((c) => done[c.id]).length;
  $('challenge-progress').textContent = `${doneCount}/${total} complete`;
  // group by game, in games order
  const byGame = new Map();
  for (const c of CHALLENGES) { if (!byGame.has(c.game)) byGame.set(c.game, []); byGame.get(c.game).push(c); }
  host.innerHTML = '';
  for (const [game, list] of byGame) {
    const dc = list.filter((c) => done[c.id]).length;
    const group = document.createElement('div');
    group.className = 'chal-group';
    group.innerHTML = `<div class="chal-game-head">${gameTitleOf(game)} <span class="cgh-count">${dc}/${list.length}</span></div><div class="chal-grid"></div>`;
    const grid = group.querySelector('.chal-grid');
    for (const c of list) {
      const isDone = !!done[c.id];
      const card = document.createElement('div');
      card.className = 'chal-card' + (isDone ? ' done' : '');
      card.innerHTML =
        `<span class="chal-emoji">${c.emoji}</span>` +
        `<div class="chal-body"><div class="ct"></div><div class="ch"></div></div>` +
        `<div class="chal-reward">${isDone ? '<span class="cr-done">✓ Done</span>' : `<span class="cr-stars">+${c.stars} <img class="cur-ico" src="/icons/credits.svg" alt=""></span>`}</div>`;
      card.querySelector('.ct').textContent = c.title;
      card.querySelector('.ch').textContent = c.hint;
      grid.appendChild(card);
    }
    host.appendChild(group);
  }
}

function renderShop() {
  const host = $('shop-grid');
  if (!host) return;
  const w = wallet();
  host.innerHTML = '';
  for (const item of SHOP) {
    const owned = w.owned.includes(item.id);
    const equipped = (item.kind === 'title' && w.title === item.value) || (item.kind === 'color' && w.nameColor === item.value);
    const card = document.createElement('div');
    card.className = 'shop-card';
    // a little live preview of what it does
    let preview = '';
    if (item.kind === 'title') preview = `<span class="title-badge">${item.value}</span>`;
    else if (item.value === 'rainbow') preview = `<span class="name-rainbow">Aa</span>`;
    else preview = `<span style="color:${item.value}">Aa</span>`;
    card.innerHTML =
      `<div class="se">${item.emoji}</div>` +
      `<div class="sl">${item.label}</div>` +
      `<div class="shop-preview">${preview}</div>`;
    const btn = document.createElement('button');
    btn.className = 'shop-btn' + (equipped ? ' equipped' : owned ? ' owned' : '');
    btn.innerHTML = equipped ? '✓ Equipped' : owned ? 'Equip' : `${item.price} <img class="cur-ico" src="/icons/claudebux.svg" alt="">`;
    btn.addEventListener('click', () => {
      if (equipped) return;
      if (owned) equipItem(item);
      else buyItem(item);
    });
    card.appendChild(btn);
    host.appendChild(card);
  }
}

function updateConvertPreview() {
  const w = wallet();
  convAmount = Math.max(1, convAmount);
  $('conv-amount').textContent = convAmount;
  const cost = convAmount * CUBE_RATE;
  $('conv-cost').innerHTML = `${cost} <img class="cur-ico" src="/icons/credits.svg" alt="">`;
  const btn = $('conv-do');
  btn.disabled = w.stars < cost;
  btn.innerHTML = w.stars < cost ? `Not enough ${POINTS.name}` : `Convert to ${convAmount} <img class="cur-ico" src="/icons/claudebux.svg" alt="">`;
}

function syncRewards(flash) {
  const w = wallet();
  $('bal-stars').textContent = w.stars;
  $('bal-cubes').textContent = w.cubes;
  updateWalletChip(flash);
  updateConvertPreview();
  renderChallenges();
  renderShop();
}

async function walletPost(path, body) {
  try {
    const data = await api(path, body);
    if (data && data.wallet) { stateHub.me.wallet = data.wallet; syncRewards(true); }
    return data;
  } catch (e) { toast(e.message, '⚠️'); return null; }
}

async function buyItem(item) {
  const data = await walletPost('/shop/buy', { name: stateHub.me.name, item: item.id });
  if (data?.ok) { sfx.success(); toast(`Got "${item.label}"!`, item.emoji); }
}
async function equipItem(item) {
  const body = { name: stateHub.me.name };
  if (item.kind === 'title') body.title = item.id;
  if (item.kind === 'color') body.nameColor = item.id;
  const data = await walletPost('/shop/equip', body);
  if (data?.ok) { sfx.tap(); toast(`Equipped ${item.label}`, '✨'); refreshSocial(); }
}

// ==================== MARKETPLACE ====================
// Laid out like Roblox's: a search header, a row of filter pills that each open
// a small popover of radio options with an Apply, a scrollable strip of tag
// chips, then a grid of rendered item cards — and an item page behind them.
//
// The catalogue is ClaudeBox's own: paid cosmetics come from AVATAR_SHOP, and
// everything else in the clothing catalogue is listed as Free, so the grid
// shows the whole wardrobe rather than only the things with a price.

const MK_KINDS = ['All', 'Body', 'Clothing', 'Accessories', 'Faces', 'Backgrounds', 'Animations'];
// slot -> which marketplace category it belongs under, and how to photograph it
const MK_SLOT = {
  hat:   { kind: 'Accessories', cat: 'hats',   frame: 'head',  label: 'Hat' },
  back:  { kind: 'Accessories', cat: 'backs',  frame: 'back',  label: 'Back' },
  face2: { kind: 'Faces',       cat: 'faces',  frame: 'face',  label: 'Face' },
  suit:  { kind: 'Clothing',    cat: 'suits',  frame: 'torso', label: 'Swimwear' },
  shirt: { kind: 'Clothing',    cat: 'shirts', frame: 'torso', label: 'Shirt' },
  shoes: { kind: 'Clothing',    cat: 'shoes',  frame: 'feet',  label: 'Shoes' },
  hair:  { kind: 'Body',        cat: 'hair',   frame: 'head',  label: 'Hair' },
};
const MK_COLOR = { hat: 'hatColor', back: 'backColor', face2: 'faceColor', suit: 'suitColor', shirt: 'shirtColor', shoes: 'shoeColor', hair: 'hairColor' };

const mkState = {
  q: '', kind: 'All', creator: '', min: null, max: null,
  sort: 'Relevance', sales: 'All', unavailable: 'Hide', tag: '',
  cart: [], detail: null,
};

// Build the full listing once: every catalogue item, priced if the shop sells it.
function mkCatalogue() {
  const priced = new Map();
  for (const it of AVATAR_SHOP) priced.set(it.slot + ':' + it.value, it);
  const out = [];
  for (const [slot, meta] of Object.entries(MK_SLOT)) {
    for (const item of (CLOTHING[meta.cat] || [])) {
      if (item.id === 'none') continue;
      const shopItem = priced.get(slot + ':' + item.id);
      out.push({
        id: shopItem?.id || `free-${slot}-${item.id}`,
        slot, value: item.id, label: shopItem?.label || item.label,
        kind: meta.kind, frame: meta.frame, slotLabel: meta.label,
        price: shopItem?.price ?? 0,
        featured: !!shopItem?.featured,
        shopId: shopItem?.id || null,
        creator: shopItem ? 'ClaudeBox Studios' : 'ClaudeBox',
        pri: item.pri, sec: item.sec, emoji: item.emoji,
      });
    }
  }
  // Anything the shop sells that is NOT a clothing slot — whole bodies and
  // animation packs — has no CLOTHING entry to walk, so it is listed straight
  // from the shop. Without this they simply never appeared.
  const KIND_OF = { Body: 'Body', Animations: 'Animations' };
  const FRAME_OF = { body: 'full', animPack: 'full' };
  const POSE_OF = { girljump: 'jump', steven: 'walk' };
  for (const it of AVATAR_SHOP) {
    if (MK_SLOT[it.slot]) continue;                 // already listed above
    out.push({
      id: it.id, slot: it.slot, value: it.value, label: it.label,
      kind: KIND_OF[it.cat] || 'Body',
      frame: FRAME_OF[it.slot] || 'full',
      pose: it.slot === 'animPack' ? (POSE_OF[it.value] || 'walk') : 'idle',
      slotLabel: it.slot === 'animPack' ? 'Animation' : 'Body',
      price: it.price, featured: !!it.featured, shopId: it.id,
      creator: 'ClaudeBox Studios', emoji: it.emoji,
    });
  }
  return out;
}
// Packs written by players, fetched once and folded into the same catalogue as
// everything else so they sort, filter, preview and buy identically.
let MK_PACKS = [];
async function loadCommunityPacks() {
  try {
    const j = await api(`/anim/market?name=${encodeURIComponent(stateHub.me?.name || '')}`);
    MK_PACKS = (j.packs || []).map((p) => ({
      id: `pack-${p.id}`, packId: p.id, slot: 'animPack', value: `pack:${p.id}`,
      label: p.title, kind: 'Animations', frame: 'full', pose: 'walk',
      slotLabel: 'Animation', price: p.price, featured: false,
      shopId: null, community: true, owned: p.owned, mine: p.mine,
      creator: p.author || 'a player', emoji: p.icon, blurb: p.blurb,
      tags: p.tags || [], clips: p.clips || [], sales: p.sales || 0,
    }));
    MK_ALL = null;             // rebuild so the new rows appear
  } catch (e) { console.error('[packs] load failed', e.message); MK_PACKS = []; }
  return MK_PACKS;
}

let MK_ALL = null;
const mkAll = () => (MK_ALL ||= [...mkCatalogue(), ...MK_PACKS]);

const mkOwned = () => new Set(wallet().ownedAvatar || []);
const mkIsOwned = (it) => (it.community ? !!it.owned : (!it.shopId || mkOwned().has(it.shopId)));
const mkEquipped = (it) => (stateHub.me?.avatar?.[it.slot] || 'none') === it.value;

function mkTags() {
  // tags are derived from what is actually listed, so they always lead somewhere
  const t = new Set();
  for (const it of mkAll()) { t.add(it.slotLabel.toLowerCase()); if (it.price === 0) t.add('free'); }
  return ['free', ...[...t].filter((x) => x !== 'free')].slice(0, 14);
}

function mkFiltered() {
  const q = mkState.q.trim().toLowerCase();
  let list = mkAll().filter((it) => {
    if (mkState.kind !== 'All' && it.kind !== mkState.kind) return false;
    if (q && !it.label.toLowerCase().includes(q) && !it.slotLabel.toLowerCase().includes(q)) return false;
    if (mkState.creator && !it.creator.toLowerCase().includes(mkState.creator.toLowerCase())) return false;
    if (mkState.min != null && it.price < mkState.min) return false;
    if (mkState.max != null && it.price > mkState.max) return false;
    if (mkState.sales === 'Limited' && !it.featured) return false;
    if (mkState.unavailable === 'Hide' && it.price > 0 && !mkIsOwned(it) && it.price > (wallet().cubes ?? 0) * 100) return false;
    if (mkState.tag) {
      const tag = mkState.tag;
      if (tag === 'free' ? it.price !== 0 : it.slotLabel.toLowerCase() !== tag) return false;
    }
    return true;
  });
  const s = mkState.sort;
  if (s === 'Price (Low to High)') list.sort((a, b) => a.price - b.price);
  else if (s === 'Price (High to Low)') list.sort((a, b) => b.price - a.price);
  else if (s === 'Bestselling' || s === 'Most Favorited') list.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  else if (s === 'Recently Published') list = [...list].reverse();
  return list;
}

// ---- filter pills ----
const MK_FILTERS = [
  { id: 'kind', title: 'Category', label: () => mkState.kind, opts: MK_KINDS, set: (v) => (mkState.kind = v) },
  { id: 'creator', title: 'Creator', label: () => (mkState.creator ? mkState.creator : 'All Creators'),
    text: { placeholder: 'Creator Name', get: () => mkState.creator, set: (v) => (mkState.creator = v) },
    opts: ['All Creators'], set: () => (mkState.creator = '') },
  { id: 'price', title: 'Price', label: () => (mkState.min == null && mkState.max == null ? 'Any Price' : `${mkState.min ?? 0}–${mkState.max ?? '∞'}`),
    range: true, opts: ['Any Price'], set: () => { mkState.min = mkState.max = null; } },
  { id: 'sort', title: 'Sort By', label: () => `Sort by ${mkState.sort}`,
    opts: ['Relevance', 'Most Favorited', 'Bestselling', 'Recently Published', 'Price (High to Low)', 'Price (Low to High)'],
    set: (v) => (mkState.sort = v) },
  { id: 'sales', title: 'Sales Type', label: () => 'Sales Type', opts: ['All', 'Limited', 'Timed Options'], set: (v) => (mkState.sales = v) },
  { id: 'unavailable', title: 'Unavailable Items', label: () => 'Unavailable Items', opts: ['Hide', 'Show'], set: (v) => (mkState.unavailable = v) },
];

function renderFilters() {
  const host = $('mk-filters'); if (!host) return;
  host.innerHTML = '';
  for (const f of MK_FILTERS) {
    const wrap = document.createElement('div'); wrap.className = 'mk-filt';
    const cur = f.id === 'kind' ? mkState.kind : f.id === 'sort' ? mkState.sort : f.id === 'sales' ? mkState.sales : f.id === 'unavailable' ? mkState.unavailable : '';
    let pending = cur;
    let pendingText = f.text ? f.text.get() : '';
    let pMin = mkState.min, pMax = mkState.max;
    wrap.innerHTML = `<button>${f.label()} <span class="car">▾</span></button>
      <div class="mk-pop hidden">
        <div class="mk-pop-head"><b>${f.title}</b><button class="x">✕</button></div>
        <div class="body"></div>
        <button class="mk-apply">Apply</button>
      </div>`;
    const pop = wrap.querySelector('.mk-pop'), body = wrap.querySelector('.body');
    const paint = () => {
      body.innerHTML = '';
      for (const o of f.opts) {
        const row = document.createElement('div');
        row.className = 'mk-opt' + (pending === o || (f.text && !pendingText && o === 'All Creators') || (f.range && pMin == null && pMax == null && o === 'Any Price') ? ' on' : '');
        row.innerHTML = `<span>${o}</span><i class="mk-radio"></i>`;
        row.addEventListener('click', () => { pending = o; if (f.text) pendingText = ''; if (f.range) { pMin = pMax = null; } paint(); });
        body.appendChild(row);
      }
      if (f.text) {
        const inp = document.createElement('input');
        inp.type = 'text'; inp.placeholder = f.text.placeholder; inp.value = pendingText;
        inp.addEventListener('input', () => { pendingText = inp.value; pending = ''; });
        body.appendChild(inp);
      }
      if (f.range) {
        const row = document.createElement('div'); row.className = 'mk-range';
        const a = document.createElement('input'); a.type = 'number'; a.placeholder = 'Min'; a.value = pMin ?? '';
        const b = document.createElement('input'); b.type = 'number'; b.placeholder = 'Max'; b.value = pMax ?? '';
        a.addEventListener('input', () => { pMin = a.value === '' ? null : +a.value; pending = ''; });
        b.addEventListener('input', () => { pMax = b.value === '' ? null : +b.value; pending = ''; });
        row.appendChild(a); row.appendChild(b); body.appendChild(row);
      }
    };
    paint();
    wrap.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = wrap.classList.contains('open');
      closePops();
      if (!wasOpen) { wrap.classList.add('open'); pop.classList.remove('hidden'); }
    });
    wrap.querySelector('.x').addEventListener('click', () => closePops());
    wrap.querySelector('.mk-apply').addEventListener('click', () => {
      if (f.text && pendingText) mkState.creator = pendingText;
      else if (f.range && (pMin != null || pMax != null)) { mkState.min = pMin; mkState.max = pMax; }
      else if (pending) f.set(pending);
      closePops(); renderMarket();
    });
    host.appendChild(wrap);
  }
}
function closePops() {
  document.querySelectorAll('.mk-filt').forEach((w) => { w.classList.remove('open'); w.querySelector('.mk-pop')?.classList.add('hidden'); });
}

function renderTags() {
  const host = $('mk-tags'); if (!host) return;
  host.innerHTML = '';
  for (const t of mkTags()) {
    const b = document.createElement('button');
    b.className = 'mk-tag' + (mkState.tag === t ? ' on' : '');
    b.textContent = t;
    b.addEventListener('click', () => { mkState.tag = mkState.tag === t ? '' : t; sfx.tap(); renderMarket(); });
    host.appendChild(b);
  }
}

function mkPreviewProfile(it) {
  const a = stateHub.me?.avatar || {};
  const base = {
    body: a.body || 'boy', skin: a.skin,
    shirtColor: a.shirtColor, pantsColor: a.pantsColor,
    [it.slot]: it.value,
    ...(MK_COLOR[it.slot] ? { [MK_COLOR[it.slot]]: it.pri || a[MK_COLOR[it.slot]] } : {}),
  };
  // an animation pack is only legible on a body that can show it, so preview it
  // on whatever the player is actually wearing
  if (it.slot === 'animPack') base.body = a.body || 'boy';
  return base;
}

function mkItemCard(it, small) {
  const b = document.createElement('button');
  b.className = 'mk-item';
  const owned = mkIsOwned(it);
  const cost = it.price === 0 ? 'Free'
    : `<img class="cur-ico" src="/icons/claudebux.svg" alt="">${it.price}`;
  b.innerHTML = `<div class="shot"></div><h4>${it.label}</h4>
    <div class="cost ${owned && it.price ? 'owned' : ''}">${owned && it.price ? 'Owned' : cost}</div>`;
  lazyThumb(b.querySelector('.shot'), `mk:${it.slot}:${it.value}:${stateHub.me?.avatar?.body || ''}`, mkPreviewProfile(it), it.frame, it.pose);
  b.addEventListener('click', () => mkOpenDetail(it));
  return b;
}

let packsLoaded = false;
function renderMarket() {
  if (!$('mk-grid')) return;
  // Pull the player-made packs the first time the Store is opened, then repaint.
  // Fetching on every keystroke of the search box would hammer the endpoint.
  if (!packsLoaded) {
    packsLoaded = true;
    loadCommunityPacks().then(() => renderMarket()).catch(() => {});
  }
  renderFilters(); renderTags();
  $('mk-detail').classList.add('hidden');
  $('mk-grid').classList.remove('hidden');
  const list = mkFiltered();
  const grid = $('mk-grid'); grid.innerHTML = '';
  for (const it of list) grid.appendChild(mkItemCard(it));
  $('mk-empty').classList.toggle('hidden', list.length > 0);
  $('mk-cart-n').textContent = String(mkState.cart.length);
}

// ---- item page ----
async function mkOpenDetail(it) {
  mkState.detail = it;
  $('mk-grid').classList.add('hidden');
  $('mk-empty').classList.add('hidden');
  const d = $('mk-detail'); d.classList.remove('hidden');
  $('mk-d-name').textContent = it.label;
  $('mk-d-by').textContent = it.creator;
  $('mk-d-price').innerHTML = it.price === 0 ? 'Free'
    : `<img class="cur-ico" src="/icons/claudebux.svg" alt="">${it.price}`;
  const owned = mkIsOwned(it);
  const buy = $('mk-d-buy');
  buy.textContent = owned ? (mkEquipped(it) ? 'Wearing' : 'Wear it') : 'Buy';
  buy.disabled = owned && mkEquipped(it);
  buy.onclick = () => (owned ? mkWear(it) : mkBuy(it));
  $('mk-d-cart').onclick = () => {
    if (mkIsOwned(it)) { toast(`You already own ${it.label}`, '🛍️'); return; }
    if (!mkState.cart.includes(it.id)) mkState.cart.push(it.id);
    cartPaint();
    sfx.tap(); toast(`${it.label} added to cart`, '🛒');
  };
  $('mk-d-meta').innerHTML = `
    <dt>Type</dt><dd>${it.kind}</dd>
    <dt>Placement</dt><dd>${it.slotLabel}</dd>
    <dt>Creator</dt><dd>${it.creator}</dd>
    ${it.community ? `<dt>Clips</dt><dd>${(it.clips || []).join(', ') || '—'}</dd>
                      <dt>Sold</dt><dd>${it.sales} time${it.sales === 1 ? '' : 's'}</dd>` : ''}
    <dt>Status</dt><dd>${owned ? 'In your inventory' : it.price === 0 ? 'Free to wear' : 'Available'}</dd>`;
  const blurbEl = $('mk-d-meta');
  if (it.blurb) blurbEl.insertAdjacentHTML('afterend', `<p class="mk-blurb">${String(it.blurb).replace(/[<>&]/g, '')}</p>`);
  const stage = $('mk-detail-thumb'); stage.innerHTML = '';
  lazyThumb(stage, `mkbig:${it.slot}:${it.value}`, mkPreviewProfile(it), it.frame, it.pose);
  $('mk-tryon').onclick = () => mkWear(it, true);
  // more from the same slot
  const rec = $('mk-rec'); rec.innerHTML = '';
  for (const o of mkAll().filter((x) => x.slot === it.slot && x.value !== it.value).slice(0, 7)) rec.appendChild(mkItemCard(o));
  d.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ---------------------------------------------------------------- cart
// The cart button counted items and did nothing else — there was no way to see
// what was in it or buy any of it. This gives it a panel, a total, removal, and
// a checkout that buys everything affordable in one go.
function cartItems() {
  const all = mkAll();
  return mkState.cart.map((id) => all.find((x) => x.id === id)).filter(Boolean);
}
function cartTotal() {
  return cartItems().filter((it) => !mkIsOwned(it)).reduce((n, it) => n + (it.price || 0), 0);
}
function cartPaint() {
  const n = $('mk-cart-n');
  if (n) n.textContent = String(mkState.cart.length);
  const panel = $('mk-cart-panel');
  if (!panel || panel.classList.contains('hidden')) return;
  const items = cartItems();
  const total = cartTotal();
  const bits = wallet().cubes ?? 0;
  $('mk-cart-list').innerHTML = items.length
    ? items.map((it) => `<div class="cart-row" data-id="${it.id}">
        <span class="ci">${it.emoji || '🎁'}</span>
        <span class="cn">${it.label}<small>${it.slotLabel}</small></span>
        <span class="cp">${mkIsOwned(it) ? 'Owned'
          : it.price === 0 ? 'Free'
          : `<img class="cur-ico" src="/icons/claudebux.svg" alt="">${it.price}`}</span>
        <button class="cx" title="Remove">✕</button></div>`).join('')
    : '<p class="cart-empty">Your cart is empty. Open an item and press “Add to cart”.</p>';
  $('mk-cart-total').innerHTML = items.length
    ? `<span>Total</span><b><img class="cur-ico" src="/icons/claudebux.svg" alt="">${total}</b>`
    : '';
  const buy = $('mk-cart-buy');
  buy.classList.toggle('hidden', !items.length);
  buy.disabled = total > bits;
  buy.textContent = total > bits ? `Need ${total - bits} more` : `Buy ${items.length} item${items.length > 1 ? 's' : ''}`;
  $('mk-cart-list').querySelectorAll('.cx').forEach((b) => {
    b.addEventListener('click', (e) => {
      const id = e.target.closest('.cart-row').dataset.id;
      mkState.cart = mkState.cart.filter((x) => x !== id);
      sfx.tap(); cartPaint();
    });
  });
}
function cartOpen(show) {
  const panel = $('mk-cart-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', show === false ? true : !panel.classList.contains('hidden') ? true : false);
  cartPaint();
}
async function cartCheckout() {
  const items = cartItems().filter((it) => !mkIsOwned(it));
  if (!items.length) { toast('Nothing left to buy', '🛒'); return; }
  let bought = 0, failed = 0;
  for (const it of items) {
    // buy sequentially: each purchase moves the wallet, and the next needs to
    // see that rather than all of them racing off one stale balance
    await mkBuy(it, true);
    if (mkIsOwned(it)) { bought++; mkState.cart = mkState.cart.filter((x) => x !== it.id); }
    else failed++;
  }
  cartPaint(); renderMarket();
  sfx.success();
  toast(failed ? `Bought ${bought}, ${failed} could not be bought` : `Bought ${bought} item${bought > 1 ? 's' : ''}!`, '🎉');
}

async function mkWear(it, tryOnly) {
  const data = await storePost('/avatarshop/equip', { name: stateHub.me.name, slot: it.slot, value: it.value });
  if (data?.ok) { sfx.tap(); toast(`${tryOnly ? 'Trying on' : 'Wearing'} ${it.label}`, '✨'); mkOpenDetail(it); }
  else if (data?.error) toast(data.error, '⚠️');
}
async function mkBuy(it, quiet) {
  if (it.community) {
    const data = await storePost('/anim/buy', { name: stateHub.me.name, id: it.packId });
    if (data?.ok) {
      it.owned = true;
      sfx.success();
      if (!quiet) {
        toast(data.already ? `You already own ${it.label}` :
          `Bought ${it.label} — ${data.paid} Bits went to ${data.author || 'its creator'}`, '🎉');
        mkOpenDetail(it);
      }
    } else if (data?.error) { sfx.deny?.(); toast(data.error, '⚠️'); }
    return;
  }
  if (!it.shopId) return mkWear(it);
  const data = await storePost('/avatarshop/buy', { name: stateHub.me.name, item: it.shopId });
  if (data?.ok) { if (!quiet) { sfx.success(); toast(`Bought ${it.label}!`, '🎉'); mkOpenDetail(it); } }
  else if (data?.error && !quiet) { sfx.deny?.(); toast(data.error, '⚠️'); }
}

async function storePost(path, body) {
  try {
    const data = await api(path, body);
    // updateWalletChip is the real repainter. The previous call used
    // `paintWallet?.()`, which does not exist — and optional chaining only
    // guards a null value, not an undeclared identifier, so every buy and
    // try-on threw ReferenceError before it could report its result.
    if (data?.wallet) { stateHub.me.wallet = data.wallet; updateWalletChip(true); }
    if (data?.avatar) { stateHub.me.avatar = data.avatar; thumbInto($('me-thumb'), stateHub.me); avatarEditor.refresh?.(); }
    return data;
  } catch (e) { return { error: e.message }; }
}

function initStoreTab() {
  const q = $('mk-q');
  $('mk-cart')?.addEventListener('click', () => { sfx.tap(); cartOpen(); });
  $('mk-cart-close')?.addEventListener('click', () => { $('mk-cart-panel').classList.add('hidden'); });
  $('mk-cart-buy')?.addEventListener('click', () => cartCheckout());
  if (q) q.addEventListener('input', () => { mkState.q = q.value; renderMarket(); });
  const kind = $('mk-kind');
  if (kind) {
    kind.innerHTML = MK_KINDS.map((k) => `<option>${k}</option>`).join('');
    kind.addEventListener('change', () => { mkState.kind = kind.value; renderMarket(); });
  }
  $('mk-buy')?.addEventListener('click', () => { sfx.tap(); selectTab('rewards'); });
  $('mk-back')?.addEventListener('click', () => { mkState.detail = null; renderMarket(); });
  $('mk-tagnext')?.addEventListener('click', () => $('mk-tags').scrollBy({ left: 260, behavior: 'smooth' }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.mk-filt')) closePops(); });
}
const renderStore = renderMarket;

function initRewardsTab() {
  // localize labels to the configured currency names
  $('lbl-stars').textContent = POINTS.name;
  $('lbl-cubes').textContent = CURRENCY.name;
  $('convert-title').textContent = `Convert ${POINTS.name} → ${CURRENCY.name}`;
  $('send-title').textContent = `Send ${CURRENCY.name} to a friend`;
  $('wallet-tag').textContent = `Complete challenges in games to earn ${POINTS.name}, then convert them into ${CURRENCY.name} to spend in the shop — or send some to a friend.`;

  $('conv-minus').addEventListener('click', () => { convAmount = Math.max(1, convAmount - 1); sfx.tap(); updateConvertPreview(); });
  $('conv-plus').addEventListener('click', () => { const max = Math.floor(wallet().stars / CUBE_RATE) || 1; convAmount = Math.min(Math.max(1, max), convAmount + 1); sfx.tap(); updateConvertPreview(); });
  $('conv-do').addEventListener('click', async () => {
    const data = await walletPost('/currency/convert', { name: stateHub.me.name, cubes: convAmount });
    if (data?.ok) { sfx.success(); toast(`Converted to ${data.minted} ${CURRENCY.name}!`, '🔷'); convAmount = 1; updateConvertPreview(); }
  });
  $('send-do').addEventListener('click', async () => {
    const to = $('send-to').value.trim();
    const amount = Math.floor(Number($('send-amount').value) || 0);
    if (!to || amount < 1) { toast('Enter a name and amount', '⚠️'); return; }
    const data = await walletPost('/currency/send', { name: stateHub.me.name, to, amount });
    if (data?.ok) { sfx.success(); toast(`Sent ${data.sent} ${CURRENCY.name} to ${data.to}!`, '🎁'); $('send-to').value = ''; $('send-amount').value = 1; }
  });
}

// ---------------- sound toggle button ----------------
function syncSoundBtn() {
  const b = $('sound-toggle');
  b.textContent = settings.sound ? '🔊' : '🔇';
  b.classList.toggle('muted', !settings.sound);
}
$('sound-toggle').addEventListener('click', () => {
  settings.sound = !settings.sound;
  sfx.setEnabled(settings.sound);
  saveSettings(); syncSoundBtn();
  if (settings.sound) sfx.toggleOn(); // plays only if just enabled
  const si = $('sound-input'); if (si) si.checked = settings.sound;
  if (!settings.sound) sfx.setAmbient(false);
  else if (settings.ambient) sfx.setAmbient(true);
});

// ---------------- settings tab ----------------
function initSettingsTab() {
  $('settings-name').textContent = stateHub.me.name;
  $('accent-input').value = settings.accent;
  $('motion-input').checked = settings.reduceMotion;
  $('gyro-input').checked = settings.gyro;
  $('rblxs-input').checked = !!settings.rblxsMaps;
  $('rbxui-input').checked = !!settings.robloxUI;
  $('sound-input').checked = settings.sound;
  $('ambient-input').checked = settings.ambient;
  const themeSel = $('theme-input'); if (themeSel) themeSel.value = settings.theme;
  syncSoundBtn();

  if (themeSel) themeSel.addEventListener('change', () => { settings.theme = themeSel.value === 'light' ? 'light' : 'dark'; applyTheme(); saveSettings(); sfx.tap && sfx.tap(); });

  $('rbxui-input').addEventListener('change', () => {
    settings.robloxUI = $('rbxui-input').checked;
    saveSettings();
    applyRbxUi();
    if (!settings.robloxUI) applyAccent();   // restore the accent the Roblox palette suppressed
    movePill();
    (settings.robloxUI ? sfx.toggleOn : sfx.toggleOff)();
    toast(settings.robloxUI ? 'Roblox-true UI on' : 'Roblox-true UI off', '🟦');
  });
  $('accent-input').addEventListener('input', () => { settings.accent = $('accent-input').value; applyAccent(); saveSettings(); });
  $('motion-input').addEventListener('change', () => { settings.reduceMotion = $('motion-input').checked; applyMotion(); motionCtl.setReduce(settings.reduceMotion); restartHeroTimer(); saveSettings(); (settings.reduceMotion ? sfx.toggleOff : sfx.toggleOn)(); });
  $('rblxs-input').addEventListener('change', async () => {
    if ($('rblxs-input').checked && !await rblxsWarning()) {
      $('rblxs-input').checked = false;
      return;
    }
    settings.rblxsMaps = $('rblxs-input').checked;
    saveSettings();
    (settings.rblxsMaps ? sfx.toggleOn : sfx.toggleOff)();
    if (settings.rblxsMaps) toast('RBLXS map on — the Playground now plays your Studio-marked slot', '🧱');
  });
  $('gyro-input').addEventListener('change', () => {
    settings.gyro = $('gyro-input').checked;
    motionCtl.setGyro(settings.gyro);
    saveSettings();
    (settings.gyro ? sfx.toggleOn : sfx.toggleOff)();
    // turning it ON is a real tap — the perfect moment to (re-)ask iOS for
    // motion access if it hasn't been granted yet
    if (settings.gyro) motionCtl.request().then((r) => {
      if (r === 'denied') toast('Motion access is blocked — see the note under the Tilt effects switch', '📱');
    });
  });
  $('sound-input').addEventListener('change', () => {
    settings.sound = $('sound-input').checked; sfx.setEnabled(settings.sound); saveSettings(); syncSoundBtn();
    if (settings.sound) sfx.toggleOn(); else sfx.setAmbient(false);
    if (settings.sound && settings.ambient) sfx.setAmbient(true);
  });
  $('ambient-input').addEventListener('change', () => {
    settings.ambient = $('ambient-input').checked; saveSettings();
    sfx.setAmbient(settings.ambient && settings.sound);
    (settings.ambient ? sfx.toggleOn : sfx.toggleOff)();
  });

  $('rename-btn').addEventListener('click', async () => {
    const newName = $('rename-input').value.trim().slice(0, 20);
    if (!newName) return;
    try {
      const { name } = await api('/rename', { name: stateHub.me.name, newName });
      stateHub.me.name = name; localStorage.setItem(USER_KEY, name);
      try { const key = 'featherfriends.lastProfile'; const prof = JSON.parse(localStorage.getItem(key) || '{}'); prof.name = name; localStorage.setItem(key, JSON.stringify(prof)); } catch {}
      $('me-name').textContent = name; $('settings-name').textContent = name; $('rename-input').value = '';
      sfx.success(); toast(`You're now ${name}!`, '✨'); refreshSocial();
    } catch (e) { toast(e.message, '⚠️'); }
  });
  $('rename-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('rename-btn').click(); });
  // ---- account password ----
  async function refreshPwStatus() {
    if (!stateHub.me) return;
    try {
      const d = await api('/haspw?name=' + encodeURIComponent(stateHub.me.name));
      const has = !!d.hasPassword;
      $('pw-status').textContent = has ? 'set ✓' : 'not set';
      $('pw-old').classList.toggle('hidden', !has);
    } catch {}
  }
  $('pw-save-btn').addEventListener('click', async () => {
    const pw = $('pw-new').value; const oldPw = $('pw-old').value;
    if (pw.length < 4) { toast('Password must be at least 4 characters', '⚠️'); return; }
    try {
      await api('/setpassword', { name: stateHub.me.name, password: pw, oldPassword: oldPw });
      $('pw-new').value = ''; $('pw-old').value = '';
      sfx.success(); toast('Password saved — log in anywhere with just your name + password!', '🔒');
      refreshPwStatus();
    } catch (e) { toast(e.message, '⚠️'); }
  });
  $('pw-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pw-save-btn').click(); });
  refreshPwStatus();
  $('signout-btn').addEventListener('click', () => { localStorage.removeItem(USER_KEY); location.reload(); });
  $('update-btn').addEventListener('click', async () => {
    try {
      const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k)));
      const regs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(regs.map((r) => r.unregister()));
    } catch {}
    toast('Refreshing…', '🔄'); setTimeout(() => location.reload(), 600);
  });
}

// ---------------- social polling ----------------
async function refreshSocial() {
  updateDmBadge();
  try {
    const data = await api('/social/' + encodeURIComponent(stateHub.me.name));
    stateHub.me.recentGames = data.me.recentGames;
    if (data.me.likedGames) stateHub.me.likedGames = data.me.likedGames;
    stateHub.friends = data.friends;
    stateHub.online = data.online;
    stateHub.requestsIn = data.requestsIn || [];
    stateHub.sent = data.sent || [];
    // wallet may have changed while you were in a game — flash if it grew
    const prev = wallet();
    const grew = data.me.wallet && (data.me.wallet.stars !== prev.stars || data.me.wallet.cubes !== prev.cubes);
    if (data.me.wallet) stateHub.me.wallet = data.me.wallet;
    renderFriends(); renderGames(); renderConnect(); syncRewards(grew);
    syncRbxUi();
  } catch {}
}

// ---------------- boot ----------------
(async () => {
  showSkeletons();
  try {
    const acc = await fetch('/api/access').then((r) => r.json());
    if (acc.locked) $('code-input').classList.remove('hidden');
  } catch {}
  await ensureLogin();
  $('me-name').textContent = stateHub.me.name;
  thumbInto($('me-thumb'), stateHub.me);
  initSettingsTab();
  $('av-pfp')?.addEventListener('click', editProfilePicture);
  initRbxUi({
    settings, stateHub, selectTab, openProfile, openDMs, launchGame,
    openGameDetail, thumbInto, fmtNum, api, toast, sfx, wallet,
    approvalPct, playerCountFor,
  });
  movePill();
  const { games } = await api('/games');
  stateHub.games = games;
  renderChips();
  renderGames();
  initRewardsTab();
  initStoreTab();
  syncRewards();
  await refreshSocial();
  movePill();
  // if the user jumped to Avatar during load, build it now that we're ready
  if (document.querySelector('.tab.selected')?.dataset.tab === 'avatar') avatarEditor.start();
  setInterval(refreshSocial, 10000);
})();
