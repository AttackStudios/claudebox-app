// Liquid surfaces, v4: the ocean ring, inland lakes, carved rivers, the
// frozen ice lake's walkable sheet, and the volcano's lava crater. Gently
// animated.

import * as THREE from 'three';
import { WORLD, riverSurfaceAt } from '/shared/worldgen.js';

function ribbon(pts, halfWidth, y) {
  const verts = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[Math.min(i + 1, pts.length - 1)];
    const prev = pts[Math.max(i - 1, 0)];
    const dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const sx = -dz / len * halfWidth, sz = dx / len * halfWidth;
    verts.push(p.x + sx, y, p.z + sz, p.x - sx, y, p.z - sz);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildWater() {
  const group = new THREE.Group();
  group.name = 'water';

  const oceanMat = new THREE.MeshLambertMaterial({ color: '#3f93cf', transparent: true, opacity: 0.82 });
  const lakeMat = new THREE.MeshLambertMaterial({ color: '#3fb6d8', transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const iceMat = new THREE.MeshLambertMaterial({ color: '#dceefa', emissive: '#2a3f50', transparent: true, opacity: 0.96 });
  const lavaMat = new THREE.MeshBasicMaterial({ color: '#ff6a1a' });

  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size * 4, WORLD.size * 4, 16, 16), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = WORLD.seaLevel - 0.05;
  group.add(ocean);

  const lakeMeshes = [];
  for (const L of WORLD.lakes) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(L.r * 1.06, 40), lakeMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(L.x, L.surface, L.z);
    group.add(m);
    lakeMeshes.push({ m, base: L.surface });
  }

  for (const r of WORLD.rivers) {
    // subdivide the polyline so the water hugs the carved bed even on steep
    // mountain stretches (otherwise long flat segments would float)
    const dense = [];
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(2, Math.round(segLen / 18));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        dense.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    dense.push(r.pts[r.pts.length - 1]);
    const geo = ribbon(dense, r.width * 1.05, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const p = dense[Math.floor(i / 2)];
      pos.setY(i, riverSurfaceAt(p.x, p.z));   // sits just above the carved bed
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, lakeMat));
  }

  const il = WORLD.iceLake;
  const ice = new THREE.Mesh(new THREE.CircleGeometry(il.r * 1.04, 36), iceMat);
  ice.rotation.x = -Math.PI / 2;
  ice.position.set(il.x, il.surface, il.z);
  group.add(ice);

  const v = WORLD.volcano;
  const crater = new THREE.Mesh(new THREE.CircleGeometry(v.craterR * 0.95, 28), lavaMat);
  crater.rotation.x = -Math.PI / 2;
  crater.position.set(v.x, v.lava, v.z);
  group.add(crater);

  const lavaA = new THREE.Color('#ff6a1a'), lavaB = new THREE.Color('#ffb030');
  group.userData.tick = (time) => {
    ocean.position.y = WORLD.seaLevel - 0.05 + Math.sin(time * 0.4) * 0.08;
    for (const { m, base } of lakeMeshes) m.position.y = base + Math.sin(time * 0.6 + base) * 0.04;
    crater.position.y = v.lava + Math.sin(time * 0.9) * 0.18;
    lavaMat.color.copy(lavaA).lerp(lavaB, (Math.sin(time * 1.6) + 1) / 2);
  };
  return group;
}
