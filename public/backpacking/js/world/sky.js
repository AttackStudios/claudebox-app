// Day/night sky: sun + moon orbit, sky-dome gradient, fog, stars, and a
// dynamic point-light budget (campfires, torches, string lights, windows,
// headlights — the 8 nearest to the camera get real PointLights).

import * as THREE from 'three';
import { WORLD } from '/shared/bp/worldgen.js';

const LIGHT_BUDGET = 16;

// palette keyed by sun elevation (-1..1)
const SKY = {
  // night is a soft moonlit blue, not pitch black, so you can still see
  nightTop: new THREE.Color('#1a2746'), nightHorizon: new THREE.Color('#2c3c60'),
  dawnTop: new THREE.Color('#3a4a7a'), dawnHorizon: new THREE.Color('#e88a5a'),
  dayTop: new THREE.Color('#4f9fe0'), dayHorizon: new THREE.Color('#cfe8f6'),
  duskTop: new THREE.Color('#2e3460'), duskHorizon: new THREE.Color('#e8704a'),
};

export class Sky {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    scene.add(this.group);

    // dome (vertex-colored each tick — low poly so it's cheap)
    this.domeGeo = new THREE.SphereGeometry(WORLD.size * 1.7, 18, 10);
    this.domeColors = new Float32Array(this.domeGeo.attributes.position.count * 3);
    this.domeGeo.setAttribute('color', new THREE.BufferAttribute(this.domeColors, 3));
    this.dome = new THREE.Mesh(this.domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
    this.group.add(this.dome);

    // sun + moon discs
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(46, 16), new THREE.MeshBasicMaterial({ color: '#fff2c0', fog: false }));
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(30, 16), new THREE.MeshBasicMaterial({ color: '#e8edf5', fog: false }));
    this.group.add(this.sun, this.moon);

    // stars
    const starCount = quality === 'low' ? 350 : 700;
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.48 + 0.04;
      const r = WORLD.size * 1.6;
      sp[i * 3] = Math.cos(a) * Math.cos(e) * r;
      sp[i * 3 + 1] = Math.sin(e) * r;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#dde6ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // lights
    this.sunLight = new THREE.DirectionalLight('#fff4dc', 2.0);
    this.hemi = new THREE.HemisphereLight('#cfe8f6', '#5a6a4a', 0.6);
    this.ambient = new THREE.AmbientLight('#9fb4cc', 0.6);
    this.group.add(this.sunLight, this.hemi, this.ambient);

    scene.fog = new THREE.Fog('#cfe8f6', 200, WORLD.size * 1.4);

    // dynamic lamp registry + pooled point lights
    this.lamps = []; // { x, y, z, color, intensity, range, flicker }
    this.pool = [];
    // soft radial glow halo paired with every pooled light (cheap bloom)
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const gc = glowCanvas.getContext('2d');
    const grad = gc.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gc.fillStyle = grad;
    gc.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    for (let i = 0; i < LIGHT_BUDGET; i++) {
      const pl = new THREE.PointLight('#ffaa55', 0, 18, 1.8);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: '#ffaa55', transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.renderOrder = 50;
      this.group.add(pl, glow);
      this.pool.push(pl);
      pl.userData.glow = glow;
    }
  }

  // register a lamp; returns the lamp record (mutate .x/.y/.z for moving lamps)
  addLamp(lamp) {
    const rec = { color: '#ffaa55', intensity: 1.6, range: 18, flicker: 0, on: true, ...lamp };
    this.lamps.push(rec);
    return rec;
  }
  removeLamp(rec) {
    const i = this.lamps.indexOf(rec);
    if (i >= 0) this.lamps.splice(i, 1);
  }

  // clock01: 0..1 through the day; 0 = dawn start
  tick(clock01, camera, time) {
    const sunA = (clock01 - 0.25) * Math.PI * 2; // 0.25 → noon overhead
    const elev = Math.sin(sunA + Math.PI / 2);   // 1 noon, -1 midnight
    const azim = Math.cos(sunA + Math.PI / 2);

    const sunDir = new THREE.Vector3(azim * 0.8, elev, 0.45).normalize();
    this.sun.position.copy(sunDir).multiplyScalar(WORLD.size * 1.5);
    this.sun.lookAt(0, 0, 0);
    this.moon.position.copy(sunDir).multiplyScalar(-WORLD.size * 1.5);
    this.moon.position.z += 120;
    this.moon.lookAt(0, 0, 0);

    // blend palettes
    const day = smooth(0.06, 0.32, elev);
    const twilight = Math.max(0, 1 - Math.abs(elev) / 0.3);
    const top = new THREE.Color().copy(SKY.nightTop).lerp(SKY.dayTop, day);
    const horizon = new THREE.Color().copy(SKY.nightHorizon).lerp(SKY.dayHorizon, day);
    if (twilight > 0) {
      const warm = azim < 0 ? SKY.duskHorizon : SKY.dawnHorizon;
      horizon.lerp(warm, twilight * 0.85);
      top.lerp(azim < 0 ? SKY.duskTop : SKY.dawnTop, twilight * 0.6);
    }

    // paint dome
    const pos = this.domeGeo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / (WORLD.size * 1.7);
      c.copy(horizon).lerp(top, Math.max(0, y) ** 0.65);
      this.domeColors[i * 3] = c.r;
      this.domeColors[i * 3 + 1] = c.g;
      this.domeColors[i * 3 + 2] = c.b;
    }
    this.domeGeo.attributes.color.needsUpdate = true;

    // lights & fog
    this.sunLight.position.copy(sunDir).multiplyScalar(400);
    if (elev > -0.04) {
      this.sunLight.intensity = 0.25 + day * 1.9;
      this.sunLight.color.set('#fff4dc').lerp(new THREE.Color('#ff9a50'), twilight);
    } else {
      // moonlight — bright enough to camp and drive by
      this.sunLight.position.copy(sunDir).multiplyScalar(-400);
      this.sunLight.intensity = 0.7;
      this.sunLight.color.set('#b8c8ec');
    }
    // generous night floor on the fill lights so nothing is ever pitch black
    this.hemi.intensity = 0.5 + day * 0.45;
    this.ambient.intensity = 0.42 + day * 0.36;
    this.scene.fog.color.copy(horizon);
    this.scene.fog.near = 60 + day * 200;
    this.scene.fog.far = (0.55 + day * 0.85) * 1400;
    this.starMat.opacity = Math.max(0, Math.min(1, -elev * 3 + 0.15));
    this.sun.material.color.set('#fff2c0').lerp(new THREE.Color('#ff7a30'), twilight);

    // ---- point light budget ----
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const active = this.lamps
      .filter((l) => l.on)
      .map((l) => ({ l, d: (l.x - cx) ** 2 + (l.y - cy) ** 2 + (l.z - cz) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, LIGHT_BUDGET);
    for (let i = 0; i < this.pool.length; i++) {
      const pl = this.pool[i];
      const slot = active[i];
      if (!slot) { pl.intensity = 0; continue; }
      const l = slot.l;
      pl.position.set(l.x, l.y, l.z);
      pl.color.set(l.color);
      pl.distance = l.range;
      const flick = l.flicker ? 1 + Math.sin(time * 11 + l.x * 7) * l.flicker * 0.4 + Math.sin(time * 23 + l.z * 3) * l.flicker * 0.2 : 1;
      // lamps glow brighter at night
      pl.intensity = l.intensity * flick * (0.55 + (1 - day) * 1.1);
      const glow = pl.userData.glow;
      glow.position.copy(pl.position);
      glow.material.color.set(l.color);
      glow.material.opacity = Math.min(0.85, 0.16 + (1 - day) * 0.55) * Math.min(1, flick);
      const s = l.range * (0.32 + (1 - day) * 0.22);
      glow.scale.set(s, s, 1);
    }
    // hide glows for unused pool slots
    for (let i = active.length; i < this.pool.length; i++) {
      this.pool[i].userData.glow.material.opacity = 0;
    }

    this.elev = elev;
    this.dayAmount = day;
  }
}

function smooth(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
