// Minimap (bottom-left circle, rotating player arrow + region name) and the
// full map overlay (M) with landmarks and live player dots. The map image is
// prerendered once from the shared worldgen.

import { WORLD, ROADS, CAMPSITES, height, waterAt, regionAt } from '/shared/bp/worldgen.js';

const MAP_PX = 512;

// paint the world top-down once
function renderMapCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = MAP_PX;
  const ctx = c.getContext('2d');
  const step = WORLD.size / MAP_PX;
  for (let py = 0; py < MAP_PX; py++) {
    for (let px = 0; px < MAP_PX; px++) {
      const x = -WORLD.half + px * step;
      const z = -WORLD.half + py * step;
      const h = height(x, z);
      let col;
      if (h < 0.3 || waterAt(x, z)) col = '#3d6f96';
      else if (h > 55) col = '#dfe5ec';
      else {
        const reg = regionAt(x, z);
        if (reg === 'Canyon') col = h > 18 ? '#a4683f' : '#8f5532';
        else if (reg === 'Volcano') col = '#4a423c';
        else if (reg === 'Peaks') col = h > 30 ? '#9aa0a8' : '#5d7a4a';
        else col = h > 12 ? '#48663a' : '#557a42';
      }
      ctx.fillStyle = col;
      ctx.fillRect(px, py, 1, 1);
    }
  }
  // roads
  ctx.strokeStyle = '#caa84e';
  ctx.lineCap = 'round';
  for (const road of ROADS) {
    ctx.lineWidth = road.width * (MAP_PX / WORLD.size) * 1.4;
    ctx.beginPath();
    road.pts.forEach(([x, z], i) => {
      const px = (x + WORLD.half) / step / 1, py = (z + WORLD.half) / step;
      if (i === 0) ctx.moveTo((x + WORLD.half) / step, (z + WORLD.half) / step);
      else ctx.lineTo((x + WORLD.half) / step, (z + WORLD.half) / step);
    });
    ctx.stroke();
  }
  // lava dot
  const v = WORLD.volcano;
  ctx.fillStyle = '#ff6a1a';
  ctx.beginPath();
  ctx.arc((v.x + WORLD.half) / step, (v.z + WORLD.half) / step, v.craterR / step, 0, 7);
  ctx.fill();
  return c;
}

const LANDMARKS = [
  { x: WORLD.lodge.x, z: WORLD.lodge.z, label: '🏠 Lodge' },
  { x: WORLD.peaks.x, z: WORLD.peaks.z, label: '🏔️ Peaks' },
  { x: WORLD.volcano.x, z: WORLD.volcano.z, label: '🌋 Volcano' },
  { x: WORLD.canyon.x, z: WORLD.canyon.z, label: '🏜️ Canyon' },
  { x: WORLD.lakeWest.x, z: WORLD.lakeWest.z, label: '💧 Lakes' },
  { x: WORLD.cave.x, z: WORLD.cave.z, label: '💎 Cave' },
];

export class MapUI {
  constructor(game) {
    this.game = game;
    this.mapImage = renderMapCanvas();
    this.mini = document.getElementById('minimap-canvas');
    this.miniCtx = this.mini.getContext('2d');
    this.regionEl = document.getElementById('region-name');
    this.full = document.getElementById('fullmap');
    this.fullCanvas = document.getElementById('fullmap-canvas');
    this.fullCtx = this.fullCanvas.getContext('2d');
    this.lastRegion = '';

    document.getElementById('minimap').addEventListener('click', () => this.toggleFull());
    document.getElementById('fullmap-close').addEventListener('click', () => this.toggleFull(false));
  }

  toggleFull(force) {
    const show = force ?? this.full.classList.contains('hidden');
    this.full.classList.toggle('hidden', !show);
    if (show) this.drawFull();
  }

  get isFullOpen() { return !this.full.classList.contains('hidden'); }

  tick() {
    const p = this.game.player.pos;
    const ctx = this.miniCtx;
    const S = this.mini.width;
    const zoom = 5.2; // world units per pixel area shown
    const view = S * zoom * 0.5;

    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, 7);
    ctx.clip();
    // rotate map so "up" = camera forward
    const yaw = this.game.orbit.yaw + Math.PI;
    ctx.translate(S / 2, S / 2);
    ctx.rotate(yaw);
    const mapScale = MAP_PX / WORLD.size;
    const px = (p.x + WORLD.half) * mapScale;
    const pz = (p.z + WORLD.half) * mapScale;
    const span = (view / WORLD.size) * MAP_PX * 2;
    ctx.drawImage(this.mapImage, px - span / 2, pz - span / 2, span, span, -S / 2, -S / 2, S, S);
    ctx.restore();

    // player arrow (always pointing up)
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2 - 7);
    ctx.lineTo(S / 2 - 5, S / 2 + 5);
    ctx.lineTo(S / 2 + 5, S / 2 + 5);
    ctx.fill();

    const reg = regionAt(p.x, p.z);
    if (reg !== this.lastRegion) {
      this.lastRegion = reg;
      this.regionEl.textContent = reg;
    }

    if (this.isFullOpen) this.drawFull();
  }

  drawFull() {
    const ctx = this.fullCtx;
    const S = this.fullCanvas.width;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapImage, 0, 0, S, S);
    const scale = S / WORLD.size;
    // campsite pins
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    for (const c of CAMPSITES) {
      ctx.fillText('⛺', (c.x + WORLD.half) * scale, (c.z + WORLD.half) * scale);
    }
    // landmarks
    ctx.font = 'bold 13px Trebuchet MS, sans-serif';
    for (const lm of LANDMARKS) {
      const x = (lm.x + WORLD.half) * scale, y = (lm.z + WORLD.half) * scale;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(lm.label, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(lm.label, x, y);
    }
    // player dots
    for (const [, rec] of this.game.players) {
      ctx.fillStyle = '#7ec8e8';
      ctx.beginPath();
      ctx.arc((rec.group.position.x + WORLD.half) * scale, (rec.group.position.z + WORLD.half) * scale, 4, 0, 7);
      ctx.fill();
    }
    const p = this.game.player.pos;
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc((p.x + WORLD.half) * scale, (p.z + WORLD.half) * scale, 5, 0, 7);
    ctx.fill();
  }
}
