// Shared helpers for the prop modules: seeded scatter placement (ground and
// sky layers), instanced mesh stamping, and drifting particle fields.

import * as THREE from 'three';
import { WORLD, groundAt, biomeAt, skySurface } from '/shared/worldgen.js';

import { noiseBump, bumpsOn } from '../textures.js';
// Every prop surface carries a heightmap: patterned materials emboss their
// own texture (bark ridges, shingle steps, cobble bumps), plain ones get
// soft fractal noise — nothing reads as a solid flat facet.
export const lambert = (color, opts = {}) => {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  if (bumpsOn() && !('bumpMap' in opts)) {
    m.bumpMap = opts.map || noiseBump();
    m.bumpScale = opts.bumpScale ?? (opts.map ? 0.14 : 0.07);
  }
  return m;
};

// Random ground spots across the whole map, filtered by biome/test.
export function scatter(rng, count, accept) {
  const out = [];
  let guard = count * 40;
  while (out.length < count && guard-- > 0) {
    const x = (rng() * 2 - 1) * (WORLD.shoreEnd + 40);
    const z = (rng() * 2 - 1) * (WORLD.shoreEnd + 40);
    const b = biomeAt(x, z);
    if (accept(b, x, z)) out.push({ x, z, y: groundAt(x, z), r: rng(), s: 0.7 + rng() * 0.7 });
  }
  return out;
}

// Scatter within a circular region (for small biomes the global scatter misses).
export function scatterIn(rng, count, cx, cz, radius, accept) {
  const out = [];
  let guard = count * 40;
  while (out.length < count && guard-- > 0) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (accept(biomeAt(x, z), x, z)) out.push({ x, z, y: groundAt(x, z), r: rng(), s: 0.7 + rng() * 0.7 });
  }
  return out;
}

// Scatter across the Skylands island tops (keeps clear of the rims).
export function scatterSky(rng, count, accept = () => true) {
  const isles = WORLD.sky.islands;
  const totalA = isles.reduce((s, i) => s + i.r * i.r, 0);
  const out = [];
  let guard = count * 40;
  while (out.length < count && guard-- > 0) {
    let pick = rng() * totalA;
    let isle = isles[0];
    for (const cand of isles) { pick -= cand.r * cand.r; if (pick <= 0) { isle = cand; break; } }
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * isle.r * 0.72;
    const x = isle.x + Math.cos(a) * d, z = isle.z + Math.sin(a) * d;
    const y = skySurface(x, z);
    if (y != null && accept(isle, x, z)) out.push({ x, z, y, r: rng(), s: 0.7 + rng() * 0.7, isle });
  }
  return out;
}

export function instanced(geo, mat, spots, place) {
  const m = new THREE.InstancedMesh(geo, mat, spots.length);
  const M = new THREE.Matrix4();
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
  const E = new THREE.Euler();
  spots.forEach((sp, i) => {
    place(sp, P, E, S);
    Q.setFromEuler(E);
    M.compose(P, Q, S);
    m.setMatrixAt(i, M);
  });
  m.instanceMatrix.needsUpdate = true;
  return m;
}

// Drifting particle field (petals, fireflies, embers, smoke, orbs).
export function particleField(count, color, size, opts = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity: opts.opacity ?? 0.9,
    blending: opts.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.seeds = Array.from({ length: count }, () => ({
    a: Math.random() * Math.PI * 2, d: Math.random(), o: Math.random() * 20, sp: 0.4 + Math.random(),
  }));
  return pts;
}

// Soft additive glow sprite (crystals, lanterns, magic pools).
let glowTexCache = null;
export function glowTexture() {
  if (glowTexCache) return glowTexCache;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTexCache = new THREE.CanvasTexture(c);
  return glowTexCache;
}

export function glowSprite(color, scale) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}
