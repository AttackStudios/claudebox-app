// ClaudeBox 3D avatar system. Loads the Roblox-style rigged GLB models
// (boy.glb / girl.glb, converted from the FBX rigs in Blender) plus per-clip
// animation GLBs, and produces animated, customizable, clothable characters
// for any game. Replaces the old procedural humanoid (avatarModel.js) — used
// by Backpacking, Restaurant Sim 2, and Obby (Feather Friends keeps its birds).

import * as THREE from 'three';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '/vendor/SkeletonUtils.js';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import { makeAnimator } from '/shared/anim/humanoid.js';
import { buildSteven, skinFromProfile, textureFromImage, STEVEN_HEIGHT } from '/shared/avatar/steven.js';
import { loadGameAnimations, loadPack } from '/shared/anim/custom.js';

const loader = new GLTFLoader();
const glbCache = new Map();
function loadGLB(url) {
  if (!glbCache.has(url)) glbCache.set(url, new Promise((res, rej) => loader.load(url, res, undefined, rej)));
  return glbCache.get(url);
}

// (per-motion clip GLBs are no longer used — see shared/anim/humanoid.js)
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

// Animation sets published from /animator. A game calls useGameAnimations once
// and every avatar it makes afterwards plays them — that is the whole
// integration, and it is why nothing has to be exported or rebuilt.
let gamePack = null, gameCameraRule = null;
const liveCtrls = new Set();
export async function useGameAnimations(gameId) {
  const { pack, camera } = await loadGameAnimations(gameId, 'any');
  gamePack = pack; gameCameraRule = camera;
  for (const c of liveCtrls) c.setCustomPack?.(gamePack);
  return { pack, camera };
}
/** The camera rule the published sets ask for, or null. */
export const animationCameraRule = () => gameCameraRule;

// Camera rule support. A published set can ask that the camera follow the head
// exactly — so a head bob or a lean in an animation moves the view with it —
// without that ever becoming a way to fly the camera off the body. We report
// the head's displacement from where it rests, clamped to the rule's limit;
// the game adds it to its own camera target, so zoom and orbit still belong to
// the player.
// A community animation pack the player bought and equipped. It layers over the
// game's own sets, because what you chose to wear should beat a global default.
function wearPack(ctrl, profile) {
  const ap = profile?.animPack || '';
  if (!/^pack:/.test(ap)) return;
  loadPack(ap.slice(5)).then((res) => {
    if (!res?.pack) return;
    ctrl.setCustomPack({ ...(gamePack || {}), ...res.pack });
  }).catch(() => {});
}

function attachHeadRule(ctrl, THREE) {
  // Measure against the BIND pose, not against the head's local position:
  // animations rotate the spine, hips and head, and a rotation never changes a
  // bone's own local position. So we pin a probe point rigidly to the head —
  // roughly where the eyes sit, derived from the model so it works for every
  // rig — and compare where it is now with where it rests. That picks up bobs
  // and leans (ancestors moving the joint) and head tilts (the head's own
  // rotation swinging the probe) alike.
  let probeInHead = null, restInGroup = null;
  const cur = new THREE.Vector3(), rest = new THREE.Vector3();
  const headBone = () => {
    const b = ctrl.bones || {};
    // boy / r6 / girl / steven, in that order
    return b.mixamorigHead || b.Head_01 || b.Neck || b.head || null;
  };
  const bind = () => {
    const h = headBone();
    if (!h) return false;
    ctrl.group.updateMatrixWorld(true);
    const headW = new THREE.Vector3(); h.getWorldPosition(headW);
    const groupW = new THREE.Vector3(); ctrl.group.getWorldPosition(groupW);
    const H = Math.max(0.2, headW.y - groupW.y);          // head height above the feet
    const probeW = headW.clone().add(new THREE.Vector3(0, H * 0.09, 0));
    probeInHead = h.worldToLocal(probeW.clone());
    restInGroup = ctrl.group.worldToLocal(probeW.clone());
    return true;
  };
  ctrl.headOffset = (out) => {
    out = out || new THREE.Vector3();
    out.set(0, 0, 0);
    const rule = gameCameraRule;
    if (!rule || !rule.followHead) return out;
    const h = headBone();
    if (!h) return out;
    if (!probeInHead && !bind()) return out;
    h.localToWorld(cur.copy(probeInHead));
    ctrl.group.localToWorld(rest.copy(restInGroup));
    out.copy(cur).sub(rest);
    const max = typeof rule.maxOffset === 'number' ? rule.maxOffset : 0.35;
    if (out.length() > max) out.setLength(max);
    return out;
  };
  bind();
}

export async function preloadAvatars(list = ['boy', 'girl', 'r6']) {
  await Promise.all(list.map(loadGender));
}

// The girl model's texture atlas is mostly TRANSPARENT texels whose RGB is
// black; rendered opaque that paints black blotches over the body and hides
// the face. Composite it over white once so unpainted areas become white
// (letting the per-region tint through, Roblox-style) and the painted face
// keeps its colours.
const texFix = new Map();
function opaqueTex(tex) {
  const img = tex?.image;
  if (!img || !img.width || typeof document === 'undefined') return tex;
  if (texFix.has(tex)) return texFix.get(tex);
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0);
  const out = new THREE.CanvasTexture(cv);
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace || THREE.SRGBColorSpace;
  out.wrapS = tex.wrapS; out.wrapT = tex.wrapT;
  texFix.set(tex, out);
  return out;
}

