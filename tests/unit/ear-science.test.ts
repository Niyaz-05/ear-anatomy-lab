import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  airToFluidTransmission, earCanalResonance, frequencyAtMmFromBase, greenwood, hearingThresholdDb, isAudible, ISO226_THRESHOLD,
  levelAtDistance, middleEarGain, noiseDose, noiseRisk, pa, placeFromFrequency, safeExposureMinutes, sonesFromPhons, spl, sumLevels,
  terhardtThresholdDb, travelingWave,
} from '../../src/ear/hearing';
import {
  accelerationMimickingTilt, afferentRate, AFFERENT, bppvNystagmusIntensity, canalReadout, canalResponse, canalStimulation, CANAL_IDS, CANALS,
  COPLANAR_PAIRS, createCanalState, dixHallpike, endolymphFlow, epleyManoeuvre, G, gravityInHead, nystagmusStep, nystagmusWaveform, otolith,
  spinStopSimulation, vor, type Vec3,
} from '../../src/ear/balance';
import {
  airBoneGap, analyseAudiogram, AUDIOGRAM_FREQUENCIES, CASES, classifyDegree, classifyType, getCase, halfGainRule, implantCoverage, makeEar,
  menieresAudiogram, niceImplantCandidacy, noiseNotchAudiogram, presbycusisAudiogram, pta, rinne, sensorineuralAsymmetry, tuningForkTests, weber,
  type CaseId,
} from '../../src/ear/audiology';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

// ===============================================================================================
// hearing.ts
// ===============================================================================================

describe('Greenwood frequency–place map (Greenwood 1990)', () => {
  it('gives ≈ 20 Hz at the apex and ≈ 20.7 kHz at the base', () => {
    expect(greenwood(0)).toBeCloseTo(165.4 * 0.12, 6); // 19.85 Hz
    expect(greenwood(0)).toBeGreaterThan(19);
    expect(greenwood(0)).toBeLessThan(21);
    expect(greenwood(1)).toBeGreaterThan(20400);
    expect(greenwood(1)).toBeLessThan(20800);
  });

  it('places 1 kHz about 40 % from the apex (≈ 21 mm from the base of a 35 mm cochlea)', () => {
    const p = placeFromFrequency(1000);
    expect(p.fromApex).toBeCloseTo(0.4, 2);
    expect(p.mmFromBase).toBeGreaterThan(20);
    expect(p.mmFromBase).toBeLessThan(22);
    expect(p.mmFromApex + p.mmFromBase).toBeCloseTo(35, 9);
  });

  it('is monotonic, and the inverse map round-trips', () => {
    let prev = 0;
    for (let x = 0; x <= 1; x += 0.05) {
      const f = greenwood(x);
      expect(f).toBeGreaterThan(prev);
      prev = f;
      expect(placeFromFrequency(f).fromApex).toBeCloseTo(x, 9);
    }
    for (const f of [125, 500, 4000, 8000]) expect(frequencyAtMmFromBase(placeFromFrequency(f).mmFromBase)).toBeCloseTo(f, 6);
  });

  it('puts high frequencies at the base and clamps outside the audible range', () => {
    expect(placeFromFrequency(8000).mmFromBase).toBeLessThan(placeFromFrequency(500).mmFromBase);
    expect(placeFromFrequency(5).fromApex).toBe(0);
    expect(placeFromFrequency(40000).fromApex).toBe(1);
    expect(placeFromFrequency(1000, 32).mmFromBase).toBeCloseTo(0.6 * 32, 0);
  });
});

describe('middle ear transformer', () => {
  it('has an area ratio ≈ 17, lever 1.3, pressure gain ≈ 22 ≈ 27 dB', () => {
    const g = middleEarGain();
    expect(g.areaRatio).toBeCloseTo(55 / 3.2, 9);
    expect(g.areaRatio).toBeGreaterThan(16.5);
    expect(g.areaRatio).toBeLessThan(18);
    expect(g.leverRatio).toBe(1.3);
    expect(g.pressureGain).toBeCloseTo(22.3, 1);
    expect(Math.abs(g.gainDb - 27)).toBeLessThan(1);
  });

  it('is parameterised (no lever → ≈ 25 dB; bigger drum → more gain)', () => {
    expect(middleEarGain({ leverRatio: 1 }).gainDb).toBeCloseTo(20 * Math.log10(55 / 3.2), 9);
    expect(middleEarGain({ tympanicAreaMm2: 85 }).gainDb).toBeGreaterThan(middleEarGain().gainDb);
  });

  it('air-to-fluid transmission is ≈ 0.1 % (≈ −30 dB), which the middle-ear gain largely recovers', () => {
    const t = airToFluidTransmission();
    expect(t.transmittedFraction).toBeGreaterThan(0.0009);
    expect(t.transmittedFraction).toBeLessThan(0.0013);
    expect(t.lossDb).toBeCloseTo(-29.5, 0);
  });
});

