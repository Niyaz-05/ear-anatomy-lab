#!/usr/bin/env node
/**
 * Build public/models/ear.glb: the right ear, from the auricle to the brainstem.
 *
 *   node tools/make-ear.mjs [<Human Atlas public/models dir>]
 *   (default: D:/Solar system/repo4-human-atlas/public/models)
 *
 * Sources
 * - BodyParts3D 4.0 (DBCLS, CC BY 4.0), as built by Human Atlas (metres, y up, +x = patient's left,
 *   +z anterior): the external ear (right half kept), the right temporal bone, and the rest of the
 *   skull merged into one simplified ghost. These are the only parts large enough to be in it.
 * - Everything inside the temporal bone is modelled here, in millimetres, from standard adult
 *   dimensions (listed with their sources in provenance.json → dimensions): the canal, eardrum,
 *   ossicles and their muscles, tympanic cavity, mastoid air cells, auditory tube, cochlea with its
 *   three scalae and basilar membrane, vestibule, utricle and saccule, semicircular canals and
 *   ampullae, endolymphatic duct and sac, CN VIII and the facial nerve with the chorda tympani, and
 *   the internal carotid artery and sigmoid sinus as landmarks. Organic parts are signed-distance
 *   unions meshed with surface nets; the scalae are swept cross-sections.
 *
 * Frame (docs/STRUCTURES.md): metres, origin at the centre of the tympanic membrane, +x lateral,
 * +y up, +z anterior; right ear. The canal is aligned with the external acoustic meatus measured in
 * the BodyParts3D temporal bone (its axis and the depth of its floor).
 *
 * Writes public/models/ear.glb, src/ear/generated/geometry.json (bounds, anchors),
 * src/ear/generated/provenance.json, src/ear/source/structures.source.json and public/ATTRIBUTION.md.
 * Run tools/bake-shading.mjs afterwards (npm run ear:make does both).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { r6, weld, smoothNormals, simplify, mergePieces, subdivide, taubin, bboxOf, centroid, bvhOf, insideMesh, THREE } from './mesh-lib.mjs';
import {
  add, sub, mul, dot, cross, len, norm, lerp, dist, rotate, basisOf,
  sdSphere, sdEllipsoid, sdCapsule, sdPolyTube, smin, union, subtract,
  surfaceNets, sweepProfile, framesAlong, curvePoints, polyLen, rng, flip,
} from './sdf-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const humanDir = process.argv[2] ?? 'D:/Solar system/repo4-human-atlas/public/models';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ── BodyParts3D reader (as in the skeletal lab's extractor) ─────────────────
function atlasReader(dir) {
  const bytes = fs.readFileSync(path.join(dir, 'atlas.json'));
  const atlas = JSON.parse(bytes.toString('utf8'));
  const cache = new Map(), hashes = {};
  const chunk = (i) => {
    if (!cache.has(i)) {
      const file = path.join(dir, atlas.chunks[i].url.split('/').pop());
      const buf = fs.readFileSync(file);
      cache.set(i, buf);
      hashes[path.basename(file)] = sha256(buf);
    }
    return cache.get(i);
  };
  const byId = new Map(atlas.parts.map((p) => [p.id, p]));
  const get = (id) => {
    const p = byId.get(id);
    if (!p) throw new Error(`${dir}: part "${id}" missing`);
    const b = chunk(p.chunk);
    return {
      part: p,
      positions: new Float32Array(b.buffer.slice(b.byteOffset + p.positions, b.byteOffset + p.positions + p.vertexCount * 12)),
      indices: new Uint32Array(b.buffer.slice(b.byteOffset + p.indices, b.byteOffset + p.indices + p.indexCount * 4)),
    };
  };
  return { bytes, atlas, get, hashes };
}
const human = atlasReader(humanDir);

// ── Frame ───────────────────────────────────────────────────────────────────
/**
 * Centre of the tympanic membrane in BodyParts3D metres: on the axis of the external acoustic
 * meatus traced in the right temporal bone (FJ3386), 1.5 mm lateral of the meatus floor.
 */
const TM_BP3D = [-0.045, 1.5817, -0.0115];
/** The auricle sits on the bone in BodyParts3D; it is moved this far laterally (mm) so the cartilaginous canal fits. */
const AURICLE_SHIFT_MM = 7.5;
/** BodyParts3D (m) → model frame (mm): mirror x (the right side's lateral is −x there), shift to the eardrum. */
const toModel = (x, y, z) => [-(x - TM_BP3D[0]) * 1000, (y - TM_BP3D[1]) * 1000, (z - TM_BP3D[2]) * 1000];
function bp3dMesh(raw) {
  const pos = new Float32Array(raw.positions.length);
  for (let i = 0; i < pos.length; i += 3) pos.set(toModel(raw.positions[i], raw.positions[i + 1], raw.positions[i + 2]), i);
  const m = weld(pos, raw.indices);
  return flip(m); // mirroring reverses the winding
}
function compact(m) {
  const map = new Map(), pos = [], idx = [];
  for (const v of m.indices) {
    let k = map.get(v);
    if (k === undefined) { k = pos.length / 3; map.set(v, k); pos.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); }
    idx.push(k);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
const keepTriangles = (m, keep) => {
  const idx = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const c = [0, 1, 2].map((a) => (m.positions[m.indices[t] * 3 + a] + m.positions[m.indices[t + 1] * 3 + a] + m.positions[m.indices[t + 2] * 3 + a]) / 3);
    if (keep(c)) idx.push(m.indices[t], m.indices[t + 1], m.indices[t + 2]);
  }
  return compact({ positions: m.positions, indices: Uint32Array.from(idx) });
};
const translate = (m, v) => { for (let i = 0; i < m.positions.length; i += 3) for (let a = 0; a < 3; a++) m.positions[i + a] += v[a]; return m; };
const smoothed = (m, levels = 1, iters = 2) => { let o = m; for (let l = 0; l < levels; l++) o = subdivide(o.positions, o.indices); o = weld(o.positions, o.indices); taubin(o.positions, o.indices, iters); return o; };

const meshes = new Map(); // id → { positions (mm), indices, layer, side, source, note }
const sources = {}; // id → source description for structures.source.json
const anchorsMm = {}; // named points (mm, model frame)
const dims = {}; // measured dimensions of the modelled parts
const put = (id, layer, m, source, extra = {}) => {
  if (meshes.has(id)) throw new Error(`duplicate mesh ${id}`);
  if (m.positions.some((v) => !Number.isFinite(v))) throw new Error(`${id}: non-finite positions`);
  meshes.set(id, { id, layer, side: extra.side ?? 'right', positions: m.positions, indices: m.indices, source });
  sources[id] = { id, layer, side: extra.side ?? 'right', ...source };
  log(`${id}: ${m.indices.length / 3} triangles`);
};

// ── BodyParts3D parts ───────────────────────────────────────────────────────
const SKULL_IDS = ['FJ3200', 'FJ3274', 'FJ3380', 'FJ3309', 'FJ3394', 'FJ3199', 'FJ3281', 'FJ3269', 'FJ3375', 'FJ3287', 'FJ3392', 'FJ3272', 'FJ3378', 'FJ3273', 'FJ3379', 'FJ3395', 'FJ3263', 'FJ3369', 'FJ3265', 'FJ3371', 'FJ3289'];
const bp3dParts = {};
let sourceTriangles = 0;
{
  const raw = human.get('FJ2811');
  sourceTriangles += raw.indices.length / 3;
  // External ear: one part for both sides; keep the right one (patient's right = −x in BodyParts3D).
  const both = bp3dMesh(raw);
  let ear = keepTriangles(both, (c) => c[0] > -40); // model x > −40 mm is the right side
  ear = translate(ear, [AURICLE_SHIFT_MM, 0, 0]);
  ear = smoothed(ear, 2, 3);
  bp3dParts.auricle = [`FJ2811 ${raw.part.name} (right half)`];
  put('auricle', 'outer', ear, { bp3d: ['FJ2811'], note: `BodyParts3D external ear, right half; moved ${AURICLE_SHIFT_MM} mm laterally so the cartilaginous canal fits; subdivided twice and smoothed.` });
}
const temporalRaw = human.get('FJ3386');
sourceTriangles += temporalRaw.indices.length / 3;
const temporalCoarse = bp3dMesh(temporalRaw);
{
  const tb = smoothed(temporalCoarse, 1, 2);
  bp3dParts['temporal-bone'] = [`FJ3386 ${temporalRaw.part.name}`];
  put('temporal-bone', 'bone', tb, { bp3d: ['FJ3386'], note: 'BodyParts3D right temporal bone, subdivided once and smoothed. The viewer cuts a window around the middle and inner ear.' });
}
{
  const pieces = SKULL_IDS.map((id) => { const r = human.get(id); sourceTriangles += r.indices.length / 3; return bp3dMesh(r); });
  bp3dParts.skull = SKULL_IDS.map((id) => `${id} ${human.get(id).part.name}`);
  const merged = mergePieces(pieces);
  const sk = simplify(merged.positions, merged.indices, 22000 / (merged.indices.length / 3), 0.01);
  put('skull', 'bone', sk, { bp3d: SKULL_IDS, note: 'The other skull bones and the mandible, merged and simplified (ghosted context).' });
}
const temporalBvh = bvhOf(temporalCoarse);
const insideBone = (p) => insideMesh(temporalBvh, p);
const boneDistance = (p) => { const res = {}; temporalBvh.closestPointToPoint(new THREE.Vector3(...p), res); return res.distance; };

