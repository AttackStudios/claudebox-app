// Import Roblox Studio place files (.rbxlx — the XML "Save As…" format) as
// ClaudeBox Studio levels. Your own Parts / Wedges / Cylinders / Balls become
// studio primitives (position, yaw, size, colour, collision) and a
// SpawnLocation becomes the level spawn. Things with no equivalent here —
// Scripts, MeshParts, Unions, Terrain — are counted and skipped, and full 3D
// tilts flatten to their yaw (the studio format only rotates about Y).

import { newId } from '/shared/studio/format.js';

const PART_CLASSES = new Set(['Part', 'WedgePart', 'CornerWedgePart', 'SpawnLocation', 'TrussPart', 'Seat']);
const SKIP_CLASSES = new Set(['MeshPart', 'UnionOperation', 'Terrain', 'Script', 'LocalScript', 'ModuleScript']);

export function parseRbxlx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.tagName !== 'roblox') {
    throw new Error('not a .rbxlx file');
  }
  const parts = [];
  let spawn = null;
  const stats = { imported: 0, skipped: 0, flattened: 0, truncated: 0 };

  for (const item of doc.querySelectorAll('Item')) {
    const cls = item.getAttribute('class');
    if (SKIP_CLASSES.has(cls)) { stats.skipped++; continue; }
    if (!PART_CLASSES.has(cls)) continue;
    const p = readProps(item);
    if (!p.cf) continue;
    if ((p.transparency ?? 0) >= 0.98) continue;

    const size = p.size || [4, 1, 2];
    // yaw from the top row of the rotation matrix; a real 3D tilt gets flattened
    const yaw = Math.atan2(p.cf.r[2], p.cf.r[0]);
    if (tilted(p.cf.r)) stats.flattened++;

    let shape = 'box';
    let sz = [size[0], size[1], size[2]];
    let rotY = yaw;

    if (cls === 'Part' && p.shape === 0) {                    // Ball
      shape = 'sphere';
      sz = [size[0], size[0], size[0]];
    } else if (cls === 'Part' && p.shape === 2) {             // Cylinder (axis = local X)
      const axis = dominantAxis(p.cf.r);                      // where local X points in the world
      if (axis === 'y') { shape = 'cylinder'; sz = [size[1], size[0], size[1]]; }   // upright pillar
      // lying cylinders keep box proportions — the closest yaw-only stand-in
    } else if (cls === 'WedgePart' || cls === 'CornerWedgePart') {
      // Roblox wedges slope along Z; studio ramps slope along X — swap + quarter turn
      shape = 'ramp';
      sz = [size[2], size[1], size[0]];
      rotY = yaw + Math.PI / 2;
    }

    const part = {
      id: newId(),
      shape,
      pos: [round(p.cf.x), round(p.cf.y), round(p.cf.z)],
      size: [round(Math.max(0.1, sz[0])), round(Math.max(0.1, sz[1])), round(Math.max(0.1, sz[2]))],
      rotY: round(rotY),
      color: p.color || (cls === 'SpawnLocation' ? '#b8b8b8' : '#9a9a9a'),
      solid: p.canCollide !== false,
      behaviors: [],
    };
    if (cls === 'SpawnLocation') {
      spawn = { x: part.pos[0], y: part.pos[1] + size[1] / 2 + 1, z: part.pos[2] };
    }
    parts.push(part);
  }

  if (parts.length > 2000) { stats.truncated = parts.length - 2000; parts.length = 2000; }
  stats.imported = parts.length;
  if (!parts.length) throw new Error('no importable parts');

  if (!spawn) {   // no SpawnLocation — spawn above the middle of the build
    let sx = 0, sz2 = 0, top = -Infinity;
    for (const p of parts) { sx += p.pos[0]; sz2 += p.pos[2]; top = Math.max(top, p.pos[1] + p.size[1] / 2); }
    spawn = { x: round(sx / parts.length), y: round(top + 2), z: round(sz2 / parts.length) };
  }

  return { level: { name: 'Imported place', sky: '#8fd6f2', spawn, parts }, stats };
}

// ---- property soup ----
function readProps(item) {
  const out = {};
  const props = item.querySelector(':scope > Properties');
  if (!props) return out;
  for (const el of props.children) {
    const name = el.getAttribute('name');
    if ((el.tagName === 'CoordinateFrame' || el.tagName === 'CFrame') && name === 'CFrame') {
      const n = (t) => parseFloat(el.querySelector(t)?.textContent) || 0;
      out.cf = {
        x: n('X'), y: n('Y'), z: n('Z'),
        r: [n('R00'), n('R01'), n('R02'), n('R10'), n('R11'), n('R12'), n('R20'), n('R21'), n('R22')],
      };
    } else if (el.tagName === 'Vector3' && (name === 'size' || name === 'Size')) {
      out.size = ['X', 'Y', 'Z'].map((t) => parseFloat(el.querySelector(t)?.textContent) || 1);
    } else if (el.tagName === 'Color3uint8' && name === 'Color3uint8') {
      const v = parseInt(el.textContent, 10) >>> 0;
      out.color = '#' + ((v >> 16) & 255).toString(16).padStart(2, '0')
        + ((v >> 8) & 255).toString(16).padStart(2, '0')
        + (v & 255).toString(16).padStart(2, '0');
    } else if (el.tagName === 'token' && name === 'shape') {
      out.shape = parseInt(el.textContent, 10);
    } else if (el.tagName === 'bool' && name === 'CanCollide') {
      out.canCollide = el.textContent.trim() === 'true';
    } else if (el.tagName === 'float' && name === 'Transparency') {
      out.transparency = parseFloat(el.textContent) || 0;
    }
  }
  return out;
}

// does the rotation do more than spin about Y?
function tilted(r) {
  return Math.abs(r[4] - 1) > 0.02;   // R11 = 1 for pure yaw
}

// which world axis the part's local X axis mostly points along
function dominantAxis(r) {
  const ax = Math.abs(r[0]), ay = Math.abs(r[3]), az = Math.abs(r[6]);
  return ay >= ax && ay >= az ? 'y' : az >= ax ? 'z' : 'x';
}

const round = (v) => Math.round(v * 100) / 100;