describe('travelling wave', () => {
  it('peaks at the Greenwood place, normalised to 1', () => {
    for (const f of [250, 1000, 4000]) {
      const w = travelingWave(f, 0, 351);
      expect(w.peakMmFromBase).toBeCloseTo(placeFromFrequency(f).mmFromBase, 9);
      const iMax = w.envelope.indexOf(Math.max(...w.envelope));
      expect(Math.abs(w.mmFromBase[iMax]! - w.peakMmFromBase)).toBeLessThan(0.2);
      expect(Math.max(...w.envelope)).toBeLessThanOrEqual(1);
      expect(Math.max(...w.envelope)).toBeGreaterThan(0.99);
      expect(Math.abs(w.peakIndex - iMax)).toBeLessThanOrEqual(1);
    }
  });

  it('builds up slowly on the basal side and cuts off sharply on the apical side', () => {
    const w = travelingWave(1000, 0, 351);
    const at = (mm: number) => w.envelope[Math.round((mm / 35) * 350)]!;
    const p = w.peakMmFromBase;
    expect(at(p - 3)).toBeGreaterThan(0.8); // 3 mm basal: still large
    expect(at(p + 3)).toBeLessThan(0.05); // 3 mm apical: nearly gone
    expect(w.envelope[350]!).toBeLessThan(1e-6);
  });

  it('accumulates phase towards the apex and stays within ±1', () => {
    const w = travelingWave(1000, 0.00037, 200);
    for (let i = 1; i < w.phaseRad.length; i++) expect(w.phaseRad[i]!).toBeGreaterThan(w.phaseRad[i - 1]!);
    expect(w.phaseRad[w.peakIndex]!).toBeCloseTo(2 * Math.PI * 2.5, 0);
    for (let i = 0; i < w.displacement.length; i++) expect(Math.abs(w.displacement[i]!)).toBeLessThanOrEqual(w.envelope[i]! + 1e-12);
    // Moves with time: a quarter period later the shape differs.
    expect(travelingWave(1000, 0.00025, 200).displacement).not.toEqual(travelingWave(1000, 0, 200).displacement);
  });
});

describe('sound levels', () => {
  it('converts pressure and dB SPL (20 µPa reference)', () => {
    expect(spl(20e-6)).toBeCloseTo(0, 9);
    expect(spl(1)).toBeCloseTo(93.98, 2);
    expect(spl(20)).toBeCloseTo(120, 9);
    expect(pa(94)).toBeCloseTo(1.0024, 3);
    for (const L of [0, 40, 85, 130]) expect(spl(pa(L))).toBeCloseTo(L, 9);
  });

  it('adds incoherent levels and falls off 6 dB per doubling of distance', () => {
    expect(sumLevels([80, 80])).toBeCloseTo(83.01, 2);
    expect(sumLevels([90, 80])).toBeCloseTo(90.41, 2);
    expect(sumLevels(Array(10).fill(70))).toBeCloseTo(80, 9);
    expect(sumLevels([])).toBe(-Infinity);
    expect(levelAtDistance(100, 1, 2)).toBeCloseTo(93.98, 2);
    expect(levelAtDistance(100, 1, 10)).toBeCloseTo(80, 9);
  });
});

describe('noise exposure (NIOSH 1998)', () => {
  it('allows 480 min at 85 dBA, halving every 3 dB', () => {
    expect(safeExposureMinutes(85)).toBeCloseTo(480, 9);
    expect(safeExposureMinutes(88)).toBeCloseTo(240, 9);
    expect(safeExposureMinutes(94)).toBeCloseTo(60, 9);
    expect(safeExposureMinutes(100)).toBeCloseTo(15, 9);
    expect(safeExposureMinutes(82)).toBeCloseTo(960, 9);
    expect(safeExposureMinutes(140)).toBe(0);
  });

  it('computes the daily dose and risk bands', () => {
    expect(noiseDose([{ dBA: 85, minutes: 480 }])).toBeCloseTo(100, 9);
    expect(noiseDose([{ dBA: 88, minutes: 120 }, { dBA: 85, minutes: 240 }])).toBeCloseTo(100, 9);
    expect(noiseRisk(60).risk).toBe('safe');
    expect(noiseRisk(80).risk).toBe('caution');
    expect(noiseRisk(85).risk).toBe('hazardous');
    expect(noiseRisk(105).risk).toBe('dangerous');
    expect(noiseRisk(125).risk).toBe('immediate-harm');
    expect(noiseRisk(100).safeMinutes).toBeCloseTo(15, 9);
  });
});

