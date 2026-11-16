/**
 * Hearing science for the ear lab: the cochlear frequency–place map, the middle-ear pressure
 * transformer, a basilar-membrane travelling wave for animation, sound-level arithmetic, noise
 * exposure limits, the threshold of hearing and the ear-canal resonance. Pure functions with units in
 * the names, so every number can be unit-tested (no DOM, no three.js).
 *
 * Main sources: Greenwood DD (1990) J Acoust Soc Am 87:2592–2605; Pickles JO (2012) An Introduction
 * to the Physiology of Hearing, 4th ed.; Purves D et al. (2018) Neuroscience, 6th ed., ch. 13;
 * OpenStax Anatomy & Physiology 2e (2022) §14.1; NIOSH (1998) Criteria for a Recommended Standard:
 * Occupational Noise Exposure, DHHS (NIOSH) Publ. 98-126; ISO 226:2003; IEC 61672-1 (A-weighting).
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// Cochlear frequency–place map
// ---------------------------------------------------------------------------------------------

/** Greenwood's constants for the human cochlea, with x as the fraction of length from the apex. */
export const GREENWOOD_HUMAN = { A: 165.4, a: 2.1, k: 0.88 } as const;
export interface GreenwoodParams { A: number; a: number; k: number }

/** Length of the human basilar membrane (organ of Corti), mm; adult range about 31–37 mm (Pickles 2012). */
export const COCHLEA_LENGTH_MM = 35;

/**
 * Greenwood's frequency–position function, F = A·(10^(a·x) − k), Hz, for a place `xFromApex`
 * (0 = helicotrema/apex, 1 = base next to the oval and round windows; clamped to 0…1). Human
 * values give ≈ 20 Hz at the apex and ≈ 20.7 kHz at the base (Greenwood 1990, JASA 87:2592).
 */
export function greenwood(xFromApex: number, p: GreenwoodParams = GREENWOOD_HUMAN): number {
  return p.A * (10 ** (p.a * clamp(xFromApex, 0, 1)) - p.k);
}

export interface CochlearPlace {
  /** Fraction of the cochlear length measured from the apex, 0…1. */
  fromApex: number;
  /** Distance from the apex (helicotrema), mm. */
  mmFromApex: number;
  /** Distance from the base (stapes / round window end), mm. */
  mmFromBase: number;
}

/**
 * Inverse Greenwood map: the characteristic place of a pure tone, x = log10(F/A + k)/a. Frequencies
 * outside the map (below ≈ 20 Hz or above ≈ 20.7 kHz) are clamped to the apex or base.
 */
export function placeFromFrequency(freqHz: number, lengthMm = COCHLEA_LENGTH_MM, p: GreenwoodParams = GREENWOOD_HUMAN): CochlearPlace {
  const arg = freqHz / p.A + p.k;
  const fromApex = arg <= 0 ? 0 : clamp(Math.log10(arg) / p.a, 0, 1);
  return { fromApex, mmFromApex: fromApex * lengthMm, mmFromBase: (1 - fromApex) * lengthMm };
}

/** Characteristic frequency at a distance from the base, Hz (convenience for implant and wave maps). */
export function frequencyAtMmFromBase(mmFromBase: number, lengthMm = COCHLEA_LENGTH_MM, p: GreenwoodParams = GREENWOOD_HUMAN): number {
  return greenwood(1 - mmFromBase / lengthMm, p);
}

// ---------------------------------------------------------------------------------------------
// Middle ear impedance matching
// ---------------------------------------------------------------------------------------------

export interface MiddleEarParams {
  /** Effective (vibrating) area of the tympanic membrane, mm²; anatomical area ≈ 85–90 mm². */
  tympanicAreaMm2: number;
  /** Area of the stapes footplate in the oval window, mm². */
  footplateAreaMm2: number;
  /** Ossicular lever ratio, malleus manubrium length / long process of incus. */
  leverRatio: number;
}
/** Textbook values (Pickles 2012 ch. 2; Purves 6e ch. 13): area ratio ≈ 17, lever ≈ 1.3. */
export const MIDDLE_EAR: MiddleEarParams = { tympanicAreaMm2: 55, footplateAreaMm2: 3.2, leverRatio: 1.3 };

export interface MiddleEarGain {
  areaRatio: number;
  leverRatio: number;
  /** Pressure at the footplate / pressure at the eardrum (ideal transformer). */
  pressureGain: number;
  /** The same, dB (20·log10). */
  gainDb: number;
}

