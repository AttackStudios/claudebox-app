// ClaudeBox 3D avatar system. Loads the Roblox-style rigged GLB models
// (boy.glb / girl.glb, converted from the FBX rigs in Blender) plus per-clip
// animation GLBs, and produces animated, customizable, clothable characters
// for any game. Replaces the old procedural humanoid (avatarModel.js) — used
// by Backpacking, Restaurant Sim 2, and Obby (Feather Friends keeps its birds).

import * as THREE from 'three';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '/vendor/SkeletonUtils.js';

const loader = new GLTFLoader();
const glbCache = new Map();
function loadGLB(url) {
  if (!glbCache.has(url)) glbCache.set(url, new Promise((res, rej) => loader.load(url, res, undefined, rej)));
  return glbCache.get(url);
}

const EXTRA_CLIPS = ['run', 'jump', 'sit', 'dance', 'death', 'swim', 'tread',
  'rifleidle', 'riflerun', 'riflefire', 'pistolidle', 'pistolrun', 'knifeidle', 'knifestab'];   // 'idle' ships inside the base model
const genders = new Map();   // gender -> { template, clips, minY, scale }
export const TARGET_HEIGHT = 1.9;       // normalize every model to this height (feet at y=0)
export const HITBOX = { radius: 0.4, height: TARGET_HEIGHT, eye: TARGET_HEIGHT * 0.92 };

// region → which body meshes get that customization colour (Roblox style)
const REGIONS = {
  skin: ['Head', 'L_Arm', 'R_Arm', 'L_Hand', 'R_Hand'],
  shirt: ['Torso'],
  pants: ['L_Leg', 'R_Leg'],
};
const meshRegion = (name) => {
  for (const [r, list] of Object.entries(REGIONS)) if (list.includes(name)) return r;
  return 'skin';
};

export async function preloadAvatars(list = ['boy', 'girl']) {
  await Promise.all(list.map(loadGender));
}

// Strip the root (hip) translation track so clips animate IN PLACE. The game
// drives the avatar's actual position; without this the body drifts off its
// collider (very visible on the new jump, which leaps the hips up + forward).
const ROOT_POS_RE = /(Hips|Waist|Armature|Root)\.position$/i;
function inPlace(clip) {
  clip.tracks = clip.tracks.filter((t) => !ROOT_POS_RE.test(t.name));
  return clip;
}

async function loadGender(gender) {
  if (genders.has(gender)) return genders.get(gender);
  const base = await loadGLB(`/models/${gender}.glb`);
  const clips = {};
  const idle = base.animations.find((a) => /idle/i.test(a.name)) || base.animations[0];
  if (idle) { const c = inPlace(idle.clone()); c.name = 'idle'; clips.idle = c; }
  await Promise.all(EXTRA_CLIPS.map(async (name) => {
    // not every gender ships every clip (e.g. swim/tread) — missing files are fine
    try {
      const g = await loadGLB(`/models/${gender}_${name}.glb`);
      if (g.animations[0]) { const c = inPlace(g.animations[0].clone()); c.name = name; clips[name] = c; }
    } catch { /* clip not provided for this gender */ }
  }));
  // single-mesh (Mixamo boy): split the body geometry into skin/shirt/pants
  // material groups by skeleton region, once, so clones can recolour regions.
  let split = false;
  base.scene.traverse((o) => {
    if (o.isSkinnedMesh && !Array.isArray(o.material) && /R15|Roblox/i.test(o.name)) {
      if (splitBodyByRegion(o)) split = true;
    }
  });
  const box = new THREE.Box3().setFromObject(base.scene);
  const h = (box.max.y - box.min.y) || 1;
  const rec = { template: base.scene, clips, minY: box.min.y, scale: TARGET_HEIGHT / h, split };
  genders.set(gender, rec);
  return rec;
}

// classify a bone name → 0 skin (head/hands), 1 shirt (torso/arms), 2 pants (legs)
function regionClass(name) {
  if (/Head|Hand/.test(name)) return 0;
  if (/Leg|Foot|Toe|Hips/.test(name)) return 2;
  return 1;
}

