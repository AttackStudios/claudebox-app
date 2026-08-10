// Build A Boat For Treasure — procedural art.
// Everything here is generated at runtime: canvas textures for the block
// materials, multi-part meshes for the ability blocks and hazards, and a small
// particle pool for splashes and debris. No image files ship with the game.

import * as THREE from 'three';
import { BLOCK_BY_ID, HAZARDS, RIVER } from '/shared/bab/config.js';

// ---------------------------------------------------------------- textures
// One 64px canvas per material. Cheap to make, and it means every block keeps
// the same single BoxGeometry while still reading as wood / brick / metal.
const texCache = new Map();
function tex(key, draw, size = 64) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

const shade = (g, s, base) => { g.fillStyle = base; g.fillRect(0, 0, s, s); };
const rnd = (seed) => { let x = seed; return () => (x = (x * 9301 + 49297) % 233280) / 233280; };

const TEX_DRAW = {
  wood: (g, s) => {
    shade(g, s, '#b3803f');
    const r = rnd(7);
    for (let i = 0; i < 26; i++) {           // grain
      g.strokeStyle = `rgba(90,58,24,${0.10 + r() * 0.22})`;
      g.lineWidth = 1 + r() * 1.6;
      g.beginPath();
      const y = r() * s;
      g.moveTo(0, y);
      g.bezierCurveTo(s * 0.3, y + (r() - 0.5) * 6, s * 0.7, y + (r() - 0.5) * 6, s, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(60,38,14,.55)'; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);   // plank edge
  },
  plastic: (g, s) => {
    shade(g, s, '#e8eef5');
    g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(0, 0, s, s * 0.32);
    g.strokeStyle = 'rgba(150,168,190,.7)'; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);
  },
  brick: (g, s) => {
    shade(g, s, '#8f4436');
    g.fillStyle = '#a8503c';
    const h = s / 4;
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? -s / 4 : 0;
      for (let col = -1; col < 3; col++) {
        g.fillRect(col * (s / 2) + off + 2, row * h + 2, s / 2 - 4, h - 4);
      }
    }
  },
  ice: (g, s) => {
    shade(g, s, '#9fd8ff');
    const r = rnd(21);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
    for (let i = 0; i < 9; i++) {            // crystal fractures
      g.beginPath();
      const x = r() * s, y = r() * s;
      g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 34, y + (r() - 0.5) * 34);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 0, s, s * 0.22);
  },
  metal: (g, s) => {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, '#b6c2d0'); grd.addColorStop(0.5, '#8e9aa8'); grd.addColorStop(1, '#788492');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(50,60,72,.55)';      // rivets
    for (const [x, y] of [[8, 8], [s - 8, 8], [8, s - 8], [s - 8, s - 8]]) {
      g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(40,50,60,.5)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, s - 3);
  },
  gold: (g, s) => {
    const grd = g.createLinearGradient(0, 0, s, s);
    grd.addColorStop(0, '#ffe89a'); grd.addColorStop(0.45, '#ffc93c');
    grd.addColorStop(0.6, '#ffefb0'); grd.addColorStop(1, '#d99a12');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(150,100,10,.55)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, s - 3);
  },
  seat: (g, s) => {
    shade(g, s, '#5c72ff');
    g.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < 4; i++) g.fillRect(6, 8 + i * 13, s - 12, 5);
  },
};

export function blockTexture(id) {
  const drawer = TEX_DRAW[id];
  if (!drawer) return null;
  return tex('blk-' + id, drawer);
}

// ---------------------------------------------------------------- materials
const matCache = new Map();
export function blockMaterial(id) {
  if (matCache.has(id)) return matCache.get(id);
  const def = BLOCK_BY_ID[id] || {};
  const t = blockTexture(id);
  const m = new THREE.MeshLambertMaterial({
    color: t ? '#ffffff' : (def.color || '#b3803f'),
    map: t || null,
    transparent: id === 'ice',
    opacity: id === 'ice' ? 0.82 : 1,
  });
  matCache.set(id, m);
  return m;
}

// ---------------------------------------------------------------- blocks
// Solid blocks stay a single textured cube (fast, and the grid reads clearly).
// The ability blocks become small assemblies so a boat looks built, not stacked.
const BOX = new THREE.BoxGeometry(1, 1, 1);

