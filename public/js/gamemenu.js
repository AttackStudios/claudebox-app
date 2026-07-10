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

  // ---- render tabs ----
  function render() { ({ people: renderPeople, settings: renderSettings, report: renderReport, help: renderHelp }[tab] || renderPeople)(); }

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