// regroup a skinned body mesh's triangles into 3 material groups by the region
// of each face's dominant bone. Mutates the (shared template) geometry once.
function splitBodyByRegion(mesh) {
  const geo = mesh.geometry;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const bones = mesh.skeleton?.bones;
  if (!si || !sw || !bones) return false;
  const classOf = (vi) => {
    let mi = 0, mw = -1;
    for (let k = 0; k < 4; k++) { const wt = sw.getComponent(vi, k); if (wt > mw) { mw = wt; mi = si.getComponent(vi, k); } }
    return regionClass(bones[mi]?.name || '');
  };
  const index = geo.index;
  const triCount = index ? index.count / 3 : geo.attributes.position.count / 3;
  const get = (i) => index ? index.getX(i) : i;
  const buckets = [[], [], []];
  for (let f = 0; f < triCount; f++) {
    const a = get(f * 3), b = get(f * 3 + 1), c = get(f * 3 + 2);
    const cl = [classOf(a), classOf(b), classOf(c)];
    const cnt = [0, 0, 0]; cl.forEach((x) => cnt[x]++);
    let cls = 0; if (cnt[1] >= cnt[0] && cnt[1] >= cnt[2]) cls = 1; else if (cnt[2] >= cnt[0]) cls = 2;
    buckets[cls].push(a, b, c);
  }
  const merged = buckets[0].concat(buckets[1], buckets[2]);
  geo.setIndex(merged);
  geo.clearGroups();
  let off = 0;
  for (let m = 0; m < 3; m++) { geo.addGroup(off, buckets[m].length, m); off += buckets[m].length; }
  mesh.userData.regionSplit = true;
  return true;
}

// game anim name -> model clip + how to play it
const ANIM_MAP = {
  idle: 'idle', walk: 'run', run: 'run', jump: 'jump', fall: 'jump',
  swim: 'swim', tread: 'tread',
  rifleidle: 'rifleidle', riflerun: 'riflerun', riflefire: 'riflefire',
  pistolidle: 'pistolidle', pistolrun: 'pistolrun',
  knifeidle: 'knifeidle', knifestab: 'knifestab',
  sit: 'sit', lie: 'sit', drive: 'sit', sitchair: 'sit', dance: 'dance',
  death: 'death', dead: 'death', fly: 'idle', spray: 'idle', roast: 'idle', eat: 'idle',
};
// if a model lacks a clip, fall back to the closest one it does have
const ANIM_FALLBACK = {
  swim: 'run', tread: 'idle',
  rifleidle: 'idle', riflerun: 'run', riflefire: 'idle',
  pistolidle: 'idle', pistolrun: 'run',
  knifeidle: 'idle', knifestab: 'idle',
};
const ONESHOT = new Set(['jump', 'death', 'knifestab', 'riflefire']);

function genderOf(profile) {
  const b = (profile.body || '').toString().toLowerCase();
  // only an explicit girl choice picks the girl model; legacy 'a'/'b' = boy
  return (b === 'girl' || b === 'woman') ? 'girl' : 'boy';
}

