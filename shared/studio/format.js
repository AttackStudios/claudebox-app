// ClaudeBox Studio — shared level format + behavior catalog.
// A level is a generic list of primitive PARTS with transforms, colour, a
// collision flag, and attached BEHAVIORS (triggers). The Studio editor produces
// it; the runtime (and, later, individual games) consume it. Game-agnostic.

export const SHAPES = ['box', 'ramp', 'cylinder', 'sphere'];
// special part KINDS (Junior Guards additions — usable by any game that understands them):
//   solid — a normal part · water — swimmable volume, makes you wet
//   sand  — textured sand with a real heightmap, not a flat plane
//   flag  — a premade flag: color = fabric, color2 = pole/handle
//   text  — floating text panel showing `text`
export const KINDS = ['solid', 'water', 'sand', 'flag', 'text'];
export const TEXTURES = ['none', 'wood', 'stripes', 'brick', 'dots', 'sand'];

// Behaviors split into:
//   cont  — animate the part every frame (movers, spinners)
//   touch — fire when the player overlaps the part's volume
export const BEHAVIORS = {
  spin:       { label: 'Spin',          cont: true,  emoji: '🌀', params: { axis: 'y', speed: 2 } },
  move:       { label: 'Move (platform)', cont: true, emoji: '↔️', params: { axis: 'x', dist: 5, speed: 1 } },
  trampoline: { label: 'Trampoline',    touch: true, emoji: '🟦', params: { power: 17 } },
  launch:     { label: 'Launch pad',    touch: true, emoji: '🚀', params: { fx: 0, fy: 18, fz: 16 } },
  kill:       { label: 'Kill / reset',  touch: true, emoji: '💀', params: {} },
  checkpoint: { label: 'Checkpoint',    touch: true, emoji: '🚩', params: {} },
  finish:     { label: 'Finish (win)',  touch: true, emoji: '🏁', params: {} },
  teleport:   { label: 'Teleport',      touch: true, emoji: '🌀', params: { tx: 0, ty: 4, tz: 0 } },
  speed:      { label: 'Speed pad',     touch: true, emoji: '⚡', params: { mult: 1.8, secs: 3 } },
  message:    { label: 'Message',       touch: true, emoji: '💬', params: { text: 'Hello!' } },
  // Prompts the player to spend ClaudeBox Bits (🔷). On purchase it grants a
  // timed speed boost (set mult:1 to sell a pure message/flex). Charges real
  // Bits when the level is played from the Playground; free in editor test-play.
  buy:        { label: 'Buy (spend Bits)', touch: true, emoji: '🔷', params: { price: 5, item: 'a speed boost', mult: 2, secs: 6, msg: 'Zoom! ⚡' } },
  // ---- Junior Guards triggers ----
  jgspawn:    { label: 'JG: Game spawn point', touch: false, emoji: '🏖️', params: {} },
  jgsit:      { label: 'JG: Sit spot',         touch: true,  emoji: '🪑', params: {} },
  jgshelter:  { label: 'JG: Rain shelter',     touch: false, emoji: '⛱️', params: {} },
};

export const PALETTE = [
  { shape: 'box', label: 'Platform', emoji: '🟦', size: [6, 1, 6], color: '#5bbf3a' },
  { shape: 'box', label: 'Wall', emoji: '🧱', size: [6, 4, 1], color: '#9a6844' },
  { shape: 'ramp', label: 'Ramp', emoji: '🛝', size: [6, 3, 4], color: '#f2c20c' },
  { shape: 'cylinder', label: 'Pillar', emoji: '🛢️', size: [2, 4, 2], color: '#2f7fd6' },
  { shape: 'sphere', label: 'Ball', emoji: '⚪', size: [3, 3, 3], color: '#e8478c' },
  { shape: 'box', label: 'Water', emoji: '💧', size: [12, 2, 12], color: '#2e9ad6', kind: 'water' },
  { shape: 'box', label: 'Sand', emoji: '🏖️', size: [16, 1, 16], color: '#e8d29a', kind: 'sand' },
  { shape: 'box', label: 'Flag', emoji: '🚩', size: [0.4, 4, 0.4], color: '#e33d3d', color2: '#8a6844', kind: 'flag' },
  { shape: 'box', label: 'Text', emoji: '🔤', size: [6, 1.6, 0.2], color: '#ffffff', kind: 'text', text: 'Hello beach!' },
];

