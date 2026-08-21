// The giant keyboard you run across.
//
// A stage can hold several thousand keycaps, and every one of them has to be
// able to press down on its own, so they are InstancedMeshes — one per letter,
// because the letter lives in the texture. Per-instance colour supplies the
// candy/chocolate variety on top of a single shared geometry.
//
// The geometry is a box whose TOP face samples the left half of the texture
// (the legend) and whose other faces sample the blank right half. That keeps
// the letter on the cap without a custom shader, which matters because shader
// chunk names move between three.js releases and this has to keep working.

import * as THREE from 'three';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const KEY_SIZE = 1.9;      // world units across a cap
export const KEY_GAP = 0.14;
export const KEY_H = 0.62;        // cap height
export const PRESS_DEPTH = 0.34;  // how far a cap sinks

const texCache = new Map();
function letterTexture(ch) {
  if (texCache.has(ch)) return texCache.get(ch);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S * 2; cv.height = S;
  const g = cv.getContext('2d');
  // left tile: the legend. Near-white so per-instance colour does the tinting.
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(0,0,0,0.06)';
  g.fillRect(0, 0, S, 6);                                  // a hint of a bevel
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(0, S - 7, S, 7);
  g.fillStyle = 'rgba(30,12,40,0.72)';
  g.font = `700 ${Math.round(S * 0.5)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, S / 2, S / 2 + S * 0.03);
  // right tile: blank, for the sides
  g.fillStyle = '#f3f3f6'; g.fillRect(S, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(ch, t);
  return t;
}

// BoxGeometry face order is +X, -X, +Y, -Y, +Z, -Z — four UVs each. Only the
// +Y face keeps the legend half; everything else is pushed onto the blank half.
function keycapGeometry() {
  const g = new THREE.BoxGeometry(KEY_SIZE, KEY_H, KEY_SIZE);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u = uv.getX(k), v = uv.getY(k);
      // The cap's legend needs a half turn to face a camera that looks down +Z:
      // u runs along +X (which is screen-left from here) and v runs along -Z,
      // so leaving either alone gives you mirrored or upside-down letters.
      // Everything but the top face is pushed onto the blank half of the atlas.
      if (f === 2) { uv.setX(k, (1 - u) * 0.5); uv.setY(k, 1 - v); }
      else uv.setX(k, 0.5 + u * 0.5);
    }
  }
  uv.needsUpdate = true;
  return g;
}

export const THEMES = {
  candy: {
    name: 'Candy',
    keys: ['#ff9fd6', '#ffb8e3', '#d9a2ff', '#c084fc', '#ff7ec7', '#e9c4ff'],
    base: '#e879c4', wall: '#f0a8dc', sky: '#ffd9f0', fog: '#ffc9e8',
    accent: '#ff4fa8',
  },
  chocolate: {
    name: 'Chocolate',
    keys: ['#a9744b', '#8b5a2b', '#c68b59', '#6f4425', '#b9825a', '#d2a679'],
    base: '#5c3317', wall: '#7b4b2a', sky: '#e8c9a8', fog: '#d9b48f',
    accent: '#ffb85c',
  },
  mint: {
    name: 'Mint',
    keys: ['#8ef0c8', '#69dcae', '#b6f5dc', '#4fc99a', '#a0ecd0', '#7de3bd'],
    base: '#2f8f6d', wall: '#57bd96', sky: '#d6fff0', fog: '#bdf4e2',
    accent: '#12d18a',
  },
};

/**
 * A field of keycaps over a grid. `cells(col,row)` returns null for a gap or
 * `{ h }` for a cap, letting a stage carve holes and steps out of the board.
 */
export function makeKeyField(scene, { cols, rows, cells, theme, origin }) {
  const th = THEMES[theme] || THEMES.candy;
  const geo = keycapGeometry();
  const pitch = KEY_SIZE + KEY_GAP;
  const ox = origin?.x ?? 0, oz = origin?.z ?? 0;

  // bucket every cap by the letter it will wear
  const buckets = new Map();          // letter -> [{col,row,h,colour}]
  const grid = new Map();             // "c,r" -> record, for height lookups
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells(c, r);
      if (!cell) continue;
      const ch = LETTERS[(Math.floor(Math.abs(Math.sin(c * 12.9898 + r * 78.233) * 43758.5453)) % 26)];
      const rec = {
        col: c, row: r, h: cell.h || 0,
        colour: th.keys[Math.floor(Math.abs(Math.sin(c * 3.17 + r * 7.71) * 1000)) % th.keys.length],
        pressed: 0, press: 0, idx: 0, letter: ch,
      };
      if (!buckets.has(ch)) buckets.set(ch, []);
      rec.idx = buckets.get(ch).length;
      buckets.get(ch).push(rec);
      grid.set(`${c},${r}`, rec);
    }
  }

  const meshes = [];
  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  for (const [ch, list] of buckets) {
    const mat = new THREE.MeshLambertMaterial({ map: letterTexture(ch) });
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      dummy.position.set(ox + rec.col * pitch, rec.h + KEY_H / 2, oz + rec.row * pitch);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, colour.set(rec.colour));
      rec.mesh = inst;
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    meshes.push(inst);
  }

  const worldToCell = (x, z) => ({
    c: Math.round((x - ox) / pitch),
    r: Math.round((z - oz) / pitch),
  });
  const cellCentre = (c, r) => ({ x: ox + c * pitch, z: oz + r * pitch });

  /** Top surface under a point, or null over a gap. */
  function heightAt(x, z) {
    const { c, r } = worldToCell(x, z);
    const rec = grid.get(`${c},${r}`);
    if (!rec) return null;
    // a pressed cap really is lower — you can feel the board sink under a run
    return rec.h + KEY_H - rec.press * PRESS_DEPTH;
  }

  const active = new Set();   // caps mid-animation

  /** Press the cap under a point. Returns the record if this is its first press. */
  function pressAt(x, z) {
    const { c, r } = worldToCell(x, z);
    const rec = grid.get(`${c},${r}`);
    if (!rec) return null;
    const fresh = !rec.pressed;
    rec.pressed = 1;
    rec.press = 1;
    rec.hold = 0.06;
    active.add(rec);
    return fresh ? rec : null;
  }

  function update(dt) {
    if (!active.size) return;
    for (const rec of active) {
      if (rec.hold > 0) { rec.hold -= dt; continue; }
      // springs back, but never all the way — a struck key stays a shade down
      // so you can read your own path across the board behind you
      const rest = 0.18;
      rec.press += (rest - rec.press) * Math.min(1, dt * 7);
      if (Math.abs(rec.press - rest) < 0.004) { rec.press = rest; active.delete(rec); }
      dummy.position.set(ox + rec.col * pitch, rec.h + KEY_H / 2 - rec.press * PRESS_DEPTH, oz + rec.row * pitch);
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      rec.mesh.setMatrixAt(rec.idx, dummy.matrix);
      rec.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function dispose() {
    for (const m of meshes) { scene.remove(m); m.material.dispose(); m.dispose(); }
    geo.dispose();
  }

  const total = grid.size;
  return { meshes, heightAt, pressAt, update, dispose, worldToCell, cellCentre, pitch, total, theme: th, grid };
}
