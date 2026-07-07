// Synthetic two-client protocol test. Run: node test-protocol.mjs
import WebSocket from 'ws';

const URL = 'ws://localhost:8787/ws';
const FLOCK = 'Sky' + (Date.now() % 100000); // unique per run — flocks persist in saves
const results = [];
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);

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
  const waitFor = (pred, ms = 3000) => new Promise((resolve, reject) => {
    const found = inbox.find(pred);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error(name + ': timeout')), ms);
    waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
  });
  return new Promise((res) => ws.on('open', () => res({ ws, send, waitFor, inbox, name })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // ---- join two players ----
  const alice = await client('alice');
  alice.send({ t: 'join', dev: 1, name: 'Alice', bird: { breed: 'eagle', stage: 'adult', colors: { body: '#112233' } }, nameStyle: { color: '#ff0000', style: 'glow' } });
  const w1 = await alice.waitFor((m) => m.t === 'welcome');
  ok('welcome has id', !!w1.id);
  ok('welcome has npcs', w1.npcs.length > 0);
  ok('welcome has items', w1.items.length > 0);
  ok('bird sanitized', w1.you.bird.breed === 'eagle' && w1.you.bird.colors.body === '#112233');

  const bob = await client('bob');
  bob.send({ t: 'join', dev: 1, name: 'Bob', bird: { breed: 'penguin', stage: 'egg', colors: {} }, nameStyle: {} });
  const w2 = await bob.waitFor((m) => m.t === 'welcome');
  ok('bob sees alice', w2.players.some((p) => p.name === 'Alice'));
  const joinNotice = await alice.waitFor((m) => m.t === 'player.join');
  ok('alice notified of bob', joinNotice.player.name === 'Bob');

  // ---- movement snapshots ----
  alice.send({ t: 'move', x: 5, y: 2, z: -7, ry: 1.5, anim: 'walk' });
  const snap = await bob.waitFor((m) => m.t === 'snapshot' && m.players.some((p) => p[0] === w1.id && p[1] === 5));
  ok('movement in snapshot', !!snap);
  ok('npcs in snapshot', snap.npcs.length > 0);

  // ---- chat ----
  alice.send({ t: 'chat', text: 'hello world!' });
  const chatMsg = await bob.waitFor((m) => m.t === 'chat');
  ok('chat broadcast', chatMsg.text === 'hello world!' && chatMsg.name === 'Alice');

  // ---- stage change (egg -> baby) + fx ----
  bob.send({ t: 'stage', stage: 'baby' });
  const upd = await alice.waitFor((m) => m.t === 'player.update' && m.id === w2.id);
  ok('stage broadcast', upd.bird.stage === 'baby');
  const fx = await alice.waitFor((m) => m.t === 'fx' && m.kind === 'hatch');
  ok('hatch fx', fx.id === w2.id);

  // ---- item pickup + eat ----
  const item = w1.items[0];
  alice.send({ t: 'move', x: item.x, y: item.y, z: item.z, ry: 0, anim: 'idle' });
  await sleep(150);
  alice.send({ t: 'pickup', kind: 'item', id: item.id });
  const carry = await bob.waitFor((m) => m.t === 'carry' && m.kind === 'item');
  ok('item pickup broadcast', carry.id === item.id && carry.carrierId === w1.id);
  alice.send({ t: 'eat' });
  const removed = await bob.waitFor((m) => m.t === 'item.remove');
  ok('item eaten', removed.id === item.id && removed.reason === 'eaten');

  // ---- carrying a baby player ----
  bob.send({ t: 'move', x: item.x, y: item.y, z: item.z, ry: 0, anim: 'idle' });
  await sleep(150);
  alice.send({ t: 'pickup', kind: 'player', id: w2.id });
  const pcarry = await bob.waitFor((m) => m.t === 'carry' && m.kind === 'player');
  ok('player carried', pcarry.id === w2.id);
  bob.send({ t: 'wiggle' });
  const freed = await alice.waitFor((m) => m.t === 'carry' && m.kind === null);
  ok('wiggle free', freed.carrierId === w1.id);

  // ---- nests ----
  alice.send({ t: 'nest.make', x: 10, y: 4, z: 12, twig: '#884422', lining: '#ddcc88' });
  const nest = await bob.waitFor((m) => m.t === 'nest.set');
  ok('nest broadcast', nest.ownerName === 'Alice' && nest.nest.twig === '#884422');
  alice.send({ t: 'nest.colors', twig: '#111111', lining: '#222222' });
  const nest2 = await bob.waitFor((m) => m.t === 'nest.set' && m.nest.twig === '#111111');
  ok('nest recolor', nest2.nest.lining === '#222222');

  // ---- flocks ----
  alice.send({ t: 'flock.create', name: FLOCK, color: '#ffcc00' });
  const fUpd = await bob.waitFor((m) => m.t === 'flock.update');
  ok('flock created', fUpd.flock.name === FLOCK && fUpd.flock.leader === 'alice');
  alice.send({ t: 'flock.invite', playerId: w2.id });
  const invite = await bob.waitFor((m) => m.t === 'flock.invited');
  ok('invite received', invite.from === 'Alice');
  bob.send({ t: 'flock.respond', accept: true, flock: FLOCK });
  const fUpd2 = await alice.waitFor((m) => m.t === 'flock.update' && m.flock.members.length === 2);
  ok('bob joined flock', fUpd2.flock.members.includes('bob'));
  bob.send({ t: 'flock.leave' });
  
  const fUpd3 = await alice.waitFor((m) => m.t === 'flock.update' && m.flock.members.length === 1);
  ok('bob left flock', !fUpd3.flock.members.includes('bob'));

  // ---- persistence: bob reconnects, gets his saved bird ----
  bob.ws.close();
  await sleep(300);
  const bob2 = await client('bob2');
  bob2.send({ t: 'join', dev: 1, name: 'Bob' }); // no bird sent — should load save
  const w3 = await bob2.waitFor((m) => m.t === 'welcome');
  ok('save restored on rejoin', w3.you.bird.breed === 'penguin' && w3.you.bird.stage === 'baby');

  alice.send({ t: 'flock.disband' });
  await sleep(300);
  alice.ws.close();
  bob2.ws.close();
} catch (err) {
  results.push(['FAIL', 'exception: ' + err.message]);
}

let fails = 0;
for (const [status, name] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name}`);
  if (status === 'FAIL') fails++;
}
console.log(fails === 0 ? `\nALL ${results.length} TESTS PASSED` : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
