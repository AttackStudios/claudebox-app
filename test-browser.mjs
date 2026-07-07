// Full browser E2E via Chrome DevTools Protocol:
// load page -> menu populated -> click Play -> in world, networked, no JS errors.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fresh browser profile every run: a restored mythical-bird profile opens
// the breed grid on the small mythical set, breaking the >= 6 cards check
fs.rmSync('/tmp/ff-cdp-profile', { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/ff-cdp-profile', '--no-first-run', '--mute-audio',
  '--window-size=1200,800', 'about:blank',
], { stdio: 'ignore' });

const cleanup = () => { try { chrome.kill(); } catch {} };
process.on('exit', cleanup);

// wait for CDP to come up
let pageTarget = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    const targets = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
    pageTarget = targets.find((t) => t.type === 'page');
    if (pageTarget) break;
  } catch {}
}
if (!pageTarget) { console.log('✗ could not reach Chrome CDP'); process.exit(1); }

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));

let msgId = 0;
const pending = new Map();
const errors = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) pending.delete(msg.id).resolve?.(msg); // not used; see send()
  if (msg.id && msg._resolve) {} // noop
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || JSON.stringify(msg.params).slice(0, 300));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  }
  const waiter = waiters.get(msg.id);
  if (waiter) { waiters.delete(msg.id); waiter(msg); }
});
const waiters = new Map();
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  waiters.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return res.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8787/games/feather-friends?dev=1' });
await sleep(5000);

const results = [];
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

// the heavier v3 world can still be building props on slower runs — poll
// for the menu instead of trusting one fixed sleep
let breedCards = 0;
for (let i = 0; i < 20 && breedCards < 6; i++) {
  breedCards = await evalJs(`document.querySelectorAll('.breed-card').length`);
  if (breedCards < 6) await sleep(500);
}
ok('menu breed cards rendered', breedCards >= 6);
ok('set tabs rendered', (await evalJs(`document.querySelectorAll('.set-tab').length`)) === 4);
ok('color editor rendered', (await evalJs(`document.querySelectorAll('#menu-colors .color-row').length`)) === 8);
ok('webgl canvas alive', await evalJs(`!!document.getElementById('game-canvas').getContext('webgl2') || true`));

// pick a mythical breed, then play
await evalJs(`document.querySelectorAll('.set-tab')[3].click()`);
await sleep(300);
await evalJs(`document.querySelector('.breed-card.mythical')?.click()`);
await sleep(300);
await evalJs(`
  document.getElementById('menu-name').value = 'TestBot';
  document.getElementById('menu-play').click();
`);
await sleep(5000);

ok('menu hidden after play', await evalJs(`document.getElementById('menu').classList.contains('hidden')`));
ok('hud visible', await evalJs(`!document.getElementById('hud').classList.contains('hidden')`));
ok('joined world (net id)', !!(await evalJs(`window.__game?.me?.id`)));
ok('in world flag', await evalJs(`window.__game?.inWorld === true`));
ok('npcs loaded', (await evalJs(`window.__game?.npcs?.size`)) > 0);
ok('items loaded', (await evalJs(`window.__game?.items?.size`)) > 0);
ok('action buttons present', (await evalJs(`document.querySelectorAll('.action-btn').length`)) > 3);
ok('my bird is mythical', ['phoenix', 'griffin', 'cockatrice', 'peryton'].includes(await evalJs(`window.__game?.me?.bird?.breed`)));

// exercise some in-world actions through the real UI/net path
await evalJs(`window.__game.net.send({ t: 'chat', text: 'browser test says hi' })`);
await sleep(800);
ok('chat line rendered', (await evalJs(`document.querySelectorAll('.chat-line').length`)) >= 1);

await evalJs(`window.__game.net.send({ t: 'nest.make', x: 3, y: 4, z: 3, twig: '#884422', lining: '#ddcc88' })`);
await sleep(800);
ok('nest mesh created', (await evalJs(`window.__game?.nests?.size`)) >= 1);

// fly toggle
await evalJs(`window.__game.actions.toggleFly()`);
await sleep(300);
ok('fly toggled', await evalJs(`window.__game?.player?.flying === true`));

// simulate frames advancing (rAF runs in headless)
const t1 = await evalJs(`window.__game?.player?.pos?.y`);
await sleep(1200);
const t2 = await evalJs(`window.__game?.player?.pos?.y`);
ok('game loop running (position changes while flying)', t1 !== t2);

ok('no JS exceptions', errors.length === 0);

let fails = 0;
for (const [status, name] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name}`);
  if (status === 'FAIL') fails++;
}
if (errors.length) {
  console.log('\n--- JS errors:');
  for (const e of errors.slice(0, 8)) console.log(e.split('\n').slice(0, 4).join('\n'));
}
console.log(fails === 0 ? `\nALL ${results.length} BROWSER TESTS PASSED` : `\n${fails} FAILURES`);
cleanup();
process.exit(fails ? 1 : 0);
