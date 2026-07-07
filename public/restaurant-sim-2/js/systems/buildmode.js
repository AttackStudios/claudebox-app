// RS2 build mode: walk your floor with a ghost preview snapped to the grid,
// rotate, place (charges cash), tap your own items to move or sell them.

import * as THREE from 'three';
import { buildFurniture } from './furniture.js';
import { toast } from '../ui/chat.js';

export class BuildMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.selected = null;      // { kind, tier } being placed
    this.movingId = null;      // existing item being relocated
    this.rot = 0;
    this.ghost = null;
    this.lastCell = null;
  }

  enter(kind, tier = 0) {
    this.exitGhost();
    this.active = true;
    this.selected = kind ? { kind, tier } : null;
    this.movingId = null;
    this.rot = 0;
    if (kind) this.makeGhost(kind, tier);
    this.game.onBuildChanged?.();
  }

  startMove(itemId) {
    const mine = this.game.myRestaurantRec();
    const item = mine?.r.items[itemId];
    if (!item) return;
    this.exitGhost();
    this.active = true;
    this.movingId = itemId;
    this.selected = { kind: item.kind, tier: item.tier || 0 };
    this.rot = item.rot;
    this.makeGhost(item.kind, item.tier || 0);
    this.game.onBuildChanged?.();
  }

  exit() {
    this.active = false;
    this.selected = null;
    this.movingId = null;
    this.exitGhost();
    this.game.onBuildChanged?.();
  }

  exitGhost() {
    if (this.ghost) {
      this.game.scene.remove(this.ghost);
      this.ghost = null;
    }
  }

  makeGhost(kind, tier) {
    this.ghost = buildFurniture(kind, tier);
    this.ghost.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.55;
        o.userData.baseColor = o.material.color.clone();
      }
    });
    this.game.scene.add(this.ghost);
  }

  rotate() {
    this.rot = (this.rot + 1) & 3;
  }

  // current grid cell in front of the player (snapped)
  targetCell() {
    const g = this.game;
    const mine = g.myRestaurantRec();
    if (!mine) return null;
    const frame = mine.shell.frame;
    const p = g.player.pos;
    const aimX = p.x + Math.sin(p.ryAim ?? g.player.ry) * 1.8;
    const aimZ = p.z + Math.cos(p.ryAim ?? g.player.ry) * 1.8;
    // world → grid
    const gx = Math.round(aimX - (frame.cx - frame.w / 2) - 0.5);
    const gzRaw = (aimZ - (frame.cz - frame.f * (frame.d / 2))) * frame.f;
    const gz = Math.round(gzRaw - 0.5);
    return { gx, gz, frame };
  }

  valid(cell) {
    const mine = this.game.myRestaurantRec();
    if (!mine || !cell || !this.selected) return false;
    return this.game.placementOkClient(mine.r, this.selected.kind, cell.gx, cell.gz, this.rot, this.movingId);
  }

  tick() {
    if (!this.active || !this.ghost) return;
    const cell = this.targetCell();
    if (!cell) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    const mine = this.game.myRestaurantRec();
    const w = cell.frame;
    const def = this.game.catalog.ITEMS[this.selected.kind];
    const fw = this.rot % 2 ? def.d : def.w;
    const fd = this.rot % 2 ? def.w : def.d;
    const a = w.cellToWorld(cell.gx, cell.gz);
    const b = w.cellToWorld(cell.gx + fw - 1, cell.gz + fd - 1);
    this.ghost.position.set((a.x + b.x) / 2, 2.17, (a.z + b.z) / 2);
    this.ghost.rotation.y = this.rot * Math.PI / 2 + (w.f < 0 ? Math.PI : 0);
    const ok = this.valid(cell);
    this.ghost.traverse((o) => {
      if (o.isMesh) o.material.color.copy(ok ? o.userData.baseColor : new THREE.Color('#ff5544'));
    });
    this.lastCell = cell;
    this.lastValid = ok;
  }

  confirm() {
    if (!this.active || !this.lastCell) return;
    if (!this.lastValid) { toast("Doesn't fit there!"); this.game.audio.sfx('error'); return; }
    if (this.movingId) {
      this.game.net.send({ t: 'build.move', id: this.movingId, gx: this.lastCell.gx, gz: this.lastCell.gz, rot: this.rot });
      this.movingId = null;
      this.exit();
    } else if (this.selected) {
      this.game.net.send({ t: 'build.place', kind: this.selected.kind, tier: this.selected.tier, gx: this.lastCell.gx, gz: this.lastCell.gz, rot: this.rot });
      this.game.audio.sfx('place');
      // stay in build mode for repeat placement (fences, chairs…)
    }
  }

  // nearest own item (for move/sell actions)
  nearestOwnItem(maxD = 2.6) {
    const g = this.game;
    const mine = g.myRestaurantRec();
    if (!mine) return null;
    let best = null, bd = maxD;
    for (const [id, rec] of Object.entries(mine.itemMeshes || {})) {
      const d = Math.hypot(rec.world.x - g.player.pos.x, rec.world.z - g.player.pos.z);
      if (d < bd) { bd = d; best = { id, rec }; }
    }
    return best;
  }
}
