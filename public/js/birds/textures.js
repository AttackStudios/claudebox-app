// Procedurally painted bird textures. Everything is drawn in white/gray so
// the material's color tints it — that keeps every color slot customizable
// while still looking like real plumage.
// (Returns null in non-DOM environments so headless tests still run.)

import * as THREE from 'three';

const hasDOM = typeof document !== 'undefined';
const cache = new Map();

function canvasTexture(key, w, h, draw) {
  if (!hasDOM) return null;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

// deterministic pseudo-random so textures are identical every load
function rng(seed) {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

// Body plumage: soft shading + rows of overlapping feather scallops.
// variants: plain | speckled (streaked breast) | fluff (downy belly) | scales
export function bodyTexture(variant = 'plain') {
  return canvasTexture('body:' + variant, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // top-to-bottom shading: back slightly darker, underside brighter
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0.13)');
    g.addColorStop(0.45, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(255,255,255,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (variant === 'fluff') {
      // downy blotches instead of scallops
      const r = rng(7);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 140; i++) {
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 4 + r() * 9, 3 + r() * 6, r() * 3, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      for (let i = 0; i < 60; i++) {
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 3 + r() * 6, 2 + r() * 4, r() * 3, 0, 7);
        ctx.fill();
      }
      return;
    }

    // overlapping feather scallop rows
    const rows = 13, cols = 9;
    for (let row = 0; row < rows; row++) {
      const y = ((row + 1) / rows) * h;
      const fade = 0.05 + 0.07 * (1 - row / rows); // crisper on the back
      ctx.strokeStyle = `rgba(0,0,0,${fade.toFixed(3)})`;
      ctx.lineWidth = 2.4;
      for (let col = 0; col <= cols; col++) {
        const x = (col + (row % 2 ? 0.5 : 0)) * (w / cols);
        ctx.beginPath();
        ctx.arc(x, y - 7, (w / cols) * 0.58, Math.PI * 0.12, Math.PI * 0.88);
        ctx.stroke();
      }
      // subtle highlight under each scallop row
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1.6;
      for (let col = 0; col <= cols; col++) {
        const x = (col + (row % 2 ? 0.5 : 0)) * (w / cols);
        ctx.beginPath();
        ctx.arc(x, y - 4, (w / cols) * 0.58, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
      }
    }

    if (variant === 'speckled') {
      const r = rng(31);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      for (let i = 0; i < 110; i++) {
        const x = r() * w, y = h * 0.3 + r() * h * 0.65;
        ctx.beginPath();
        ctx.ellipse(x, y, 1.6 + r() * 2.6, 4 + r() * 7, (r() - 0.5) * 0.5, 0, 7);
        ctx.fill();
      }
    }
    if (variant === 'scales') {
      const r = rng(13);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 2;
      for (let row = 0; row < 16; row++) {
        for (let col = 0; col <= 12; col++) {
          const x = (col + (row % 2 ? 0.5 : 0)) * (w / 12);
          const y = (row / 16) * h + 8;
          ctx.beginPath();
          ctx.arc(x, y, 9 + r() * 2, Math.PI * 0.1, Math.PI * 0.9);
          ctx.stroke();
        }
      }
    }
  });
}

// One flight feather: rounded vane, central shaft, fine barb striations,
// transparent outside the vane (used with alphaTest).
export function featherTexture() {
  return canvasTexture('feather', 128, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;

    // vane silhouette: narrow quill at bottom, rounded tip at top
    ctx.beginPath();
    ctx.moveTo(cx, h - 4);
    ctx.bezierCurveTo(cx - w * 0.46, h * 0.78, cx - w * 0.46, h * 0.16, cx, 6);
    ctx.bezierCurveTo(cx + w * 0.46, h * 0.16, cx + w * 0.46, h * 0.78, cx, h - 4);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // shade the vane: slightly darker toward the quill + trailing edge
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.save();
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // barbs: fine diagonal strokes from the shaft outward
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1.2;
    for (let y = 10; y < h - 6; y += 5) {
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx - w * 0.44, y + 16);
      ctx.moveTo(cx, y);
      ctx.lineTo(cx + w * 0.44, y + 16);
      ctx.stroke();
    }
    // central shaft
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(cx, 8);
    ctx.lineTo(cx, h - 4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 1.6, 10);
    ctx.lineTo(cx - 1.6, h - 6);
    ctx.stroke();
    ctx.restore();
  });
}

// Egg shell: soft mottling + speckle spots.
export function eggTexture() {
  return canvasTexture('egg', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const r = rng(99);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let i = 0; i < 70; i++) {
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 6 + r() * 14, 4 + r() * 9, r() * 3, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 56; i++) {
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 1.5 + r() * 3.5, 1.2 + r() * 2.6, r() * 3, 0, 7);
      ctx.fill();
    }
  });
}

// Bare-skin / beak sheen: very subtle vertical gradient, no markings.
export function smoothTexture() {
  return canvasTexture('smooth', 64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
