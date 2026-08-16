// ClaudeBox Playtest kiosk.
// Attract screen → game carousel → launch with a countdown. When the timer
// runs out the game sends the player straight back here, never to the hub.

const $ = (s) => document.querySelector(s);

const GAMES = [
  { id: 'rivals',          name: 'Rivals',                     tag: 'FPS duels',        url: '/games/rivals',          art: '/icons/game-rivals.png' },
  { id: 'bab',             name: 'Build A Boat For Treasure',  tag: 'Build & sail',     url: '/games/bab',             art: '/icons/game-bab.svg', trending: true },
  { id: 'feather-friends', name: 'Feather Friends',            tag: 'Live a bird life', url: '/games/feather-friends', art: '/icons/game-feather-friends.png' },
  { id: 'nds',             name: 'Natural Disaster Survival',  tag: 'Outlast it',       url: '/games/nds',             art: '/icons/game-nds.svg' },
];

const PASSWORD = 'j4ckK4t3';
const SESSION_KEY = 'claudebox.playtest';
const MINUTES_KEY = 'claudebox.playtest.minutes';
const PRESETS = [2, 5, 10, 15, 20, 30];

const getMinutes = () => {
  const v = parseInt(localStorage.getItem(MINUTES_KEY) || '10', 10);
  return Number.isFinite(v) && v >= 1 && v <= 120 ? v : 10;
};
const setMinutes = (v) => localStorage.setItem(MINUTES_KEY, String(Math.max(1, Math.min(120, v))));

// Arriving here means the session is over (or never started) — clear it so the
// in-game overlay does not fire on the next launch.
try {
  // Arriving here means a session just ended (or never started). Delete the
  // guest account it was using so throwaway profiles never accumulate.
  const prev = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  const stale = (prev && prev.guest) || localStorage.getItem('claudebox.user');
  if (stale && /^Guest\d{4}$/.test(stale)) {
    fetch('/api/playtest/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' },
      body: JSON.stringify({ name: stale }),
    }).catch(() => {});
    localStorage.removeItem('claudebox.user');
  }
  localStorage.removeItem(SESSION_KEY);
} catch {}

// ---------------------------------------------------------------- screens
let screen = 'start';
function show(name) {
  const from = $('#' + screen), to = $('#' + name);
  if (from === to) return;
  from.classList.add('out');
  from.classList.remove('on');
  setTimeout(() => from.classList.remove('out'), 600);
  to.classList.add('on');
  screen = name;
}

// ---------------------------------------------------------------- carousel
let index = 1;                       // start on the trending one
const rail = $('#rail');
const cards = [];

GAMES.forEach((g, i) => {
  const el = document.createElement('div');
  el.className = 'card3';
  el.innerHTML = `<div class="art"><img src="${g.art}" alt="${g.name}"></div>`
    + (g.trending ? `<div class="trend">🔥 TRENDING</div>` : '');
  el.addEventListener('click', () => { if (i === index) launch(); else go(i); });
  rail.appendChild(el);
  cards.push(el);
});

function layout() {
  cards.forEach((el, i) => {
    const d = i - index;
    el.className = 'card3 ' + (
      d === 0 ? 'center' : d === -1 ? 'left' : d === 1 ? 'right' : d < -1 ? 'far-left' : 'far-right');
  });
  const g = GAMES[index];
  const head = $('#pick-head');
  head.classList.add('swapping');
  setTimeout(() => {
    $('#pick-name').textContent = g.name;
    $('#pick-tag').textContent = g.tag;
    head.classList.remove('swapping');
  }, 180);
  [...$('#dots').children].forEach((d, i) => d.classList.toggle('on', i === index));
}

function go(i) {
  index = Math.max(0, Math.min(GAMES.length - 1, i));
  layout();
}
const next = () => go(index + 1);
const prev = () => go(index - 1);