async function loadGender(gender) {
  if (genders.has(gender)) return genders.get(gender);
  const base = await loadGLB(`/models/${gender}.glb`);
  const clips = {};   // kept for shape; nothing populates it any more
  base.scene.traverse((o) => {
    if (o.isMesh && o.material?.map) o.material.map = opaqueTex(o.material.map);
  });
  // Motion is procedural now (shared/anim/humanoid.js), so none of the
  // per-motion clip GLBs are fetched any more — that is 20 downloads removed,
  // and every body gets every motion instead of only the ones it shipped.
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

// The six-bone classic. Joint name -> which colourable part it drives.
const R6_PARTS = {
  Torso_00: 'torso', Head_01: 'head',
  Left_Arm_02: 'armL', Right_Arm_03: 'armR',
  Left_Leg_04: 'legL', Right_Leg_05: 'legR',
};

function genderOf(profile) {
  const b = (profile.body || '').toString().toLowerCase();
  if (b === 'steven') return 'steven';
  if (b === 'r6' || b === 'blocky') return 'r6';
  // only an explicit girl choice picks the girl model; legacy 'a'/'b' = boy
  return (b === 'girl' || b === 'woman') ? 'girl' : 'boy';
}

// AvatarController — the per-character handle games use
export function makeAvatar(profile = {}) {
  let gender = genderOf(profile);
  if (gender === 'steven') return makeStevenAvatar(profile);
  let rec = genders.get(gender);
  if (!rec) {
    // The requested body was never loaded — a game that preloaded only boy and
    // girl, say. Fall back to a body we HAVE, and fall the gender back with it:
    // keeping gender = 'r6' while rendering the boy mesh ran the R6 per-vertex
    // tint over geometry that has no R6 joints, which painted it plain white.
    rec = genders.get('boy') || genders.values().next().value;
    gender = rec ? [...genders.entries()].find(([, v]) => v === rec)?.[0] || 'boy' : gender;
  }
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
  const isR6 = gender === 'r6';
  // R6 has no named body meshes to recolour, so parts are tinted per-vertex by
  // whichever joint owns each vertex. This also lets the ordinary avatar colours
  // (skin / shirt / pants) map onto the blocky body, so a profile does not need
  // a separate R6 palette to look right.
  let r6Tint = null;
  if (isR6) {
    const jointPart = [];
    inner.traverse((o) => {
      if (!o.isSkinnedMesh || jointPart.length) return;
      o.skeleton.bones.forEach((b, i) => { jointPart[i] = R6_PARTS[b.name] || null; });
    });
    const meshes = [];
    inner.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    r6Tint = (cols) => {
      for (const o of meshes) {
        const geo = o.geometry;
        const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
        if (!si || !sw) continue;
        const n = geo.attributes.position.count;
        const arr = geo.attributes.color?.array instanceof Float32Array && geo.attributes.color.count === n
          ? geo.attributes.color.array : new Float32Array(n * 3);
        const col = new THREE.Color();
        for (let i = 0; i < n; i++) {
          let best = 0, bw = -1;
          for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
          col.set(cols[jointPart[best]] || '#ffffff');
          arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b;
        }
        if (geo.attributes.color?.array === arr) geo.attributes.color.needsUpdate = true;
        else geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        // A mesh can carry an ARRAY of materials (multi-material export), and a
        // material need not have a colour at all. Assuming a single coloured
        // material here threw during avatar construction, which killed the whole
        // game boot — the loading screen simply never went away.
        for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!mat) continue;
          mat.vertexColors = true;
          mat.color?.set('#ffffff');
          mat.needsUpdate = true;
        }
      }
    };
  }
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
    // Real half-extents. These heads are rounded CUBES, not spheres — hair cut
    // as a sphere lets the cube's corners poke straight through the top.
    head.hw = (bb.max.x - bb.min.x) / 2;
    head.hh = (bb.max.y - bb.min.y) / 2;
    head.hd = (bb.max.z - bb.min.z) / 2;
  } else {
    // single-mesh model: head is the top of the overall bounding box
    const bb = new THREE.Box3().setFromObject(inner);
    head.radius = (bb.max.x - bb.min.x) * 0.17;
    head.center = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y - head.radius, (bb.min.z + bb.max.z) / 2);
    head.top = bb.max.y; head.forward = 1;   // ROBLOXBoyR15 faces +Z
    head.hw = head.hd = head.hh = head.radius;
  }
  // measure the torso too, so a shirt print wraps the actual chest instead of
  // a guessed cylinder (the two models are different shapes)
  const torsoMesh = inner.getObjectByName('Torso');
  const torso = { center: new THREE.Vector3(0, TARGET_HEIGHT * 0.62, 0), halfW: 0.2, halfD: 0.12, height: 0.5 };
  if (torsoMesh) {
    const tb = new THREE.Box3().setFromObject(torsoMesh);
    torso.center = tb.getCenter(new THREE.Vector3());
    torso.halfW = (tb.max.x - tb.min.x) / 2;
    torso.halfD = (tb.max.z - tb.min.z) / 2;
    torso.height = tb.max.y - tb.min.y;
  } else {
    // No named Torso mesh (the boy is one welded mesh), and the overall bounding
    // box spans his outstretched arms — so measure the chest off the skeleton
    // instead: shoulder joints give the width, neck-to-hips gives the height.
    const bn = (names) => { for (const n of names) if (bones[n]) return bones[n]; return null; };
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const lA = bn(['mixamorigLeftArm', 'L_Shoulder']), rA = bn(['mixamorigRightArm', 'R_Shoulder']);
    const neckB = bn(['mixamorigNeck', 'Neck']), hipB = bn(['mixamorigHips', 'Waist']);
    const bb = new THREE.Box3().setFromObject(inner);
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    if (lA && rA && neckB && hipB) {
      const l = wp(lA), r = wp(rA), nk = wp(neckB), hp = wp(hipB);
      torso.halfW = Math.max(0.14, Math.abs(l.x - r.x) / 2 * 0.94);
      torso.halfD = torso.halfW * 0.66;
      torso.height = Math.max(0.3, (nk.y - hp.y) * 1.06);
      torso.center = new THREE.Vector3(cx, (nk.y + hp.y) / 2, cz);
    } else {
      torso.halfW = TARGET_HEIGHT * 0.125;
      torso.halfD = TARGET_HEIGHT * 0.078;
      torso.height = TARGET_HEIGHT * 0.32;
      torso.center = new THREE.Vector3(cx, TARGET_HEIGHT * 0.63, cz);
    }
  }
  torso.forward = head.forward;

  // Measure the foot so shoes fit either rig. The two models are built very
  // differently — the girl's leg is a column that just ends at the floor, the
  // boy has a real foot with a toe joint — so a fixed shoe size fits neither.
  const foot = { ankleY: TARGET_HEIGHT * 0.07, halfW: TARGET_HEIGHT * 0.06, toe: TARGET_HEIGHT * 0.09, heel: TARGET_HEIGHT * 0.035 };
  {
    const fb = (names) => { for (const n of names) if (bones[n]) return bones[n]; return null; };
    const lAnk = fb(['L_Ankle', 'mixamorigLeftFoot']);
    const rAnk = fb(['R_Ankle', 'mixamorigRightFoot']);
    const toeB = fb(['mixamorigLeftToeBase', 'L_Toe']);
    if (lAnk) {
      const lp = lAnk.getWorldPosition(new THREE.Vector3());
      foot.ankleY = Math.max(0.04, lp.y);
      if (rAnk) {
        const rp = rAnk.getWorldPosition(new THREE.Vector3());
        foot.halfW = Math.max(0.05, Math.abs(lp.x - rp.x) / 2 * 0.86);
      }
      // a real toe joint gives the exact reach; otherwise infer it from width
      if (toeB) {
        const tp = toeB.getWorldPosition(new THREE.Vector3());
        foot.toe = Math.max(foot.halfW * 1.2, Math.abs(tp.z - lp.z) + foot.halfW * 0.35);
      } else {
        foot.toe = Math.max(foot.halfW * 1.35, foot.ankleY * 1.15);
      }
      foot.heel = foot.halfW * 0.6;
    }
    // If the model has a named leg mesh, trust it over the joint spacing: on a
    // rig whose leg is a plain column the shoe has to be wider than the column
    // or it simply disappears inside it.
    const legMesh = inner.getObjectByName('L_Leg') || inner.getObjectByName('R_Leg');
    if (legMesh) {
      const lb = new THREE.Box3().setFromObject(legMesh);
      foot.halfW = Math.max(foot.halfW, (lb.max.x - lb.min.x) / 2) * 1.08;
      if (!toeB) { foot.toe = foot.halfW * 1.35; foot.heel = foot.halfW * 0.72; }
    }
  }

  // R6's proportions are exact and known, so measure them off the skeleton
  // rather than inferring from a bounding box that includes the outstretched
  // arms. Everything is expressed in studs derived from the head, so this stays
  // right whatever height the model is normalised to.
  if (isR6) {
    const wp = (n) => { const b = bones[n]; if (!b) return null; const v = new THREE.Vector3(); b.getWorldPosition(v); return v; };
    const headB = wp('Head_01'), headT = wp('Head_end_06');
    const shoulder = wp('Left_Arm_02'), hip = wp('Left_Leg_04'), toe = wp('Left_Leg_end_09');
    if (headB && headT && shoulder && hip) {
      const stud = (headT.y - headB.y) / 1.25;        // the R6 head is 1.25 studs tall
      head.center.set(headB.x, (headB.y + headT.y) / 2, headB.z);
      head.top = headT.y;
      head.hw = head.hd = head.hh = (headT.y - headB.y) / 2;
      head.radius = head.hw;
      // R6 faces -Z, unlike the other two models. Without this every brim,
      // fringe and face decal would point out of the back of its head.
      head.forward = -1;

      torso.center.set(0, (shoulder.y + hip.y) / 2, 0);
      torso.height = shoulder.y - hip.y;
      torso.halfW = stud * 1.0;                       // 2 studs across
      torso.halfD = stud * 0.5;                       // 1 stud deep
      torso.forward = -1;

      // The leg-end bone sits on the floor, so the shoe has to be lifted by its
      // own ankle height for the sole to land on the ground rather than under it.
      foot.ankleY = stud * 0.55;
      foot.halfW = stud * 0.5;                        // each leg is 1 stud wide
      foot.toe = stud * 0.62;
      foot.heel = stud * 0.34;
      foot.lift = foot.ankleY;
      if (toe) foot.groundY = toe.y;
    }
  }

  const modelQuat = new THREE.Quaternion(); inner.getWorldQuaternion(modelQuat);

  const anim = makeAnimator(THREE, bones, gender, profile.animPack || 'none');
  const baseY = -rec.minY * rec.scale;
  let currentName = 'idle', rootPitch = 0;
  const attachments = [];

  const ctrl = {
    group, inner, gender, bones, anim, headForward: head.forward,
    hitbox: { radius: HITBOX.radius, height: HITBOX.height },

    idlePhase: 0,
    moveSpeed: 0,   // world units/sec; drives how fast walk/run cycles
    setAnim(name) {
      currentName = name;
      anim.setAnim(name);
    },

    update(dt) {
      anim.setSpeed(this.moveSpeed);
      const c = anim.update(dt);
      // The root carries what bones cannot: the vertical bob of a stride, and
      // the pitch that lays the body flat for swimming or death.
      inner.position.y = baseY + (c.bob || 0);
      inner.position.x = c.rootX || 0;
      inner.position.z = c.rootZ || 0;
      // dt === 0 means an editor is scrubbing to an exact time, so snap rather
      // than smooth — otherwise the root never reaches the authored value.
      rootPitch += ((c.rootPitch || 0) - rootPitch) * (dt > 0 ? Math.min(1, dt * 8) : 1);
      inner.rotation.x = rootPitch;
    },

    setColors(p = {}) {
      const skin = p.skin || '#e8b48a';
      let shirtC = p.shirtColor || '#3a7bd5';
      let pantsC = p.pantsColor || '#34404f';
      // A garment with a fixed background (a full-bleed print) sets the body's
      // shirt region too, so what shows past the shell's edges still matches.
      const worn = CLOTHING.shirts.find((i) => i.id === p.shirt);
      if (worn && worn.base) shirtC = worn.base;
      // a swimsuit bares the body — the suit itself is a separate overlay mesh
      if (p.suit && p.suit !== 'none') { shirtC = skin; pantsC = skin; }
      // R6 colours by vertex, one colour per body part. The ordinary avatar
      // fields map straight on (skin -> head and arms, shirt -> torso, pants ->
      // legs), so an existing profile looks right on the blocky body without
      // needing its own palette. An explicit `r6` block still wins if present.
      if (r6Tint) {
        const r6 = p.r6 && typeof p.r6 === 'object' ? p.r6 : {};
        r6Tint({
          head: r6.head || skin, armL: r6.armL || skin, armR: r6.armR || skin,
          torso: r6.torso || shirtC, legL: r6.legL || pantsC, legR: r6.legR || pantsC,
        });
        return;
      }
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
      // the face rides the same attachment pipeline so expression changes
      // (and removal on re-dress) just work
      // face decal is for the girl only — the boy's smile is baked into his
      // mesh, so a drawn face on him doubles up
      const ft = headMesh ? faceTexture(p.face || 'happy') : null;
      if (ft) {
        const fs = head.radius * 1.55;
        const fp = new THREE.Mesh(
          new THREE.PlaneGeometry(fs, fs),
          new THREE.MeshBasicMaterial({ map: ft, transparent: true, depthWrite: false }),
        );
        fp.position.z = head.radius * 1.04 * head.forward;
        if (head.forward < 0) fp.rotation.y = Math.PI;
        const holder = new THREE.Group();
        holder.position.copy(inner.worldToLocal(head.center.clone()));
        holder.scale.setScalar(1 / rec.scale);
        holder.add(fp);
        inner.add(holder);
        attachments.push(holder);
      }
      for (const raw of clothingFor(p)) {
        // Bone-parented items (shoes, gloves) get one copy per bone and ride
        // the skeleton, so they move with the limb instead of hanging where
        // the limb was at bind time.
        if (raw.attach && BONE_SETS[raw.attach]) {
          for (const names of BONE_SETS[raw.attach]) {
            const bone = names.map((n) => bones[n]).find(Boolean);
            if (!bone) continue;
            const piece = buildClothing(raw, head, torso, foot);
            if (!piece) continue;
            bone.updateWorldMatrix(true, false);
            const bp = new THREE.Vector3(), bq = new THREE.Quaternion(), bs = new THREE.Vector3();
            bone.matrixWorld.decompose(bp, bq, bs);
            // cancel the bone's rest rotation and the model's scale, so the
            // piece is authored in upright world units yet still follows the bone
            const holder = new THREE.Group();
            holder.quaternion.copy(bq).invert();
            holder.scale.set(1 / bs.x, 1 / bs.y, 1 / bs.z);
            // rigs whose anchor bone sits on the floor need the piece raised so
            // its sole meets the ground instead of sinking through it
            if (raw.attach === 'ankles' && foot.lift) piece.position.y += foot.lift;
            holder.add(piece);
            bone.add(holder);
            attachments.push(holder);
          }
          continue;
        }
        // hair only fits models with a real Head mesh (the girl). The boy's
        // single Mixamo mesh has hair baked in and only an estimated head
        // position, which put hair pieces across his face.
        if (raw.build?.startsWith('hair-') && !headMesh) continue;
        // 'swim' picks the garment by body type: girls get a full one-piece on
        // the torso, boys get swim shorts on the hips.
        const item = raw.build === 'swim'
          ? { ...raw, build: gender === 'girl' ? 'swimsuit' : 'swimshorts', bone: gender === 'girl' ? 'Torso' : 'Hips' }
          : raw;
        const mesh = buildClothing(item, head, torso, foot);
        if (!mesh) continue;
        // anchor in WORLD space: head for hats/faces, chest for backs, and fixed
        // fractions of the (normalised) body height for outfits.
        const anchorWorld = item.bone === 'Shirt'
          ? torso.center.clone()
          : item.bone === 'Chest'
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

    setPack(name) { anim.setPack(name); },
    setCustomPack(obj) { anim.setCustomPack(obj); },
    dispose() { },
  };

  ctrl.setColors(profile);
  ctrl.setClothing(profile);
  ctrl.setAnim('idle');
  if (gamePack) ctrl.setCustomPack(gamePack);
  attachHeadRule(ctrl, THREE);
  liveCtrls.add(ctrl);
  wearPack(ctrl, profile);
  return ctrl;
}

// ----------------- Steven -----------------
// A whole body in one item. It has no skeleton to dress, because its clothing
// is painted into the skin rather than attached to it — so this path skips the
// attachment pipeline entirely and repaints the sheet when colours change.
function makeStevenAvatar(profile = {}) {
  const group = new THREE.Group();
  let tex = null, built = null, over = null;

  const setMap = (t) => {
    if (!t) return;
    tex = t;
    if (built) built.root.traverse((o) => { if (o.isMesh) { o.material.map = t; o.material.needsUpdate = true; } });
  };
  const paint = (p) => {
    // Always paint the generated skin first. An uploaded PNG has to decode
    // before it can be sampled, and a texture used before its image lands
    // samples black — so the wardrobe-painted sheet is what shows until the
    // upload is actually ready, and then it swaps in.
    setMap(skinFromProfile(p));
    if (p.stevenSkin) uploadedSkin(p.stevenSkin, setMap);
  };

  paint(profile);
  built = buildSteven(tex, { slim: !!profile.slimArms });
  group.add(built.root);

  const anim = makeAnimator(THREE, built.joints, 'steven', profile.animPack || 'none');
  const baseY = 0;
  let rootPitch = 0;

  const ctrl = {
    group, inner: built.root, gender: 'steven', bones: built.joints, anim,
    hitbox: { radius: HITBOX.radius, height: STEVEN_HEIGHT },
    idlePhase: 0, moveSpeed: 0,
    setAnim(name) { anim.setAnim(name); },
    update(dt) {
      anim.setSpeed(this.moveSpeed);
      const c = anim.update(dt);
      built.root.position.y = baseY + (c.bob || 0);
      built.root.position.x = c.rootX || 0;
      built.root.position.z = c.rootZ || 0;
      rootPitch += ((c.rootPitch || 0) - rootPitch) * (dt > 0 ? Math.min(1, dt * 8) : 1);
      built.root.rotation.x = rootPitch;
    },
    setColors(p = {}) { paint({ ...profile, ...p }); },
    setClothing() { /* Steven wears its skin; nothing is attached */ },
    // arm width is geometry, not paint, so switching it means a rebuild — the
    // caller in the editor already rebuilds the avatar, this is for anyone else
    get slim() { return built.slim; },
    setPack(name) { anim.setPack(name); },
    setCustomPack(obj) { anim.setCustomPack(obj); },
    dispose() { tex?.dispose?.(); },
  };
  ctrl.setAnim('idle');
  if (gamePack) ctrl.setCustomPack(gamePack);
  attachHeadRule(ctrl, THREE);
  liveCtrls.add(ctrl);
  wearPack(ctrl, profile);
  return ctrl;
}

// Uploaded skins arrive as data URLs. The image may still be decoding, so the
// texture is handed back immediately and refreshed when it lands.
const skinCache = new Map();
function uploadedSkin(dataUrl, onReady) {
  const hit = skinCache.get(dataUrl);
  if (hit) { if (hit.image?.complete) onReady(hit); else hit.image.addEventListener('load', () => onReady(hit), { once: true }); return; }
  if (typeof document === 'undefined') return;
  const img = new Image();
  const t = textureFromImage(img);
  img.onload = () => { t.needsUpdate = true; onReady(t); };
  img.src = dataUrl;
  skinCache.set(dataUrl, t);
}

/** Decode a skin ahead of time, so a one-shot render (a thumbnail) is not black. */
export function preloadStevenSkin(dataUrl) {
  return new Promise((res) => {
    if (!dataUrl || typeof document === 'undefined') return res();
    uploadedSkin(dataUrl, () => res());
  });
}

// ----------------- clothing -----------------
// Every item is a small assembly, never one solid blob: a hat has a crown, a
// brim, a band and a button, each with its own colour and surface. Two of those
// colours are yours (primary + secondary); the rest are shades derived from
// them so a single pick always produces something that reads as one garment.
//
// Items attach one of two ways:
//   anchor  — parented to the model root at a fixed body landmark (hats, packs)
//   bones   — parented to real skeleton bones, so they follow the animation
//             (shoes, gloves). Bone names are resolved across both rigs.

// ---- colour helpers ----
const _c = typeof THREE !== 'undefined' ? new THREE.Color() : null;
function shade(hex, k) {                    // k>0 lighten, k<0 darken
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color('#ffffff'), k);
  else c.lerp(new THREE.Color('#000000'), -k);
  return '#' + c.getHexString();
}
function mixc(a, b, t) {
  const c = new THREE.Color(a); c.lerp(new THREE.Color(b), t);
  return '#' + c.getHexString();
}

