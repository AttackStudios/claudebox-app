// Desktop input. On foot: WASD move, Shift sprint, Space jump, E interact,
// B backpack, M map, Enter chat, click = pointer-lock camera.
// Driving: W/S throttle/brake-reverse, A/D steer, Space handbrake, F exit.

export class DesktopControls {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.dragging = false;
    this.lastX = 0; this.lastY = 0;
    this.locked = false;
    this.ac = new AbortController();
    const opts = { signal: this.ac.signal };
    const canvas = game.renderer.domElement;
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => this.onKey(e, true), opts);
    window.addEventListener('keyup', (e) => this.onKey(e, false), opts);
    window.addEventListener('blur', () => this.keys.clear(), opts);

    canvas.addEventListener('click', () => {
      this.game.panels.closeAll();
      if (!this.locked) {
        try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {}
      }
    }, opts);
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    }, opts);

    canvas.addEventListener('mousedown', (e) => {
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
    }, opts);
    window.addEventListener('mousemove', (e) => {
      if (this.locked) { this.game.orbit.rotate(e.movementX, e.movementY); return; }
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

  destroy() {
    if (this.locked) document.exitPointerLock?.();
    this.ac.abort();
  }

  get typing() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  onKey(e, down) {
    if (this.typing) return;
    const k = e.code;
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    const g = this.game;
    switch (k) {
      case 'Space':
        e.preventDefault();
        if (!g.driving) g.player.queueJump();
        break;
      case 'KeyE': g.actions.primary(); break;
      case 'KeyB': g.actions.backpack(); break;
      case 'KeyM': g.actions.map(); break;
      case 'KeyF': g.actions.vanToggle(); break;
      case 'KeyQ': g.actions.unequip(); break;
      case 'Digit1': case 'Digit2': case 'Digit3':
        g.actions.hotbar(Number(k.slice(-1)) - 1);
        break;
      case 'Enter': g.chat.openInput(); break;
      case 'Escape': g.panels.closeAll(); break;
    }
  }

  // foot input: x right+, z forward+; drive input: steer/throttle/brake
  poll(input) {
    if (this.typing) { input.x = input.z = 0; return input; }
    const K = this.keys;
    input.x = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
    input.z = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
    this.game.player.sprint = K.has('ShiftLeft') || K.has('ShiftRight');
    // driving
    input.steer = input.x;
    input.throttle = K.has('KeyW') || K.has('ArrowUp') ? 1 : 0;
    input.brake = K.has('KeyS') || K.has('ArrowDown') ? 1 : 0;
    input.handbrake = K.has('Space');
    return input;
  }
}
