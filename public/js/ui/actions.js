// Actions / emotes: a grid of expressive things your bird can do. Each plays
// an animation pose (seen by everyone) and pops an italic action bubble.
// The panel is rebuilt every time it opens, so the grid re-checks the bird's
// life stage: eggs just get a hint, hatched birds get the core set, and
// adults get show-off extras (Display + Preen).

const CORE_EMOTES = [
  { emoji: '🎵', label: 'Call', call: true },
  { emoji: '🪑', label: 'Sit', pose: 'sit', secs: 4, bubble: 'sits down' },
  { emoji: '😴', label: 'Sleep', pose: 'sleep', secs: 6, bubble: 'falls asleep' },
  { emoji: '🍽️', label: 'Peck', pose: 'peck', secs: 1.6, bubble: 'pecks the ground' },
  { emoji: '🤕', label: 'Hurt', pose: 'peck', secs: 0.8, hurt: true },
  { emoji: '🪽', label: 'Flap', pose: 'flare', secs: 1.2, bubble: 'flaps its wings' },
  { emoji: '👋', label: 'Wave', pose: 'flare', secs: 1.0, bubble: 'waves hello' },
  { emoji: '💃', label: 'Dance', pose: 'flare', secs: 2.4, bubble: 'does a little dance' },
  { emoji: '❤️', label: 'Love', pose: 'peck', secs: 1.0, bubble: 'sends love' },
  { emoji: '😂', label: 'Laugh', pose: 'flare', secs: 1.4, bubble: 'laughs' },
  { emoji: '😢', label: 'Cry', pose: 'sit', secs: 2, bubble: 'cries softly' },
  { emoji: '😡', label: 'Squawk', pose: 'flare', secs: 1.2, bubble: 'squawks angrily' },
];

// Grown-up flair: only adults can strut.
const ADULT_EMOTES = [
  { emoji: '🦚', label: 'Display', pose: 'flare', secs: 2.5, bubble: 'displays their feathers' },
  { emoji: '💧', label: 'Preen', pose: 'drink', secs: 2.2, bubble: 'preens its feathers' },
];

export function buildActionsPanel(panel, game, panels) {
  const h = document.createElement('h2');
  h.textContent = '🎭 Actions';
  panel.appendChild(h);

  const stage = game.me?.bird?.stage;
  if (stage === 'egg') {
    const info = document.createElement('p');
    info.style.fontSize = '13px';
    info.style.marginBottom = '8px';
    info.textContent = 'Hatch first! 🥚';
    panel.appendChild(info);
    return;
  }

  const emotes = stage === 'adult' ? [...CORE_EMOTES, ...ADULT_EMOTES] : CORE_EMOTES;
  const grid = document.createElement('div');
  grid.className = 'emote-grid';
  for (const e of emotes) {
    const b = document.createElement('button');
    b.className = 'emote-btn';
    b.innerHTML = `<span class="emote-emoji">${e.emoji}</span><small>${e.label}</small>`;
    b.addEventListener('click', () => {
      const baby = game.me.bird.stage === 'baby';
      if (e.call) {
        // per-breed voice from audio.js (babies get the small squeaky version)
        game.audio?.call?.(game.me.bird.breed, { baby });
        game.actions.emote('peck', 1.0, 'calls out');
      } else if (e.hurt) {
        game.actions.emote(e.pose, e.secs, baby ? 'cheeps in pain' : 'squawks in pain');
        game.audio?.sfx?.('click');
      } else {
        game.actions.emote(e.pose, e.secs, e.bubble);
        game.audio?.sfx?.('click');
      }
    });
    grid.appendChild(b);
  }
  panel.appendChild(grid);
}
