// Camera-relative flight E2E: the bird flies where the free-look camera
// points, so the test aims the orbit camera (orbit.pitch) and asserts the
// bird follows — climb when looking up, dive when looking down, thrust builds
// speed, dives gain it, barrel roll via Q/E, slow descent lands. Server up.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9239;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync('/tmp/ff-cdp-flight', { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/ff-cdp-flight', '--no-first-run', '--mute-audio', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

let page = null;
for (let i = 0; i < 40 && !page; i++) {
  await sleep(250);
  try { page = (await (await fetch(`http://localhost:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let id = 0; const waiters = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw); const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8787/games/feather-friends?dev=1' });
await sleep(5500);
await ev(`document.getElementById('menu-name').value = 'AcePilot'; document.getElementById('menu-play').click(); 'ok'`);
await sleep(3500);

const results = [];
const ok = (name, cond, info = '') => { results.push([cond ? 'PASS' : 'FAIL', name + (info ? ` (${info})` : '')]); };
const P = () => ev(`(() => { const p = window.__game.player; return JSON.stringify({
  flying: p.flying, y: +p.pos.y.toFixed(1), speed: +p.airspeed.toFixed(1),
  pitch: +p.pitch.toFixed(2), roll: +p.roll.toFixed(2), grounded: p.grounded }); })()`).then(JSON.parse);

// stop the real input poll from fighting our scripted state
await ev(`(() => { const g = window.__game; g.controls.poll = (i) => { i.x = 0; i.z = 0; return i; }; g.player.pos.x = 0; g.player.pos.z = 320; return 'ok'; })()`);
const set = (fields) => ev(`(() => { Object.assign(window.__game.player, ${JSON.stringify(fields)}); 'ok'; })()`);
const setCam = (pitch) => ev(`(() => { window.__game.orbit.pitch = ${pitch}; 'ok'; })()`);
const roll = (v) => ev(`(() => { window.__game.player.steer.roll = ${v}; 'ok'; })()`);

// 1. takeoff
await ev(`window.__game.player.toggleFly(); 'ok'`);
await sleep(400);
let s = await P();
ok('takeoff: flying with airspeed', s.flying && s.speed >= 5, `speed=${s.speed}`);

// 2. look level + thrust → builds cruise speed
await setCam(0);
await set({ thrust: true });
await sleep(3000);
s = await P();
const cruise = s.speed;
ok('thrust builds cruise speed', cruise > 18, `speed=${cruise}`);

// 3. look UP (camera pitch negative) → bird climbs, speed bleeds
await setCam(-1.0);
await sleep(1200);
s = await P();
ok('looking up climbs the bird', s.pitch > 0.6, `pitch=${s.pitch}`);
await sleep(1400);
s = await P();
ok('climb bleeds airspeed', s.speed < cruise - 3, `speed=${s.speed} vs ${cruise}`);

// 4. look straight up → near-vertical climb
await setCam(-1.4);
await sleep(1400);
s = await P();
ok('can climb near-vertical', s.pitch > 1.1, `pitch=${s.pitch}`);

// 5. look DOWN, no thrust, from altitude → dive gains speed
await set({ thrust: false });
await ev(`window.__game.player.pos.y = 178; 'ok'`);
await setCam(1.2);
const preDive = (await P()).speed;
await sleep(3000);
s = await P();
ok('diving gains speed (no thrust)', s.speed > preDive + 3, `speed=${preDive}->${s.speed}`);

// 6. barrel roll: Q/E roll input, passes inverted, then auto-levels
await setCam(0);
await ev(`window.__game.player.pos.y = 150; window.__game.player.airspeed = 20; 'ok'`);
await set({ thrust: true });
await roll(1);
let sawInverted = false;
for (let i = 0; i < 14; i++) { await sleep(120); if (Math.abs((await P()).roll) > 2.4) sawInverted = true; }
ok('barrel roll passes inverted', sawInverted);
await roll(0);
await sleep(1800);
s = await P();
ok('roll auto-levels after release', Math.abs(s.roll) < 0.3, `roll=${s.roll}`);

// 7. glide down slow → lands
await setCam(0);
await ev(`(() => { const p = window.__game.player; p.pos.x = 0; p.pos.z = 320; p.pos.y = 16; p.airspeed = 7; p.roll = 0; 'ok'; })()`);
await set({ thrust: false });
await sleep(5000);
s = await P();
ok('slow descent lands (flight exits)', !s.flying && s.grounded, `y=${s.y}`);

// 8. snapshot carries rx/rz attitude
const snap = await ev(`(async () => {
  return await new Promise((res) => {
    const ws2 = new WebSocket('ws://' + location.host + '/ws');
    ws2.onopen = () => ws2.send(JSON.stringify({ t: 'join', dev: 1, name: 'Watcher', bird: { breed: 'robin', stage: 'adult', colors: {} } }));
    ws2.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'snapshot' && m.players.length) { ws2.close(); res(JSON.stringify(m.players.find((p) => p.length >= 8) || null)); } };
    setTimeout(() => res(null), 6000);
  });
})()`);
ok('snapshot carries rx/rz attitude', !!snap && JSON.parse(snap).length >= 8);

let fails = 0;
for (const [st, name] of results) { console.log(st === 'PASS' ? '✓' : '✗', name); if (st === 'FAIL') fails++; }
console.log(fails ? `${fails} FAILURES` : `ALL ${results.length} FLIGHT TESTS PASSED`);
chrome.kill();
process.exit(fails ? 1 : 0);
