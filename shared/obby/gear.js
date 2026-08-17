// Obby gear — the shop, in the tradition of classic obby power-ups.
//
// Everything here is bought once with ClaudeBux and kept forever. Purchases are
// validated and stored server-side (see /api/obby/gear) so ownership can't be
// faked from the client. Gear is a convenience, never a requirement: every
// stage is beatable with nothing equipped.

export const GEAR = [
  {
    id: 'speed', name: 'Speed Coil', emoji: '🌀', price: 20,
    blurb: 'Run noticeably faster while held.',
    slot: 'hold', mult: 1.55,
  },
  {
    id: 'gravity', name: 'Gravity Coil', emoji: '🪀', price: 35,
    blurb: 'Low gravity — float down slowly and jump far higher.',
    slot: 'hold', gravity: 0.42, jump: 1.35,
  },
  {
    id: 'carpet', name: 'Magic Carpet', emoji: '🧞', price: 60,
    blurb: 'Deploy a carpet you can stand on and fly across gaps.',
    slot: 'deploy', flySpeed: 21, life: 14, cooldown: 22,   // scaled with the Roblox tempo
  },
  {
    id: 'jump', name: 'Double Jump', emoji: '🦘', price: 30,
    blurb: 'One extra jump in mid-air, every time you leave the ground.',
    slot: 'passive',
  },
  {
    id: 'skip', name: 'Stage Skip', emoji: '⏭️', price: 45,
    blurb: 'Warp to the next checkpoint. Two-minute cooldown.',
    slot: 'use', cooldown: 120,
  },
  {
    id: 'trail', name: 'Rainbow Trail', emoji: '🌈', price: 15,
    blurb: 'Leave a bright ribbon behind you. Purely for show.',
    slot: 'passive',
  },
];

export const GEAR_BY_ID = Object.fromEntries(GEAR.map((g) => [g.id, g]));
export const isGear = (id) => !!GEAR_BY_ID[id];
