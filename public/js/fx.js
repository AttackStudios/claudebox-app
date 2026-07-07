// Tiny particle bursts: hatch shells, grow sparkles, eating crumbs,
// water ripples, feather poofs. Cheap meshes with velocities that fade out.

import * as THREE from 'three';

const COLORS = {
  hatch: ['#f2ead8', '#e8dcc0', '#fffaf0'],
  grow: ['#ffd24a', '#fff0a0', '#ffffff'],
  eat: ['#c98d5a', '#a06a3c', '#e8b88a'],
  drink: ['#7ad2f0', '#b8e8f8'],
  splash: ['#7ad2f0', '#ffffff'],
  poof: ['#ffffff', '#f0f0f0'],
  nest: ['#8a6038', '#b8884f'],
};

export class FxSystem {
  constructor(scene) {
    this.scene = scene;
    this.bursts = [];
    this.geo = new THREE.TetrahedronGeometry(0.09, 0);
    this.matCache = new Map();
  }

  mat(hex) {
    if (!this.matCache.has(hex)) {
      this.matCache.set(hex, new THREE.MeshBasicMaterial({ color: hex, transparent: true }));
    }
    return this.matCache.get(hex);
  }

  burst(kind, pos, count = 14, spread = 3.2) {
    const colors = COLORS[kind] || COLORS.poof;
    const group = new THREE.Group();
    const parts = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo, this.mat(colors[i % colors.length]).clone());
      m.position.copy(pos);
      m.position.y += 0.3;
      const a = Math.random() * Math.PI * 2;
      const up = kind === 'drink' || kind === 'splash' ? 2 : 3.5;
      parts.push({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(a) * spread * Math.random(), up + Math.random() * 2.5, Math.sin(a) * spread * Math.random()),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      });
      group.add(m);
    }
    this.scene.add(group);
    this.bursts.push({ group, parts, life: 1.1 });
  }

  update(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      const fade = Math.max(0, b.life / 1.1);
      for (const p of b.parts) {
        p.vel.y -= 9 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.material.opacity = fade;
      }
      if (b.life <= 0) {
        this.scene.remove(b.group);
        for (const p of b.parts) p.mesh.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
