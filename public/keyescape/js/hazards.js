// Stage hazards.
//
// Each one is a small object with update(dt, player) and a hit test. They are
// deliberately readable rather than clever: the fun in a runner comes from
// hazards you can predict on sight, so every one of these telegraphs what it
// is about to do.

import * as THREE from 'three';

const mat = (c, opts = {}) => new THREE.MeshLambertMaterial({ color: c, ...opts });

/** A blocky character that walks you down. Slow, relentless, kills on touch. */
export function makeChaser(scene, { x, z, speed = 5.4, colour = '#ffd9e6', dress = '#ff5c8a', scale = 1 }) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), mat(colour));
  head.position.y = 4.6;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.2, 1.2), mat(dress));
  torso.position.y = 2.6;
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.9, 4), mat(dress));
  skirt.position.y = 1.2; skirt.rotation.y = Math.PI / 4;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.1, 0.42), mat(colour));
  const armR = armL.clone();
  armL.position.set(-1.35, 2.7, 0); armR.position.set(1.35, 2.7, 0);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), mat(colour));
  const legR = legL.clone();
  legL.position.set(-0.5, 0.5, 0); legR.position.set(0.5, 0.5, 0);
  // a face, so it reads as a character and not a crate
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.06), mat('#221019'));
  const eye2 = eye.clone();
  eye.position.set(-0.6, 5.0, 1.32); eye2.position.set(0.6, 5.0, 1.32);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 0.06), mat('#e0507a'));
  mouth.position.set(0, 4.1, 1.32);
  g.add(head, torso, skirt, armL, armR, legL, legR, eye, eye2, mouth);
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  scene.add(g);

  let t = 0;
  return {
    group: g, kind: 'chaser', radius: 1.9 * scale,
    update(dt, p, field) {
      t += dt;
      const dx = p.x - g.position.x, dz = p.z - g.position.z;
      const d = Math.hypot(dx, dz) || 1;
      g.position.x += (dx / d) * speed * dt;
      g.position.z += (dz / d) * speed * dt;
      const h = field?.heightAt(g.position.x, g.position.z);
      g.position.y = (h == null ? 0 : h);
      g.rotation.y = Math.atan2(dx, dz);
      // a plodding walk cycle
      const sw = Math.sin(t * 7) * 0.5;
      legL.rotation.x = sw; legR.rotation.x = -sw;
      armL.rotation.x = -sw * 0.7; armR.rotation.x = sw * 0.7;
      g.position.y += Math.abs(Math.sin(t * 7)) * 0.12;
    },
    hits(p) {
      const dx = p.x - g.position.x, dz = p.z - g.position.z;
      return Math.hypot(dx, dz) < this.radius + 0.7 && Math.abs(p.y - g.position.y) < 6 * scale;
    },
    dispose() { scene.remove(g); },
  };
}

/** A giant gumball that rolls down the lane on a timer. */
export function makeRoller(scene, { x, z0, z1, radius = 5, period = 6.5, colour = '#f2a6dd', offset = 0 }) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), mat(colour));
  ball.position.set(x, radius, z0);
  scene.add(ball);
  let t = offset;
  return {
    group: ball, kind: 'roller', radius,
    update(dt, p, field) {
      t = (t + dt) % period;
      const k = t / period;
      ball.position.z = z0 + (z1 - z0) * k;
      const h = field?.heightAt(ball.position.x, ball.position.z);
      ball.position.y = (h == null ? 0 : h) + radius * 0.86;
      ball.rotation.x += (dt * (z1 - z0) / period) / radius;
      // squash a path through the keys as it goes
      field?.pressAt(ball.position.x, ball.position.z);
    },
    hits(p) {
      const dx = p.x - ball.position.x, dz = p.z - ball.position.z;
      return Math.hypot(dx, dz) < radius * 0.82 && p.y < ball.position.y + radius;
    },
    dispose() { scene.remove(ball); },
  };
}

