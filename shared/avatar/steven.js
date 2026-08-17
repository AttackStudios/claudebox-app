// Steven — the blocky body.
//
// Not a downloaded model: a Minecraft character is six boxes and a 64x64 skin,
// so this builds the boxes and UV-maps them onto whatever skin it is handed.
// That has a nice consequence — if we can DRAW a skin, we can dress the body.
// So when no skin has been uploaded, one is painted from the wearer's own
// avatar: shirt colour onto the torso and sleeves, pants onto the legs, skin
// onto the head and hands, hair and hat onto the overlay layer. That is what
// "pixelates your clothing and flattens it onto the body" means here.
//
// Height is pinned so Steven is never taller than the default boy.

import * as THREE from 'three';

export const SKIN_PX = 64;
// A Minecraft character is 32 pixels tall (8 head + 12 body + 12 leg). The boy
// model normalises to 1.9, so this scale keeps Steven a shade under it.
export const STEVEN_HEIGHT = 1.88;
const S = STEVEN_HEIGHT / 32;

// Every box in pixels: [width, height, depth] and where its faces live on the
// skin sheet. Regions are [x, y] of the layout block; faces are derived.
const P = (w, h, d) => ({ w, h, d });
export const PARTS = {
  head:  { size: P(8, 8, 8),  uv: [0, 0],   overlay: [32, 0] },
  body:  { size: P(8, 12, 4), uv: [16, 16], overlay: [16, 32] },
  armR:  { size: P(4, 12, 4), uv: [40, 16], overlay: [40, 32] },
  armL:  { size: P(4, 12, 4), uv: [32, 48], overlay: [48, 48] },
  legR:  { size: P(4, 12, 4), uv: [0, 16],  overlay: [0, 32] },
  legL:  { size: P(4, 12, 4), uv: [16, 48], overlay: [0, 48] },
};

// Map one box's six faces onto the sheet. three.js orders faces +X,-X,+Y,-Y,+Z,-Z
// and lays each out as top-left, top-right, bottom-left, bottom-right.
function applyBoxUV(geo, { w, h, d }, [ox, oy]) {
  const uv = geo.attributes.uv;
  const N = SKIN_PX;
  // face rectangles in sheet pixels, in three.js face order
  const faces = [
    [ox + d + w, oy + d, d, h],          // +X  (character's left side)
    [ox,         oy + d, d, h],          // -X  (right side)
    [ox + d,     oy,     w, d],          // +Y  top
    [ox + d + w, oy,     w, d],          // -Y  bottom
    [ox + d,     oy + d, w, h],          // +Z  front
    [ox + d + w + d, oy + d, w, h],      // -Z  back
  ];
  faces.forEach((f, i) => {
    const [x, y, fw, fh] = f;
    const u0 = x / N, u1 = (x + fw) / N;
    // the sheet counts y downward; uv counts upward
    const v0 = 1 - y / N, v1 = 1 - (y + fh) / N;
    const o = i * 4;
    uv.setXY(o + 0, u0, v0);
    uv.setXY(o + 1, u1, v0);
    uv.setXY(o + 2, u0, v1);
    uv.setXY(o + 3, u1, v1);
  });
  uv.needsUpdate = true;
}

function boxFor(part, overlay) {
  const { size } = PARTS[part];
  // the overlay ("hat") layer is the same box a touch larger, so it reads as a
  // second skin rather than z-fighting with the first
  const g = overlay ? 1.08 : 1;
  const geo = new THREE.BoxGeometry(size.w * S * g, size.h * S * g, size.d * S * g);
  applyBoxUV(geo, size, overlay ? PARTS[part].overlay : PARTS[part].uv);
  return geo;
}

/**
 * Build the blocky body. Returns pivots named the way the animator expects, so
 * the same pose library drives this as drives the other rigs.
 */
