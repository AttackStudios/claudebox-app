// Brooktown RP — town layout, shared by the client (renders + collides) and the
// server (only uses SPAWN + CARS; movement is client-authoritative).

export const SPAWN = { x: 0, y: 0, z: 20 };
export const GROUND = 340;   // half-extent of the grass plane

// parked cars — the server tracks driver + transform per id; the client renders.
export const CARS = [
  { id: 'car1', x: -16, z: 30, ry: 0, color: '#e0503c' },
  { id: 'car2', x: 16, z: 30, ry: 0, color: '#3a7bd5' },
  { id: 'car3', x: -30, z: -18, ry: Math.PI / 2, color: '#ffcf5c' },
  { id: 'car4', x: 30, z: -18, ry: -Math.PI / 2, color: '#4ade80' },
  { id: 'car5', x: 62, z: 10, ry: 0, color: '#9b6bff' },
  { id: 'car6', x: -62, z: 10, ry: 0, color: '#ff7eb6' },
  { id: 'car7', x: 0, z: -52, ry: Math.PI, color: '#20c0b0' },
  { id: 'car8', x: -46, z: 52, ry: 0, color: '#ff8a3c' },
  { id: 'car9', x: 46, z: 84, ry: 0, color: '#d94f7a' },
  { id: 'car10', x: -46, z: 84, ry: 0, color: '#5ac0e0' },
  { id: 'car11', x: 110, z: 10, ry: 0, color: '#e0c040' },
  { id: 'car12', x: -110, z: 10, ry: 0, color: '#7a5cff' },
  { id: 'car13', x: 16, z: -84, ry: Math.PI, color: '#40c060' },
  { id: 'car14', x: -16, z: -84, ry: Math.PI, color: '#e05050' },
];

// buildings. kind 'house' = hollow enterable+decoratable shell; kind 'block' =
// solid landmark. door side faces the nearest road.
const H = (x, z, color, door = 'south') => ({ kind: 'house', x, z, w: 14, d: 12, h: 5.5, color, door, roofColor: ['#9c4a3a', '#3a6a9c', '#5a7a3a', '#7a4a7a'][(Math.abs(x + z) / 12 | 0) % 4] });
const B = (x, z, w, d, h, color, roof, label) => ({ kind: 'block', x, z, w, d, h, color, roof, label });
export const BUILDINGS = [
  // ---- landmarks ----
  B(-54, -52, 40, 24, 11, '#d9b88a', '#8a5a3a', '🏫 School'),
  B(54, -52, 32, 24, 13, '#eef2f7', '#c74b4b', '🏥 Hospital'),
  B(56, 54, 26, 20, 10, '#6f7c92', '#2f3a52', '🚓 Police'),
  B(-56, 54, 38, 16, 8.5, '#e8a24c', '#7a3f1c', '🛒 Market'),
  B(66, -14, 18, 14, 6, '#e2e6ec', '#3a86c0', '⛽ Gas'),
  B(0, -76, 22, 16, 9, '#c98ae0', '#5a2f7a', '🍔 Diner'),
  B(-108, -52, 26, 22, 9, '#b8895a', '#5a3a22', '☕ Cafe'),
  B(108, -52, 28, 22, 12, '#cdd6e2', '#43506a', '🏦 Bank'),
  B(-108, 54, 30, 20, 10, '#a8b0bc', '#4a5560', '📚 Library'),
  B(108, 54, 26, 22, 16, '#c8b8a0', '#6a5a44', '🏢 Apartments'),
  B(0, 100, 34, 18, 7, '#7ab0d0', '#3a6a8a', '🎬 Cinema'),
  B(0, -108, 30, 18, 8, '#e0b0b0', '#8a4a4a', '🏋️ Gym'),
  // ---- houses (enterable + decoratable) ----
  H(-24, -24, '#e7cfa6', 'south'), H(24, -24, '#bcd6b0', 'south'),
  H(-24, 26, '#d6b0c8', 'north'), H(24, 26, '#a9c4e0', 'north'),
  H(-78, 22, '#e0c090', 'east'), H(78, 22, '#c0d0a0', 'west'),
  H(-78, -22, '#cbb0e0', 'east'), H(78, -22, '#e0b0b0', 'west'),
  H(-24, 78, '#c0e0c0', 'north'), H(24, 78, '#e0d0a0', 'north'),
  H(-24, -80, '#b0c0e0', 'south'), H(24, -80, '#e0b0c8', 'south'),
  H(-110, 24, '#d0c0a0', 'east'), H(110, 24, '#a0c0d0', 'west'),
  H(-110, -24, '#c8d0b0', 'east'), H(110, -24, '#d0b0c0', 'west'),
];

// roads (flat asphalt quads, no collision) — {x,z,w,d}
export const ROADS = [
  { x: 0, z: 0, w: 320, d: 16 }, { x: 0, z: 0, w: 16, d: 320 },   // mains
  { x: 0, z: -52, w: 260, d: 12 }, { x: 0, z: 52, w: 260, d: 12 },
  { x: 0, z: -104, w: 180, d: 12 }, { x: 0, z: 104, w: 180, d: 12 },
  { x: -60, z: 0, w: 12, d: 260 }, { x: 60, z: 0, w: 12, d: 260 },
  { x: -120, z: 0, w: 12, d: 200 }, { x: 120, z: 0, w: 12, d: 200 },
];
