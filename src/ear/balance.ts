/**
 * Vestibular science for the ear lab: semicircular canal geometry and coplanar pairs, cupula
 * dynamics and afferent firing (Ewald's laws), the spin-and-stop experiment with velocity storage,
 * otolith shear and the tilt–translation ambiguity, the vestibulo-ocular reflex and nystagmus, and
 * posterior-canal BPPV (Dix–Hallpike test and Epley manoeuvre). Pure functions, no DOM.
 *
 * Head frame (the lab's model frame): +x right, +y up, +z forward (anterior). Angular velocity
 * ω = {x, y, z} deg/s is given about those axes, positive = counter-clockwise when viewed from the
 * positive end of the axis, so:
 *   ω.y > 0  yaw, head turning to the LEFT
 *   ω.x > 0  pitch, nose UP (extension)
 *   ω.z > 0  roll, RIGHT ear down
 * Only dot products are used, so the result does not depend on the frame's handedness.
 *
 * Main sources: Kandel ER et al. (2021) Principles of Neural Science, 6th ed., ch. 27; Purves D et
 * al. (2018) Neuroscience, 6th ed., ch. 14; Goldberg JM & Fernández C (1971) J Neurophysiol
 * 34:635–660 and Fernández C & Goldberg JM (1971, 1976) J Neurophysiol; Raphan T, Matsuo V & Cohen B
 * (1979) Exp Brain Res 35:229–248 (velocity storage); Della Santina CC et al. (2005) JARO 6:191
 * (canal planes); Bhattacharyya N et al. (2017) Clinical Practice Guideline: BPPV (update),
 * Otolaryngol Head Neck Surg 156(3S):S1–S47; Epley JM (1992) Otolaryngol Head Neck Surg 107:399;
 * Hain TC, BPPV (dizziness-and-balance.com); Fife TD et al. (2008) Neurology 70:2067.
 */

export interface Vec3 { x: number; y: number; z: number }
export type Side = 'left' | 'right';
export type CanalName = 'lateral' | 'anterior' | 'posterior';
export type CanalId = `${Side}-${CanalName}`;
export type Flow = 'ampullopetal' | 'ampullofugal';

const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec3, k: number): Vec3 => vec(a.x * k, a.y * k, a.z * k);
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Standard gravity, m/s². */
export const G = 9.80665;

// ---------------------------------------------------------------------------------------------
// Canal geometry
// ---------------------------------------------------------------------------------------------

/** The lateral canal plane is pitched up anteriorly by about 30° from the stereotaxic horizontal. */
export const LATERAL_CANAL_TILT_DEG = 30;
/** The vertical (anterior and posterior) canal planes are at about 45° to the sagittal plane (measured ≈ 37–45°). */
export const VERTICAL_CANAL_ANGLE_DEG = 45;

export interface Canal {
  id: CanalId;
  side: Side;
  name: CanalName;
  /**
   * Unit normal of the canal plane, oriented as the excitatory rotation axis: head angular velocity
   * with a positive component along it excites this canal's afferents at the onset of rotation.
   */
  normal: Vec3;
  /** Mesh ids from docs/STRUCTURES.md (the model shows the right ear). */
  structureId: `${CanalName}-canal`;
  ampullaId: `${CanalName}-ampulla`;
  /** Endolymph flow that excites (Ewald): towards the ampulla in the lateral canal, away from it in the vertical canals. */
  excitatoryFlow: Flow;
}

