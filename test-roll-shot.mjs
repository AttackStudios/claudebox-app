// Action shot: a bird frozen mid-barrel-roll with the chase cam.
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9241;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync('/tmp/ff-cdp-roll', { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/ff-cdp-roll', '--no-first-run', '--mute-audio', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
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
await sleep(5500);
// pick the peryton so the shot shows a quadruped flying
await ev(`document.querySelectorAll('.set-tab')[3].click(); 'ok'`);
await sleep(300);
await ev(`[...document.querySelectorAll('.breed-card')].find((c) => c.textContent.includes('Peryton'))?.click(); 'ok'`);
await sleep(300);
await ev(`document.getElementById('menu-name').value = 'RollDemo'; document.getElementById('menu-play').click(); 'ok'`);
await sleep(3500);
await ev(`(() => { const g = window.__game; g.controls.poll = (i) => { i.x = 0; i.z = 0; return i; };
  const p = g.player; p.pos.x = -40; p.pos.z = 40; p.pos.y = 60; p.toggleFly(); p.thrust = true; p.airspeed = 22; 'ok'; })()`);
await sleep(1500);
await ev(`(() => { const p = window.__game.player; p.steer.roll = 1; 'ok'; })()`);
await sleep(620);   // ~mid-roll
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
fs.writeFileSync('/tmp/ff-shots/barrel-roll.jpg', Buffer.from(shot.result.data, 'base64'));
console.log('roll state:', await ev(`JSON.stringify({ roll: +window.__game.player.roll.toFixed(2), speed: +window.__game.player.airspeed.toFixed(1) })`));
chrome.kill();
process.exit(0);