// AvatarController — the per-character handle games use
export function makeAvatar(profile = {}) {
  const gender = genderOf(profile);
  const rec = genders.get(gender) || genders.get('boy') || genders.values().next().value;
  if (!rec) throw new Error('avatar3d: call preloadAvatars() before makeAvatar()');

  const inner = cloneSkinned(rec.template);
  inner.scale.setScalar(rec.scale);
  inner.position.y = -rec.minY * rec.scale;        // feet at y=0
  const group = new THREE.Group();
  group.add(inner);

  // colour setup. Girl = 8 named parts (tint by mesh name). Boy = one mesh whose
  // geometry was split into [skin, shirt, pants] groups (tint groups 1 & 2).
  const regionMats = { skin: [], shirt: [], pants: [] };
  const splitMats = { shirt: null, pants: null };
  let multiPart = false;
  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    if (rec.split && o.geometry.groups && o.geometry.groups.length === 3) {
      const base = o.material;
      const skin = base.clone(), shirt = base.clone(), pants = base.clone();
      o.material = [skin, shirt, pants];   // matches geometry groups 0/1/2
      splitMats.shirt = shirt; splitMats.pants = pants;
    } else {
      o.material = o.material.clone();
      if (REGIONS.skin.includes(o.name) || REGIONS.shirt.includes(o.name) || REGIONS.pants.includes(o.name)) {
        multiPart = true; regionMats[meshRegion(o.name)].push(o.material);
      }
    }
  });

  const bones = {};
  inner.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  // resolve a logical bone name across the Roblox ('Neck'/'Chest') and Mixamo
  // ('mixamorig:*') skeletons so clothing attaches on either rig
  // Blender's glTF export strips the ':' from mixamorig bone names
  const ALIAS = {
    Neck: ['Neck', 'mixamorigNeck', 'mixamorigHead'],
    Chest: ['Chest', 'mixamorigSpine2', 'mixamorigSpine1', 'mixamorigSpine'],
    Head: ['Head', 'mixamorigHead'],
  };
  const boneFor = (name) => { for (const n of (ALIAS[name] || [name])) if (bones[n]) return bones[n]; return inner; };
  const isMixamo = !!bones['mixamorigHips'];
  // (both rigs happen to face the same way once normalised by the exporter, so
  // no extra facing flip is needed — boy and girl stay consistent)
  inner.updateWorldMatrix(true, true);
  const headBone = boneFor('Head');

  // measure head (world space) so accessories sit upright
  const headMesh = inner.getObjectByName('Head');
  const head = { center: new THREE.Vector3(0, TARGET_HEIGHT * 0.84, 0), top: TARGET_HEIGHT, radius: 0.28, forward: -1 };
  if (headMesh) {
    const bb = new THREE.Box3().setFromObject(headMesh);
    head.center = bb.getCenter(new THREE.Vector3());
    head.top = bb.max.y;
    head.radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    head.forward = (bb.max.z - head.center.z) >= 0 ? 1 : -1;
  } else {
    // single-mesh model: head is the top of the overall bounding box
    const bb = new THREE.Box3().setFromObject(inner);
    head.radius = (bb.max.x - bb.min.x) * 0.17;
    head.center = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y - head.radius, (bb.min.z + bb.max.z) / 2);
    head.top = bb.max.y; head.forward = 1;   // ROBLOXBoyR15 faces +Z
  }
  const modelQuat = new THREE.Quaternion(); inner.getWorldQuaternion(modelQuat);

  const mixer = new THREE.AnimationMixer(inner);
  const actions = {};
  for (const [n, clip] of Object.entries(rec.clips)) actions[n] = mixer.clipAction(clip);
  let current = null, currentName = '', currentClip = '';
  const attachments = [];

  const ctrl = {
    group, inner, mixer, gender, bones,
    hitbox: { radius: HITBOX.radius, height: HITBOX.height },

    idlePhase: 0,
    moveSpeed: 0,   // world units/sec; drives how fast walk/run cycles
    setAnim(name) {
      let clip = ANIM_MAP[name] || 'idle';
      if (!actions[clip] && ANIM_FALLBACK[clip]) clip = ANIM_FALLBACK[clip];   // model lacks this clip
      // guard on the resolved CLIP, not the name: 'jump' and 'fall' both map to
      // the jump clip, so switching names mid-air must NOT replay it.
      if (clip === currentClip) { currentName = name; return; }
      currentName = name; currentClip = clip;
      const act = actions[clip];
      if (!act) {                       // no clip (e.g. boy has no idle) → rest pose
        if (current) current.fadeOut(0.2);
        current = null;
        return;
      }
      act.reset(); act.enabled = true; act.setEffectiveWeight(1);
      act.timeScale = 1;
      act.loop = ONESHOT.has(clip) ? THREE.LoopOnce : THREE.LoopRepeat;
      act.clampWhenFinished = ONESHOT.has(clip);
      act.fadeIn(0.1).play();
      if (current && current !== act) current.fadeOut(0.1);
      current = act;
    },

    update(dt) {
      // walk/run cycle speeds up with movement (and again when sprinting)
      if (current && currentClip === 'run') {
        current.timeScale = Math.max(1.1, Math.min(2.5, 0.95 + this.moveSpeed * 0.13));
      }
      mixer.update(dt);
      // gentle procedural breathing when resting with no idle clip
      if (!current) {
        this.idlePhase += dt;
        inner.position.y = (-rec.minY * rec.scale) + Math.sin(this.idlePhase * 1.6) * 0.012;
      }
    },

    setColors(p = {}) {
      const skin = p.skin || '#e8b48a';
      let shirtC = p.shirtColor || '#3a7bd5';
      let pantsC = p.pantsColor || '#34404f';
      // a swimsuit bares the body — the suit itself is a separate overlay mesh
      if (p.suit && p.suit !== 'none') { shirtC = skin; pantsC = skin; }
      const set = (mats, col) => { for (const m of mats) if (m.color && col) m.color.set(col); };
      if (multiPart) {
        set(regionMats.skin, skin);
        set(regionMats.shirt, shirtC);
        set(regionMats.pants, pantsC);
      } else if (splitMats.shirt) {     // boy: recolour the body's shirt/pants regions
        splitMats.shirt.color.set(shirtC);
        splitMats.pants.color.set(pantsC);
      }
    },

    setClothing(p = {}) {
      for (const a of attachments) a.parent?.remove(a);
      attachments.length = 0;
      inner.updateWorldMatrix(true, true);
      for (const raw of clothingFor(p)) {
        // 'swim' picks the garment by body type: girls get a full one-piece on
        // the torso, boys get swim shorts on the hips.
        const item = raw.build === 'swim'
          ? { ...raw, build: gender === 'girl' ? 'swimsuit' : 'swimshorts', bone: gender === 'girl' ? 'Torso' : 'Hips' }
          : raw;
        const mesh = buildClothing(item, head);
        if (!mesh) continue;
        // anchor in WORLD space: head for hats/faces, chest for backs, and fixed
        // fractions of the (normalised) body height for outfits.
        const anchorWorld = item.bone === 'Chest'
          ? new THREE.Vector3(head.center.x, head.center.y - head.radius * 2.2, head.center.z)
          : item.bone === 'Torso'
            ? new THREE.Vector3(head.center.x, TARGET_HEIGHT * 0.62, head.center.z)
            : item.bone === 'Hips'
              ? new THREE.Vector3(head.center.x, TARGET_HEIGHT * 0.46, head.center.z)
              : head.center.clone();
        // place on the model root in its local frame, undoing its scale; clothing
        // dims are world units. (Rides the body, not the head bone — fine for hats.)
        const holder = new THREE.Group();
        holder.position.copy(inner.worldToLocal(anchorWorld));
        holder.scale.setScalar(1 / rec.scale);
        holder.add(mesh);
        inner.add(holder);
        attachments.push(holder);
      }
    },

    dispose() { mixer.stopAllAction(); },
  };

  ctrl.setColors(profile);
  ctrl.setClothing(profile);
  ctrl.setAnim('idle');
  return ctrl;
}

