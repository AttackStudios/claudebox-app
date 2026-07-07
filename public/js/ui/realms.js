// Roleplay realms: pick a themed roleplay to join. On this single LAN server
// a "realm" is a tag every bird in it wears over their head ({Realm}), so
// players can gather into the same roleplay — Zoo, Adoption Center, Vet, etc.
// Counts are live (how many birds currently wear each tag).

import { toast } from './chat.js';

const REALMS = [
  { id: 'Zoo', emoji: '🦓' },
  { id: 'Adoption Center', emoji: '🏥' },
  { id: 'Vet', emoji: '🩺' },
  { id: 'Family', emoji: '🐣' },
  { id: 'School', emoji: '🏫' },
  { id: 'Wildlife', emoji: '🌿' },
  { id: 'Fantasy', emoji: '✨' },
  { id: 'Prehistoric', emoji: '🦖' },
  { id: 'Taming', emoji: '🪢' },
];

export function buildRealmPanel(panel, game, panels) {
  panel.appendChild(el('h2', '🌐 Roleplay Realms'));
  const cur = game.me.realm || '';
  panel.appendChild(el('p', cur ? `You're roleplaying in {${cur}}.` : 'Join a roleplay so your bird wears its tag and others can find you.', 'panel-note'));

  // count birds currently in each realm (me + everyone visible)
  const counts = {};
  const tally = (r) => { if (r) counts[r] = (counts[r] || 0) + 1; };
  tally(game.me.realm);
  for (const p of game.players.values()) tally(p.data.realm);

  const list = document.createElement('div');
  list.className = 'realm-list';
  for (const r of REALMS) {
    const row = document.createElement('button');
    row.className = 'shop-row realm-row' + (cur === r.id ? ' owned' : '');
    row.innerHTML = `<span class="shop-emoji">${r.emoji}</span>`
      + `<span class="shop-label">${r.id}</span>`
      + `<span class="realm-count">👤 ${counts[r.id] || 0}</span>`
      + `<span class="shop-price">${cur === r.id ? '✓' : 'Join'}</span>`;
    row.addEventListener('click', () => {
      if (cur === r.id) return;
      game.net.send({ t: 'realm.set', realm: r.id });
      toast(`You joined the ${r.id} roleplay!`);
      panels.closeAll();
    });
    list.appendChild(row);
  }
  panel.appendChild(list);

  if (cur) {
    const row = panels.row(panel);
    panels.button(row, '🚪 Leave roleplay', () => {
      game.net.send({ t: 'realm.set', realm: '' });
      panels.closeAll();
    }, 'warn');
  }
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
