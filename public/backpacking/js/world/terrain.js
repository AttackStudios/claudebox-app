// Backpacking terrain: one vertex-colored heightfield mesh multiplied by a
// tiling ground-detail texture so the wilderness reads as textured up close.

import * as THREE from 'three';
import { WORLD, height, roadInfo, regionAt } from '/shared/bp/worldgen.js';
import { Simplex2D } from '/shared/noise.js';
import { groundDetail } from '../textures.js';

const tint = new Simplex2D(WORLD.seed + 5);

const C = {
  forest: new THREE.Color('#4e7a3a'),
  forestDark: new THREE.Color('#3b6230'),
  meadow: new THREE.Color('#6b9a48'),
  dirt: new THREE.Color('#7c6443'),
  sand: new THREE.Color('#d9c489'),
  rock: new THREE.Color('#7e7468'),
  rockDark: new THREE.Color('#5d564d'),
  snow: new THREE.Color('#edf2f8'),
  canyonA: new THREE.Color('#b97a4e'),
  canyonB: new THREE.Color('#8f5532'),
  canyonC: new THREE.Color('#c98a58'),
  asphalt: new THREE.Color('#46464a'),
  shoulder: new THREE.Color('#6e6356'),
  scorched: new THREE.Color('#4a423c'),
  basalt: new THREE.Color('#4d4741'),   // lighter so steep cuts read as rock, not voids
  mud: new THREE.Color('#8a7150'),
  underwater: new THREE.Color('#c7b683'),
  caveFloor: new THREE.Color('#5a5450'),
};

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const CHUNK = 256;

// Chunked terrain: a grid of 256-unit tiles (one material, frustum-culled,
// deep-ocean tiles skipped) so the 4096-unit wilderness stays smooth.
export function buildTerrain(quality = 'high') {
  const group = new THREE.Group();
  group.name = 'terrain';
  const detail = groundDetail();
  detail.repeat.set(CHUNK / 7, CHUNK / 7);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });

  const segs = quality === 'low' ? 22 : 40;
  const span = WORLD.size + CHUNK;
  const n = Math.ceil(span / CHUNK);
  const start = -Math.floor(n / 2) * CHUNK;
  const col = new THREE.Color();
  let built = 0;

  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const ox = start + cx * CHUNK, oz = start + cz * CHUNK;
      if (deepOcean(ox, oz)) continue;
      const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, segs, segs);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
        const h = height(x, z);
        pos.setY(i, h);
        const e = 3;
        const slope = Math.abs(height(x + e, z) - h) + Math.abs(height(x, z + e) - h);
        colorAt(x, z, h, slope, col);
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
      pos.needsUpdate = true;
      geo.translate(ox, 0, oz);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
      built++;
    }
  }
  group.userData.chunkCount = built;
  return group;
}

function deepOcean(ox, oz) {
  for (const [dx, dz] of [[8, 8], [CHUNK - 8, 8], [8, CHUNK - 8], [CHUNK - 8, CHUNK - 8], [CHUNK / 2, CHUNK / 2]]) {
    if (height(ox + dx, oz + dz) > -9) return false;
  }
  return true;
}

function colorAt(x, z, h, slope, out) {
  const n = tint.fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
  const n2 = tint.fbm(x * 0.005 + 7, z * 0.005 - 3, 3) * 0.5 + 0.5;

  // forest floor base with meadow patches
  out.copy(C.forest).lerp(C.forestDark, n * 0.7);
  out.lerp(C.meadow, smoothstep(0.55, 0.85, n2) * 0.5);
  out.lerp(C.dirt, smoothstep(0.6, 0.95, tint.fbm(x * 0.03 - 9, z * 0.03 + 4, 2) * 0.5 + 0.5) * 0.35);

  // canyon: banded red strata by elevation
  const cn = WORLD.canyon;
  const cnMask = smoothstep(cn.r * 1.1, cn.r * 0.55, Math.hypot(x - cn.x, z - cn.z));
  if (cnMask > 0) {
    const band = Math.abs(Math.sin(h * 0.5 + n * 1.3));
    const bandCol = band > 0.66 ? C.canyonC : band > 0.33 ? C.canyonA : C.canyonB;
    out.lerp(bandCol, cnMask * 0.92);
  }

  // peaks: rock then snow with elevation
  const pk = WORLD.peaks;
  const pkMask = smoothstep(pk.r * 1.25, pk.r * 0.6, Math.hypot(x - pk.x, z - pk.z));
  out.lerp(n > 0.5 ? C.rock : C.rockDark, pkMask * smoothstep(12, 30, h));
  out.lerp(C.snow, smoothstep(42, 60, h));

  // volcano: scorched slopes, basalt near the rim
  const v = WORLD.volcano;
  const vd = Math.hypot(x - v.x, z - v.z);
  const vMask = smoothstep(v.r * 1.3, v.r * 0.6, vd);
  if (vMask > 0) {
    out.lerp(n > 0.5 ? C.scorched : C.basalt, vMask * 0.9);
  }

  // crystal cave floor
  const cv = WORLD.cave;
  out.lerp(C.caveFloor, smoothstep(cv.r * 1.5, cv.r * 0.6, Math.hypot(x - cv.x, z - cv.z)));

  // cliffs show rock
  out.lerp(C.rockDark, smoothstep(2.4, 5, slope) * 0.75 * (1 - cnMask));

  // shores and lakebeds
  for (const L of [WORLD.lakeWest, WORLD.lakeSouth]) {
    const ld = Math.hypot(x - L.x, z - L.z);
    out.lerp(C.mud, smoothstep(L.r * 1.25, L.r * 0.95, ld) * smoothstep(L.surface + 2, L.surface + 0.3, h));
  }
  out.lerp(C.sand, smoothstep(2.6, 1, h) * smoothstep(WORLD.shoreStart - 90, WORLD.shoreStart - 25, Math.hypot(x, z)));
  if (h < 0.5) out.lerp(C.underwater, smoothstep(0.5, -2, h));

  // road surface + gravel shoulder (the road mesh sits on top, but painting
  // the ground below hides any seam)
  const ri = roadInfo(x, z);
  if (ri.dist < ri.width * 1.5) {
    out.lerp(C.shoulder, smoothstep(ri.width * 1.5, ri.width * 0.62, ri.dist));
    out.lerp(C.asphalt, smoothstep(ri.width * 0.62, ri.width * 0.45, ri.dist));
  }
}
