// Context action stack (right side) + speedometer. FF Hud pattern.

export class Hud {
  constructor(game) {
    this.game = game;
    this.stack = document.getElementById('action-stack');
    this.lastKey = '';
    this.speedo = document.getElementById('speedo');
    this.needle = document.getElementById('speedo-needle');
    this.speedoText = document.getElementById('speedo-text');
  }

  render(actions, desktop) {
    const key = actions.map((a) => a.id + a.label).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.stack.innerHTML = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'action-btn' + (a.kind ? ' ' + a.kind : '');
      if (desktop && a.hotkey) {
        const hint = document.createElement('span');
        hint.className = 'key-hint';
        hint.textContent = a.hotkey;
        btn.appendChild(hint);
      }
      btn.appendChild(document.createTextNode(`${a.emoji} ${a.label}`));
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); a.fn(); });
      this.stack.appendChild(btn);
    }
  }

  setSpeed(visible, speed) {
    this.speedo.classList.toggle('hidden', !visible);
    if (!visible) return;
    const kmh = Math.abs(Math.round(speed * 4.2));
    this.speedoText.textContent = kmh;
    const frac = Math.min(1, Math.abs(speed) / 22);
    this.needle.style.transform = `rotate(${-110 + frac * 220}deg)`;
  }
}