describe('threshold of hearing (ISO 226) and the ear canal', () => {
  it('matches the ISO 226 table at its nodes and is lowest near 3–4 kHz', () => {
    for (const [f, l] of ISO226_THRESHOLD) expect(hearingThresholdDb(f)).toBeCloseTo(l, 9);
    expect(hearingThresholdDb(1000)).toBeCloseTo(2.4, 9);
    let minF = 0, min = Infinity;
    for (let f = 20; f <= 16000; f *= 1.02) if (hearingThresholdDb(f) < min) { min = hearingThresholdDb(f); minF = f; }
    expect(minF).toBeGreaterThan(2800);
    expect(minF).toBeLessThan(4200);
    expect(min).toBeLessThan(-5);
  });

  it('decides audibility (20 Hz needs ≈ 79 dB, outside 20 Hz–20 kHz never)', () => {
    expect(isAudible(1000, 10)).toBe(true);
    expect(isAudible(1000, 0)).toBe(false);
    expect(isAudible(20, 70)).toBe(false);
    expect(isAudible(20, 80)).toBe(true);
    expect(isAudible(3150, -5)).toBe(true);
    expect(isAudible(10, 140)).toBe(false);
    expect(isAudible(25000, 140)).toBe(false);
    expect(hearingThresholdDb(18000)).toBeGreaterThan(hearingThresholdDb(16000));
  });

  it("Terhardt's fit stays within 6 dB of ISO 226 from 100 Hz to 6.3 kHz", () => {
    for (const [f, l] of ISO226_THRESHOLD) if (f >= 100 && f <= 6300) expect(Math.abs(terhardtThresholdDb(f) - l)).toBeLessThan(6);
  });

  it('loudness doubles per 10 phon', () => {
    expect(sonesFromPhons(40)).toBe(1);
    expect(sonesFromPhons(60)).toBe(4);
  });

  it('has a quarter-wave canal resonance ≈ 3.4 kHz for 25 mm', () => {
    expect(earCanalResonance()).toBeCloseTo(3430, 0);
    expect(Math.abs(earCanalResonance() - 3400)).toBeLessThan(100);
    expect(earCanalResonance(30)).toBeLessThan(earCanalResonance(25));
  });
});

// ===============================================================================================
// balance.ts
// ===============================================================================================

describe('semicircular canal geometry', () => {
  it('has unit normals; the lateral canal is pitched 30° and the vertical canals are at 45° to the sagittal plane', () => {
    for (const id of CANAL_IDS) expect(len(CANALS[id].normal)).toBeCloseTo(1, 12);
    const lat = CANALS['left-lateral'].normal;
    expect((Math.acos(Math.abs(lat.y)) * 180) / Math.PI).toBeCloseTo(30, 9); // normal tilted 30° from vertical
    expect(lat.z).toBeLessThan(0); // plane rises anteriorly
    for (const id of ['left-anterior', 'left-posterior', 'right-anterior', 'right-posterior'] as const) {
      const n = CANALS[id].normal;
      // Angle between the canal plane and the sagittal plane (normal x) = angle between normals.
      expect((Math.acos(Math.abs(n.x)) * 180) / Math.PI).toBeCloseTo(45, 9);
    }
  });

  it('pitching the head 30° nose down makes the lateral canals earth-horizontal and the vertical canals vertical', () => {
    const t = Math.PI / 6;
    // Express a head-frame vector in the earth frame after a nose-down pitch of 30°.
    const pitchDown = (n: Vec3): Vec3 => v(n.x, n.y * Math.cos(t) - n.z * Math.sin(t), n.y * Math.sin(t) + n.z * Math.cos(t));
    expect(pitchDown(CANALS['left-lateral'].normal).y).toBeCloseTo(1, 12);
    for (const id of ['left-anterior', 'left-posterior', 'right-anterior', 'right-posterior'] as const) expect(pitchDown(CANALS[id].normal).y).toBeCloseTo(0, 12);
  });

  it('forms three coplanar pairs whose normals are antiparallel (push–pull), mutually orthogonal pairs', () => {
    expect(COPLANAR_PAIRS.map((p) => p.name)).toEqual(['lateral', 'LARP', 'RALP']);
    for (const p of COPLANAR_PAIRS) expect(dot(CANALS[p.canals[0]].normal, CANALS[p.canals[1]].normal)).toBeCloseTo(-1, 12);
    const [a, b, c] = COPLANAR_PAIRS.map((p) => CANALS[p.canals[0]].normal) as [Vec3, Vec3, Vec3];
    expect(dot(a, b)).toBeCloseTo(0, 12);
    expect(dot(a, c)).toBeCloseTo(0, 12);
    expect(dot(b, c)).toBeCloseTo(0, 12);
  });

  it('maps canals to structure and ampulla ids', () => {
    expect(CANALS['right-posterior'].structureId).toBe('posterior-canal');
    expect(CANALS['left-lateral'].ampullaId).toBe('lateral-ampulla');
  });
});

