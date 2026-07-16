// Wibit Simulator — a floating inflatable water park you bounce, climb, slide
// and swim around. Reuses the ClaudeBox avatar. Water physics: fall in and you
// swim, then climb back out at any edge. Every obstacle has its own action
// (trampoline bounce, blast-bag launch, iceberg climb, slide, wiggle bridge,
// balance beam, stepping pods, log roll, tower swing). Periodic Wipeout rounds:
// last one out of the water wins.

import * as THREE from 'three';
import { fpFade } from '/js/fpzoom.js';
import { loadIdentity } from '/backpacking/js/player/avatar.js';
import { preloadAvatars, makeAvatar } from '/shared/avatar3d.js';
import { Net, InterpBuffer } from './net.js';
import {
  PARK, PARTS, COLLIDERS, WIGGLES, LOGS, SWINGS, ICEBERG,
  WATER_Y, DECK, THK, C, SPAWN, SHORE_Z,
  wiggleOffset, logAngle, logPush, swingState, applyWorld,
} from '/shared/wibit/park.js';
import { toWibitWorld } from '/shared/studio/adapters.js';

// a wedge (ramp) prism geometry for custom Studio levels
function primWedge(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const v = [-hx, hy, hz, -hx, -hy, hz, hx, -hy, hz, -hx, hy, -hz, -hx, -hy, -hz, hx, -hy, -hz];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 5, 4, 3, 0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2, 0, 3, 4, 0, 4, 1]);
  g.computeVertexNormals(); return g;
}

const $ = (s) => document.querySelector(s);
const canvas = $('#game-canvas');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fd6f2');
scene.fog = new THREE.Fog('#a7e0f5', 140, 620);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight('#dff3ff', '#2a6e8c', 1.0); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff6e0', 1.05);
sun.position.set(80, 160, 60); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160; sun.shadow.camera.far = 760;
scene.add(sun); scene.add(sun.target);

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

// ---------- water ----------
let waterMesh;
{
  const geo = new THREE.PlaneGeometry(1400, 1400, 60, 60);
  geo.rotateX(-Math.PI / 2);
  waterMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: '#1f93c9', transparent: true, opacity: 0.88, emissive: '#0a3a55', emissiveIntensity: 0.25,
  }));
  waterMesh.position.y = WATER_Y;
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);
  // a deep underwater volume so edges read as water, not a sheet
  const deep = new THREE.Mesh(new THREE.BoxGeometry(1400, 30, 1400), lam('#0e5377'));
  deep.position.y = WATER_Y - 15.2; scene.add(deep);
  geo.userData.base = Float32Array.from(geo.attributes.position.array);
}

// ---------- distant mountains + beach feel ----------
{
  for (let i = 0; i < 7; i++) {
    const ang = (-0.7 + i * 0.22);
    const r = 600;
    const m = new THREE.Mesh(new THREE.ConeGeometry(120 + (i % 3) * 40, 130 + (i % 2) * 70, 4),
      lam(i % 2 ? '#5e7d6a' : '#6f8f79'));
    m.position.set(Math.sin(ang) * r, 30, -Math.cos(ang) * r - 120);
    m.rotation.y = ang; scene.add(m);
  }
}

// ---------- build the park ----------
const wiggleMeshes = [], logMeshes = [], swingSeats = [];
const roundedTop = (w, d, color, top, h = THK, trim) => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  body.position.y = top - h / 2; body.castShadow = body.receiveShadow = true; g.add(body);
  // bright top cap
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.18, d * 0.96), lam(C.lime));
  cap.position.y = top - 0.02; cap.receiveShadow = true; g.add(cap);
  if (trim) {
    const tb = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), lam(trim));
    tb.position.y = top - h + 0.25; g.add(tb);
  }
  return g;
};

