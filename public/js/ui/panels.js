// Small panel framework: one floating panel open at a time
// (settings / flock / nest / customize), injected into #panels.

export class Panels {
  constructor() {
    this.host = document.getElementById('panels');
    this.current = null;
    this.currentId = null;
  }

  toggle(id, builder) {
    if (this.currentId === id) {
      this.closeAll();
      return;
    }
    this.open(id, builder);
  }

  open(id, builder) {
    this.closeAll();
    document.exitPointerLock?.(); // free the cursor for menu interaction
    const panel = document.createElement('div');
    panel.className = 'side-panel';
    const close = document.createElement('button');
    close.className = 'close-x';
    close.textContent = '✕';
    close.addEventListener('click', () => this.closeAll());
    panel.appendChild(close);
    builder(panel);
    this.host.appendChild(panel);
    this.current = panel;
    this.currentId = id;
  }

  refresh() {
    // Re-open the current panel with fresh data, if its builder was saved.
    if (this.currentId && this.builders?.[this.currentId]) {
      const id = this.currentId;
      this.closeAll();
      this.open(id, this.builders[id]);
    }
  }

  closeAll() {
    this.current?.remove();
    this.current = null;
    this.currentId = null;
  }

  row(parent, labelText) {
    const row = document.createElement('div');
    row.className = 'panel-row';
    if (labelText) {
      const label = document.createElement('label');
      label.textContent = labelText;
      row.appendChild(label);
    }
    parent.appendChild(row);
    return row;
  }

  button(parent, text, fn, cls = '') {
    const b = document.createElement('button');
    b.className = 'panel-btn' + (cls ? ' ' + cls : '');
    b.textContent = text;
    b.addEventListener('click', fn);
    parent.appendChild(b);
    return b;
  }
}
