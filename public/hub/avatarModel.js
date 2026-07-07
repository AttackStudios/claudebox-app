// ClaudeBox avatar: a smooth low-poly humanoid assembled from primitives.
// Every part is driven by the avatar params object (see DEFAULT shape in
// server/hub.js): body style, skin, hair, shirt, pants, shoes, hat, face.

import * as THREE from 'three';

const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex, flatShading: false });
const sphere = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);
const capsule = (r, len, cs = 6, rs = 14) => new THREE.CapsuleGeometry(r, len, cs, rs);
const cyl = (r1, r2, len, seg = 16) => new THREE.CylinderGeometry(r1, r2, len, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

// Builds the avatar standing on y=0, ~1.8 units tall. Returns { group, parts }.
export function buildAvatar(av) {
  const g = new THREE.Group();
  const parts = {};
  const broad = av.body === 'a';
  const shoulderW = broad ? 0.46 : 0.38;
  const hipW = broad ? 0.36 : 0.34;
  const torsoH = 0.62;
  const legH = 0.78;
  const armH = 0.58;

  const skin = mat(av.skin);
  const shirt = mat(av.shirtColor);
  const pantsM = mat(av.pantsColor);
  const shoeM = mat(av.shoeColor);
  const hairM = mat(av.hairColor);
  const hatM = mat(av.hatColor);

  // ---- legs ----
  const legY = legH / 2 + 0.06;
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * hipW * 0.45, legH + 0.06, 0);
    const pantLen = av.pants === 'shorts' ? legH * 0.45 : legH * 0.92;
    const pant = new THREE.Mesh(capsule(0.105, pantLen * 0.7), pantsM);
    pant.position.y = -pantLen / 2;
    leg.add(pant);
    if (av.pants !== 'long') {
      const shin = new THREE.Mesh(capsule(0.085, legH * 0.4), skin);
      shin.position.y = -legH * 0.7;
      leg.add(shin);
    }
    // shoes
    if (av.shoes !== 'none') {
      const isBoot = av.shoes === 'boots';
      const shoe = new THREE.Mesh(
        av.shoes === 'sandals' ? box(0.17, 0.06, 0.3) : capsule(0.095, isBoot ? 0.16 : 0.1),
        shoeM
      );
      if (av.shoes !== 'sandals') {
        shoe.rotation.x = Math.PI / 2;
        shoe.scale.set(1, 1, isBoot ? 1.2 : 0.9);
      }
      shoe.position.set(0, -legH - 0.0, 0.06);
      leg.add(shoe);
    } else {
      const foot = new THREE.Mesh(capsule(0.085, 0.08), skin);
      foot.rotation.x = Math.PI / 2;
      foot.position.set(0, -legH, 0.05);
      leg.add(foot);
    }
    g.add(leg);
    parts[side === -1 ? 'legL' : 'legR'] = leg;
  }
  if (av.pants === 'skirt') {
    const skirt = new THREE.Mesh(cyl(hipW * 0.85, hipW * 1.5, 0.34, 18), pantsM);
    skirt.position.y = legH + 0.06 - 0.1;
    g.add(skirt);
  }

  // ---- torso ----
  const torsoY = legH + 0.06 + torsoH / 2;
  // capsule sized to the torso, then widened at the shoulders
  const torso = new THREE.Mesh(capsule(0.24, torsoH * 0.55, 8, 18), shirt);
  torso.scale.set(shoulderW / 0.24 * 0.62, 0.78, 0.62);
  torso.position.y = torsoY;
  g.add(torso);
  parts.torso = torso;
  if (av.shirt === 'hoodie') {
    const hood = new THREE.Mesh(sphere(0.17, 16, 12), shirt);
    hood.scale.set(1.1, 0.8, 1);
    hood.position.set(0, torsoY + torsoH * 0.52, -0.12);
    g.add(hood);
  }
  if (av.shirt === 'jacket') {
    const zip = new THREE.Mesh(box(0.03, torsoH * 0.8, 0.02), mat('#dddddd'));
    zip.position.set(0, torsoY, shoulderW * 0.63);
    g.add(zip);
  }

  // ---- arms ----
  const sleeve = av.shirt === 'tank' ? 0 : av.shirt === 'tee' ? 0.42 : 0.95;
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    // hang from the torso's actual edge (capsule r=0.24 × x-scale) so the
    // shoulder touches the body
    arm.position.set(side * (shoulderW * 0.62 + 0.05), torsoY + torsoH * 0.34, 0);
    if (sleeve > 0) {
      const sl = new THREE.Mesh(capsule(0.085, armH * sleeve * 0.6), shirt);
      sl.position.y = -armH * sleeve * 0.35;
      arm.add(sl);
    }
    const bare = new THREE.Mesh(capsule(0.075, armH * 0.8 * (1 - sleeve * 0.55)), skin);
    bare.position.y = -armH * (0.45 + sleeve * 0.28);
    arm.add(bare);
    const hand = new THREE.Mesh(sphere(0.08, 14, 10), skin);
    hand.position.y = -armH - 0.04;
    arm.add(hand);
    arm.rotation.z = side * 0.08;
    g.add(arm);
    parts[side === -1 ? 'armL' : 'armR'] = arm;
  }

  // ---- head ----
  const headY = legH + 0.06 + torsoH + 0.26;
  const headPivot = new THREE.Group();
  headPivot.position.y = headY;
  g.add(headPivot);
  parts.head = headPivot;

  const neck = new THREE.Mesh(cyl(0.07, 0.08, 0.12, 12), skin);
  neck.position.y = -0.14;
  headPivot.add(neck);
  const head = new THREE.Mesh(sphere(0.21, 24, 18), skin);
  head.scale.set(1, 1.08, 1);
  headPivot.add(head);

  // face
  const eyeY = 0.03, eyeZ = 0.185;
  if (av.face === 'cool') {
    const glasses = new THREE.Mesh(box(0.3, 0.07, 0.04), mat('#1c1c1c'));
    glasses.position.set(0, eyeY, eyeZ + 0.01);
    headPivot.add(glasses);
  } else {
    for (const side of [-1, 1]) {
      const open = av.face !== 'sleepy';
      const eye = new THREE.Mesh(
        open ? sphere(av.face === 'surprised' ? 0.035 : 0.026, 10, 8) : box(0.05, 0.012, 0.01),
        mat('#26262c')
      );
      eye.position.set(side * 0.075, eyeY, eyeZ);
      headPivot.add(eye);
    }
  }
  // smile
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.012, 8, 12, Math.PI * 0.8),
    mat('#a8584a')
  );
  smile.position.set(0, -0.06, eyeZ);
  smile.rotation.z = Math.PI + (av.face === 'surprised' ? Math.PI : 0);
  if (av.face === 'surprised') { smile.scale.setScalar(0.7); smile.position.y = -0.08; }
  headPivot.add(smile);

  // ---- hair ----
  switch (av.hair) {
    case 'short': {
      const h = new THREE.Mesh(sphere(0.215, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
      h.position.y = 0.035;
      headPivot.add(h);
      break;
    }
    case 'long': {
      const top = new THREE.Mesh(sphere(0.22, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
      top.position.y = 0.03;
      const back = new THREE.Mesh(capsule(0.13, 0.3), hairM);
      back.scale.set(1.3, 1, 0.55);
      back.position.set(0, -0.13, -0.13);
      headPivot.add(top, back);
      break;
    }
    case 'spiky': {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), hairM);
        spike.position.set(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12);
        spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        headPivot.add(spike);
      }
      const base = new THREE.Mesh(sphere(0.215, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM);
      base.position.y = 0.035;
      headPivot.add(base);
      break;
    }
    case 'bun': {
      const top = new THREE.Mesh(sphere(0.215, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
      top.position.y = 0.035;
      const bun = new THREE.Mesh(sphere(0.09, 14, 10), hairM);
      bun.position.set(0, 0.21, -0.1);
      headPivot.add(top, bun);
      break;
    }
    case 'curly': {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = 0.13 + (i % 3) * 0.03;
        const curl = new THREE.Mesh(sphere(0.07, 10, 8), hairM);
        curl.position.set(Math.cos(a) * r, 0.13 + (i % 2) * 0.06, Math.sin(a) * r);
        headPivot.add(curl);
      }
      break;
    }
  }

  // ---- hat ----
  switch (av.hat) {
    case 'cap': {
      const dome = new THREE.Mesh(sphere(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hatM);
      dome.position.y = 0.1;
      const brim = new THREE.Mesh(cyl(0.13, 0.15, 0.025, 14), hatM);
      brim.position.set(0, 0.1, 0.2);
      brim.rotation.x = 0.1;
      brim.scale.z = 1.4;
      headPivot.add(dome, brim);
      break;
    }
    case 'beanie': {
      const dome = new THREE.Mesh(sphere(0.215, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hatM);
      dome.position.y = 0.08;
      dome.scale.y = 1.15;
      const pom = new THREE.Mesh(sphere(0.06, 10, 8), mat('#ffffff'));
      pom.position.y = 0.32;
      headPivot.add(dome, pom);
      break;
    }
    case 'tophat': {
      const brim = new THREE.Mesh(cyl(0.27, 0.27, 0.03, 20), hatM);
      brim.position.y = 0.16;
      const tube = new THREE.Mesh(cyl(0.16, 0.17, 0.3, 18), hatM);
      tube.position.y = 0.32;
      const band = new THREE.Mesh(cyl(0.165, 0.175, 0.06, 18), mat('#b8893a'));
      band.position.y = 0.21;
      headPivot.add(brim, tube, band);
      break;
    }
    case 'crown': {
      const ring = new THREE.Mesh(cyl(0.17, 0.15, 0.1, 12), mat('#ffd24a'));
      ring.position.y = 0.2;
      headPivot.add(ring);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 8), mat('#ffd24a'));
        point.position.set(Math.cos(a) * 0.155, 0.29, Math.sin(a) * 0.155);
        headPivot.add(point);
        const gem = new THREE.Mesh(sphere(0.022, 8, 6), hatM);
        gem.position.set(Math.cos(a + 0.6) * 0.165, 0.2, Math.sin(a + 0.6) * 0.165);
        headPivot.add(gem);
      }
      break;
    }
    case 'flower': {
      const center = new THREE.Mesh(sphere(0.04, 10, 8), mat('#ffd24a'));
      center.position.set(0.13, 0.18, 0.05);
      headPivot.add(center);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const petal = new THREE.Mesh(sphere(0.035, 8, 6), hatM);
        petal.scale.set(1.4, 0.5, 1);
        petal.position.set(0.13 + Math.cos(a) * 0.05, 0.18 + Math.sin(a) * 0.05, 0.05);
        petal.rotation.z = a;
        headPivot.add(petal);
      }
      break;
    }
    case 'headphones': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.025, 10, 20, Math.PI), hatM);
      band.position.y = 0.05;
      headPivot.add(band);
      for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(cyl(0.07, 0.07, 0.05, 14), hatM);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(side * 0.21, 0.0, 0);
        headPivot.add(cup);
      }
      break;
    }
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, parts };
}

