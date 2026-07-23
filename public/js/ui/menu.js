// Main menu, two screens over the living world: the title (logo + Play),
// then the species picker — tabbed sheets of white cards, each with a real
// rendered thumbnail of the bird. Picking Egg starts you as an egg of your
// last (or default) breed; picking a species drops you in as an adult.
// Colors + nametag are customized in-game (Customize / Name panels).

import * as THREE from 'three';
import { BREEDS, SETS, defaultColors, BREED_MIGRATIONS } from '../birds/breeds.js';
import { buildBird } from '../birds/factory.js';
import { audio } from '../audio.js';

const LAST_KEY = 'featherfriends.lastProfile';
const UNLOCK_CACHE_KEY = 'ff.unlockCache';

// Server-confirmed unlock state, cached at every join. Missing cache
// (first ever launch) => treat everything as unlocked; the server
// enforces anyway and falls back gracefully.
function readUnlockCache() {
  try { return JSON.parse(localStorage.getItem(UNLOCK_CACHE_KEY) || 'null'); }
  catch { return null; }
}

export function loadLastProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    if (p && BREED_MIGRATIONS[p.breed]) {
      p.breed = BREED_MIGRATIONS[p.breed];
      p.colors = {};   // removed breed's colors don't suit the new model
    }
    return p;
  } catch { return null; }
}

// the three picker tabs and which breed sets fill them
const PICKER_TABS = [
  { id: 'standard', label: 'Standard', sets: ['classic'] },
  { id: 'unlock', label: 'Unlockables', sets: ['exotic', 'raptor'] },
  { id: 'mythical', label: 'Mythical', sets: ['mythical'] },
];

export function runMenu() {
  return new Promise((resolve) => {
    const menuEl = document.getElementById('menu');
    const titleEl = document.getElementById('title-screen');
    const pickerEl = document.getElementById('picker-screen');
    const last = loadLastProfile();

    const nameInput = document.getElementById('menu-name');
    nameInput.value = last?.name || localStorage.getItem('claudebox.user') || '';

    const unlockCache = readUnlockCache();
    const priceOf = (id) => unlockCache?.prices?.[id] || 0;
    const isLocked = (id) =>
      !!unlockCache && priceOf(id) > 0 && !unlockCache.unlocked?.includes(id);

    // ---- music ----
    const startAudio = () => audio.unlock();
    window.addEventListener('pointerdown', startAudio, { once: true });
    window.addEventListener('keydown', startAudio, { once: true });
    audio.playMenu();

    // ---- screen 1 -> screen 2 ----
    let chosenName = 'Birb';
    document.getElementById('menu-play').addEventListener('click', () => {
      chosenName = nameInput.value.trim().slice(0, 20) || 'Birb';
      audio.unlock();
      audio.sfx('sparkle');
      titleEl.classList.add('hidden');
      pickerEl.classList.remove('hidden');
      renderTabs();
      renderGrid();
    });

    // ---- species picker ----
    let currentTab = 'standard';
    const tabsEl = document.getElementById('picker-tabs');
    const gridEl = document.getElementById('picker-grid');
    const hintEl = document.getElementById('picker-hint');

    const renderTabs = () => {
      tabsEl.innerHTML = '';
      for (const tab of PICKER_TABS) {
        const b = document.createElement('button');
        b.className = 'picker-tab' + (tab.id === currentTab ? ' selected' : '');
        b.innerHTML = `<span>${tab.label}</span>`;
        b.addEventListener('click', () => {
          currentTab = tab.id;
          renderTabs();
          renderGrid();
          audio.sfx('click');
        });
        tabsEl.appendChild(b);
      }
    };

    const pick = (breed, stage) => {
      audio.sfx('sparkle');
      const profile = {
        name: chosenName,
        stage,
        breed,
        colors: defaultColors(breed),
        nameStyle: last?.nameStyle || { color: '#ffffff', style: 'outline' },
      };
      localStorage.setItem(LAST_KEY, JSON.stringify(profile));
      thumbs.dispose();
      menuEl.classList.add('hidden');
      resolve(profile);
    };

    const showHint = (text) => {
      hintEl.textContent = text;
      hintEl.classList.remove('hidden');
      clearTimeout(showHint.t);
      showHint.t = setTimeout(() => hintEl.classList.add('hidden'), 3200);
    };

    const card = (label, { locked = 0, mythical = false } = {}) => {
      const c = document.createElement('button');
      c.className = 'pick-card' + (locked ? ' locked' : '') + (mythical ? ' mythical' : '');
      const name = document.createElement('div');
      name.className = 'pick-name';
      name.textContent = label;
      const imgBox = document.createElement('div');
      imgBox.className = 'pick-img';
      if (locked) {
        const badge = document.createElement('span');
        badge.className = 'pick-lock';
        badge.textContent = `🔒 ${locked} 🪶`;
        imgBox.appendChild(badge);
      }
      c.append(name, imgBox);
      return c;
    };

    const renderGrid = () => {
      gridEl.innerHTML = '';
      const tab = PICKER_TABS.find((t) => t.id === currentTab);

      // the Egg leads the Standard sheet — hatch into your bird the long way
      if (currentTab === 'standard') {
        const eggBreed = last?.breed && !isLocked(last.breed) ? last.breed : 'robin';
        const c = card('Egg');
        thumbs.into(c.querySelector('.pick-img'), eggBreed, 'egg');
        c.addEventListener('click', () => pick(eggBreed, 'egg'));
        gridEl.appendChild(c);
      }

      for (const [id, def] of Object.entries(BREEDS)) {
        if (!tab.sets.includes(def.set)) continue;
        const locked = isLocked(id) ? priceOf(id) : 0;
        const c = card(def.label, { locked, mythical: def.set === 'mythical' });
        thumbs.into(c.querySelector('.pick-img'), id, 'adult');
        c.addEventListener('click', () => {
          if (locked) {
            c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
            showHint(`🔒 Unlock the ${def.label} in-game for ${locked} 🪶 — feathers drip in just for playing!`);
            audio.sfx('click');
            return;
          }
          pick(id, 'adult');
        });
        gridEl.appendChild(c);
      }
    };

    // ---- 3D thumbnails, rasterized once per species ----
    const thumbs = makeThumbnailer();
  });
}

// One tiny offscreen renderer rasterizes every species card image on demand;
// data-URLs are cached so tab flips are instant.
function makeThumbnailer() {
  const SIZE = 220;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  scene.add(new THREE.AmbientLight('#dbe8f2', 1.35));
  const sun = new THREE.DirectionalLight('#fff4dc', 1.9);
  sun.position.set(3, 5, 4);
  scene.add(sun);

  const cache = new Map();   // `${breed}:${stage}` -> dataURL

  function shot(breed, stage) {
    const key = `${breed}:${stage}`;
    if (cache.has(key)) return cache.get(key);
    const bird = buildBird(breed, defaultColors(breed, stage), stage);
    // three-quarter pose facing right, like a field-guide plate
    bird.group.rotation.y = Math.PI / 2 + 0.55;
    scene.add(bird.group);
    const box = new THREE.Box3().setFromObject(bird.group);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    cam.position.set(c.x + r * 0.4, c.y + r * 0.45, c.z + r * 2.5);
    cam.lookAt(c);
    renderer.render(scene, cam);
    const url = canvas.toDataURL();
    scene.remove(bird.group);
    cache.set(key, url);
    return url;
  }

  return {
    into(box, breed, stage) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = shot(breed, stage);
      box.appendChild(img);
    },
    dispose() { renderer.dispose(); },
  };
}
