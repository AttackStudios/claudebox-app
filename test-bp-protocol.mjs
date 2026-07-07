// Backpacking protocol test: two synthetic clients exercise join, movement,
// placement, vans (seats, driving, full), spray, lava death, respawn,
// and persistence. Run: node test-bp-protocol.mjs
import WebSocket from 'ws';

const URL = 'ws://localhost:8787/bp-ws';
const results = [];
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(msg)) waiters.splice(i, 1)[0].resolve(msg);
    }
  });
  const send = (m) => ws.send(JSON.stringify(m));
  const waitFor = (pred, ms = 4000) => new Promise((resolve, reject) => {
    const found = inbox.find(pred);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error(name + ': timeout')), ms);
    waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
  });
  return new Promise((res) => ws.on('open', () => res({ ws, send, waitFor, inbox, name })));
}

try {
  const A = await client('A');
  A.send({ t: 'join', name: 'BpTestA', avatar: { body: 'a', skin: '#e8b48a' }, dev: 1 });
  const wA = await A.waitFor((m) => m.t === 'welcome');
  ok('welcome has vans', wA.vans.length === 9);
  ok('welcome has clock', typeof wA.clock === 'number');
  ok('spawned at lodge', Math.hypot(wA.you.pos.x - -200, wA.you.pos.z - 1200) < 8);

  const B = await client('B');
  B.send({ t: 'join', name: 'BpTestB', avatar: {}, dev: 1 });
  const wB = await B.waitFor((m) => m.t === 'welcome');
  ok('B sees A', wB.players.some((p) => p.name === 'BpTestA'));

  // movement + snapshot
  A.send({ t: 'move', x: -300, y: 7, z: 330, ry: 1, anim: 'walk' });
  const snap = await B.waitFor((m) => m.t === 'snapshot' && m.players.some((p) => p[0] === wA.id && p[1] === -300));
  ok('movement in snapshot', !!snap);
  ok('bears in snapshot', snap.bears.length === 10);

  // place + pickup persistence
  A.send({ t: 'place', kind: 'campfire', x: -302, z: 332, ry: 0, color: '#4f8a55' });
  const added = await B.waitFor((m) => m.t === 'item.add');
  ok('item placed + broadcast', added.item.kind === 'campfire' && added.item.owner === 'bptesta');
  A.send({ t: 'place', kind: 'tent', x: -298, z: 336, ry: 1, color: '#c0564a' });
  const tentMsg = await B.waitFor((m) => m.t === 'item.add' && m.item.kind === 'tent');
  ok('tent placed with color', tentMsg.item.color === '#c0564a');
  A.send({ t: 'pickup', id: added.id });
  const removed = await B.waitFor((m) => m.t === 'item.remove');
  ok('own item picked up', removed.id === added.id);
  // B cannot pick up A's tent
  B.send({ t: 'move', x: -298, y: 7, z: 336, ry: 0, anim: 'idle' });
  await sleep(150);
  B.send({ t: 'pickup', id: tentMsg.id });
  await sleep(400);
  ok("can't pick up someone else's item", !B.inbox.some((m) => m.t === 'item.remove' && m.id === tentMsg.id));

  // vans: A drives, B joins as passenger
  const van = wA.vans[0];
  A.send({ t: 'move', x: van.x + 2, y: 7, z: van.z, ry: 0, anim: 'idle' });
  await sleep(150);
  A.send({ t: 'van.enter', vanId: van.id });
  const seatsA = await A.waitFor((m) => m.t === 'van.seats');
  ok('A took driver seat', seatsA.seats[0] === wA.id);
  B.send({ t: 'move', x: van.x + 2, y: 7, z: van.z + 1, ry: 0, anim: 'idle' });
  await sleep(150);
  B.send({ t: 'van.enter', vanId: van.id });
  const seatsB = await B.waitFor((m) => m.t === 'van.seats' && m.seats[1] !== null);
  ok('B took passenger seat', seatsB.seats[1] === wB.id);
  // driver streams the van
  A.send({ t: 'van.state', x: van.x + 30, y: 7, z: van.z + 5, ry: 0.4, pitch: 0, roll: 0, speed: 12 });
  const vsnap = await B.waitFor((m) => m.t === 'snapshot' && m.vans.some((v) => v[0] === van.id && v[1] === van.x + 30));
  ok('van movement in snapshot', !!vsnap);
  // passenger cannot stream
  B.send({ t: 'van.state', x: 0, y: 0, z: 0, ry: 0, pitch: 0, roll: 0, speed: 99 });
  await sleep(300);
  ok('passenger cannot stream van', !B.inbox.some((m) => m.t === 'snapshot' && m.vans.some((v) => v[0] === van.id && v[1] === 0)));
  A.send({ t: 'van.exit' });
  B.send({ t: 'van.exit' });
  await A.waitFor((m) => m.t === 'van.seats' && m.seats.every((s) => s === null));
  ok('both exited the van', true);

  // spray broadcasts
  A.send({ t: 'spray', dirX: 0, dirZ: 1 });
  const spray = await B.waitFor((m) => m.t === 'spray.fx');
  ok('spray fx broadcast', spray.id === wA.id);

  // lava death (validated server-side) → respawn at lodge
  A.send({ t: 'move', x: 1080, y: 72, z: -260, ry: 0, anim: 'idle' }); // caldera lava
  await sleep(150);
  A.send({ t: 'die', cause: 'lava' });
  const death = await B.waitFor((m) => m.t === 'player.death');
  ok('lava death broadcast', death.id === wA.id && death.cause === 'lava');
  await sleep(1600);
  A.send({ t: 'respawn' });
  const resp = await A.waitFor((m) => m.t === 'player.respawn');
  ok('respawned at lodge', Math.hypot(resp.x - -200, resp.z - 1200) < 8);

  // fake lava death rejected when not in lava
  B.send({ t: 'die', cause: 'lava' });
  await sleep(400);
  ok('fake lava death rejected', !A.inbox.some((m) => m.t === 'player.death' && m.id === wB.id));

  // tent persists for a fresh client
  const C = await client('C');
  C.send({ t: 'join', name: 'BpTestC', avatar: {}, dev: 1 });
  const wC = await C.waitFor((m) => m.t === 'welcome');
  ok('placed tent persists in welcome', Object.values(wC.items).some((i) => i.kind === 'tent' && i.owner === 'bptesta'));

  // clean up the tent so test reruns stay tidy
  A.send({ t: 'move', x: -298, y: 7, z: 336, ry: 0, anim: 'idle' });
  await sleep(150);
  A.send({ t: 'pickup', id: tentMsg.id });
  await sleep(300);

  A.ws.close(); B.ws.close(); C.ws.close();
} catch (err) {
  results.push(['FAIL', 'exception: ' + err.message]);
}

let fails = 0;
for (const [status, name] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name}`);
  if (status === 'FAIL') fails++;
}
console.log(fails === 0 ? `\nALL ${results.length} BP TESTS PASSED` : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
