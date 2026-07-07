// The backpack: Tents / Camp / Gear tabs, everything unlocked. Selecting an
// item puts it in the 3-slot hotbar; the active slot equips it in hand.

import { CATALOG, catalogEntry, TENT_COLORS } from '../systems/items.js';

export class Inventory {
  constructor(game) {
    this.game = game;
    this.hotbar = [null, null, null]; // { kind, color }
    this.active = -1;
    this.el = document.getElementById('backpack');
    this.grid = document.getElementById('backpack-grid');
    this.tabsEl = document.getElementById('backpack-tabs');
    this.hotbarEl = document.getElementById('hotbar');
    this.tab = 'Tents';

    document.getElementById('backpack-close').addEventListener('click', () => this.toggle(false));
    this.renderTabs();
    this.renderHotbar();
  }

  toggle(force) {
    const show = force ?? this.el.classList.contains('hidden');
    this.el.classList.toggle('hidden', !show);
    if (show) { document.exitPointerLock?.(); this.renderGrid(); }
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  renderTabs() {
    this.tabsEl.innerHTML = '';
    for (const name of Object.keys(CATALOG)) {
      const b = document.createElement('button');
      b.className = 'bp-tab' + (name === this.tab ? ' selected' : '');
      b.textContent = name;
      b.addEventListener('click', () => { this.tab = name; this.renderTabs(); this.renderGrid(); });
      this.tabsEl.appendChild(b);
    }
  }

  renderGrid() {
    this.grid.innerHTML = '';
    for (const entry of CATALOG[this.tab]) {
      const card = document.createElement('button');
      card.className = 'bp-item';
      card.innerHTML = `<span class="bp-emoji">${entry.emoji}</span>${entry.label}`;
      if (entry.colors) {
        const swatches = document.createElement('div');
        swatches.className = 'bp-swatches';
        for (const col of entry.colors) {
          const sw = document.createElement('button');
          sw.className = 'bp-swatch';
          sw.style.background = col;
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addToHotbar(entry.kind, col);
          });
          swatches.appendChild(sw);
        }
        card.appendChild(swatches);
        card.addEventListener('click', () => this.addToHotbar(entry.kind, entry.colors[0]));
      } else {
        card.addEventListener('click', () => this.addToHotbar(entry.kind, null));
      }
      this.grid.appendChild(card);
    }
  }

  addToHotbar(kind, color) {
    let slot = this.hotbar.findIndex((s) => s === null);
    if (slot === -1) slot = 0;
    this.hotbar[slot] = { kind, color };
    this.setActive(slot);
    this.renderHotbar();
    this.toggle(false);
  }

  setActive(i) {
    this.active = this.active === i ? -1 : i;
    this.renderHotbar();
    this.game.onEquipChanged?.();
  }

  get equipped() {
    return this.active >= 0 ? this.hotbar[this.active] : null;
  }

  clearActive() {
    this.active = -1;
    this.renderHotbar();
    this.game.onEquipChanged?.();
  }

  renderHotbar() {
    this.hotbarEl.innerHTML = '';
    this.hotbar.forEach((slot, i) => {
      const b = document.createElement('button');
      b.className = 'hotbar-slot' + (i === this.active ? ' active' : '');
      if (slot) {
        const entry = catalogEntry(slot.kind);
        b.innerHTML = `<span>${entry?.emoji || '❔'}</span>`;
        if (slot.color) b.style.borderBottomColor = slot.color;
      }
      b.addEventListener('click', () => slot && this.setActive(i));
      this.hotbarEl.appendChild(b);
    });
  }
}
