// Elemental Tycoon — client. Third-person shooter controller, a client-run
// tycoon economy on your own plot, unlockable elemental powers, and
// server-authoritative PvP (projectiles / damage / respawns).

import * as THREE from 'three';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import {
  PLOTS, CENTER, GROUND, ARENA_RADIUS, ELEMENTS, ELEMENT_BY_ID, BUTTONS, BUTTON_BY_ID,
  SIDE_BUILDS, SIDE_BY_ID, BASE_INCOME, DROP_INTERVAL, MAX_HP, RESPAWN,
} from '/shared/tycoon/world.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const START_CASH = 55;   // mirrors world.js
const WALK = 4.4, RUN = 8.0;
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ---------------- renderer / scene ----------------
const canvas = $('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1030);
scene.fog = new THREE.Fog(0x0c1030, 120, 300);
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 900);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3a446a, 1.25); scene.add(hemi);
scene.add(new THREE.AmbientLight(0x66708f, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.position.set(60, 90, 40); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -140; sun.shadow.camera.right = 140;
sun.shadow.camera.top = 140; sun.shadow.camera.bottom = -140; sun.shadow.camera.far = 260;
scene.add(sun);

// ---------------- world ----------------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(GROUND, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x1a2140, roughness: 1 }));
ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(GROUND * 2, 60, 0x33407a, 0x232a52);
grid.material.transparent = true; grid.material.opacity = 0.35; grid.position.y = 0.02; scene.add(grid);

// center arena — a red-tinted danger disc (you can only be hit inside it) + ring
const arenaFloor = new THREE.Mesh(
  new THREE.CircleGeometry(ARENA_RADIUS, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff4a5a, transparent: true, opacity: 0.08, side: THREE.DoubleSide }));
arenaFloor.position.y = 0.03; scene.add(arenaFloor);
const ring = new THREE.Mesh(
  new THREE.RingGeometry(ARENA_RADIUS - 1.5, ARENA_RADIUS + 1.5, 72).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff5a6c, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
ring.position.y = 0.05; scene.add(ring);
const arenaTxt = makeSprite('⚔ BATTLE ARENA ⚔', 46, '#aab6ff');
arenaTxt.position.set(0, 6, 0); arenaTxt.scale.set(16, 4, 1); scene.add(arenaTxt);

// ---------------- plots ----------------
// Each plot shows ONE build pad at a time (the next step), sitting where that
// thing gets built. Buying it constructs the mesh there and reveals the next.
const plots = PLOTS.map((def) => buildPlot(def));
const ownerPlot = new Map(); // playerId -> plot index

// mesh helpers (function declarations so they hoist above the plots = map() call)
function smat(c, o = {}) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o }); }
function box(w, h, d, x, y, z, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
function cyl(rt, rb, h, x, y, z, mat, seg = 14) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; return m; }
function aabb(x, z, rx, y1, rz, y0 = 0) { return { x0: x - rx, x1: x + rx, y0, y1, z0: z - rz, z1: z + rz }; }

// ---- detailed machine models ----
function detailedDropper() {
  const g = new THREE.Group();
  g.add(box(2.6, 2.0, 2.6, 0, 1.5, 0, smat(0x49527e, { metalness: 0.5, roughness: 0.4 })));
  const hop = cyl(1.5, 0.65, 1.5, 0, 3.2, 0, smat(0x5b66a0, { metalness: 0.5, roughness: 0.4 }), 4); hop.rotation.y = Math.PI / 4; g.add(hop);
  const rim = cyl(1.55, 1.55, 0.22, 0, 3.95, 0, smat(0x2a3358), 4); rim.rotation.y = Math.PI / 4; g.add(rim);
  g.add(cyl(0.34, 0.5, 0.9, 0, 0.55, 1.35, smat(0x2a3358)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.26, 1.1, 0.26, sx * 1.05, 0.55, sz * 1.05, smat(0x33384f)));
  const led = box(0.55, 0.35, 0.08, 0.7, 2.3, 1.31, smat(0x0a0a0a, { emissive: 0x33ff88, emissiveIntensity: 1 })); g.add(led);
  return g;
}
function detailedCollector() {
  const g = new THREE.Group();
  g.add(box(2.6, 1.7, 2.6, 0, 0.95, 0, smat(0xe0a92a, { metalness: 0.5, roughness: 0.4 })));
  g.add(box(2.85, 0.3, 2.85, 0, 1.9, 0, smat(0xffe08a, { metalness: 0.4 })));
  g.add(box(1.5, 0.12, 1.5, 0, 2.02, 0, smat(0x1a1200, { emissive: 0xffcf5c, emissiveIntensity: 0.8 })));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.24, 0.95, 0.24, sx * 1.05, 0.48, sz * 1.05, smat(0x8a6a12)));
  return g;
}
function detailedPedestal(el) {
  const g = new THREE.Group();
  g.add(cyl(1.15, 1.35, 0.5, 0, 0.25, 0, smat(0x2b3160)));
  g.add(cyl(0.55, 0.72, 1.5, 0, 1.25, 0, smat(0x3a4272)));
  g.add(cyl(0.92, 0.72, 0.28, 0, 2.05, 0, smat(0x4a5490)));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.07, 8, 22), new THREE.MeshBasicMaterial({ color: el.color }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 2.4; g.add(ring);
  const cry = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: el.color, emissive: el.color, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3 }));
  cry.position.y = 3.05; g.add(cry); g.userData.crystal = cry;
  const lp = new THREE.PointLight(el.color, 1.1, 7); lp.position.y = 3; g.add(lp);
  return g;
}

function buildPlot(def) {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z); g.rotation.y = def.ry;
  g.add(box(22, 0.4, 22, 0, 0.2, 3, smat(0x222a4d, { roughness: 0.95 })));   // pad (local +Z=back, -Z=front)
  g.add(box(22.4, 0.5, 0.5, 0, 0.25, -8, smat(0x3a4680)));                    // front rim
  const dropper = detailedDropper(); dropper.position.set(-7, 0, 7); g.add(dropper);
  g.add(box(13, 0.5, 1.8, -0.5, 0.6, 7, smat(0x181d38)));                     // conveyor (inset from the back wall)
  const bin = detailedCollector(); bin.position.set(6.6, 0, 7); g.add(bin);
  const banner = makeSprite('Open Plot', 40, '#9fb0e0');
  banner.position.set(0, 6.2, 9.4); banner.scale.set(10, 2.4, 1); g.add(banner);
  scene.add(g);
  const plot = {
    def, group: g, dropper, bin, banner, orbs: [], builds: new Map(), sideBuilds: new Map(),
    sidePads: new Map(), unlocked: new Set(), crystals: [], colliders: [], _support: 0,
    ownerId: null, pad: null, padStep: null,
  };
  plot.colliders.push(aabb(-7, 7, 1.4, 3.6, 1.4), aabb(6.6, 7, 1.45, 2.0, 1.45));  // starter machines
  return plot;
}