function makeCanals(): Record<CanalId, Canal> {
  const t = rad(LATERAL_CANAL_TILT_DEG), v = rad(VERTICAL_CANAL_ANGLE_DEG);
  // Lateral: plane contains x and (0, sin t, cos t); normal (0, cos t, −sin t) points up and back,
  // so yaw to the left (+ω.y) excites the left lateral canal.
  const lat = vec(0, Math.cos(t), -Math.sin(t));
  // Vertical canals: anterior canals are excited by nose-down pitch and ipsilateral ear-down roll,
  // posterior canals by nose-up pitch and ipsilateral ear-down roll. The set is treated as mutually
  // orthogonal, a simplification: measured planes depart from 90° by up to about 10–20° (Blanks,
  // Curthoys & Markham 1975, Acta Otolaryngol; Della Santina et al. 2005, JARO), so the vertical-canal
  // normals (a, 0, b) of the head pitched 30° nose
  // down are carried by the same 30° pitch, (a, b·sin t, b·cos t); they stay at 45° to the sagittal plane.
  const s = Math.sin(v), c = Math.cos(v);
  const tilt = (a: number, b: number) => vec(a, b * Math.sin(t), b * Math.cos(t));
  const normals: Record<CanalId, Vec3> = {
    'left-lateral': lat,
    'right-lateral': scale(lat, -1),
    'left-anterior': tilt(-c, -s),
    'right-posterior': tilt(c, s),
    'right-anterior': tilt(-c, s),
    'left-posterior': tilt(c, -s),
  };
  const out = {} as Record<CanalId, Canal>;
  for (const id of Object.keys(normals) as CanalId[]) {
    const [side, name] = id.split('-') as [Side, CanalName];
    out[id] = {
      id, side, name, normal: normals[id],
      structureId: `${name}-canal`, ampullaId: `${name}-ampulla`,
      excitatoryFlow: name === 'lateral' ? 'ampullopetal' : 'ampullofugal',
    };
  }
  return out;
}

/** The six semicircular canals in the head frame. */
export const CANALS: Readonly<Record<CanalId, Canal>> = makeCanals();
export const CANAL_IDS: readonly CanalId[] = ['left-lateral', 'left-anterior', 'left-posterior', 'right-lateral', 'right-anterior', 'right-posterior'];

/**
 * The three push–pull coplanar pairs: a rotation in the pair's plane excites one canal and inhibits
 * the other (Kandel 6e ch. 27). LARP = left anterior/right posterior, RALP = right anterior/left posterior.
 */
export const COPLANAR_PAIRS: readonly { name: 'lateral' | 'LARP' | 'RALP'; canals: readonly [CanalId, CanalId] }[] = [
  { name: 'lateral', canals: ['left-lateral', 'right-lateral'] },
  { name: 'LARP', canals: ['left-anterior', 'right-posterior'] },
  { name: 'RALP', canals: ['right-anterior', 'left-posterior'] },
];

