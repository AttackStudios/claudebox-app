// Nametags + chat bubbles as canvas-texture sprites floating above birds.
// Lines: [flock tag] / Name (custom color+style) / breed · stage

import * as THREE from 'three';
import { BREEDS } from '../birds/breeds.js';

const PX = 2; // canvas oversampling

export class Nametag {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.anisotropy = 2;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.texture, transparent: true, depthWrite: false,
      depthTest: false, // always draw over models so tags are never buried
    }));
    this.sprite.renderOrder = 999;
    // anchor the sprite's BOTTOM edge at its position, so all tag content
    // renders upward from the anchor and never overlaps the bird below it
    this.sprite.center.set(0.5, 0);
    this.bubbleText = null;
    this.bubbleUntil = 0;
    this.cached = '';
  }

  // info: { name, nameStyle, breed, stage, flockName, flockColor, flockRank }
  update(info) {
    const key = JSON.stringify(info) + '|' + (this.bubbleText || '');
    if (key === this.cached) return;
    this.cached = key;
    this.draw(info);
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
      return true; // needs redraw via update()
    }
    return false;
  }

  draw(info) {
    const ctx = this.ctx;
    const W = 360 * PX, H = 200 * PX;
    this.canvas.width = W;
    this.canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';

    let y = H; // we draw bottom-up

    // line 4: breed · stage
    const breedLabel = BREEDS[info.breed]?.label || info.breed;
    const stageLabel = info.stage === 'egg' ? 'Egg' : info.stage === 'baby' ? 'Hatchling' : info.stage === 'fledgling' ? 'Fledgling' : '';
    ctx.font = `${14 * PX}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 3 * PX;
    y -= 8 * PX;
    ctx.fillText(stageLabel ? `${breedLabel} · ${stageLabel}` : breedLabel, W / 2, y);
    y -= 19 * PX;

    // line 3: description (the creature-card subtitle), wrapped, italic
    if (info.description) {
      ctx.font = `italic ${15 * PX}px 'Trebuchet MS', sans-serif`;
      ctx.fillStyle = 'rgba(255,246,210,0.95)';
      ctx.shadowBlur = 3 * PX;
      const dlines = wrap(ctx, info.description, 320 * PX).slice(0, 2);
      for (let i = dlines.length - 1; i >= 0; i--) {
        ctx.fillText(dlines[i], W / 2, y);
        y -= 18 * PX;
      }
      y -= 2 * PX;
    }

    // line 2: name (creature name, styled)
    ctx.font = `bold ${24 * PX}px 'Trebuchet MS', sans-serif`;
    const style = info.nameStyle || {};
    ctx.shadowBlur = 0;
    if (style.style === 'glow') {
      ctx.shadowColor = style.color || '#fff';
      ctx.shadowBlur = 12 * PX;
    } else if (style.style === 'outline' || !style.style) {
      ctx.lineWidth = 5 * PX;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(info.name, W / 2, y);
    }
    ctx.fillStyle = style.color || '#ffffff';
    ctx.fillText(info.name, W / 2, y);
    if (style.style === 'glow') ctx.fillText(info.name, W / 2, y); // double for stronger glow
    ctx.shadowBlur = 0;
    y -= 26 * PX;

    // line 1: [Role] {Flock} {Realm}
    const tagParts = [];
    if (info.flockName) tagParts.push(`[${info.flockRole || 'Member'}] {${info.flockName}}`);
    if (info.realm) tagParts.push(`{${info.realm}}`);
    if (tagParts.length) {
      const tag = tagParts.join('  ');
      ctx.font = `bold ${15 * PX}px 'Trebuchet MS', sans-serif`;
      ctx.lineWidth = 4 * PX;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(tag, W / 2, y);
      ctx.fillStyle = info.flockColor || '#ffd24a';
      ctx.fillText(tag, W / 2, y);
      y -= 20 * PX;
    }

    // chat bubble on top
    if (this.bubbleText) {
      ctx.font = `${18 * PX}px 'Trebuchet MS', sans-serif`;
      const lines = wrap(ctx, this.bubbleText, 300 * PX);
      const lh = 22 * PX;
      const bh = lines.length * lh + 14 * PX;
      const bw = Math.min(320 * PX, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 28 * PX);
      const bx = (W - bw) / 2;
      const by = y - bh - 6 * PX;
      const isEmote = /^\*.*\*$/.test(this.bubbleText);
      ctx.fillStyle = isEmote ? 'rgba(240,240,255,0.92)' : 'rgba(255,255,255,0.94)';
      roundRect(ctx, bx, by, bw, bh, 10 * PX);
      ctx.fill();
      // little tail
      ctx.beginPath();
      ctx.moveTo(W / 2 - 6 * PX, by + bh);
      ctx.lineTo(W / 2 + 6 * PX, by + bh);
      ctx.lineTo(W / 2, by + bh + 8 * PX);
      ctx.fill();
      ctx.fillStyle = isEmote ? '#777' : '#234';
      ctx.font = `${isEmote ? 'italic ' : ''}${18 * PX}px 'Trebuchet MS', sans-serif`;
      lines.forEach((l, i) => ctx.fillText(l, W / 2, by + (i + 1) * lh - 2 * PX));
    }

    this.texture.needsUpdate = true;
    this.sprite.scale.set(4.6, 2.55, 1);
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
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
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