function buildPark() {
  for (const p of PARTS) {
    let g = null;
    switch (p.kind) {
      case 'prim': {   // generic primitive from a ClaudeBox Studio level
        let geo;
        if (p.shape === 'cylinder') geo = new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.h, 20);
        else if (p.shape === 'sphere') geo = new THREE.SphereGeometry(p.w / 2, 18, 12);
        else if (p.shape === 'ramp') geo = primWedge(p.w, p.h, p.d);
        else geo = new THREE.BoxGeometry(p.w, p.h, p.d);
        g = new THREE.Mesh(geo, lam(p.color));
        g.position.set(p.x, p.y, p.z); g.rotation.y = p.rotY || 0; g.castShadow = g.receiveShadow = true; break;
      }
      case 'beach': {
        g = new THREE.Mesh(new THREE.BoxGeometry(p.w, 2, p.d), lam('#e8d6a0'));
        g.position.set(p.x, -0.4, p.z); g.receiveShadow = true; break;
      }
      case 'dock': {
        g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.8, p.d), lam('#9c7a4f'));
        base.position.y = p.top - 0.4; base.receiveShadow = true; g.add(base);
        for (let i = 0; i < 8; i++) {
          const plank = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.12, 1.2), lam(i % 2 ? '#b08a5c' : '#a07d50'));
          plank.position.set(0, p.top + 0.06, -p.d / 2 + 2 + i * (p.d / 9));
          g.add(plank);
        }
        g.position.set(p.x, 0, p.z); break;
      }
      case 'deck': {
        g = roundedTop(p.w, p.d, p.color, p.top, THK, p.trim);
        g.position.set(p.x, 0, p.z);
        // collider length lies along world angle p.rot; three.js Ry maps local +X
        // to angle -θ, so negate to make the rendered deck match its collider.
        if (p.rot) g.rotation.y = -p.rot;
        break;
      }
      case 'pillar': {            // inflatable support column under a raised deck
        const h = p.top - THK;
        g = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, h, 12), lam(p.color || C.blueDk));
        g.position.set(p.x, h / 2, p.z); g.castShadow = true; break;
      }
      case 'tramp': {
        g = new THREE.Group();
        const frame = new THREE.Mesh(new THREE.BoxGeometry(p.size, THK, p.size), lam(C.green));
        frame.position.y = p.top - THK / 2; frame.castShadow = frame.receiveShadow = true; g.add(frame);
        const lip = new THREE.Mesh(new THREE.BoxGeometry(p.size, 0.6, p.size), lam(C.blue));
        lip.position.y = p.top + 0.1; g.add(lip);
        const mat = new THREE.Mesh(new THREE.BoxGeometry(p.size - 1.8, 0.3, p.size - 1.8), lam(C.trampMat));
        mat.position.y = p.top - 0.05; g.add(mat);
        g.position.set(p.x, 0, p.z); break;
      }
      case 'step': {
        g = roundedTop(p.w, p.d, p.color, p.top, THK, C.greenDk);
        g.position.set(p.x, 0, p.z); break;
      }
      case 'tower': {
        g = new THREE.Group();
        const tube = (x, z) => {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, p.top + 2.2, 10), lam(C.yellow));
          t.position.set(x, (p.top + 2.2) / 2, z); t.castShadow = true; g.add(t);
        };
        const h = p.w / 2 - 0.5;
        tube(-h, -h); tube(h, -h); tube(-h, h); tube(h, h);
        const deckMesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.6, p.d), lam(C.green));
        deckMesh.position.y = p.top; deckMesh.castShadow = deckMesh.receiveShadow = true; g.add(deckMesh);
        // top rail crossbars
        const rail = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.35, 0.35), lam(C.yellowDk));
        rail.position.set(0, p.top + 2.2, -h); g.add(rail.clone());
        rail.position.z = h; g.add(rail);
        g.position.set(p.x, 0, p.z); break;
      }
      case 'slide': {
        g = new THREE.Group();
        const len = p.len, ang = Math.atan2(p.topHi - p.topLo, len);
        const surf = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.4, len + 0.4), lam(p.color));
        surf.rotation.x = -ang; surf.position.y = (p.topHi + p.topLo) / 2; surf.castShadow = surf.receiveShadow = true;
        g.add(surf);
        // side rails
        for (const s of [-1, 1]) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, len), lam(C.blue));
          r.rotation.x = -ang; r.position.set(s * (p.w / 2 - 0.1), (p.topHi + p.topLo) / 2 + 0.5, 0);
          g.add(r);
        }
        g.position.set(p.x, 0, p.z); g.rotation.y = -p.dir + Math.PI / 2; break;
      }
      case 'blast': {
        g = new THREE.Group();
        // a big inflated wedge: tall lip on the launch side sloping down behind
        const wedge = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.top, p.d), lam(C.yellow));
        wedge.rotation.x = -0.5; wedge.position.y = p.top / 2; wedge.castShadow = wedge.receiveShadow = true;
        g.add(wedge);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.d, 16), lam(C.green));
        cap.rotation.z = Math.PI / 2; cap.position.y = p.top; g.add(cap);
        g.position.set(p.x, 0, p.z); g.rotation.y = -p.dir + Math.PI / 2; break;
      }
      case 'beam': {
        g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(p.len, 0.7, p.w), lam(p.color));
        b.castShadow = b.receiveShadow = true; b.position.y = p.top - 0.35; g.add(b);
        const top = new THREE.Mesh(new THREE.BoxGeometry(p.len, 0.18, p.w * 0.7), lam(C.blue));
        top.position.y = p.top; g.add(top);
        g.position.set(p.x, 0, p.z); g.rotation.y = -p.dir; break;   // match collider (see deck note)
      }
      case 'pod': {
        g = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.05, THK, 18), lam(p.color));
        disc.position.y = p.top - THK / 2; disc.castShadow = disc.receiveShadow = true; g.add(disc);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.85, p.r * 0.85, 0.16, 18), lam(C.blue));
        cap.position.y = p.top; g.add(cap);
        g.position.set(p.x, 0, p.z); break;
      }
      case 'iceberg': {
        const ice = p.ref;
        g = new THREE.Group();
        const cone = new THREE.Mesh(new THREE.ConeGeometry(ice.baseR, ice.top, 7), lam(C.ice));
        cone.position.y = ice.top / 2; cone.castShadow = cone.receiveShadow = true; g.add(cone);
        const cone2 = new THREE.Mesh(new THREE.ConeGeometry(ice.baseR * 0.6, ice.top * 1.25, 6), lam(C.iceDk));
        cone2.position.set(ice.baseR * 0.25, ice.top * 0.62, -ice.baseR * 0.2); cone2.rotation.y = 1; g.add(cone2);
        // handholds
        let s = 11;
        const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let i = 0; i < 26; i++) {
          const hh = rnd() * 0.75; const rr = ice.baseR * (1 - hh) * (0.6 + rnd() * 0.4);
          const a = rnd() * Math.PI * 2;
          const hold = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), lam(i % 3 ? '#3fb6ff' : '#ff6b4a'));
          hold.position.set(Math.cos(a) * rr, hh * ice.top + 0.3, Math.sin(a) * rr); g.add(hold);
        }
        g.position.set(ice.x, 0, ice.z); break;
      }
      case 'swingframe': {
        g = new THREE.Group();
        // hang bar held by the tower; the moving seat is added to swingSeats
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5, 8), lam(C.yellowDk));
        bar.rotation.z = Math.PI / 2; bar.position.y = p.top; g.add(bar);
        g.position.set(p.x, 0, p.z); break;
      }
    }
    if (g) scene.add(g);
  }

  // dynamic: wiggle bridges
  for (const w of WIGGLES) {
    const m = roundedTop(w.len, w.w, C.blue, w.top, THK, C.green);
    m.rotation.y = w.dir; scene.add(m);
    wiggleMeshes.push({ spec: w, mesh: m });
  }
  // dynamic: rolling logs (length baked along X so rolling = rotation.x)
  for (const l of LOGS) {
    const grp = new THREE.Group();
    const roller = new THREE.Group();
    const cylGeo = new THREE.CylinderGeometry(l.r, l.r, l.len, 16); cylGeo.rotateZ(Math.PI / 2);
    const cyl = new THREE.Mesh(cylGeo, lam(C.yellow)); cyl.castShadow = true; roller.add(cyl);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(l.len, 0.16, 0.55), lam(C.blue));
    stripe.position.y = l.r * 0.92; roller.add(stripe);
    grp.add(roller);
    grp.position.set(l.x, l.top, l.z); grp.rotation.y = l.dir;
    scene.add(grp);
    logMeshes.push({ spec: l, roller });
  }
  // dynamic: swing seats
  for (const s of SWINGS) {
    const seat = new THREE.Group();
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), lam('#cfd8e6'));
    t1.position.y = 0.8; seat.add(t1);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 12), lam(C.yellow));
    seat.add(bar);
    scene.add(seat);
    swingSeats.push({ spec: s, seat });
  }
}
// buildPark() is deferred to boot(), after any custom Studio level is loaded