// ----------------- clothing -----------------
// Each item attaches to a bone with a local offset; dims are world units that
// get unscaled onto the bone. Bones available: Neck, Chest, Shoulders, Waist,
// R_/L_ Shoulder/Elbow/Wrist, R_/L_ Thigh/Knee/Ankle.
export const CLOTHING = {
  hats: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'cap', label: 'Cap', emoji: '🧢', bone: 'Neck', build: 'cap' },
    { id: 'beanie', label: 'Beanie', emoji: '🧶', bone: 'Neck', build: 'beanie' },
    { id: 'tophat', label: 'Top Hat', emoji: '🎩', bone: 'Neck', build: 'tophat' },
    { id: 'crown', label: 'Crown', emoji: '👑', bone: 'Neck', build: 'crown' },
    { id: 'cowboy', label: 'Cowboy', emoji: '🤠', bone: 'Neck', build: 'cowboy' },
    { id: 'headphones', label: 'Headphones', emoji: '🎧', bone: 'Neck', build: 'headphones' },
    { id: 'halo', label: 'Halo', emoji: '😇', bone: 'Neck', build: 'halo' },
    { id: 'horns', label: 'Horns', emoji: '😈', bone: 'Neck', build: 'horns' },
    { id: 'wizard', label: 'Wizard', emoji: '🧙', bone: 'Neck', build: 'wizard' },
    { id: 'bandana', label: 'Bandana', emoji: '🏴', bone: 'Neck', build: 'bandana' },
    // ---- premium (Store) ----
    { id: 'pirate', label: 'Pirate Hat', emoji: '🏴‍☠️', bone: 'Neck', build: 'pirate' },
    { id: 'party', label: 'Party Hat', emoji: '🥳', bone: 'Neck', build: 'party' },
    { id: 'chef', label: 'Chef Hat', emoji: '👨‍🍳', bone: 'Neck', build: 'chef' },
    { id: 'football', label: 'Football Helmet', emoji: '🏈', bone: 'Neck', build: 'football' },
    { id: 'flower', label: 'Flower Crown', emoji: '🌸', bone: 'Neck', build: 'flower' },
    { id: 'propeller', label: 'Propeller Cap', emoji: '🚁', bone: 'Neck', build: 'propeller' },
  ],
  backs: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'backpack', label: 'Backpack', emoji: '🎒', bone: 'Chest', build: 'backpack' },
    { id: 'wings', label: 'Wings', emoji: '🦋', bone: 'Chest', build: 'wings' },
    { id: 'cape', label: 'Cape', emoji: '🦸', bone: 'Chest', build: 'cape' },
    { id: 'jetpack', label: 'Jetpack', emoji: '🚀', bone: 'Chest', build: 'jetpack' },
    { id: 'sword', label: 'Sword', emoji: '🗡️', bone: 'Chest', build: 'sword' },
    // ---- premium (Store) ----
    { id: 'angelwings', label: 'Angel Wings', emoji: '👼', bone: 'Chest', build: 'angelwings' },
    { id: 'balloon', label: 'Balloon', emoji: '🎈', bone: 'Chest', build: 'balloon' },
    { id: 'guitar', label: 'Guitar', emoji: '🎸', bone: 'Chest', build: 'guitar' },
  ],
  faces: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'glasses', label: 'Glasses', emoji: '👓', bone: 'Neck', build: 'glasses' },
    { id: 'shades', label: 'Shades', emoji: '🕶️', bone: 'Neck', build: 'shades' },
    { id: 'mask', label: 'Mask', emoji: '😷', bone: 'Neck', build: 'mask' },
    // ---- premium (Store) ----
    { id: 'monocle', label: 'Monocle', emoji: '🧐', bone: 'Neck', build: 'monocle' },
    { id: 'eyepatch', label: 'Eyepatch', emoji: '🏴‍☠️', bone: 'Neck', build: 'eyepatch' },
    { id: 'threed', label: '3D Glasses', emoji: '🤓', bone: 'Neck', build: 'threed' },
  ],
  // Body outfits. 'swim' resolves per body type: swim shorts for boys, a
  // full one-piece for girls (handled in setClothing); the body underneath is
  // bared to skin (see setColors) so the suit reads cleanly.
  suits: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'swim', label: 'Swimsuit', emoji: '🩱', bone: 'Hips', build: 'swim' },
  ],
};

