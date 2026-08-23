// Procedural humanoid animation.
//
// Replaces the per-clip GLB animations with pose functions driven in code. The
// reasons this is worth doing:
//   * The girl model shipped without an idle clip, so she fell back to whatever
//     clip loaded first and stood there dancing.
//   * `walk` was mapped onto the run clip, so walking looked like running.
//   * Every clip was a separate GLB download per body per motion.
// Driving bones directly means every body gets every motion, walking and
// running are actually different, and the whole set is a few kB of maths.
//
// The awkward part of doing this across rigs is that "swing the arm forward" is
// a different local rotation on each skeleton, depending on how the bones were
// laid out at bind time. Those axes are not guessed here — they were measured.
// Rotating a bone about local axis `a` displaces its child by R * (a x p) for
// small angles (R = the bone's world rotation, p = the child's position in bone
// space), so the swing axis is whichever of x/y/z maximises that along world
// forward, and its sign says which way is "forward".

export const RIGS = {
  // Mixamo skeleton. Arms swing about local Z and are already mirrored by the
  // rig; legs swing about local X and are not.
  boy: {
    joints: {
      hips: 'mixamorigHips', spine: 'mixamorigSpine', chest: 'mixamorigSpine2',
      neck: 'mixamorigNeck', head: 'mixamorigHead',
      armL: 'mixamorigLeftArm', armR: 'mixamorigRightArm',
      foreL: 'mixamorigLeftForeArm', foreR: 'mixamorigRightForeArm',
      legL: 'mixamorigLeftUpLeg', legR: 'mixamorigRightUpLeg',
      shinL: 'mixamorigLeftLeg', shinR: 'mixamorigRightLeg',
      footL: 'mixamorigLeftFoot', footR: 'mixamorigRightFoot',
    },
    swing: { arm: 'z', fore: 'z', leg: 'x', shin: 'x', foot: 'x', spine: 'x', head: 'x' },
    sign: { armL: 1, armR: -1, foreL: 1, foreR: -1, legL: 1, legR: 1, shinL: 1, shinR: 1, footL: 1, footR: 1, spine: 1, head: 1 },
    lift: { arm: 'x', armL: 1, armR: -1 },      // raising the arms out sideways
  },
  // The girl rig swings everything about local X, and both sides share a sign,
  // so left/right mirroring has to be applied by hand.
  girl: {
    joints: {
      hips: 'Waist', spine: 'Waist', chest: 'Chest',
      neck: 'Neck', head: 'Neck',                 // no Head bone; the neck carries it
      armL: 'L_Shoulder', armR: 'R_Shoulder',
      foreL: 'L_Elbow', foreR: 'R_Elbow',
      legL: 'L_Thigh', legR: 'R_Thigh',
      shinL: 'L_Knee', shinR: 'R_Knee',
      footL: 'L_Ankle', footR: 'R_Ankle',
    },
    swing: { arm: 'x', fore: 'x', leg: 'x', shin: 'x', foot: 'x', spine: 'x', head: 'x' },
    sign: { armL: -1, armR: -1, foreL: -1, foreR: -1, legL: -1, legR: -1, shinL: -1, shinR: -1, footL: -1, footR: -1, spine: -1, head: -1 },
    lift: { arm: 'z', armL: 1, armR: -1 },
  },
  // Classic Roblox R6: six bones, no elbows or knees. Both arms and legs swing
  // about local Z. The signs are all negative because R6 FACES -Z, unlike the
  // other two rigs — rotating +z displaces a limb toward +Z, which on this model
  // is backwards.
  // The blocky body. Six pivots, built by shared/avatar/steven.js, already
  // upright and axis-aligned — so no sign gymnastics and no rest correction.
  steven: {
    joints: { hips: 'body', spine: 'body', chest: 'body', neck: 'head', head: 'head',
              armL: 'armL', armR: 'armR', legL: 'legL', legR: 'legR' },
    swing: { arm: 'x', fore: 'x', leg: 'x', shin: 'x', foot: 'x', spine: 'x', head: 'x' },
    sign: { armL: 1, armR: 1, foreL: 0, foreR: 0, legL: 1, legR: 1,
            shinL: 0, shinR: 0, footL: 0, footR: 0, spine: 1, head: 1 },
    // Minecraft arms never lift out to the side, so lift is disabled rather
    // than scaled — a blocky body reads wrong the moment its arms splay.
    lift: { arm: 'z', armL: 0, armR: 0 },
    rigid: true,
  },
  r6: {
    joints: {
      hips: 'Torso_00', spine: 'Torso_00', chest: 'Torso_00',
      neck: 'Head_01', head: 'Head_01',
      armL: 'Left_Arm_02', armR: 'Right_Arm_03',
      legL: 'Left_Leg_04', legR: 'Right_Leg_05',
    },
    swing: { arm: 'z', fore: 'z', leg: 'z', shin: 'z', foot: 'z', spine: 'x', head: 'x' },
    sign: { armL: -1, armR: -1, foreL: 0, foreR: 0, legL: -1, legR: -1,
            shinL: 0, shinR: 0, footL: 0, footR: 0, spine: -1, head: -1 },
    lift: { arm: 'x', armL: -1, armR: 1 },
    // This model's bind pose splays the arms out from the shoulders; classic R6
    // hangs them at the sides. No single lift value fixes that (rotating far
    // enough just tucks them behind the torso), so the rest pose is corrected
    // by solving for it — see normalizeRest below.
    normalizeRest: ['armL', 'armR'],
    // R6 has no knee or ankle, so the whole leg is one rigid block. Folding the
    // shin into the thigh keeps the stride reading as a stride instead of
    // silently dropping half the motion.
    rigid: true,
  },
};

