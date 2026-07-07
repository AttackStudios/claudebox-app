// RS2 town rendering: lawn terrain, asphalt roads + sidewalks, the plaza
// fountain, cottages with porches and doorbells, street lamps, trees.
// Fixed warm golden-hour lighting (no day/night here — always dinner time).

import * as THREE from 'three';
import { WORLD, ROADS, PLOTS, HOUSES, PLAZA, height, roadInfo } from '/shared/rs2/world.js';
import { mulberry32 } from '/shared/noise.js';
import { grassLawn, asphalt, sidewalk, brick, roofShingles, woodFloor } from '../textures.js';

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

export function buildLighting(scene) {
  const sun = new THREE.DirectionalLight('#ffe8c0', 2.1);
  sun.position.set(220, 320, 160);
  const hemi = new THREE.HemisphereLight('#cfe4f4', '#7a9a5a', 0.75);
  const amb = new THREE.AmbientLight('#d8e2ec', 0.5);
  scene.add(sun, hemi, amb);
  scene.fog = new THREE.Fog('#dfe9f2', 260, 1300);
  scene.background = new THREE.Color('#bcd9ee');

  // pooled point lights for restaurant lamps/houses (RS2 is bright, so few needed)
  const pool = [];
  for (let i = 0; i < 10; i++) {
    const pl = new THREE.PointLight('#ffd9a0', 0, 14, 1.8);
    scene.add(pl);
    pool.push(pl);
  }
  const lamps = [];
  return {
    addLamp(l) { const rec = { color: '#ffd9a0', intensity: 1.2, range: 12, on: true, ...l }; lamps.push(rec); return rec; },
    removeLamp(rec) { const i = lamps.indexOf(rec); if (i >= 0) lamps.splice(i, 1); },
    tick(camera) {
      const cx = camera.position.x, cz = camera.position.z;
      const active = lamps.filter((l) => l.on)
        .map((l) => ({ l, d: (l.x - cx) ** 2 + (l.z - cz) ** 2 }))
        .sort((a, b) => a.d - b.d).slice(0, pool.length);
      pool.forEach((pl, i) => {
        const slot = active[i];
        if (!slot) { pl.intensity = 0; return; }
        pl.position.set(slot.l.x, slot.l.y, slot.l.z);
        pl.color.set(slot.l.color);
        pl.distance = slot.l.range;
        pl.intensity = slot.l.intensity;
      });
    },
  };
}

export function buildTerrain() {
  const segments = 180;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const tex = grassLawn();
  tex.repeat.set(110, 110);
  const mesh = new THREE.Mesh(geo, lambert('#7ab35e', { map: tex }));
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRoadsAndPads() {
  const g = new THREE.Group();
  const roadTex = asphalt();
  const walkTex = sidewalk();

  for (const road of ROADS) {
    const p = road.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const tex = roadTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1, len / (road.width * 2));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(road.width, len + road.width), lambert('#ffffff', { map: tex }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -ang;
      mesh.position.set(mx, 2.06, mz);
      g.add(mesh);
      // sidewalks both sides
      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(new THREE.PlaneGeometry(2.4, len + road.width), lambert('#ffffff', { map: walkTex }));
        const wtex = walkTex.clone();
        wtex.needsUpdate = true;
        wtex.repeat.set(1, (len + road.width) / 2.4);
        sw.material = lambert('#ffffff', { map: wtex });
        sw.rotation.x = -Math.PI / 2;
        sw.rotation.z = -ang;
        sw.position.set(mx + Math.cos(ang) * side * (road.width / 2 + 1.2), 2.08, mz - Math.sin(ang) * side * (road.width / 2 + 1.2));
        g.add(sw);
      }
    }
  }

  // plot pads: light concrete with a painted border
  for (const p of PLOTS) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(p.padW, p.padD), lambert('#cfccc2', { map: walkTex }));
    pad.material.map = walkTex.clone();
    pad.material.map.needsUpdate = true;
    pad.material.map.repeat.set(p.padW / 3, p.padD / 3);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(p.x, 2.05, p.z);
    g.add(pad);
    // moped parking square
    const park = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), lambert('#9aa7b8'));
    park.rotation.x = -Math.PI / 2;
    park.position.set(p.mopedX, 2.1, p.mopedZ);
    g.add(park);
  }

  // plaza: brick circle + fountain
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA.r, 36), lambert('#c89a7a', { map: brick() }));
  plaza.material.map.repeat.set(10, 10);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(PLAZA.x, 2.07, PLAZA.z);
  g.add(plaza);
  return g;
}

