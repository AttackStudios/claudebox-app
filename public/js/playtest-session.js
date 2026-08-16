// Playtest session enforcement, loaded inside every game by the ClaudeBox SDK.
// Does nothing at all unless a session was started from /playtest.
//
// While a session is live it: shows a countdown, sends every "leave" route back
// to the playtest kiosk instead of the hub, and when the clock runs out plays a
// TIME'S UP card with a draining bar before returning.
(() => {
  const KEY = 'claudebox.playtest';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  if (!session || !session.endsAt) return;
  if (Date.now() >= session.endsAt) { bounce(); return; }

  const BACK = '/playtest';
  const GRACE = 5000;              // how long TIME'S UP stays up
  let ended = false;

  // Release the throwaway guest account before leaving. Uses sendBeacon where
  // possible so it still fires when the tab is being torn down.
  function releaseGuest() {
    let who = null;
    try { who = (session && session.guest) || localStorage.getItem('claudebox.user'); } catch {}
    if (!who || !/^Guest\d{4}$/.test(who)) return;
    const body = JSON.stringify({ name: who });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/playtest/release', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/playtest/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch {}
    try { localStorage.removeItem('claudebox.user'); } catch {}
  }

  function bounce() {
    releaseGuest();
    try { localStorage.removeItem(KEY); } catch {}
    location.replace(BACK);
  }

  // closing the tab or navigating away ends the session too
  addEventListener('pagehide', releaseGuest);
  addEventListener('beforeunload', releaseGuest);

  // ---------------------------------------------------------------- styles
  const css = document.createElement('style');
  css.textContent = `
  #pt-chip { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2147483000;
    display: flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 999px;
    background: rgba(10,14,22,.86); border: 2px solid rgba(255,255,255,.2);
    border-bottom: 4px solid rgba(0,0,0,.5); backdrop-filter: blur(8px);
    font-family: ui-rounded,'SF Pro Rounded','Trebuchet MS',sans-serif;
    font-weight: 900; font-size: 15px; color: #eef2f8; pointer-events: none;
    box-shadow: 0 10px 30px rgba(0,0,0,.45); animation: ptDrop .5s cubic-bezier(.34,1.56,.64,1); }
  @keyframes ptDrop { from { transform: translate(-50%, -70px); opacity: 0; } to { transform: translateX(-50%); opacity: 1; } }
  #pt-chip b { color: #6ee7ff; font-variant-numeric: tabular-nums; }
  #pt-chip.warn { border-color: #ffc94a; }
  #pt-chip.warn b { color: #ffc94a; }
  #pt-chip.crit { border-color: #ff5d6c; animation: ptPulse 1s ease-in-out infinite; }
  #pt-chip.crit b { color: #ff5d6c; }
  @keyframes ptPulse { 0%,100%{transform:translateX(-50%) scale(1)} 50%{transform:translateX(-50%) scale(1.06)} }

  #pt-over { position: fixed; inset: 0; z-index: 2147483600; display: grid; place-items: center;
    background: rgba(4,7,14,.9); backdrop-filter: blur(10px); opacity: 0;
    transition: opacity .4s ease;
    font-family: ui-rounded,'SF Pro Rounded','Trebuchet MS',sans-serif; }
  #pt-over.on { opacity: 1; }
  #pt-over .inner { text-align: center; }
  #pt-over .big { font-size: clamp(44px, 11vw, 130px); font-weight: 900; letter-spacing: .03em;
    background: linear-gradient(180deg,#fff,#ff9aa5); -webkit-background-clip: text; background-clip: text;
    color: transparent; animation: ptPop .55s cubic-bezier(.34,1.56,.64,1); }
  @keyframes ptPop { from { transform: scale(.6); opacity: 0; } to { transform: none; opacity: 1; } }
  #pt-over .sub { margin-top: 10px; font-size: clamp(12px,2vw,17px); font-weight: 900;
    letter-spacing: .28em; text-transform: uppercase; color: #93a0b4; }
  #pt-bar { position: fixed; left: 0; bottom: 0; height: 7px; width: 100%;
    background: linear-gradient(90deg,#6ee7ff,#2b8de0); transform-origin: left center;
    box-shadow: 0 0 20px rgba(110,231,255,.6); }`;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- countdown
  const chip = document.createElement('div');
  chip.id = 'pt-chip';
  chip.innerHTML = `<span>⏱</span><b>--:--</b>`;
  const mount = () => (document.body || document.documentElement).appendChild(chip);
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);

  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  setInterval(tick, 250);
  tick();
  function tick() {
    if (ended) return;
    const left = session.endsAt - Date.now();
    chip.querySelector('b').textContent = fmt(left);
    chip.classList.toggle('warn', left <= 60000 && left > 15000);
    chip.classList.toggle('crit', left <= 15000);
    if (left <= 0) timeUp();
  }

  // ---------------------------------------------------------------- time up
  function timeUp() {
    if (ended) return;
    ended = true;
    chip.remove();
    const over = document.createElement('div');
    over.id = 'pt-over';
    over.innerHTML = `<div class="inner"><div class="big">TIME'S UP</div>
      <div class="sub">Returning to the playtest menu</div></div><div id="pt-bar"></div>`;
    document.body.appendChild(over);
    requestAnimationFrame(() => over.classList.add('on'));
    // the bar drains over the grace period, so the wait is visible
    const bar = over.querySelector('#pt-bar');
    bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
      { duration: GRACE, easing: 'linear', fill: 'forwards' });
    setTimeout(bounce, GRACE);
  }

  // ---------------------------------------------------------------- no escape
  // Anything that would drop the player back at the hub goes to the kiosk.
  addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const hit = t.closest('a[href="/"], a[href="./"], .leave, [data-leave]');
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    bounce();
  }, true);

  // and the browser's own back button lands on the kiosk, not the hub
  history.pushState({ pt: 1 }, '', location.href);
  addEventListener('popstate', () => bounce());
})();