/**
 * Ideal middle-ear transformer: pressure gain = (A_TM/A_FP) × lever ratio ≈ 17 × 1.3 ≈ 22 ≈ 27 dB.
 * (Measured gains are frequency-dependent and peak at about 20–25 dB near 1 kHz; Pickles 2012.)
 */
export function middleEarGain(p: Partial<MiddleEarParams> = {}): MiddleEarGain {
  const q = { ...MIDDLE_EAR, ...p };
  const areaRatio = q.tympanicAreaMm2 / q.footplateAreaMm2;
  const pressureGain = areaRatio * q.leverRatio;
  return { areaRatio, leverRatio: q.leverRatio, pressureGain, gainDb: 20 * Math.log10(pressureGain) };
}

/**
 * Why a middle ear is needed: the fraction of sound intensity transmitted from air into water (the
 * cochlear fluids) at normal incidence, T = 4·Z1·Z2/(Z1 + Z2)², and the loss in dB. Characteristic
 * impedances in rayl (Pa·s/m): air ≈ 413 at 20 °C, sea water/perilymph ≈ 1.48 × 10⁶. Gives ≈ 0.1 %
 * (≈ −30 dB), the loss that the ≈ 27 dB middle-ear gain largely recovers (Purves 6e ch. 13).
 */
export function airToFluidTransmission(zAirRayl = 413, zFluidRayl = 1.48e6): { transmittedFraction: number; lossDb: number } {
  const t = (4 * zAirRayl * zFluidRayl) / (zAirRayl + zFluidRayl) ** 2;
  return { transmittedFraction: t, lossDb: 10 * Math.log10(t) };
}

// ---------------------------------------------------------------------------------------------
// Basilar membrane travelling wave
// ---------------------------------------------------------------------------------------------

export interface TravelingWaveOptions {
  /** Basilar membrane length, mm. */
  lengthMm?: number;
  /** Phase lag accumulated from the base to the characteristic place, cycles (≈ 2–3 in mammals; Ruggero 1992). */
  cyclesToPeak?: number;
  /** Width of the slow basal build-up, as a fraction of the length (Gaussian e-fold scale). */
  basalWidth?: number;
  /** Width of the sharp apical cut-off, as a fraction of the length. */
  apicalWidth?: number;
}

export interface TravelingWave {
  /** Sample positions, mm from the base (0 = stapes end), evenly spaced to the apex. */
  mmFromBase: number[];
  /** Displacement envelope at each sample, normalised so the peak is 1. */
  envelope: number[];
  /** Instantaneous displacement envelope·cos(2πft − φ), in −1…1. */
  displacement: number[];
  /** Phase lag φ relative to the stapes, radians (increases towards the apex). */
  phaseRad: number[];
  /** The characteristic place for the tone (Greenwood), mm from the base. */
  peakMmFromBase: number;
  /** Index of the sample nearest the peak. */
  peakIndex: number;
}

/**
 * A von Békésy travelling wave on the basilar membrane for a pure tone of `freqHz` at time `tS`
 * (pass slowed time for animation), sampled at `n` points from base to apex. The envelope builds up
 * slowly from the base, peaks at the Greenwood characteristic place and is cut off sharply on the
 * apical side; the phase lag grows with distance and the wavelength shortens as the wave slows near
 * its peak (von Békésy 1960; Pickles 2012 ch. 3; Robles & Ruggero 2001, Physiol Rev 81:1305). The
 * shape is a qualitative fit, not a hydrodynamic solution.
 */
export function travelingWave(freqHz: number, tS: number, n = 128, opts: TravelingWaveOptions = {}): TravelingWave {
  const L = opts.lengthMm ?? COCHLEA_LENGTH_MM;
  const cycles = opts.cyclesToPeak ?? 2.5;
  const wb = (opts.basalWidth ?? 0.25) * L;
  const wa = (opts.apicalWidth ?? 0.04) * L;
  const peak = Math.max(0.5, placeFromFrequency(freqHz, L).mmFromBase); // keep the phase law finite at the very base
  const count = Math.max(2, Math.floor(n));
  const mmFromBase: number[] = [], envelope: number[] = [], displacement: number[] = [], phaseRad: number[] = [];
  let peakIndex = 0, best = Infinity;
  for (let i = 0; i < count; i++) {
    const s = (L * i) / (count - 1);
    const d = s - peak;
    const env = Math.exp(-((d / (d <= 0 ? wb : wa)) ** 2));
    const u = s / peak;
    // φ ∝ u² before the peak (wave number rising linearly), continued with the same slope beyond.
    const phi = 2 * Math.PI * cycles * (u <= 1 ? u * u : 1 + 2 * (u - 1));
    mmFromBase.push(s);
    envelope.push(env);
    phaseRad.push(phi);
    displacement.push(env * Math.cos(2 * Math.PI * freqHz * tS - phi));
    if (Math.abs(d) < best) { best = Math.abs(d); peakIndex = i; }
  }
  return { mmFromBase, envelope, displacement, phaseRad, peakMmFromBase: peak, peakIndex };
}

