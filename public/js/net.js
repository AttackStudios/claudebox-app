// WebSocket client: connects, joins, sends our movement at 12 Hz, and
// keeps interpolation buffers for everyone else.

const SEND_RATE = 1000 / 12;
export const INTERP_DELAY = 0.12; // render others 120ms in the past

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
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.addEventListener('open', () => {
      this.connected = true;
      if (this.pendingJoin) {
        this.send(this.pendingJoin);
        this.pendingJoin = null;
      }
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
    // ?dev=1 lets testers through while the game is in maintenance
    if (new URLSearchParams(location.search).get('dev') === '1') msg.dev = 1;
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
      if (s) this.send({ t: 'move', ...s });
    }, SEND_RATE);
  }
}

// ---------------- interpolation ----------------

export class InterpBuffer {
  constructor() {
    this.frames = []; // { t, x, y, z, ry, rx, rz }
  }

  push(x, y, z, ry, rx = 0, rz = 0) {
    const now = performance.now() / 1000;
    this.frames.push({ t: now, x, y, z, ry, rx, rz });
    if (this.frames.length > 30) this.frames.splice(0, this.frames.length - 30);
  }

  // Sample the position INTERP_DELAY seconds in the past.
  sample(out) {
    const now = performance.now() / 1000 - INTERP_DELAY;
    const f = this.frames;
    if (f.length === 0) return false;
    if (f.length === 1 || now <= f[0].t) {
      Object.assign(out, f[0]);
      return true;
    }
    for (let i = f.length - 1; i >= 0; i--) {
      if (f[i].t <= now) {
        const a = f[i];
        const b = f[Math.min(i + 1, f.length - 1)];
        const span = b.t - a.t;
        const k = span > 0.0001 ? Math.min(1, (now - a.t) / span) : 1;
        out.x = a.x + (b.x - a.x) * k;
        out.y = a.y + (b.y - a.y) * k;
        out.z = a.z + (b.z - a.z) * k;
        out.ry = lerpAngle(a.ry, b.ry, k);
        out.rx = (a.rx || 0) + ((b.rx || 0) - (a.rx || 0)) * k;
        out.rz = lerpAngle(a.rz || 0, b.rz || 0, k);   // shortest arc (mid-roll)
        return true;
      }
    }
    Object.assign(out, f[f.length - 1]);
    return true;
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
