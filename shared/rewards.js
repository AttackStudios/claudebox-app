// ClaudeBox universal rewards economy.
//
// Two currencies, both stored on the platform profile so they follow you into
// every game:
//   ⭐ Stars — earned by completing CHALLENGES (one-time each, universal).
//   🧊 Cubes — the ClaudeBox currency (the "Robux"). You mint Cubes from Stars
//              at CUBE_RATE, then spend Cubes in the Shop or inside games.
//
// This module is imported by the server (authoritative) and mirrored to the
// hub UI. Games never import it directly — they just call
// ClaudeBox.completeChallenge('<id>') (see public/js/claudebox.js), and the
// server validates the id and awards the Stars.

// Currency identity, in ONE place so a rename is a one-line change everywhere.
export const POINTS = { name: 'Stars', one: 'Star', emoji: '⭐' };   // earned from challenges
export const CURRENCY = { name: 'Bits', one: 'Bit', emoji: '🔷' };   // the spendable "Robux"

export const CUBE_RATE = 10; // Stars per 1 Bit when converting

// ---- CHALLENGES --------------------------------------------------------
// id must be globally unique. `game` matches a GAMES id. `stars` is the
// one-time reward. `hint` tells the player how to earn it.
export const CHALLENGES = [
  // Backpacking
  { id: 'bp-scare-bear', game: 'backpacking',     emoji: '🐻', title: 'Bear Scare',         hint: 'Scare off a bear with bear spray.',     stars: 150 },
  { id: 'bp-camp',       game: 'backpacking',     emoji: '⛺', title: 'Home Sweet Tent',    hint: 'Set up your first campsite (place a tent).', stars: 50 },
  { id: 'bp-drive',      game: 'backpacking',     emoji: '🚐', title: 'Road Trip',          hint: 'Get behind the wheel of the van.',      stars: 40 },

  // Obby
  { id: 'obby-finish',   game: 'obby',            emoji: '🏁', title: 'Tower Conqueror',    hint: 'Reach the top and beat the tower.',     stars: 200 },
  { id: 'obby-check',    game: 'obby',            emoji: '🚩', title: 'Making Progress',    hint: 'Reach any checkpoint in the Obby.',     stars: 30 },

  // Wibit
  { id: 'wibit-survive', game: 'wibit',           emoji: '🌊', title: 'Last One Splashing', hint: 'Win a Wipeout round.',                  stars: 180 },

  // Restaurant Simulator 2
  { id: 'rs-serve',      game: 'restaurant-sim-2',emoji: '🍔', title: 'Order Up!',          hint: 'Serve your first dish.',                stars: 70 },

  // Studio
  { id: 'studio-publish',game: 'studio',          emoji: '🛠️', title: 'Level Designer',     hint: 'Save a level in ClaudeBox Studio.',     stars: 60 },
];

export const CHALLENGE_BY_ID = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));

// ---- SHOP --------------------------------------------------------------
// Spend Cubes on cosmetics that show up across the platform. `kind` decides
// what it sets on your profile: 'title' → u.title, 'color' → u.nameColor.
// `value` is the text (titles) or CSS colour / 'rainbow' (colours).
export const SHOP = [
  { id: 'title-explorer',  kind: 'title', emoji: '🧭', label: 'Explorer',      value: 'Explorer',      price: 5 },
  { id: 'title-camper',    kind: 'title', emoji: '⛺', label: 'Happy Camper',  value: 'Happy Camper',  price: 10 },
  { id: 'title-bear',      kind: 'title', emoji: '🐻', label: 'Bear Wrestler', value: 'Bear Wrestler', price: 20 },
  { id: 'title-champion',  kind: 'title', emoji: '🏆', label: 'Champion',      value: 'Champion',      price: 40 },
  { id: 'title-legend',    kind: 'title', emoji: '👑', label: 'Legend',        value: 'Legend',        price: 80 },

  { id: 'color-gold',      kind: 'color', emoji: '🟡', label: 'Gold name',     value: '#ffcf5c',       price: 15 },
  { id: 'color-mint',      kind: 'color', emoji: '🟢', label: 'Mint name',     value: '#4ade80',       price: 15 },
  { id: 'color-pink',      kind: 'color', emoji: '🩷', label: 'Pink name',     value: '#ff7eb6',       price: 15 },
  { id: 'color-sky',       kind: 'color', emoji: '🔵', label: 'Sky name',      value: '#5be0ff',       price: 15 },
  { id: 'color-rainbow',   kind: 'color', emoji: '🌈', label: 'Rainbow name',  value: 'rainbow',       price: 60 },
];

export const SHOP_BY_ID = Object.fromEntries(SHOP.map((s) => [s.id, s]));