// the mesh a completed main-track step leaves behind → { group, colliders(plot-local) }
function stepMesh(step) {
  const grp = new THREE.Group(); grp.position.set(step.lx, 0, step.lz);
  let cols;
  if (step.build === 'pedestal') {
    const ped = detailedPedestal(ELEMENT_BY_ID[step.element]); grp.add(ped); grp.userData.crystal = ped.userData.crystal;
    cols = [aabb(step.lx, step.lz, 1.2, 2.2, 1.2)];
  } else if (step.build === 'collector') {
    grp.add(detailedCollector()); cols = [aabb(step.lx, step.lz, 1.45, 2.0, 1.45)];
  } else {
    grp.add(detailedDropper()); cols = [aabb(step.lx, step.lz, 1.4, 3.6, 1.4)];
  }
  return { group: grp, colliders: cols };
}

// ---- house structures → { group, colliders(plot-local) } ----
const HX = 11, HZB = 9, HZF = -8, HW = 5, HT = 0.5;   // house extents / wall height
const F2 = HW + 0.5, HW2 = 4.3;                        // second-floor surface = roof top; upper wall height
function wallRing(g, cols, baseY, h, color, door) {
  const m = smat(color); const yc = baseY + h / 2;
  g.add(box(2 * HX + HT, h, HT, 0, yc, HZB, m)); cols.push({ x0: -HX, x1: HX, y0: baseY, y1: baseY + h, z0: HZB - 0.4, z1: HZB + 0.4 });
  g.add(box(HT, h, HZB - HZF, -HX, yc, (HZB + HZF) / 2, m)); cols.push({ x0: -HX - 0.4, x1: -HX + 0.4, y0: baseY, y1: baseY + h, z0: HZF, z1: HZB });
  g.add(box(HT, h, HZB - HZF, HX, yc, (HZB + HZF) / 2, m)); cols.push({ x0: HX - 0.4, x1: HX + 0.4, y0: baseY, y1: baseY + h, z0: HZF, z1: HZB });
  if (door) {
    g.add(box(9, h, HT, -6.5, yc, HZF, m)); cols.push({ x0: -HX, x1: -2, y0: baseY, y1: baseY + h, z0: HZF - 0.4, z1: HZF + 0.4 });
    g.add(box(9, h, HT, 6.5, yc, HZF, m)); cols.push({ x0: 2, x1: HX, y0: baseY, y1: baseY + h, z0: HZF - 0.4, z1: HZF + 0.4 });
    g.add(box(4.4, 1.2, HT, 0, baseY + h - 0.6, HZF, m));
  } else {
    g.add(box(2 * HX + HT, h, HT, 0, yc, HZF, m)); cols.push({ x0: -HX, x1: HX, y0: baseY, y1: baseY + h, z0: HZF - 0.4, z1: HZF + 0.4 });
  }
}
function winPane(x, y, z, ry) { const w = new THREE.Group(); w.add(box(2, 2, 0.16, 0, 0, 0, smat(0x5a4632))); w.add(box(1.5, 1.5, 0.06, 0, 0, 0.09, smat(0x9fd4ff, { emissive: 0x203038, transparent: true, opacity: 0.85 }))); w.position.set(x, y, z); w.rotation.y = ry; return w; }
function structureMesh(id) {
  const g = new THREE.Group(); const cols = [];
  const WALL = 0xcdb492, ROOF = 0x9c4a3a, WOOD = 0x6b4a2a;
  switch (id) {
    case 'walls': wallRing(g, cols, 0, HW, WALL, true); break;
    case 'windows': g.add(winPane(-HX - 0.08, 2.7, -3, Math.PI / 2), winPane(-HX - 0.08, 2.7, 4, Math.PI / 2), winPane(HX + 0.08, 2.7, -3, Math.PI / 2), winPane(HX + 0.08, 2.7, 4, Math.PI / 2), winPane(-5, 2.7, HZB + 0.08, 0), winPane(5, 2.7, HZB + 0.08, 0)); break;
    case 'roof': {
      // a frame with a stairwell opening (HOLE) at the ramp mouth, so the ramp
      // to the 2nd floor comes up through it instead of clipping the slab. The
      // roof top (HW+0.5) doubles as the walkable second-floor surface.
      const RX0 = -HX - 0.6, RX1 = HX + 0.6, RZ0 = HZF - 0.6, RZ1 = HZB + 0.6;
      const hx0 = 6.4, hx1 = 10.6, hz0 = 4.8, hz1 = 8;
      const piece = (x0, x1, z0, z1) => { g.add(box(x1 - x0, 0.5, z1 - z0, (x0 + x1) / 2, HW + 0.25, (z0 + z1) / 2, smat(ROOF))); cols.push({ x0, x1, y0: HW, y1: HW + 0.5, z0, z1, floor: true }); };
      piece(RX0, hx0, RZ0, RZ1);   // left of the opening
      piece(hx1, RX1, RZ0, RZ1);   // right of the opening
      piece(hx0, hx1, RZ0, hz0);   // in front of the opening
      piece(hx0, hx1, hz1, RZ1);   // behind the opening
      g.add(box(2 * HX + 1.6, 0.4, 0.6, 0, HW + 0.55, HZF - 0.4, smat(0x7a3a2e)));
      g.add(box(2 * HX + 1.6, 0.4, 0.6, 0, HW + 0.55, HZB + 0.4, smat(0x7a3a2e)));
      break;
    }
    case 'chimney': { g.add(box(1.3, 3, 1.3, HX - 3, HW + 1.5, HZB - 3, smat(0x8a5a4a))); g.add(box(1.5, 0.4, 1.5, HX - 3, HW + 3, HZB - 3, smat(0x5a3a2e)));
      for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.4 + i * 0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.35 - i * 0.08 })); s.position.set(HX - 3, HW + 3.6 + i * 0.9, HZB - 3); g.add(s); }
      cols.push(aabb(HX - 3, HZB - 3, 0.7, HW + 3, 0.7)); break; }
    case 'floor2': {
      // The roof (required first) IS the second-floor surface. This just adds the
      // RAMP up through the roof's stairwell opening, plus railings. The ramp
      // collision is a chain of thin flat slabs so you can't get clipped sideways.
      const rx = 8.5, rz0 = -2, rz1 = 6.5, rlen = rz1 - rz0;
      const shp = new THREE.Shape(); shp.moveTo(0, 0); shp.lineTo(rlen, 0); shp.lineTo(rlen, F2); shp.closePath();
      const rgeo = new THREE.ExtrudeGeometry(shp, { depth: 3.2, bevelEnabled: false }); rgeo.translate(-rlen / 2, 0, -1.6);
      const wedge = new THREE.Mesh(rgeo, smat(0xa0895f)); wedge.position.set(rx, 0, (rz0 + rz1) / 2); wedge.rotation.y = -Math.PI / 2; wedge.castShadow = true; g.add(wedge);
      const N = 16;
      for (let i = 0; i <= N; i++) { const tz = rz0 + (i / N) * rlen, h = (i / N) * F2; cols.push({ x0: rx - 1.55, x1: rx + 1.55, y0: h - 0.5, y1: h + 0.06, z0: tz - (rlen / N * 0.5 + 0.35), z1: tz + (rlen / N * 0.5 + 0.35), floor: true }); }
      for (let i = 0; i <= 5; i++) { const tz = rz0 + (i / 5) * rlen, h = (i / 5) * F2; g.add(box(0.16, 1.0, 0.16, rx + 1.75, h + 0.55, tz, smat(0x6b5a3a))); }
      // guard rails around the rooftop opening (leave the ramp mouth clear) + deck perimeter
      g.add(box(4.4, 1.0, 0.16, 8.5, F2 + 0.55, 8, smat(0x6b5a3a)));
      g.add(box(0.16, 1.0, 3.4, 6.4, F2 + 0.55, 6.3, smat(0x6b5a3a)));
      g.add(box(0.16, 1.0, 3.4, 10.6, F2 + 0.55, 6.3, smat(0x6b5a3a)));
      for (let x = -HX + 1; x <= HX - 1; x += 3) { g.add(box(0.18, 1.1, 0.18, x, F2 + 0.55, HZF + 0.3, smat(0x6b5a3a))); g.add(box(0.18, 1.1, 0.18, x, F2 + 0.55, HZB - 0.3, smat(0x6b5a3a))); }
      break;
    }
    case 'walls2': wallRing(g, cols, F2, HW2, WALL, false); break;
    case 'windows2': g.add(winPane(-HX - 0.08, F2 + 2.2, -3, Math.PI / 2), winPane(HX + 0.08, F2 + 2.2, 3, Math.PI / 2), winPane(-4, F2 + 2.2, HZB + 0.08, 0), winPane(4, F2 + 2.2, HZB + 0.08, 0)); break;
    case 'roof2': { g.add(box(2 * HX + 1.2, 0.5, HZB - HZF + 1.2, 0, F2 + HW2 + 0.25, (HZB + HZF) / 2, smat(ROOF))); cols.push({ x0: -HX - 0.6, x1: HX + 0.6, y0: F2 + HW2, y1: F2 + HW2 + 0.5, z0: HZF - 0.6, z1: HZB + 0.6, floor: true }); break; }
    case 'balcony': {
      g.add(box(8, 0.4, 3.5, 0, F2 - 0.2, HZF - 1.7, smat(0xa08a6a)));
      for (let x = -3.5; x <= 3.5; x += 1.75) g.add(box(0.16, 1.0, 0.16, x, F2 + 0.5, HZF - 3.4, smat(0x6b5a3a)));
      g.add(box(8, 0.16, 0.16, 0, F2 + 1.0, HZF - 3.4, smat(0x6b5a3a)));
      cols.push({ x0: -4, x1: 4, y0: F2 - 0.4, y1: F2, z0: HZF - 3.4, z1: HZF, floor: true }); break;
    }
    case 'flag': { g.add(cyl(0.1, 0.1, 4, 0, F2 + HW2 + 2.5, 0, smat(0xcccccc))); const cloth = box(2.4, 1.4, 0.06, 1.2, F2 + HW2 + 3.8, 0, smat(0xff4a5a)); g.add(cloth); break; }
    case 'fence': for (let i = -HX; i <= HX; i += 2.2) { g.add(box(0.2, 1.4, 0.2, i, 0.7, HZF - 0.8, smat(0x8a6a44))); g.add(box(0.2, 1.4, 0.2, i, 0.7, HZB + 0.8, smat(0x8a6a44))); }
      g.add(box(2 * HX + 1.5, 0.16, 0.16, 0, 1.1, HZF - 0.8, smat(0x9a7a54))); g.add(box(2 * HX + 1.5, 0.16, 0.16, 0, 1.1, HZB + 0.8, smat(0x9a7a54))); break;
    case 'garden': for (const [x, z] of [[-9, -6], [9, -6], [-9, 7], [9, 7]]) { g.add(cyl(0.25, 0.3, 1.2, x, 0.6, z, smat(0x6b4a2a))); const f = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), smat(0x3f8a3a)); f.position.set(x, 1.7, z); f.castShadow = true; g.add(f); }
      break;
    case 'lamps': for (const [x, z] of [[-10, -7], [10, -7], [-10, 8], [10, 8]]) { g.add(cyl(0.12, 0.16, 3, x, 1.5, z, smat(0x2a2a2a))); const h = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), smat(0x1a1a10, { emissive: 0xffe08a, emissiveIntensity: 1.1 })); h.position.set(x, 3.1, z); g.add(h); }
      break;
    case 'path': for (let i = 0; i < 6; i++) g.add(box(3, 0.1, 1.3, 0, 0.42, -6 + i * -0.0 + (-i * 1.5), smat(0x6a6f7a))); break;
    default: break;
  }
  return { group: g, colliders: cols };
}

