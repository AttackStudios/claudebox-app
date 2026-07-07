// Trees, rocks, grass, and flowers for every biome — all InstancedMesh,
// shaped to match the reference map: tiered forest pines, snow-capped ice
// pines + snowy oaks, flat-top acacias, umbrella jungle canopies, banana
// palms, burnt volcano snags, glossy blue Skylands trees, village oaks,
// trimmed sanctuary topiary.

import * as THREE from 'three';
import { WORLD, groundAt, height, lavaAt, waterAt } from '/shared/worldgen.js';
import { lambert, scatter, scatterIn, scatterSky, instanced } from './lib.js';

const dist = (x, z, p) => Math.hypot(x - p.x, z - p.z);

export function buildTrees(rng, q) {
  const group = new THREE.Group();
  group.name = 'trees';
  const trunks = [];
  const addTrunks = (spots, r = 0.7) => { for (const t of spots) trunks.push({ x: t.x, z: t.z, r: r * t.s }); };

  const fo = WORLD.forest, ic = WORLD.ice, de = WORLD.desert, j = WORLD.jungle;
  const vil = WORLD.village, sa = WORLD.sanctuary, v = WORLD.volcano;

  // keep clearings around the landmark anchors
  const forestClear = (x, z) =>
    dist(x, z, fo.pond) > fo.pond.r + 3 && dist(x, z, fo.grotto) > fo.grotto.r * 1.7
    && dist(x, z, fo.cabin) > 12 && dist(x, z, fo.crystal) > 14;
  const iceClear = (x, z) =>
    dist(x, z, ic.pond) > ic.pond.r + 3 && dist(x, z, ic.caveP) > ic.caveP.r * 1.8
    && dist(x, z, ic.grotto) > ic.grotto.r * 1.8 && dist(x, z, ic.crystal) > 14;
  const villageClear = (x, z) =>
    dist(x, z, vil.barn) > 13 && dist(x, z, vil.bell) > 9 && dist(x, z, vil.well) > 7
    && vil.cottages.every((c) => dist(x, z, c) > 10);

  // ============ FOREST PINES (tall, tiered, red-brown trunks) ============
  const pines = scatter(rng, Math.floor(300 * q), (b, x, z) => b === 'forest' && forestClear(x, z))
    .concat(scatter(rng, Math.floor(26 * q), (b, x, z) => b === 'meadow' && z < -60));
  const pineTrunkMat = lambert('#8a5638');
  const pineMatA = lambert('#27583a'), pineMatB = lambert('#33684a');
  group.add(
    instanced(new THREE.CylinderGeometry(0.32, 0.5, 7.5, 6), pineTrunkMat, pines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 3.4 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(2.6, 3.6, 7), pineMatA, pines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 5.4 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(2.0, 3.1, 7), pineMatB, pines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 7.6 * sp.s, sp.z); E.set(0, sp.r * 6 + 0.5, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(1.3, 2.6, 7), pineMatA, pines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 9.6 * sp.s, sp.z); E.set(0, sp.r * 6 + 1, 0); S.setScalar(sp.s); })
  );
  addTrunks(pines, 0.6);

  // ============ ICE: snow-capped pines + snowy oaks ============
  const icePines = scatterIn(rng, Math.floor(120 * q), ic.x, ic.z, ic.r, (b, x, z) =>
    b === 'ice' && iceClear(x, z) && height(x, z) < 45);
  group.add(
    instanced(new THREE.CylinderGeometry(0.3, 0.45, 6.5, 6), lambert('#7a5a42'), icePines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 3 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(2.4, 3.2, 7), lambert('#2c5448'), icePines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 4.9 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(1.9, 1.4, 7), lambert('#f4f8fc'), icePines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 6.2 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(1.5, 2.6, 7), lambert('#33684a'), icePines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 7.3 * sp.s, sp.z); E.set(0, sp.r * 6 + 0.7, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(1.1, 1.1, 7), lambert('#ffffff'), icePines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 8.6 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); })
  );
  addTrunks(icePines, 0.55);

  const snowyOaks = scatterIn(rng, Math.floor(30 * q), ic.x, ic.z, ic.r, (b, x, z) =>
    b === 'ice' && iceClear(x, z) && height(x, z) < 30);
  group.add(
    instanced(new THREE.CylinderGeometry(0.4, 0.6, 4.6, 6), lambert('#6e4a34'), snowyOaks,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2.1 * sp.s, sp.z); E.set(0, sp.r * 6, (sp.r - 0.5) * 0.25); S.setScalar(sp.s); }),
    instanced(new THREE.IcosahedronGeometry(2.5, 0), lambert('#1e3c30'), snowyOaks,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 5 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.set(sp.s * 1.15, sp.s * 0.8, sp.s * 1.15); }),
    instanced(new THREE.IcosahedronGeometry(2.4, 0), lambert('#f4f8fc'), snowyOaks,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 5.9 * sp.s, sp.z); E.set(sp.r * 2, sp.r * 5, 0); S.set(sp.s * 1.1, sp.s * 0.42, sp.s * 1.1); })
  );
  addTrunks(snowyOaks, 0.7);

  // ============ DESERT ACACIAS (flat tops, tilted trunks) ============
  const acacias = scatterIn(rng, Math.floor(64 * q), de.x, de.z, de.r, (b, x, z) =>
    b === 'desert' && height(x, z) < 12 && de.arches.every((a) => dist(x, z, a) > 14));
  group.add(
    instanced(new THREE.CylinderGeometry(0.18, 0.34, 4.6, 5), lambert('#7a5a3c'), acacias,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2.1 * sp.s, sp.z); E.set((sp.r - 0.5) * 0.5, sp.r * 6, (sp.r - 0.5) * 0.5); S.setScalar(sp.s); }),
    instanced(new THREE.CylinderGeometry(2.6, 1.7, 0.8, 8), lambert('#5d8a3c'), acacias,
      (sp, P, E, S) => { P.set(sp.x + (sp.r - 0.5) * 1.6 * sp.s, sp.y + 4.5 * sp.s, sp.z + (sp.r - 0.5) * 1.2 * sp.s); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.CylinderGeometry(1.3, 0.9, 0.55, 7), lambert('#6e9a48'), acacias,
      (sp, P, E, S) => { P.set(sp.x + (sp.r - 0.5) * 3.4 * sp.s, sp.y + 5.2 * sp.s, sp.z - (sp.r - 0.5) * 2 * sp.s); E.set(0, sp.r * 4, 0); S.setScalar(sp.s); })
  );
  addTrunks(acacias, 0.45);

  // ============ JUNGLE: umbrella canopies + bananas + palms ============
  const umbrellas = scatterIn(rng, Math.floor(135 * q), j.x, j.z, j.r, (b, x, z) =>
    b === 'jungle' && !waterAt(x, z) && j.falls.every((f) => dist(x, z, f) > 8));
  const umbTrunk = lambert('#8a7050');
  group.add(
    instanced(new THREE.CylinderGeometry(0.22, 0.38, 13, 6), umbTrunk, umbrellas,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 6 * sp.s, sp.z); E.set((sp.r - 0.5) * 0.12, sp.r * 6, (sp.r - 0.5) * 0.12); S.setScalar(sp.s); }),
    instanced(new THREE.IcosahedronGeometry(3.4, 0), lambert('#2e8a3c'), umbrellas,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 12.6 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.set(sp.s * 1.25, sp.s * 0.4, sp.s * 1.25); }),
    instanced(new THREE.IcosahedronGeometry(2.2, 0), lambert('#46aa50'), umbrellas,
      (sp, P, E, S) => { P.set(sp.x + 1.2 * sp.s, sp.y + 11.6 * sp.s, sp.z - 0.8 * sp.s); E.set(0, sp.r * 9, 0.2); S.set(sp.s, sp.s * 0.35, sp.s); })
  );
  addTrunks(umbrellas, 0.5);

  const bananas = scatterIn(rng, Math.floor(60 * q), j.x, j.z, j.r, (b, x, z) =>
    b === 'jungle' && !waterAt(x, z) && height(x, z) < 12);
  group.add(
    instanced(new THREE.CylinderGeometry(0.28, 0.42, 3.2, 6), lambert('#8aa84e'), bananas,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 1.5 * sp.s, sp.z); E.set(0, sp.r * 6, (sp.r - 0.5) * 0.3); S.setScalar(sp.s); }),
    instanced(new THREE.IcosahedronGeometry(1.9, 0), lambert('#4faa3c'), bananas,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 3.4 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.set(sp.s * 1.7, sp.s * 0.5, sp.s * 0.8); }),
    instanced(new THREE.IcosahedronGeometry(1.9, 0), lambert('#5dbc48'), bananas,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 3.7 * sp.s, sp.z); E.set(0, sp.r * 6 + Math.PI / 2, 0); S.set(sp.s * 1.5, sp.s * 0.45, sp.s * 0.75); })
  );
  addTrunks(bananas, 0.5);

  // ============ BEACH / BAY PALMS ============
  const palms = scatter(rng, Math.floor(36 * q), (b, x, z) => b === 'beach' && height(x, z) > 0.6);
  const isleRng = { n: 0 };
  for (const isle of WORLD.isles) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + isle.x;
      const d = Math.sqrt((i + 1) / 6) * isle.r * 0.55;
      const x = isle.x + Math.cos(a) * d, z = isle.z + Math.sin(a) * d;
      const y = height(x, z);
      if (y > 0.8) palms.push({ x, z, y, r: (i * 0.37 + 0.1) % 1, s: 0.8 + ((i * 53) % 10) / 18 });
    }
  }
  group.add(
    instanced(new THREE.CylinderGeometry(0.22, 0.38, 6, 5), lambert('#9a7048'), palms,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2.6, sp.z); E.set(0.18, sp.r * 6, 0.1); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(2.4, 1.3, 6), lambert('#54b364'), palms,
      (sp, P, E, S) => { P.set(sp.x + 0.9 * sp.s, sp.y + 5.6 * sp.s, sp.z + 0.4 * sp.s); E.set(0, sp.r * 6, 0); S.set(sp.s, sp.s * 0.8, sp.s); })
  );
  addTrunks(palms, 0.5);

  // ============ VOLCANO BURNT SNAGS ============
  const burnt = scatterIn(rng, Math.floor(46 * q), v.x, v.z, v.r * 1.3, (b, x, z) =>
    b === 'volcano' && !lavaAt(x, z) && dist(x, z, v) > v.craterR * 1.6 && dist(x, z, v.grotto) > v.grotto.r * 1.6);
  const charMat = lambert('#1f1a1d');
  group.add(
    instanced(new THREE.CylinderGeometry(0.12, 0.34, 4.4, 5), charMat, burnt,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2 * sp.s, sp.z); E.set((sp.r - 0.5) * 0.35, sp.r * 6, (sp.r - 0.5) * 0.35); S.setScalar(sp.s); }),
    instanced(new THREE.CylinderGeometry(0.05, 0.13, 2.2, 4), charMat, burnt,
      (sp, P, E, S) => { P.set(sp.x + 0.7 * sp.s, sp.y + 3.4 * sp.s, sp.z); E.set(0, sp.r * 6, 1.0); S.setScalar(sp.s); }),
    instanced(new THREE.CylinderGeometry(0.04, 0.11, 1.8, 4), charMat, burnt,
      (sp, P, E, S) => { P.set(sp.x - 0.6 * sp.s, sp.y + 2.9 * sp.s, sp.z + 0.3 * sp.s); E.set(0.5, sp.r * 5, -0.9); S.setScalar(sp.s); })
  );
  addTrunks(burnt, 0.4);

  // ============ VILLAGE OAKS + MEADOW OAKS + BUSHES ============
  const oaks = scatterIn(rng, Math.floor(16 * q), vil.x, vil.z, vil.r, (b, x, z) => b === 'village' && villageClear(x, z))
    .concat(scatter(rng, Math.floor(30 * q), (b, x, z) => b === 'meadow' && z > -80));
  group.add(
    instanced(new THREE.CylinderGeometry(0.45, 0.65, 4.2, 6), lambert('#7a5638'), oaks,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2 * sp.s, sp.z); E.set(0, sp.r * 6, (sp.r - 0.5) * 0.15); S.setScalar(sp.s); }),
    instanced(new THREE.IcosahedronGeometry(2.9, 0), lambert('#4f9a44'), oaks,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 5.6 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.IcosahedronGeometry(2.0, 0), lambert('#5fae50'), oaks,
      (sp, P, E, S) => { P.set(sp.x + 1.2 * sp.s, sp.y + 4.6 * sp.s, sp.z + 0.7 * sp.s); E.set(0, sp.r * 9, 0.3); S.setScalar(sp.s); })
  );
  addTrunks(oaks, 0.8);

  const bushes = scatterIn(rng, Math.floor(40 * q), vil.x, vil.z, vil.r, (b, x, z) => b === 'village' && villageClear(x, z))
    .concat(scatterIn(rng, Math.floor(20 * q), sa.x, sa.z, sa.r, (b) => b === 'sanctuary'));
  group.add(
    instanced(new THREE.IcosahedronGeometry(1.0, 0), lambert('#3f8a3a'), bushes,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.5 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.set(sp.s, sp.s * 0.75, sp.s); })
  );

  // ============ SANCTUARY TOPIARY (trimmed cones on posts) ============
  const topiary = scatterIn(rng, Math.floor(14 * q), sa.x, sa.z, sa.r * 0.95, (b, x, z) =>
    b === 'sanctuary' && dist(x, z, sa.hospital) > 12 && sa.pens.every((p) => Math.abs(x - p.x) > p.w / 2 + 2 || Math.abs(z - p.z) > p.d / 2 + 2));
  group.add(
    instanced(new THREE.CylinderGeometry(0.16, 0.2, 1.6, 5), lambert('#6e4a34'), topiary,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.7, sp.z); E.set(0, 0, 0); S.setScalar(sp.s); }),
    instanced(new THREE.SphereGeometry(0.85, 7, 6), lambert('#2e7a34'), topiary,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 1.9 * sp.s, sp.z); E.set(0, 0, 0); S.setScalar(sp.s); }),
    instanced(new THREE.SphereGeometry(0.55, 7, 6), lambert('#2e7a34'), topiary,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 3.0 * sp.s, sp.z); E.set(0, 0, 0); S.setScalar(sp.s); })
  );
  addTrunks(topiary, 0.4);

  // ============ SKYLANDS GLOSSY BLUE TREES ============
  const skyPond = WORLD.sky.pond;
  const gardenIsle = WORLD.sky.islands[skyPond.island];
  const skyTrees = scatterSky(rng, Math.floor(30 * q), (isle, x, z) =>
    !(isle === gardenIsle && Math.hypot(x - (gardenIsle.x + skyPond.x), z - (gardenIsle.z + skyPond.z)) < skyPond.r + 3)
    && !(isle === gardenIsle && Math.hypot(x - gardenIsle.x, z - gardenIsle.z) < 14));
  const skyTrunkMat = lambert('#b8cada');
  const skyLeafMat = new THREE.MeshPhongMaterial({
    color: '#cfe4f8', emissive: '#23445d', specular: '#ffffff', shininess: 90, flatShading: true,
  });
  group.add(
    instanced(new THREE.CylinderGeometry(0.25, 0.42, 4.6, 6), skyTrunkMat, skyTrees,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2.1 * sp.s, sp.z); E.set(0, sp.r * 6, (sp.r - 0.5) * 0.3); S.setScalar(sp.s); }),
    instanced(new THREE.IcosahedronGeometry(2.4, 0), skyLeafMat, skyTrees,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 5 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.set(sp.s * 1.2, sp.s * 0.75, sp.s * 1.2); }),
    instanced(new THREE.IcosahedronGeometry(1.5, 0), skyLeafMat, skyTrees,
      (sp, P, E, S) => { P.set(sp.x + 1.1 * sp.s, sp.y + 4 * sp.s, sp.z - 0.6 * sp.s); E.set(0, sp.r * 9, 0.35); S.set(sp.s, sp.s * 0.7, sp.s); })
  );
  addTrunks(skyTrees, 0.55);

  // ============ ROCKS ============
  const rocks = scatter(rng, Math.floor(80 * q), (b) => !['ocean', 'lake', 'river', 'village', 'sanctuary'].includes(b));
  group.add(
    instanced(new THREE.DodecahedronGeometry(0.9, 0), lambert('#8d8478'), rocks,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.3 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s, sp.s * 0.7, sp.s); })
  );
  // mossy boulders in the forest + jungle
  const mossy = scatter(rng, Math.floor(42 * q), (b, x, z) => (b === 'forest' && forestClear(x, z)) || b === 'jungle');
  group.add(
    instanced(new THREE.DodecahedronGeometry(1.3, 0), lambert('#7e786c'), mossy,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.45 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s, sp.s * 0.75, sp.s); }),
    instanced(new THREE.IcosahedronGeometry(1.15, 0), lambert('#4f7a3c'), mossy,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.95 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s * 0.95, sp.s * 0.4, sp.s * 0.95); })
  );
  // desert boulder clusters
  const dBoulders = scatterIn(rng, Math.floor(36 * q), de.x, de.z, de.r, (b, x, z) => b === 'desert' && height(x, z) < 12);
  group.add(
    instanced(new THREE.DodecahedronGeometry(1.5, 0), lambert('#9a948c'), dBoulders,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.5 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s * 1.2, sp.s * 0.8, sp.s); })
  );

  // ============ GRASS + FLOWERS ============
  const meadowGrass = scatter(rng, Math.floor(650 * q), (b) => ['meadow', 'village', 'forest'].includes(b));
  group.add(
    instanced(new THREE.ConeGeometry(0.16, 0.8, 4), lambert('#5fb350'), meadowGrass,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.3, sp.z); E.set(sp.r * 0.4 - 0.2, sp.r * 6, 0); S.setScalar(0.7 + sp.r); })
  );
  // jungle floor: dense tall blade clumps
  const jungleGrass = scatterIn(rng, Math.floor(520 * q), j.x, j.z, j.r, (b, x, z) => b === 'jungle' && !waterAt(x, z));
  group.add(
    instanced(new THREE.ConeGeometry(0.22, 1.7, 4), lambert('#8aaa3c'), jungleGrass,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.7, sp.z); E.set(sp.r * 0.5 - 0.25, sp.r * 6, (sp.r - 0.5) * 0.4); S.setScalar(0.7 + sp.r); }),
    instanced(new THREE.ConeGeometry(0.18, 1.3, 4), lambert('#6e9a34'), jungleGrass,
      (sp, P, E, S) => { P.set(sp.x + 0.4, sp.y + 0.55, sp.z + 0.3); E.set((sp.r - 0.5) * 0.5, sp.r * 4, (0.5 - sp.r) * 0.5); S.setScalar(0.6 + sp.r); })
  );
  // savanna gold tufts in the desert
  const savanna = scatterIn(rng, Math.floor(260 * q), de.x, de.z, de.r, (b, x, z) => b === 'desert' && height(x, z) < 11);
  group.add(
    instanced(new THREE.ConeGeometry(0.18, 1.0, 4), lambert('#c2b35e'), savanna,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.4, sp.z); E.set(sp.r * 0.5 - 0.25, sp.r * 6, 0); S.setScalar(0.7 + sp.r); })
  );
  // pale tufts + dried volcano grass
  const skyGrass = scatterSky(rng, Math.floor(150 * q));
  group.add(
    instanced(new THREE.ConeGeometry(0.15, 0.7, 4), lambert('#cfe8c0'), skyGrass,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.28, sp.z); E.set(sp.r * 0.4 - 0.2, sp.r * 6, 0); S.setScalar(0.7 + sp.r); })
  );
  const driedTufts = scatterIn(rng, Math.floor(140 * q), v.x, v.z, v.r * 1.25, (b, x, z) => b === 'volcano' && !lavaAt(x, z));
  group.add(
    instanced(new THREE.ConeGeometry(0.15, 0.7, 4), lambert('#8a7a4e'), driedTufts,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.28, sp.z); E.set(sp.r * 0.5 - 0.25, sp.r * 6, 0); S.setScalar(0.7 + sp.r); })
  );

  const flowers = scatter(rng, Math.floor(150 * q), (b) => b === 'meadow' || b === 'village')
    .concat(scatterIn(rng, Math.floor(70 * q), fo.x, fo.z, fo.r, (b, x, z) => b === 'forest' && forestClear(x, z)));
  const flowerColors = ['#f8d23a', '#f08aa8', '#8a9af8', '#ffffff', '#f2702a'];
  flowerColors.forEach((fc, fi) => {
    const mine = flowers.filter((_, i) => i % flowerColors.length === fi);
    if (!mine.length) return;
    group.add(
      instanced(new THREE.SphereGeometry(0.16, 5, 4), lambert(fc), mine,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.5, sp.z); E.set(0, 0, 0); S.setScalar(0.8 + sp.r * 0.5); })
    );
  });
  // pink + violet blooms on the sky islands
  const skyFlowers = scatterSky(rng, Math.floor(80 * q));
  ['#e88ad2', '#b08af8'].forEach((fc, fi) => {
    const mine = skyFlowers.filter((_, i) => i % 2 === fi);
    if (!mine.length) return;
    group.add(
      instanced(new THREE.SphereGeometry(0.15, 5, 4), lambert(fc), mine,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.4, sp.z); E.set(0, 0, 0); S.setScalar(0.8 + sp.r * 0.4); })
    );
  });

  return { group, trunks };
}
