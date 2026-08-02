// Junior Guards Simulator 🏖️ — shared config (client + server).
// An original ClaudeBox game: Capitola-style junior lifeguards beach RP.

export const JG = {
  wsPath: '/jg-ws',
  snapshotHz: 12,
  lobbyRadius: 26,
};

// ---- backpack: what every guard carries ----
// Snacks roll once when the pack is created: meatstick (or RARELY a sandwich),
// fruit snack (or seaweed), and always an apple.
export function rollBackpack(rand = Math.random) {
  return [
    { id: 'wetsuit', name: 'Wetsuit', emoji: '🤿', kind: 'equip' },
    { id: 'towel', name: 'Towel', emoji: '🧻', kind: 'towel' },
    { id: 'hat', name: 'Hat', emoji: '🧢', kind: 'equip' },
    rand() < 0.12
      ? { id: 'sandwich', name: 'Sandwich', emoji: '🥪', kind: 'snack' }
      : { id: 'meatstick', name: 'Meat Stick', emoji: '🥓', kind: 'snack' },
    rand() < 0.5
      ? { id: 'fruitsnack', name: 'Fruit Snack', emoji: '🍇', kind: 'snack' }
      : { id: 'seaweed', name: 'Seaweed', emoji: '🌿', kind: 'snack' },
    { id: 'apple', name: 'Apple', emoji: '🍎', kind: 'snack' },
  ];
}

// ---- the stretch routine (the real Capitola JG warm-up order) ----
// kind: 'reps' alternates poses a/b `reps` times; 'hold' holds one pose.
// ground: true = the body lies down (root pitch + drop to the sand).
export const STRETCHES = [
  { id: 'jacks', name: 'Jumping Jacks', reps: 25, kind: 'reps' },
  { id: 'rlegfwd', name: 'Right Leg Forward', kind: 'hold' },
  { id: 'llegfwd', name: 'Left Leg Forward', kind: 'hold' },
  { id: 'seagull', name: 'Seagull Target', kind: 'hold' },        // downward dog
  { id: 'rlegout', name: 'Right Leg Out', kind: 'hold', ground: true },
  { id: 'llegout', name: 'Left Leg Out', kind: 'hold', ground: true },
  { id: 'butterfly', name: 'Butterfly', kind: 'hold', ground: true },
  { id: 'corpser', name: 'Corpse Hug Right Leg', kind: 'hold', ground: true },
  { id: 'corpsel', name: 'Corpse Hug Left Leg', kind: 'hold', ground: true },
  { id: 'corpse', name: 'Corpse', kind: 'hold', ground: true },
  { id: 'vups', name: 'V-Ups', reps: 25, kind: 'reps', ground: true },
  { id: 'twistups', name: 'Twist-Ups', reps: 25, kind: 'reps', ground: true },
  { id: 'curls', name: 'Stomach Curls', reps: 25, kind: 'reps', ground: true },
  { id: 'vups2', name: 'V-Ups (round 2)', reps: 25, kind: 'reps', ground: true, as: 'vups' },
  { id: 'twistups2', name: 'Twist-Ups (round 2)', reps: 25, kind: 'reps', ground: true, as: 'twistups' },
  { id: 'curls2', name: 'Stomach Curls (round 2)', reps: 25, kind: 'reps', ground: true, as: 'curls' },
  { id: 'cobra', name: 'Cobra', kind: 'hold', ground: true },
  { id: 'pushups1', name: 'Push-Ups (set 1)', reps: 25, kind: 'reps', ground: true, as: 'pushups' },
  { id: 'pushups2', name: 'Push-Ups (set 2)', reps: 25, kind: 'reps', ground: true, as: 'pushups' },
  { id: 'pushups3', name: 'Push-Ups (set 3)', reps: 25, kind: 'reps', ground: true, as: 'pushups' },
];
export const STRETCH_BY_ID = Object.fromEntries(STRETCHES.map((s) => [s.id, s]));

// ---- weather: gloomy Capitola mornings ----
// fog (dense marine layer) → small chance of rain → the sun burns through.
export const WEATHER = {
  fogSecs: [150, 240],     // how long the marine layer lasts
  rainChance: 0.12,        // most mornings it does NOT rain
  rainSecs: [60, 120],
  drySunSecs: 120,         // wet + sun for 2 minutes = dry
};

export function rollWeatherPlan(rand = Math.random) {
  const fog = WEATHER.fogSecs[0] + rand() * (WEATHER.fogSecs[1] - WEATHER.fogSecs[0]);
  const rains = rand() < WEATHER.rainChance;
  const rain = rains ? WEATHER.rainSecs[0] + rand() * (WEATHER.rainSecs[1] - WEATHER.rainSecs[0]) : 0;
  return { fog: Math.round(fog), rain: Math.round(rain) };
}
