// Reset a player's Restaurant Simulator 2 restaurant back to the starter
// template (4 tables, basic kitchen, $1000 cash) as if it never happened.
// Usage: node reset-restaurant.mjs <PlayerName>
// The ClaudeBox server must be running. If the player is in-game, their
// session reconnects automatically.
import WebSocket from 'ws';

const name = process.argv[2];
if (!name) {
  console.log('Usage: node reset-restaurant.mjs <PlayerName>');
  process.exit(1);
}

const ws = new WebSocket('ws://localhost:8787/rs2-ws');
const timeout = setTimeout(() => { console.log('✗ timed out — is the server running?'); process.exit(1); }, 8000);

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, avatar: {} })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') {
    if (m.plotId == null) {
      console.log(`✗ ${name} doesn't own a restaurant.`);
      process.exit(1);
    }
    ws.send(JSON.stringify({ t: 'restaurant.reset' }));
  }
  if (m.t === 'toast' && m.text.includes('Fresh start')) {
    clearTimeout(timeout);
    console.log(`✓ ${name}'s restaurant reset to the starter template, cash back to $1000.`);
    ws.close();
    process.exit(0);
  }
});
ws.on('error', () => { console.log('✗ could not connect — is the server running?'); process.exit(1); });