// ---- the pose library ----
// Each pose fills a canonical channel set. Positive `armSwing`/`legSwing` is
// forward for every rig; the per-rig signs above sort out what that means in
// local space. Amplitudes are in radians and chosen to read like the classic
// Roblox set: a plain pendulum on the limbs, very little torso, no wind-up.
const TAU = Math.PI * 2;
const ch = () => ({
  armLS: 0, armRS: 0, armLL: 0, armRL: 0,   // arm swing / lift, per side
  foreL: 0, foreR: 0,
  legLS: 0, legRS: 0, shinL: 0, shinR: 0, footL: 0, footR: 0,
  spine: 0, head: 0, bob: 0, rootPitch: 0,
  // Root translation. Nothing procedural uses these — they exist so an authored
  // set can slide the whole body (a lunge, a dodge, a landing skid).
  rootX: 0, rootZ: 0,
});

export const POSES = {
  // slow breathing, arms resting slightly away from the body
  idle(c, t) {
    const b = Math.sin(t * 1.5);
    c.armLL = 0.09 + b * 0.012; c.armRL = 0.09 + b * 0.012;
    c.armLS = b * 0.03; c.armRS = -b * 0.03;
    c.spine = b * 0.012;
    c.head = Math.sin(t * 0.7) * 0.05;
    c.bob = b * 0.004;
  },
  // a pendulum, arms opposing legs — the classic look
  walk(c, t) {
    const s = Math.sin(t * TAU);
    c.legLS = s * 0.52; c.legRS = -s * 0.52;
    c.armLS = -s * 0.42; c.armRS = s * 0.42;
    c.armLL = 0.07; c.armRL = 0.07;
    c.shinL = Math.max(0, -s) * 0.5; c.shinR = Math.max(0, s) * 0.5;
    c.spine = 0.03;
    c.bob = Math.abs(Math.cos(t * TAU)) * 0.018;
  },
  run(c, t) {
    const s = Math.sin(t * TAU);
    c.legLS = s * 0.95; c.legRS = -s * 0.95;
    c.armLS = -s * 0.85; c.armRS = s * 0.85;
    c.armLL = 0.11; c.armRL = 0.11;
    c.foreL = 0.42; c.foreR = 0.42;                // elbows bent while sprinting
    c.shinL = Math.max(0, -s) * 0.95; c.shinR = Math.max(0, s) * 0.95;
    c.spine = 0.14;                                // lean into it
    c.bob = Math.abs(Math.cos(t * TAU)) * 0.035;
  },
  // arms up, trailing leg tucked
  jump(c) {
    c.armLS = 1.5; c.armRS = 1.5; c.armLL = 0.3; c.armRL = 0.3;
    c.legLS = 0.35; c.legRS = -0.2; c.shinL = 0.5;
    c.spine = -0.06;
  },
  fall(c, t) {
    const w = Math.sin(t * 6) * 0.08;
    c.armLS = 1.1 + w; c.armRS = 1.1 - w; c.armLL = 0.55; c.armRL = 0.55;
    c.legLS = -0.25; c.legRS = 0.3; c.shinR = 0.35;
  },
  sit(c) {
    c.legLS = 1.5; c.legRS = 1.5; c.shinL = 1.2; c.shinR = 1.2;
    c.armLS = -0.25; c.armRS = -0.25; c.armLL = 0.18; c.armRL = 0.18;
    c.spine = 0.08;
  },
  // face-down, arms sweeping — the root pitch is what sells it
  swim(c, t) {
    const s = Math.sin(t * TAU * 1.2);
    c.rootPitch = 1.35;
    c.armLS = s * 1.5 + 0.6; c.armRS = -s * 1.5 + 0.6;
    c.armLL = 0.3; c.armRL = 0.3;
    c.legLS = s * 0.3; c.legRS = -s * 0.3;
  },
  tread(c, t) {
    const s = Math.sin(t * 3);
    c.armLL = 0.9 + s * 0.15; c.armRL = 0.9 - s * 0.15;
    c.armLS = 0.35; c.armRS = 0.35;
    c.legLS = s * 0.45 + 0.4; c.legRS = -s * 0.45 + 0.4;
    c.shinL = 0.6; c.shinR = 0.6;
  },
  climb(c, t) {
    const s = Math.sin(t * TAU * 0.9);
    c.armLS = 1.9 + s * 0.6; c.armRS = 1.9 - s * 0.6;
    c.armLL = 0.22; c.armRL = 0.22;
    c.legLS = s * 0.5; c.legRS = -s * 0.5;
    c.shinL = Math.max(0, -s) * 0.7; c.shinR = Math.max(0, s) * 0.7;
  },
  dance(c, t) {
    const s = Math.sin(t * TAU * 0.9), s2 = Math.sin(t * TAU * 1.8);
    c.armLS = 1.4 + s * 0.5; c.armRS = 1.4 - s * 0.5;
    c.armLL = 0.5 + s2 * 0.25; c.armRL = 0.5 - s2 * 0.25;
    c.legLS = s * 0.28; c.legRS = -s * 0.28;
    c.spine = s2 * 0.09;
    c.bob = Math.abs(s2) * 0.05;
  },
  death(c) {
    c.rootPitch = 1.5;
    c.armLS = -0.5; c.armRS = -0.5; c.armLL = 0.8; c.armRL = 0.8;
    c.legLS = -0.15; c.legRS = 0.15;
  },
};

