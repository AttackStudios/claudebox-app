// ClaudeBox home — login, tabs, social, the games library, a 3D avatar
// studio, and a synthesized sound layer. Talks to the same platform API as
// before (/api/login, /social, /games, /avatar, /friends/*, /rename, /played).

import * as THREE from 'three';
import { drawAvatarHead } from './avatarModel.js';
import { preloadAvatars, makeAvatar, CLOTHING } from '/shared/avatar3d.js';
import { sfx } from './sounds.js';
import { CHALLENGES, SHOP, CUBE_RATE, CURRENCY, POINTS, AVATAR_SHOP, AVATAR_SHOP_BY_ID, AVATAR_CATS } from '/shared/rewards.js';

const USER_KEY = 'claudebox.user';
const SETTINGS_KEY = 'claudebox.settings';
const $ = (id) => document.getElementById(id);

// ---------------- per-device settings ----------------
const settings = (() => {
  const d = { accent: '#38b6e8', reduceMotion: false, sound: true, ambient: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return d; }
})();
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

// derive a readable "ink" colour + glow for any accent
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function applyAccent() {
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
applyAccent();
applyMotion();
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
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

// ---------------- login ----------------
async function ensureLogin() {
  const saved = localStorage.getItem(USER_KEY);
  if (saved) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { const { profile } = await api('/login', { name: saved }); stateHub.me = profile; return; }
      catch { await new Promise((r) => setTimeout(r, 600)); }
    }
  }
  $('login').classList.remove('hidden');
  await new Promise((resolve) => {
    const go = async () => {
      const name = $('login-input').value.trim().slice(0, 20);
      if (!name) return;
      const code = $('code-input')?.value.trim();
      if (code) localStorage.setItem('claudebox.code', code);
      try {
        const { profile } = await api('/login', { name });
        stateHub.me = profile;
        localStorage.setItem(USER_KEY, profile.name);
        sfx.welcome();
        const card = $('login').querySelector('.login-card');
        card.style.transition = 'transform .4s var(--spring), opacity .4s';
        card.style.transform = 'scale(1.05)'; card.style.opacity = '0';
        setTimeout(() => { $('login').classList.add('hidden'); resolve(); }, 380);
      } catch (e) { toast(e.message, '⚠️'); }
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
  if (name === 'store') { renderStore(); storeStage.start(); } else storeStage.stop();
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
function thumbInto(canvas, avatar) { drawAvatarHead(canvas.getContext('2d'), avatar, canvas.width); }

// ---------------- per-game theming (client-side flourish) ----------------
const GAME_THEME = {
  'feather-friends': { emoji: '🐦', from: '#1fa87a', to: '#0c5566', accent: '#34d6a8' },
  'backpacking':     { emoji: '🏕️', from: '#e0913c', to: '#6e3417', accent: '#ffbb52' },
  'restaurant-sim-2':{ emoji: '🍔', from: '#e0503c', to: '#6e1626', accent: '#ff7a5c' },
  'obby':            { emoji: '🧗', from: '#7c5cff', to: '#241566', accent: '#a58bff' },
  'wibit':           { emoji: '🌊', from: '#2ec5e0', to: '#144a70', accent: '#5be0ff' },
  'rivals':          { emoji: '🎯', from: '#e04b3c', to: '#3c1024', accent: '#ff6b5c' },
  'brook':           { emoji: '🏘️', from: '#4fae6a', to: '#173a24', accent: '#7fe0a0' },
  'tycoon':          { emoji: '🔥', from: '#ff7a3a', to: '#2a1866', accent: '#ffb14a' },
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
    thumbInto(cv, f.avatar);
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
  const l = game.likes || 0;
  return Math.min(99, 78 + Math.round(Math.log2(l + 1) * 3.2));
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
  gdEl.querySelector('.gd-dislikes').textContent = fmtNum(Math.round(likes * (100 - pct) / Math.max(1, pct)));
  gdEl.querySelector('.gd-bar-fill').style.width = pct + '%';
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
  $('dm-back').classList.add('hidden'); $('dm-title').textContent = 'Messages';
}
async function loadDmInbox() {
  try {
    const data = await api('/dm/inbox?name=' + encodeURIComponent(stateHub.me.name));
    const host = $('dm-list'); host.innerHTML = '';
    if (!data.conversations?.length) { host.innerHTML = '<div class="empty-note">No conversations yet. Message a friend to start one!</div>'; return; }
    for (const c of data.conversations) {
      const row = document.createElement('button'); row.className = 'dm-conv';
      const cv = document.createElement('canvas'); cv.width = cv.height = 84; thumbInto(cv, c.avatar);
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
  await refreshThread();
  $('dm-input').focus();
  clearInterval(dmPoll); dmPoll = setInterval(refreshThread, 3000);
}
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
  const cv = document.createElement('canvas'); cv.width = cv.height = 84; thumbInto(cv, person.avatar);
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

// ---------------- avatar editor ----------------
const cloth = (cat) => CLOTHING[cat].map((i) => [i.id, `${i.emoji} ${i.label}`]);
const OPTIONS = {
  body: { label: 'Body type', values: [['boy', '🧍 Boy'], ['girl', '🧍‍♀️ Girl']] },
  shirtColor: { label: 'Shirt colour', colorOnly: true },
  pantsColor: { label: 'Pants colour', colorOnly: true },
  suit: { label: 'Swimsuit', values: cloth('suits'), color: 'suitColor' },
  hat: { label: 'Hat', values: cloth('hats'), color: 'hatColor' },
  back: { label: 'Back', values: cloth('backs'), color: 'backColor' },
  face2: { label: 'Face', values: cloth('faces'), color: 'faceColor' },
};
const SKIN_TONES = ['#f5d3b3', '#e8b48a', '#c98e62', '#9a6844', '#6e4a30', '#54382a'];

const avatarEditor = (() => {
  let renderer = null, scene, cam, ctrl = null, running = false, ready = false;
  const clock = new THREE.Clock();

  function rebuild() {
    if (!scene || !ready) return;
    if (ctrl) { scene.remove(ctrl.group); ctrl.dispose?.(); }
    ctrl = makeAvatar(stateHub.me.avatar);
    ctrl.setAnim('idle');
    scene.add(ctrl.group);
  }
  async function init() {
    // Build the controls first so the editor is usable even if WebGL is
    // unavailable on this device.
    buildOptionsUI();
    const canvas = $('avatar-canvas');
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (e) { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    cam.position.set(0, 1.15, 4.4); cam.lookAt(0, 0.95, 0);
    scene.add(new THREE.AmbientLight('#aab4c4', 1.5));
    const key = new THREE.DirectionalLight('#fff4dc', 2.0); key.position.set(2, 4, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(settings.accent, 0.9); rim.position.set(-3, 2, -2); scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.1, 40), new THREE.MeshLambertMaterial({ color: '#26282f' }));
    disc.position.y = -0.05; scene.add(disc);
    await preloadAvatars(['boy', 'girl']);
    ready = true; rebuild();
  }
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const canvas = renderer.domElement, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    const dt = clock.getDelta();
    if (ctrl) { ctrl.update(dt); ctrl.group.rotation.y = settings.reduceMotion ? 0 : Math.sin(now / 1000 * 0.4) * 0.6; }
    renderer.render(scene, cam);
  }
  function buildOptionsUI() {
    const host = $('avatar-options'); host.innerHTML = '';
    const av = stateHub.me.avatar;
    const skinGroup = document.createElement('div');
    skinGroup.className = 'opt-group'; skinGroup.innerHTML = '<h3>Skin</h3>';
    const skinRow = document.createElement('div'); skinRow.className = 'opt-row';
    for (const tone of SKIN_TONES) {
      const sw = document.createElement('button');
      sw.className = 'skin-swatch' + (av.skin === tone ? ' selected' : '');
      sw.style.background = tone;
      sw.addEventListener('click', () => { av.skin = tone; sfx.tap(); skinRow.querySelectorAll('.skin-swatch').forEach((s) => s.classList.toggle('selected', s === sw)); rebuild(); });
      skinRow.appendChild(sw);
    }
    const customSkin = document.createElement('input');
    customSkin.type = 'color'; customSkin.value = av.skin;
    customSkin.addEventListener('input', () => { av.skin = customSkin.value; rebuild(); });
    skinRow.appendChild(customSkin); skinGroup.appendChild(skinRow); host.appendChild(skinGroup);

    for (const [key, opt] of Object.entries(OPTIONS)) {
      const group = document.createElement('div'); group.className = 'opt-group'; group.innerHTML = `<h3>${opt.label}</h3>`;
      const row = document.createElement('div'); row.className = 'opt-row';
      if (opt.colorOnly) {
        const ci = document.createElement('input'); ci.type = 'color'; ci.value = av[key] || '#888888';
        ci.addEventListener('input', () => { av[key] = ci.value; rebuild(); });
        row.appendChild(ci); group.appendChild(row); host.appendChild(group); continue;
      }
      for (const [value, label] of opt.values) {
        const btn = document.createElement('button');
        btn.className = 'opt-btn' + ((av[key] || 'none') === value ? ' selected' : '');
        btn.textContent = label;
        btn.addEventListener('click', () => { av[key] = value; sfx.tap(); row.querySelectorAll('.opt-btn').forEach((b) => b.classList.toggle('selected', b === btn)); rebuild(); });
        row.appendChild(btn);
      }
      if (opt.color) {
        const colorInput = document.createElement('input'); colorInput.type = 'color'; colorInput.value = av[opt.color];
        colorInput.addEventListener('input', () => { av[opt.color] = colorInput.value; rebuild(); });
        row.appendChild(colorInput);
      }
      group.appendChild(row); host.appendChild(group);
    }
    const saveBtn = document.createElement('button');
    saveBtn.id = 'avatar-save'; saveBtn.textContent = '💾 Save avatar';
    saveBtn.addEventListener('click', async () => {
      try {
        const { avatar } = await api('/avatar', { name: stateHub.me.name, avatar: stateHub.me.avatar });
        stateHub.me.avatar = avatar; thumbInto($('me-thumb'), avatar);
        sfx.success(); toast('Avatar saved!', '✨');
      } catch (e) { toast(e.message, '⚠️'); }
    });
    host.appendChild(saveBtn);
  }
  return {
    async start() {
      if (!stateHub.me) return; // profile not loaded yet
      if (!renderer && !ready) await init();
      if (renderer && !running) { running = true; clock.getDelta(); requestAnimationFrame(frame); }
    },
    stop() { running = false; },
  };
})();

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

// ==================== STORE (Avatar Shop) ====================
let storeCat = 'Featured';
const SLOT_LABEL = { hat: 'Hat', back: 'Back', face2: 'Face', suit: 'Outfit' };

// a lightweight live 3D preview of your avatar (own renderer, runs only when the
// Store tab is open) — mirrors the avatar editor but read-only
const storeStage = (() => {
  let renderer = null, scene, cam, ctrl = null, running = false, ready = false;
  const clock = new THREE.Clock();
  function rebuild() {
    if (!scene || !ready) return;
    if (ctrl) { scene.remove(ctrl.group); ctrl.dispose?.(); }
    ctrl = makeAvatar(stateHub.me.avatar); ctrl.setAnim('idle'); scene.add(ctrl.group);
  }
  async function init() {
    const canvas = $('store-canvas'); if (!canvas) return;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(32, 1, 0.1, 30); cam.position.set(0, 1.1, 4.6); cam.lookAt(0, 0.95, 0);
    scene.add(new THREE.AmbientLight('#aab4c4', 1.5));
    const key = new THREE.DirectionalLight('#fff4dc', 2.0); key.position.set(2, 4, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(settings.accent, 0.9); rim.position.set(-3, 2, -2); scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.1, 40), new THREE.MeshLambertMaterial({ color: '#26282f' }));
    disc.position.y = -0.05; scene.add(disc);
    await preloadAvatars(['boy', 'girl']); ready = true; rebuild();
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
    async start() { if (!renderer) await init(); running = true; requestAnimationFrame(frame); },
    stop() { running = false; },
    refresh() { rebuild(); },
  };
})();

function storeCounts() {
  const w = wallet();
  const owned = new Set(w.ownedAvatar || []);
  return { owned };
}
function renderCats() {
  const host = $('store-cats'); if (!host) return;
  host.innerHTML = '';
  const emojiByCat = { Featured: '✨', Hats: '🎩', Faces: '🕶️', Back: '🎒' };
  for (const cat of AVATAR_CATS) {
    const b = document.createElement('button');
    b.className = 'store-cat' + (cat === storeCat ? ' active' : '');
    b.innerHTML = `<span>${emojiByCat[cat] || '🛍️'}</span> ${cat}`;
    b.addEventListener('click', () => { storeCat = cat; sfx.tap(); renderStore(); });
    host.appendChild(b);
  }
}
function renderStore() {
  const grid = $('store-grid'); if (!grid) return;
  renderCats();
  $('store-bal').textContent = wallet().cubes || 0;
  $('store-cur').textContent = CURRENCY.name;
  const q = ($('store-search')?.value || '').trim().toLowerCase();
  const { owned } = storeCounts();
  const av = stateHub.me.avatar || {};
  let items = AVATAR_SHOP.filter((it) => storeCat === 'Featured' ? it.featured : it.cat === storeCat);
  if (q) items = AVATAR_SHOP.filter((it) => it.label.toLowerCase().includes(q));
  grid.innerHTML = '';
  if (!items.length) { grid.innerHTML = '<div class="store-empty">No items found.</div>'; return; }
  for (const it of items) {
    const isOwned = owned.has(it.id);
    const isEquipped = av[it.slot] === it.value;
    const card = document.createElement('div');
    card.className = 'store-card' + (isEquipped ? ' equipped' : '');
    let btn;
    if (isEquipped) btn = `<button class="store-btn on">✓ Equipped</button>`;
    else if (isOwned) btn = `<button class="store-btn equip">Equip</button>`;
    else btn = `<button class="store-btn buy"><img class="cur-ico" src="/icons/claudebux.svg" alt=""> ${it.price}</button>`;
    card.innerHTML =
      `<div class="store-thumb">${it.emoji}</div>` +
      `<div class="store-name">${it.label}</div>` +
      `<div class="store-cat-tag">${SLOT_LABEL[it.slot] || ''}</div>` +
      btn;
    card.querySelector('button').addEventListener('click', () => {
      if (isEquipped) unequipAvatar(it);
      else if (isOwned) equipAvatarItem(it);
      else buyAvatarItem(it);
    });
    grid.appendChild(card);
  }
}
async function storePost(path, body) {
  try {
    const data = await api(path, body);
    if (data?.wallet) stateHub.me.wallet = data.wallet;
    if (data?.avatar) { stateHub.me.avatar = data.avatar; thumbInto($('me-thumb'), stateHub.me.avatar); storeStage.refresh(); }
    syncRewards(); renderStore();
    return data;
  } catch (e) { toast(e.message, '⚠️'); return null; }
}
async function buyAvatarItem(it) {
  if ((wallet().cubes || 0) < it.price) { toast(`Not enough ${CURRENCY.name} — earn & convert Stars first`, '🔷'); sfx.error?.(); return; }
  const data = await storePost('/avatarshop/buy', { name: stateHub.me.name, item: it.id });
  if (data?.ok) { sfx.success(); toast(`Unlocked "${it.label}"!`, it.emoji); }
}
async function equipAvatarItem(it) {
  const data = await storePost('/avatarshop/equip', { name: stateHub.me.name, slot: it.slot, value: it.value });
  if (data?.ok) { sfx.tap(); toast(`Equipped ${it.label}`, '✨'); }
}
async function unequipAvatar(it) {
  const data = await storePost('/avatarshop/equip', { name: stateHub.me.name, slot: it.slot, value: 'none' });
  if (data?.ok) { sfx.tap(); toast(`Removed ${it.label}`, '👋'); }
}
function initStoreTab() {
  const s = $('store-search'); if (s) s.addEventListener('input', () => renderStore());
  const gb = $('store-getbits'); if (gb) gb.addEventListener('click', () => { sfx.tap(); selectTab('rewards'); });
}

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
  $('sound-input').checked = settings.sound;
  $('ambient-input').checked = settings.ambient;
  syncSoundBtn();

  $('accent-input').addEventListener('input', () => { settings.accent = $('accent-input').value; applyAccent(); saveSettings(); });
  $('motion-input').addEventListener('change', () => { settings.reduceMotion = $('motion-input').checked; applyMotion(); restartHeroTimer(); saveSettings(); (settings.reduceMotion ? sfx.toggleOff : sfx.toggleOn)(); });
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
  thumbInto($('me-thumb'), stateHub.me.avatar);
  initSettingsTab();
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