$('#dots').innerHTML = GAMES.map(() => '<i></i>').join('');
$('#arrow-l').addEventListener('click', prev);
$('#arrow-r').addEventListener('click', next);
$('#play').addEventListener('click', launch);
layout();

// keyboard + swipe
addEventListener('keydown', (e) => {
  if ($('#lock').classList.contains('on') || $('#dev').classList.contains('on')) return;
  if (screen === 'start') { if (e.key) begin(); return; }
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'ArrowRight') next();
  if (e.key === 'Enter' || e.key === ' ') launch();
});
let swipeX = null;
rail.addEventListener('pointerdown', (e) => { swipeX = e.clientX; });
rail.addEventListener('pointerup', (e) => {
  if (swipeX == null) return;
  const dx = e.clientX - swipeX; swipeX = null;
  if (Math.abs(dx) > 45) { dx < 0 ? next() : prev(); }
});

// ---------------------------------------------------------------- start
function begin() { show('picker'); }
$('#start').addEventListener('click', begin);

// ---------------------------------------------------------------- launch
// Every playtest session plays as a fresh guest — nobody at a kiosk should be
// asked to sign in. The account is registered server-side first, otherwise the
// games look up an unknown user and bounce to the login page.
async function makeGuest() {
  const name = 'Guest' + (1000 + Math.floor(Math.random() * 9000));
  try {
    const r = await fetch('/api/playtest/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (j && j.ok && j.name) {
      localStorage.setItem('claudebox.user', j.name);
      return j.name;
    }
  } catch {}
  // even if the call failed, give the games a name to work with
  localStorage.setItem('claudebox.user', name);
  return name;
}

async function launch() {
  const g = GAMES[index];
  const mins = getMinutes();
  const guest = await makeGuest();
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      game: g.id, name: g.name, endsAt: Date.now() + mins * 60000, minutes: mins, guest,
    }));
  } catch {}

  // a short branded wipe so the jump into the game does not feel abrupt
  const wipe = document.createElement('div');
  wipe.id = 'wipe';
  wipe.innerHTML = `<div><div class="w-art"><img src="${g.art}" alt=""></div>
    <div class="w-name">${g.name}</div>
    <div class="w-sub">${mins} minute session &middot; playing as ${guest}</div></div>`;
  document.body.appendChild(wipe);
  requestAnimationFrame(() => wipe.classList.add('on'));
  setTimeout(() => { location.href = g.url; }, 900);
}

// ---------------------------------------------------------------- dev menu
const lock = $('#lock'), dev = $('#dev');
const openLock = () => { $('#pw').value = ''; $('#pw-err').textContent = ''; lock.classList.add('on'); setTimeout(() => $('#pw').focus(), 60); };
const closeLock = () => lock.classList.remove('on');

$('#gear').addEventListener('click', openLock);
$('#pw-cancel').addEventListener('click', closeLock);
$('#pw-go').addEventListener('click', tryUnlock);
$('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

function tryUnlock() {
  if ($('#pw').value === PASSWORD) { closeLock(); openDev(); return; }
  $('#pw-err').textContent = 'Wrong password';
  const c = lock.querySelector('.card');
  c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
}

function renderMinutes() {
  $('#mins-val').querySelector('b').textContent = getMinutes();
  [...$('#presets').children].forEach((b) => b.classList.toggle('on', +b.dataset.m === getMinutes()));
}
$('#presets').innerHTML = PRESETS.map((m) => `<button data-m="${m}">${m}m</button>`).join('');
[...$('#presets').children].forEach((b) => b.addEventListener('click', () => { setMinutes(+b.dataset.m); renderMinutes(); }));
$('#mins-up').addEventListener('click', () => { setMinutes(getMinutes() + 1); renderMinutes(); });
$('#mins-down').addEventListener('click', () => { setMinutes(getMinutes() - 1); renderMinutes(); });
$('#dev-close').addEventListener('click', () => dev.classList.remove('on'));
function openDev() { renderMinutes(); dev.classList.add('on'); }