// ---- animation packs ----
// A pack replaces individual poses. Anything it does not define falls through
// to the default set, so a pack can be one jump or a whole style, and every
// pack works on every body because they all speak the same canonical channels.
export const PACKS = {
  none: {},

  // "Girl Jump": knees snap forward and tuck toward the chest so the legs read
  // as a sideways V, while both arms are thrown straight overhead. The arms
  // coming back down on landing is not scripted — leaving the jump pose does it.
  girljump: {
    jump(c) {
      c.armLS = 2.55; c.armRS = 2.55;          // straight up
      c.armLL = 0.14; c.armRL = 0.14;
      c.legLS = 1.25; c.legRS = 1.05;          // thighs forward, slightly split
      c.shinL = 1.55; c.shinR = 1.35;          // heels tucked back to the body
      c.spine = -0.16;
    },
    fall(c, t) {
      const w = Math.sin(t * 7) * 0.1;
      c.armLS = 2.2 + w; c.armRS = 2.2 - w;
      c.armLL = 0.3; c.armRL = 0.3;
      c.legLS = 0.95; c.legRS = 0.8;
      c.shinL = 1.2; c.shinR = 1.05;
    },
  },

  // "Steven": Minecraft. Rigid limbs swinging in straight lines, a dead-still
  // idle, and no lean — the whole charm is that nothing bends.
  steven: {
    idle(c) {
      c.armLS = 0; c.armRS = 0; c.armLL = 0.02; c.armRL = 0.02;
      c.legLS = 0; c.legRS = 0;
    },
    walk(c, t) {
      const s = Math.sin(t * TAU);
      c.legLS = s * 0.72; c.legRS = -s * 0.72;
      c.armLS = -s * 0.72; c.armRS = s * 0.72;
      c.armLL = 0.05; c.armRL = 0.05;
      c.shinL = 0; c.shinR = 0;                // no knees in Minecraft
    },
    run(c, t) {
      const s = Math.sin(t * TAU);
      c.legLS = s * 0.95; c.legRS = -s * 0.95;
      c.armLS = -s * 0.95; c.armRS = s * 0.95;
      c.armLL = 0.07; c.armRL = 0.07;
      c.spine = 0.08;
    },
    jump(c) { c.legLS = 0.5; c.legRS = -0.3; c.armLS = -0.35; c.armRS = -0.35; c.armLL = 0.1; c.armRL = 0.1; },
    fall(c) { c.legLS = 0.35; c.legRS = -0.25; c.armLS = -0.5; c.armRS = -0.5; c.armLL = 0.16; c.armRL = 0.16; },
    // the flat-armed sprint-swim Minecraft does
    swim(c, t) {
      const s = Math.sin(t * TAU * 1.1);
      c.rootPitch = 1.4;
      c.armLS = s * 1.6 + 0.9; c.armRS = -s * 1.6 + 0.9;
      c.legLS = s * 0.35; c.legRS = -s * 0.35;
    },
    sit(c) { c.legLS = 1.5; c.legRS = 1.5; c.armLS = -0.2; c.armRS = -0.2; },
  },
};

