// Terrain, v4 — chunked so a 4096-unit continent stays smooth. The world is
// a grid of 256-unit terrain tiles, each its own vertex-colored mesh sharing
// one material, so the renderer frustum-culls them and the fog hides the
// distant ones. Deep-ocean tiles are skipped (the water plane covers them).
// Biome colors blend by the worldgen's soft region weights, with elevation
// overrides (snow caps, beach sand, slope rock, water-edge mud, volcanic ash).

import * as THREE from 'three';
import { WORLD, height, regionWeights } from '/shared/worldgen.js';
import { Simplex2D } from '/shared/noise.js';
import { terrainDetail } from './textures.js';

const tint = new Simplex2D(WORLD.seed + 99);
const C = (hex) => new THREE.Color(hex);

// per-biome ground tones: [primary, secondary] mixed by local noise
const PAL = {
  meadow: [C('#6fbf5a'), C('#56a248')],
  forest: [C('#46883f'), C('#356a34')],
  snow: [C('#eef4fb'), C('#d6e6f2')],
  desert: [C('#cf8a44'), C('#b06a2e')],
  jungle: [C('#3f9a3c'), C('#2e7a34')],
  volcano: [C('#7a6a72'), C('#564a55')],
  autumn: [C('#c87a36'), C('#9a8a3a')],
};
const SAND = C('#e6d39a');
const ROCK = C('#8a8278');
const ROCKD = C('#6a6258');
const SNOW = C('#f4f8fc');
const MUD = C('#9a7e54');
const ASH = C('#403642');
const BASALT = C('#2a2630');
const TERRA_PALE = C('#e0a060');
const TERRA = C('#cf8a44');
const TERRA_DK = C('#a4571f');
const UNDER = C('#caa86a');
const ICE = C('#cfe6f5');

const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const CHUNK = 256;

export function buildTerrain(quality = 'high') {
  const group = new THREE.Group();
  group.name = 'terrain';

  const detail = terrainDetail();
  detail.repeat.set(CHUNK / 6, CHUNK / 6);   // tiles per chunk (each chunk uses full 0..1 UV)
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
  // emboss the same detail pattern so the ground has real tooth, not paint
  if (typeof window === 'undefined' || window.__ffBumps !== false) {
    mat.bumpMap = detail;
    mat.bumpScale = 0.5;
  }

  const segs = quality === 'low' ? 22 : 40;
  const span = WORLD.size + CHUNK;            // a little past the edge
  const n = Math.ceil(span / CHUNK);
  const start = -Math.floor(n / 2) * CHUNK;

  const tmp = new THREE.Color();
  let built = 0;
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const ox = start + cx * CHUNK;
      const oz = start + cz * CHUNK;
      // skip tiles that are entirely deep ocean
      if (deepOcean(ox, oz)) continue;

      const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, segs, segs);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + ox;
        const z = pos.getZ(i) + oz;
        const h = height(x, z);
        pos.setY(i, h);
        const e = 4;
        const slope = Math.abs(height(x + e, z) - h) + Math.abs(height(x, z + e) - h);
        colorAt(x, z, h, slope, tmp);
        colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
      }
      pos.needsUpdate = true;
      geo.translate(ox, 0, oz);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.name = 'chunk';
      group.add(mesh);
      built++;
    }
  }
  group.userData.chunkCount = built;
  return group;
}

// true when every sample of a chunk's footprint is well below sea level
function deepOcean(ox, oz) {
  for (const [dx, dz] of [[8, 8], [CHUNK - 8, 8], [8, CHUNK - 8], [CHUNK - 8, CHUNK - 8], [CHUNK / 2, CHUNK / 2]]) {
    if (height(ox + dx, oz + dz) > -7) return false;
  }
  return true;
}

function colorAt(x, z, h, slope, out) {
  const n = tint.fbm(x * 0.01, z * 0.01, 2) * 0.5 + 0.5;          // 0..1 patchiness
  const w = regionWeights(x, z);

  // blended base ground color across regions
  out.setRGB(0, 0, 0);
  let total = 0;
  for (const biome in w) {
    const pal = PAL[biome]; if (!pal) continue;
    const t = w[biome];
    tmpCol.copy(pal[0]).lerp(pal[1], n * 0.8);
    out.r += tmpCol.r * t; out.g += tmpCol.g * t; out.b += tmpCol.b * t;
    total += t;
  }
  if (total > 0) { out.r /= total; out.g /= total; out.b /= total; }
  else out.copy(PAL.meadow[0]);

  // desert terracotta banding by elevation (on top of the desert blend)
  const dw = w.desert || 0;
  if (dw > 0.25 && h > 16) {
    const band = Math.abs(Math.sin(h * 0.12 + n * 1.2));
    const bc = band > 0.66 ? TERRA_PALE : band > 0.33 ? TERRA : TERRA_DK;
    out.lerp(bc, dw * smoothstep(16, 30, h) * 0.9);
  }

  // volcano: ash + basalt near the crater, scorched banks
  const vw = w.volcano || 0;
  if (vw > 0.2) {
    const v = WORLD.volcano;
    const vd = Math.hypot(x - v.x, z - v.z);
    out.lerp(n > 0.5 ? ASH : C('#564a55'), vw * 0.8);
    out.lerp(BASALT, smoothstep(v.craterR * 2, v.craterR * 0.9, vd) * 0.9);
  }

  // steep slopes show rock (deserts keep their banding)
  out.lerp(n > 0.5 ? ROCK : ROCKD, smoothstep(7, 16, slope) * 0.85 * (1 - dw * 0.6));

  // snow caps on the heights (gradual line, snow region gets it lower) —
  // but the volcano stays bare rock + ash, never snowy
  const snowStart = WORLD.mountain.snowLine - (w.snow || 0) * 60;
  out.lerp(SNOW, smoothstep(snowStart, snowStart + 60, h) * (1 - Math.min(1, vw * 2)));

  // ice lake sheen
  const il = WORLD.iceLake;
  out.lerp(ICE, smoothstep(il.r * 1.2, il.r * 0.7, Math.hypot(x - il.x, z - il.z)) * 0.7);

  // water-edge mud (lakes + rivers)
  for (const L of WORLD.lakes) {
    out.lerp(MUD, smoothstep(L.r * 1.25, L.r * 0.95, Math.hypot(x - L.x, z - L.z)) * smoothstep(L.surface + 3, L.surface + 0.3, h));
  }

  // beaches + shallow sea floor
  const cont = continent(x, z);
  out.lerp(SAND, smoothstep(5.5, 1.5, h) * smoothstep(0.5, 0.12, cont) * (1 - (w.snow || 0)));
  if (h < 0.5) out.lerp(UNDER, smoothstep(0.5, -6, h));
}

const tmpCol = new THREE.Color();
function continent(x, z) {
  const wx = x + tint.fbm(x * 0.0007 + 3, z * 0.0007, 3) * 320;
  const wz = z + tint.fbm(x * 0.0007 + 14, z * 0.0007 - 7, 3) * 320;
  return smoothstep(WORLD.shoreEnd, WORLD.shoreStart, Math.hypot(wx, wz));
}