// ---- surfaces ----
// Roblox-flat by default, but metal and glossy plastic catch a highlight so
// buckles, visors and jewels don't disappear into the cloth around them.
const lam = (c, opts = {}) => new THREE.MeshLambertMaterial({ color: c, ...opts });
const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
const cloth = (c, opts = {}) => new THREE.MeshLambertMaterial({ color: c, ...opts });
const metal = (c, opts = {}) => new THREE.MeshPhongMaterial({ color: c, specular: '#ffffff', shininess: 90, ...opts });
const shiny = (c, opts = {}) => new THREE.MeshPhongMaterial({ color: c, specular: '#dddddd', shininess: 45, ...opts });
const glass = (c, o = 0.55) => new THREE.MeshPhongMaterial({ color: c, specular: '#ffffff', shininess: 120, transparent: true, opacity: o });

// The bone pairs shoes and gloves hang from, in each rig's own naming.
// R6 has no ankle joint; the bone at the bottom of each leg block sits exactly
// on the ground, which is the right anchor for footwear.
const BONE_SETS = {
  ankles: [['R_Ankle', 'mixamorigRightFoot', 'Right_Leg_end_010'],
           ['L_Ankle', 'mixamorigLeftFoot', 'Left_Leg_end_09']],
  wrists: [['R_Wrist', 'mixamorigRightHand', 'Right_Arm_end_08'],
           ['L_Wrist', 'mixamorigLeftHand', 'Left_Arm_end_07']],
};

export const CLOTHING = {
  hats: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'cap', label: 'Cap', emoji: '🧢', bone: 'Neck', build: 'cap', sec: '#1f2430' },
    { id: 'snapback', label: 'Snapback', emoji: '🧢', bone: 'Neck', build: 'snapback', pri: '#141419', sec: '#d8322a', logo: 'AOTP' },
    { id: 'beanie', label: 'Beanie', emoji: '🧶', bone: 'Neck', build: 'beanie', sec: '#f4f6fa' },
    { id: 'tophat', label: 'Top Hat', emoji: '🎩', bone: 'Neck', build: 'tophat', sec: '#c0392b' },
    { id: 'crown', label: 'Crown', emoji: '👑', bone: 'Neck', build: 'crown', sec: '#e2412f' },
    { id: 'cowboy', label: 'Cowboy', emoji: '🤠', bone: 'Neck', build: 'cowboy', sec: '#5a3d22' },
    { id: 'headphones', label: 'Headphones', emoji: '🎧', bone: 'Neck', build: 'headphones', sec: '#2b2f38' },
    { id: 'halo', label: 'Halo', emoji: '😇', bone: 'Neck', build: 'halo', sec: '#fff8c8' },
    { id: 'horns', label: 'Horns', emoji: '😈', bone: 'Neck', build: 'horns', sec: '#f0e3d0' },
    { id: 'wizard', label: 'Wizard', emoji: '🧙', bone: 'Neck', build: 'wizard', sec: '#ffd23f' },
    { id: 'bandana', label: 'Bandana', emoji: '🏴', bone: 'Neck', build: 'bandana', sec: '#f4f6fa' },
    // ---- premium (Store) ----
    { id: 'pirate', label: 'Pirate Hat', emoji: '🏴‍☠️', bone: 'Neck', build: 'pirate', sec: '#f2f2f2' },
    { id: 'party', label: 'Party Hat', emoji: '🥳', bone: 'Neck', build: 'party', sec: '#5be0ff' },
    { id: 'chef', label: 'Chef Hat', emoji: '👨‍🍳', bone: 'Neck', build: 'chef', sec: '#dfe4ec' },
    { id: 'football', label: 'Football Helmet', emoji: '🏈', bone: 'Neck', build: 'football', sec: '#ffffff' },
    { id: 'flower', label: 'Flower Crown', emoji: '🌸', bone: 'Neck', build: 'flower', sec: '#ff7eb6' },
    { id: 'propeller', label: 'Propeller Cap', emoji: '🚁', bone: 'Neck', build: 'propeller', sec: '#5be0ff' },
  ],
  backs: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'backpack', label: 'Backpack', emoji: '🎒', bone: 'Chest', build: 'backpack', sec: '#2f333c' },
    { id: 'wings', label: 'Wings', emoji: '🦋', bone: 'Chest', build: 'wings', sec: '#ffffff' },
    { id: 'cape', label: 'Cape', emoji: '🦸', bone: 'Chest', build: 'cape', sec: '#f2c14e' },
    { id: 'jetpack', label: 'Jetpack', emoji: '🚀', bone: 'Chest', build: 'jetpack', sec: '#565b66' },
    { id: 'sword', label: 'Sword', emoji: '🗡️', bone: 'Chest', build: 'sword', sec: '#ffd23f' },
    // ---- premium (Store) ----
    { id: 'angelwings', label: 'Angel Wings', emoji: '👼', bone: 'Chest', build: 'angelwings', sec: '#ffe9a8' },
    { id: 'balloon', label: 'Balloon', emoji: '🎈', bone: 'Chest', build: 'balloon', sec: '#ffffff' },
    { id: 'guitar', label: 'Guitar', emoji: '🎸', bone: 'Chest', build: 'guitar', sec: '#6b4a2a' },
  ],
  faces: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'glasses', label: 'Glasses', emoji: '👓', bone: 'Neck', build: 'glasses', sec: '#9fd4ff' },
    { id: 'shades', label: 'Shades', emoji: '🕶️', bone: 'Neck', build: 'shades', sec: '#15171c' },
    { id: 'mask', label: 'Mask', emoji: '😷', bone: 'Neck', build: 'mask', sec: '#ffffff' },
    // ---- premium (Store) ----
    { id: 'monocle', label: 'Monocle', emoji: '🧐', bone: 'Neck', build: 'monocle', sec: '#bfe8ff' },
    { id: 'eyepatch', label: 'Eyepatch', emoji: '🏴‍☠️', bone: 'Neck', build: 'eyepatch', sec: '#101216' },
    { id: 'threed', label: '3D Glasses', emoji: '🤓', bone: 'Neck', build: 'threed', sec: '#111111' },
  ],
  // Body outfits. 'swim' resolves per body type: swim shorts for boys, a
  // full one-piece for girls (handled in setClothing); the body underneath is
  // bared to skin (see setColors) so the suit reads cleanly.
  suits: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'swim', label: 'Swimsuit', emoji: '🩱', bone: 'Hips', build: 'swim', sec: '#ffffff' },
  ],
  // Shirts wrap the chest as a thin shell just outside the body, with the
  // print drawn onto the front panel. The body's own shirt region keeps its
  // colour underneath, so nothing pops through at the shoulders.
  shirts: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'tee', label: 'T-Shirt', emoji: '👕', bone: 'Shirt', build: 'shirt', art: 'plain', sec: '#ffffff' },
    { id: 'striped', label: 'Striped Tee', emoji: '🎽', bone: 'Shirt', build: 'shirt', art: 'stripes', sec: '#ffffff' },
    { id: 'ringer', label: 'Ringer Tee', emoji: '🅾️', bone: 'Shirt', build: 'shirt', art: 'hoop', sec: '#ffe14a' },
    { id: 'stickfight', label: 'Stick Fight', emoji: '🕴️', bone: 'Shirt', build: 'shirt', art: 'stickfight', sec: '#a05cd8', base: '#3d1560' },
  ],
  // Footwear rides the ankle bones, so it walks and jumps with the feet
  // instead of hanging in the air where the feet used to be.
  shoes: [
    { id: 'none', label: 'Barefoot', emoji: '🚫' },
    { id: 'sneakers', label: 'Sneakers', emoji: '👟', attach: 'ankles', build: 'sneakers', sec: '#f4f6fa' },
    { id: 'boots', label: 'Boots', emoji: '🥾', attach: 'ankles', build: 'boots', sec: '#3a2a1a' },
    { id: 'hightops', label: 'High Tops', emoji: '👞', attach: 'ankles', build: 'hightops', sec: '#ffffff' },
    { id: 'dress', label: 'Dress Shoes', emoji: '🖤', attach: 'ankles', build: 'dress', sec: '#2b2f38' },
    { id: 'sandals', label: 'Sandals', emoji: '🩴', attach: 'ankles', build: 'sandals', sec: '#c98e62' },
  ],
  // Hair rides the same head anchor as hats. Ids match the platform's saved
  // avatar fields (sanitizeAvatar), so old profiles just start showing hair.
  hair: [
    { id: 'none', label: 'None', emoji: '🚫' },
    { id: 'short', label: 'Short', emoji: '💇', bone: 'Neck', build: 'hair-short', sec: '#8a6242' },
    { id: 'long', label: 'Long', emoji: '👱', bone: 'Neck', build: 'hair-long', sec: '#8a6242' },
    { id: 'spiky', label: 'Spiky', emoji: '🦔', bone: 'Neck', build: 'hair-spiky', sec: '#8a6242' },
    { id: 'bun', label: 'Bun', emoji: '🍩', bone: 'Neck', build: 'hair-bun', sec: '#8a6242' },
    { id: 'curly', label: 'Curly', emoji: '🐑', bone: 'Neck', build: 'hair-curly', sec: '#8a6242' },
  ],
};

// Look an item up without caring which category it lives in.
export function findClothing(id) {
  for (const list of Object.values(CLOTHING)) {
    const hit = list.find((i) => i.id === id);
    if (hit) return hit;
  }
  return null;
}

function clothingFor(p) {
  const out = [];
  const add = (cat, id, color, color2) => {
    const item = CLOTHING[cat]?.find((i) => i.id === id);
    // color2 falls back to the item's own designed accent, so a profile saved
    // before secondary colours existed still looks finished.
    if (item && item.build) out.push({ ...item, color, color2: color2 || item.sec });
  };
  add('hair', p.hair, p.hairColor || '#5d4037', p.hairColor2);
  add('hats', p.hat, p.hatColor || '#d2453a', p.hatColor2);
  add('backs', p.back, p.backColor || '#4a7ec0', p.backColor2);
  add('faces', p.face2 || p.accessory, p.faceColor || '#222', p.faceColor2);
  add('suits', p.suit, p.suitColor || '#19a3d6', p.suitColor2);
  add('shirts', p.shirt, p.shirtColor || '#3a7bd5', p.shirtColor2);
  add('shoes', p.shoes, p.shoeColor || '#e0453a', p.shoeColor2);
  return out;
}