// ── Tympanic membrane frame ─────────────────────────────────────────────────
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const C = [0, 0, 0];
/** Lateral face normal of the eardrum: it faces laterally, down (55° to the canal floor) and forwards. */
const nTM = norm([1, -0.7, 0.42]);
const uTM = norm(sub(Y, mul(nTM, dot(Y, nTM))));
const fTM = norm(cross(nTM, uTM));
const TILT = (15 * Math.PI) / 180; // long axis leans back at the top
const L_TM = norm(sub(mul(uTM, Math.cos(TILT)), mul(fTM, Math.sin(TILT))));
const W_TM = norm(add(mul(fTM, Math.cos(TILT)), mul(uTM, Math.sin(TILT))));
const TM_A = 4.6, TM_B = 4.1; // semi-axes: 9.2 × 8.2 mm
const CONE = 2.0; // depth of the umbo below the rim plane
const UMBO_DROP = 0.6; // the umbo lies a little below the centre
const Ap = mul(uTM, -UMBO_DROP); // apex in the rim plane
const U = sub(Ap, mul(nTM, CONE)); // umbo
const tmDepth = (rho) => CONE * (1 - rho) - 0.45 * rho * (1 - rho);
const rimAt = (phi) => add(C, add(mul(L_TM, TM_A * Math.cos(phi)), mul(W_TM, TM_B * Math.sin(phi))));
const tmSurface = (rho, phi) => sub(lerp(Ap, rimAt(phi), rho), mul(nTM, tmDepth(rho)));
const phiOf = (dir) => { const dp = sub(dir, mul(nTM, dot(dir, nTM))); return Math.atan2(dot(dp, W_TM) / TM_B, dot(dp, L_TM) / TM_A); };
const PHI_HANDLE = phiOf(add(uTM, mul(fTM, 0.08)));
/** Handle of the malleus: along the stria mallearis, on the medial side of the drum. */
const handle = (rho, off = 0.33) => sub(tmSurface(rho, PHI_HANDLE), mul(nTM, off));

// ── Ear canal ───────────────────────────────────────────────────────────────
const CANAL_PTS = [[0, 0, 0], [4.5, 0.15, -2.1], [9.2, 0.5, -3.9], [15.0, 0.9, -5.3], [18.6, 1.9, -4.5], [22.2, 2.7, -4.5], [25.5, 2.8, -5.3]];
const canalLine = curvePoints(CANAL_PTS, 0.35);
const canalLen = polyLen(canalLine);
const JUNCTION_MM = 16.0; // bony inner two thirds / cartilaginous outer third
{
  const frames = framesAlong(canalLine, Y);
  const s = [0]; for (let i = 1; i < canalLine.length; i++) s.push(s[i - 1] + dist(canalLine[i], canalLine[i - 1]));
  // Semi-axes (vertical a, horizontal b) along the canal: wide at the drum and the opening, narrowest at the isthmus.
  const prof = [[0, 3.6, 3.0], [4, 3.5, 2.9], [11, 3.2, 2.4], [16, 3.4, 2.6], [21, 4.1, 3.0], [canalLen, 4.4, 3.3]];
  const semi = (x) => { for (let i = 0; i < prof.length - 1; i++) if (x <= prof[i + 1][0]) { const t = (x - prof[i][0]) / (prof[i + 1][0] - prof[i][0]); return [prof[i][1] + (prof[i + 1][1] - prof[i][1]) * t, prof[i][2] + (prof[i + 1][2] - prof[i][2]) * t]; } return [prof.at(-1)[1], prof.at(-1)[2]]; };
  const M = 48, BLEND = 3.5;
  const ring = (i, wall) => {
    const f = frames[i];
    const [a, b] = semi(s[i]);
    const pts = [];
    for (let j = 0; j < M; j++) {
      const al = (j / M) * Math.PI * 2;
      const dir = add(mul(f.u, Math.cos(al)), mul(f.v, Math.sin(al)));
      let p = add(f.c, add(mul(f.u, (a + wall) * Math.cos(al)), mul(f.v, (b + wall) * Math.sin(al))));
      if (s[i] < BLEND) {
        // At the drum the lumen is the tympanic ring: blend into the rim of the membrane (tympanic sulcus).
        const rim = rimAt(phiOf(dir));
        const out = norm(sub(rim, C));
        const q = add(rim, mul(out, 0.15 + wall));
        const w = 1 - s[i] / BLEND;
        p = lerp(p, q, w * w * (3 - 2 * w));
      }
      pts.push(p);
    }
    return pts;
  };
  const build = (i0, i1, wall) => {
    const outer = [], inner = [];
    for (let i = i0; i <= i1; i++) { outer.push(ring(i, wall)); inner.push(ring(i, 0)); }
    return hollowRings(outer, inner);
  };
  const jx = s.findIndex((v) => v >= JUNCTION_MM);
  put('ear-canal-bone', 'outer', build(0, jx, 1.4), { modelled: `Bony (inner two thirds) part of the external acoustic meatus, ${JUNCTION_MM} mm, aligned with the meatus of the BodyParts3D temporal bone; ends at the tympanic sulcus around the drum.` });
  put('ear-canal-cartilage', 'outer', build(jx, canalLine.length - 1, 1.1), { modelled: `Cartilaginous (outer third) part, ${(canalLen - JUNCTION_MM).toFixed(1)} mm, from the bony meatus to the concha.` });
}
/** A hollow tube from rings of outer and inner points (same count), ends joined by annuli. */
function hollowRings(outer, inner) {
  const R = outer.length, m = outer[0].length;
  const pos = [...outer.flat(), ...inner.flat()].flat();
  const O = (i, j) => i * m + (j % m), I = (i, j) => R * m + i * m + (j % m);
  const idx = [];
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < m; j++) {
    idx.push(O(i, j), O(i + 1, j), O(i, j + 1), O(i, j + 1), O(i + 1, j), O(i + 1, j + 1));
    idx.push(I(i, j), I(i, j + 1), I(i + 1, j), I(i, j + 1), I(i + 1, j + 1), I(i + 1, j));
  }
  for (let j = 0; j < m; j++) {
    idx.push(O(0, j), O(0, j + 1), I(0, j), O(0, j + 1), I(0, j + 1), I(0, j));
    const e = R - 1;
    idx.push(O(e, j), I(e, j), O(e, j + 1), O(e, j + 1), I(e, j), I(e, j + 1));
  }
  const w = weld(Float32Array.from(pos), Uint32Array.from(idx));
  return signedVol(w) < 0 ? flip(w) : w;
}
function signedVol(m) {
  let v = 0; const p = m.positions, ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

// ── Tympanic membrane ───────────────────────────────────────────────────────
{
  const NR = 26, NP = 96, TH = 0.05; // 0.1 mm thick
  const pos = [], idx = [];
  const lat = (i, j) => (i === 0 ? 0 : 1 + (i - 1) * NP + (j % NP));
  const base = 1 + (NR) * NP;
  const med = (i, j) => base + (i === 0 ? 0 : 1 + (i - 1) * NP + (j % NP));
  for (const side of [1, -1]) {
    pos.push(...add(U, mul(nTM, side * TH)));
    for (let i = 1; i <= NR; i++) for (let j = 0; j < NP; j++) {
      const rho = i / NR, phi = (j / NP) * Math.PI * 2;
      pos.push(...add(tmSurface(rho, phi), mul(nTM, side * TH)));
    }
  }
  for (let j = 0; j < NP; j++) { idx.push(lat(0, 0), lat(1, j), lat(1, j + 1)); idx.push(med(0, 0), med(1, j + 1), med(1, j)); }
  for (let i = 1; i < NR; i++) for (let j = 0; j < NP; j++) {
    idx.push(lat(i, j), lat(i + 1, j), lat(i, j + 1), lat(i, j + 1), lat(i + 1, j), lat(i + 1, j + 1));
    idx.push(med(i, j), med(i, j + 1), med(i + 1, j), med(i, j + 1), med(i + 1, j + 1), med(i + 1, j));
  }
  for (let j = 0; j < NP; j++) idx.push(lat(NR, j), med(NR, j), lat(NR, j + 1), lat(NR, j + 1), med(NR, j), med(NR, j + 1));
  let m = weld(Float32Array.from(pos), Uint32Array.from(idx));
  if (signedVol(m) < 0) flip(m);
  put('tympanic-membrane', 'outer', m, { modelled: `Ellipse ${2 * TM_A} × ${2 * TM_B} mm, a shallow cone ${CONE} mm deep at the umbo, 0.1 mm thick; lateral face tilted ~55° to the canal floor and turned forwards.` });
}

// ── Ossicles ────────────────────────────────────────────────────────────────
const LP_RHO = 0.86;
const N0 = handle(0.93, 0.36);
const N1 = add(N0, [-0.75, 1.15, -0.25]);
const HEAD = add(N1, [-0.5, 1.55, -0.15]);
const HEAD_R = [0.9, 1.22, 1.02]; // head of the malleus: an ovoid knob, a little taller than wide
const INCUS = add(HEAD, [-0.3, -0.35, -1.95]);
const INCUS_R = [0.86, 1.2, 0.98]; // body of the incus
const IL0 = add(INCUS, [-0.1, -0.7, -0.15]);
const IL1 = add(INCUS, [-0.55, -2.6, -0.55]);
const ILT = add(INCUS, [-1.25, -4.35, -0.75]);
const LENT = add(ILT, [-0.62, 0.05, 0]);
const SH = add(ILT, [-1.08, 0.05, 0]);
const FP = add(SH, [-2.72, -0.05, 0.05]);
const SN = add(SH, [-0.48, 0, 0]);
const incusBodyField = sdEllipsoid(INCUS, [X, Y, Z], INCUS_R.map((r) => r + 0.07));
const headField = sdEllipsoid(HEAD, [X, Y, Z], HEAD_R.map((r) => r + 0.07));
const lentField = sdEllipsoid(LENT, [X, Y, Z], [0.24, 0.38, 0.38]);
const ossicleBounds = (pts, pad) => { const lo = [0, 1, 2].map((a) => Math.min(...pts.map((p) => p[a])) - pad), hi = [0, 1, 2].map((a) => Math.max(...pts.map((p) => p[a])) + pad); return [lo, hi]; };
{
  const hp = []; for (let r = 0.04; r <= 0.93; r += 0.05) hp.push(handle(r));
  const hr = hp.map((_, i) => 0.36 - 0.06 * Math.sin((i / (hp.length - 1)) * Math.PI) + 0.08 * (i / (hp.length - 1)) ** 3);
  const lpBase = handle(LP_RHO, 0.3), lpTip = add(tmSurface(LP_RHO + 0.02, PHI_HANDLE), mul(nTM, 0.02));
  const f = subtract(union([
    sdPolyTube(hp, hr, 0.1, 0.8),
    sdEllipsoid(handle(0.03, 0.3), [fTM, nTM, uTM], [0.55, 0.26, 0.62]), // spatulate tip at the umbo
    sdCapsule(lpBase, lpTip, 0.42, 0.2), // lateral process
    sdPolyTube([handle(0.9), N0, N1, HEAD], [0.42, 0.47, 0.6, 0.9], 0.2, 0.8), // neck
    sdEllipsoid(HEAD, [X, Y, Z], HEAD_R),
    sdCapsule(N1, add(N1, [-0.25, -0.15, 1.9]), 0.2, 0.07), // anterior process
  ], 0.3), incusBodyField, 0.12);
  const [lo, hi] = ossicleBounds([...hp, HEAD, N1, lpTip], 1.6);
  put('malleus', 'middle', surfaceNets(f, lo, hi, 0.045, { smooth: 2, target: 9000 }), { modelled: 'Head (in the epitympanic recess), neck, lateral and anterior processes, and the handle along the drum to the spatulate tip at the umbo; saddle facet for the incus.' });
}
{
  const f = subtract(union([
    sdEllipsoid(INCUS, [X, Y, Z], INCUS_R),
    sdCapsule(add(INCUS, [-0.1, 0.35, -0.6]), add(INCUS, [-0.5, 0.45, -4.2]), 0.6, 0.18), // short process (a tapering cone)
    sdPolyTube([IL0, IL1, ILT], [0.6, 0.42, 0.33], 0.15, 0.8), // long process
    sdCapsule(ILT, LENT, 0.22, 0.18),
    sdEllipsoid(LENT, [X, Y, Z], [0.17, 0.31, 0.31]), // lenticular process
  ], 0.3), headField, 0.12);
  const [lo, hi] = ossicleBounds([INCUS, add(INCUS, [-0.5, 0.45, -4.2]), ILT, LENT], 1.6);
  put('incus', 'middle', surfaceNets(f, lo, hi, 0.045, { smooth: 2, target: 8000 }), { modelled: 'Body (saddle joint with the malleus head), short process running back to the fossa incudis, long process descending behind the handle of the malleus, lenticular process turning medially to the stapes.' });
}
const FP_R = [0.14, 0.68, 1.5]; // footplate 3.0 × 1.4 mm (x thin)
{
  const fpa = add(FP, [0.12, 0, FP_R[2] - 0.38]), fpp = add(FP, [0.12, 0, -FP_R[2] + 0.32]);
  const f = union([
    subtract(sdEllipsoid(SH, [X, Y, Z], [0.36, 0.5, 0.55]), lentField, 0.05),
    sdCapsule(SH, SN, 0.32, 0.28),
    sdPolyTube([SN, add(SN, [-0.9, 0.0, 0.6]), add(SN, [-1.8, 0, 0.98]), fpa], [0.2, 0.15, 0.15, 0.17], 0.05, 0.6), // anterior crus (straighter, thinner)
    sdPolyTube([SN, add(SN, [-0.85, 0.0, -0.78]), add(SN, [-1.75, 0, -1.12]), fpp], [0.22, 0.18, 0.18, 0.2], 0.05, 0.6), // posterior crus (more curved)
    sdEllipsoid(FP, [X, Y, Z], FP_R),
    sdEllipsoid(add(FP, [0.07, 0, 0]), [X, Y, Z], [0.1, 0.5, 1.25]), // the footplate's raised lateral rim
  ], 0.12);
  const [lo, hi] = ossicleBounds([SH, FP, fpa, fpp, add(FP, [0, 0.7, 1.5]), add(FP, [0, -0.7, -1.5])], 0.8);
  put('stapes', 'middle', surfaceNets(f, lo, hi, 0.03, { smooth: 2, target: 8000 }), { modelled: 'Head with its facet for the lenticular process, neck, anterior and posterior crura around the obturator foramen, footplate 3.0 × 1.4 mm in the oval window.' });
}
{
  // Oval window: the annular ligament as a ring around the footplate.
  const pts = []; for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(add(FP, [-0.03, (FP_R[1] + 0.14) * Math.sin(a), (FP_R[2] + 0.14) * Math.cos(a)])); }
  put('oval-window', 'inner', ringTube(pts, 0.11), { modelled: 'The oval window (fenestra vestibuli) with the annular ligament around the stapes footplate, 3.3 × 1.7 mm.' });
}
function ringTube(pts, r, seg = 12) {
  const frames = framesAlong(pts, X);
  return sweepProfile(frames, () => Array.from({ length: seg }, (_, j) => [r * Math.cos((j / seg) * Math.PI * 2), r * Math.sin((j / seg) * Math.PI * 2)]));
}
function roundTube(points, radius, { seg = 14, step = 0.25, up = Y } = {}) {
  const pts = curvePoints(points, step);
  const frames = framesAlong(pts, up);
  const total = polyLen(pts);
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i], pts[i - 1]));
  return sweepProfile(frames, (i) => { const r = typeof radius === 'function' ? radius(s[i] / total, pts[i]) : radius; return Array.from({ length: seg }, (_, j) => [r * Math.cos((j / seg) * Math.PI * 2), r * Math.sin((j / seg) * Math.PI * 2)]); });
}
/** Spindle radius profile: thin at both ends, widest at `peak`. */
const spindle = (r0, rm, r1, peak = 0.45) => (t) => (t < peak ? r0 + (rm - r0) * Math.sin((t / peak) * Math.PI / 2) : r1 + (rm - r1) * Math.cos(((t - peak) / (1 - peak)) * Math.PI / 2));

