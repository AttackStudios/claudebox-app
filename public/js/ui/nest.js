// Nest panel: build/move your nest where you stand, teleport home,
// and recolor the twigs + lining. Nest meshes live in main.js's nest map;
// this is just the UI + messages.

import { toast } from './chat.js';
import { groundAt as height, waterAt } from '/shared/worldgen.js';

export function buildNestPanel(panel, game, panels) {
  const h = document.createElement('h2');
  h.textContent = '🪹 Nest';
  panel.appendChild(h);

  const myNest = game.myNest();

  const info = document.createElement('p');
  info.style.fontSize = '13px';
  info.style.marginBottom = '8px';
  info.textContent = myNest
    ? 'Your cozy nest is built! Teleport home anytime, or rebuild it right where you\'re standing.'
    : 'Build a nest right where you\'re standing — it becomes your home you can teleport to.';
  panel.appendChild(info);

  let nestType = myNest?.type || 'stick';

  const place = () => {
    const p = game.player.pos;
    if (waterAt(p.x, p.z, p.y)) return toast("Can't build a nest in water!");
    game.net.send({
      t: 'nest.make',
      x: p.x, y: height(p.x, p.z, p.y), z: p.z,
      type: nestType,
      twig: twigInput.value, lining: liningInput.value,
    });
    game.audio.sfx('nest');
    panels.closeAll();
  };

  // ---- nest type picker ----
  const typeHeader = document.createElement('div');
  typeHeader.className = 'field-label';
  typeHeader.textContent = 'Choose a nest';
  panel.appendChild(typeHeader);
  const grid = document.createElement('div');
  grid.className = 'nest-grid';
  const TYPES = [
    ['stick', '🪹', 'Stick'], ['rock', '🪨', 'Rock'], ['dirt', '🟤', 'Dirt'],
    ['burrow', '🕳️', 'Burrow'], ['mound', '⛰️', 'Mound'], ['cavity', '🪵', 'Cavity'],
  ];
  for (const [id, emoji, label] of TYPES) {
    const b = document.createElement('button');
    b.className = 'nest-type' + (nestType === id ? ' selected' : '');
    b.innerHTML = `<span class="nest-emoji">${emoji}</span><small>${label}</small>`;
    b.addEventListener('click', () => {
      nestType = id;
      [...grid.querySelectorAll('.nest-type')].forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
    });
    grid.appendChild(b);
  }
  panel.appendChild(grid);

  const btnRow = panels.row(panel);
  panels.button(btnRow, myNest ? '🔨 Rebuild nest here' : '🪹 Build nest here', place, 'gold');
  if (myNest) {
    panels.button(btnRow, '🏠 Go to my nest', () => {
      game.teleportTo(myNest.x, myNest.z, myNest.y);
      panels.closeAll();
    });
  }

  const colorHeader = document.createElement('div');
  colorHeader.className = 'field-label';
  colorHeader.textContent = 'Nest colors';
  panel.appendChild(colorHeader);

  const twigRow = panels.row(panel, '🪵 Twigs');
  const twigInput = document.createElement('input');
  twigInput.type = 'color';
  twigInput.value = myNest?.twig || '#8a6038';
  twigRow.appendChild(twigInput);

  const liningRow = panels.row(panel, '🧶 Lining');
  const liningInput = document.createElement('input');
  liningInput.type = 'color';
  liningInput.value = myNest?.lining || '#d8c27a';
  liningRow.appendChild(liningInput);

  const recolor = () => {
    if (game.myNest()) game.net.send({ t: 'nest.colors', twig: twigInput.value, lining: liningInput.value });
  };
  twigInput.addEventListener('change', recolor);
  liningInput.addEventListener('change', recolor);

  // ---- babies: eggs in the nest that hatch into chicks who follow you ----
  const babiesHeader = document.createElement('div');
  babiesHeader.className = 'field-label';
  panel.appendChild(babiesHeader);
  const babiesHost = document.createElement('div');
  panel.appendChild(babiesHost);

  const myOffspring = () => {
    const meLower = game.me.name.toLowerCase();
    return [...game.offspring.values()].map((r) => r.data).filter((o) => o.owner === meLower);
  };

  const renderBabies = () => {
    const mine = myOffspring();
    babiesHeader.textContent = `Babies (${mine.length}/3)`;
    babiesHost.innerHTML = '';

    if (!game.myNest()) {
      const p = document.createElement('p');
      p.style.cssText = 'font-size:12.5px;opacity:.75';
      p.textContent = 'Build a nest and you can fill it with eggs of your own.';
      babiesHost.appendChild(p);
      return;
    }
    if (game.me.bird.stage !== 'adult') {
      const p = document.createElement('p');
      p.style.cssText = 'font-size:12.5px;opacity:.75';
      p.textContent = 'Grow up first — only adult birds can lay eggs.';
      babiesHost.appendChild(p);
      return;
    }

    for (const o of mine) {
      const row = document.createElement('div');
      row.className = 'baby-row';

      const title = document.createElement('div');
      title.className = 'baby-title';
      title.textContent = `${o.stage === 'egg' ? '🥚' : '🐤'} ${o.name || (o.stage === 'egg' ? 'Egg' : 'Chick')}`;
      row.appendChild(title);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.maxLength = 16;
      nameInput.placeholder = 'Name…';
      nameInput.value = o.name || '';
      nameInput.addEventListener('change', () => game.net.send({ t: 'off.customize', id: o.id, name: nameInput.value }));
      row.appendChild(nameInput);

      const colorRow = document.createElement('div');
      colorRow.className = 'baby-colors';
      for (const [slot, label] of [['body', 'Body'], ['accent', 'Accent']]) {
        const c = document.createElement('input');
        c.type = 'color';
        c.value = o.colors?.[slot] || '#f2e7c8';
        c.title = label;
        c.addEventListener('change', () => game.net.send({ t: 'off.customize', id: o.id, colors: { [slot]: c.value } }));
        colorRow.appendChild(c);
      }
      row.appendChild(colorRow);

      const btns = document.createElement('div');
      btns.className = 'baby-btns';
      const bb = (label, fn, cls) => {
        const b = document.createElement('button');
        b.className = 'panel-btn' + (cls ? ' ' + cls : '');
        b.textContent = label;
        b.addEventListener('click', fn);
        btns.appendChild(b);
      };
      if (o.stage === 'egg') {
        bb('🐣 Hatch!', () => game.net.send({ t: 'off.hatch', id: o.id }), 'gold');
      } else {
        bb(o.mode === 'follow' ? '🛑 Stay' : '🐾 Follow me', () =>
          game.net.send({ t: 'off.mode', id: o.id, mode: o.mode === 'follow' ? 'stay' : 'follow' }));
      }
      bb('💨 Set free', () => game.net.send({ t: 'off.remove', id: o.id }));
      row.appendChild(btns);
      babiesHost.appendChild(row);
    }

    if (mine.length < 3) {
      const lay = document.createElement('button');
      lay.className = 'panel-btn gold';
      lay.textContent = '🥚 Lay an egg in the nest';
      lay.addEventListener('click', () => game.net.send({ t: 'off.spawn' }));
      babiesHost.appendChild(lay);
    }
  };
  renderBabies();
  // live-refresh while the panel is open (hatch confirmations, new eggs…)
  game.onOffspringChange = renderBabies;
}
