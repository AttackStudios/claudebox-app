// ClaudeBox emote wheel.
//
// Hold Left Alt to open it, tap 1–6 to play one, let go to close. Six slots:
// the first four come from whichever animation pack you are wearing, the last
// two are platform staples so the wheel is never half empty.
//
// Which emotes you have is decided ENTIRELY by your equipped animation pack.
// There is no separate emote loadout to manage — swapping packs is how you
// change your emotes, which keeps a pack a single, meaningful choice.

import { loadPack } from '/shared/anim/custom.js';

const NAMES = {
  emote1: 'Wave', emote2: 'Clap', emote3: 'Point', emote4: 'Cheer',
  dance: 'Dance', sit: 'Sit',
};
const ICONS = {
  emote1: '👋', emote2: '👏', emote3: '👉', emote4: '🎉', dance: '🕺', sit: '🪑',
};
// slots 5 and 6 are always these; a pack only ever supplies the first four
const BUILT_IN_TAIL = ['dance', 'sit'];
const SLOTS = ['emote1', 'emote2', 'emote3', 'emote4', ...BUILT_IN_TAIL];

const state = {
  open: false, playing: null, until: 0,
  packName: '', packTitle: '', labels: { ...NAMES },
  getCtrl: null,          // a game hands us its local avatar controller
};

// ---------------------------------------------------------------- style
const css = `
#cbx-wheel { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center;
  background: rgba(6,9,14,.32); backdrop-filter: blur(2px); pointer-events: none;
  opacity: 0; transition: opacity .12s ease; }
#cbx-wheel.on { opacity: 1; }
#cbx-wheel .ring { position: relative; width: 340px; height: 340px; }
#cbx-wheel .hub { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  text-align: center; color: #fff; font: 600 12px/1.35 ui-rounded, system-ui, sans-serif;
  text-shadow: 0 2px 10px rgba(0,0,0,.8); max-width: 150px; }
#cbx-wheel .hub b { display: block; font-size: 14px; }
#cbx-wheel .hub small { opacity: .65; font-size: 10.5px; }
#cbx-wheel .slot { position: absolute; width: 92px; height: 92px; margin: -46px 0 0 -46px;
  border-radius: 50%; background: rgba(16,20,28,.9); border: 2px solid rgba(255,255,255,.18);
  display: grid; place-items: center; gap: 1px; color: #eef2f8;
  font: 600 11px/1.2 ui-rounded, system-ui, sans-serif; text-align: center;
  box-shadow: 0 8px 26px rgba(0,0,0,.5); }
#cbx-wheel .slot .ico { font-size: 26px; line-height: 1; }
#cbx-wheel .slot .num { position: absolute; top: -7px; left: 50%; transform: translateX(-50%);
  width: 20px; height: 20px; border-radius: 50%; background: #6ee7ff; color: #04121d;
  font: 800 11px/20px ui-rounded, system-ui; }
#cbx-wheel .slot.hot { border-color: #6ee7ff; background: rgba(110,231,255,.22); }
#cbx-toast { position: fixed; left: 50%; bottom: 14%; transform: translateX(-50%);
  z-index: 9001; padding: 8px 16px; border-radius: 999px; background: rgba(16,20,28,.9);
  color: #eef2f8; font: 600 13px ui-rounded, system-ui; pointer-events: none;
  opacity: 0; transition: opacity .18s ease; }
#cbx-toast.on { opacity: 1; }
`;

let root = null, toastEl = null;
function build() {
  if (root) return;
  const st = document.createElement('style'); st.textContent = css;
  document.head.appendChild(st);
  root = document.createElement('div');
  root.id = 'cbx-wheel';
  root.innerHTML = `<div class="ring"><div class="hub"></div></div>`;
  document.body.appendChild(root);
  toastEl = document.createElement('div');
  toastEl.id = 'cbx-toast';
  document.body.appendChild(toastEl);
  paint();
}

function paint() {
  if (!root) return;
  const ring = root.querySelector('.ring');
  ring.querySelectorAll('.slot').forEach((n) => n.remove());
  const R = 118;
  SLOTS.forEach((clip, i) => {
    const a = -Math.PI / 2 + (i / SLOTS.length) * Math.PI * 2;
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.i = String(i);
    el.style.left = `${170 + Math.cos(a) * R}px`;
    el.style.top = `${170 + Math.sin(a) * R}px`;
    el.innerHTML = `<span class="num">${i + 1}</span>
      <span class="ico">${ICONS[clip] || '🎬'}</span>
      <span>${state.labels[clip] || NAMES[clip] || clip}</span>`;
    ring.appendChild(el);
  });
  ring.querySelector('.hub').innerHTML = state.packTitle
    ? `<b>${state.packTitle}</b><small>hold Alt · press 1–6</small>`
    : `<b>Default emotes</b><small>wear an animation pack to change these</small>`;
}

