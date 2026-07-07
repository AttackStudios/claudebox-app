// The delivery moped: a detailed little scooter with a food box on the
// back, and a light ride model derived from Backpacking's van sim —
// same slope pitch/roll conventions, plus a lean into the steering.

import * as THREE from 'three';
import { groundAt, roadInfo } from '/shared/rs2/world.js';
import { steel } from '../textures.js';

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

export function buildMopedMesh(color = '#e8902a') {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';

  // deck + floorboard
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 1.0), lambert('#2e3138'));
  deck.position.y = 0.42;
  // body fairing (curved seat support)
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 6, 12), lambert(color, { map: steel() }));
  body.rotation.x = Math.PI / 2 - 0.5;
  body.position.set(0, 0.62, -0.32);
  // seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.5), lambert('#2a2a2e'));
  seat.position.set(0, 0.88, -0.3);
  // steering column + handlebars
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.75, 8), lambert(color, { map: steel() }));
  column.rotation.x = -0.35;
  column.position.set(0, 0.78, 0.48);
  const handlePivot = new THREE.Group();
  handlePivot.position.set(0, 1.1, 0.36);
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 8), lambert('#2e3138'));
  bars.rotation.z = Math.PI / 2;
  handlePivot.add(bars);
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 8), lambert('#4a4a50'));
    grip.rotation.z = Math.PI / 2;
    grip.position.x = side * 0.3;
    handlePivot.add(grip);
  }
  const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff6cc' }));
  headlight.position.set(0, 1.0, 0.52);
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14);
  const wheels = [];
  for (const wz of [0.62, -0.55]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.26, wz);
    const wheel = new THREE.Mesh(wheelGeo, lambert('#1d1d1f'));
    wheel.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 10), lambert('#c8ccd0'));
    hub.rotation.z = Math.PI / 2;
    pivot.add(wheel, hub);
    g.add(pivot);
    wheels.push({ pivot, wheel, front: wz > 0 });
  }
  // fenders
  for (const wz of [0.62, -0.55]) {
    const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 12, 1, false, Math.PI, Math.PI), lambert(color, { map: steel() }));
    fender.rotation.z = Math.PI / 2;
    fender.rotation.y = Math.PI / 2;
    fender.position.set(0, 0.34, wz);
    g.add(fender);
  }
  // delivery box on a rack
  const rack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.4), lambert('#4a4a50'));
  rack.position.set(0, 0.82, -0.62);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.44), lambert('#c0564a'));
  box.position.set(0, 1.05, -0.62);
  const boxLid = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.48), lambert('#9a4438'));
  boxLid.position.set(0, 1.27, -0.62);
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial({ color: '#ffe9b8' }));
  logo.position.set(0, 1.05, -0.39);
  // kickstand
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), lambert('#4a4a50'));
  stand.rotation.z = 0.4;
  stand.position.set(0.12, 0.18, -0.3);

  g.add(deck, body, seat, column, handlePivot, headlight, rack, box, boxLid, logo, stand);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, wheels, handlePivot };
}

// light ride sim — Backpacking VanSim conventions (corrected slope signs)
export class MopedSim {
  constructor(x, z, ry) {
    this.x = x; this.z = z; this.y = groundAt(x, z);
    this.ry = ry;
    this.speed = 0;
    this.pitch = 0; this.roll = 0;
    this.steerVis = 0;
  }

  update(dt, input) {
    const ri = roadInfo(this.x, this.z);
    const onRoad = ri.dist < ri.width * 0.7;
    const grip = onRoad ? 1 : 0.7;
    const maxFwd = onRoad ? 17 : 11;

    if (input.throttle) this.speed += 9 * grip * dt;
    if (input.brake) this.speed -= (this.speed > 0.4 ? 16 : 4) * dt;
    this.speed -= this.speed * 0.5 * dt;
    if (!input.throttle && !input.brake && Math.abs(this.speed) < 0.3) this.speed = 0;
    this.speed = Math.max(-4, Math.min(maxFwd, this.speed));

    const steerAuthority = 2.2 / (1 + Math.abs(this.speed) * 0.07);
    if (Math.abs(this.speed) > 0.3) {
      this.ry -= input.steer * steerAuthority * dt * Math.sign(this.speed);
    }
    this.steerVis += (input.steer * 0.5 - this.steerVis) * Math.min(1, dt * 8);

    this.x += Math.sin(this.ry) * this.speed * dt;
    this.z += Math.cos(this.ry) * this.speed * dt;

    const g = groundAt(this.x, this.z);
    this.y += (g - this.y) * Math.min(1, dt * 10);

    const ahead = groundAt(this.x + Math.sin(this.ry) * 1.4, this.z + Math.cos(this.ry) * 1.4);
    const behind = groundAt(this.x - Math.sin(this.ry) * 1.4, this.z - Math.cos(this.ry) * 1.4);
    // uphill = nose up (Backpacking-corrected sign), plus lean into the turn
    const targetPitch = -Math.atan2(ahead - behind, 2.8);
    const lean = this.steerVis * Math.min(1, Math.abs(this.speed) / 10) * 0.5;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 7);
    this.roll += (lean - this.roll) * Math.min(1, dt * 7);
  }
}