describe("canal stimulation and Ewald's laws", () => {
  it('yaw to the left excites the left lateral canal and inhibits the right', () => {
    const s = canalStimulation(v(0, 100, 0));
    expect(s['left-lateral']).toBeGreaterThan(0);
    expect(s['right-lateral']).toBeLessThan(0);
    expect(s['left-lateral']).toBeCloseTo(100 * Math.cos(Math.PI / 6), 9);
  });

  it('nose-down pitch excites both anterior canals; nose-up both posterior canals', () => {
    const down = canalStimulation(v(-100, 0, 0)), up = canalStimulation(v(100, 0, 0));
    expect(down['left-anterior']).toBeGreaterThan(0);
    expect(down['right-anterior']).toBeGreaterThan(0);
    expect(down['left-posterior']).toBeLessThan(0);
    expect(up['left-posterior']).toBeGreaterThan(0);
    expect(up['right-posterior']).toBeGreaterThan(0);
  });

  it('right-ear-down roll excites the right anterior and right posterior canals', () => {
    const s = canalStimulation(v(0, 0, 100));
    expect(s['right-anterior']).toBeGreaterThan(0);
    expect(s['right-posterior']).toBeGreaterThan(0);
    expect(s['left-anterior']).toBeLessThan(0);
    expect(s['left-posterior']).toBeLessThan(0);
  });

  it('first law (flow): ampullopetal excites the lateral canal, ampullofugal the vertical canals', () => {
    expect(CANALS['left-lateral'].excitatoryFlow).toBe('ampullopetal');
    expect(CANALS['left-posterior'].excitatoryFlow).toBe('ampullofugal');
    expect(endolymphFlow('lateral', 10)).toBe('ampullopetal');
    expect(endolymphFlow('lateral', -10)).toBe('ampullofugal');
    expect(endolymphFlow('anterior', 10)).toBe('ampullofugal');
    expect(endolymphFlow('posterior', -10)).toBe('ampullopetal');
    expect(endolymphFlow('posterior', 0)).toBeNull();
  });

  it('second law: excitation outlasts inhibition (rest 90, floor 0, ceiling ≈ 400 spikes/s)', () => {
    expect(afferentRate(0)).toBe(AFFERENT.restingHz);
    expect(afferentRate(1)).toBeCloseTo(90.5, 2);
    expect(afferentRate(-1)).toBeCloseTo(89.5, 2);
    expect(afferentRate(-1000)).toBeGreaterThanOrEqual(0);
    expect(afferentRate(-1000)).toBeLessThan(1);
    expect(afferentRate(10000)).toBeGreaterThan(395);
    expect(afferentRate(10000)).toBeLessThanOrEqual(400);
    for (const w of [100, 200, 400]) expect(afferentRate(w) - 90).toBeGreaterThan(90 - afferentRate(-w));
  });

  it('canal readout gives flow, sign and firing for each canal', () => {
    // Rotation about the lateral-canal axis (yaw with the head pitched 30° down) leaves the vertical canals at rest.
    const n = CANALS['left-lateral'].normal;
    const r = canalReadout(v(100 * n.x, 100 * n.y, 100 * n.z));
    expect(r['left-lateral'].stimulation).toBeCloseTo(100, 9);
    expect(r['left-lateral'].excitatory).toBe(true);
    expect(r['left-lateral'].flow).toBe('ampullopetal');
    expect(r['right-lateral'].flow).toBe('ampullofugal');
    expect(r['left-lateral'].firingRate).toBeGreaterThan(90);
    expect(r['right-lateral'].firingRate).toBeLessThan(90);
    expect(r['left-anterior'].excitatory).toBeNull();
  });
});

describe('cupula dynamics', () => {
  it('a step of velocity is transduced at once, then decays with τ ≈ 6 s', () => {
    const dt = 0.01, step = Array(Math.round(0.1 / dt)).fill(v(0, 100, 0));
    const early = canalResponse(step, dt);
    expect(early.state.cupula.y).toBeCloseTo(100 * Math.exp(-0.1 / 6), 0);
    const six = canalResponse(Array(600).fill(v(0, 100, 0)), dt);
    expect(six.state.cupula.y / 100).toBeCloseTo(Math.exp(-1), 2);
    expect(six.canals['left-lateral'].stimulation).toBeCloseTo(six.state.cupula.y * Math.cos(Math.PI / 6), 9);
  });

  it('steady rotation is not signalled; stopping it deflects the cupula the other way', () => {
    const spinning = createCanalState(v(0, 100, 0));
    const r = canalResponse([v(0, 100, 0)], 0.01, spinning);
    expect(Math.abs(r.state.cupula.y)).toBeLessThan(1e-9);
    const stop = canalResponse(Array(10).fill(v(0, 0, 0)), 0.01, spinning);
    expect(stop.state.cupula.y).toBeLessThan(-95);
    expect(stop.canals['left-lateral'].excitatory).toBe(false);
    expect(stop.canals['right-lateral'].excitatory).toBe(true);
  });
});

