# ClaudeBox desktop (macOS)

An Electron shell around the ClaudeBox web app. It opens the ClaudeBox server in a
native window (default: `https://claudebox-app.onrender.com`), keeps games running
in the background, and identifies itself to the web app so the "Roblox-true UI" is
switched on by default.

Plain CommonJS, no frameworks:

| File | Purpose |
| --- | --- |
| `main.js` | Main process: window, user agent, navigation/permission policy, offline page, server switching |
| `preload.js` | `window.ClaudeBoxDesktop` bridge + one-time `claudebox.settings` seeding |
| `menu.js` | macOS application menu (App / Edit / View / **Server** / Window / Help) |
| `config.js` | Server URL persistence (`config.json` in the app's user-data folder) |
| `offline.html` | Shown when the server cannot be reached ("Retry") |
| `server-prompt.html` | "Custom server…" dialog |
| `build/icon.png`, `build/icon.icns` | App icon (generated from `public/icons/icon-512.png`) |
| `build/afterPack.js` | Ad-hoc code-signs the packed `.app` so it runs on Apple Silicon |

## Build

```sh
cd desktop
npm install
npm run dist          # = CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --arm64 --x64
```

Artifacts land in `desktop/dist/`:

```
ClaudeBox-1.0.0-arm64.dmg   ClaudeBox-1.0.0-arm64-mac.zip   (Apple Silicon)
ClaudeBox-1.0.0-x64.dmg     ClaudeBox-1.0.0-x64-mac.zip     (Intel)
dist/mac-arm64/ClaudeBox.app, dist/mac/ClaudeBox.app          (unpacked apps)
```

`npm run dist:arm64` / `npm run dist:x64` build one architecture. `npm start` runs
the app from source; `npm run start:local` points it at `http://localhost:8787`.
`CLAUDEBOX_SERVER=<url>` or `--server=<url>` override the server for one launch
without touching the saved config.

The build is unsigned (no signing identity, no notarization, no auto-update /
publish config). `build/afterPack.js` applies an ad-hoc signature so the binary is
allowed to launch on Apple Silicon.

## Contract with the web app

1. **User agent** – every request carries the default Chromium UA plus the token
   ` ClaudeBoxDesktop/<version>` (from `package.json`, e.g. `ClaudeBoxDesktop/1.0.0`).
   The web app detects the desktop app with
   `navigator.userAgent.includes('ClaudeBoxDesktop')`.
2. **Preload bridge** (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`):
   on pages of the configured server origin the preload exposes
   `window.ClaudeBoxDesktop = { version, platform, serverUrl }` and, before any
   page script runs, seeds `localStorage['claudebox.settings']` once: if
   `robloxUI` is `undefined` it becomes `true` (and `theme` becomes `'light'` if
   it was `undefined`). Values the user already set are never overridden.
3. **Server URL** – the app loads the configured server (default
   `https://claudebox-app.onrender.com`). The choice is stored in
   `~/Library/Application Support/ClaudeBox/config.json` (`{"serverUrl": "..."}`).
   The **Server** menu offers *ClaudeBox Cloud*, *Local server (http://localhost:8787)*
   and *Custom server…*; switching reloads the window on the new origin.

Other behaviour:

- Navigation stays inside the server origin. Links to any other site (including
  `target="_blank"`) open in the system browser.
- Permissions granted to the server origin: microphone/camera (`media`), pointer
  lock, fullscreen, notifications, clipboard read (and sanitized clipboard write).
  Everything else is denied. `backgroundThrottling` is off so games keep running.
- If the server cannot be reached the bundled offline page appears with a Retry
  button and a hint to pick another server.

## Installing the unsigned app (Gatekeeper)

The app is not signed with an Apple Developer ID, so on first open macOS may say
*"ClaudeBox" can't be opened because Apple cannot check it for malicious software*
(or "is damaged"). Either:

- open **System Settings → Privacy & Security**, scroll down and click
  **Open Anyway** next to the ClaudeBox message, or
- remove the quarantine flag in Terminal:

  ```sh
  xattr -cr /Applications/ClaudeBox.app
  ```

then launch it again.

## Build notes

### `NODE_OPTIONS=--experimental-require-module`

electron-builder 26.15.3 pulls in `@noble/hashes` v2, which is ESM-only, but its
own `app-builder-lib/out/targets/blockmap/blockmap.js` still `require()`s it. On
Node 22.11 that is a hard `ERR_REQUIRE_ESM` and the build dies before it writes
anything. Node 22.12+ allows `require(esm)` by default; on 22.11 the flag turns
the same behaviour on. It is baked into every `npm run pack|dist*` script here,
so just use those rather than calling `electron-builder` directly.

### Publishing the artifacts

`npm run dist` writes four files to `dist/`, each roughly 125 MB:

| File | For |
|---|---|
| `ClaudeBox-1.0.0-arm64.dmg` | Apple Silicon, disk image |
| `ClaudeBox-1.0.0-arm64.zip` | Apple Silicon, zipped .app |
| `ClaudeBox-1.0.0-x64.dmg`   | Intel, disk image |
| `ClaudeBox-1.0.0-x64.zip`   | Intel, zipped .app |

They are **not** committed — GitHub rejects any file over 100 MB, and they would
bloat the Render image besides. `dist/` is gitignored.

The server's `/download` page asks `/api/downloads` what is available:

* **Locally** it finds `desktop/dist` on disk and serves the files straight from
  there at `/downloads/<file>`. Build once and the page just works.
* **In the cloud** there is no `desktop/dist`, so it falls back to the GitHub
  Release — by default
  `https://github.com/AttackStudios/claudebox-app/releases/latest/download`,
  which always resolves to the newest release. No env var needed. Set
  `CLAUDEBOX_DOWNLOAD_BASE` only to point somewhere else.
* The filenames are derived from the `version` in this `package.json`, so
  cutting a new release means: bump that version, `npm run dist`, then
  `gh release create vX.Y.Z --repo AttackStudios/claudebox-app` and
  `gh release upload vX.Y.Z dist/ClaudeBox-*.dmg dist/ClaudeBox-*.zip`.

### Signing

There is no paid Apple Developer certificate on the build machine, so the app is
**ad-hoc signed** by `build/afterPack.js` (which runs before the dmg/zip are
produced, so the artifacts contain the signed app). Ad-hoc signing is what lets
it run at all on Apple Silicon; Gatekeeper will still show the "unidentified
developer" warning on first launch — see the install steps above.
