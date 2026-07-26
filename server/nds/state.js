// Natural Disaster Survival — server state.
let seq = 0;
export const genId = (p = 'p') => `${p}${(++seq).toString(36)}${Math.floor(perfNow() % 1e6).toString(36)}`;
function perfNow() { try { return performance.now(); } catch { return 0; } }

export const state = {
  players: new Map(),      // id -> player
  phase: 'intermission',   // intermission | warning | disaster | aftermath
  phaseUntil: 0,
  round: 0,
  disasters: [],           // active disaster param objects this round
  stacks: 0,               // extra disasters queued by the Multi-Disaster Machine
  seed: 1,
};
export const nowSec = () => Date.now() / 1000;
