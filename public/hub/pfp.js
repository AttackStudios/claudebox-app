// ClaudeBox profile pictures — the browser half: canvas rendering and import.
// The record shape and its validation live in /shared/pfp.js so the server can
// apply exactly the same rules.

import { sanitizePfp, PFP_LIMITS, DEFAULT_PFP } from '/shared/pfp.js';
export * from '/shared/pfp.js';

/* ------------------------------------------------------------------ paths -- */
function shapePath(ctx, shape, s) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  } else if (shape === 'square') {
    ctx.rect(0, 0, s, s);
  } else if (shape === 'hex') {
    // flat-top hexagon inscribed in the square
    const cx = s / 2, cy = s / 2, r = s / 2;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  } else {                                   // rounded / squircle
    const r = s * 0.28;
    ctx.moveTo(r, 0);
    ctx.arcTo(s, 0, s, s, r);
    ctx.arcTo(s, s, 0, s, r);
    ctx.arcTo(0, s, 0, 0, r);
    ctx.arcTo(0, 0, s, 0, r);
    ctx.closePath();
  }
}

/* --------------------------------------------------------- image caching -- */
// Imported pictures decode asynchronously; cache the decoded bitmap and repaint
// the canvases that asked for it once it lands.
const imgCache = new Map();       // dataUrl -> HTMLImageElement | 'loading'
const pending = new Map();        // dataUrl -> Set<() => void>

function getImage(src, onReady) {
  const hit = imgCache.get(src);
  if (hit && hit !== 'loading') return hit;
  if (!hit) {
    imgCache.set(src, 'loading');
    const im = new Image();
    im.onload = () => {
      imgCache.set(src, im);
      const waiting = pending.get(src);
      pending.delete(src);
      if (waiting) waiting.forEach((fn) => { try { fn(); } catch {} });
    };
    im.onerror = () => { imgCache.set(src, null); pending.delete(src); };
    im.src = src;
  }
  if (onReady) {
    if (!pending.has(src)) pending.set(src, new Set());
    pending.get(src).add(onReady);
  }
  return null;
}

/* ------------------------------------------------------------------ draw --- */
// drawHead is passed in (the hub's drawAvatarHead) so this module stays free of
// the 3D avatar code and can be imported by the server.
export function drawPfp(canvas, user, drawHead) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const s = canvas.width;
  const pfp = sanitizePfp(user && user.pfp);
  ctx.clearRect(0, 0, s, s);
  ctx.save();
  shapePath(ctx, pfp.shape, s);
  ctx.clip();

  if (pfp.kind === 'image' && pfp.image) {
    const im = getImage(pfp.image, () => drawPfp(canvas, user, drawHead));
    ctx.fillStyle = pfp.bg;
    ctx.fillRect(0, 0, s, s);
    if (im) {
      // cover-fit, centred
      const scale = Math.max(s / im.width, s / im.height);
      const w = im.width * scale, h = im.height * scale;
      ctx.drawImage(im, (s - w) / 2, (s - h) / 2, w, h);
    }
  } else if (pfp.kind === 'emoji') {
    ctx.fillStyle = pfp.bg;
    ctx.fillRect(0, 0, s, s);
    ctx.font = `${Math.round(s * 0.58)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pfp.emoji, s / 2, s * 0.54);
  } else {
    // the character's head, on the chosen backdrop
    ctx.fillStyle = pfp.bg;
    ctx.fillRect(0, 0, s, s);
    if (drawHead && user && user.avatar) drawHead(ctx, user.avatar, s);
  }
  ctx.restore();
}

// True when the PFP is just the plain character head on the default backdrop —
// i.e. the player has never touched it. Lets callers keep the old transparent
// look instead of stamping a coloured disc behind every head.
export function isDefaultPfp(pfp) {
  const p = sanitizePfp(pfp);
  return p.kind === 'avatar' && p.shape === 'circle' && p.bg === DEFAULT_PFP.bg && !p.image;
}

/* ------------------------------------------------- import + downscale ----- */
// Runs on the player's device: any picture they pick is drawn into a 256x256
// square and re-encoded, so what leaves the browser is small and predictable.
export function fileToPfpImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('That file is not an image.'));
    if (file.size > 12 * 1024 * 1024) return reject(new Error('That image is too big — pick one under 12 MB.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const im = new Image();
      im.onerror = () => reject(new Error('That image could not be decoded.'));
      im.onload = () => {
        const S = PFP_LIMITS.size;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const x = c.getContext('2d');
        x.fillStyle = '#ffffff';
        x.fillRect(0, 0, S, S);
        const scale = Math.max(S / im.width, S / im.height);
        const w = im.width * scale, h = im.height * scale;
        x.drawImage(im, (S - w) / 2, (S - h) / 2, w, h);
        // step the quality down until it fits the cap
        let out = '';
        for (const q of [0.85, 0.7, 0.55, 0.4, 0.3]) {
          out = c.toDataURL('image/jpeg', q);
          if (out.length <= PFP_LIMITS.image) break;
        }
        if (out.length > PFP_LIMITS.image) return reject(new Error('That image would not compress small enough.'));
        resolve(out);
      };
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
