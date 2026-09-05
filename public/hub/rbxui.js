// ClaudeBox — "Roblox-true UI" chrome.
//
// This module owns ONLY the DOM that the Roblox layout needs and that the hub
// does not already have: the header's hamburger / text links / search, the
// left-nav user row, the two extra nav rows (Profile, Messages), the promo
// card, the per-page <h1>s and the footer. Everything else is the existing hub
// DOM restyled by rbxui.css — no render logic is duplicated here, so the games
// list, friends, store, avatar editor and overlays keep working exactly as they
// did and keep re-rendering into the same elements every 10 seconds.
//
// Anything injected carries class `rt-only`, which rbxui.css hides whenever the
// html[data-ui="roblox"] attribute is absent. That is what lets the setting be
// flipped live, without a reload, in both directions.

let ctx = null;          // { settings, stateHub, selectTab, openProfile, ... }
let built = false;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ icons -- */
// Foundation's nav icons are single-colour glyphs on a 32-unit grid rendered at
// 24px. Drawing them as 2-unit round strokes gives the same ~1.5px visual weight.
const svg = (body, size = 24) =>
  `<svg viewBox="0 0 32 32" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICON = {
  home:      svg('<path d="M4 14 16 4l12 10"/><path d="M7 12.5V26a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V12.5"/><path d="M13 27v-7h6v7"/>'),
  profile:   svg('<circle cx="16" cy="11" r="5"/><path d="M6 27c0-5 4.5-8 10-8s10 3 10 8"/>'),
  messages:  svg('<rect x="4" y="7" width="24" height="16" rx="4"/><path d="M12 27v-4"/><path d="M11 13h10M11 17h6"/>'),
  friends:   svg('<circle cx="12" cy="11" r="4.5"/><path d="M4 26c0-4.4 3.6-7 8-7s8 2.6 8 7"/><path d="M21 7.5a4.5 4.5 0 0 1 0 9"/><path d="M23 19.5c3 .8 5 3.2 5 6.5"/>'),
  avatar:    svg('<rect x="12" y="3" width="8" height="8" rx="1.5"/><path d="M9 13h14v9H9z"/><path d="M9 15H5v7M23 15h4v7"/><path d="M13 22v7M19 22v7"/>'),
  store:     svg('<path d="M5 12h22l-1.5-6h-19L5 12z"/><path d="M7 12v14a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V12"/><path d="M13 27v-8h6v8"/>'),
  bux:       svg('<path d="M16 3 28 9.5v13L16 29 4 22.5v-13L16 3z"/><path d="m16 11 5 2.8v5.4L16 22l-5-2.8v-5.4L16 11z"/>'),
  gear:      svg('<circle cx="16" cy="16" r="4.6"/><path d="M25.3 19.3a1.9 1.9 0 0 0 .4 2.1l.1.1a2.3 2.3 0 1 1-3.3 3.3l-.1-.1a1.9 1.9 0 0 0-2.1-.4 1.9 1.9 0 0 0-1.2 1.8v.3a2.3 2.3 0 1 1-4.6 0V26a1.9 1.9 0 0 0-1.3-1.8 1.9 1.9 0 0 0-2.1.4l-.1.1a2.3 2.3 0 1 1-3.3-3.3l.1-.1a1.9 1.9 0 0 0 .4-2.1 1.9 1.9 0 0 0-1.8-1.2H6a2.3 2.3 0 1 1 0-4.6h.2A1.9 1.9 0 0 0 8 12.2a1.9 1.9 0 0 0-.4-2.1l-.1-.1a2.3 2.3 0 1 1 3.3-3.3l.1.1a1.9 1.9 0 0 0 2.1.4h.2a1.9 1.9 0 0 0 1.2-1.8V5a2.3 2.3 0 1 1 4.6 0v.2a1.9 1.9 0 0 0 1.2 1.8 1.9 1.9 0 0 0 2.1-.4l.1-.1a2.3 2.3 0 1 1 3.3 3.3l-.1.1a1.9 1.9 0 0 0-.4 2.1v.2a1.9 1.9 0 0 0 1.8 1.2h.3a2.3 2.3 0 1 1 0 4.6H26a1.9 1.9 0 0 0-1.8 1.2z"/>'),
  bell:      svg('<path d="M8 22V14a8 8 0 0 1 16 0v8l2.5 3h-21L8 22z"/><path d="M13 25a3 3 0 0 0 6 0"/>'),
  search:    svg('<circle cx="14" cy="14" r="8.5"/><path d="m20.5 20.5 6 6"/>'),
  menu:      svg('<path d="M6 10h20M6 16h20M6 22h20"/>'),
  chevron:   svg('<path d="m10 13 6 6 6-6"/>'),
  plus:      svg('<path d="M16 4 28 10.4v11.2L16 28 4 21.6V10.4L16 4z"/><path d="M16 11v10M11 16h10"/>'),
  play:      svg('<circle cx="16" cy="16" r="12"/><path d="m13 11 8 5-8 5V11z"/>'),
  bag:       svg('<path d="M6 11h20l-1.5 15a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2L6 11z"/><path d="M11 13V9a5 5 0 0 1 10 0v4"/>'),
  hammer:    svg('<path d="M14 6 8 12l4 4 6-6"/><path d="m16 10 8 8-4 4-8-8"/><path d="m6 26 6-6"/>'),
  close:     svg('<circle cx="16" cy="16" r="11"/><path d="m12 12 8 8M20 12l-8 8"/>'),
  thumb:     svg('<path d="M9 28V14l6-9a3 3 0 0 1 3 3v5h7a3 3 0 0 1 3 3.5l-1.8 9A3 3 0 0 1 23 28H9z"/><path d="M9 14H4v14h5"/>'),
  person1:   svg('<circle cx="16" cy="10" r="5"/><path d="M6 28c0-5.5 4.5-9 10-9s10 3.5 10 9"/>'),
  gamepad:   svg('<path d="M11 13H8a5 5 0 0 0-5 5v4a4 4 0 0 0 7 2.8l1.6-1.8h8.8l1.6 1.8A4 4 0 0 0 29 22v-4a5 5 0 0 0-5-5h-3"/><path d="M9.5 18h3M11 16.5v3M21 17.5h.01M23.5 20h.01"/>'),
};

/* -------------------------------------------------------------- utilities -- */
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

// Swap an element's markup while remembering the original, so turning the
// setting off restores the hub exactly as it was.
function stash(node, key, next) {
  if (!node) return;
  if (node.dataset[key] === undefined) node.dataset[key] = node.innerHTML;
  node.innerHTML = next;
}
function unstash(node, key) {
  if (!node || node.dataset[key] === undefined) return;
  node.innerHTML = node.dataset[key];
  delete node.dataset[key];
}
function stashText(node, key, next) {
  if (!node) return;
  if (node.dataset[key] === undefined) node.dataset[key] = node.textContent;
  node.textContent = next;
}
function unstashText(node, key) {
  if (!node || node.dataset[key] === undefined) return;
  node.textContent = node.dataset[key];
  delete node.dataset[key];
}

/* ---------------------------------------------------------------- toggling -- */
export function applyRbxUi() {
  // hub.js calls applyTheme() at module scope, before initRbxUi() has run. Bail
  // out until we have context so the pre-paint attribute is left alone.
  if (!ctx) return;
  const on = !!ctx.settings.robloxUI;
  const html = document.documentElement;
  if (on) html.setAttribute('data-ui', 'roblox');
  else html.removeAttribute('data-ui');

  // keep the iOS status bar / PWA chrome in step with the page background
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = html.getAttribute('data-theme') === 'dark';
    meta.setAttribute('content', on ? (dark ? '#121215' : '#ffffff') : '#0a0b0f');
  }

  if (on) { build(); decorate(); }
  else { undecorate(); closeDrawer(); }
  syncRbxUi();
}

/* ----------------------------------------------------------------- build --- */
// Injects the Roblox-only chrome. Idempotent: safe to call on every toggle.
function build() {
  if (built) return;
  built = true;

  const topbar = $('topbar');
  const tabs = $('tabs');
  if (!topbar || !tabs) return;

  /* --- header: hamburger ------------------------------------------------ */
  const menu = el('button', 'rt-only');
  menu.id = 'rt-menu';
  menu.type = 'button';
  menu.setAttribute('aria-label', 'Menu');
  menu.innerHTML = ICON.menu;
  menu.addEventListener('click', (e) => { e.stopPropagation(); toggleDrawer(); });
  topbar.insertBefore(menu, topbar.firstChild);

  /* --- header: text links ----------------------------------------------- */
  const TOPNAV = [
    { label: 'Charts', go: () => { ctx.selectTab('home'); scrollTo('popular-row'); } },
    { label: 'Marketplace', go: () => ctx.selectTab('store') },
    { label: 'Create', go: () => { window.location.href = '/studio'; } },
    { label: 'ClaudeBux', go: () => ctx.selectTab('rewards') },
  ];
  const topnav = el('ul', 'rt-topnav rt-only');
  topnav.id = 'rt-topnav';
  for (const item of TOPNAV) {
    const li = el('li');
    const b = el('button', null, item.label);
    b.type = 'button';
    b.addEventListener('click', item.go);
    li.appendChild(b);
    topnav.appendChild(li);
  }
  topbar.insertBefore(topnav, tabs);

  /* --- header: search --------------------------------------------------- */
  const search = el('form', 'rt-search rt-only');
  search.id = 'rt-search';
  search.innerHTML = `<span class="rt-search-ico">${ICON.search}</span>` +
    '<input type="search" id="rt-search-input" placeholder="Search" autocomplete="off" maxlength="120">';
  search.addEventListener('submit', (e) => e.preventDefault());
  const input = search.querySelector('input');
  // mirror into the home page's own search box so hub.js does the filtering
  input.addEventListener('input', () => {
    const target = $('game-search');
    if (!target) return;
    target.value = input.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    if (input.value) ctx.selectTab('home');
  });
  topbar.insertBefore(search, tabs);

  buildSearchPanel(search, input);

  // the ≤543px search button that expands the bar
  const sbtn = el('button', 'rt-hbtn rt-only');
  sbtn.id = 'rt-search-btn';
  sbtn.type = 'button';
  sbtn.setAttribute('aria-label', 'Search');
  sbtn.innerHTML = ICON.search;
  sbtn.addEventListener('click', () => {
    search.classList.toggle('rt-shown');
    if (search.classList.contains('rt-shown')) input.focus();
  });
  const right = topbar.querySelector('.top-right');
  if (right) right.insertBefore(sbtn, right.firstChild);

  // Roblox's header ends with a settings gear; ClaudeBox's settings are a tab
  const gear = el('button', 'rt-hbtn rt-only');
  gear.id = 'rt-gear';
  gear.type = 'button';
  gear.setAttribute('aria-label', 'Settings');
  gear.innerHTML = ICON.gear.replace('width="24" height="24"', 'width="28" height="28"');
  gear.addEventListener('click', () => ctx.selectTab('settings'));
  if (right) right.appendChild(gear);

  /* --- left nav: user row ----------------------------------------------- */
  const user = el('button', 'rt-nav-user rt-only');
  user.id = 'rt-nav-user';
  user.type = 'button';
  user.innerHTML =
    '<span class="rt-ico-slot"><canvas class="rt-nav-avatar" id="rt-nav-thumb" width="48" height="48"></canvas></span>' +
    '<span class="rt-nav-label" id="rt-nav-username">…</span>' +
    '<span class="rt-nav-trail"><span class="rt-pill" id="rt-nav-userpill">Player</span></span>';
  user.addEventListener('click', () => {
    if (ctx.stateHub.me && ctx.stateHub.me.name) ctx.openProfile(ctx.stateHub.me.name);
  });
  tabs.appendChild(user);

  /* --- left nav: rows that are overlays, not tabs ------------------------ */
  const profileRow = navLink('rt-profile', ICON.profile, 'Profile', () => {
    if (ctx.stateHub.me && ctx.stateHub.me.name) ctx.openProfile(ctx.stateHub.me.name);
  });
  const messagesRow = navLink('rt-messages', ICON.messages, 'Messages', () => ctx.openDMs());
  messagesRow.querySelector('.rt-nav-trail').innerHTML =
    '<span class="rt-pill rt-pill-contrast rt-hidden" id="rt-msg-count">0</span>';
  tabs.appendChild(profileRow);
  tabs.appendChild(messagesRow);

  /* --- left nav: promo card --------------------------------------------- */
  const promo = el('button', 'rt-navpromo rt-only');
  promo.type = 'button';
  promo.innerHTML =
    ICON.plus.replace('width="24" height="24"', 'width="20" height="20"') +
    '<span>Earn Credits in every game, then turn them into ClaudeBux.</span>' +
    '<span class="rt-navpromo-link">See challenges</span>';
  promo.addEventListener('click', () => ctx.selectTab('rewards'));
  tabs.appendChild(promo);

  /* --- page headings ----------------------------------------------------- */
  addPageHead('tab-home', 'Home');
  addPageHead('tab-rewards', 'ClaudeBux');
  addPageHead('tab-connect', 'Friends');
  addPageHead('tab-settings', 'Settings');

  /* --- footer ------------------------------------------------------------ */
  buildFooter();

  /* --- drawer dismissal -------------------------------------------------- */
  document.addEventListener('click', (e) => {
    if (!tabs.classList.contains('rt-open')) return;
    if (e.target.closest('#tabs') || e.target.closest('#rt-menu')) return;
    closeDrawer();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  // picking a page on mobile closes the drawer
  tabs.addEventListener('click', (e) => {
    if (e.target.closest('.tab, .rt-nav-link') && window.innerWidth <= 1140) closeDrawer();
  });
}


/* ---------------------------------------------------------- search panel -- */
// Roblox's header search opens a panel: with an empty box it browses (Recently
// Visited + "Try searching for"), and as soon as you type it becomes a list of
// "<query> in <Category>" rows. Both states are reproduced here, wired to the
// pages ClaudeBox actually has.
let spEl = null, spRows = [], spSel = -1;

function buildSearchPanel(form, input) {
  spEl = el('div', 'rt-sp rt-only');
  spEl.hidden = true;
  spEl.innerHTML = '<div class="rt-sp-browse"></div><ul class="rt-sp-list"></ul>';
  form.appendChild(spEl);

  const clear = el('button', 'rt-sp-clear rt-only');
  clear.type = 'button';
  clear.setAttribute('aria-label', 'Clear search');
  clear.innerHTML = ICON.close.replace('width="24" height="24"', 'width="20" height="20"');
  clear.addEventListener('mousedown', (e) => e.preventDefault());
  clear.addEventListener('click', () => {
    input.value = '';
    mirrorSearch('');
    input.focus();
    renderSearchPanel(input);
  });
  form.appendChild(clear);

  input.addEventListener('focus', () => renderSearchPanel(input));
  input.addEventListener('input', () => renderSearchPanel(input));
  input.addEventListener('keydown', (e) => onSearchKey(e, input));
  // a click anywhere else closes it; mousedown inside the panel must not blur
  spEl.addEventListener('mousedown', (e) => e.preventDefault());
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#rt-search')) closeSearchPanel();
  });
}

function mirrorSearch(v) {
  const target = $('game-search');
  if (!target) return;
  target.value = v;
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function closeSearchPanel() {
  if (spEl) spEl.hidden = true;
  spSel = -1;
}

function onSearchKey(e, input) {
  if (e.key === 'Escape') { closeSearchPanel(); input.blur(); return; }
  if (!spEl || spEl.hidden || !spRows.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    spSel = (spSel + (e.key === 'ArrowDown' ? 1 : -1) + spRows.length) % spRows.length;
    paintSearchSel();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    (spRows[spSel < 0 ? 0 : spSel] || {}).go?.();
    closeSearchPanel();
    input.blur();
  }
}

function paintSearchSel() {
  const items = spEl.querySelectorAll('.rt-sp-row');
  items.forEach((n, i) => n.classList.toggle('on', i === spSel));
}

function renderSearchPanel(input) {
  if (!spEl) return;
  const q = input.value.trim();
  const browse = spEl.querySelector('.rt-sp-browse');
  const list = spEl.querySelector('.rt-sp-list');
  spEl.hidden = false;
  spEl.classList.toggle('rt-sp-wide', !q);
  document.getElementById('rt-search').classList.toggle('rt-has-text', !!input.value);
  spSel = -1;
  spRows = [];

  if (!q) { list.innerHTML = ''; list.hidden = true; browse.hidden = false; renderBrowse(browse, input); return; }
  browse.hidden = true; browse.innerHTML = ''; list.hidden = false;

  const games = (ctx.stateHub.games || []).filter((g) => g.playable);
  const hits = games.filter((g) => g.title.toLowerCase().includes(q.toLowerCase())).slice(0, 4);

  spRows = [
    { icon: 'play', text: q, cat: 'Games', go: () => { ctx.selectTab('home'); mirrorSearch(q); } },
    ...hits.map((g) => ({ icon: 'play', text: g.title, cat: 'Games', go: () => ctx.openGameDetail(g) })),
    { icon: 'person1', text: q, cat: 'People', go: () => { ctx.selectTab('connect'); const a = $('add-input'); if (a) { a.value = q; a.dispatchEvent(new Event('input', { bubbles: true })); a.focus(); } } },
    { icon: 'bag', text: q, cat: 'Marketplace', go: () => ctx.selectTab('store') },
    { icon: 'hammer', text: q, cat: 'Studio', go: () => { window.location.href = '/studio'; } },
  ];

  list.innerHTML = '';
  spRows.forEach((r, i) => {
    const li = el('li', 'rt-sp-row');
    li.innerHTML = `<span class="rt-sp-ico">${ICON[r.icon]}</span>` +
      `<span class="rt-sp-txt"><b></b> <i>in ${r.cat}</i></span>`;
    li.querySelector('b').textContent = r.text;
    li.addEventListener('mouseenter', () => { spSel = i; paintSearchSel(); });
    li.addEventListener('click', () => { r.go(); closeSearchPanel(); input.blur(); });
    list.appendChild(li);
  });
  spSel = 0;
  paintSearchSel();
}

function renderBrowse(host, input) {
  const games = (ctx.stateHub.games || []).filter((g) => g.playable);
  const me = ctx.stateHub.me || {};
  let recents = (me.recentGames || []).map((id) => games.find((g) => g.id === id)).filter(Boolean);
  if (recents.length < 5) {
    // pad with the most-played so the shelf is never nearly empty
    for (const g of [...games].sort((a, b) => (b.plays || 0) - (a.plays || 0))) {
      if (recents.length >= 6) break;
      if (!recents.includes(g)) recents.push(g);
    }
  }
  recents = recents.slice(0, 6);

  const tags = new Set();
  for (const g of games) (g.tags || []).forEach((t) => tags.add(t));
  const chips = [...tags].sort().slice(0, 12);

  host.innerHTML = '<h3>Recently Visited</h3><div class="rt-sp-cards"></div>' +
    '<h3>Try searching for</h3><div class="rt-sp-chips"></div>';

  const cards = host.querySelector('.rt-sp-cards');
  for (const g of recents) {
    const c = el('button', 'rt-sp-card');
    c.type = 'button';
    const art = el('span', 'rt-sp-art');
    if (g.art) art.style.backgroundImage = `url("${g.art}")`;
    const pct = ctx.approvalPct ? ctx.approvalPct(g) : null;
    const players = ctx.playerCountFor ? ctx.playerCountFor(g.id) : 0;
    const count = players > 0 ? players : (g.plays || 0);
    c.appendChild(art);
    const t = el('span', 'rt-sp-cardtitle'); t.textContent = g.title; c.appendChild(t);
    const meta = el('span', 'rt-sp-meta');
    meta.innerHTML =
      (pct != null ? `<span>${ICON.thumb.replace('width="24" height="24"', 'width="16" height="16"')}${pct}%</span>` : '') +
      `<span>${ICON.person1.replace('width="24" height="24"', 'width="16" height="16"')}${ctx.fmtNum(count)}</span>`;
    c.appendChild(meta);
    c.addEventListener('click', () => { ctx.openGameDetail(g); closeSearchPanel(); input.blur(); });
    cards.appendChild(c);
  }

  const chipHost = host.querySelector('.rt-sp-chips');
  for (const t of chips) {
    const b = el('button', 'rt-sp-chip', t);
    b.type = 'button';
    b.addEventListener('click', () => {
      input.value = t;
      mirrorSearch(t);
      ctx.selectTab('home');
      renderSearchPanel(input);
      input.focus();
    });
    chipHost.appendChild(b);
  }
}


/* ------------------------------------------------------- friend hover card -- */
// Roblox shows a card under a friend's avatar: "<name> is playing <Game>", a
// Join button and View Profile. The friends row is innerHTML-wiped by
// renderFriends() every 10s, so this re-decorates from syncRbxUi() each pass;
// the card itself lives on <body> and is reused.
let fcard = null, fcardTimer = null;

function friendCardEl() {
  if (fcard) return fcard;
  fcard = el('div', 'rt-fcard rt-only');
  fcard.hidden = true;
  fcard.addEventListener('mouseenter', () => clearTimeout(fcardTimer));
  fcard.addEventListener('mouseleave', hideFriendCard);
  document.body.appendChild(fcard);
  return fcard;
}
function hideFriendCard() {
  clearTimeout(fcardTimer);
  fcardTimer = setTimeout(() => { if (fcard) fcard.hidden = true; }, 120);
}
function showFriendCard(anchor, friend, game) {
  clearTimeout(fcardTimer);
  const c = friendCardEl();
  const name = friend.name;
  c.innerHTML = '';

  if (game) {
    const top = el('div', 'rt-fcard-top');
    const art = el('span', 'rt-fcard-art');
    if (game.art) art.style.backgroundImage = `url("${game.art}")`;
    const txt = el('div', 'rt-fcard-txt');
    const who = el('div', 'rt-fcard-who');
    who.innerHTML = '<b></b> is playing';
    who.querySelector('b').textContent = name;
    const gt = el('div', 'rt-fcard-game');
    gt.textContent = game.title;
    txt.append(who, gt);
    top.append(art, txt);
    c.appendChild(top);

    const join = el('button', 'rt-fcard-join', 'Join');
    join.type = 'button';
    join.addEventListener('click', () => { hideFriendCardNow(); ctx.launchGame(game.id); });
    c.appendChild(join);
  } else {
    const top = el('div', 'rt-fcard-top rt-fcard-top-plain');
    const txt = el('div', 'rt-fcard-txt');
    const who = el('div', 'rt-fcard-who');
    who.innerHTML = '<b></b>';
    who.querySelector('b').textContent = name;
    const gt = el('div', 'rt-fcard-game rt-fcard-quiet');
    gt.textContent = friend.status === 'hub' ? 'Online' : 'Offline';
    txt.append(who, gt);
    top.appendChild(txt);
    c.appendChild(top);
  }

  const prof = el('button', 'rt-fcard-prof', 'View Profile');
  prof.type = 'button';
  prof.addEventListener('click', () => { hideFriendCardNow(); ctx.openProfile(name); });
  c.appendChild(prof);

  c.hidden = false;
  // anchor under the avatar, clamped to the viewport
  const r = anchor.getBoundingClientRect();
  const w = c.offsetWidth || 300;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
  let top = r.bottom + 8;
  if (top + c.offsetHeight > window.innerHeight - 12) top = Math.max(12, r.top - c.offsetHeight - 8);
  c.style.left = left + 'px';
  c.style.top = top + 'px';
}
function hideFriendCardNow() { clearTimeout(fcardTimer); if (fcard) fcard.hidden = true; }

function decorateFriends() {
  const row = $('friends-row');
  if (!row) return;
  const byName = new Map((ctx.stateHub.friends || []).map((f) => [f.name, f]));
  const games = ctx.stateHub.games || [];
  for (const node of row.querySelectorAll('.friend-circle')) {
    if (node.classList.contains('add-circle')) continue;
    const nameEl = node.querySelector('.fname');
    const friend = byName.get(nameEl ? nameEl.textContent : '');
    if (!friend) continue;
    const gid = String(friend.status || '').startsWith('game:') ? friend.status.slice(5) : null;
    const game = gid ? games.find((g) => g.id === gid) : null;

    // the status line names the game rather than saying "in a game"
    const st = node.querySelector('.fstatus');
    if (st && game) st.textContent = game.title;

    // green controller badge while in a game
    const ring = node.querySelector('.fc-ring');
    if (ring && game && !ring.querySelector('.rt-fc-badge')) {
      const b = el('span', 'rt-fc-badge rt-only', ICON.gamepad.replace('width="24" height="24"', 'width="18" height="18"'));
      ring.appendChild(b);
    }

    if (node.dataset.rtHover) continue;
    node.dataset.rtHover = '1';
    node.addEventListener('mouseenter', () => {
      const f2 = byName.get(nameEl ? nameEl.textContent : '') || friend;
      const g2 = String(f2.status || '').startsWith('game:')
        ? (ctx.stateHub.games || []).find((g) => g.id === f2.status.slice(5)) : null;
      showFriendCard(node, f2, g2);
    });
    node.addEventListener('mouseleave', hideFriendCard);
  }
}

function navLink(id, icon, label, onClick) {
  const b = el('button', 'rt-nav-link rt-only');
  b.id = id;
  b.type = 'button';
  b.innerHTML = `<span class="rt-ico-slot">${icon}</span>` +
    `<span class="rt-nav-label">${label}</span><span class="rt-nav-trail"></span>`;
  b.addEventListener('click', onClick);
  return b;
}

function addPageHead(sectionId, title) {
  const sec = $(sectionId);
  if (!sec || sec.querySelector('.rt-pagehead')) return;
  const head = el('div', 'rt-pagehead rt-only', `<h1>${title}</h1>`);
  sec.insertBefore(head, sec.firstChild);
}

function buildFooter() {
  if ($('rt-footer')) return;
  const main = document.querySelector('main');
  if (!main) return;
  const LINKS = [
    ['About ClaudeBox', () => ctx.selectTab('home')],
    ['Studio', () => { window.location.href = '/studio'; }],
    ['Games', () => ctx.selectTab('home')],
    ['Marketplace', () => ctx.selectTab('store')],
    ['Avatar', () => ctx.selectTab('avatar')],
    ['Friends', () => ctx.selectTab('connect')],
    ['ClaudeBux', () => ctx.selectTab('rewards')],
    ['Settings', () => ctx.selectTab('settings')],
    ['Help', () => ctx.toast('ClaudeBox runs on your own network — ask whoever set it up.', 'ℹ️')],
  ];
  const f = el('footer', 'rt-footer rt-only');
  f.id = 'rt-footer';
  const inner = el('div', 'rt-footer-inner');
  const ul = el('ul', 'rt-footer-links');
  for (const [label, go] of LINKS) {
    const li = el('li');
    const a = el('a', null, label);
    a.setAttribute('role', 'button');
    a.addEventListener('click', go);
    li.appendChild(a);
    ul.appendChild(li);
  }
  const bottom = el('div', 'rt-footer-bottom');
  bottom.innerHTML =
    '<div class="rt-footer-lang"><div class="rt-select"><span>English (United States)</span>' +
    ICON.chevron.replace('width="24" height="24"', 'width="20" height="20"') + '</div></div>' +
    `<p class="rt-footer-note">©${new Date().getFullYear()} ClaudeBox. ClaudeBox is a private game platform ` +
    'built for friends and family. Not affiliated with, endorsed by, or connected to Roblox Corporation.</p>';
  inner.appendChild(ul);
  inner.appendChild(bottom);
  f.appendChild(inner);
  main.parentNode.insertBefore(f, main.nextSibling);
}

/* ------------------------------------------------------- decorate / undo --- */
// Swaps emoji glyphs for Foundation-style icons and renames two tabs. Reversed
// by undecorate() so flipping the setting off restores the original hub.
const TAB_ICON = { home: 'home', rewards: 'bux', avatar: 'avatar', store: 'store', connect: 'friends', settings: 'gear' };
const TAB_LABEL = { store: 'Marketplace', rewards: 'ClaudeBux' };

function decorate() {
  for (const tab of document.querySelectorAll('#tabs .tab')) {
    const key = tab.dataset.tab;
    const ti = tab.querySelector('.ti');
    if (ti && ICON[TAB_ICON[key]]) stash(ti, 'rtIcon', ICON[TAB_ICON[key]]);
    const tl = tab.querySelector('.tl');
    if (tl && TAB_LABEL[key]) stashText(tl, 'rtLabel', TAB_LABEL[key]);
  }
  // header icon buttons: keep the live #dm-badge node, swap the emoji for an icon
  const dm = $('dm-btn');
  if (dm && !dm.querySelector('svg')) {
    const badge = $('dm-badge');
    if (dm.dataset.rtIcon === undefined) dm.dataset.rtIcon = dm.innerHTML;
    dm.innerHTML = ICON.bell;
    if (badge) dm.appendChild(badge);
  }
  // wordmark next to the logo
  const brand = document.querySelector('#topbar .brand');
  if (brand && !brand.querySelector('.rt-wordmark')) {
    brand.appendChild(el('span', 'rt-wordmark rt-only', 'ClaudeBox'));
  }
}

function undecorate() {
  for (const tab of document.querySelectorAll('#tabs .tab')) {
    unstash(tab.querySelector('.ti'), 'rtIcon');
    unstashText(tab.querySelector('.tl'), 'rtLabel');
  }
  const dm = $('dm-btn');
  if (dm && dm.dataset.rtIcon !== undefined) {
    const badge = $('dm-badge');
    dm.innerHTML = dm.dataset.rtIcon;
    delete dm.dataset.rtIcon;
    // the restored markup contains a stale badge; put the live node back
    const stale = dm.querySelector('#dm-badge');
    if (stale && badge && stale !== badge) stale.replaceWith(badge);
  }
}

/* ----------------------------------------------------------------- drawer -- */
function toggleDrawer() {
  const tabs = $('tabs');
  if (!tabs) return;
  tabs.classList.contains('rt-open') ? closeDrawer() : openDrawer();
}
function openDrawer() {
  const tabs = $('tabs');
  if (!tabs) return;
  tabs.classList.add('rt-open');
  if (!$('rt-scrim')) {
    const s = el('div', 'rt-scrim rt-only');
    s.id = 'rt-scrim';
    s.addEventListener('click', closeDrawer);
    document.body.appendChild(s);
  }
}
function closeDrawer() {
  const tabs = $('tabs');
  if (tabs) tabs.classList.remove('rt-open');
  const s = $('rt-scrim');
  if (s) s.remove();
}

function scrollTo(id) {
  const n = $(id);
  if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ------------------------------------------------------------------- sync -- */
// Cheap; called after every hub render so derived text stays in step.
export function syncRbxUi() {
  if (!ctx || !built) return;
  if (!ctx.settings.robloxUI) return;

  const me = ctx.stateHub.me;
  if (me) {
    const nameEl = $('rt-nav-username');
    if (nameEl) nameEl.textContent = me.name || '…';
    const thumb = $('rt-nav-thumb');
    if (thumb && me.avatar) { try { ctx.thumbInto(thumb, me.avatar); } catch {} }
    const pill = $('rt-nav-userpill');
    if (pill) {
      const title = (ctx.wallet() || {}).title;
      pill.textContent = title || 'Player';
    }
  }

  // messages count mirrors the header badge
  const badge = $('dm-badge');
  const count = $('rt-msg-count');
  if (count && badge) {
    const n = (badge.textContent || '').trim();
    const show = !badge.classList.contains('hidden') && n && n !== '0';
    count.textContent = n;
    count.classList.toggle('rt-hidden', !show);
  }

  decorateFriends();

  // keep the mirrored search boxes in step (e.g. after a chip reset)
  const gs = $('game-search');
  const rs = $('rt-search-input');
  if (gs && rs && document.activeElement !== rs && rs.value !== gs.value) rs.value = gs.value;
}

/* ------------------------------------------------------------------- init -- */
export function initRbxUi(context) {
  ctx = context;
  applyRbxUi();
  window.addEventListener('resize', () => { if (window.innerWidth > 1140) closeDrawer(); });
}
