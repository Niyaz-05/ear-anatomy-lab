import geometryJson from './generated/geometry.json';
import type { Mode, SimulationDefinition } from '../contract/schema';
import { MODE_LAYERS } from '../app/state';

export type Vec3 = [number, number, number];

interface G { centroid: number[]; bounds: number[][]; surfaceAnchor?: number[]; side: string; layer: string }

/** Per-structure bounds and label anchors (metres, model frame; see docs/STRUCTURES.md). */
export const geometry = geometryJson.structures as unknown as Record<string, G>;

/** A point along the basilar membrane, from the base, with its width. */
export interface CochleaPathPoint { p: Vec3; mm: number; widthMm: number }
export type CanalName = 'anterior' | 'posterior' | 'lateral';

/** Named anchor points written by tools/make-ear.mjs (metres; directions are unit vectors). */
export interface EarAnchors {
  umbo: Vec3;
  'stapes-footplate': Vec3;
  'round-window': Vec3;
  'oval-window': Vec3;
  'cochlea-base': Vec3;
  'cochlea-apex': Vec3;
  'cochlea-axis': Vec3;
  'cochlea-path': CochleaPathPoint[];
  'canal-centres': Record<CanalName, Vec3>;
  'canal-normals': Record<CanalName, Vec3>;
  'canal-radii-mm': Record<CanalName, number>;
  ampullae: Record<CanalName, Vec3>;
  'canal-entrance': Vec3;
  'ear-canal-path': Vec3[];
  'tympanic-membrane-normal': Vec3;
  'tympanic-membrane-centre': Vec3;
  'malleus-head': Vec3;
  'incus-body': Vec3;
  'lenticular-process': Vec3;
  'ossicular-axis': [Vec3, Vec3];
  'auditory-tube-pharynx': Vec3;
  'auditory-tube-tympanic': Vec3;
  'internal-acoustic-porus': Vec3;
  'geniculate-ganglion': Vec3;
  'stylomastoid-foramen': Vec3;
  'mastoid-antrum': Vec3;
  'vestibule-centre': Vec3;
  utricle: Vec3;
  saccule: Vec3;
}
export const anchors = geometryJson.anchors as unknown as EarAnchors;

export const vec = (p: readonly number[]): Vec3 => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];

/**
 * Model frame → rendering (world) frame. The contract's frame (+x lateral, +y up, +z anterior for
 * the right ear) is left-handed, so drawn as-is the right ear would look like a left ear. The viewer
 * mirrors the model in x when it loads (world +x = the patient's left, a right-handed frame, as in
 * BodyParts3D). Use this for any model-frame point or direction placed in the 3D scene; data,
 * anchors and the science modules stay in the model frame.
 */
export const toWorld = (p: readonly number[]): Vec3 => [-(p[0] ?? 0), p[1] ?? 0, p[2] ?? 0];
/** Model-frame bounds → world bounds. */
export const boundsToWorld = ([lo, hi]: [Vec3, Vec3]): [Vec3, Vec3] => [[-hi[0], lo[1], lo[2]], [-lo[0], hi[1], hi[2]]];

/** A point to hang a label on: on the structure's surface, or the middle of a group. */
export function anchorOf(def: SimulationDefinition, id: string): Vec3 | null {
  const g = geometry[id];
  if (g) return vec(g.surfaceAnchor ?? g.centroid);
  const s = def.structures.find((x) => x.id === id);
  if (s?.kind === 'group' && s.members) {
    const pts = s.members.map((m) => anchorOf(def, m)).filter((p): p is Vec3 => p !== null);
    if (!pts.length) return null;
    return [0, 1, 2].map((a) => pts.reduce((n, p) => n + p[a]!, 0) / pts.length) as Vec3;
  }
  return null;
}

/** Axis-aligned bounds of a set of structures (groups expand to their members). */
export function boundsOfIds(def: SimulationDefinition, ids: readonly string[]): [Vec3, Vec3] | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const visit = (id: string) => {
    const g = geometry[id];
    if (g) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a]!, g.bounds[0]![a]!);
        hi[a] = Math.max(hi[a]!, g.bounds[1]![a]!);
      }
      return;
    }
    def.structures.find((x) => x.id === id)?.members?.forEach(visit);
  };
  ids.forEach(visit);
  return Number.isFinite(lo[0]) ? [lo, hi] : null;
}

const INNER = ['cochlea', 'vestibule', 'anterior-canal', 'posterior-canal', 'lateral-canal'];
/** The parts each mode frames by default. */
const HOME: Partial<Record<Mode, readonly string[]>> = {
  explore: ['auricle', 'ear-canal-bone', ...INNER],
  hearing: ['ear-canal-bone', 'tympanic-membrane', 'malleus', 'cochlea'],
  balance: [...INNER, 'endolymphatic-sac'],
  clinic: ['auricle', 'ear-canal-bone', ...INNER],
  closeups: ['malleus', 'incus', 'stapes', 'tympanic-membrane'],
};

/** Bounds of the default view for a mode. */
export function homeBounds(def: SimulationDefinition, mode: Mode = 'explore'): [Vec3, Vec3] {
  const ids = HOME[mode] ?? HOME.explore!;
  return boundsOfIds(def, ids) ?? [[-0.02, -0.02, -0.02], [0.02, 0.02, 0.02]];
}

/**
 * Where the cuts are centred (model frame): just behind the umbo, so at the slider's middle a
 * coronal cut passes through the drum, the incus and stapes, the vestibule and the basal turn of the
 * cochlea; an axial cut through the canal and the ossicles; a sagittal cut through the middle ear.
 */
export const CUT_CENTRE: Vec3 = [-0.002, 0.0008, -0.0009];

/** Bounds of everything shown in a mode (used to scale the cut slider), without the skull. */
export function modeBounds(def: SimulationDefinition, mode: Mode): [Vec3, Vec3] {
  const layers = mode === 'explore' || mode === 'tour' ? null : MODE_LAYERS[mode];
  const ids = def.structures.filter((s) => s.kind === 'mesh' && s.id !== 'skull' && s.id !== 'temporal-bone' && (layers ? layers.includes(s.layer) : true)).map((s) => s.id);
  return boundsOfIds(def, ids) ?? homeBounds(def, mode);
}

/**
 * The window cut into the temporal bone (and skull) so the middle and inner ear show: an ellipsoid
 * around them, open to the lateral surface (metres, model frame).
 */
export const BONE_WINDOW = { centre: [0.003, 0.002, 0.004] as Vec3, radii: [0.031, 0.016, 0.024] as Vec3 };
