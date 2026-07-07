// Main menu: name, stage, breed grid with live 3D preview, colors, nametag.
// Resolves with the chosen profile when Play is pressed.

import * as THREE from 'three';
import { BREEDS, SETS, defaultColors, BREED_MIGRATIONS } from '../birds/breeds.js';
import { buildBird } from '../birds/factory.js';
import { animateBird, makeAnimState } from '../birds/animate.js';
import { buildColorEditor } from './customize.js';
import { audio } from '../audio.js';

const LAST_KEY = 'featherfriends.lastProfile';

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

export function runMenu() {
  return new Promise((resolve) => {
    const menuEl = document.getElementById('menu');
    const last = loadLastProfile();

    const profile = {
      name: last?.name || '',
      stage: last?.stage || 'adult',
      breed: last?.breed || 'robin',
      colors: last?.colors && last?.breed ? { ...last.colors } : defaultColors('robin'),
      nameStyle: last?.nameStyle || { color: '#ffffff', style: 'outline' },
    };

    // ---- name ----
    const nameInput = document.getElementById('menu-name');
    nameInput.value = profile.name;

    // ---- stage cards ----
    const stageRow = document.getElementById('menu-stages');
    const refreshStages = () => {
      for (const btn of stageRow.querySelectorAll('.stage-card')) {
        btn.classList.toggle('selected', btn.dataset.stage === profile.stage);
      }
    };
    stageRow.addEventListener('click', (e) => {
      const btn = e.target.closest('.stage-card');
      if (!btn) return;
      profile.stage = btn.dataset.stage;
      refreshStages();
      rebuildPreview();
      audio.sfx('click');
    });
    refreshStages();

    // ---- breed set tabs + grid ----
    let currentSet = BREEDS[profile.breed]?.set || 'classic';
    const tabsEl = document.getElementById('menu-set-tabs');
    const gridEl = document.getElementById('menu-breeds');

    const renderTabs = () => {
      tabsEl.innerHTML = '';
      for (const set of SETS) {
        const tab = document.createElement('button');
        tab.className = 'set-tab' + (set.id === currentSet ? ' selected' : '');
        tab.textContent = set.label;
        tab.addEventListener('click', () => {
          currentSet = set.id;
          renderTabs();
          renderGrid();
          audio.sfx('click');
        });
        tabsEl.appendChild(tab);
      }
    };

    const renderGrid = () => {
      gridEl.innerHTML = '';
      for (const [id, def] of Object.entries(BREEDS)) {
        if (def.set !== currentSet) continue;
        const card = document.createElement('button');
        card.className = 'breed-card'
          + (id === profile.breed ? ' selected' : '')
          + (def.set === 'mythical' ? ' mythical' : '');
        const em = document.createElement('span');
        em.className = 'breed-emoji';
        em.textContent = def.emoji;
        card.appendChild(em);
        card.appendChild(document.createTextNode(def.label));
        card.addEventListener('click', () => {
          profile.breed = id;
          profile.colors = defaultColors(id);
          colorEditor.setAll(profile.colors);
          renderGrid();
          rebuildPreview();
          audio.sfx('pop');
        });
        gridEl.appendChild(card);
      }
    };
    renderTabs();
    renderGrid();

    // ---- color editor ----
    const colorBox = document.getElementById('menu-colors');
    const colorEditor = buildColorEditor(colorBox, profile.colors, () => {
      preview.bird?.setColors(profile.colors);
    });

    // ---- nametag ----
    const tagBox = document.getElementById('menu-nametag');
    tagBox.innerHTML = '';
    const tagColor = document.createElement('input');
    tagColor.type = 'color';
    tagColor.value = profile.nameStyle.color;
    tagColor.addEventListener('input', () => { profile.nameStyle.color = tagColor.value; });
    const tagStyle = document.createElement('select');
    for (const [v, label] of [['outline', 'Outline'], ['glow', 'Glow'], ['plain', 'Plain']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      tagStyle.appendChild(o);
    }
    tagStyle.value = profile.nameStyle.style;
    tagStyle.style.padding = '6px 10px';
    tagStyle.style.borderRadius = '10px';
    tagStyle.style.border = '2px solid #cfe9f5';
    tagStyle.addEventListener('change', () => { profile.nameStyle.style = tagStyle.value; });
    const tagLabel = document.createElement('span');
    tagLabel.textContent = 'Color + style:';
    tagLabel.style.fontWeight = 'bold';
    tagLabel.style.color = 'var(--ink)';
    tagLabel.style.fontSize = '13px';
    tagBox.append(tagLabel, tagColor, tagStyle);

    // ---- 3D preview ----
    const preview = createPreview(document.getElementById('menu-preview'));
    const rebuildPreview = () => preview.setBird(profile.breed, profile.colors, profile.stage);
    rebuildPreview();

    // ---- music + play ----
    const startAudio = () => audio.unlock();
    window.addEventListener('pointerdown', startAudio, { once: true });
    window.addEventListener('keydown', startAudio, { once: true });
    audio.playMenu();

    document.getElementById('menu-play').addEventListener('click', () => {
      profile.name = nameInput.value.trim().slice(0, 20) || 'Birb';
      audio.unlock();
      audio.sfx('sparkle');
      localStorage.setItem(LAST_KEY, JSON.stringify(profile));
      preview.stop();
      menuEl.classList.add('hidden');
      resolve(profile);
    });
  });
}

function createPreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, canvas.clientWidth / canvas.clientHeight, 0.1, 50);
  cam.position.set(0, 1.6, 5);
  cam.lookAt(0, 0.9, 0);
  scene.add(new THREE.AmbientLight('#cfe4f0', 1.3));
  const sun = new THREE.DirectionalLight('#fff4dc', 2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  // little grass disc
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.4, 0.3, 18),
    new THREE.MeshLambertMaterial({ color: '#6fbf5a', flatShading: true })
  );
  disc.position.y = -0.15;
  scene.add(disc);

  const state = { bird: null, animState: makeAnimState(), running: true };

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h) {
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  };
  resize();
  window.addEventListener('resize', resize);

  let lastT = performance.now();
  const loop = () => {
    if (!state.running) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (state.bird) {
      state.bird.group.rotation.y += dt * 0.6;
      animateBird(state.bird, state.animState, dt);
    }
    renderer.render(scene, cam);
  };
  loop();

  return {
    get bird() { return state.bird; },
    setBird(breed, colors, stage) {
      if (state.bird) scene.remove(state.bird.group);
      state.bird = buildBird(breed, colors, stage);
      const def = BREEDS[breed];
      const fit = 1 / Math.max(0.8, def.size * (stage === 'baby' ? 0.7 : 1));
      state.bird.group.scale.setScalar(fit);
      scene.add(state.bird.group);
      state.animState = makeAnimState();
      state.animState.anim = 'idle';
    },
    stop() {
      state.running = false;
      renderer.dispose();
    },
  };
}