export function buildPlaza(lights) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 1, 20), lambert('#b8b4ac'));
  base.position.set(PLAZA.x, 2.5, PLAZA.z);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 1.1, 18), lambert('#c8c4bc'));
  bowl.position.set(PLAZA.x, 3.4, PLAZA.z);
  const water = new THREE.Mesh(new THREE.CircleGeometry(3.2, 18), new THREE.MeshLambertMaterial({ color: '#5fb8e8', transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(PLAZA.x, 3.95, PLAZA.z);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 2.4, 12), lambert('#b0aca4'));
  spire.position.set(PLAZA.x, 5, PLAZA.z);
  g.add(base, bowl, water, spire);
  g.userData.fountainWater = water;

  // benches around the fountain
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 0.9), lambert('#9a7048', { map: woodFloor() }));
    seat.position.y = 0.55;
    const back = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 0.14), lambert('#9a7048'));
    back.position.set(0, 1.05, -0.4);
    for (const sx of [-1.2, 1.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.8), lambert('#3a3a3e'));
      leg.position.set(sx, 0.28, 0);
      bench.add(leg);
    }
    bench.add(seat, back);
    bench.position.set(PLAZA.x + Math.cos(a) * 12, 2.1, PLAZA.z + Math.sin(a) * 12);
    bench.rotation.y = -a + Math.PI / 2;
    g.add(bench);
  }
  return g;
}

