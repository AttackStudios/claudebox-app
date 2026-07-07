// Paved road ribbons laid over the graded roadbed: asphalt texture with a
// dashed center line; UV u runs along the road, v across it.

import * as THREE from 'three';
import { ROADS, roadInfo, roadElevation, height } from '/shared/bp/worldgen.js';
import { asphalt } from '../textures.js';

export function buildRoads() {
  const group = new THREE.Group();
  group.name = 'roads';
  const tex = asphalt();
  const roadMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
  const shoulderMat = new THREE.MeshLambertMaterial({ color: '#6e5a40', side: THREE.DoubleSide });

  for (const road of ROADS) {
    // resample the polyline at ~7u steps with smoothed corners
    const pts = resample(road.pts, 7);
    const rv = [], ruv = [], ridx = [];       // asphalt ribbon
    const sv = [], sidx = [];                  // embankment shoulders (drop to terrain)
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const dir = new THREE.Vector2(next.x - prev.x, next.z - prev.z).normalize();
      const nrm = new THREE.Vector2(-dir.y, dir.x);
      const hw = road.width / 2;
      const ri = roadInfo(p.x, p.z);
      const y = roadElevation(ri) + 0.06;
      if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z);

      // road edge points
      const lx = p.x + nrm.x * hw, lz = p.z + nrm.y * hw;
      const rx = p.x - nrm.x * hw, rz = p.z - nrm.y * hw;
      rv.push(lx, y, lz, rx, y, rz);
      const u = dist / (road.width * 2.2);
      ruv.push(u, 0, u, 1);

      // shoulder skirt: extend out and DROP to actual terrain so there's never
      // a gap under the road on coarse terrain (this kills the floating roads)
      const out = hw + Math.max(2.5, road.width * 0.5);
      const olx = p.x + nrm.x * out, olz = p.z + nrm.y * out;
      const orx = p.x - nrm.x * out, orz = p.z - nrm.y * out;
      const oly = Math.min(y, height(olx, olz)) - 0.04;
      const ory = Math.min(y, height(orx, orz)) - 0.04;
      // per point: [edgeL, outerL, edgeR, outerR]
      sv.push(lx, y, lz, olx, oly, olz, rx, y, rz, orx, ory, orz);

      if (i > 0) {
        const a = (i - 1) * 2;
        ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        const b = (i - 1) * 4;
        // left shoulder quad (edgeL→outerL) + right shoulder quad
        sidx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4);
        sidx.push(b + 2, b + 6, b + 3, b + 3, b + 6, b + 7);
      }
    }

    group.add(buildMesh(rv, ridx, roadMat, ruv));
    group.add(buildMesh(sv, sidx, shoulderMat));
  }
  return group;
}

function buildMesh(verts, idx, mat, uvs) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  if (uvs) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// Chaikin-ish smoothing + even resampling of a waypoint polyline
function resample(waypoints, step) {
  // corner-cut twice for smooth bends
  let pts = waypoints.map(([x, z]) => ({ x, z }));
  for (let pass = 0; pass < 2; pass++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  // even spacing
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let d = Math.hypot(b.x - a.x, b.z - a.z);
    while (acc + d >= step) {
      const t = (step - acc) / d;
      const nx = a.x + (b.x - a.x) * t, nz = a.z + (b.z - a.z) * t;
      out.push({ x: nx, z: nz });
      a.x = nx; a.z = nz;
      d = Math.hypot(b.x - a.x, b.z - a.z);
      acc = 0;
    }
    acc += d;
  }
  out.push(pts[pts.length - 1]);
  return out;
}
