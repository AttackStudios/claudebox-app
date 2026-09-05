// Backpacking fishing.
//
// The server owns the outcome — it rolls the fish the moment you cast and times
// the bite — so this module is presentation plus the reaction window: aim at
// water, cast, watch the bobber, and hit Reel while the fish is on.
//
// Flow:  idle -> casting -> waiting -> bite -> (reel | missed) -> idle

import * as THREE from 'three';
import { waterAt, lavaAt } from '/shared/bp/worldgen.js';
import { FISH, FISH_BY_ID, RARITIES, RARITY_ORDER, BITE_MAX_MS } from '/shared/bp/fish.js';

const MAX_CAST = 22;      // metres of line
const AIM_STEP = 0.6;

export class Fishing {
  constructor(game, scene, net) {
    this.game = game;
    this.scene = scene;
    this.net = net;
    this.state = 'idle';
    this.biteTimer = null;
    this.reactUntil = 0;
    this.target = null;
    this.marshmallows = 0;
    this.caught = {};
    this.records = {};

    this.bobber = this._buildBobber();
    this.bobber.visible = false;
    scene.add(this.bobber);

    this.line = this._buildLine();
    this.line.visible = false;
    scene.add(this.line);

    this._ui();
  }

  /* --------------------------------------------------------------- meshes -- */
  _buildBobber() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: '#e2402f' }));
    const bot = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: '#f4f4f5' }));
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 5),
      new THREE.MeshLambertMaterial({ color: '#3a3a40' }));
    pin.position.y = 0.18;
    g.add(top, bot, pin);
    return g;
  }

  _buildLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#e8e8ea', transparent: true, opacity: 0.55 }));
  }

  /* ------------------------------------------------------------------- ui -- */
  _ui() {
    if (!document.getElementById('fish-style')) {
      const st = document.createElement('style');
      st.id = 'fish-style';
      st.textContent = `
      #fish-prompt { position: fixed; left: 50%; top: 22%; transform: translateX(-50%);
        z-index: 40; pointer-events: none; text-align: center; display: none; }
      #fish-prompt.on { display: block; }
      #fish-prompt .fp-word { font: 900 40px/1 system-ui, sans-serif; color: #fff;
        text-shadow: 0 3px 14px rgba(0,0,0,.7); letter-spacing: .02em; }
      #fish-prompt .fp-hint { margin-top: 6px; font: 700 15px system-ui, sans-serif; color: #ffe9a8;
        text-shadow: 0 2px 8px rgba(0,0,0,.7); }
      #fish-prompt .fp-bar { width: 190px; height: 9px; margin: 10px auto 0; border-radius: 5px;
        background: rgba(0,0,0,.45); overflow: hidden; }
      #fish-prompt .fp-fill { height: 100%; width: 100%; background: linear-gradient(90deg,#ffd451,#ff6b3d);
        transform-origin: left center; }
      #fish-prompt.waiting .fp-word { font-size: 22px; color: #dfe6f0; }
      #fish-prompt.waiting .fp-bar { display: none; }

      #fish-card { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%) scale(.9);
        z-index: 60; width: min(330px, 88vw); padding: 20px; border-radius: 20px; text-align: center;
        background: linear-gradient(180deg, rgba(28,32,42,.97), rgba(18,20,26,.97));
        border: 1px solid rgba(255,255,255,.14); box-shadow: 0 24px 70px rgba(0,0,0,.6);
        color: #f2f4f8; font-family: system-ui, sans-serif; opacity: 0; pointer-events: none;
        transition: opacity .18s ease, transform .18s cubic-bezier(.34,1.56,.64,1); }
      #fish-card.on { opacity: 1; transform: translate(-50%,-50%) scale(1); }
      #fish-card .fc-emoji { font-size: 62px; line-height: 1; filter: drop-shadow(0 4px 10px rgba(0,0,0,.5)); }
      #fish-card .fc-name { margin-top: 8px; font-size: 22px; font-weight: 800; }
      #fish-card .fc-rar { display: inline-block; margin-top: 7px; padding: 3px 12px; border-radius: 999px;
        font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
      #fish-card .fc-size { margin-top: 10px; font-size: 15px; color: #aeb6c4; }
      #fish-card .fc-val { margin-top: 12px; font-size: 19px; font-weight: 800; color: #ffd451; }
      #fish-card .fc-tags { margin-top: 10px; display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
      #fish-card .fc-tag { padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 800;
        background: rgba(255,255,255,.12); }
      #fish-card .fc-tag.shiny { background: linear-gradient(90deg,#ffd451,#ff8fd0); color: #2a1a00; }
      #fish-card .fc-tag.record { background: #48d98a; color: #06301c; }
      #fish-card .fc-tag.first { background: #5aa9ff; color: #04203f; }

      #mallow-chip { position: fixed; z-index: 35; top: calc(12px + env(safe-area-inset-top)); left: 50%;
        transform: translateX(-50%); display: flex; align-items: center; gap: 7px;
        padding: 7px 14px; border-radius: 999px; font: 800 15px system-ui, sans-serif; color: #fff7ee;
        background: rgba(16,18,24,.72); border: 1px solid rgba(255,255,255,.12);
        backdrop-filter: blur(10px); pointer-events: none; }
      #mallow-chip.bump { animation: mallowBump .45s cubic-bezier(.34,1.56,.64,1); }
      @keyframes mallowBump { 0%{transform:translateX(-50%) scale(1)} 40%{transform:translateX(-50%) scale(1.18)} 100%{transform:translateX(-50%) scale(1)} }
      @media (max-width: 640px) { #mallow-chip { top: calc(8px + env(safe-area-inset-top)); font-size: 13px; } }`;
      document.head.appendChild(st);
    }

    this.prompt = document.createElement('div');
    this.prompt.id = 'fish-prompt';
    this.prompt.innerHTML = '<div class="fp-word"></div><div class="fp-hint"></div>' +
      '<div class="fp-bar"><div class="fp-fill"></div></div>';
    document.body.appendChild(this.prompt);
    this.fill = this.prompt.querySelector('.fp-fill');

    this.card = document.createElement('div');
    this.card.id = 'fish-card';
    document.body.appendChild(this.card);

    this.chip = document.createElement('div');
    this.chip.id = 'mallow-chip';
    this.chip.innerHTML = '<span>🍡</span><span class="mc-n">0</span>';
    document.body.appendChild(this.chip);
  }

  setWallet(n) {
    this.marshmallows = n | 0;
    this.chip.querySelector('.mc-n').textContent = this.marshmallows.toLocaleString();
  }

  bumpWallet(n) {
    this.setWallet(n);
    this.chip.classList.remove('bump');
    void this.chip.offsetWidth;
    this.chip.classList.add('bump');
  }

  /* ---------------------------------------------------------------- aiming -- */
  // March forward from the player along their facing until we hit fishable
  // water. Returns null when they are not looking at any.
  aimPoint(player) {
    const dx = -Math.sin(player.ry), dz = -Math.cos(player.ry);
    for (let d = 2; d <= MAX_CAST; d += AIM_STEP) {
      const x = player.pos.x + dx * d;
      const z = player.pos.z + dz * d;
      if (lavaAt(x, z)) return null;
      const w = waterAt(x, z);
      if (w) return { x, z, surface: w.surface, kind: w.kind, dist: d };
    }
    return null;
  }

  canCast(player) { return this.state === 'idle' && !!this.aimPoint(player); }

  /* ------------------------------------------------------------- the cast -- */
  cast(player) {
    if (this.state !== 'idle') return;
    const aim = this.aimPoint(player);
    if (!aim) return;
    this.state = 'casting';
    this.target = aim;
    this.net.send({ t: 'fish.cast', x: aim.x, z: aim.z });
  }

  // server accepted the cast; it will tell us when something bites
  onCastOk(msg) {
    if (this.state !== 'casting') return;
    this.state = 'waiting';
    this.target = { ...this.target, x: msg.x, z: msg.z };
    this.bobber.position.set(msg.x, this.target.surface, msg.z);
    this.bobber.visible = true;
    this.line.visible = true;
    this._showPrompt('waiting', 'Waiting…', 'The line is out');
    // the bite is server-announced; if it never lands (a dropped packet, or the
    // cast was abandoned) reel ourselves in rather than waiting forever
    clearTimeout(this.biteTimer);
    this.biteTimer = setTimeout(() => {
      if (this.state !== 'waiting') return;
      this.cancel();
      this.game.toast?.('Nothing biting — line reeled in.');
    }, BITE_MAX_MS + 4000);
  }

  onBite(msg) { this._bite(msg.reactMs); }

  _bite(reactMs) {
    if (this.state !== 'waiting') return;
    this.state = 'bite';
    this.reactUntil = performance.now() + reactMs;
    this.reactMs = reactMs;
    this._showPrompt('bite', 'REEL!', 'Press E / tap');
    this.game.sfx?.bite?.();
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) { try { navigator.vibrate(40); } catch {} }
  }

  // player hit the button
  reel() {
    if (this.state === 'waiting') {
      // reeling in early just cancels the cast
      this.net.send({ t: 'fish.cancel' });
      this._reset();
      return;
    }
    if (this.state !== 'bite') return;
    this.state = 'reeling';
    this.net.send({ t: 'fish.reel' });
  }

  onCaught(msg) {
    this._reset();
    const f = FISH_BY_ID[msg.fish];
    if (!f) return;
    this.caught[msg.fish] = (this.caught[msg.fish] || 0) + 1;
    if (msg.cm > (this.records[msg.fish] || 0)) this.records[msg.fish] = msg.cm;
    this.bumpWallet(msg.marshmallows);

    const rar = RARITIES[f.rarity];
    const tags = [];
    if (msg.shiny) tags.push('<span class="fc-tag shiny">✨ SHINY</span>');
    if (msg.first) tags.push('<span class="fc-tag first">NEW</span>');
    if (msg.record && !msg.first) tags.push('<span class="fc-tag record">RECORD</span>');

    this.card.innerHTML =
      `<div class="fc-emoji">${msg.shiny ? '✨' : f.emoji}</div>` +
      `<div class="fc-name">${f.name}</div>` +
      `<div class="fc-rar" style="background:${rar.color};color:#10131a">${rar.label}</div>` +
      `<div class="fc-size">${msg.cm} cm</div>` +
      `<div class="fc-val">+${msg.value} 🍡</div>` +
      (tags.length ? `<div class="fc-tags">${tags.join('')}</div>` : '');
    this.card.classList.add('on');
    this.game.sfx?.catch_?.(f.junk ? 'junk' : f.rarity);
    clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(() => this.card.classList.remove('on'), f.junk ? 1400 : 2400);
  }

  onMiss(msg) {
    this._reset();
    if (msg.reason) this.game.toast?.(msg.reason);
  }

  _showPrompt(cls, word, hint) {
    this.prompt.className = 'on ' + cls;
    this.prompt.querySelector('.fp-word').textContent = word;
    this.prompt.querySelector('.fp-hint').textContent = hint;
    this.fill.style.transform = 'scaleX(1)';
  }

  _reset() {
    clearTimeout(this.biteTimer);
    this.state = 'idle';
    this.target = null;
    this.bobber.visible = false;
    this.line.visible = false;
    this.prompt.className = '';
  }

  cancel() {
    if (this.state === 'idle') return;
    this.net.send({ t: 'fish.cancel' });
    this._reset();
  }

  /* ----------------------------------------------------------------- guide -- */
  // Every species, what you have caught, and your personal best of each — the
  // in-game fishing guide the original leans on for "where do I catch X".
  toggleGuide() {
    if (this.guide && this.guide.classList.contains('on')) { this.guide.classList.remove('on'); return; }
    if (!this.guide) {
      const st = document.createElement('style');
      st.textContent = `
      #fish-guide { position: fixed; inset: 0; z-index: 70; display: none; place-items: center;
        background: rgba(6,8,12,.66); padding: 16px; font-family: system-ui, sans-serif; }
      #fish-guide.on { display: grid; }
      #fish-guide .fg { width: min(620px,100%); max-height: 84vh; overflow-y: auto; padding: 20px 22px;
        border-radius: 20px; background: linear-gradient(180deg,rgba(26,30,39,.98),rgba(16,18,24,.98));
        border: 1px solid rgba(255,255,255,.13); color: #eef1f6; box-shadow: 0 26px 80px rgba(0,0,0,.6); }
      #fish-guide h2 { margin: 0 0 2px; font-size: 21px; font-weight: 800; }
      #fish-guide .fg-sub { margin: 0 0 16px; font-size: 13.5px; color: #9aa3b2; }
      #fish-guide .fg-row { display: flex; align-items: center; gap: 12px; padding: 9px 0;
        border-bottom: 1px solid rgba(255,255,255,.07); }
      #fish-guide .fg-row:last-child { border-bottom: 0; }
      #fish-guide .fg-em { font-size: 26px; width: 34px; text-align: center; flex: none; }
      #fish-guide .fg-mid { flex: 1; min-width: 0; }
      #fish-guide .fg-nm { font-size: 15px; font-weight: 700; }
      #fish-guide .fg-wh { font-size: 12px; color: #9aa3b2; margin-top: 1px; }
      #fish-guide .fg-rt { text-align: right; flex: none; font-size: 12px; color: #9aa3b2; }
      #fish-guide .fg-rt b { display: block; font-size: 13px; color: #eef1f6; }
      #fish-guide .fg-tag { display: inline-block; padding: 2px 8px; border-radius: 999px;
        font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #10131a; }
      #fish-guide .locked { opacity: .45; }
      #fish-guide .fg-close { margin-top: 16px; width: 100%; padding: 12px; border: 0; border-radius: 12px;
        background: rgba(255,255,255,.1); color: #eef1f6; font: 700 15px system-ui; cursor: pointer; }
      #fish-guide .fg-close:hover { background: rgba(255,255,255,.16); }`;
      document.head.appendChild(st);
      this.guide = document.createElement('div');
      this.guide.id = 'fish-guide';
      document.body.appendChild(this.guide);
      this.guide.addEventListener('click', (e) => { if (e.target === this.guide) this.guide.classList.remove('on'); });
    }

    const seen = Object.keys(this.caught).length;
    const total = FISH.filter((f) => !f.junk).length;
    const rows = [...FISH].sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
      .filter((f) => !f.junk)
      .map((f) => {
        const n = this.caught[f.id] || 0;
        const rec = this.records[f.id];
        const rar = RARITIES[f.rarity];
        return `<div class="fg-row${n ? '' : ' locked'}">
          <div class="fg-em">${n ? f.emoji : '❔'}</div>
          <div class="fg-mid">
            <div class="fg-nm">${n ? f.name : '???'}</div>
            <div class="fg-wh">${f.where}</div>
          </div>
          <div class="fg-rt">
            <span class="fg-tag" style="background:${rar.color}">${rar.label}</span>
            <b>${n ? `${rec} cm` : '—'}</b>${n ? `caught ${n}` : 'not caught'}
          </div>
        </div>`;
      }).join('');

    this.guide.innerHTML = `<div class="fg">
      <h2>Fishing guide</h2>
      <p class="fg-sub">${seen} of ${total} species · ${this.marshmallows.toLocaleString()} 🍡 earned</p>
      ${rows}
      <button class="fg-close" type="button">Close</button></div>`;
    this.guide.querySelector('.fg-close').addEventListener('click', () => this.guide.classList.remove('on'));
    this.guide.classList.add('on');
  }

  /* ----------------------------------------------------------------- frame -- */
  update(dt, now, rodTip) {
    if (this.state === 'idle') return;

    // bob on the water, and dip hard when something is on
    if (this.bobber.visible && this.target) {
      const t = now / 1000;
      const bobbing = this.state === 'bite'
        ? -0.16 + Math.sin(t * 26) * 0.09
        : Math.sin(t * 2.2) * 0.045;
      this.bobber.position.y = this.target.surface + bobbing;
      this.bobber.rotation.z = Math.sin(t * (this.state === 'bite' ? 18 : 1.6)) * 0.16;
    }

    // line from the rod tip to the bobber
    if (this.line.visible && rodTip) {
      const pos = this.line.geometry.attributes.position;
      pos.setXYZ(0, rodTip.x, rodTip.y, rodTip.z);
      pos.setXYZ(1, this.bobber.position.x, this.bobber.position.y + 0.1, this.bobber.position.z);
      pos.needsUpdate = true;
      this.line.geometry.computeBoundingSphere();
    }

    // the reaction window draining away
    if (this.state === 'bite') {
      const left = Math.max(0, this.reactUntil - now) / this.reactMs;
      this.fill.style.transform = `scaleX(${left})`;
      if (left <= 0) {
        this._reset();
        this.game.toast?.('It got away…');
      }
    }
  }
}
