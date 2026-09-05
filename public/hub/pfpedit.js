// ClaudeBox profile-picture editor.
//
// A self-contained modal: live preview, three styles (the 3D character's head,
// an emoji preset, or an imported picture), four shapes and a colour. It carries
// its own stylesheet so it looks right in both the classic hub and the
// Roblox-true UI without either of them having to know about it.

import { drawPfp, sanitizePfp, fileToPfpImage, PFP_EMOJI, PFP_COLORS, PFP_SHAPES, DEFAULT_PFP } from './pfp.js';
import { drawAvatarHead } from './avatarModel.js';

let root = null, draft = null, onSave = null, currentUser = null;

const SHAPE_LABEL = { circle: 'Circle', rounded: 'Rounded', square: 'Square', hex: 'Hexagon' };

function styles() {
  if (document.getElementById('pfp-edit-style')) return;
  const st = document.createElement('style');
  st.id = 'pfp-edit-style';
  st.textContent = `
  .pfpe-back { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center;
    background: rgba(8,10,14,.62); padding: 16px; }
  .pfpe-back[hidden] { display: none; }
  .pfpe { width: min(560px, 100%); max-height: min(88vh, 760px); overflow-y: auto;
    background: var(--pfpe-bg); color: var(--pfpe-ink); border: 1px solid var(--pfpe-line);
    border-radius: var(--pfpe-radius); padding: 22px 24px 20px;
    font-family: var(--pfpe-font); box-shadow: 0 24px 70px rgba(0,0,0,.45); }
  /* tokens: classic hub */
  .pfpe-back { --pfpe-bg:#171a21; --pfpe-ink:#f2f4f8; --pfpe-dim:#a7adba;
    --pfpe-line:rgba(255,255,255,.10); --pfpe-chip:rgba(255,255,255,.07);
    --pfpe-chip-on:rgba(255,255,255,.16); --pfpe-accent:var(--accent,#38b6e8);
    --pfpe-accent-ink:#06232e; --pfpe-radius:20px;
    --pfpe-font:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif; }
  /* tokens: Roblox-true UI */
  html[data-ui="roblox"] .pfpe-back { --pfpe-bg:var(--rt-surface-0); --pfpe-ink:var(--rt-ink);
    --pfpe-dim:var(--rt-ink-3); --pfpe-line:var(--rt-shift-200); --pfpe-chip:var(--rt-shift-200);
    --pfpe-chip-on:var(--rt-shift-300); --pfpe-accent:var(--rt-blue); --pfpe-accent-ink:#fff;
    --pfpe-radius:8px; --pfpe-font:var(--rt-font); }

  .pfpe h2 { margin: 0 0 4px; font-size: 22px; font-weight: 800; letter-spacing: -.01em; }
  .pfpe .pfpe-sub { margin: 0 0 18px; font-size: 14px; color: var(--pfpe-dim); }
  .pfpe h3 { margin: 18px 0 9px; font-size: 13px; font-weight: 700; letter-spacing: .04em;
    text-transform: uppercase; color: var(--pfpe-dim); }

  .pfpe-top { display: flex; align-items: center; gap: 18px; }
  .pfpe-preview { width: 108px; height: 108px; flex: none; }
  .pfpe-preview canvas { width: 108px; height: 108px; display: block; }
  .pfpe-styles { display: flex; flex-wrap: wrap; gap: 8px; }
  .pfpe-chip { border: 1px solid transparent; border-radius: 999px; cursor: pointer;
    background: var(--pfpe-chip); color: var(--pfpe-ink); font: 600 14px var(--pfpe-font);
    padding: 9px 16px; }
  .pfpe-chip:hover { background: var(--pfpe-chip-on); }
  .pfpe-chip.on { background: var(--pfpe-accent); color: var(--pfpe-accent-ink); }

  .pfpe-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 8px; }
  .pfpe-emoji { aspect-ratio: 1; display: grid; place-items: center; cursor: pointer;
    border: 2px solid transparent; border-radius: 12px; background: var(--pfpe-chip);
    font-size: 26px; line-height: 1; padding: 0; }
  .pfpe-emoji:hover { background: var(--pfpe-chip-on); }
  .pfpe-emoji.on { border-color: var(--pfpe-accent); background: var(--pfpe-chip-on); }

  .pfpe-swatches { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; }
  .pfpe-sw { width: 34px; height: 34px; border-radius: 50%; cursor: pointer;
    border: 2px solid transparent; box-shadow: 0 0 0 1px var(--pfpe-line); padding: 0; }
  .pfpe-sw.on { border-color: var(--pfpe-ink); box-shadow: 0 0 0 2px var(--pfpe-ink); }
  .pfpe-swatches input[type=color] { width: 34px; height: 34px; padding: 0; cursor: pointer;
    border: 1px solid var(--pfpe-line); border-radius: 50%; background: none; }

  .pfpe-photo { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .pfpe-photo input[type=file] { display: none; }
  .pfpe-note { margin: 8px 0 0; font-size: 13px; color: var(--pfpe-dim); line-height: 1.5; }
  .pfpe-note.bad { color: #ff8b7a; }

  .pfpe-btn { border: 0; border-radius: 10px; cursor: pointer; font: 700 14px var(--pfpe-font);
    padding: 11px 18px; background: var(--pfpe-chip); color: var(--pfpe-ink); }
  .pfpe-btn:hover { background: var(--pfpe-chip-on); }
  .pfpe-btn.primary { background: var(--pfpe-accent); color: var(--pfpe-accent-ink); }
  .pfpe-btn.primary:disabled { opacity: .5; cursor: default; }
  html[data-ui="roblox"] .pfpe-btn { border-radius: 8px; }

  .pfpe-foot { display: flex; gap: 10px; justify-content: flex-end; align-items: center;
    margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--pfpe-line); }
  .pfpe-foot .pfpe-reset { margin-right: auto; background: none; color: var(--pfpe-dim); }
  .pfpe-foot .pfpe-reset:hover { color: var(--pfpe-ink); background: none; text-decoration: underline; }
  .pfpe-hide { display: none; }
  @media (max-width: 520px) {
    .pfpe-top { flex-direction: column; align-items: flex-start; }
    .pfpe { padding: 18px 16px 16px; }
  }`;
  document.head.appendChild(st);
}

