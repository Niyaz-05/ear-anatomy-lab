/**
 * Middle-ear pressure and the auditory (Eustachian) tube: ambient pressure when flying or diving,
 * the pressure difference across the eardrum, and what it does. Pure functions, no DOM.
 *
 * Sources: the International Standard Atmosphere (ISO 2533:1975) barometric formula for the
 * troposphere; hydrostatics for sea water (ρ ≈ 1025 kg/m³); Edmonds C et al., Diving and Subaquatic
 * Medicine (5th ed., 2015) for the approximate pressure differences that cause pain, lock the tube
 * and can rupture the drum; Pickles JO (2012) An Introduction to the Physiology of Hearing.
 */

/** Standard sea-level pressure, kPa. */
export const SEA_LEVEL_KPA = 101.325;
export const MMHG_PER_KPA = 7.50062;

/** Air pressure at an altitude, kPa (ISA troposphere, valid to 11 km): p = p₀(1 − 2.25577×10⁻⁵ h)^5.25588. */
export function airPressureKPa(altitudeM: number): number {
  const h = Math.min(Math.max(altitudeM, -500), 11000);
  return SEA_LEVEL_KPA * (1 - 2.25577e-5 * h) ** 5.25588;
}

/** Absolute pressure under sea water at a depth, kPa: p₀ + ρ·g·d (≈ +10 kPa per metre; doubles at 10 m). */
export function waterPressureKPa(depthM: number, densityKgM3 = 1025): number {
  return SEA_LEVEL_KPA + (densityKgM3 * 9.80665 * Math.max(0, depthM)) / 1000;
}

/**
 * Approximate thresholds for the pressure difference across the drum, kPa (Edmonds et al. 2015, diving
 * medicine; individual values vary widely): discomfort and pain from about 8 kPa (≈ 60 mmHg); the tube
 * may "lock" shut, so swallowing no longer opens it, from about 12 kPa (≈ 90 mmHg); the drum can
 * rupture somewhere between about 13 and 65 kPa (≈ 100–500 mmHg).
 */
export const DRUM_THRESHOLDS_KPA = { pain: 8, lock: 12, rupture: 13 } as const;
/** Middle-ear overpressure (ascent) vents passively through the tube once it exceeds a few kPa (approximate). */
export const PASSIVE_VENT_KPA = 2;

export type DrumState = 'neutral' | 'pushed-in' | 'bulging-out';

export interface EarPressure {
  ambientKPa: number;
  middleEarKPa: number;
  /** Ambient minus middle ear, kPa: positive pushes the drum in (descent), negative bulges it out (ascent). */
  differenceKPa: number;
  differenceMmHg: number;
  drum: DrumState;
  /** 0 none … 3 rupture risk. */
  severity: 0 | 1 | 2 | 3;
  /** Whether a swallow or Valsalva can still open the tube. */
  canEqualise: boolean;
  note: string;
}

/** What the pressure difference across the eardrum does. */
export function earPressure(ambientKPa: number, middleEarKPa: number): EarPressure {
  const d = ambientKPa - middleEarKPa;
  const a = Math.abs(d);
  const drum: DrumState = a < 0.3 ? 'neutral' : d > 0 ? 'pushed-in' : 'bulging-out';
  const severity = a >= DRUM_THRESHOLDS_KPA.rupture ? 3 : a >= DRUM_THRESHOLDS_KPA.pain ? 2 : a >= 1 ? 1 : 0;
  const canEqualise = !(d > 0 && a >= DRUM_THRESHOLDS_KPA.lock);
  const note = drum === 'neutral'
    ? 'Pressures are equal on both sides: the drum rests in its normal position.'
    : drum === 'pushed-in'
      ? `The outside pressure is higher: the drum is pushed in towards the middle ear${severity >= 2 ? ', which hurts' : ' and feels blocked'}. ${canEqualise ? 'Swallowing or a Valsalva opens the tube and lets air in.' : 'The tube is probably locked shut: swallowing no longer opens it (go back up a little).'}`
      : `The middle-ear pressure is higher: the drum bulges out. Air vents passively down the tube once the difference passes a few kPa, so going up is usually easier than coming down.`;
  return { ambientKPa, middleEarKPa, differenceKPa: d, differenceMmHg: d * MMHG_PER_KPA, drum, severity, canEqualise, note };
}

/**
 * Middle-ear pressure after the ambient pressure changes with the tube closed: overpressure above
 * `PASSIVE_VENT_KPA` vents passively (ascent); underpressure stays until the learner swallows.
 */
export function middleEarAfter(middleEarKPa: number, ambientKPa: number): number {
  return middleEarKPa - ambientKPa > PASSIVE_VENT_KPA ? ambientKPa + PASSIVE_VENT_KPA : middleEarKPa;
}

/** Eardrum displacement for the 3D view, −1 … 1 (+ = pushed in), saturating as the drum stiffens. */
export function drumDisplacement(differenceKPa: number): number {
  return Math.tanh(differenceKPa / 8);
}
