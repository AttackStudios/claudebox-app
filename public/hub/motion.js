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

  // status — surfaced under the settings switch so permission problems are
  // visible instead of silently doing nothing. 'active' comes with live x/y.
  let status = 'idle';
  const setStatus = (s, extra) => { status = s; opts.onStatus?.(s, extra); };

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
  let statusT = 0, orientSeen = false;
  const report = (x, y) => {
    const now = Date.now();
    if (now - statusT > 250) { statusT = now; setStatus('active', { x, y }); }
  };
  const onOrient = (e) => {
    if (e.gamma == null && e.beta == null) return;   // desktops fire empty events
    gyroSeen = true; orientSeen = true; decide(true);
    if (status !== 'active') setStatus('active', { x: 0, y: 0 });
    if (!gyroOn || reduce) return;
    if (baseG === null) { baseG = e.gamma; baseB = e.beta; }
    // the baseline slowly follows the current angle, so a new resting grip
    // becomes the new neutral instead of pinning the UI off-centre
    baseG += (e.gamma - baseG) * 0.006;
    baseB += (e.beta - baseB) * 0.006;
    setTarget((e.gamma - baseG) / 18, (e.beta - baseB) / 18);
    report(tx, ty);
  };
  // fallback: some iOS builds (notably home-screen apps) grant permission but
  // never deliver deviceorientation — while devicemotion still flows. Derive
  // tilt from the gravity vector instead; same rolling-baseline treatment.
  let baseGX = null, baseGY = null;
  const onMotion = (e) => {
    if (orientSeen) return;                    // real orientation data wins
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    gyroSeen = true; decide(true);
    if (status !== 'active') setStatus('active', { x: 0, y: 0 });
    if (!gyroOn || reduce) return;
    if (baseGX === null) { baseGX = g.x; baseGY = g.y; }
    baseGX += (g.x - baseGX) * 0.006;
    baseGY += (g.y - baseGY) * 0.006;
    setTarget(-(g.x - baseGX) / 4.5, (g.y - baseGY) / 4.5);
    report(tx, ty);
  };
  const attach = (gated) => {
    addEventListener('deviceorientation', onOrient);
    addEventListener('devicemotion', onMotion);
    // permission granted but the sensors stay silent → iOS sometimes only
    // wakes them after a reload. Reload once automatically, then say so.
    if (gated) setTimeout(() => {
      if (gyroSeen) return;
      try {
        if (!sessionStorage.getItem('cbx.tiltReload')) {
          sessionStorage.setItem('cbx.tiltReload', '1');
          setStatus('retrying');
          setTimeout(() => location.reload(), 600);
          return;
        }
      } catch {}
      setStatus('nodata');
    }, 2500);
  };

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
    setStatus('asking');
    // ask for BOTH sensors in this same gesture — the devicemotion fallback
    // needs its own grant on iOS (one Apple dialog usually covers both)
    const motionAsk = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'
      ? DeviceMotionEvent.requestPermission().catch(() => 'error')
      : Promise.resolve('granted');
    return Promise.all([
      DeviceOrientationEvent.requestPermission().catch(() => 'error'),
      motionAsk,
    ])
      .then(([r, rm]) => {
        if (r === 'granted' || rm === 'granted') { permGranted = true; setStatus('granted'); attach(true); return 'granted'; }
        setStatus(r === 'error' ? 'error' : 'denied');
        return r;
      });
  };
  if (needsAsk) {
    // every iOS device with this API has a gyroscope — support is a
    // permission question, never a hardware one, so keep the toggle live
    decide(true);
    setStatus('waiting-tap');
    const ask = () => {
      removeEventListener('click', ask, true);
      removeEventListener('touchend', ask, true);
      request();
    };
    addEventListener('click', ask, true);
    addEventListener('touchend', ask, true);
  } else if (hasAPI) {
    attach(false);
    setTimeout(() => decide(gyroSeen), 2500);   // silence = no gyroscope
  } else {
    decide(false);
    setStatus('unsupported');
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
    get status() { return status; },
  };
}
