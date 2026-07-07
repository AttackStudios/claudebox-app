// Procedural bears: a chunky quadruped with a swinging gait, rendered from
// the server's simulation via interpolation.

import * as THREE from 'three';

const lambert = (color) => new THREE.MeshLambertMaterial({ color });

const FUR = { brown: '#6b4a32', black: '#2e2a28' };
const FUR_LIGHT = { brown: '#82593c', black: '#3c3835' };

export function buildBearMesh(variant = 'brown') {
  const fur = lambert(FUR[variant] || FUR.brown);
  const furLight = lambert(FUR_LIGHT[variant] || FUR_LIGHT.brown);
  const g = new THREE.Group();
  const parts = {};

  // body
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.15, 6, 14), fur);
  body.rotation.x = Math.PI / 2;
  body.position.y = 1.0;
  g.add(body);

  // shoulder hump
  const hump = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), fur);
  hump.position.set(0, 1.4, 0.45);
  hump.scale.set(1.05, 0.8, 1);
  g.add(hump);

  // head
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.35, 1.15);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), fur);
  head.scale.set(1, 0.95, 1.05);
  const muzzle = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.18, 5, 10), furLight);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, -0.06, 0.34);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lambert('#1a1a1a'));
  nose.position.set(0, -0.02, 0.52);
  headPivot.add(head, muzzle, nose);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), fur);
    ear.position.set(side * 0.24, 0.3, -0.05);
    headPivot.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), lambert('#141414'));
    eye.position.set(side * 0.15, 0.08, 0.3);
    headPivot.add(eye);
  }
  g.add(headPivot);
  parts.head = headPivot;

  // legs
  const legGeo = new THREE.CapsuleGeometry(0.15, 0.55, 5, 10);
  const pawGeo = new THREE.SphereGeometry(0.17, 8, 6);
  parts.legs = [];
  for (const [lx, lz] of [[-0.4, 0.62], [0.4, 0.62], [-0.4, -0.62], [0.4, -0.62]]) {
    const hip = new THREE.Group();
    hip.position.set(lx, 0.85, lz);
    const leg = new THREE.Mesh(legGeo, fur);
    leg.position.y = -0.4;
    const paw = new THREE.Mesh(pawGeo, furLight);
    paw.position.y = -0.78;
    paw.scale.y = 0.6;
    hip.add(leg, paw);
    g.add(hip);
    parts.legs.push(hip);
  }

  // stubby tail
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), furLight);
  tail.position.set(0, 1.15, -1.0);
  g.add(tail);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, parts };
}

export function makeBearAnim() {
  return { t: Math.random() * 10 };
}

export function animateBear(parts, st, anim, dt) {
  const cadence = anim === 'run' ? 11 : anim === 'walk' ? 6 : 2;
  st.t += dt * cadence;
  const t = st.t;
  const amp = anim === 'run' ? 0.65 : anim === 'walk' ? 0.4 : 0.03;
  // diagonal gait: FL+BR vs FR+BL
  parts.legs[0].rotation.x = Math.sin(t) * amp;
  parts.legs[3].rotation.x = Math.sin(t) * amp;
  parts.legs[1].rotation.x = -Math.sin(t) * amp;
  parts.legs[2].rotation.x = -Math.sin(t) * amp;
  parts.head.rotation.x = anim === 'run' ? -0.1 : Math.sin(t * 0.5) * 0.08;
  parts.head.rotation.y = anim === 'idle' ? Math.sin(t * 0.8) * 0.3 : 0;
}
