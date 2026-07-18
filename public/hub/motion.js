// Motion layer — drives two CSS custom properties (--mx / --my, each -1..1)
// that the stylesheet uses for depth: the aurora drifts, the hero tilts, card
// glare follows the light. Sources: the gyroscope on phones/tablets (with a
// rolling baseline so however you're holding the device counts as neutral),
// or a gentle pointer parallax on mouse machines. Everything is smoothed
// through one rAF loop that goes idle when the target settles.

export function startMotion(opts = {}) {
  const root = document.documentElement.style;
  let gyroOn = opts.gyro !== false;
  let reduce = !!opts.reduce;
  let tx = 0, ty = 0, cx = 0, cy = 0;
  let baseB = null, baseG = null;
  let gyroSeen = false, decided = false;
  const decide = (ok) => { if (!decided) { decided = true; opts.onSupport?.(ok); } };

  const apply = () => { root.setProperty('--mx', cx.toFixed(4)); root.setProperty('--my', cy.toFixed(4)); };
  let raf = null;
  const tick = () => {
    raf = null;
    cx += (tx - cx) * 0.09; cy += (ty - cy) * 0.09;
    if (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002) { apply(); raf = requestAnimationFrame(tick); }
    else { cx = tx; cy = ty; apply(); }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const setTarget = (x, y) => {
    tx = Math.max(-1, Math.min(1, x));
    ty = Math.max(-1, Math.min(1, y));
    kick();
  };
  const reset = () => { baseG = baseB = null; setTarget(0, 0); };

  // ---------------- gyroscope ----------------
  const onOrient = (e) => {
    if (e.gamma == null && e.beta == null) return;   // desktops fire empty events
    gyroSeen = true; decide(true);
    if (!gyroOn || reduce) return;
    if (baseG === null) { baseG = e.gamma; baseB = e.beta; }
    // the baseline slowly follows the current angle, so a new resting grip
    // becomes the new neutral instead of pinning the UI off-centre
    baseG += (e.gamma - baseG) * 0.006;
    baseB += (e.beta - baseB) * 0.006;
    setTarget((e.gamma - baseG) / 22, (e.beta - baseB) / 22);
  };
  const attach = () => addEventListener('deviceorientation', onOrient);

  const hasAPI = typeof DeviceOrientationEvent !== 'undefined';
  const needsAsk = hasAPI && typeof DeviceOrientationEvent.requestPermission === 'function';
  let permGranted = false;
  // iOS: sensor access is permission-gated and the request MUST run inside a
  // real user gesture. Callable again later (e.g. from the settings toggle)
  // because Safari only shows its dialog when it feels like the gesture is
  // clean — a failed first ask must not brick the feature.
  const request = () => {
    if (!needsAsk) return Promise.resolve('granted');
    if (permGranted) return Promise.resolve('granted');
    return DeviceOrientationEvent.requestPermission()
      .then((r) => {
        if (r === 'granted') { permGranted = true; attach(); }
        return r;
      })
      .catch(() => 'error');
  };
  if (needsAsk) {
    // every iOS device with this API has a gyroscope — support is a
    // permission question, never a hardware one, so keep the toggle live
    decide(true);
    const ask = () => {
      removeEventListener('click', ask, true);
      removeEventListener('touchend', ask, true);
      request();
    };
    addEventListener('click', ask, true);
    addEventListener('touchend', ask, true);
  } else if (hasAPI) {
    attach();
    setTimeout(() => decide(gyroSeen), 2500);   // silence = no gyroscope
  } else {
    decide(false);
  }

  // ---------------- pointer parallax (mouse machines) ----------------
  if (matchMedia('(pointer: fine)').matches) {
    addEventListener('mousemove', (e) => {
      if (reduce || gyroSeen) return;   // a real gyro always wins
      setTarget((e.clientX / innerWidth * 2 - 1) * 0.5, (e.clientY / innerHeight * 2 - 1) * 0.5);
    }, { passive: true });
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });

  return {
    setGyro(on) { gyroOn = on; if (!on) reset(); },
    setReduce(on) { reduce = on; if (on) reset(); },
    request,   // re-ask for iOS motion permission (call from a tap handler)
  };
}
