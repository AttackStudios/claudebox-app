// Backpacking scenery: dense pine forest, rocks, canyon hoodoos + cacti,
// the lakeside dock, crystal cave, the volcano road tunnel, campsite rings,
// and the starting lodge with its cozy lights. Returns collision + lamp data.

import * as THREE from 'three';
import {
  WORLD, ROADS, ROUNDABOUTS, PARKING_LOTS, CAMPSITES, height, roadInfo, regionAt, waterAt, inTunnel,
} from '/shared/bp/worldgen.js';
import { mulberry32 } from '/shared/noise.js';
import { planks, bark, rockStrata, lavaGlow, tentFabric, plaid } from '../textures.js';

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

function scatter(rng, count, accept) {
  const out = [];
  let guard = count * 40;
  while (out.length < count && guard-- > 0) {
    const x = (rng() * 2 - 1) * (WORLD.shoreStart + 20);
    const z = (rng() * 2 - 1) * (WORLD.shoreStart + 20);
    if (accept(x, z)) out.push({ x, z, y: height(x, z), r: rng(), s: 0.7 + rng() * 0.8 });
  }
  return out;
}

function instanced(geo, mat, spots, place) {
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

export function buildProps(sky, quality = 'high') {
  const rng = mulberry32(WORLD.seed + 9);
  const group = new THREE.Group();
  group.name = 'props';
  const q = quality === 'low' ? 0.5 : 1;
  const trunks = [];      // soft collision circles
  const platforms = [];   // walkable rectangles { minX, maxX, minZ, maxZ, y }

  const clearOfRoad = (x, z, m = 1.6) => roadInfo(x, z).dist > roadInfo(x, z).width * m;

  // ================= PINE FOREST (dense) =================
  const barkTex = bark();
  const pineOk = (x, z) => {
    const reg = regionAt(x, z);
    if (!['Forest', 'Lakes', 'Lodge'].includes(reg)) return false;
    if (waterAt(x, z) || height(x, z) < 1.2) return false;
    if (Math.hypot(x - WORLD.lodge.x, z - WORLD.lodge.z) < 38) return false;
    for (const c of CAMPSITES) if (Math.hypot(x - c.x, z - c.z) < c.r + 3) return false;
    return clearOfRoad(x, z);
  };
  // general forest + a corridor pass that crowds pines along the roads so
  // night drives feel like tunnels of trees (like the reference footage)
  const pines = scatter(rng, Math.floor(7000 * q), pineOk)
    .concat(scatter(rng, Math.floor(2200 * q), (x, z) => {
      const ri = roadInfo(x, z);
      return ri.dist > ri.width * 1.5 && ri.dist < 48 && pineOk(x, z);
    }));
  group.add(
    instanced(new THREE.CylinderGeometry(0.22, 0.42, 6, 7), lambert('#6b5138', { map: barkTex }), pines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2.6, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(2.3, 5.4, 8), lambert('#2f5428'), pines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 5.4 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(1.7, 4.0, 8), lambert('#3a6a31'), pines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 7.6 * sp.s, sp.z); E.set(0, sp.r * 6 + 0.5, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(1.1, 2.6, 8), lambert('#4f8a42'), pines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 9.6 * sp.s, sp.z); E.set(0, sp.r * 6 + 1, 0); S.setScalar(sp.s); })
  );
  for (const t of pines) trunks.push({ x: t.x, z: t.z, r: 0.65 * t.s });

  // snowy pines on the peaks
  const snowPines = scatter(rng, Math.floor(900 * q), (x, z) => {
    const h = height(x, z);
    return regionAt(x, z) === 'Peaks' && h > 8 && h < 52 && clearOfRoad(x, z);
  });
  group.add(
    instanced(new THREE.CylinderGeometry(0.2, 0.36, 4.6, 7), lambert('#5d4632'), snowPines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 2, sp.z); E.set(0, 0, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(1.9, 4.6, 8), lambert('#3c6648'), snowPines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 4.6 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.ConeGeometry(1.3, 1.6, 8), lambert('#eef2f8'), snowPines,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 6.8 * sp.s, sp.z); E.set(0, sp.r * 6 + 0.3, 0); S.setScalar(sp.s); })
  );
  for (const t of snowPines) trunks.push({ x: t.x, z: t.z, r: 0.55 * t.s });

  // ferns carpeting the forest floor
  const ferns = scatter(rng, Math.floor(2400 * q), (x, z) =>
    ['Forest', 'Lakes'].includes(regionAt(x, z)) && !waterAt(x, z) && height(x, z) > 1.2 && clearOfRoad(x, z, 1.0));
  group.add(
    instanced(new THREE.ConeGeometry(0.55, 0.5, 5), lambert('#3f7a35'), ferns,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.22, sp.z); E.set((sp.r - 0.5) * 0.6, sp.r * 6, (sp.r - 0.5) * 0.6); S.set(sp.s * 1.3, sp.s * 0.7, sp.s * 1.3); })
  );

  // bushes + rocks everywhere
  const bushes = scatter(rng, Math.floor(260 * q), (x, z) =>
    !waterAt(x, z) && height(x, z) > 1 && clearOfRoad(x, z, 1.1) && regionAt(x, z) !== 'Volcano');
  group.add(
    instanced(new THREE.IcosahedronGeometry(0.7, 1), lambert('#4a7a3a'), bushes,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.4 * sp.s, sp.z); E.set(sp.r, sp.r * 6, 0); S.set(sp.s * 1.2, sp.s * 0.75, sp.s * 1.2); })
  );
  const rocks = scatter(rng, Math.floor(170 * q), (x, z) => !waterAt(x, z) && clearOfRoad(x, z, 1.1));
  group.add(
    instanced(new THREE.DodecahedronGeometry(0.8, 0), lambert('#7e7468'), rocks,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 0.25 * sp.s, sp.z); E.set(sp.r * 3, sp.r * 7, sp.r); S.set(sp.s, sp.s * 0.7, sp.s); })
  );

  // ================= CANYON: hoodoos + cacti =================
  const strata = rockStrata();
  const hoodoos = scatter(rng, Math.floor(26 * q), (x, z) =>
    regionAt(x, z) === 'Canyon' && clearOfRoad(x, z) && height(x, z) > 6);
  group.add(
    instanced(new THREE.CylinderGeometry(1.2, 2.2, 9, 9), lambert('#b97a4e', { map: strata }), hoodoos,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 4 * sp.s, sp.z); E.set(0, sp.r * 6, (sp.r - 0.5) * 0.1); S.setScalar(sp.s * (0.8 + sp.r)); }),
    instanced(new THREE.DodecahedronGeometry(1.7, 0), lambert('#c98a58'), hoodoos,
      (sp, P, E, S) => { P.set(sp.x, sp.y + (8.5 + sp.r) * sp.s, sp.z); E.set(sp.r * 2, sp.r * 5, 0); S.set(sp.s, sp.s * 0.6, sp.s); })
  );
  const cacti = scatter(rng, Math.floor(60 * q), (x, z) => regionAt(x, z) === 'Canyon' && clearOfRoad(x, z));
  group.add(
    instanced(new THREE.CapsuleGeometry(0.32, 1.9, 5, 9), lambert('#5b8a4a'), cacti,
      (sp, P, E, S) => { P.set(sp.x, sp.y + 1.25, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); }),
    instanced(new THREE.CapsuleGeometry(0.18, 0.7, 5, 8), lambert('#699a55'), cacti,
      (sp, P, E, S) => { P.set(sp.x + 0.5 * sp.s, sp.y + 1.5 * sp.s, sp.z); E.set(0, 0, -0.9); S.setScalar(sp.s); })
  );

  // ================= LAVA + caldera glow =================
  {
    const v = WORLD.volcano;
    const lava = new THREE.Mesh(
      new THREE.CircleGeometry(v.craterR * 0.97, 26),
      new THREE.MeshBasicMaterial({ map: lavaGlow() })
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(v.x, v.lavaLevel, v.z);
    group.add(lava);
    sky.addLamp({ x: v.x, y: v.lavaLevel + 3, z: v.z, color: '#ff6a1a', intensity: 3, range: 60, flicker: 0.6 });
    group.userData.lavaMesh = lava;
  }

  // ================= ROAD TUNNELS (solid half-pipe shells) =================
  // The old widely-spaced torus arches read as a broken rib cage from above.
  // Each tunnel is now a continuous rock tube: overlapping half-cylinder
  // segments that follow the roadbed's slope, with portal rings at both ends.
  for (const t of WORLD.tunnels) {
    const rockMat = lambert('#4a423c', { side: THREE.DoubleSide });
    const len = Math.hypot(t.bx - t.ax, t.bz - t.az);
    const segs = Math.max(6, Math.round(len / 14));
    const segLen = len / segs;
    const yaw = Math.atan2(t.bx - t.ax, t.bz - t.az);
    for (let i = 0; i < segs; i++) {
      const k = (i + 0.5) / segs;
      const x = t.ax + (t.bx - t.ax) * k;
      const z = t.az + (t.bz - t.az) * k;
      const ri = roadInfo(x, z);
      const y = height(ri.px, ri.pz);
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(t.r * 0.62, t.r * 0.62, segLen * 1.22, 14, 1, true, 0, Math.PI),
        rockMat);
      shell.rotation.order = 'YXZ';
      shell.rotation.y = yaw;
      shell.rotation.x = -Math.PI / 2;   // lay the tube along the road
      shell.position.set(x, y + 0.35, z);
      group.add(shell);
      if (i % 2 === 1) {
        const sideX = Math.cos(yaw) * t.r * 0.5 * (i % 4 === 1 ? 1 : -1);
        const sideZ = -Math.sin(yaw) * t.r * 0.5 * (i % 4 === 1 ? 1 : -1);
        addTorch(group, sky, x + sideX, y, z + sideZ);
      }
    }
    // chunky portal rings at the two mouths
    for (const [px2, pz2] of [[t.ax, t.az], [t.bx, t.bz]]) {
      const ri = roadInfo(px2, pz2);
      const y = height(ri.px, ri.pz);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(t.r * 0.62, t.r * 0.2, 8, 14, Math.PI), rockMat);
      ring.position.set(px2, y + 0.35, pz2);
      ring.rotation.y = yaw;
      group.add(ring);
    }
  }

  // ================= CRYSTAL CAVE (a real walk-in cave) =================
  {
    const cv = WORLD.cave;
    const cy = height(cv.x, cv.z);
    const R = cv.r * 1.35;
    // the entrance faces the access spur (SW of the cave)
    const openAng = Math.atan2(-0.6, -0.8);           // toward the spur end
    const gap = 1.1;                                    // doorway width in radians
    // dome shell with a wedge cut out for the doorway
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(R, 20, 10, openAng + gap / 2, Math.PI * 2 - gap, 0, Math.PI / 2),
      lambert('#564f48', { side: THREE.DoubleSide })
    );
    shell.position.set(cv.x, cy - 0.6, cv.z);
    shell.scale.set(1, 0.85, 1.05);
    group.add(shell);
    // rocky entrance lip framing the doorway
    for (const s of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 0), lambert('#4f4842'));
      const a = openAng + s * (gap / 2 + 0.18);
      jamb.position.set(cv.x + Math.cos(a) * R * 0.96, cy + 1.4, cv.z + Math.sin(a) * R * 0.96);
      jamb.rotation.set(s, s * 1.7, 0);
      group.add(jamb);
    }
    // WALL COLLISION: a ring of soft colliders, with a gap at the doorway so
    // you must walk through the opening (no more walking through the dome)
    const segs = 22;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      let da = a - openAng;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) < gap / 2 + 0.1) continue;       // leave the doorway open
      trunks.push({ x: cv.x + Math.cos(a) * R * 0.92, z: cv.z + Math.sin(a) * R * 0.92, r: 1.1 });
    }
    // crystals glowing inside
    const crystalA = new THREE.MeshLambertMaterial({ color: '#8fd8ec', emissive: '#1e6a82' });
    const crystalB = new THREE.MeshLambertMaterial({ color: '#c9a0f5', emissive: '#5a2a8a' });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = R * (0.25 + (i % 3) * 0.18);
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.55 + (i % 3) * 0.3, 0), i % 2 ? crystalA : crystalB);
      cr.position.set(cv.x + Math.cos(a) * d, cy + 0.3, cv.z + Math.sin(a) * d);
      cr.rotation.set(i * 0.7, i * 1.3, 0);
      cr.scale.y = 1.8 + (i % 3);
      group.add(cr);
    }
    sky.addLamp({ x: cv.x, y: cy + 3, z: cv.z, color: '#7ecbe8', intensity: 2.4, range: 32, flicker: 0.15 });

    // furnished interior: a little hideout camp tucked against the back wall
    const back = openAng + Math.PI;                      // opposite the doorway
    const bx = cv.x + Math.cos(back) * R * 0.5, bz = cv.z + Math.sin(back) * R * 0.5;
    // bedroll
    const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.4, 5, 10), lambert('#4a7ec0', { map: tentFabric() }));
    roll.rotation.set(Math.PI / 2, 0, back); roll.scale.y = 0.5;
    roll.position.set(bx, cy + 0.2, bz);
    // rug under it
    const rug = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 1.7), lambert('#9c5a4a', { map: plaid() }));
    rug.position.set(bx, cy + 0.03, bz); rug.rotation.y = back;
    // crate + small lantern table
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), lambert('#7a5a36', { map: planks() }));
    const ca = back - 0.9;
    crate.position.set(cv.x + Math.cos(ca) * R * 0.45, cy + 0.35, cv.z + Math.sin(ca) * R * 0.45);
    crate.rotation.y = ca;
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.22), new THREE.MeshLambertMaterial({ color: '#ffdf9a', emissive: '#a8741a' }));
    lantern.position.set(crate.position.x, cy + 0.86, crate.position.z);
    group.add(rug, roll, crate, lantern);
    sky.addLamp({ x: crate.position.x, y: cy + 1, z: crate.position.z, color: '#ffcf7a', intensity: 1.6, range: 14, flicker: 0.3 });
    // a couple of storage barrels by the wall
    for (const ba of [back + 0.7, back + 1.1]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.86, 12), lambert('#6b5236', { map: planks() }));
      barrel.position.set(cv.x + Math.cos(ba) * R * 0.62, cy + 0.43, cv.z + Math.sin(ba) * R * 0.62);
      group.add(barrel);
    }
  }

  // ================= SOUTH LAKE DOCK =================
  {
    const L = WORLD.lakeSouth;
    const plankTex = planks();
    const deckMat = lambert('#b08a5a', { map: plankTex });
    const ang = -0.5;
    const dirX = Math.sin(ang), dirZ = Math.cos(ang);
    const sx = L.x + dirX * -L.r * 0.55, sz = L.z + dirZ * -L.r * 0.55; // shore end
    const dock = new THREE.Group();
    const deckY = L.surface + 0.55;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.22, 26), deckMat);
    deck.position.set(sx + dirX * 13, deckY, sz + dirZ * 13);
    deck.rotation.y = ang;
    dock.add(deck);
    const endDeck = new THREE.Mesh(new THREE.BoxGeometry(8, 0.22, 6), deckMat);
    endDeck.position.set(sx + dirX * 27, deckY, sz + dirZ * 27);
    endDeck.rotation.y = ang;
    dock.add(endDeck);
    for (let i = 0; i < 6; i++) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.4, 7), lambert('#6b5138'));
        post.position.set(sx + dirX * (4 + i * 5) + Math.cos(ang) * side * 1.5, deckY - 1, sz + dirZ * (4 + i * 5) - Math.sin(ang) * side * 1.5);
        dock.add(post);
      }
    }
    group.add(dock);
    // walkable strips (axis-aligned approximations along the dock)
    for (let i = 0; i < 9; i++) {
      const px = sx + dirX * (2 + i * 3), pz = sz + dirZ * (2 + i * 3);
      platforms.push({ minX: px - 1.8, maxX: px + 1.8, minZ: pz - 1.8, maxZ: pz + 1.8, y: deckY + 0.11 });
    }
    const px = sx + dirX * 27, pz = sz + dirZ * 27;
    platforms.push({ minX: px - 4, maxX: px + 4, minZ: pz - 3.2, maxZ: pz + 3.2, y: deckY + 0.11 });
  }

  // ================= CAMPSITE CLEARINGS =================
  for (const c of CAMPSITES) {
    const cy = height(c.x, c.z);
    // stone fire ring
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), lambert('#6e675e'));
      st.position.set(c.x + Math.cos(a) * 1.1, cy + 0.18, c.z + Math.sin(a) * 1.1);
      st.rotation.set(i, i * 2, 0);
      group.add(st);
    }
    // log benches
    for (const a of [0.8, 2.6]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 3, 9), lambert('#6b5138', { map: bark() }));
      log.position.set(c.x + Math.cos(a) * 3.2, cy + 0.34, c.z + Math.sin(a) * 3.2);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = a + Math.PI / 2;
      group.add(log);
    }
  }

  // ================= THE LODGE =================
  buildLodge(group, sky, trunks, platforms);

  // ================= PARKING LOTS (pergola + marked spaces + lights) =======
  for (const lot of PARKING_LOTS) {
    const ly = height(lot.x, lot.z);
    const g = new THREE.Group();
    g.position.set(lot.x, ly, lot.z);
    g.rotation.y = lot.ry;
    // paved pad
    // thick slab sunk deep: terrain interpolates between grid vertices, so a
    // thin pad shows sliver gaps at the edges — the slab covers any sag
    const pad = new THREE.Mesh(new THREE.BoxGeometry(lot.w, 1.8, lot.d), lambert('#46464a'));
    pad.position.y = 0.27 - 0.9;
    pad.receiveShadow = true;
    g.add(pad);
    // painted parking-space lines (down the length)
    const spaces = Math.floor(lot.w / 6);
    for (let i = 1; i < spaces; i++) {
      const lx = -lot.w / 2 + i * (lot.w / spaces);
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, lot.d * 0.8), lambert('#d8d2c0'));
      line.position.set(lx, 0.28, 0);
      g.add(line);
    }
    // pergola: corner posts + slatted roof beams
    const postMat = lambert('#6e5236');
    const ph = 4.2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, ph, 0.4), postMat);
      post.position.set(sx * (lot.w / 2 - 1), ph / 2, sz * (lot.d / 2 - 1));
      g.add(post);
    }
    for (let i = 0; i <= 8; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(lot.w - 1.4, 0.16, 0.3), postMat);
      beam.position.set(0, ph + 0.1, -lot.d / 2 + 1 + i * ((lot.d - 2) / 8));
      g.add(beam);
    }
    group.add(g);
    // string-light glow + lamps at the corners (use world coords)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wx = lot.x + (sx * (lot.w / 2 - 1)) * Math.cos(lot.ry) - (sz * (lot.d / 2 - 1)) * Math.sin(lot.ry);
      const wz = lot.z + (sx * (lot.w / 2 - 1)) * Math.sin(lot.ry) + (sz * (lot.d / 2 - 1)) * Math.cos(lot.ry);
      sky.addLamp({ x: wx, y: ly + ph, z: wz, color: '#ffd98a', intensity: 1.4, range: 22, flicker: 0.05 });
    }
    // pergola posts block the player a little
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      trunks.push({ x: lot.x + sx * (lot.w / 2 - 1), z: lot.z + sz * (lot.d / 2 - 1), r: 0.6 });
    }
  }

  // ================= ROUNDABOUT ISLANDS (grassy centre + sign) =============
  for (const rb of ROUNDABOUTS) {
    const ry = height(rb.x, rb.z);
    const island = new THREE.Mesh(new THREE.CylinderGeometry(rb.r * 0.62, rb.r * 0.7, 1.4, 20), lambert('#5b8a42'));
    island.position.set(rb.x, ry + 0.5, rb.z);
    group.add(island);
    // a little tree + a few rocks on the island
    const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 4, 7), lambert('#6b5138'));
    tt.position.set(rb.x, ry + 2.6, rb.z);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 8), lambert('#3a6a31'));
    canopy.position.set(rb.x, ry + 6.5, rb.z);
    group.add(tt, canopy);
    trunks.push({ x: rb.x, z: rb.z, r: rb.r * 0.66 });   // can't drive over the island
  }

  group.userData.trunks = trunks;
  group.userData.platforms = platforms;
  return group;
}

