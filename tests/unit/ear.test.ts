import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { earDefinition as def } from '../../src/ear/definition';
import { validateDefinition } from '../../src/contract/validate';
import { APPROVED_ASSETS } from '../../src/contract/assets';
import geometry from '../../src/ear/generated/geometry.json';
import { anchors } from '../../src/ear/anchors';
import { effectiveMode, effectiveSlice, initialState, isVisible, keptHalf, makeReducer } from '../../src/app/state';
import { searchStructures } from '../../src/app/search';

const reduce = makeReducer(def);
const G = geometry.structures as unknown as Record<string, { centroid: number[]; bounds: number[][] }>;
const c = (id: string) => G[id]!.centroid as [number, number, number];

/** Node names in the GLB, read from its JSON chunk (no loader needed). */
function glbNodeNames(): string[] {
  const buf = fs.readFileSync(path.resolve(process.cwd(), 'public/models/ear.glb'));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as { nodes: { name: string }[] };
  return json.nodes.map((n) => n.name);
}
/** Mesh ids in docs/STRUCTURES.md. */
function contractIds(): string[] {
  const md = fs.readFileSync(path.resolve(process.cwd(), 'docs/STRUCTURES.md'), 'utf8');
  const ids: string[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\| `([a-z-]+)` \| (.*) \|$/);
    if (m) for (const id of m[2]!.matchAll(/`([a-z0-9-]+)`/g)) ids.push(id[1]!);
  }
  return ids;
}