function repaint() {
  const cv = root.querySelector('.pfpe-preview canvas');
  drawPfp(cv, { avatar: currentUser.avatar, pfp: draft }, drawAvatarHead);

  root.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === draft.kind));
  root.querySelectorAll('[data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === draft.shape));
  root.querySelectorAll('[data-emoji]').forEach((b) => b.classList.toggle('on', b.dataset.emoji === draft.emoji));
  root.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === draft.bg));
  root.querySelector('.pfpe-emoji-sec').classList.toggle('pfpe-hide', draft.kind !== 'emoji');
  root.querySelector('.pfpe-photo-sec').classList.toggle('pfpe-hide', draft.kind !== 'image');
  root.querySelector('.pfpe-photo-clear').classList.toggle('pfpe-hide', !draft.image);
}

export function openPfpEditor(user, save) {
  styles();
  currentUser = user || {};
  onSave = save;
  draft = sanitizePfp(currentUser.pfp);
  // an untouched profile starts on "My avatar" with no backdrop tint applied
  if (!currentUser.pfp) draft = { ...DEFAULT_PFP };

  if (!root) {
    root = document.createElement('div');
    root.className = 'pfpe-back';
    document.body.appendChild(root);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.hidden) close();
    });
  }
  root.hidden = false;
  root.innerHTML = `
    <div class="pfpe" role="dialog" aria-modal="true" aria-label="Profile picture">
      <h2>Profile picture</h2>
      <p class="pfpe-sub">This is what everyone sees next to your name.</p>

      <div class="pfpe-top">
        <div class="pfpe-preview"><canvas width="216" height="216"></canvas></div>
        <div>
          <h3 style="margin-top:0">Style</h3>
          <div class="pfpe-styles">
            <button class="pfpe-chip" type="button" data-kind="avatar">My avatar</button>
            <button class="pfpe-chip" type="button" data-kind="emoji">Preset</button>
            <button class="pfpe-chip" type="button" data-kind="image">Photo</button>
          </div>
          <h3>Shape</h3>
          <div class="pfpe-styles pfpe-shapes"></div>
        </div>
      </div>

      <div class="pfpe-emoji-sec">
        <h3>Preset</h3>
        <div class="pfpe-grid pfpe-emojis"></div>
      </div>

      <div class="pfpe-photo-sec">
        <h3>Photo</h3>
        <div class="pfpe-photo">
          <button class="pfpe-btn pfpe-pick" type="button">Choose image…</button>
          <button class="pfpe-btn pfpe-photo-clear" type="button">Remove</button>
          <input type="file" accept="image/*" class="pfpe-file">
        </div>
        <p class="pfpe-note">Your picture is shrunk to 256×256 on this device before it is sent.</p>
      </div>

      <h3>Background</h3>
      <div class="pfpe-swatches"></div>

      <div class="pfpe-foot">
        <button class="pfpe-btn pfpe-reset" type="button">Reset to default</button>
        <button class="pfpe-btn pfpe-cancel" type="button">Cancel</button>
        <button class="pfpe-btn primary pfpe-save" type="button">Save</button>
      </div>
    </div>`;

  // shapes
  const shapeHost = root.querySelector('.pfpe-shapes');
  for (const sh of PFP_SHAPES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pfpe-chip'; b.dataset.shape = sh;
    b.textContent = SHAPE_LABEL[sh];
    b.addEventListener('click', () => { draft.shape = sh; repaint(); });
    shapeHost.appendChild(b);
  }
  // emoji presets
  const emojiHost = root.querySelector('.pfpe-emojis');
  for (const e of PFP_EMOJI) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pfpe-emoji'; b.dataset.emoji = e;
    b.textContent = e;
    b.addEventListener('click', () => { draft.emoji = e; draft.kind = 'emoji'; repaint(); });
    emojiHost.appendChild(b);
  }
  // colours
  const swHost = root.querySelector('.pfpe-swatches');
  for (const c of PFP_COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pfpe-sw'; b.dataset.color = c;
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => { draft.bg = c; repaint(); });
    swHost.appendChild(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.value = draft.bg;
  custom.title = 'Custom colour';
  custom.addEventListener('input', () => { draft.bg = custom.value.toLowerCase(); repaint(); });
  swHost.appendChild(custom);

  // style switches
  root.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.kind === 'image' && !draft.image) { root.querySelector('.pfpe-file').click(); return; }
    draft.kind = b.dataset.kind;
    repaint();
  }));

  // photo import
  const file = root.querySelector('.pfpe-file');
  const note = root.querySelector('.pfpe-photo-sec .pfpe-note');
  root.querySelector('.pfpe-pick').addEventListener('click', () => file.click());
  root.querySelector('.pfpe-photo-clear').addEventListener('click', () => {
    draft.image = ''; draft.kind = 'avatar'; file.value = ''; repaint();
  });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    note.classList.remove('bad');
    note.textContent = 'Processing…';
    try {
      draft.image = await fileToPfpImage(f);
      draft.kind = 'image';
      note.textContent = `Ready — ${Math.round(draft.image.length / 1024)} KB.`;
      repaint();
    } catch (err) {
      note.classList.add('bad');
      note.textContent = err.message;
    }
  });

  root.querySelector('.pfpe-cancel').addEventListener('click', close);
  root.querySelector('.pfpe-reset').addEventListener('click', () => { draft = { ...DEFAULT_PFP }; repaint(); });
  root.querySelector('.pfpe-save').addEventListener('click', async () => {
    const btn = root.querySelector('.pfpe-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try { await onSave(sanitizePfp(draft)); close(); }
    catch (e) { btn.disabled = false; btn.textContent = 'Save'; }
  });

  repaint();
}

function close() { if (root) root.hidden = true; }
