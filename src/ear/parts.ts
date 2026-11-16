/**
 * Points and paths inside the model for the simulations (model frame, metres; place them in the
 * scene with `toWorld`). Built from the anchors in geometry.json; pure functions, unit-tested.
 */
import { anchors, type CanalName, type Vec3 } from './anchors';
import { COCHLEA_LENGTH_MM } from './hearing';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(...a) || 1));
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, mul(sub(b, a), t));

/**
 * Parts of the ossicles, from the construction points of tools/make-ear.mjs (model frame, metres),
 * for the close-up's labels.
 */
export const OSSICLE_PARTS: readonly { id: string; label: string; p: Vec3; bone: 'malleus' | 'incus' | 'stapes' | 'joint' }[] = [
  { id: 'malleus-head', label: 'Head of malleus', p: [0.00034, 0.00645, 0.00063], bone: 'malleus' },
  { id: 'anterior-process', label: 'Anterior process', p: [0.00059, 0.00475, 0.00268], bone: 'malleus' },
  { id: 'lateral-process', label: 'Lateral process', p: [0.0017, 0.00338, 0.00106], bone: 'malleus' },
  { id: 'handle', label: 'Handle (manubrium)', p: [-0.00023, 0.00215, 0.00008], bone: 'malleus' },
  { id: 'umbo', label: 'Tip at the umbo', p: [-0.00195, 0.00083, -0.00081], bone: 'malleus' },
  { id: 'incus-body', label: 'Body of incus', p: [0.00004, 0.0061, -0.00132], bone: 'incus' },
  { id: 'short-process', label: 'Short process', p: [-0.00046, 0.00655, -0.00552], bone: 'incus' },
  { id: 'long-process', label: 'Long process', p: [-0.00051, 0.0035, -0.00187], bone: 'incus' },
  { id: 'lenticular-process', label: 'Lenticular process', p: [-0.00183, 0.0018, -0.00207], bone: 'incus' },
  { id: 'stapes-head', label: 'Head of stapes', p: [-0.00229, 0.0018, -0.00207], bone: 'stapes' },
  { id: 'anterior-crus', label: 'Anterior crus', p: [-0.00457, 0.0018, -0.00109], bone: 'stapes' },
  { id: 'posterior-crus', label: 'Posterior crus', p: [-0.00452, 0.0018, -0.00319], bone: 'stapes' },
  { id: 'footplate', label: 'Footplate', p: [-0.00501, 0.00175, -0.00202], bone: 'stapes' },
  { id: 'incudomalleolar-joint', label: 'Incudomalleolar joint', p: [0.00019, 0.00628, -0.00034], bone: 'joint' },
  { id: 'incudostapedial-joint', label: 'Incudostapedial joint', p: [-0.00206, 0.0018, -0.00207], bone: 'joint' },
];

// ---------------------------------------------------------------------------------------------
// Cochlea
// ---------------------------------------------------------------------------------------------

/** The basilar membrane path from base to apex, model frame. */
export const cochleaPath = (): Vec3[] => anchors['cochlea-path'].map((q) => q.p);

/**
 * The point on the basilar membrane `mmFromBase` from the base, for a cochlea of `lengthMm` (the
 * science modules use 35 mm; the model's path is about 35.8 mm, so positions are scaled by fraction).
 */
export function cochleaPointAt(mmFromBase: number, lengthMm = COCHLEA_LENGTH_MM): Vec3 {
  const path = anchors['cochlea-path'];
  const total = path[path.length - 1]!.mm;
  const s = Math.min(1, Math.max(0, mmFromBase / lengthMm)) * total;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    if (s <= b.mm) return lerp(a.p, b.p, (s - a.mm) / Math.max(1e-9, b.mm - a.mm));
  }
  return path[path.length - 1]!.p;
}

/**
 * Shift from the middle of the basilar membrane into the scala tympani (towards the base of the
 * modiolus), where a cochlear-implant array lies, metres.
 */
export const SCALA_TYMPANI_OFFSET: Vec3 = mul(anchors['cochlea-axis'], -0.00035);

