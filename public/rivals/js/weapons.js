// Rivals — weapon models.
//
// Every gun in the roster is modelled here from shared sub-assemblies (grips,
// magazines, rails, optics, muzzle devices) so the arsenal reads as one designed
// family instead of a pile of one-offs. Nothing is a recoloured clone any more:
// each weapon has its own silhouette, furniture and moving parts.
//
// Materials are physically-shaded with procedurally generated maps and a small
// generated environment, which is what gives the metal its sheen. Geometry and
// materials are cached and shared across instances — cloning a Mesh copies both
// by reference, so 20 weapons cost a couple of dozen buffers.

import * as THREE from 'three';

// ---------------------------------------------------------------- textures
const texCache = new Map();
function tex(key, draw, size = 128) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
const rnd = (seed) => { let x = seed; return () => (x = (x * 9301 + 49297) % 233280) / 233280; };

// fine brushed streaks — reads as machined aluminium at viewmodel distance
const brushed = () => tex('brushed', (g, s) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
  const r = rnd(11);
  for (let i = 0; i < 260; i++) {
    const v = 0.72 + r() * 0.28;
    g.strokeStyle = `rgba(${(v * 255) | 0},${(v * 255) | 0},${(v * 255) | 0},.55)`;
    g.lineWidth = r() * 1.6 + 0.3;
    const y = r() * s;
    g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + (r() - 0.5) * 3); g.stroke();
  }
});
// moulded polymer stipple
const stipple = () => tex('stipple', (g, s) => {
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
  const r = rnd(29);
  for (let i = 0; i < 2600; i++) {
    const v = r() > 0.5 ? 255 : 150;
    g.fillStyle = `rgba(${v},${v},${v},.5)`;
    g.fillRect(r() * s, r() * s, 1.6, 1.6);
  }
});
// walnut furniture
const walnut = () => tex('walnut', (g, s) => {
  g.fillStyle = '#8a5a30'; g.fillRect(0, 0, s, s);
  const r = rnd(53);
  for (let i = 0; i < 46; i++) {
    g.strokeStyle = `rgba(${60 + r() * 40 | 0},${34 + r() * 24 | 0},${14 + r() * 14 | 0},${0.25 + r() * 0.4})`;
    g.lineWidth = 1 + r() * 3;
    const y = r() * s;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(s * 0.3, y + (r() - 0.5) * 14, s * 0.7, y + (r() - 0.5) * 14, s, y + (r() - 0.5) * 8);
    g.stroke();
  }
});
// checkered rubber grip
const checker = () => tex('checker', (g, s) => {
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, s, s);
  const n = 16, cell = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,.85)' : 'rgba(90,90,90,.85)';
    g.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
  }
});

// ---------------------------------------------------------------- materials
// A tiny gradient environment gives the metals something to reflect. Without it
// a metalness>0 standard material renders nearly black.
let envMap = null;
export function initWeaponEnv(renderer) {
  if (envMap || !renderer) return envMap;
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, '#ffffff');      // sky
    grd.addColorStop(0.38, '#cfe0f5');
    grd.addColorStop(0.5, '#8f9db2');    // horizon
    grd.addColorStop(0.52, '#6b7382');
    grd.addColorStop(1, '#3a4048');      // ground bounce
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    envMap = pmrem.fromEquirectangular(t).texture;
    pmrem.dispose(); t.dispose();
    for (const m of Object.values(MAT)) { if (m && 'envMap' in m) { m.envMap = envMap; m.needsUpdate = true; } }
  } catch { envMap = null; }
  return envMap;
}

const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.9, ...o });

// The shared palette. Skins swap a mesh's material REFERENCE (they never mutate
// these), so sharing across every weapon is safe.
export const MAT = {
  gunmetal: std({ color: '#454c58', metalness: 0.78, roughness: 0.4,  map: brushed(), roughnessMap: brushed(), envMapIntensity: 1.3 }),
  blued:    std({ color: '#22262d', metalness: 0.86, roughness: 0.28, map: brushed(), envMapIntensity: 1.35 }),
  steel:    std({ color: '#c2ccdb', metalness: 0.92, roughness: 0.2,  map: brushed(), roughnessMap: brushed(), envMapIntensity: 1.5 }),
  chrome:   std({ color: '#eaeff6', metalness: 0.98, roughness: 0.08, envMapIntensity: 1.6 }),
  polymer:  std({ color: '#282c33', metalness: 0.05, roughness: 0.84, map: stipple() }),
  polyLite: std({ color: '#5a626e', metalness: 0.08, roughness: 0.72, map: stipple() }),
  rubber:   std({ color: '#2a2e35', metalness: 0.02, roughness: 0.95, map: checker() }),
  wood:     std({ color: '#b8763a', metalness: 0.02, roughness: 0.58, map: walnut() }),
  gold:     std({ color: '#e3b452', metalness: 0.95, roughness: 0.2, envMapIntensity: 1.5 }),
  brass:    std({ color: '#d8ae2e', metalness: 0.9,  roughness: 0.28, envMapIntensity: 1.4 }),
  glass:    std({ color: '#7fd8ff', metalness: 0.1,  roughness: 0.05, transparent: true, opacity: 0.55,
                  emissive: '#2b6f9a', emissiveIntensity: 0.6 }),
  reticle:  new THREE.MeshBasicMaterial({ color: '#ff4d5e' }),
  lamp:     new THREE.MeshBasicMaterial({ color: '#8ef0ff' }),
};

// ---------------------------------------------------------------- geometry
const geoCache = new Map();
const G = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };

