// Chat: a fading log in the top-left, an input row, and overhead bubbles
// (the bubbles themselves are drawn by nametags.js).

export class Chat {
  constructor(game) {
    this.game = game;
    this.log = document.getElementById('chat-log');
    this.row = document.getElementById('chat-input-row');
    this.input = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('chat-send');

    this.sendBtn.addEventListener('click', () => this.submit());
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

  // called on incoming chat broadcast
  addMessage(name, text, isSelf) {
    const line = document.createElement('div');
    const emote = /^\*.*\*$/.test(text);
    line.className = 'chat-line' + (emote ? ' emote' : '');
    const nameEl = document.createElement('span');
    nameEl.className = 'chat-name';
    nameEl.textContent = name + ': ';
    nameEl.style.color = isSelf ? '#c2851f' : '#2b6a8a';
    line.appendChild(nameEl);
    line.appendChild(document.createTextNode(text));
    this.log.appendChild(line);
    while (this.log.children.length > 40) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => line.classList.add('faded'), 9000);
  }
}

export function toast(text, opts = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (opts.invite ? ' invite' : '');
  el.textContent = text;
  if (opts.invite) {
    const yes = document.createElement('button');
    yes.className = 'yes'; yes.textContent = 'Join!';
    const no = document.createElement('button');
    no.className = 'no'; no.textContent = 'No thanks';
    yes.addEventListener('click', () => { opts.onAccept?.(); el.remove(); });
    no.addEventListener('click', () => { opts.onDecline?.(); el.remove(); });
    el.append(yes, no);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), opts.invite ? 15000 : 3500);
}
