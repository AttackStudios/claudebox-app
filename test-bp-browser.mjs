// Backpacking browser E2E: boots with a ClaudeBox identity, walks (sound
// state), places camp items, roasts a marshmallow, drives a van, meets a
// bear (death + respawn at lodge), and captures screenshots along the way.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9246',
  '--user-data-dir=/tmp/bp-cdp-e2e', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,800', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

let page = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    const ts = await (await fetch('http://localhost:9246/json/list')).json();
    page = ts.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let id = 0; const waiters = new Map(); const errors = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description || '').slice(0, 250));
  const w = waiters.get(m.id);
  if (w) { waiters.delete(m.id); w(m); }
});
const send = (m, p = {}) => new Promise((res) => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (file) => {
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('claudebox.user', 'CampTester');" });
await fetch('http://localhost:8787/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'CampTester' }) });
await send('Page.navigate', { url: 'http://localhost:8787/games/backpacking?dev=1' });
await sleep(11000);

ok('booted straight in (no login)', await ev("window.__game?.me?.name === 'CampTester'"));
ok('no JS errors at boot', errors.length === 0);

// ---- daytime lodge screenshot ----
await ev('window.__game.clockOverride = 0.3');
await sleep(1200);
await shot('/tmp/bp-day-lodge.jpg');

// ---- walking + sound state ----
await ev('window.__game.audio.unlock()');
await sleep(300);
await ev("window.__game.controls.keys.add('KeyW')");
await sleep(1200);
ok('walk sound playing while walking', await ev('window.__game.audio.walking === true && !window.__game.audio.walk.paused'));
await ev("window.__game.controls.keys.delete('KeyW')");
await sleep(700);
ok('walk sound stops on stop', await ev('window.__game.audio.walking === false'));

// ---- place tent + campfire ----
await ev(`(() => { const g = window.__game; g.inventory.addToHotbar('tent', '#c0564a'); })()`);
await sleep(400);
await ev('window.__game.actions.primary()'); // place tent
await sleep(900);
await ev(`(() => { const g = window.__game; g.inventory.addToHotbar('campfire', null); })()`);
await sleep(400);
await ev('window.__game.actions.primary()'); // place campfire
await sleep(900);
ok('tent + campfire placed', (await ev('[...window.__game.items.values()].filter(i => ["tent","campfire"].includes(i.data.kind)).length')) >= 2);

// ---- roast + eat ----
// stand right next to the campfire we just placed (a real player walks up to it)
await ev(`(() => {
  const g = window.__game;
  const fire = [...g.items.values()].find(i => i.data.kind === 'campfire');
  if (fire) { g.player.pos.x = fire.data.x + 1.4; g.player.pos.z = fire.data.z; }
})()`);
await ev(`(() => { const g = window.__game; g.inventory.addToHotbar('marshmallow', null); })()`);
await sleep(600);
const roastAvail = await ev(`(() => { const g = window.__game; return !!document.querySelector('#action-stack') && g.roast.stage === 'raw'; })()`);
await ev('window.__game.actions.primary()'); // roast
await sleep(700);
ok('roasting started (locked pose)', roastAvail && await ev("window.__game.roast.stage === 'roasting'"));
await sleep(4200);
ok('marshmallow roasted', await ev("window.__game.roast.stage === 'roasted'"));
await shot('/tmp/bp-roast.jpg');
await ev('window.__game.actions.primary()'); // eat
await sleep(500);
ok('marshmallow eaten', await ev("window.__game.roast.stage === 'raw'"));

// ---- night campsite shot with fire + tent ----
await ev('window.__game.clockOverride = 0.8');
await sleep(1400);
await shot('/tmp/bp-night-camp.jpg');
await ev('window.__game.clockOverride = 0.3');

// ---- drive a van ----
await ev(`(() => {
  const g = window.__game;
  const van = [...g.vans.values()][0];
  g.player.pos.x = van.group.position.x + 3;
  g.player.pos.z = van.group.position.z;
  g.player.pos.y = van.group.position.y + 1;   // land on the van's ground, not underground
  g.player.vel && (g.player.vel.x = g.player.vel.z = 0);
})()`);
await sleep(1400);
await ev('window.__game.actions.vanToggle()');
await sleep(900);
ok('took the driver seat', await ev('window.__game.driving === true'));
await ev("window.__game.controls.keys.add('KeyW')");
await sleep(2600);
const speed = await ev('window.__game.vanSim?.speed || 0');
ok('van accelerates (sim feel)', speed > 4);
ok('van sound playing while moving', await ev('!window.__game.audio.van.paused'));
ok('speedometer visible', await ev("!document.getElementById('speedo').classList.contains('hidden')"));
await shot('/tmp/bp-driving.jpg');
await ev("window.__game.controls.keys.delete('KeyW')");
await sleep(2500);
await ev('window.__game.actions.vanToggle()'); // exit
await sleep(800);
ok('exited the van', await ev('window.__game.driving === false'));
ok('van sound stopped', await ev('window.__game.audio.van.paused'));

// ---- bear encounter: teleport next to a bear and wait ----
await ev(`(() => {
  const g = window.__game;
  const bear = [...g.bears.values()][0];
  g.player.pos.x = bear.group.position.x + 2;
  g.player.pos.z = bear.group.position.z + 2;
  g.player.pos.y = bear.group.position.y + 1;
})()`);
let died = false;
for (let i = 0; i < 24; i++) {
  await sleep(500);
  if (await ev('window.__game.dead === true')) { died = true; break; }
}
ok('bear caught and killed me', died);
if (died) await shot('/tmp/bp-death.jpg');
await sleep(3500);
ok('respawned at the lodge', await ev(`(() => {
  const g = window.__game;
  return !g.dead && Math.hypot(g.player.pos.x - -200, g.player.pos.z - 1200) < 10;
})()`));

ok('no JS errors overall', errors.length === 0);
if (errors.length) console.log('ERRORS:', errors.slice(0, 6));

let fails = 0;
for (const [s, n] of results) { console.log((s === 'PASS' ? '✓ ' : '✗ ') + n); if (s === 'FAIL') fails++; }
console.log(fails ? fails + ' FAILURES' : 'ALL ' + results.length + ' BP BROWSER TESTS PASSED');
chrome.kill();
process.exit(fails ? 1 : 0);
