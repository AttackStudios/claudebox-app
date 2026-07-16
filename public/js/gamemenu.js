// ClaudeBox in-game menu — a Roblox-style pause/menu injected into EVERY game
// (loaded by /js/claudebox.js). Top-left logo button opens it. Games can add
// hooks via ClaudeBox.registerGame({ players, resetCharacter, keybinds, help }).
(function () {
  if (window.__cbxMenu) return; window.__cbxMenu = true;

  const CB = (window.ClaudeBox = window.ClaudeBox || {});
  const meName = () => { let n = localStorage.getItem('claudebox.user') || (CB.getName && CB.getName()); if (!n) { try { n = JSON.parse(localStorage.getItem('featherfriends.lastProfile') || '{}').name; } catch {} } return n || ''; };
  const code = () => localStorage.getItem('claudebox.code') || '';
  const post = (p, b) => fetch('/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cbx-code': code() }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => ({}));
  const getJSON = (p) => fetch('/api' + p, { headers: { 'x-cbx-code': code() } }).then((r) => r.json()).catch(() => null);
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const dot = (name) => `<span class="cbx-dot" style="background:hsl(${hue(name)} 55% 45%)">${esc((name[0] || '?').toUpperCase())}</span>`;

  // ---- settings (persisted, exposed for games to read) ----
  const SKEY = 'claudebox.settings';
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch {}
  const settings = Object.assign({ fov: 78, sensitivity: 1.0, volume: 1.0 }, saved);
  const setCbs = [];
  CB.settings = settings;
  CB.onSettingsChange = (fn) => { setCbs.push(fn); try { fn(settings); } catch {} };
  function commitSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} setCbs.forEach((f) => { try { f(settings); } catch {} }); }

  // ---- game hooks ----
  let game = {};
  CB.registerGame = (opts) => { game = Object.assign(game, opts || {}); if (!menu.classList.contains('hidden')) render(); };
  CB.openMenu = () => open();

  // ---- styles ----
  const style = document.createElement('style');
  style.textContent = `
  #cbx-menu-btn{position:fixed;top:12px;left:12px;z-index:100000;width:46px;height:46px;padding:7px;border:none;border-radius:13px;
    background:rgba(20,24,34,.72);backdrop-filter:blur(10px);box-shadow:0 4px 16px rgba(0,0,0,.45);cursor:pointer;transition:transform .12s,background .15s;-webkit-appearance:none;}
  #cbx-menu-btn:hover{background:rgba(30,36,50,.85);transform:translateY(-1px);}
  #cbx-menu-btn:active{transform:scale(.94);}
  #cbx-menu-btn img{width:100%;height:100%;display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));pointer-events:none;}
  #cbx-menu{position:fixed;inset:0;z-index:100001;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;
    background:rgba(6,8,14,.55);backdrop-filter:blur(6px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e9edf5;overflow-y:auto;}
  #cbx-menu.hidden{display:none;}
  .cbx-card{width:min(900px,96vw);margin:auto;background:rgba(22,26,36,.94);border:1px solid rgba(255,255,255,.08);border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column;max-height:92vh;}
  .cbx-tabs{display:flex;gap:4px;padding:12px 14px 0;border-bottom:1px solid rgba(255,255,255,.07);}
  .cbx-tab{flex:1;background:none;border:none;color:#9aa4b8;font-size:15px;font-weight:700;padding:12px 6px 14px;cursor:pointer;border-bottom:3px solid transparent;display:flex;align-items:center;justify-content:center;gap:8px;}
  .cbx-tab .ti{font-size:17px;}
  .cbx-tab.sel{color:#fff;border-bottom-color:#4a9eff;}
  .cbx-body{padding:16px;overflow-y:auto;}
  .cbx-close{position:absolute;top:16px;right:18px;background:none;border:none;color:#9aa4b8;font-size:22px;cursor:pointer;z-index:2;}
  .cbx-row{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.04);border-radius:12px;padding:10px 12px;margin-bottom:8px;}
  .cbx-row:hover{background:rgba(255,255,255,.07);}
  .cbx-dot{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:16px;color:#fff;flex:0 0 auto;}
  .cbx-nm{flex:1;min-width:0;}
  .cbx-nm b{display:block;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cbx-nm small{color:#8a94a8;font-size:12px;}
  .cbx-badge{display:inline-block;width:15px;height:15px;vertical-align:-2px;margin-left:4px;}
  .cbx-ib{background:rgba(255,255,255,.08);border:none;color:#cfd6e4;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:15px;flex:0 0 auto;}
  .cbx-ib:hover{background:rgba(255,255,255,.16);}
  .cbx-add{background:#2f6fed;border:none;color:#fff;font-weight:700;font-size:13px;padding:8px 14px;border-radius:9px;cursor:pointer;flex:0 0 auto;}
  .cbx-add:hover{background:#3f7ffd;} .cbx-add.done{background:rgba(255,255,255,.12);color:#9aa4b8;cursor:default;}
  .cbx-invite{width:100%;justify-content:flex-start;gap:12px;cursor:pointer;}
  .cbx-invite .cbx-dot{background:rgba(74,158,255,.25);color:#7fbcff;}
  .cbx-foot{display:flex;gap:12px;justify-content:center;padding:14px;border-top:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.15);}
  .cbx-foot button{display:flex;flex-direction:column;align-items:center;gap:5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#e9edf5;border-radius:13px;padding:12px 26px;cursor:pointer;font-weight:600;font-size:12px;min-width:120px;}
  .cbx-foot .em{font-size:22px;}
  .cbx-foot .leave:hover{background:rgba(224,80,60,.25);border-color:rgba(224,80,60,.5);}
  .cbx-foot .reset:hover{background:rgba(74,158,255,.22);border-color:rgba(74,158,255,.5);}
  .cbx-set{margin-bottom:20px;}
  .cbx-set label{display:block;font-weight:700;margin-bottom:8px;color:#dfe5f0;}
  .cbx-set label span{float:right;color:#7fbcff;font-variant-numeric:tabular-nums;}
  .cbx-set input[type=range]{width:100%;accent-color:#4a9eff;}
  .cbx-kb{display:flex;justify-content:space-between;padding:9px 12px;background:rgba(255,255,255,.04);border-radius:9px;margin-bottom:6px;font-size:14px;}
  .cbx-kb kbd{background:rgba(255,255,255,.12);border-radius:6px;padding:2px 9px;font-family:inherit;font-weight:700;color:#fff;}
  .cbx-h{font-size:13px;color:#9aa4b8;margin:2px 0 12px;}
  .cbx-sel,.cbx-inp{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:11px 12px;font-size:14px;margin-bottom:12px;}
  .cbx-primary{width:100%;background:#e0503c;border:none;color:#fff;font-weight:800;font-size:15px;padding:13px;border-radius:12px;cursor:pointer;}
  .cbx-empty{color:#8a94a8;text-align:center;padding:30px;}
  @media(max-width:640px){.cbx-tab{font-size:13px;} .cbx-tab .tl{display:none;} .cbx-add{padding:8px 10px;} .cbx-foot button{min-width:90px;padding:10px 14px;}}
  `;
  document.head.appendChild(style);

  // ---- button ----
  const btn = document.createElement('button');
  btn.id = 'cbx-menu-btn'; btn.title = 'Menu (Esc)';
  btn.innerHTML = '<img src="/icons/logo-mark.svg" alt="Menu">';
  btn.addEventListener('click', () => (menu.classList.contains('hidden') ? open() : close()));
  // hide the game's own top-left back/leave button so ours replaces it
  const killBack = () => { ['#back', '.back-btn', '#back-btn', '[data-cbx-back]'].forEach((s) => document.querySelectorAll(s).forEach((e) => { if (e !== btn) e.style.display = 'none'; })); };

  // ---- overlay ----
  const menu = document.createElement('div');
  menu.id = 'cbx-menu'; menu.className = 'hidden';
  menu.innerHTML = `<div class="cbx-card">
    <button class="cbx-close" aria-label="Close">✕</button>
    <div class="cbx-tabs">
      <button class="cbx-tab sel" data-t="people"><span class="ti">👥</span><span class="tl">People</span></button>
      <button class="cbx-tab" data-t="settings"><span class="ti">⚙️</span><span class="tl">Settings</span></button>
      <button class="cbx-tab" data-t="controls"><span class="ti">🎮</span><span class="tl">Controls</span></button>
      <button class="cbx-tab" data-t="report"><span class="ti">🚩</span><span class="tl">Report</span></button>
      <button class="cbx-tab" data-t="help"><span class="ti">❔</span><span class="tl">Help</span></button>
    </div>
    <div class="cbx-body"></div>
    <div class="cbx-foot">
      <button class="leave"><span class="em">🚪</span>Leave Game</button>
      <button class="reset"><span class="em">💀</span>Reset Character</button>
    </div>
  </div>`;

  let tab = 'people';
  const body = () => menu.querySelector('.cbx-body');
  function setup() {
    document.body.appendChild(btn);
    document.body.appendChild(menu);
    killBack();
    menu.querySelector('.cbx-close').addEventListener('click', close);
    menu.addEventListener('mousedown', (e) => { if (e.target === menu) close(); });
    menu.querySelectorAll('.cbx-tab').forEach((t) => t.addEventListener('click', () => { tab = t.dataset.t; menu.querySelectorAll('.cbx-tab').forEach((x) => x.classList.toggle('sel', x === t)); render(); }));
    menu.querySelector('.leave').addEventListener('click', () => { if (game.leave) game.leave(); else location.href = '/'; });
    menu.querySelector('.reset').addEventListener('click', () => { close(); if (game.resetCharacter) game.resetCharacter(); else location.reload(); });
  }
  if (document.body) setup(); else addEventListener('DOMContentLoaded', setup);

  addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); menu.classList.contains('hidden') ? open() : close(); } });

  function open() { killBack(); menu.classList.remove('hidden'); try { document.exitPointerLock && document.exitPointerLock(); } catch {} render(); }
  function close() { menu.classList.add('hidden'); }

  // ============ customizable touch controls (shared by every game) ============
  // Size / transparency / handedness + drag-anywhere layouts, saved per game.
  const CTL_SELECTORS = [
    '#joystick-zone', '#stick',
    '#btn-a', '#btn-b', '#btn-jump', '#btn-fly', '#btn-descend',
    '#btn-action', '#btn-horn', '#btn-phone-m', '#btn-chat',
    '#t-jump', '#t-enter', '#t-fire',
    '#action-stack',
    '#m-fire', '#m-jump', '#m-aim', '#m-crouch', '#m-reload', '#m-chat', '#m-play',   // Rivals
  ];
  const CTL_CONTAINERS = ['#move-cluster', '#touch', '#action-stack', '#mobile'];   // force-shown while arranging
  const ctlPrefs = () => { try { return { scale: 1, opacity: 1, mirror: false, ...JSON.parse(localStorage.getItem('bd.controls') || '{}') }; } catch { return { scale: 1, opacity: 1, mirror: false }; } };
  const ctlSavePrefs = (p) => { try { localStorage.setItem('bd.controls', JSON.stringify(p)); } catch {} };
  const ctlPosAll = () => { try { return JSON.parse(localStorage.getItem('bd.controls.pos') || '{}'); } catch { return {}; } };
  const ctlPos = () => ctlPosAll()[location.pathname] || {};
  const ctlSavePos = (m) => { try { const a = ctlPosAll(); a[location.pathname] = m; localStorage.setItem('bd.controls.pos', JSON.stringify(a)); } catch {} };
  function ctlEls() {
    const out = [];
    for (const sel of CTL_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && !out.some((o) => o.el.contains(el) || el.contains(o.el))) out.push({ sel, el });
    }
    return out;
  }
  // Idempotent: remember each element's untouched inline style, restore it,
  // then layer on mirror + saved offset + scale + opacity as one transform.
  function ctlApply() {
    const p = ctlPrefs(); const pos = ctlPos();
    for (const { sel, el } of ctlEls()) {
      if (el.dataset.cbxOrig === undefined) el.dataset.cbxOrig = el.getAttribute('style') || '';
      el.setAttribute('style', el.dataset.cbxOrig);
      let mx = 0;
      if (p.mirror) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) mx = innerWidth - r.right - r.left;   // flip to the other side
      }
      const o = pos[sel] || { dx: 0, dy: 0 };
      const t = `translate(${(o.dx || 0) + mx}px, ${o.dy || 0}px) scale(${p.scale})`;
      el.style.transform = (el.dataset.cbxOrig.includes('transform') ? '' : '') + t;
      el.style.transformOrigin = 'center bottom';
      el.style.opacity = String(p.opacity);
    }
  }
  // controls appear after each game boots its touch UI — apply a few times
  [800, 2500, 6000].forEach((ms) => setTimeout(ctlApply, ms));
  addEventListener('resize', () => setTimeout(ctlApply, 60));

  // ---- arrange mode: drag any control where you like ----
  function ctlArrange() {
    close();
    const shown = [];
    for (const sel of CTL_CONTAINERS) { const el = document.querySelector(sel); if (el && el.classList.contains('hidden')) { el.classList.remove('hidden'); shown.push(el); } }
    ctlApply();
    const ov = document.createElement('div');
    ov.id = 'cbx-ctl-arrange';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(10,16,30,.35);touch-action:none';
    ov.innerHTML = `<div style="position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;background:rgba(12,18,32,.95);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:10px 14px;font:600 13px system-ui;color:#fff">
      ✋ Drag your buttons anywhere
      <button id="cbx-ctl-reset" style="border:0;border-radius:9px;padding:7px 12px;background:rgba(255,255,255,.12);color:#fff;font-weight:700;cursor:pointer">Reset</button>
      <button id="cbx-ctl-done" style="border:0;border-radius:9px;padding:7px 12px;background:#3aa0ff;color:#fff;font-weight:800;cursor:pointer">Done</button>
    </div>`;
    const marks = [];
    const mark = () => {
      marks.forEach((m) => m.remove()); marks.length = 0;
      for (const { el } of ctlEls()) {
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        const m = document.createElement('div');
        m.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2px dashed #7cc4ff;border-radius:14px;pointer-events:none`;
        ov.appendChild(m); marks.push(m);
      }
    };
    let drag = null;
    ov.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      let best = null;
      for (const { sel, el } of ctlEls()) {
        const r = el.getBoundingClientRect();
        if (!r.width || e.clientX < r.left - 14 || e.clientX > r.right + 14 || e.clientY < r.top - 14 || e.clientY > r.bottom + 14) continue;
        if (!best || r.width * r.height < best.area) best = { sel, el, area: r.width * r.height };
      }
      if (!best) return;
      const cur = ctlPos()[best.sel] || { dx: 0, dy: 0 };
      drag = { sel: best.sel, sx: e.clientX, sy: e.clientY, dx: cur.dx || 0, dy: cur.dy || 0 };
      ov.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    ov.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const m = ctlPos();
      m[drag.sel] = { dx: drag.dx + (e.clientX - drag.sx), dy: drag.dy + (e.clientY - drag.sy) };
      ctlSavePos(m); ctlApply(); mark();
    });
    const endDrag = () => { drag = null; };
    ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag);
    ov.querySelector('#cbx-ctl-reset').addEventListener('click', () => { ctlSavePos({}); ctlApply(); mark(); });
    ov.querySelector('#cbx-ctl-done').addEventListener('click', () => {
      ov.remove();
      for (const el of shown) el.classList.add('hidden');
      ctlApply();
    });
    document.body.appendChild(ov);
    mark();
  }

  function renderControls() {
    const p = ctlPrefs();
    body().innerHTML = `
      <div class="cbx-set"><label>Button size <span id="cbx-ctlsv">${Math.round(p.scale * 100)}%</span></label><input type="range" id="cbx-ctls" min="0.7" max="1.6" step="0.05" value="${p.scale}"></div>
      <div class="cbx-set"><label>See-through <span id="cbx-ctlov">${Math.round(p.opacity * 100)}%</span></label><input type="range" id="cbx-ctlo" min="0.3" max="1" step="0.05" value="${p.opacity}"></div>
      <div class="cbx-set"><label>Left-handed (swap sides) <span></span></label><div class="cbx-kb"><span>Joystick on the right, buttons on the left</span><input type="checkbox" id="cbx-ctlm" ${p.mirror ? 'checked' : ''} style="width:22px;height:22px;accent-color:#3aa0ff"></div></div>
      <div class="cbx-set"><label>Layout</label>
        <div class="cbx-kb"><span>Drag every button exactly where you like</span><button id="cbx-ctlarr" style="border:0;border-radius:9px;padding:8px 14px;background:#3aa0ff;color:#fff;font-weight:800;cursor:pointer">✋ Arrange</button></div>
        <div class="cbx-kb"><span>Back to the normal layout (this game)</span><button id="cbx-ctlrst" style="border:0;border-radius:9px;padding:8px 14px;background:rgba(255,255,255,.12);color:#fff;font-weight:700;cursor:pointer">Reset</button></div>
      </div>
      <p style="font-size:12px;opacity:.6;margin:4px 2px">Tip: these are for touch screens — your layout is saved per game.</p>`;
    const upd = (patch) => { ctlSavePrefs({ ...ctlPrefs(), ...patch }); ctlApply(); };
    body().querySelector('#cbx-ctls').addEventListener('input', (e) => { upd({ scale: +e.target.value }); body().querySelector('#cbx-ctlsv').textContent = Math.round(+e.target.value * 100) + '%'; });
    body().querySelector('#cbx-ctlo').addEventListener('input', (e) => { upd({ opacity: +e.target.value }); body().querySelector('#cbx-ctlov').textContent = Math.round(+e.target.value * 100) + '%'; });
    body().querySelector('#cbx-ctlm').addEventListener('change', (e) => upd({ mirror: e.target.checked }));
    body().querySelector('#cbx-ctlarr').addEventListener('click', ctlArrange);
    body().querySelector('#cbx-ctlrst').addEventListener('click', () => { ctlSavePos({}); ctlApply(); });
  }

  // ---- render tabs ----
  function render() { ({ people: renderPeople, settings: renderSettings, controls: renderControls, report: renderReport, help: renderHelp }[tab] || renderPeople)(); }

  async function playerList() {
    // ONLY players actually in this game session — never platform-wide online users.
    if (typeof game.players === 'function') { try { return (await game.players()) || []; } catch { return []; } }
    // auto-detect the game's own remote-player roster (each game exposes it on window)
    const w = window;
    const m = (w.__rivals && w.__rivals.others) || (w.__brook && w.__brook.remotes) || (w.__wibit && w.__wibit.remotes) || (w.__obby && w.__obby.remotes) || (w.__game && w.__game.players);
    const out = [];
    if (m && typeof m.forEach === 'function') m.forEach((r) => { const n = r && r.data && r.data.name; if (n) out.push({ name: n, bot: r.data.bot }); });
    return out;
  }

  async function renderPeople() {
    const el = body(); el.innerHTML = `<div class="cbx-row cbx-invite"><span class="cbx-dot">＋</span><b style="font-size:15px">Invite friends to join</b></div><div id="cbx-plist"><div class="cbx-empty">Loading players…</div></div>`;
    el.querySelector('.cbx-invite').addEventListener('click', invite);
    const me = meName().toLowerCase();
    const seen = new Set(), players = [];
    for (const p of await playerList()) { const n = (p.name || p).toString(); const k = n.toLowerCase(); if (!n || k === me || seen.has(k) || p.bot || /^🤖/.test(n)) continue; seen.add(k); players.push({ name: n, badge: p.badge }); }
    const list = el.querySelector('#cbx-plist');
    if (!players.length) { list.innerHTML = `<div class="cbx-empty">No other players here right now.</div>`; return; }
    list.innerHTML = players.map((p) => `
      <div class="cbx-row" data-n="${esc(p.name)}">
        ${dot(p.name)}
        <div class="cbx-nm"><b>${esc(p.name)}${p.badge ? ' ✔' : ''}</b><small>@${esc(p.name.toLowerCase())}</small></div>
        <button class="cbx-ib" data-a="inspect" title="View profile">🔍</button>
        <button class="cbx-ib" data-a="report" title="Report">🚩</button>
        <button class="cbx-add" data-a="friend">Add Friend</button>
      </div>`).join('');
    list.querySelectorAll('.cbx-row').forEach((row) => {
      const n = row.dataset.n;
      row.querySelector('[data-a="friend"]').addEventListener('click', async (e) => { const b = e.target; b.textContent = '…'; const r = await post('/friends/add', { name: meName(), friend: n }); b.classList.add('done'); b.textContent = r && r.ok ? (r.status === 'friends' ? 'Friends' : 'Requested') : 'Sent'; });
      row.querySelector('[data-a="report"]').addEventListener('click', () => { tab = 'report'; menu.querySelectorAll('.cbx-tab').forEach((x) => x.classList.toggle('sel', x.dataset.t === 'report')); render(reportTarget = n); });
      row.querySelector('[data-a="inspect"]').addEventListener('click', () => inspect(n));
    });
  }

  async function inspect(name) {
    const d = await getJSON('/profile/' + encodeURIComponent(name) + '?viewer=' + encodeURIComponent(meName()));
    const el = body();
    const card = document.createElement('div');
    card.style.cssText = 'position:fixed;inset:0;z-index:5;display:grid;place-items:center;background:rgba(0,0,0,.5)';
    card.innerHTML = `<div style="background:#1a1f2b;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px;width:min(340px,90vw);text-align:center">
      ${dot(name).replace('cbx-dot"', 'cbx-dot" style="width:64px;height:64px;font-size:28px;margin:0 auto 12px;background:hsl(' + hue(name) + ' 55% 45%)"')}
      <h2 style="margin:0 0 2px">${esc(name)}${d && d.badge ? ' ✔' : ''}</h2>
      <div style="color:#8a94a8;font-size:13px;margin-bottom:14px">@${esc(name.toLowerCase())}</div>
      <div style="display:flex;justify-content:center;gap:18px;margin-bottom:16px">
        <div><b style="font-size:18px">${(d && d.followers) || 0}</b><div style="color:#8a94a8;font-size:12px">Followers</div></div>
        <div><b style="font-size:18px">${(d && d.totalVisits) || 0}</b><div style="color:#8a94a8;font-size:12px">Visits</div></div>
      </div>
      <button class="cbx-primary" style="background:#2f6fed" data-x="close">Close</button></div>`;
    card.addEventListener('mousedown', (e) => { if (e.target === card || e.target.dataset.x === 'close') card.remove(); });
    el.appendChild(card);
  }

  function invite() {
    const url = location.href.split('#')[0];
    (navigator.clipboard && navigator.clipboard.writeText(url).then(() => flash('Invite link copied — share it!')).catch(() => flash(url))) || flash(url);
  }
  function flash(msg) { const t = document.createElement('div'); t.textContent = msg; t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100002;background:#2f6fed;color:#fff;font-weight:700;padding:12px 20px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.4)'; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

  function renderSettings() {
    const kb = game.keybinds || [{ keys: 'WASD', action: 'Move' }, { keys: 'Mouse', action: 'Look / Aim' }, { keys: 'Space', action: 'Jump' }, { keys: 'Shift', action: 'Sprint' }, { keys: 'Esc', action: 'This menu' }];
    body().innerHTML = `
      <div class="cbx-set"><label>Field of View <span id="cbx-fovv">${settings.fov}°</span></label><input type="range" id="cbx-fov" min="60" max="100" step="1" value="${settings.fov}"></div>
      <div class="cbx-set"><label>Mouse Sensitivity <span id="cbx-senv">${settings.sensitivity.toFixed(2)}×</span></label><input type="range" id="cbx-sen" min="0.2" max="2.5" step="0.05" value="${settings.sensitivity}"></div>
      <div class="cbx-set"><label>Volume <span id="cbx-volv">${Math.round(settings.volume * 100)}%</span></label><input type="range" id="cbx-vol" min="0" max="1" step="0.05" value="${settings.volume}"></div>
      <div class="cbx-set"><label>Keybinds</label>${kb.map((k) => `<div class="cbx-kb"><span>${esc(k.action)}</span><kbd>${esc(k.keys)}</kbd></div>`).join('')}</div>`;
    const bind = (id, key, fmt, el) => body().querySelector(id).addEventListener('input', (e) => { settings[key] = +e.target.value; body().querySelector(el).textContent = fmt(settings[key]); commitSettings(); });
    bind('#cbx-fov', 'fov', (v) => v + '°', '#cbx-fovv');
    bind('#cbx-sen', 'sensitivity', (v) => v.toFixed(2) + '×', '#cbx-senv');
    bind('#cbx-vol', 'volume', (v) => Math.round(v * 100) + '%', '#cbx-volv');
  }

  let reportTarget = '';
  async function renderReport(pre) {
    if (pre) reportTarget = pre;
    const players = (await playerList()).filter((p) => !p.bot && !/^🤖/.test(p.name)).map((p) => (p.name || p).toString()).filter((n) => n && n.toLowerCase() !== meName().toLowerCase());
    const reasons = ['Cheating / exploiting', 'Harassment or bullying', 'Inappropriate username', 'Offensive language', 'Spamming', 'Other'];
    body().innerHTML = `
      <p class="cbx-h">Reports go to the ClaudeBox moderators. Only report real rule-breaking.</p>
      <label class="cbx-h">Who are you reporting?</label>
      <select class="cbx-sel" id="cbx-rwho"><option value="">Select a player…</option>${players.map((n) => `<option${n === reportTarget ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <label class="cbx-h">Reason</label>
      <select class="cbx-sel" id="cbx-rwhy">${reasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
      <textarea class="cbx-inp" id="cbx-rdet" rows="3" placeholder="Details (optional)"></textarea>
      <button class="cbx-primary" id="cbx-rsend">Submit report</button>`;
    body().querySelector('#cbx-rsend').addEventListener('click', async () => {
      const who = body().querySelector('#cbx-rwho').value;
      if (!who) { flash('Pick a player to report.'); return; }
      await post('/report', { name: meName(), target: who, reason: body().querySelector('#cbx-rwhy').value, details: body().querySelector('#cbx-rdet').value.slice(0, 300), game: gameId() });
      reportTarget = ''; flash('Report submitted. Thanks for keeping ClaudeBox safe.'); close();
    });
  }

  function renderHelp() {
    const custom = game.help ? `<p class="cbx-h" style="font-size:14px;color:#dfe5f0;white-space:pre-line">${esc(game.help)}</p>` : '';
    body().innerHTML = `${custom}
      <div class="cbx-kb"><span>Open this menu</span><kbd>Esc</kbd></div>
      <div class="cbx-kb"><span>Add a friend / report</span><kbd>People tab</kbd></div>
      <div class="cbx-kb"><span>Reset your character</span><kbd>💀 button</kbd></div>
      <div class="cbx-kb"><span>Leave the game</span><kbd>🚪 button</kbd></div>
      <p class="cbx-h" style="margin-top:14px">Playing on <b style="color:#fff">ClaudeBox</b> · have fun and be kind. 💙</p>`;
  }

  function gameId() { const m = location.pathname.match(/\/games\/([^/?#]+)/); return m ? m[1] : (location.pathname.replace(/\//g, '') || 'unknown'); }
})();


// ================= 📱 Landscape mode for phones =================
// iPhones can't lock orientation from the web, so when the phone stays
// portrait (rotation lock!) we rotate the whole game 90° with CSS and patch
// the coordinate APIs (innerWidth/Height, mouse/touch positions, element
// rects) so every game believes the screen really is landscape.
(function () {
  if (window.__cbxLandscape) return;
  window.__cbxLandscape = true;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;

  // physical viewport getters, captured before we shadow them
  const wDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth') || Object.getOwnPropertyDescriptor(Window.prototype, 'innerWidth');
  const hDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight') || Object.getOwnPropertyDescriptor(Window.prototype, 'innerHeight');
  if (!wDesc?.get || !hDesc?.get) return;
  const realW = () => wDesc.get.call(window);
  const realH = () => hDesc.get.call(window);
  const R = { on: false, native: false };
  const physPortrait = () => realH() > realW();

  // logical coords: x' = physY, y' = physW - physX  (pure 90° rotation)
  function patchPoint(proto, xProp, yProp) {
    const xd = Object.getOwnPropertyDescriptor(proto, xProp);
    const yd = Object.getOwnPropertyDescriptor(proto, yProp);
    if (!xd?.get || !yd?.get) return;
    Object.defineProperty(proto, xProp, { configurable: true, get() { return R.on ? yd.get.call(this) : xd.get.call(this); } });
    Object.defineProperty(proto, yProp, { configurable: true, get() { return R.on ? realW() - xd.get.call(this) : yd.get.call(this); } });
  }
  try {
    patchPoint(MouseEvent.prototype, 'clientX', 'clientY');
    patchPoint(MouseEvent.prototype, 'pageX', 'pageY');
    if (window.Touch) { patchPoint(Touch.prototype, 'clientX', 'clientY'); patchPoint(Touch.prototype, 'pageX', 'pageY'); }
    const realGBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const r = realGBCR.call(this);
      if (!R.on) return r;
      return new DOMRect(r.top, realW() - r.right, r.height, r.width);
    };
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => (R.on ? realH() : realW()) });
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => (R.on ? realW() : realH()) });
  } catch { return; }

  const st = document.createElement('style');
  st.textContent = `
  html.cbx-land, html.cbx-land body { overflow: hidden !important; overscroll-behavior: none; }
  html.cbx-land body { position: fixed !important; top: 0 !important; left: 0 !important; margin: 0 !important;
    transform: rotate(90deg) translateY(-100%); transform-origin: 0 0;
    width: var(--cbx-lw) !important; height: var(--cbx-lh) !important; }
  html.cbx-land #game-canvas, html.cbx-land canvas.game-canvas { width: 100% !important; height: 100% !important; }
  #cbx-land-btn { position: fixed; top: 12px; left: 66px; z-index: 100000; width: 46px; height: 46px; border: none;
    border-radius: 13px; background: rgba(20,24,34,.72); backdrop-filter: blur(10px); color: #fff; font-size: 21px;
    box-shadow: 0 4px 16px rgba(0,0,0,.45); cursor: pointer; -webkit-appearance: none; display: none; }
  #cbx-land-btn.show { display: block; }`;
  document.head.appendChild(st);

  const btn = document.createElement('button');
  btn.id = 'cbx-land-btn'; btn.textContent = '🔄'; btn.title = 'Landscape mode';
  function syncBtn() { btn.classList.toggle('show', physPortrait() || R.on); btn.textContent = R.on ? '↩️' : '🔄'; }

  // physical size of the visible area — visualViewport tracks iOS toolbar
  // collapse better than innerWidth/Height, killing the black bar
  const physW = () => Math.round(window.visualViewport?.width || realW());
  const physH = () => Math.round(window.visualViewport?.height || realH());
  function sizeVars() {
    const de = document.documentElement;
    de.style.setProperty('--cbx-lw', physH() + 'px');
    de.style.setProperty('--cbx-lh', physW() + 'px');
  }
  function apply(on) {
    R.on = on;
    const de = document.documentElement;
    if (on) sizeVars();
    de.classList.toggle('cbx-land', on);
    try { sessionStorage.setItem('cbx.landscape', on ? '1' : ''); } catch {}
    syncBtn();
    dispatchEvent(new Event('resize'));
  }
  window.visualViewport?.addEventListener('resize', () => { if (R.on) { sizeVars(); dispatchEvent(new Event('resize')); } });
  setInterval(() => { if (R.on) sizeVars(); }, 900);

  // Android path: real fullscreen + orientation lock. iOS throws → CSS rotation.
  async function tryNativeLock() {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation.lock('landscape');
      R.native = true; syncBtn();
      return true;
    } catch { try { if (document.fullscreenElement) document.exitFullscreen(); } catch {} return false; }
  }
  function releaseNative() {
    R.native = false;
    try { screen.orientation.unlock?.(); } catch {}
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  }

  btn.addEventListener('click', async () => {
    if (R.on) { apply(false); return; }
    if (R.native) { releaseNative(); syncBtn(); return; }
    if (await tryNativeLock()) return;
    apply(true);
  });

  addEventListener('resize', () => {
    if (R.on) {
      if (!physPortrait()) { apply(false); return; }   // physically rotated: native landscape wins
      sizeVars();
    }
    syncBtn();
  });

  function boot() {
    document.body.appendChild(btn);
    syncBtn();
    let saved = '';
    try { saved = sessionStorage.getItem('cbx.landscape') || ''; } catch {}
    if (saved === '1' && physPortrait()) apply(true);
  }
  if (document.body) boot(); else addEventListener('DOMContentLoaded', boot);
})();