// cottages: hollow interiors with furniture and a door that swings open
export function buildHouses(lights) {
  const g = new THREE.Group();
  const doorButtons = [];
  const doorPivots = [];   // { x, z, pivot } — main.js animates these
  const colliders = [];    // box + circle colliders for the whole town
  const brickTex = brick();
  const roofTex = roofShingles();
  const plankTex = woodFloor();

  const wallBox = (bw, bh, bd, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), lambert('#e8dcc8'));
    m.position.set(x, y, z);
    g.add(m);
    colliders.push({ box: true, minX: x - bw / 2 - 0.08, maxX: x + bw / 2 + 0.08, minZ: z - bd / 2 - 0.08, maxZ: z + bd / 2 + 0.08, top: y + bh / 2 });
    return m;
  };

  for (const hs of HOUSES) {
    const W = 9, D = 8, H = 3.6;
    const baseY = 2.05;
    const yMid = baseY + H / 2;
    const frontZ = hs.z - D / 2;   // doors face -z (the street)
    const backZ = hs.z + D / 2;
    const doorW = 1.5;

    // floor + brick skirt
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.16, D), lambert('#b08a5a', { map: plankTex }));
    floor.position.set(hs.x, baseY + 0.1, hs.z);
    g.add(floor);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.5, D + 0.3), lambert('#9a5240', { map: brickTex }));
    skirt.position.set(hs.x, baseY + 0.25, hs.z);
    g.add(skirt);

    // hollow walls: back, sides, front segments around the door gap
    wallBox(W, H, 0.3, hs.x, yMid, backZ);
    wallBox(0.3, H, D, hs.x - W / 2, yMid, hs.z);
    wallBox(0.3, H, D, hs.x + W / 2, yMid, hs.z);
    const segW = (W - doorW) / 2;
    wallBox(segW, H, 0.3, hs.x - doorW / 2 - segW / 2, yMid, frontZ);
    wallBox(segW, H, 0.3, hs.x + doorW / 2 + segW / 2, yMid, frontZ);
    // header above the door (visual only)
    const header = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.2, H - 2.45, 0.3), lambert('#e8dcc8'));
    header.position.set(hs.x, baseY + 2.45 + (H - 2.45) / 2, frontZ);
    g.add(header);

    // the door itself: hinged pivot, swings open when someone is near
    const pivot = new THREE.Group();
    pivot.position.set(hs.x - doorW / 2, baseY, frontZ);
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, 2.4, 0.12), lambert('#7a4a30', { map: plankTex }));
    door.position.set(doorW / 2, 1.3, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), lambert('#e8c860'));
    knob.position.set(doorW - 0.18, 1.25, -0.1);
    pivot.add(door, knob);
    g.add(pivot);
    doorPivots.push({ x: hs.doorX, z: hs.doorZ, pivot });

    // doorbell
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), lambert('#e8b94a'));
    bell.rotation.x = Math.PI / 2;
    bell.position.set(hs.x + doorW / 2 + 0.35, baseY + 1.5, frontZ - 0.12);
    g.add(bell);

    // pitched roof
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.22, D * 0.62), lambert('#6e4438', { map: roofTex }));
      panel.position.set(hs.x, baseY + H + 1.0, hs.z + side * D * 0.225);
      panel.rotation.x = -side * 0.62;
      g.add(panel);
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 0.3, 0.5), lambert('#54342c'));
    ridge.position.set(hs.x, baseY + H + 1.72, hs.z);
    g.add(ridge);

    // windows (front, glowing)
    for (const wx of [-2.6, 2.6]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.3, 0.1), new THREE.MeshBasicMaterial({ color: '#ffeebb' }));
      win.position.set(hs.x + wx, baseY + 2.0, frontZ - 0.12);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, 0.06), lambert('#ffffff'));
      frame.position.set(hs.x + wx, baseY + 2.0, frontZ - 0.06);
      g.add(frame, win);
    }

    // ---- furniture inside ----
    // bed (back-left corner)
    const bedX = hs.x - W / 2 + 1.6, bedZ = backZ - 1.8;
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 2.4), lambert('#6b5138', { map: plankTex }));
    bedFrame.position.set(bedX, baseY + 0.35, bedZ);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.2, 2.25), lambert('#f0ede6'));
    mattress.position.set(bedX, baseY + 0.62, bedZ);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, 0.5), lambert('#ffffff'));
    pillow.position.set(bedX, baseY + 0.78, bedZ + 0.8);
    const throwB = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.2), lambert('#c0564a'));
    throwB.position.set(bedX, baseY + 0.74, bedZ - 0.4);
    g.add(bedFrame, mattress, pillow, throwB);
    colliders.push({ x: bedX, z: bedZ, r: 1.1, top: baseY + 1 });

    // table + two stools (right side)
    const tX = hs.x + 2.4, tZ = hs.z + 0.6;
    const tTop = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 14), lambert('#b08a5a', { map: plankTex }));
    tTop.position.set(tX, baseY + 0.85, tZ);
    const tLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.8, 8), lambert('#6b5138'));
    tLeg.position.set(tX, baseY + 0.42, tZ);
    g.add(tTop, tLeg);
    for (const a of [0.8, 3.6]) {
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.5, 10), lambert('#8a6a48'));
      stool.position.set(tX + Math.cos(a) * 1.2, baseY + 0.25, tZ + Math.sin(a) * 1.2);
      g.add(stool);
    }
    colliders.push({ x: tX, z: tZ, r: 0.85, top: baseY + 1 });

    // dresser + lamp (back-right)
    const drX = hs.x + W / 2 - 1.2, drZ = backZ - 1.0;
    const dresser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.6), lambert('#8a6a48', { map: plankTex }));
    dresser.position.set(drX, baseY + 0.5, drZ);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.4, 8), lambert('#2e3138'));
    lampBase.position.set(drX, baseY + 1.2, drZ);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 12, 1, true), lambert('#e8c890', { side: THREE.DoubleSide }));
    shade.position.set(drX, baseY + 1.5, drZ);
    g.add(dresser, lampBase, shade);
    colliders.push({ x: drX, z: drZ, r: 0.8, top: baseY + 1.1 });
    lights.addLamp({ x: drX, y: baseY + 1.6, z: drZ, color: '#ffd9a0', intensity: 1.2, range: 8 });

    // rug
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.04, 18), lambert('#b86a4a'));
    rug.scale.z = 0.7;
    rug.position.set(hs.x, baseY + 0.2, hs.z - 1);
    g.add(rug);

    // porch + posts + mailbox
    const porch = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 2.6), lambert('#b08a5a', { map: plankTex }));
    porch.position.set(hs.x, baseY + 0.15, frontZ - 1.4);
    g.add(porch);
    for (const px of [-2, 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.6, 8), lambert('#8a6a48'));
      post.position.set(hs.x + px, baseY + 1.45, frontZ - 2.4);
      g.add(post);
      colliders.push({ x: hs.x + px, z: frontZ - 2.4, r: 0.3, top: baseY + 2.8 });
    }
    const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(5, 0.18, 3), lambert('#6e4438', { map: roofTex }));
    porchRoof.position.set(hs.x, baseY + 2.85, frontZ - 1.5);
    porchRoof.rotation.x = 0.12;
    g.add(porchRoof);
    const mailPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), lambert('#5a4a3a'));
    mailPost.position.set(hs.x - 3.4, baseY + 0.55, frontZ - 3);
    const mailBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.7), lambert('#3d6f96'));
    mailBox.position.set(hs.x - 3.4, baseY + 1.25, frontZ - 3);
    g.add(mailPost, mailBox);

    lights.addLamp({ x: hs.x, y: baseY + 2.6, z: frontZ - 1, color: '#ffd9a0', intensity: 1.1, range: 10 });
    doorButtons.push({ houseId: hs.id, x: hs.doorX, z: hs.doorZ });
  }

  // fountain is solid
  colliders.push({ x: PLAZA.x, z: PLAZA.z, r: 7.4, top: 8 });

  // street lamps along both streets
  const lampTex = lambert('#2e3138');
  for (const z of [8.5, 241.5]) {
    for (let x = -400; x <= 400; x += 100) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), lampTex);
      pole.position.set(x, 4.35, z);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff0c8' }));
      head.position.set(x, 6.7, z);
      g.add(pole, head);
      colliders.push({ x, z, r: 0.3, top: 6 });
    }
  }

  // decorative trees scattered on the lawn
  const rng = mulberry32(WORLD.seed + 3);
  for (let i = 0; i < 130; i++) {
    const x = (rng() * 2 - 1) * 470;
    const z = (rng() * 2 - 1) * 470;
    if (roadInfo(x, z).dist < 14) continue;
    if (PLOTS.some((p) => Math.abs(x - p.x) < p.padW / 2 + 5 && Math.abs(z - p.z) < p.padD / 2 + 5)) continue;
    if (HOUSES.some((h) => Math.abs(x - h.x) < 14 && Math.abs(z - h.z) < 14)) continue;
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 6) continue;
    const s = 0.8 + rng() * 0.7;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.4 * s, 3.4 * s, 7), lambert('#6b5138'));
    trunk.position.set(x, height(x, z) + 1.6 * s, z);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3 * s, 1), lambert(rng() > 0.5 ? '#4f9a44' : '#5fae50'));
    crown.position.set(x, height(x, z) + 4.6 * s, z);
    g.add(trunk, crown);
    colliders.push({ x, z, r: 0.5 * s, top: height(x, z) + 4 });
  }

  g.userData.doorButtons = doorButtons;
  g.userData.doorPivots = doorPivots;
  g.userData.colliders = colliders;
  return g;
}
