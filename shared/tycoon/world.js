// Elemental Tycoon — shared config: plots, elements/powers, and the unlock tree.
// The server uses PLOTS (assign a plot per player), ELEMENTS (PvP projectile
// stats), and BUTTONS (validate unlocks); the client renders everything.

export const GROUND = 260;
export const CENTER = { x: 0, z: 0 };   // PvP battle area
export const ARENA_RADIUS = 46;         // you can only be damaged inside this ring; plots are a safe zone

// 8 plots in a ring facing the centre. ry so the plot's front (buttons/machine)
// faces inward toward the arena.
export const PLOTS = (() => {
  const out = [];
  const R = 78, N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    out.push({ i, x, z, ry: Math.atan2(x, z) });   // faces center
  }
  return out;
})();

// The five elemental powers (unlocked via buttons, used in PvP).
export const ELEMENTS = [
  { id: 'fire',      name: 'Fire',      emoji: '🔥', color: '#ff5a2a', dmg: 24, cd: 0.75, speed: 36, life: 1.7, radius: 0.6, kind: 'ball' },
  { id: 'water',     name: 'Water',     emoji: '💧', color: '#3aa0ff', dmg: 15, cd: 0.42, speed: 44, life: 1.4, radius: 0.5, kind: 'ball' },
  { id: 'earth',     name: 'Earth',     emoji: '🪨', color: '#a67c4a', dmg: 34, cd: 1.15, speed: 28, life: 1.9, radius: 0.8, kind: 'rock' },
  { id: 'air',       name: 'Air',       emoji: '💨', color: '#bfeaff', dmg: 12, cd: 0.6,  speed: 52, life: 1.1, radius: 0.7, kind: 'gust', knockback: 14 },
  { id: 'lightning', name: 'Lightning', emoji: '⚡', color: '#ffe14a', dmg: 30, cd: 0.95, speed: 78, life: 1.2, radius: 0.45, kind: 'bolt' },
];
export const ELEMENT_BY_ID = Object.fromEntries(ELEMENTS.map((e) => [e.id, e]));

// The unlock tree is an ORDERED sequence: only the next unbought step is shown,
// and its pad sits at the local (lx,lz) spot on the plot where that thing gets
// built. Buy it → the build appears there → the next step's pad appears.
//   kind 'income' raises cash-per-orb (income = max owned).
//   kind 'speed'  lowers the drop interval (interval = min owned).
//   kind 'power'  unlocks an element you can use in PvP; builds a crystal pedestal.
// Local coords: +Z is the back (dropper/conveyor), -Z is the front (facing the
// arena) where the power pedestals line up.
export const BUTTONS = [
  { id: 'drop2',    kind: 'income', label: 'Dropper II',       emoji: '⚙️', cost: 45,    income: 6,   lx: -7,  lz: 6.5, build: 'dropper' },
  { id: 'fire',     kind: 'power',  label: 'Fire Crystal',     emoji: '🔥', cost: 110,   element: 'fire',      lx: -8, lz: -4, build: 'pedestal' },
  { id: 'drop3',    kind: 'income', label: 'Dropper III',      emoji: '⚙️', cost: 260,   income: 14,  lx: -4,  lz: 7,   build: 'dropper' },
  { id: 'speed1',   kind: 'speed',  label: 'Faster Belt',      emoji: '💨', cost: 480,   interval: 0.75, lx: -1, lz: 7,  build: 'dropper' },
  { id: 'water',    kind: 'power',  label: 'Water Crystal',    emoji: '💧', cost: 800,   element: 'water',     lx: -4, lz: -4, build: 'pedestal' },
  { id: 'drop4',    kind: 'income', label: 'Dropper IV',       emoji: '⚙️', cost: 1300,  income: 34,  lx: 2,   lz: 7,   build: 'dropper' },
  { id: 'collect2', kind: 'income', label: 'Golden Collector', emoji: '🏆', cost: 2100,  income: 52,  lx: 6.6, lz: 6,   build: 'collector' },
  { id: 'earth',    kind: 'power',  label: 'Earth Crystal',    emoji: '🪨', cost: 3200,  element: 'earth',     lx: 0,  lz: -4, build: 'pedestal' },
  { id: 'drop5',    kind: 'income', label: 'Dropper V',        emoji: '⚙️', cost: 5000,  income: 95,  lx: -6,  lz: 5,   build: 'dropper' },
  { id: 'speed2',   kind: 'speed',  label: 'Turbo Belt',       emoji: '💨', cost: 7500,  interval: 0.55, lx: -2, lz: 5,  build: 'dropper' },
  { id: 'air',      kind: 'power',  label: 'Air Crystal',      emoji: '💨', cost: 11000, element: 'air',       lx: 4,  lz: -4, build: 'pedestal' },
  { id: 'drop6',    kind: 'income', label: 'Dropper VI',       emoji: '⚙️', cost: 16000, income: 210, lx: 3,   lz: 5,   build: 'dropper' },
  { id: 'vault',    kind: 'income', label: 'Cash Vault',       emoji: '🏦', cost: 24000, income: 330, lx: 7.5, lz: 4,   build: 'collector' },
  { id: 'lightning',kind: 'power',  label: 'Lightning Crystal',emoji: '⚡', cost: 36000, element: 'lightning', lx: 8,  lz: -4, build: 'pedestal' },
  { id: 'drop7',    kind: 'income', label: 'Dropper VII',      emoji: '⚙️', cost: 55000, income: 540, lx: -8,  lz: 4,   build: 'dropper' },
  { id: 'drop8',    kind: 'income', label: 'Dropper VIII',     emoji: '⚙️', cost: 90000, income: 900, lx: 8,   lz: 2,   build: 'dropper' },
];
export const BUTTON_BY_ID = Object.fromEntries(BUTTONS.map((b) => [b.id, b]));
export const POWER_STEPS = BUTTONS.filter((b) => b.kind === 'power');

