// Sky dome with a vertex-color gradient, sun, drifting low-poly clouds,
// and the scene lights.

import * as THREE from 'three';
import { WORLD } from '/shared/worldgen.js';
import { mulberry32 } from '/shared/noise.js';

export function buildSky(scene, quality = 'high') {
  const group = new THREE.Group();
  group.name = 'sky';

  // gradient dome
  const domeGeo = new THREE.SphereGeometry(WORLD.size * 1.7, 20, 12);
  const colors = new Float32Array(domeGeo.attributes.position.count * 3);
  const top = new THREE.Color('#4aa8e8');
  const horizon = new THREE.Color('#cfeefc');
  const c = new THREE.Color();
  for (let i = 0; i < domeGeo.attributes.position.count; i++) {
    const y = domeGeo.attributes.position.getY(i) / (WORLD.size * 1.7);
    c.copy(horizon).lerp(top, Math.max(0, y) ** 0.7);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  domeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  group.add(dome);

  // sun disc
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(60, 16),
    new THREE.MeshBasicMaterial({ color: '#fff6c8', fog: false })
  );
  sun.position.set(500, 700, -600);
  sun.lookAt(0, 0, 0);
  group.add(sun);

  // clouds
  const rng = mulberry32(WORLD.seed + 31);
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, flatShading: true });
  const clouds = [];
  const count = quality === 'low' ? 8 : 16;
  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group();
    const blobs = 3 + Math.floor(rng() * 3);
    for (let b = 0; b < blobs; b++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(8 + rng() * 9, 0), cloudMat);
      blob.position.set(b * 11 - blobs * 5 + rng() * 5, rng() * 4, rng() * 8 - 4);
      blob.scale.y = 0.55;
      cloud.add(blob);
    }
    cloud.position.set((rng() * 2 - 1) * (WORLD.half + 200), 150 + rng() * 180, (rng() * 2 - 1) * (WORLD.half + 200));
    cloud.userData.speed = 1.6 + rng() * 3;
    group.add(cloud);
    clouds.push(cloud);
  }

  // lights — warm key sun + cool low fill so surfaces have a lit side and a
  // shaded side (the contrast is what makes the world read as a real place).
  const sunLight = new THREE.DirectionalLight('#fff2cf', 2.6);
  sunLight.position.set(280, 420, -320);
  // crisp shadows over a box that follows the player (moved each frame in main.js)
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.6;
  const sc = sunLight.shadow.camera;
  sc.near = 1; sc.far = 600;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110;
  sc.updateProjectionMatrix();
  const ambient = new THREE.AmbientLight('#9fb8cc', 0.5);   // cool, low — fills the shade without flattening
  const bounce = new THREE.HemisphereLight('#bfe4f5', '#6f9a5e', 0.75);
  group.add(sunLight, sunLight.target, ambient, bounce);

  // Atmosphere tuned to the big continent: clear nearby, biomes melting into
  // haze a region away, and the tall peaks reading as silhouettes — so you
  // can never see the whole map, but the world reveals itself as you fly.
  scene.fog = new THREE.Fog('#cfe6f2', 260, 1500);
  scene.add(group);

  const SP = WORLD.half + 200;
  group.userData.tick = (time, dt) => {
    for (const cloud of clouds) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > SP) cloud.position.x = -SP;
    }
  };

  return { group, sunLight };
}