describe('spin and stop with velocity storage', () => {
  const sim = spinStopSimulation({ omegaDegS: 100, spinS: 60, afterS: 60, dtS: 0.01 });
  const at = (t: number) => sim.samples[Math.round(t / 0.01)]!;

  it('the cupula decays with τ ≈ 6 s, perception with τ ≈ 16 s', () => {
    expect(at(6).cupula / 100).toBeCloseTo(Math.exp(-1), 1);
    expect(at(16).perceived / 100).toBeCloseTo(Math.exp(-1), 1);
    expect(at(16).perceived).toBeGreaterThan(at(16).cupula); // storage extends the response
    expect(Math.abs(at(59.9).cupula)).toBeLessThan(1);
  });

  it('after the stop the cupula, perception and nystagmus reverse and decay', () => {
    const T = sim.stopTimeS;
    expect(at(T + 0.05).cupula).toBeLessThan(-95);
    expect(at(T + 6).cupula / at(T + 0.05).cupula).toBeCloseTo(Math.exp(-1), 1);
    expect(at(T + 0.05).perceived).toBeLessThan(-90);
    expect(at(T + 16).perceived / at(T + 0.05).perceived).toBeCloseTo(Math.exp(-1), 1);
    // Per-rotatory slow phase opposite to the turn; post-rotatory in the direction of the turn.
    expect(at(1).slowPhaseVelocity).toBeLessThan(0);
    expect(at(T + 1).slowPhaseVelocity).toBeGreaterThan(0);
    // Left lateral canal excited during the left turn, inhibited after the stop.
    expect(at(1).leftLateralRate).toBeGreaterThan(90);
    expect(at(T + 1).leftLateralRate).toBeLessThan(90);
    expect(at(T + 1).rightLateralRate).toBeGreaterThan(90);
    expect(at(T + 1).phase).toBe('post-rotatory');
  });
});

describe('otolith organs', () => {
  it('upright and still: the saccule carries 1 g, the utricle no shear, all populations at rest', () => {
    const o = otolith();
    expect(o.gia.y).toBeCloseTo(G, 9);
    expect(o.utricle.magnitude).toBeCloseTo(0, 9);
    expect(o.saccule.magnitude).toBeCloseTo(G, 9);
    expect(o.apparentTiltDeg).toBeCloseTo(0, 9);
    expect(o.firing.utricleRight).toBe(60);
  });

  it('a 30° right-ear-down tilt shears the utricle by g·sin 30° and reads 30° of tilt', () => {
    const o = otolith(gravityInHead(0, 30));
    expect(o.utricle.magnitude).toBeCloseTo(G * 0.5, 9);
    expect(o.apparentTiltDeg).toBeCloseTo(30, 9);
    expect(o.firing.utricleLeft).toBeGreaterThan(60);
    expect(o.firing.utricleRight).toBeLessThan(60);
    expect(len(gravityInHead(25, -40))).toBeCloseTo(G, 9);
  });

  it('tilt–translation ambiguity: forward acceleration g·sin θ mimics nose-up pitch θ in the utricle', () => {
    const tilt = otolith(gravityInHead(20, 0));
    const accel = otolith(undefined, v(0, 0, accelerationMimickingTilt(20)));
    expect(accel.utricle.z).toBeCloseTo(tilt.utricle.z, 9);
    expect(accel.utricle.x).toBeCloseTo(tilt.utricle.x, 9);
    expect(accel.firing.utricleForward).toBeCloseTo(tilt.firing.utricleForward, 9);
    expect(accel.apparentTiltDeg).toBeGreaterThan(18); // perceived as pitch up (somatogravic illusion)
  });
});

describe('VOR and nystagmus', () => {
  it('the eyes counter-rotate with gain ≈ 1 (torsion lower)', () => {
    const e = vor(v(10, 100, 50));
    expect(e.y).toBe(-100);
    expect(e.x).toBe(-10);
    expect(e.z).toBeCloseTo(-30, 9);
  });

  it('jerk nystagmus: slow drift at the SPV, fast reset beating the other way', () => {
    const w = nystagmusWaveform(20, 0.1);
    expect(w.phase).toBe('slow');
    expect(w.fastPhaseSign).toBe(-1);
    expect(w.positionDeg).toBeCloseTo(-5 + 2, 9);
    expect(nystagmusWaveform(20, 0.51).phase).toBe('fast');
    expect(nystagmusWaveform(0, 1).phase).toBe('none');
    let s = { positionDeg: 0, fast: false }, resets = 0, wasFast = false;
    for (let i = 0; i < 300; i++) {
      s = nystagmusStep(s, 20, 0.01);
      expect(Math.abs(s.positionDeg)).toBeLessThanOrEqual(5 + 1e-9);
      if (s.fast && !wasFast) resets++;
      wasFast = s.fast;
    }
    expect(resets).toBeGreaterThanOrEqual(5);
  });
});

