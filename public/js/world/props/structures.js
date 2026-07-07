// Built structures: the red barn + bell tower + cottages + picket fences +
// wishing well + lamp posts of the village, the sanctuary's hospital and
// chain-link pens, the forest A-frame cabin, desert rock arches, and the
// ruined gateway on the Skylands garden island.

import * as THREE from 'three';
import { WORLD, groundAt, skySurface } from '/shared/worldgen.js';
import { lambert, instanced, glowSprite } from './lib.js';
import { woodPlanks, plaster, shingles, cobblestone, chainlink, ruinStone } from '../textures.js';

const Y = (x, z) => groundAt(x, z);

function box(parent, mat, w, h, d, x, y, z, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.rotation.z = rz;
  parent.add(m);
  return m;
}

export function buildStructures(rng, q) {
  const group = new THREE.Group();
  group.name = 'structures';
  const trunks = [];
  const tickers = [];

  const vil = WORLD.village, sa = WORLD.sanctuary, fo = WORLD.forest, de = WORLD.desert;

  // shared materials
  const whiteMat = lambert('#f4f0e6', { map: plaster() });
  const redBarnMat = lambert('#c03a2e', { map: woodPlanks('#c03a2e', '#8a2820') });
  const woodMat = lambert('#8a6a48', { map: woodPlanks() });
  const darkWoodMat = lambert('#6e4a30');
  const grayRoofMat = lambert('#ffffff', { map: shingles() });
  const brownRoofMat = lambert('#ffffff', { map: shingles('#8a6a50', '#665040') });
  const stoneMat = lambert('#9a948a', { map: cobblestone() });
  const ruinMat = lambert('#e2dccf', { map: ruinStone() });

  // ================= THE BARN (red, white gambrel roof) =================
  {
    const b = vil.barn;
    const y = Y(b.x, b.z);
    const barn = new THREE.Group();
    box(barn, redBarnMat, 10, 6, 8, 0, 3, 0);
    // gambrel roof: steep lower panels + shallow upper panels, white
    const roofMat = whiteMat;
    box(barn, roofMat, 0.35, 4.6, 8.8, -4.6, 7.0, 0, 0, 0.5);
    box(barn, roofMat, 0.35, 4.6, 8.8, 4.6, 7.0, 0, 0, -0.5);
    box(barn, roofMat, 0.35, 3.6, 8.8, -1.55, 9.15, 0, 0, 1.15);
    box(barn, roofMat, 0.35, 3.6, 8.8, 1.55, 9.15, 0, 0, -1.15);
    box(barn, roofMat, 1.4, 0.4, 8.8, 0, 9.9, 0);                     // ridge cap
    // gable in-fill (red) under the roofline
    const gable = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 4.9, 7.6, 4, 1), redBarnMat);
    gable.rotation.z = Math.PI / 2;
    gable.rotation.y = Math.PI / 2;
    gable.scale.set(0.78, 1, 1);
    gable.position.set(0, 6.4, 0);
    barn.add(gable);
    // big doors + white trim + loft window
    box(barn, darkWoodMat, 3.4, 4, 0.3, 0, 2, 4.05);
    box(barn, whiteMat, 0.3, 4, 0.4, -1.85, 2, 4.08);
    box(barn, whiteMat, 0.3, 4, 0.4, 1.85, 2, 4.08);
    box(barn, whiteMat, 4.1, 0.3, 0.4, 0, 4.1, 4.08);
    box(barn, whiteMat, 1.4, 1.4, 0.2, 0, 7.2, 4.02);
    box(barn, darkWoodMat, 1.0, 1.0, 0.24, 0, 7.2, 4.06);
    barn.position.set(b.x, y, b.z);
    barn.rotation.y = b.ry;
    group.add(barn);
    trunks.push({ x: b.x, z: b.z, r: 6.5 });
  }

  // ================= BELL TOWER =================
  {
    const b = vil.bell;
    const y = Y(b.x, b.z);
    const t = new THREE.Group();
    box(t, redBarnMat, 4.6, 5.5, 4.6, 0, 2.75, 0);                  // base building
    box(t, grayRoofMat, 5.4, 0.5, 5.4, 0, 5.75, 0);                 // skirt roof
    box(t, redBarnMat, 3.0, 3.4, 3.0, 0, 7.4, 0);                   // tower shaft
    // open cupola: 4 corner posts + pyramid cap
    for (const [px, pz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      box(t, whiteMat, 0.4, 2.4, 0.4, px, 10.2, pz);
    }
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.0, 4), grayRoofMat);
    cap.position.y = 12.5;
    cap.rotation.y = Math.PI / 4;
    t.add(cap);
    // the bell (swings!)
    const bellPivot = new THREE.Group();
    bellPivot.position.set(0, 11.4, 0);
    const bellMat = new THREE.MeshPhongMaterial({ color: '#e8b94a', emissive: '#5d4310', shininess: 60, flatShading: true });
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.9, 1.2, 8), bellMat);
    bell.position.y = -0.7;
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), darkWoodMat);
    clapper.position.y = -1.35;
    bellPivot.add(bell, clapper);
    t.add(bellPivot);
    // door + window
    box(t, darkWoodMat, 1.4, 2.6, 0.3, 0, 1.3, 2.35);
    box(t, whiteMat, 1.1, 1.1, 0.2, 0, 4.2, 2.32);
    t.position.set(b.x, y, b.z);
    t.rotation.y = b.ry;
    group.add(t);
    trunks.push({ x: b.x, z: b.z, r: 3.4 });
    tickers.push((time) => { bellPivot.rotation.z = Math.sin(time * 2.2) * 0.35 * (0.5 + 0.5 * Math.sin(time * 0.21)); });
  }

  // ================= COTTAGES =================
  for (const c of vil.cottages) {
    const y = Y(c.x, c.z);
    const h = new THREE.Group();
    const roofMat = (c.x + c.z) % 2 ? brownRoofMat : grayRoofMat;
    box(h, whiteMat, 6, 3.6, 5, 0, 1.8, 0);
    // simple gable roof from two slabs
    box(h, roofMat, 4.2, 0.32, 5.8, -1.55, 4.6, 0, 0, 0.62);
    box(h, roofMat, 4.2, 0.32, 5.8, 1.55, 4.6, 0, 0, -0.62);
    box(h, roofMat, 0.8, 0.34, 5.8, 0, 5.25, 0);
    box(h, darkWoodMat, 1.2, 2.2, 0.3, 0, 1.1, 2.55);               // door
    box(h, lambert('#9fc8de'), 1.0, 1.0, 0.2, -1.8, 2.0, 2.52);     // windows
    box(h, lambert('#9fc8de'), 1.0, 1.0, 0.2, 1.8, 2.0, 2.52);
    const chimney = box(h, stoneMat, 0.8, 2.2, 0.8, 2.2, 5.0, -1.2);
    h.position.set(c.x, y, c.z);
    h.rotation.y = c.ry;
    group.add(h);
    trunks.push({ x: c.x, z: c.z, r: 4.2 });
  }

  // ================= WISHING WELL =================
  {
    const w = vil.well;
    const y = Y(w.x, w.z);
    const well = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 1.1, 9), stoneMat);
    ring.position.y = 0.55;
    well.add(ring);
    const waterDisc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 9),
      new THREE.MeshLambertMaterial({ color: '#3fa9d8', transparent: true, opacity: 0.85 }));
    waterDisc.rotation.x = -Math.PI / 2;
    waterDisc.position.y = 0.85;
    well.add(waterDisc);
    box(well, darkWoodMat, 0.22, 2.4, 0.22, -1.35, 1.9, 0);
    box(well, darkWoodMat, 0.22, 2.4, 0.22, 1.35, 1.9, 0);
    box(well, darkWoodMat, 3.1, 0.18, 0.18, 0, 3.0, 0);             // crossbar
    const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.4, 4), brownRoofMat);
    wellRoof.position.y = 3.9;
    wellRoof.rotation.y = Math.PI / 4;
    well.add(wellRoof);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.4, 7), woodMat);
    bucket.position.y = 2.0;
    well.add(bucket);
    well.position.set(w.x, y, w.z);
    group.add(well);
    trunks.push({ x: w.x, z: w.z, r: 2.0 });
  }

  // ================= PICKET FENCES (cottage yards) =================
  {
    const posts = [];
    const railSegs = [];
    const toWorld = (c, lx, lz) => {
      const cos = Math.cos(c.ry), sin = Math.sin(c.ry);
      const x = c.x + lx * cos - lz * sin;
      const z = c.z + lx * sin + lz * cos;
      return { x, z, y: Y(x, z) };
    };
    for (const c of vil.cottages.slice(0, 3)) {
      const w = 9.5, d = 8, step = 1.9;
      // walk the yard perimeter as a list of local corners
      const ring = [];
      for (let fx = -w / 2; fx < w / 2 - 0.01; fx += step) ring.push([fx, -d / 2]);
      for (let fz = -d / 2; fz < d / 2 - 0.01; fz += step) ring.push([w / 2, fz]);
      for (let fx = w / 2; fx > -w / 2 + 0.01; fx -= step) ring.push([fx, d / 2]);
      for (let fz = d / 2; fz > -d / 2 + 0.01; fz -= step) ring.push([-w / 2, fz]);
      for (let i = 0; i < ring.length; i++) {
        const a = toWorld(c, ring[i][0], ring[i][1]);
        const b = toWorld(c, ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1]);
        posts.push({ x: a.x, z: a.z, y: a.y, r: c.ry, s: 1 });
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        railSegs.push({
          x: mx, z: mz, y: (a.y + b.y) / 2,
          r: Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2,
          s: Math.hypot(b.x - a.x, b.z - a.z),
        });
      }
    }
    group.add(
      instanced(new THREE.BoxGeometry(0.16, 1.15, 0.16), whiteMat, posts,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.57, sp.z); E.set(0, sp.r, 0); S.setScalar(1); }),
      instanced(new THREE.BoxGeometry(1, 0.13, 0.09), whiteMat, railSegs,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.88, sp.z); E.set(0, sp.r, 0); S.set(sp.s, 1, 1); }),
      instanced(new THREE.BoxGeometry(1, 0.13, 0.09), whiteMat, railSegs,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.44, sp.z); E.set(0, sp.r, 0); S.set(sp.s, 1, 1); })
    );
  }

  // ================= LAMP POSTS (village + sanctuary paths) =================
  {
    const lampSpots = [];
    const lamp = (x, z) => lampSpots.push({ x, z, y: Y(x, z) });
    // around the village green + along the lane
    lamp(vil.well.x + 5, vil.well.z + 5); lamp(vil.well.x - 6, vil.well.z - 4);
    lamp(vil.barn.x - 9, vil.barn.z + 3); lamp(vil.bell.x + 6, vil.bell.z - 5);
    lamp((vil.x + sa.x) / 2, (vil.z + sa.z) / 2);
    // sanctuary plaza (the refs show lit lamps by the pens)
    lamp(sa.hospital.x + 9, sa.hospital.z - 6); lamp(sa.hospital.x - 9, sa.hospital.z - 6);
    lamp(sa.x + 18, sa.z - 14); lamp(sa.x - 30, sa.z + 6);
    const lampGlows = [];
    for (const L of lampSpots) {
      const g = new THREE.Group();
      box(g, lambert('#2a2a30'), 0.18, 3.6, 0.18, 0, 1.8, 0);
      box(g, lambert('#2a2a30'), 1.1, 0.12, 0.12, 0.45, 3.5, 0);
      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.42),
        new THREE.MeshLambertMaterial({ color: '#ffe9a8', emissive: '#b88a20' }));
      lantern.position.set(0.9, 3.2, 0);
      g.add(lantern);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 4), lambert('#2a2a30'));
      cap.position.set(0.9, 3.62, 0);
      cap.rotation.y = Math.PI / 4;
      g.add(cap);
      const glow = glowSprite('#ffd870', 2.6);
      glow.position.set(0.9, 3.2, 0);
      g.add(glow);
      lampGlows.push(glow);
      g.position.set(L.x, L.y, L.z);
      g.rotation.y = (L.x * 13 + L.z * 7) % 6;
      group.add(g);
      trunks.push({ x: L.x, z: L.z, r: 0.5 });
    }
    tickers.push((time) => {
      const f = 0.8 + 0.2 * Math.sin(time * 7) * Math.sin(time * 3.1);
      for (const glow of lampGlows) glow.material.opacity = 0.55 * f;
    });
  }

  // ================= SANCTUARY: HOSPITAL + CHAIN-LINK PENS =================
  {
    const h = sa.hospital;
    const y = Y(h.x, h.z);
    const hosp = new THREE.Group();
    box(hosp, whiteMat, 13, 4.6, 8, 0, 2.3, 0);
    box(hosp, grayRoofMat, 13.8, 0.5, 8.8, 0, 4.85, 0);
    box(hosp, whiteMat, 3.4, 1.4, 8.4, 0, 5.55, 0);                  // roof box
    // red cross over the door
    const crossMat = lambert('#d23a2e');
    box(hosp, crossMat, 0.42, 1.5, 0.18, 0, 3.4, 4.08);
    box(hosp, crossMat, 1.5, 0.42, 0.18, 0, 3.4, 4.08);
    box(hosp, lambert('#7ab8d8'), 2.2, 2.6, 0.3, 0, 1.3, 4.05);      // glass doors
    for (const wx of [-4.4, -2.4, 2.4, 4.4]) {
      box(hosp, lambert('#9fc8de'), 1.3, 1.3, 0.2, wx, 2.6, 4.02);
    }
    hosp.position.set(h.x, y, h.z);
    hosp.rotation.y = h.ry;
    group.add(hosp);
    trunks.push({ x: h.x, z: h.z, r: 7.5 });

    // pens: galvanized posts + translucent chain-link panels
    const linkTex = chainlink();
    const fencePanelMat = new THREE.MeshLambertMaterial({
      map: linkTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.15,
    });
    const postMat = lambert('#7a828c');
    for (const pen of sa.pens) {
      const yP = Y(pen.x, pen.z);
      const H = 2.6;
      for (const [sx, sz, len, ry] of [
        [0, -pen.d / 2, pen.w, 0], [0, pen.d / 2, pen.w, 0],
        [-pen.w / 2, 0, pen.d, Math.PI / 2], [pen.w / 2, 0, pen.d, Math.PI / 2],
      ]) {
        const px = pen.x + sx, pz = pen.z + sz;
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, H), fencePanelMat.clone());
        panel.material.map = linkTex.clone();
        panel.material.map.repeat.set(len / 2.2, H / 2.2);
        panel.material.map.needsUpdate = true;
        panel.position.set(px, yP + H / 2 + 0.1, pz);
        panel.rotation.y = ry;
        group.add(panel);
        // top rail
        box(group, postMat, len, 0.1, 0.1, px, yP + H + 0.15, pz, ry);
      }
      // corner + interval posts (instanced: dozens per pen otherwise)
      const postSpots = [];
      const step = 4;
      for (let fx = -pen.w / 2; fx <= pen.w / 2; fx += step) for (const fz of [-pen.d / 2, pen.d / 2]) postSpots.push([pen.x + fx, pen.z + fz]);
      for (let fz = -pen.d / 2; fz <= pen.d / 2; fz += step) for (const fx of [-pen.w / 2, pen.w / 2]) postSpots.push([pen.x + fx, pen.z + fz]);
      group.add(
        instanced(new THREE.BoxGeometry(0.14, H + 0.3, 0.14), postMat,
          postSpots.map(([px, pz]) => ({ px, pz, py: Y(px, pz) })),
          (sp, P, E, S) => { P.set(sp.px, sp.py + H / 2, sp.pz); E.set(0, 0, 0); S.setScalar(1); })
      );
      // pen pond (decorative inset pool)
      if (pen.pond) {
        const pool = new THREE.Mesh(new THREE.CircleGeometry(Math.min(pen.w, pen.d) * 0.28, 14),
          new THREE.MeshLambertMaterial({ color: '#3fa9d8', transparent: true, opacity: 0.85 }));
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(pen.x, yP + 0.12, pen.z);
        group.add(pool);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(Math.min(pen.w, pen.d) * 0.28, 0.18, 5, 14), stoneMat);
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(pen.x, yP + 0.16, pen.z);
        group.add(rim);
      }
    }
  }

  // ================= FOREST A-FRAME CABIN =================
  {
    const c = fo.cabin;
    const y = Y(c.x, c.z);
    const cab = new THREE.Group();
    // two big sloped roof slabs meeting at a ridge, walls implied
    box(cab, brownRoofMat, 0.4, 6.4, 7, -2.1, 2.6, 0, 0, 0.72);
    box(cab, brownRoofMat, 0.4, 6.4, 7, 2.1, 2.6, 0, 0, -0.72);
    box(cab, brownRoofMat, 0.9, 0.4, 7.4, 0, 5.0, 0);
    // front wall: planks + door + round window
    const front = box(cab, woodMat, 3.6, 4.2, 0.3, 0, 1.7, 3.35);
    box(cab, darkWoodMat, 1.1, 2.2, 0.34, 0, 1.1, 3.42);
    const win = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 10), lambert('#9fc8de'));
    win.rotation.x = Math.PI / 2;
    win.position.set(0, 3.6, 3.42);
    cab.add(win);
    const chim = box(cab, stoneMat, 0.9, 3.2, 0.9, 1.6, 4.4, -1.6);
    cab.position.set(c.x, y, c.z);
    cab.rotation.y = c.ry;
    group.add(cab);
    trunks.push({ x: c.x, z: c.z, r: 4.0 });
  }

  // ================= DESERT ROCK ARCHES =================
  for (const a of de.arches) {
    const y = Y(a.x, a.z);
    const arch = new THREE.Group();
    const rockMat = lambert('#c9742e');
    const rockMatD = lambert('#a4571f');
    const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.8, 10, 7), rockMat);
    leg1.position.set(-5.5, 5, 0);
    leg1.rotation.z = 0.12;
    const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.6, 9, 7), rockMatD);
    leg2.position.set(5.5, 4.5, 0);
    leg2.rotation.z = -0.15;
    const span = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 12.5, 7), rockMat);
    span.rotation.z = Math.PI / 2 - 0.06;
    span.position.set(0, 9.4, 0);
    const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(2.1, 0), rockMatD);
    cap.position.set(-5.5, 10.6, 0);
    arch.add(leg1, leg2, span, cap);
    arch.position.set(a.x, y, a.z);
    arch.rotation.y = a.ry;
    group.add(arch);
    trunks.push({ x: a.x - 5 * Math.cos(a.ry), z: a.z + 5 * Math.sin(a.ry), r: 2.6 });
    trunks.push({ x: a.x + 5 * Math.cos(a.ry), z: a.z - 5 * Math.sin(a.ry), r: 2.4 });
  }

  // ================= SKYLANDS RUINS (garden island) =================
  {
    const isle = WORLD.sky.islands[0];
    const cx = isle.x, cz = isle.z;
    const yAt = (x, z) => (skySurface(x, z) ?? isle.top);
    // broken pillar ring
    const pillarHs = [3.2, 1.4, 4.0, 2.2, 0.9, 3.6];
    pillarHs.forEach((ph, i) => {
      const a = (i / pillarHs.length) * Math.PI * 2 + 0.4;
      const x = cx + Math.cos(a) * 11, z = cz + Math.sin(a) * 11;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, ph, 8), ruinMat);
      p.position.set(x, yAt(x, z) + ph / 2, z);
      group.add(p);
      if (ph > 3) {
        const capStone = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 2.1), ruinMat);
        capStone.position.set(x, yAt(x, z) + ph + 0.25, z);
        group.add(capStone);
      }
    });
    // the gate: two squared columns + lintel + soft glowing doorway
    const gx = cx, gz = cz - 11;
    box(group, ruinMat, 1.6, 7, 1.6, gx - 2.6, yAt(gx - 2.6, gz) + 3.5, gz);
    box(group, ruinMat, 1.6, 7, 1.6, gx + 2.6, yAt(gx + 2.6, gz) + 3.5, gz);
    box(group, ruinMat, 7.6, 1.3, 1.9, gx, yAt(gx, gz) + 7.3, gz);
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 6.2),
      new THREE.MeshBasicMaterial({ color: '#f0b8d8', transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    portal.position.set(gx, yAt(gx, gz) + 3.4, gz);
    group.add(portal);
    const portalGlow = glowSprite('#f0b8d8', 7);
    portalGlow.position.set(gx, yAt(gx, gz) + 3.6, gz);
    group.add(portalGlow);
    // fallen blocks
    for (let i = 0; i < 7; i++) {
      const a = i * 1.7, d = 6 + (i % 3) * 4;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const blk = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.1), ruinMat);
      blk.position.set(x, yAt(x, z) + 0.3, z);
      blk.rotation.set(i * 0.4, i, i * 0.2);
      group.add(blk);
    }
    tickers.push((time) => {
      portal.material.opacity = 0.28 + 0.12 * Math.sin(time * 1.4);
      portalGlow.material.opacity = 0.35 + 0.15 * Math.sin(time * 1.4);
    });
  }

  return { group, trunks, tickers };
}