// ---------------------------------------------------------------------------------------------
// Semicircular canals
// ---------------------------------------------------------------------------------------------

/** How far each canal's arc runs from its ampulla before it rejoins the vestibule, degrees (measured on the mesh). */
export const CANAL_ARC_DEG = 265;

export interface CanalFrame {
  centre: Vec3;
  /** Unit normal of the canal plane (geometry.json's convention). */
  normal: Vec3;
  /** In-plane unit vectors: u towards the ampulla, v the direction away from the ampulla along the canal. */
  u: Vec3;
  v: Vec3;
  radius: number;
  ampulla: Vec3;
}

export function canalFrame(name: CanalName): CanalFrame {
  const centre = anchors['canal-centres'][name];
  const normal = norm(anchors['canal-normals'][name]);
  const ampulla = anchors.ampullae[name];
  const d = sub(ampulla, centre);
  const u = norm(sub(d, mul(normal, dot(d, normal))));
  const v = cross(normal, u);
  return { centre, normal, u, v, radius: anchors['canal-radii-mm'][name] / 1000, ampulla };
}

/** A point on the canal's centre line `deg` degrees round from its ampulla (0 = the ampulla). */
export function canalPoint(f: CanalFrame, deg: number, radiusScale = 1): Vec3 {
  const t = (deg * Math.PI) / 180;
  return add(f.centre, mul(add(mul(f.u, Math.cos(t)), mul(f.v, Math.sin(t))), f.radius * radiusScale));
}

/** Unit tangent along the canal, pointing away from the ampulla (the ampullofugal direction). */
export function canalTangent(f: CanalFrame, deg: number): Vec3 {
  const t = (deg * Math.PI) / 180;
  return norm(add(mul(f.u, -Math.sin(t)), mul(f.v, Math.cos(t))));
}

/**
 * Where otoconia lie in the posterior canal at a fraction of the way from the ampulla (0) round
 * the arc and through the common crus (0.85) into the utricle (1), as in `epleyManoeuvre`.
 */
export function posteriorCanalPoint(fraction: number): Vec3 {
  const f = canalFrame('posterior');
  const x = Math.min(1, Math.max(0, fraction));
  if (x <= 0.85) return canalPoint(f, (x / 0.85) * CANAL_ARC_DEG);
  return lerp(canalPoint(f, CANAL_ARC_DEG), anchors.utricle, (x - 0.85) / 0.15);
}

// ---------------------------------------------------------------------------------------------
// Ear canal, drum and ossicular chain
// ---------------------------------------------------------------------------------------------

/** The ear canal's centre line from the entrance to the drum, model frame. */
export const earCanalInward = (): Vec3[] => [...anchors['ear-canal-path']].reverse();

/** Unit normal of the drum's lateral face, and the medial direction of the stapes piston (model frame). */
export const DRUM_NORMAL: Vec3 = norm(anchors['tympanic-membrane-normal']);
export const PISTON_DIR: Vec3 = norm(sub(anchors['stapes-footplate'], anchors['lenticular-process']));

/** Rotation axis of the malleus–incus block (unit) and a point on it. */
export const OSSICULAR_AXIS = { point: anchors['ossicular-axis'][0], dir: norm(sub(anchors['ossicular-axis'][1], anchors['ossicular-axis'][0])) };

/**
 * Sign of the chain rotation (about OSSICULAR_AXIS.dir, right-hand rule in the model's coordinates)
 * that moves the umbo medially, i.e. with the drum pushed in: +1 or −1.
 */
export function inwardRotationSign(): 1 | -1 {
  const r = sub(anchors.umbo, OSSICULAR_AXIS.point);
  const vel = cross(OSSICULAR_AXIS.dir, r); // umbo velocity for a small positive rotation
  return dot(vel, DRUM_NORMAL) < 0 ? 1 : -1;
}

/** Displacement of a point for a small chain rotation `angleRad`, model frame (first order). */
export function chainDisplacement(p: Vec3, angleRad: number): Vec3 {
  return mul(cross(OSSICULAR_AXIS.dir, sub(p, OSSICULAR_AXIS.point)), angleRad);
}
