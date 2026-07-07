// Two-browser carry test: an adult picks up an egg player, walks far away,
// puts it down — the egg must stay at the drop point on BOTH clients.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info = '') => results.push([cond ? 'PASS' : 'FAIL', name + (info ? ` (${info})` : '')]);

async function launchClient(port, profileDir) {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`, '--no-first-run', '--mute-audio',
    '--window-size=1100,700', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const ts = await (await fetch(`http://localhost:${port}/json/list`)).json();
      page = ts.find((t) => t.type === 'page');
      if (page) break;
    } catch {}
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const waiters = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    const w = waiters.get(m.id);
    if (w) { waiters.delete(m.id); w(m); }
  });
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8787/games/feather-friends' });
  await sleep(4500);
  return { chrome, ev, send };
}

const A = await launchClient(9231, '/tmp/ff-carry-A'); // adult carrier
const B = await launchClient(9232, '/tmp/ff-carry-B'); // egg

// A: adult eagle
await A.ev(`document.getElementById('menu-name').value = 'CarrierBot';
  document.querySelectorAll('.set-tab')[2].click();`);
await sleep(250);
await A.ev(`document.querySelector('.breed-card').click()`);
await sleep(250);
await A.ev(`document.getElementById('menu-play').click()`);

// B: egg
await B.ev(`document.getElementById('menu-name').value = 'EggBot';
  document.querySelectorAll('.stage-card')[0].click();`);
await sleep(250);
await B.ev(`document.getElementById('menu-play').click()`);
await sleep(5000);

// Park the egg at a known spot and remember it
await B.ev(`(() => { const g = window.__game; g.player.pos.x = 5; g.player.pos.z = -5; })()`);
await sleep(1200);
const origin = await B.ev(`({ x: window.__game.player.pos.x, z: window.__game.player.pos.z })`);

// A walks next to the egg and picks it up via the real action path
await A.ev(`(() => { const g = window.__game; g.player.pos.x = 6; g.player.pos.z = -5; })()`);
await sleep(1200);
const pickedUp = await A.ev(`(() => {
  const g = window.__game;
  const target = [...g.players.values()].find((p) => p.data.name === 'EggBot');
  if (!target) return 'no target';
  g.net.send({ t: 'pickup', kind: 'player', id: target.data.id });
  return 'sent';
})()`);
await sleep(1000);
ok('pickup initiated', pickedUp === 'sent');
ok('egg knows it is carried', await B.ev(`!!window.__game.me.carriedBy`));

// A walks far away while carrying (simulate movement over time so the
// movement stream reports it naturally)
for (let step = 0; step < 10; step++) {
  await A.ev(`(() => { const g = window.__game; g.player.pos.x += 4; g.player.pos.z += 2.5; })()`);
  await sleep(260);
}
const carrierPos = await A.ev(`({ x: window.__game.player.pos.x, z: window.__game.player.pos.z })`);

// drop the egg
await A.ev(`window.__game.net.send({ t: 'drop' })`);
await sleep(1800);

const eggSelf = await B.ev(`({ x: window.__game.player.pos.x, z: window.__game.player.pos.z, carried: !!window.__game.me.carriedBy })`);
const eggOnA = await A.ev(`(() => {
  const rec = [...window.__game.players.values()].find((p) => p.data.name === 'EggBot');
  return { x: rec.group.position.x, z: rec.group.position.z };
})()`);

const distSelfToCarrier = Math.hypot(eggSelf.x - carrierPos.x, eggSelf.z - carrierPos.z);
const distSelfToOrigin = Math.hypot(eggSelf.x - origin.x, eggSelf.z - origin.z);
const distViewToCarrier = Math.hypot(eggOnA.x - carrierPos.x, eggOnA.z - carrierPos.z);

ok('egg released', !eggSelf.carried);
ok('egg (own client) stays at drop point', distSelfToCarrier < 5, `dist=${distSelfToCarrier.toFixed(1)}`);
ok('egg (own client) did NOT return to origin', distSelfToOrigin > 20, `dist=${distSelfToOrigin.toFixed(1)}`);
ok('egg (carrier view) stays at drop point', distViewToCarrier < 5, `dist=${distViewToCarrier.toFixed(1)}`);

// nametag visual check from the carrier's side
const shot = await A.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
fs.writeFileSync('/tmp/ff-carry-drop.jpg', Buffer.from(shot.result.data, 'base64'));

A.chrome.kill(); B.chrome.kill();
let fails = 0;
for (const [status, name] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name}`);
  if (status === 'FAIL') fails++;
}
console.log(fails === 0 ? `ALL ${results.length} CARRY TESTS PASSED` : `${fails} FAILURES`);
process.exit(fails ? 1 : 0);
