// Mobile touch controls.
// Layout (per the design): joystick bottom-RIGHT with Jump + Fly buttons
// beside it, all other actions stacked on the LEFT, settings gear top-right,
// and dragging anywhere else moves the camera. Pinch zooms.
// Every touch is tracked by identifier so joystick + camera work together.

export class MobileControls {
  constructor(game) {
    this.game = game;
    this.move = { x: 0, z: 0 };
    this.ascendHeld = false;
    this.descendHeld = false;

    this.joyTouch = null;     // touch id steering the joystick
    this.camTouches = new Map(); // id -> {x, y}
    this.pinchDist = 0;

    this.zone = document.getElementById('joystick-zone');
    this.base = document.getElementById('joystick-base');
    this.knob = document.getElementById('joystick-knob');
    this.btnJump = document.getElementById('btn-jump');
    this.btnFly = document.getElementById('btn-fly');
    this.btnDescend = document.getElementById('btn-descend');
    document.getElementById('move-cluster').classList.remove('hidden');

    this.bindJoystick();
    this.bindButtons();
    this.bindCamera();
  }

  destroy() {
    document.getElementById('move-cluster').classList.add('hidden');
  }

  bindJoystick() {
    const onStart = (e) => {
      for (const t of e.changedTouches) {
        if (this.joyTouch === null) {
          this.joyTouch = t.identifier;
          this.updateKnob(t);
        }
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyTouch) this.updateKnob(t);
      }
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
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
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
    hold(this.btnJump, () => {
      this.ascendHeld = true;                 // in flight: hold = thrust
      this.game.player.queueJump();           // tap = jump / flap
    }, () => { this.ascendHeld = false; });

    hold(this.btnFly, () => this.game.actions.toggleFly());
    hold(this.btnDescend, () => { this.descendHeld = true; }, () => { this.descendHeld = false; });
  }

  // Flying changes what the right-hand buttons mean: the joystick becomes a
  // flight stick (up/down = pitch, left/right = bank), Jump holds thrust
  // (tap = flap), Descend brakes, and two roll buttons appear.
  refreshFlightUI(flying) {
    this.btnFly.classList.toggle('active', flying);
    this.btnDescend.classList.toggle('hidden', !flying);
    this.btnJump.querySelector('span').textContent = flying ? 'Boost' : 'Jump';
    const desc = this.btnDescend.querySelector('span');
    if (desc) desc.textContent = flying ? 'Brake' : 'Down';
    this.ensureRollButtons();
    this.rollWrap.classList.toggle('hidden', !flying);
  }

  ensureRollButtons() {
    if (this.rollWrap) return;
    this.rollHeld = 0;
    const wrap = document.createElement('div');
    wrap.id = 'roll-buttons';
    wrap.className = 'hidden';
    wrap.style.cssText = 'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:14px;z-index:6;';
    for (const [label, dir] of [['⟲', -1], ['⟳', 1]]) {
      const b = document.createElement('button');
      b.className = 'move-btn';
      b.style.cssText = 'width:54px;height:54px;font-size:24px;';
      b.innerHTML = `<span>${label}</span>`;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.rollHeld = dir; }, { passive: false });
      b.addEventListener('touchend', (e) => { e.stopPropagation(); if (this.rollHeld === dir) this.rollHeld = 0; });
      b.addEventListener('touchcancel', () => { if (this.rollHeld === dir) this.rollHeld = 0; });
      wrap.appendChild(b);
    }
    document.getElementById('move-cluster').appendChild(wrap);
    this.rollWrap = wrap;
  }

  bindCamera() {
    // Any touch not on a control = camera drag. Two = pinch zoom.
    const isControl = (target) => target.closest?.(
      '#joystick-zone, .move-btn, #action-stack, .side-panel, .round-btn, #chat-input-row, .toast, #chat-log'
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
        if (this.camTouches.size === 1) {
          this.game.orbit.rotate(t.clientX - rec.x, t.clientY - rec.y);
        }
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

    const drop = (e) => {
      for (const t of e.changedTouches) this.camTouches.delete(t.identifier);
    };
    window.addEventListener('touchend', drop);
    window.addEventListener('touchcancel', drop);
  }

  poll(input) {
    // screen-up on the joystick = forward
    input.x = this.move.x;
    input.z = -this.move.z;
    input.ascend = this.ascendHeld;
    input.descend = this.descendHeld;

    const player = this.game.player;
    if (player) {
      if (player.flying) {
        // camera-relative: drag aims the camera, the bird flies where you
        // look. Push the joystick up (or hold Boost) to thrust; roll buttons
        // (or joystick sideways) roll; Brake slows.
        player.thrust = this.ascendHeld || this.move.z < -0.35;
        player.brake = this.descendHeld;
        player.steer.roll = (this.rollHeld || 0) || this.move.x * 0.7;
      } else {
        player.thrust = false;
        player.brake = false;
        player.steer.roll = 0;
      }
    }
    return input;
  }
}
