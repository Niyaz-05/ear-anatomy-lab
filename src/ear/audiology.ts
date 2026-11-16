/**
 * Clinical audiology for the ear lab: pure-tone audiograms, WHO 2021 grading, type of loss
 * (conductive / sensorineural / mixed), tuning-fork tests derived from the thresholds, eleven
 * teaching cases with generated audiograms, and hearing-aid / cochlear-implant helpers. Pure data
 * and functions; structure ids are those of docs/STRUCTURES.md.
 *
 * Main sources: WHO (2021) World Report on Hearing; British Society of Audiology (2018) Recommended
 * Procedure: Pure-tone air-conduction and bone-conduction threshold audiometry; ISO 7029:2000;
 * Jerger J (1970) Arch Otolaryngol 92:311 (tympanogram types); Scott-Brown's Otorhinolaryngology
 * Head & Neck Surgery, 8th ed. (2018); Pickles JO (2012) An Introduction to the Physiology of
 * Hearing, 4th ed.; NICE TA566 (2019) Cochlear implants for severe to profound deafness.
 */

import { COCHLEA_LENGTH_MM, frequencyAtMmFromBase } from './hearing';

export type Side = 'left' | 'right';

// ---------------------------------------------------------------------------------------------
// Audiogram types
// ---------------------------------------------------------------------------------------------

/** Test frequencies, Hz (BSA 2018): octaves 250–8000 plus the 3 and 6 kHz inter-octaves. */
export const AUDIOGRAM_FREQUENCIES = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000] as const;
export type AudiogramFrequency = (typeof AUDIOGRAM_FREQUENCIES)[number];
/** Bone conduction is tested 250–4000 Hz (transducer output and vibrotactile limits). */
export const BONE_FREQUENCIES = [250, 500, 1000, 2000, 3000, 4000] as const;
export type BoneFrequency = (typeof BONE_FREQUENCIES)[number];
/** Frequencies of the WHO / BSA four-frequency pure-tone average. */
export const PTA_FREQUENCIES = [500, 1000, 2000, 4000] as const;

/** Thresholds of one ear, dB HL. */
export interface EarAudiogram {
  air: Record<AudiogramFrequency, number>;
  bone: Record<BoneFrequency, number>;
}
export interface Audiogram { left: EarAudiogram; right: EarAudiogram }