// SIDE builds — a parallel construction track that turns your plot into a
// house. Unlike the main track, ALL side builds whose prerequisite (`req`) is
// met show at once, so several buy-pads can be available alongside the main
// upgrade. Each pad sits at (lx,lz); buying it constructs the structure.
export const SIDE_BUILDS = [
  { id: 'path',     label: 'Stone Path',   emoji: '🪨', cost: 120,  req: null,     lx: 3,   lz: -7 },
  { id: 'fence',    label: 'Fence',        emoji: '🚧', cost: 160,  req: null,     lx: 10,  lz: -2 },
  { id: 'garden',   label: 'Garden',       emoji: '🌳', cost: 240,  req: null,     lx: -10, lz: -2 },
  { id: 'lamps',    label: 'Lamp Posts',   emoji: '💡', cost: 360,  req: null,     lx: -10, lz: 7.5 },
  { id: 'walls',    label: 'Walls',        emoji: '🧱', cost: 220,  req: null,     lx: 10,  lz: 1 },
  { id: 'windows',  label: 'Windows',      emoji: '🪟', cost: 300,  req: 'walls',  lx: 10,  lz: -5 },
  { id: 'roof',     label: 'Roof',         emoji: '🏠', cost: 750,  req: 'walls',  lx: 10,  lz: 4.5 },
  { id: 'chimney',  label: 'Chimney',      emoji: '🏭', cost: 500,  req: 'roof',   lx: 6,   lz: 6 },
  { id: 'floor2',   label: 'Second Floor', emoji: '🏢', cost: 1800, req: 'roof',   lx: -10, lz: 4.5 },
  { id: 'walls2',   label: '2F Walls',     emoji: '🧱', cost: 1300, req: 'floor2', lx: -10, lz: 1 },
  { id: 'windows2', label: '2F Windows',   emoji: '🪟', cost: 950,  req: 'walls2', lx: -10, lz: -5 },
  { id: 'balcony',  label: 'Balcony',      emoji: '🛖', cost: 1200, req: 'floor2', lx: -3,  lz: -7 },
  { id: 'roof2',    label: '2F Roof',      emoji: '🏠', cost: 2400, req: 'walls2', lx: -6,  lz: 7.5 },
  { id: 'flag',     label: 'Rooftop Flag', emoji: '🚩', cost: 1500, req: 'roof2',  lx: 0,   lz: 8 },
];
export const SIDE_BY_ID = Object.fromEntries(SIDE_BUILDS.map((b) => [b.id, b]));

export const BASE_INCOME = 3;      // cash per orb at the start
export const DROP_INTERVAL = 0.95; // seconds between orbs (before speed upgrades)
export const START_CASH = 55;
export const MAX_HP = 100;
export const RESPAWN = 3;           // seconds
