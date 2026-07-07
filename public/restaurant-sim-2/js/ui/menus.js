// RS2 menus: the Shop (furniture/appliances/decor/expansions/staff/recipes),
// the Manage panel (name, styles, menu picker, music, co-owner), the
// customer Order menu, and the Warp panel. All built on the shared Panels.

import { toast } from './chat.js';

const $ = (el, html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

export function buildShopPanel(panel, game, panels) {
  const { ITEMS, STAFF, DISHES, EXPANSIONS } = game.catalog;
  panel.appendChild($(panel, '<h2>🛒 Shop</h2>').firstChild);
  const mine = game.myRestaurantRec();
  if (!mine) { panel.appendChild(document.createTextNode('You need a restaurant first!')); return; }

  const tabs = document.createElement('div');
  tabs.className = 'rs2-tabs';
  const body = document.createElement('div');
  let tab = 'Seating';
  const TABS = ['Seating', 'Kitchen', 'Decor', 'Staff', 'Recipes', 'Expand'];

  const render = () => {
    [...tabs.children].forEach((b) => b.classList.toggle('selected', b.textContent === tab));
    body.innerHTML = '';
    if (tab === 'Staff') {
      for (const [role, def] of Object.entries(STAFF)) {
        const hired = mine.r.staff[role];
        const row = document.createElement('button');
        row.className = 'shop-row';
        row.innerHTML = `<span class="shop-emoji">${def.emoji}</span><span class="shop-label">${def.label}${hired ? ' (hired)' : ''}</span>
          <span class="shop-price">${hired ? (hired.tier >= 1 ? 'MAX' : '⬆ $' + def.upgrade) : '$' + def.price}</span>`;
        row.addEventListener('click', () => { game.net.send({ t: 'hire', role }); });
        body.appendChild(row);
      }
    } else if (tab === 'Recipes') {
      for (const [dishId, dish] of Object.entries(DISHES)) {
        const owned = mine.r.unlocked.includes(dishId);
        const row = document.createElement('button');
        row.className = 'shop-row' + (owned ? ' owned' : '');
        row.innerHTML = `<span class="shop-emoji">${dish.emoji}</span><span class="shop-label">${dish.label} <small>sells $${dish.price}</small></span>
          <span class="shop-price">${owned ? '✓' : '$' + dish.unlock}</span>`;
        if (!owned) row.addEventListener('click', () => game.net.send({ t: 'dish.unlock', dishId }));
        body.appendChild(row);
      }
    } else if (tab === 'Expand') {
      EXPANSIONS.forEach((ex, i) => {
        const row = document.createElement('button');
        row.className = 'shop-row' + (i <= mine.r.expansion ? ' owned' : '') + (i === mine.r.expansion + 1 ? '' : i > mine.r.expansion + 1 ? ' locked' : '');
        row.innerHTML = `<span class="shop-emoji">🏗️</span><span class="shop-label">${ex.label} <small>${ex.w}×${ex.d}</small></span>
          <span class="shop-price">${i <= mine.r.expansion ? '✓' : '$' + ex.price}</span>`;
        if (i === mine.r.expansion + 1) row.addEventListener('click', () => game.net.send({ t: 'build.expand' }));
        body.appendChild(row);
      });
    } else {
      for (const [kind, def] of Object.entries(ITEMS)) {
        if (def.cat !== tab) continue;
        const tiers = def.tiers ? [0, 1, 2] : [0];
        for (const tier of tiers) {
          const row = document.createElement('button');
          row.className = 'shop-row';
          const tierName = def.tiers ? [' (Basic)', ' (Steel)', ' (Deluxe)'][tier] : '';
          row.innerHTML = `<span class="shop-emoji">${def.emoji}</span><span class="shop-label">${def.label}${tierName}</span>
            <span class="shop-price">$${game.catalog.tierPrice(kind, tier)}</span>`;
          row.addEventListener('click', () => {
            panels.closeAll();
            game.buildMode.enter(kind, tier);
            toast('Walk to a spot, then Place! (R rotates)');
          });
          body.appendChild(row);
        }
      }
    }
  };
  for (const t of TABS) {
    const b = document.createElement('button');
    b.className = 'rs2-tab';
    b.textContent = t;
    b.addEventListener('click', () => { tab = t; render(); });
    tabs.appendChild(b);
  }
  panel.append(tabs, body);
  render();
}

export function buildManagePanel(panel, game, panels) {
  const { DISHES, WALL_COLORS, FLOOR_STYLES } = game.catalog;
  panel.appendChild($(panel, '<h2>📋 Manage</h2>').firstChild);
  const mine = game.myRestaurantRec();
  if (!mine) { panel.appendChild(document.createTextNode('You need a restaurant!')); return; }
  const r = mine.r;

  // name
  const nameRow = panels.row(panel, '🪧 Name');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 18;
  nameInput.value = r.name;
  nameRow.appendChild(nameInput);
  panels.button(nameRow, 'Set', () => game.net.send({ t: 'build.style', name: nameInput.value }));

  // wall + floor + awning styles
  const wallRow = panels.row(panel, '🎨 Walls');
  for (const c of WALL_COLORS) {
    const sw = document.createElement('button');
    sw.className = 'rs2-swatch' + (r.wall === c ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => game.net.send({ t: 'build.style', wall: c }));
    wallRow.appendChild(sw);
  }
  const awnRow = panels.row(panel, '⛱️ Awning');
  for (const c of WALL_COLORS) {
    const sw = document.createElement('button');
    sw.className = 'rs2-swatch' + (r.awning === c ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => game.net.send({ t: 'build.style', awning: c }));
    awnRow.appendChild(sw);
  }
  const floorRow = panels.row(panel, '🧱 Floor');
  for (const f of FLOOR_STYLES) {
    const b = document.createElement('button');
    b.className = 'rs2-tab' + (r.floor === f ? ' selected' : '');
    b.textContent = f;
    b.addEventListener('click', () => game.net.send({ t: 'build.style', floor: f }));
    floorRow.appendChild(b);
  }

  // menu picker (up to 6 of unlocked)
  const menuHead = $(panel, '<h3 class="rs2-subhead">📖 Menu (pick up to 6)</h3>').firstChild;
  panel.appendChild(menuHead);
  const menuRow = document.createElement('div');
  menuRow.className = 'rs2-menu-grid';
  const selection = new Set(r.menu);
  for (const dishId of r.unlocked) {
    const dish = DISHES[dishId];
    const b = document.createElement('button');
    b.className = 'rs2-dish' + (selection.has(dishId) ? ' selected' : '');
    b.innerHTML = `${dish.emoji}<small>${dish.label}</small>`;
    b.addEventListener('click', () => {
      if (selection.has(dishId)) selection.delete(dishId);
      else if (selection.size < 6) selection.add(dishId);
      game.net.send({ t: 'menu.set', menu: [...selection] });
      b.classList.toggle('selected');
    });
    menuRow.appendChild(b);
  }
  panel.appendChild(menuRow);

  // music picker
  const musicHead = $(panel, '<h3 class="rs2-subhead">🎵 Restaurant music</h3>').firstChild;
  panel.appendChild(musicHead);
  const musicRow = panels.row(panel);
  const none = document.createElement('button');
  none.className = 'rs2-tab' + (!r.music ? ' selected' : '');
  none.textContent = 'None';
  none.addEventListener('click', () => game.net.send({ t: 'music.set', track: null }));
  musicRow.appendChild(none);
  for (const tr of game.audio.tracks) {
    const b = document.createElement('button');
    b.className = 'rs2-tab' + (r.music === tr.id ? ' selected' : '');
    b.textContent = tr.label;
    b.addEventListener('click', () => {
      game.net.send({ t: 'music.set', track: tr.id });
      game.audio.fadeTo(tr.id); // live preview
    });
    musicRow.appendChild(b);
  }

  // danger zone: full reset
  const dzHead = $(panel, '<h3 class="rs2-subhead">⚠️ Danger zone</h3>').firstChild;
  panel.appendChild(dzHead);
  const dzRow = panels.row(panel);
  let armed = false;
  const resetBtn = panels.button(dzRow, '🗑️ Reset restaurant…', () => {
    if (!armed) {
      armed = true;
      resetBtn.textContent = '⚠️ Really erase EVERYTHING? Tap again';
      resetBtn.style.background = '#d4543c';
      setTimeout(() => { armed = false; resetBtn.textContent = '🗑️ Reset restaurant…'; resetBtn.style.background = ''; }, 4000);
      return;
    }
    game.net.send({ t: 'restaurant.reset' });
    panels.closeAll();
  });

  // co-owner
  const coHead = $(panel, '<h3 class="rs2-subhead">🤝 Co-owner</h3>').firstChild;
  panel.appendChild(coHead);
  if (r.owners.length >= 2) {
    panel.appendChild(document.createTextNode('Owners: ' + r.owners.join(' & ')));
  } else {
    const coRow = panels.row(panel);
    let any = false;
    for (const [, rec] of game.players) {
      any = true;
      panels.button(coRow, `Invite ${rec.data.name}`, () => game.net.send({ t: 'coowner.invite', playerId: rec.data.id }));
    }
    if (!any) coRow.appendChild(document.createTextNode('No other players online to invite.'));
  }
}

// menu at SOMEONE'S restaurant (or delivery from home)
export function buildOrderPanel(panel, game, panels, plotId, kind) {
  const { DISHES } = game.catalog;
  const r = game.restaurants.get(plotId)?.r;
  panel.appendChild($(panel, `<h2>${kind === 'delivery' ? '🛵 Order delivery' : '🧾 Order'} — ${r?.name || ''}</h2>`).firstChild);
  if (!r) return;
  const grid = document.createElement('div');
  grid.className = 'rs2-menu-grid';
  for (const dishId of r.menu) {
    const dish = DISHES[dishId];
    const price = dish.price + (kind === 'delivery' ? 5 : 0);
    const b = document.createElement('button');
    b.className = 'rs2-dish';
    b.innerHTML = `${dish.emoji}<small>${dish.label}</small><b>$${price}</b>`;
    b.addEventListener('click', () => {
      game.net.send({ t: 'food.order', plotId, dishId, kind });
      game.audio.sfx('register');
      panels.closeAll();
    });
    grid.appendChild(b);
  }
  if (!r.menu.length) grid.appendChild(document.createTextNode('Nothing on the menu yet…'));
  panel.appendChild(grid);
}

// pick a restaurant to deliver from (home ordering)
export function buildDeliveryChooser(panel, game, panels) {
  panel.appendChild($(panel, '<h2>🏠 Order to your door</h2>').firstChild);
  let any = false;
  for (const [plotId, rec] of game.restaurants) {
    if (!rec.r.menu.length) continue;
    any = true;
    const row = document.createElement('button');
    row.className = 'shop-row';
    row.innerHTML = `<span class="shop-emoji">🍽️</span><span class="shop-label">${rec.r.name}
      <small>${'⭐'.repeat(Math.round(rec.r.rating))}</small></span><span class="shop-price">›</span>`;
    row.addEventListener('click', () => panels.open('order', (pp) => buildOrderPanel(pp, game, panels, plotId, 'delivery')));
    panel.appendChild(row);
  }
  if (!any) panel.appendChild(document.createTextNode('No restaurants are serving right now.'));
}

export function buildWarpPanel(panel, game, panels) {
  panel.appendChild($(panel, '<h2>✨ Warp</h2>').firstChild);
  const row = panels.row(panel);
  const mine = game.myRestaurantRec();
  if (mine) {
    panels.button(row, '🍽️ My restaurant', () => { game.warpToPlot(mine.plotId); panels.closeAll(); }, 'gold');
  }
  panels.button(row, '🏠 My house', () => { game.warpToHouse(); panels.closeAll(); }, 'gold');
  panels.button(row, '⛲ Town plaza', () => { game.warpToPlaza(); panels.closeAll(); });
  const row2 = panels.row(panel);
  panels.button(row2, '🎮 ClaudeBox home', () => { location.href = '/'; });
}