// the glowing "buy me" pad for a step
function padMesh(step, side) {
  const grp = new THREE.Group(); grp.position.set(step.lx, 0, step.lz);
  const col = side ? new THREE.Color(0x46c8a0) : step.kind === 'power' ? new THREE.Color(ELEMENT_BY_ID[step.element].color) : new THREE.Color(0xffd23f);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.3, 24), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.5 }));
  disc.position.y = 0.22; grp.add(disc);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 4.2, 18, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.13, side: THREE.DoubleSide }));
  beam.position.y = 2.1; grp.add(beam);
  const label = makeSprite(`${step.emoji} ${step.label}\n💰${short(step.cost)}`, 27, '#ffffff');
  label.position.y = 3.0; label.scale.set(3.6, 1.8, 1); grp.add(label);
  return { group: grp, disc, beam };
}

// ---- endless main track: after the defined steps, generate more droppers ----
const ENDLESS_SPOTS = [[-7, 6.5], [-4, 7], [2, 7], [-6, 5], [3, 5], [-8, 4], [8, 2], [6, 6], [-3, 6], [3, 3]];
function endlessDef(n) {   // n = dropper ordinal (9, 10, 11, …)
  const k = n - 8;
  const [lx, lz] = ENDLESS_SPOTS[n % ENDLESS_SPOTS.length];
  return { id: 'drop' + n, kind: 'income', label: 'Dropper ' + n, emoji: '⚙️', cost: Math.round(90000 * Math.pow(2.15, k)), income: Math.round(900 * Math.pow(1.7, k)), lx, lz, build: 'dropper', endless: true };
}
function stepDef(id) {
  if (BUTTON_BY_ID[id]) return BUTTON_BY_ID[id];
  if (SIDE_BY_ID[id]) return SIDE_BY_ID[id];
  const m = /^drop(\d+)$/.exec(id); if (m && +m[1] >= 9) return endlessDef(+m[1]);
  return null;
}
function nextMainStep(set) {
  const s = BUTTONS.find((b) => !set.has(b.id)); if (s) return s;
  let n = 9; while (set.has('drop' + n)) n++; return endlessDef(n);
}

