'use strict';
// ClaudeBox desktop - preload script.
//
// Runs in every renderer BEFORE any page script, isolated from the page
// (contextIsolation: true, nodeIntegration: false, sandbox: false so that
// contextBridge / ipcRenderer are available here).
//
// CONTRACT 2 (web <-> desktop):
//   a) window.ClaudeBoxDesktop = { version, platform, serverUrl } on pages of the
//      configured server origin. The web app also detects the desktop app through
//      navigator.userAgent.includes('ClaudeBoxDesktop') (see main.js).
//   b) Seed localStorage['claudebox.settings'] ONCE: if robloxUI is undefined set
//      robloxUI: true (and theme: 'light' if theme is undefined). Never override a
//      value the user already set. Only on pages of the configured server origin.

const { contextBridge, ipcRenderer } = require('electron');

const SETTINGS_KEY = 'claudebox.settings';

const info = getDesktopInfo();
const pageOrigin = safeOrigin(window.location.href);
const isServerPage = Boolean(info.serverUrl) && pageOrigin === info.serverUrl;
const isBundledPage = window.location.protocol === 'file:';

if (isServerPage) {
  // 2a - desktop bridge for the web app.
  contextBridge.exposeInMainWorld('ClaudeBoxDesktop', {
    version: info.version,
    platform: process.platform,
    serverUrl: info.serverUrl,
  });

  // 2b - seed the "Roblox-true UI" setting so the desktop app has it on by default.
  seedSettings();
} else if (isBundledPage) {
  // Bundled pages only (offline.html, server-prompt.html): tiny internal bridge.
  contextBridge.exposeInMainWorld('ClaudeBoxDesktopInternal', {
    version: info.version,
    serverUrl: info.serverUrl,
    retry: () => ipcRenderer.send('claudebox:retry'),
    setServer: (url) => ipcRenderer.invoke('claudebox:set-server', String(url ?? '')),
    closePrompt: () => ipcRenderer.send('claudebox:close-prompt'),
  });
}

function seedSettings() {
  try {
    let settings = {};
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
    }
    if (settings.robloxUI === undefined) {
      settings.robloxUI = true;
      if (settings.theme === undefined) settings.theme = 'light';
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch (err) {
    // Storage may be unavailable or hold something unexpected - never break the page.
    console.warn('[ClaudeBoxDesktop] could not seed settings:', err && err.message);
  }
}

function getDesktopInfo() {
  try {
    const res = ipcRenderer.sendSync('claudebox:get-desktop-info');
    if (res && typeof res === 'object') return { version: String(res.version || ''), serverUrl: String(res.serverUrl || '') };
  } catch {
    // fall through
  }
  return { version: 'unknown', serverUrl: '' };
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