export function buildSteven(texture) {
  const mat = new THREE.MeshLambertMaterial({ map: texture });
  const over = new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: 0.35, depthWrite: false });

  const root = new THREE.Group();
  const px = (n) => n * S;
  // heights: legs 12, body 12, head 8 — measured from the floor
  const legTop = px(12), bodyTop = legTop + px(12);

  const joints = {};
  const mk = (name, part, pivotY, offsetY, x = 0) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const mesh = new THREE.Mesh(boxFor(part, false), mat);
    mesh.position.y = offsetY;
    const skin = new THREE.Mesh(boxFor(part, true), over);
    skin.position.y = offsetY;
    pivot.add(mesh, skin);
    root.add(pivot);
    joints[name] = pivot;
    return pivot;
  };

  // torso hangs from the waist; head, arms and legs pivot where they attach
  mk('body', 'body', legTop, px(6));
  mk('head', 'head', bodyTop, px(4));
  mk('armR', 'armR', bodyTop - px(2), -px(4), -px(6));
  mk('armL', 'armL', bodyTop - px(2), -px(4), px(6));
  mk('legR', 'legR', legTop, -px(6), -px(2));
  mk('legL', 'legL', legTop, -px(6), px(2));

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return { root, joints, height: STEVEN_HEIGHT };
}

// ---------------------------------------------------------------- skin paint
const px = (x, c, a, b, w, h) => { x.fillStyle = c; x.fillRect(a, b, w, h); };

/**
 * Paint a 64x64 skin from an avatar profile — the wearer's own clothing,
 * pixelated and flattened onto the body.
 */
export function skinFromProfile(p = {}) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SKIN_PX;
  const x = cv.getContext('2d');
  x.imageSmoothingEnabled = false;

  const skin = p.skin || '#e8b48a';
  const shirt = p.shirtColor || '#3a7bd5';
  const pants = p.pantsColor || '#34404f';
  const shoe = p.shoes && p.shoes !== 'none' ? (p.shoeColor || '#22242c') : null;
  const hair = p.hair && p.hair !== 'none' ? (p.hairColor || '#5d4037') : null;
  const hat = p.hat && p.hat !== 'none' ? (p.hatColor || '#d2453a') : null;

  // ---- head: skin all round, then a pixel face on the front ----
  px(x, skin, 8, 0, 8, 8); px(x, skin, 16, 0, 8, 8);       // top / bottom
  px(x, skin, 0, 8, 32, 8);                                 // right, front, left, back
  const fx = 8;                                             // head front starts at x=8, y=8
  px(x, '#ffffff', fx + 2, 8 + 3, 1, 2); px(x, '#ffffff', fx + 5, 8 + 3, 1, 2);
  px(x, '#3b2a1c', fx + 2, 8 + 3, 1, 1); px(x, '#3b2a1c', fx + 5, 8 + 3, 1, 1);
  px(x, '#6b4a35', fx + 3, 8 + 6, 2, 1);                    // mouth

  // ---- torso: the shirt, with a collar band ----
  px(x, shirt, 16, 16, 24, 4);                              // top + bottom strips
  px(x, shirt, 16, 20, 24, 12);                             // the four sides
  px(x, '#ffffff', 20, 20, 8, 1);                           // collar

  // ---- arms: sleeve on top, bare hand at the wrist ----
  for (const [ax, ay] of [[40, 16], [32, 48]]) {
    px(x, shirt, ax, ay, 16, 4);
    px(x, shirt, ax, ay + 4, 16, 8);                        // upper arm = sleeve
    px(x, skin, ax, ay + 12, 16, 4);                        // forearm + hand
  }

  // ---- legs: trousers, and shoes on the last few pixels ----
  for (const [lx, ly] of [[0, 16], [16, 48]]) {
    px(x, pants, lx, ly, 16, 4);
    px(x, pants, lx, ly + 4, 16, 12);
    if (shoe) px(x, shoe, lx, ly + 13, 16, 3);
  }

  // ---- overlay layer: hair, then a hat over it ----
  if (hair) {
    px(x, hair, 32 + 8, 0, 8, 8);                           // top of head
    px(x, hair, 32, 8, 32, 3);                              // a fringe all round
    px(x, hair, 32 + 24, 8, 8, 8);                          // back of head
  }
  if (hat) {
    px(x, hat, 32 + 8, 0, 8, 8);                            // crown
    px(x, hat, 32, 8, 32, 2);                               // band
  }

  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Turn an uploaded skin image into a texture with the right filtering. */
export function textureFromImage(img) {
  const t = new THREE.Texture(img);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
