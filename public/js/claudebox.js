// ClaudeBox in-game bridge — drop-in for any game.
//
//   <script src="/js/claudebox.js"></script>
//   ClaudeBox.completeChallenge('bp-scare-bear');
//
// It figures out who the player is (localStorage 'claudebox.user', the same key
// every ClaudeBox game already uses), reports the completion to the platform,
// and — only the first time it's earned — pops a celebratory toast with the
// Star reward. Fully self-contained: no imports, no CSS file, safe to call as
// often as you like (client + server both dedupe).
(function () {
  if (window.ClaudeBox) return;

  const NAME_KEYS = ['claudebox.user'];
  const LOCAL_DONE = 'claudebox.challengesDone'; // client-side dedupe cache
  let overrideName = null;

  function getName() {
    if (overrideName) return overrideName;
    for (const k of NAME_KEYS) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
    // fall back to the hub menu's profile blob if present
    try { const p = JSON.parse(localStorage.getItem('featherfriends.lastProfile') || '{}'); if (p.name) return p.name; } catch {}
    return null;
  }

  function doneSet() {
    try { return new Set(JSON.parse(localStorage.getItem(LOCAL_DONE) || '[]')); } catch { return new Set(); }
  }
  function markDone(id) {
    const s = doneSet(); s.add(id);
    try { localStorage.setItem(LOCAL_DONE, JSON.stringify([...s])); } catch {}
  }

  async function api(path, body) {
    const res = await fetch('/api' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' }, body: JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
  }

  // ---- toast UI (injected once) ----
  let host = null;
  function ensureHost() {
    if (host) return host;
    const style = document.createElement('style');
    style.textContent = `
      #cbx-toasts{position:fixed;left:50%;top:calc(16px + env(safe-area-inset-top));transform:translateX(-50%);
        z-index:2147483000;display:flex;flex-direction:column;gap:10px;align-items:center;pointer-events:none;
        font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif}
      .cbx-toast{display:flex;align-items:center;gap:12px;min-width:240px;max-width:min(92vw,420px);
        padding:12px 18px 12px 14px;border-radius:18px;color:#fff;
        background:linear-gradient(135deg,rgba(30,33,42,.96),rgba(20,22,28,.96));
        border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 40px rgba(0,0,0,.5),0 0 0 1px rgba(255,207,92,.25);
        backdrop-filter:blur(16px);animation:cbxIn .5s cubic-bezier(.22,1,.36,1) both}
      .cbx-toast.out{animation:cbxOut .35s ease forwards}
      .cbx-emoji{font-size:30px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));flex:none}
      .cbx-body{display:flex;flex-direction:column;line-height:1.25;min-width:0}
      .cbx-kicker{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#ffcf5c}
      .cbx-title{font-size:15px;font-weight:700}
      .cbx-reward{font-size:13px;font-weight:800;color:#ffcf5c;white-space:nowrap;flex:none}
      @keyframes cbxIn{from{opacity:0;transform:translateY(-16px) scale(.9)}to{opacity:1;transform:none}}
      @keyframes cbxOut{to{opacity:0;transform:translateY(-10px) scale(.94)}}
      @media (prefers-reduced-motion:reduce){.cbx-toast,.cbx-toast.out{animation-duration:.001ms}}`;
    document.head.appendChild(style);
    host = document.createElement('div');
    host.id = 'cbx-toasts';
    document.body.appendChild(host);
    return host;
  }

  function toast({ emoji = '⭐', kicker = 'Challenge complete', title = '', reward = '' }) {
    const el = document.createElement('div');
    el.className = 'cbx-toast';
    el.innerHTML =
      `<span class="cbx-emoji">${emoji}</span>` +
      `<span class="cbx-body"><span class="cbx-kicker">${kicker}</span><span class="cbx-title"></span></span>` +
      (reward ? `<span class="cbx-reward">${reward}</span>` : '');
    el.querySelector('.cbx-title').textContent = title;
    ensureHost().appendChild(el);
    chime();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 360); }, 4200);
  }

  // a short, pleasant reward chime (Web Audio, no assets)
  let ac = null;
  function chime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = ac || new AC();
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const t = now + i * 0.08;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.36);
      });
    } catch {}
  }

  const ClaudeBox = {
    setName(n) { overrideName = n && String(n).trim() || null; },
    getName,

    // Report a challenge completion. Returns the server result (or null if we
    // couldn't). Shows a toast only when it's newly earned.
    async completeChallenge(id) {
      if (!id) return null;
      const name = getName();
      if (!name) return null;
      if (doneSet().has(id)) return { ok: true, newly: false, cached: true };
      let data = null;
      try { data = await api('/challenge/complete', { name, id }); } catch { return null; }
      if (!data || !data.ok) return data;
      markDone(id);
      if (data.newly && data.challenge) {
        toast({
          emoji: data.challenge.emoji || '⭐',
          title: data.challenge.title,
          reward: `+${data.awarded} ⭐`,
        });
      }
      return data;
    },

    // Read the player's wallet (stars/cubes/owned…) so a game can gate content.
    async getWallet() {
      const name = getName(); if (!name) return null;
      try { const d = await fetch('/api/social/' + encodeURIComponent(name)).then((r) => r.json()); return d?.me?.wallet || null; } catch { return null; }
    },

    // Charge the player Cubes for an in-game purchase. Returns { ok, cubes }.
    async spend(amount, reason) {
      const name = getName(); if (!name) return { ok: false };
      try { return await api('/currency/spend', { name, amount, reason: reason || '' }); } catch { return { ok: false }; }
    },

    // Manual toast (e.g. "not enough Cubes")
    toast,
  };

  window.ClaudeBox = ClaudeBox;
})();