function addTorch(group, sky, x, groundY, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.9, 7), lambert('#5d4632'));
  pole.position.set(x, groundY + 0.95, z);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.25, 8), lambert('#3a342e'));
  bowl.position.set(x, groundY + 1.95, z);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.45, 7),
    new THREE.MeshBasicMaterial({ color: '#ffb347' })
  );
  flame.position.set(x, groundY + 2.25, z);
  group.add(pole, bowl, flame);
  sky.addLamp({ x, y: groundY + 2.2, z, color: '#ffaa55', intensity: 1.8, range: 16, flicker: 0.7 });
}

function buildLodge(group, sky, trunks, platforms) {
  const lg = WORLD.lodge;
  const baseY = height(lg.x, lg.z);
  const lodge = new THREE.Group();
  const plankTex = planks();
  const wall = lambert('#9a7349', { map: plankTex });
  const darkWood = lambert('#6b5138');
  const W = 22, D = 16, H = 6;

  // raised plank floor + porch
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W + 8, 0.5, D + 8), lambert('#b08a5a', { map: plankTex }));
  floor.position.set(0, 0.55, 0);
  lodge.add(floor);
  // stone foundation: fills the gap between the raised floor and the terrain
  // (which sags slightly between mesh vertices) all the way around
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(W + 7.6, 8, D + 7.6), lambert('#7e7468'));
  foundation.position.set(0, 0.32 - 4, 0);
  lodge.add(foundation);
  platforms.push({ minX: lg.x - (W + 8) / 2, maxX: lg.x + (W + 8) / 2, minZ: lg.z - (D + 8) / 2, maxZ: lg.z + (D + 8) / 2, y: baseY + 0.8 });

  // walls (south wall has a big doorway gap)
  const mkWall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
    m.position.set(x, y, z);
    lodge.add(m);
  };
  mkWall(W, H, 0.6, 0, 0.8 + H / 2, -D / 2);            // back (north)
  mkWall(0.6, H, D, -W / 2, 0.8 + H / 2, 0);            // west
  mkWall(0.6, H, D, W / 2, 0.8 + H / 2, 0);             // east
  mkWall(W / 2 - 2.2, H, 0.6, -(W / 4 + 1.1), 0.8 + H / 2, D / 2);  // front left
  mkWall(W / 2 - 2.2, H, 0.6, W / 4 + 1.1, 0.8 + H / 2, D / 2);     // front right
  mkWall(4.4, 1.6, 0.6, 0, 0.8 + H - 0.8, D / 2);       // door header

  // gabled roof
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(W + 3, 0.4, D * 0.72), lambert('#54403a'));
    panel.position.set(0, 0.8 + H + 1.7, side * D * 0.26);
    panel.rotation.x = -side * 0.5;
    lodge.add(panel);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(W + 3.4, 0.5, 1), darkWood);
  ridge.position.set(0, 0.8 + H + 3.05, 0);
  lodge.add(ridge);

  // stone chimney + interior fireplace
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(2.2, H + 6, 2.2), lambert('#7e7468'));
  chimney.position.set(-W / 2 + 1.6, 0.8 + (H + 6) / 2 - 0.4, -D / 2 + 2.6);
  lodge.add(chimney);
  const hearth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 1.2), lambert('#6e675e'));
  hearth.position.set(-W / 2 + 1.7, 0.8 + 1.2, -D / 2 + 3.4);
  lodge.add(hearth);
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 8), new THREE.MeshBasicMaterial({ color: '#ffa040' }));
  fire.position.set(-W / 2 + 1.7, 1.6, -D / 2 + 3.6);
  lodge.add(fire);

  // windows (emissive at night) + porch posts + couches + rug
  const windowMat = new THREE.MeshBasicMaterial({ color: '#ffd98a' });
  for (const wx of [-W / 4, W / 4]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 0.2), windowMat);
    win.position.set(wx, 0.8 + 3, -D / 2 - 0.25);
    lodge.add(win);
  }
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 2.6), windowMat);
    win.position.set(side * (W / 2 + 0.25), 0.8 + 3, 2);
    lodge.add(win);
  }
  for (const px of [-W / 2 - 2.6, -W / 4, W / 4, W / 2 + 2.6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.4, 8), darkWood);
    post.position.set(px, 0.8 + 2.2, D / 2 + 3.4);
    lodge.add(post);
  }
  const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(W + 7, 0.35, 5), lambert('#54403a'));
  porchRoof.position.set(0, 0.8 + 4.5, D / 2 + 2.6);
  porchRoof.rotation.x = 0.12;
  lodge.add(porchRoof);

  for (const [cx, cz, ry] of [[-4, -2, 0.4], [4, -2, -0.4], [0, -4.5, 0]]) {
    const couch = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 1.4), lambert('#a8443c'));
    seat.position.y = 1.3;
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 0.4), lambert('#963c34'));
    back.position.set(0, 1.85, -0.55);
    couch.add(seat, back);
    couch.position.set(cx, 0, cz);
    couch.rotation.y = ry;
    lodge.add(couch);
  }
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.06, 18), lambert('#b86a4a'));
  rug.position.set(0, 0.85, -1);
  lodge.add(rug);

  lodge.position.set(lg.x, baseY, lg.z);
  lodge.rotation.y = 0; // door faces +z (south, toward the road)
  group.add(lodge);

  // cozy lights: hearth, windows, porch string lights
  sky.addLamp({ x: lg.x - W / 2 + 2, y: baseY + 2.4, z: lg.z - D / 2 + 4, color: '#ffaa55', intensity: 2.4, range: 22, flicker: 0.6 });
  sky.addLamp({ x: lg.x, y: baseY + 4, z: lg.z, color: '#ffd98a', intensity: 1.6, range: 26, flicker: 0 });
  // porch string lights
  const stringMat = new THREE.MeshBasicMaterial({ color: '#ffe2a0' });
  for (let i = 0; i < 9; i++) {
    const k = i / 8;
    const bx = lg.x - (W + 6) / 2 + (W + 6) * k;
    const by = baseY + 4.9 - Math.sin(k * Math.PI) * 0.45;
    const bz = lg.z + D / 2 + 4.6;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), stringMat);
    bulb.position.set(bx, by, bz);
    group.add(bulb);
  }
  sky.addLamp({ x: lg.x, y: baseY + 4.6, z: lg.z + D / 2 + 4.6, color: '#ffe2a0', intensity: 1.8, range: 20, flicker: 0 });

  // lodge walls block movement (approximate with trunk circles along walls)
  for (let i = -5; i <= 5; i++) {
    trunks.push({ x: lg.x + i * 2, z: lg.z - D / 2, r: 1 });
    if (Math.abs(i * 2) > 3) trunks.push({ x: lg.x + i * 2, z: lg.z + D / 2, r: 1 }); // doorway gap
  }
  for (let i = -3; i <= 3; i++) {
    trunks.push({ x: lg.x - W / 2, z: lg.z + i * 2.2, r: 1 });
    trunks.push({ x: lg.x + W / 2, z: lg.z + i * 2.2, r: 1 });
  }
}

// water surfaces for the lakes + sea
export function buildWater() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#3d87b8', transparent: true, opacity: 0.82 });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size * 4, WORLD.size * 4, 16, 16), mat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = WORLD.seaLevel - 0.05;
  group.add(sea);
  for (const L of [WORLD.lakeWest, WORLD.lakeSouth]) {
    const lake = new THREE.Mesh(new THREE.CircleGeometry(L.r * 1.06, 30), mat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(L.x, L.surface, L.z);
    group.add(lake);
  }
  group.userData.tick = (time) => {
    sea.position.y = WORLD.seaLevel - 0.05 + Math.sin(time * 0.5) * 0.05;
  };
  return group;
}