/** Instantaneous projection of head angular velocity onto each canal's excitatory axis, deg/s. */
export function canalStimulation(omegaDegS: Vec3): Record<CanalId, number> {
  const out = {} as Record<CanalId, number>;
  for (const id of CANAL_IDS) out[id] = dot(omegaDegS, CANALS[id].normal);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Afferent firing (Ewald's second law)
// ---------------------------------------------------------------------------------------------

export interface AfferentParams {
  /** Resting discharge, spikes/s (primate regular afferents ≈ 90; Goldberg & Fernández 1971). */
  restingHz: number;
  /** Saturation in excitation, spikes/s. */
  maxHz: number;
  /** Sensitivity near rest, (spikes/s) per (deg/s) of cupula-equivalent velocity (≈ 0.4–0.5). */
  gainHzPerDegS: number;
}
export const AFFERENT: AfferentParams = { restingHz: 90, maxHz: 400, gainHzPerDegS: 0.5 };

/**
 * Canal afferent firing rate for a cupula signal in deg/s (positive = excitatory). The response is
 * linear near rest with slope `gainHzPerDegS` and saturates smoothly: at 0 spikes/s in inhibition
 * (only `restingHz` of headroom) and at `maxHz` in excitation, so excitation is the stronger
 * response — Ewald's second law (Goldberg & Fernández 1971; Kandel 6e ch. 27).
 */
export function afferentRate(signalDegS: number, p: AfferentParams = AFFERENT): number {
  const g = p.gainHzPerDegS * signalDegS;
  if (g >= 0) return p.restingHz + (p.maxHz - p.restingHz) * Math.tanh(g / (p.maxHz - p.restingHz));
  return p.restingHz + p.restingHz * Math.tanh(g / p.restingHz);
}

/** Direction of endolymph flow relative to the ampulla for a signed canal signal (Ewald's laws). */
export function endolymphFlow(canal: CanalName, signalDegS: number): Flow | null {
  if (signalDegS === 0) return null;
  const petalExcites = canal === 'lateral';
  return (signalDegS > 0) === petalExcites ? 'ampullopetal' : 'ampullofugal';
}

// ---------------------------------------------------------------------------------------------
// Cupula dynamics (torsion pendulum)
// ---------------------------------------------------------------------------------------------

export interface CupulaParams {
  /** Long (cupula restoring) time constant, s; ≈ 4–7 s in primates (≈ 6 s). */
  tauLongS: number;
  /** Short (endolymph inertial/viscous) time constant, s; ≈ 0.003–0.005 s. */
  tauShortS: number;
}
export const CUPULA: CupulaParams = { tauLongS: 6, tauShortS: 0.005 };

/**
 * State of the torsion-pendulum model H(s) = τ₁s / ((τ₁s + 1)(τ₂s + 1)) from head angular velocity to
 * the cupula signal, in velocity-equivalent units (deg/s; mid-band gain 1, so between ≈ 0.03 Hz and
 * ≈ 30 Hz the canals transduce head velocity). The model is linear, so it runs on the 3-D vector and
 * each canal's signal is the projection of `cupula` on its normal (Steinhausen; Wilson & Melvill
 * Jones 1979, Mammalian Vestibular Physiology).
 */
export interface CanalState {
  /** Head velocity low-passed by τ₁ (the part the cupula has adapted to), deg/s. */
  adapted: Vec3;
  /** Cupula signal, deg/s equivalent. */
  cupula: Vec3;
  /** Time, s. */
  t: number;
}

/** A head at rest, or already rotating steadily at `omegaDegS` long enough for the cupula to have returned to rest. */
export function createCanalState(omegaDegS: Vec3 = vec(0, 0, 0)): CanalState {
  return { adapted: { ...omegaDegS }, cupula: vec(0, 0, 0), t: 0 };
}

/** Advance the cupula model by `dtS` with head angular velocity `omegaDegS` held over the step (exact for steps). */
export function stepCanals(s: CanalState, omegaDegS: Vec3, dtS: number, p: CupulaParams = CUPULA): CanalState {
  const a1 = 1 - Math.exp(-dtS / p.tauLongS), a2 = 1 - Math.exp(-dtS / p.tauShortS);
  const adapted = vec(
    s.adapted.x + (omegaDegS.x - s.adapted.x) * a1,
    s.adapted.y + (omegaDegS.y - s.adapted.y) * a1,
    s.adapted.z + (omegaDegS.z - s.adapted.z) * a1,
  );
  const hp = sub(omegaDegS, adapted);
  const cupula = vec(s.cupula.x + (hp.x - s.cupula.x) * a2, s.cupula.y + (hp.y - s.cupula.y) * a2, s.cupula.z + (hp.z - s.cupula.z) * a2);
  return { adapted, cupula, t: s.t + dtS };
}

export interface CanalReading {
  /** Cupula signal projected on the canal's excitatory axis, deg/s (positive = excitatory). */
  stimulation: number;
  /** Endolymph flow relative to the ampulla, or null at rest. */
  flow: Flow | null;
  /** True when excited, false when inhibited, null at rest. */
  excitatory: boolean | null;
  /** Afferent firing rate, spikes/s. */
  firingRate: number;
}

/** Per-canal readings from a cupula signal vector (deg/s equivalent). */
export function canalReadout(cupulaDegS: Vec3, p: AfferentParams = AFFERENT): Record<CanalId, CanalReading> {
  const out = {} as Record<CanalId, CanalReading>;
  for (const id of CANAL_IDS) {
    const c = CANALS[id];
    const raw = dot(cupulaDegS, c.normal);
    const stimulation = Math.abs(raw) < 1e-9 ? 0 : raw;
    out[id] = {
      stimulation,
      flow: endolymphFlow(c.name, stimulation),
      excitatory: stimulation === 0 ? null : stimulation > 0,
      firingRate: afferentRate(stimulation, p),
    };
  }
  return out;
}

/**
 * Run the canals through a head angular-velocity history sampled every `dtS` seconds (pass a single
 * sample for "the head has just jumped to this velocity from rest"), optionally continuing from a
 * previous state. Returns the final state and the per-canal readings.
 */
export function canalResponse(
  history: readonly Vec3[],
  dtS = 0.01,
  prev: CanalState = createCanalState(),
  p: { cupula?: CupulaParams; afferent?: AfferentParams } = {},
): { state: CanalState; canals: Record<CanalId, CanalReading> } {
  let state = prev;
  for (const w of history) state = stepCanals(state, w, dtS, p.cupula ?? CUPULA);
  return { state, canals: canalReadout(state.cupula, p.afferent ?? AFFERENT) };
}

// ---------------------------------------------------------------------------------------------
// Spin and stop (Bárány chair) with velocity storage
// ---------------------------------------------------------------------------------------------

export interface SpinStopOptions {
  /** Chair velocity about the head's vertical (+y) axis, deg/s; positive = turning left. */
  omegaDegS?: number;
  /** Duration of constant rotation after the impulsive start, s. */
  spinS?: number;
  /** Time recorded after the impulsive stop, s. */
  afterS?: number;
  /** Sample interval, s. */
  dtS?: number;
  /** Cupula long time constant, s. */
  tauCupulaS?: number;
  /** Time constant of perceived rotation and the VOR after velocity storage, s (≈ 15–20 s). */
  tauStorageS?: number;
  /** VOR gain (eye velocity / head-velocity estimate). */
  vorGain?: number;
}

export interface SpinSample {
  t: number;
  phase: 'per-rotatory' | 'post-rotatory';
  /** Chair/head velocity, deg/s. */
  headVelocity: number;
  /** Cupula signal along the yaw axis, deg/s equivalent (decays with τ_cupula). */
  cupula: number;
  /** Brain's estimate of head velocity (direct canal path + velocity storage), deg/s. */
  perceived: number;
  /** Slow-phase eye velocity of the nystagmus, deg/s (opposite to the perceived rotation). */
  slowPhaseVelocity: number;
  /** Afferent firing of the left and right lateral canals, spikes/s. */
  leftLateralRate: number;
  rightLateralRate: number;
}

/**
 * Bárány spin-and-stop: the chair jumps to `omegaDegS` at t = 0, turns steadily for `spinS`, then
 * stops abruptly. The cupula signal decays with τ_c ≈ 6 s during the spin (the sensation of turning
 * fades) and is driven the opposite way at the stop (post-rotatory sensation of turning the other
 * way and nystagmus beating in the opposite direction to the per-rotatory one). Central velocity
 * storage (Raphan, Matsuo & Cohen 1979) is a leaky integrator, v' = −v/τ_s + g·r, fed by the canal
 * signal r and added to the direct path; with g = (τ_s − τ_c)/(τ_c·τ_s) the total is exactly a
 * high-pass of head velocity with τ_s, extending the perceived/VOR time constant to ≈ 15–20 s.
 */
export function spinStopSimulation(opts: SpinStopOptions = {}): { samples: SpinSample[]; stopTimeS: number; tauCupulaS: number; tauStorageS: number } {
  const w = opts.omegaDegS ?? 100, T = opts.spinS ?? 60, after = opts.afterS ?? 60, dt = opts.dtS ?? 0.05;
  const tc = opts.tauCupulaS ?? CUPULA.tauLongS, ts = opts.tauStorageS ?? 16, gain = opts.vorGain ?? 1;
  const gi = (ts - tc) / (tc * ts);
  const decay = Math.exp(-dt / ts);
  let state = createCanalState();
  let storage = 0;
  const lat = CANALS['left-lateral'].normal.y; // yaw projection factor (cos 30°)
  const samples: SpinSample[] = [];
  const steps = Math.round((T + after) / dt);
  const cp: CupulaParams = { tauLongS: tc, tauShortS: CUPULA.tauShortS };
  const chair = (t: number) => (t < T - 1e-9 ? w : 0);
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const head = chair(t);
    if (i > 0) {
      // Integrate over the interval that ends at t, with the chair velocity of that interval.
      state = stepCanals(state, vec(0, chair(t - dt), 0), dt, cp);
      storage = storage * decay + gi * ts * (1 - decay) * state.cupula.y;
    }
    const r = state.cupula.y;
    const perceived = r + storage;
    samples.push({
      t, phase: t < T - 1e-9 ? 'per-rotatory' : 'post-rotatory',
      headVelocity: head, cupula: r, perceived,
      slowPhaseVelocity: -gain * perceived,
      leftLateralRate: afferentRate(r * lat),
      rightLateralRate: afferentRate(-r * lat),
    });
  }
  return { samples, stopTimeS: T, tauCupulaS: tc, tauStorageS: ts };
}

/** Cupula signal after a step of head velocity Δω, deg/s: Δω·e^(−t/τ) (short time constant ignored). */
export const cupulaAfterStep = (deltaOmegaDegS: number, tS: number, tauS = CUPULA.tauLongS): number => deltaOmegaDegS * Math.exp(-tS / tauS);

// ---------------------------------------------------------------------------------------------
// Otolith organs
// ---------------------------------------------------------------------------------------------

/**
 * Gravity in the head frame, m/s², for a head pitched `pitchDeg` (nose up +) and then rolled
 * `rollDeg` (right ear down +): g·(sin φ cos θ, −cos φ cos θ, −sin θ).
 */
export function gravityInHead(pitchDeg: number, rollDeg: number): Vec3 {
  const th = rad(pitchDeg), ph = rad(rollDeg);
  return vec(G * Math.sin(ph) * Math.cos(th), -G * Math.cos(ph) * Math.cos(th), -G * Math.sin(th));
}

export interface OtolithParams {
  /** Resting rate of otolith afferents, spikes/s (≈ 50–100; Fernández & Goldberg 1976). */
  restingHz: number;
  /** Sensitivity to shear, spikes/s per g (≈ 30–100 for regular to irregular units). */
  gainHzPerG: number;
  maxHz: number;
}
export const OTOLITH: OtolithParams = { restingHz: 60, gainHzPerG: 50, maxHz: 400 };

export interface OtolithResponse {
  /** Gravito-inertial acceleration (specific force) f = a − g sensed by the maculae, m/s². Upright at rest: (0, +g, 0). */
  gia: Vec3;
  /** Shear in the (approximately horizontal) utricular macula: x (lateral) and z (fore–aft) components, m/s². */
  utricle: { x: number; z: number; magnitude: number };
  /** Shear in the (approximately vertical, parasagittal) saccular macula: y (vertical) and z components, m/s². */
  saccule: { y: number; z: number; magnitude: number };
  /** Angle between f and the head's vertical axis, degrees: the tilt the brain would infer from the otoliths alone. */
  apparentTiltDeg: number;
  /**
   * Firing of hair-cell populations polarised along ±x, +z (utricle) and +y, +z (saccule), spikes/s,
   * relative to the upright, stationary head (the saccule is already loaded by 1 g when upright).
   */
  firing: { utricleRight: number; utricleLeft: number; utricleForward: number; sacculeUp: number; sacculeForward: number };
  /** Whether this pattern could equally be a tilt or a translation (always true for a single static reading). */
  ambiguity: string;
}

/**
 * Otolith shear for a gravity vector and linear head acceleration in the head frame, m/s². The
 * maculae sense only the gravito-inertial acceleration f = a − g, so a forward acceleration of
 * g·sin θ gives exactly the same utricular shear as a nose-up pitch of θ — the tilt–translation
 * ambiguity behind the somatogravic illusion; the brain resolves it with canal signals and internal
 * models (Angelaki et al. 1999, J Neurosci 19:316–327; Purves 6e ch. 14; Kandel 6e ch. 27).
 */
export function otolith(gravity: Vec3 = vec(0, -G, 0), linearAccel: Vec3 = vec(0, 0, 0), p: OtolithParams = OTOLITH): OtolithResponse {
  const f = sub(linearAccel, gravity);
  const rest = vec(0, G, 0);
  const d = sub(f, rest);
  const rate = (shear: number) => Math.min(p.maxHz, Math.max(0, p.restingHz + (p.gainHzPerG * shear) / G));
  const cos = len(f) === 0 ? 1 : f.y / len(f);
  return {
    gia: f,
    utricle: { x: f.x, z: f.z, magnitude: Math.hypot(f.x, f.z) },
    saccule: { y: f.y, z: f.z, magnitude: Math.hypot(f.y, f.z) },
    apparentTiltDeg: deg(Math.acos(Math.max(-1, Math.min(1, cos)))),
    firing: {
      utricleRight: rate(d.x), utricleLeft: rate(-d.x), utricleForward: rate(d.z),
      sacculeUp: rate(d.y), sacculeForward: rate(d.z),
    },
    ambiguity: 'Otoliths sense gravito-inertial acceleration only: a static tilt and a linear acceleration of the same direction and size give the same shear.',
  };
}

/** Forward acceleration, m/s², that mimics a nose-up pitch of `pitchDeg` for the utricle: g·sin θ. */
export const accelerationMimickingTilt = (pitchDeg: number): number => G * Math.sin(rad(pitchDeg));

// ---------------------------------------------------------------------------------------------
// Vestibulo-ocular reflex and nystagmus
// ---------------------------------------------------------------------------------------------

/** VOR gains per axis: horizontal and vertical ≈ 1 in the light at high frequency; torsional ≈ 0.5–0.7. */
export const VOR_GAIN = { yaw: 1, pitch: 1, roll: 0.6 } as const;

/**
 * Angular VOR: eye velocity in the head = −gain × head velocity, deg/s, per axis (yaw = ω.y,
 * pitch = ω.x, roll = ω.z), keeping the gaze stable in space (Kandel 6e ch. 27).
 */
export function vor(headVelocityDegS: Vec3, gains: { yaw: number; pitch: number; roll: number } = VOR_GAIN): Vec3 {
  return vec(-gains.pitch * headVelocityDegS.x, -gains.yaw * headVelocityDegS.y, -gains.roll * headVelocityDegS.z);
}

export interface NystagmusOptions {
  /** Range of eye positions the slow phase sweeps before a reset, degrees. */
  rangeDeg?: number;
  /** Fast-phase (saccadic reset) speed, deg/s. */
  fastPhaseDegS?: number;
}
export interface NystagmusState { positionDeg: number; fast: boolean }

/**
 * Advance a jerk nystagmus by `dtS` with slow-phase velocity `spvDegS` (deg/s, eye in head): the
 * eye drifts at the SPV until it reaches the edge of the range, then a fast phase resets it to the
 * other edge. Nystagmus is named by the direction of the fast phase (opposite to the slow phase).
 */
export function nystagmusStep(s: NystagmusState, spvDegS: number, dtS: number, opts: NystagmusOptions = {}): NystagmusState {
  const half = (opts.rangeDeg ?? 10) / 2, fast = opts.fastPhaseDegS ?? 250;
  const dir = Math.sign(spvDegS);
  if (dir === 0) return { positionDeg: s.positionDeg, fast: false };
  if (s.fast) {
    const target = -dir * half;
    const next = s.positionDeg - dir * fast * dtS;
    return dir > 0 ? (next <= target ? { positionDeg: target, fast: false } : { positionDeg: next, fast: true })
      : (next >= target ? { positionDeg: target, fast: false } : { positionDeg: next, fast: true });
  }
  const next = s.positionDeg + spvDegS * dtS;
  if (dir * next >= half) return { positionDeg: dir * half, fast: true };
  return { positionDeg: next, fast: false };
}

/**
 * Eye position of a steady jerk nystagmus at time `tS` (closed form for a constant SPV): a sawtooth
 * of slow drifts at `spvDegS` and fast resets. `fastPhaseSign` is the direction the nystagmus beats.
 */
export function nystagmusWaveform(spvDegS: number, tS: number, opts: NystagmusOptions = {}): { positionDeg: number; phase: 'slow' | 'fast' | 'none'; fastPhaseSign: number } {
  const range = opts.rangeDeg ?? 10, fast = opts.fastPhaseDegS ?? 250;
  const dir = Math.sign(spvDegS);
  if (dir === 0) return { positionDeg: 0, phase: 'none', fastPhaseSign: 0 };
  const slowT = range / Math.abs(spvDegS), fastT = range / fast, period = slowT + fastT;
  const tau = ((tS % period) + period) % period;
  if (tau < slowT) return { positionDeg: -dir * range / 2 + spvDegS * tau, phase: 'slow', fastPhaseSign: -dir };
  return { positionDeg: dir * range / 2 - dir * fast * (tau - slowT), phase: 'fast', fastPhaseSign: -dir };
}

// ---------------------------------------------------------------------------------------------
// BPPV: posterior-canal canalithiasis
// ---------------------------------------------------------------------------------------------

export interface DixHallpikeResult {
  testSide: Side;
  /** Whether the manoeuvre provokes positional vertigo and nystagmus. */
  provoked: boolean;
  /** Latency before the nystagmus starts, s. */
  latencyS: { typical: number; min: number; max: number } | null;
  /** Duration of the nystagmus, s (always under 60 s in canalithiasis). */
  durationS: { typical: number; max: number } | null;
  nystagmus: {
    /** Vertical component: upbeating (fast phase towards the forehead). */
    vertical: 'upbeating';
    /** Torsional component: upper pole of the eye beats towards the dependent (affected) ear (geotropic). */
    torsionalToward: Side;
    /** The plane it lies in (Ewald's first law): that of the stimulated posterior canal. */
    plane: string;
  } | null;
  /** On sitting up the nystagmus reverses (downbeating, torsion away), and repeated tests fatigue it. */
  reversesOnSittingUp: boolean;
  fatigable: boolean;
  explanation: string;
}

/** Typical course of canalithiasis nystagmus after a provoking manoeuvre (Bhattacharyya 2017; Hain). */
export const BPPV_TIMING = { latencyS: { typical: 3, min: 1, max: 5 }, durationS: { typical: 20, max: 60 } } as const;

/**
 * Dix–Hallpike test on `testSide` (head turned 45° to that side, brought quickly from sitting to
 * supine with the neck extended 20–30° below horizontal) in a patient with posterior-canal
 * canalithiasis of `affected` (null = no BPPV). It is positive only when the affected ear is the
 * dependent (tested) ear: otoconia fall ampullofugally in the posterior canal, exciting it, giving
 * a burst of torsional (upper pole towards the lower ear) upbeating nystagmus after 1–5 s that lasts
 * under 60 s (Bhattacharyya et al. 2017; Fife et al. 2008; Hain).
 */
export function dixHallpike(testSide: Side, affected: Side | null): DixHallpikeResult {
  const provoked = affected !== null && affected === testSide;
  if (!provoked) {
    return {
      testSide, provoked: false, latencyS: null, durationS: null, nystagmus: null, reversesOnSittingUp: false, fatigable: false,
      explanation: affected === null
        ? 'No otoconia in the canal: no positional nystagmus.'
        : `Turning to the ${testSide} does not tip the ${affected} posterior canal so that its debris falls away from the cupula: negative on this side (test the ${affected} side).`,
    };
  }
  return {
    testSide, provoked: true,
    latencyS: { ...BPPV_TIMING.latencyS }, durationS: { ...BPPV_TIMING.durationS },
    nystagmus: { vertical: 'upbeating', torsionalToward: affected, plane: `${affected} posterior canal (${affected === 'left' ? 'RALP' : 'LARP'} plane)` },
    reversesOnSittingUp: true, fatigable: true,
    explanation: `Debris in the ${affected} posterior canal falls away from the cupula (ampullofugal), exciting the canal: after a short latency the eyes beat upwards and torsionally towards the ${affected} (lowermost) ear, crescendo then decrescendo, for less than a minute.`,
  };
}

/**
 * Relative intensity (0…1) of the provoked nystagmus `tS` seconds after reaching the provoking
 * position: zero during the latency, then a crescendo–decrescendo x·e^(1−x) with its peak `peakS`
 * after onset, under 2 % of peak by 60 s. For animation.
 */
export function bppvNystagmusIntensity(tS: number, latencyS: number = BPPV_TIMING.latencyS.typical, peakS = 6): number {
  if (tS <= latencyS) return 0;
  const x = (tS - latencyS) / peakS;
  return x * Math.exp(1 - x);
}

/** Head positions that typically provoke posterior-canal BPPV (Bhattacharyya et al. 2017). */
export const BPPV_PROVOKING_POSITIONS: readonly string[] = [
  'Lying back into bed or the Dix–Hallpike position with the head turned to the affected side',
  'Rolling over in bed onto the affected side',
  'Looking up (extending the neck, "top-shelf vertigo")',
  'Bending forward (e.g. tying shoelaces)',
];

export interface EpleyStep {
  step: number;
  name: string;
  posture: 'sitting' | 'supine' | 'side-lying';
  /** The side the patient lies on in side-lying, else null. */
  lyingOn: Side | null;
  /** Head turn on the trunk, degrees: + to the patient's right, − to the left. */
  headYawOnTrunkDeg: number;
  /** Neck extension, degrees: + chin up / head hanging below the couch, − chin down. */
  headPitchDeg: number;
  /**
   * Rotation of the face about the body's long axis from facing the ceiling, degrees (+ towards the
   * patient's right); null when sitting. Steps 2→3→4 each turn the head 90°.
   */
  faceFromCeilingDeg: number | null;
  /** How long to hold the position, s. */
  holdSeconds: number;
  /** Where the otoconia are in the affected posterior canal at the end of the step. */
  otoconia: {
    region: 'ampullary arm (near cupula)' | 'apex of the canal arc' | 'non-ampullary arm' | 'common crus' | 'utricle';
    /** Progress along the canal from the ampulla (0) through the common crus to the utricle (1). */
    fractionAlongCanal: number;
  };
  instruction: string;
}

/**
 * The canalith repositioning (Epley) manoeuvre for posterior-canal BPPV of the `affected` ear: five
 * positions, each held about 30 s (or until the nystagmus stops), moving the otoconia around the
 * posterior canal, through the common crus and into the utricle, where they no longer act on the
 * cupula (Epley 1992; Bhattacharyya et al. 2017; Hain).
 */
export function epleyManoeuvre(affected: Side): EpleyStep[] {
  const s = affected === 'right' ? 1 : -1; // + towards the affected ear
  const other: Side = affected === 'right' ? 'left' : 'right';
  return [
    {
      step: 1, name: 'Sit, head turned to the affected ear', posture: 'sitting', lyingOn: null,
      headYawOnTrunkDeg: 45 * s, headPitchDeg: 0, faceFromCeilingDeg: null, holdSeconds: 0,
      otoconia: { region: 'ampullary arm (near cupula)', fractionAlongCanal: 0.05 },
      instruction: `Sit on the couch and turn the head 45° towards the ${affected} ear.`,
    },
    {
      step: 2, name: 'Dix–Hallpike position', posture: 'supine', lyingOn: null,
      headYawOnTrunkDeg: 45 * s, headPitchDeg: 20, faceFromCeilingDeg: 45 * s, holdSeconds: 30,
      otoconia: { region: 'apex of the canal arc', fractionAlongCanal: 0.4 },
      instruction: `Lie back quickly with the head still turned 45° to the ${affected} and hanging 20–30° below the couch; wait for the nystagmus to stop.`,
    },
    {
      step: 3, name: 'Turn the head to the other side', posture: 'supine', lyingOn: null,
      headYawOnTrunkDeg: -45 * s, headPitchDeg: 20, faceFromCeilingDeg: -45 * s, holdSeconds: 30,
      otoconia: { region: 'non-ampullary arm', fractionAlongCanal: 0.65 },
      instruction: `Keeping the neck extended, turn the head 90° so it faces 45° towards the ${other}.`,
    },
    {
      step: 4, name: 'Roll onto the unaffected side, face down', posture: 'side-lying', lyingOn: other,
      headYawOnTrunkDeg: -45 * s, headPitchDeg: 0, faceFromCeilingDeg: -135 * s, holdSeconds: 30,
      otoconia: { region: 'common crus', fractionAlongCanal: 0.85 },
      instruction: `Roll onto the ${other} side, turning the head another 90° so the nose points 45° towards the floor.`,
    },
    {
      step: 5, name: 'Sit up, chin down', posture: 'sitting', lyingOn: null,
      headYawOnTrunkDeg: -45 * s, headPitchDeg: -20, faceFromCeilingDeg: null, holdSeconds: 30,
      otoconia: { region: 'utricle', fractionAlongCanal: 1 },
      instruction: 'Sit up slowly from the side, keeping the head turned, then bring the chin down about 20°.',
    },
  ];
}
