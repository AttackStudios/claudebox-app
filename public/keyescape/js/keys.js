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
export const KEY_GAP = 0.26;      // a real board leaves air between caps
export const KEY_H = 0.86;        // cap height
export const PRESS_DEPTH = 0.34;  // how far a cap sinks

const texCache = new Map();
function letterTexture(ch) {
  if (texCache.has(ch)) return texCache.get(ch);
  const S = 160;
  const cv = document.createElement('canvas');
  cv.width = S * 2; cv.height = S;
  const g = cv.getContext('2d');

  // --- left tile: the cap's top surface ---
  // Near-white, because per-instance colour tints it. The soft radial darkening
  // fakes the dish a real keycap has scooped into it, which no amount of
  // geometry at this scale would sell as cheaply.
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  const dish = g.createRadialGradient(S / 2, S * 0.46, S * 0.08, S / 2, S * 0.5, S * 0.72);
  dish.addColorStop(0, 'rgba(255,255,255,0)');
  dish.addColorStop(1, 'rgba(0,0,0,0.13)');
  g.fillStyle = dish; g.fillRect(0, 0, S, S);
  // a highlight along the top edge, the way light catches a moulded cap
  const sheen = g.createLinearGradient(0, 0, 0, S * 0.42);
  sheen.addColorStop(0, 'rgba(255,255,255,0.85)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(0, 0, S, S * 0.42);

  // the legend
  g.fillStyle = 'rgba(26,10,34,0.78)';
  g.font = `600 ${Math.round(S * 0.46)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, S / 2, S * 0.53);

  // --- right tile: the skirt ---
  // Deliberately darker than the top so the taper reads as shading even under
  // flat lighting; the tint multiplies both, so the relationship survives.
  const side = g.createLinearGradient(S, 0, S, S);
  side.addColorStop(0, '#e6e6ec');
  side.addColorStop(1, '#a9a9b6');
  g.fillStyle = side; g.fillRect(S, 0, S, S);

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(ch, t);
  return t;
}

/**
 * A keycap, not a box: a tapered skirt, a bevelled crown and a small flat top,
 * roughly Cherry profile. Built by hand and left non-indexed so
 * computeVertexNormals gives crisp facets instead of smearing the taper.
 *
 * The top face samples the legend half of the 2:1 atlas (flipped in both axes,
 * because the camera looks down +Z); every other face takes the skirt half.
 */
function keycapGeometry() {
  const h = KEY_H;
  const B = KEY_SIZE * 0.50;    // base half-width
  const M = KEY_SIZE * 0.425;   // shoulder, where the skirt meets the crown
  const T = KEY_SIZE * 0.375;   // the flat top
  const yM = h * 0.80;

  const pos = [], uv = [];
  // Legend UVs live in [0,0.5]; the skirt gets [0.5,1]. u is flipped because the
  // corner order below runs along +X, which is screen-LEFT for a camera looking
  // down +Z — leave it alone and every N reads as И. v needs no flip: the top
  // face's far edge is already the top of the glyph, which is how you read a
  // real keyboard from behind it.
  const capUV = (u, v) => { uv.push((1 - u) * 0.5, v); };
  const skirtUV = (u, v) => { uv.push(0.5 + u * 0.5, v); };

  const quad = (a, b, c, d, uvfn, uvs) => {
    // two triangles, wound counter-clockwise seen from outside
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const [u0, u1, u2, u3] = uvs;
    uvfn(...u0); uvfn(...u1); uvfn(...u2);
    uvfn(...u0); uvfn(...u2); uvfn(...u3);
  };

  // the four sides, each in two bands (skirt then crown bevel)
  const corners = (r, y) => [[-r, y, r], [r, y, r], [r, y, -r], [-r, y, -r]];
  const b = corners(B, 0), m = corners(M, yM), t = corners(T, h);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(b[i], b[j], m[j], m[i], skirtUV, [[0, 0], [1, 0], [1, 0.8], [0, 0.8]]);
    quad(m[i], m[j], t[j], t[i], skirtUV, [[0, 0.8], [1, 0.8], [1, 1], [0, 1]]);
  }
  // the top, carrying the legend
  quad(t[0], t[1], t[2], t[3], capUV, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  // and a floor, so a cap seen from under a gap is not hollow
  quad(b[3], b[2], b[1], b[0], skirtUV, [[0, 0], [1, 0], [1, 1], [0, 1]]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // the cap sits ON the surface, so shift it up out of its own base
  g.translate(0, -h / 2, 0);
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
    // a little specular: ABS caps are matte but not dead flat
    const mat = new THREE.MeshPhongMaterial({ map: letterTexture(ch), shininess: 16, specular: 0x1a1a1a });
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

  /**
   * Top surface under a point, or null over a gap.
   *
   * Deliberately ignores the press animation. Letting the collision surface
   * follow the cap meant the ground dropped a third of a unit the instant you
   * touched a key, so your feet — and the camera watching them — snapped down
   * on every single keystroke. The press is cosmetic; the floor is flat.
   */
  function heightAt(x, z) {
    const { c, r } = worldToCell(x, z);
    const rec = grid.get(`${c},${r}`);
    if (!rec) return null;
    return rec.h + KEY_H;
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

  /**
   * Press every cap along the path travelled since last frame.
   *
   * Testing only the cell under the player drops keys the moment one frame
   * carries you further than a cap is wide — which is most of the late game,
   * and any frame hitch at any speed. Walking the segment means a key registers
   * no matter how fast you are going or how badly the frame stuttered.
   */
  function pressSegment(x0, z0, x1, z1) {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    // sample below half a cap so no cell along the line can be stepped over
    const steps = Math.min(160, Math.max(1, Math.ceil(dist / (pitch * 0.4))));
    const fresh = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const rec = pressAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (rec) fresh.push(rec);
    }
    return fresh;
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
  return { meshes, heightAt, pressAt, pressSegment, update, dispose, worldToCell, cellCentre, pitch, total, theme: th, grid };
}