// Poses that hold rather than cycle, so their phase must not advance.
export const STATIC = new Set(['jump', 'sit', 'death']);

// Motions that do not exist on their own get the closest one that does.
const ALIAS = {
  fly: 'fall', lie: 'sit', drive: 'sit', sitchair: 'sit', dead: 'death',
  spray: 'idle', roast: 'idle', eat: 'idle',
  rifleidle: 'idle', pistolidle: 'idle', knifeidle: 'idle',
  riflerun: 'run', pistolrun: 'run',
  riflefire: 'idle', knifestab: 'idle',
};
export const resolvePose = (name) => (POSES[name] ? name : (POSES[ALIAS[name]] ? ALIAS[name] : 'idle'));

/**
 * Build an animator over a resolved bone map.
 *   bones   - { boneName: THREE.Bone } as collected from the model
 *   rigName - 'boy' | 'girl'
 *   THREE   - the three.js namespace (passed in so this module stays portable)
 */
export function makeAnimator(THREE, bones, rigName, packName = 'none') {
  const rig = RIGS[rigName] || RIGS.boy;
  let pack = PACKS[packName] || PACKS.none;
  let custom = null;
  const joint = {}, rest = {};
  for (const [canon, boneName] of Object.entries(rig.joints)) {
    const b = bones[boneName];
    if (!b) continue;
    joint[canon] = b;
    rest[canon] = b.quaternion.clone();
  }
  // Some rigs are authored with limbs splayed. Rather than hunting for a magic
  // offset, solve for the rest pose directly: find the rotation that takes the
  // limb's current world direction onto straight-down, and fold it into rest.
  // Everything the poses do then stacks on a sane neutral.
  for (const canon of (rig.normalizeRest || [])) {
    const b = joint[canon];
    if (!b) continue;
    const child = b.children.find((ch) => ch.isBone);
    if (!child) continue;
    b.updateWorldMatrix(true, false);
    const parentQ = new THREE.Quaternion();
    (b.parent || b).getWorldQuaternion(parentQ);
    const worldQ = new THREE.Quaternion();
    b.getWorldQuaternion(worldQ);
    const dir = child.position.clone().applyQuaternion(worldQ).normalize();
    if (!isFinite(dir.x) || dir.lengthSq() < 1e-6) continue;
    const fix = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, -1, 0));
    // move the world-space correction into the bone's local frame
    const inv = parentQ.clone().invert();
    const local = inv.multiply(fix).multiply(parentQ).multiply(rest[canon]);
    rest[canon].copy(local);
  }

  // ---- corrected rotation axes ----
  // The `swing`/`lift` tables above name the best CARDINAL axis (x, y or z) for
  // each rig. Best is not right: a shoulder's rest orientation is not aligned to
  // the world, so the nearest cardinal axis leaves a residue — on the boy rig a
  // pure forward arm swing also dragged the hand 43% of that distance inward.
  //
  // The axis that swings a limb purely forward is the world left-right axis,
  // written in the frame the rotation actually acts in (parent world x rest).
  // Deriving it per bone removes the cross-body drift on every rig at once, and
  // it is the same reasoning normalizeRest already uses for R6's shoulders.
  const AX_SWING = new THREE.Vector3(1, 0, 0);   // rotate about world right -> forward/back
  const AX_LIFT = new THREE.Vector3(0, 0, 1);    // rotate about world forward -> out to the side
  //
  // The derived axis is a line, not a direction: +a and -a describe the same
  // rotation axis but opposite senses. Point each one the same way the cardinal
  // axis it replaces pointed, so every existing pose keeps the direction it was
  // authored with and only loses the sideways residue.
  const CARD = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  const SWING_KEY = {
    armL: 'arm', armR: 'arm', foreL: 'fore', foreR: 'fore',
    legL: 'leg', legR: 'leg', shinL: 'shin', shinR: 'shin',
    footL: 'foot', footR: 'foot', spine: 'spine', chest: 'spine',
    hips: 'spine', neck: 'head', head: 'head',
  };
  const axisOf = {};
  {
    const pq = new THREE.Quaternion(), inv = new THREE.Quaternion();
    for (const canon of Object.keys(joint)) {
      const b = joint[canon];
      b.updateWorldMatrix(true, false);
      (b.parent || b).getWorldQuaternion(pq);
      inv.copy(pq).multiply(rest[canon]).invert();
      const swing = AX_SWING.clone().applyQuaternion(inv).normalize();
      const lift = AX_LIFT.clone().applyQuaternion(inv).normalize();
      const swingCard = CARD[(rig.swing || {})[SWING_KEY[canon]] || 'x'];
      const liftCard = CARD[(rig.lift || {}).arm || 'x'];
      if (swing.dot(swingCard) < 0) swing.negate();
      if (lift.dot(liftCard) < 0) lift.negate();
      axisOf[canon] = { swing, lift };
    }
  }

  const e = new THREE.Euler(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  // Apply a rotation on top of the bind pose. Everything is relative to rest,
  // so a joint we never touch keeps exactly the shape the artist gave it.
  const apply = (canon, axis, amount, axis2, amount2) => {
    const b = joint[canon]; if (!b) return;
    const ax = axisOf[canon];
    q.setFromAxisAngle(ax.swing, amount || 0);
    if (amount2) { q2.setFromAxisAngle(ax.lift, amount2); q.multiply(q2); }
    b.quaternion.copy(rest[canon]).multiply(q);
  };

  let pose = 'idle', phase = 0, speed = 0;
  const c = ch();
  return {
    setAnim(name) { const p = resolvePose(name); if (p !== pose) { pose = p; if (STATIC.has(p)) phase = 0; } },
    get pose() { return pose; },
    setSpeed(v) { speed = v; },
    setPack(name) { pack = PACKS[name] || PACKS.none; },
    // An authored set arrives as a plain map of pose -> function, built by
    // shared/anim/custom.js. It layers on top of whatever built-in pack is
    // selected, so a set can replace one clip and leave the rest alone.
    setCustomPack(obj) { custom = obj && typeof obj === 'object' ? obj : null; },
    // Drive the phase directly. The animator normally advances on its own
    // clock; an editor needs to put it at an exact time so the viewport and the
    // playhead can never disagree.
    setPhase(t) { phase = t; },
    get phase() { return phase; },
    update(dt) {
      // Cycle rate follows how fast the body is actually travelling, so a walk
      // does not scrub at a fixed rate regardless of speed.
      const rate = pose === 'run' ? Math.max(1.4, 0.42 + speed * 0.115)
                 : pose === 'walk' ? Math.max(0.85, 0.3 + speed * 0.115)
                 : 1;
      if (!STATIC.has(pose)) phase += dt * rate;
      for (const k in c) c[k] = 0;
      // a pack's pose wins; anything it leaves out falls through to the default
      ((custom && custom[pose]) || pack[pose] || POSES[pose] || POSES.idle)(c, phase);

      if (rig.rigid) {
        // One-piece limbs: there is no knee to bend, so give the thigh a share
        // of what the knee would have done rather than losing that motion.
        c.legLS += c.shinL * 0.45; c.legRS += c.shinR * 0.45;
        c.shinL = c.shinR = c.footL = c.footR = 0;
      } else {
        // The thigh and knee rotations compound down the leg, so without an
        // ankle that gives most of it back the foot ends up pointing behind the
        // character at the top of a stride. Real animation keeps the sole flat;
        // this approximates that rather than authoring a foot curve per pose.
        c.footL = -(c.legLS + c.shinL) * 0.85;
        c.footR = -(c.legRS + c.shinR) * 0.85;
      }

      const S = rig.sign, SW = rig.swing, LF = rig.lift;
      apply('armL', SW.arm, c.armLS * S.armL, LF.arm, c.armLL * LF.armL);
      apply('armR', SW.arm, c.armRS * S.armR, LF.arm, c.armRL * LF.armR);
      apply('foreL', SW.fore, c.foreL * S.foreL);
      apply('foreR', SW.fore, c.foreR * S.foreR);
      apply('legL', SW.leg, c.legLS * S.legL);
      apply('legR', SW.leg, c.legRS * S.legR);
      apply('shinL', SW.shin, c.shinL * S.shinL);
      apply('shinR', SW.shin, c.shinR * S.shinR);
      apply('footL', SW.foot, c.footL * S.footL);
      apply('footR', SW.foot, c.footR * S.footR);
      apply('spine', SW.spine, c.spine * S.spine);
      if (joint.head !== joint.spine) apply('head', SW.head, c.head * S.head);
      return c;      // the caller applies bob / rootPitch to the model root
    },
  };
}
