// RS2 furniture & appliance meshes — detailed original models with real
// parts: tablecloth tables, chairs with backs, stoves with burners and
// flames, ovens with windows and interior glow, dispensers with taps,
// counters with cutting boards. Appliance tiers restyle the finish.

import * as THREE from 'three';
import { tablecloth, steel, woodFloor, marbleFloor } from '../textures.js';

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const basic = (color) => new THREE.MeshBasicMaterial({ color });

// tier finishes: body material + accent
function finish(tier) {
  if (tier >= 2) return { body: lambert('#2e3138'), top: lambert('#ffffff', { map: marbleFloor() }), accent: '#e8b94a' };
  if (tier === 1) return { body: lambert('#ffffff', { map: steel() }), top: lambert('#d8dcde', { map: steel() }), accent: '#4a90c0' };
  return { body: lambert('#e8e4da'), top: lambert('#b8b4ac'), accent: '#7a8a96' };
}

// builds the mesh for an item record { kind, tier, rot }. Returns a Group
// whose origin is the footprint center at floor level. userData carries
// interaction anchors (seatY, stationPoint, surfaceY for food placement).
export function buildFurniture(kind, tier = 0) {
  const g = new THREE.Group();
  const fin = finish(tier);

  switch (kind) {
    case 'table': {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.09, 18), lambert('#ffffff', { map: tablecloth() }));
      top.position.y = 0.92;
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 1.02, 0.16, 18), lambert('#f0ece2', { map: tablecloth() }));
      skirt.position.y = 0.84;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.85, 10), lambert('#6e5a4a'));
      stem.position.y = 0.45;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.08, 14), lambert('#5a4a3c'));
      foot.position.y = 0.05;
      g.add(top, skirt, stem, foot);
      g.userData.surfaceY = 0.97;
      g.userData.isTable = true;
      break;
    }
    case 'booth': {
      const seatMat = lambert('#a8443c');
      for (const sx of [-1.1, 1.1]) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 1.7), seatMat);
        seat.position.set(sx, 0.45, 0);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.25, 1.7), lambert('#963c34'));
        back.position.set(sx + Math.sign(sx) * 0.3, 0.85, 0);
        g.add(seat, back);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.09, 1.6), lambert('#b08a5a', { map: woodFloor() }));
      top.position.y = 0.86;
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.18), lambert('#6e5a4a'));
      stem.position.y = 0.43;
      g.add(top, stem);
      g.userData.surfaceY = 0.91;
      g.userData.isTable = true;
      g.userData.builtInSeats = [{ dx: -1.1, dz: 0, ry: Math.PI / 2 }, { dx: 1.1, dz: 0, ry: -Math.PI / 2 }];
      break;
    }
    case 'chair': {
      const wood = lambert('#8a6a48', { map: woodFloor() });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.52), wood);
      seat.position.y = 0.5;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.07), wood);
      back.position.set(0, 0.85, -0.23);
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), lambert('#b85c4a'));
      cushion.position.y = 0.56;
      g.add(seat, back, cushion);
      for (const [lx, lz] of [[-0.21, 0.21], [0.21, 0.21], [-0.21, -0.21], [0.21, -0.21]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.5, 7), wood);
        leg.position.set(lx, 0.25, lz);
        g.add(leg);
      }
      // backrest spindles
      for (const sx of [-0.16, 0, 0.16]) {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), wood);
        sp.position.set(sx, 0.78, -0.23);
        g.add(sp);
      }
      g.userData.seatY = 0.58;
      g.userData.isChair = true;
      break;
    }
    case 'counter': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.95, 0.85), fin.body);
      body.position.y = 0.48;
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.95), fin.top);
      top.position.y = 0.99;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.5), lambert('#caa86a', { map: woodFloor() }));
      board.position.set(-0.4, 1.06, 0);
      const knife = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.05), lambert('#c8ccd0'));
      knife.position.set(0.35, 1.05, 0.1);
      knife.rotation.y = 0.5;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.14, 12), lambert('#e8e4da'));
      bowl.position.set(0.55, 1.1, -0.2);
      g.add(body, top, board, knife, bowl);
      // drawer + handle details
      for (const dx of [-0.5, 0.5]) {
        const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.04), fin.top);
        drawer.position.set(dx, 0.62, 0.45);
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), lambert(fin.accent));
        handle.rotation.z = Math.PI / 2;
        handle.position.set(dx, 0.62, 0.49);
        g.add(drawer, handle);
      }
      g.userData.surfaceY = 1.03;
      g.userData.station = 'counter';
      break;
    }
    case 'stove': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.95, 0.85), fin.body);
      body.position.y = 0.48;
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.95), lambert('#2b2b30'));
      top.position.y = 0.98;
      g.add(body, top);
      // four burners with grates + one lit flame
      const flames = [];
      for (const [bx, bz] of [[-0.55, -0.2], [0.55, -0.2], [-0.55, 0.25], [0.55, 0.25]]) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 14), lambert('#1a1a1e'));
        burner.position.set(bx, 1.02, bz);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 14), lambert('#4a4a50'));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(bx, 1.04, bz);
        g.add(burner, ring);
      }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 8), basic('#5fa8ff'));
      flame.position.set(-0.55, 1.12, -0.2);
      flame.visible = false;
      g.add(flame);
      flames.push(flame);
      // oven-style handle + knobs
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), lambert(fin.accent));
      handle.rotation.z = Math.PI / 2;
      handle.position.set(0, 0.78, 0.46);
      g.add(handle);
      for (let k = 0; k < 4; k++) {
        const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), lambert('#1a1a1e'));
        knob.rotation.x = Math.PI / 2;
        knob.position.set(-0.6 + k * 0.4, 0.93, 0.45);
        g.add(knob);
      }
      // pan on the lit burner
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.08, 14), lambert('#3a3a40'));
      pan.position.set(-0.55, 1.08, -0.2);
      const panHandle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.06), lambert('#2a2a2e'));
      panHandle.position.set(-0.85, 1.1, -0.2);
      g.add(pan, panHandle);
      g.userData.flames = flames;
      g.userData.surfaceY = 1.05;
      g.userData.station = 'stove';
      break;
    }
    case 'oven': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 0.85), fin.body);
      body.position.y = 0.75;
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.95), fin.top);
      top.position.y = 1.53;
      g.add(body, top);
      // door with window + interior glow
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.08), lambert('#3a3a40'));
      door.position.set(0, 0.72, 0.44);
      const window_ = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.04), new THREE.MeshBasicMaterial({ color: '#2a1a10' }));
      window_.position.set(0, 0.78, 0.49);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.5), basic('#ff9a40'));
      glow.position.set(0, 0.78, 0.52);
      glow.visible = false;
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8), lambert(fin.accent));
      handle.rotation.z = Math.PI / 2;
      handle.position.set(0, 1.28, 0.5);
      g.add(door, window_, glow, handle);
      g.userData.glow = glow;
      g.userData.surfaceY = 1.58;
      g.userData.station = 'oven';
      break;
    }
    case 'dispenser': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.5, 0.7), fin.body);
      body.position.y = 0.75;
      const header = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.74), lambert(fin.accent));
      header.position.y = 1.55;
      g.add(body, header);
      // three taps + drip tray + stacked cups
      for (let i = 0; i < 3; i++) {
        const tap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.18, 0.16), lambert('#2e3138'));
        tap.position.set(-0.24 + i * 0.24, 1.18, 0.4);
        const label = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.02), basic(['#e8503c', '#e8b94a', '#5fa8ff'][i]));
        label.position.set(-0.24 + i * 0.24, 1.34, 0.38);
        g.add(tap, label);
      }
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.3), lambert('#9aa0a8'));
      tray.position.set(0, 0.62, 0.38);
      const cups = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.3, 10), lambert('#f4f0e8'));
      cups.position.set(0.32, 0.8, 0.3);
      g.add(tray, cups);
      g.userData.surfaceY = 0.7;
      g.userData.station = 'dispenser';
      break;
    }
    case 'register': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 0.8), lambert('#8a6a48', { map: woodFloor() }));
      body.position.y = 0.5;
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.9), lambert('#caa86a', { map: woodFloor() }));
      top.position.y = 1.04;
      const till = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), lambert('#2e3138'));
      till.position.set(-0.5, 1.28, 0);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.04), basic('#7ee0a0'));
      screen.position.set(-0.5, 1.36, 0.2);
      screen.rotation.x = -0.3;
      g.add(body, top, till, screen);
      g.userData.surfaceY = 1.08;
      g.userData.pickup = true;
      break;
    }
    case 'plant': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.35, 12), lambert('#b85c4a'));
      pot.position.y = 0.18;
      g.add(pot);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.7, 6), lambert('#4f9a44'));
        leaf.position.set(Math.cos(a) * 0.12, 0.7, Math.sin(a) * 0.12);
        leaf.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        g.add(leaf);
      }
      break;
    }
    case 'painting': {
      const framePic = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 0.06), lambert('#caa84e'));
      framePic.position.y = 2.2;
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 48;
      const c = canvas.getContext('2d');
      const grad = c.createLinearGradient(0, 0, 0, 48);
      grad.addColorStop(0, '#7ec8e8'); grad.addColorStop(0.6, '#e8b94a'); grad.addColorStop(1, '#4f9a44');
      c.fillStyle = grad;
      c.fillRect(0, 0, 64, 48);
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(48, 12, 6, 0, 7); c.fill();
      const tex = new THREE.CanvasTexture(canvas);
      const art = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.7), new THREE.MeshLambertMaterial({ map: tex }));
      art.position.set(0, 2.2, 0.04);
      g.add(framePic, art);
      break;
    }
    case 'rug': {
      const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.04, 20), lambert('#b86a4a'));
      rug.scale.z = 0.7;
      rug.position.y = 0.02;
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.05, 20), lambert('#d8a05a'));
      inner.scale.z = 0.7;
      inner.position.y = 0.02;
      g.add(rug, inner);
      break;
    }
    case 'lamp': {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), lambert('#2a2a2e'));
      cord.position.y = 3.4;
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.4, 14, 1, true), lambert('#b85c4a', { side: THREE.DoubleSide }));
      shade.position.y = 2.65;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), basic('#ffe9b8'));
      bulb.position.y = 2.5;
      g.add(cord, shade, bulb);
      g.userData.lampSpec = { y: 2.5, color: '#ffd9a0', intensity: 1.3, range: 9 };
      break;
    }
    case 'divider': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.6, 0.12), lambert('#8a6a48', { map: woodFloor() }));
      frame.position.y = 0.8;
      const lattice = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 0.04), lambert('#caa86a'));
      lattice.position.y = 0.85;
      g.add(frame, lattice);
      break;
    }
    case 'flowers': {
      const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.22, 10), lambert('#7ec8e8'));
      vase.position.y = 0.11;
      g.add(vase);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lambert(['#e8503c', '#e8b94a', '#c08ec5', '#ffffff'][i]));
        bloom.position.set(Math.cos(a) * 0.07, 0.32, Math.sin(a) * 0.07);
        g.add(bloom);
      }
      break;
    }
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// food meshes per dish (plates/cups), plus the takeout bag
export function buildFoodMesh(dishId) {
  const g = new THREE.Group();
  const plate = () => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.04, 16), lambert('#f4f2ec'));
    p.position.y = 0.02;
    g.add(p);
  };
  const cup = (color) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.22, 12), lambert('#f4f0e8'));
    c.position.y = 0.11;
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), basic(color));
    liquid.position.y = 0.21;
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), lambert('#e8503c'));
    straw.position.set(0.03, 0.28, 0);
    straw.rotation.z = 0.2;
    g.add(c, liquid, straw);
  };
  switch (dishId) {
    case 'water': cup('#bfe4f5'); break;
    case 'soda': cup('#6e3a1e'); break;
    case 'juice': cup('#e8902a'); break;
    case 'salad': {
      plate();
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, 7, 0, Math.PI / 2), lambert('#5fae50'));
      bowl.position.y = 0.05;
      g.add(bowl);
      break;
    }
    case 'soup': {
      plate();
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.1, 14), lambert('#f4f2ec'));
      bowl.position.y = 0.08;
      const broth = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 14), basic('#c0452a'));
      broth.position.y = 0.13;
      g.add(bowl, broth);
      break;
    }
    case 'burger': {
      plate();
      const bunB = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 14), lambert('#d8a05a'));
      bunB.position.y = 0.06;
      const patty = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 14), lambert('#6e4430'));
      patty.position.y = 0.1;
      const cheese = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.24), lambert('#e8b94a'));
      cheese.position.y = 0.125;
      cheese.rotation.y = 0.5;
      const bunT = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 8, 0, 7, 0, Math.PI / 2), lambert('#caa86a'));
      bunT.position.y = 0.13;
      g.add(bunB, patty, cheese, bunT);
      break;
    }
    case 'wrap': {
      plate();
      for (const dx of [-0.06, 0.06]) {
        const half = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 10), lambert('#e8d8b0'));
        half.rotation.z = Math.PI / 2.4;
        half.position.set(dx, 0.08, 0);
        g.add(half);
      }
      break;
    }
    case 'pasta': {
      plate();
      const pile = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, 7, 0, Math.PI / 2), lambert('#e8c95c'));
      pile.position.y = 0.04;
      const sauce = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 6, 0, 7, 0, Math.PI / 2), lambert('#c0452a'));
      sauce.position.y = 0.1;
      g.add(pile, sauce);
      break;
    }
    case 'cookies': {
      plate();
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 12), lambert('#b07a40'));
        c.position.set(-0.08 + i * 0.08, 0.05 + i * 0.005, (i % 2) * 0.06);
        g.add(c);
      }
      break;
    }
    case 'pizza': {
      const board = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 16), lambert('#caa86a', { map: woodFloor() }));
      board.position.y = 0.02;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16), lambert('#e8c95c'));
      base.position.y = 0.05;
      const sauce = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.015, 16), lambert('#c0452a'));
      sauce.position.y = 0.07;
      g.add(board, base, sauce);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const pep = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 10), lambert('#a83a2e'));
        pep.position.set(Math.cos(a) * 0.1, 0.085, Math.sin(a) * 0.1);
        g.add(pep);
      }
      break;
    }
    case 'steak': {
      plate();
      const steak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.14), lambert('#6e3a28'));
      steak.position.y = 0.06;
      steak.rotation.y = 0.4;
      const butter = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), lambert('#ffe9a0'));
      butter.position.y = 0.1;
      const greens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6, 0, 7, 0, Math.PI / 2), lambert('#5fae50'));
      greens.position.set(0.12, 0.05, 0.08);
      g.add(steak, butter, greens);
      break;
    }
    case 'cake': {
      plate();
      const layer1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 16), lambert('#6e4430'));
      layer1.position.y = 0.07;
      const layer2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), lambert('#8a5a40'));
      layer2.position.y = 0.13;
      const icing = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.02, 16), lambert('#f4e2e8'));
      icing.position.y = 0.17;
      const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), lambert('#c0282e'));
      cherry.position.y = 0.2;
      g.add(layer1, layer2, icing, cherry);
      break;
    }
    default: plate();
  }
  return g;
}

export function buildBagMesh() {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.26), lambert('#caa86a'));
  bag.position.y = 0.2;
  const fold = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.28), lambert('#b8945a'));
  fold.position.y = 0.42;
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), basic('#c0564a'));
  logo.position.set(0, 0.22, 0.135);
  for (const hx of [-0.08, 0.08]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), lambert('#8a6a48'));
    handle.position.set(hx, 0.45, 0);
    g.add(handle);
  }
  g.add(bag, fold, logo);
  return g;
}

// cash pile left on tables
export function buildCashPile() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.11), lambert('#6fae5a'));
    bill.position.set((i - 1) * 0.04, 0.012 + i * 0.013, (i % 2) * 0.04);
    bill.rotation.y = i * 0.5;
    g.add(bill);
  }
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 10), lambert('#e8b94a'));
  coin.position.set(0.12, 0.02, -0.05);
  g.add(coin);
  return g;
}
