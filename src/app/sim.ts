/**
 * Settings of the simulation modes (Hearing, Balance, Clinic, Close-ups), kept in the lab state so a
 * tour step can set them through its `params` and every learner action stays a pure, testable update.
 * Values that change every frame (the vibrating chain, the cupulae) live in `live.ts` instead.
 */
import type { StepParams } from '../contract/schema';
import { CASES, makeEar, type Audiogram, type CaseId, type Side } from '../ear/audiology';
import { SEA_LEVEL_KPA, airPressureKPa, waterPressureKPa } from '../ear/pressure';

/** Ambient pressure in the ear-pressure close-up, kPa: the cabin air when flying, the water when diving. */
export const ambientKPa = (s: Pick<Sim, 'environment' | 'heightM' | 'depthM'>) => (s.environment === 'flight' ? airPressureKPa(s.heightM) : waterPressureKPa(s.depthM));

export const CLOSEUPS = [
  { id: 'ossicles', label: 'Ossicles' },
  { id: 'cochlea', label: 'Cochlear duct' },
  { id: 'crista', label: 'Crista' },
  { id: 'macula', label: 'Macula' },
  { id: 'pressure', label: 'Ear pressure' },
  { id: 'bppv', label: 'BPPV' },
] as const;
export type CloseupId = (typeof CLOSEUPS)[number]['id'];
export type ClinicView = 'cases' | 'build' | 'devices';
/** Continuous head movement in the Balance mode: none, or a gentle shake, nod or side-to-side tilt. */
export type HeadMotion = 'none' | 'yaw' | 'pitch' | 'roll';
export type Environment = 'flight' | 'dive';

export interface Sim {
  /** Hearing: pure-tone frequency, Hz (20–20 000), and level, dB SPL (0–130). */
  freqHz: number;
  levelDb: number;
  /** Balance: static head tilt for the otoliths, degrees (pitch nose-up +, roll right-ear-down +). */
  pitchDeg: number;
  rollDeg: number;
  /** Balance: forward linear acceleration, m/s² (the tilt–translation ambiguity). */
  accelMs2: number;
  motion: HeadMotion;
  /** Balance: start the spin-and-stop demonstration when this changes (0 = not started). */
  spin: number;
  /** Clinic. */
  caseId: CaseId;
  clinicView: ClinicView;
  custom: Audiogram;
  implantElectrodes: number;
  implantDepthMm: number;
  /** Close-ups. */
  closeup: CloseupId;
  muscles: boolean;
  environment: Environment;
  /** Cabin altitude (flight), m, 0–3000; or depth under water (dive), m, 0–12. */
  heightM: number;
  depthM: number;
  /** Middle-ear pressure, kPa (set to the ambient pressure by swallowing). */
  middleEarKPa: number;
  /** BPPV: Dix–Hallpike side tested, and the Epley step shown (0 = before the manoeuvre, 1–5). */
  hallpikeSide: Side | 'none';
  epleyStep: number;
}


/** A flat normal audiogram, where "build your own" starts. */
export const flatAudiogram = (): Audiogram => ({
  left: makeEar([10, 10, 10, 10, 10, 10, 10, 10], [5, 5, 5, 5, 5, 5]),
  right: makeEar([10, 10, 10, 10, 10, 10, 10, 10], [5, 5, 5, 5, 5, 5]),
});

export function defaultSim(): Sim {
  return {
    freqHz: 1000, levelDb: 70,
    pitchDeg: 0, rollDeg: 0, accelMs2: 0, motion: 'none', spin: 0,
    caseId: 'otosclerosis', clinicView: 'cases', custom: flatAudiogram(), implantElectrodes: 22, implantDepthMm: 25,
    closeup: 'ossicles', muscles: false, environment: 'flight', heightM: 0, depthM: 0, middleEarKPa: SEA_LEVEL_KPA,
    hallpikeSide: 'none', epleyStep: 0,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);
const CASE_IDS = CASES.map((c) => c.id);

/**
 * Apply a patch of settings, keeping every value in range (unknown keys and wrong types are
 * ignored). Used both for learner actions and for a tour step's `params`.
 */
export function patchSim(sim: Sim, p: Partial<Sim> | StepParams): Sim {
  const q = p as Record<string, unknown>;
  const out: Sim = { ...sim };
  if ('freqHz' in q) out.freqHz = num(q.freqHz, 20, 20000, sim.freqHz);
  if ('levelDb' in q) out.levelDb = num(q.levelDb, 0, 130, sim.levelDb);
  if ('pitchDeg' in q) out.pitchDeg = num(q.pitchDeg, -90, 90, sim.pitchDeg);
  if ('rollDeg' in q) out.rollDeg = num(q.rollDeg, -90, 90, sim.rollDeg);
  if ('accelMs2' in q) out.accelMs2 = num(q.accelMs2, -6, 6, sim.accelMs2);
  if ('motion' in q) out.motion = oneOf(q.motion, ['none', 'yaw', 'pitch', 'roll'] as const, sim.motion);
  if ('spin' in q) out.spin = num(q.spin, 0, 1e9, sim.spin);
  if ('caseId' in q) out.caseId = oneOf(q.caseId, CASE_IDS, sim.caseId);
  if ('clinicView' in q) out.clinicView = oneOf(q.clinicView, ['cases', 'build', 'devices'] as const, sim.clinicView);
  if ('custom' in q && q.custom && typeof q.custom === 'object') out.custom = q.custom as Audiogram;
  if ('implantElectrodes' in q) out.implantElectrodes = Math.round(num(q.implantElectrodes, 12, 22, sim.implantElectrodes));
  if ('implantDepthMm' in q) out.implantDepthMm = num(q.implantDepthMm, 12, 32, sim.implantDepthMm);
  if ('closeup' in q) out.closeup = oneOf(q.closeup, CLOSEUPS.map((c) => c.id), sim.closeup);
  if ('muscles' in q && typeof q.muscles === 'boolean') out.muscles = q.muscles;
  if ('environment' in q) out.environment = oneOf(q.environment, ['flight', 'dive'] as const, sim.environment);
  if ('heightM' in q) out.heightM = num(q.heightM, 0, 3000, sim.heightM);
  if ('depthM' in q) out.depthM = num(q.depthM, 0, 12, sim.depthM);
  if ('middleEarKPa' in q) out.middleEarKPa = num(q.middleEarKPa, 50, 250, sim.middleEarKPa);
  if ('hallpikeSide' in q) out.hallpikeSide = oneOf(q.hallpikeSide, ['none', 'left', 'right'] as const, sim.hallpikeSide);
  if ('epleyStep' in q) out.epleyStep = Math.round(num(q.epleyStep, 0, 5, sim.epleyStep));
  return out;
}

/** Set one threshold of the learner's own audiogram (snapped to 5 dB, −10 … 120 dB HL). */
export function setThreshold(a: Audiogram, ear: Side, path: 'air' | 'bone', freq: number, db: number): Audiogram {
  const v = clamp(Math.round(db / 5) * 5, -10, 120);
  const e = a[ear];
  if (path === 'air') {
    if (!(freq in e.air)) return a;
    return { ...a, [ear]: { ...e, air: { ...e.air, [freq]: v } } };
  }
  if (!(freq in e.bone)) return a;
  return { ...a, [ear]: { ...e, bone: { ...e.bone, [freq]: v } } };
}