// ── Labyrinth ───────────────────────────────────────────────────────────────
const V = add(FP, [-1.75, 0.2, 0.3]); // vestibule centre: its lateral wall holds the oval window
const V_R = [1.6, 2.3, 2.2];
const B = add(FP, [-1.8, -2.0, 3.14]); // centre of the cochlea's base (modiolus)
const RW_T = add(FP, [0.45, -2.6, 0.55]); // where the basal turn ends at the round window
const AX = norm([0.55, -0.25, 0.8]); // cochlear axis, base → apex: antero-lateral-inferior
const [E1, E2] = basisOf(AX);
const TURNS = 2.6, THETA = TURNS * Math.PI * 2, R_END = 0.8, H_APEX = 3.2;
const g0 = sub(RW_T, B), H0 = dot(g0, AX), gIn = sub(g0, mul(AX, H0));
const R0 = len(gIn), PHI0 = Math.atan2(dot(gIn, E2), dot(gIn, E1));
const KR = Math.log(R0 / R_END) / THETA;
const spiralAt = (th, sg) => {
  const r = R0 * Math.exp(-KR * th), ph = PHI0 + sg * th;
  const er = add(mul(E1, Math.cos(ph)), mul(E2, Math.sin(ph)));
  const h = th <= 0 ? H0 : H0 + (H_APEX - H0) * Math.pow(th / THETA, 1.1);
  return { c: add(add(B, mul(er, r)), mul(AX, h)), er, r, h };
};
// The basal turn leaves the round window running forwards under the promontory.
const SG = spiralAt(0.3, 1).c[2] > spiralAt(0.3, -1).c[2] ? 1 : -1;
const rhoAt = (th) => 1.05 - 0.5 * Math.pow(Math.max(0, Math.min(1, th / THETA)), 0.8);
const spiral = (th) => spiralAt(th, SG);
// Sample θ every ~0.15 mm of arc.
const thetas = [0]; while (thetas.at(-1) < THETA) thetas.push(Math.min(THETA, thetas.at(-1) + 0.15 / spiral(thetas.at(-1)).r));
const cl = thetas.map((th) => spiral(th).c);
const clS = [0]; for (let i = 1; i < cl.length; i++) clS.push(clS[i - 1] + dist(cl[i], cl[i - 1]));
const clLen = clS.at(-1);
const B0 = (rho) => -0.1 * rho; // basilar membrane level (slightly below the canal centre)
const BM_W = (frac) => 0.1 + 0.4 * frac; // basilar membrane width, mm: 0.1 at the base, 0.5 at the apex
const ligament = (rho) => 0.3 * rho;
const bmInner = (rho, frac) => rho - ligament(rho) - BM_W(frac); // edge of the osseous spiral lamina
const cochRings = thetas.map((th) => { const s = spiral(th); return { c: s.c, u: s.er, v: AX }; });
{
  const G = 0.025;
  const arc = (rho, a1, a2, n) => Array.from({ length: n }, (_, k) => { const a = a1 + ((a2 - a1) * k) / (n - 1); return [rho * Math.cos(a), rho * Math.sin(a)]; });
  const line = (p, q, n, skipEnds = true) => Array.from({ length: n }, (_, k) => { const t = skipEnds ? (k + 1) / (n + 1) : k / (n - 1); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; });
  const geo = (i) => {
    const th = thetas[i], rho = rhoAt(th), frac = clS[i] / clLen, b0 = B0(rho);
    const e = bmInner(rho, frac), w = BM_W(frac);
    const bs = b0 + G, bf = b0 - G;
    const aOut = Math.sqrt(rho * rho - bs * bs) - 0.12 * rho;
    const bTop = b0 + 0.62 * rho;
    const P1 = [e - 0.1 * rho - 0.05, bs], P2 = [aOut, bs], P3 = [Math.sqrt(rho * rho - bTop * bTop) - 0.14 * rho, bTop];
    return { rho, b0, e, w, bs, bf, P1, P2, P3, bTop };
  };
  const ST = (i) => {
    const { rho, bf } = geo(i);
    const aL = Math.PI - Math.asin(bf / rho), aR = Math.asin(bf / rho) + 2 * Math.PI;
    return [...arc(rho, aL, aR, 26), ...line([Math.cos(aR) * rho, bf], [Math.cos(aL) * rho, bf], 8)];
  };
  const SV = (i) => {
    const { rho, bs, P1, P3, bTop } = geo(i);
    // Reissner's membrane shifted towards the scala vestibuli by the gap.
    const dR = norm([P3[0] - P1[0], P3[1] - P1[1], 0]); const nR = [-dR[1] * G, dR[0] * G];
    const q1 = [P1[0] + nR[0] - G, P1[1]], q3 = [P3[0] + nR[0], P3[1] + nR[1] + G];
    const aWall = Math.asin(Math.min(1, (bTop + G) / rho)), aLeft = Math.PI - Math.asin(bs / rho);
    return [[-Math.sqrt(rho * rho - bs * bs), bs], ...line([-Math.sqrt(rho * rho - bs * bs), bs], q1, 5), q1, ...line(q1, q3, 6), q3, ...arc(rho, aWall, aLeft, 24).slice(0, -1)];
  };
  const SM = (i) => {
    const { P1, P2, P3 } = geo(i);
    return [P1, ...line(P1, P2, 6), P2, ...line(P2, P3, 4), P3, ...line(P3, P1, 6)];
  };
  const BM = (i) => {
    const { e, w, b0 } = geo(i);
    return [[e, b0 - G * 0.7], [e + w, b0 - G * 0.7], [e + w, b0 + G * 0.7], [e, b0 + G * 0.7]];
  };
  // Scala vestibuli: opens into the vestibule at its basal end.
  const sv = sweepProfile(cochRings, SV);
  const sv0 = centroid(Float32Array.from(SV(0).map(([a, b]) => add(add(cochRings[0].c, mul(cochRings[0].u, a)), mul(AX, b))).flat()));
  const svLink = roundTube([sv0, lerp(sv0, add(V, [0.5, -1.4, 1.2]), 0.5), add(V, [0.5, -1.4, 1.2])], 0.6);
  put('scala-vestibuli', 'inner', mergePieces([sv, svLink]), { modelled: 'Perilymph space above the cochlear duct, from the vestibule to the helicotrema; swept meridional cross-sections.' });
  const sm = sweepProfile(cochRings, SM);
  put('scala-media', 'inner', sm, { modelled: 'Cochlear duct (endolymph): triangular, between the basilar membrane, Reissner’s membrane and the stria vascularis on the spiral ligament.' });
  put('scala-tympani', 'inner', sweepProfile(cochRings, ST), { modelled: 'Perilymph space below the basilar membrane, from the helicotrema to the round window.' });
  put('basilar-membrane', 'inner', sweepProfile(cochRings, BM), { modelled: 'Ribbon from the osseous spiral lamina to the spiral ligament, widening from 0.1 mm at the base to 0.5 mm at the apex (true widths, not exaggerated).' });
  // Round window membrane: closes the basal end of the scala tympani.
  const st0 = ST(0).map(([a, b]) => add(add(cochRings[0].c, mul(cochRings[0].u, a)), mul(AX, b)));
  const rwC = centroid(Float32Array.from(st0.flat()));
  const tan0 = norm(sub(cl[0], cl[1]));
  const [ru, rv] = basisOf(tan0);
  const ext = st0.map((p) => sub(p, rwC));
  const ra = Math.max(...ext.map((p) => Math.abs(dot(p, ru)))) + 0.12, rb = Math.max(...ext.map((p) => Math.abs(dot(p, rv)))) + 0.12;
  const rwCentre = add(rwC, mul(tan0, 0.08));
  const disc = sdEllipsoid(rwCentre, [ru, rv, tan0], [ra, rb, 0.07]);
  const [lo, hi] = [sub(rwCentre, [2, 2, 2]), add(rwCentre, [2, 2, 2])];
  put('round-window', 'inner', surfaceNets(disc, lo, hi, 0.03, { smooth: 1, target: 1500 }), { modelled: `Round window membrane (secondary tympanic membrane), ${(2 * ra).toFixed(1)} × ${(2 * rb).toFixed(1)} mm, closing the scala tympani.` });
  anchorsMm.roundWindow = rwCentre;
  anchorsMm.svStart = sv0;
  // Cochlea path along the middle of the basilar membrane.
  const path64 = [];
  const bmPts = thetas.map((th, i) => { const g = geo(i); return add(add(cl[i], mul(cochRings[i].u, g.e + g.w / 2)), mul(AX, g.b0)); });
  const bs = [0]; for (let i = 1; i < bmPts.length; i++) bs.push(bs[i - 1] + dist(bmPts[i], bmPts[i - 1]));
  const bmLen = bs.at(-1);
  for (let k = 0; k < 64; k++) {
    const target = (bmLen * k) / 63;
    let i = bs.findIndex((v) => v >= target); if (i <= 0) i = Math.max(1, i);
    const t = (target - bs[i - 1]) / Math.max(1e-9, bs[i] - bs[i - 1]);
    path64.push({ p: lerp(bmPts[i - 1], bmPts[i], Math.max(0, Math.min(1, t))), mm: target, widthMm: BM_W(clS[Math.min(i, clS.length - 1)] / clLen) });
  }
  anchorsMm.cochleaPath = path64;
  dims.basilarMembraneLengthMm = r6(bmLen);
  dims.cochlearCanalCentrelineMm = r6(clLen);
}