// ---- face decal ----
// Neither GLB paints a face where its head UVs sample, so the face is a drawn
// decal on a small transparent plane just in front of the head (Roblox-style).
const faceTexCache = new Map();
function faceTexture(face) {
  if (typeof document === 'undefined') return null;
  if (faceTexCache.has(face)) return faceTexCache.get(face);
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  x.strokeStyle = x.fillStyle = '#241a12'; x.lineCap = 'round';
  const dot = (cx) => { x.beginPath(); x.arc(cx, 104, 15, 0, Math.PI * 2); x.fill(); };
  const closed = (cx) => { x.lineWidth = 10; x.beginPath(); x.moveTo(cx - 16, 106); x.quadraticCurveTo(cx, 116, cx + 16, 106); x.stroke(); };
  if (face === 'cool') {                       // shades + smirk
    x.fillRect(56, 86, 52, 30); x.fillRect(148, 86, 52, 30); x.fillRect(100, 94, 56, 10);
    x.lineWidth = 12; x.beginPath(); x.moveTo(96, 156); x.quadraticCurveTo(140, 178, 168, 148); x.stroke();
  } else if (face === 'surprised') {           // wide eyes + o mouth
    dot(88); dot(168);
    x.lineWidth = 11; x.beginPath(); x.arc(128, 170, 20, 0, Math.PI * 2); x.stroke();
  } else if (face === 'sleepy') {              // closed eyes + soft smile
    closed(88); closed(168);
    x.lineWidth = 10; x.beginPath(); x.moveTo(102, 172); x.quadraticCurveTo(128, 182, 154, 172); x.stroke();
  } else {                                     // happy (default)
    dot(88); dot(168);
    x.lineWidth = 12; x.beginPath(); x.arc(128, 128, 48, Math.PI * 0.22, Math.PI * 0.78); x.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  faceTexCache.set(face, t);
  return t;
}

// ---- shirt prints ----
// Drawn from scratch on a canvas, then wrapped around the chest. Nothing here
// is an imported image; each design is code so it stays crisp at any size and
// costs one texture rather than a download.
const shirtArtCache = new Map();
function stickFigure(x, col, lw, head, segs) {
  x.strokeStyle = col; x.lineWidth = lw; x.lineCap = 'round'; x.lineJoin = 'round';
  if (head) { x.beginPath(); x.arc(head[0], head[1], head[2], 0, Math.PI * 2); x.stroke(); }
  for (const pts of segs) {
    x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
    x.stroke();
  }
}
export function shirtArt(design, primary = '#3a7bd5', secondary = '#ffffff') {
  if (typeof document === 'undefined') return null;
  const key = design + '|' + primary + '|' + secondary;
  if (shirtArtCache.has(key)) return shirtArtCache.get(key);
  const W = 512, H = 700;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');

  if (design === 'stickfight') {
    // A brawl of stick figures on a purple field: one big outlined figure
    // standing behind, five smaller coloured ones scrapping in front.
    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#7a35b8'); bg.addColorStop(0.5, '#5d2494'); bg.addColorStop(1, '#341251');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const glow = x.createRadialGradient(W * 0.5, H * 0.42, 20, W * 0.5, H * 0.42, W * 0.75);
    glow.addColorStop(0, 'rgba(168,92,224,.55)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = glow; x.fillRect(0, 0, W, H);

    // the big one behind — head, spine, and one long bowed sweep of arms
    x.strokeStyle = '#000'; x.lineWidth = 26; x.lineCap = 'round';
    x.beginPath(); x.arc(256, 118, 60, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(256, 178); x.lineTo(256, 350); x.stroke();
    x.beginPath(); x.moveTo(60, 176); x.quadraticCurveTo(256, 292, 452, 176); x.stroke();

    const crew = [
      ['#d8321f', 13, [132, 214, 30], [[[132, 244], [152, 342]], [[137, 266], [88, 322]], [[137, 266], [197, 310]], [[152, 342], [120, 432]], [[152, 342], [178, 430]]]],
      ['#29a8e0', 14, [96, 254, 34], [[[96, 288], [142, 400]], [[110, 320], [182, 300]], [[110, 320], [58, 380]], [[142, 400], [68, 470]], [[142, 400], [152, 502]]]],
      ['#4cb944', 12, [316, 234, 30], [[[316, 264], [310, 402]], [[316, 290], [264, 340]], [[316, 290], [362, 330]], [[310, 402], [284, 500]], [[310, 402], [336, 496]]]],
      ['#f5e04a', 15, [402, 254, 42], [[[402, 296], [396, 430]], [[402, 326], [340, 370]], [[402, 326], [456, 360]], [[396, 430], [360, 540]], [[396, 430], [432, 530]]]],
      ['#f07020', 17, [216, 300, 44], [[[216, 344], [216, 472]], [[216, 372], [148, 432]], [[216, 372], [288, 416]], [[216, 472], [178, 562]], [[216, 472], [252, 556]]]],
    ];
    for (const [col, lw, head, segs] of crew) stickFigure(x, col, lw, head, segs);
  } else if (design === 'stripes') {
    x.fillStyle = primary; x.fillRect(0, 0, W, H);
    x.fillStyle = secondary;
    for (let i = 0; i < 9; i++) x.fillRect(0, i * (H / 9) + H / 36, W, H / 18);
  } else if (design === 'hoop') {
    x.fillStyle = primary; x.fillRect(0, 0, W, H);
    x.fillStyle = secondary;
    x.beginPath(); x.arc(W / 2, H / 2, W * 0.3, 0, Math.PI * 2); x.fill();
    x.fillStyle = primary;
    x.beginPath(); x.arc(W / 2, H / 2, W * 0.2, 0, Math.PI * 2); x.fill();
  } else {                       // plain
    x.fillStyle = primary; x.fillRect(0, 0, W, H);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  shirtArtCache.set(key, t);
  return t;
}

// ---- cap wordmark ----
// An arched, heavy-slab wordmark whose letters are filled with a patchwork of
// colour blocks and outlined in near-black. Drawn rather than imported so it
// stays sharp at any size and costs one texture.
const capLogoCache = new Map();
function capLogoTexture(text) {
  if (typeof document === 'undefined') return null;
  if (capLogoCache.has(text)) return capLogoCache.get(text);
  const W = 640, H = 320;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');

  // the patchwork swatch the letters are filled with
  const pc = document.createElement('canvas'); pc.width = pc.height = 128;
  const px = pc.getContext('2d');
  const COLS = ['#c62828', '#c62828', '#c62828', '#2e4fa8', '#4f9d3a', '#e8c63a', '#e07a2a', '#3aa8a0', '#8a4fd6'];
  px.fillStyle = '#c62828'; px.fillRect(0, 0, 128, 128);
  let r = 20260815;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 30; i++) {
    px.fillStyle = COLS[Math.floor(rnd() * COLS.length)];
    px.save();
    px.translate(rnd() * 128, rnd() * 128);
    px.rotate(rnd() * Math.PI);
    px.fillRect(-18 - rnd() * 20, -12 - rnd() * 14, 34 + rnd() * 40, 22 + rnd() * 30);
    px.restore();
  }
  const pat = x.createPattern(pc, 'repeat');

  const FONT = '900 150px "Arial Black", Impact, "Helvetica Neue", sans-serif';
  x.font = FONT;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  // Letters ride a circle whose centre is below the canvas, so the ends drop
  // and tilt outward the way a real arched wordmark does. The angular step per
  // letter comes from its measured width, otherwise wide letters collide.
  const radius = 520, cx = W / 2, cy = 150 + radius;
  const chars = [...text];
  const widths = chars.map((ch) => x.measureText(ch).width * 1.04);
  let a = -(widths.reduce((p, q) => p + q, 0) / 2) / radius;
  for (let i = 0; i < chars.length; i++) {
    const step = widths[i] / radius;
    x.save();
    x.translate(cx, cy);
    x.rotate(a + step / 2);
    x.translate(0, -radius);
    x.font = FONT; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 18; x.strokeStyle = '#0a0a0c';
    x.strokeText(chars[i], 0, 0);
    x.fillStyle = pat;
    x.fillText(chars[i], 0, 0);
    x.restore();
    a += step;
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  capLogoCache.set(text, t);
  return t;
}

// Clothing is built around the attach anchor at origin (head center for hats/
// faces, chest for backs, the ankle for shoes). +Y is up, +Z*F is the way the
// face/front points.
function buildClothing(item, head, torso, foot) {
  const g = new THREE.Group();
  const c = item.color;
  // Second colour: the wearer's pick, else the accent the item was designed
  // with, else a darker shade of the primary. Everything else is derived, so
  // trims and shadows always belong to the same garment.
  const c2 = item.color2 || item.sec || shade(c, -0.35);
  const dk = shade(c, -0.26), dk2 = shade(c, -0.46), lt = shade(c, 0.2);
  const d2 = shade(c2, -0.28), l2 = shade(c2, 0.22);
  const GOLD = '#f0c23c', STEEL = '#cfd6e0', DARK = '#22262e';
  const R = (head?.radius || 0.28);      // real head radius (world units)
  const F = (head?.forward || 1);        // face direction in +Z
  const TOP = R;                         // head top, relative to head center

  // tiny builders so each item reads as an assembly instead of a wall of maths
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const cyl = (rt, rb, h, mat, seg = 16, open = false) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
  const sph = (r, mat, seg = 14, rings = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, rings), mat);
  const dome = (r, mat, frac = 0.5, seg = 16) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, 10, 0, Math.PI * 2, 0, Math.PI * frac), mat);
  const cone = (r, h, mat, seg = 16) => new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
  const ring = (r, t, mat, seg = 20, arc = Math.PI * 2) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, seg, arc), mat);
  const at = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };

  switch (item.build) {
    // ---- hair: blocky pieces cut to the head's real box, with a dyed streak ----
    // HW/HH/HD are the head's half-extents. Sizing off those (instead of one
    // radius) is what keeps hair sitting ON the head rather than inside it.
    case 'hair-short': case 'hair-long': case 'hair-spiky': case 'hair-bun': case 'hair-curly': {
      const HW = head?.hw || R, HH = head?.hh || R, HD = head?.hd || R;
      const style = item.build.slice(5);
      const capH = HH * 0.62;
      // the cap: a slab over the crown, plus a thin skirt down the sides so the
      // hairline reads instead of ending in a hard edge
      const cap = at(box(HW * 2.12, capH, HD * 2.12, cloth(c)), 0, HH - capH * 0.42, 0);
      const skirt = at(box(HW * 2.1, HH * 0.5, HD * 2.1, cloth(style === 'curly' ? c : dk)), 0, HH * 0.28, 0);
      // fringe across the brow, kept clear of the eyes
      if (style !== 'curly') at(box(HW * 1.9, HH * 0.34, HD * 0.42, cloth(c)), 0, HH * 0.5, HD * 1.02 * F);
      // a dyed streak so the second colour shows from the front
      // The dyed streak sits in the fringe rather than on the side of the cap,
      // so it reads as coloured hair instead of a block stuck to the head.
      if (style !== 'curly') at(box(HW * 0.42, HH * 0.36, HD * 0.44, cloth(c2)), HW * 0.6, HH * 0.5, HD * 1.03 * F);

      if (style === 'short') {
        for (const sd of [-1, 1]) at(box(HW * 0.36, HH * 0.6, HD * 0.7, cloth(dk)), sd * HW * 0.98, HH * 0.1, HD * 0.35 * F);
        at(box(HW * 1.9, HH * 0.7, HD * 0.4, cloth(dk)), 0, HH * 0.15, -HD * 1.02 * F);
      } else if (style === 'long') {
        at(box(HW * 2.0, HH * 2.6, HD * 0.45, cloth(dk)), 0, -HH * 1.0, -HD * 1.06 * F);        // fall down the back
        for (const sd of [-1, 1]) {
          at(box(HW * 0.5, HH * 2.2, HD * 1.3, cloth(c)), sd * HW * 0.95, -HH * 0.7, -HD * 0.2 * F);
          at(box(HW * 0.28, HH * 1.7, HD * 0.4, cloth(dk2)), sd * HW * 0.62, -HH * 1.0, -HD * 0.95 * F);
        }
        at(ring(HW * 0.45, HW * 0.1, cloth(c2), 14), 0, -HH * 1.9, -HD * 1.04 * F);             // hair tie
      } else if (style === 'spiky') {
        const spots = [[0, 0.2], [0.75, 0.55], [-0.75, 0.55], [0.6, -0.55], [-0.6, -0.55], [0, -0.8]];
        spots.forEach(([sx, sz], i) => {
          const sp = at(cone(HW * 0.34, HH * 1.0, cloth(i % 2 ? c : dk), 6), sx * HW, HH * 1.35, sz * HD * F);
          sp.rotation.set(sz * -0.45, 0, sx * -0.45);
          const tip = at(cone(HW * 0.16, HH * 0.34, cloth(c2), 6), sx * HW * 1.16, HH * 1.85, sz * HD * 1.16 * F);
          tip.rotation.copy(sp.rotation);
        });
      } else if (style === 'bun') {
        at(sph(HW * 0.6, cloth(dk), 12, 10), 0, HH * 1.3, -HD * 0.9 * F);                       // the bun
        const tie = at(ring(HW * 0.58, HW * 0.13, cloth(c2), 16), 0, HH * 0.95, -HD * 0.86 * F);
        tie.rotation.x = Math.PI * 0.08;
        for (const sd of [-1, 1]) at(box(HW * 0.26, HH * 1.0, HD * 0.34, cloth(dk)), sd * HW * 0.98, HH * 0.05, HD * 0.5 * F);
      } else {                                                                                   // curly
        const puffs = [[0, 1.25, 0, 0.68], [0.85, 1.0, 0.4, 0.56], [-0.85, 1.0, 0.4, 0.56],
          [0.8, 1.0, -0.6, 0.58], [-0.8, 1.0, -0.6, 0.58], [0, 1.1, -0.95, 0.6],
          [0.45, 1.2, 0.7, 0.5], [-0.45, 1.2, 0.7, 0.5], [1.0, 0.5, -0.15, 0.48], [-1.0, 0.5, -0.15, 0.48]];
        puffs.forEach(([sx, sy, sz, sr], i) => {
          const col = i % 4 === 0 ? c2 : i % 3 === 0 ? dk : c;
          at(sph(HW * sr, cloth(col), 10, 8), sx * HW, sy * HH, sz * HD * F);
        });
      }
      break;
    }

    // ---- hats ----
    case 'cap': {
      const crown = at(dome(R * 1.05, cloth(c), 0.5, 14), 0, TOP - R * 0.1, 0);
      crown.scale.y = 0.92;
      for (const s of [-1, 1]) {          // panel seams
        const seam = at(box(0.008, R * 1.02, R * 2.1, cloth(dk2)), s * R * 0.52, TOP - R * 0.1, 0);
        seam.rotation.z = -s * 0.32;
      }
      const brim = at(box(R * 1.75, 0.035, R * 1.25, cloth(c2)), 0, TOP - R * 0.13, R * 0.98 * F);
      brim.rotation.x = -0.18 * F;
      const under = at(box(R * 1.68, 0.02, R * 1.18, cloth(d2)), 0, TOP - R * 0.155, R * 0.98 * F);
      under.rotation.x = -0.18 * F;
      at(sph(R * 0.1, cloth(c2), 10, 8), 0, TOP + R * 0.42, 0);        // button
      at(box(R * 0.7, R * 0.16, 0.03, cloth(c2)), 0, TOP - R * 0.28, -R * 1.02 * F);   // rear strap
      at(box(R * 0.16, R * 0.13, 0.04, metal(STEEL)), 0, TOP - R * 0.28, -R * 1.05 * F);
      break;
    }
    // A flat-brim snapback: structured six-panel crown, rounded flat brim, the
    // little button on the crown, and an open rear closed by a perforated
    // plastic strap. Cut to the head's real box — a sphere-based crown lets a
    // squared-off head poke through at the corners — and stepped inward toward
    // the top so it domes instead of reading as a slab.
    case 'snapback': {
      const HW = head?.hw || R, HH = head?.hh || R, HD = head?.hd || R;
      const CW = HW * 1.08, CD = HD * 1.08;       // crown half-extents at the band
      const baseY = HH * 0.2;                     // bottom rim, clear of the brow
      const gapH = HH * 0.34;                     // lower band / height of the rear opening
      const upperH = HH * 0.62;                   // everything above the band
      const bandTop = baseY + gapH;
      // the taper: each tier is shorter and narrower than the one below it
      const TIERS = [[0.5, 1.0], [0.22, 0.97], [0.17, 0.915], [0.11, 0.82]];
      let ty = bandTop;
      for (const [hFrac, wFrac] of TIERS) {
        const h = upperH * hFrac;
        at(box(CW * 2 * wFrac, h, CD * 2 * wFrac, cloth(c)), 0, ty + h / 2, 0);
        ty += h;
      }
      const topY = ty;
      // the band wraps the front and sides only, leaving the back open
      at(box(CW * 2, gapH, CD * 1.34, cloth(c)), 0, baseY + gapH / 2, CD * 0.33 * F);
      for (const sd of [-1, 1]) at(box(CW * 0.62, gapH, CD * 0.66, cloth(c)), sd * CW * 0.69, baseY + gapH / 2, -CD * 0.67 * F);

      // panel seams — the six-panel look reads entirely off these. They stop at
      // the first taper so nothing pokes above the crown.
      // The front seam runs only above the wordmark, so it never cuts through
      // the lettering the way a full-height seam does.
      const seamH = gapH + upperH * 0.55;
      const seamMid = baseY + seamH / 2;
      at(box(CW * 0.06, upperH * 0.3, CD * 0.08, cloth(dk)), 0, bandTop + upperH * 0.62, CD * 1.0 * F);
      at(box(CW * 0.06, upperH * 0.55, CD * 0.08, cloth(dk)), 0, bandTop + upperH * 0.28, -CD * 1.0 * F);
      for (const sd of [-1, 1]) at(box(CW * 0.08, seamH, CD * 0.06, cloth(dk)), sd * CW * 1.0, seamMid, 0);

      // front wordmark, alpha-tested so it never sorts against the crown
      const logoTex = capLogoTexture(item.logo || 'AOTP');
      if (logoTex) {
        const logo = new THREE.Mesh(
          new THREE.PlaneGeometry(CW * 1.96, upperH * 0.72),
          new THREE.MeshLambertMaterial({ map: logoTex, transparent: true, alphaTest: 0.45 }),
        );
        logo.position.set(0, bandTop + upperH * 0.24, CD * 1.02 * F);
        if (F < 0) logo.rotation.y = Math.PI;
        g.add(logo);
      }

      // Flat brim: a HALF disc so it projects forward only. A full disc reaches
      // out behind the head and reads as a bowler hat.
      const brimR = CW * 1.0, brimZ = (CD * 1.72) / brimR;
      const brim = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(brimR, brimR, HH * 0.07, 26, 1, false, -Math.PI / 2, Math.PI), cloth(c));
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(brimR * 0.97, brimR * 0.97, HH * 0.03, 26, 1, false, -Math.PI / 2, Math.PI), cloth(dk2));
      lip.position.y = -HH * 0.05;
      brim.add(plate, lip);
      brim.scale.z = brimZ;
      brim.position.set(0, baseY + HH * 0.01, CD * 0.3 * F);
      brim.rotation.x = -0.05 * F;
      if (F < 0) brim.rotation.y = Math.PI;
      g.add(brim);

      at(box(CW * 0.24, HH * 0.12, CD * 0.24, cloth(c2)), 0, topY + HH * 0.05, 0);   // squatchee button

      // snapback strap across the rear opening, with its two rows of holes
      at(box(CW * 1.5, gapH * 0.58, CD * 0.16, cloth(c2)), 0, baseY + gapH * 0.4, -CD * 1.02 * F);
      for (let col = -2; col <= 2; col++) {
        for (const row of [-1, 1]) {
          const hole = at(cyl(CW * 0.05, CW * 0.05, CD * 0.1, cloth('#1a1013'), 8),
            col * CW * 0.27, baseY + gapH * 0.4 + row * gapH * 0.12, -CD * 1.06 * F);
          hole.rotation.x = Math.PI / 2;
        }
      }
      break;
    }
    case 'beanie': {
      // Sits on the crown of the head with the cuff at the brow — pulled any
      // lower and the knit covers the eyes.
      at(dome(R * 1.08, cloth(c), 0.62, 14), 0, TOP - R * 0.05, 0);
      for (let i = 0; i < 3; i++) {       // knit ribs
        const rib = at(ring(R * (1.06 - i * 0.04), 0.012, cloth(dk), 18), 0, TOP + R * (0.06 + i * 0.16), 0);
        rib.rotation.x = Math.PI / 2;
      }
      at(cyl(R * 1.12, R * 1.12, R * 0.3, cloth(c2), 18), 0, TOP - R * 0.1, 0);
      const cuffLip = at(ring(R * 1.12, 0.04, cloth(l2), 18), 0, TOP - R * 0.24, 0);
      cuffLip.rotation.x = Math.PI / 2;
      at(sph(R * 0.26, cloth(c2), 10, 8), 0, TOP + R * 0.78, 0);       // pom
      break;
    }
    case 'tophat': {
      const brim = at(cyl(R * 1.6, R * 1.6, 0.05, cloth(c), 20), 0, TOP, 0);
      const edge = at(ring(R * 1.6, 0.028, cloth(dk), 22), 0, TOP, 0);
      edge.rotation.x = Math.PI / 2;
      at(cyl(R * 1.0, R * 1.04, R * 1.8, cloth(c), 20), 0, TOP + R * 0.9, 0);
      at(cyl(R * 1.01, R * 1.01, 0.012, cloth(lt), 20), 0, TOP + R * 1.79, 0);  // crown top
      at(cyl(R * 1.05, R * 1.05, R * 0.26, cloth(c2), 20), 0, TOP + R * 0.24, 0);  // band
      const buckle = at(box(R * 0.3, R * 0.24, 0.03, metal(GOLD)), 0, TOP + R * 0.24, R * 1.06 * F);
      buckle.add(new THREE.Mesh(new THREE.BoxGeometry(R * 0.16, R * 0.12, 0.05), lam(shade(c2, -0.1))));
      break;
    }
    case 'crown': {
      const band = at(cyl(R * 1.06, R * 1.06, R * 0.5, metal(c, { side: THREE.DoubleSide }), 12, true), 0, TOP + R * 0.1, 0);
      for (const yy of [-0.14, 0.14]) {   // rolled rims top and bottom
        const rim = at(ring(R * 1.07, 0.022, metal(lt), 14), 0, TOP + R * 0.1 + R * yy * 2, 0);
        rim.rotation.x = Math.PI / 2;
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const big = i === 0;
        at(cone(R * (big ? 0.22 : 0.18), R * (big ? 0.72 : 0.5), metal(c), 4),
          Math.cos(a) * R * 1.06, TOP + R * (big ? 0.62 : 0.5), Math.sin(a) * R * 1.06);
        at(sph(R * (big ? 0.13 : 0.09), glass(c2, 0.9), 10, 8),
          Math.cos(a) * R * 1.1, TOP + R * (big ? 0.92 : 0.72), Math.sin(a) * R * 1.1);
        at(sph(R * 0.07, glass(c2, 0.85), 8, 6),                    // jewels set in the band
          Math.cos(a + 0.5) * R * 1.08, TOP + R * 0.1, Math.sin(a + 0.5) * R * 1.08);
      }
      break;
    }
    case 'cowboy': {
      const brim = at(cyl(R * 2.0, R * 2.0, 0.045, cloth(c), 22), 0, TOP - R * 0.1, 0);
      brim.scale.z = 0.8;
      for (const s of [-1, 1]) {          // the sides curl up
        const curl = at(box(R * 0.5, R * 0.3, R * 2.2, cloth(c)), s * R * 1.78, TOP - R * 0.02, 0);
        curl.scale.z = 0.8; curl.rotation.z = -s * 0.5;
      }
      const crown = at(cyl(R * 0.95, R * 1.06, R * 1.2, cloth(c), 16), 0, TOP + R * 0.45, 0);
      const crease = at(box(R * 0.3, R * 0.5, R * 1.5, cloth(dk)), 0, TOP + R * 0.95, 0);
      crease.scale.z = 0.9;
      at(cyl(R * 1.08, R * 1.08, R * 0.2, cloth(c2), 18), 0, TOP + R * 0.05, 0);   // band
      at(cyl(R * 0.11, R * 0.11, 0.02, metal(STEEL), 10), 0, TOP + R * 0.05, R * 1.08 * F).rotation.x = Math.PI / 2;
      break;
    }
    case 'headphones': {
      const band = at(ring(R * 1.1, 0.05, cloth(c2), 18, Math.PI), 0, TOP - R * 0.2, 0);
      const pad = at(ring(R * 1.02, 0.045, cloth(d2), 16, Math.PI * 0.8), 0, TOP - R * 0.2, 0);
      pad.rotation.z = Math.PI * 0.1;
      for (const s of [-1, 1]) {
        const arm = at(box(0.03, R * 0.5, 0.03, metal(STEEL)), s * R * 1.08, TOP - R * 0.5, 0);
        const cup = at(cyl(R * 0.42, R * 0.42, R * 0.34, cloth(c), 14), s * R * 1.12, -R * 0.15, 0);
        cup.rotation.z = Math.PI / 2;
        const rim = at(ring(R * 0.42, 0.035, metal(STEEL), 16), s * R * 1.28, -R * 0.15, 0);
        rim.rotation.y = Math.PI / 2;
        const cushion = at(cyl(R * 0.38, R * 0.34, R * 0.16, cloth(DARK), 14), s * R * 0.98, -R * 0.15, 0);
        cushion.rotation.z = Math.PI / 2;
        at(cyl(R * 0.16, R * 0.16, 0.02, cloth(c2), 10), s * R * 1.3, -R * 0.15, 0).rotation.z = Math.PI / 2;
      }
      break;
    }
    case 'halo': {
      at(ring(R * 0.95, 0.045, new THREE.MeshBasicMaterial({ color: c }), 24), 0, TOP + R * 1.1, 0).rotation.x = Math.PI / 2;
      const glow = at(ring(R * 0.95, 0.1, new THREE.MeshBasicMaterial({ color: c2, transparent: true, opacity: 0.45 }), 24), 0, TOP + R * 1.1, 0);
      glow.rotation.x = Math.PI / 2;
      at(ring(R * 0.7, 0.02, new THREE.MeshBasicMaterial({ color: c2, transparent: true, opacity: 0.35 }), 20), 0, TOP + R * 1.12, 0).rotation.x = Math.PI / 2;
      break;
    }
    case 'horns': {
      const band = at(ring(R * 1.04, 0.035, cloth(dk2), 18), 0, TOP - R * 0.05, 0);
      band.rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) {
        const horn = at(cone(R * 0.28, R * 0.9, cloth(c), 8), s * R * 0.6, TOP + R * 0.3, 0);
        horn.rotation.z = -s * 0.4;
        for (let i = 0; i < 3; i++) {     // growth ridges
          const rg = at(ring(R * (0.24 - i * 0.05), 0.018, cloth(dk), 10), s * (R * 0.6 + i * R * 0.1), TOP + R * (0.12 + i * 0.22), 0);
          rg.rotation.x = Math.PI / 2; rg.rotation.y = -s * 0.4;
        }
        const tip = at(cone(R * 0.11, R * 0.3, cloth(c2), 8), s * R * 0.78, TOP + R * 0.76, 0);
        tip.rotation.z = -s * 0.4;
      }
      break;
    }
    case 'wizard': {
      const hat = at(cone(R * 1.2, R * 3, cloth(c), 18), 0, TOP + R * 1.4, 0);
      hat.rotation.z = 0.12;                                   // a slight droop
      at(cyl(R * 1.7, R * 1.7, 0.04, cloth(c), 20), 0, TOP, 0);
      at(ring(R * 1.7, 0.03, cloth(dk), 22), 0, TOP, 0).rotation.x = Math.PI / 2;
      at(cyl(R * 1.16, R * 1.16, R * 0.28, cloth(c2), 18), 0, TOP + R * 0.24, 0);   // band
      at(box(R * 0.26, R * 0.2, 0.03, metal(GOLD)), 0, TOP + R * 0.24, R * 1.18 * F);
      const stars = [[0.5, 1.2, 0.75], [-0.42, 1.9, 0.55], [0.28, 2.5, 0.35]];
      for (const [sx, sy, sz] of stars) {                       // little stars up the cone
        const st = at(cone(R * 0.13, R * 0.05, basic(c2), 5), sx * R, TOP + sy * R, sz * R * F);
        st.rotation.x = Math.PI / 2 * F;
      }
      break;
    }
    case 'bandana': {
      at(dome(R * 1.06, cloth(c), 0.42, 14), 0, TOP - R * 0.3, 0);
      at(ring(R * 1.06, 0.03, cloth(dk), 18), 0, TOP - R * 0.42, 0).rotation.x = Math.PI / 2;
      const knot = at(sph(R * 0.2, cloth(c), 8, 6), -R * 1.0, TOP - R * 0.45, -R * 0.35 * F);
      for (const [ang, len] of [[0.5, 0.8], [-0.2, 0.6]]) {     // trailing tails
        const tail = at(box(R * 0.16, R * len, R * 0.06, cloth(dk)), -R * 1.05, TOP - R * (0.5 + len * 0.5), -R * 0.42 * F);
        tail.rotation.z = ang;
      }
      for (let i = 0; i < 7; i++) {                             // printed dots
        const a = (i / 7) * Math.PI * 2;
        at(cyl(R * 0.07, R * 0.07, 0.005, basic(c2), 8), Math.cos(a) * R * 0.72, TOP - R * 0.12, Math.sin(a) * R * 0.72);
      }
      break;
    }

    // ---- face pieces: primary is the frame, secondary is the lens ----
    case 'glasses': case 'shades': {
      const dark = item.build === 'shades';
      const lensCol = dark ? (item.color2 || '#15171c') : (item.color2 || '#9fd4ff');
      const lensMat = dark ? shiny(lensCol) : glass(lensCol, 0.5);
      for (const s of [-1, 1]) {
        const rim = at(ring(R * 0.34, R * 0.055, shiny(c), 18), s * R * 0.42, R * 0.1, R * 0.99 * F);
        rim.rotation.y = F < 0 ? Math.PI : 0;
        const lens = at(new THREE.Mesh(new THREE.CircleGeometry(R * 0.32, 16), lensMat), s * R * 0.42, R * 0.1, R * 0.985 * F);
        lens.rotation.y = F < 0 ? Math.PI : 0;
        // temple arm running back toward the ear
        const arm = at(box(0.016, 0.016, R * 0.95, shiny(c)), s * R * 0.74, R * 0.12, R * 0.55 * F);
        arm.rotation.y = -s * 0.28 * F;
      }
      at(box(R * 0.2, 0.022, 0.022, shiny(c)), 0, R * 0.16, R * 1.0 * F);        // bridge
      for (const s of [-1, 1]) at(box(0.014, R * 0.1, 0.014, shiny(c)), s * R * 0.14, R * 0.02, R * 1.0 * F);  // nose pads
      break;
    }
    case 'mask': {
      const m = at(dome(R * 1.0, cloth(c), 0.5, 14), 0, -R * 0.35, R * 0.1 * F);
      m.rotation.x = Math.PI; m.scale.z = 1.1;
      for (let i = 0; i < 3; i++) {                       // pleats
        const pl = at(box(R * 1.3, R * 0.05, R * 0.04, cloth(dk)), 0, -R * (0.2 + i * 0.22), R * 0.92 * F);
      }
      at(box(R * 0.5, 0.02, 0.02, metal(STEEL)), 0, -R * 0.02, R * 0.95 * F);    // nose wire
      for (const s of [-1, 1]) {                          // ear loops
        const loop = at(ring(R * 0.36, 0.018, cloth(c2), 14, Math.PI * 1.2), s * R * 0.95, -R * 0.3, R * 0.25 * F);
        loop.rotation.y = Math.PI / 2; loop.rotation.z = -s * 0.4;
      }
      break;
    }
    case 'monocle': {
      at(ring(R * 0.3, 0.032, metal(c), 18), R * 0.42, R * 0.1, R * 0.98 * F).rotation.y = F < 0 ? Math.PI : 0;
      const lens = at(new THREE.Mesh(new THREE.CircleGeometry(R * 0.28, 16), glass(c2, 0.45)), R * 0.42, R * 0.1, R * 0.965 * F);
      lens.rotation.y = F < 0 ? Math.PI : 0;
      for (let i = 0; i < 5; i++) {                       // a chain of little links
        const lk = at(ring(0.012, 0.005, metal(c), 8), R * (0.42 - i * 0.02), R * (-0.05 - i * 0.13), R * 0.98 * F);
        lk.rotation.x = i % 2 ? Math.PI / 2 : 0;
      }
      break;
    }
    case 'eyepatch': {
      const patch = at(new THREE.Mesh(new THREE.CircleGeometry(R * 0.32, 16), cloth(c)), -R * 0.42, R * 0.12, R * 1.0 * F);
      patch.rotation.y = F < 0 ? Math.PI : 0;
      const stitch = at(ring(R * 0.27, 0.012, cloth(c2), 18), -R * 0.42, R * 0.12, R * 1.01 * F);
      stitch.rotation.y = F < 0 ? Math.PI : 0;
      const strap = at(ring(R * 1.02, 0.028, cloth(c), 22, Math.PI * 1.25), 0, R * 0.2, 0);
      strap.rotation.z = 0.3;
      break;
    }
    case 'threed': {
      at(box(R * 1.55, R * 0.42, 0.035, shiny(c)), 0, R * 0.1, R * 0.98 * F);
      at(box(R * 1.55, R * 0.07, 0.045, shiny(c2)), 0, R * 0.3, R * 0.98 * F);       // top rail
      for (const [s, col] of [[-1, '#ff3b3b'], [1, '#3b7bff']]) {
        const lens = at(new THREE.Mesh(new THREE.CircleGeometry(R * 0.3, 16), glass(col, 0.6)), s * R * 0.4, R * 0.1, R * 1.005 * F);
        lens.rotation.y = F < 0 ? Math.PI : 0;
      }
      for (const s of [-1, 1]) {
        const arm = at(box(0.018, 0.018, R * 0.9, shiny(c)), s * R * 0.74, R * 0.12, R * 0.55 * F);
        arm.rotation.y = -s * 0.28 * F;
      }
      break;
    }

    // ---- back items: origin is the chest, +Z*F is forward so back = -Z*F ----
    case 'backpack': {
      at(box(0.42, 0.5, 0.24, cloth(c)), 0, 0.02, -0.3 * F);
      const flap = at(box(0.44, 0.19, 0.27, cloth(dk)), 0, 0.22, -0.29 * F);
      flap.rotation.x = -0.16 * F;
      at(box(0.3, 0.2, 0.12, cloth(lt)), 0, -0.13, -0.42 * F);                    // front pocket
      at(box(0.32, 0.02, 0.13, cloth(dk2)), 0, -0.02, -0.42 * F);                 // pocket zip
      for (const y of [0.12, -0.05]) {                                            // buckles
        at(box(0.055, 0.045, 0.05, metal(STEEL)), 0, y, -0.44 * F);
        at(box(0.03, 0.09, 0.03, cloth(c2)), 0, y + 0.06, -0.44 * F);
      }
      for (const s of [-1, 1]) {                                                  // shoulder straps
        const strap = at(box(0.065, 0.54, 0.05, cloth(c2)), s * 0.16, 0.0, 0.15 * F);
        strap.rotation.x = 0.22 * F;
        at(box(0.075, 0.06, 0.055, metal(STEEL)), s * 0.16, -0.16, 0.2 * F);      // strap slider
      }
      at(ring(0.05, 0.014, cloth(c2), 12), 0, 0.3, -0.3 * F).rotation.x = Math.PI / 2;   // grab handle
      break;
    }
    case 'wings': {
      for (const s of [-1, 1]) {
        const wing = at(new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), cloth(c, { side: THREE.DoubleSide, transparent: true, opacity: 0.85 })), s * 0.3, 0.15, -0.22 * F);
        wing.rotation.y = s * 0.7 * F;
        // a strut down the leading edge plus veins, so it isn't a flat sheet
        const strut = at(box(0.03, 0.82, 0.03, cloth(c2)), s * 0.3, 0.15, -0.22 * F);
        strut.rotation.y = s * 0.7 * F; strut.position.x += s * 0.28 * Math.cos(s * 0.7 * F);
        for (let i = 0; i < 3; i++) {
          const vein = at(box(0.5, 0.014, 0.014, cloth(c2, { transparent: true, opacity: 0.8 })), s * 0.3, 0.4 - i * 0.24, -0.22 * F);
          vein.rotation.y = s * 0.7 * F; vein.rotation.z = -s * 0.25;
        }
      }
      break;
    }
    case 'cape': {
      const outer = cloth(c, { side: THREE.DoubleSide });
      const liner = cloth(c2, { side: THREE.DoubleSide });
      const N = 7, spanW = 0.62;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1) - 0.5;
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(spanW / N + 0.03, 1.02), outer);
        panel.position.set(t * spanW, -0.22, (-0.2 - Math.cos(t * Math.PI) * 0.07) * F);
        panel.rotation.y = -t * 0.55 * F; panel.rotation.x = 0.1 * F;
        g.add(panel);
        // the lining shows where the cape falls open at the edges
        if (i === 0 || i === N - 1) {
          const li = new THREE.Mesh(new THREE.PlaneGeometry(spanW / N, 1.0), liner);
          li.position.copy(panel.position); li.position.z += 0.012 * F;
          li.rotation.copy(panel.rotation);
          g.add(li);
        }
      }
      at(box(0.46, 0.12, 0.17, cloth(dk)), 0, 0.28, -0.05 * F).rotation.x = 0.1 * F;   // collar
      at(box(0.44, 0.04, 0.16, cloth(c2)), 0, 0.34, -0.05 * F).rotation.x = 0.1 * F;   // collar trim
      at(sph(0.045, metal(GOLD), 10, 8), 0, 0.25, 0.13 * F);                           // clasp
      at(box(0.2, 0.03, 0.03, metal(GOLD)), 0, 0.25, 0.11 * F);                        // clasp chain
      break;
    }
    case 'jetpack': {
      at(box(0.36, 0.42, 0.08, metal(c2)), 0, 0.03, -0.26 * F);
      at(box(0.3, 0.05, 0.09, cloth(shade(c2, -0.3))), 0, 0.19, -0.26 * F);            // harness rail
      for (const s of [-1, 1]) {
        at(cyl(0.1, 0.1, 0.46, shiny(c), 14), s * 0.15, 0.05, -0.33 * F);
        at(cyl(0.102, 0.102, 0.05, cloth('#f0c23c'), 14), s * 0.15, 0.16, -0.33 * F);  // warning band
        at(dome(0.1, shiny(dk), 0.5, 12), s * 0.15, 0.28, -0.33 * F);
        at(cyl(0.05, 0.085, 0.1, metal(DARK), 12), s * 0.15, -0.22, -0.33 * F);
        at(cyl(0.09, 0.09, 0.02, metal(STEEL), 12), s * 0.15, -0.17, -0.33 * F);
        at(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 10), new THREE.MeshBasicMaterial({ color: '#ff9a3a', transparent: true, opacity: 0.85 })), s * 0.15, -0.36, -0.33 * F).rotation.x = Math.PI;
        at(new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.12, 10), new THREE.MeshBasicMaterial({ color: '#ffe6a0', transparent: true, opacity: 0.9 })), s * 0.15, -0.32, -0.33 * F).rotation.x = Math.PI;
        const hose = at(cyl(0.018, 0.018, 0.2, cloth(DARK), 8), s * 0.08, 0.16, -0.29 * F);
        hose.rotation.z = -s * 0.6;
      }
      break;
    }
    case 'sword': {
      const grp = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.016), metal(STEEL)); blade.position.y = 0.06; grp.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.031, 0.12, 4), metal(STEEL)); tip.position.y = 0.38; tip.rotation.y = Math.PI / 4; grp.add(tip);
      const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.5, 0.024), metal('#9aa2ad')); fuller.position.y = 0.06; grp.add(fuller);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.06), metal(c2)); guard.position.y = -0.22; grp.add(guard);
      for (const s of [-1, 1]) {                       // quillon tips
        const q = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), metal(c2)); q.position.set(s * 0.11, -0.22, 0); grp.add(q);
      }
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.17, 10), cloth(c)); grip.position.y = -0.32; grp.add(grip);
      for (let i = 0; i < 4; i++) {                    // grip wrap
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.006, 6, 12), cloth(dk));
        w.rotation.x = Math.PI / 2; w.position.y = -0.27 - i * 0.04; grp.add(w);
      }
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.037, 10, 8), metal(c2)); pommel.position.y = -0.42; grp.add(pommel);
      grp.position.set(-0.24, 0.12, -0.26 * F); grp.rotation.z = 0.5; g.add(grp);
      // a strap across the back so it isn't floating
      const belt = at(box(0.06, 0.62, 0.03, cloth(dk)), -0.02, 0.05, -0.24 * F);
      belt.rotation.z = -0.6;
      break;
    }
    case 'angelwings': {
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const fw = at(new THREE.Mesh(new THREE.PlaneGeometry(0.34 - i * 0.06, 0.5 - i * 0.08), cloth(c, { side: THREE.DoubleSide })), s * (0.18 + i * 0.14), 0.28 - i * 0.18, -0.22 * F);
          fw.rotation.y = s * 0.9 * F; fw.rotation.z = -s * 0.2;
          // tipped feathers in the second colour give the layers definition
          const tp = at(new THREE.Mesh(new THREE.PlaneGeometry(0.3 - i * 0.06, 0.14), cloth(c2, { side: THREE.DoubleSide })), s * (0.2 + i * 0.15), 0.08 - i * 0.19, -0.215 * F);
          tp.rotation.y = s * 0.9 * F; tp.rotation.z = -s * 0.2;
        }
      }
      break;
    }
    case 'balloon': {
      at(cyl(0.006, 0.006, 0.9, cloth(c2), 6), 0.1, 0.5, -0.1 * F);
      const ball = at(sph(0.28, shiny(c), 16, 12), 0.1, 1.05, -0.1 * F); ball.scale.y = 1.15;
      at(cone(0.05, 0.09, cloth(dk), 8), 0.1, 0.78, -0.1 * F).rotation.x = Math.PI;   // knot
      const hi = at(sph(0.07, basic(shade(c, 0.65)), 10, 8), 0.02, 1.2, 0.06 * F);     // highlight
      hi.scale.set(1.3, 0.9, 0.6);
      break;
    }
    case 'guitar': {
      const bodyMat = shiny(c);
      at(cyl(0.22, 0.22, 0.09, bodyMat, 22), 0.1, -0.26, -0.26 * F).rotation.x = Math.PI / 2;
      at(cyl(0.165, 0.165, 0.09, bodyMat, 22), 0.1, -0.02, -0.26 * F).rotation.x = Math.PI / 2;
      // pickguard in the second colour, the part that reads first on a real one
      const pg = at(new THREE.Mesh(new THREE.CircleGeometry(0.11, 18, 0, Math.PI * 1.1), shiny(c2)), 0.17, -0.2, -0.212 * F);
      pg.rotation.y = F < 0 ? Math.PI : 0; pg.rotation.z = 0.6;
      at(new THREE.Mesh(new THREE.CircleGeometry(0.06, 18), basic('#141414')), 0.1, -0.13, -0.211 * F).rotation.y = F < 0 ? Math.PI : 0;
      at(ring(0.065, 0.008, cloth(c2), 20), 0.1, -0.13, -0.211 * F).rotation.y = F < 0 ? Math.PI : 0;   // rosette
      at(box(0.12, 0.03, 0.03, cloth('#241a12')), 0.1, -0.33, -0.21 * F);
      const neck = at(box(0.07, 0.62, 0.05, cloth(item.color2 ? shade(c2, -0.2) : '#6b4a2a')), -0.05, 0.34, -0.26 * F);
      neck.rotation.z = 0.34;
      for (let i = 0; i < 6; i++) {                    // frets
        const fr = at(box(0.072, 0.008, 0.052, metal(STEEL)), -0.05 - i * 0.028, 0.16 + i * 0.083, -0.255 * F);
        fr.rotation.z = 0.34;
      }
      const head = at(box(0.1, 0.15, 0.035, cloth('#3a2a1a')), -0.28, 0.64, -0.26 * F);
      head.rotation.z = 0.34;
      for (const s of [-1, 1]) at(cyl(0.008, 0.008, 0.05, metal(STEEL), 6), -0.28 + s * 0.045, 0.66, -0.24 * F).rotation.x = Math.PI / 2;
      for (let i = -1; i <= 1; i++) {
        const str = at(cyl(0.004, 0.004, 0.78, basic('#e0e0e0'), 4), 0.08 + i * 0.022, 0.04, -0.205 * F);
        str.rotation.z = 0.34;
      }
      break;
    }

    // ---- outfits: anchored on the body (Hips for shorts, Torso for one-piece) ----
    case 'swimshorts': {        // boys: coloured board shorts around hips + thighs
      at(cyl(0.29, 0.31, 0.4, cloth(c), 18), 0, 0.02, 0).scale.z = 1.12;
      for (const s of [-1, 1]) {
        at(cyl(0.185, 0.17, 0.42, cloth(c), 16), s * 0.135, -0.26, 0.01);
        at(box(0.02, 0.42, 0.19, cloth(c2)), s * 0.19, -0.26, 0.01);            // side stripe
        const hem = at(ring(0.172, 0.022, cloth(c2), 16), s * 0.135, -0.46, 0.01);
        hem.rotation.x = Math.PI / 2;
      }
      const band = at(ring(0.3, 0.032, cloth(c2), 22), 0, 0.19, 0);
      band.rotation.x = Math.PI / 2; band.scale.z = 1.12;
      at(sph(0.03, cloth(c2), 8, 6), 0, 0.15, 0.33 * F);                        // drawstring knot
      for (const s of [-1, 1]) at(cyl(0.008, 0.008, 0.1, cloth(c2), 6), s * 0.035, 0.11, 0.33 * F).rotation.x = 0.3;
      break;
    }
    case 'swimsuit': {          // girls: a full one-piece over torso + hips
      at(cyl(0.25, 0.27, 0.6, cloth(c), 18), 0, 0.02, 0).scale.z = 1.2;
      const hips = at(sph(0.28, cloth(c), 16, 12), 0, -0.36, 0);
      hips.scale.set(1, 0.72, 1.16);
      for (const s of [-1, 1]) {
        const strap = at(ring(0.17, 0.026, cloth(c), 12, Math.PI * 0.9), s * 0.17, 0.3, 0);
        strap.rotation.y = Math.PI / 2; strap.rotation.z = -0.15;
        const trimS = at(ring(0.17, 0.01, cloth(c2), 12, Math.PI * 0.9), s * 0.17, 0.3, 0);
        trimS.rotation.y = Math.PI / 2; trimS.rotation.z = -0.15;
      }
      const trim = at(ring(0.26, 0.022, cloth(c2), 22), 0, -0.17, 0);
      trim.rotation.x = Math.PI / 2; trim.scale.z = 1.2;
      const neckline = at(ring(0.25, 0.018, cloth(c2), 22), 0, 0.3, 0);
      neckline.rotation.x = Math.PI / 2; neckline.scale.z = 1.2;
      break;
    }

    // ---- shirts: a thin shell around the measured chest, print on the front ----
    case 'shirt': {
      if (!torso) break;
      // Follow the measured chest: full torso height, tapering slightly to the
      // waist, and squashed in Z so it hugs an oval body rather than a barrel.
      const rTop = torso.halfW * 1.13, rBot = torso.halfW * 1.0;
      const squash = (torso.halfD * 1.06) / rTop;
      const h = torso.height * 0.94;
      const yOff = -torso.height * 0.02;
      const arc = Math.PI * 0.62;
      // The stick-fight print is a full-bleed purple design, so the rest of the
      // shirt takes its background rather than the wearer's colour.
      // A graphic tee is a plain shirt plus a print panel on the chest; a
      // pattern (stripes, ringer) belongs on the whole garment instead.
      const graphic = item.art === 'stickfight';
      const shellMat = graphic
        ? cloth('#3d1560', { side: THREE.DoubleSide })
        : new THREE.MeshLambertMaterial({ map: shirtArt(item.art || 'plain', c, c2), side: THREE.DoubleSide });
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 30, 1, true), shellMat);
      shell.scale.z = squash; shell.position.y = yOff;
      g.add(shell);
      if (graphic) {
        const panel = new THREE.Mesh(
          new THREE.CylinderGeometry(rTop * 1.015, rBot * 1.02, h * 0.9, 30, 1, true, -arc / 2, arc),
          new THREE.MeshLambertMaterial({ map: shirtArt(item.art, c, c2), side: THREE.DoubleSide }),
        );
        panel.scale.z = squash; panel.position.y = yOff;
        if (F < 0) panel.rotation.y = Math.PI;
        g.add(panel);
      }
      const collar = at(ring(rTop * 0.62, 0.022, cloth(c2), 26), 0, yOff + h * 0.5, 0);
      collar.rotation.x = Math.PI / 2; collar.scale.z = squash;
      const hem = at(ring(rBot * 1.01, 0.018, cloth(c2), 26), 0, yOff - h * 0.5, 0);
      hem.rotation.x = Math.PI / 2; hem.scale.z = squash;
      break;
    }

    // ---- footwear: origin is the ankle joint, +Z*F is toes-forward ----
    // Every dimension comes from the measured foot, so the same build fits a
    // rig with real toes and one whose leg simply ends at the floor.
    case 'sneakers': case 'hightops': case 'boots': case 'dress': case 'sandals': {
      if (!foot) break;
      const AY = foot.ankleY, HW = foot.halfW, TOE = foot.toe, HEEL = foot.heel;
      const LEN = TOE + HEEL;                 // heel-to-toe
      const ZC = (TOE - HEEL) / 2;            // shoe centre, ahead of the ankle
      const W = HW * 2;
      // helpers in foot space: y is measured up from the ground, z from the ankle
      const fb = (w, h, d, mat, yGround, z = ZC) => at(box(w, h, d, mat), 0, -AY + yGround, z * F);
      const kind = item.build;

      if (kind === 'sandals') {
        fb(W * 1.02, AY * 0.2, LEN, cloth(c), AY * 0.1);                       // sole
        fb(W * 0.94, AY * 0.09, LEN * 0.96, cloth(c2), AY * 0.24);             // footbed
        const s1 = fb(W * 1.0, AY * 0.11, LEN * 0.17, cloth(c2), AY * 0.42, ZC + LEN * 0.3);
        s1.rotation.x = 0.22 * F;
        const s2 = fb(W * 0.96, AY * 0.11, LEN * 0.15, cloth(c2), AY * 0.5, ZC);
        s2.rotation.x = -0.18 * F;
        fb(W * 0.5, AY * 0.1, AY * 0.1, cloth(c2), AY * 0.4, -HEEL * 0.9);     // heel strap
        break;
      }

      const boot = kind === 'boots', dress = kind === 'dress', high = kind === 'hightops';
      const soleCol = dress ? shade(c2, -0.35) : boot ? d2 : c2;
      const soleH = dress ? AY * 0.14 : boot ? AY * 0.26 : AY * 0.24;
      fb(W * 1.03, soleH, LEN, cloth(soleCol), soleH / 2);                     // sole
      if (!dress) {                                                            // tread blocks
        const n = boot ? 5 : 4;
        for (let i = 0; i < n; i++) fb(W * 1.0, AY * 0.07, LEN / (n + 1.4), cloth(shade(soleCol, -0.3)), AY * 0.02, -HEEL + LEN * ((i + 0.7) / n));
      }
      if (!boot && !dress) fb(W * 1.06, AY * 0.08, LEN * 1.005, cloth(l2), soleH + AY * 0.04);   // midsole stripe
      if (boot || dress) fb(W * 0.94, AY * 0.22, LEN * 0.3, cloth(soleCol), -AY * 0.06 + soleH / 2, -HEEL + LEN * 0.16);  // heel block

      const upperMat = dress ? shiny(c) : cloth(c);
      const upperH = boot ? AY * 0.72 : dress ? AY * 0.58 : AY * 0.68;
      fb(W * 0.97, upperH, LEN * 0.92, upperMat, soleH + upperH / 2);          // upper
      // A gently domed toe box. It stays close to the upper's colour — a big
      // lighten here reads as a grey egg stuck on the front of the shoe.
      const toeCol = dress ? shade(c, 0.12) : boot ? dk : shade(c, 0.07);
      const toeCap = at(sph(HW * 0.88, dress ? shiny(toeCol) : cloth(toeCol), 12, 8), 0, -AY + soleH + upperH * 0.42, (ZC + LEN * 0.3) * F);
      toeCap.scale.set(1, dress ? 0.38 : 0.46, 1.05);

      if (dress) {
        fb(W * 0.58, AY * 0.3, LEN * 0.34, shiny(c2), soleH + upperH * 0.85, ZC - LEN * 0.1);   // vamp
        for (let i = 0; i < 2; i++) fb(W * 0.5, AY * 0.05, AY * 0.05, cloth(shade(c2, 0.35)), soleH + upperH * 1.05, ZC - LEN * 0.16 + i * LEN * 0.14);
        fb(W * 0.95, AY * 0.3, LEN * 0.12, shiny(c), soleH + upperH * 0.7, -HEEL * 0.88);       // heel counter
        break;
      }

      // laces, tongue and heel tab — the parts that read as a trainer
      fb(W * 0.58, AY * 0.32, LEN * 0.14, cloth(dk), soleH + upperH * 0.95, ZC - LEN * 0.14);   // tongue
      const rows = boot ? 4 : 3;
      for (let i = 0; i < rows; i++) {
        const yy = soleH + upperH * (0.8 + i * 0.28);
        fb(W * 0.72, AY * 0.055, AY * 0.055, cloth(c2), yy, ZC - LEN * 0.12 + i * LEN * 0.13);
        if (boot) for (const sd of [-1, 1]) {
          const eye = at(cyl(HW * 0.11, HW * 0.11, AY * 0.06, metal(STEEL), 6), sd * HW * 0.75, -AY + yy, (ZC - LEN * 0.12 + i * LEN * 0.13) * F);
          eye.rotation.x = Math.PI / 2;
        }
      }
      for (const sd of [-1, 1]) {                                              // side flash
        const fl = at(box(AY * 0.06, AY * 0.28, LEN * 0.5, cloth(c2)), sd * HW * 0.98, -AY + soleH + upperH * 0.5, ZC * F);
        fl.rotation.x = 0.2 * F;
      }
      fb(W * 0.62, AY * 0.3, AY * 0.1, cloth(c2), soleH + upperH * 0.95, -HEEL * 0.9);          // heel tab

      if (boot || high) {                                                      // ankle shaft / collar
        const shaftH = boot ? AY * 1.15 : AY * 0.6;
        const shaftR = HW * (boot ? 1.0 : 0.96);
        at(cyl(shaftR, shaftR * 1.06, shaftH, cloth(c), 14), 0, -AY + soleH + upperH + shaftH / 2, ZC * F * 0.25);
        at(cyl(shaftR * 1.09, shaftR * 1.09, AY * (boot ? 0.28 : 0.18), cloth(c2), 14), 0, -AY + soleH + upperH + shaftH, ZC * F * 0.25);
        if (high) {
          const patch = at(new THREE.Mesh(new THREE.CircleGeometry(HW * 0.4, 5), cloth(c2)), shaftR, -AY + soleH + upperH + shaftH * 0.5, ZC * F * 0.25);
          patch.rotation.y = Math.PI / 2;
        }
      }
      break;
    }

    // ---------- premium hats ----------
    case 'pirate': {
      const brim = at(cyl(R * 1.7, R * 1.7, 0.05, cloth(c), 20), 0, TOP, 0);
      brim.scale.x = 1.25;
      at(ring(R * 1.7, 0.03, cloth(c2), 22), 0, TOP + 0.01, 0).rotation.x = Math.PI / 2;   // piped edge
      at(dome(R * 1.02, cloth(c), 0.5, 14), 0, TOP, 0);
      at(cyl(R * 1.05, R * 1.05, R * 0.2, cloth(dk), 16), 0, TOP + R * 0.14, 0);           // band
      at(sph(R * 0.26, basic(c2), 12, 10), 0, TOP + R * 0.4, R * 0.98 * F);                // skull
      for (const s of [-1, 1]) {                                                           // crossbones
        const bone = at(box(R * 0.62, R * 0.08, 0.02, basic(c2)), 0, TOP + R * 0.16, R * 1.0 * F);
        bone.rotation.z = s * 0.6;
      }
      for (const s of [-1, 1]) at(sph(R * 0.07, basic(shade(c, -0.6)), 8, 6), s * R * 0.09, TOP + R * 0.44, R * 1.2 * F);  // eye sockets
      break;
    }
    case 'party': {
      at(cone(R * 0.85, R * 2.2, cloth(c), 18), 0, TOP + R * 1.0, 0);
      for (let i = 0; i < 4; i++) {                        // banded stripes up the cone
        const b = at(ring(R * (0.72 - i * 0.16), 0.035, cloth(i % 2 ? c2 : l2), 18), 0, TOP + R * (0.25 + i * 0.5), 0);
        b.rotation.x = Math.PI / 2;
      }
      at(sph(R * 0.22, cloth(c2), 10, 8), 0, TOP + R * 2.12, 0);                     // pom
      const strap = at(ring(R * 1.0, 0.014, cloth(c2), 20, Math.PI), 0, -R * 0.2, 0);
      strap.rotation.z = Math.PI;                                                    // chin elastic
      break;
    }
    case 'chef': {
      at(cyl(R * 1.02, R * 1.02, R * 0.55, cloth(c), 16), 0, TOP + R * 0.25, 0);      // band
      at(ring(R * 1.03, 0.022, cloth(c2), 18), 0, TOP + R * 0.5, 0).rotation.x = Math.PI / 2;
      const puff = at(sph(R * 1.15, cloth(c), 16, 12), 0, TOP + R * 0.9, 0);
      puff.scale.y = 0.8;
      for (let i = 0; i < 6; i++) {                        // gathers around the puff
        const a = (i / 6) * Math.PI * 2;
        const gp = at(cyl(R * 0.2, R * 0.24, R * 0.75, cloth(c2), 8), Math.cos(a) * R * 0.86, TOP + R * 0.88, Math.sin(a) * R * 0.86);
        gp.scale.set(1, 1, 0.65);
      }
      break;
    }
    case 'football': {
      at(dome(R * 1.18, shiny(c), 0.62, 16), 0, TOP - R * 0.35, 0);
      at(box(R * 0.18, R * 1.35, 0.025, shiny(c2)), 0, TOP - R * 0.1, 0);             // centre stripe
      for (const s of [-1, 1]) at(box(R * 0.07, R * 1.3, 0.02, shiny(c2)), s * R * 0.3, TOP - R * 0.12, 0);
      for (const s of [-1, 1]) at(cyl(R * 0.22, R * 0.22, 0.03, cloth(DARK), 12), s * R * 1.15, TOP - R * 0.5, 0).rotation.z = Math.PI / 2;
      for (const y of [-0.15, 0.12]) at(cyl(0.022, 0.022, R * 1.5, metal(STEEL), 8), 0, TOP + R * y, R * 1.05 * F).rotation.z = Math.PI / 2;
      at(cyl(0.022, 0.022, R * 0.5, metal(STEEL), 8), 0, TOP - R * 0.02, R * 1.05 * F);
      at(box(R * 0.55, R * 0.1, 0.03, cloth(c2)), 0, TOP - R * 0.72, R * 0.7 * F);    // chin strap
      break;
    }
    case 'flower': {
      at(ring(R * 1.05, 0.032, cloth('#4a8a3a'), 20), 0, TOP + R * 0.05, 0).rotation.x = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const col = i % 2 ? c : c2;                        // two flower colours alternating
        for (let p = 0; p < 5; p++) {                      // real petals around a centre
          const pa = (p / 5) * Math.PI * 2;
          const petal = at(sph(R * 0.09, cloth(col), 8, 6),
            Math.cos(a) * R * 1.05 + Math.cos(pa) * R * 0.1, TOP + R * 0.12, Math.sin(a) * R * 1.05 + Math.sin(pa) * R * 0.1);
          petal.scale.y = 0.5;
        }
        at(sph(R * 0.06, cloth('#ffd23f'), 8, 6), Math.cos(a) * R * 1.05, TOP + R * 0.15, Math.sin(a) * R * 1.05).scale.y = 0.6;
        const leaf = at(sph(R * 0.11, cloth('#3f7a32'), 8, 6), Math.cos(a + 0.4) * R * 1.06, TOP + R * 0.05, Math.sin(a + 0.4) * R * 1.06);
        leaf.scale.set(1, 0.32, 0.55);
      }
      break;
    }
    case 'propeller': {
      for (let i = 0; i < 4; i++) {                        // alternating beanie panels
        const panel = at(dome(R * 1.05, cloth(i % 2 ? c : c2), 0.5, 6), 0, TOP - R * 0.1, 0);
        panel.rotation.y = (i / 4) * Math.PI * 2;
        panel.geometry = new THREE.SphereGeometry(R * 1.05, 6, 8, (i / 4) * Math.PI * 2, Math.PI / 2, 0, Math.PI / 2);
        panel.rotation.y = 0;
      }
      at(ring(R * 1.05, 0.035, cloth(dk), 18), 0, TOP - R * 0.1, 0).rotation.x = Math.PI / 2;
      at(cyl(0.022, 0.022, R * 0.4, metal(DARK), 6), 0, TOP + R * 0.3, 0);
      at(cyl(R * 0.1, R * 0.1, R * 0.08, metal(STEEL), 10), 0, TOP + R * 0.5, 0);      // hub
      for (const s of [-1, 1]) {
        const bl = at(box(R * 0.9, 0.028, R * 0.22, cloth(s > 0 ? c2 : l2)), s * R * 0.45, TOP + R * 0.5, 0);
        bl.rotation.y = s * 0.3;
      }
      break;
    }
    default: return null;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return mergeByMaterial(g);
}

