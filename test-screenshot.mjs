// Capture aerial screenshots of the island for visual inspection.
// Usage: node test-screenshot.mjs [x y z lookX lookZ name]...defaults to a grand tour.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9227;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/ff-cdp-shot', '--no-first-run', '--mute-audio',
  '--window-size=1280,800', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

let page = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    const ts = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
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
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });

await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8787/games/feather-friends?dev=1' });
await sleep(5000);
await ev(`document.getElementById('menu-name').value = 'CameraDrone'; document.getElementById('menu-play').click();`);
await sleep(4000);

const defaultShots = [
  // [camX, camY, camZ, lookX, lookY, lookZ, name]  — 4096 continent
  [0, 2600, 1700, 0, 0, -200, 'overview'],
  [0, 30, 540, 0, 18, 0, 'spawn-sealevel'],     // sea-level: must NOT see whole map
  [-120, 360, -700, -120, 120, -1380, 'mountains'],
  [-1180, 130, 300, -1180, 30, -300, 'forest'],
  [1280, 200, 700, 1280, 40, 180, 'desert'],
  [340, 120, 1850, 340, 20, 1300, 'jungle'],
  [-1240, 240, 1560, -1240, 60, 1020, 'volcano'],
  [1080, 200, -560, 1080, 50, -1000, 'autumn'],
  [240, 70, 1100, 240, 6, 640, 'central-lake'],
  [-260, 60, -640, -260, 8, -980, 'ice-lake'],
];
const shots = process.argv.length > 2
  ? [process.argv.slice(2, 8).map(Number).concat(process.argv[8] || 'custom')].map((a) => a)
  : defaultShots;

fs.mkdirSync('/tmp/ff-shots', { recursive: true });
for (const [cx, cy, cz, lx, ly, lz, name] of shots) {
  await ev(`
    (() => {
      const g = window.__game;
      g.__freeCam = true;
      g.camera.position.set(${cx}, ${cy}, ${cz});
      g.camera.lookAt(${lx}, ${ly}, ${lz});
      g.camera.updateProjectionMatrix();
      // park the player far underground so it doesn't block the view + stop orbit control
      g.orbit.update = () => {};
      g.renderer.render(g.scene, g.camera);
    })()
  `);
  await sleep(700);
  await ev(`(() => { const g = window.__game; g.camera.position.set(${cx}, ${cy}, ${cz}); g.camera.lookAt(${lx}, ${ly}, ${lz}); g.renderer.render(g.scene, g.camera); })()`);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  fs.writeFileSync(`/tmp/ff-shots/${name}.jpg`, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', name);
}
chrome.kill();
process.exit(0);
