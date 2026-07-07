// 21 breeds, each a parameter recipe for the procedural bird factory —
// redesigned (v3) to match the reference sheet: species-accurate palettes,
// painted face markings, quadruped plans for Griffin/Peryton, and per-breed
// baby looks. Proportions are relative to a "standard bird" ~1 unit tall.
//
// New recipe fields the factory understands:
//   markings: per-species face/body overlays (see factory buildMarkings)
//   plan: 'bird' (default) | 'quad' — quadrupeds get 4 legs (legBL/legBR)
//   legsFront/legsRear: 'talon' | 'hoof' | 'paw'  (quad only)
//   antlers: true — branched antlers (adults only)
//   mane: true — hackle-feather neck mane
//   eyeKind: 'round' (default) | 'slit'
//   tailSlot: color slot the tail fan uses (default 'wings')
//   baby: { palette: {...overrides}, noMarkings: true } — hatchling look

export const SETS = [
  { id: 'classic', label: 'Classic' },
  { id: 'exotic', label: 'Exotic' },
  { id: 'raptor', label: 'Raptors' },
  { id: 'mythical', label: 'Mythical' },
];

export const BREEDS = {
  // ---------- classic ----------
  robin: {
    label: 'Robin', set: 'classic', emoji: '🐦', size: 0.9,
    body: { len: 1.0, w: 0.95, h: 0.95 }, headSize: 0.95, neckLen: 0.08,
    beak: 'cone', beakLen: 0.26, legLen: 0.45, tail: 'fan', wingSpan: 1.0,
    markings: 'robin',
    palette: { body: '#3a3f45', wings: '#2c3036', belly: '#f2702a', head: '#1d2024', beak: '#f2b13a', legs: '#c89090', eyes: '#2b2b2b', accent: '#f2f2ee' },
    baby: { palette: { body: '#8d8478', wings: '#7a7268', belly: '#d8a878', head: '#6e675e' } },
  },
  cardinal: {
    label: 'Cardinal', set: 'classic', emoji: '❤️', size: 0.9,
    body: { len: 1.0, w: 0.9, h: 0.95 }, headSize: 0.95, neckLen: 0.08,
    beak: 'cone', beakLen: 0.24, legLen: 0.45, tail: 'long', wingSpan: 1.0, crest: 'spike',
    markings: 'cardinal',
    palette: { body: '#e0241d', wings: '#9c4a52', belly: '#e8443c', head: '#e0241d', beak: '#f2913a', legs: '#8d6b54', eyes: '#2b2b2b', accent: '#1d1d22' },
    baby: { palette: { body: '#c98d7a', wings: '#a4705e', belly: '#e0b49a', head: '#c98d7a' }, noMarkings: true },
  },
  duck: {
    label: 'Duck', set: 'classic', emoji: '🦆', size: 1.0,
    body: { len: 1.25, w: 1.1, h: 0.9 }, headSize: 0.9, neckLen: 0.3,
    beak: 'spoon', beakLen: 0.34, legLen: 0.32, tail: 'pin', wingSpan: 0.95,
    markings: 'duck',
    palette: { body: '#d8d8d0', wings: '#8d7058', belly: '#efefe8', head: '#1d6e35', beak: '#f2d23a', legs: '#f2913a', eyes: '#1c1c1c', accent: '#2455c8' },
    baby: { palette: { body: '#f2d75a', wings: '#e8c84a', belly: '#f8e88a', head: '#f2d75a', beak: '#f2913a' }, noMarkings: true },
  },
  chicken: {
    label: 'Chicken', set: 'classic', emoji: '🐔', size: 1.0,
    body: { len: 1.1, w: 1.1, h: 1.05 }, headSize: 0.85, neckLen: 0.34,
    beak: 'cone', beakLen: 0.22, legLen: 0.5, tail: 'fan', wingSpan: 0.8, crest: 'comb', wattle: true,
    tailSlot: 'wings', wingTips: false,
    palette: { body: '#b8895c', wings: '#8d6740', belly: '#caa275', head: '#b8602c', beak: '#e8e0c0', legs: '#f2e09a', eyes: '#2b2b2b', accent: '#e23b3b' },
    baby: { palette: { body: '#f8e070', wings: '#f2d75a', belly: '#fcf0a8', head: '#f8e070', beak: '#f2b13a', legs: '#f2b13a' }, noMarkings: true },
  },
  owl: {
    label: 'Owl', set: 'classic', emoji: '🦉', size: 1.05,
    body: { len: 0.95, w: 1.15, h: 1.15 }, headSize: 1.25, neckLen: 0.0,
    beak: 'hook', beakLen: 0.16, legLen: 0.34, tail: 'fan', wingSpan: 1.15,
    markings: 'owl',
    palette: { body: '#caa84e', wings: '#c0974a', belly: '#f4f0e6', head: '#caa84e', beak: '#d8c8b8', legs: '#c8b09a', eyes: '#2b2b2b', accent: '#f4f0e6' },
    baby: { palette: { body: '#ece4d4', wings: '#ded4c0', belly: '#f8f4ea', head: '#ece4d4' }, noMarkings: true },
  },
  sparrow: {
    label: 'Sparrow', set: 'classic', emoji: '🤎', size: 0.75,
    body: { len: 0.95, w: 0.9, h: 0.9 }, headSize: 1.0, neckLen: 0.06,
    beak: 'cone', beakLen: 0.18, legLen: 0.42, tail: 'forked', wingSpan: 0.95,
    markings: 'sparrow',
    palette: { body: '#8d9298', wings: '#a4502e', belly: '#d8d3c4', head: '#6e4a2c', beak: '#2b2b30', legs: '#c8a890', eyes: '#1c1c1c', accent: '#f2f2ee' },
    baby: { palette: { body: '#b0a695', wings: '#9a8a74' }, noMarkings: true },
  },
  chickadee: {
    label: 'Chickadee', set: 'classic', emoji: '🖤', size: 0.65,
    body: { len: 0.85, w: 0.95, h: 0.95 }, headSize: 1.15, neckLen: 0.04,
    beak: 'cone', beakLen: 0.13, legLen: 0.36, tail: 'long', wingSpan: 0.9,
    markings: 'chickadee',
    palette: { body: '#aeb4ba', wings: '#82888f', belly: '#f2eccd', head: '#f2f2ee', beak: '#2b2b2b', legs: '#5d5d62', eyes: '#1c1c1c', accent: '#26262a' },
    baby: { palette: { body: '#c4c8cc', belly: '#f6f2dd' } },
  },

  // ---------- exotic ----------
  flamingo: {
    label: 'Flamingo', set: 'exotic', emoji: '🦩', size: 1.35,
    body: { len: 1.05, w: 0.85, h: 0.9 }, headSize: 0.7, neckLen: 1.5, neckCurve: true,
    beak: 'hook', beakLen: 0.4, legLen: 1.6, tail: 'fan', wingSpan: 1.0,
    palette: { body: '#f0879f', wings: '#ee7691', belly: '#f8b4c4', head: '#f0879f', beak: '#22262c', legs: '#f0b0bc', eyes: '#caa84e', accent: '#1d1d22' },
    baby: { palette: { body: '#d8d3d0', wings: '#c8c2be', belly: '#e8e4e0', head: '#d8d3d0', beak: '#4a4a50', legs: '#9a9298' } },
  },
  penguin: {
    label: 'Penguin', set: 'exotic', emoji: '🐧', size: 1.1,
    body: { len: 0.9, w: 1.05, h: 1.5 }, upright: true, headSize: 0.85, neckLen: 0.0,
    beak: 'long', beakLen: 0.28, legLen: 0.18, tail: 'pin', wingSpan: 0.7, flipper: true,
    markings: 'penguin',
    palette: { body: '#22242c', wings: '#22242c', belly: '#f4f6f2', head: '#16181e', beak: '#3a3c44', legs: '#26262c', eyes: '#caa84e', accent: '#f2d13a' },
    baby: { palette: { body: '#9aa0a8', wings: '#9aa0a8', belly: '#e8eaec', head: '#22242c' } },
  },
  dodo: {
    label: 'Dodo', set: 'exotic', emoji: '🪿', size: 1.25,
    body: { len: 1.3, w: 1.3, h: 1.2 }, headSize: 0.95, neckLen: 0.4,
    beak: 'hook', beakLen: 0.48, legLen: 0.55, tail: 'puff', wingSpan: 0.55, flightless: true,
    palette: { body: '#6e5a3c', wings: '#46392b', belly: '#e8e0c8', head: '#3a322a', beak: '#7a98b8', legs: '#8d9298', eyes: '#caa84e', accent: '#caa84e' },
    baby: { palette: { body: '#9a8a6e', wings: '#7a6c54', head: '#5d5244' } },
  },
  peacock: {
    label: 'Peacock', set: 'exotic', emoji: '🦚', size: 1.2,
    body: { len: 1.05, w: 0.9, h: 0.95 }, headSize: 0.8, neckLen: 0.7,
    beak: 'cone', beakLen: 0.2, legLen: 0.7, tail: 'peacock', wingSpan: 0.9, crest: 'plume',
    markings: 'peacock',
    palette: { body: '#1f6ab8', wings: '#b0bcc0', belly: '#1d5d34', head: '#1f6ab8', beak: '#b8aa98', legs: '#c8b8a4', eyes: '#1c1c1c', accent: '#2a8a5d' },
    baby: { palette: { body: '#c8b88e', wings: '#b0a078', belly: '#e0d4b0', head: '#c8b88e' }, noMarkings: true },
  },
  toucan: {
    label: 'Toucan', set: 'exotic', emoji: '🌈', size: 1.0,
    body: { len: 1.0, w: 0.95, h: 1.0 }, headSize: 1.0, neckLen: 0.1,
    beak: 'big', beakLen: 0.85, legLen: 0.45, tail: 'long', wingSpan: 0.95,
    markings: 'toucan',
    wingTips: false,
    palette: { body: '#1d1f24', wings: '#15161a', belly: '#f4f6f2', head: '#1d1f24', beak: '#f2913a', legs: '#7ab8e8', eyes: '#2455c8', accent: '#e23b3b' },
    baby: { palette: { body: '#46484e', wings: '#3a3c40', beak: '#f2b16a' } },
  },
  parrot: {
    label: 'Parrot', set: 'exotic', emoji: '🦜', size: 0.95,
    body: { len: 1.0, w: 0.9, h: 1.0 }, headSize: 1.0, neckLen: 0.1,
    beak: 'hook', beakLen: 0.3, legLen: 0.45, tail: 'long', wingSpan: 1.05,
    markings: 'macaw',
    tailSlot: 'body',
    palette: { body: '#e8231d', wings: '#2455c8', belly: '#e8443c', head: '#e8231d', beak: '#e8e0d0', legs: '#6e6258', eyes: '#f2d23a', accent: '#f2d23a' },
    baby: { palette: { body: '#f08a86', wings: '#7a9ad8', belly: '#f4aaa6', head: '#f08a86' }, noMarkings: true },
  },

  // ---------- raptors ----------
  eagle: {
    label: 'Eagle', set: 'raptor', emoji: '🦅', size: 1.5,
    body: { len: 1.2, w: 1.05, h: 1.05 }, headSize: 0.95, neckLen: 0.2,
    beak: 'hook', beakLen: 0.34, legLen: 0.55, tail: 'fan', wingSpan: 1.6,
    tailSlot: 'accent',
    wingTips: false,
    palette: { body: '#26211c', wings: '#1d1916', belly: '#2c2620', head: '#f4f4f0', beak: '#f2b13a', legs: '#f2c23a', eyes: '#f2d23a', accent: '#f4f4f0' },
    baby: { palette: { body: '#f4f6f6', wings: '#e8ecee', belly: '#fafcfc', head: '#f4f6f6', beak: '#6e7a8d' } },
  },
  falcon: {
    label: 'Falcon', set: 'raptor', emoji: '💨', size: 1.15,
    body: { len: 1.05, w: 0.85, h: 0.9 }, headSize: 0.9, neckLen: 0.12,
    beak: 'hook', beakLen: 0.22, legLen: 0.5, tail: 'long', wingSpan: 1.45,
    markings: 'falcon',
    wingTips: false,
    palette: { body: '#2c3a55', wings: '#212c42', belly: '#e8e8e0', head: '#1d2536', beak: '#f2d23a', legs: '#f2c23a', eyes: '#2b2b2b', accent: '#f4f4f0' },
    baby: { palette: { body: '#d8dce0', wings: '#c4cad2', belly: '#eef0f2', head: '#d8dce0' }, noMarkings: true },
  },
  raven: {
    label: 'Raven', set: 'raptor', emoji: '🌑', size: 1.15,
    body: { len: 1.15, w: 0.95, h: 1.0 }, headSize: 1.0, neckLen: 0.22,
    beak: 'long', beakLen: 0.44, legLen: 0.5, tail: 'fan', wingSpan: 1.3,
    palette: { body: '#16181f', wings: '#101218', belly: '#1d2029', head: '#16181f', beak: '#262d3f', legs: '#2c2f3a', eyes: '#caa84e', accent: '#2c3242' },
    baby: { palette: { body: '#46484e', wings: '#3a3c42', belly: '#5a5d64', head: '#46484e' } },
  },
  vulture: {
    label: 'Vulture', set: 'raptor', emoji: '🪶', size: 1.4,
    body: { len: 1.25, w: 1.1, h: 1.05 }, headSize: 0.7, neckLen: 0.55, ruff: true,
    beak: 'hook', beakLen: 0.34, legLen: 0.55, tail: 'fan', wingSpan: 1.6,
    palette: { body: '#b89a6e', wings: '#8d6b48', belly: '#e8dcc0', head: '#d89a96', beak: '#e8e0c8', legs: '#b8b0a0', eyes: '#2b2b2b', accent: '#1d1d22' },
    baby: { palette: { body: '#e0d8c4', wings: '#c8bca0', head: '#e0b4b0' } },
  },

  // ---------- mythical ----------
  phoenix: {
    label: 'Phoenix', set: 'mythical', emoji: '🔥', size: 1.5,
    body: { len: 1.15, w: 0.95, h: 1.0 }, headSize: 0.95, neckLen: 0.55,
    beak: 'cone', beakLen: 0.28, legLen: 0.6, tail: 'streamer', wingSpan: 1.55, crest: 'flame',
    markings: 'phoenix',
    extras: ['embers', 'emissive'],
    palette: { body: '#f5231a', wings: '#f23a1d', belly: '#f2c43a', head: '#f5231a', beak: '#f2d23a', legs: '#8d8d92', eyes: '#1d1d22', accent: '#f8d23a' },
    baby: { palette: { body: '#f0666e', wings: '#e8443c', belly: '#f4a0a6', head: '#f0666e', legs: '#8d6b54' }, noMarkings: true },
  },
  griffin: {
    label: 'Griffin', set: 'mythical', emoji: '🦁', size: 1.7,
    body: { len: 1.45, w: 1.05, h: 1.05 }, headSize: 1.0, neckLen: 0.2,
    beak: 'hook', beakLen: 0.36, legLen: 0.7, tail: 'lion', wingSpan: 1.6, crest: 'ears',
    plan: 'quad', legsFront: 'talon', legsRear: 'paw',
    markings: 'griffin',
    palette: { body: '#f2f2ee', wings: '#c89058', belly: '#f2efe6', head: '#f2f2ee', beak: '#f2913a', legs: '#6e4a30', eyes: '#f2913a', accent: '#f2c23a' },
    baby: { palette: { body: '#c2cad6', wings: '#aeb8c6', belly: '#e8ecf0', head: '#c2cad6', beak: '#5d6470', legs: '#9aa4b2', accent: '#8d96a4' }, noMarkings: true },
  },
  cockatrice: {
    label: 'Cockatrice', set: 'mythical', emoji: '🐲', size: 1.45,
    body: { len: 1.2, w: 1.0, h: 1.05 }, headSize: 0.95, neckLen: 0.35,
    beak: 'hook', beakLen: 0.3, legLen: 0.6, tail: 'spikes', wingSpan: 1.6,
    crest: 'comb', wattle: true, mane: true, eyeKind: 'slit',
    extras: ['membraneWings'],
    markings: 'cockatrice',
    palette: { body: '#5d8a3c', wings: '#6aa83c', belly: '#cfe0b8', head: '#8d5d34', beak: '#f2c23a', legs: '#d8c25a', eyes: '#4ad03c', accent: '#e23b3b' },
    baby: { palette: { body: '#7aa44e', wings: '#8db85a', belly: '#dae8c4', head: '#e8d8a8', beak: '#f2913a' }, noMarkings: true },
  },
  peryton: {
    label: 'Peryton', set: 'mythical', emoji: '🦌', size: 1.75,
    body: { len: 1.5, w: 0.95, h: 1.0 }, headSize: 0.9, neckLen: 0.55,
    beak: 'cone', beakLen: 0.24, legLen: 0.85, tail: 'train', wingSpan: 1.5, crest: 'deerEars',
    plan: 'quad', legsFront: 'hoof', legsRear: 'talon', antlers: true,
    markings: 'peryton',
    tailSlot: 'accent',
    wingTips: false,
    palette: { body: '#8d6b48', wings: '#9a7858', belly: '#d8c2a4', head: '#f2f2ee', beak: '#b8b4ac', legs: '#8d9298', eyes: '#4a9ad8', accent: '#26262e' },
    baby: { palette: { body: '#a4845e', wings: '#b09070', belly: '#e4d2b8', accent: '#f2efe6' }, noMarkings: false },
  },
};

export const COLOR_SLOTS = ['body', 'wings', 'belly', 'head', 'beak', 'legs', 'eyes', 'accent'];

// breeds removed in v3 — old saves migrate to their replacements
export const BREED_MIGRATIONS = { wyvern: 'peryton', shadoweagle: 'cockatrice' };

export function defaultColors(breedId, stage = 'adult') {
  const b = BREEDS[breedId] || BREEDS.robin;
  if (stage === 'baby' && b.baby?.palette) return { ...b.palette, ...b.baby.palette };
  return { ...b.palette };
}