export function makeBlockMesh(id) {
  const def = BLOCK_BY_ID[id];
  if (!def) return new THREE.Mesh(BOX, blockMaterial('wood'));

  if (def.kind === 'balloon') {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: def.color });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 12), skin);
    ball.scale.set(1, 1.18, 1); ball.position.y = 0.16;
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 8), skin);
    knot.position.y = -0.36; knot.rotation.x = Math.PI;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5),
      new THREE.MeshLambertMaterial({ color: '#e8e8e8' }));
    string.position.y = -0.56;
    g.add(ball, knot, string);
    return g;
  }

  if (def.kind === 'thruster') {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.8, 12),
      new THREE.MeshLambertMaterial({ color: '#8a919c' }));
    body.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.07, 8, 16),
      new THREE.MeshLambertMaterial({ color: def.color }));
    ring.position.z = -0.34;
    // the flame is scaled by thrust each frame while sailing
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 10),
      new THREE.MeshBasicMaterial({ color: '#ffb03a', transparent: true, opacity: 0.9 }));
    flame.rotation.x = -Math.PI / 2; flame.position.z = -0.85;
    flame.name = 'flame'; flame.visible = false;
    g.add(body, ring, flame);
    return g;
  }

  if (def.kind === 'sail') {
    const g = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 1.9, 8),
      new THREE.MeshLambertMaterial({ color: '#6d4c24' }));
    mast.position.y = 0.45;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.35),
      new THREE.MeshLambertMaterial({ color: def.color, side: THREE.DoubleSide }));
    cloth.position.set(0, 0.6, 0.02); cloth.rotation.y = Math.PI / 2;
    cloth.name = 'cloth';
    g.add(mast, cloth);
    return g;
  }

  if (def.kind === 'seat') {
    const g = new THREE.Group();
    const m = blockMaterial('seat');
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.9), m);
    base.position.y = -0.22;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.2), m);
    back.position.set(0, 0.2, -0.35);
    g.add(base, back);
    return g;
  }

  return new THREE.Mesh(BOX, blockMaterial(id));
}

// tint a block (mesh or group) as it takes damage
export function tintDamaged(obj, frac) {
  obj.traverse?.((o) => {
    if (!o.isMesh) return;
    if (!o.userData._mat) { o.userData._mat = o.material; o.material = o.material.clone(); }
    o.material.color.lerp(new THREE.Color('#3a2018'), Math.min(0.55, (1 - frac) * 0.5));
  });
  if (obj.isMesh && !obj.userData._mat) {
    obj.userData._mat = obj.material; obj.material = obj.material.clone();
    obj.material.color.lerp(new THREE.Color('#3a2018'), Math.min(0.55, (1 - frac) * 0.5));
  }
}

