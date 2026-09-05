// ClaudeBox profile pictures — the parts the server and the browser both need.
//
// A PFP decides what gets drawn wherever a headshot appears (friends row, header
// chip, left rail, profile overlay). Three kinds: `avatar` renders the 3D
// character's head, `emoji` is a preset glyph on a colour, `image` is a picture
// the player imported. Any kind can be masked to one of four shapes.
//
// sanitizePfp() runs on BOTH sides: the browser calls it before POSTing and the
// server calls it before persisting, so a hand-crafted request cannot smuggle in
// an oversized payload or a non-image data URL.

export const PFP_SHAPES = ['circle', 'rounded', 'square', 'hex'];

export const PFP_EMOJI = [
  '🐦', '🦅', '🦉', '🐱', '🐶', '🦊', '🐼', '🐸',
  '🎮', '🕹️', '🚀', '⚡', '⭐', '🔥', '🌈', '💎',
  '👾', '🤖', '👑', '🎩', '🍕', '🍔', '🍩', '🌮',
  '⚽', '🏀', '🎸', '🎨', '🧩', '🪄', '🛸', '🦖',
];

// A palette that reads well behind both dark glyphs and light ones.
export const PFP_COLORS = [
  '#38b6e8', '#4f7cff', '#7c5cff', '#b45cff', '#ff5ca8', '#ff6b5c',
  '#ff9f43', '#ffcf5c', '#48d98a', '#2ec5a0', '#5a6a7a', '#1f2430',
];

export const PFP_LIMITS = { image: 96 * 1024, size: 256 };

export const DEFAULT_PFP = { kind: 'avatar', emoji: '🐦', bg: '#38b6e8', shape: 'circle', image: '' };

const hex = (v, fallback) =>
  (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim())) ? v.trim().toLowerCase() : fallback;

// Shared by the client (before POST) and the server (before persisting), so a
// hand-crafted request cannot smuggle in an oversized or non-image payload.
export function sanitizePfp(raw) {
  const p = (raw && typeof raw === 'object') ? raw : {};
  const out = { ...DEFAULT_PFP };
  out.kind = ['avatar', 'emoji', 'image'].includes(p.kind) ? p.kind : 'avatar';
  out.shape = PFP_SHAPES.includes(p.shape) ? p.shape : 'circle';
  out.bg = hex(p.bg, DEFAULT_PFP.bg);
  out.emoji = (typeof p.emoji === 'string' && PFP_EMOJI.includes(p.emoji)) ? p.emoji : DEFAULT_PFP.emoji;

  const img = typeof p.image === 'string' ? p.image : '';
  const okImg = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(img) && img.length <= PFP_LIMITS.image;
  out.image = okImg ? img : '';
  if (out.kind === 'image' && !out.image) out.kind = 'avatar';   // nothing to draw
  return out;
}

