// Elemental Tycoon — shared config: plots, elements/powers, and the unlock tree.
// The server uses PLOTS (assign a plot per player), ELEMENTS (PvP projectile
// stats), and BUTTONS (validate unlocks); the client renders everything.

export const GROUND = 260;
export const CENTER = { x: 0, z: 0 };   // PvP battle area

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

// Unlock tree on each plot. `income` buttons raise your cash-per-orb; `power`
// buttons unlock an element you can then use in PvP.
export const BUTTONS = [
  { id: 'drop2', label: 'Dropper II',    emoji: '⚙️', cost: 60,   kind: 'income', income: 3 },
  { id: 'fire',  label: 'Fire Power',    emoji: '🔥', cost: 120,  kind: 'power', element: 'fire' },
  { id: 'water', label: 'Water Power',   emoji: '💧', cost: 260,  kind: 'power', element: 'water' },
  { id: 'drop3', label: 'Dropper III',   emoji: '⚙️', cost: 420,  kind: 'income', income: 8 },
  { id: 'earth', label: 'Earth Power',   emoji: '🪨', cost: 560,  kind: 'power', element: 'earth' },
  { id: 'drop4', label: 'Dropper IV',    emoji: '⚙️', cost: 900,  kind: 'income', income: 18 },
  { id: 'air',   label: 'Air Power',     emoji: '💨', cost: 1200, kind: 'power', element: 'air' },
  { id: 'light', label: 'Lightning',     emoji: '⚡', cost: 2000, kind: 'power', element: 'lightning' },
];
export const BUTTON_BY_ID = Object.fromEntries(BUTTONS.map((b) => [b.id, b]));

export const BASE_INCOME = 1;      // cash per orb at the start
export const DROP_INTERVAL = 1.1;  // seconds between orbs
export const MAX_HP = 100;
export const RESPAWN = 3;           // seconds