// Detail is cheap to author and expensive to draw: a laced boot is two dozen
// little boxes. Since a garment never animates internally, bake every part that
// shares a surface into one mesh — same picture, a handful of draw calls.
function mergeByMaterial(g) {
  try {
    g.updateMatrixWorld(true);
    const buckets = new Map();
    const meshes = [];
    g.traverse((o) => { if (o.isMesh && o.geometry && !Array.isArray(o.material)) meshes.push(o); });
    if (meshes.length < 3) return g;
    for (const m of meshes) {
      const mt = m.material;
      // anything that changes how the surface is drawn has to stay separate
      const key = [mt.type, mt.color?.getHexString(), mt.map?.uuid || '', mt.transparent ? 1 : 0,
        mt.opacity, mt.side, mt.shininess ?? '', mt.specular?.getHexString() ?? ''].join('|');
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      if (!geo.attributes.uv) return g;         // can't merge a mismatched set
      const b = buckets.get(key);
      if (b) b.geos.push(geo); else buckets.set(key, { mat: mt, geos: [geo] });
    }
    const out = new THREE.Group();
    for (const { mat, geos } of buckets.values()) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) return g;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      out.add(mesh);
    }
    return out;
  } catch (e) {
    return g;                                    // never let an optimisation break the look
  }
}

// expose the flat clothing list for editors
export function clothingCatalog() { return CLOTHING; }