let _id = 0;
export const newId = () => 'p' + (Date.now().toString(36)) + (_id++).toString(36);

export function newPart(over = {}) {
  return {
    id: newId(),
    shape: 'box',
    pos: [0, 0.5, 0],
    size: [6, 1, 6],
    rotY: 0,
    color: '#5bbf3a',
    color2: '#8a6844',
    kind: 'solid',
    texture: 'none',
    text: '',
    group: '',          // parts sharing a group id move/select as one object
    solid: true,
    behaviors: [],
    ...over,
  };
}

const clampNum = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clampColor = (c, d) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);

export function sanitizeLevel(l = {}) {
  const parts = Array.isArray(l.parts) ? l.parts.slice(0, 2000).map(sanitizePart) : [];
  const sp = l.spawn || {};
  return {
    name: (typeof l.name === 'string' ? l.name : 'Untitled').slice(0, 60),
    sky: clampColor(l.sky, '#8fd6f2'),
    spawn: { x: clampNum(sp.x, 0), y: clampNum(sp.y, 4), z: clampNum(sp.z, 0) },
    parts,
  };
}

function sanitizePart(p = {}) {
  const size = Array.isArray(p.size) ? p.size : [6, 1, 6];
  const pos = Array.isArray(p.pos) ? p.pos : [0, 0.5, 0];
  return {
    id: typeof p.id === 'string' ? p.id : newId(),
    shape: SHAPES.includes(p.shape) ? p.shape : 'box',
    pos: [clampNum(pos[0], 0), clampNum(pos[1], 0.5), clampNum(pos[2], 0)],
    size: [Math.max(0.1, clampNum(size[0], 6)), Math.max(0.1, clampNum(size[1], 1)), Math.max(0.1, clampNum(size[2], 6))],
    rotY: clampNum(p.rotY, 0),
    color: clampColor(p.color, '#5bbf3a'),
    color2: clampColor(p.color2, '#8a6844'),
    kind: KINDS.includes(p.kind) ? p.kind : 'solid',
    texture: TEXTURES.includes(p.texture) ? p.texture : 'none',
    text: (typeof p.text === 'string' ? p.text : '').slice(0, 80),
    group: (typeof p.group === 'string' ? p.group : '').slice(0, 24),
    solid: p.solid !== false,
    behaviors: Array.isArray(p.behaviors) ? p.behaviors.filter((b) => BEHAVIORS[b?.type]).slice(0, 12).map(sanitizeBehavior) : [],
  };
}

function sanitizeBehavior(b) {
  const def = BEHAVIORS[b.type];
  const out = { type: b.type };
  for (const [k, dv] of Object.entries(def.params)) {
    const v = b[k];
    if (typeof dv === 'number') out[k] = clampNum(v, dv);
    else if (typeof dv === 'string') out[k] = (typeof v === 'string' ? v : dv).slice(0, 120);
    else out[k] = v ?? dv;
  }
  return out;
}

// a small starter so a blank slug still has something to stand on
export function starterLevel() {
  return sanitizeLevel({
    name: 'Starter',
    spawn: { x: 0, y: 4, z: 0 },
    parts: [
      newPart({ shape: 'box', pos: [0, 0, 0], size: [14, 1, 14], color: '#5bbf3a' }),
      newPart({ shape: 'box', pos: [16, 0, 0], size: [6, 1, 6], color: '#2f7fd6' }),
      newPart({ shape: 'box', pos: [16, 1.4, 0], size: [5, 0.6, 5], color: '#16324f', behaviors: [{ type: 'trampoline', power: 17 }] }),
      newPart({ shape: 'box', pos: [30, 0, 0], size: [8, 1, 8], color: '#a6d94b', behaviors: [{ type: 'finish' }] }),
    ],
  });
}
