// Renders every breed (adult + baby) with the v3 factory into /tmp/ff-birds/
// for side-by-side review against the reference sheet.
// Usage: node test-birds-gallery.mjs [breed ...]   (default: all breeds)
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9237;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync('/tmp/ff-cdp-birds', { recursive: true, force: true });
fs.mkdirSync('/tmp/ff-birds', { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/ff-cdp-birds', '--no-first-run', '--mute-audio', '--window-size=900,900', 'about:blank'], { stdio: 'ignore' });
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
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8787/games/feather-friends?dev=1' });
await sleep(4500);

// stand up an isolated studio renderer inside the page (import map is there)
await ev(`(async () => {
  const THREE = await import('three');
  const { buildBird } = await import('/js/birds/factory.js');
  const { BREEDS } = await import('/js/birds/breeds.js');
  const { animateBird, makeAnimState } = await import('/js/birds/animate.js');
  window.__anim = { animateBird, makeAnimState };
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(700, 700);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8eef4');
  scene.add(new THREE.AmbientLight('#cfd8e8', 1.3));
  const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  window.__studio = { THREE, buildBird, BREEDS, renderer, scene, cam, current: null };
  return Object.keys(BREEDS).join(',');
})()`);

const breeds = process.argv.length > 2
  ? process.argv.slice(2)
  : (await ev(`Object.keys(window.__studio.BREEDS).join(',')`)).split(',');

for (const breed of breeds) {
  for (const stage of ['adult', 'baby']) {
    const dataUrl = await ev(`(() => {
      const st = window.__studio;
      if (st.current) st.scene.remove(st.current);
      const bird = st.buildBird('${breed}', {}, '${stage}');
      st.current = bird.group;
      st.scene.add(bird.group);
      // settle into the resting (idle) pose so wings fold like they do in-game
      const anim = window.__anim.makeAnimState();
      anim.anim = 'idle';
      for (let f = 0; f < 90; f++) window.__anim.animateBird(bird, anim, 1 / 60);
      // 3/4 view, framed by the bird's overall size
      const bb = new st.THREE.Box3().setFromObject(bird.group);
      const size = bb.getSize(new st.THREE.Vector3()).length();
      const center = bb.getCenter(new st.THREE.Vector3());
      st.cam.position.set(center.x + size * 0.72, center.y + size * 0.3, center.z + size * 0.85);
      st.cam.lookAt(center);
      st.renderer.render(st.scene, st.cam);
      return st.renderer.domElement.toDataURL('image/jpeg', 0.88);
    })()`);
    fs.writeFileSync(`/tmp/ff-birds/${breed}-${stage}.jpg`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('saved', breed, stage);
  }
}
chrome.kill();
process.exit(0);
