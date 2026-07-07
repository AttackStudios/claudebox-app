// Procedural animation v2: drives the pivot groups built by factory.js.
//
// Beyond the basic state poses, birds now:
//  - fold wings against the body on the ground, spread them in flight
//  - flap with a downstroke-biased curve and twist the wing through the stroke
//  - bank into turns and pitch with climb/descent (st.turn / st.vy)
//  - waddle, lean and head-bob when walking (speed-scaled, st.speed)
//  - breathe constantly; idle birds glance around, flick tails, ruffle wings
//  - tuck their head back to sleep, paddle when swimming, dangle when carried
//
// Callers may fill st.speed (horizontal u/s), st.vy (vertical u/s), st.turn
// (yaw rad/s), st.roll (flight roll) and st.airspeed each frame for the
// motion-aware parts; all default to 0. st.hasAttitude means the bird's
// GROUP already carries true pitch/roll (flight-sim players), so the body
// pose only adds posture on top instead of faking the attitude.
// Quadrupeds (parts.legBL/legBR) trot with diagonal pairs.

export function makeAnimState() {
  return {
    t: Math.random() * 10,   // gait phase (cadence-scaled)
    tt: Math.random() * 100, // wall-clock seconds (for breathing/fidgets)
    anim: 'idle',
    speed: 0, vy: 0, turn: 0, roll: 0, airspeed: 0,
    hasAttitude: false,
    seed: Math.random() * 97,
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// short organic burst: fires for `dur` seconds once every `period` seconds
function pulse(tt, seed, period, dur) {
  const ph = (tt + seed * 7.3) % period;
  return ph < dur ? Math.sin((ph / dur) * Math.PI) : 0;
}

// wandering value in [-1,1] that holds, drifts, holds (for idle glances)
function wander(tt, seed) {
  return Math.sin(tt * 0.31 + seed) * Math.sin(tt * 0.117 + seed * 2.1);
}

export function animateBird(bird, st, dt) {
  if (!bird) return;
  st.tt += dt;
  const tt = st.tt;

  // ---------------- eggs: wobble, hop squash & stretch ----------------
  if (bird.stage === 'egg') {
    const g = bird.group;
    if (st.anim === 'walk' || st.anim === 'run' || st.anim === 'wiggle') {
      st.t += dt * 11;
      g.rotation.z = Math.sin(st.t) * 0.2;
      g.rotation.x = Math.cos(st.t * 0.7) * 0.12;
      g.scale.y += ((1 + Math.sin(st.t * 2) * 0.07) - g.scale.y) * Math.min(1, dt * 12);
    } else {
      g.rotation.z *= 0.88;
      g.rotation.x *= 0.88;
      // tiny living wobble + breath so eggs never look like rocks
      g.rotation.z += Math.sin(tt * 1.1 + st.seed) * 0.004;
      g.scale.y += ((1 + Math.sin(tt * 1.7 + st.seed) * 0.012) - g.scale.y) * Math.min(1, dt * 4);
    }
    return;
  }

  const p = bird.parts;
  const S = bird.size;
  const def = bird.def || {};
  const upright = !!def.upright;
  const quad = !!p.legBL;
  const baby = bird.stage === 'baby';
  const rollNow = Math.atan2(Math.sin(st.roll || 0), Math.cos(st.roll || 0));

  // cadence: gait phase advances with how fast the bird actually moves
  const cadence = (baby ? 1.3 : 1) * (
    st.anim === 'run' ? 10 + clamp(st.speed, 4, 14) * 0.45 :
    st.anim === 'walk' ? 6 + clamp(st.speed, 0, 8) * 0.5 :
    st.anim === 'fly' ? 10.5 :
    st.anim === 'swim' ? 6 : 3);
  st.t += dt * cadence;
  const t = st.t;

  const ease = 1 - Math.pow(0.0001, dt);       // standard smoothing
  const snap = 1 - Math.pow(0.0000001, dt);    // fast (flaps, strokes)
  const to = (obj, prop, axis, target, e = ease) => {
    obj[prop][axis] += (target - obj[prop][axis]) * e;
  };

  // per-frame targets
  let legL = 0, legR = 0, legBL = 0, legBR = 0;
  let flap = 0, fold = 0.35, wingPitch = 0, wingEase = ease;
  let wingAsym = 0, wingSweep = 0;
  let bob = 0, rootY = bird.standH;
  let bodyPitch = 0, bodyRoll = 0;
  let headPitch = 0, headYaw = 0, neckPitch = 0;
  let tailPitch = 0, tailYaw = 0;
  let breathe = 1 + 0.013 * Math.sin(tt * 1.9 + st.seed);
  let legEase = ease;

  const bank = clamp(-st.turn * 0.42, -0.5, 0.5);

  switch (st.anim) {
    case 'walk':
    case 'run': {
      const run = st.anim === 'run';
      const amp = clamp(st.speed / (run ? 11 : 6.5), 0.35, 1);
      const swing = Math.sin(t) * (run ? 1.0 : 0.8) * amp * (quad ? 0.65 : 1);
      legL = swing; legR = -swing;
      if (quad) {
        // trot: diagonal pairs move together
        legBL = -swing;
        legBR = swing;
      }
      legEase = snap;
      // bounce lands on each footfall (twice per cycle)
      bob = Math.abs(Math.sin(t)) * (run ? 0.07 : 0.045) * S * amp;
      bodyPitch = (run ? 0.2 : 0.06) + Math.sin(t * 2) * 0.02;
      // waddle: upright birds (penguins!) swing way more
      bodyRoll = Math.sin(t) * (upright ? 0.16 : 0.05) * amp + bank * 0.4;
      headPitch = Math.sin(t * 2 + 0.6) * 0.07 * amp; // pigeon-style bob
      neckPitch = Math.sin(t * 2 + 0.6) * 0.05 * amp;
      headYaw = bank * -0.5;
      tailPitch = Math.sin(t * 2) * 0.07;
      tailYaw = Math.sin(t) * 0.08 * amp;
      flap = Math.sin(t) * 0.05;        // folded wings sway with the gait
      fold = 0.35;
      break;
    }
    case 'fly': {
      // downstroke-biased stroke: quick power stroke, slower recovery
      flap = (Math.sin(t) + 0.45 * Math.sin(2 * t + 0.7)) * 0.78;
      wingPitch = Math.cos(t) * 0.22;   // wing twists through the stroke
      wingEase = snap;
      fold = 0;
      legL = legR = legBL = legBR = 0.95;  // legs trail behind
      if (st.hasAttitude) {
        // the group already pitches/rolls — just hold a flight posture
        bodyPitch = 0.1;
        bodyRoll = 0;
        headPitch = -0.08;
        // head counter-rolls a touch so the eyes stay level in banks
        headYaw = 0;
      } else {
        bodyPitch = clamp(0.34 - st.vy * 0.022, 0.02, 0.62);
        bodyRoll = bank;
        headPitch = -0.1 - st.vy * 0.008;
        headYaw = bank * -0.4;
      }
      wingAsym = clamp(rollNow * 0.45, -0.5, 0.5);   // inside wing tucks
      if ((st.airspeed || 0) > 18 && st.vy < -5) {   // dive tuck
        fold = 0.22;
        wingSweep = 0.5;
        wingEase = snap;
      }
      tailPitch = -0.12 + clamp(st.vy * 0.012, -0.12, 0.12);
      tailYaw = bank * -0.5;            // tail rudders the turn
      bob = Math.sin(t - 0.9) * 0.05 * S; // body heaves a beat after the stroke
      breathe = 1 + 0.02 * Math.sin(tt * 3.2);
      break;
    }
    case 'glide': {
      fold = 0;
      flap = 0.14 + Math.sin(tt * 1.4 + st.seed) * 0.045; // dihedral hold
      wingPitch = Math.sin(tt * 0.9) * 0.04;
      legL = legR = legBL = legBR = 0.95;
      if (st.hasAttitude) {
        bodyPitch = 0.06;
        bodyRoll = 0;
        headYaw = 0;
      } else {
        bodyPitch = 0.2 - st.vy * 0.012;
        bodyRoll = bank * 1.2;
        headYaw = bank * -0.5;
      }
      wingAsym = clamp(rollNow * 0.45, -0.5, 0.5);
      if ((st.airspeed || 0) > 18 && st.vy < -5) { fold = 0.22; wingSweep = 0.5; }
      tailPitch = -0.06;
      tailYaw = bank * -0.6;
      bob = Math.sin(tt * 1.1) * 0.02 * S;
      break;
    }
    case 'flare': {
      // landing flare: wings thrown wide and high, body reared, legs reaching
      fold = 0;
      flap = -0.55;
      wingPitch = 0.5;
      wingEase = snap;
      legL = legR = legBL = legBR = -0.5;
      bodyPitch = -0.3;
      tailPitch = 0.3;
      headPitch = 0.12;
      break;
    }
    case 'swim': {
      const paddle = Math.sin(t) * 0.7;
      legL = paddle; legR = -paddle;
      legEase = snap;
      fold = 0.35;
      bob = Math.sin(t * 1.1) * 0.035 * S;
      bodyRoll = Math.sin(t * 0.9) * 0.05 + bank * 0.4;
      bodyPitch = -0.05;
      headPitch = -0.14;                 // chin up out of the water
      tailYaw = Math.sin(t * 1.3) * 0.1; // happy tail wag
      break;
    }
    case 'peck': {
      // anticipation pull-back, sharp strike, recover
      const ph = t % (Math.PI * 2);
      const strike = Math.max(0, Math.sin(ph)) ** 2;
      const windup = Math.max(0, Math.sin(-ph)) * 0.18;
      headPitch = strike * 0.95 - windup;
      neckPitch = strike * 0.5 - windup * 0.5;
      tailPitch = -strike * 0.18;        // tail tips up as the head goes down
      bob = -strike * 0.02 * S;
      break;
    }
    case 'drink': {
      const sip = Math.sin(t * 1.5);
      headPitch = 0.62 + sip * 0.38;
      neckPitch = 0.32 + sip * 0.18;
      tailPitch = -0.22;
      breathe = 1 + 0.03 * Math.sin(tt * 5);  // little gulps
      break;
    }
    case 'sit': {
      rootY = bird.standH * 0.55;
      legL = legR = -1.25;
      bob = Math.sin(tt * 1.5 + st.seed) * 0.014 * S;
      headYaw = wander(tt, st.seed) * 0.55;   // perched birds still look around
      headPitch = 0.04 + wander(tt, st.seed + 9) * 0.06;
      tailYaw = pulse(tt, st.seed + 4, 6, 0.5) * Math.sin(tt * 9) * 0.14;
      break;
    }
    case 'sleep': {
      rootY = bird.standH * 0.5;
      legL = legR = -1.25;
      headYaw = 2.1;                     // head tucked back toward the wing
      headPitch = 0.5;
      neckPitch = 0.3;
      fold = 0.45;
      breathe = 1 + 0.03 * Math.sin(tt * 1.1 + st.seed); // deep slow breaths
      bob = Math.sin(tt * 1.1 + st.seed) * 0.02 * S;
      break;
    }
    case 'carried': {
      legL = -0.9 + Math.sin(tt * 3.1 + st.seed) * 0.18;       // dangling feet
      legR = -0.9 + Math.sin(tt * 3.1 + st.seed + 1.4) * 0.18;
      bodyRoll = Math.sin(tt * 2.2) * 0.06;
      headYaw = wander(tt, st.seed) * 0.4;
      fold = 0.35;
      bob = Math.sin(tt * 2.2) * 0.012 * S;
      break;
    }
    default: { // idle: a living, fidgeting bird
      bob = Math.sin(tt * 1.9 + st.seed) * 0.016 * S;
      // occasional curious glances that hold, then move on
      headYaw = wander(tt, st.seed) * 0.7;
      headPitch = 0.03 + wander(tt, st.seed + 31) * 0.09;
      // weight shifts foot to foot
      bodyRoll = Math.sin(tt * 0.4 + st.seed) * 0.035;
      const shift = Math.sin(tt * 0.4 + st.seed);
      legL = shift * 0.05; legR = -shift * 0.05;
      if (quad) { legBL = -shift * 0.04; legBR = shift * 0.04; }
      // tail flicks every several seconds
      tailYaw = pulse(tt, st.seed, 5.5, 0.4) * Math.sin(tt * 11) * 0.18;
      tailPitch = Math.sin(tt * 0.9 + st.seed) * 0.03;
      // quick wing ruffle now and then
      const ruffle = pulse(tt, st.seed + 13, 8.5, 0.5);
      flap = ruffle * Math.sin(tt * 24) * 0.4;
      fold = 0.35 - ruffle * 0.2;
      if (ruffle > 0.01) wingEase = snap;
    }
  }

  // ---------------- apply ----------------
  to(p.legL, 'rotation', 'x', legL, legEase);
  to(p.legR, 'rotation', 'x', legR, legEase);
  if (p.legBL) to(p.legBL, 'rotation', 'x', legBL, legEase);
  if (p.legBR) to(p.legBR, 'rotation', 'x', legBR, legEase);

  // Folded wings hang steeply at the sides AND compress along their length,
  // so they read as tucked feathers instead of out-stretched planks.
  const folded = fold > 0.2;
  const spreadLift = folded ? -0.85 : 0.16;
  const wingScale = folded ? 0.55 : 1;
  to(p.wingL, 'rotation', 'z', -(flap + spreadLift) + wingAsym, wingEase);
  to(p.wingR, 'rotation', 'z', flap + spreadLift + wingAsym, wingEase);
  to(p.wingL, 'rotation', 'y', -(fold + wingSweep));
  to(p.wingR, 'rotation', 'y', fold + wingSweep);
  to(p.wingL, 'rotation', 'x', wingPitch, wingEase);
  to(p.wingR, 'rotation', 'x', wingPitch, wingEase);
  to(p.wingL, 'scale', 'x', wingScale);
  to(p.wingR, 'scale', 'x', wingScale);

  to(p.root, 'position', 'y', rootY + bob, snap);
  to(p.root, 'rotation', 'x', -bodyPitch);
  to(p.root, 'rotation', 'z', bodyRoll);
  to(p.root, 'scale', 'y', breathe);

  to(p.neck, 'rotation', 'x', neckPitch);
  // eyes stay roughly level through banks
  to(p.neck, 'rotation', 'z', st.hasAttitude ? clamp(-rollNow * 0.3, -0.45, 0.45) : 0);
  to(p.head, 'rotation', 'x', headPitch);
  to(p.head, 'rotation', 'y', headYaw);

  // blink: eyelids drop over the eyes for a tenth of a second now and then
  if (p.eyelids) {
    const blink = pulse(tt, st.seed + 21, 6.5, 0.14);
    for (const lid of p.eyelids) lid.scale.y = 0.12 + blink * 0.9;
  }

  if (p.tail) {
    to(p.tail, 'rotation', 'x', tailPitch);
    to(p.tail, 'rotation', 'y', tailYaw);
  }

  // mythical particle swirl
  if (p.particles) {
    const { seeds, S: ps } = p.particles.userData;
    const pos = p.particles.geometry.attributes.position;
    const time = performance.now() / 1000;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const a = s.a + time * s.s;
      const flicker = (Math.sin(time * 3 + s.o) + 1) / 2;
      pos.setXYZ(
        i,
        Math.cos(a) * s.r * ps,
        bird.standH * 0.6 + Math.sin(time * 0.8 + s.o) * 0.5 * ps + flicker * 0.3,
        Math.sin(a) * s.r * ps - 0.3 * ps
      );
    }
    pos.needsUpdate = true;
  }
}