describe('BPPV (posterior-canal canalithiasis)', () => {
  it('Dix–Hallpike is positive only towards the affected ear, with the textbook nystagmus', () => {
    const pos = dixHallpike('right', 'right');
    expect(pos.provoked).toBe(true);
    expect(pos.latencyS!.min).toBeGreaterThanOrEqual(1);
    expect(pos.latencyS!.max).toBeLessThanOrEqual(5);
    expect(pos.durationS!.max).toBeLessThanOrEqual(60);
    expect(pos.nystagmus!.vertical).toBe('upbeating');
    expect(pos.nystagmus!.torsionalToward).toBe('right');
    expect(pos.reversesOnSittingUp).toBe(true);
    expect(pos.fatigable).toBe(true);
    expect(dixHallpike('left', 'right').provoked).toBe(false);
    expect(dixHallpike('left', null).provoked).toBe(false);
    expect(dixHallpike('left', 'left').nystagmus!.torsionalToward).toBe('left');
  });

  it('the nystagmus starts after the latency, peaks and is over within a minute', () => {
    expect(bppvNystagmusIntensity(2)).toBe(0);
    expect(bppvNystagmusIntensity(9)).toBeCloseTo(1, 9);
    expect(bppvNystagmusIntensity(60)).toBeLessThan(0.02);
  });

  it('the Epley manoeuvre has five 90°-step positions moving the otoconia into the utricle', () => {
    const steps = epleyManoeuvre('right');
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.length).toBeLessThanOrEqual(5);
    expect(steps[0]!.headYawOnTrunkDeg).toBe(45);
    expect(steps[1]!.posture).toBe('supine');
    expect(steps[1]!.headPitchDeg).toBeGreaterThanOrEqual(20);
    expect(steps[1]!.headPitchDeg).toBeLessThanOrEqual(30);
    const face = steps.map((s) => s.faceFromCeilingDeg).filter((f): f is number => f !== null);
    expect(face).toEqual([45, -45, -135]);
    for (let i = 1; i < face.length; i++) expect(Math.abs(face[i]! - face[i - 1]!)).toBe(90);
    expect(steps[3]!.lyingOn).toBe('left');
    expect(steps[4]!.posture).toBe('sitting');
    expect(steps[4]!.otoconia.region).toBe('utricle');
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.otoconia.fractionAlongCanal).toBeGreaterThan(steps[i - 1]!.otoconia.fractionAlongCanal);
    for (const s of steps.slice(1, 4)) expect(s.holdSeconds).toBeGreaterThanOrEqual(20);
  });

  it('mirrors for the left ear', () => {
    const l = epleyManoeuvre('left');
    expect(l[0]!.headYawOnTrunkDeg).toBe(-45);
    expect(l[3]!.lyingOn).toBe('right');
    expect(l[3]!.faceFromCeilingDeg).toBe(135);
  });
});

// ===============================================================================================
// audiology.ts
// ===============================================================================================

describe('audiogram grading (WHO 2021)', () => {
  it('grades the PTA at the published boundaries', () => {
    const cases: [number, string][] = [
      [19.9, 'normal'], [20, 'mild'], [34.9, 'mild'], [35, 'moderate'], [49, 'moderate'], [50, 'moderately-severe'],
      [64, 'moderately-severe'], [65, 'severe'], [79, 'severe'], [80, 'profound'], [94, 'profound'], [95, 'complete'], [120, 'complete'],
    ];
    for (const [db, grade] of cases) expect(classifyDegree(db).grade).toBe(grade);
  });

  it('PTA is the mean of 0.5, 1, 2 and 4 kHz', () => {
    const e = makeEar([100, 10, 20, 30, 100, 40, 100, 100], [0, 0, 0, 0, 0, 0]);
    expect(pta(e)).toBe(25);
    expect(pta(e, 'bone')).toBe(0);
    expect(airBoneGap(e)).toBe(25);
  });

  it('classifies conductive, sensorineural and mixed losses', () => {
    expect(classifyType(makeEar([40, 40, 40, 40, 40, 40, 40, 40], [5, 5, 5, 5, 5, 5]))).toBe('conductive');
    expect(classifyType(makeEar([40, 40, 40, 40, 40, 40, 40, 40]))).toBe('sensorineural');
    expect(classifyType(makeEar([70, 70, 70, 70, 70, 70, 70, 70], [40, 40, 40, 40, 40, 40]))).toBe('mixed');
    expect(classifyType(makeEar([10, 10, 10, 10, 15, 10, 10, 15], [5, 5, 5, 5, 5, 5]))).toBe('normal');
    expect(classifyType(makeEar([30, 30, 30, 30, 30, 30, 30, 30], [20, 20, 20, 20, 20, 20]))).toBe('sensorineural'); // gap 10 < 15
  });

  it('rejects malformed ears', () => {
    expect(() => makeEar([10, 10])).toThrow(RangeError);
    expect(() => makeEar(Array(8).fill(10), [1])).toThrow(RangeError);
  });
});

describe('tuning-fork tests derived from thresholds', () => {
  it('Rinne: positive normally and in SNHL, negative with an air–bone gap ≥ 15 dB', () => {
    const normal = makeEar([10, 5, 5, 5, 10, 10, 10, 15], [5, 5, 5, 5, 5, 5]);
    expect(rinne(normal).result).toBe('positive');
    expect(rinne(makeEar(Array(8).fill(40))).result).toBe('positive');
    expect(rinne(makeEar(Array(8).fill(30), [5, 5, 5, 5, 5, 5])).result).toBe('negative');
    expect(rinne(makeEar(Array(8).fill(15), [5, 5, 5, 5, 5, 5])).result).toBe('positive'); // gap 10
  });

  it('Rinne is falsely negative in a severe unilateral SNHL (heard by the other cochlea)', () => {
    const dead = makeEar(Array(8).fill(90)), good = makeEar([10, 5, 5, 5, 10, 10, 10, 15], [5, 5, 5, 5, 5, 5]);
    const r = rinne(dead, good);
    expect(r.result).toBe('negative');
    expect(r.falseNegative).toBe(true);
    expect(rinne(dead).result).toBe('positive'); // with the other ear masked
  });

  it('Weber goes to the conductive ear and away from the sensorineural ear', () => {
    const good = makeEar([10, 5, 5, 5, 10, 10, 10, 15], [5, 5, 5, 5, 5, 5]);
    const cond = makeEar(Array(8).fill(35), [5, 5, 5, 5, 5, 5]);
    const sn = makeEar(Array(8).fill(50));
    expect(weber(good, cond).lateralisesTo).toBe('right');
    expect(weber(cond, good).lateralisesTo).toBe('left');
    expect(weber(good, sn).lateralisesTo).toBe('left');
    expect(weber(sn, good).lateralisesTo).toBe('right');
    expect(weber(good, good).lateralisesTo).toBe('midline');
    expect(weber(cond, cond).lateralisesTo).toBe('midline');
  });
});

