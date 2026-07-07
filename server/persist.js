// Optional cloud persistence for the data/ directory.
//
// ClaudeBox normally stores everything as JSON files under data/ (platform.json,
// saves.json, levels/*.json). That's perfect on a home server, but free cloud
// hosts have an EPHEMERAL disk — files vanish when the instance restarts. So
// when this app runs in the cloud we mirror data/ to a free cloud database
// (Upstash Redis, via its REST API — no npm dependency, no credit card):
//
//   • restore()   — on boot, download the saved files back into data/
//   • startSync() — every 15s (and on shutdown) upload any changed files
//
// It activates ONLY when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are
// set (the cloud host provides them). Locally those are unset, so this whole
// module is a no-op and the game keeps using plain files exactly as before.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.CLAUDEBOX_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const cloudEnabled = !!(REST_URL && REST_TOKEN);

const FILE_KEY = (rel) => 'cbx:file:' + rel;
const MANIFEST_KEY = 'cbx:manifest';

async function redis(cmd) {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}: ${(await res.text()).slice(0, 140)}`);
  return (await res.json()).result;
}

// every file under data/, as posix-relative paths (skip temp write files)
function listDataFiles(dir = DATA_DIR, base = DATA_DIR) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.endsWith('.tmp')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listDataFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

// ---- boot: cloud -> data/ ----
export async function restore() {
  if (!cloudEnabled) return;
  try {
    const manifestRaw = await redis(['GET', MANIFEST_KEY]);
    if (!manifestRaw) { console.log('[persist] Upstash connected — no snapshot yet, starting fresh'); return; }
    const files = JSON.parse(manifestRaw);
    let n = 0;
    for (const rel of files) {
      const content = await redis(['GET', FILE_KEY(rel)]);
      if (content == null) continue;
      const dest = path.join(DATA_DIR, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
      n++;
      lastMtime.set(rel, safeMtime(dest)); // don't immediately re-upload what we just restored
    }
    console.log(`[persist] restored ${n} file(s) from Upstash`);
  } catch (e) {
    console.error('[persist] restore failed (starting fresh):', e.message);
  }
}

// ---- runtime: data/ -> cloud ----
const lastMtime = new Map();
function safeMtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

async function syncUp() {
  if (!cloudEnabled) return;
  try {
    const files = listDataFiles();
    let changed = 0;
    for (const rel of files) {
      const full = path.join(DATA_DIR, rel);
      const m = safeMtime(full);
      if (lastMtime.get(rel) === m) continue; // unchanged since last upload
      const content = fs.readFileSync(full, 'utf8');
      await redis(['SET', FILE_KEY(rel), content]);
      lastMtime.set(rel, m);
      changed++;
    }
    if (changed) await redis(['SET', MANIFEST_KEY, JSON.stringify(files)]);
    return changed;
  } catch (e) {
    console.error('[persist] sync failed:', e.message);
  }
}

let started = false;
export function startSync() {
  if (!cloudEnabled || started) return;
  started = true;
  console.log('[persist] cloud persistence ON (Upstash) — data/ mirrors to the cloud DB');
  const iv = setInterval(syncUp, 15000);
  iv.unref?.();
  // flush the latest data before the host stops/redeploys us
  const flush = async () => { try { await syncUp(); } catch {} process.exit(0); };
  process.on('SIGTERM', flush);
  process.on('SIGINT', flush);
}