// ---------- player controller ----------
const R = 0.4, G = 26, JUMP = 13.4, MOVE = 8, RUN = 13;
// cranked way up: huge bounces, big catapult launches, fast slides, lots of air
const TRAMP_BOUNCE = 19, BLAST_H = 26, BLAST_V = 31, SLIDE_SPEED = 26;
const AIR_CONTROL = 0.04;   // gentle mid-air steering that preserves launch momentum
const SWIM_SPEED = 4.6, SWIM_Y = -0.3, WATER_ENTER = 0.55, CLIMB_REACH = 2.7, CLIMB_RATE = 7;

const player = {
  pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z }, vel: { x: 0, y: 0, z: 0 },
  ry: Math.PI, grounded: false, anim: 'idle', sprint: false,
};
const game = { swimming: false, out: false, onSwing: null, swingCd: 0, splashed: false, sliding: false };
let lastBlast = 0;

// unified support query at (x,z) you can reach down onto from fromY at time t
function supportUnder(x, z, fromY, time) {
  let best = -Infinity, kind = null, ref = null, slopeDir = 0;
  const consider = (top, k, r, sd) => {
    if (top <= fromY + 0.65 && top > best) { best = top; kind = k; ref = r; slopeDir = sd || 0; }
  };
  for (const c of COLLIDERS) {
    if (c.shape === 'box') {
      if (x > c.x - c.w / 2 - R && x < c.x + c.w / 2 + R && z > c.z - c.d / 2 - R && z < c.z + c.d / 2 + R)
        consider(c.top, c.kind, c.ref);
    } else if (c.shape === 'obox') {
      const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.dir), sn = Math.sin(c.dir);
      const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
      if (Math.abs(lx) < c.w / 2 + R && Math.abs(lz) < c.d / 2 + R) consider(c.top, c.kind, c.ref);
    } else if (c.shape === 'circle') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + R) consider(c.top, c.kind, c.ref);
    } else if (c.shape === 'ramp') {
      const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.dir), sn = Math.sin(c.dir);
      const u = dx * cs + dz * sn, v = -dx * sn + dz * cs;     // u along downhill, v across
      if (Math.abs(u) < c.len / 2 + R && Math.abs(v) < c.w / 2 + R) {
        const t = (u + c.len / 2) / c.len;                      // 0 at high end, 1 at low end
        consider(c.topHi + (c.topLo - c.topHi) * t, c.kind, c, c.dir);
      }
    }
  }
  // dynamic wiggle bridges
  for (const w of WIGGLES) {
    const o = wiggleOffset(w, time);
    const cx = w.x + o.dx, cz = w.z + o.dz;
    const dx = x - cx, dz = z - cz, cs = Math.cos(w.dir), sn = Math.sin(w.dir);
    const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
    if (Math.abs(lx) < w.len / 2 + R && Math.abs(lz) < w.w / 2 + R) consider(w.top + o.dy, 'wiggle', w);
  }
  // dynamic rolling logs (stand on the top of the cylinder)
  for (const l of LOGS) {
    const dx = x - l.x, dz = z - l.z, cs = Math.cos(l.dir), sn = Math.sin(l.dir);
    const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;     // lx along axis, lz across
    if (Math.abs(lx) < l.len / 2 + R && Math.abs(lz) < l.r + R) consider(l.top + l.r, 'log', l);
  }
  // the iceberg cone (climbable slope)
  {
    const d = Math.hypot(x - ICEBERG.x, z - ICEBERG.z);
    if (d < ICEBERG.baseR + R) {
      const h = Math.max(0.35, ICEBERG.top * (1 - d / ICEBERG.baseR));
      consider(h, 'iceslope', ICEBERG);
    }
  }
  return { top: best, kind, ref, slopeDir };
}

