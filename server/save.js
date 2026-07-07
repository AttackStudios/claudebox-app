// Debounced JSON persistence. Everything lives in data/saves.json keyed by
// lowercased player name, so anyone rejoining (from any device) gets their
// bird, nest, settings, and flock back.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.CLAUDEBOX_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SAVE_FILE = path.join(DATA_DIR, 'saves.json');

export function loadSaves() {
  try {
    const raw = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    return { players: raw.players || {}, flocks: raw.flocks || {} };
  } catch {
    return { players: {}, flocks: {} };
  }
}

let timer = null;
export function scheduleSave(saves) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = SAVE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(saves, null, 1));
      fs.renameSync(tmp, SAVE_FILE);
    } catch (err) {
      console.error('[save] failed:', err.message);
    }
  }, 1500);
}
