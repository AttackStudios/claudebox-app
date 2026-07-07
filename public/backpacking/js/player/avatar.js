// The player IS their ClaudeBox avatar. This module is now a thin compatibility
// shim over the shared 3D avatar system (avatar3d.js — real rigged GLB models
// with skeletal animation + clothing). Games keep calling buildPlayerAvatar /
// animatePlayer / makePlayerAnimState exactly as before; the work is delegated.

import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';

// Returns { name, avatar } or redirects to the hub for login. Also preloads the
// avatar GLBs so the (synchronous) buildPlayerAvatar can run immediately after.
export async function loadIdentity() {
  const name = localStorage.getItem('claudebox.user');
  if (!name) { location.href = '/'; return new Promise(() => {}); }
  try {
    const res = await fetch('/api/avatar/' + encodeURIComponent(name));
    if (!res.ok) throw new Error('no profile');
    const data = await res.json();
    await preloadAvatars(['boy', 'girl']);
    return { name: data.name, avatar: data.avatar };
  } catch {
    location.href = '/';
    return new Promise(() => {});
  }
}

export async function ensureAvatars() { await preloadAvatars(['boy', 'girl']); }

// An Object3D fixed to a bone, unscaled so world-unit children (held items)
// render at the right size and ride the animated hand/head.
function holderOn(bone) {
  const h = new THREE.Object3D();
  if (!bone) return h;
  bone.updateWorldMatrix(true, false);
  const s = new THREE.Vector3().setFromMatrixScale(bone.matrixWorld);
  h.scale.set(1 / (s.x || 1), 1 / (s.y || 1), 1 / (s.z || 1));
  bone.add(h);
  return h;
}

// buildPlayerAvatar(profile) → { group, parts }. `parts` keeps the old pivot
// names games attach to (armR/armL for held items, head), backed by bones, plus
// a hidden reference to the avatar3d controller for animation.
export function buildPlayerAvatar(avatarParams) {
  const ctrl = makeAvatar(avatarParams || {});
  const b = ctrl.bones;
  const pick = (...names) => { for (const n of names) if (b[n]) return b[n]; return null; };
  const parts = {
    __ctrl: ctrl,
    armR: holderOn(pick('R_Wrist', 'mixamorigRightHand', 'mixamorigRightForeArm')),
    armL: holderOn(pick('L_Wrist', 'mixamorigLeftHand', 'mixamorigLeftForeArm')),
    head: holderOn(pick('Neck', 'mixamorigHead')),
    // legacy pivots some code may still touch — harmless detached nodes
    legL: new THREE.Object3D(), legR: new THREE.Object3D(),
    torso: new THREE.Object3D(), tail: new THREE.Object3D(),
  };
  return { group: ctrl.group, parts };
}

export function makePlayerAnimState() {
  return { anim: 'idle', speed: 0 };
}

// Drives the avatar's animation from the game's anim string. Returns 0 (the old
// vertical-bob offset) since the GLB clips carry their own motion.
export function animatePlayer(parts, st, dt) {
  const ctrl = parts && parts.__ctrl;
  if (ctrl) { ctrl.setAnim(st.anim || 'idle'); ctrl.moveSpeed = st.speed || 0; ctrl.update(dt); }
  return 0;
}

// Death ragdoll: detach the avatar's top-level pieces and tumble them. With the
// GLB model the group holds a single skinned mesh, so it tumbles as one piece.
export function makeRagdoll(scene, avatarGroup, position, ry) {
  const parts = [];
  const pieces = [...avatarGroup.children];
  for (const piece of pieces) {
    avatarGroup.remove(piece);
    scene.add(piece);
    piece.position.add(position);
    piece.rotation.y += ry;
    parts.push({
      mesh: piece,
      vel: { x: (Math.random() - 0.5) * 6, y: 2.5 + Math.random() * 4, z: (Math.random() - 0.5) * 6 },
      spin: { x: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
      groundY: position.y + 0.15 + Math.random() * 0.2,
    });
  }
  return {
    update(dt) {
      for (const p of parts) {
        p.vel.y -= 22 * dt;
        p.mesh.position.x += p.vel.x * dt;
        p.mesh.position.y += p.vel.y * dt;
        p.mesh.position.z += p.vel.z * dt;
        if (p.mesh.position.y <= p.groundY) {
          p.mesh.position.y = p.groundY;
          p.vel.y *= -0.25; p.vel.x *= 0.6; p.vel.z *= 0.6;
          p.spin.x *= 0.5; p.spin.z *= 0.5;
        }
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.z += p.spin.z * dt;
      }
    },
    dispose() { for (const p of parts) scene.remove(p.mesh); },
  };
}
