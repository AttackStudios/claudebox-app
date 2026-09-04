'use strict';
// ClaudeBox desktop - application menu (standard macOS menus + the "Server" menu).

const { Menu, app } = require('electron');

/**
 * Build and install the application menu.
 * @param {object} opts
 * @param {string} opts.serverUrl            current server origin
 * @param {{label:string,url:string}[]} opts.presets
 * @param {(url:string)=>void} opts.onSelectServer   preset picked
 * @param {()=>void} opts.onCustomServer     "Custom server..." picked
 * @param {()=>void} opts.onReconnect        reload the server home page
 * @param {()=>void} opts.onOpenInBrowser    open the current page in the system browser
 */
function installMenu(opts) {
  const { serverUrl, presets, onSelectServer, onCustomServer, onReconnect, onOpenInBrowser } = opts;
  const isMac = process.platform === 'darwin';
  const usingPreset = presets.some((p) => p.url === serverUrl);

  // CONTRACT 3: Server menu. Switching reloads the main window on the new origin.
  const serverMenu = {
    label: 'Server',
    submenu: [
      ...presets.map((p) => ({
        label: p.label,
        type: 'radio',
        checked: p.url === serverUrl,
        click: () => onSelectServer(p.url),
      })),
      {
        label: usingPreset ? 'Custom server…' : `Custom server… (${serverUrl})`,
        type: 'radio',
        checked: !usingPreset,
        click: () => onCustomServer(),
      },
      { type: 'separator' },
      { label: 'Reconnect', click: () => onReconnect() },
      { label: 'Open in Browser', click: () => onOpenInBrowser() },
    ],
  };

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    serverMenu,
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
          : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [{ label: 'Open in Browser', click: () => onOpenInBrowser() }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installMenu };
