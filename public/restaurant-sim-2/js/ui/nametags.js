// Floating nametags + chat bubbles (canvas sprites, bottom-anchored,
// always drawn above models — Feather Friends pattern).

import * as THREE from 'three';

const PX = 2;

export class Nametag {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: false,
    }));
    this.sprite.renderOrder = 999;
    this.sprite.center.set(0.5, 0);
    this.bubbleText = null;
    this.bubbleUntil = 0;
    this.cached = '';
  }

  update(name) {
    const key = name + '|' + (this.bubbleText || '');
    if (key === this.cached) return;
    this.cached = key;
    this.draw(name);
  }

  setBubble(text, seconds = 6) {
    this.bubbleText = text;
    this.bubbleUntil = performance.now() / 1000 + seconds;
    this.cached = '';
  }

  tick(now) {
    if (this.bubbleText && now > this.bubbleUntil) {
      this.bubbleText = null;
      this.cached = '';
      return true;
    }
    return false;
  }

  draw(name) {
    const ctx = this.ctx;
    const W = 320 * PX, H = 150 * PX;
    this.canvas.width = W; this.canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';

    let y = H - 10 * PX;
    ctx.font = `bold ${22 * PX}px 'Trebuchet MS', sans-serif`;
    ctx.lineWidth = 5 * PX;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(name, W / 2, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, W / 2, y);
    y -= 28 * PX;

    if (this.bubbleText) {
      ctx.font = `${17 * PX}px 'Trebuchet MS', sans-serif`;
      const lines = wrap(ctx, this.bubbleText, 270 * PX);
      const lh = 21 * PX;
      const bh = lines.length * lh + 12 * PX;
      const bw = Math.min(290 * PX, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 26 * PX);
      const bx = (W - bw) / 2, by = y - bh;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      roundRect(ctx, bx, by, bw, bh, 9 * PX);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(W / 2 - 5 * PX, by + bh);
      ctx.lineTo(W / 2 + 5 * PX, by + bh);
      ctx.lineTo(W / 2, by + bh + 7 * PX);
      ctx.fill();
      ctx.fillStyle = '#234';
      lines.forEach((l, i) => ctx.fillText(l, W / 2, by + (i + 1) * lh - 2 * PX));
    }

    this.texture.needsUpdate = true;
    this.sprite.scale.set(4.0, 1.9, 1);
  }

  dispose() {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