// ---------------------------------------------------------------------------------------------
// Sound levels
// ---------------------------------------------------------------------------------------------

/** Reference RMS pressure for dB SPL in air, Pa (20 µPa, roughly the 1 kHz threshold of hearing). */
export const P_REF_PA = 20e-6;

/** Sound pressure level, dB SPL, of an RMS pressure in pascals: 20·log10(p/20 µPa). */
export const spl = (pressurePa: number): number => 20 * Math.log10(pressurePa / P_REF_PA);

/** RMS pressure, Pa, of a level in dB SPL (inverse of `spl`). */
export const pa = (levelDb: number): number => P_REF_PA * 10 ** (levelDb / 20);

/** Total level of incoherent sources, dB: 10·log10(Σ 10^(Lᵢ/10)). Two equal sources add 3.01 dB. */
export function sumLevels(levelsDb: readonly number[]): number {
  if (levelsDb.length === 0) return -Infinity;
  return 10 * Math.log10(levelsDb.reduce((s, l) => s + 10 ** (l / 10), 0));
}

/**
 * Free-field point-source level at `toM` metres given `levelDb` at `fromM` (inverse-square law):
 * L₂ = L₁ − 20·log10(r₂/r₁), i.e. −6.02 dB per doubling of distance.
 */
export function levelAtDistance(levelDb: number, fromM: number, toM: number): number {
  return levelDb - 20 * Math.log10(toM / fromM);
}

// ---------------------------------------------------------------------------------------------
// Noise exposure (NIOSH REL)
// ---------------------------------------------------------------------------------------------

/** NIOSH 1998 recommended exposure limit: 85 dBA for 8 h, 3 dB exchange rate, 140 dBA ceiling. */
export const NIOSH_REL = { criterionDbA: 85, criterionMinutes: 480, exchangeDb: 3, ceilingDbA: 140 } as const;

/**
 * Permissible daily exposure, minutes: T = 480 / 2^((L − 85)/3) (NIOSH 1998, eq. 1-1). 85 dBA →
 * 480 min, 88 → 240, 94 → 60, 100 → 15. No exposure is permitted at or above the 140 dBA ceiling.
 */
export function safeExposureMinutes(dBA: number, rel: { criterionDbA: number; criterionMinutes: number; exchangeDb: number; ceilingDbA: number } = NIOSH_REL): number {
  if (dBA >= rel.ceilingDbA) return 0;
  return rel.criterionMinutes / 2 ** ((dBA - rel.criterionDbA) / rel.exchangeDb);
}

/** Daily noise dose, % (NIOSH 1998 eq. 1-2): D = 100·Σ Cᵢ/Tᵢ; ≥ 100 % exceeds the REL. */
export function noiseDose(exposures: readonly { dBA: number; minutes: number }[]): number {
  return 100 * exposures.reduce((s, e) => {
    const T = safeExposureMinutes(e.dBA);
    return s + (e.minutes <= 0 ? 0 : T === 0 ? Infinity : e.minutes / T);
  }, 0);
}

export type NoiseRisk = 'safe' | 'caution' | 'hazardous' | 'dangerous' | 'immediate-harm';

/**
 * A plain risk band for a steady level: < 70 dBA safe (WHO/EPA 24-h guideline), 70–84 caution,
 * 85–99 hazardous (over the 8-h REL), 100–119 dangerous (minutes), ≥ 120 immediate harm (near the
 * threshold of pain; NIOSH 1998).
 */
export function noiseRisk(dBA: number): { risk: NoiseRisk; label: string; safeMinutes: number } {
  const safeMinutes = safeExposureMinutes(dBA);
  if (dBA < 70) return { risk: 'safe', label: 'No measurable risk of hearing damage', safeMinutes };
  if (dBA < 85) return { risk: 'caution', label: 'Below the 8-hour limit; risk only with very long daily exposure', safeMinutes };
  if (dBA < 100) return { risk: 'hazardous', label: 'Over the 8-hour limit: limit time or wear hearing protection', safeMinutes };
  if (dBA < 120) return { risk: 'dangerous', label: 'Damage within minutes: hearing protection essential', safeMinutes };
  return { risk: 'immediate-harm', label: 'Painful; immediate risk of permanent damage', safeMinutes };
}

