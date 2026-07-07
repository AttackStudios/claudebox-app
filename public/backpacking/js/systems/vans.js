// Camper vans: retro-bus meshes with six seat anchors, headlights, and a
// momentum-heavy driving model the driver's client simulates and streams.

import * as THREE from 'three';
import { groundAt, waterAt, roadInfo } from '/shared/bp/worldgen.js';
import { metalVan } from '../textures.js';

const VAN_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#d35400', '#8e44ad', '#16a085', '#c2761d', '#7f8c8d'];

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

// seat anchor positions in van-local space (x right, z forward)
export const SEATS = [
  { x: -0.62, y: 1.05, z: 1.35 },  // 0: driver (front-left)
  { x: 0.62, y: 1.05, z: 1.35 },   // 1: front passenger
  { x: -0.62, y: 1.05, z: 0.1 },   // 2-3: middle bench
  { x: 0.62, y: 1.05, z: 0.1 },
  { x: -0.62, y: 1.05, z: -1.15 }, // 4-5: rear bench
  { x: 0.62, y: 1.05, z: -1.15 },
];

export function buildVanMesh(index, sky) {
  const color = VAN_COLORS[index % VAN_COLORS.length];
  const g = new THREE.Group();
  const tex = metalVan();

  // body: lower colored shell + white upper + rounded front
  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.0, 5.0), lambert(color, { map: tex }));
  lower.position.y = 0.95;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.95, 5.0), lambert('#f2f0ea', { map: tex }));
  upper.position.y = 1.93;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 4.85), lambert('#f2f0ea', { map: tex }));
  roof.position.y = 2.5;
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 2.05, 14, 1, false, 0, Math.PI), lambert(color, { map: tex }));
  nose.rotation.z = Math.PI / 2;
  nose.position.set(0, 1.05, 2.5);
  nose.scale.set(0.45, 1, 1);
  g.add(lower, upper, roof, nose);

  // windows: windshield + sides
  const glass = lambert('#3b5566', { transparent: true, opacity: 0.85 });
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.75, 0.06), glass);
  windshield.position.set(0, 1.95, 2.49);
  g.add(windshield);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 1.15), glass);
      win.position.set(side * 1.06, 1.95, 1.25 - i * 1.4);
      g.add(win);
    }
  }

  // V-stripe on the nose + bumper + mirrors
  const stripeShape = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.0, 3), lambert('#f2f0ea'));
  stripeShape.rotation.x = Math.PI / 2;
  stripeShape.rotation.z = Math.PI;
  stripeShape.scale.z = 0.12;
  stripeShape.position.set(0, 1.25, 2.58);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.25), lambert('#c9c9c9'));
  bumper.position.set(0, 0.5, 2.55);
  const bumperR = bumper.clone();
  bumperR.position.z = -2.55;
  g.add(stripeShape, bumper, bumperR);

  // wheels (front pair steers, all spin)
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
  const wheelMat = lambert('#1d1d1f');
  const hubMat = lambert('#d8d8d8');
  const wheels = [];
  for (const [wx, wz, front] of [[-1.0, 1.7, true], [1.0, 1.7, true], [-1.0, -1.6, false], [1.0, -1.6, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.42, wz);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 10), hubMat);
    hub.rotation.z = Math.PI / 2;
    pivot.add(wheel, hub);
    g.add(pivot);
    wheels.push({ pivot, wheel, hub, front });
  }

  // headlights + taillights
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff6cc' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#992222' });
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.CircleGeometry(0.16, 10), headMat);
    hl.position.set(side * 0.65, 1.15, 2.62);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.05), tailMat);
    tl.position.set(side * 0.8, 1.0, -2.53);
    g.add(hl, tl);
  }
  // headlight lamp (sky budget decides if it's a real light; on at night)
  const lamp = sky.addLamp({ x: 0, y: 0, z: 0, color: '#fff2bb', intensity: 2.2, range: 26, flicker: 0, on: false });

  // interior: benches + steering wheel
  const benchMat = lambert('#7a5a40');
  for (const bz of [1.35, 0.1, -1.15]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 0.85), benchMat);
    bench.position.set(0, 0.78, bz - 0.1);
    g.add(bench);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.12), benchMat);
    back.position.set(0, 1.1, bz - 0.5);
    g.add(back);
  }
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 16), lambert('#2b2b2e'));
  wheelRim.position.set(-0.62, 1.45, 1.95);
  wheelRim.rotation.x = -0.5;
  g.add(wheelRim);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, wheels, lamp, color };
}

