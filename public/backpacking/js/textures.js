// Backpacking — procedurally painted tiling textures. Deterministic, cached,
// and painted in near-real colors (terrain multiplies them with vertex tints).

import * as THREE from 'three';

const cache = new Map();

function rng(seed) {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

function tile(key, size, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

// neutral gray detail used as a multiply layer over vertex-colored terrain:
// grass blades, soil grain, tiny stones — reads as texture in any biome tint
export function groundDetail() {
  return tile('groundDetail', 256, (ctx, s) => {
    const r = rng(11);
    ctx.fillStyle = '#9b9b9b';
    ctx.fillRect(0, 0, s, s);
    // soil mottling
    for (let i = 0; i < 240; i++) {
      const g = 120 + Math.floor(r() * 80);
      ctx.fillStyle = `rgba(${g},${g},${g},0.25)`;
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 2 + r() * 9, 2 + r() * 6, r() * 3, 0, 7);
      ctx.fill();
    }
    // grass blades
    for (let i = 0; i < 900; i++) {
      const x = r() * s, y = r() * s;
      const g = 110 + Math.floor(r() * 110);
      ctx.strokeStyle = `rgba(${g},${g},${g},0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
      ctx.stroke();
    }
    // pebbles
    for (let i = 0; i < 70; i++) {
      const g = 100 + Math.floor(r() * 70);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.beginPath();
      ctx.arc(r() * s, r() * s, 0.8 + r() * 1.6, 0, 7);
      ctx.fill();
    }
  });
}

// asphalt with aggregate, worn dashed center line, faded edge lines.
// UVs: u runs ALONG the road (tile repeats), v across (0..1 edge to edge).
export function asphalt() {
  return tile('asphalt', 256, (ctx, s) => {
    const r = rng(23);
    ctx.fillStyle = '#3a3a3e';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const g = 40 + Math.floor(r() * 50);
      ctx.fillStyle = `rgba(${g},${g},${g + 4},0.6)`;
      ctx.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
    }
    // cracks
    ctx.strokeStyle = 'rgba(20,20,22,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      let x = r() * s, y = r() * s;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 26; y += r() * 18; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // center dashed yellow line (v = 0.5 → y = s/2), worn
    ctx.fillStyle = 'rgba(214,180,60,0.85)';
    ctx.fillRect(0, s / 2 - 3, s * 0.55, 6);
    ctx.fillStyle = 'rgba(214,180,60,0.25)';
    ctx.fillRect(s * 0.55, s / 2 - 3, s * 0.08, 6);
    // edge lines
    ctx.fillStyle = 'rgba(220,220,220,0.45)';
    ctx.fillRect(0, 6, s, 3);
    ctx.fillRect(0, s - 9, s, 3);
  });
}

export function rockStrata() {
  return tile('rockStrata', 256, (ctx, s) => {
    const r = rng(37);
    const bands = ['#b97a4e', '#a4623b', '#c98a58', '#8f5532', '#bd8050'];
    let y = 0;
    let bi = 0;
    while (y < s) {
      const h = 14 + r() * 26;
      ctx.fillStyle = bands[bi % bands.length];
      ctx.fillRect(0, y, s, h);
      // band noise
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(60,30,15,${0.05 + r() * 0.12})`;
        ctx.fillRect(r() * s, y + r() * h, 2 + r() * 10, 1 + r() * 2.5);
      }
      y += h; bi++;
    }
    ctx.strokeStyle = 'rgba(50,25,12,0.35)';
    for (let i = 0; i < 5; i++) {
      let x = r() * s;
      ctx.beginPath(); ctx.moveTo(x, 0);
      for (let yy = 0; yy < s; yy += 16) { x += (r() - 0.5) * 10; ctx.lineTo(x, yy); }
      ctx.stroke();
    }
  });
}

