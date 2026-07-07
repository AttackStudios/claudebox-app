// Chat log + input + toasts (Feather Friends pattern).

export class Chat {
  constructor(game) {
    this.game = game;
    this.log = document.getElementById('chat-log');
    this.row = document.getElementById('chat-input-row');
    this.input = document.getElementById('chat-input');
    document.getElementById('chat-send').addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submit();
      if (e.key === 'Escape') this.closeInput();
    });
  }

  openInput() {
    this.row.classList.remove('hidden');
    this.input.focus();
  }

  closeInput() {
    this.row.classList.add('hidden');
    this.input.value = '';
    this.input.blur();
  }

  submit() {
    const text = this.input.value.trim().slice(0, 160);
    if (text) this.game.net.send({ t: 'chat', text });
    this.closeInput();
  }

  addMessage(name, text, isSelf) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const nameEl = document.createElement('span');
    nameEl.className = 'chat-name';
    nameEl.textContent = name + ': ';
    nameEl.style.color = isSelf ? '#e8b94a' : '#7ec8e8';
    line.appendChild(nameEl);
    line.appendChild(document.createTextNode(text));
    this.log.appendChild(line);
    while (this.log.children.length > 40) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => line.classList.add('faded'), 9000);
  }
}

export function toast(text) {
  const box = document.getElementById('bp-toasts');
  const el = document.createElement('div');
  el.className = 'bp-toast';
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
