// Desktop input. On the ground: WASD/arrows to move, Space jump, F fly,
// E primary action, Q drop, C sit, Enter chat. The cursor stays FREE by
// default — hold a mouse button (right-click feels natural) and drag to look;
// Settings has a "Capture mouse" toggle for classic pointer-lock. IN FLIGHT the mouse becomes the flight stick: point the nose where
// you look (pointer-locked free-look), W = thrust, S = brake, A/D = rudder,
// Q/E = roll (hold for a barrel roll), Space = flap. Esc frees the cursor;
// dragging steers as a fallback.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class DesktopControls {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.locked = false;
    this.ac = new AbortController();
    const opts = { signal: this.ac.signal };

    window.addEventListener('keydown', (e) => this.onKey(e, true), opts);
    window.addEventListener('keyup', (e) => this.onKey(e, false), opts);
    window.addEventListener('blur', () => this.keys.clear(), opts);

    const canvas = game.renderer.domElement;
    this.canvas = canvas;

    canvas.addEventListener('click', () => {
      // clicking the world closes menus — and only grabs the cursor if the
      // player opted into classic capture in Settings
      this.game.panels.closeAll();
      if (this.game.settings.mouseCapture) this.requestLock();
    }, opts);

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    }, opts);

    // free-cursor look: hold a mouse button (right feels natural) and drag
    canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX; this.lastY = e.clientY;
    }, opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    window.addEventListener('mousemove', (e) => {
      // the mouse always orbits the free-look camera — on the ground and in
      // the air — so flying feels exactly like looking around
      if (this.locked) {
        this.game.orbit.rotate(e.movementX, e.movementY);
        return;
      }
      if (!this.dragging) return;
      this.game.orbit.rotate(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX; this.lastY = e.clientY;
    }, opts);
    window.addEventListener('mouseup', () => { this.dragging = false; }, opts);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.game.orbit.zoom(e.deltaY);
    }, { passive: false, signal: this.ac.signal });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      p?.catch?.(() => {}); // headless/iframe: just keep drag-look
    } catch {}
  }

  unlock() {
    if (this.locked) document.exitPointerLock?.();
  }

  destroy() {
    this.unlock();
    this.ac.abort();
  }

  get typing() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  onKey(e, down) {
    if (this.typing) {
      // Enter/Escape are handled by the chat module while typing.
      return;
    }
    const k = e.code;
    if (down) this.keys.add(k); else this.keys.delete(k);

    if (!down) return;
    switch (k) {
      case 'Space':
        e.preventDefault();
        this.game.player.queueJump();   // jump on the ground, flap in the air
        break;
      case 'KeyF':
        this.game.actions.toggleFly();
        break;
      case 'KeyE':
        if (!this.game.player.flying) this.game.actions.primary();
        break;
      case 'KeyQ':
        if (!this.game.player.flying) this.game.actions.drop();
        break;
      case 'KeyC':
        this.game.actions.sit();
        break;
      case 'Enter':
        this.game.chat.openInput();
        break;
      case 'Escape':
        // browser already released pointer lock on Esc; also close menus
        this.game.panels.closeAll();
        break;
    }
  }

  // Produces the input object the controller consumes.
  // Convention: x = +1 right, z = +1 forward (away from camera).
  poll(input) {
    const player = this.game.player;
    if (this.typing) {
      if (player) { player.thrust = false; player.brake = false; }
      return input;
    }
    const K = this.keys;
    input.x = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
    input.z = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
    input.ascend = K.has('Space');
    input.descend = K.has('ShiftLeft') || K.has('ShiftRight');

    if (player) {
      if (player.flying) {
        // the mouse aims the camera (handled in mousemove); the bird flies
        // where you look. W = thrust, S = brake, Q/E = roll, Space = flap.
        player.thrust = K.has('KeyW') || K.has('ArrowUp');
        player.brake = K.has('KeyS') || K.has('ArrowDown');
        player.steer.roll = (K.has('KeyE') || K.has('KeyD') || K.has('ArrowRight') ? 1 : 0)
          - (K.has('KeyQ') || K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
        if (K.has('Space')) player.queueJump();   // held space = flap on cooldown
      } else {
        player.thrust = false;
        player.brake = false;
        player.steer.roll = 0;
      }
    }
    return input;
  }
}