describe('teaching cases', () => {
  const structureIds = new Set(
    [...readFileSync(fileURLToPath(new URL('../../docs/STRUCTURES.md', import.meta.url)), 'utf8').matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]!),
  );

  it('has the eleven cases, each with ids from STRUCTURES.md, description, signs, management and sources', () => {
    const ids: CaseId[] = ['normal', 'wax-impaction', 'acute-otitis-media', 'otitis-media-effusion', 'otosclerosis', 'tm-perforation', 'noise-induced', 'presbycusis', 'menieres', 'vestibular-schwannoma', 'sudden-snhl'];
    expect(CASES.map((c) => c.id)).toEqual(ids);
    for (const c of CASES) {
      for (const s of c.structures) expect(structureIds.has(s), `${c.id}: ${s}`).toBe(true);
      if (c.id !== 'normal') expect(c.structures.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(40);
      expect(c.signs.length).toBeGreaterThanOrEqual(2);
      expect(c.management.length).toBeGreaterThan(10);
      expect(c.sources.length).toBeGreaterThanOrEqual(1);
      for (const f of AUDIOGRAM_FREQUENCIES) for (const side of ['left', 'right'] as const) {
        const t = c.audiogram[side].air[f];
        expect(t).toBeGreaterThanOrEqual(-10);
        expect(t).toBeLessThanOrEqual(120);
      }
    }
    expect(() => getCase('nope' as CaseId)).toThrow();
  });

  it('classifies each affected ear as its stated category', () => {
    for (const c of CASES) {
      const a = analyseAudiogram(c.audiogram);
      const ears = c.affectedEar === 'both' || c.affectedEar === 'none' ? (['left', 'right'] as const) : [c.affectedEar];
      for (const e of ears) expect(a[e].type, `${c.id} ${e}`).toBe(c.category);
      if (c.affectedEar === 'left' || c.affectedEar === 'right') {
        const other = c.affectedEar === 'left' ? 'right' : 'left';
        expect(a[other].type, `${c.id} other ear`).toBe('normal');
      }
    }
  });

  it('gives the expected Rinne and Weber for every case', () => {
    const expected: Record<CaseId, { rinneL: 'positive' | 'negative'; rinneR: 'positive' | 'negative'; weber: 'left' | 'right' | 'midline'; falseNegR?: boolean }> = {
      'normal': { rinneL: 'positive', rinneR: 'positive', weber: 'midline' },
      'wax-impaction': { rinneL: 'positive', rinneR: 'negative', weber: 'right' },
      'acute-otitis-media': { rinneL: 'positive', rinneR: 'negative', weber: 'right' },
      'otitis-media-effusion': { rinneL: 'negative', rinneR: 'negative', weber: 'midline' },
      'otosclerosis': { rinneL: 'negative', rinneR: 'negative', weber: 'right' },
      'tm-perforation': { rinneL: 'positive', rinneR: 'negative', weber: 'right' },
      'noise-induced': { rinneL: 'positive', rinneR: 'positive', weber: 'midline' },
      'presbycusis': { rinneL: 'positive', rinneR: 'positive', weber: 'midline' },
      'menieres': { rinneL: 'positive', rinneR: 'positive', weber: 'left' },
      'vestibular-schwannoma': { rinneL: 'positive', rinneR: 'positive', weber: 'left' },
      'sudden-snhl': { rinneL: 'positive', rinneR: 'negative', weber: 'left', falseNegR: true },
    };
    for (const c of CASES) {
      const t = tuningForkTests(c.audiogram), e = expected[c.id];
      expect(t.rinne.left.result, `${c.id} Rinne L`).toBe(e.rinneL);
      expect(t.rinne.right.result, `${c.id} Rinne R`).toBe(e.rinneR);
      expect(t.weber.lateralisesTo, `${c.id} Weber`).toBe(e.weber);
      expect(t.rinne.right.falseNegative, `${c.id} false negative`).toBe(e.falseNegR ?? false);
    }
  });

  it('case-specific features: Carhart notch, 4 kHz notch, sloping presbycusis, low-frequency Ménière, asymmetric schwannoma', () => {
    const oto = getCase('otosclerosis').audiogram.right.bone;
    expect(oto[2000]).toBeGreaterThan(Math.max(oto[500], oto[1000], oto[4000]));
    const nihl = getCase('noise-induced').audiogram.left.air;
    expect(nihl[4000]).toBeGreaterThan(nihl[2000] + 20);
    expect(nihl[4000]).toBeGreaterThan(nihl[8000] + 20); // recovery at 8 kHz
    const pres = getCase('presbycusis').audiogram.right.air;
    for (let i = 1; i < AUDIOGRAM_FREQUENCIES.length; i++) expect(pres[AUDIOGRAM_FREQUENCIES[i]!]).toBeGreaterThanOrEqual(pres[AUDIOGRAM_FREQUENCIES[i - 1]!]);
    const men = getCase('menieres').audiogram.right.air;
    expect(men[250]).toBeGreaterThan(men[4000]);
    const vs = getCase('vestibular-schwannoma');
    expect(analyseAudiogram(vs.audiogram).asymmetry).toMatchObject({ asymmetric: true, worseEar: 'right' });
    expect(vs.wordRecognitionPct.right).toBeLessThan(60);
    expect(sensorineuralAsymmetry(getCase('otosclerosis').audiogram).asymmetric).toBe(false);
    expect(sensorineuralAsymmetry(getCase('presbycusis').audiogram).asymmetric).toBe(false);
    expect(analyseAudiogram(getCase('sudden-snhl').audiogram).right.degree.grade).toBe('severe');
    expect(getCase('otitis-media-effusion').tympanogram.left).toBe('B');
    expect(getCase('otosclerosis').tympanogram.right).toBe('As');
    expect(getCase('menieres').vestibular).toBe(true);
  });

  it('generators: presbycusis worsens with age and is worse in men; Ménière fluctuates; notch scales', () => {
    expect(pta(presbycusisAudiogram(80).left)).toBeGreaterThan(pta(presbycusisAudiogram(60).left));
    expect(presbycusisAudiogram(70, 'male').left.air[4000]).toBeGreaterThan(presbycusisAudiogram(70, 'female').left.air[4000]);
    expect(pta(presbycusisAudiogram(18).left)).toBe(0);
    expect(presbycusisAudiogram(70).left.air[4000]).toBe(45); // 0.016 × 52² = 43 → 45 dB
    expect(pta(menieresAudiogram('remission').right)).toBeLessThan(pta(menieresAudiogram('attack').right));
    expect(noiseNotchAudiogram(30).left.air[4000]).toBeLessThan(noiseNotchAudiogram(55).left.air[4000]);
  });
});