function plotSetOwner(plot, name, mine) { setSprite(plot.banner, mine ? `⭐ ${name} (You)` : name, mine ? '#ffd76a' : '#cfe0ff'); }
function plotBuild(plot, id) {
  if (plot.builds.has(id)) return;
  const step = stepDef(id); if (!step) return;
  const { group, colliders } = stepMesh(step); plot.builds.set(id, group); plot.group.add(group);
  if (group.userData.crystal) plot.crystals.push(group.userData.crystal);
  plot.colliders.push(...colliders);
}
function plotBuildSide(plot, id) {
  if (plot.sideBuilds.has(id) || !SIDE_BY_ID[id]) return;
  const { group, colliders } = structureMesh(id); plot.sideBuilds.set(id, group); plot.group.add(group);
  plot.colliders.push(...colliders);
}
function plotSetUnlocks(plot, list) {
  for (const id of list) { plot.unlocked.add(id); if (SIDE_BY_ID[id]) plotBuildSide(plot, id); else plotBuild(plot, id); }
}
function plotShowPad(plot) {            // MINE only — reveal the next main-track step (endless)
  if (plot.pad) { plot.group.remove(plot.pad.group); plot.pad = null; }
  const step = nextMainStep(plot.unlocked);
  plot.padStep = step || null;
  if (step) { plot.pad = padMesh(step); plot.group.add(plot.pad.group); }
}
function updateSidePads(plot) {         // MINE only — show ALL available side builds at once
  if (plot.ownerId !== net.id) return;
  for (const [id, pad] of [...plot.sidePads]) {
    const b = SIDE_BY_ID[id]; const avail = !plot.unlocked.has(id) && (!b.req || plot.unlocked.has(b.req));
    if (!avail) { plot.group.remove(pad.group); plot.sidePads.delete(id); }
  }
  for (const b of SIDE_BUILDS) {
    if (plot.unlocked.has(b.id) || plot.sidePads.has(b.id)) continue;
    if (b.req && !plot.unlocked.has(b.req)) continue;
    const pad = padMesh(b, true); plot.group.add(pad.group); plot.sidePads.set(b.id, pad);
  }
}
function plotReset(plot) {
  plot.ownerId = null; setSprite(plot.banner, 'Open Plot', '#9fb0e0');
  for (const [, m] of plot.builds) plot.group.remove(m);
  for (const [, m] of plot.sideBuilds) plot.group.remove(m);
  for (const [, p] of plot.sidePads) plot.group.remove(p.group);
  plot.builds.clear(); plot.sideBuilds.clear(); plot.sidePads.clear();
  plot.unlocked.clear(); plot.crystals = []; plot.colliders.length = 0;
  plot.colliders.push(aabb(-7, 7, 1.4, 3.6, 1.4), aabb(6.6, 7, 1.45, 2.0, 1.45));
  if (plot.pad) { plot.group.remove(plot.pad.group); plot.pad = null; }
  plot.padStep = null;
  for (const o of plot.orbs) plot.group.remove(o); plot.orbs = [];
}
function short(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : '' + n; }

// ---------------- sprites / tags ----------------
function makeSprite(text, px, color) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  setSprite(spr, text, color, px); return spr;
}
function setSprite(spr, text, color = '#fff', px = 36) {
  const cvs = document.createElement('canvas'); const s = 2; cvs.width = 256; cvs.height = 128;
  const c = cvs.getContext('2d'); c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `800 ${px * s / 2}px -apple-system, system-ui, sans-serif`;
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const y = 64 + (i - (lines.length - 1) / 2) * px * s / 2 * 1.05;
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(ln, 128, y);
    c.fillStyle = color; c.fillText(ln, 128, y);
  });
  const tex = new THREE.CanvasTexture(cvs); tex.anisotropy = 4;
  if (spr.material.map) spr.material.map.dispose();
  spr.material.map = tex; spr.material.needsUpdate = true;
}
// overhead name + hp tag for remotes
function makeTag(name) {
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 96;
  const ctx = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(3, 1.12, 1); spr.position.y = 2.9;
  function draw(hp = MAX_HP, dead = false) {
    ctx.clearRect(0, 0, 256, 96);
    ctx.textAlign = 'center'; ctx.font = '800 34px system-ui'; ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(name, 128, 34);
    ctx.fillStyle = dead ? '#ff8a8a' : '#fff'; ctx.fillText(name, 128, 34);
    // bar
    const w = 180, x = 38, y = 54, h = 14, f = clamp(hp / MAX_HP, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; roundRect(ctx, x, y, w, h, 7); ctx.fill();
    ctx.fillStyle = f > 0.5 ? '#41d17a' : f > 0.25 ? '#ffcf5c' : '#ff5a4a';
    roundRect(ctx, x, y, w * f, h, 7); ctx.fill();
    tex.needsUpdate = true;
  }
  draw();
  return { sprite: spr, setHp: draw };
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

// ---------------- local player + camera ----------------
const player = { pos: { x: 0, y: 0, z: 0 }, vy: 0, ry: 0, anim: 'idle', onGround: true, hp: MAX_HP, dead: false };
let myAvatar = null;
let spawned = false;   // becomes true on welcome; gates the movement stream
let camYaw = 0, camPitch = -0.15;
const keys = new Set();

// economy state (persisted per user)
let cash = START_CASH;
const unlocks = new Set();
let dropTimer = 0;
let saveName = 'guest';

function income() {
  let inc = BASE_INCOME;
  for (const id of unlocks) { const b = stepDef(id); if (b?.income) inc = Math.max(inc, b.income); }
  return inc;
}
function dropInterval() {
  let iv = DROP_INTERVAL;
  for (const id of unlocks) { const b = stepDef(id); if (b?.interval) iv = Math.min(iv, b.interval); }
  return iv;
}
function unlockedPowers() { return ELEMENTS.filter((e) => unlocks.has(powerBtnId(e.id))); }
function powerBtnId(el) { return BUTTONS.find((b) => b.element === el)?.id; }

function applySave(raw) {
  if (!raw) return;
  if (typeof raw.cash === 'number') cash = raw.cash;
  if (Array.isArray(raw.unlocks)) raw.unlocks.forEach((u) => { if (stepDef(u) || SIDE_BY_ID[u]) unlocks.add(u); });
}
function readLocal() { try { return JSON.parse(localStorage.getItem('tycoon.save.' + saveName) || 'null'); } catch { return null; } }
// Progress follows you across devices. We MERGE the account (server) save with
// this device's local save — union the unlocks, keep the higher cash — so a
// stale/empty save on either side can never wipe your progress. Then we push
// the merged result back so both converge.
async function loadProgress(name) {
  let server = null;
  try {
    const r = await fetch('/api/gamesave/tycoon?name=' + encodeURIComponent(name), { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } });
    const j = await r.json(); if (j && j.data) server = j.data;
  } catch {}
  const local = readLocal();
  const cashes = [server?.cash, local?.cash].filter((c) => typeof c === 'number');
  const allUnlocks = [...new Set([...(server?.unlocks || []), ...(local?.unlocks || [])])];
  applySave({ cash: cashes.length ? Math.max(...cashes) : undefined, unlocks: allUnlocks });
  if (server || local) save();   // write the merged result to BOTH sides
}
let saveDirty = false;
function saveServer() { saveDirty = true; }
function flushServer() {
  if (!saveDirty) return; saveDirty = false;
  fetch('/api/gamesave', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cbx-code': localStorage.getItem('claudebox.code') || '' },
    body: JSON.stringify({ name: localStorage.getItem('claudebox.user'), game: 'tycoon', data: { cash, unlocks: [...unlocks] } }) }).catch(() => {});
}
setInterval(flushServer, 4000);            // periodic sync to the account
addEventListener('pagehide', flushServer); // and a best-effort save on leave
function save() {
  try { localStorage.setItem('tycoon.save.' + saveName, JSON.stringify({ cash, unlocks: [...unlocks] })); } catch {}
  saveServer();
}
function setCash(v) { cash = Math.max(0, Math.round(v)); $('#cash').textContent = short(cash); }