// Bony cochlea: a hollow shell (otic capsule) around the spiral canal and the modiolus.
const SHELL = 0.38;
const cochleaOuter = (() => {
  const ths = thetas.filter((th, i) => th >= 0.08 && i % 3 === 0);
  const pts = [...ths.map((th) => spiral(th).c), spiral(THETA).c];
  const rad = [...ths.map((th) => rhoAt(th) + SHELL), rhoAt(THETA) + SHELL + 0.1];
  const tube = sdPolyTube(pts, rad, 0.6, 0.8, 1.2);
  const modiolus = sdCapsule(sub(B, mul(AX, 0.2)), add(B, mul(AX, H_APEX + 0.3)), 1.3, 0.45);
  return union([tube, modiolus], 0.8);
})();
{
  const lumThetas = [-0.35, -0.2, -0.1, ...thetas.filter((_, i) => i % 3 === 0), THETA];
  const lumen = sdPolyTube(lumThetas.map((th) => spiral(th).c), lumThetas.map((th) => rhoAt(th) + 0.03), 0.15, 0.8, 1.2);
  const toVest = sdCapsule(anchorsMm.svStart, add(V, [0.5, -1.4, 1.2]), 0.62, 0.62);
  const f = (p) => Math.max(cochleaOuter(p), -Math.min(lumen(p), toVest(p)));
  const lo = sub(B, [6.5, 6.5, 6.5]), hi = add(B, [6.5, 6.5, 6.5]);
  put('cochlea', 'inner', surfaceNets(f, lo, hi, 0.07, { smooth: 1, target: 26000 }), { modelled: `Bony cochlea: ${TURNS} turns around the modiolus, apex pointing antero-laterally and down; hollow, open at the round window and towards the vestibule.` });
  anchorsMm.cochleaBase = B;
  anchorsMm.cochleaApex = add(B, mul(AX, H_APEX + 0.85));
  // Measured size: width of the base across the axis, height along it.
  const m = meshes.get('cochlea');
  let wMax = 0, hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) {
    const d = sub([m.positions[i], m.positions[i + 1], m.positions[i + 2]], B);
    const h = dot(d, AX); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
    wMax = Math.max(wMax, len(sub(d, mul(AX, h))));
  }
  dims.cochleaBaseWidthMm = r6(2 * wMax * 0.97);
  dims.cochleaHeightMm = r6(hMax - hMin);
  dims.cochleaTurns = TURNS;
}

// Vestibule (perilymph space of the bony vestibule) with its elliptical and spherical recesses.
const vestField = union([
  sdEllipsoid(V, [X, Y, Z], V_R),
  sdEllipsoid(add(V, [-0.2, 0.9, -0.6]), [X, Y, Z], [1.2, 1.4, 1.5]),
  sdSphere(add(V, [0.0, -1.0, 0.9]), 1.2),
], 0.6);
put('vestibule', 'inner', surfaceNets(vestField, sub(V, [3.5, 4, 4]), add(V, [3.5, 4, 4]), 0.08, { smooth: 2, target: 5000 }), { modelled: 'Bony vestibule (perilymph), about 4 × 5 × 3 mm, with the oval window in its lateral wall.' });
const UTRICLE = add(V, [-0.2, 0.75, -0.45]), SACCULE = add(V, [0.15, -1.05, 0.8]);
put('utricle', 'inner', surfaceNets(union([sdEllipsoid(UTRICLE, [X, Y, Z], [0.62, 0.8, 1.45]), sdEllipsoid(add(UTRICLE, [0.25, 0.1, 0.9]), [X, Y, Z], [0.45, 0.45, 0.6])], 0.4), sub(UTRICLE, [2, 2, 3]), add(UTRICLE, [2, 2, 3]), 0.05, { smooth: 2, target: 2500 }), { modelled: 'Utricle: elongated endolymph sac in the elliptical recess, receiving the five openings of the semicircular canals; its macula lies roughly horizontal.' });
put('saccule', 'inner', surfaceNets(sdEllipsoid(SACCULE, [X, Y, Z], [0.42, 0.75, 0.68]), sub(SACCULE, [1.5, 1.5, 1.5]), add(SACCULE, [1.5, 1.5, 1.5]), 0.04, { smooth: 2, target: 1800 }), { modelled: 'Saccule: smaller, rounded sac in the spherical recess, near the cochlea; its macula is roughly vertical.' });

