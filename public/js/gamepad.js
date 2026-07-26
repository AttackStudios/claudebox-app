// ClaudeBox — universal gamepad support (Xbox / PlayStation / generic).
// Console browsers (e.g. Edge on Xbox) map the sticks to a cursor, not to the
// game. This translates a connected controller into the SAME keyboard + mouse
// events every ClaudeBox game already listens for, so console players can play
// with no keyboard. Include once per page: <script src="/js/gamepad.js"></script>
(function () {
  if (window.__cbxGamepad) return;
  window.__cbxGamepad = true;
  const DEAD = 0.24;                 // stick dead-zone
  const LOOK = 26;                   // right-stick look sensitivity (px/frame at full tilt)
  const held = new Set();            // synthetic keys currently down
  const mouse = { 0: false, 2: false };
  const prev = [];                   // previous button states (edge detection)
  let lastPad = false;

  const canvasEl = () => document.querySelector('canvas');
  function keyEv(type, code) { const e = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }); window.dispatchEvent(e); document.dispatchEvent(e); }
  function setKey(code, on) {
    if (on && !held.has(code)) { held.add(code); keyEv('keydown', code); }
    else if (!on && held.has(code)) { held.delete(code); keyEv('keyup', code); }
  }
  function tap(code) { keyEv('keydown', code); setTimeout(() => keyEv('keyup', code), 45); }
  function mouseBtn(btn, on) {
    if (on === mouse[btn]) return;
    mouse[btn] = on;
    const c = canvasEl() || document;
    const opt = { button: btn, buttons: on ? (btn === 2 ? 2 : 1) : 0, bubbles: true, cancelable: true };
    const e1 = new MouseEvent(on ? 'mousedown' : 'mouseup', opt);
    c.dispatchEvent(e1); window.dispatchEvent(new MouseEvent(on ? 'mousedown' : 'mouseup', opt));
  }
  function look(dx, dy) {
    if (!dx && !dy) return;
    const c = canvasEl();
    const opt = { movementX: dx | 0, movementY: dy | 0, bubbles: true };
    const mk = () => new MouseEvent('mousemove', opt);
    if (c) c.dispatchEvent(mk());
    document.dispatchEvent(mk()); window.dispatchEvent(mk());
  }
  function tryLock() {
    const c = canvasEl();
    if (!c) return;
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));   // most games lock on canvas click
    if (document.pointerLockElement !== c && c.requestPointerLock) { try { c.requestPointerLock(); } catch {} }
  }
  const curve = (v) => Math.sign(v) * v * v;   // finer control near centre

  function poll() {
    requestAnimationFrame(poll);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { if (lastPad) { lastPad = false; badge(false); } return; }
    if (!lastPad) { lastPad = true; badge(true); window.__padActive = true; }

    const ax = gp.axes;
    const lx = Math.abs(ax[0] || 0) > DEAD ? ax[0] : 0;
    const ly = Math.abs(ax[1] || 0) > DEAD ? ax[1] : 0;
    const rx = Math.abs(ax[2] || 0) > DEAD ? ax[2] : 0;
    const ry = Math.abs(ax[3] || 0) > DEAD ? ax[3] : 0;

    // left stick → WASD
    setKey('KeyW', ly < -DEAD); setKey('KeyS', ly > DEAD);
    setKey('KeyA', lx < -DEAD); setKey('KeyD', lx > DEAD);
    // right stick → mouse look
    look(curve(rx) * LOOK, curve(ry) * LOOK);

    const b = gp.buttons.map((x) => (typeof x === 'object' ? x.pressed : x > 0.5));
    const edge = (i) => b[i] && !prev[i];
    const locked = !!document.pointerLockElement;

    // A(0)=jump(Space)  B(1)=slide/crouch(Shift)  X(2)=reload(R)
    setKey('Space', !!b[0]);
    setKey('ShiftLeft', !!b[1]);
    if (edge(2)) tap('KeyR');
    // Y(3)=interact/queue(E)
    if (edge(3)) tap('KeyE');
    // RT(7)/RB(5)=fire (left mouse)   LT(6)/LB(4)=aim (right mouse)
    mouseBtn(0, !!(b[7] || b[5]));
    mouseBtn(2, !!(b[6] || b[4]));
    // D-pad → weapon slots 1..4
    if (edge(12)) tap('Digit1');
    if (edge(15)) tap('Digit2');
    if (edge(13)) tap('Digit3');
    if (edge(14)) tap('Digit4');
    // Start(9) → (re)engage pointer lock; Back(8) → Escape / open menu
    if (edge(9)) tryLock();
    if (edge(8)) tap('Escape');
    // pressing anything while unlocked → lock so movement + look take effect
    if (!locked && (edge(0) || edge(7) || edge(5) || edge(9))) tryLock();

    for (let i = 0; i < b.length; i++) prev[i] = b[i];
  }

  // small "controller ready" badge
  let badgeEl = null;
  function badge(on) {
    if (on && !badgeEl) {
      badgeEl = document.createElement('div');
      badgeEl.textContent = '🎮 Controller ready — press A / RT to start';
      badgeEl.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;background:rgba(16,20,30,.9);color:#8fe0a0;font:600 13px system-ui;padding:8px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.15);pointer-events:none;transition:opacity .5s;';
      document.body && document.body.appendChild(badgeEl);
      setTimeout(() => { if (badgeEl) badgeEl.style.opacity = '0'; }, 6000);
    } else if (!on && badgeEl) { badgeEl.remove(); badgeEl = null; }
  }
  window.addEventListener('gamepadconnected', () => { window.__padActive = true; });
  poll();
})();
