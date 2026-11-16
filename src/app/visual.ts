/**
 * How the simulations are drawn: the slowed, exaggerated stand-ins for motions far too fast and
 * small to see (a 1 kHz tone moves the eardrum a thousand times a second, by nanometres). Pure
 * mappings so the scene and the panels agree, unit-tested.
 */

/** Fraction of the audible range, 0 at 20 Hz … 1 at 20 kHz (log scale). */
export const logFraction = (freqHz: number) => Math.min(1, Math.max(0, Math.log10(freqHz / 20) / 3));

/** Frequency shown in the animation, Hz: 0.7 Hz for 20 Hz up to 3 Hz for 20 kHz (higher pitch, faster). */
export const visualHz = (freqHz: number) => 0.7 + 2.3 * logFraction(freqHz);

/** Spacing of the drawn pressure fronts in the ear canal, metres (not to scale: real wavelengths are 1.7 cm–17 m). */
export const ringSpacingM = (freqHz: number) => 0.009 - 0.0055 * logFraction(freqHz);

/** Drawn amplitude, 0.12 … 1, rising with level (dB SPL); 0 when there is no sound. */
export const visualAmplitude = (levelDb: number) => (levelDb <= 0 ? 0.12 : 0.12 + 0.88 * Math.min(1, levelDb / 120));

/** Frequency as text: "250 Hz", "1.0 kHz", "12.5 kHz". */
export function formatHz(freqHz: number): string {
  if (freqHz < 1000) return `${Math.round(freqHz)} Hz`;
  const k = freqHz / 1000;
  return `${k < 10 ? k.toFixed(1) : k.toFixed(k % 1 < 0.05 ? 0 : 1)} kHz`;
}

/** Slider position 0…1000 ↔ frequency on a log scale from 20 Hz to 20 kHz. */
export const freqFromSlider = (v: number) => 20 * 10 ** ((3 * Math.min(1000, Math.max(0, v))) / 1000);
export const sliderFromFreq = (f: number) => Math.round((1000 * Math.log10(Math.min(20000, Math.max(20, f)) / 20)) / 3);

/** Minutes as text: "8 h", "15 min", "28 s". */
export function formatMinutes(min: number): string {
  if (!Number.isFinite(min)) return 'unlimited';
  if (min <= 0) return 'none';
  if (min >= 60 * 24) return 'more than a day';
  if (min >= 60) return `${+(min / 60).toFixed(min >= 600 ? 0 : 1)} h`;
  if (min >= 1) return `${Math.round(min)} min`;
  return `${Math.max(1, Math.round(min * 60))} s`;
}