// ---------------------------------------------------------------------------------------------
// Threshold of hearing and loudness
// ---------------------------------------------------------------------------------------------

/**
 * Binaural free-field threshold of hearing for young otologically normal listeners, [Hz, dB SPL]:
 * ISO 226:2003 Table 1 (20 Hz–12.5 kHz), extended with approximate values at 14 and 16 kHz after
 * ISO 389-7:2005 (not checked against the standard's table; treat them as approximate).
 */
export const ISO226_THRESHOLD: readonly (readonly [number, number])[] = [
  [20, 78.5], [25, 68.7], [31.5, 59.5], [40, 51.1], [50, 44.0], [63, 37.5], [80, 31.5], [100, 26.5],
  [125, 22.1], [160, 17.9], [200, 14.4], [250, 11.4], [315, 8.6], [400, 6.2], [500, 4.4], [630, 3.0],
  [800, 2.2], [1000, 2.4], [1250, 3.5], [1600, 1.7], [2000, -1.3], [2500, -4.2], [3150, -6.0],
  [4000, -5.4], [5000, -1.5], [6300, 6.0], [8000, 12.6], [10000, 13.9], [12500, 12.3], [14000, 18.4],
  [16000, 40.2],
];

/**
 * Threshold in quiet, dB SPL, interpolated linearly in log-frequency through `ISO226_THRESHOLD`
 * (valid 20 Hz–16 kHz). Between 16 and 20 kHz the 14→16 kHz slope is extrapolated; outside
 * 20 Hz–20 kHz the result is Infinity (not audible as a tone).
 */
export function hearingThresholdDb(freqHz: number): number {
  const T = ISO226_THRESHOLD;
  if (!(freqHz >= 20 && freqHz <= 20000)) return Infinity;
  for (let i = 1; i < T.length; i++) {
    const [f1, l1] = T[i - 1]!, [f2, l2] = T[i]!;
    if (freqHz <= f2) return l1 + ((l2 - l1) * Math.log10(freqHz / f1)) / Math.log10(f2 / f1);
  }
  const [f1, l1] = T[T.length - 2]!, [f2, l2] = T[T.length - 1]!;
  return l2 + ((l2 - l1) * Math.log10(freqHz / f2)) / Math.log10(f2 / f1);
}

/**
 * Terhardt's analytic approximation of the threshold in quiet, dB SPL (Terhardt 1979, Hear Res 1:155):
 * 3.64 f⁻⁰·⁸ − 6.5 exp(−0.6 (f − 3.3)²) + 10⁻³ f⁴, f in kHz. Within a few dB of ISO 226 from about
 * 100 Hz to 6 kHz; it overestimates the threshold above ≈ 10 kHz.
 */
export function terhardtThresholdDb(freqHz: number): number {
  const f = freqHz / 1000;
  return 3.64 * f ** -0.8 - 6.5 * Math.exp(-0.6 * (f - 3.3) ** 2) + 1e-3 * f ** 4;
}

/**
 * A-frequency weighting, dB (IEC 61672-1): the correction from dB SPL to dBA for a pure tone, which
 * follows the ear's lower sensitivity at low and very high frequencies. 0 dB at 1 kHz, about −19 dB
 * at 100 Hz, +1.2 dB at 2.5 kHz and −2.5 dB at 10 kHz.
 */
export function aWeightingDb(freqHz: number): number {
  const f2 = freqHz * freqHz;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

/** Is a pure tone of `levelDbSpl` at `freqHz` audible to a young normal listener (at or above threshold)? */
export function isAudible(freqHz: number, levelDbSpl: number): boolean {
  return levelDbSpl >= hearingThresholdDb(freqHz);
}

/** Loudness in sones from loudness level in phons (Stevens): S = 2^((P − 40)/10), valid above ≈ 40 phon. */
export const sonesFromPhons = (phons: number): number => 2 ** ((phons - 40) / 10);

// ---------------------------------------------------------------------------------------------
// Outer ear
// ---------------------------------------------------------------------------------------------

/**
 * First resonance of the ear canal as a tube closed at one end by the eardrum (quarter-wave):
 * f = c / (4L), Hz. A 25 mm adult canal at c = 343 m/s gives ≈ 3.4 kHz, the 10–15 dB boost around
 * 2.5–4 kHz in the open-ear gain (Pickles 2012 ch. 2; OpenStax A&P 2e §14.1). `endCorrectionMm`
 * may be added for the open end.
 */
export function earCanalResonance(lengthMm = 25, speedOfSoundMS = 343, endCorrectionMm = 0): number {
  return speedOfSoundMS / (4 * ((lengthMm + endCorrectionMm) / 1000));
}
