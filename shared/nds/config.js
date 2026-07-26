// Natural Disaster Survival — shared tuning (client render + server logic agree).
// Original implementation; disasters recreate real-world phenomena as gameplay.

export const WORLD = {
  islandRadius: 34,      // grass circle radius
  islandY: 0,            // grass top height
  waterY: -1.4,          // water surface (touch = die)
  lobbyGap: 200,         // lobby sits far from the island (own little sky area)
};

export const ROUND = {
  intermission: 14,      // hang out in the lobby
  warning: 6,            // disaster announced, everyone teleported to the island
  disaster: 26,          // survive!
  aftermath: 6,          // rewards + back to lobby
  reward: { stars: 2, cubes: 1 },   // per survived disaster
  machineCost: 5,        // ClaudeBux to stack an extra disaster next round
};

// Each disaster: an original mechanic modelled on the real phenomenon.
export const DISASTERS = {
  tornado:  { id: 'tornado',  name: 'Tornado',        emoji: '🌪️', color: '#8a8f98', warn: 'A tornado is forming!' },
  flood:    { id: 'flood',    name: 'Flood',          emoji: '🌊', color: '#2f7fd0', warn: 'Flood waters are rising!' },
  meteors:  { id: 'meteors',  name: 'Meteor Shower',  emoji: '☄️', color: '#ff6a2a', warn: 'Meteors incoming!' },
  quake:    { id: 'quake',    name: 'Earthquake',     emoji: '🌎', color: '#7a5a3a', warn: 'The ground is shaking!' },
  tsunami:  { id: 'tsunami',  name: 'Tsunami',        emoji: '🌊', color: '#1f6fb0', warn: 'A tsunami approaches!' },
  wildfire: { id: 'wildfire', name: 'Wildfire',       emoji: '🔥', color: '#ff4d1a', warn: 'Wildfire is spreading!' },
  blizzard: { id: 'blizzard', name: 'Blizzard',       emoji: '❄️', color: '#bfe4ff', warn: 'A blizzard rolls in!' },
  volcano:  { id: 'volcano',  name: 'Volcano',        emoji: '🌋', color: '#e03a10', warn: 'The volcano erupts!' },
  acid:     { id: 'acid',     name: 'Acid Rain',      emoji: '🧪', color: '#7de04a', warn: 'Acid rain falls!' },
};
export const DISASTER_IDS = Object.keys(DISASTERS);

// ---- MAPS: the island the round is played on. Same survival DNA (grass-or-
// terrain disc ringed by deadly water), each with its own theme + high ground
// (climb these to beat floods/tsunamis). Feature positions are fixed so every
// client + the server build an identical island. ----
export const MAPS = {
  grassy: {
    id: 'grassy', name: 'Grassy Isle', radius: 34,
    ground: '#54c46e', ground2: '#3fae5a', beach: '#d8c98a', rock: '#8f9aa6', capCol: '#54c46e',
    sky: ['#7db9ec', '#dcecf8'], water: '#2f7fd0', fog: '#9fc4e8',
    features: [
      { t: 'rock', x: 0, z: -15, r: 4.5, h: 7.5 }, { t: 'rock', x: 15, z: 9, r: 4, h: 6 },
      { t: 'rock', x: -15, z: 11, r: 4, h: 8.5 }, { t: 'rock', x: 21, z: -11, r: 3.5, h: 5 },
      { t: 'rock', x: -21, z: -13, r: 3.5, h: 6.5 }, { t: 'rock', x: 8, z: 21, r: 3.5, h: 5.5 },
      { t: 'rock', x: -7, z: 23, r: 3, h: 4.5 }, { t: 'tree', x: 10, z: -5, r: 1, h: 5 }, { t: 'tree', x: -11, z: -2, r: 1, h: 6 },
    ],
  },
  desert: {
    id: 'desert', name: 'Desert Mesa', radius: 37,
    ground: '#dcb878', ground2: '#c9a860', beach: '#efe0b4', rock: '#b8823c', capCol: '#c99a52',
    sky: ['#e6bd7a', '#f6ecce'], water: '#2f8fc8', fog: '#e6cfa0',
    features: [
      { t: 'mesa', x: 0, z: 0, r: 9, h: 9.5 }, { t: 'mesa', x: -19, z: -15, r: 6.5, h: 6 },
      { t: 'mesa', x: 19, z: 15, r: 6.5, h: 7 }, { t: 'rock', x: 17, z: -18, r: 3, h: 4 },
      { t: 'rock', x: -17, z: 18, r: 3, h: 4.5 }, { t: 'rock', x: 0, z: 26, r: 3.5, h: 5 },
      { t: 'cactus', x: 9, z: -9, r: 1, h: 4 }, { t: 'cactus', x: -10, z: 8, r: 1, h: 3.5 },
    ],
  },
  frozen: {
    id: 'frozen', name: 'Frozen Peak', radius: 33,
    ground: '#e9f1f7', ground2: '#d3e4f0', beach: '#cfe0ee', rock: '#b6d4ea', capCol: '#f4fbff',
    sky: ['#a9c8e0', '#eaf3fa'], water: '#3a86c0', fog: '#dbe8f2',
    features: [
      { t: 'peak', x: 0, z: 0, r: 10, h: 17 }, { t: 'ledge', x: 8, z: 8, r: 3, h: 5.5 },
      { t: 'ledge', x: -9, z: 6, r: 3, h: 8.5 }, { t: 'ledge', x: 5, z: -10, r: 3, h: 6.5 },
      { t: 'rock', x: 17, z: -12, r: 3, h: 4 }, { t: 'rock', x: -17, z: -14, r: 3, h: 5 },
      { t: 'rock', x: 15, z: 17, r: 3, h: 4.5 }, { t: 'tree', x: -13, z: 13, r: 1, h: 5 },
    ],
  },
  volcanic: {
    id: 'volcanic', name: 'Ashen Crater', radius: 34,
    ground: '#4a4048', ground2: '#39303a', beach: '#5c4c44', rock: '#2b2228', capCol: '#6a3020',
    sky: ['#7a4a4a', '#c89890'], water: '#3a4450', fog: '#8a6a68',
    features: [
      { t: 'crater', x: 0, z: 0, r: 11, h: 6.5 }, { t: 'column', x: -17, z: -10, r: 2.6, h: 9 },
      { t: 'column', x: 17, z: 10, r: 2.6, h: 10.5 }, { t: 'column', x: 12, z: -17, r: 2.6, h: 7.5 },
      { t: 'column', x: -14, z: 15, r: 2.6, h: 8.5 }, { t: 'rock', x: 23, z: 0, r: 3, h: 5 },
      { t: 'rock', x: -23, z: 2, r: 3, h: 5.5 },
    ],
  },
};
export const MAP_IDS = Object.keys(MAPS);
