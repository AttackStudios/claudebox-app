// Settings panel + persistence (device-level prefs in localStorage,
// allowPickup synced to the server too).

import { audio } from '../audio.js';
import { effectiveMode } from '../device.js';

const KEY = 'featherfriends.settings';

export const DEFAULTS = {
  musicVolume: 0.6,
  sfxVolume: 0.8,
  quality: 'high',          // high | low
  shadows: false,
  camSensitivity: 1,
  invertY: false,
  allowPickup: true,
  controlsMode: 'auto',     // auto | mobile | desktop
  mouseCapture: false,      // PC: click captures the cursor (off = hold a button to look)
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function buildSettingsPanel(panel, game, panels) {
  const s = game.settings;
  const h = document.createElement('h2');
  h.textContent = '⚙️ Settings';
  panel.appendChild(h);

  const slider = (label, key, onChange) => {
    const row = panels.row(panel, label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = 0; input.max = 1; input.step = 0.05;
    input.value = s[key];
    input.addEventListener('input', () => {
      s[key] = parseFloat(input.value);
      saveSettings(s);
      onChange?.(s[key]);
    });
    row.appendChild(input);
  };

  slider('🎵 Music', 'musicVolume', (v) => audio.setMusicVolume(v));
  slider('🔔 Sounds', 'sfxVolume', (v) => audio.setSfxVolume(v));

  // camera sensitivity 0.3..2
  {
    const row = panels.row(panel, '🎥 Camera speed');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = 0.3; input.max = 2; input.step = 0.1;
    input.value = s.camSensitivity;
    input.addEventListener('input', () => {
      s.camSensitivity = parseFloat(input.value);
      if (game.orbit) game.orbit.sensitivity = s.camSensitivity;
      saveSettings(s);
    });
    row.appendChild(input);
  }

  const toggle = (label, key, onChange) => {
    const row = panels.row(panel, label);
    row.classList.add('toggle-row');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!s[key];
    input.addEventListener('change', () => {
      s[key] = input.checked;
      saveSettings(s);
      onChange?.(s[key]);
    });
    row.appendChild(input);
  };

  toggle('🔃 Invert camera up/down', 'invertY', (v) => { if (game.orbit) game.orbit.invertY = v; });
  toggle('🤲 Let others pick me up', 'allowPickup', (v) => game.net?.send({ t: 'settings', allowPickup: v }));
  toggle('🖱️ Capture mouse on click (PC)', 'mouseCapture', (v) => { if (!v) game.controls?.unlock?.(); });

  // graphics quality
  {
    const row = panels.row(panel, '✨ Graphics');
    const sel = document.createElement('select');
    for (const [v, label] of [['high', 'Pretty'], ['low', 'Fast']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = s.quality;
    sel.addEventListener('change', () => {
      s.quality = sel.value;
      saveSettings(s);
      game.applyQuality?.();
    });
    row.appendChild(sel);
  }

  // controls override
  {
    const row = panels.row(panel, '🕹️ Controls');
    const sel = document.createElement('select');
    for (const [v, label] of [['auto', 'Auto-detect'], ['mobile', 'Touch'], ['desktop', 'Keyboard + mouse']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = s.controlsMode;
    sel.addEventListener('change', () => {
      s.controlsMode = sel.value;
      saveSettings(s);
      game.applyControlsMode?.(effectiveMode(s.controlsMode));
    });
    row.appendChild(sel);
  }

  {
    const row = panels.row(panel);
    panels.button(row, '⛶ Fullscreen', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    if (game.inWorld) {
      panels.button(row, '🚪 Back to menu', () => location.reload(), 'warn');
      panels.button(row, '🎮 ClaudeBox home', () => { location.href = '/'; });
    }
  }
}