// Semicircular canals: three mutually perpendicular planes. The lateral canal is pitched up 30° at
// the front; the vertical canals stand at 45° to the sagittal plane, pitched back with it.
const PITCH = (30 * Math.PI) / 180;
const pitch = (v) => rotate(v, X, -PITCH); // y → up-and-back
const N_LAT = pitch([0, 1, 0]);
const N_ANT = pitch(norm([-1, 0, 1]));
const N_POST = pitch(norm([1, 0, 1]));
const CC = add(V, [-0.7, 2.0, -1.6]); // crus commune: shared limb of the anterior and posterior canals
const CANAL_R = 0.45; // bony canal lumen ~0.9 mm
function canalArc(name, ampEnd, otherEnd, n, R, moveOther = false) {
  // Put the ends in the canal plane: move the ampullary end (and optionally the other) along the normal.
  const mid = lerp(ampEnd, otherEnd, 0.5);
  const into = (p) => sub(p, mul(n, dot(sub(p, mid), n)));
  const E1 = moveOther ? into(ampEnd) : sub(ampEnd, mul(n, dot(sub(ampEnd, otherEnd), n)));
  const E2 = moveOther ? into(otherEnd) : otherEnd;
  const c = sub(E2, E1), L = len(c);
  if (L >= 2 * R) throw new Error(`${name}: chord ${L} too long for radius ${R}`);
  let w = norm(cross(n, c));
  if (dot(w, sub(lerp(E1, E2, 0.5), V)) < 0) w = mul(w, -1);
  const O = add(lerp(E1, E2, 0.5), mul(w, Math.sqrt(R * R - (L * L) / 4)));
  const a = norm(sub(E1, O)), b = cross(n, a);
  const ang = (p) => { const d = sub(p, O); return Math.atan2(dot(d, b), dot(d, a)); };
  let a2 = ang(E2); // from 0 (E1)
  // Go the long way, through the far side (direction w from O).
  const aw = ang(add(O, w));
  const pos = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let dir = 1;
  if (!(pos(aw) < pos(a2))) dir = -1;
  const span = dir === 1 ? pos(a2) : -pos(-a2);
  const pts = [];
  const N = 96;
  for (let k = 0; k <= N; k++) { const t = (span * k) / N; pts.push(add(O, add(mul(a, R * Math.cos(t)), mul(b, R * Math.sin(t))))); }
  return { O, n: dir === 1 ? n : mul(n, -1), E1, E2, pts, R, arcDeg: Math.abs(span) * 180 / Math.PI };
}
const canals = {
  anterior: canalArc('anterior', add(V, [0.7, 1.9, 1.2]), CC, N_ANT, 3.2),
  posterior: canalArc('posterior', add(V, [-0.3, -1.3, -1.6]), CC, N_POST, 3.15),
  lateral: canalArc('lateral', add(V, [1.0, 1.6, 1.5]), add(V, [0.5, 0.8, -1.9]), N_LAT, 2.9, true),
};
const intoVest = (p) => lerp(p, V, 0.45);
for (const [name, k] of Object.entries(canals)) {
  const pieces = [roundTube([intoVest(k.E1), ...k.pts.filter((_, i) => i % 4 === 0), k.pts.at(-1), name === 'lateral' ? intoVest(k.E2) : k.pts.at(-1)].filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) > 0.05), CANAL_R, { seg: 16, step: 0.2 })];
  if (name === 'anterior') pieces.push(roundTube([CC, lerp(CC, V, 0.25), lerp(CC, V, 0.55)], 0.5, { seg: 16, step: 0.2 })); // crus commune
  put(`${name}-canal`, 'inner', mergePieces(pieces), { modelled: `${name[0].toUpperCase()}${name.slice(1)} semicircular canal: loop ${(2 * k.R).toFixed(1)} mm across (${k.arcDeg.toFixed(0)}° of arc), lumen ${2 * CANAL_R} mm${name === 'anterior' ? '; includes the crus commune shared with the posterior canal' : ''}.` });
  // Ampulla: a dilatation at the canal's ampullary end.
  const i0 = 7, tan = norm(sub(k.pts[i0 + 2], k.pts[i0 - 2]));
  const [p1, p2] = basisOf(tan);
  const cAmp = k.pts[i0];
  put(`${name}-ampulla`, 'inner', surfaceNets(sdEllipsoid(cAmp, [tan, p1, p2], [1.0, 0.82, 0.82]), sub(cAmp, [1.6, 1.6, 1.6]), add(cAmp, [1.6, 1.6, 1.6]), 0.04, { smooth: 2, target: 1600 }), { modelled: `Ampulla of the ${name} canal, about 2.0 × 1.6 mm, housing the crista ampullaris.` });
  anchorsMm[`ampulla-${name}`] = cAmp;
  dims[`${name}CanalDiameterMm`] = r6(2 * k.R);
}
// Endolymphatic duct and sac.
const SAC = add(V, [-3.8, -4.2, -8.8]);
{
  const sacN = norm([-0.55, 0.1, -0.83]); // faces the posterior cranial fossa
  const sacL = norm(sub([0, -0.8, -0.6], mul(sacN, dot([0, -0.8, -0.6], sacN))));
  const duct = [add(V, [-0.9, 0.0, -0.5]), add(V, [-1.8, 0.6, -2.6]), add(V, [-2.6, -0.4, -4.6]), add(V, [-3.3, -2.0, -6.4]), add(SAC, mul(sacL, -2.5))];
  const f = union([sdPolyTube(curvePoints(duct, 0.3), curvePoints(duct, 0.3).map((_, i, a) => 0.18 + 0.2 * (i / (a.length - 1))), 0.15, 1), sdEllipsoid(SAC, [sacN, sacL, cross(sacN, sacL)], [0.55, 4.0, 2.4])], 0.6);
  put('endolymphatic-sac', 'inner', surfaceNets(f, sub(SAC, [6, 6, 6]), add(V, [1, 2, 1]), 0.08, { smooth: 2, target: 4500 }), { modelled: 'Endolymphatic duct in the vestibular aqueduct and the flattened sac (about 8 × 5 mm) on the posterior surface of the petrous bone, under the dura.' });
}

// ── Nerves ──────────────────────────────────────────────────────────────────
const FUNDUS = add(V, [-2.5, -0.9, 1.3]);
const IAM = norm([-0.98, 0.04, -0.15]); // fundus → porus (medial)
const SPLIT = add(FUNDUS, mul(IAM, 1.4));
{
  const trunk = [SPLIT, add(SPLIT, mul(IAM, 5)), add(SPLIT, mul(IAM, 10)), add(add(SPLIT, mul(IAM, 16)), [0, -0.3, 0.6]), add(add(SPLIT, mul(IAM, 22)), [0, -0.8, 1.6])];
  put('vestibulocochlear-nerve', 'nerves', roundTube(trunk, (t) => 1.1 + 0.15 * t, { seg: 20 }), { modelled: 'CN VIII trunk in the internal acoustic meatus (about 10 mm) and on to the cerebellopontine angle.' });
  anchorsMm.porus = add(SPLIT, mul(IAM, 10));
  const coch = roundTube([SPLIT, add(FUNDUS, [0, -0.5, 0.6]), sub(B, mul(AX, 0.7)), add(B, mul(AX, 0.6)), add(B, mul(AX, 2.0))], (t) => (t < 0.6 ? 0.8 : 0.8 - (t - 0.6) * 1.1), { seg: 16 });
  put('cochlear-nerve', 'nerves', coch, { modelled: 'Cochlear division: from the anteroinferior fundus into the modiolus, where the spiral ganglion lies.' });
  const supV = add(FUNDUS, [0, 0.7, -0.3]), infV = add(FUNDUS, [0, -0.6, -0.5]);
  const pieces = [
    roundTube([SPLIT, supV, add(UTRICLE, [-0.6, 0.1, 0.2])], 0.5),
    roundTube([supV, add(supV, [1.0, 0.9, 0.6]), anchorsMm['ampulla-anterior']], 0.28),
    roundTube([supV, add(supV, [1.2, 0.5, 0.8]), anchorsMm['ampulla-lateral']], 0.28),
    roundTube([SPLIT, infV, add(SACCULE, [-0.45, 0, 0])], 0.45),
    roundTube([infV, add(infV, [0.5, -0.8, -1.2]), anchorsMm['ampulla-posterior']], 0.25), // singular nerve
  ];
  put('vestibular-nerve', 'nerves', mergePieces(pieces), { modelled: 'Superior division (utricle, anterior and lateral ampullae) and inferior division (saccule; posterior ampulla by the singular nerve).' });
}
const GENIC = add(FP, [-0.6, 2.2, 4.4]);
const facialPath = [
  add(add(SPLIT, mul(IAM, 22)), [0, 0.6, 2.4]), add(add(SPLIT, mul(IAM, 10)), [0, 1.1, 1.0]), add(FUNDUS, [0.2, 1.3, 0.9]), // meatal segment
  lerp(add(FUNDUS, [0.2, 1.3, 0.9]), GENIC, 0.5), GENIC, // labyrinthine segment
  add(FP, [0.4, 2.05, 1.8]), add(FP, [0.8, 1.75, -0.2]), add(FP, [1.2, 1.5, -2.3]), // tympanic segment
  add(FP, [1.55, 0.9, -3.7]), // second genu
  add(FP, [1.75, -2.0, -4.3]), add(FP, [2.0, -7.0, -4.45]), add(FP, [2.3, -12.0, -4.0]), // mastoid segment to the stylomastoid foramen
  add(FP, [3.2, -15.0, -2.6]), add(FP, [5.5, -17.0, 0.5]),
];
{
  const geniculate = (p) => 0.32 * Math.exp(-((dist(p, GENIC) / 0.9) ** 2));
  const labyr = (p) => -0.18 * Math.exp(-((dist(p, lerp(add(FUNDUS, [0.2, 1.3, 0.9]), GENIC, 0.5)) / 1.6) ** 2));
  put('facial-nerve', 'nerves', roundTube(facialPath, (t, p) => 0.68 + geniculate(p) + labyr(p), { seg: 16 }), { modelled: 'CN VII: meatal, labyrinthine, geniculate ganglion (first genu), tympanic (above the oval window, below the lateral canal), second genu and mastoid segments to the stylomastoid foramen.' });
  anchorsMm.geniculate = GENIC;
  anchorsMm.stylomastoid = add(FP, [2.3, -12.0, -4.0]);
}
{
  // Chorda tympani: from the mastoid segment, up through the posterior canaliculus, across the drum
  // between the handle of the malleus (lateral) and the long process of the incus (medial), out
  // through the petrotympanic fissure.
  const mPt = handle(0.97, 0.75);
  const ip = [IL0, IL1, ILT];
  const yAt = mPt[1];
  const iPt = yAt >= IL0[1] ? IL0 : yAt >= IL1[1] ? lerp(IL0, IL1, (IL0[1] - yAt) / (IL0[1] - IL1[1])) : lerp(IL1, ILT, (IL1[1] - yAt) / (IL1[1] - ILT[1]));
  const cross0 = add(lerp(iPt, mPt, 0.4), [0, 0.15, 0]);
  const post = sub(add(rimAt(phiOf(sub(uTM, fTM))), mul(norm(sub(uTM, fTM)), -0.6)), mul(nTM, 0.9));
  const ant = sub(add(rimAt(phiOf(add(uTM, fTM))), mul(norm(add(uTM, fTM)), -0.5)), mul(nTM, 1.1));
  const pts = [add(FP, [2.0, -6.5, -4.45]), add(FP, [3.6, -3.0, -3.7]), lerp(add(FP, [3.6, -3.0, -3.7]), post, 0.6), post, cross0, add(cross0, [-0.15, 0.25, 1.6]), ant, add(ant, [-1.2, -0.6, 2.6]), add(ant, [-3.0, -2.2, 6.0])];
  put('chorda-tympani', 'nerves', roundTube(pts, 0.22, { seg: 12, step: 0.2 }), { modelled: 'Branch of the facial nerve crossing the middle ear medial to the handle of the malleus and lateral to the long process of the incus.' });
  anchorsMm.chordaCrossing = cross0;
}