let jumpAt = -1, coyoteUntil = 0;

function updatePlayer(dt, input, time) {
  const now = performance.now() / 1000;

  // ----- swing ride -----
  if (game.onSwing) {
    const st = swingState(game.onSwing.s, time);
    player.pos.x = st.seatX; player.pos.y = st.seatY - 1.5; player.pos.z = st.seatZ;
    player.ry = game.onSwing.s.dir + Math.PI;
    player.anim = 'sit'; player.grounded = false;
    hint('🪢 On the swing! Press ⎵ to let go');
    if (input.jump || time - game.onSwing.grabbed > 2.4) {
      const d = game.onSwing.s.dir;
      player.vel.x = Math.cos(d) * 17; player.vel.z = Math.sin(d) * 17; player.vel.y = 11;
      game.swingCd = time + 1.2; game.onSwing = null; jumpAt = -1;
    }
    return;
  }
  // try to grab a swing if you're airborne near its seat
  if (!game.swimming && time > game.swingCd) {
    for (const s of SWINGS) {
      const st = swingState(s, time);
      if (Math.hypot(player.pos.x - st.seatX, player.pos.z - st.seatZ) < 2.0 &&
          Math.abs(player.pos.y - (st.seatY - 1.5)) < 2.2 && !player.grounded) {
        game.onSwing = { s, grabbed: time }; player.vel = { x: 0, y: 0, z: 0 }; return;
      }
    }
  }

  // ----- movement wish (camera-relative) -----
  const mx = input.x, mz = input.z;
  const moving = Math.hypot(mx, mz) > 0.05;
  const yaw = orbit.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let wishX = fx * mz + rx * mx, wishZ = fz * mz + rz * mx;
  const wl = Math.hypot(wishX, wishZ) || 1; wishX /= wl; wishZ /= wl;
  if (moving) player.ry = Math.atan2(wishX, wishZ);

  // ===== SWIMMING =====
  if (game.swimming) {
    // paddle around
    player.vel.x = moving ? wishX * SWIM_SPEED : player.vel.x * 0.8;
    player.vel.z = moving ? wishZ * SWIM_SPEED : player.vel.z * 0.8;
    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;
    // tread water when still, swim stroke when moving
    player.anim = moving ? 'swim' : 'tread';
    // is there a ledge within reach to climb out onto?
    const reachFrom = Math.max(player.pos.y, WATER_Y) + CLIMB_REACH;
    const sup = supportUnder(player.pos.x, player.pos.z, reachFrom, time);
    const canClimb = sup.top > WATER_Y + 0.2 && sup.top <= player.pos.y + CLIMB_REACH && (moving || input.jump);
    if (canClimb) {
      // rise toward the ledge — do NOT also apply the float-bob, or it fights the
      // climb and you can never finish getting out (the "can't stop swimming" bug)
      player.pos.y = Math.min(sup.top, player.pos.y + CLIMB_RATE * dt);
      if (player.pos.y >= sup.top - 0.08) {
        player.pos.y = sup.top; player.grounded = true; player.vel.y = 0;
        hint('🏖️ Out of the water!');
        leaveWater();
      } else {
        hint('🧗 Climbing out — keep going!');
      }
    } else {
      // just floating: bob to the surface
      player.pos.y += (SWIM_Y - player.pos.y) * Math.min(1, dt * 4);
      hint('🏊 Swim to an edge (hold toward it) — or 🏖️ to reset');
    }
    return;
  }

  // ===== ON LAND / IN AIR =====
  const sp = player.sprint ? RUN : MOVE;
  if (!game.sliding) {
    if (player.grounded) {
      // responsive ground control
      player.vel.x = wishX * (moving ? sp : 0);
      player.vel.z = wishZ * (moving ? sp : 0);
    } else if (moving) {
      // airborne: steer gently toward input but keep launch/bounce momentum
      player.vel.x += (wishX * sp - player.vel.x) * AIR_CONTROL;
      player.vel.z += (wishZ * sp - player.vel.z) * AIR_CONTROL;
    }
    // airborne with no input → momentum preserved (you stay launched)
  }

  const prevY = player.pos.y;
  player.vel.y -= G * dt;
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;

  const sup = supportUnder(player.pos.x, player.pos.z, prevY, time);
  player.grounded = false; game.sliding = false;
  let onHint = null;

  if (player.vel.y <= 0 && sup.top > -Infinity && player.pos.y <= sup.top && prevY >= sup.top - 0.6) {
    player.pos.y = sup.top; player.vel.y = 0; player.grounded = true;

    switch (sup.kind) {
      case 'tramp': {
        player.vel.y = TRAMP_BOUNCE * (input.jump ? 1.45 : 1);
        player.grounded = false; onHint = 'Trampoline! Hold ⎵ for a bigger bounce';
        break;
      }
      case 'blast': {
        if (now - lastBlast > 0.5) {
          lastBlast = now;
          const d = (sup.ref && sup.ref.dir != null) ? sup.ref.dir : player.ry;
          const vh = sup.ref?.vh ?? BLAST_H, vv = sup.ref?.vv ?? BLAST_V;
          player.vel.x = Math.cos(d) * vh; player.vel.z = Math.sin(d) * vh; player.vel.y = vv;
          player.grounded = false; onHint = '💥 BLAST OFF!';
        }
        break;
      }
      case 'slide': {
        game.sliding = true;
        const d = sup.slopeDir;
        player.vel.x = Math.cos(d) * SLIDE_SPEED + wishX * 2;
        player.vel.z = Math.sin(d) * SLIDE_SPEED + wishZ * 2;
        player.anim = 'sit'; onHint = '🛝 Wheee!';
        break;
      }
      case 'log': {
        const push = logPush(sup.ref);
        player.pos.x += push.x * push.mag * dt;
        player.pos.z += push.z * push.mag * dt;
        onHint = '🪵 Log roll — keep your footing!';
        break;
      }
      case 'iceslope': {
        if (!moving) { // slide gently back down the ice when you stop climbing
          const dx = player.pos.x - ICEBERG.x, dz = player.pos.z - ICEBERG.z;
          const dl = Math.hypot(dx, dz) || 1;
          player.pos.x += (dx / dl) * 2.4 * dt; player.pos.z += (dz / dl) * 2.4 * dt;
        }
        onHint = '🧗 Climb the iceberg — head for the top!';
        break;
      }
      case 'wiggle': onHint = '🌉 Wiggle bridge — wobbly!'; break;
      case 'beam': onHint = '⚖️ Balance beam — don\'t slip!'; break;
      case 'pod': onHint = '🟢 Hop pod to pod!'; break;
    }
  }

  // jump (buffered + coyote), works off any solid footing incl. slides/icebergs
  if (player.grounded || game.sliding) coyoteUntil = now + 0.1;
  const recentlyPressed = jumpAt >= 0 && now - jumpAt < 0.15;
  if (recentlyPressed && now < coyoteUntil) {
    player.vel.y = JUMP; player.grounded = false; coyoteUntil = 0; jumpAt = -1;
  }

  // fall into the water
  if (!player.grounded && player.pos.y < WATER_ENTER) enterWater();

  // animation
  if (!game.swimming && !game.sliding) {
    if (!player.grounded) player.anim = player.vel.y > 1 ? 'jump' : 'fall';
    else if (moving) player.anim = player.sprint ? 'run' : 'walk';
    else player.anim = 'idle';
  }

  if (onHint) hint(onHint);
}

