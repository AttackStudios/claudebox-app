// Color customization UI, shared by the main menu and the in-game panel.
// Builds one row per color slot with a color input + quick swatches.

import { BREEDS, COLOR_SLOTS, defaultColors } from '../birds/breeds.js';

const QUICK = ['#ffffff', '#2b2b2b', '#e23b3b', '#f2913a', '#f8d23a', '#59d185',
  '#3fa9d8', '#8a5df2', '#f08aa8', '#9a7e5f'];

const SLOT_EMOJI = {
  body: '🐦', wings: '🪽', belly: '🤍', head: '👤',
  beak: '🔶', legs: '🦵', eyes: '👁️', accent: '✨',
};

// container: element to fill. colors: live object mutated in place.
// onChange(slot, hex) fires on every edit.
export function buildColorEditor(container, colors, onChange) {
  container.innerHTML = '';
  const inputs = {};
  for (const slot of COLOR_SLOTS) {
    const row = document.createElement('div');
    row.className = 'color-row';

    const label = document.createElement('label');
    label.textContent = `${SLOT_EMOJI[slot]} ${slot}`;
    row.appendChild(label);

    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    for (const hex of QUICK.slice(0, 5)) {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = hex;
      sw.addEventListener('click', () => {
        colors[slot] = hex;
        input.value = hex;
        onChange(slot, hex);
      });
      swatches.appendChild(sw);
    }
    row.appendChild(swatches);

    const input = document.createElement('input');
    input.type = 'color';
    input.value = colors[slot] || '#ffffff';
    input.addEventListener('input', () => {
      colors[slot] = input.value;
      onChange(slot, input.value);
    });
    row.appendChild(input);
    inputs[slot] = input;

    container.appendChild(row);
  }
  return {
    setAll(newColors) {
      for (const slot of COLOR_SLOTS) {
        colors[slot] = newColors[slot];
        if (inputs[slot]) inputs[slot].value = newColors[slot] || '#ffffff';
      }
    },
  };
}

// In-game customize panel: live recolor + nametag tweaks, synced to server.
export function buildCustomizePanel(panel, game, panels) {
  const h = document.createElement('h2');
  h.textContent = '🎨 Customize';
  panel.appendChild(h);

  const push = () => {
    game.net.send({ t: 'customize', bird: game.me.bird, nameStyle: game.me.nameStyle });
    game.refreshMyBird();
  };

  // ---- species grid: pick an unlocked breed, or buy a locked one ----
  const speciesLabel = document.createElement('div');
  speciesLabel.className = 'field-label';
  speciesLabel.textContent = 'Species';
  panel.appendChild(speciesLabel);

  const grid = document.createElement('div');
  grid.className = 'breed-grid';
  panel.appendChild(grid);

  const buyBox = document.createElement('div');
  buyBox.className = 'buy-box hidden';
  panel.appendChild(buyBox);

  let buyTarget = null;   // locked breed the buy box is showing
  const isLocked = (id) => !!game.breedPrices[id] && !game.unlocked.has(id);

  const selectBreed = (id) => {
    game.me.bird.breed = id;
    editor.setAll(defaultColors(id, game.me.bird.stage));  // mutates bird.colors in place
    push();
    buyTarget = null;
    renderBuyBox();
    renderGrid();
  };

  const renderBuyBox = () => {
    buyBox.innerHTML = '';
    if (!buyTarget) { buyBox.classList.add('hidden'); return; }
    buyBox.classList.remove('hidden');
    const def = BREEDS[buyTarget];
    const price = game.breedPrices[buyTarget] || 0;
    const title = document.createElement('div');
    title.className = 'buy-title';
    title.textContent = `🔒 ${def.emoji} ${def.label}`;
    const bal = document.createElement('div');
    bal.className = 'buy-balance';
    bal.textContent = `Costs ${price} 🪶 — you have ${(game.me.feathers || 0).toLocaleString()} 🪶`;
    const btn = document.createElement('button');
    btn.className = 'panel-btn gold';
    btn.textContent = `Unlock for ${price} 🪶`;
    btn.addEventListener('click', () => {
      btn.disabled = true;                 // re-enabled by re-render on unlock / toast on failure
      game.buyBreed(buyTarget);
      setTimeout(() => { btn.disabled = false; }, 1500);
    });
    buyBox.append(title, bal, btn);
  };

  const renderGrid = () => {
    grid.innerHTML = '';
    for (const [id, def] of Object.entries(BREEDS)) {
      const locked = isLocked(id);
      const card = document.createElement('button');
      card.className = 'breed-card'
        + (id === game.me.bird.breed ? ' selected' : '')
        + (locked ? ' locked' : '')
        + (def.set === 'mythical' ? ' mythical' : '');
      const em = document.createElement('span');
      em.className = 'breed-emoji';
      em.textContent = def.emoji;
      card.appendChild(em);
      card.appendChild(document.createTextNode(def.label));
      if (locked) {
        const badge = document.createElement('span');
        badge.className = 'breed-lock';
        badge.textContent = `🔒 ${game.breedPrices[id]} 🪶`;
        card.appendChild(badge);
      }
      card.addEventListener('click', () => {
        if (isLocked(id)) { buyTarget = id; renderBuyBox(); }
        else selectBreed(id);
      });
      grid.appendChild(card);
    }
  };
  renderGrid();

  // refresh + auto-equip when the server confirms a purchase (panel open only)
  game.onUnlock = (breed) => {
    if (!panel.isConnected) { game.onUnlock = null; return; }
    renderGrid();
    selectBreed(breed);
  };

  // ---- colors ----
  const colorLabel = document.createElement('div');
  colorLabel.className = 'field-label';
  colorLabel.textContent = 'Colors';
  panel.appendChild(colorLabel);

  const colorBox = document.createElement('div');
  colorBox.className = 'color-rows';
  panel.appendChild(colorBox);

  const editor = buildColorEditor(colorBox, game.me.bird.colors, () => push());

  const resetRow = panels.row(panel);
  panels.button(resetRow, '↩️ Natural colors', () => {
    game.me.bird.colors = defaultColors(game.me.bird.breed);
    push();
    panels.refresh?.();
    // simplest: rebuild panel content
    panels.closeAll();
  });

  // nametag style
  const tagHeader = document.createElement('div');
  tagHeader.className = 'field-label';
  tagHeader.textContent = 'Nametag';
  panel.appendChild(tagHeader);

  const tagRow = panels.row(panel, '🏷️ Name color');
  const tagColor = document.createElement('input');
  tagColor.type = 'color';
  tagColor.value = game.me.nameStyle.color || '#ffffff';
  tagColor.addEventListener('input', () => {
    game.me.nameStyle.color = tagColor.value;
    push();
  });
  tagRow.appendChild(tagColor);

  const styleRow = panels.row(panel, '💫 Style');
  const sel = document.createElement('select');
  for (const [v, label] of [['outline', 'Outline'], ['glow', 'Glow'], ['plain', 'Plain']]) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = game.me.nameStyle.style || 'outline';
  sel.addEventListener('change', () => {
    game.me.nameStyle.style = sel.value;
    push();
  });
  styleRow.appendChild(sel);
}
