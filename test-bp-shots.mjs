import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9251;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync('/tmp/bp-cdp', { recursive: true, force: true });
fs.mkdirSync('/tmp/bp-shots', { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/bp-cdp', '--no-first-run', '--mute-audio', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let page = null;
for (let i = 0; i < 40 && !page; i++) { await sleep(250); try { page = (await (await fetch(`http://localhost:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let id = 0; const waiters = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw); const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 84 }); fs.writeFileSync(`/tmp/bp-shots/${n}.jpg`, Buffer.from(s.result.data, 'base64')); console.log('saved', n); };
await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('claudebox.user', 'BPTester');" });
await send('Page.navigate', { url: 'http://localhost:8787/games/backpacking?dev=1' });
await sleep(8000);
let ready = false;
for (let i = 0; i < 16 && !ready; i++) { ready = await ev(`!!(window.__game && window.__game.player)`); if (!ready) await sleep(700); }
console.log('player ready:', ready);
// freeze input + face a road
await ev(`(() => { const g = window.__game; if (g.controls) g.controls.poll = (i) => i; return 'ok'; })()`);
const place = (x, z, yaw, pitch) => ev(`(() => { const g = window.__game; const w = g.player; w.pos.x=${x}; w.pos.z=${z}; w.pos.y=50; g.orbit.yaw=${yaw}; g.orbit.pitch=${pitch||0.3}; return 'ok'; })()`);
// day, near the lodge spawn looking out
await ev(`window.__game.clockOverride = 0.28; 'ok'`);
await place(-220, 1140, 2.6, 0.32);
await sleep(2400); await shot('v2-spawn');
// a forest road stretch
await place(-540, 500, 1.2, 0.28);
await sleep(2400); await shot('v2-forest-road');
// the table mountain + cave area
await place(290, -660, 0.4, 0.18);
await sleep(2400); await shot('v2-mountain');
// roundabout (east junction)
await place(1060, 470, 2.0, 0.35);
await sleep(2400); await shot('v2-roundabout');
// place a tent + furniture near spawn and look at it
await place(-220, 1150, 2.6, 0.18);
await ev(`(() => {
  const g = window.__game;
  g.inventory.addToHotbar('tent', '#4a7ec0'); g.actions.primary();
  return 'ok';
})()`);
await sleep(1000);
await ev(`(() => { const g=window.__game; g.orbit.dist=10; g.orbit.pitch=0.12; return 'ok'; })()`);
await sleep(1800); await shot('v2-tent');
// the furnished crystal cave
await place(250, -700, 0.5, 0.15);
await ev(`(() => { const g=window.__game; g.orbit.dist=12; return 'ok'; })()`);
await sleep(2400); await shot('v2-cave');
// build every catalog item mesh to catch geometry errors
const buildReport = await ev(`(async () => {
  const items = await import('/backpacking/js/systems/items.js');
  const sky = window.__game.sky;
  const bad = [];
  for (const tab of Object.values(items.CATALOG)) {
    for (const e of tab) {
      try {
        if (e.held) items.buildHeldMesh(e.kind);
        else items.buildItemMesh(e.kind, (e.colors && e.colors[0]) || '#4f8a55', sky);
      } catch (err) { bad.push(e.kind + ': ' + err.message); }
    }
  }
  return bad.length ? 'FAILED: ' + bad.join('; ') : 'all ' + Object.values(items.CATALOG).flat().length + ' item meshes built OK';
})()`);
console.log('FURNITURE:', buildReport);
// high overview
await ev(`(() => { const g=window.__game; g.orbit.dist=900; g.orbit.pitch=1.15; return 'ok'; })()`);
await place(0, 0, 0.0, 1.15);
await sleep(2400); await shot('v2-overview');

chrome.kill(); process.exit(0);
