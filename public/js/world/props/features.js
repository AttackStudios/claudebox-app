// Landmark features from the reference map: the four glowing Crystal sites,
// the Magic Tree grottos (cave shells with glowing pools), hanging jungle
// vines, waterfalls (jungle cliffs, a frozen fall, Skylands edge-falls),
// icicles, glowing mushrooms, lily pads, and the volcano's spike rings.

import * as THREE from 'three';
import { WORLD, groundAt, height, skySurface, waterAt } from '/shared/worldgen.js';
import { lambert, instanced, glowSprite, scatterIn } from './lib.js';

const Y = (x, z) => groundAt(x, z);

function emissiveMat(color, emissive, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, emissive, flatShading: true, ...opts });
}

// vertical white streaks, transparent — scrolled for waterfall sheets
function waterfallTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 256);
  let s = 991;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 46; i++) {
    const x = rng() * 64, w = 1.5 + rng() * 4, a = 0.25 + rng() * 0.5;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, `rgba(220,242,255,${a * 0.7})`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, w, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A bare, many-branched magic tree. Returns a group (origin at the roots).
function magicTree(mat, scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 3.2, 7), mat);
  trunk.position.y = 1.6;
  g.add(trunk);
  const branch = (len, r0, y, ry, tilt) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.4, r0, len, 5), mat);
    b.geometry.translate(0, len / 2, 0);
    b.position.y = y;
    b.rotation.order = 'YXZ';
    b.rotation.y = ry;
    b.rotation.x = tilt;
    g.add(b);
    return b;
  };
  const tips = [];
  for (let i = 0; i < 6; i++) {
    const ry = (i / 6) * Math.PI * 2 + 0.4;
    const tilt = 0.7 + (i % 3) * 0.25;
    const b = branch(2.6 + (i % 2) * 0.8, 0.26, 3.0, ry, tilt);
    // a twig off each branch
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.4, 4), mat);
    twig.geometry.translate(0, 0.7, 0);
    twig.position.y = 2.2;
    twig.rotation.z = 0.8;
    b.add(twig);
    tips.push(b);
  }
  const crown = branch(2.2, 0.2, 3.1, 0, 0.06);
  g.scale.setScalar(scale);
  return g;
}

// A glowing capsule crystal with a ring of spikes. Returns { group, glow }.
function crystalSite(x, z, y, coreColor, coreEmissive, spikeMat, spikeCount = 6) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.5, 4.2, 3, 8),
    new THREE.MeshLambertMaterial({ color: coreColor, emissive: coreEmissive }),
  );
  core.position.set(0, 3.6, 0);
  g.add(core);
  const glow = glowSprite(coreColor, 13);
  glow.position.set(0, 4.2, 0);
  g.add(glow);
  for (let i = 0; i < spikeCount; i++) {
    const a = (i / spikeCount) * Math.PI * 2 + 0.3;
    const d = 3.6 + (i % 2) * 1.7;
    const h = 2.2 + ((i * 7) % 5) * 0.7;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.55, h * 2, 6), spikeMat);
    spike.position.set(Math.cos(a) * d, h * 0.55, Math.sin(a) * d);
    spike.rotation.z = (Math.sin(a * 3)) * 0.14;
    g.add(spike);
  }
  g.position.set(x, y, z);
  return { group: g, glow };
}

// A rocky cave shell whose wedge opening faces the point (tx, tz) from the
// cave at (cx, cz). three.js spheres start at -x, so the gap (centered at
// phiStart - halfGap) points along (-cos(phi), sin(phi)) — hence the atan2
// with a negated dx. DoubleSide so the inside is visible from within.
function caveShell(r, mat, cx, cz, tx, tz) {
  const ry = Math.atan2(tz - cz, -(tx - cx));
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, 14, 9, ry + 0.6, Math.PI * 2 - 1.2, 0, Math.PI / 2),
    mat,
  );
}