// Gentle idle sway for previews and the hub.
export function animateAvatar(parts, t) {
  if (!parts.head) return;
  parts.head.rotation.y = Math.sin(t * 0.6) * 0.18;
  parts.head.rotation.x = Math.sin(t * 0.4 + 1) * 0.04;
  parts.armL.rotation.x = Math.sin(t * 0.9) * 0.06;
  parts.armR.rotation.x = -Math.sin(t * 0.9) * 0.06;
  parts.torso.position.y += 0; // anchor
}

// 2D head thumbnail for friend circles (fast, no WebGL).
export function drawAvatarHead(ctx, av, size) {
  const s = size / 100;
  ctx.clearRect(0, 0, size, size);
  // head
  ctx.fillStyle = av.skin;
  ctx.beginPath();
  ctx.arc(50 * s, 56 * s, 30 * s, 0, 7);
  ctx.fill();
  // hair
  if (av.hair !== 'none') {
    ctx.fillStyle = av.hairColor;
    ctx.beginPath();
    if (av.hair === 'long') {
      ctx.ellipse(50 * s, 50 * s, 34 * s, 30 * s, 0, Math.PI, 0);
      ctx.rect(16 * s, 50 * s, 12 * s, 30 * s);
      ctx.rect(72 * s, 50 * s, 12 * s, 30 * s);
    } else if (av.hair === 'spiky') {
      for (let i = 0; i < 5; i++) {
        const x = (28 + i * 11) * s;
        ctx.moveTo(x, 38 * s);
        ctx.lineTo(x + 5 * s, 16 * s);
        ctx.lineTo(x + 10 * s, 38 * s);
      }
    } else {
      ctx.ellipse(50 * s, 44 * s, 31 * s, 24 * s, 0, Math.PI, 0);
    }
    ctx.fill();
    if (av.hair === 'bun') {
      ctx.beginPath();
      ctx.arc(50 * s, 18 * s, 10 * s, 0, 7);
      ctx.fill();
    }
  }
  // eyes
  ctx.fillStyle = '#26262c';
  if (av.face === 'cool') {
    ctx.fillRect(30 * s, 50 * s, 40 * s, 9 * s);
  } else {
    ctx.beginPath();
    ctx.arc(40 * s, 54 * s, (av.face === 'surprised' ? 5 : 3.4) * s, 0, 7);
    ctx.arc(60 * s, 54 * s, (av.face === 'surprised' ? 5 : 3.4) * s, 0, 7);
    ctx.fill();
  }
  // smile
  ctx.strokeStyle = '#a8584a';
  ctx.lineWidth = 2.4 * s;
  ctx.beginPath();
  ctx.arc(50 * s, 62 * s, 10 * s, 0.3, Math.PI - 0.3);
  ctx.stroke();
  // hat
  ctx.fillStyle = av.hatColor;
  if (av.hat === 'cap') {
    ctx.beginPath();
    ctx.ellipse(50 * s, 38 * s, 30 * s, 16 * s, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(44 * s, 34 * s, 42 * s, 7 * s);
  } else if (av.hat === 'beanie') {
    ctx.beginPath();
    ctx.ellipse(50 * s, 40 * s, 31 * s, 20 * s, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(50 * s, 18 * s, 6 * s, 0, 7);
    ctx.fill();
  } else if (av.hat === 'tophat') {
    ctx.fillRect(30 * s, 8 * s, 40 * s, 26 * s);
    ctx.fillRect(18 * s, 32 * s, 64 * s, 6 * s);
  } else if (av.hat === 'crown') {
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const x = (29 + i * 14) * s;
      ctx.moveTo(x, 34 * s);
      ctx.lineTo(x + 7 * s, 18 * s);
      ctx.lineTo(x + 14 * s, 34 * s);
    }
    ctx.fill();
    ctx.fillRect(29 * s, 32 * s, 42 * s, 7 * s);
  } else if (av.hat === 'flower') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc((72 + Math.cos(a) * 7) * s, (34 + Math.sin(a) * 7) * s, 5 * s, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(72 * s, 34 * s, 5 * s, 0, 7);
    ctx.fill();
  } else if (av.hat === 'headphones') {
    ctx.strokeStyle = av.hatColor;
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.arc(50 * s, 52 * s, 33 * s, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.fillRect(13 * s, 48 * s, 10 * s, 14 * s);
    ctx.fillRect(77 * s, 48 * s, 10 * s, 14 * s);
  }
}