describe('hearing aids and cochlear implants', () => {
  it('half-gain rule', () => {
    const g = halfGainRule(makeEar([20, 30, 40, 50, 60, 70, 70, 80]));
    expect(g[1000]).toBe(20);
    expect(g[8000]).toBe(40);
  });

  it('NICE TA566 candidacy needs bilateral > 80 dB HL at two frequencies and BKB ≤ 50 %', () => {
    const profound = makeEar(Array(8).fill(95));
    expect(niceImplantCandidacy({ left: profound, right: profound }, 30).eligible).toBe(true);
    expect(niceImplantCandidacy({ left: profound, right: profound }, 70).eligible).toBe(false);
    expect(niceImplantCandidacy(getCase('sudden-snhl').audiogram, 30).eligible).toBe(false);
  });

  it('maps electrodes to Greenwood places: a 20 mm insertion reaches ≈ 1.2 kHz, 28 mm ≈ 300 Hz', () => {
    const c = implantCoverage({ electrodeCount: 22, insertionDepthMm: 20 });
    expect(c.electrodes.length).toBe(22);
    expect(c.lowestPlaceHz).toBeCloseTo(greenwood(15 / 35), 6);
    expect(c.lowestPlaceHz).toBeGreaterThan(1100);
    expect(c.lowestPlaceHz).toBeLessThan(1250);
    expect(c.highestPlaceHz).toBeGreaterThan(c.lowestPlaceHz);
    for (let i = 1; i < c.electrodes.length; i++) expect(c.electrodes[i]!.mmFromBase).toBeLessThan(c.electrodes[i - 1]!.mmFromBase);
    expect(c.electrodes[0]!.mismatchOctaves).toBeLessThan(-1); // apical electrode fed far lower frequencies than its place
    const deep = implantCoverage({ electrodeCount: 12, insertionDepthMm: 28 });
    expect(deep.lowestPlaceHz).toBeGreaterThan(250);
    expect(deep.lowestPlaceHz).toBeLessThan(330);
    expect(Math.abs(deep.electrodes[0]!.mismatchOctaves)).toBeLessThan(Math.abs(c.electrodes[0]!.mismatchOctaves));
    expect(() => implantCoverage({ electrodeCount: 8, insertionDepthMm: 20 })).toThrow(RangeError);
    expect(() => implantCoverage({ electrodeCount: 24, insertionDepthMm: 20 })).toThrow(RangeError);
  });
});
