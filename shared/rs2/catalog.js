// Restaurant Simulator 2 — the catalog: buyable items, dishes/recipes,
// staff, and styles. Single source of truth for prices and footprints,
// shared by server validation and (served via welcome) the client UI.

// ---------- furniture / appliances / decor ----------
// footprint w×d in grid cells; rot rotates footprint. station=true items
// perform recipe steps. seatAt = chair anchor offsets for tables.
export const ITEMS = {
  // seating
  table: { label: 'Table', emoji: '🍽️', price: 120, w: 2, d: 2, cat: 'Seating', seats: 2 },
  booth: { label: 'Booth', emoji: '🛋️', price: 320, w: 3, d: 2, cat: 'Seating', seats: 2 },
  chair: { label: 'Chair', emoji: '🪑', price: 35, w: 1, d: 1, cat: 'Seating' },

  // kitchen stations (3 tiers each: price = base × tier multiplier)
  counter: { label: 'Countertop', emoji: '🔪', price: 250, w: 2, d: 1, cat: 'Kitchen', station: 'counter', tiers: [1, 2.4, 5] },
  stove: { label: 'Stove', emoji: '🍳', price: 350, w: 2, d: 1, cat: 'Kitchen', station: 'stove', tiers: [1, 2.4, 5] },
  oven: { label: 'Oven', emoji: '🥧', price: 400, w: 2, d: 1, cat: 'Kitchen', station: 'oven', tiers: [1, 2.4, 5] },
  dispenser: { label: 'Drink dispenser', emoji: '🥤', price: 220, w: 1, d: 1, cat: 'Kitchen', station: 'dispenser', tiers: [1, 2.4, 5] },
  register: { label: 'Counter register', emoji: '🧾', price: 150, w: 2, d: 1, cat: 'Kitchen', pickup: true },

  // decor
  plant: { label: 'Potted plant', emoji: '🪴', price: 60, w: 1, d: 1, cat: 'Decor' },
  painting: { label: 'Painting', emoji: '🖼️', price: 90, w: 1, d: 1, cat: 'Decor', wall: true },
  rug: { label: 'Rug', emoji: '🧶', price: 80, w: 3, d: 2, cat: 'Decor', flat: true },
  lamp: { label: 'Hanging light', emoji: '💡', price: 110, w: 1, d: 1, cat: 'Decor', light: true },
  divider: { label: 'Divider', emoji: '🚪', price: 70, w: 2, d: 1, cat: 'Decor' },
  flowers: { label: 'Table flowers', emoji: '💐', price: 40, w: 1, d: 1, cat: 'Decor' },
};

export const WALL_COLORS = ['#e8dcc8', '#d8b89a', '#b8d2c8', '#c8b8d8', '#e8c8b8', '#9ab8d8', '#d8d8d8', '#b85c4a'];
export const FLOOR_STYLES = ['wood', 'tile', 'checker', 'marble', 'carpet'];

// ---------- staff ----------
export const STAFF = {
  waiter: { label: 'Waiter', emoji: '🤵', price: 350, upgrade: 500, speeds: [1, 1.45] },
  chef: { label: 'Chef', emoji: '👨‍🍳', price: 500, upgrade: 700, speeds: [1, 1.5] },
  delivery: { label: 'Delivery driver', emoji: '🛵', price: 400, upgrade: 550, speeds: [1, 1.4] },
};

// ---------- dishes ----------
// steps: { station, verb, time(s) }. price = customer pays. unlock = one-time
// cash cost to add it to your unlocked list (0 = free from the start).
export const DISHES = {
  water: { label: 'Water', emoji: '💧', price: 3, unlock: 0, steps: [{ station: 'dispenser', verb: 'Pour', time: 1.5 }] },
  soda: { label: 'Soda', emoji: '🥤', price: 5, unlock: 0, steps: [{ station: 'dispenser', verb: 'Pour', time: 2 }] },
  juice: { label: 'Fresh juice', emoji: '🧃', price: 7, unlock: 200, steps: [{ station: 'dispenser', verb: 'Blend', time: 2.5 }] },
  salad: { label: 'Garden salad', emoji: '🥗', price: 8, unlock: 0, steps: [{ station: 'counter', verb: 'Chop', time: 3 }] },
  soup: { label: 'Tomato soup', emoji: '🍲', price: 12, unlock: 0, steps: [{ station: 'counter', verb: 'Chop', time: 2 }, { station: 'stove', verb: 'Simmer', time: 4 }] },
  burger: { label: 'Burger', emoji: '🍔', price: 15, unlock: 0, steps: [{ station: 'stove', verb: 'Grill', time: 4 }, { station: 'counter', verb: 'Assemble', time: 2.5 }] },
  wrap: { label: 'Veggie wrap', emoji: '🌯', price: 13, unlock: 300, steps: [{ station: 'counter', verb: 'Chop', time: 2 }, { station: 'counter', verb: 'Roll', time: 2.5 }] },
  pasta: { label: 'Pasta', emoji: '🍝', price: 16, unlock: 500, steps: [{ station: 'stove', verb: 'Boil', time: 4 }, { station: 'stove', verb: 'Sauce', time: 2.5 }] },
  cookies: { label: 'Cookies', emoji: '🍪', price: 10, unlock: 400, steps: [{ station: 'counter', verb: 'Roll dough', time: 2.5 }, { station: 'oven', verb: 'Bake', time: 5 }] },
  pizza: { label: 'Pizza', emoji: '🍕', price: 20, unlock: 800, steps: [{ station: 'counter', verb: 'Roll dough', time: 3 }, { station: 'oven', verb: 'Bake', time: 6 }] },
  steak: { label: 'Steak dinner', emoji: '🥩', price: 24, unlock: 1200, steps: [{ station: 'stove', verb: 'Sear', time: 5 }, { station: 'counter', verb: 'Plate', time: 2 }] },
  cake: { label: 'Chocolate cake', emoji: '🍰', price: 22, unlock: 1500, steps: [{ station: 'counter', verb: 'Mix batter', time: 3 }, { station: 'oven', verb: 'Bake', time: 7 }] },
};

export const FREE_DISHES = Object.keys(DISHES).filter((d) => DISHES[d].unlock === 0);

// the starter restaurant: 4 tables × 2 chairs + the basic kitchen line
export function templateLayout() {
  let n = 0;
  const id = () => 't' + (n++);
  const items = {};
  const put = (kind, gx, gz, rot = 0, tier = 0) => { items[id()] = { kind, gx, gz, rot, tier }; };
  // dining area (front half): tables with chairs east/west of each
  put('table', 1, 5); put('chair', 0, 5, 1); put('chair', 3, 5, 3);
  put('table', 1, 8); put('chair', 0, 8, 1); put('chair', 3, 8, 3);
  put('table', 8, 5); put('chair', 7, 5, 1); put('chair', 10, 5, 3);
  put('table', 8, 8); put('chair', 7, 8, 1); put('chair', 10, 8, 3);
  // kitchen line along the back wall
  put('counter', 1, 0); put('stove', 4, 0); put('oven', 7, 0); put('dispenser', 10, 0);
  put('register', 5, 2);
  return items;
}

export function tierPrice(kind, tier) {
  const item = ITEMS[kind];
  if (!item) return Infinity;
  const mult = item.tiers ? item.tiers[tier] ?? 1 : 1;
  return Math.round(item.price * mult);
}

export function stationSpeed(tier) {
  return [1, 1.35, 1.8][tier] || 1; // higher tier cooks faster
}
