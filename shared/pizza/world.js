// Pizza Works — shared layout + tuning. Imported by BOTH the server
// (validation, NPC sim, order pipeline) and the client (rendering), so the
// two can never drift. A cooperative pizzeria: take orders, build pizzas,
// bake, box, and deliver them around the neighborhood.

export const JOBS = ['cashier', 'chef', 'boxer', 'driver', 'supplier'];
export const JOB_META = {
  cashier:  { emoji: '💁', label: 'Cashier',  hint: 'Take orders from customers at the registers' },
  chef:     { emoji: '👨‍🍳', label: 'Chef',     hint: 'Claim a ticket, add each ingredient, bake it' },
  boxer:    { emoji: '📦', label: 'Boxer',    hint: 'Fold cooked pizzas into delivery boxes' },
  driver:   { emoji: '🚗', label: 'Driver',   hint: 'Drive boxed pizzas to the glowing house' },
  supplier: { emoji: '🚚', label: 'Supplier', hint: 'Carry crates from the truck to refill the bins' },
};

export const TOPPINGS = ['pepperoni', 'mushroom', 'olive', 'pineapple'];
export const TOPPING_COLORS = { pepperoni: '#c0392b', mushroom: '#c8b89a', olive: '#4a5d23', pineapple: '#f2c14a' };

// pay per completed task (goes to whoever did it)
export const PAY = { order: 2, step: 1, bake: 2, box: 3, deliver: 8, supply: 3 };

export const BAKE_SECS = 8;
export const BOX_SECS = 2.5;
export const MAX_ORDERS = 8;
export const CUSTOMER_EVERY = 9;     // seconds between walk-ins (if queue has room)
export const BIN_MAX = 20;

// ---------------- the pizzeria (centered at origin, door faces +z) ----------------
export const SHOP = { x: 0, z: -2, w: 44, d: 28, wallH: 5 };   // building shell

// customer-facing registers (staff stand behind, z-)
export const REGISTERS = [
  { id: 'reg1', x: -5, z: 5.5 },
  { id: 'reg2', x: 5, z: 5.5 },
];
// where customers queue (slot 0 = at the counter)
export const QUEUE_SLOTS = [
  [{ x: -5, z: 8 }, { x: -5, z: 10.5 }, { x: -5, z: 13 }],
  [{ x: 5, z: 8 }, { x: 5, z: 10.5 }, { x: 5, z: 13 }],
];
export const DOOR = { x: 0, z: 12 };                 // front door gap
export const NPC_SPAWN = { x: 0, z: 26 };            // sidewalk spawn, walks in

export const TICKET_BOARD = { x: 0, z: 0.5 };        // chefs claim orders here
export const BINS = [
  { id: 'dough',     x: -16, z: -6,  label: 'Dough',     color: '#e8d5a8' },
  { id: 'sauce',     x: -16, z: -1,  label: 'Sauce',     color: '#c0392b' },
  { id: 'cheese',    x: -16, z: 4,   label: 'Cheese',    color: '#f2c14a' },
  { id: 'pepperoni', x: 16,  z: -6,  label: 'Pepperoni', color: '#c0392b' },
  { id: 'mushroom',  x: 16,  z: -1,  label: 'Mushroom',  color: '#c8b89a' },
  { id: 'olive',     x: 16,  z: 4,   label: 'Olive',     color: '#4a5d23' },
  { id: 'pineapple', x: 20,  z: -1,  label: 'Pineapple', color: '#f2c14a' },
];
export const OVENS = [
  { id: 'oven1', x: -9, z: -13 },
  { id: 'oven2', x: -3, z: -13 },
  { id: 'oven3', x: 3, z: -13 },
  { id: 'oven4', x: 9, z: -13 },
];
export const BOX_BENCH = { x: 14, z: -13 };          // cooked pizzas land here
export const PICKUP_SHELF = { x: 19, z: -10 };       // boxed + ready for drivers
export const JOB_BOARD = { x: -12, z: 9 };           // pick your job
export const SUPPLY_TRUCK = { x: -30, z: -12 };      // crates live here

// ---------------- neighborhood ----------------
export const HOUSES = [
  { id: 'h1', x: -58, z: 38,  color: '#c96b4a', door: 0.5 },
  { id: 'h2', x: -62, z: -8,  color: '#5b8dbe', door: 0 },
  { id: 'h3', x: -46, z: -48, color: '#6aa46a', door: -0.6 },
  { id: 'h4', x: 6,   z: -58, color: '#b08adf', door: 3.14 },
  { id: 'h5', x: 52,  z: -48, color: '#d8a83c', door: 2.6 },
  { id: 'h6', x: 64,  z: -4,  color: '#c96b8f', door: 3.14 },
  { id: 'h7', x: 56,  z: 40,  color: '#7fb3c8', door: -2.6 },
  { id: 'h8', x: 2,   z: 58,  color: '#9a8adf', door: 3.14 },
];

// the delivery loop road (visual + driving guide), plus a spur to the shop
export const ROAD_LOOP = [
  [-48, 28], [-52, -2], [-38, -40], [0, -48], [42, -40], [54, -2], [46, 30], [4, 46], [-48, 28],
];
export const ROAD_W = 7;

export const CARS = [
  { id: 'car1', x: 26, z: 10, ry: 0, color: '#e0503c' },
  { id: 'car2', x: 26, z: 16, ry: 0, color: '#2ec5e0' },
  { id: 'car3', x: 26, z: 22, ry: 0, color: '#59d185' },
];

export const PLAYER_SPAWN = { x: -2, z: 16 };

// what a fresh order looks like: dough → sauce → cheese → 1-2 toppings
export function rollOrder(rand = Math.random) {
  const steps = ['dough', 'sauce', 'cheese'];
  const t1 = TOPPINGS[Math.floor(rand() * TOPPINGS.length)];
  steps.push(t1);
  if (rand() < 0.45) {
    let t2 = TOPPINGS[Math.floor(rand() * TOPPINGS.length)];
    if (t2 === t1) t2 = TOPPINGS[(TOPPINGS.indexOf(t1) + 1) % TOPPINGS.length];
    steps.push(t2);
  }
  return steps;
}

export const NPC_NAMES = ['Marge', 'Stu', 'Poppy', 'Gus', 'Winnie', 'Alfie', 'Dot', 'Bruno', 'Hazel', 'Milo'];
