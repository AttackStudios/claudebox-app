'use strict';
// ClaudeBox desktop - Electron main process.
//
// Wraps the ClaudeBox web app (ClaudeBox Cloud or a self-hosted server) in a
// native macOS window. Plain CommonJS, no frameworks.
//
// CONTRACT with the web app (see README.md):
//   1. The user agent carries " ClaudeBoxDesktop/<version>" on every request.
//   2. preload.js exposes window.ClaudeBoxDesktop and seeds the `claudebox.settings`
//      localStorage entry (robloxUI: true) once, on server-origin pages.
//   3. The server URL is switchable from the Server menu and persisted in
//      <userData>/config.json (see config.js).

const { app, BrowserWindow, session, shell, ipcMain, systemPreferences } = require('electron');
const path = require('node:path');
const pkg = require('./package.json');
const config = require('./config');
const { installMenu } = require('./menu');

const VERSION = pkg.version;
const UA_TOKEN = `ClaudeBoxDesktop/${VERSION}`;
const PRELOAD = path.join(__dirname, 'preload.js');

// Permissions games need: microphone for voice calls (media), pointer lock, fullscreen,
// notifications, clipboard read. Sanitized clipboard write (Cmd+C-equivalent) is added
// so "copy invite code" style buttons work. Everything else is denied.
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'pointerLock',
  'fullscreen',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
]);

app.name = 'ClaudeBox'; // also fixes the userData folder name (~/Library/Application Support/ClaudeBox)

// ---- CONTRACT 1: user agent ------------------------------------------------------
// app.userAgentFallback is the UA every session uses unless overridden; append our
// token to the default Chromium UA (defaultSession.setUserAgent below makes sure).
if (!app.userAgentFallback.includes(UA_TOKEN)) {
  app.userAgentFallback = `${app.userAgentFallback} ${UA_TOKEN}`;
}
const USER_AGENT = app.userAgentFallback;

// Games: let music/sfx start without a prior click, like a native game would.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const state = {
  serverUrl: config.DEFAULT_SERVER_URL, // always a bare origin, e.g. https://claudebox-app.onrender.com
  persisted: true,                       // false when overridden by --server= / CLAUDEBOX_SERVER
};
let mainWindow = null;
let promptWindow = null;
let lastCrashReload = 0;

// ---- single instance -------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusMainWindow());
  app.on('web-contents-created', (_event, contents) => attachNavigationPolicy(contents));
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (mainWindow) focusMainWindow();
    else createMainWindow();
  });
  app.whenReady().then(onReady);
}

async function onReady() {
  resolveInitialServer();

  const ses = session.defaultSession;
  ses.setUserAgent(USER_AGENT); // CONTRACT 1 (belt and braces)
  installPermissionHandlers(ses);
  installIpc();

  app.setAboutPanelOptions({
    applicationName: 'ClaudeBox',
    applicationVersion: VERSION,
    version: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    copyright: 'Copyright © 2026 AttackStudio',
  });

  refreshMenu();
  createMainWindow();
}

// Server URL: CLI flag > env var > saved config > default.
function resolveInitialServer() {
  const flag = process.argv.find((a) => a.startsWith('--server='));
  const override = config.normalizeServerUrl(flag ? flag.slice('--server='.length) : process.env.CLAUDEBOX_SERVER);
  if (override) {
    state.serverUrl = override;
    state.persisted = false;
    return;
  }
  state.serverUrl = config.load().serverUrl;
  state.persisted = true;
}

// ---- windows ---------------------------------------------------------------------
function windowWebPreferences() {
  return {
    preload: PRELOAD,           // CONTRACT 2
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,             // preload needs require('electron') for contextBridge / ipcRenderer
    backgroundThrottling: false, // keep games, timers and websockets running when hidden
    spellcheck: false,
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ClaudeBox',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: windowWebPreferences(),
  });

  let shown = false;
  const showOnce = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    mainWindow.show();
  };
  mainWindow.once('ready-to-show', showOnce);
  // A cold cloud instance can take a while to answer; don't leave the user with no window.
  setTimeout(showOnce, 3000);

  const wc = mainWindow.webContents;
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED (navigation superseded / cancelled) - not a connectivity problem.
    if (!isMainFrame || errorCode === -3) return;
    showOfflinePage(validatedURL, errorCode, errorDescription);
  });
  wc.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || details.reason === 'killed') return;
    const now = Date.now();
    if (now - lastCrashReload < 10_000) return; // don't loop on a persistent crash
    lastCrashReload = now;
    loadServer();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  loadServer();
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function loadServer() {
  if (!mainWindow) return;
  // Load failures are reported through did-fail-load (-> offline page).
  mainWindow.loadURL(`${state.serverUrl}/`).catch(() => {});
}

