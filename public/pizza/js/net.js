// Pizza Works networking: a thin WebSocket wrapper (same shape as the other
// ClaudeBox games) + a snapshot interpolation buffer for remote players.

export class Net {
  constructor() {
    this.handlers = new Map();
    this.connected = false;
    this.pendingJoin = null;
    this.id = null;
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/pizza-ws`);
    this.ws.addEventListener('open', () => {
      this.connected = true;
      if (this.pendingJoin) { this.send(this.pendingJoin); this.pendingJoin = null; }
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') this.id = msg.id;
      this.handlers.get(msg.t)?.(msg);
    });
    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.handlers.get('_disconnect')?.();
    });
  }
  join(profile) {
    const msg = { t: 'join', ...profile };
    if (this.connected) this.send(msg); else this.pendingJoin = msg;
  }
  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  on(t, fn) { this.handlers.set(t, fn); }
}

// tiny fixed-lag interpolator: push [x,y,z,ry,anim], sample ~120ms behind
export class InterpBuffer {
  constructor() { this.buf = []; }
  push(v) { this.buf.push({ at: performance.now(), v }); if (this.buf.length > 20) this.buf.shift(); }
  sample() {
    const t = performance.now() - 120;
    if (!this.buf.length) return null;
    let a = this.buf[0], b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].at <= t && this.buf[i + 1].at >= t) { a = this.buf[i]; b = this.buf[i + 1]; break; }
    }
    const k = b.at === a.at ? 1 : Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)));
    const va = a.v, vb = b.v;
    let dr = vb[3] - va[3];
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    return [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k, va[3] + dr * k, vb[4]];
  }
}
