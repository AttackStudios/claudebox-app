// Scenery, v4 — populated across the big continent by biome region. Trees,
// rocks, grass and ambient particles are placed with seeded scatter inside
// each region and stamped as InstancedMesh (one draw call per layer), so a
// 4096-unit world stays cheap. Exposes userData.trunks (soft tree colliders)
// and userData.tick(time, dt) for animated bits.

import * as THREE from 'three';
import { WORLD, biomeAt, groundAt, height, waterAt, lavaAt, SKY_ISLANDS, skySurfaceAt, WATERFALL } from '/shared/worldgen.js';
import { mulberry32 } from '/shared/noise.js';
import { bark, leafCanopy, softDot } from '../textures.js';

const DOT = softDot();   // soft round sprite for all point particles

// Smooth PBR material (no more one-flat-color-per-face). Roughness/metalness
// give surfaces a natural light response; `map` accepts a grayscale detail
// texture that the `color` tints — same trick the terrain uses.
const lambert = (color, opts = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.96, metalness: 0, flatShading: false, ...opts,
});

// shared grayscale detail maps, tinted per-tree by the material color
const BARK = bark(); BARK.repeat.set(1, 3);
const LEAF = leafCanopy(); LEAF.repeat.set(2, 2);

// ---- wind: a single shared clock drives a gentle vertex sway on grass and
// foliage, so the world breathes instead of standing frozen. Cost is zero
// per-frame JS — it's a shader tweak; we only tick one uniform.
const windTime = { value: 0 };
function applyWind(mat, strength = 0.5) {
  mat.userData.wind = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float wPhase = 0.0;
       #ifdef USE_INSTANCING
         wPhase = instanceMatrix[3].x * 0.06 + instanceMatrix[3].z * 0.05;
       #endif
       float wH = clamp(position.y + 0.6, 0.0, 2.2);        // base stays planted, tips sway
       transformed.x += sin(uTime * 1.5 + wPhase) * wH * ${strength.toFixed(3)} * 0.09;
       transformed.z += cos(uTime * 1.2 + wPhase) * wH * ${strength.toFixed(3)} * 0.07;`
    );
  };
  return mat;
}

// scatter `count` points inside a region circle, accepting only the target
// biome. Points clump into groves with open clearings between them (nature
// clusters — even spacing reads as "computer-generated"). Most points land
// near a randomly chosen grove centre; a minority scatter freely.
function scatterRegion(rng, region, count, accept, opts = {}) {
  const clump = opts.clump !== false;   // ground cover passes clump:false to fill evenly
  const out = [];
  const R = region.r * 1.18;
  // grove centres — fewer, bigger clusters for sparse layers; more for dense
  const nGroves = Math.max(3, Math.round(count / 36));
  const groves = [];
  for (let i = 0; i < nGroves; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * R;
    groves.push({ x: region.x + Math.cos(a) * d, z: region.z + Math.sin(a) * d, r: R * (0.10 + rng() * 0.16) });
  }
  let guard = count * 40;
  while (out.length < count && guard-- > 0) {
    let x, z;
    if (clump && rng() < 0.82) {
      // inside a grove, denser toward its core (rng*rng biases inward)
      const g = groves[(rng() * groves.length) | 0];
      const a = rng() * Math.PI * 2;
      const d = rng() * rng() * g.r;
      x = g.x + Math.cos(a) * d;
      z = g.z + Math.sin(a) * d;
    } else {
      // a few loners out in the clearings
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * R;
      x = region.x + Math.cos(a) * d;
      z = region.z + Math.sin(a) * d;
    }
    if (biomeAt(x, z) !== region.biome) continue;
    if (waterAt(x, z) || lavaAt(x, z)) continue;
    if (accept && !accept(x, z)) continue;
    out.push({ x, z, y: groundAt(x, z), r: rng(), s: 0.78 + rng() * 0.55 });
  }
  return out;
}

function instanced(geo, mat, spots, place) {
  if (!spots.length) return new THREE.Group();
  const m = new THREE.InstancedMesh(geo, mat, spots.length);
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler();
  spots.forEach((sp, i) => { place(sp, P, E, S); Q.setFromEuler(E); M.compose(P, Q, S); m.setMatrixAt(i, M); });
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = true;
  return m;
}

function particleField(count, color, size, opts = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mat = new THREE.PointsMaterial({
    color, size, map: DOT, alphaTest: 0.05, transparent: true, opacity: opts.opacity ?? 0.9,
    blending: opts.glow ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.seeds = Array.from({ length: count }, () => ({ a: Math.random() * 6.28, d: Math.random(), o: Math.random() * 20, sp: 0.4 + Math.random() }));
  return pts;
}

const region = (biome) => WORLD.regions.find((r) => r.biome === biome);

// a small butterfly: dark body + two rounded wings that hinge to flap
const BFLY_COLS = ['#ff9ad0', '#f8d23a', '#8ab8ff', '#ffffff', '#f2702a', '#c45af0'];
let BFLY_WING = null;
function butterflyWingGeo() {
  if (BFLY_WING) return BFLY_WING;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.18, 0.55, 0.72, 0.62, 0.72, 0.12);
  s.bezierCurveTo(0.78, -0.34, 0.4, -0.52, 0, -0.16);
  BFLY_WING = new THREE.ShapeGeometry(s);
  BFLY_WING.rotateX(-Math.PI / 2);   // lay flat so wings flap up/down
  return BFLY_WING;
}
function buildButterfly(rng) {
  const col = BFLY_COLS[(rng() * BFLY_COLS.length) | 0];
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.55, 5), lambert('#352a26'));
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  g.add(body);
  const geo = butterflyWingGeo();
  const wingMat = lambert(col, { side: THREE.DoubleSide, roughness: 0.7 });
  const L = new THREE.Group(); const lw = new THREE.Mesh(geo, wingMat); lw.castShadow = true; L.add(lw);
  const R = new THREE.Group(); const rw = new THREE.Mesh(geo, wingMat); rw.scale.x = -1; rw.castShadow = true; R.add(rw);
  g.add(L, R);
  g.userData = { L, R };
  return g;
}

export function buildProps(quality = 'high') {
  const rng = mulberry32(WORLD.seed + 7);
  const group = new THREE.Group();
  group.name = 'props';
  const q = quality === 'low' ? 0.4 : 1;
  const trunks = [];
  const tickers = [];
  const addTrunks = (spots, rad = 0.7) => { for (const t of spots) trunks.push({ x: t.x, z: t.z, r: rad * t.s }); };

  // ===================== FOREST: tall tiered pines =====================
  {
    const spots = scatterRegion(rng, region('forest'), Math.floor(900 * q), (x, z) => height(x, z) < WORLD.mountain.snowLine - 10);
    group.add(
      instanced(new THREE.CylinderGeometry(0.5, 0.8, 9, 8), lambert('#7a563a', { map: BARK, roughness: 1 }), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 4 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
      instanced(new THREE.ConeGeometry(3.4, 5, 12), lambert('#2e6a36', { map: LEAF }), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 6.5 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
      instanced(new THREE.ConeGeometry(2.6, 4.2, 12), lambert('#367a40', { map: LEAF }), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 9.4 * sp.s, sp.z); E.set(0, sp.r * 6 + 1, 0); S.setScalar(sp.s); }),
      instanced(new THREE.ConeGeometry(1.7, 3.4, 12), lambert('#2e6a36', { map: LEAF }), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 12 * sp.s, sp.z); E.set(0, sp.r * 6 + 2, 0); S.setScalar(sp.s); })
    );
    addTrunks(spots, 0.8);
  }

  // ===================== SNOW: snow-capped pines + drifts =====================
  {
    const spots = scatterRegion(rng, region('snow'), Math.floor(700 * q), (x, z) => height(x, z) < 200);
    group.add(
      instanced(new THREE.CylinderGeometry(0.45, 0.7, 7, 8), lambert('#6e5240', { map: BARK, roughness: 1 }), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 3.2 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
      instanced(new THREE.ConeGeometry(2.8, 4.4, 12), lambert('#2c5447', { map: LEAF }), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 5.6 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
      instanced(new THREE.ConeGeometry(2.0, 2.2, 7), lambert('#f2f8fc'), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 7.6 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
      instanced(new THREE.ConeGeometry(1.3, 2.4, 7), lambert('#ffffff'), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 9.2 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); })
    );
    addTrunks(spots, 0.7);
    const drifts = scatterRegion(rng, region('snow'), Math.floor(220 * q));
    group.add(instanced(new THREE.SphereGeometry(2.2, 7, 5), lambert('#ffffff'), drifts,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.2, sp.z); E.set(0, sp.r * 6, 0); S.set(sp.s * 1.6, sp.s * 0.45, sp.s * 1.6); }));
  }

  // ===================== MEADOW: round oaks + bushes + flowers =====================
  {
    const oaks = scatterRegion(rng, region('meadow'), Math.floor(260 * q));
    group.add(
      instanced(new THREE.CylinderGeometry(0.55, 0.8, 5, 8), lambert('#7a5638', { map: BARK, roughness: 1 }), oaks,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 2.4 * sp.s, sp.z); E.set(0, sp.r * 6, (sp.r - 0.5) * 0.15); S.setScalar(sp.s); }),
      instanced(new THREE.IcosahedronGeometry(3.6, 2), lambert('#4f9a44', { map: LEAF }), oaks,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 6.6 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.setScalar(sp.s); }),
      instanced(new THREE.IcosahedronGeometry(2.5, 2), lambert('#5fae50', { map: LEAF }), oaks,
        (sp, P, E, S) => { P.set(sp.x + 1.4 * sp.s, sp.y + 5.4 * sp.s, sp.z + 0.8 * sp.s); E.set(0, sp.r * 9, 0.3); S.setScalar(sp.s); })
    );
    addTrunks(oaks, 0.85);
    const bushes = scatterRegion(rng, region('meadow'), Math.floor(200 * q));
    group.add(instanced(new THREE.IcosahedronGeometry(1.1, 0), lambert('#3f8a3a'), bushes,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.55 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.set(sp.s, sp.s * 0.75, sp.s); }));
    const flowers = scatterRegion(rng, region('meadow'), Math.floor(360 * q));
    ['#f8d23a', '#f08aa8', '#8a9af8', '#ffffff', '#f2702a'].forEach((fc, fi) => {
      const mine = flowers.filter((_, i) => i % 5 === fi);
      group.add(instanced(new THREE.SphereGeometry(0.2, 5, 4), lambert(fc), mine,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.5, sp.z); E.set(0, 0, 0); S.setScalar(0.9 + sp.r * 0.6); }));
    });
  }

  // ===================== JUNGLE: palms + leafy canopies =====================
  {
    const canopy = scatterRegion(rng, region('jungle'), Math.floor(520 * q));
    group.add(
      instanced(new THREE.CylinderGeometry(0.3, 0.55, 16, 8), lambert('#8a7050', { map: BARK, roughness: 1 }), canopy,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 7.5 * sp.s, sp.z); E.set((sp.r - 0.5) * 0.12, sp.r * 6, (sp.r - 0.5) * 0.12); S.setScalar(sp.s); }),
      instanced(new THREE.IcosahedronGeometry(4.4, 2), lambert('#2e8a3c', { map: LEAF }), canopy,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 15.5 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.set(sp.s * 1.3, sp.s * 0.5, sp.s * 1.3); }),
      instanced(new THREE.IcosahedronGeometry(2.8, 2), lambert('#46aa50', { map: LEAF }), canopy,
        (sp, P, E, S) => { P.set(sp.x + 1.6 * sp.s, sp.y + 14 * sp.s, sp.z - 1 * sp.s); E.set(0, sp.r * 9, 0.2); S.set(sp.s, sp.s * 0.5, sp.s); })
    );
    addTrunks(canopy, 0.6);
    const palms = scatterRegion(rng, region('jungle'), Math.floor(160 * q));
    group.add(
      instanced(new THREE.CylinderGeometry(0.28, 0.46, 9, 6), lambert('#9a7850'), palms,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 4 * sp.s, sp.z); E.set(0.16, sp.r * 6, 0.1); S.setScalar(sp.s); }),
      instanced(new THREE.ConeGeometry(3.4, 1.6, 6), lambert('#54b364'), palms,
        (sp, P, E, S) => { P.set(sp.x + 1 * sp.s, sp.y + 8.6 * sp.s, sp.z + 0.5 * sp.s); E.set(0, sp.r * 6, 0); S.set(sp.s, sp.s * 0.85, sp.s); })
    );
    addTrunks(palms, 0.5);
  }

  // ===================== DESERT: acacias + cacti + boulders =====================
  {
    const acacias = scatterRegion(rng, region('desert'), Math.floor(200 * q), (x, z) => height(x, z) < 30);
    group.add(
      instanced(new THREE.CylinderGeometry(0.25, 0.45, 6, 5), lambert('#7a5a3c'), acacias,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 2.8 * sp.s, sp.z); E.set((sp.r - 0.5) * 0.4, sp.r * 6, (sp.r - 0.5) * 0.4); S.setScalar(sp.s); }),
      instanced(new THREE.CylinderGeometry(3.4, 2.2, 1, 8), lambert('#5d8a3c'), acacias,
        (sp, P, E, S) => { P.set(sp.x + (sp.r - 0.5) * 2 * sp.s, sp.y + 6 * sp.s, sp.z, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); })
    );
    addTrunks(acacias, 0.5);
    const cacti = scatterRegion(rng, region('desert'), Math.floor(240 * q), (x, z) => height(x, z) < 36);
    group.add(
      instanced(new THREE.CylinderGeometry(0.5, 0.6, 4, 7), lambert('#4f9a5f'), cacti,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 2 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
      instanced(new THREE.SphereGeometry(0.55, 6, 5), lambert('#5fae6e'), cacti,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 4 * sp.s, sp.z); E.set(0, 0, 0); S.setScalar(sp.s); })
    );
    addTrunks(cacti, 0.5);
    const boulders = scatterRegion(rng, region('desert'), Math.floor(180 * q));
    group.add(instanced(new THREE.DodecahedronGeometry(1.8, 0), lambert('#9a948c'), boulders,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.5 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s * 1.3, sp.s * 0.8, sp.s); }));
  }

  // ===================== AUTUMN: warm round trees =====================
  {
    const trees = scatterRegion(rng, region('autumn'), Math.floor(420 * q), (x, z) => height(x, z) < WORLD.mountain.snowLine - 10);
    const leafCols = ['#d8742a', '#c84a2a', '#e0a82e'];
    group.add(instanced(new THREE.CylinderGeometry(0.5, 0.75, 5.5, 8), lambert('#6e4a34', { map: BARK, roughness: 1 }), trees,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2.6 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }));
    leafCols.forEach((lc, li) => {
      const mine = trees.filter((_, i) => i % 3 === li);
      group.add(instanced(new THREE.IcosahedronGeometry(3.4, 2), lambert(lc, { map: LEAF }), mine,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 6.4 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.setScalar(sp.s); }));
    });
    addTrunks(trees, 0.75);
  }

  // ===================== VOLCANO: charred snags + basalt + embers =====================
  {
    const v = WORLD.volcano;
    const dead = scatterRegion(rng, region('volcano'), Math.floor(220 * q), (x, z) => height(x, z) < v.rim * 0.7);
    group.add(
      instanced(new THREE.CylinderGeometry(0.15, 0.4, 5, 5), lambert('#1f1a1d'), dead,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 2.4 * sp.s, sp.z); E.set((sp.r - 0.5) * 0.35, sp.r * 6, (sp.r - 0.5) * 0.35); S.setScalar(sp.s); }),
      instanced(new THREE.CylinderGeometry(0.06, 0.16, 2.6, 4), lambert('#1f1a1d'), dead,
        (sp, P, E, S) => { P.set(sp.x + 0.8 * sp.s, sp.y + 4 * sp.s, sp.z); E.set(0, sp.r * 6, 1); S.setScalar(sp.s); })
    );
    addTrunks(dead, 0.4);
    const basalt = scatterRegion(rng, region('volcano'), Math.floor(260 * q));
    group.add(instanced(new THREE.DodecahedronGeometry(1.6, 0), lambert('#2a2630'), basalt,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.4 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s, sp.s * 0.75, sp.s); }));

    const smoke = particleField(Math.floor(50 * q), '#a89aa4', 14, { opacity: 0.3 });
    const embers = particleField(Math.floor(60 * q), '#ffae3a', 1.4, { glow: true });
    group.add(smoke, embers);
    tickers.push((time) => {
      const sPos = smoke.geometry.attributes.position;
      for (let i = 0; i < smoke.userData.seeds.length; i++) {
        const s = smoke.userData.seeds[i]; const rise = (time * (5 + s.sp * 3) + s.o * 7) % 220;
        sPos.setXYZ(i, v.x + Math.cos(s.a + time * 0.1) * (10 + rise * 0.4) * s.d, v.lava + 4 + rise, v.z + Math.sin(s.a + time * 0.1) * (10 + rise * 0.4) * s.d);
      }
      sPos.needsUpdate = true;
      const ePos = embers.geometry.attributes.position;
      for (let i = 0; i < embers.userData.seeds.length; i++) {
        const s = embers.userData.seeds[i]; const rise = (time * (6 + s.sp * 5) + s.o * 4) % 60;
        ePos.setXYZ(i, v.x + Math.cos(s.a * 3 + time * 0.6 * s.sp) * s.d * v.craterR, v.lava + 1 + rise, v.z + Math.sin(s.a * 3 + time * 0.6 * s.sp) * s.d * v.craterR);
      }
      ePos.needsUpdate = true;
    });
  }

  // ===================== ground cover: the world's missing middle =====================
  // Dense grass carpet, leafy shrubs, flower patches and scattered stone fill
  // the bare gaps so the land never reads as empty. Grass/shrubs sway in wind.
  {
    // -- big boulders (clumped, as before) --
    const rockSpots = [];
    for (const b of ['meadow', 'forest', 'snow', 'jungle', 'autumn']) {
      rockSpots.push(...scatterRegion(rng, region(b), Math.floor(120 * q)));
    }
    group.add(instanced(new THREE.DodecahedronGeometry(1.2, 0), lambert('#8d8478', { roughness: 1 }), rockSpots,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.3 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s, sp.s * 0.7, sp.s); }));

    // -- small pebbles carpeting the ground everywhere (fills bare floor) --
    const pebbles = [];
    for (const b of ['meadow', 'forest', 'snow', 'jungle', 'autumn', 'desert']) {
      pebbles.push(...scatterRegion(rng, region(b), Math.floor(700 * q), null, { clump: false }));
    }
    group.add(instanced(new THREE.DodecahedronGeometry(0.4, 0), lambert('#94897b', { roughness: 1 }), pebbles,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.12 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s, sp.s * 0.6, sp.s); }));

    // -- DENSE grass carpet: uniform fill (incl. the clearings between groves) --
    const grass = [];
    for (const [b, c] of [['meadow', 5200], ['forest', 3400], ['jungle', 3000], ['autumn', 2400], ['snow', 900]]) {
      grass.push(...scatterRegion(rng, region(b), Math.floor(c * q), null, { clump: false }).map((g) => ({ ...g, biome: b })));
    }
    const grassMat = applyWind(lambert('#5fb350', { map: LEAF, roughness: 1 }), 1.0);
    group.add(instanced(new THREE.ConeGeometry(0.22, 1.5, 4), grassMat, grass,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.6, sp.z); E.set(sp.r * 0.5 - 0.25, sp.r * 6, 0);
        const t = sp.biome === 'jungle' ? 1.6 : sp.biome === 'snow' ? 0.7 : 1; S.setScalar(t * (0.8 + sp.r * 0.8)); }));
    // a darker, taller tuft mixed in for depth
    const grass2 = grass.filter((_, i) => i % 3 === 0);
    const grassMat2 = applyWind(lambert('#4f9a44', { map: LEAF, roughness: 1 }), 1.1);
    group.add(instanced(new THREE.ConeGeometry(0.28, 2.1, 4), grassMat2, grass2,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.9, sp.z); E.set(sp.r * 0.4 - 0.2, sp.r * 6 + 1, 0); S.setScalar(0.7 + sp.r * 0.7); }));

    // -- leafy shrubs / ferns: the mid-layer between grass and trees --
    const ferns = [];
    for (const [b, c] of [['forest', 900], ['jungle', 800], ['meadow', 500], ['autumn', 500]]) {
      ferns.push(...scatterRegion(rng, region(b), Math.floor(c * q)).map((g) => ({ ...g, biome: b })));
    }
    const fernMat = applyWind(lambert('#3f8a3a', { map: LEAF, roughness: 1 }), 0.7);
    group.add(instanced(new THREE.IcosahedronGeometry(0.9, 1), fernMat, ferns,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.5 * sp.s, sp.z); E.set(0, sp.r * 6, 0);
        S.set(sp.s * 1.3, sp.s * (0.7 + sp.r * 0.5), sp.s * 1.3); }));

    // -- flower patches spread across the soft biomes (clumped = natural patches) --
    const flowers2 = [];
    for (const b of ['meadow', 'autumn', 'forest', 'jungle']) {
      flowers2.push(...scatterRegion(rng, region(b), Math.floor(420 * q)));
    }
    ['#f8d23a', '#f08aa8', '#8a9af8', '#ffffff', '#f2702a', '#c45af0'].forEach((fc, fi) => {
      const mine = flowers2.filter((_, i) => i % 6 === fi);
      group.add(instanced(new THREE.SphereGeometry(0.26, 6, 5), lambert(fc, { roughness: 0.8 }), mine,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.55, sp.z); E.set(0, 0, 0); S.setScalar(0.9 + sp.r * 0.7); }));
    });
  }

  // beach palms
  {
    const palms = [];
    let guard = 800;
    while (palms.length < Math.floor(140 * q) && guard-- > 0) {
      const a = rng() * Math.PI * 2, d = (WORLD.shoreStart - 120) * (0.85 + rng() * 0.12);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (biomeAt(x, z) === 'beach') palms.push({ x, z, y: groundAt(x, z), r: rng(), s: 0.8 + rng() * 0.5 });
    }
    group.add(
      instanced(new THREE.CylinderGeometry(0.24, 0.42, 7, 5), lambert('#9a7048'), palms,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 3 * sp.s, sp.z); E.set(0.2, sp.r * 6, 0.12); S.setScalar(sp.s); }),
      instanced(new THREE.ConeGeometry(2.8, 1.4, 6), lambert('#54b364'), palms,
        (sp, P, E, S) => { P.set(sp.x + 1 * sp.s, sp.y + 6.4 * sp.s, sp.z + 0.4 * sp.s); E.set(0, sp.r * 6, 0); S.set(sp.s, sp.s * 0.8, sp.s); })
    );
    addTrunks(palms, 0.5);
  }

  // jungle fireflies
  {
    const j = region('jungle');
    const flies = particleField(Math.floor(60 * q), '#d8f060', 1.6, { glow: true });
    group.add(flies);
    tickers.push((time) => {
      const pos = flies.geometry.attributes.position;
      for (let i = 0; i < flies.userData.seeds.length; i++) {
        const s = flies.userData.seeds[i];
        const x = j.x + Math.cos(s.a + time * 0.2 * s.sp) * s.d * j.r * 0.8;
        const z = j.z + Math.sin(s.a * 1.4 + time * 0.18 * s.sp) * s.d * j.r * 0.8;
        pos.setXYZ(i, x, groundAt(x, z) + 2 + Math.sin(time * 1.3 * s.sp + s.o) * 1.2, z);
      }
      pos.needsUpdate = true;
      flies.material.opacity = 0.5 + 0.4 * Math.sin(time * 2);
    });
  }

  // ===================== drifting life: motes + butterflies =====================
  // Slow-floating motion across the open land so the air itself feels alive.
  {
    const m = region('meadow');
    // pollen / dust motes drifting low over the soft biomes
    const motes = particleField(Math.floor(420 * q), '#fbf4c8', 2.2, { opacity: 0.5, glow: true });
    motes.userData.seeds = motes.userData.seeds.map((s) => ({
      ...s, hx: (Math.random() * 2 - 1) * WORLD.half * 0.85, hz: (Math.random() * 2 - 1) * WORLD.half * 0.85,
    }));
    group.add(motes);
    tickers.push((time) => {
      const pos = motes.geometry.attributes.position;
      for (let i = 0; i < motes.userData.seeds.length; i++) {
        const s = motes.userData.seeds[i];
        const x = s.hx + Math.cos(s.a + time * 0.12 * s.sp) * 14 + time * 1.5 % 40;
        const z = s.hz + Math.sin(s.a * 1.3 + time * 0.1 * s.sp) * 14;
        pos.setXYZ(i, x, groundAt(x, z) + 3 + Math.sin(time * 0.6 * s.sp + s.o) * 2.2, z);
      }
      pos.needsUpdate = true;
    });

    // real butterflies fluttering + banking over the meadow
    const bflies = [];
    const bCount = Math.floor(46 * q);
    for (let i = 0; i < bCount; i++) {
      const g = buildButterfly(rng);
      g.scale.setScalar(0.9 + rng() * 0.5);
      g.userData.seed = { a: rng() * 6.28, d: 0.15 + rng() * 0.85, o: rng() * 6.28, sp: 0.7 + rng() * 0.7 };
      group.add(g);
      bflies.push(g);
    }
    tickers.push((time) => {
      for (const g of bflies) {
        const s = g.userData.seed;
        const rad = 25 + s.d * 130;   // a loose visible cloud, not spread thin across the whole meadow
        const x = m.x + Math.cos(s.a + time * 0.3 * s.sp) * rad;
        const z = m.z + Math.sin(s.a * 1.7 + time * 0.27 * s.sp) * rad;
        const y = groundAt(x, z) + 1.8 + Math.abs(Math.sin(time * 3 * s.sp + s.o)) * 1.6;
        if (s.px !== undefined) {
          const dx = x - s.px, dz = z - s.pz;
          if (dx * dx + dz * dz > 1e-5) g.rotation.y = Math.atan2(dx, dz);
        }
        s.px = x; s.pz = z;
        g.position.set(x, y, z);
        const flap = 0.55 + Math.sin(time * 14 * s.sp + s.o) * 0.65;
        g.userData.L.rotation.z = flap;
        g.userData.R.rotation.z = -flap;
      }
    });
  }

  // ===================== SKYLANDS: floating islands only fliers reach =====================
  // Each island is an inverted rock cone hanging under a grassy dome whose
  // mesh samples skySurfaceAt directly, so feet land exactly on the render
  // surface (collision lives in the player controller via skySurfaceAt).
  // No trunks up here — trunk colliders are infinite-height cylinders and
  // would shove birds walking on the terrain far below.
  {
    const rockMat = lambert('#a89e90', { roughness: 1 });
    rockMat.emissive = new THREE.Color('#3a352c');   // undersides face away from the sun — keep them readable, not black
    const topMat = lambert('#55a84a', { roughness: 1 });
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.38, depthWrite: false });
    const cloudRings = [];
    for (const isl of SKY_ISLANDS) {
      // underside: inverted rounded rock cone tapering to a hanging tip
      const depth = isl.r * 0.85;
      const under = new THREE.Mesh(new THREE.ConeGeometry(isl.r * 0.99, depth, 11, 3), rockMat);
      under.rotation.x = Math.PI;
      under.rotation.y = rng() * 6.28;
      under.position.set(isl.x, isl.y - depth / 2 + 0.3, isl.z);
      under.castShadow = true;
      group.add(under);

      // top: a grass dome sampled straight from skySurfaceAt
      const topGeo = new THREE.CircleGeometry(isl.r * 0.995, 40);
      topGeo.rotateX(-Math.PI / 2);
      const tPos = topGeo.attributes.position;
      for (let i = 0; i < tPos.count; i++) {
        tPos.setY(i, skySurfaceAt(isl.x + tPos.getX(i), isl.z + tPos.getZ(i)) - isl.y);
      }
      topGeo.computeVertexNormals();
      const top = new THREE.Mesh(topGeo, topMat);
      top.position.set(isl.x, isl.y, isl.z);
      top.receiveShadow = true;
      group.add(top);

      // a few small oaks + bushes up top (kept inside the dome's gentle part)
      const spots = [];
      for (let i = 0, n = Math.max(2, Math.round(isl.r / 12)); i < n; i++) {
        const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * isl.r * 0.6;
        const x = isl.x + Math.cos(a) * d, z = isl.z + Math.sin(a) * d;
        spots.push({ x, z, y: skySurfaceAt(x, z), r: rng(), s: 0.55 + rng() * 0.35 });
      }
      group.add(
        instanced(new THREE.CylinderGeometry(0.4, 0.6, 4, 7), lambert('#7a5638', { map: BARK, roughness: 1 }), spots,
          (sp, P, E, S) => { P.set(sp.x, sp.y + 1.9 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
        instanced(new THREE.IcosahedronGeometry(2.7, 2), lambert('#4f9a44', { map: LEAF }), spots,
          (sp, P, E, S) => { P.set(sp.x, sp.y + 5 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.setScalar(sp.s); }),
        instanced(new THREE.IcosahedronGeometry(1.0, 0), lambert('#3f8a3a'), spots,
          (sp, P, E, S) => { P.set(sp.x + 2.4 * sp.s, sp.y + 0.4, sp.z + 1.1 * sp.s); E.set(0, sp.r * 9, 0); S.set(sp.s, sp.s * 0.7, sp.s); })
      );

      // ring of soft cloud puffs drifting slowly around the island
      const ring = new THREE.Group();
      ring.position.set(isl.x, isl.y, isl.z);
      for (let i = 0, n = Math.max(6, Math.round(isl.r / 7)); i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.6;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(2.6 + rng() * 3.2, 7, 5), cloudMat);
        puff.position.set(Math.cos(a) * (isl.r * 1.12 + rng() * 9), -2 - rng() * 7, Math.sin(a) * (isl.r * 1.12 + rng() * 9));
        puff.scale.set(1.7, 0.55, 1.2);
        ring.add(puff);
      }
      group.add(ring);
      cloudRings.push({ ring, y: isl.y, sp: (0.03 + rng() * 0.025) * (rng() < 0.5 ? -1 : 1) });
    }
    tickers.push((time) => {
      for (const c of cloudRings) {
        c.ring.rotation.y = time * c.sp;
        c.ring.position.y = c.y + Math.sin(time * 0.25 + c.y) * 0.7;
      }
    });
  }

  // ===================== HERON FALLS: outcrop + waterfall =====================
  // A rock pillar on Heron Lake's eastern shore. Its flat summit is solid
  // ground via worldgen's waterfallTopAt (used by the player controller) —
  // trunk colliders are infinite-height pushes and would shove a landed bird
  // straight off the top, so the surface helper is the collider here.
  {
    const wf = WATERFALL;
    const lake = WORLD.lakes[0];
    const baseY = wf.top - wf.h;
    const dx = lake.x - wf.x, dz = lake.z - wf.z;
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;          // unit vector toward open water
    const rockMat = lambert('#877e72', { roughness: 1 });

    // main pillar, flat top exactly at wf.top; skirt boulders around the base
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(wf.topR, wf.topR * 1.5, wf.h + 3, 10), rockMat);
    pillar.position.set(wf.x, wf.top - (wf.h + 3) / 2, wf.z);
    pillar.castShadow = true;
    group.add(pillar);
    const skirt = [];
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2, d = wf.topR * (1.2 + rng() * 0.9);
      skirt.push({ x: wf.x + Math.cos(a) * d, z: wf.z + Math.sin(a) * d, y: baseY, r: rng(), s: 0.9 + rng() * 0.9 });
    }
    skirt.push({ x: wf.x + ux * wf.topR * 0.7, z: wf.z + uz * wf.topR * 0.7, y: wf.top - 0.4, r: 0.3, s: 0.7 }); // spill lip
    group.add(instanced(new THREE.DodecahedronGeometry(1.6, 0), rockMat, skirt,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.5 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s * 1.2, sp.s * 0.8, sp.s); }));

    // the falling sheet: a vertical plane off the lake-facing lip, wobbled
    // gently every frame so the water reads as moving (see tick below)
    const drop = wf.top + 0.4 - lake.surface;
    const sheetGeo = new THREE.PlaneGeometry(wf.topR * 1.15, drop, 4, 10);
    const sheetBase = sheetGeo.attributes.position.array.slice();
    const sheetMat = new THREE.MeshLambertMaterial({ color: '#3fb6d8', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
    const sheet = new THREE.Mesh(sheetGeo, sheetMat);
    sheet.rotation.y = Math.atan2(ux, uz);
    sheet.position.set(wf.x + ux * (wf.topR + 0.5), lake.surface + drop / 2, wf.z + uz * (wf.topR + 0.5));
    group.add(sheet);

    // foam + mist where the falls hit the lake
    const foamMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false });
    const mistMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.26, depthWrite: false });
    const fx = wf.x + ux * (wf.topR + 1.5), fz = wf.z + uz * (wf.topR + 1.5);
    const foams = [];
    for (let i = 0; i < 5; i++) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.9 + rng() * 0.9, 7, 5), foamMat);
      blob.position.set(fx + (rng() - 0.5) * 5, lake.surface + 0.15, fz + (rng() - 0.5) * 5);
      blob.scale.y = 0.45;
      group.add(blob);
      foams.push({ blob, o: rng() * 6.28, s: blob.scale.x });
    }
    const mists = [];
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(2 + rng() * 1.6, 7, 5), mistMat);
      puff.position.set(fx + (rng() - 0.5) * 4, lake.surface + 1.4, fz + (rng() - 0.5) * 4);
      group.add(puff);
      mists.push({ puff, o: rng() * 6.28, y: puff.position.y });
    }

    tickers.push((time) => {
      // ripple the sheet: small lateral wobble that grows toward the bottom
      const p = sheetGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = sheetBase[i * 3 + 1];
        const fall = 0.5 - y / drop;              // 0 at the lip → 1 at the lake
        p.setZ(i, sheetBase[i * 3 + 2] + Math.sin(time * 5 + y * 0.9 + sheetBase[i * 3] * 0.7) * 0.34 * fall);
      }
      p.needsUpdate = true;
      for (const f of foams) {
        const k = 1 + Math.sin(time * 3.2 + f.o) * 0.22;
        f.blob.scale.set(f.s * k, 0.45 * k, f.s * k);
      }
      for (const m of mists) m.puff.position.y = m.y + Math.sin(time * 0.9 + m.o) * 0.5;
      mistMat.opacity = 0.2 + 0.1 * (Math.sin(time * 1.4) + 1) / 2;
    });
  }

  // give every leafy canopy the same wind sway as the grass (skip trunks/snow)
  group.traverse((o) => {
    if (o.isMesh && o.material && o.material.map === LEAF && !o.material.userData.wind) {
      applyWind(o.material, 0.32);
    }
  });

  group.userData.trunks = trunks;
  group.userData.tick = (time, dt) => { windTime.value = time; for (const t of tickers) t(time, dt); };
  return group;
}
