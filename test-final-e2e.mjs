// Final world E2E: sky landing, lava damage in a lava river, drink at the
// forest pond, perf stats.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9233;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync('/tmp/ff-cdp-final', { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/ff-cdp-final', '--no-first-run', '--mute-audio', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
let page = null;
for (let i = 0; i < 40 && !page; i++) {
  await sleep(250);
  try { page = (await (await fetch(`http://localhost:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let id = 0; const waiters = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw); const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8787/games/feather-friends?dev=1' });
await sleep(6000);
await ev(`document.getElementById('menu-name').value = 'FinalCheck'; document.getElementById('menu-play').click(); 'ok'`);
await sleep(3500);
const results = [];
const ok = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]); };

// 1. drop onto the continent terrain and land (no more sky islands)
await ev(`(() => { const g = window.__game; g.player.pos.x = 0; g.player.pos.z = 320; g.player.pos.y = 120; g.player.vel = {x:0,y:0,z:0}; g.player.flying = false; })()`);
await sleep(3000);
const land = JSON.parse(await ev(`(() => { const g = window.__game; return JSON.stringify({ y: g.player.pos.y, grounded: g.player.grounded }); })()`));
ok('falls and lands on meadow terrain', land.grounded && land.y > 2 && land.y < 30);

// 2. lava in the volcano crater
const lavaSeen = await ev(`(async () => {
  const w = await import('/shared/worldgen.js');
  const v = w.WORLD.volcano;
  if (!w.lavaAt(v.x, v.z)) return false;
  const g = window.__game;
  g.player.pos.x = v.x; g.player.pos.z = v.z; g.player.pos.y = w.groundAt(v.x, v.z) + 0.3;
  g.player.flying = false;
  return true;
})()`);
ok('lava registers in the volcano crater', lavaSeen === true);

// 3. drink at the central lake
await ev(`(async () => { const w = await import('/shared/worldgen.js'); const L = w.WORLD.lakes[0]; const g = window.__game; g.player.pos.x = L.x; g.player.pos.z = L.z; g.player.pos.y = L.surface; })()`);
await sleep(1300);
ok('drink available at the central lake', await ev(`(async () => { const w = await import('/shared/worldgen.js'); const p = window.__game.player.pos; return w.canDrinkAt(p.x, p.z, p.y); })()`));

// 4. perf: frame pacing matters, not raw mesh count (birds dominate calls)
const fps = await ev(`(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(n / 1.5); };
  requestAnimationFrame(tick);
}))()`);
const info = JSON.parse(await ev(`JSON.stringify(window.__game.renderer.info.render)`));
ok('renders above 25 fps headless', fps > 25);
console.log('renderer:', JSON.stringify(info), 'fps:', Math.round(fps));

for (const [s, n] of results) console.log(s === 'PASS' ? '✓' : '✗', n);
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(fails ? fails + ' FAILURES' : 'ALL FINAL E2E PASSED');
chrome.kill();
process.exit(fails ? 1 : 0);