export function planks() {
  return tile('planks', 256, (ctx, s) => {
    const r = rng(53);
    const w = s / 4;
    for (let p = 0; p < 4; p++) {
      const base = 118 + Math.floor(r() * 26);
      ctx.fillStyle = `rgb(${base},${Math.floor(base * 0.72)},${Math.floor(base * 0.46)})`;
      ctx.fillRect(p * w, 0, w, s);
      // wood grain
      for (let i = 0; i < 26; i++) {
        ctx.strokeStyle = `rgba(70,45,25,${0.12 + r() * 0.2})`;
        ctx.lineWidth = 0.8 + r();
        ctx.beginPath();
        let x = p * w + r() * w;
        ctx.moveTo(x, 0);
        for (let y = 0; y < s; y += 14) { x += (r() - 0.5) * 4; ctx.lineTo(Math.max(p * w + 1, Math.min((p + 1) * w - 1, x)), y); }
        ctx.stroke();
      }
      // knot
      if (r() > 0.5) {
        ctx.fillStyle = 'rgba(70,45,25,0.6)';
        ctx.beginPath();
        ctx.ellipse(p * w + w / 2, r() * s, 4, 6, 0, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(40,25,12,0.7)';
      ctx.fillRect(p * w, 0, 2, s);
    }
  });
}

export function bark() {
  return tile('bark', 128, (ctx, s) => {
    const r = rng(61);
    ctx.fillStyle = '#5d4632';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(30,20,12,${0.25 + r() * 0.3})`;
      ctx.lineWidth = 1.5 + r() * 2.5;
      let x = r() * s;
      ctx.beginPath(); ctx.moveTo(x, -4);
      for (let y = 0; y < s + 8; y += 12) { x += (r() - 0.5) * 7; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(120,95,65,${0.1 + r() * 0.2})`;
      ctx.fillRect(r() * s, r() * s, 2 + r() * 4, 6 + r() * 10);
    }
  });
}

export function tentFabric() {
  return tile('tentFabric', 128, (ctx, s) => {
    const r = rng(71);
    ctx.fillStyle = '#e9e9e9';
    ctx.fillRect(0, 0, s, s);
    // weave
    for (let y = 0; y < s; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${y % 6 ? 0.05 : 0.09})`;
      ctx.fillRect(0, y, s, 1);
    }
    for (let x = 0; x < s; x += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(x, 0, 1, s);
    }
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.06 + r() * 0.1})`;
      ctx.fillRect(r() * s, r() * s, 4 + r() * 14, 2 + r() * 5);
    }
  });
}

export function plaid() {
  return tile('plaid', 128, (ctx, s) => {
    ctx.fillStyle = '#f3f3f0';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(196,60,56,0.85)';
    for (const p of [0, 0.5]) {
      ctx.fillRect(p * s, 0, s * 0.22, s);
      ctx.fillRect(0, p * s, s, s * 0.22);
    }
    ctx.fillStyle = 'rgba(40,60,120,0.5)';
    for (const p of [0.32, 0.82]) {
      ctx.fillRect(p * s, 0, s * 0.06, s);
      ctx.fillRect(0, p * s, s, s * 0.06);
    }
  });
}

export function snowSparkle() {
  return tile('snow', 128, (ctx, s) => {
    const r = rng(83);
    ctx.fillStyle = '#eef2f7';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
      ctx.fillRect(r() * s, r() * s, 1, 1);
    }
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = 'rgba(190,205,225,0.25)';
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 3 + r() * 8, 2 + r() * 4, r() * 3, 0, 7);
      ctx.fill();
    }
  });
}

export function metalVan() {
  return tile('metalVan', 64, (ctx, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0.25)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function lavaGlow() {
  return tile('lava', 128, (ctx, s) => {
    const r = rng(97);
    ctx.fillStyle = '#cf4a12';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(255,${150 + Math.floor(r() * 80)},40,0.8)`;
      ctx.lineWidth = 2 + r() * 3;
      let x = r() * s, y = r() * s;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(40,12,6,0.55)';
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 4 + r() * 12, 3 + r() * 8, r() * 3, 0, 7);
      ctx.fill();
    }
  });
}
