// RS2 restaurant shells, generated from restaurant data: floor, walls with
// storefront windows + door gap, sloped striped awning, roof, name sign.
// Walls produce BOX colliders (solid for players and the camera).

import * as THREE from 'three';
import { EXPANSIONS, buildingFrame } from '/shared/rs2/world.js';
import { FLOOR_TEX, wallPlaster, awningStripes, roofShingles } from '../textures.js';

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const WALL_H = 4.2;
const BASE_Y = 2.05;

export function buildRestaurantShell(plot, restaurant) {
  const frame = buildingFrame(plot, restaurant.expansion);
  const { w, d, f } = frame;
  const g = new THREE.Group();
  const colliders = [];

  // ---- floor ----
  const floorTex = (FLOOR_TEX[restaurant.floor] || FLOOR_TEX.wood)();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lambert('#ffffff', { map: floorTex.clone() }));
  floor.material.map.needsUpdate = true;
  floor.material.map.repeat.set(w / 4, d / 4);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(frame.cx, BASE_Y + 0.12, frame.cz);
  g.add(floor);

  // ---- walls ----
  const wallMat = lambert(restaurant.wall || '#e8dcc8', { map: wallPlaster() });
  const yMid = BASE_Y + WALL_H / 2;
  const backZ = frame.cz - f * (d / 2);
  const frontZ = frame.cz + f * (d / 2);
  const doorW = 2.6;

  const wallBox = (bw, bh, bd, x, y, z, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), wallMat);
    m.position.set(x, y, z);
    g.add(m);
    if (solid) {
      colliders.push({
        box: true,
        minX: x - bw / 2 - 0.1, maxX: x + bw / 2 + 0.1,
        minZ: z - bd / 2 - 0.1, maxZ: z + bd / 2 + 0.1,
        top: y + bh / 2,
      });
    }
    return m;
  };

  wallBox(w + 0.5, WALL_H, 0.4, frame.cx, yMid, backZ);                 // back
  wallBox(0.4, WALL_H, d + 0.5, frame.cx - w / 2, yMid, frame.cz);     // west
  wallBox(0.4, WALL_H, d + 0.5, frame.cx + w / 2, yMid, frame.cz);     // east
  const segW = (w - doorW) / 2;
  wallBox(segW, WALL_H, 0.4, frame.cx - doorW / 2 - segW / 2, yMid, frontZ);
  wallBox(segW, WALL_H, 0.4, frame.cx + doorW / 2 + segW / 2, yMid, frontZ);
  // header above the door: visual only (you walk under it)
  wallBox(doorW + 0.3, 1.0, 0.4, frame.cx, BASE_Y + WALL_H - 0.5, frontZ, false);
  // door frame trim
  for (const sx of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.5), lambert('#6e4a30'));
    jamb.position.set(frame.cx + sx * (doorW / 2 + 0.02), BASE_Y + 1.6, frontZ);
    g.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.4, 0.18, 0.5), lambert('#6e4a30'));
  lintel.position.set(frame.cx, BASE_Y + 3.25, frontZ);
  g.add(lintel);

  // storefront windows set into the front segments
  const glass = new THREE.MeshLambertMaterial({ color: '#9fc8de', transparent: true, opacity: 0.5 });
  for (const sx of [-1, 1]) {
    const winX = frame.cx + sx * (doorW / 2 + segW / 2);
    const win = new THREE.Mesh(new THREE.BoxGeometry(segW * 0.68, 1.8, 0.2), glass);
    win.position.set(winX, BASE_Y + 2.15, frontZ + f * 0.18);
    g.add(win);
    const frameTrim = new THREE.Mesh(new THREE.BoxGeometry(segW * 0.74, 1.95, 0.1), lambert('#ffffff'));
    frameTrim.position.set(winX, BASE_Y + 2.15, frontZ + f * 0.1);
    g.add(frameTrim);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(segW * 0.78, 0.14, 0.5), lambert('#ffffff'));
    sill.position.set(winX, BASE_Y + 1.12, frontZ + f * 0.15);
    g.add(sill);
  }

  // ---- sloped striped awning over the door ----
  const awnTex = awningStripes(restaurant.awning || '#c0564a');
  awnTex.repeat.set(3, 1);
  const awn = new THREE.Mesh(new THREE.BoxGeometry(doorW + 1.8, 0.1, 1.7), lambert('#ffffff', { map: awnTex }));
  awn.position.set(frame.cx, BASE_Y + 3.62, frontZ + f * 0.95);
  awn.rotation.x = f * 0.42; // slopes down toward the street
  g.add(awn);
  // valance (hanging front strip)
  const valTex = awningStripes(restaurant.awning || '#c0564a');
  valTex.repeat.set(3, 0.3);
  const valance = new THREE.Mesh(new THREE.BoxGeometry(doorW + 1.8, 0.34, 0.06), lambert('#ffffff', { map: valTex }));
  valance.position.set(frame.cx, BASE_Y + 3.22, frontZ + f * 1.72);
  g.add(valance);
  // awning side brackets
  for (const sx of [-1, 1]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), lambert('#6e4a30'));
    rod.position.set(frame.cx + sx * (doorW / 2 + 0.8), BASE_Y + 3.4, frontZ + f * 0.9);
    rod.rotation.x = Math.PI / 2 - f * 0.42;
    g.add(rod);
  }

  // ---- roof + trim ----
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.3, d + 0.9), lambert('#6e5a4a', { map: roofShingles() }));
  roof.position.set(frame.cx, BASE_Y + WALL_H + 0.15, frame.cz);
  g.add(roof);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 1.1, 0.35, d + 1.1), lambert('#54453a'));
  trim.position.set(frame.cx, BASE_Y + WALL_H + 0.38, frame.cz);
  g.add(trim);

  // ---- name sign ----
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512; signCanvas.height = 128;
  const ctx = signCanvas.getContext('2d');
  ctx.fillStyle = '#3a2c22';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#e8b94a';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = '#ffe9b8';
  ctx.font = 'bold 56px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((restaurant.name || 'Restaurant').slice(0, 18), 256, 68);
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w * 0.8, 10), 1.6, 0.3), new THREE.MeshLambertMaterial({ map: signTex }));
  sign.position.set(frame.cx, BASE_Y + WALL_H + 1.3, frontZ + f * 0.1);
  if (f < 0) sign.rotation.y = Math.PI;
  g.add(sign);

  // ---- rating stars above the awning ----
  const starsCanvas = document.createElement('canvas');
  starsCanvas.width = 256; starsCanvas.height = 48;
  const starsTex = new THREE.CanvasTexture(starsCanvas);
  const stars = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.58), new THREE.MeshBasicMaterial({ map: starsTex, transparent: true }));
  stars.position.set(frame.cx, BASE_Y + WALL_H - 0.18, frontZ + f * 0.45);
  if (f < 0) stars.rotation.y = Math.PI;
  g.add(stars);
  g.userData.setRating = (rating) => {
    const c = starsTex.image.getContext('2d');
    c.clearRect(0, 0, 256, 48);
    c.font = '38px sans-serif';
    c.textBaseline = 'middle';
    for (let i = 0; i < 5; i++) {
      c.globalAlpha = rating >= i + 0.5 ? 1 : 0.22;
      c.fillText('⭐', 8 + i * 50, 26);
    }
    c.globalAlpha = 1;
    starsTex.needsUpdate = true;
  };
  g.userData.setRating(restaurant.rating ?? 3);

  return { group: g, frame, colliders };
}

export { EXPANSIONS, BASE_Y, WALL_H };
