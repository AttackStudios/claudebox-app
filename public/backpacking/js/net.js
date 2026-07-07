// WebSocket client + interpolation buffers (Feather Friends pattern,
// pointed at the Backpacking namespace).

const SEND_RATE = 1000 / 12;
export const INTERP_DELAY = 0.12;

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.handlers = new Map();
    this.sendTimer = null;
    this.connected = false;
    this.pendingJoin = null;
  }

  on(type, fn) { this.handlers.set(type, fn); }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/bp-ws`);
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
      clearInterval(this.sendTimer);
      this.handlers.get('_disconnect')?.();
    });
  }

  join(profile) {
    const msg = { t: 'join', ...profile };
    if (new URLSearchParams(location.search).get('dev') === '1') msg.dev = 1;   // maintenance bypass for testing
    if (this.connected) this.send(msg);
    else this.pendingJoin = msg;
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  startMovementStream(getState) {
    clearInterval(this.sendTimer);
    this.sendTimer = setInterval(() => {
      const s = getState();
      if (s) this.send(s);
    }, SEND_RATE);
  }
}

export class InterpBuffer {
  constructor() { this.frames = []; }

  push(values) {
    this.frames.push({ t: performance.now() / 1000, v: values });
    if (this.frames.length > 30) this.frames.splice(0, this.frames.length - 30);
  }

  // sample INTERP_DELAY in the past; returns interpolated array or null
  sample(angles = []) {
    const now = performance.now() / 1000 - INTERP_DELAY;
    const f = this.frames;
    if (!f.length) return null;
    if (f.length === 1 || now <= f[0].t) return f[0].v;
    for (let i = f.length - 1; i >= 0; i--) {
      if (f[i].t <= now) {
        const a = f[i], b = f[Math.min(i + 1, f.length - 1)];
        const span = b.t - a.t;
        const k = span > 0.0001 ? Math.min(1, (now - a.t) / span) : 1;
        return a.v.map((va, idx) => {
          const vb = b.v[idx];
          if (typeof va !== 'number') return k < 0.5 ? va : vb;
          if (angles.includes(idx)) return lerpAngle(va, vb, k);
          return va + (vb - va) * k;
        });
      }
    }
    return f[f.length - 1].v;
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