function enterWater() {
  if (game.swimming) return;
  game.swimming = true;
  player.grounded = false;
  player.vel.y = 0;
  if (!game.splashed) {
    game.splashed = true;
    net.send({ t: 'splash' });
    splashFx(player.pos.x, player.pos.z);
    $('#swim-veil').classList.remove('hidden');
    setTimeout(() => $('#swim-veil').classList.add('hidden'), 1500);
  }
}
function leaveWater() {
  game.swimming = false;
  game.splashed = false;
  player.vel = { x: 0, y: 0, z: 0 };
}

// ---------- camera (third-person orbit) ----------
const orbit = { yaw: Math.PI, pitch: 0.5, dist: 11 };
function updateCamera() {
  const tx = player.pos.x, ty = player.pos.y + 1.6, tz = player.pos.z;
  const cp = Math.cos(orbit.pitch);
  const cx = tx + Math.sin(orbit.yaw) * cp * orbit.dist;
  const cy = ty + Math.sin(orbit.pitch) * orbit.dist;
  const cz = tz + Math.cos(orbit.yaw) * cp * orbit.dist;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.55);
  camera.lookAt(tx, ty, tz);
}

// ---------- avatars ----------
const myAvatar = { ctrl: null, group: null };
const remotes = new Map();

function nameSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px Trebuchet MS'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#eaf6ff'; x.strokeStyle = 'rgba(0,40,70,.85)'; x.lineWidth = 5;
  x.strokeText(name, 128, 40); x.fillText(name, 128, 40);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  spr.scale.set(3.2, 0.8, 1); spr.position.y = 2.7;
  return spr;
}
// the swim/tread animation clips now define posture, so no manual body tilt