/** A bar that sweeps a circle — duck round it or time the gap. */
export function makeSpinner(scene, { x, z, len = 11, speed = 1.5, colour = '#ff5c8a', y = 1.2 }) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 0.9), mat(colour));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 10), mat('#ffffff'));
  hub.position.y = 0.4;
  g.add(bar, hub);
  g.position.set(x, y, z);
  scene.add(g);
  let a = Math.random() * Math.PI;
  return {
    group: g, kind: 'spinner',
    update(dt, p, field) {
      a += dt * speed; g.rotation.y = a;
      const h = field?.heightAt(x, z);
      g.position.y = (h == null ? 0 : h) + 0.9;
    },
    hits(p) {
      const dx = p.x - x, dz = p.z - z;
      const d = Math.hypot(dx, dz);
      if (d > len / 2 || d < 0.4) return false;
      if (Math.abs(p.y - g.position.y) > 1.6) return false;
      // is the player near the bar's line?
      const ang = Math.atan2(dz, dx);
      let diff = ((ang - a) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2;
      return Math.abs(Math.sin(diff) * d) < 0.85;
    },
    dispose() { scene.remove(g); },
  };
}

/** A block that slams down on a beat. The shadow is the tell. */
export function makeCrusher(scene, { x, z, w = 7, period = 3, offset = 0, colour = '#8b5a2b' }) {
  const block = new THREE.Mesh(new THREE.BoxGeometry(w, 4, w), mat(colour));
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w, w),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(block, shadow);
  let t = offset;
  const HIGH = 16;
  return {
    group: block, kind: 'crusher',
    update(dt, p, field) {
      t = (t + dt) % period;
      const k = t / period;
      // hangs, then drops fast, then winds back up
      const y = k < 0.62 ? HIGH - (k / 0.62) * 1.5
              : k < 0.72 ? HIGH - 1.5 - ((k - 0.62) / 0.10) * (HIGH - 3.5)
              : 3.5 + ((k - 0.72) / 0.28) * (HIGH - 3.5);
      block.position.set(x, y, z);
      const h = field?.heightAt(x, z) ?? 0;
      shadow.position.set(x, h + 0.05, z);
      const near = Math.max(0, 1 - (y - h) / HIGH);
      shadow.material.opacity = 0.12 + near * 0.35;
      shadow.scale.setScalar(0.7 + near * 0.3);
      if (y < h + 3.2) field?.pressAt(x, z);
    },
    hits(p) {
      if (Math.abs(p.x - x) > w / 2 || Math.abs(p.z - z) > w / 2) return false;
      return p.y < block.position.y + 2 && p.y > block.position.y - 4;
    },
    dispose() { scene.remove(block); scene.remove(shadow); },
  };
}

/**
 * The floor here fades out over a few seconds, then comes back. The wiki's
 * stage 5: a long path that vanishes under you.
 */
export function makeDissolve(scene, { field, z0, z1, period = 5, fade = 3 }) {
  let t = 0;
  let gone = false;
  const affected = [];
  for (const [, rec] of field.grid) {
    const wz = rec.row * field.pitch;
    if (wz >= z0 && wz <= z1) affected.push(rec);
  }
  return {
    kind: 'dissolve',
    get gone() { return gone; },
    covers(z) { return z >= z0 && z <= z1; },
    update(dt) {
      t = (t + dt) % period;
      const k = Math.min(1, t / fade);
      gone = t < fade ? k > 0.94 : false;
      const drop = t < fade ? k : 0;
      for (const rec of affected) {
        if (rec.press === drop) continue;
        rec.press = drop;
        rec.hold = 0;
      }
      // push the visual change through the instanced meshes
      const d = new THREE.Object3D();
      for (const rec of affected) {
        d.position.set(rec.col * field.pitch, rec.h + 0.62 / 2 - rec.press * 0.34, rec.row * field.pitch);
        d.updateMatrix();
        rec.mesh.setMatrixAt(rec.idx, d.matrix);
      }
      for (const m of field.meshes) m.instanceMatrix.needsUpdate = true;
    },
    hits() { return false; },
    dispose() {},
  };
}

/** A platform that slides across a gap. You ride it. */
export function makeMover(scene, { x0, x1, z, period = 4, w = 6, d = 6, colour = '#c084fc', y = 0.6 }) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), mat(colour));
  p.position.set(x0, y, z);
  scene.add(p);
  let t = Math.random() * period;
  return {
    group: p, kind: 'mover', top: y + 0.4, w, d,
    update(dt) {
      t = (t + dt) % period;
      const k = 0.5 - Math.cos((t / period) * Math.PI * 2) * 0.5;
      p.position.x = x0 + (x1 - x0) * k;
    },
    /** platforms are ridden, not avoided */
    surfaceAt(px, pz) {
      if (Math.abs(px - p.position.x) > w / 2 || Math.abs(pz - z) > d / 2) return null;
      return this.top;
    },
    hits() { return false; },
    dispose() { scene.remove(p); },
  };
}