/** Build an ear from air thresholds (8 values, 250–8000 Hz) and bone thresholds (6 values, 250–4000 Hz; default = air, i.e. sensorineural). */
export function makeEar(air: readonly number[], bone?: readonly number[]): EarAudiogram {
  if (air.length !== AUDIOGRAM_FREQUENCIES.length) throw new RangeError(`need ${AUDIOGRAM_FREQUENCIES.length} air thresholds`);
  if (bone && bone.length !== BONE_FREQUENCIES.length) throw new RangeError(`need ${BONE_FREQUENCIES.length} bone thresholds`);
  const a = {} as Record<AudiogramFrequency, number>, b = {} as Record<BoneFrequency, number>;
  AUDIOGRAM_FREQUENCIES.forEach((f, i) => { a[f] = air[i]!; });
  BONE_FREQUENCIES.forEach((f, i) => { b[f] = bone ? bone[i]! : air[i]!; });
  return { air: a, bone: b };
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Four-frequency pure-tone average (0.5, 1, 2, 4 kHz), dB HL, of the air (default) or bone thresholds. */
export function pta(ear: EarAudiogram, path: 'air' | 'bone' = 'air'): number {
  return mean(PTA_FREQUENCIES.map((f) => (path === 'air' ? ear.air[f] : ear.bone[f])));
}

/** Mean air–bone gap over the PTA frequencies, dB. */
export function airBoneGap(ear: EarAudiogram): number {
  return mean(PTA_FREQUENCIES.map((f) => ear.air[f] - ear.bone[f]));
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

export type HearingGrade = 'normal' | 'mild' | 'moderate' | 'moderately-severe' | 'severe' | 'profound' | 'complete';

/**
 * WHO 2021 grade from a pure-tone average in dB HL (World Report on Hearing, Table 1.1): normal
 * < 20, mild 20–34, moderate 35–49, moderately severe 50–64, severe 65–79, profound 80–94,
 * complete (total) ≥ 95. WHO grades a person by the better ear.
 */
export function classifyDegree(ptaDb: number): { grade: HearingGrade; label: string } {
  if (ptaDb < 20) return { grade: 'normal', label: 'Normal hearing' };
  if (ptaDb < 35) return { grade: 'mild', label: 'Mild hearing loss' };
  if (ptaDb < 50) return { grade: 'moderate', label: 'Moderate hearing loss' };
  if (ptaDb < 65) return { grade: 'moderately-severe', label: 'Moderately severe hearing loss' };
  if (ptaDb < 80) return { grade: 'severe', label: 'Severe hearing loss' };
  if (ptaDb < 95) return { grade: 'profound', label: 'Profound hearing loss' };
  return { grade: 'complete', label: 'Complete or total hearing loss' };
}

export type LossType = 'normal' | 'conductive' | 'sensorineural' | 'mixed';

/** Air–bone gap that counts as a conductive component, dB (BSA practice: ≥ 15 dB). */
export const SIGNIFICANT_GAP_DB = 15;

/**
 * Type of loss in one ear: normal if every air threshold is < 20 dB HL; otherwise conductive when
 * the mean air–bone gap is ≥ 15 dB with normal bone conduction (bone PTA < 20), mixed when there is
 * such a gap and bone conduction is also raised, and sensorineural when there is no significant gap.
 */
export function classifyType(ear: EarAudiogram): LossType {
  if (AUDIOGRAM_FREQUENCIES.every((f) => ear.air[f] < 20)) return 'normal';
  if (airBoneGap(ear) >= SIGNIFICANT_GAP_DB) return pta(ear, 'bone') < 20 ? 'conductive' : 'mixed';
  return 'sensorineural';
}

export interface EarAnalysis {
  ptaAir: number;
  ptaBone: number;
  airBoneGap: number;
  degree: { grade: HearingGrade; label: string };
  type: LossType;
}
export function analyseEar(ear: EarAudiogram): EarAnalysis {
  return { ptaAir: pta(ear), ptaBone: pta(ear, 'bone'), airBoneGap: airBoneGap(ear), degree: classifyDegree(pta(ear)), type: classifyType(ear) };
}

/**
 * Asymmetry of the cochlear (bone-conduction) thresholds: ≥ 15 dB between the ears at two adjacent
 * test frequencies, a common screening rule for retrocochlear pathology prompting an MRI of the
 * internal acoustic meatus (see e.g. Margolis & Saly 2008, Otol Neurotol 29:422).
 */
export function sensorineuralAsymmetry(a: Audiogram, minDiffDb = 15): { asymmetric: boolean; worseEar: Side | null; maxDiffDb: number } {
  const diffs = BONE_FREQUENCIES.map((f) => a.right.bone[f] - a.left.bone[f]);
  let asymmetric = false;
  for (let i = 1; i < diffs.length; i++) {
    const p = diffs[i - 1]!, q = diffs[i]!;
    if (Math.abs(p) >= minDiffDb && Math.abs(q) >= minDiffDb && Math.sign(p) === Math.sign(q)) asymmetric = true;
  }
  const maxDiffDb = Math.max(...diffs.map(Math.abs));
  const worst = diffs.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0);
  return { asymmetric, worseEar: asymmetric ? (worst > 0 ? 'right' : 'left') : null, maxDiffDb };
}

export interface AudiogramAnalysis {
  left: EarAnalysis;
  right: EarAnalysis;
  /** WHO grade of the better ear. */
  betterEarGrade: { grade: HearingGrade; label: string };
  asymmetry: ReturnType<typeof sensorineuralAsymmetry>;
}
export function analyseAudiogram(a: Audiogram): AudiogramAnalysis {
  const left = analyseEar(a.left), right = analyseEar(a.right);
  return { left, right, betterEarGrade: classifyDegree(Math.min(left.ptaAir, right.ptaAir)), asymmetry: sensorineuralAsymmetry(a) };
}

// ---------------------------------------------------------------------------------------------
// Tuning-fork tests (512 Hz), derived from the 500 Hz thresholds
// ---------------------------------------------------------------------------------------------

export interface RinneResult {
  /** What the examiner observes: positive = air conduction heard louder/longer than bone. */
  result: 'positive' | 'negative';
  /** Air–bone gap at 500 Hz in the tested ear, dB. */
  airBoneGapDb: number;
  /** Negative only because bone conduction was heard by the other (better) cochlea. */
  falseNegative: boolean;
  interpretation: string;
}

/**
 * Rinne test at 512 Hz on `ear`. Air conduction is normally heard ≈ 15 dB "better" than bone
 * through the ossicular chain, so the test turns negative (BC > AC) once the air–bone gap at
 * 500 Hz is ≥ 15 dB (reliably ≥ 20–30 dB; Scott-Brown 8e). If the other ear is given, a severe
 * sensorineural loss (air ≥ 65 dB HL at 500 Hz) with a normal opposite cochlea (bone < 20) gives a
 * false-negative Rinne: the mastoid vibration crosses the skull with almost no attenuation and is
 * heard in the good ear (unmasked; Weber and masking reveal it).
 */
export function rinne(ear: EarAudiogram, opposite?: EarAudiogram): RinneResult {
  const gap = ear.air[500] - ear.bone[500];
  if (gap >= SIGNIFICANT_GAP_DB) {
    return { result: 'negative', airBoneGapDb: gap, falseNegative: false, interpretation: `Negative (BC > AC): a conductive component of about ${Math.round(gap)} dB at 500 Hz.` };
  }
  if (opposite && ear.air[500] >= 65 && opposite.bone[500] < 20) {
    return { result: 'negative', airBoneGapDb: gap, falseNegative: true, interpretation: 'False negative: severe sensorineural loss; the bone-conducted sound is heard by the other cochlea. Weber goes to the other ear; masking confirms.' };
  }
  return { result: 'positive', airBoneGapDb: gap, falseNegative: false, interpretation: 'Positive (AC > BC): normal, or a sensorineural loss.' };
}

export interface WeberResult {
  /** Where the midline fork is heard: the ear it lateralises to, or the midline. */
  lateralisesTo: Side | 'midline';
  interpretation: string;
}

/**
 * Weber test at 512 Hz on the vertex/forehead. Each ear's bone-conducted loudness is modelled as
 * its conductive boost (the air–bone gap: occlusion effect and less masking by room noise) minus its
 * cochlear threshold; a difference of ≥ 5 dB lateralises. So the sound goes to the ear with a
 * conductive loss, or away from the ear with a sensorineural loss (Scott-Brown 8e; OpenStax A&P 2e §14.1).
 */
export function weber(left: EarAudiogram, right: EarAudiogram, minDiffDb = 5): WeberResult {
  const score = (e: EarAudiogram) => (e.air[500] - e.bone[500]) - e.bone[500];
  const d = score(right) - score(left);
  if (Math.abs(d) < minDiffDb) return { lateralisesTo: 'midline', interpretation: 'Central: normal hearing or a symmetrical loss.' };
  const to: Side = d > 0 ? 'right' : 'left', away: Side = to === 'right' ? 'left' : 'right';
  const conductive = (to === 'right' ? right : left).air[500] - (to === 'right' ? right : left).bone[500] >= SIGNIFICANT_GAP_DB;
  return {
    lateralisesTo: to,
    interpretation: conductive
      ? `Lateralises to the ${to}: a conductive loss in the ${to} ear (or a sensorineural loss in the ${away}).`
      : `Lateralises to the ${to}: a sensorineural loss in the ${away} ear (or a conductive loss in the ${to}).`,
  };
}

/** Rinne for each ear (with the other as the crossover ear) and Weber, for a whole audiogram. */
export function tuningForkTests(a: Audiogram): { rinne: { left: RinneResult; right: RinneResult }; weber: WeberResult } {
  return { rinne: { left: rinne(a.left, a.right), right: rinne(a.right, a.left) }, weber: weber(a.left, a.right) };
}

// ---------------------------------------------------------------------------------------------
// Audiogram generators
// ---------------------------------------------------------------------------------------------

/** A normal ear used as the unaffected side of unilateral cases, dB HL. */
const NORMAL_AIR = [10, 5, 5, 5, 10, 10, 10, 15];
const NORMAL_BONE = [5, 5, 5, 5, 5, 5];

/** Round to the 5 dB steps of clinical audiometry. */
const step5 = (x: number) => Math.round(x / 5) * 5;

/**
 * Median age-related threshold shift coefficients α (dB per year²), ΔH = α·(age − 18)², in the classic
 * form of ISO 7029:2000 as commonly tabulated (not checked against the standard itself; treat as
 * approximate; the 2017 revision uses a different polynomial).
 */
export const ISO7029_ALPHA: Record<'male' | 'female', Record<AudiogramFrequency, number>> = {
  male: { 250: 0.003, 500: 0.0035, 1000: 0.004, 2000: 0.007, 3000: 0.0115, 4000: 0.016, 6000: 0.018, 8000: 0.022 },
  female: { 250: 0.003, 500: 0.0035, 1000: 0.004, 2000: 0.006, 3000: 0.0075, 4000: 0.009, 6000: 0.012, 8000: 0.015 },
};

/** Median ISO 7029-like threshold shift at an age, dB (0 below 18). */
export function ageShiftDb(age: number, freq: AudiogramFrequency, sex: 'male' | 'female' = 'male'): number {
  return age <= 18 ? 0 : ISO7029_ALPHA[sex][freq] * (age - 18) ** 2;
}

/** Presbycusis: bilateral symmetrical sloping high-frequency sensorineural loss for a median listener of `age`. */
export function presbycusisAudiogram(age = 70, sex: 'male' | 'female' = 'male'): Audiogram {
  const air = AUDIOGRAM_FREQUENCIES.map((f) => step5(ageShiftDb(age, f, sex)));
  return { left: makeEar(air), right: makeEar(air) };
}

/** Noise-induced loss: bilateral notch at 3–6 kHz deepest at 4 kHz, with recovery at 8 kHz (Coles et al. 2000). */
export function noiseNotchAudiogram(notchDepthDb = 55): Audiogram {
  const k = notchDepthDb / 55;
  const air = [10, 10, 10, 15, step5(10 + 30 * k), step5(10 + 45 * k), step5(10 + 35 * k), step5(10 + 15 * k)];
  return { left: makeEar(air), right: makeEar(air) };
}

/** Ménière's disease (right ear): low-frequency sensorineural loss, worse during an attack and partly recovering between attacks. */
export function menieresAudiogram(phase: 'attack' | 'remission' = 'attack'): Audiogram {
  const right = phase === 'attack' ? [55, 50, 40, 30, 25, 25, 25, 30] : [30, 30, 25, 20, 15, 15, 20, 25];
  return { left: makeEar(NORMAL_AIR, NORMAL_BONE), right: makeEar(right) };
}

// ---------------------------------------------------------------------------------------------
// Teaching cases
// ---------------------------------------------------------------------------------------------

/** Tympanogram types (Jerger 1970): A normal, As stiff (otosclerosis), Ad flaccid, B flat (fluid/perforation/occlusion), C negative pressure. */
export type Tympanogram = 'A' | 'As' | 'Ad' | 'B' | 'C';

export type CaseId =
  | 'normal' | 'wax-impaction' | 'acute-otitis-media' | 'otitis-media-effusion' | 'otosclerosis' | 'tm-perforation'
  | 'noise-induced' | 'presbycusis' | 'menieres' | 'vestibular-schwannoma' | 'sudden-snhl';

export interface EarCase {
  id: CaseId;
  name: string;
  /** Expected type of loss in the affected ear(s). */
  category: LossType;
  affectedEar: Side | 'both' | 'none';
  audiogram: Audiogram;
  /** Mesh ids (docs/STRUCTURES.md) of the structures involved. */
  structures: string[];
  description: string;
  /** Symptoms and examination signs. */
  signs: string[];
  tympanogram: { left: Tympanogram; right: Tympanogram };
  /** Word recognition (speech discrimination) at a comfortable level, %. */
  wordRecognitionPct: { left: number; right: number };
  /** Vertigo or imbalance is part of the picture. */
  vestibular: boolean;
  management: string;
  sources: string[];
}

const normalEar = () => makeEar(NORMAL_AIR, NORMAL_BONE);

export const CASES: readonly EarCase[] = [
  {
    id: 'normal', name: 'Normal hearing', category: 'normal', affectedEar: 'none',
    audiogram: { left: normalEar(), right: normalEar() },
    structures: [],
    description: 'All thresholds between −10 and 20 dB HL in both ears, with air and bone conduction together.',
    signs: ['Normal otoscopy', 'Rinne positive both sides', 'Weber central'],
    tympanogram: { left: 'A', right: 'A' }, wordRecognitionPct: { left: 100, right: 100 }, vestibular: false,
    management: 'None needed.',
    sources: ['British Society of Audiology (2018) Recommended Procedure: Pure-tone audiometry', 'WHO (2021) World Report on Hearing'],
  },
  {
    id: 'wax-impaction', name: 'Impacted earwax (cerumen)', category: 'conductive', affectedEar: 'right',
    audiogram: { left: normalEar(), right: makeEar([35, 35, 30, 30, 30, 35, 35, 40], [5, 5, 5, 10, 10, 10]) },
    structures: ['ear-canal-cartilage', 'ear-canal-bone'],
    description: 'Cerumen made in the cartilaginous outer third of the canal has built up and occludes it, blocking the air-conduction route.',
    signs: ['Gradual or sudden muffled hearing, often after showering', 'Aural fullness, sometimes tinnitus or itch', 'Wax obscuring the eardrum on otoscopy'],
    tympanogram: { left: 'A', right: 'B' }, wordRecognitionPct: { left: 100, right: 96 }, vestibular: false,
    management: 'Ear drops to soften the wax, then irrigation or microsuction if it persists; avoid cotton buds.',
    sources: ['NICE NG98 (2018) Hearing loss in adults: assessment and management', 'Schwartz SR et al. (2017) Clinical practice guideline (update): earwax. Otolaryngol Head Neck Surg 156(1S):S1–S29'],
  },
  {
    id: 'acute-otitis-media', name: 'Acute otitis media', category: 'conductive', affectedEar: 'right',
    audiogram: { left: normalEar(), right: makeEar([40, 35, 35, 30, 25, 30, 30, 35], [5, 5, 5, 5, 5, 5]) },
    structures: ['tympanic-membrane', 'tympanic-cavity', 'auditory-tube', 'mastoid-air-cells'],
    description: 'Bacterial or viral infection of the middle ear, usually after a cold blocks the auditory tube; pus under pressure fills the tympanic cavity and damps the eardrum and ossicles.',
    signs: ['Ear pain (otalgia), fever, irritability in children', 'Red, bulging tympanic membrane with loss of the light reflex', 'Possible otorrhoea if the drum perforates'],
    tympanogram: { left: 'A', right: 'B' }, wordRecognitionPct: { left: 100, right: 92 }, vestibular: false,
    management: 'Analgesia; most resolve in about 3 days. Antibiotics (amoxicillin) if systemically unwell, under 2 years with bilateral disease, otorrhoea, or not improving; watch for mastoiditis.',
    sources: ['NICE NG91 (2018) Otitis media (acute): antimicrobial prescribing', 'Lieberthal AS et al. (2013) The diagnosis and management of acute otitis media. Pediatrics 131:e964–e999'],
  },
  {
    id: 'otitis-media-effusion', name: 'Otitis media with effusion (glue ear)', category: 'conductive', affectedEar: 'both',
    audiogram: { left: makeEar([30, 30, 25, 25, 25, 25, 25, 30], [5, 5, 5, 5, 5, 5]), right: makeEar([30, 30, 25, 25, 25, 25, 25, 30], [5, 5, 5, 5, 5, 5]) },
    structures: ['tympanic-cavity', 'auditory-tube', 'tympanic-membrane'],
    description: 'Non-infected fluid in the middle ear behind an intact drum, from poor auditory-tube ventilation; the commonest cause of hearing loss in children.',
    signs: ['No pain; poor attention, speech delay, turning the TV up', 'Dull, retracted drum, sometimes with a fluid level or bubbles', 'Flat (type B) tympanograms'],
    tympanogram: { left: 'B', right: 'B' }, wordRecognitionPct: { left: 96, right: 96 }, vestibular: false,
    management: 'Active observation for 3 months (most clear); hearing aids, or ventilation tubes (grommets) for persistent bilateral loss affecting development; autoinflation.',
    sources: ['NICE CG60 (2008, updated 2023) Otitis media with effusion in under 12s', 'Rosenfeld RM et al. (2016) Clinical practice guideline: otitis media with effusion (update). Otolaryngol Head Neck Surg 154(1S):S1–S41'],
  },
  {
    id: 'otosclerosis', name: 'Otosclerosis', category: 'conductive', affectedEar: 'both',
    audiogram: {
      left: makeEar([30, 30, 25, 25, 25, 25, 30, 30], [5, 5, 5, 20, 10, 5]),
      right: makeEar([50, 50, 45, 40, 40, 40, 45, 45], [5, 5, 10, 25, 15, 10]),
    },
    structures: ['stapes', 'oval-window'],
    description: 'Abnormal bone remodelling of the otic capsule fixes the stapes footplate in the oval window. Bone conduction shows the Carhart notch, a dip greatest at 2 kHz caused by the loss of the ossicular resonance, not by cochlear damage.',
    signs: ['Progressive hearing loss from early adulthood, often bilateral and asymmetric', 'Family history; women more often, may worsen in pregnancy', 'Normal drum (occasionally a pink Schwartze sign); hears better in noise (paracusis Willisii)'],
    tympanogram: { left: 'As', right: 'As' }, wordRecognitionPct: { left: 100, right: 96 }, vestibular: false,
    management: 'Hearing aids, or stapedotomy (a piston prosthesis through the footplate), which also closes the Carhart notch.',
    sources: ['Carhart R (1950) Clinical application of bone conduction audiometry. Arch Otolaryngol 51:798–808', "Scott-Brown's Otorhinolaryngology Head & Neck Surgery, 8th ed. (2018), Otosclerosis"],
  },
  {
    id: 'tm-perforation', name: 'Tympanic membrane perforation', category: 'conductive', affectedEar: 'right',
    audiogram: { left: normalEar(), right: makeEar([30, 30, 25, 20, 20, 25, 30, 30], [5, 5, 5, 5, 5, 5]) },
    structures: ['tympanic-membrane', 'tympanic-cavity'],
    description: 'A hole in the eardrum from infection, trauma or barotrauma reduces the area that drives the ossicles and lets sound reach the round window, so the loss grows with the size of the perforation.',
    signs: ['Sudden pain then relief, with discharge or bleeding after infection or a slap/blast', 'Visible perforation on otoscopy', 'Flat tympanogram with a large ear-canal volume'],
    tympanogram: { left: 'A', right: 'B' }, wordRecognitionPct: { left: 100, right: 96 }, vestibular: false,
    management: 'Most traumatic perforations heal within weeks; keep the ear dry, treat infection. Myringoplasty for persistent perforations.',
    sources: ["Scott-Brown's Otorhinolaryngology Head & Neck Surgery, 8th ed. (2018), Chronic otitis media", 'OpenStax Anatomy & Physiology 2e (2022) §14.1'],
  },
  {
    id: 'noise-induced', name: 'Noise-induced hearing loss', category: 'sensorineural', affectedEar: 'both',
    audiogram: noiseNotchAudiogram(55),
    structures: ['cochlea', 'basilar-membrane', 'scala-media'],
    description: 'Years of loud noise destroy outer hair cells of the organ of Corti, first in the region tuned to 3–6 kHz (helped by the ear-canal resonance), leaving the classic 4 kHz notch with recovery at 8 kHz.',
    signs: ['History of occupational or recreational noise', 'Tinnitus; difficulty hearing speech in noise', 'Bilateral symmetrical notch at 3–6 kHz'],
    tympanogram: { left: 'A', right: 'A' }, wordRecognitionPct: { left: 92, right: 92 }, vestibular: false,
    management: 'Prevention (hearing protection, limiting dose to 85 dBA for 8 h); hearing aids; tinnitus management. The loss is permanent.',
    sources: ['NIOSH (1998) Criteria for a Recommended Standard: Occupational Noise Exposure, Publ. 98-126', 'Coles RRA, Lutman ME, Buffin JT (2000) Guidelines on the diagnosis of noise-induced hearing loss for medicolegal purposes. Clin Otolaryngol 25:264–273'],
  },
  {
    id: 'presbycusis', name: 'Presbycusis (age-related hearing loss)', category: 'sensorineural', affectedEar: 'both',
    audiogram: presbycusisAudiogram(70, 'male'),
    structures: ['cochlea', 'basilar-membrane', 'scala-media', 'cochlear-nerve'],
    description: 'Gradual loss of hair cells (basal turn first), stria vascularis and spiral ganglion neurons with age gives a bilateral symmetrical high-frequency sloping loss.',
    signs: ['Difficulty following speech, especially in noise; consonants (s, f, th) lost', 'Tinnitus', 'Bilateral symmetrical sloping audiogram'],
    tympanogram: { left: 'A', right: 'A' }, wordRecognitionPct: { left: 84, right: 84 }, vestibular: false,
    management: 'Hearing aids and communication tactics; cochlear implant if severe to profound with poor aided speech scores.',
    sources: ['ISO 7029:2000 Acoustics — Statistical distribution of hearing thresholds as a function of age', 'Gates GA, Mills JH (2005) Presbycusis. Lancet 366:1111–1120'],
  },
  {
    id: 'menieres', name: "Ménière's disease", category: 'sensorineural', affectedEar: 'right',
    audiogram: menieresAudiogram('attack'),
    structures: ['scala-media', 'endolymphatic-sac', 'cochlea', 'utricle', 'saccule', 'lateral-canal', 'anterior-canal', 'posterior-canal'],
    description: 'Endolymphatic hydrops: excess endolymph distends the cochlear duct and vestibular labyrinth. Attacks of vertigo come with a fluctuating low-frequency sensorineural loss, tinnitus and aural fullness.',
    signs: ['Episodes of vertigo lasting 20 minutes to 12 hours, with nausea and horizontal nystagmus', 'Fluctuating low-frequency hearing loss, roaring tinnitus, aural fullness in the affected ear', 'Weber to the good ear; Rinne positive'],
    tympanogram: { left: 'A', right: 'A' }, wordRecognitionPct: { left: 100, right: 80 }, vestibular: true,
    management: 'Vestibular sedatives in attacks; low-salt diet, betahistine (weak evidence); intratympanic steroid or gentamicin, endolymphatic sac surgery for refractory vertigo. MRI to exclude a schwannoma.',
    sources: ['Lopez-Escamez JA et al. (2015) Diagnostic criteria for Menière\'s disease. J Vestib Res 25:1–7', 'Basura GJ et al. (2020) Clinical practice guideline: Ménière\'s disease. Otolaryngol Head Neck Surg 162(2S):S1–S55'],
  },
  {
    id: 'vestibular-schwannoma', name: 'Vestibular schwannoma (acoustic neuroma)', category: 'sensorineural', affectedEar: 'right',
    audiogram: { left: normalEar(), right: makeEar([15, 20, 25, 35, 45, 50, 55, 60]) },
    structures: ['vestibular-nerve', 'vestibulocochlear-nerve', 'cochlear-nerve', 'facial-nerve'],
    description: 'A benign tumour of Schwann cells of the vestibular nerve in the internal acoustic meatus and cerebellopontine angle compresses the cochlear nerve: an asymmetric (retrocochlear) loss with speech discrimination worse than the thresholds predict.',
    signs: ['Progressive unilateral hearing loss and unilateral tinnitus', 'Imbalance more than vertigo (slow growth allows compensation)', 'Poor word recognition; large tumours: facial numbness (CN V), facial weakness (CN VII)'],
    tympanogram: { left: 'A', right: 'A' }, wordRecognitionPct: { left: 100, right: 40 }, vestibular: true,
    management: 'Gadolinium-enhanced MRI of the internal acoustic meatus; watch-and-scan for small tumours, stereotactic radiosurgery, or microsurgical removal.',
    sources: ['Carlson ML, Link MJ (2021) Vestibular schwannomas. N Engl J Med 384:1335–1348', 'Margolis RH, Saly GL (2008) Asymmetric hearing loss: definition, validation, and prevalence. Otol Neurotol 29:422–431'],
  },
  {
    id: 'sudden-snhl', name: 'Sudden sensorineural hearing loss', category: 'sensorineural', affectedEar: 'right',
    audiogram: { left: normalEar(), right: makeEar([60, 65, 70, 70, 75, 75, 80, 80]) },
    structures: ['cochlea', 'scala-media', 'cochlear-nerve'],
    description: 'A sensorineural loss of at least 30 dB over three consecutive frequencies developing within 72 hours, usually idiopathic (viral, vascular and immune causes proposed). An otological emergency.',
    signs: ['Sudden one-sided deafness, often noticed on waking or on the phone', 'Tinnitus, aural fullness, sometimes vertigo', 'Normal otoscopy; Weber to the good ear; false-negative Rinne possible'],
    tympanogram: { left: 'A', right: 'A' }, wordRecognitionPct: { left: 100, right: 30 }, vestibular: false,
    management: 'Same-day referral; exclude a conductive cause; corticosteroids (oral or intratympanic) within 2 weeks; MRI to exclude a vestibular schwannoma; hearing aids or CROS if it does not recover.',
    sources: ['Chandrasekhar SS et al. (2019) Clinical practice guideline: sudden hearing loss (update). Otolaryngol Head Neck Surg 161(1S):S1–S45'],
  },
];

/** Look up a teaching case. */
export function getCase(id: CaseId): EarCase {
  const c = CASES.find((k) => k.id === id);
  if (!c) throw new RangeError(`unknown case ${id}`);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Hearing aids and cochlear implants
// ---------------------------------------------------------------------------------------------

/**
 * Lybarger's half-gain rule: prescribed insertion gain ≈ half the hearing threshold at each
 * frequency, dB (Lybarger 1944; modern rules such as NAL-NL2 refine it; Dillon, Hearing Aids, 2012).
 */
export function halfGainRule(ear: EarAudiogram): Record<AudiogramFrequency, number> {
  const out = {} as Record<AudiogramFrequency, number>;
  for (const f of AUDIOGRAM_FREQUENCIES) out[f] = Math.max(0, ear.air[f]) / 2;
  return out;
}

/**
 * NICE TA566 (2019) audiological criteria for cochlear implants: in BOTH ears, hearing only sounds
 * louder than 80 dB HL at two or more of 500, 1000, 2000, 3000 and 4000 Hz without hearing aids,
 * and with well-fitted aids a Bamford–Kowal–Bench sentence score of ≤ 50 % at 70 dB SPL.
 */
export function niceImplantCandidacy(a: Audiogram, bkbSentenceScorePct: number): { eligible: boolean; severeProfoundEars: Side[]; reasons: string[] } {
  const freqs = [500, 1000, 2000, 3000, 4000] as const;
  const severe = (e: EarAudiogram) => freqs.filter((f) => e.air[f] > 80).length >= 2;
  const severeProfoundEars = (['left', 'right'] as const).filter((s) => severe(a[s]));
  const reasons: string[] = [];
  if (severeProfoundEars.length < 2) reasons.push('Not severe to profound (> 80 dB HL at two or more of 0.5–4 kHz) in both ears');
  if (bkbSentenceScorePct > 50) reasons.push('Aided BKB sentence score above 50 %');
  return { eligible: reasons.length === 0, severeProfoundEars: [...severeProfoundEars], reasons };
}

/** Typical electrode counts: MED-EL 12, Advanced Bionics 16, Cochlear 22. */
export const IMPLANT_ELECTRODE_RANGE = { min: 12, max: 22 } as const;

export interface ImplantSpec {
  /** Number of intracochlear electrode contacts, 12–22. */
  electrodeCount: number;
  /** Insertion depth of the tip from the round window, mm (along the organ of Corti). */
  insertionDepthMm: number;
  /** Length of the array carrying the contacts, mm (default 82 % of the insertion depth). */
  activeLengthMm?: number;
  cochleaLengthMm?: number;
  /** Processor analysis range, Hz (log-spaced channels; default 188–7938 Hz). */
  analysisRangeHz?: readonly [number, number];
}

export interface ImplantElectrode {
  /** 1 = most apical contact. */
  index: number;
  mmFromBase: number;
  /** Greenwood characteristic frequency of the place, Hz. */
  placeHz: number;
  /** Centre frequency of the processor channel assigned to it, Hz. */
  assignedHz: number;
  /** log2(assigned/place): negative = the electrode is fed lower frequencies than its place codes. */
  mismatchOctaves: number;
}

/**
 * Electrode positions and the frequencies their places code (Greenwood 1990), with the
 * frequency-to-place mismatch for a standard log-spaced processor map. A 20 mm insertion reaches
 * only the ≈ 1 kHz place, so speech energy below that is shifted up in place, one reason new users
 * report "high-pitched" voices that adapt over months. (Greenwood maps the organ of Corti; the
 * spiral ganglion map is compressed apically; Stakhovskaya et al. 2007, JARO 8:220.)
 */
export function implantCoverage(spec: ImplantSpec): { electrodes: ImplantElectrode[]; lowestPlaceHz: number; highestPlaceHz: number; fractionOfCochlea: number } {
  const n = spec.electrodeCount;
  if (!Number.isInteger(n) || n < IMPLANT_ELECTRODE_RANGE.min || n > IMPLANT_ELECTRODE_RANGE.max) throw new RangeError('electrodeCount must be an integer 12–22');
  const L = spec.cochleaLengthMm ?? COCHLEA_LENGTH_MM;
  const tip = Math.min(Math.max(spec.insertionDepthMm, 0), L);
  const active = Math.min(spec.activeLengthMm ?? 0.82 * tip, tip);
  const [lo, hi] = spec.analysisRangeHz ?? [188, 7938];
  const electrodes: ImplantElectrode[] = [];
  for (let i = 0; i < n; i++) {
    const mm = tip - (active * i) / (n - 1); // i = 0 at the tip (apical)
    const placeHz = frequencyAtMmFromBase(mm, L);
    const assignedHz = lo * (hi / lo) ** ((i + 0.5) / n);
    electrodes.push({ index: i + 1, mmFromBase: mm, placeHz, assignedHz, mismatchOctaves: Math.log2(assignedHz / placeHz) });
  }
  return {
    electrodes,
    lowestPlaceHz: electrodes[0]!.placeHz,
    highestPlaceHz: electrodes[n - 1]!.placeHz,
    fractionOfCochlea: tip / L,
  };
}
