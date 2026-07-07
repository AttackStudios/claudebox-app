// Placeable camp items: meshes, ghost-preview placement, sitting, the
// campfire's light + flames, and the marshmallow roast/eat flow.

import * as THREE from 'three';
import { waterAt, roadInfo, lavaAt, height } from '/shared/bp/worldgen.js';
import { tentFabric, plaid, planks, bark } from '../textures.js';

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

export const TENT_COLORS = ['#4f8a55', '#c0564a', '#4a7ec0', '#c08ec5', '#d9c95c'];

// Backpack catalog — every item unlocked, organized by tab.
export const CATALOG = {
  Tents: [
    { kind: 'tent', label: 'Tent', emoji: '⛺', colors: TENT_COLORS },
  ],
  Camp: [
    { kind: 'campfire', label: 'Campfire', emoji: '🔥' },
    { kind: 'chair', label: 'Camp chair', emoji: '🪑', colors: TENT_COLORS, sit: true },
    { kind: 'table', label: 'Picnic table', emoji: '🍽️' },
    { kind: 'bed', label: 'Camp bed', emoji: '🛏️', sit: true },
    { kind: 'sleepingbag', label: 'Sleeping bag', emoji: '🛌', colors: TENT_COLORS, sit: true },
    { kind: 'blanket', label: 'Picnic blanket', emoji: '🧺' },
    { kind: 'cooler', label: 'Cooler', emoji: '🧊' },
    { kind: 'grill', label: 'BBQ grill', emoji: '🍖' },
    { kind: 'fence', label: 'Fence', emoji: '🚧' },
    { kind: 'stump', label: 'Log stool', emoji: '🪵', sit: true },
  ],
  Furniture: [
    { kind: 'sofa', label: 'Sofa', emoji: '🛋️', colors: TENT_COLORS, sit: true },
    { kind: 'armchair', label: 'Armchair', emoji: '💺', colors: TENT_COLORS, sit: true },
    { kind: 'bench', label: 'Wooden bench', emoji: '🪑', sit: true },
    { kind: 'hammock', label: 'Hammock', emoji: '🏝️', colors: TENT_COLORS, sit: true },
    { kind: 'rug', label: 'Rug', emoji: '🟫', colors: TENT_COLORS },
    { kind: 'tv', label: 'TV', emoji: '📺' },
    { kind: 'bookshelf', label: 'Bookshelf', emoji: '📚' },
    { kind: 'planter', label: 'Potted plant', emoji: '🪴' },
    { kind: 'lamp', label: 'Floor lamp', emoji: '🛋️' },
  ],
  Comfort: [
    { kind: 'hottub', label: 'Hot tub', emoji: '♨️', sit: true },
    { kind: 'pool', label: 'Kiddie pool', emoji: '🏊' },
    { kind: 'lantern', label: 'Lantern post', emoji: '🏮' },
    { kind: 'sign', label: 'Camp sign', emoji: '🪧' },
    { kind: 'flagpole', label: 'Flag', emoji: '🚩' },
  ],
  Gear: [
    { kind: 'torch', label: 'Standing torch', emoji: '🕯️' },
    { kind: 'stringlights', label: 'String lights', emoji: '💡' },
    { kind: 'marshmallow', label: 'Marshmallow stick', emoji: '🍡', held: true },
    { kind: 'bearspray', label: 'Bear spray', emoji: '🧯', held: true },
  ],
};

export function catalogEntry(kind) {
  for (const tab of Object.values(CATALOG)) {
    const e = tab.find((i) => i.kind === kind);
    if (e) return e;
  }
  return null;
}