// ---------------- remotes ----------------
const remotes = new Map();
function makeRemote(d) {
  const ctrl = makeAvatar(d.avatar || {});
  const tag = makeTag(d.name);
  ctrl.group.add(tag.sprite);
  scene.add(ctrl.group);
  const rec = { ctrl, group: ctrl.group, tag, interp: new InterpBuffer(), hp: d.hp ?? MAX_HP, dead: !!d.dead };
  remotes.set(d.id, rec);
  // plot ownership
  if (d.plot != null && plots[d.plot]) { const pl = plots[d.plot]; pl.ownerId = d.id; plotSetOwner(pl, d.name, false); plotSetUnlocks(pl, d.unlocks || []); ownerPlot.set(d.id, d.plot); }
  return rec;
}
function dropRemote(id) {
  const r = remotes.get(id); if (r) { scene.remove(r.group); remotes.delete(id); }
  const pi = ownerPlot.get(id); if (pi != null && plots[pi]?.ownerId === id) plotReset(plots[pi]);
  ownerPlot.delete(id);
}

// ---------------- projectiles ----------------
const projMeshes = new Map(); // pid -> { mesh, x,y,z, vx,vy,vz, t }
function projMat(el) {
  const c = new THREE.Color(el.color);
  return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.4 });
}
function makeProj(el) {
  let mesh;
  if (el.kind === 'rock') mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(el.radius * 1.3, 0), projMat(el));
  else if (el.kind === 'bolt') mesh = new THREE.Mesh(new THREE.OctahedronGeometry(el.radius * 1.4, 0), projMat(el));
  else mesh = new THREE.Mesh(new THREE.SphereGeometry(el.radius, 16, 16), projMat(el));
  if (el.id === 'fire' || el.id === 'lightning') {
    const l = new THREE.PointLight(el.color, 1.6, 12); mesh.add(l);
  }
  scene.add(mesh); return mesh;
}

// ---------------- input ----------------
addEventListener('keydown', (e) => {
  if (e.code === 'Enter') { toggleChat(); return; }
  if (chatOpen) return;
  keys.add(e.code);
  if (e.code >= 'Digit1' && e.code <= 'Digit5') selectPower(+e.code.slice(5) - 1);
  if (e.code === 'KeyE') tryBuy();
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', (e) => {
  if (chatOpen) return;
  if (!isTouch && document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) castSelected();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) { camYaw -= e.movementX * 0.0026; camPitch = clamp(camPitch - e.movementY * 0.0022, -1.15, 0.85); }
});
// drag-look fallback (no pointer lock)
let dragId = null, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (isTouch) return; // touch handled below
});

// ---------------- power hotbar UI ----------------
let selected = 0;
function buildHotbar() {
  const bar = $('#hotbar'); bar.innerHTML = '';
  ELEMENTS.forEach((el, i) => {
    const s = document.createElement('div');
    s.className = 'slot'; s.dataset.el = el.id;
    s.innerHTML = `<span class="k">${i + 1}</span><span class="em">${el.emoji}</span><div class="cd" style="transform:scaleY(0)"></div>`;
    s.addEventListener('click', () => selectPower(i));
    bar.appendChild(s);
  });
  refreshHotbar();
}
function refreshHotbar() {
  const slots = $('#hotbar').children;
  ELEMENTS.forEach((el, i) => {
    const has = unlocks.has(powerBtnId(el.id));
    slots[i].style.opacity = has ? '1' : '0.32';
    slots[i].classList.toggle('sel', has && i === selected);
  });
}
function selectPower(i) { if (unlocks.has(powerBtnId(ELEMENTS[i].id))) { selected = i; refreshHotbar(); sfx('tick'); } }
const cdUntil = {};
function castSelected() {
  const el = ELEMENTS[selected];
  if (player.dead || !unlocks.has(powerBtnId(el.id))) return;
  const now = performance.now() / 1000;
  if (now < (cdUntil[el.id] || 0)) return;
  cdUntil[el.id] = now + el.cd;
  animateCd(selected, el.cd);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  net.send({ t: 'cast', el: el.id, x: player.pos.x, y: player.pos.y, z: player.pos.z, dx: dir.x, dy: dir.y, dz: dir.z });
  muzzle(el, dir);
  sfx('cast-' + el.id);
}
function animateCd(i, dur) {
  const cd = $('#hotbar').children[i].querySelector('.cd');
  const t0 = performance.now();
  (function step() {
    const k = clamp((performance.now() - t0) / (dur * 1000), 0, 1);
    cd.style.transform = `scaleY(${1 - k})`;
    if (k < 1) requestAnimationFrame(step);
  })();
}
function muzzle(el, dir) {
  const m = new THREE.PointLight(el.color, 3, 8);
  m.position.set(player.pos.x + dir.x * 1.4, player.pos.y + 1.2 + dir.y, player.pos.z + dir.z * 1.4);
  scene.add(m); setTimeout(() => scene.remove(m), 90);
}

// ---------------- buy interaction ----------------
let hoverBtn = null;
const _pv = new THREE.Vector3();
function padDist2(mp, lx, lz) { _pv.set(lx, 0.35, lz).applyEuler(mp.group.rotation).add(mp.group.position); const dx = player.pos.x - _pv.x, dz = player.pos.z - _pv.z; return dx * dx + dz * dz; }
function updatePrompt() {
  const el = $('#prompt');
  hoverBtn = null;
  const mp = plots.find((p) => p.ownerId === net.id);
  if (mp && !player.dead) {
    let best = 12;
    if (mp.padStep) { const d = padDist2(mp, mp.padStep.lx, mp.padStep.lz); if (d < best) { best = d; hoverBtn = mp.padStep; } }
    for (const [id] of mp.sidePads) { const s = SIDE_BY_ID[id]; const d = padDist2(mp, s.lx, s.lz); if (d < best) { best = d; hoverBtn = s; } }
  }
  if (hoverBtn) {
    const s = hoverBtn, ok = cash >= s.cost;
    el.classList.remove('hidden'); el.classList.toggle('cant', !ok);
    el.innerHTML = ok
      ? `${s.emoji} <b>${s.label}</b> · 💰${short(s.cost)} — <span class="buy-key">TAP</span> or press <span class="buy-key">E</span>`
      : `${s.emoji} <b>${s.label}</b> · need 💰${short(s.cost)} (you have ${short(cash)})`;
  } else el.classList.add('hidden');
  updateObjective();
}
function updateObjective() {
  const ob = $('#objective'); if (!ob) return;
  const powers = unlockedPowers().length;
  let txt;
  if (powers === 0) txt = '🏗️ Stand on a glowing pad and TAP to buy your first power';
  else if (powers < 5) txt = `⚔️ Press 1-${ELEMENTS.length}${isTouch ? ' / tap a slot' : ''} to pick a power, then ${isTouch ? 'tap 🔥' : 'click'} to blast rivals — buy more powers to get stronger`;
  else txt = '🌟 All powers unlocked! Rule the arena.';
  if (ob.textContent !== txt) ob.textContent = txt;
}
function tryBuy() {
  if (!hoverBtn) return;
  const mp = plots.find((p) => p.ownerId === net.id); if (!mp) return;
  const s = hoverBtn;
  if (unlocks.has(s.id)) return;
  if (cash < s.cost) { sfx('deny'); return; }
  const isSide = !!SIDE_BY_ID[s.id];
  setCash(cash - s.cost); unlocks.add(s.id); mp.unlocked.add(s.id); save();
  net.send({ t: 'unlock', id: s.id }); sfx('buy');
  if (isSide) {
    plotBuildSide(mp, s.id); updateSidePads(mp);   // may reveal new side builds
    feed(`Built <b>${s.label}</b> 🏠`);
  } else {
    plotBuild(mp, s.id); plotShowPad(mp);          // build it → reveal the next main step
    if (s.kind === 'power') {
      refreshHotbar();
      const idx = ELEMENTS.findIndex((e) => e.id === s.element); if (idx >= 0) selectPower(idx);
      window.ClaudeBox?.completeChallenge?.('tycoon-power');
      if (unlockedPowers().length >= 5) window.ClaudeBox?.completeChallenge?.('tycoon-max');
      feed(`Unlocked <b>${s.label}</b>! Press ${idx + 1} & click to blast rivals.`);
    } else feed(`Built <b>${s.label}</b> — income now 💰${short(income())}/orb`);
  }
}