function showOfflinePage(failedUrl, code, reason) {
  if (!mainWindow) return;
  mainWindow
    .loadFile(path.join(__dirname, 'offline.html'), {
      query: { server: state.serverUrl, url: failedUrl || '', code: String(code), reason: reason || '' },
    })
    .catch(() => {});
}

// ---- CONTRACT 3: server switching ------------------------------------------------
function setServer(url) {
  const origin = config.normalizeServerUrl(url);
  if (!origin) return false;
  state.serverUrl = origin;
  state.persisted = true;
  config.save({ serverUrl: origin });
  refreshMenu();
  if (mainWindow) loadServer();
  else createMainWindow();
  return true;
}

function openCustomServerPrompt() {
  if (promptWindow) {
    promptWindow.focus();
    return;
  }
  promptWindow = new BrowserWindow({
    width: 480,
    height: 236,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Custom server',
    backgroundColor: '#ffffff',
    webPreferences: windowWebPreferences(),
  });
  promptWindow.once('ready-to-show', () => promptWindow && promptWindow.show());
  promptWindow.on('closed', () => {
    promptWindow = null;
    refreshMenu(); // restore the radio check if the user cancelled
  });
  promptWindow
    .loadFile(path.join(__dirname, 'server-prompt.html'), { query: { current: state.serverUrl } })
    .catch(() => {});
}

function closePrompt() {
  if (promptWindow) promptWindow.close();
}

function refreshMenu() {
  installMenu({
    serverUrl: state.serverUrl,
    presets: config.SERVER_PRESETS,
    onSelectServer: (url) => setServer(url),
    onCustomServer: () => openCustomServerPrompt(),
    onReconnect: () => (mainWindow ? loadServer() : createMainWindow()),
    onOpenInBrowser: () => {
      const current = mainWindow ? mainWindow.webContents.getURL() : '';
      openExternal(isServerUrl(current) ? current : state.serverUrl);
    },
  });
}

// ---- navigation policy -----------------------------------------------------------
// Stay inside the configured server origin (games are same-origin routes such as
// /games/rivals). Anything else - target=_blank, links to other sites - opens in the
// system browser and is denied in-app.
function attachNavigationPolicy(contents) {
  contents.on('will-navigate', (event, url) => {
    if (isServerUrl(url) || isBundledUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isServerUrl(url)) {
      // Same-origin popup: allow it as a child window with the same policy/preload.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 720,
          minWidth: 700,
          minHeight: 500,
          backgroundColor: '#ffffff',
          webPreferences: windowWebPreferences(),
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
}

function isServerUrl(url) {
  return Boolean(url) && safeOrigin(url) === state.serverUrl;
}

// file:// pages bundled with the app (offline.html, server-prompt.html).
function isBundledUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return false;
    return decodeURIComponent(u.pathname).startsWith(__dirname + path.sep);
  } catch {
    return false;
  }
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function openExternal(url) {
  if (/^(https?|mailto):/i.test(url || '')) shell.openExternal(url).catch(() => {});
}

// ---- permissions -----------------------------------------------------------------
function installPermissionHandlers(ses) {
  ses.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    const origin = safeOrigin((details && details.requestingUrl) || webContents.getURL());
    const allowed = ALLOWED_PERMISSIONS.has(permission) && origin === state.serverUrl;
    if (allowed && permission === 'media' && process.platform === 'darwin') {
      // Trigger the macOS privacy prompt (TCC) the first time a game asks for the mic.
      const types = (details && details.mediaTypes) || [];
      try {
        if (types.includes('audio')) await systemPreferences.askForMediaAccess('microphone');
        if (types.includes('video')) await systemPreferences.askForMediaAccess('camera');
      } catch {
        // fall through - Chromium reports the failure to the page
      }
    }
    callback(allowed);
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && safeOrigin(requestingOrigin) === state.serverUrl;
  });
}

// ---- IPC (used by preload.js) ----------------------------------------------------
function installIpc() {
  // Synchronous so the preload can expose it before any page script runs.
  ipcMain.on('claudebox:get-desktop-info', (event) => {
    event.returnValue = { version: VERSION, serverUrl: state.serverUrl };
  });
  // The following are only exposed to the bundled file:// pages.
  ipcMain.on('claudebox:retry', (event) => {
    if (isBundledSender(event)) loadServer();
  });
  ipcMain.on('claudebox:close-prompt', (event) => {
    if (isBundledSender(event)) closePrompt();
  });
  ipcMain.handle('claudebox:set-server', (event, input) => {
    if (!isBundledSender(event)) return { ok: false, error: 'Not allowed.' };
    const origin = config.normalizeServerUrl(input);
    if (!origin) return { ok: false, error: 'Enter a valid http:// or https:// address.' };
    setServer(origin);
    closePrompt();
    return { ok: true, serverUrl: origin };
  });
}

function isBundledSender(event) {
  const url = (event.senderFrame && event.senderFrame.url) || (event.sender && event.sender.getURL()) || '';
  return isBundledUrl(url);
}