function clothingFor(p) {
  const out = [];
  const add = (cat, id, color) => {
    const item = CLOTHING[cat]?.find((i) => i.id === id);
    if (item && item.build) out.push({ ...item, color });
  };
  add('hats', p.hat, p.hatColor || '#d2453a');
  add('backs', p.back, p.backColor || '#4a7ec0');
  add('faces', p.face2 || p.accessory, p.faceColor || '#222');
  add('suits', p.suit, p.suitColor || '#19a3d6');
  return out;
}

const lam = (c, opts = {}) => new THREE.MeshLambertMaterial({ color: c, ...opts });
const basic = (c) => new THREE.MeshBasicMaterial({ color: c });

// Clothing is built around the attach anchor at origin (head center for hats/
// faces, chest for backs). +Y is up, +Z*F is the way the face/front points.
function buildClothing(item, head) {
  const g = new THREE.Group();
  const c = item.color;
  const R = (head?.radius || 0.28);      // real head radius (world units)
  const F = (head?.forward || 1);        // face direction in +Z
  const TOP = R;                         // head top, relative to head center
  switch (item.build) {
    case 'cap': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(c));
      dome.position.y = TOP - R * 0.1;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(R * 1.7, 0.04, R * 1.2), lam(c));
      brim.position.set(0, TOP - R * 0.1, R * 0.95 * F);
      g.add(dome, brim); break;
    }
    case 'beanie': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(R * 1.08, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), lam(c));
      b.position.y = TOP - R * 0.35;
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(R * 1.05, 0.06, 8, 16), lam(c));
      cuff.rotation.x = Math.PI / 2; cuff.position.y = TOP - R * 0.3;
      g.add(b, cuff); break;
    }
    case 'tophat': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.6, R * 1.6, 0.04, 18), lam(c));
      brim.position.y = TOP;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.0, R * 1.0, R * 1.8, 18), lam(c));
      top.position.y = TOP + R * 0.9;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.08, 18), lam('#c0392b'));
      band.position.y = TOP + R * 0.2;
      g.add(brim, top, band); break;
    }
    case 'crown': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.06, R * 1.06, R * 0.5, 12, 1, true), lam('#ffd23f', { side: THREE.DoubleSide }));
      base.position.y = TOP + R * 0.1;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(R * 0.18, R * 0.5, 4), lam('#ffd23f'));
        sp.position.set(Math.cos(a) * R * 1.06, TOP + R * 0.5, Math.sin(a) * R * 1.06);
        g.add(sp);
      }
      g.add(base); break;
    }
    case 'cowboy': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(R * 2.0, R * 2.0, 0.04, 20), lam(c));
      brim.position.y = TOP - R * 0.1; brim.scale.z = 0.8;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.95, R * 1.05, R * 1.2, 16), lam(c));
      crown.position.y = TOP + R * 0.45;
      g.add(brim, crown); break;
    }
    case 'headphones': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(R * 1.1, 0.05, 8, 16, Math.PI), lam('#222'));
      band.position.y = TOP - R * 0.2;
      for (const s of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.4, R * 0.4, R * 0.4, 12), lam(c));
        cup.rotation.z = Math.PI / 2; cup.position.set(s * R * 1.1, -R * 0.15, 0);
        g.add(cup);
      }
      g.add(band); break;
    }
    case 'halo': {
      const h = new THREE.Mesh(new THREE.TorusGeometry(R * 0.95, 0.04, 8, 24), new THREE.MeshBasicMaterial({ color: '#fff2a0' }));
      h.rotation.x = Math.PI / 2; h.position.y = TOP + R * 1.1; g.add(h); break;
    }
    case 'horns': {
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(R * 0.28, R * 0.9, 8), lam(c || '#9b1b1b'));
        horn.position.set(s * R * 0.6, TOP + R * 0.3, 0); horn.rotation.z = -s * 0.4; g.add(horn);
      }
      break;
    }
    case 'wizard': {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(R * 1.2, R * 3, 16), lam(c || '#3b2c7a'));
      hat.position.y = TOP + R * 1.4;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.7, R * 1.7, 0.03, 18), lam(c || '#3b2c7a'));
      brim.position.y = TOP; g.add(hat, brim); break;
    }
    case 'bandana': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), lam(c));
      b.position.y = TOP - R * 0.3; g.add(b); break;
    }
    case 'glasses': case 'shades': {
      const dark = item.build === 'shades';
      for (const s of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(R * 0.32, 14), basic(dark ? '#111' : '#9fd4ff'));
        lens.position.set(s * R * 0.42, R * 0.1, R * 1.0 * F); lens.lookAt(s * R * 0.42, R * 0.1, R * 3 * F);
        g.add(lens);
      }
      break;
    }
    case 'mask': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(R * 1.0, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), lam(c || '#cfe6ff'));
      m.position.set(0, -R * 0.35, R * 0.1 * F); m.scale.z = 1.1; g.add(m); break;
    }
    // ---- back items: origin is the chest, +Z*F is forward so back = -Z*F ----
    case 'backpack': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.22), lam(c));
      body.position.set(0, 0.05, -0.26 * F); g.add(body);
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.1), lam(c).clone());
      pocket.material = lam('#00000022', { transparent: true, opacity: 0.18 });
      pocket.position.set(0, -0.03, -0.38 * F); g.add(pocket); break;
    }
    case 'wings': {
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), lam(c, { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
        wing.position.set(s * 0.3, 0.15, -0.22 * F); wing.rotation.y = s * 0.7 * F; g.add(wing);
      }
      break;
    }
    case 'cape': {
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), lam(c, { side: THREE.DoubleSide }));
      cape.position.set(0, -0.2, -0.24 * F); cape.rotation.x = 0.12 * F; g.add(cape); break;
    }
    case 'jetpack': {
      const tank = (s) => { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 10), lam(c)); t.position.set(s * 0.16, 0.05, -0.28 * F); return t; };
      g.add(tank(-1), tank(1)); break;
    }
    case 'sword': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.02), lam('#cdd3da'));
      const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), lam('#6b4a2a'));
      hilt.position.y = -0.3; const grp = new THREE.Group(); grp.add(blade, hilt);
      grp.position.set(-0.24, 0.1, -0.26 * F); grp.rotation.z = 0.5; g.add(grp); break;
    }
    // ---- outfits: anchored on the body (Hips for shorts, Torso for one-piece) ----
    case 'swimshorts': {        // boys: coloured board shorts around hips + thighs
      const sc = c || '#19a3d6';
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.36, 0.34), lam(sc));
      trunk.position.y = 0.03; g.add(trunk);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.165, 0.4, 14), lam(sc));
        leg.position.set(s * 0.135, -0.27, 0.01); g.add(leg);
      }
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.07, 0.36), lam('#ffffff'));
      band.position.y = 0.2; g.add(band);
      // a little side stripe so it reads as swimwear
      for (const s of [-1, 1]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.36), lam('#ffffff'));
        stripe.position.set(s * 0.27, -0.05, 0); g.add(stripe);
      }
      break;
    }
    case 'swimsuit': {          // girls: a full one-piece over torso + hips
      const sc = c || '#e23b6d';
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.34), lam(sc));
      torso.position.y = 0.0; g.add(torso);
      const briefs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.32), lam(sc));
      briefs.position.y = -0.44; g.add(briefs);
      for (const s of [-1, 1]) {                 // shoulder straps
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.1), lam(sc));
        strap.position.set(s * 0.18, 0.32, -0.03 * F); g.add(strap);
      }
      // a contrasting waist trim
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.36), lam('#ffffff'));
      trim.position.y = -0.2; g.add(trim);
      break;
    }
    // ---------- premium hats ----------
    case 'pirate': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.7, R * 1.7, 0.05, 20), lam(c || '#1a1a1e'));
      brim.position.y = TOP; brim.scale.x = 1.25;
      const crown = new THREE.Mesh(new THREE.SphereGeometry(R * 1.02, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), lam(c || '#1a1a1e'));
      crown.position.y = TOP;
      const skull = new THREE.Mesh(new THREE.SphereGeometry(R * 0.26, 10, 8), basic('#f2f2f2'));
      skull.position.set(0, TOP + R * 0.35, R * 1.0 * F);
      g.add(brim, crown, skull); break;
    }
    case 'party': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(R * 0.85, R * 2.2, 18), lam(c || '#ff5aa5'));
      cone.position.y = TOP + R * 1.0;
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.TorusGeometry(R * (0.5 + i * 0.12), 0.03, 6, 16), basic(i % 2 ? '#5be0ff' : '#ffe14a')); b.rotation.x = Math.PI / 2; b.position.y = TOP + R * (0.3 + i * 0.6); g.add(b); }
      const pom = new THREE.Mesh(new THREE.SphereGeometry(R * 0.2, 8, 6), basic('#ffffff')); pom.position.y = TOP + R * 2.1;
      g.add(cone, pom); break;
    }
    case 'chef': {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, R * 0.55, 16), lam('#ffffff')); band.position.y = TOP + R * 0.25;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(R * 1.15, 14, 10), lam('#ffffff')); puff.position.y = TOP + R * 0.85; puff.scale.y = 0.8;
      g.add(band, puff); break;
    }
    case 'football': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 1.18, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), lam(c || '#e0a326'));
      dome.position.y = TOP - R * 0.35;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(R * 0.16, R * 1.3, 0.02), lam('#ffffff')); stripe.position.set(0, TOP - R * 0.1, 0);
      for (const y of [-0.15, 0.12]) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, R * 1.5, 8), lam('#d8dde3')); bar.rotation.z = Math.PI / 2; bar.position.set(0, TOP + R * y, R * 1.05 * F); g.add(bar); }
      const vbar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, R * 0.5, 8), lam('#d8dde3')); vbar.position.set(0, TOP - R * 0.02, R * 1.05 * F);
      g.add(dome, stripe, vbar); break;
    }
    case 'flower': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.05, 0.03, 8, 20), lam('#4a8a3a')); ring.rotation.x = Math.PI / 2; ring.position.y = TOP + R * 0.05;
      const cols = ['#ff7eb6', '#ffd23f', '#ff5a5a', '#a06bff', '#ffffff'];
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const fl = new THREE.Mesh(new THREE.SphereGeometry(R * 0.18, 8, 6), basic(cols[i % cols.length])); fl.position.set(Math.cos(a) * R * 1.05, TOP + R * 0.1, Math.sin(a) * R * 1.05); fl.scale.y = 0.6; g.add(fl); }
      g.add(ring); break;
    }
    case 'propeller': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(c || '#e64a3b')); dome.position.y = TOP - R * 0.1;
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, R * 0.4, 6), lam('#333')); stalk.position.y = TOP + R * 0.3;
      for (const s of [-1, 1]) { const bl = new THREE.Mesh(new THREE.BoxGeometry(R * 0.9, 0.03, R * 0.22), lam(s > 0 ? '#5be0ff' : '#ffe14a')); bl.position.set(s * R * 0.4, TOP + R * 0.5, 0); bl.rotation.y = s * 0.3; g.add(bl); }
      g.add(dome, stalk); break;
    }
    // ---------- premium faces ----------
    case 'monocle': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.3, 0.03, 8, 16), lam('#ffd23f')); ring.position.set(R * 0.42, R * 0.1, R * 0.98 * F);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(R * 0.28, 14), basic('#bfe8ff')); lens.position.set(R * 0.42, R * 0.1, R * 0.96 * F); lens.material.transparent = true; lens.material.opacity = 0.5;
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.01, R * 0.5, 0.01), lam('#ffd23f')); chain.position.set(R * 0.42, R * -0.15, R * 0.98 * F);
      g.add(ring, lens, chain); break;
    }
    case 'eyepatch': {
      const patch = new THREE.Mesh(new THREE.CircleGeometry(R * 0.32, 14), lam('#111')); patch.position.set(-R * 0.42, R * 0.12, R * 1.0 * F); patch.lookAt(-R * 0.42, R * 0.12, R * 3 * F);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.03, 6, 20, Math.PI * 1.2), lam('#111')); strap.rotation.z = 0.3; strap.position.y = R * 0.2;
      g.add(patch, strap); break;
    }
    case 'threed': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(R * 1.5, R * 0.4, 0.03), lam('#111')); frame.position.set(0, R * 0.1, R * 0.98 * F);
      for (const [s, col] of [[-1, '#ff3b3b'], [1, '#3b7bff']]) { const lens = new THREE.Mesh(new THREE.CircleGeometry(R * 0.3, 14), basic(col)); lens.position.set(s * R * 0.4, R * 0.1, R * 1.0 * F); lens.material.transparent = true; lens.material.opacity = 0.6; g.add(lens); }
      g.add(frame); break;
    }
    // ---------- premium backs ----------
    case 'angelwings': {
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const fw = new THREE.Mesh(new THREE.PlaneGeometry(0.34 - i * 0.06, 0.5 - i * 0.08), lam('#fbfbff', { side: THREE.DoubleSide }));
          fw.position.set(s * (0.18 + i * 0.14), 0.28 - i * 0.18, -0.22 * F); fw.rotation.y = s * 0.9 * F; fw.rotation.z = -s * 0.2; g.add(fw);
        }
      }
      break;
    }
    case 'balloon': {
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 6), lam('#cccccc')); str.position.set(0.1, 0.5, -0.1 * F);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), lam(c || '#ff4a6b')); ball.position.set(0.1, 1.05, -0.1 * F); ball.scale.y = 1.15;
      g.add(str, ball); break;
    }
    case 'guitar': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.08), lam(c || '#c0392b')); body.position.set(0.1, -0.15, -0.26 * F); body.scale.x = 0.85;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.09, 14), basic('#1a1a1a')); hole.position.set(0.1, -0.15, -0.215 * F);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.62, 0.05), lam('#6b4a2a')); neck.position.set(-0.02, 0.32, -0.26 * F); neck.rotation.z = 0.35;
      g.add(body, hole, neck); break;
    }
    default: return null;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// expose the flat clothing list for editors
export function clothingCatalog() { return CLOTHING; }