// soft-edged box, matching the game's chunky look
function roundedBoxGeo(w, h, d, r) {
  r = Math.min(r, w / 2, h / 2, d / 2);
  const geo = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const pos = geo.attributes.position;
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(Math.max(-ix, Math.min(ix, v.x)), Math.max(-iy, Math.min(iy, v.y)), Math.max(-iz, Math.min(iz, v.z)));
    const dir = v.sub(c); const len = dir.length() || 1;
    pos.setXYZ(i, c.x + dir.x / len * r, c.y + dir.y / len * r, c.z + dir.z / len * r);
  }
  geo.computeVertexNormals();
  return geo;
}
const boxG = (w, h, d, r) => G(`b${w}_${h}_${d}_${r}`, () => roundedBoxGeo(w, h, d, r ?? Math.min(w, h, d) * 0.3));
const cylG = (rt, rb, h, seg = 12) => G(`c${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const torG = (r, t, seg = 10, ring = 16) => G(`t${r}_${t}_${seg}_${ring}`, () => new THREE.TorusGeometry(r, t, seg, ring));
const sphG = (r, w = 12, h = 10) => G(`s${r}_${w}_${h}`, () => new THREE.SphereGeometry(r, w, h));

// place a mesh
function P(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  return m;
}
const bx = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) => P(boxG(w, h, d), mat, x, y, z, rx, ry, rz);
// a cylinder lying along Z (barrels, tubes, scopes)
const rod = (r, len, mat, x, y, z, seg = 12) => P(cylG(r, r, len, seg), mat, x, y, z, Math.PI / 2, 0, 0);

// ---------------------------------------------------------------- assemblies
// Reused across the roster — this is what makes the family feel designed.

// picatinny rail: a base plus evenly spaced cross-slots
function rail(len, mat, x, y, z, slots = 0) {
  const out = [bx(0.05, 0.018, len, mat, x, y, z, 0, 0, 0)];
  const n = slots || Math.max(3, Math.round(len / 0.05));
  for (let i = 0; i < n; i++) {
    const zz = z - len / 2 + 0.02 + i * ((len - 0.04) / Math.max(1, n - 1));
    out.push(bx(0.056, 0.026, 0.012, mat, x, y + 0.006, zz));
  }
  return out;
}

// pistol grip with a palm swell and a checkered strap
function grip(mat, x, y, z, tilt = 0.3, w = 0.062, h = 0.17, d = 0.09) {
  return [
    bx(w, h, d, mat, x, y, z, tilt),
    bx(w * 0.72, h * 0.82, 0.022, MAT.rubber, x, y - 0.005, z + d * 0.46, tilt),  // backstrap
    bx(w * 1.12, 0.022, d * 0.9, mat, x, y + h * 0.5, z, tilt),                    // collar
  ];
}

// trigger guard loop + trigger blade
function trigger(mat, x, y, z) {
  return [
    P(torG(0.045, 0.009, 8, 14), mat, x, y - 0.045, z, 0, Math.PI / 2, 0),
    bx(0.014, 0.045, 0.014, MAT.steel, x, y - 0.035, z + 0.005, 0.2),
  ];
}

// box magazine; `curve` bends it like a STANAG
function magazine(w, h, d, mat, x, y, z, curve = 0) {
  const g = new THREE.Group();
  g.add(bx(w, h, d, mat, 0, 0, 0, curve));
  g.add(bx(w * 1.08, 0.02, d * 1.04, mat, 0, h * 0.48, -curve * 0.02));      // feed lips
  g.add(bx(w * 0.5, 0.012, d * 0.5, MAT.steel, 0, -h * 0.5 + 0.006, 0));     // floorplate
  for (let i = 0; i < 3; i++) g.add(bx(w * 1.02, 0.008, d * 0.7, MAT.polyLite, 0, h * 0.2 - i * 0.045, 0));  // witness ribs
  g.position.set(x, y, z);
  return g;
}

// red-dot optic: hood, lens, mount, and a visible dot
function redDot(x, y, z, scale = 1) {
  const g = new THREE.Group();
  g.add(bx(0.052, 0.03, 0.05, MAT.gunmetal, 0, -0.028, 0));                 // mount
  g.add(bx(0.056, 0.052, 0.085, MAT.gunmetal, 0, 0.012, 0));                // housing
  g.add(P(cylG(0.022, 0.022, 0.006, 14), MAT.glass, 0, 0.014, -0.03, Math.PI / 2));
  g.add(P(sphG(0.005, 8, 6), MAT.reticle, 0, 0.014, -0.033));               // the dot
  g.add(bx(0.058, 0.014, 0.014, MAT.gunmetal, 0, 0.042, 0));                // top strap
  g.scale.setScalar(scale);
  g.position.set(x, y, z);
  return g;
}

// magnified scope: tube, bells, turrets, lens
function scope(len, x, y, z, tubeR = 0.032) {
  const g = new THREE.Group();
  g.add(rod(tubeR, len, MAT.blued, 0, 0, 0, 14));
  g.add(rod(tubeR * 1.5, 0.075, MAT.blued, 0, 0, -len / 2 - 0.02, 14));      // objective bell
  g.add(rod(tubeR * 1.32, 0.06, MAT.blued, 0, 0, len / 2 + 0.015, 14));      // eyepiece
  g.add(P(cylG(tubeR * 1.42, tubeR * 1.42, 0.006, 16), MAT.glass, 0, 0, -len / 2 - 0.056, Math.PI / 2));
  g.add(P(cylG(0.02, 0.02, 0.03, 10), MAT.steel, 0, tubeR + 0.012, -0.02));  // elevation turret
  g.add(P(cylG(0.018, 0.018, 0.026, 10), MAT.steel, tubeR + 0.01, 0, -0.02, 0, 0, Math.PI / 2));
  for (const zz of [-len * 0.3, len * 0.3]) g.add(bx(0.05, 0.055, 0.03, MAT.gunmetal, 0, -tubeR - 0.012, zz));  // rings
  g.position.set(x, y, z);
  return g;
}

// ported muzzle brake
function brake(mat, x, y, z, r = 0.03, len = 0.09) {
  const out = [rod(r * 1.35, len, mat, x, y, z, 12)];
  for (let i = 0; i < 3; i++) {
    const zz = z - len / 2 + 0.02 + i * (len / 3.2);
    out.push(bx(r * 3, 0.008, 0.012, mat, x, y + r * 0.9, zz));
    out.push(bx(r * 3, 0.008, 0.012, mat, x, y - r * 0.9, zz));
  }
  return out;
}

// collapsible stock on a buffer tube
function collapsibleStock(mat, x, y, z) {
  return [
    rod(0.026, 0.26, MAT.gunmetal, x, y, z - 0.06, 10),          // buffer tube
    bx(0.062, 0.1, 0.16, mat, x, y - 0.004, z + 0.08),           // slider
    bx(0.07, 0.13, 0.035, MAT.rubber, x, y - 0.01, z + 0.17),    // butt pad
    bx(0.03, 0.05, 0.06, mat, x, y - 0.06, z + 0.06),            // cheek lug
  ];
}

// folded bipod under the barrel
function bipod(x, y, z) {
  const g = new THREE.Group();
  g.add(bx(0.03, 0.03, 0.06, MAT.gunmetal, 0, 0, 0));
  for (const s of [-1, 1]) {
    g.add(bx(0.014, 0.13, 0.014, MAT.steel, s * 0.022, -0.06, 0.02, 0.35, 0, s * 0.28));
    g.add(bx(0.02, 0.016, 0.02, MAT.rubber, s * 0.038, -0.12, 0.06));
  }
  g.position.set(x, y, z);
  return g;
}

// flip-up iron sights
function ironSights(mat, frontZ, rearZ, y) {
  return [
    bx(0.03, 0.05, 0.014, mat, 0, y + 0.03, frontZ),                 // front post housing
    bx(0.008, 0.03, 0.008, MAT.steel, 0, y + 0.045, frontZ),         // post
    bx(0.05, 0.038, 0.014, mat, 0, y + 0.026, rearZ),                // rear aperture
    P(torG(0.012, 0.005, 6, 12), MAT.steel, 0, y + 0.034, rearZ, 0, 0, 0),
  ];
}

// ---------------------------------------------------------------- weapons
// Each returns { parts, fx, arms }. `fx` keeps the exact contract the animation
// code expects: bolt/mag/slide/serr with their z0/y0 rest positions recorded.
const BUILD = {};

// ============================ ASSAULT RIFLE ============================
BUILD.ar = () => {
  const mag = magazine(0.062, 0.19, 0.095, MAT.polymer, 0, -0.15, -0.06, 0.14);
  const bolt = bx(0.03, 0.032, 0.075, MAT.steel, 0.052, 0.062, 0.06);       // charging handle
  const parts = [
    ...collapsibleStock(MAT.polymer, 0, -0.01, 0.3),
    bx(0.088, 0.115, 0.42, MAT.gunmetal, 0, 0, 0.02),                        // lower + upper receiver
    bx(0.092, 0.045, 0.2, MAT.gold, 0, 0.05, 0.02),                          // upper deck (skin accent)
    bx(0.02, 0.05, 0.07, MAT.blued, 0.05, 0.01, 0.1),                        // ejection port cover
    P(cylG(0.016, 0.016, 0.03, 8), MAT.gunmetal, 0.05, -0.005, 0.16, 0, 0, Math.PI / 2),  // forward assist
    ...grip(MAT.polymer, 0, -0.115, 0.15, 0.32),
    ...trigger(MAT.gunmetal, 0, -0.03, 0.11),
    mag, bolt,
    bx(0.078, 0.082, 0.3, MAT.polyLite, 0, 0.005, -0.32),                    // handguard
    ...rail(0.3, MAT.gunmetal, 0, 0.05, -0.32),
    ...rail(0.22, MAT.gunmetal, 0, 0.05, 0.02),
    rod(0.018, 0.34, MAT.blued, 0, 0.012, -0.62),                            // barrel
    bx(0.042, 0.06, 0.05, MAT.gunmetal, 0, 0.03, -0.5),                      // gas block
    ...brake(MAT.gunmetal, 0, 0.012, -0.82),
    redDot(0, 0.106, -0.06),
  ];
  return { parts, fx: { bolt, mag }, arms: [[0.06, -0.16, 0.22], [0.5, -0.12, 0], [-0.08, -0.1, -0.32], [0.35, 0.35, 0.1]] };
};

// ============================ CARBINE ============================
BUILD.carbine = () => {
  const mag = magazine(0.058, 0.16, 0.09, MAT.polyLite, 0, -0.13, -0.04, 0.12);
  const bolt = bx(0.028, 0.03, 0.07, MAT.steel, 0.05, 0.058, 0.05);
  const hand = [];
  for (let i = 0; i < 5; i++) hand.push(bx(0.086, 0.016, 0.024, MAT.gunmetal, 0, -0.03, -0.2 - i * 0.045));  // M-LOK slots
  const parts = [
    // skeleton stock — open frame rather than the AR's solid slider
    rod(0.024, 0.24, MAT.gunmetal, 0, -0.01, 0.2, 10),
    bx(0.055, 0.018, 0.2, MAT.polyLite, 0, 0.045, 0.24),
    bx(0.055, 0.018, 0.2, MAT.polyLite, 0, -0.062, 0.24),
    bx(0.06, 0.115, 0.03, MAT.rubber, 0, -0.008, 0.35),
    bx(0.084, 0.108, 0.36, MAT.gunmetal, 0, 0, 0.01),
    bx(0.088, 0.04, 0.18, MAT.gold, 0, 0.048, 0.01),
    ...grip(MAT.rubber, 0, -0.11, 0.13, 0.34, 0.058, 0.155, 0.085),
    ...trigger(MAT.gunmetal, 0, -0.028, 0.09),
    mag, bolt,
    bx(0.07, 0.072, 0.26, MAT.gunmetal, 0, 0.005, -0.26), ...hand,
    ...rail(0.26, MAT.gunmetal, 0, 0.045, -0.26),
    ...rail(0.18, MAT.gunmetal, 0, 0.045, 0.01),
    rod(0.016, 0.22, MAT.blued, 0, 0.012, -0.5),
    bx(0.052, 0.05, 0.08, MAT.gunmetal, 0, -0.03, -0.34, 0.5),                // angled foregrip
    ...brake(MAT.blued, 0, 0.012, -0.64, 0.026, 0.075),
    // holographic sight — wider window than the AR's dot
    (() => { const g = new THREE.Group();
      g.add(bx(0.062, 0.055, 0.1, MAT.gunmetal, 0, 0, 0));
      g.add(P(cylG(0.026, 0.026, 0.006, 4), MAT.glass, 0, 0.006, -0.038, Math.PI / 2, 0, Math.PI / 4));
      g.add(bx(0.03, 0.004, 0.004, MAT.reticle, 0, 0.006, -0.042));
      g.position.set(0, 0.104, -0.05); return g; })(),
  ];
  return { parts, fx: { bolt, mag }, arms: [[0.06, -0.15, 0.2], [0.5, -0.12, 0], [-0.075, -0.1, -0.28], [0.38, 0.35, 0.1]] };
};

// ============================ BATTLE RIFLE ============================
BUILD.battle = () => {
  const mag = magazine(0.07, 0.23, 0.11, MAT.polymer, 0, -0.17, -0.05, 0.16);
  const bolt = bx(0.032, 0.034, 0.08, MAT.steel, 0.056, 0.066, 0.07);
  const parts = [
    bx(0.082, 0.155, 0.26, MAT.polymer, 0, -0.025, 0.38),                    // side-folding stock
    bx(0.088, 0.06, 0.16, MAT.polyLite, 0, 0.055, 0.4),                      // raised comb
    bx(0.09, 0.055, 0.04, MAT.rubber, 0, -0.05, 0.52),                       // butt pad
    bx(0.03, 0.075, 0.09, MAT.gunmetal, 0.05, -0.02, 0.28, 0, 0, 0.3),       // folding hinge
    bx(0.096, 0.128, 0.46, MAT.gunmetal, 0, 0, 0.04),
    bx(0.1, 0.05, 0.24, MAT.gold, 0, 0.058, 0.04),
    ...grip(MAT.rubber, 0, -0.125, 0.17, 0.3, 0.066, 0.185, 0.095),
    ...trigger(MAT.gunmetal, 0, -0.032, 0.12),
    mag, bolt,
    bx(0.086, 0.09, 0.32, MAT.polyLite, 0, 0.005, -0.32),
    ...rail(0.34, MAT.gunmetal, 0, 0.056, -0.3),
    ...rail(0.26, MAT.gunmetal, 0, 0.056, 0.04),
    rod(0.021, 0.4, MAT.blued, 0, 0.014, -0.68),
    bx(0.05, 0.066, 0.06, MAT.gunmetal, 0, 0.036, -0.52),
    ...brake(MAT.steel, 0, 0.014, -0.9, 0.034, 0.1),
    ...ironSights(MAT.gunmetal, -0.46, 0.16, 0.056),
  ];
  return { parts, fx: { bolt, mag }, arms: [[0.062, -0.17, 0.24], [0.5, -0.12, 0], [-0.085, -0.1, -0.34], [0.34, 0.35, 0.1]] };
};

// ============================ BURST RIFLE ============================
BUILD.burst = () => {
  const mag = magazine(0.06, 0.17, 0.09, MAT.gunmetal, 0, -0.14, -0.05, 0.1);
  const bolt = bx(0.028, 0.03, 0.07, MAT.steel, 0.05, 0.07, 0.08);
  const parts = [
    bx(0.075, 0.13, 0.28, MAT.polymer, 0, -0.02, 0.34),                      // fixed A2 stock
    bx(0.082, 0.04, 0.04, MAT.rubber, 0, -0.02, 0.48),
    bx(0.086, 0.115, 0.4, MAT.gunmetal, 0, 0, 0.02),
    // carry handle — the burst rifle's signature
    bx(0.048, 0.02, 0.32, MAT.gunmetal, 0, 0.135, 0.0),                       // handle bridge
    bx(0.048, 0.075, 0.032, MAT.gunmetal, 0, 0.098, 0.15),                    // rear tower
    bx(0.048, 0.075, 0.032, MAT.gunmetal, 0, 0.098, -0.15),                   // front tower
    P(torG(0.016, 0.006, 6, 12), MAT.steel, 0, 0.135, 0.13, 0, 0, 0),         // rear aperture
    bx(0.03, 0.012, 0.28, MAT.polyLite, 0, 0.122, 0.0),                       // grip ribs
    ...grip(MAT.polymer, 0, -0.112, 0.15, 0.32),
    ...trigger(MAT.gunmetal, 0, -0.03, 0.11),
    bx(0.03, 0.022, 0.05, MAT.gold, 0.048, -0.008, 0.2),                      // burst selector
    mag, bolt,
    // triangular handguard
    bx(0.084, 0.086, 0.3, MAT.polymer, 0, 0.0, -0.32),
    bx(0.03, 0.03, 0.3, MAT.polyLite, 0, -0.05, -0.32, 0, 0, Math.PI / 4),
    rod(0.017, 0.32, MAT.blued, 0, 0.012, -0.62),
    // triangular front sight tower
    bx(0.036, 0.075, 0.05, MAT.gunmetal, 0, 0.055, -0.5),
    bx(0.01, 0.03, 0.01, MAT.steel, 0, 0.098, -0.5),
    ...brake(MAT.blued, 0, 0.012, -0.8, 0.028, 0.08),
  ];
  return { parts, fx: { bolt, mag }, arms: [[0.06, -0.16, 0.22], [0.5, -0.12, 0], [-0.08, -0.1, -0.32], [0.35, 0.35, 0.1]] };
};

// ============================ SMG ============================
BUILD.smg = () => {
  const mag = magazine(0.05, 0.2, 0.075, MAT.blued, 0, -0.15, -0.1, 0.2);
  const bolt = bx(0.026, 0.028, 0.06, MAT.steel, 0.046, 0.048, 0.04);
  const parts = [
    rod(0.03, 0.22, MAT.gunmetal, 0, 0.0, 0.26, 10),                          // retractable stock rail
    bx(0.09, 0.028, 0.03, MAT.gunmetal, 0, 0.0, 0.37),
    rod(0.05, 0.34, MAT.gunmetal, 0, 0.01, 0.0, 14),                          // tubular receiver
    bx(0.07, 0.05, 0.2, MAT.polymer, 0, -0.03, 0.02),                         // lower
    ...grip(MAT.polymer, 0, -0.115, 0.11, 0.28, 0.056, 0.16, 0.082),
    ...trigger(MAT.gunmetal, 0, -0.03, 0.07),
    mag, bolt,
    bx(0.062, 0.07, 0.2, MAT.polyLite, 0, -0.01, -0.26),                      // handguard
    ...rail(0.2, MAT.gunmetal, 0, 0.042, -0.24),
    rod(0.014, 0.16, MAT.blued, 0, 0.01, -0.44),
    rod(0.03, 0.07, MAT.gunmetal, 0, 0.01, -0.53, 10),                        // flash hider
    // drum rear sight + hooded front, MP5 style
    P(cylG(0.026, 0.026, 0.022, 10), MAT.gunmetal, 0, 0.05, 0.16, 0, 0, 0),
    P(torG(0.02, 0.006, 6, 12), MAT.gunmetal, 0, 0.05, -0.36, 0, 0, 0),
    bx(0.008, 0.026, 0.008, MAT.steel, 0, 0.048, -0.36),
    redDot(0, 0.096, -0.02, 0.9),
  ];
  return { parts, fx: { bolt, mag }, arms: [[0.055, -0.15, 0.16], [0.5, -0.12, 0], [-0.07, -0.11, -0.26], [0.4, 0.35, 0.1]] };
};

// ============================ UZI ============================
BUILD.uzi = () => {
  // the defining feature: the magazine feeds through the pistol grip
  const mag = magazine(0.05, 0.22, 0.07, MAT.blued, 0, -0.19, 0.06, 0);
  const bolt = bx(0.03, 0.026, 0.09, MAT.steel, 0, 0.052, 0.02);              // top-mounted charging bolt
  const parts = [
    bx(0.075, 0.105, 0.34, MAT.gunmetal, 0, 0.01, -0.02),                     // stamped receiver
    bx(0.079, 0.026, 0.34, MAT.polyLite, 0, 0.062, -0.02),                    // ribbed top cover
    ...(() => { const o = []; for (let i = 0; i < 5; i++) o.push(bx(0.081, 0.014, 0.016, MAT.gunmetal, 0, 0.062, -0.14 + i * 0.06)); return o; })(),
    bx(0.064, 0.165, 0.095, MAT.rubber, 0, -0.135, 0.08),                     // grip = magazine housing
    bx(0.07, 0.024, 0.1, MAT.gunmetal, 0, -0.048, 0.08),                      // mag collar
    mag, bolt,
    ...trigger(MAT.gunmetal, 0, -0.045, 0.02),
    bx(0.066, 0.055, 0.1, MAT.polymer, 0, -0.028, -0.19),                     // fore grip
    rod(0.015, 0.14, MAT.blued, 0, 0.012, -0.28),                             // short barrel
    rod(0.026, 0.045, MAT.gunmetal, 0, 0.012, -0.37, 10),                     // nut
    bx(0.034, 0.036, 0.016, MAT.gunmetal, 0, 0.062, -0.2),                    // front sight ears
    bx(0.044, 0.03, 0.016, MAT.gunmetal, 0, 0.062, 0.13),                     // rear sight
    // folding stock, stowed under the receiver
    bx(0.052, 0.016, 0.22, MAT.gunmetal, 0, -0.058, 0.2),
    bx(0.055, 0.055, 0.022, MAT.rubber, 0, -0.058, 0.32),
  ];
  return { parts, fx: { bolt, mag }, arms: [[0.05, -0.16, 0.1], [0.55, -0.12, 0], [-0.06, -0.13, -0.18], [0.5, 0.35, 0.1]] };
};

// ============================ MINIGUN ============================
BUILD.minigun = () => {
  // six barrels on a rotating cluster — the whole point of the weapon
  const cluster = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cluster.add(rod(0.019, 0.62, MAT.blued, Math.cos(a) * 0.052, Math.sin(a) * 0.052, 0, 10));
  }
  cluster.add(rod(0.03, 0.6, MAT.gunmetal, 0, 0, 0, 10));                      // spindle
  for (const zz of [-0.26, 0, 0.26]) cluster.add(P(cylG(0.076, 0.076, 0.022, 14), MAT.gunmetal, 0, 0, zz, Math.PI / 2));
  cluster.position.set(0, 0.01, -0.46);
  cluster.name = 'barrels';

  const belt = new THREE.Group();                                             // ammo belt
  for (let i = 0; i < 9; i++) {
    belt.add(bx(0.02, 0.03, 0.016, MAT.brass, 0.04 + i * 0.004, -0.13 - i * 0.018, 0.12 + i * 0.012, 0, 0, 0.2));
  }
  const parts = [
    bx(0.16, 0.17, 0.34, MAT.gunmetal, 0, 0.0, 0.06),                          // housing
    bx(0.17, 0.06, 0.2, MAT.gold, 0, 0.08, 0.06),                              // deck accent
    P(cylG(0.06, 0.06, 0.1, 12), MAT.polymer, -0.09, 0.02, 0.1, 0, 0, Math.PI / 2),  // motor
    cluster,
    P(cylG(0.09, 0.09, 0.05, 16), MAT.steel, 0, 0.01, -0.16, Math.PI / 2),     // barrel shroud front
    bx(0.14, 0.16, 0.16, MAT.polymer, 0.02, -0.16, 0.16),                      // ammo box
    belt,
    // spade grips
    bx(0.028, 0.13, 0.03, MAT.rubber, 0.09, -0.09, 0.2, 0.25),
    bx(0.028, 0.13, 0.03, MAT.rubber, -0.09, -0.09, 0.2, 0.25),
    bx(0.2, 0.026, 0.03, MAT.gunmetal, 0, -0.03, 0.22),
    ...trigger(MAT.gunmetal, 0.09, -0.06, 0.19),
  ];
  return { parts, fx: { barrels: cluster }, arms: [[0.115, -0.2, 0.2], [0.45, -0.15, 0], [-0.115, -0.2, 0.2], [0.45, 0.15, 0]] };
};

// ============================ SHOTGUN ============================
BUILD.shotgun = () => {
  // pump action — the fore-end is the moving part, driven as `slide`
  const slide = bx(0.078, 0.076, 0.22, MAT.wood, 0, -0.035, -0.3);
  const serr = bx(0.082, 0.02, 0.22, MAT.rubber, 0, -0.075, -0.3);
  const parts = [
    bx(0.08, 0.15, 0.3, MAT.wood, 0, -0.03, 0.36),                             // stock
    bx(0.086, 0.05, 0.04, MAT.rubber, 0, -0.05, 0.51),                         // recoil pad
    bx(0.09, 0.12, 0.36, MAT.gunmetal, 0, 0.0, 0.06),                          // receiver
    bx(0.094, 0.04, 0.2, MAT.gold, 0, 0.055, 0.06),
    bx(0.02, 0.05, 0.09, MAT.blued, 0.052, 0.0, 0.06),                         // ejection port
    ...grip(MAT.wood, 0, -0.1, 0.19, 0.42, 0.06, 0.13, 0.09),
    ...trigger(MAT.gunmetal, 0, -0.03, 0.13),
    rod(0.028, 0.56, MAT.blued, 0, 0.03, -0.42, 14),                           // barrel (wide bore)
    P(cylG(0.032, 0.032, 0.03, 14), MAT.steel, 0, 0.03, -0.7, Math.PI / 2),    // choke
    rod(0.022, 0.42, MAT.gunmetal, 0, -0.028, -0.36, 12),                      // tube magazine
    slide, serr,
    bx(0.014, 0.014, 0.03, MAT.gunmetal, 0, 0.062, -0.66),                     // bead post
    P(sphG(0.009, 8, 6), MAT.reticle, 0, 0.075, -0.66),                        // brass bead
    bx(0.05, 0.03, 0.02, MAT.gunmetal, 0, 0.055, 0.2),                         // rear notch
  ];
  slide.userData.z0 = slide.position.z; serr.userData.z0 = serr.position.z;
  return { parts, fx: { slide, serr }, arms: [[0.06, -0.16, 0.24], [0.5, -0.12, 0], [-0.08, -0.14, -0.3], [0.4, 0.35, 0.1]] };
};

// ============================ SHORTY (sawn-off) ============================
BUILD.shorty = () => {
  const parts = [
    bx(0.07, 0.13, 0.16, MAT.wood, 0, -0.05, 0.2),                             // cut-down grip
    bx(0.074, 0.04, 0.03, MAT.rubber, 0, -0.07, 0.29),
    bx(0.09, 0.1, 0.22, MAT.gunmetal, 0, 0.0, 0.03),                           // action body
    bx(0.094, 0.03, 0.12, MAT.gold, 0, 0.05, 0.03),
    P(cylG(0.016, 0.016, 0.05, 10), MAT.steel, 0, 0.045, 0.13, 0, 0, Math.PI / 2),  // break lever
    ...trigger(MAT.gunmetal, 0, -0.025, 0.06),
    ...trigger(MAT.gunmetal, 0, -0.025, 0.02),                                 // second trigger
    // twin side-by-side barrels
    rod(0.028, 0.34, MAT.blued, -0.03, 0.02, -0.26, 14),
    rod(0.028, 0.34, MAT.blued, 0.03, 0.02, -0.26, 14),
    P(cylG(0.031, 0.031, 0.02, 14), MAT.steel, -0.03, 0.02, -0.43, Math.PI / 2),
    P(cylG(0.031, 0.031, 0.02, 14), MAT.steel, 0.03, 0.02, -0.43, Math.PI / 2),
    bx(0.075, 0.016, 0.3, MAT.gunmetal, 0, 0.045, -0.26),                      // top rib
    bx(0.075, 0.02, 0.06, MAT.wood, 0, -0.008, -0.16),                         // fore-end
  ];
  return { parts, fx: {}, arms: [[0.05, -0.15, 0.12], [0.55, -0.12, 0], [-0.07, -0.12, -0.14], [0.5, 0.35, 0.1]] };
};

// ============================ HANDGUN ============================
BUILD.handgun = () => {
  const slide = bx(0.066, 0.075, 0.32, MAT.gunmetal, 0, 0.025, -0.03);
  const serr = bx(0.07, 0.055, 0.07, MAT.blued, 0, 0.025, 0.09);
  const parts = [
    slide, serr,
    bx(0.07, 0.05, 0.26, MAT.polymer, 0, -0.03, -0.02),                        // frame
    ...rail(0.09, MAT.polymer, 0, -0.055, -0.13, 3),                           // accessory rail
    ...grip(MAT.polymer, 0, -0.13, 0.09, 0.24, 0.062, 0.17, 0.085),
    ...trigger(MAT.polymer, 0, -0.035, 0.0),
    P(cylG(0.012, 0.012, 0.05, 8), MAT.chrome, 0, 0.005, -0.19, Math.PI / 2),  // exposed barrel
    bx(0.02, 0.024, 0.016, MAT.steel, 0, 0.066, -0.16),                        // front sight
    bx(0.05, 0.024, 0.016, MAT.steel, 0, 0.066, 0.1),                          // rear sight
    P(sphG(0.005, 6, 5), MAT.lamp, 0, 0.072, -0.163),                          // tritium dot
    bx(0.012, 0.02, 0.03, MAT.steel, 0.036, 0.0, 0.1),                         // slide stop
  ];
  slide.userData.z0 = slide.position.z; serr.userData.z0 = serr.position.z;
  return { parts, fx: { slide, serr }, arms: [[0.045, -0.17, 0.17], [0.45, 0, 0], [-0.085, -0.18, 0.13], [0.45, 0.3, 0.2]] };
};

// ============================ DEAGLE ============================
BUILD.deagle = () => {
  const slide = bx(0.078, 0.095, 0.38, MAT.gold, 0, 0.03, -0.04);
  const serr = bx(0.082, 0.07, 0.08, MAT.brass, 0, 0.03, 0.11);
  const parts = [
    slide, serr,
    bx(0.05, 0.03, 0.3, MAT.blued, 0, 0.078, -0.06),                           // ported top rib
    ...(() => { const o = []; for (let i = 0; i < 4; i++) o.push(bx(0.03, 0.012, 0.02, MAT.blued, 0, 0.09, -0.16 - i * 0.05)); return o; })(),
    bx(0.076, 0.055, 0.28, MAT.gunmetal, 0, -0.032, -0.03),                    // frame
    ...grip(MAT.rubber, 0, -0.14, 0.1, 0.22, 0.07, 0.18, 0.095),
    ...trigger(MAT.gold, 0, -0.038, 0.0),
    P(cylG(0.02, 0.02, 0.06, 10), MAT.chrome, 0, 0.006, -0.23, Math.PI / 2),   // muzzle
    bx(0.024, 0.03, 0.018, MAT.steel, 0, 0.086, -0.2),
    bx(0.05, 0.03, 0.018, MAT.steel, 0, 0.086, 0.12),
  ];
  slide.userData.z0 = slide.position.z; serr.userData.z0 = serr.position.z;
  return { parts, fx: { slide, serr }, arms: [[0.048, -0.18, 0.18], [0.45, 0, 0], [-0.088, -0.19, 0.13], [0.45, 0.3, 0.2]] };
};

// ============================ REVOLVER ============================
BUILD.revolver = () => {
  // fluted cylinder with visible chambers
  const cyl = new THREE.Group();
  cyl.add(P(cylG(0.055, 0.055, 0.12, 14), MAT.blued, 0, 0, 0, Math.PI / 2));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cyl.add(P(cylG(0.013, 0.013, 0.125, 8), MAT.gunmetal, Math.cos(a) * 0.034, Math.sin(a) * 0.034, 0, Math.PI / 2));
    cyl.add(bx(0.012, 0.012, 0.1, MAT.blued, Math.cos(a + 0.5) * 0.05, Math.sin(a + 0.5) * 0.05, 0));   // flutes
  }
  cyl.position.set(0, 0.0, 0.02);
  cyl.name = 'cylinder';
  const parts = [
    cyl,
    bx(0.056, 0.075, 0.2, MAT.gunmetal, 0, 0.012, -0.14),                      // frame / top strap
    bx(0.05, 0.02, 0.24, MAT.blued, 0, 0.052, -0.12),                          // rib
    P(cylG(0.024, 0.024, 0.3, 12), MAT.blued, 0, 0.005, -0.28, Math.PI / 2),   // barrel
    P(cylG(0.012, 0.012, 0.22, 8), MAT.steel, 0, -0.032, -0.24, Math.PI / 2),  // ejector rod
    bx(0.05, 0.09, 0.1, MAT.gunmetal, 0, -0.02, 0.14),                         // rear frame
    bx(0.03, 0.05, 0.035, MAT.steel, 0, 0.055, 0.16, -0.3),                    // exposed hammer
    P(torG(0.014, 0.006, 6, 10), MAT.steel, 0, 0.07, 0.17, 0, Math.PI / 2, 0),
    ...grip(MAT.wood, 0, -0.13, 0.16, 0.3, 0.062, 0.17, 0.1),
    ...trigger(MAT.steel, 0, -0.04, 0.07),
    bx(0.02, 0.026, 0.016, MAT.steel, 0, 0.05, -0.4),
    bx(0.045, 0.024, 0.016, MAT.steel, 0, 0.055, 0.03),
  ];
  return { parts, fx: { cylinder: cyl }, arms: [[0.05, -0.17, 0.2], [0.45, 0, 0], [-0.085, -0.18, 0.14], [0.45, 0.3, 0.2]] };
};

// ============================ SNIPER (bolt action) ============================
BUILD.sniper = () => {
  const bolt = bx(0.026, 0.026, 0.13, MAT.chrome, 0.055, 0.028, 0.12);
  bolt.add(P(sphG(0.022, 8, 6), MAT.chrome, 0.026, 0, 0.06));                  // bolt knob
  const mag = magazine(0.056, 0.13, 0.095, MAT.gunmetal, 0, -0.12, -0.16, 0);
  const parts = [
    bx(0.082, 0.15, 0.3, MAT.polymer, 0, -0.02, 0.4),                          // chassis stock
    bx(0.088, 0.06, 0.14, MAT.rubber, 0, 0.045, 0.42),                         // cheek riser
    bx(0.09, 0.05, 0.05, MAT.rubber, 0, -0.05, 0.56),                          // butt pad
    bx(0.04, 0.09, 0.1, MAT.polyLite, 0, -0.08, 0.5),                          // monopod hook
    bx(0.092, 0.125, 0.6, MAT.gunmetal, 0, 0, 0.0),                            // receiver
    bx(0.096, 0.045, 0.34, MAT.gold, 0, 0.056, 0.0),
    ...grip(MAT.rubber, 0, -0.125, 0.2, 0.26, 0.064, 0.18, 0.09),
    ...trigger(MAT.gunmetal, 0, -0.032, 0.14),
    mag, bolt,
    // fluted heavy barrel
    rod(0.024, 0.62, MAT.blued, 0, 0.014, -0.62, 14),
    ...(() => { const o = []; for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2;
      o.push(rod(0.005, 0.5, MAT.gunmetal, Math.cos(a) * 0.022, 0.014 + Math.sin(a) * 0.022, -0.6, 6)); } return o; })(),
    ...brake(MAT.steel, 0, 0.014, -0.97, 0.036, 0.11),
    bx(0.086, 0.09, 0.34, MAT.polyLite, 0, -0.02, -0.42),                      // handguard
    ...rail(0.34, MAT.gunmetal, 0, 0.03, -0.42),
    bipod(0, -0.075, -0.5),
    scope(0.36, 0, 0.132, -0.06, 0.036),
  ];
  bolt.userData.z0 = bolt.position.z; bolt.userData.y0 = bolt.position.y;
  return { parts, fx: { bolt, mag }, arms: [[0.05, -0.16, 0.26], [0.5, -0.1, 0], [-0.085, -0.13, -0.4], [0.35, 0.3, 0]] };
};

// ============================ AUTO SNIPER ============================
BUILD.autosniper = () => {
  const mag = magazine(0.062, 0.19, 0.1, MAT.gunmetal, 0, -0.15, -0.1, 0.06);
  const bolt = bx(0.03, 0.03, 0.075, MAT.steel, 0.056, 0.05, 0.1);
  const parts = [
    bx(0.084, 0.15, 0.26, MAT.polymer, 0, -0.02, 0.36),
    bx(0.09, 0.055, 0.12, MAT.rubber, 0, 0.045, 0.38),
    bx(0.09, 0.045, 0.05, MAT.rubber, 0, -0.05, 0.5),
    bx(0.094, 0.125, 0.52, MAT.gunmetal, 0, 0, 0.02),
    bx(0.098, 0.045, 0.28, MAT.gold, 0, 0.055, 0.02),
    ...grip(MAT.rubber, 0, -0.122, 0.18, 0.28, 0.064, 0.175, 0.09),
    ...trigger(MAT.gunmetal, 0, -0.032, 0.13),
    mag, bolt,
    bx(0.05, 0.06, 0.14, MAT.gunmetal, 0, 0.052, -0.3),                        // gas system
    rod(0.021, 0.48, MAT.blued, 0, 0.014, -0.6, 14),
    ...brake(MAT.steel, 0, 0.014, -0.88, 0.032, 0.1),
    bx(0.08, 0.085, 0.3, MAT.polyLite, 0, -0.01, -0.36),
    ...rail(0.3, MAT.gunmetal, 0, 0.032, -0.36),
    scope(0.3, 0, 0.126, -0.04, 0.032),
  ];
  bolt.userData.z0 = bolt.position.z; bolt.userData.y0 = bolt.position.y;
  return { parts, fx: { bolt, mag }, arms: [[0.055, -0.16, 0.24], [0.5, -0.1, 0], [-0.085, -0.12, -0.36], [0.35, 0.3, 0]] };
};

// ============================ DMR ============================
BUILD.dmr = () => {
  const mag = magazine(0.058, 0.17, 0.095, MAT.polymer, 0, -0.14, -0.08, 0.08);
  const bolt = bx(0.028, 0.03, 0.07, MAT.steel, 0.052, 0.052, 0.08);
  const parts = [
    bx(0.08, 0.14, 0.24, MAT.wood, 0, -0.02, 0.34),                            // wood thumbhole stock
    bx(0.086, 0.05, 0.1, MAT.wood, 0, 0.04, 0.36),
    bx(0.088, 0.048, 0.05, MAT.rubber, 0, -0.05, 0.47),
    bx(0.088, 0.118, 0.46, MAT.gunmetal, 0, 0, 0.02),
    bx(0.092, 0.042, 0.24, MAT.gold, 0, 0.052, 0.02),
    ...grip(MAT.wood, 0, -0.118, 0.16, 0.3, 0.062, 0.17, 0.088),
    ...trigger(MAT.gunmetal, 0, -0.03, 0.11),
    mag, bolt,
    bx(0.078, 0.082, 0.28, MAT.wood, 0, -0.005, -0.32),                        // wood handguard
    ...rail(0.24, MAT.gunmetal, 0, 0.03, -0.3),
    rod(0.019, 0.44, MAT.blued, 0, 0.014, -0.6),
    bx(0.046, 0.055, 0.06, MAT.gunmetal, 0, 0.038, -0.44),
    ...brake(MAT.blued, 0, 0.014, -0.84, 0.028, 0.09),
    bipod(0, -0.07, -0.44),
    scope(0.26, 0, 0.118, -0.04, 0.03),
  ];
  bolt.userData.z0 = bolt.position.z; bolt.userData.y0 = bolt.position.y;
  return { parts, fx: { bolt, mag }, arms: [[0.055, -0.16, 0.24], [0.5, -0.1, 0], [-0.08, -0.11, -0.34], [0.35, 0.3, 0]] };
};

// ---------------------------------------------------------------- api
export const GUN_IDS = Object.keys(BUILD);
export const hasGun = (id) => !!BUILD[id];

// Build one weapon. Records the rest positions the animation code reads.
export function buildGun(id) {
  const b = BUILD[id];
  if (!b) return null;
  const out = b();
  if (out.fx?.bolt && out.fx.bolt.userData.z0 === undefined) {
    out.fx.bolt.userData.z0 = out.fx.bolt.position.z;
    out.fx.bolt.userData.y0 = out.fx.bolt.position.y;
  }
  if (out.fx?.mag) out.fx.mag.userData.y0 = out.fx.mag.position.y;
  return out;
}
