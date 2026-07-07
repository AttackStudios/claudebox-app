// RS2 — painted tiling textures: floors, walls, roads, fabrics. All drawn
// procedurally so every restaurant style stays crisp and original.

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

export function woodFloor() {
  return tile('woodFloor', 256, (ctx, s) => {
    const r = rng(5);
    const rows = 8;
    for (let row = 0; row < rows; row++) {
      const y = row * (s / rows);
      let x = -(r() * 60);
      while (x < s) {
        const w = 60 + r() * 70;
        const base = 165 + Math.floor(r() * 35);
        ctx.fillStyle = `rgb(${base},${Math.floor(base * 0.68)},${Math.floor(base * 0.42)})`;
        ctx.fillRect(x, y, w - 2, s / rows - 2);
        for (let i = 0; i < 8; i++) {
          ctx.strokeStyle = `rgba(90,55,30,${0.08 + r() * 0.12})`;
          ctx.beginPath();
          ctx.moveTo(x + r() * w, y);
          ctx.lineTo(x + r() * w, y + s / rows);
          ctx.stroke();
        }
        x += w;
      }
    }
  });
}

export function tileFloor() {
  return tile('tileFloor', 256, (ctx, s) => {
    const r = rng(9);
    const n = 4;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const g = 215 + Math.floor(r() * 22);
        ctx.fillStyle = `rgb(${g},${g - 4},${g - 10})`;
        ctx.fillRect(i * s / n + 2, j * s / n + 2, s / n - 4, s / n - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(i * s / n + 4, j * s / n + 4, s / n - 8, 4);
      }
    }
  });
}

export function checkerFloor() {
  return tile('checkerFloor', 256, (ctx, s) => {
    const n = 4;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#2b2b30' : '#e8e8e2';
        ctx.fillRect(i * s / n, j * s / n, s / n, s / n);
      }
    }
  });
}

export function marbleFloor() {
  return tile('marbleFloor', 256, (ctx, s) => {
    const r = rng(13);
    ctx.fillStyle = '#e9e7e2';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(140,140,150,${0.12 + r() * 0.2})`;
      ctx.lineWidth = 0.8 + r() * 1.6;
      let x = r() * s, y = r() * s;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 90; y += (r() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
}

export function carpetFloor() {
  return tile('carpetFloor', 128, (ctx, s) => {
    const r = rng(17);
    ctx.fillStyle = '#7a3c40';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const g = r();
      ctx.fillStyle = `rgba(${120 + g * 60},${50 + g * 25},${55 + g * 28},0.5)`;
      ctx.fillRect(r() * s, r() * s, 1.5, 1.5);
    }
  });
}

export const FLOOR_TEX = { wood: woodFloor, tile: tileFloor, checker: checkerFloor, marble: marbleFloor, carpet: carpetFloor };

export function wallPlaster() {
  return tile('wallPlaster', 128, (ctx, s) => {
    const r = rng(21);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) {
      const g = 225 + Math.floor(r() * 30);
      ctx.fillStyle = `rgba(${g},${g},${g},0.4)`;
      ctx.fillRect(r() * s, r() * s, 2 + r() * 3, 2 + r() * 3);
    }
    // wainscot line
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, s * 0.72, s, 3);
  });
}

export function brick() {
  return tile('brick', 128, (ctx, s) => {
    const r = rng(25);
    ctx.fillStyle = '#9a5240';
    ctx.fillRect(0, 0, s, s);
    const bh = s / 6;
    for (let row = 0; row < 6; row++) {
      const off = row % 2 ? s / 6 : 0;
      for (let i = -1; i < 4; i++) {
        const g = r();
        ctx.fillStyle = `rgb(${145 + g * 35},${72 + g * 18},${56 + g * 14})`;
        ctx.fillRect(i * s / 3 + off + 2, row * bh + 2, s / 3 - 4, bh - 4);
      }
    }
  });
}

export function asphalt() {
  return tile('asphalt', 256, (ctx, s) => {
    const r = rng(31);
    ctx.fillStyle = '#46464c';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2200; i++) {
      const g = 50 + Math.floor(r() * 45);
      ctx.fillStyle = `rgba(${g},${g},${g + 4},0.6)`;
      ctx.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
    }
    ctx.fillStyle = 'rgba(230,220,190,0.8)';
    ctx.fillRect(0, s / 2 - 3, s * 0.5, 6);
  });
}

export function sidewalk() {
  return tile('sidewalk', 128, (ctx, s) => {
    const r = rng(37);
    ctx.fillStyle = '#b8b4ac';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 300; i++) {
      const g = 165 + Math.floor(r() * 30);
      ctx.fillStyle = `rgba(${g},${g - 3},${g - 8},0.5)`;
      ctx.fillRect(r() * s, r() * s, 2, 2);
    }
    ctx.strokeStyle = 'rgba(80,78,72,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s, s);
  });
}

export function grassLawn() {
  return tile('grassLawn', 256, (ctx, s) => {
    const r = rng(41);
    ctx.fillStyle = '#69a84f';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1600; i++) {
      const g = r();
      ctx.strokeStyle = `rgba(${60 + g * 60},${130 + g * 60},${50 + g * 40},0.5)`;
      const x = r() * s, y = r() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
      ctx.stroke();
    }
  });
}

export function awningStripes(color) {
  return tile('awning:' + color, 128, (ctx, s) => {
    ctx.fillStyle = '#f4f0e8';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = color;
    for (let x = 0; x < s; x += s / 4) ctx.fillRect(x, 0, s / 8, s);
  });
}

export function tablecloth() {
  return tile('tablecloth', 64, (ctx, s) => {
    ctx.fillStyle = '#f6f3ec';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(180,60,60,0.45)';
    ctx.lineWidth = 3;
    for (let k = 0; k <= s; k += s / 4) {
      ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(s, k); ctx.stroke();
    }
  });
}

export function steel() {
  return tile('steel', 64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#d4d8dc');
    g.addColorStop(0.5, '#aeb4ba');
    g.addColorStop(1, '#c8cdd2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, s * 0.18, s, 3);
  });
}

export function roofShingles() {
  return tile('roof', 128, (ctx, s) => {
    const r = rng(47);
    ctx.fillStyle = '#6e4438';
    ctx.fillRect(0, 0, s, s);
    const rh = s / 5;
    for (let row = 0; row < 5; row++) {
      const off = row % 2 ? s / 8 : 0;
      for (let i = -1; i < 5; i++) {
        const g = r();
        ctx.fillStyle = `rgb(${100 + g * 30},${60 + g * 18},${48 + g * 14})`;
        ctx.beginPath();
        ctx.roundRect(i * s / 4 + off + 1, row * rh + 1, s / 4 - 2, rh - 2, 4);
        ctx.fill();
      }
    }
  });
}