// ---------------- driving model (heavier sim feel) ----------------
export class VanSim {
  constructor(van) {
    this.id = van.id;
    this.x = van.x; this.y = van.y; this.z = van.z;
    this.ry = van.ry;
    this.speed = van.speed || 0;   // signed, +forward
    this.pitch = 0; this.roll = 0;
    this.tipped = false;
    this.steerVis = 0;
  }

  update(dt, input) {
    const onRoadHere = roadInfo(this.x, this.z).dist < roadInfo(this.x, this.z).width * 0.62;
    const grip = onRoadHere ? 1 : 0.55;
    const maxFwd = onRoadHere ? 21 : 13;

    // throttle / brake / reverse
    const accel = 7.5 * grip;
    if (input.throttle) this.speed += accel * dt;
    if (input.brake) {
      if (this.speed > 0.5) this.speed -= 14 * dt;        // real braking distance
      else this.speed -= 4.5 * dt;                         // reverse
    }
    // engine drag + rolling resistance
    this.speed -= this.speed * 0.35 * dt;
    if (!input.throttle && !input.brake && Math.abs(this.speed) < 0.4) this.speed = 0;

    // slope: gravity component along the heading (downhill speeds you up)
    const ahead = groundAt(this.x + Math.sin(this.ry) * 2.5, this.z + Math.cos(this.ry) * 2.5);
    const behind = groundAt(this.x - Math.sin(this.ry) * 2.5, this.z - Math.cos(this.ry) * 2.5);
    const slope = (ahead - behind) / 5; // + = uphill ahead
    this.speed -= slope * 9.5 * dt * Math.sign(this.speed || 1);

    this.speed = Math.max(-6, Math.min(maxFwd, this.speed));

    // steering: speed-sensitive; handbrake loosens the rear
    const steerAuthority = 1.6 / (1 + Math.abs(this.speed) * 0.09);
    const handbrakeBoost = input.handbrake && Math.abs(this.speed) > 4 ? 1.9 : 1;
    if (Math.abs(this.speed) > 0.3) {
      this.ry -= input.steer * steerAuthority * handbrakeBoost * dt * Math.sign(this.speed) * grip;
    }
    if (input.handbrake) this.speed -= this.speed * 1.1 * dt;
    this.steerVis += (input.steer * 0.45 - this.steerVis) * Math.min(1, dt * 8);

    // integrate
    this.x += Math.sin(this.ry) * this.speed * dt;
    this.z += Math.cos(this.ry) * this.speed * dt;

    // vans don't swim — soft wall at water's edge
    if (waterAt(this.x, this.z)) {
      this.x -= Math.sin(this.ry) * this.speed * dt * 1.5;
      this.z -= Math.cos(this.ry) * this.speed * dt * 1.5;
      this.speed *= -0.25;
    }

    // ground follow + body attitude from the terrain
    const g = groundAt(this.x, this.z);
    this.y += (g - this.y) * Math.min(1, dt * 9);

    const right = groundAt(this.x + Math.cos(this.ry) * 1.1, this.z - Math.sin(this.ry) * 1.1);
    const left = groundAt(this.x - Math.cos(this.ry) * 1.1, this.z + Math.sin(this.ry) * 1.1);
    // uphill (ahead higher) tilts the nose UP; downhill tilts it down
    const targetPitch = -Math.atan2(ahead - behind, 5);
    const targetRoll = -Math.atan2(left - right, 2.2) + this.steerVis * Math.min(1, Math.abs(this.speed) / 14) * 0.25;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 6);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);

    // tip-over on extreme attitude
    this.tipped = Math.abs(this.roll) > 0.9 || Math.abs(this.pitch) > 1.0;
  }
}

export { VAN_COLORS };
