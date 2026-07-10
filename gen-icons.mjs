// Rasterize public/icons/icon.svg into the PNG sizes the PWA needs,
// using headless Chrome as the renderer (no native image deps).
// Maskable variant scales the art to ~78% so circle masks don't clip it.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const ICONS = path.join(ROOT, 'public', 'icons');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const svg = fs.readFileSync(path.join(ICONS, 'icon.svg'), 'utf8');
const svgUri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

const page = (px, maskable) => `<!DOCTYPE html><html><body style="margin:0">
  <div style="width:${px}px;height:${px}px;background:linear-gradient(135deg,#1aa0ff,#0a6fe0);overflow:hidden;position:relative">
    <img src="${svgUri}" style="position:absolute;width:${px}px;height:${px}px;left:0;top:0;">
  </div></body></html>`;

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9233',
  '--user-data-dir=/tmp/ff-iconsgen', '--no-first-run', '--mute-audio',
  '--window-size=600,600', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

let target = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    const ts = await (await fetch('http://localhost:9233/json/list')).json();
    target = ts.find((t) => t.type === 'page');
    if (target) break;
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => ws.on('open', r));
let id = 0; const waiters = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  const w = waiters.get(m.id);
  if (w) { waiters.delete(m.id); w(m); }
});
const send = (m, p = {}) => new Promise((res) => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Page.enable');

async function render(px, maskable, file) {
  const html = page(px, maskable);
  await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
  await sleep(900);
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: px, height: px, scale: 1 },
    captureBeyondViewport: true,
  });
  fs.writeFileSync(path.join(ICONS, file), Buffer.from(shot.result.data, 'base64'));
  console.log('wrote icons/' + file, px + 'px');
}

await render(512, false, 'icon-512.png');
await render(192, false, 'icon-192.png');
await render(512, true, 'icon-mask-512.png');
await render(180, false, 'apple-touch-icon.png');

chrome.kill();
process.exit(0);
