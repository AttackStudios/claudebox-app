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
