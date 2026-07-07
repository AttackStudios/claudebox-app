// The left-side action stack: context actions (eat/drink/pick up...) plus
// the always-available feature buttons. Rebuilt only when the action set
// changes. On desktop the primary context action shows its hotkey.

export class Hud {
  constructor(game) {
    this.game = game;
    this.stack = document.getElementById('action-stack');
    this.lastKey = '';
  }

  // actions: array of { id, label, emoji, kind('primary'|'urgent'|''), fn }
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
      const fire = (e) => { e.preventDefault(); e.stopPropagation(); a.fn(); };
      btn.addEventListener('click', fire);
      this.stack.appendChild(btn);
    }
  }
}