// ── Middle-ear muscles, auditory tube ───────────────────────────────────────
const TUBE_DIR = norm([-0.6, -0.45, 0.66]); // antero-medio-inferior
const TUBE_O = add(FP, [3.0, -1.5, 6.7]); // tympanic orifice, on the anterior wall
{
  const pts = [TUBE_O, add(TUBE_O, mul(TUBE_DIR, 6)), add(add(TUBE_O, mul(TUBE_DIR, 12)), [0, 0.3, 0]), add(add(TUBE_O, mul(TUBE_DIR, 20)), [0.3, 0.4, 0.4]), add(add(TUBE_O, mul(TUBE_DIR, 28)), [0.2, 0.2, 0.5]), add(TUBE_O, mul(TUBE_DIR, 36))];
  const line = curvePoints(pts, 0.4);
  const fr = framesAlong(line, Y);
  const tot = polyLen(line); const s = [0]; for (let i = 1; i < line.length; i++) s.push(s[i - 1] + dist(line[i], line[i - 1]));
  const ab = (x) => {
    if (x < 12) { const t = x / 12; return [2.4 - 1.4 * t, 1.5 - 1.0 * t]; } // bony part narrows to the isthmus
    const t = (x - 12) / (tot - 12); return [1.0 + 3.6 * t ** 1.6, 0.5 + 1.9 * t ** 1.8]; // cartilaginous part flares to the pharyngeal opening
  };
  put('auditory-tube', 'middle', sweepProfile(fr, (i) => { const [a, b] = ab(s[i]); return Array.from({ length: 20 }, (_, j) => [a * Math.cos((j / 20) * Math.PI * 2), b * Math.sin((j / 20) * Math.PI * 2)]); }), { modelled: `Pharyngotympanic (Eustachian) tube, ${tot.toFixed(0)} mm: bony posterior third narrowing to the isthmus, cartilaginous anterior two thirds flaring to the nasopharynx (lumen shown).` });
  anchorsMm.tubePharynx = line.at(-1);
  anchorsMm.tubeTympanic = TUBE_O;
  dims.auditoryTubeLengthMm = r6(tot);
}
const CPR = add(FP, [1.3, 1.25, 2.5]); // cochleariform process
{
  const tendonEnd = add(handle(0.9, 0.55), [-0.15, 0.05, 0]);
  const belly = [CPR, add(CPR, mul(TUBE_DIR, 1.5)), add(add(TUBE_O, mul(TUBE_DIR, 4)), [0, 2.3, 0]), add(add(TUBE_O, mul(TUBE_DIR, 12)), [0, 2.6, 0]), add(add(TUBE_O, mul(TUBE_DIR, 21)), [0, 2.8, 0])];
  put('tensor-tympani', 'middle', mergePieces([roundTube(belly, spindle(0.35, 1.1, 0.7, 0.55), { seg: 16 }), roundTube([CPR, lerp(CPR, tendonEnd, 0.5), tendonEnd], 0.22, { seg: 10, step: 0.2 })]), { modelled: 'Tensor tympani: belly in its semicanal above the auditory tube; tendon turning laterally around the cochleariform process to the neck of the malleus.' });
}
{
  const pyr = add(SH, [-0.6, -0.35, -1.8]);
  const attach = add(SN, [0.2, 0, -0.3]);
  put('stapedius', 'middle', mergePieces([
    roundTube([add(pyr, [0.0, -0.4, -0.35]), add(pyr, [-0.15, -2.6, -0.7]), add(pyr, [-0.3, -5.4, -0.8])], spindle(0.32, 0.72, 0.35, 0.45), { seg: 16 }),
    roundTube([pyr, lerp(pyr, attach, 0.5), attach], 0.15, { seg: 10, step: 0.15 }),
  ]), { modelled: 'Stapedius: belly in the pyramidal eminence beside the facial nerve; tendon forwards to the neck of the stapes.' });
}

// ── Tympanic cavity and mastoid ─────────────────────────────────────────────
const ATTIC = add(lerp(HEAD, INCUS, 0.5), [-0.2, 0.3, -0.3]);
const ANTRUM = add(INCUS, [-1.0, 0.2, -11.0]);
{
  const f0 = union([
    sdEllipsoid(sub(C, mul(nTM, 1.7)), [nTM, uTM, fTM], [2.2, 5.0, 5.0]), // mesotympanum, behind the drum
    sdEllipsoid(ATTIC, [X, Y, Z], [2.6, 2.4, 3.6]), // epitympanic recess (attic)
    sdEllipsoid(add(U, [-1.0, -3.4, 0.2]), [X, Y, Z], [2.0, 2.2, 3.4]), // hypotympanum
    sdCapsule(sub(C, mul(nTM, 1.5)), TUBE_O, 2.0, 1.6), // protympanum to the tube
    sdCapsule(ATTIC, add(ATTIC, [-0.3, 0, -5.2]), 1.7, 1.35), // aditus to the antrum
    sdEllipsoid(add(FP, [1.0, -0.4, -1.4]), [X, Y, Z], [1.8, 2.2, 2.6]), // posterior sinuses (oval and round window niches)
  ], 1.2);
  const lateralOfDrum = (p) => dot(sub(p, C), nTM) + 0.12;
  const f = (p) => Math.max(f0(p), lateralOfDrum(p), -(cochleaOuter(p) - 0.12), -(vestField(p) - 0.25));
  put('tympanic-cavity', 'middle', surfaceNets(f, [-8, -9, -9], [6, 10, 11], 0.1, { smooth: 2, target: 9000 }), { modelled: 'Air space of the middle ear (ghosted): mesotympanum behind the drum, attic above it, hypotympanum below, protympanum leading to the auditory tube, the window niches and the aditus to the mastoid antrum. Its medial wall wraps the promontory (basal turn of the cochlea).' });
}
// Sigmoid sinus: down the inner surface of the mastoid, behind the labyrinth, to the jugular bulb
// under the floor of the middle ear (path relative to the vestibule).
const SIGMOID_R = 3.4;
const sigmoidCtrl = [[-2.1, 12.8, -28.7], [-0.6, 6.8, -22.7], [-0.6, -1.2, -16.7], [-2.1, -7.2, -10.7], [-2.6, -11.2, -4.7], [-2.1, -12.7, -1.7], [-3.1, -25.2, -0.7]].map((p) => add(V, p));
const sigmoidPts = curvePoints(sigmoidCtrl, 0.5);
let mastoidCells = 0;
{
  const r = rng(20251111);
  const avoid = [
    { pts: curvePoints(facialPath, 0.5), r: 0.7 + 0.9 },
    { pts: canalLine, r: 4.6 },
  ];
  const cells = [{ c: ANTRUM, r: 3.0 }];
  const centre = add(ANTRUM, [2.8, -8.5, -1.0]);
  for (let k = 0; k < 600 && cells.length < 48; k++) {
    const p = add(centre, [(r() * 2 - 1) * 7.5, (r() * 2 - 1) * 11, (r() * 2 - 1) * 7]);
    const rad = 1.0 + r() * 1.6;
    if (!insideBone(p) || boneDistance(p) < rad + 0.5) continue;
    if (avoid.some((a) => a.pts.some((q) => dist(q, p) < a.r + rad))) continue;
    if (sigmoidPts.some((q) => dist(q, p) < SIGMOID_R + 0.8 + rad)) continue;
    if (dist(p, canals.posterior.O) < canals.posterior.R + 1.5 + rad) continue;
    if (cells.some((c) => dist(c.c, p) < (c.r + rad) * 0.75)) continue;
    cells.push({ c: p, r: rad });
  }
  mastoidCells = cells.length - 1;
  const f = union(cells.map((c) => sdSphere(c.c, c.r)), 0.9);
  const lo = [0, 1, 2].map((a) => Math.min(...cells.map((c) => c.c[a] - c.r)) - 1), hi = [0, 1, 2].map((a) => Math.max(...cells.map((c) => c.c[a] + c.r)) + 1);
  put('mastoid-air-cells', 'middle', surfaceNets(f, lo, hi, 0.14, { smooth: 2, target: 14000 }), { modelled: `Mastoid antrum and ${mastoidCells} air cells, placed (deterministically) inside the BodyParts3D mastoid, clear of the facial nerve, canal, posterior semicircular canal and sigmoid sinus.` });
}

// ── Vessels ─────────────────────────────────────────────────────────────────
{
  const bulb = sigmoidCtrl[5];
  put('sigmoid-sinus', 'vessels', roundTube(sigmoidCtrl, (t, p) => SIGMOID_R + 1.0 * Math.exp(-((dist(p, bulb) / 3.5) ** 2)), { seg: 22, step: 0.5 }), { modelled: 'Sigmoid sinus in its groove on the inner mastoid, curving down to the jugular bulb below the middle ear and on into the internal jugular vein (landmark).' });
}
{
  // Internal carotid artery: up through the carotid canal in front of the cochlea, then forwards and medially (relative to the cochlea's base).
  const ica = [[-2.1, -29.2, 2.1], [-1.1, -15.2, 3.1], [-0.6, -8.7, 3.7], [-0.8, -3.9, 4.6], [-3.6, -3.0, 7.6], [-9.1, -2.2, 12.6], [-14.6, -1.7, 17.1], [-17.6, 1.8, 20.1]].map((p) => add(B, add(p, [-0.7, -0.6, 0.6])));
  put('internal-carotid-artery', 'vessels', roundTube(ica, 2.3, { seg: 22, step: 0.5 }), { modelled: 'Petrous internal carotid artery: vertical segment in the carotid canal anterior to the cochlea and medial to the auditory tube, genu, then the horizontal segment towards the petrous apex (landmark).' });
}

