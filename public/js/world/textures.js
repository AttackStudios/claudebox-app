// High-res procedural tiling textures. The terrain look is vertex colors ×
// one rich grayscale detail map (so biome hues blend smoothly while the
// close-up ground stays crisp). Structures get their own small tile set.
// Everything is generated — no image assets.

import * as THREE from 'three';

function makeTex(size, draw, { srgb = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// deterministic rng so every client draws identical pixels
function texRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- terrain detail: layered speckle + blotch + fine strokes, mid-gray ----
export function terrainDetail() {
  return makeTex(1024, (ctx, S) => {
    const rng = texRng(7771);
    // stays near-white so multiplying barely darkens the vertex colors
    ctx.fillStyle = '#dedede';
    ctx.fillRect(0, 0, S, S);
    // soft large blotches
    for (let i = 0; i < 260; i++) {
      const v = 195 + Math.floor(rng() * 50);
      ctx.fillStyle = `rgba(${v},${v},${v},0.12)`;
      const r = 18 + rng() * 70;
      ctx.beginPath();
      ctx.arc(rng() * S, rng() * S, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // medium speckle
    for (let i = 0; i < 9000; i++) {
      const v = 175 + Math.floor(rng() * 80);
      ctx.fillStyle = `rgba(${v},${v},${v},0.4)`;
      const r = 1 + rng() * 3.2;
      ctx.fillRect(rng() * S, rng() * S, r, r);
    }
    // fine grass-blade strokes
    ctx.lineWidth = 1;
    for (let i = 0; i < 5200; i++) {
      const v = 168 + Math.floor(rng() * 87);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.32)`;
      const x = rng() * S, y = rng() * S;
      const a = rng() * Math.PI, l = 3 + rng() * 7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  });
}

// ---- foliage: grayscale maps tinted per-tree by the material color ----

// bark: vertical grain, near-white average so it multiplies onto the trunk hue
export function bark() {
  return makeTex(256, (ctx, S) => {
    const rng = texRng(8123);
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(0, 0, S, S);
    // long vertical fibres, darker and lighter, for woody grain
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 520; i++) {
      const dark = rng() > 0.45;
      const a = dark ? 0.10 + rng() * 0.16 : 0.10 + rng() * 0.12;
      ctx.strokeStyle = dark ? `rgba(60,40,24,${a})` : `rgba(255,244,220,${a})`;
      const x = rng() * S;
      const y0 = rng() * S, len = 30 + rng() * 120;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + (rng() - 0.5) * 6, y0 + len);
      ctx.stroke();
    }
    // a few horizontal cracks/knots
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(40,26,16,${0.12 + rng() * 0.12})`;
      ctx.fillRect(rng() * S, rng() * S, 4 + rng() * 14, 1.5);
    }
  });
}

// leafy canopy: soft dappled clumps of light/shadow, grayscale, ~white average
export function leafCanopy() {
  return makeTex(512, (ctx, S) => {
    const rng = texRng(4477);
    ctx.fillStyle = '#cfcfcf';
    ctx.fillRect(0, 0, S, S);
    // overlapping leaf blobs — darker pockets and bright highlights = depth
    for (let i = 0; i < 1400; i++) {
      const light = rng() > 0.5;
      const a = light ? 0.06 + rng() * 0.12 : 0.06 + rng() * 0.16;
      ctx.fillStyle = light ? `rgba(255,255,255,${a})` : `rgba(20,40,16,${a})`;
      const r = 6 + rng() * 26;
      ctx.beginPath();
      ctx.arc(rng() * S, rng() * S, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // fine leaf speckle for close-up crispness
    for (let i = 0; i < 6000; i++) {
      const v = rng() > 0.5 ? 235 : 120;
      ctx.fillStyle = `rgba(${v},${v},${v},0.18)`;
      ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
    }
  });
}

// soft round sprite so Points render as gentle dots, not hard squares
export function softDot() {
  return makeTex(64, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
}

// ---- structures ----

export function woodPlanks(base = '#a87848', gap = '#6e4a2c') {
  return makeTex(256, (ctx, S) => {
    const rng = texRng(411);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * S;
      ctx.fillStyle = gap;
      ctx.fillRect(0, y, S, 3);
      // grain
      for (let i = 0; i < 50; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.04 + rng() * 0.07})`;
        ctx.fillRect(rng() * S, y + 4 + rng() * (S / rows - 8), 10 + rng() * 60, 1.5);
      }
      ctx.fillStyle = gap;
      ctx.fillRect(((r * 97) % S), y, 3, S / rows);
    }
  }, { srgb: true });
}

export function plaster() {
  return makeTex(256, (ctx, S) => {
    const rng = texRng(929);
    ctx.fillStyle = '#f4f0e6';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2400; i++) {
      const v = 215 + Math.floor(rng() * 40);
      ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},0.5)`;
      ctx.fillRect(rng() * S, rng() * S, 2 + rng() * 3, 2 + rng() * 3);
    }
  }, { srgb: true });
}

export function shingles(base = '#7c8894', dark = '#5a646e') {
  return makeTex(256, (ctx, S) => {
    const rng = texRng(553);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    const rows = 7, w = S / 6;
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * S;
      const off = (r % 2) * w * 0.5;
      ctx.fillStyle = dark;
      ctx.fillRect(0, y, S, 2.5);
      for (let cI = -1; cI < 7; cI++) {
        ctx.fillRect(off + cI * w, y, 2, S / rows);
        ctx.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.06})`;
        ctx.fillRect(off + cI * w + 2, y + 2, w - 4, S / rows - 2);
        ctx.fillStyle = dark;
      }
    }
  }, { srgb: true });
}

export function cobblestone() {
  return makeTex(256, (ctx, S) => {
    const rng = texRng(127);
    ctx.fillStyle = '#8d8276';
    ctx.fillRect(0, 0, S, S);
    // rounded stones packed on a jittered grid
    const n = 7;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const cx = ((gx + 0.5) / n) * S + (rng() - 0.5) * 9;
        const cy = ((gy + 0.5) / n) * S + (rng() - 0.5) * 9;
        const r = (S / n) * (0.34 + rng() * 0.1);
        const v = 140 + Math.floor(rng() * 60);
        ctx.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * (0.9 + rng() * 0.3), r, rng(), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.2, cy - r * 0.25, r * 0.5, r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, { srgb: true });
}

export function straw() {
  return makeTex(256, (ctx, S) => {
    const rng = texRng(631);
    ctx.fillStyle = '#d8b850';
    ctx.fillRect(0, 0, S, S);
    ctx.lineWidth = 2;
    for (let i = 0; i < 900; i++) {
      const g = rng();
      ctx.strokeStyle = g > 0.5 ? 'rgba(120,85,30,0.5)' : 'rgba(255,230,140,0.5)';
      const x = rng() * S, y = rng() * S, a = (rng() - 0.5) * 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26);
      ctx.stroke();
    }
  }, { srgb: true });
}

// alpha-mapped chain-link mesh for the sanctuary fences
export function chainlink() {
  const tex = makeTex(128, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(225,230,235,0.95)';
    ctx.lineWidth = 2.5;
    const step = S / 4;
    for (let i = -4; i < 9; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step + S, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i * step + S, 0);
      ctx.lineTo(i * step, S);
      ctx.stroke();
    }
  }, { srgb: true });
  return tex;
}

// pale weathered stone for the Skylands ruins
export function ruinStone() {
  return makeTex(256, (ctx, S) => {
    const rng = texRng(283);
    ctx.fillStyle = '#ded8cc';
    ctx.fillRect(0, 0, S, S);
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * S;
      ctx.fillStyle = 'rgba(90,85,75,0.55)';
      ctx.fillRect(0, y, S, 2.5);
      const off = (r % 2) * S / 6;
      for (let i = 0; i < 4; i++) ctx.fillRect(off + i * (S / 3), y, 2.5, S / rows);
      for (let i = 0; i < 160; i++) {
        const v = 190 + Math.floor(rng() * 50);
        ctx.fillStyle = `rgba(${v},${v - 5},${v - 14},0.4)`;
        ctx.fillRect(rng() * S, y + 3 + rng() * (S / rows - 5), 2 + rng() * 4, 2 + rng() * 4);
      }
    }
  }, { srgb: true });
}