let toastT;
function say(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('on'), 1400);
}

// ---------------------------------------------------------------- pack
/**
 * Read the wearer's pack and label the first four slots from it. A pack that
 * only authors two emotes keeps the built-in names for the rest, so a slot
 * always says what it will actually do.
 */
async function readPack() {
  let ap = '';
  try { ap = JSON.parse(localStorage.getItem('claudebox.avatar') || '{}').animPack || ''; } catch {}
  if (!ap) {
    try {
      const name = localStorage.getItem('claudebox.user');
      if (name) {
        const r = await fetch(`/api/avatar/${encodeURIComponent(name)}`, {
          headers: { 'x-cbx-code': localStorage.getItem('claudebox.code') || '' },
        });
        ap = (await r.json())?.avatar?.animPack || '';
      }
    } catch {}
  }
  state.packName = ap;
  state.labels = { ...NAMES };
  state.packTitle = '';
  if (/^pack:/.test(ap)) {
    const res = await loadPack(ap.slice(5));
    if (res?.meta) {
      state.packTitle = res.meta.title || 'Your pack';
      for (const c of ['emote1', 'emote2', 'emote3', 'emote4']) {
        if (res.meta.clips?.[c]) state.labels[c] = `${state.packTitle} ${c.slice(5)}`;
      }
    }
  } else if (ap && ap !== 'none') {
    state.packTitle = ap[0].toUpperCase() + ap.slice(1);
  }
  paint();
}

// ---------------------------------------------------------------- playing
function play(i) {
  const clip = SLOTS[i];
  if (!clip) return;
  const ctrl = state.getCtrl?.();
  state.playing = clip;
  state.until = performance.now() + 4200;
  if (ctrl?.setAnim) ctrl.setAnim(clip);
  say(`${ICONS[clip] || '🎬'}  ${state.labels[clip] || clip}`);
  window.dispatchEvent(new CustomEvent('cbx-emote', { detail: { clip, slot: i + 1 } }));
}

/** Games call this every frame; returns the clip to force, or null. */
function activeClip() {
  if (!state.playing) return null;
  if (performance.now() > state.until) { state.playing = null; return null; }
  return state.playing;
}
const stop = () => { state.playing = null; };

// ---------------------------------------------------------------- input
function open() {
  if (state.open) return;
  build();
  state.open = true;
  root.classList.add('on');
  readPack();
}
function close() {
  state.open = false;
  root?.classList.remove('on');
  root?.querySelectorAll('.slot.hot').forEach((n) => n.classList.remove('hot'));
}

addEventListener('keydown', (e) => {
  // Left Alt only — the right one is AltGr on a lot of layouts and eating it
  // breaks typing accented characters.
  if (e.code === 'AltLeft') {
    if (!state.open) { open(); e.preventDefault(); }
    return;
  }
  if (!state.open) return;
  const n = /^(Digit|Numpad)([1-6])$/.exec(e.code);
  if (n) {
    e.preventDefault();
    const i = +n[2] - 1;
    root?.querySelector(`.slot[data-i="${i}"]`)?.classList.add('hot');
    play(i);
  } else if (e.key === 'Escape') { close(); }
});
addEventListener('keyup', (e) => { if (e.code === 'AltLeft') close(); });
// releasing focus with Alt held would otherwise leave the wheel stuck open
addEventListener('blur', close);

// A game sets its avatar's animation from its own state every frame, so calling
// setAnim once would be overwritten immediately. Instead we wrap the controller
// exactly once: while an emote is playing, whatever the game asks for is
// redirected to the emote. No per-frame ordering to get wrong, and one line of
// wiring per game.
let patched = null;
function ensurePatch() {
  const c = state.getCtrl?.();
  if (!c || typeof c.setAnim !== 'function' || c === patched) return c;
  const orig = c.setAnim.bind(c);
  c.setAnim = (name) => orig(activeClip() || name);
  patched = c;
  return c;
}
// avatars get rebuilt (respawns, body changes), so keep checking cheaply
(function watch() { ensurePatch(); requestAnimationFrame(watch); })();

export const CBXEmotes = {
  /** A game hands over a getter for its local avatar controller. */
  bind(getCtrl) { state.getCtrl = getCtrl; ensurePatch(); readPack(); },
  activeClip, stop, play,
  get open() { return state.open; },
  get slots() { return SLOTS.slice(); },
  refresh: readPack,
};
window.CBXEmotes = CBXEmotes;