// ---------------------------------------------------------------- hazards
export function makeHazardMesh(kind) {
  const def = HAZARDS[kind];
  const col = def.color;
  const g = new THREE.Group();

  if (kind === 'rock') {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(def.r * 0.85, 0),
      new THREE.MeshLambertMaterial({ color: col, flatShading: true }));
    m.rotation.set(0.6, 1.1, 0.3);
    m.scale.set(1, 0.78, 1.1);
    g.add(m);
  } else if (kind === 'barrel') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(def.r * 0.7, def.r * 0.7, def.r * 1.8, 12),
      new THREE.MeshLambertMaterial({ color: col }));
    const bandMat = new THREE.MeshLambertMaterial({ color: '#3a2a18' });
    for (const y of [-0.5, 0.5]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(def.r * 0.72, 0.08, 6, 14), bandMat);
      band.rotation.x = Math.PI / 2; band.position.y = y * def.r;
      g.add(band);
    }
    body.rotation.z = Math.PI / 2;
    g.add(body);
  } else if (kind === 'hammer') {
    const head = new THREE.Mesh(new THREE.BoxGeometry(def.r * 1.5, def.r * 1.2, def.r * 1.2),
      new THREE.MeshLambertMaterial({ color: col }));
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.3, def.r * 1.3, def.r * 1.3),
      new THREE.MeshLambertMaterial({ color: '#6a2a20' }));
    face.position.x = def.r * 0.8;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 7, 8),
      new THREE.MeshLambertMaterial({ color: '#6d4c24' }));
    handle.position.y = 3.5;
    g.add(head, face, handle);
  } else if (kind === 'cannon') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(def.r, 12, 10),
      new THREE.MeshLambertMaterial({ color: col }));
    const sheen = new THREE.Mesh(new THREE.SphereGeometry(def.r * 1.04, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#5a5a66', transparent: true, opacity: 0.25 }));
    g.add(ball, sheen);
  } else if (kind === 'spike') {
    const ice = new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.9, flatShading: true });
    const main = new THREE.Mesh(new THREE.ConeGeometry(def.r * 0.8, def.r * 2.6, 7), ice);
    main.position.y = def.r * 0.9;
    const side = new THREE.Mesh(new THREE.ConeGeometry(def.r * 0.45, def.r * 1.5, 6), ice);
    side.position.set(def.r * 0.7, def.r * 0.2, def.r * 0.3); side.rotation.z = -0.4;
    g.add(main, side);
  } else if (kind === 'saw') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(def.r, def.r, 0.28, 20),
      new THREE.MeshLambertMaterial({ color: col }));
    disc.rotation.z = Math.PI / 2;
    g.add(disc);
    const toothMat = new THREE.MeshLambertMaterial({ color: '#f2f4f8' });
    for (let i = 0; i < 12; i++) {          // teeth around the rim
      const a = (i / 12) * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 4), toothMat);
      t.position.set(0, Math.cos(a) * def.r, Math.sin(a) * def.r);
      t.rotation.x = -a;
      g.add(t);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(def.r * 0.25, def.r * 0.25, 0.34, 10),
      new THREE.MeshLambertMaterial({ color: '#8a8a94' }));
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
  } else if (kind === 'fireball') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(def.r * 0.8, 12, 10),
      new THREE.MeshBasicMaterial({ color: '#ffd28a' }));
    const shell = new THREE.Mesh(new THREE.SphereGeometry(def.r * 1.15, 12, 10),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
    shell.name = 'shell';
    g.add(core, shell);
    const light = new THREE.PointLight('#ff7a2a', 1.4, 22);
    g.add(light);
  } else if (kind === 'whirl') {
    const ringMat = new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const r = def.r * (1 - i * 0.26);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.3, 6, 22), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -i * 0.5;
      g.add(ring);
    }
    const funnel = new THREE.Mesh(new THREE.ConeGeometry(def.r * 0.8, 2.6, 16, 1, true),
      new THREE.MeshLambertMaterial({ color: '#1e4a70', transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    funnel.position.y = -1.3; funnel.rotation.x = Math.PI;
    g.add(funnel);
  } else if (kind === 'laser') {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, RIVER.width, 8),
      new THREE.MeshBasicMaterial({ color: col }));
    beam.rotation.x = Math.PI / 2;
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, RIVER.width, 8),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28 }));
    glow.rotation.x = Math.PI / 2; glow.name = 'glow';
    g.add(beam, glow);
    const light = new THREE.PointLight(col, 1.1, 26);
    g.add(light);
  }
  return g;
}

// ---------------------------------------------------------------- particles
// One pooled set of small boxes reused for splashes, debris and sparks, so a
// long run never allocates mid-frame.
export class Particles {
  constructor(scene, count = 160) {
    this.pool = [];
    this.live = [];
    const geo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true }));
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }
  burst(pos, color, n = 10, opts = {}) {
    const spread = opts.spread ?? 5, up = opts.up ?? 5, life = opts.life ?? 0.85, size = opts.size ?? 1;
    for (let i = 0; i < n; i++) {
      const m = this.pool.pop();
      if (!m) return;
      m.visible = true;
      m.position.copy(pos);
      m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      m.material.color.set(color);
      m.material.opacity = 1;
      this.live.push({
        m,
        vx: (Math.random() - 0.5) * spread,
        vy: Math.random() * up + 1.5,
        vz: (Math.random() - 0.5) * spread,
        t: 0, life: life * (0.7 + Math.random() * 0.6),
      });
    }
  }
  step(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.t += dt;
      p.vy -= 17 * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.m.rotation.x += dt * 6; p.m.rotation.z += dt * 4;
      p.m.material.opacity = Math.max(0, 1 - p.t / p.life);
      if (p.t >= p.life) {
        p.m.visible = false;
        this.pool.push(p.m);
        this.live.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------- water
// A scrolling caustic-ish texture sells motion far more cheaply than animating
// plane vertices every frame.
export function waterTexture() {
  return tex('water', (g, s) => {
    shade(g, s, '#2f9fd0');
    const r = rnd(99);
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const y = r() * s;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(s * 0.25, y - 4, s * 0.6, y + 4, s, y);
      g.stroke();
    }
  }, 128);
}