// ── Checks ──────────────────────────────────────────────────────────────────
const cent = (id) => centroid(meshes.get(id).positions);
const bb = (id) => bboxOf(meshes.get(id).positions);
const minDist = (aPts, bPts) => { let m = Infinity; for (const p of aPts) for (const q of bPts) m = Math.min(m, dist(p, q)); return m; };
const pointsOf = (id, every = 7) => { const p = meshes.get(id).positions, out = []; for (let i = 0; i < p.length; i += 3 * every) out.push([p[i], p[i + 1], p[i + 2]]); return out; };
const checks = {
  canalLateralOfDrum: cent('ear-canal-cartilage')[0] > cent('ear-canal-bone')[0] && cent('ear-canal-bone')[0] > 0,
  ossiclesMedialOfDrum: ['malleus', 'incus', 'stapes'].every((id) => cent(id)[0] < 1.5),
  stapesMostMedialOssicle: cent('stapes')[0] < cent('incus')[0] && cent('incus')[0] < cent('malleus')[0],
  incusBehindMalleus: cent('incus')[2] < cent('malleus')[2],
  cochleaInFrontOfVestibule: cent('cochlea')[2] > cent('vestibule')[2],
  cochleaApexAnteroLateralInferior: AX[0] > 0 && AX[1] < 0 && AX[2] > 0,
  anteriorCanalHighest: bb('anterior-canal')[1][1] > bb('lateral-canal')[1][1] && bb('anterior-canal')[1][1] > bb('posterior-canal')[1][1],
  posteriorCanalBehind: cent('posterior-canal')[2] < cent('vestibule')[2] - 2,
  lateralCanalLateral: cent('lateral-canal')[0] > cent('vestibule')[0],
  facialAboveOvalWindow: facialPath[6][1] > FP[1] + 1,
  tubeGoesAnteroMedioInferior: anchorsMm.tubePharynx[0] < -15 && anchorsMm.tubePharynx[1] < -10 && anchorsMm.tubePharynx[2] > 18,
  carotidInFrontOfCochlea: cent('internal-carotid-artery')[2] > cent('cochlea')[2],
  sigmoidBehindLabyrinth: cent('sigmoid-sinus')[2] < cent('posterior-canal')[2],
};
const clear = {
  chordaToMalleusMm: minDist(pointsOf('chorda-tympani', 2), pointsOf('malleus', 3)),
  chordaToIncusMm: minDist(pointsOf('chorda-tympani', 2), pointsOf('incus', 3)),
  facialToLateralCanalMm: minDist(pointsOf('facial-nerve', 3), pointsOf('lateral-canal', 3)),
  facialToStapesMm: minDist(pointsOf('facial-nerve', 3), pointsOf('stapes', 3)),
  cochleaToDrumMm: minDist(pointsOf('cochlea', 5), pointsOf('tympanic-membrane', 3)),
  cochleaToMalleusMm: minDist(pointsOf('cochlea', 5), pointsOf('malleus', 3)),
  carotidToCochleaMm: minDist(pointsOf('internal-carotid-artery', 4), pointsOf('cochlea', 5)),
  sigmoidToPosteriorCanalMm: minDist(pointsOf('sigmoid-sinus', 4), pointsOf('posterior-canal', 3)),
  malleusToIncusMm: minDist(pointsOf('malleus', 2), pointsOf('incus', 2)),
  incusToStapesMm: minDist(pointsOf('incus', 2), pointsOf('stapes', 2)),
};
{
  // The chorda must pass lateral to the incus and medial to the malleus where it crosses them.
  const x = anchorsMm.chordaCrossing;
  checks.chordaBetweenMalleusAndIncus = x[0] < handle(0.97, 0)[0] && x[0] > ILT[0];
}
// Turns of the cochlea must not touch: centreline gap minus the two lumens.
let turnGap = Infinity;
for (let i = 0; i < cl.length; i += 3) for (let j = i + 1; j < cl.length; j += 3) {
  if (thetas[j] - thetas[i] < Math.PI * 1.5) continue;
  turnGap = Math.min(turnGap, dist(cl[i], cl[j]) - rhoAt(thetas[i]) - rhoAt(thetas[j]));
}
clear.cochlearTurnGapMm = turnGap;
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
log('clearances (mm)', Object.fromEntries(Object.entries(clear).map(([k, v]) => [k, r6(v)])));
if (failed.length) throw new Error(`Orientation checks failed: ${failed.join(', ')}`);

// ── Dimensions (measured on the model) ──────────────────────────────────────
const extentAlong = (id, dir) => { const p = meshes.get(id).positions; let lo = Infinity, hi = -Infinity; for (let i = 0; i < p.length; i += 3) { const t = p[i] * dir[0] + p[i + 1] * dir[1] + p[i + 2] * dir[2]; lo = Math.min(lo, t); hi = Math.max(hi, t); } return hi - lo; };
const maxSpan = (id) => { const p = pointsOf(id, 3); let m = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) m = Math.max(m, dist(p[i], p[j])); return m; };
Object.assign(dims, {
  earCanalLengthMm: r6(canalLen), earCanalBonyMm: JUNCTION_MM, earCanalCartilaginousMm: r6(canalLen - JUNCTION_MM),
  tympanicMembraneMm: [2 * TM_A, 2 * TM_B], tympanicMembraneConeDepthMm: CONE,
  tympanicMembraneAngleToCanalFloorDeg: r6((Math.atan2(1, 0.7) * 180) / Math.PI),
  malleusLengthMm: r6(maxSpan('malleus')), incusLengthMm: r6(maxSpan('incus')), stapesHeightMm: r6(extentAlong('stapes', X)),
  stapesFootplateMm: [2 * FP_R[2], 2 * FP_R[1]],
  lateralCanalPitchDeg: 30, canalLumenMm: 2 * CANAL_R,
  canalPlaneAnglesDeg: { anteriorPosterior: r6(Math.acos(Math.abs(dot(N_ANT, N_POST))) * 180 / Math.PI), anteriorLateral: r6(Math.acos(Math.abs(dot(N_ANT, N_LAT))) * 180 / Math.PI), posteriorLateral: r6(Math.acos(Math.abs(dot(N_POST, N_LAT))) * 180 / Math.PI) },
  basilarMembraneWidthMm: { base: BM_W(0), apex: BM_W(1) },
  mastoidAirCells: mastoidCells,
});
const DIM_SOURCES = {
  earCanalLengthMm: { expected: '≈25 mm (24–26), outer third cartilage, inner two thirds bone, S-shaped', sources: ['grays-42', 'openstax-hearing'] },
  tympanicMembraneMm: { expected: '9–10 × 8–9 mm; cone ~2 mm deep at the umbo; ~55° to the canal floor', sources: ['grays-42'] },
  malleusLengthMm: { expected: '8–9 mm', sources: ['grays-42'] },
  incusLengthMm: { expected: '≈7 mm (long process), short process ≈5 mm', sources: ['grays-42'] },
  stapesHeightMm: { expected: '≈3.3 mm; footplate ≈3.0 × 1.4 mm', sources: ['grays-42'] },
  cochleaTurns: { expected: '2.5–2.75 turns; base ≈9 mm wide, ≈5 mm high', sources: ['grays-42', 'openstax-hearing'] },
  basilarMembraneLengthMm: { expected: '≈33–35 mm uncoiled; width ≈0.1 mm at the base to ≈0.5 mm at the apex', sources: ['pickles-2012'] },
  anteriorCanalDiameterMm: { expected: 'loops ≈6.5 mm across (lateral smaller), lumen ≈0.8–1 mm, mutually ~perpendicular, lateral canal ~30° up anteriorly', sources: ['grays-42', 'della-santina-2005'] },
  auditoryTubeLengthMm: { expected: '≈36 mm, bony posterior third, antero-medio-inferior to the nasopharynx', sources: ['grays-42'] },
};

// ── Output ──────────────────────────────────────────────────────────────────
const ORDER = ['auricle', 'ear-canal-cartilage', 'ear-canal-bone', 'tympanic-membrane', 'malleus', 'incus', 'stapes', 'tensor-tympani', 'stapedius', 'tympanic-cavity', 'mastoid-air-cells', 'auditory-tube',
  'cochlea', 'scala-vestibuli', 'scala-media', 'scala-tympani', 'basilar-membrane', 'oval-window', 'round-window', 'vestibule', 'utricle', 'saccule', 'anterior-canal', 'posterior-canal', 'lateral-canal', 'anterior-ampulla', 'posterior-ampulla', 'lateral-ampulla', 'endolymphatic-sac',
  'vestibulocochlear-nerve', 'cochlear-nerve', 'vestibular-nerve', 'facial-nerve', 'chorda-tympani', 'internal-carotid-artery', 'sigmoid-sinus', 'temporal-bone', 'skull'];
