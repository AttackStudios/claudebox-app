// Brooktown RP — town layout, shared by the client (renders + collides) and the
// server (only uses SPAWN + CARS; movement is client-authoritative).

export const SPAWN = { x: 0, y: 0, z: 20 };
export const GROUND = 320;   // half-extent of the grass plane

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
];

// buildings. kind 'house' = hollow enterable shell (door gap you walk through);
// kind 'block' = solid landmark. door side faces the nearest road.
const H = (x, z, color, door = 'south', rot = 0) => ({ kind: 'house', x, z, w: 14, d: 12, h: 5.5, color, door, rot });
export const BUILDINGS = [
  // ---- landmarks (solid) ----
  { kind: 'block', x: -54, z: -50, w: 40, d: 24, h: 11, color: '#d9b88a', roof: '#8a5a3a', label: '🏫 School' },
  { kind: 'block', x: 54, z: -50, w: 32, d: 24, h: 13, color: '#eef2f7', roof: '#c74b4b', label: '🏥 Hospital' },
  { kind: 'block', x: 56, z: 52, w: 26, d: 20, h: 10, color: '#6f7c92', roof: '#2f3a52', label: '🚓 Police' },
  { kind: 'block', x: -56, z: 52, w: 38, d: 16, h: 8.5, color: '#e8a24c', roof: '#7a3f1c', label: '🛒 Market' },
  { kind: 'block', x: 66, z: -14, w: 18, d: 14, h: 6, color: '#e2e6ec', roof: '#3a86c0', label: '⛽ Gas' },
  { kind: 'block', x: 0, z: -74, w: 22, d: 16, h: 9, color: '#c98ae0', roof: '#5a2f7a', label: '🍔 Diner' },
  // ---- houses (enterable) ----
  H(-24, -24, '#e7cfa6', 'south'), H(24, -24, '#bcd6b0', 'south'),
  H(-24, 26, '#d6b0c8', 'north'), H(24, 26, '#a9c4e0', 'north'),
  H(-78, 22, '#e0c090', 'east'), H(78, 22, '#c0d0a0', 'west'),
  H(-78, -22, '#cbb0e0', 'east'), H(78, -22, '#e0b0b0', 'west'),
];

// roads (flat asphalt quads, no collision) — {x,z,w,d}
export const ROADS = [
  { x: 0, z: 0, w: 300, d: 16 },   // main E-W
  { x: 0, z: 0, w: 16, d: 300 },   // main N-S
  { x: 0, z: -50, w: 200, d: 12 },
  { x: 0, z: 52, w: 200, d: 12 },
  { x: -60, z: 0, w: 12, d: 200 },
  { x: 60, z: 0, w: 12, d: 200 },
];
