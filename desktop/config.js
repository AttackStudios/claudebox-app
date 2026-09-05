'use strict';
// ClaudeBox desktop - server URL configuration.
//
// CONTRACT 3: the chosen server URL is persisted as JSON in
//   <app.getPath('userData')>/config.json   e.g. ~/Library/Application Support/ClaudeBox/config.json
// and defaults to the ClaudeBox Cloud instance.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULT_SERVER_URL = 'https://claudebox-app.onrender.com';
const LOCAL_SERVER_URL = 'http://localhost:8787';

// The presets offered in the Server menu.
const SERVER_PRESETS = [
  { label: 'ClaudeBox Cloud (claudebox-app.onrender.com)', url: DEFAULT_SERVER_URL },
  { label: 'Local server (http://localhost:8787)', url: LOCAL_SERVER_URL },
];

function filePath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Turn user input ("localhost:8787", "https://my-box.example.com/hub", ...) into a
// bare origin ("http://localhost:8787"). Returns null when it is not an http(s) URL.
function normalizeServerUrl(input) {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // No scheme given: localhost / raw IPs / explicit ports are almost always plain
    // http dev servers, anything else is assumed to be https.
    const hostPart = text.split('/')[0];
    const looksLocal = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(hostPart) || /:\d+$/.test(hostPart);
    text = (looksLocal ? 'http://' : 'https://') + text;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url.origin;
}

function readFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Returns { serverUrl, ...anything else stored }. serverUrl is always a valid origin.
function load() {
  const stored = readFile();
  const serverUrl = normalizeServerUrl(stored.serverUrl) || DEFAULT_SERVER_URL;
  return { ...stored, serverUrl };
}

// Merge `patch` into the stored config and write it back (best effort).
function save(patch) {
  const next = { ...readFile(), ...patch };
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('[claudebox] could not save config:', err.message);
  }
  return next;
}

module.exports = { DEFAULT_SERVER_URL, LOCAL_SERVER_URL, SERVER_PRESETS, filePath, normalizeServerUrl, load, save };
