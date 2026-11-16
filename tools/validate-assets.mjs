#!/usr/bin/env node
/**
 * Checks public/models/ear.glb against its provenance and geometry records:
 * file hash and size budget, node set (= the contract in docs/STRUCTURES.md), extras.layer,
 * finite positions, unit normals, in-range indices, sane bounds, the baked shading attribute,
 * the named anchors and the attribution file. Exits non-zero on any failure so it can gate builds.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (msg) => problems.push(msg);

const glbPath = path.join(root, 'public/models/ear.glb');
const glb = fs.readFileSync(glbPath);
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'src/ear/generated/provenance.json'), 'utf8'));
const geometry = JSON.parse(fs.readFileSync(path.join(root, 'src/ear/generated/geometry.json'), 'utf8'));

const MAX_BYTES = 8 * 1024 * 1024;
if (glb.byteLength > MAX_BYTES) fail(`ear.glb is ${glb.byteLength} bytes, over the ${MAX_BYTES} byte budget`);
const hash = crypto.createHash('sha256').update(glb).digest('hex');
if (hash !== provenance.output.sha256) fail(`ear.glb sha256 ${hash} does not match provenance ${provenance.output.sha256}`);

// The contract: every id and layer listed in docs/STRUCTURES.md.
const contract = fs.readFileSync(path.join(root, 'docs/STRUCTURES.md'), 'utf8');
const contractLayers = {};
for (const line of contract.split('\n')) {
  const m = line.match(/^\| `([a-z-]+)` \| (.*) \|$/);
  if (!m) continue;
  for (const id of m[2].matchAll(/`([a-z0-9-]+)`/g)) contractLayers[id[1]] = m[1];
}

const doc = await new NodeIO().readBinary(new Uint8Array(glb));
const nodes = doc.getRoot().listNodes();
const names = nodes.map((n) => n.getName());
const expected = Object.keys(geometry.structures);
for (const id of expected) if (!names.includes(id)) fail(`node "${id}" missing from ear.glb`);
for (const n of names) if (!expected.includes(n)) fail(`unexpected node "${n}" in ear.glb`);
if (new Set(names).size !== names.length) fail('duplicate node names in ear.glb');
for (const [id, layer] of Object.entries(contractLayers)) if (!names.includes(id)) fail(`contract id "${id}" (${layer}) missing from ear.glb`);
for (const n of names) if (!(n in contractLayers)) fail(`node "${n}" is not in docs/STRUCTURES.md`);

let triangles = 0;
for (const node of nodes) {
  const id = node.getName();
  const layer = node.getExtras()?.layer;
  if (layer !== contractLayers[id]) fail(`${id}: extras.layer "${layer}" but the contract says "${contractLayers[id]}"`);
  const mesh = node.getMesh();
  if (!mesh) { fail(`${id}: node has no mesh`); continue; }
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')?.getArray();
    const nor = prim.getAttribute('NORMAL')?.getArray();
    const idx = prim.getIndices()?.getArray();
    if (!pos || !nor || !idx) { fail(`${id}: missing POSITION, NORMAL or indices`); continue; }
    if (pos.length !== nor.length) fail(`${id}: ${pos.length / 3} positions but ${nor.length / 3} normals`);
    for (let i = 0; i < pos.length; i++) {
      if (!Number.isFinite(pos[i])) { fail(`${id}: non-finite position at ${i}`); break; }
      // The skull reaches ~0.2 m from the eardrum; everything else is within a few centimetres.
      if (Math.abs(pos[i]) > (id === 'skull' ? 0.25 : 0.12)) { fail(`${id}: position ${pos[i]} outside the expected range`); break; }
    }
    for (let i = 0; i < nor.length; i += 3) {
      const len = Math.hypot(nor[i], nor[i + 1], nor[i + 2]);
      if (Math.abs(len - 1) > 1e-3) { fail(`${id}: normal ${i / 3} has length ${len}`); break; }
    }
    const vCount = pos.length / 3;
    for (const i of idx) if (i >= vCount) { fail(`${id}: index ${i} >= vertex count ${vCount}`); break; }
    if (idx.length % 3) fail(`${id}: index count ${idx.length} not divisible by 3`);
    const tissue = prim.getAttribute('_TISSUE');
    if (!tissue) fail(`${id}: no baked _TISSUE shading attribute (run tools/bake-shading.mjs)`);
    else if (tissue.getCount() !== vCount || tissue.getElementSize() !== 4 || !tissue.getNormalized()) fail(`${id}: _TISSUE must be normalised VEC4, one per vertex`);
    triangles += idx.length / 3;
    const recorded = geometry.structures[id];
    if (recorded && recorded.triangleCount !== idx.length / 3) fail(`${id}: ${idx.length / 3} triangles, geometry.json says ${recorded.triangleCount}`);
  }
}

// Anchors named in the contract.
const a = geometry.anchors ?? {};
const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
for (const k of ['umbo', 'stapes-footplate', 'round-window', 'cochlea-base', 'cochlea-apex', 'canal-entrance', 'auditory-tube-pharynx']) if (!isVec(a[k])) fail(`anchor "${k}" missing or not a point`);
if (!Array.isArray(a['cochlea-path']) || a['cochlea-path'].length !== 64) fail('anchor "cochlea-path" must have 64 points');
else if (a['cochlea-path'][0].mm !== 0 || !(a['cochlea-path'][63].mm > 30 && a['cochlea-path'][63].mm < 38)) fail('cochlea-path must run from 0 mm to ~33–35 mm');
for (const k of ['canal-centres', 'canal-normals']) for (const c of ['anterior', 'posterior', 'lateral']) if (!isVec(a[k]?.[c])) fail(`anchor "${k}.${c}" missing`);

const attribution = path.join(root, 'public/ATTRIBUTION.md');
if (!fs.existsSync(attribution)) fail('public/ATTRIBUTION.md is missing');
else {
  const text = fs.readFileSync(attribution, 'utf8');
  for (const needle of ['BodyParts3D', 'Database Center for Life Science', 'CC BY 4.0', 'FJ2811', 'FJ3386', provenance.sources.bodyparts3d.atlasJsonSha256, provenance.output.sha256]) {
    if (!text.includes(needle)) fail(`public/ATTRIBUTION.md does not mention "${needle}"`);
  }
}

if (problems.length) {
  console.error(`Asset validation FAILED (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Asset validation passed: ${names.length} nodes, ${triangles} triangles, ${(glb.byteLength / 1048576).toFixed(2)} MB, sha256 ${hash.slice(0, 12)}…`);