// ---------------- economy tick ----------------
function tickEconomy(dt) {
  const myPlot = plots.find((p) => p.ownerId === net.id);
  if (!myPlot) return;
  dropTimer += dt;
  if (dropTimer >= dropInterval()) {
    dropTimer = 0;
    // spawn an orb at the dropper, slide it to the bin
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffcf5c, emissiveIntensity: 0.9 }));
    orb.userData.k = 0; myPlot.group.add(orb); myPlot.orbs.push(orb);
  }
  for (let i = myPlot.orbs.length - 1; i >= 0; i--) {
    const o = myPlot.orbs[i]; o.userData.k += dt / 1.4;
    const k = o.userData.k;
    o.position.set(-7 + k * 13.6, 1.4 + Math.sin(k * Math.PI) * 0.4, 7);
    if (k >= 1) {
      myPlot.group.remove(o); myPlot.orbs.splice(i, 1);
      setCash(cash + income()); coinPop(myPlot); save();
    }
  }
}
function coinPop(plot) {
  const wp = new THREE.Vector3(6.6, 2.4, 7).applyEuler(plot.group.rotation).add(plot.group.position);
  const s = makeSprite('+' + income(), 30, '#ffe08a'); s.position.copy(wp); s.scale.set(2, 1, 1); scene.add(s);
  const t0 = performance.now();
  (function up() { const k = (performance.now() - t0) / 700; s.position.y = wp.y + k * 1.5; s.material.opacity = 1 - k; if (k < 1) requestAnimationFrame(up); else scene.remove(s); })();
}

// ---------------- movement / camera ----------------
function moveInput() {
  let f = 0, r = 0;
  if (keys.has('KeyW')) f += 1; if (keys.has('KeyS')) f -= 1;
  if (keys.has('KeyD')) r += 1; if (keys.has('KeyA')) r -= 1;
  if (touchVec.x || touchVec.y) { r = touchVec.x; f = -touchVec.y; }
  return { f, r };
}

// Collide the player against the plot they're standing on (in the plot's LOCAL
// frame, so it stays axis-aligned despite the plot's rotation). Returns the
// floor/support height under the player (0 = ground; higher = second floor).
const _cv = new THREE.Vector3(), _cv2 = new THREE.Vector3();
function resolveCollision() {
  let plot = null;
  for (const pl of plots) {
    if (!pl.colliders.length) continue;
    const dx = player.pos.x - pl.def.x, dz = player.pos.z - pl.def.z;
    if (dx * dx + dz * dz > 20 * 20) continue;
    _cv.set(player.pos.x, 0, player.pos.z); pl.group.worldToLocal(_cv);
    if (_cv.x > -12 && _cv.x < 12 && _cv.z > -9 && _cv.z < 11) { plot = pl; break; }
  }
  if (!plot) return 0;
  let lx = _cv.x, lz = _cv.z; const feet = player.pos.y;
  const PR = 0.55, STEP = 0.9, PH = 1.5;
  for (const c of plot.colliders) {
    if (c.floor) continue;                                      // horizontal floors/roofs: support only, never shove sideways
    if (c.y1 <= feet + 0.02) continue;                          // below the feet (it's a floor)
    if (c.y0 >= feet + PH) continue;                            // above the head
    if (c.y1 - feet <= STEP && c.y0 <= feet + 0.05) continue;   // low step → walk up, don't block
    const cx = clamp(lx, c.x0, c.x1), cz = clamp(lz, c.z0, c.z1);
    const ddx = lx - cx, ddz = lz - cz, d2 = ddx * ddx + ddz * ddz;
    if (d2 < PR * PR) {
      if (d2 > 1e-6) { const d = Math.sqrt(d2); const push = PR - d; lx += ddx / d * push; lz += ddz / d * push; }
      else { const dl = lx - c.x0, dr = c.x1 - lx, db = lz - c.z0, df = c.z1 - lz, mn = Math.min(dl, dr, db, df); if (mn === dl) lx = c.x0 - PR; else if (mn === dr) lx = c.x1 + PR; else if (mn === db) lz = c.z0 - PR; else lz = c.z1 + PR; }
    }
  }
  let support = 0;
  for (const c of plot.colliders) { if (lx > c.x0 - PR && lx < c.x1 + PR && lz > c.z0 - PR && lz < c.z1 + PR && c.y1 <= feet + STEP && c.y1 > support) support = c.y1; }
  _cv2.set(lx, 0, lz); plot.group.localToWorld(_cv2); player.pos.x = _cv2.x; player.pos.z = _cv2.z;
  return support;
}

function updatePlayer(dt) {
  const { f, r } = moveInput();
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchRun;
  const spd = running ? RUN : WALK;
  const len = Math.hypot(f, r) || 1;
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  // right vector (D = strafe right). Uses -90° so A/D aren't inverted.
  const rx = Math.sin(camYaw - Math.PI / 2), rz = Math.cos(camYaw - Math.PI / 2);
  let moving = (f || r) && !player.dead;
  if (moving) {
    const vx = (fx * f + rx * r) / len * spd, vz = (fz * f + rz * r) / len * spd;
    player.pos.x += vx * dt; player.pos.z += vz * dt;
  }
  // knockback residual
  if (kb.x || kb.z) { player.pos.x += kb.x * dt; player.pos.z += kb.z * dt; kb.x *= 0.86; kb.z *= 0.86; if (Math.abs(kb.x) < 0.1) kb.x = 0; if (Math.abs(kb.z) < 0.1) kb.z = 0; }
  // bounds
  const lim = GROUND - 4; player.pos.x = clamp(player.pos.x, -lim, lim); player.pos.z = clamp(player.pos.z, -lim, lim);
  // structure collisions (walls/machines) + floor support (second floor / stairs)
  const groundY = resolveCollision();
  // jump / gravity
  if ((keys.has('Space') || touchJump) && player.onGround && !player.dead) { player.vy = 9.5; player.onGround = false; touchJump = false; }
  player.vy -= 26 * dt; player.pos.y += player.vy * dt;
  if (player.pos.y <= groundY) { player.pos.y = groundY; player.vy = 0; player.onGround = true; } else player.onGround = false;
  player.ry = camYaw;
  player.anim = !moving ? 'idle' : running ? 'run' : 'walk';
  if (myAvatar) {
    myAvatar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
    myAvatar.group.rotation.y = player.ry;
    myAvatar.setAnim(player.dead ? 'idle' : player.anim);
    myAvatar.moveSpeed = player.anim === 'run' ? RUN : player.anim === 'walk' ? WALK : 0;
    myAvatar.group.visible = !player.dead;
  }
}
const camRay = new THREE.Raycaster(); const _camDir = new THREE.Vector3(), _camOrigin = new THREE.Vector3();
function updateCamera() {
  const tx = player.pos.x, ty = player.pos.y + 1.7, tz = player.pos.z;
  const dist = 6.8, cp = Math.cos(camPitch);
  _camDir.set(-Math.sin(camYaw) * cp, -Math.sin(camPitch) + 0.03, -Math.cos(camYaw) * cp).normalize();
  let d = dist;
  // pull the camera in if a wall/roof is between it and the player
  const mp = plots.find((p) => p.ownerId === net.id);
  if (mp && mp.sideBuilds.size) {
    _camOrigin.set(tx, ty, tz); camRay.set(_camOrigin, _camDir); camRay.far = dist;
    const hits = camRay.intersectObjects([...mp.sideBuilds.values()], true);
    if (hits.length) d = Math.max(1.6, hits[0].distance - 0.4);
  }
  camera.position.set(tx + _camDir.x * d, ty + _camDir.y * d, tz + _camDir.z * d);
  if (camera.position.y < 0.8) camera.position.y = 0.8;
  camera.lookAt(tx, ty, tz);
}

