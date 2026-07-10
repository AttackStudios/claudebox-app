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
export const POINTS = { name: 'Credits', one: 'Credit', emoji: '⭐' };   // earned from challenges (was Stars)
export const CURRENCY = { name: 'ClaudeBux', one: 'ClaudeBux', emoji: '🔷' };   // the spendable premium currency (was Bits)

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

  // Rivals
  { id: 'rivals-elim',   game: 'rivals',          emoji: '🎯', title: 'First Blood',        hint: 'Get your first elimination in Rivals.', stars: 80 },
  { id: 'rivals-win',    game: 'rivals',          emoji: '🏆', title: 'Duel Champion',      hint: 'Win a Rivals duel (first to 5).',       stars: 200 },
  { id: 'rivals-slide',  game: 'rivals',          emoji: '🛷', title: 'Slick Moves',        hint: 'Slide by sprinting and then crouching.', stars: 40 },

  // Restaurant Simulator 2
  { id: 'rs-serve',      game: 'restaurant-sim-2',emoji: '🍔', title: 'Order Up!',          hint: 'Serve your first dish.',                stars: 70 },

  // Studio
  { id: 'studio-publish',game: 'studio',          emoji: '🛠️', title: 'Level Designer',     hint: 'Save a level in ClaudeBox Studio.',     stars: 60 },

  // Elemental Tycoon
  { id: 'tycoon-power',  game: 'tycoon',          emoji: '🔥', title: 'Awakened',           hint: 'Unlock your first elemental power.',    stars: 60 },
  { id: 'tycoon-elim',   game: 'tycoon',          emoji: '⚔️', title: 'Elemental Duelist',  hint: 'Defeat another player in the arena.',   stars: 120 },
  { id: 'tycoon-max',    game: 'tycoon',          emoji: '🌟', title: 'Grand Elementalist', hint: 'Unlock all five elemental powers.',     stars: 250 },
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

// =================== AVATAR SHOP (cosmetics) ===================
// Premium avatar cosmetics bought with Bits. `slot` is the avatar profile key
// the item equips into; `value` is the clothing id from avatar3d.js CLOTHING.
// Once bought the id lands in u.ownedAvatar and can be equipped on the avatar.
// `cat` drives the Store category sidebar; `featured` items headline the shop.
const A = (id, cat, slot, value, emoji, label, price, featured = false) =>
  ({ id, cat, slot, value, emoji, label, price, featured });
export const AVATAR_SHOP = [
  // ---- Hats ----
  A('av-hat-football', 'Hats', 'hat', 'football', '🏈', 'Golden Football Helmet', 80, true),
  A('av-hat-crown',    'Hats', 'hat', 'crown',    '👑', 'Royal Crown',            60, true),
  A('av-hat-halo',     'Hats', 'hat', 'halo',     '😇', 'Angel Halo',             50),
  A('av-hat-pirate',   'Hats', 'hat', 'pirate',   '🏴‍☠️', 'Pirate Hat',           45, true),
  A('av-hat-wizard',   'Hats', 'hat', 'wizard',   '🧙', 'Wizard Hat',             35),
  A('av-hat-horns',    'Hats', 'hat', 'horns',    '😈', 'Devil Horns',            30),
  A('av-hat-flower',   'Hats', 'hat', 'flower',   '🌸', 'Flower Crown',           30),
  A('av-hat-propeller','Hats', 'hat', 'propeller','🚁', 'Propeller Cap',          25),
  A('av-hat-cowboy',   'Hats', 'hat', 'cowboy',   '🤠', 'Cowboy Hat',             25),
  A('av-hat-tophat',   'Hats', 'hat', 'tophat',   '🎩', 'Top Hat',                25),
  A('av-hat-chef',     'Hats', 'hat', 'chef',     '👨‍🍳', 'Chef Hat',             20),
  A('av-hat-headphones','Hats','hat', 'headphones','🎧', 'Gold Headphones',        20, true),
  A('av-hat-party',    'Hats', 'hat', 'party',    '🥳', 'Party Hat',              15),
  A('av-hat-bandana',  'Hats', 'hat', 'bandana',  '🏴', 'Bandana',                15),
  // ---- Faces ----
  A('av-face-monocle', 'Faces', 'face2', 'monocle', '🧐', 'Fancy Monocle',        30),
  A('av-face-mask',    'Faces', 'face2', 'mask',    '😷', 'Ninja Mask',           25),
  A('av-face-eyepatch','Faces', 'face2', 'eyepatch','🏴‍☠️', 'Pirate Eyepatch',    25),
  A('av-face-shades',  'Faces', 'face2', 'shades',  '🕶️', 'Cool Shades',          20, true),
  A('av-face-threed',  'Faces', 'face2', 'threed',  '🤓', '3D Glasses',           15),
  // ---- Back ----
  A('av-back-angel',   'Back', 'back', 'angelwings', '👼', 'Angel Wings',         80, true),
  A('av-back-wings',   'Back', 'back', 'wings',      '🦋', 'Butterfly Wings',     45),
  A('av-back-jetpack', 'Back', 'back', 'jetpack',    '🚀', 'Jetpack',             40),
  A('av-back-sword',   'Back', 'back', 'sword',      '🗡️', 'Back Sword',          35),
  A('av-back-cape',    'Back', 'back', 'cape',       '🦸', 'Hero Cape',           30),
  A('av-back-guitar',  'Back', 'back', 'guitar',     '🎸', 'Electric Guitar',     30),
  A('av-back-balloon', 'Back', 'back', 'balloon',    '🎈', 'Balloon',             15),
];
export const AVATAR_SHOP_BY_ID = Object.fromEntries(AVATAR_SHOP.map((s) => [s.id, s]));
export const AVATAR_CATS = ['Featured', 'Hats', 'Faces', 'Back'];