if (ORDER.length !== meshes.size || ORDER.some((id) => !meshes.has(id))) throw new Error(`mesh set mismatch: ${[...meshes.keys()].filter((k) => !ORDER.includes(k))} / ${ORDER.filter((k) => !meshes.has(k))}`);
const M = (p) => p.map((v) => r6(v / 1000));
const geometry = {};
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('ear');
let triangles = 0;
for (const id of ORDER) {
  const m = meshes.get(id);
  const w = compact(weld(m.positions, m.indices));
  const positions = new Float32Array(w.positions.length);
  for (let i = 0; i < positions.length; i++) positions[i] = w.positions[i] / 1000;
  const normals = smoothNormals(positions, w.indices);
  const [lo, hi] = bboxOf(positions);
  const c = centroid(positions);
  let nearest = 0, nd = Infinity;
  for (let i = 0; i < positions.length; i += 3) { const d = Math.hypot(positions[i] - c[0], positions[i + 1] - c[1], positions[i + 2] - c[2]); if (d < nd) { nd = d; nearest = i; } }
  geometry[id] = {
    layer: m.layer, side: m.side,
    bounds: [lo.map(r6), hi.map(r6)], centroid: c.map(r6),
    surfaceAnchor: [positions[nearest], positions[nearest + 1], positions[nearest + 2]].map(r6),
    vertexCount: positions.length / 3, triangleCount: w.indices.length / 3,
  };
  triangles += w.indices.length / 3;
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(positions.length / 3 < 65536 ? Uint16Array.from(w.indices) : w.indices).setBuffer(buffer));
  scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)).setExtras({ layer: m.layer, source: sources[id].bp3d ? 'bodyparts3d' : 'modelled' }));
}
doc.getRoot().getAsset().generator = 'ear-anatomy-lab tools/make-ear.mjs';
doc.getRoot().getAsset().copyright = 'Auricle, temporal bone and skull: BodyParts3D (DBCLS), CC BY 4.0. Other parts modelled for this lab.';
const outGlb = path.join(root, 'public/models/ear.glb');
fs.mkdirSync(path.dirname(outGlb), { recursive: true });
const glb = await new NodeIO().writeBinary(doc);
fs.writeFileSync(outGlb, glb);

const anchors = {
  umbo: M(U),
  'stapes-footplate': M(FP),
  'round-window': M(anchorsMm.roundWindow),
  'oval-window': M(FP),
  'cochlea-base': M(anchorsMm.cochleaBase),
  'cochlea-apex': M(anchorsMm.cochleaApex),
  'cochlea-axis': norm(AX).map(r6),
  'cochlea-path': anchorsMm.cochleaPath.map((q) => ({ p: M(q.p), mm: r6(q.mm), widthMm: r6(q.widthMm) })),
  'canal-centres': Object.fromEntries(Object.entries(canals).map(([k, c]) => [k, M(c.O)])),
  'canal-normals': Object.fromEntries(Object.entries(canals).map(([k, c]) => [k, norm(c.n).map(r6)])),
  'canal-radii-mm': Object.fromEntries(Object.entries(canals).map(([k, c]) => [k, c.R])),
  ampullae: { anterior: M(anchorsMm['ampulla-anterior']), posterior: M(anchorsMm['ampulla-posterior']), lateral: M(anchorsMm['ampulla-lateral']) },
  'canal-entrance': M(canalLine.at(-1)),
  'ear-canal-path': curvePoints(CANAL_PTS, 1.0).map(M),
  'tympanic-membrane-normal': nTM.map(r6),
  'tympanic-membrane-centre': M(C),
  'malleus-head': M(HEAD),
  'incus-body': M(INCUS),
  'lenticular-process': M(LENT),
  /** The ossicular chain rocks about the line from the anterior process of the malleus to the short process of the incus. */
  'ossicular-axis': [M(add(N1, [-0.25, -0.15, 1.9])), M(add(INCUS, [-0.5, 0.45, -4.2]))],
  'auditory-tube-pharynx': M(anchorsMm.tubePharynx),
  'auditory-tube-tympanic': M(anchorsMm.tubeTympanic),
  'internal-acoustic-porus': M(anchorsMm.porus),
  'geniculate-ganglion': M(anchorsMm.geniculate),
  'stylomastoid-foramen': M(anchorsMm.stylomastoid),
  'mastoid-antrum': M(ANTRUM),
  'vestibule-centre': M(V),
  utricle: M(UTRICLE), saccule: M(SACCULE),
};
const genDir = path.join(root, 'src/ear/generated');
fs.mkdirSync(genDir, { recursive: true });
fs.writeFileSync(path.join(genDir, 'geometry.json'), JSON.stringify({ units: 'metres', axes: { x: 'lateral (patient’s right, out of the head)', y: 'superior', z: 'anterior' }, origin: 'centre of the right tympanic membrane', structures: geometry, anchors }, null, 2) + '\n');

const commit = (dir) => { try { return execFileSync('git', ['-C', path.resolve(dir, '../..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } };
fs.writeFileSync(path.join(genDir, 'provenance.json'), JSON.stringify({
  output: { file: 'public/models/ear.glb', bytes: glb.byteLength, sha256: sha256(glb), triangles, sourceTriangles },
  sources: {
    bodyparts3d: {
      name: 'BodyParts3D 4.0 (Database Center for Life Science), via the Human Atlas build', license: 'CC-BY-4.0',
      intermediate: 'github.com/Niyaz-05/human-atlas, commit ' + commit(humanDir),
      atlasJsonSha256: sha256(human.bytes), chunkSha256: human.hashes, parts: bp3dParts,
    },
  },
  frame: {
    origin: 'centre of the right tympanic membrane', units: 'metres', axes: { x: 'lateral', y: 'superior', z: 'anterior' },
    tympanicMembraneCentreInBodyParts3D: TM_BP3D,
    transform: 'model = (−(X − X0), Y − Y0, Z − Z0) with (X0, Y0, Z0) the drum centre in BodyParts3D metres; winding reversed after the mirror',
    meatusAlignment: 'The canal’s bony part follows the axis of the external acoustic meatus traced in the BodyParts3D right temporal bone (cross-section centroids every 2 mm): laterally and ~25° backwards from the drum.',
    auricleShiftMm: AURICLE_SHIFT_MM,
  },
  dimensions: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, { model: v, ...(DIM_SOURCES[k] ?? {}) }])),
  clearancesMm: Object.fromEntries(Object.entries(clear).map(([k, v]) => [k, r6(v)])),
  orientationChecks: checks,
  changesHere: 'BodyParts3D: kept the right half of the external ear and moved it 7.5 mm laterally; subdivided and Taubin-smoothed the ear and the right temporal bone; merged and simplified the other skull bones; mirrored into the lab frame (x lateral) with the drum centre as origin. All other parts are modelled in code (tools/make-ear.mjs) from the dimensions listed here.',
}, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'src/ear/source/structures.source.json'), JSON.stringify({
  $comment: 'Ear structures and where their geometry comes from. bp3d: BodyParts3D 4.0 part ids (Human Atlas build). modelled: built in code by tools/make-ear.mjs from the dimensions in provenance.json.',
  structures: ORDER.map((id) => sources[id]),
}, null, 2) + '\n');

// ── Attribution ─────────────────────────────────────────────────────────────
const prov = JSON.parse(fs.readFileSync(path.join(genDir, 'provenance.json'), 'utf8'));
const dimRows = Object.entries(prov.dimensions).map(([k, d]) => `| ${k} | ${Array.isArray(d.model) ? d.model.join(' × ') : typeof d.model === 'object' ? Object.entries(d.model).map(([a, b]) => `${a} ${b}`).join(', ') : d.model} | ${d.expected ?? ''} | ${(d.sources ?? []).join(', ')} |`).join('\n');
const attribution = `# Attribution and asset provenance

## 3D ear model — \`models/ear.glb\`

### Source

**BodyParts3D 4.0**, © The **Database Center for Life Science** (DBCLS), licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html

- Taken as converted by *Human Atlas* (github.com/Niyaz-05/human-atlas, commit \`${commit(humanDir)}\`); \`atlas.json\` sha256 \`${sha256(human.bytes)}\`; chunk hashes in \`src/ear/generated/provenance.json\`.
- Used parts: the external ear (FJ2811, right half) → \`auricle\`; the right temporal bone (FJ3386) → \`temporal-bone\`; the other skull bones and the mandible (${SKULL_IDS.join(', ')}) → \`skull\`.

Neither DBCLS nor BodyParts3D has reviewed or endorsed this lab.

### Changes made (as CC BY 4.0 requires)

\`tools/make-ear.mjs\`:
- Mirrored the BodyParts3D right side into the lab frame (metres, origin at the centre of the right tympanic membrane, +x lateral, +y up, +z anterior).
- Kept the right half of the external ear and moved it ${AURICLE_SHIFT_MM} mm laterally so the cartilaginous part of the canal fits between it and the bony meatus; subdivided twice and smoothed.
- Subdivided once and smoothed the right temporal bone; the viewer cuts a window into it around the middle and inner ear.
- Merged the other skull bones and the mandible and simplified them to about 22,000 triangles (shown ghosted).

### Parts modelled for this lab (not from BodyParts3D)

The ear canal (cartilaginous and bony parts), tympanic membrane, malleus, incus, stapes, tensor tympani, stapedius, tympanic cavity, mastoid air cells, auditory tube, cochlea (bony shell), scala vestibuli, scala media, scala tympani, basilar membrane, oval and round windows, vestibule, utricle, saccule, the three semicircular canals and their ampullae, endolymphatic duct and sac, vestibulocochlear nerve and its cochlear and vestibular divisions, facial nerve, chorda tympani, internal carotid artery and sigmoid sinus are built in code from standard adult dimensions, placed in the BodyParts3D temporal bone (the canal follows its external acoustic meatus). They are teaching models: shapes are simplified and real ears vary.

| Dimension | Model | Typical adult value | Sources |
|---|---|---|---|
${dimRows}

Sources: grays-42 = Standring S (ed.), *Gray's Anatomy*, 42nd ed., Elsevier 2020 (external, middle and inner ear); pickles-2012 = Pickles JO, *An Introduction to the Physiology of Hearing*, 4th ed., Brill 2012; della-santina-2005 = Della Santina CC et al., Orientation of human semicircular canals measured by three-dimensional multiplanar CT reconstruction, *JARO* 2005;6:191–206; openstax-hearing = Betts JG et al., *Anatomy and Physiology 2e*, §14.1 "Sensory Perception", OpenStax 2022 (CC BY 4.0). Cited for dimensions only; no text is copied.

\`tools/bake-shading.mjs\` then adds a per-vertex \`_TISSUE\` attribute (ambient occlusion and a noise value) for the real-tissue look.

<!-- output:start -->
The output is \`models/ear.glb\` (${glb.byteLength.toLocaleString('en-GB')} bytes, ${triangles.toLocaleString('en-GB')} triangles, sha256 \`${sha256(glb)}\`).
<!-- output:end -->
`;
fs.writeFileSync(path.join(root, 'public/ATTRIBUTION.md'), attribution);
log(JSON.stringify({ structures: meshes.size, triangles, bytes: glb.byteLength, dims, checks }, null, 1));