// ---------------- combat feedback ----------------
const kb = { x: 0, z: 0 };
function setHealth(hp) {
  player.hp = hp; $('#health-fill').style.width = clamp(hp / MAX_HP * 100, 0, 100) + '%';
  $('#health-num').textContent = Math.max(0, Math.round(hp));
  $('#health-fill').style.background = hp > 50 ? 'linear-gradient(90deg,#34d17a,#7be6a2)' : hp > 25 ? 'linear-gradient(90deg,#ffcf5c,#ffe08a)' : 'linear-gradient(90deg,#ff5a4a,#ff9a8a)';
}
function flashDmg() { const f = $('#dmg-flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 120); }
let respawnTimer = 0;
function showDead(byName) {
  player.dead = true; $('#dead-overlay').classList.remove('hidden');
  $('#dead-by').textContent = byName ? `Defeated by ${byName}` : '';
  respawnTimer = RESPAWN;
}
function feed(html) {
  const line = document.createElement('div'); line.className = 'feed-line'; line.innerHTML = html;
  $('#feed').prepend(line);
  while ($('#feed').children.length > 4) $('#feed').lastChild.remove();
  setTimeout(() => line.remove(), 6000);
}

// ---------------- chat ----------------
let chatOpen = false;
function toggleChat() {
  const inp = $('#chat-input');
  if (!chatOpen) { chatOpen = true; inp.classList.add('open'); inp.focus(); }
  else { chatOpen = false; const t = inp.value.trim(); inp.value = ''; inp.blur(); inp.classList.remove('open'); if (t) net.send({ t: 'chat', text: t }); }
}
function addChat(name, text, self, sys) {
  const el = document.createElement('div'); el.className = 'cl' + (sys ? ' sys' : '');
  el.innerHTML = `<b>${esc(name)}</b> ${esc(text)}`;
  $('#chat-log').appendChild(el);
  while ($('#chat-log').children.length > 7) $('#chat-log').firstChild.remove();
}
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ---------------- sound (tiny Web Audio) ----------------
let actx = null;
function sfx(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
    const n = actx.currentTime; let f = 440, type = 'sine', dur = 0.15, vol = 0.14;
    if (kind === 'buy') { f = 700; type = 'triangle'; dur = 0.18; }
    else if (kind === 'deny') { f = 150; type = 'square'; dur = 0.12; }
    else if (kind === 'tick') { f = 520; dur = 0.05; vol = 0.08; }
    else if (kind === 'hit') { f = 220; type = 'square'; dur = 0.1; }
    else if (kind.startsWith('cast-')) {
      const el = kind.slice(5); type = el === 'lightning' ? 'sawtooth' : el === 'earth' ? 'square' : 'triangle';
      f = el === 'fire' ? 260 : el === 'water' ? 520 : el === 'earth' ? 120 : el === 'air' ? 700 : 900; dur = 0.2; vol = 0.16;
    }
    o.type = type; o.frequency.setValueAtTime(f, n);
    if (kind.startsWith('cast-')) o.frequency.exponentialRampToValueAtTime(f * 0.5, n + dur);
    g.gain.setValueAtTime(vol, n); g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
    o.start(n); o.stop(n + dur);
  } catch {}
}

// ---------------- touch controls ----------------
const touchVec = { x: 0, y: 0 }; let touchRun = false, touchJump = false;
function setupTouch() {
  $('#touch').classList.remove('hidden');
  const stick = $('#stick'), knob = stick.querySelector('i');
  let sid = null, cx = 0, cy = 0;
  stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === sid) {
      let dx = t.clientX - cx, dy = t.clientY - cy; const m = Math.hypot(dx, dy) || 1; const cl = Math.min(m, 54);
      dx = dx / m * cl; dy = dy / m * cl; knob.style.transform = `translate(${dx}px,${dy}px)`;
      touchVec.x = dx / 54; touchVec.y = dy / 54; touchRun = m > 40;
    }
  }, { passive: false });
  addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; knob.style.transform = ''; touchVec.x = touchVec.y = 0; touchRun = false; } });
  // look drag on right half
  let lid = null, lx = 0, ly = 0;
  canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; if (t.clientX > innerWidth / 2 && lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === lid) { camYaw -= (t.clientX - lx) * 0.006; camPitch = clamp(camPitch - (t.clientY - ly) * 0.005, -1.15, 0.85); lx = t.clientX; ly = t.clientY; } }, { passive: false });
  canvas.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; });
  $('#t-jump').addEventListener('touchstart', (e) => { touchJump = true; e.preventDefault(); }, { passive: false });
  $('#t-fire').addEventListener('touchstart', (e) => { castSelected(); e.preventDefault(); }, { passive: false });
  // tap plot button to buy
  $('#t-fire').addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
}