function makeRemote(d) {
  const ctrl = makeAvatar(d.avatar || {});
  const spr = nameSprite(d.name);
  ctrl.group.add(spr);
  scene.add(ctrl.group);
  const rec = { ctrl, group: ctrl.group, interp: new InterpBuffer(), data: d, nameSprite: spr };
  remotes.set(d.id, rec);
  return rec;
}

// ---------- networking ----------
const net = new Net();
let identity = null;
let roundState = { phase: 'intermission', endsAt: 0, left: 0, lastWinner: null };

net.on('welcome', (msg) => {
  for (const d of msg.players) makeRemote(d);
  if (msg.round) roundState = msg.round;
  $('#loading').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  toast('Welcome to the Wibit! 🏊  Bounce, climb, splash!');
});
net.on('player.join', (m) => { if (m.player.id !== net.id && !remotes.has(m.player.id)) makeRemote(m.player); });
net.on('player.leave', (m) => { const r = remotes.get(m.id); if (r) { scene.remove(r.group); remotes.delete(m.id); } });
net.on('snapshot', (m) => {
  serverTime = m.clock;
  if (m.round) roundState = m.round;
  for (const row of m.players) {
    const [id, x, y, z, ry, anim, swim] = row;
    if (id === net.id) continue;
    const r = remotes.get(id); if (!r) continue;
    r.interp.push([x, y, z, ry, anim, swim]);
  }
});
net.on('round.start', (m) => {
  roundState.phase = 'active'; roundState.endsAt = m.endsAt;
  game.out = false; $('#out-veil').classList.add('hidden'); $('#win-veil').classList.add('hidden');
  toast('🏁 WIPEOUT! Don\'t fall in — last one dry wins!');
});
net.on('round.out', (m) => {
  if (m.id === net.id) {
    game.out = true;
    $('#out-veil').classList.remove('hidden');
    setTimeout(() => $('#out-veil').classList.add('hidden'), 2600);
  }
});
net.on('round.end', (m) => {
  roundState.phase = 'intermission'; roundState.endsAt = m.nextAt; roundState.lastWinner = m.winner?.name || null;
  if (m.winner && m.winner.id === net.id) {
    $('#win-text').textContent = 'You won the Wipeout! 🏆';
    $('#win-veil').classList.remove('hidden');
    setTimeout(() => $('#win-veil').classList.add('hidden'), 4000);
    window.ClaudeBox?.completeChallenge('wibit-survive');
  }
  game.out = false; $('#out-veil').classList.add('hidden');
});
net.on('chat', (m) => addChat(m));
net.on('_disconnect', () => toast('Disconnected — refresh to rejoin.'));

let serverTime = 0;

// ---------- splash fx ----------
const splashes = [];
function splashFx(x, z) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.7, 18),
    new THREE.MeshBasicMaterial({ color: '#dffaff', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, WATER_Y + 0.06, z); scene.add(ring);
  splashes.push({ ring, ttl: 0.9 });
}

