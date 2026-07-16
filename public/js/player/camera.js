// Third-person free-look orbit camera. The mouse always orbits the camera
// around the bird — on the ground AND in the air — so flying feels exactly
// like looking around: you aim the camera where you want to go and the bird
// follows. In flight the pitch range opens up (climb/dive) and the FOV
// widens a little with airspeed for a sense of speed. Never dips below the
// terrain (sky-island/continent aware).

import { groundAt as height } from '/shared/worldgen.js';

export class OrbitCamera {
  constructor(camera) {
    this.camera = camera;
    this.baseFov = camera.fov;
    this.yaw = Math.PI;       // behind the bird, looking north
    this.pitch = 0.35;
    this.pitchMin = -0.55;
    this.pitchMax = 1.35;
    this.dist = 10;
    this.minDist = 0.3;   // all the way in = first-person (the bird fades out)
    this.maxDist = 40;
    this.curDist = this.dist;  // effective camera→bird distance this frame
    this.sensitivity = 1;
    this.invertY = false;
    this.target = { x: 0, y: 2, z: 0 };
    this.fov = camera.fov;
    this.camRoll = 0;   // smoothed horizon tilt that follows the bird's bank
  }

  rotate(dx, dy) {
    const s = 0.0042 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch += dy * s * (this.invertY ? -1 : 1);
    this.pitch = Math.max(this.pitchMin, Math.min(this.pitchMax, this.pitch));
  }

  zoom(delta) {
    this.dist *= 1 + delta * 0.0014;
    this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist));
  }

  // followPos: bird position. flight: { flying, airspeed } (optional) for FOV.
  update(dt, followPos, size = 1, headH = 1.4, flight = null) {
    const flying = !!flight?.flying;
    // open up the pitch range in flight so you can climb and dive steeply
    this.pitchMin = flying ? -1.4 : -0.55;
    this.pitchMax = flying ? 1.4 : 1.35;

    // how fast we're going, 0..1 (used for pull-back + FOV stretch)
    const speedT = flying ? Math.min(1, (flight.airspeed || 0) / 30) : 0;

    const wanted = { x: followPos.x, y: followPos.y + headH * size, z: followPos.z };
    // a touch of trailing lag in flight so the bird leads and the camera chases
    const followRate = flying ? 7 : 10;
    const k = Math.min(1, dt * followRate);
    this.target.x += (wanted.x - this.target.x) * k;
    this.target.y += (wanted.y - this.target.y) * k;
    this.target.z += (wanted.z - this.target.z) * k;

    // camera eases further back the faster you fly — pure sense of speed
    const d = this.dist * Math.max(0.75, size * 0.8) * (1 + speedT * 0.4);
    this.curDist = d;   // callers use this for the first-person fade
    const cp = Math.cos(this.pitch), spn = Math.sin(this.pitch);
    let cx = this.target.x + Math.sin(this.yaw) * cp * d;
    let cy = this.target.y + spn * d;
    let cz = this.target.z + Math.cos(this.yaw) * cp * d;

    // keep the camera above the ground
    const groundY = height(cx, cz, cy) + 0.6;
    if (cy < groundY) cy = groundY;

    // horizon tilts with your bank — smoothed so it leans in and out gently
    const wantRoll = flying ? Math.max(-0.5, Math.min(0.5, (flight.roll || 0) * 0.4)) : 0;
    this.camRoll += (wantRoll - this.camRoll) * Math.min(1, dt * 5);

    this.camera.position.set(cx, cy, cz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
    if (Math.abs(this.camRoll) > 0.001) this.camera.rotateZ(this.camRoll);

    // FOV widens with airspeed, plus a quick punch on every wingbeat
    const flapKick = (flight?.flap || 0) * 7;
    const wantFov = this.baseFov + (flying ? speedT * 16 + flapKick : 0);
    this.fov += (wantFov - this.fov) * Math.min(1, dt * (flapKick > 0.5 ? 12 : 4));
    if (Math.abs(this.fov - this.camera.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
