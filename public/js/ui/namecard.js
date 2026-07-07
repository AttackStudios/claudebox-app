// Name card: give your bird a display name + a description line (the
// creature-card subtitle shown over its head), and style the name's colour.
// Distinct from your account name, which still keys flocks + friends.

import { toast } from './chat.js';

const STYLES = [['plain', 'Plain'], ['outline', 'Outline'], ['glow', 'Glow']];

export function buildCardPanel(panel, game, panels) {
  panel.appendChild(h('h2', '🏷️ Name Card'));
  panel.appendChild(h('p', 'Your bird\'s display name and description appear over its head like a creature card.', 'panel-note'));

  const me = game.me;
  const style = { ...(me.nameStyle || { color: '#ffffff', style: 'outline' }) };

  const nameRow = panels.row(panel, '🪶 Name');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 18;
  nameInput.placeholder = me.name;
  nameInput.value = me.creatureName || '';
  nameRow.appendChild(nameInput);

  const descRow = panels.row(panel, '📝 Description');
  const descInput = document.createElement('textarea');
  descInput.maxLength = 70;
  descInput.rows = 2;
  descInput.placeholder = 'Big, cute, eats berries, has glass wings…';
  descInput.value = me.description || '';
  descInput.style.width = '100%';
  descInput.style.resize = 'none';
  descRow.appendChild(descInput);

  const colorRow = panels.row(panel, '🎨 Name colour');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = style.color || '#ffffff';
  colorRow.appendChild(colorInput);

  const styleRow = panels.row(panel, '✨ Style');
  for (const [v, label] of STYLES) {
    const b = document.createElement('button');
    b.className = 'panel-btn' + (style.style === v ? ' gold' : '');
    b.textContent = label;
    b.style.minHeight = '32px';
    b.style.padding = '4px 12px';
    b.addEventListener('click', () => {
      style.style = v;
      [...styleRow.querySelectorAll('button')].forEach((x) => x.classList.remove('gold'));
      b.classList.add('gold');
    });
    styleRow.appendChild(b);
  }

  const save = panels.row(panel);
  panels.button(save, '💾 Save card', () => {
    style.color = colorInput.value;
    game.net.send({
      t: 'card.set',
      creatureName: nameInput.value.trim(),
      description: descInput.value.trim(),
      nameStyle: style,
    });
    toast('Name card updated! 🪶');
    panels.closeAll();
  }, 'gold');
}

function h(tag, text, cls) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