export function buildFeatures(rng, q) {
  const group = new THREE.Group();
  group.name = 'features';
  const trunks = [];
  const tickers = [];
  const glows = [];

  const fo = WORLD.forest, ic = WORLD.ice, j = WORLD.jungle, v = WORLD.volcano;
  const rockMat = lambert('#5d564e', { side: THREE.DoubleSide });
  const iceShellMat = emissiveMat('#bfe2f6', '#16334a', { side: THREE.DoubleSide });
  const lavaShellMat = emissiveMat('#4a2026', '#200608', { side: THREE.DoubleSide });

  // ============ CRYSTAL SITES ============
  {
    const sites = [
      // forest: green crystal in a mossy clearing
      crystalSite(fo.crystal.x, fo.crystal.z, Y(fo.crystal.x, fo.crystal.z),
        '#7af084', '#1d7a30', emissiveMat('#9af0a4', '#2a5d34', { transparent: true, opacity: 0.75 })),
      // ice: cyan obelisk ringed by translucent ice spikes
      crystalSite(ic.crystal.x, ic.crystal.z, Y(ic.crystal.x, ic.crystal.z),
        '#7af0e8', '#1d8a8a', emissiveMat('#dff4fc', '#3a6a8a', { transparent: true, opacity: 0.6 }), 8),
      // volcano: red crystal among black basalt teeth
      crystalSite(v.crystal.x, v.crystal.z, Y(v.crystal.x, v.crystal.z),
        '#ff5040', '#8a100a', lambert('#26222b'), 8),
    ];
    // skylands: pale crystal on its own island
    const skyIsle = WORLD.sky.islands[WORLD.sky.crystal.island];
    const sx = skyIsle.x + WORLD.sky.crystal.x, sz = skyIsle.z + WORLD.sky.crystal.z;
    sites.push(crystalSite(sx, sz, skySurface(sx, sz) ?? skyIsle.top,
      '#f2faff', '#5a7a9a', emissiveMat('#e8f4fc', '#46627a', { transparent: true, opacity: 0.5 }), 7));
    for (const s of sites) {
      group.add(s.group);
      glows.push(s.glow);
      trunks.push({ x: s.group.position.x, z: s.group.position.z, r: 1.6 });
    }
  }

  // ============ MAGIC TREE GROTTOS ============
  // forest: dark mossy cave, green pool, white-green tree, glowing mushrooms
  {
    const gr = fo.grotto;
    const y = fo.grotto.floor;
    const shell = caveShell(gr.r * 1.18, rockMat, gr.x, gr.z, fo.x, fo.z);
    shell.position.set(gr.x, y - 0.4, gr.z);
    shell.scale.set(1, 0.72, 1);
    group.add(shell);
    // mossy boulders piled against the shell so it reads as a rocky knoll
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.5;
      const bx = gr.x + Math.cos(a) * gr.r * 1.25, bz = gr.z + Math.sin(a) * gr.r * 1.25;
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4 + (i % 3) * 1.2, 0), i % 2 ? rockMat : lambert('#4f7a3c'));
      rk.position.set(bx, Y(bx, bz) + 0.8, bz);
      rk.rotation.set(i, i * 2.2, i * 0.4);
      group.add(rk);
    }
    const pool = new THREE.Mesh(new THREE.CircleGeometry(gr.r * 0.42, 18), emissiveMat('#4ad06a', '#1d6a2e', { transparent: true, opacity: 0.9 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(gr.x, y + 0.06, gr.z);
    group.add(pool);
    const tree = magicTree(emissiveMat('#d8f0d8', '#2e6a3c'), 1.15);
    tree.position.set(gr.x, y, gr.z);
    group.add(tree);
    const glow = glowSprite('#5af07a', 12);
    glow.position.set(gr.x, y + 3, gr.z);
    group.add(glow);
    glows.push(glow);
    trunks.push({ x: gr.x, z: gr.z, r: 1.2 });
  }
  // ice: penguin cave (plain) + the magic ice cave with a cyan pool
  {
    const pc = ic.caveP;
    const shell = caveShell(pc.r * 1.2, iceShellMat, pc.x, pc.z, 0, 0);
    shell.position.set(pc.x, pc.floor - 0.4, pc.z);
    shell.scale.set(1, 0.78, 1);
    group.add(shell);

    const gr = ic.grotto;
    const shell2 = caveShell(gr.r * 1.2, iceShellMat, gr.x, gr.z, ic.crystal.x, ic.crystal.z);
    shell2.position.set(gr.x, gr.floor - 0.4, gr.z);
    shell2.scale.set(1, 0.8, 1);
    group.add(shell2);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(gr.r * 0.45, 18), emissiveMat('#52e8e0', '#0d6a6a', { transparent: true, opacity: 0.92 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(gr.x, gr.floor + 0.06, gr.z);
    group.add(pool);
    const tree = magicTree(emissiveMat('#eef8fc', '#3a7a8a'), 1.1);
    tree.position.set(gr.x, gr.floor, gr.z);
    group.add(tree);
    const glow = glowSprite('#7af0f0', 12);
    glow.position.set(gr.x, gr.floor + 3, gr.z);
    group.add(glow);
    glows.push(glow);
    trunks.push({ x: gr.x, z: gr.z, r: 1.2 });

    // icicles fringing both cave mouths
    const icicleSpots = [];
    for (const cave of [pc, gr]) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        icicleSpots.push({
          x: cave.x + Math.cos(a) * cave.r * 1.1,
          z: cave.z + Math.sin(a) * cave.r * 1.1,
          y: cave.floor + cave.r * 0.62,
          r: a, s: 0.6 + (i % 4) * 0.3,
        });
      }
    }
    group.add(
      instanced(new THREE.ConeGeometry(0.22, 1.6, 5), emissiveMat('#dff4fc', '#1d3a52', { transparent: true, opacity: 0.85 }), icicleSpots,
        (sp, P, E, S) => { P.set(sp.x, sp.y, sp.z); E.set(Math.PI, sp.r, 0); S.setScalar(sp.s); })
    );
  }
  // volcano: lava cavern — dark red shell over the lava-ring floor, dark tree
  {
    const gr = v.grotto;
    const shell = caveShell(gr.r * 1.22, lavaShellMat, gr.x, gr.z, 0, 0);
    shell.position.set(gr.x, gr.floor - 0.4, gr.z);
    shell.scale.set(1, 0.85, 1);
    group.add(shell);
    const tree = magicTree(emissiveMat('#5d1410', '#36080a'), 1.2);
    tree.position.set(gr.x, gr.floor, gr.z);
    group.add(tree);
    const glow = glowSprite('#ff6a30', 11);
    glow.position.set(gr.x, gr.floor + 3.4, gr.z);
    group.add(glow);
    glows.push(glow);
    trunks.push({ x: gr.x, z: gr.z, r: 1.3 });
    // red-hot stalactites hanging inside
    const stalSpots = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      stalSpots.push({
        x: gr.x + Math.cos(a) * gr.r * 0.7, z: gr.z + Math.sin(a) * gr.r * 0.7,
        y: gr.floor + gr.r * 0.72, r: a, s: 0.7 + (i % 3) * 0.4,
      });
    }
    group.add(
      instanced(new THREE.ConeGeometry(0.4, 2.6, 5), emissiveMat('#e83a20', '#7a1208'), stalSpots,
        (sp, P, E, S) => { P.set(sp.x, sp.y, sp.z); E.set(Math.PI, sp.r, 0); S.setScalar(sp.s); })
    );
  }
  // skylands: translucent magic tree in a hedge garden over the cloud pool
  {
    const isle = WORLD.sky.islands[WORLD.sky.pond.island];
    const px = isle.x + WORLD.sky.pond.x, pz = isle.z + WORLD.sky.pond.z;
    const py = isle.top + 0.35;
    const tree = magicTree(emissiveMat('#dff2f8', '#4a7a8a', { transparent: true, opacity: 0.85 }), 1.3);
    tree.position.set(px, py - 0.2, pz);
    group.add(tree);
    const glow = glowSprite('#cfeefc', 13);
    glow.position.set(px, py + 4, pz);
    group.add(glow);
    glows.push(glow);
    // hedge ring with a gap, like the garden in the reference
    const hedgeMat = lambert('#3e7a36');
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      if (a > 5.0 && a < 5.9) continue; // gateway gap
      const hx = px + Math.cos(a) * (WORLD.sky.pond.r + 5);
      const hz = pz + Math.sin(a) * (WORLD.sky.pond.r + 5);
      const hy = skySurface(hx, hz);
      if (hy == null) continue;
      const hedge = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 1.4), hedgeMat);
      hedge.position.set(hx, hy + 1.0, hz);
      hedge.rotation.y = a + Math.PI / 2;
      group.add(hedge);
      trunks.push({ x: hx, z: hz, r: 1.4 });
    }
  }

  // ============ JUNGLE VINES (saggy tubes from the canopy) ============
  {
    const vineMat = lambert('#8a3c2e');
    const leafMat = lambert('#46aa50');
    const spots = scatterIn(rng, Math.floor(26 * q), j.x, j.z, j.r * 0.9, (b) => b === 'jungle');
    for (const sp of spots) {
      const top = sp.y + 11 + sp.r * 3;
      const sway = 2.2 + sp.r * 2;
      const pts = [
        new THREE.Vector3(sp.x, top, sp.z),
        new THREE.Vector3(sp.x + sway * 0.5, top - 3.2, sp.z + sway * 0.3),
        new THREE.Vector3(sp.x + sway * 0.2, top - 6.4, sp.z + sway * 0.7),
        new THREE.Vector3(sp.x + sway * 0.6, Math.max(sp.y + 1.4, top - 9.5), sp.z + sway * 0.2),
      ];
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.09 + sp.r * 0.05, 5, false), vineMat);
      group.add(tube);
      const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), leafMat);
      tip.position.copy(pts[3]);
      tip.scale.set(1, 0.6, 1);
      group.add(tip);
    }
  }

  // ============ WATERFALLS ============
  const fallTex = waterfallTexture();
  const fallMats = [];
  const makeFall = (x, z, topY, botY, w, ry) => {
    const h = topY - botY;
    if (h < 2) return;
    const mat = new THREE.MeshBasicMaterial({
      map: fallTex.clone(), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    });
    mat.map.repeat.set(w / 6, h / 14);
    fallMats.push(mat);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    sheet.position.set(x, (topY + botY) / 2, z);
    sheet.rotation.y = ry;
    group.add(sheet);
    // translucent body behind the streaks so the fall reads from any angle
    const body = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h),
      new THREE.MeshLambertMaterial({ color: '#9fd4f0', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    body.position.copy(sheet.position);
    body.rotation.y = ry;
    group.add(body);
    // foam at the base
    const foam = new THREE.Mesh(new THREE.CircleGeometry(w * 0.55, 10),
      new THREE.MeshLambertMaterial({ color: '#eef8ff', transparent: true, opacity: 0.7 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(x, botY + 0.15, z);
    group.add(foam);
  };
  // jungle cliff falls: from each lip down to the local low ground
  for (const f of j.falls) {
    const topY = height(f.x, f.z);
    let botY = topY;
    let bx = f.x, bz = f.z;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const hx = f.x + Math.cos(a) * 7, hz = f.z + Math.sin(a) * 7;
      const hh = height(hx, hz);
      if (hh < botY) { botY = hh; bx = hx; bz = hz; }
    }
    makeFall((f.x + bx) / 2, (f.z + bz) / 2, topY + 0.6, Math.max(botY, j.swampLevel - 0.4), 8, Math.atan2(bx - f.x, bz - f.z));
  }
  // frozen waterfall on the ice peak's south face (a solid icy sheet)
  {
    const fx = ic.peak.x - 24, fz = ic.peak.z + 38;
    const topY = height(fx, fz - 6) + 2;
    const botY = height(fx, fz + 8);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(7, Math.max(4, topY - botY)),
      emissiveMat('#bfe6f8', '#1d3a52', { transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    sheet.position.set(fx, (topY + botY) / 2, fz);
    sheet.rotation.x = -0.32;
    group.add(sheet);
  }
  // Skylands edge falls: pour off island rims and fade in the air
  {
    const pourers = [0, 1, 3, 7];
    pourers.forEach((idx, k) => {
      const isle = WORLD.sky.islands[idx];
      const a = 1.1 + k * 1.7;
      const ex = isle.x + Math.cos(a) * (isle.r - 1.5);
      const ez = isle.z + Math.sin(a) * (isle.r - 1.5);
      const top = (skySurface(ex, ez) ?? isle.top);
      makeFall(ex + Math.cos(a) * 1.2, ez + Math.sin(a) * 1.2, top, top - 24 - k * 4, 4.5, a + Math.PI / 2);
    });
  }
  tickers.push((time, dt) => {
    for (const m of fallMats) m.map.offset.y = (m.map.offset.y + dt * 0.7) % 1;
  });

  // ============ GLOWING MUSHROOMS (forest grotto + deep forest) ============
  {
    const spots = [];
    for (let i = 0; i < Math.floor(16 * q); i++) {
      const a = rng() * Math.PI * 2;
      const d = 3 + Math.sqrt(rng()) * fo.grotto.r * 0.75;
      const x = fo.grotto.x + Math.cos(a) * d, z = fo.grotto.z + Math.sin(a) * d;
      spots.push({ x, z, y: Y(x, z), r: rng(), s: 0.7 + rng() * 0.9 });
    }
    spots.push(...scatterIn(rng, Math.floor(20 * q), fo.x, fo.z, fo.r, (b) => b === 'forest'));
    group.add(
      instanced(new THREE.CylinderGeometry(0.09, 0.14, 0.55, 5), lambert('#d8e8d0'), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.25, sp.z); E.set(0, 0, (sp.r - 0.5) * 0.3); S.setScalar(sp.s); }),
      instanced(new THREE.SphereGeometry(0.3, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), emissiveMat('#7af084', '#1d7a30'), spots,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.5 * sp.s, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); })
    );
  }

  // ============ LILY PADS (forest pond + jungle swamp) ============
  {
    const pond = fo.pond;
    const pads = [];
    for (let i = 0; i < Math.floor(16 * q); i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * pond.r * 0.8;
      pads.push({ x: pond.x + Math.cos(a) * d, z: pond.z + Math.sin(a) * d, y: pond.surface + 0.04, r: rng(), s: 0.6 + rng() * 0.8 });
    }
    const swampPads = scatterIn(rng, Math.floor(30 * q), j.x, j.z, j.r, (b, x, z) => waterAt(x, z)?.kind === 'swamp')
      .map((sp) => ({ ...sp, y: j.swampLevel + 0.04 }));
    pads.push(...swampPads);
    group.add(
      instanced(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 7), lambert('#4f9a4f'), pads,
        (sp, P, E, S) => { P.set(sp.x, sp.y, sp.z); E.set(0, sp.r * 6, 0); S.setScalar(sp.s); })
    );
    const blooms = pads.filter((_, i) => i % 4 === 0);
    group.add(
      instanced(new THREE.SphereGeometry(0.2, 5, 4), lambert('#f08ac8'), blooms,
        (sp, P, E, S) => { P.set(sp.x, sp.y + 0.16, sp.z); E.set(0, 0, 0); S.setScalar(sp.s); })
    );
  }

  // ============ VOLCANO SPIKE RINGS (pink dragon-teeth) ============
  {
    const cx = v.x + 52, cz = v.z + 64;   // on the SE ash flats
    const toothMat = lambert('#e8b8c4');
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const d = 7 + (i % 2) * 2;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const h = 3.2 + (i % 3) * 1.4;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(1.0, h, 6), toothMat);
      tooth.position.set(x, Y(x, z) + h * 0.45, z);
      tooth.rotation.z = Math.sin(a * 2) * 0.3;
      group.add(tooth);
      trunks.push({ x, z, r: 0.9 });
    }
  }

  // crystal / pool glows pulse gently
  tickers.push((time) => {
    const f = 0.75 + 0.25 * Math.sin(time * 1.8);
    for (const g of glows) g.material.opacity = 0.5 * f;
  });

  return { group, trunks, tickers };
}