// ---------------- item meshes ----------------
export function buildItemMesh(kind, color, sky) {
  const g = new THREE.Group();
  const lamps = [];
  switch (kind) {
    case 'tent': {
      // big walk-in A-frame: ridge along z, doorway open at +z (front)
      const HW = 2.1, DEPTH = 4.8, RIDGE = 2.7;        // half-width, depth, ridge height
      const HD = DEPTH / 2;
      const fabric = lambert(color, { map: tentFabric(), side: THREE.DoubleSide });
      const slopeLen = Math.hypot(HW, RIDGE);
      const slopeAng = Math.atan2(RIDGE, HW);
      // two sloped roof panels meeting at the ridge
      for (const s of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.06, DEPTH), fabric);
        panel.position.set(s * HW / 2, RIDGE / 2, 0);
        panel.rotation.z = s > 0 ? -slopeAng : Math.PI + slopeAng;
        g.add(panel);
      }
      // closed back gable wall
      const gable = new THREE.Shape();
      gable.moveTo(-HW, 0); gable.lineTo(HW, 0); gable.lineTo(0, RIDGE); gable.closePath();
      const backWall = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 0.06, bevelEnabled: false }), fabric);
      backWall.position.z = -HD - 0.03;
      g.add(backWall);
      // front: rolled-back door flaps framing an open doorway
      for (const s of [-1, 1]) {
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.5, RIDGE * 0.92, 0.08), lambert(color, { map: tentFabric(), side: THREE.DoubleSide }));
        flap.position.set(s * (HW - 0.45), RIDGE * 0.46, HD - 0.02);
        flap.rotation.z = s * 0.12;
        g.add(flap);
      }
      // top valance over the doorway so the front isn't a full gap
      const valance = new THREE.Mesh(new THREE.BoxGeometry(HW * 1.4, 0.5, 0.06), fabric);
      valance.position.set(0, RIDGE - 0.4, HD - 0.02);
      g.add(valance);
      // ridge pole + A-frame poles
      const poleMat = lambert('#5d4632');
      const ridgePole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, DEPTH, 6), poleMat);
      ridgePole.rotation.x = Math.PI / 2; ridgePole.position.y = RIDGE;
      g.add(ridgePole);
      for (const pz of [-HD + 0.1, HD - 0.1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, RIDGE * 1.02, 6), poleMat);
        pole.position.set(0, RIDGE / 2, pz);
        g.add(pole);
      }
      // interior floor mat + a cozy bedroll + pillow inside
      const floor = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 - 0.1, 0.06, DEPTH - 0.1), lambert('#5a5347', { map: plaid() }));
      floor.position.y = 0.05;
      g.add(floor);
      const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, DEPTH * 0.5, 5, 10), lambert('#d9c95c', { map: tentFabric() }));
      roll.rotation.x = Math.PI / 2; roll.scale.y = 0.5;
      roll.position.set(-HW * 0.4, 0.26, -0.2);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.4), lambert('#f0ede6'));
      pillow.position.set(-HW * 0.4, 0.3, -HD + 0.7);
      g.add(roll, pillow);
      // you can crawl in and sleep
      g.userData.seatY = 0.32;
      g.userData.lie = true;
      // WALK-IN COLLISION: side + back walls (local coords), doorway at +z open
      const walls = [];
      for (let z = -HD + 0.4; z <= HD - 0.4; z += 0.7) {
        walls.push({ dx: -HW + 0.2, dz: z, r: 0.5, top: 1.2 });
        walls.push({ dx: HW - 0.2, dz: z, r: 0.5, top: 1.2 });
      }
      for (let x = -HW + 0.4; x <= HW - 0.4; x += 0.7) {
        walls.push({ dx: x, dz: -HD + 0.2, r: 0.5, top: 1.6 });
      }
      g.userData.colliders = walls;
      break;
    }
    case 'campfire': {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 0), lambert('#6e675e'));
        stone.position.set(Math.cos(a) * 0.62, 0.12, Math.sin(a) * 0.62);
        stone.rotation.set(i, i * 2, 0);
        g.add(stone);
      }
      const logMat = lambert('#5d4632', { map: bark() });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 7), logMat);
        log.rotation.z = Math.PI / 2.4;
        log.rotation.y = (i / 3) * Math.PI * 2;
        log.position.y = 0.22;
        g.add(log);
      }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 8), new THREE.MeshBasicMaterial({ color: '#ffa040', transparent: true, opacity: 0.95 }));
      flame.position.y = 0.65;
      const flameIn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 7), new THREE.MeshBasicMaterial({ color: '#ffe08a' }));
      flameIn.position.y = 0.55;
      g.add(flame, flameIn);
      g.userData.flames = [flame, flameIn];
      g.userData.isFire = true;
      lamps.push({ y: 1, color: '#ffaa55', intensity: 2.4, range: 18, flicker: 0.8 });
      break;
    }
    case 'torch': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.8, 7), lambert('#5d4632'));
      pole.position.y = 0.9;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.3, 8), lambert('#3a342e'));
      head.position.y = 1.85;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 7), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
      flame.position.y = 2.15;
      g.add(pole, head, flame);
      g.userData.flames = [flame];
      lamps.push({ y: 2.1, color: '#ffaa55', intensity: 1.8, range: 15, flicker: 0.7 });
      break;
    }
    case 'stringlights': {
      const postMat = lambert('#5d4632');
      for (const sx of [-2.2, 2.2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6), postMat);
        post.position.set(sx, 1.2, 0);
        g.add(post);
      }
      const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffe2a0' });
      for (let i = 0; i <= 10; i++) {
        const k = i / 10;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bulbMat);
        bulb.position.set(-2.2 + 4.4 * k, 2.3 - Math.sin(k * Math.PI) * 0.5, 0);
        g.add(bulb);
      }
      lamps.push({ y: 2.1, color: '#ffe2a0', intensity: 1.6, range: 14, flicker: 0 });
      break;
    }
    case 'chair': {
      const cloth = lambert(color);
      const frame = lambert('#4a4a4e');
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.6), cloth);
      seat.position.y = 0.55;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.08), cloth);
      back.position.set(0, 0.95, -0.28);
      back.rotation.x = -0.15;
      g.add(seat, back);
      for (const [lx, lz] of [[-0.26, 0.24], [0.26, 0.24], [-0.26, -0.24], [0.26, -0.24]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), frame);
        leg.position.set(lx, 0.28, lz);
        leg.rotation.z = lx > 0 ? -0.12 : 0.12;
        g.add(leg);
      }
      g.userData.seatY = 0.62;
      break;
    }
    case 'table': {
      const wood = lambert('#b08a5a', { map: planks() });
      const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1), wood);
      top.position.y = 0.78;
      g.add(top);
      for (const side of [-1, 1]) {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.34), wood);
        bench.position.set(0, 0.46, side * 0.78);
        g.add(bench);
        const legA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.1), wood);
        legA.position.set(-0.85, 0.39, side * 0.4);
        const legB = legA.clone();
        legB.position.x = 0.85;
        g.add(legA, legB);
      }
      g.userData.collider = { r: 1.2, top: 1 };
      break;
    }
    case 'bed': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.3, 2.2), lambert('#6b5138', { map: planks() }));
      frame.position.y = 0.3;
      const mattress = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 2.05), lambert('#e8e4da'));
      mattress.position.y = 0.52;
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.45), lambert('#ffffff'));
      pillow.position.set(0, 0.66, 0.75);
      const throwB = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.08, 1.1), lambert(color || '#c0564a', { map: plaid() }));
      throwB.position.set(0, 0.63, -0.4);
      g.add(frame, mattress, pillow, throwB);
      g.userData.seatY = 0.7;
      g.userData.lie = true;
      break;
    }
    case 'sleepingbag': {
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.5, 6, 12), lambert(color, { map: tentFabric() }));
      bag.rotation.x = Math.PI / 2;
      bag.position.y = 0.2;
      bag.scale.y = 0.55;
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.35), lambert('#f0ede6'));
      pillow.position.set(0, 0.18, 1.0);
      g.add(bag, pillow);
      g.userData.seatY = 0.32;
      g.userData.lie = true;
      break;
    }
    case 'blanket': {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 2.2), lambert('#ffffff', { map: plaid() }));
      b.position.y = 0.04;
      g.add(b);
      break;
    }
    case 'cooler': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.5), lambert('#3d87b8'));
      box.position.y = 0.3;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.54), lambert('#f0f0ec'));
      lid.position.y = 0.62;
      g.add(box, lid);
      break;
    }
    case 'fence': {
      const wood = lambert('#e8e4dc');
      for (const fx of [-1.1, 0, 1.1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), wood);
        post.position.set(fx, 0.55, 0);
        g.add(post);
      }
      for (const fy of [0.5, 0.9]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 0.08), wood);
        rail.position.y = fy;
        g.add(rail);
      }
      g.userData.collider = { r: 1.2, top: 1.2 };
      break;
    }
    case 'stump': {
      const wood = lambert('#6b5236', { map: bark() });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.5, 12), wood);
      trunk.position.y = 0.25;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 12), lambert('#caa56e'));
      top.position.y = 0.52;
      g.add(trunk, top);
      g.userData.seatY = 0.56;
      break;
    }
    case 'grill': {
      const steel = lambert('#2d2f33');
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.55), steel);
      body.position.y = 0.85;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.9, 14, 1, false, 0, Math.PI), steel);
      lid.rotation.z = Math.PI / 2; lid.position.set(0, 1.06, 0);
      const grate = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.04, 0.48), lambert('#555'));
      grate.position.y = 1.07;
      const ember = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.46), new THREE.MeshBasicMaterial({ color: '#ff6a2a' }));
      ember.position.y = 1.02;
      g.add(grate, ember, body, lid);
      for (const lx of [-0.36, 0.36]) for (const lz of [-0.22, 0.22]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.64, 6), steel);
        leg.position.set(lx, 0.32, lz); g.add(leg);
      }
      lamps.push({ y: 1.05, color: '#ff7a33', intensity: 0.9, range: 7, flicker: 0.6 });
      g.userData.collider = { r: 0.6, top: 1.3 };
      break;
    }
    case 'sofa': {
      const cloth = lambert(color || '#4a7ec0');
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.4, 0.95), cloth);
      base.position.y = 0.4;
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 0.25), cloth);
      back.position.set(0, 0.75, -0.35);
      for (const cx of [-0.55, 0.55]) {
        const cush = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.18, 0.85), lambert(color || '#5b8fd0'));
        cush.position.set(cx, 0.69, 0.03); g.add(cush);
      }
      for (const ax of [-1.1, 1.1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.95), cloth);
        arm.position.set(ax, 0.6, 0); g.add(arm);
      }
      g.add(base, back);
      for (const lx of [-1, 1]) for (const lz of [-0.4, 0.4]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 6), lambert('#3a2c1e'));
        leg.position.set(lx, 0.1, lz); g.add(leg);
      }
      g.userData.seatY = 0.62;
      g.userData.collider = { r: 1.1, top: 1 };
      break;
    }
    case 'armchair': {
      const cloth = lambert(color || '#c0564a');
      const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.95), cloth);
      base.position.y = 0.4;
      const cush = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.18, 0.82), lambert(color || '#d06a5e'));
      cush.position.set(0, 0.69, 0.03);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1, 0.72, 0.22), cloth);
      back.position.set(0, 0.78, -0.36);
      g.add(base, cush, back);
      for (const ax of [-0.46, 0.46]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.95), cloth);
        arm.position.set(ax, 0.6, 0); g.add(arm);
      }
      g.userData.seatY = 0.62;
      g.userData.collider = { r: 0.7, top: 1 };
      break;
    }
    case 'bench': {
      const wood = lambert('#9a7345', { map: planks() });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.5), wood);
      seat.position.y = 0.5;
      const back = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.08), wood);
      back.position.set(0, 0.78, -0.21); back.rotation.x = -0.12;
      g.add(seat, back);
      for (const lx of [-0.85, 0.85]) for (const lz of [-0.18, 0.18]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), wood);
        leg.position.set(lx, 0.25, lz); g.add(leg);
      }
      g.userData.seatY = 0.56;
      break;
    }
    case 'hammock': {
      const rope = lambert('#caa978');
      for (const sx of [-1.5, 1.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.9, 7), lambert('#5d4632', { map: bark() }));
        post.position.set(sx, 0.95, 0); post.rotation.z = sx > 0 ? 0.12 : -0.12; g.add(post);
      }
      const shape = new THREE.Shape();
      shape.moveTo(-1.35, 0.95); shape.quadraticCurveTo(0, 0.2, 1.35, 0.95);
      const pts = shape.getPoints(16).map((p) => new THREE.Vector3(p.x, p.y, 0));
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, 0.8), lambert(color || '#d9c95c', { map: tentFabric() }));
      cloth.position.set(0, 0.62, 0);
      cloth.geometry.translate(0, 0, 0);
      g.add(cloth);
      void pts; void rope;
      g.userData.seatY = 0.72;
      g.userData.lie = true;
      break;
    }
    case 'rug': {
      const r = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.03, 1.6), lambert(color || '#9c5a4a', { map: plaid() }));
      r.position.y = 0.03;
      const border = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.025, 1.8), lambert('#e8ddc8'));
      border.position.y = 0.02;
      g.add(border, r);
      break;
    }
    case 'tv': {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.4), lambert('#3a2c1e', { map: planks() }));
      stand.position.y = 0.25;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.1), lambert('#1a1a1d'));
      frame.position.y = 1.05;
      const screen = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.78, 0.04), new THREE.MeshBasicMaterial({ color: '#4a6e9c' }));
      screen.position.set(0, 1.05, 0.06);
      g.add(stand, frame, screen);
      lamps.push({ y: 1.05, color: '#6a8ec8', intensity: 0.5, range: 6, flicker: 0.15 });
      g.userData.collider = { r: 0.85, top: 1.5 };
      break;
    }
    case 'bookshelf': {
      const wood = lambert('#6b5236', { map: planks() });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.9, 0.4), wood);
      frame.position.y = 0.95; g.add(frame);
      const bookCols = ['#c0564a', '#4a7ec0', '#d9c95c', '#5a8a55', '#c08ec5', '#e8ddc8'];
      for (let s = 0; s < 4; s++) {
        for (let b = 0; b < 9; b++) {
          const bk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.3), lambert(bookCols[(s * 9 + b) % bookCols.length]));
          bk.position.set(-0.58 + b * 0.135, 0.35 + s * 0.46, 0.06);
          bk.rotation.z = (b % 5 === 4) ? 0.18 : 0;
          g.add(bk);
        }
      }
      g.userData.collider = { r: 0.8, top: 1.9 };
      break;
    }
    case 'planter': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.42, 12), lambert('#b5623f'));
      pot.position.y = 0.21;
      const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 12), lambert('#3a2c1e'));
      soil.position.y = 0.4;
      g.add(pot, soil);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 5), lambert(i % 2 ? '#5a8a45' : '#6ba055'));
        leaf.position.set(Math.cos(a) * 0.14, 0.75, Math.sin(a) * 0.14);
        leaf.rotation.set(Math.cos(a) * 0.4, 0, Math.sin(a) * -0.4);
        g.add(leaf);
      }
      break;
    }
    case 'lamp': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.7, 8), lambert('#2d2f33'));
      pole.position.y = 0.85;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 12), lambert('#2d2f33'));
      base.position.y = 0.04;
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.42, 14, 1, true), lambert('#efe2bf', { side: THREE.DoubleSide }));
      shade.position.y = 1.75;
      g.add(base, pole, shade);
      lamps.push({ y: 1.7, color: '#ffe9b8', intensity: 1.5, range: 12, flicker: 0 });
      break;
    }
    case 'hottub': {
      const tub = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.05, 0.8, 20), lambert('#6b4a30', { map: planks() }));
      tub.position.y = 0.4;
      const water = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.04, 20), new THREE.MeshBasicMaterial({ color: '#4fa8c8', transparent: true, opacity: 0.85 }));
      water.position.y = 0.72;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 8, 20), lambert('#8a6442'));
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.8;
      g.add(tub, water, rim);
      g.userData.seatY = 0.55;
      g.userData.collider = { r: 1.25, top: 0.9 };
      break;
    }
    case 'pool': {
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.45, 22, 1, true), lambert('#4a9ed8', { side: THREE.DoubleSide }));
      wall.position.y = 0.22;
      const water = new THREE.Mesh(new THREE.CylinderGeometry(1.46, 1.46, 0.04, 22), new THREE.MeshBasicMaterial({ color: '#5fc0e8', transparent: true, opacity: 0.8 }));
      water.position.y = 0.34;
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.04, 22), lambert('#bfe7f5'));
      floor.position.y = 0.02;
      g.add(floor, wall, water);
      break;
    }
    case 'lantern': {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.3, 8), lambert('#2d2f33'));
      post.position.y = 1.15;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6), lambert('#2d2f33'));
      arm.rotation.z = Math.PI / 2; arm.position.set(0.18, 2.25, 0);
      const cage = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), lambert('#1a1a1d'));
      cage.position.set(0.36, 2.1, 0);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), new THREE.MeshBasicMaterial({ color: '#ffdf9a' }));
      glow.position.set(0.36, 2.1, 0);
      g.add(post, arm, cage, glow);
      lamps.push({ y: 2.1, color: '#ffd98a', intensity: 1.8, range: 16, flicker: 0.12 });
      g.userData.collider = { r: 0.3, top: 2.3 };
      break;
    }
    case 'sign': {
      const wood = lambert('#8a6a42', { map: planks() });
      for (const sx of [-0.55, 0.55]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6), wood);
        post.position.set(sx, 0.75, 0); g.add(post);
      }
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.08), wood);
      board.position.y = 1.3;
      const text = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.02), lambert('#3a2c1e'));
      text.position.set(0, 1.34, 0.05);
      g.add(board, text);
      g.userData.collider = { r: 0.7, top: 1.6 };
      break;
    }
    case 'flagpole': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3, 8), lambert('#d8d8dc'));
      pole.position.y = 1.5;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.02), lambert(color || '#c0564a', { map: tentFabric(), side: THREE.DoubleSide }));
      flag.position.set(0.5, 2.6, 0);
      g.add(pole, flag);
      g.userData.flag = flag;
      g.userData.collider = { r: 0.25, top: 3 };
      break;
    }
  }
  g.userData.lampSpecs = lamps;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// hand-held: marshmallow stick (with a mallow that browns) + bear spray can
