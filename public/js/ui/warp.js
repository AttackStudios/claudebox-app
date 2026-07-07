// Teleport panel: warp home to your nest, back to the spawn meadow, to your
// flock leader, or fast-travel out to any of the continent's regions.

import { WORLD } from '/shared/worldgen.js';
import { toast } from './chat.js';

const REGIONS = [
  { biome: 'meadow', emoji: '🌼', label: 'Meadow (spawn)' },
  { biome: 'forest', emoji: '🌲', label: 'Pine Forest' },
  { biome: 'snow', emoji: '🏔️', label: 'Snowy Mountains' },
  { biome: 'desert', emoji: '🏜️', label: 'Desert Canyon' },
  { biome: 'jungle', emoji: '🌴', label: 'Jungle Wetlands' },
  { biome: 'autumn', emoji: '🍂', label: 'Autumn Woods' },
  { biome: 'volcano', emoji: '🌋', label: 'Volcano' },
];

export function buildWarpPanel(panel, game, panels) {
  panel.appendChild(h('h2', '✨ Teleport'));

  const quick = panels.row(panel);
  const nest = game.myNest();
  if (nest) panels.button(quick, '🪹 My nest', () => { game.teleportTo(nest.x, nest.z, nest.y); panels.closeAll(); }, 'gold');
  panels.button(quick, '🌼 Spawn', () => { game.teleportTo(WORLD.spawn.x, WORLD.spawn.z); panels.closeAll(); });

  const flock = game.me.flock ? game.flocks.get(game.me.flock) : null;
  if (flock) {
    const row = panels.row(panel);
    panels.button(row, '🪶 To flock leader', () => {
      const leader = [...game.players.values()].find((p) => p.data.name.toLowerCase() === flock.leader);
      if (!leader) return toast('Your leader is offline.');
      game.teleportTo(leader.group.position.x + 2, leader.group.position.z + 2);
      panels.closeAll();
    }, 'gold');
  }

  panel.appendChild(h('div', 'Fast-travel to a region', 'field-label'));
  const grid = document.createElement('div');
  grid.className = 'realm-list';
  for (const r of REGIONS) {
    const reg = WORLD.regions.find((g) => g.biome === r.biome);
    if (!reg) continue;
    const row = document.createElement('button');
    row.className = 'shop-row';
    row.innerHTML = `<span class="shop-emoji">${r.emoji}</span><span class="shop-label">${r.label}</span><span class="shop-price">›</span>`;
    row.addEventListener('click', () => {
      // nudge inward from the region centre so you don't land on a peak/crater
      game.teleportTo(reg.x * 0.92, reg.z * 0.92);
      toast(`Warped to the ${r.label}.`);
      panels.closeAll();
    });
    grid.appendChild(row);
  }
  panel.appendChild(grid);
}

function h(tag, text, cls) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
