// Viewport gizmos: the RGB rings and arrows you actually grab.
//
// These are built by hand rather than pulled from three's TransformControls,
// because a stock gizmo hands back a free quaternion and this rig does not want
// one. Every joint here rotates about a SINGLE named axis per channel (the axis
// differs per rig — see RIGS in shared/anim/humanoid.js), so the gizmo only
// ever offers the axes that map to a real channel. Dragging a ring that could
// not be saved would be a lie.

import { RIGS } from '/shared/anim/humanoid.js';

export const AXIS_COLOR = { x: 0xff4d5e, y: 0x4de07f, z: 0x4d8bff };

// Which channels each joint owns, and which entry in the rig's axis tables
// tells us the local axis to spin about.
const JOINTS = {
  head:  { label: 'Head',       rot: [['head',  'head']] },
  spine: { label: 'Torso',      rot: [['spine', 'spine']] },
  armL:  { label: 'Left arm',   rot: [['armLS', 'arm'], ['armLL', 'lift']] },
  armR:  { label: 'Right arm',  rot: [['armRS', 'arm'], ['armRL', 'lift']] },
  foreL: { label: 'Left forearm',  rot: [['foreL', 'fore']] },
  foreR: { label: 'Right forearm', rot: [['foreR', 'fore']] },
  legL:  { label: 'Left leg',   rot: [['legLS', 'leg']] },
  legR:  { label: 'Right leg',  rot: [['legRS', 'leg']] },
  shinL: { label: 'Left knee',  rot: [['shinL', 'shin']] },
  shinR: { label: 'Right knee', rot: [['shinR', 'shin']] },
  footL: { label: 'Left ankle', rot: [['footL', 'foot']] },
  footR: { label: 'Right ankle',rot: [['footR', 'foot']] },
};

/** The joints a rig actually has, with the live axis/sign for each channel. */
export function jointsFor(rigName) {
  const rig = RIGS[rigName] || RIGS.boy;
  const out = {};
  for (const [canon, def] of Object.entries(JOINTS)) {
    const rot = [];
    for (const [channel, kind] of def.rot) {
      // `lift` lives in its own table and is per-side; everything else is a
      // straight lookup in `swing`. A sign of 0 means the rig disables it.
      const axis = kind === 'lift' ? rig.lift?.arm : rig.swing?.[kind];
      const sign = kind === 'lift'
        ? (channel === 'armLL' ? rig.lift?.armL : rig.lift?.armR)
        : rig.sign?.[canon] ?? 1;
      if (!axis || !sign) continue;
      rot.push({ channel, axis, sign });
    }
    if (!rot.length) continue;
    // rigid rigs fold the knee into the thigh, so a knee gizmo would do nothing
    if (rig.rigid && ['shinL', 'shinR', 'footL', 'footR', 'foreL', 'foreR'].includes(canon)) continue;
    out[canon] = { label: def.label, bone: rig.joints[canon], rot };
  }
  // The root is not a bone — it is the model transform, and it carries the
  // channels that no joint can: the body's own slide and lean.
  out.root = {
    label: 'Body (root)', bone: null,
    rot: [{ channel: 'rootPitch', axis: 'x', sign: 1 }],
    move: [{ channel: 'rootX', axis: 'x' }, { channel: 'bob', axis: 'y' }, { channel: 'rootZ', axis: 'z' }],
  };
  return out;
}

const ringGeom = (THREE, r) => new THREE.TorusGeometry(r, r * 0.042, 8, 96);

function orient(mesh, axis, THREE) {
  // a torus is born in the XY plane (its axis is +Z)
  if (axis === 'x') mesh.rotation.y = Math.PI / 2;
  else if (axis === 'y') mesh.rotation.x = Math.PI / 2;
}

/**
 * Builds the gizmo group. `handles` is what the raycaster tests against; each
 * handle carries the channel it drives so a drag needs no lookup table.
 */
export function makeGizmo(THREE) {
  const group = new THREE.Group();
  group.renderOrder = 999;
  const handles = [];
  const mat = (color, opacity = 1) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false,
  });

  const clear = () => {
    for (const h of handles) { h.geometry.dispose(); h.material.dispose(); }
    handles.length = 0;
    group.clear();
  };

  /** Rebuild for a joint, in either 'rotate' or 'move' mode. */
  const build = (joint, mode, scale) => {
    clear();
    if (!joint) return handles;
    const R = scale;
    if (mode === 'rotate') {
      // a faint outer sphere-ish ring, purely so the gizmo reads as a ball
      const shell = new THREE.Mesh(ringGeom(THREE, R * 1.18), mat(0x8899aa, 0.22));
      shell.rotation.x = Math.PI / 2;
      group.add(shell);
      for (const r of joint.rot) {
        const m = new THREE.Mesh(ringGeom(THREE, R), mat(AXIS_COLOR[r.axis]));
        orient(m, r.axis, THREE);
        group.add(m);
        // A drawn ring is a couple of pixels thick — precise to look at and
        // miserable to grab. The thing the raycaster actually tests is a fat
        // invisible torus on the same path.
        const pick = new THREE.Mesh(
          new THREE.TorusGeometry(R, R * 0.16, 6, 40),
          new THREE.MeshBasicMaterial({ visible: false }));
        orient(pick, r.axis, THREE);
        pick.userData = { kind: 'rotate', ...r };
        group.add(pick); handles.push(pick);
      }
    } else {
      for (const mv of (joint.move || [])) {
        const dir = new THREE.Vector3(mv.axis === 'x' ? 1 : 0, mv.axis === 'y' ? 1 : 0, mv.axis === 'z' ? 1 : 0);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.022, R * 0.022, R * 1.5, 8), mat(AXIS_COLOR[mv.axis]));
        const head = new THREE.Mesh(new THREE.ConeGeometry(R * 0.09, R * 0.3, 12), mat(AXIS_COLOR[mv.axis]));
        // cylinders and cones are born pointing +Y
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        shaft.quaternion.copy(q); head.quaternion.copy(q);
        shaft.position.copy(dir).multiplyScalar(R * 0.75);
        head.position.copy(dir).multiplyScalar(R * 1.65);
        group.add(shaft, head);
        const pick = new THREE.Mesh(
          new THREE.CylinderGeometry(R * 0.16, R * 0.16, R * 2, 8),
          new THREE.MeshBasicMaterial({ visible: false }));
        pick.quaternion.copy(q);
        pick.position.copy(dir).multiplyScalar(R);
        pick.userData = { kind: 'move', ...mv, dir };
        group.add(pick); handles.push(pick);
      }
    }
    return handles;
  };

  /** A world point sitting on the given channel's handle — used by tests. */
  const pointOn = (channel, THREE2 = THREE) => {
    const h = handles.find((x) => x.userData.channel === channel);
    if (!h) return null;
    group.updateMatrixWorld(true);
    const local = h.userData.kind === 'rotate'
      ? new THREE2.Vector3(h.geometry.parameters.radius, 0, 0)
      : new THREE2.Vector3(0, 0, 0);
    return h.localToWorld(local);
  };

  return { group, handles, build, clear, pointOn };
}