// ---------- chat / toast / hint ----------
function addChat(m) {
  const log = $('#chat-log');
  const div = document.createElement('div'); div.className = 'chat-line';
  div.innerHTML = `<span class="nm ${m.id === 'sys' ? 'sys' : ''}">${esc(m.name)}</span> ${esc(m.text)}`;
  log.appendChild(div);
  while (log.children.length > 9) log.removeChild(log.firstChild);
}
function toast(text) {
  const t = document.createElement('div'); t.className = 'wb-toast'; t.textContent = text;
  $('#wb-toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let hintText = '', hintUntil = 0;
function hint(text) {
  const el = $('#action-hint');
  if (text !== hintText) { el.textContent = text; el.classList.remove('hidden'); hintText = text; }
  hintUntil = performance.now() + 900;
}

// ---------- round HUD ----------
function updateRoundHud() {
  const phaseEl = $('#round-phase'), subEl = $('#round-sub');
  const secs = Math.max(0, Math.ceil((roundState.endsAt - Date.now()) / 1000));
  if (roundState.phase === 'active') {
    phaseEl.textContent = game.out ? '🌊 You\'re OUT' : '🏁 WIPEOUT';
    phaseEl.classList.add('active');
    subEl.textContent = `${secs}s left · ${roundState.left} still in`;
  } else {
    phaseEl.textContent = 'Free Roam';
    phaseEl.classList.remove('active');
    subEl.textContent = roundState.lastWinner
      ? `Last winner: ${roundState.lastWinner} · next round ${secs}s`
      : `Next Wipeout in ${secs}s`;
  }
}

// ---------- input ----------
const keys = new Set();
let dragging = false, lastX = 0, lastY = 0, locked = false;
const typing = () => { const e = document.activeElement; return e && e.tagName === 'INPUT'; };
addEventListener('keydown', (e) => {
  if (typing()) { if (e.code === 'Enter') sendChat(); if (e.code === 'Escape') $('#chat-input').blur(); return; }
  keys.add(e.code);
  if (e.code === 'Space') { jumpAt = performance.now() / 1000; e.preventDefault(); }
  if (e.code === 'Enter') openChat();
  if (e.code === 'KeyR') resetToDock();
});
addEventListener('keyup', (e) => keys.delete(e.code));

canvas.addEventListener('click', () => { if (!locked && !typing()) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
canvas.addEventListener('mousedown', (e) => { if (!locked) { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', (e) => {
  if (locked) { orbit.yaw -= e.movementX * 0.0024; orbit.pitch += e.movementY * 0.0024; clampPitch(); return; }
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastX) * 0.005; orbit.pitch += (e.clientY - lastY) * 0.005; clampPitch();
  lastX = e.clientX; lastY = e.clientY;
});
function clampPitch() { orbit.pitch = Math.max(-0.2, Math.min(1.25, orbit.pitch)); }
const clampDist = (d) => Math.max(0.3, Math.min(24, d));   // 0.3 = zoomed all the way in (first-person)
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = clampDist(orbit.dist + e.deltaY * 0.01); }, { passive: false });

// touch: one-finger drag on the canvas looks around, two-finger pinch zooms.
// The joystick/jump buttons are separate elements, so their touches never land here.
const camTouches = new Map();
let pinchDist = 0;
canvas.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) camTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
  if (camTouches.size === 2) {
    const [a, b] = [...camTouches.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    const p = camTouches.get(t.identifier); if (!p) continue;
    if (camTouches.size === 1) { orbit.yaw -= (t.clientX - p.x) * 0.005; orbit.pitch += (t.clientY - p.y) * 0.005; clampPitch(); }
    p.x = t.clientX; p.y = t.clientY;
  }
  if (camTouches.size === 2) {
    const [a, b] = [...camTouches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist) orbit.dist = clampDist(orbit.dist - (d - pinchDist) * 0.02);   // spread = zoom in
    pinchDist = d;
  }
}, { passive: true });
const endCamTouch = (e) => { for (const t of e.changedTouches) camTouches.delete(t.identifier); pinchDist = 0; };
canvas.addEventListener('touchend', endCamTouch, { passive: true });
canvas.addEventListener('touchcancel', endCamTouch, { passive: true });

function readInput() {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const z = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  player.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  return { x, z, jump: keys.has('Space') };
}

function resetToDock() {
  player.pos = { x: SPAWN.x + (Math.random() * 2 - 1), y: SPAWN.y, z: SPAWN.z };
  player.vel = { x: 0, y: 0, z: 0 };
  leaveWater(); game.onSwing = null;
}
$('#reset-btn').onclick = resetToDock;

// chat
function openChat() { if (locked) document.exitPointerLock?.(); $('#chat-input-row').classList.remove('hidden'); $('#chat-input').focus(); }
function sendChat() {
  const inp = $('#chat-input'); const text = inp.value.trim();
  if (text) net.send({ t: 'chat', text });
  inp.value = ''; inp.blur(); $('#chat-input-row').classList.add('hidden');
}
$('#chat-send').onclick = sendChat;

