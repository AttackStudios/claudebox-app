// Actions / emotes: a grid of expressive things your bird can do. Each plays
// an animation pose (seen by everyone) and pops an italic action bubble.

const EMOTES = [
  { emoji: '🎵', label: 'Chirp', pose: 'peck', secs: 1.0, bubble: 'chirps' },
  { emoji: '🪑', label: 'Sit', pose: 'sit', secs: 4, bubble: 'sits down' },
  { emoji: '😴', label: 'Sleep', pose: 'sleep', secs: 6, bubble: 'falls asleep' },
  { emoji: '🍽️', label: 'Peck', pose: 'peck', secs: 1.6, bubble: 'pecks the ground' },
  { emoji: '💧', label: 'Preen', pose: 'drink', secs: 2.2, bubble: 'preens its feathers' },
  { emoji: '🪽', label: 'Flap', pose: 'flare', secs: 1.2, bubble: 'flaps its wings' },
  { emoji: '👋', label: 'Wave', pose: 'flare', secs: 1.0, bubble: 'waves hello' },
  { emoji: '💃', label: 'Dance', pose: 'flare', secs: 2.4, bubble: 'does a little dance' },
  { emoji: '❤️', label: 'Love', pose: 'peck', secs: 1.0, bubble: 'sends love' },
  { emoji: '😂', label: 'Laugh', pose: 'flare', secs: 1.4, bubble: 'laughs' },
  { emoji: '😢', label: 'Cry', pose: 'sit', secs: 2, bubble: 'cries softly' },
  { emoji: '😡', label: 'Squawk', pose: 'flare', secs: 1.2, bubble: 'squawks angrily' },
];

export function buildActionsPanel(panel, game, panels) {
  const h = document.createElement('h2');
  h.textContent = '🎭 Actions';
  panel.appendChild(h);

  const grid = document.createElement('div');
  grid.className = 'emote-grid';
  for (const e of EMOTES) {
    const b = document.createElement('button');
    b.className = 'emote-btn';
    b.innerHTML = `<span class="emote-emoji">${e.emoji}</span><small>${e.label}</small>`;
    b.addEventListener('click', () => {
      game.actions.emote(e.pose, e.secs, e.bubble);
      game.audio?.sfx?.('click');
    });
    grid.appendChild(b);
  }
  panel.appendChild(grid);
}
