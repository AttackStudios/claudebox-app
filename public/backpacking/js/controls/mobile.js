// Mobile touch controls — same layout as Feather Friends: joystick + primary
// buttons on the LEFT, context actions on the RIGHT, drag anywhere = camera.
// On foot: Jump + Sprint beside the joystick. Driving: joystick steers,
// the buttons become Gas and Brake.

export class MobileControls {
  constructor(game) {
    this.game = game;
    this.move = { x: 0, z: 0 };
    this.gasHeld = false;
    this.brakeHeld = false;
    this.joyTouch = null;
    this.camTouches = new Map();
    this.pinchDist = 0;
    this.mode = 'foot';

    this.zone = document.getElementById('joystick-zone');
    this.base = document.getElementById('joystick-base');
    this.knob = document.getElementById('joystick-knob');
    this.btnA = document.getElementById('btn-a'); // Jump / Gas
    this.btnB = document.getElementById('btn-b'); // Sprint / Brake
    document.getElementById('move-cluster').classList.remove('hidden');

    this.bindJoystick();
    this.bindButtons();
    this.bindCamera();
    this.setMode('foot');
  }

  destroy() {
    document.getElementById('move-cluster').classList.add('hidden');
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'drive') {
      this.btnA.innerHTML = '⛽<span>Gas</span>';
      this.btnB.innerHTML = '🛑<span>Brake</span>';
    } else {
      this.btnA.innerHTML = '⬆️<span>Jump</span>';
      this.btnB.innerHTML = '🏃<span>Sprint</span>';
      this.btnB.classList.toggle('active', this.game.player.sprint);
    }
  }

  bindJoystick() {
    const onStart = (e) => {
      for (const t of e.changedTouches) {
        if (this.joyTouch === null) { this.joyTouch = t.identifier; this.updateKnob(t); }
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.joyTouch) this.updateKnob(t);
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyTouch) {
          this.joyTouch = null;
          this.move.x = 0; this.move.z = 0;
          this.knob.style.transform = 'translate(-50%,-50%)';
        }
      }
    };
    this.zone.addEventListener('touchstart', onStart, { passive: false });
    this.zone.addEventListener('touchmove', onMove, { passive: false });
    this.zone.addEventListener('touchend', onEnd);
    this.zone.addEventListener('touchcancel', onEnd);
  }

  updateKnob(touch) {
    const rect = this.base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = touch.clientX - cx, dy = touch.clientY - cy;
    const max = rect.width / 2;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.move.x = dx / max;
    this.move.z = dy / max;
  }

  bindButtons() {
    const hold = (el, downFn, upFn) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); downFn(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.stopPropagation(); upFn?.(); });
      el.addEventListener('touchcancel', () => upFn?.());
    };
    hold(this.btnA, () => {
      if (this.mode === 'drive') this.gasHeld = true;
      else this.game.player.queueJump();
    }, () => { this.gasHeld = false; });
    hold(this.btnB, () => {
      if (this.mode === 'drive') this.brakeHeld = true;
      else {
        this.game.player.sprint = !this.game.player.sprint;
        this.btnB.classList.toggle('active', this.game.player.sprint);
      }
    }, () => { this.brakeHeld = false; });
  }

  bindCamera() {
    const isControl = (target) => target.closest?.(
      '#joystick-zone, .move-btn, #action-stack, .side-panel, .round-btn, #chat-input-row, #hotbar, #minimap, .bp-toast, #chat-log, #backpack, #fullmap'
    );
    window.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyTouch) continue;
        if (isControl(t.target)) continue;
        this.camTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      if (this.camTouches.size === 2) {
        const [a, b] = [...this.camTouches.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      let moved = false;
      for (const t of e.changedTouches) {
        const rec = this.camTouches.get(t.identifier);
        if (!rec) continue;
        if (this.camTouches.size === 1) this.game.orbit.rotate(t.clientX - rec.x, t.clientY - rec.y);
        rec.x = t.clientX; rec.y = t.clientY;
        moved = true;
      }
      if (moved && this.camTouches.size === 2) {
        const [a, b] = [...this.camTouches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.game.orbit.zoom((this.pinchDist - d) * 4);
        this.pinchDist = d;
      }
    }, { passive: true });
    const drop = (e) => { for (const t of e.changedTouches) this.camTouches.delete(t.identifier); };
    window.addEventListener('touchend', drop);
    window.addEventListener('touchcancel', drop);
  }

  poll(input) {
    input.x = this.move.x;
    input.z = -this.move.z; // screen-up = forward
    input.steer = this.move.x;
    input.throttle = this.gasHeld ? 1 : 0;
    input.brake = this.brakeHeld ? 1 : 0;
    input.handbrake = false;
    return input;
  }
}
