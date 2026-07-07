// WebSocket client for Rivals (same pattern as the other ClaudeBox games,
// pointed at /rivals-ws).

const SEND_RATE = 1000 / 15;

export class Net {
  constructor() {
    this.ws = null; this.id = null; this.handlers = new Map();
    this.sendTimer = null; this.connected = false; this.pendingJoin = null;
  }
  on(type, fn) { this.handlers.set(type, fn); }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/rivals-ws`);
    this.ws.addEventListener('open', () => {
      this.connected = true;
      if (this.pendingJoin) { this.send(this.pendingJoin); this.pendingJoin = null; }
    });
    this.ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') this.id = msg.id;
      this.handlers.get(msg.t)?.(msg);
    });
    this.ws.addEventListener('close', () => {
      this.connected = false; clearInterval(this.sendTimer);
      this.handlers.get('_disconnect')?.();
    });
  }
  join(profile) {
    const msg = { t: 'join', ...profile };
    if (this.connected) this.send(msg); else this.pendingJoin = msg;
  }
  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  startMovementStream(getState) {
    clearInterval(this.sendTimer);
    this.sendTimer = setInterval(() => { const s = getState(); if (s) this.send(s); }, SEND_RATE);
  }
}