describe('ear definition', () => {
  it('passes the validation gate with no warnings', () => {
    const r = validateDefinition(def);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('has exactly one mesh structure per model node, and the GLB has exactly the contract’s ids', () => {
    const meshes = def.structures.filter((s) => s.kind === 'mesh').map((s) => s.id).sort();
    expect(meshes).toEqual([...APPROVED_ASSETS['ear-v1']!.nodes].sort());
    const nodes = glbNodeNames().sort();
    expect(nodes).toEqual(meshes);
    expect(contractIds().sort()).toEqual(nodes);
  });

  it('gives each structure the layer the contract lists', () => {
    const md = fs.readFileSync(path.resolve(process.cwd(), 'docs/STRUCTURES.md'), 'utf8');
    for (const s of def.structures.filter((x) => x.kind === 'mesh')) expect(md, s.id).toMatch(new RegExp(`\\| \`${s.layer}\` \\|[^\\n]*\`${s.id}\``));
  });

  it('cites every structure, and only https sources', () => {
    for (const s of def.sources) if (s.url) expect(s.url.startsWith('https://')).toBe(true);
    for (const s of def.structures) expect(s.sources.length).toBeGreaterThan(0);
  });

  it('has the six modes and about twenty tour steps', () => {
    expect(def.tour.length).toBeGreaterThanOrEqual(18);
    const modes = new Set(def.tour.map((t) => t.mode ?? 'explore'));
    for (const m of ['explore', 'hearing', 'balance', 'clinic', 'closeups']) expect(modes.has(m as never), m).toBe(true);
    for (const id of ['lateral', 'anterior', 'superior', 'medial', 'middle-ear', 'inner-ear']) expect(def.cameraPresets.some((p) => p.id === id), id).toBe(true);
  });

  it('rejects an unapproved asset and a route through an unknown structure', () => {
    expect(validateDefinition({ ...def, assets: [{ id: 'not-approved', role: 'anatomy-model' }] }).ok).toBe(false);
    const bad = { ...def, routes: [{ ...def.routes[0]!, steps: [...def.routes[0]!.steps, { structure: 'nope', label: 'Nope' }] }] };
    expect(validateDefinition(bad).ok).toBe(false);
  });
});

describe('model geometry (frame: +x lateral, +y up, +z anterior, origin at the eardrum)', () => {
  it('has the named anchors', () => {
    for (const k of ['umbo', 'stapes-footplate', 'round-window', 'cochlea-base', 'cochlea-apex', 'canal-entrance', 'auditory-tube-pharynx'] as const) {
      expect(anchors[k]).toHaveLength(3);
    }
    expect(anchors['cochlea-path']).toHaveLength(64);
    expect(anchors['cochlea-path'][0]!.mm).toBe(0);
    expect(anchors['cochlea-path'][63]!.mm).toBeGreaterThan(30);
    expect(anchors['cochlea-path'][63]!.mm).toBeLessThan(38);
    expect(anchors['cochlea-path'][63]!.widthMm).toBeGreaterThan(anchors['cochlea-path'][0]!.widthMm);
    for (const k of ['anterior', 'posterior', 'lateral'] as const) {
      expect(anchors['canal-centres'][k]).toHaveLength(3);
      expect(Math.hypot(...anchors['canal-normals'][k])).toBeCloseTo(1, 3);
    }
  });

  it('puts the parts in their anatomical places', () => {
    expect(Math.hypot(...anchors['tympanic-membrane-centre'])).toBeLessThan(1e-6); // origin
    expect(anchors['canal-entrance'][0]).toBeGreaterThan(0.02); // canal opens ~25 mm lateral
    expect(anchors.umbo[0]).toBeLessThan(0); // the umbo is drawn in medially
    expect(anchors['stapes-footplate'][0]).toBeLessThan(anchors.umbo[0]); // stapes medial to the drum
    expect(c('incus')[2]).toBeLessThan(c('malleus')[2]); // incus behind malleus
    expect(c('cochlea')[2]).toBeGreaterThan(c('vestibule')[2]); // cochlea in front of the vestibule
    expect(c('posterior-canal')[2]).toBeLessThan(c('vestibule')[2]);
    expect(G['anterior-canal']!.bounds[1]![1]).toBeGreaterThan(G['lateral-canal']!.bounds[1]![1]!);
    const ax = anchors['cochlea-axis'];
    expect(ax[0]).toBeGreaterThan(0); expect(ax[1]).toBeLessThan(0); expect(ax[2]).toBeGreaterThan(0); // apex antero-lateral-inferior
    const p = anchors['auditory-tube-pharynx'];
    expect(p[0]).toBeLessThan(0); expect(p[1]).toBeLessThan(0); expect(p[2]).toBeGreaterThan(0); // tube antero-medio-inferior
  });

  it('has mutually perpendicular canals with the lateral canal pitched up at the front', () => {
    const n = anchors['canal-normals'];
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(Math.abs(dot(n.anterior, n.posterior))).toBeLessThan(0.05);
    expect(Math.abs(dot(n.anterior, n.lateral))).toBeLessThan(0.05);
    expect(Math.abs(dot(n.posterior, n.lateral))).toBeLessThan(0.05);
    const tilt = (Math.acos(Math.abs(n.lateral[1])) * 180) / Math.PI;
    expect(tilt).toBeGreaterThan(25); expect(tilt).toBeLessThan(35);
  });
});

describe('lab state', () => {
  it('starts in Anatomy mode on the lateral view with every layer shown', () => {
    const s = initialState(def);
    expect(s.mode).toBe('explore');
    expect(s.camera.preset).toBe('lateral');
    expect(isVisible(def, s, 'malleus')).toBe(true);
    expect(isVisible(def, s, 'temporal-bone')).toBe(true);
  });

  it('each mode shows its own layers', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'balance' });
    expect(s.camera.preset).toBe('inner-ear');
    expect(isVisible(def, s, 'lateral-canal')).toBe(true);
    expect(isVisible(def, s, 'auricle')).toBe(false);
    s = reduce(s, { type: 'set-mode', mode: 'hearing' });
    expect(isVisible(def, s, 'stapes')).toBe(true);
    expect(isVisible(def, s, 'skull')).toBe(false);
  });

  it('tour steps set their own mode and cut', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'tour' });
    const at = (id: string) => def.tour.findIndex((t) => t.id === id);
    s = reduce(s, { type: 'tour-go', index: at('scalae') });
    expect(effectiveMode(def, s)).toBe('closeups');
    expect(effectiveSlice(def, s).axis).toBe('axial');
    s = reduce(s, { type: 'tour-go', index: at('overview') });
    expect(effectiveMode(def, s)).toBe('explore');
    expect(effectiveSlice(def, s).axis).toBe('off');
  });

  it('says which part the cut keeps', () => {
    expect(keptHalf({ axis: 'sagittal', at: 0, flip: false })).toMatch(/medial/);
    expect(keptHalf({ axis: 'coronal', at: 0, flip: true })).toBe('the front part');
  });
});

describe('search', () => {
  it('finds structures by name and synonym', () => {
    expect(searchStructures(def.structures, 'eardrum')[0]!.structure.id).toBe('tympanic-membrane');
    expect(searchStructures(def.structures, 'stirrup')[0]!.structure.id).toBe('stapes');
    expect(searchStructures(def.structures, 'eustachian')[0]!.structure.id).toBe('auditory-tube');
    expect(searchStructures(def.structures, 'CN VIII')[0]!.structure.id).toBe('vestibulocochlear-nerve');
  });
});