// ---------------- net ----------------
const net = new Net();
net.on('welcome', (msg) => {
  for (const d of msg.players) makeRemote(d);
  // spawn where the server put us (at our own plot) — not stuck at world origin
  if (msg.you.pos) { player.pos.x = msg.you.pos.x; player.pos.y = msg.you.pos.y || 0; player.pos.z = msg.you.pos.z; }
  // my plot
  if (msg.you.plot != null && plots[msg.you.plot]) {
    const mp = plots[msg.you.plot];
    mp.ownerId = net.id; plotSetOwner(mp, msg.you.name, true);
    plotSetUnlocks(mp, [...unlocks]); plotShowPad(mp); updateSidePads(mp); ownerPlot.set(net.id, msg.you.plot);
    // face our plot's build area (toward the centre arena)
    camYaw = PLOTS[msg.you.plot].ry + Math.PI;
    // replay saved unlocks to the server so others see my built plot
    for (const u of unlocks) net.send({ t: 'unlock', id: u });
  }
  spawned = true;   // now it's safe to stream our real position (fixes join damage)
  refreshHotbar();
  // pick a default selected power if any owned
  const firstOwned = ELEMENTS.findIndex((e) => unlocks.has(powerBtnId(e.id))); if (firstOwned >= 0) selected = firstOwned;
  $('#loading').classList.add('hidden'); $('#hud').classList.remove('hidden'); $('#crosshair').classList.remove('hidden');
  feed('Welcome! Grow your plot, unlock powers, then fight in the arena.');
});
net.on('player.join', (m) => { if (m.player.id !== net.id && !remotes.has(m.player.id)) { makeRemote(m.player); addChat('System', `${m.player.name} joined`, false, true); } });
net.on('player.leave', (m) => dropRemote(m.id));
net.on('player.unlock', (m) => { const pi = ownerPlot.get(m.id); if (pi != null && plots[pi]) { const pl = plots[pi]; pl.unlocked.add(m.btn); if (SIDE_BY_ID[m.btn]) plotBuildSide(pl, m.btn); else plotBuild(pl, m.btn); } });
net.on('snapshot', (m) => {
  for (const row of m.players) { const [id, x, y, z, ry, anim, hp, dead] = row; if (id === net.id) { if (typeof hp === 'number' && !player.dead) setHealth(hp); continue; } const r = remotes.get(id); if (r) { r.interp.push([x, y, z, ry, anim]); if (r.hp !== hp) { r.hp = hp; r.tag.setHp(hp, !!dead); } r.dead = !!dead; r.group.visible = !dead; } }
  // projectiles
  const live = new Set();
  for (const row of m.proj) {
    const [pid, elId, x, y, z, vx, vy, vz] = row; live.add(pid);
    let p = projMeshes.get(pid);
    if (!p) { const mesh = makeProj(ELEMENT_BY_ID[elId] || ELEMENTS[0]); p = { mesh }; projMeshes.set(pid, p); }
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.t = performance.now() / 1000;
  }
  for (const [pid, p] of projMeshes) if (!live.has(pid)) { scene.remove(p.mesh); projMeshes.delete(pid); }
});
net.on('hit', (m) => {
  if (m.id === net.id) {
    setHealth(m.hp); flashDmg(); sfx('hit');
    if (m.kx || m.kz) { kb.x += m.kx; kb.z += m.kz; }
  } else { const r = remotes.get(m.id); if (r) { r.hp = m.hp; r.tag.setHp(m.hp, false); } }
  // impact spark
  const r = remotes.get(m.id); const pos = m.id === net.id ? player.pos : r?.group.position;
  if (pos) { const el = ELEMENT_BY_ID[m.el] || ELEMENTS[0]; const l = new THREE.PointLight(el.color, 3, 8); l.position.set(pos.x, pos.y + 1.2, pos.z); scene.add(l); setTimeout(() => scene.remove(l), 120); }
});
net.on('died', (m) => {
  const meVictim = m.id === net.id, meKiller = m.by === net.id;
  const vName = meVictim ? 'You' : remotes.get(m.id) ? tagName(m.id) : 'Someone';
  feed(`<b>${esc(m.byName || 'Someone')}</b> defeated <b>${esc(vName)}</b> ⚔️`);
  if (meVictim) showDead(m.byName);
  if (meKiller && !meVictim) { window.ClaudeBox?.completeChallenge?.('tycoon-elim'); sfx('buy'); }
});
net.on('respawn', (m) => {
  if (m.id === net.id) { player.dead = false; player.pos.x = m.x; player.pos.y = m.y; player.pos.z = m.z; player.vy = 0; setHealth(MAX_HP); $('#dead-overlay').classList.add('hidden'); }
  else { const r = remotes.get(m.id); if (r) { r.dead = false; r.group.visible = true; r.hp = MAX_HP; r.tag.setHp(MAX_HP, false); } }
});
net.on('chat', (m) => addChat(m.name, m.text, m.id === net.id));
net.on('toast', (m) => addChat('System', m.text, false, true));
let kicked = false;
net.on('kicked', (m) => {
  kicked = true; spawned = false;
  const o = document.createElement('div'); o.id = 'kicked-overlay';
  o.innerHTML = `<div class="kick-card"><div class="kick-emoji">🚪💥</div><h1>Kicked out!</h1><p>${(m.reason || 'You joined from another device.')}</p><button onclick="location.reload()">Reload to play here</button></div>`;
  document.body.appendChild(o);
});
net.on('_disconnect', () => { if (!kicked) feed('Disconnected — refresh to rejoin.'); });
function tagName(id) { const cvs = remotes.get(id); return cvs ? 'a rival' : 'Someone'; }

// ---------------- loop ----------------
let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!player.dead) updatePlayer(dt); else { if (myAvatar) myAvatar.group.visible = false; }
  if (respawnTimer > 0) { respawnTimer -= dt; $('#respawn-n').textContent = Math.ceil(respawnTimer); }
  if (myAvatar) myAvatar.update(dt);
  tickEconomy(dt);
  updatePrompt();
  // remotes
  for (const [, r] of remotes) {
    const s = r.interp.sample([3]);
    if (s) { r.group.position.set(s[0], s[1], s[2]); r.group.rotation.y = s[3]; r.ctrl.setAnim(s[4]); r.ctrl.moveSpeed = s[4] === 'run' ? RUN : s[4] === 'walk' ? WALK : 0; }
    r.ctrl.update(dt);
  }
  // spin power crystals
  for (const pl of plots) for (const c of pl.crystals) c.rotation.y += dt * 1.3;
  // projectiles extrapolate
  const tnow = performance.now() / 1000;
  for (const [, p] of projMeshes) {
    const e = tnow - p.t;
    p.mesh.position.set(p.x + p.vx * e, p.y + p.vy * e, p.z + p.vz * e);
    p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 5;
  }
  updateZone();
  updateCamera();
  renderer.render(scene, camera);
}
function updateZone() {
  const z = $('#zone'); if (!z) return;
  const inArena = (player.pos.x * player.pos.x + player.pos.z * player.pos.z) <= ARENA_RADIUS * ARENA_RADIUS;
  if (inArena && !z.classList.contains('arena')) { z.className = 'arena'; z.textContent = '⚔️ Battle Arena — PvP ON'; }
  else if (!inArena && !z.classList.contains('safe')) { z.className = 'safe'; z.textContent = '🛡️ Safe Zone'; }
}

// ---------------- boot ----------------
async function boot() {
  const name = localStorage.getItem('claudebox.user');
  if (!name) { location.href = '/'; return; }
  saveName = name.toLowerCase();
  let profile = {};
  try {
    const res = await fetch('/api/avatar/' + encodeURIComponent(name), { headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' } });
    if (!res.ok) throw 0; const data = await res.json(); profile = data.avatar || {};
    localStorage.setItem('claudebox.user', data.name);
  } catch { location.href = '/'; return; }
  $('#load-msg').textContent = 'Loading avatars…';
  await preloadAvatars(['boy', 'girl']);
  myAvatar = makeAvatar(profile); scene.add(myAvatar.group);
  await loadProgress(localStorage.getItem('claudebox.user')); setCash(cash); buildHotbar();
  // buying works by tapping/clicking the prompt (so phones can buy too) or pressing E
  $('#prompt').addEventListener('click', () => tryBuy());
  $('#prompt').addEventListener('touchend', (e) => { e.preventDefault(); tryBuy(); });
  if (isTouch) setupTouch();
  net.connect();
  net.join({ name: localStorage.getItem('claudebox.user'), avatar: profile, code: localStorage.getItem('claudebox.code') || '' });
  net.startMovementStream(() => spawned ? ({ t: 'move', x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), ry: +player.ry.toFixed(3), anim: player.anim }) : null);
  requestAnimationFrame(frame);
  window.__tycoon = { player, plots, remotes, net, scene };
}
boot();
