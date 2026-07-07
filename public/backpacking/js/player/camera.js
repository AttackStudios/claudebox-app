// Third-person orbit camera (Feather Friends pattern): drag/pointer-lock to
// rotate, scroll/pinch to zoom, never dips under the terrain.

import { groundAt } from '/shared/bp/worldgen.js';

export class OrbitCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = 0.32;
    this.dist = 7;
    this.minDist = 2.2;
    this.maxDist = 26;
    this.sensitivity = 1;
    this.invertY = false;
    this.target = { x: 0, y: 2, z: 0 };
  }

  rotate(dx, dy) {
    const s = 0.0042 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch += dy * s * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-0.5, Math.min(1.35, this.pitch));
  }

  zoom(delta) {
    this.dist *= 1 + delta * 0.0014;
    this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist));
  }

  update(dt, followPos, headH = 1.6) {
    const wanted = { x: followPos.x, y: followPos.y + headH, z: followPos.z };
    const k = Math.min(1, dt * 10);
    this.target.x += (wanted.x - this.target.x) * k;
    this.target.y += (wanted.y - this.target.y) * k;
    this.target.z += (wanted.z - this.target.z) * k;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let cx = this.target.x + Math.sin(this.yaw) * cp * this.dist;
    let cy = this.target.y + sp * this.dist;
    let cz = this.target.z + Math.cos(this.yaw) * cp * this.dist;

    const groundY = groundAt(cx, cz) + 0.5;
    if (cy < groundY) cy = groundY;

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
  }
}