export function buildHeldMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'marshmallow') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.1, 6), lambert('#8a6a48'));
    stick.rotation.x = Math.PI / 2;
    stick.position.z = 0.5;
    const mallow = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.1, 5, 10), lambert('#fff7ee'));
    mallow.rotation.x = Math.PI / 2;
    mallow.position.z = 1.05;
    g.add(stick, mallow);
    g.userData.mallow = mallow;
  } else if (kind === 'bearspray') {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.34, 10), lambert('#c0392b'));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), lambert('#2b2b2e'));
    cap.position.y = 0.21;
    g.add(can, cap);
  }
  return g;
}

// roast progress 0..1 → white to toasty brown to burnt
const MALLOW_COLORS = [new THREE.Color('#fff7ee'), new THREE.Color('#d8a35e'), new THREE.Color('#7a4a22')];
export function setMallowRoast(heldGroup, t) {
  const m = heldGroup?.userData?.mallow;
  if (!m) return;
  const c = t < 0.5
    ? MALLOW_COLORS[0].clone().lerp(MALLOW_COLORS[1], t * 2)
    : MALLOW_COLORS[1].clone().lerp(MALLOW_COLORS[2], (t - 0.5) * 2);
  m.material = new THREE.MeshLambertMaterial({ color: c });
}

// placement validity: not in water/lava/road, on reasonably flat ground
export function placementValid(kind, x, z) {
  if (waterAt(x, z) || lavaAt(x, z)) return false;
  const ri = roadInfo(x, z);
  if (ri.dist < ri.width * 0.7) return false;
  const slope = Math.abs(height(x + 1.5, z) - height(x - 1.5, z)) + Math.abs(height(x, z + 1.5) - height(x, z - 1.5));
  return slope < 3.8;   // allow bumpy forest floor; only blocks real cliffs
}