// ---------- mobile ----------
let mobileStick = null;
(function setupMobile() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  $('#move-cluster').classList.remove('hidden');
  const base = $('#joystick-base'), knob = $('#joystick-knob'); const stick = { x: 0, z: 0 };
  let touchId = null, cx = 0, cy = 0;
  const zone = $('#joystick-zone');
  zone.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; touchId = t.identifier; const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; }, { passive: true });
  zone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === touchId) {
      let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy), max = 50;
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.left = (35 + dx) + 'px'; knob.style.top = (35 + dy) + 'px';
      stick.x = dx / max; stick.z = -dy / max;
    }
  }, { passive: true });
  zone.addEventListener('touchend', () => { touchId = null; stick.x = stick.z = 0; knob.style.left = '35px'; knob.style.top = '35px'; }, { passive: true });
  $('#btn-jump').addEventListener('touchstart', () => { jumpAt = performance.now() / 1000; keys.add('Space'); }, { passive: true });
  $('#btn-jump').addEventListener('touchend', () => keys.delete('Space'), { passive: true });
  mobileStick = stick;
})();

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const time = serverTime || now / 1000;

  // animate water
  const g = waterMesh.geometry, base = g.userData.base, pos = g.attributes.position.array, tt = now / 1000;
  for (let i = 0; i < pos.length; i += 3) {
    const bx = base[i], bz = base[i + 2];
    pos[i + 1] = Math.sin(bx * 0.05 + tt) * 0.25 + Math.cos(bz * 0.06 + tt * 0.8) * 0.25;
  }
  g.attributes.position.needsUpdate = true;

  // animate dynamic park parts
  for (const wm of wiggleMeshes) {
    const o = wiggleOffset(wm.spec, time);
    wm.mesh.position.set(wm.spec.x + o.dx, o.dy, wm.spec.z + o.dz);
  }
  for (const lm of logMeshes) lm.roller.rotation.x = logAngle(lm.spec, time);
  for (const ss of swingSeats) { const st = swingState(ss.spec, time); ss.seat.position.set(st.seatX, st.seatY - 1.2, st.seatZ); }

  // input + player
  const input = readInput();
  if (mobileStick) { input.x += mobileStick.x; input.z += mobileStick.z; }
  if (myAvatar.ctrl) {
    updatePlayer(dt, input, time);
    myAvatar.ctrl.setAnim(player.anim);
    myAvatar.ctrl.moveSpeed = Math.hypot(player.vel.x, player.vel.z);
    myAvatar.ctrl.update(dt);
    myAvatar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
    myAvatar.group.rotation.y = player.ry;
    // first-person zoom: fade MY avatar out as the camera zooms all the way in
    // (only the local player fades; there's no local nametag — remotes keep theirs)
    fpFade(myAvatar.group, orbit.dist);
    sun.position.set(player.pos.x + 80, player.pos.y + 160, player.pos.z + 60);
    sun.target.position.set(player.pos.x, player.pos.y, player.pos.z);
  }
  updateCamera();

  // hint auto-hide
  if (now > hintUntil && hintText) { $('#action-hint').classList.add('hidden'); hintText = ''; }

  // remotes
  for (const [, r] of remotes) {
    const s = r.interp.sample([3]);
    if (s) {
      r.group.position.set(s[0], s[1], s[2]); r.group.rotation.y = s[3];
      r.ctrl.setAnim(s[4]);   // anim string already encodes swim/tread
      r.ctrl.moveSpeed = s[4] === 'run' ? RUN : s[4] === 'walk' ? MOVE : 0;
    }
    r.ctrl.update(dt);
  }

  // splashes
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i]; s.ttl -= dt;
    const k = 1 - s.ttl / 0.9; s.ring.scale.setScalar(1 + k * 5); s.ring.material.opacity = Math.max(0, s.ttl / 0.9) * 0.9;
    if (s.ttl <= 0) { scene.remove(s.ring); splashes.splice(i, 1); }
  }

  updateRoundHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
(async function boot() {
  // if a level was designed for Wibit in ClaudeBox Studio, make it the live world
  try {
    const { level } = await (await fetch('/api/level/wibit')).json();
    applyWorld(toWibitWorld(level));   // null/empty → keeps the built-in park
  } catch {}
  buildPark();
  player.pos = { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z };

  identity = await loadIdentity();
  await preloadAvatars(['boy', 'girl']);
  myAvatar.ctrl = makeAvatar(identity.avatar || {});
  myAvatar.group = myAvatar.ctrl.group;
  scene.add(myAvatar.group);
  camera.position.set(SPAWN.x, SPAWN.y + 8, SPAWN.z + 12);
  net.connect();
  net.join({ name: identity.name, avatar: identity.avatar, code: localStorage.getItem('claudebox.code') || '' });
  net.startMovementStream(() => ({
    t: 'move',
    x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2),
    ry: +player.ry.toFixed(3), anim: player.anim, swim: game.swimming,
  }));
  requestAnimationFrame(frame);
  window.__wibit = { net, player, game, remotes, scene, camera, orbit, keys, avatar: myAvatar, roundState: () => roundState };
})();
