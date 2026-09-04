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
