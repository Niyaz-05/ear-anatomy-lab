import { describe, expect, it } from 'vitest';
import { earDefinition as def } from '../../src/ear/definition';
import { anchors, geometry } from '../../src/ear/anchors';
import {
  CLOSEUP, effectiveMode, effectiveSim, effectiveSlice, initialState, isVisible, makeReducer, simHighlight,
} from '../../src/app/state';
import { defaultSim, patchSim, setThreshold, ambientKPa, flatAudiogram, type Sim } from '../../src/app/sim';
import { BalanceLive, SPIN } from '../../src/app/live';
import { formatHz, formatMinutes, freqFromSlider, logFraction, ringSpacingM, sliderFromFreq, visualAmplitude, visualHz } from '../../src/app/visual';
import { toneGain } from '../../src/app/tone';
import { DRUM_THRESHOLDS_KPA, PASSIVE_VENT_KPA, SEA_LEVEL_KPA, airPressureKPa, drumDisplacement, earPressure, middleEarAfter, waterPressureKPa } from '../../src/ear/pressure';
import { aWeightingDb } from '../../src/ear/hearing';
import {
  CANAL_ARC_DEG, DRUM_NORMAL, OSSICLE_PARTS, OSSICULAR_AXIS, PISTON_DIR, SCALA_TYMPANI_OFFSET, canalFrame, canalPoint, canalTangent,
  chainDisplacement, cochleaPointAt, inwardRotationSign, posteriorCanalPoint,
} from '../../src/ear/parts';
import { getCase } from '../../src/ear/audiology';

const reduce = makeReducer(def);
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('simulation settings', () => {
  it('keep every value in range and ignore unknown keys and wrong types', () => {
    const s = patchSim(defaultSim(), { freqHz: 50000, levelDb: -20, caseId: 'nope', closeup: 'macula', epleyStep: 7.6, motion: 'spin', muscles: 'yes', bogus: 3 } as never);
    expect(s.freqHz).toBe(20000);
    expect(s.levelDb).toBe(0);
    expect(s.caseId).toBe(defaultSim().caseId);
    expect(s.closeup).toBe('macula');
    expect(s.epleyStep).toBe(5);
    expect(s.motion).toBe('none');
    expect(s.muscles).toBe(false);
    expect('bogus' in s).toBe(false);
  });

  it('set audiogram thresholds in 5 dB steps, bone only up to 4 kHz', () => {
    let a = setThreshold(flatAudiogram(), 'right', 'air', 4000, 52);
    expect(a.right.air[4000]).toBe(50);
    a = setThreshold(a, 'left', 'bone', 1000, 200);
    expect(a.left.bone[1000]).toBe(120);
    expect(setThreshold(a, 'left', 'bone', 8000, 40)).toBe(a);
  });

  it('give the ambient pressure of the cabin or the water', () => {
    expect(ambientKPa({ environment: 'flight', heightM: 0, depthM: 5 })).toBeCloseTo(SEA_LEVEL_KPA, 3);
    expect(ambientKPa({ environment: 'dive', heightM: 2000, depthM: 10 })).toBeCloseTo(201.8, 0);
  });
});

describe('every tour step', () => {
  it('has about twenty steps covering every mode, and params the modes understand', () => {
    expect(def.tour.length).toBeGreaterThanOrEqual(20);
    const keys = new Set(Object.keys(defaultSim()));
    for (const t of def.tour) {
      for (const [k, v] of Object.entries(t.params ?? {})) {
        expect(keys.has(k), `${t.id}.${k}`).toBe(true);
        expect((patchSim(defaultSim(), { [k]: v }) as unknown as Record<string, unknown>)[k], `${t.id}.${k}`).toEqual(v);
      }
    }
    for (const m of ['hearing', 'balance', 'clinic', 'closeups']) expect(def.tour.some((t) => t.mode === m && t.params), m).toBe(true);
  });

  it('drives its mode: a tour step sets the tone, the close-up and the case', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'tour' });
    const go = (id: string) => { s = reduce(s, { type: 'tour-go', index: def.tour.findIndex((t) => t.id === id) }); };
    go('tonotopy');
    expect(effectiveMode(def, s)).toBe('hearing');
    expect(effectiveSim(def, s).freqHz).toBe(8000);
    go('scalae');
    expect(effectiveMode(def, s)).toBe('closeups');
    expect(effectiveSim(def, s).closeup).toBe('cochlea');
    expect(effectiveSlice(def, s).axis).toBe('axial');
    go('hearing-loss');
    expect(simHighlight(def, s)).toEqual(getCase('otosclerosis').structures);
    expect(isVisible(def, s, 'stapes')).toBe(true);
    // The learner's own settings are untouched by the tour…
    expect(s.sim.freqHz).toBe(defaultSim().freqHz);
    // …until they choose to try a step themselves.
    go('tonotopy');
    s = reduce(s, { type: 'try-step' });
    expect(s.mode).toBe('hearing');
    expect(s.sim.freqHz).toBe(8000);
  });
});

describe('the reducer and the modes', () => {
  it('moves the camera to a new close-up and shows only its parts', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'closeups' });
    expect(s.camera.preset).toBe(CLOSEUP.ossicles.preset);
    expect(isVisible(def, s, 'malleus')).toBe(true);
    expect(isVisible(def, s, 'tympanic-membrane')).toBe(false);
    expect(isVisible(def, s, 'stapedius')).toBe(false);
    s = reduce(s, { type: 'set-sim', patch: { muscles: true } });
    expect(isVisible(def, s, 'stapedius')).toBe(true);
    const n = s.camera.nonce;
    s = reduce(s, { type: 'set-sim', patch: { closeup: 'bppv' } });
    expect(s.camera.nonce).toBe(n + 1);
    expect(s.camera.preset).toBe('inner-ear');
    expect(isVisible(def, s, 'posterior-canal')).toBe(true);
    expect(isVisible(def, s, 'malleus')).toBe(false);
    s = reduce(s, { type: 'set-sim', patch: { closeup: 'cochlea' } });
    expect(effectiveSlice(def, s)).toMatchObject({ axis: 'axial' });
  });

  it('highlights a case’s structures and frames them; a new case moves the camera', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'clinic' });
    expect(simHighlight(def, s)).toEqual(['stapes', 'oval-window']);
    const n = s.camera.nonce;
    s = reduce(s, { type: 'set-sim', patch: { caseId: 'wax-impaction' } });
    expect(s.camera.nonce).toBe(n + 1);
    expect(s.camera.focus).toContain('ear-canal-cartilage');
    expect(simHighlight(def, s)).toEqual(['ear-canal-cartilage', 'ear-canal-bone']);
    // Selecting a structure takes over from the case highlight.
    s = reduce(s, { type: 'select', id: 'cochlea' });
    expect(simHighlight(def, s)).toEqual([]);
  });

  it('points the 3D view at the chain or the cochlea for the learner’s own audiogram', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'clinic' });
    s = reduce(s, { type: 'set-sim', patch: { clinicView: 'build' } });
    expect(simHighlight(def, s)).toEqual([]);
    for (const f of [500, 1000, 2000, 4000]) s = reduce(s, { type: 'set-threshold', ear: 'right', path: 'air', freq: f, db: 45 });
    expect(simHighlight(def, s)).toContain('stapes');
    for (const f of [500, 1000, 2000, 4000]) s = reduce(s, { type: 'set-threshold', ear: 'right', path: 'bone', freq: f, db: 45 });
    expect(simHighlight(def, s)).toContain('cochlea');
    expect(simHighlight(def, s)).not.toContain('stapes');
  });

  it('frames the cochlea for the implant view, and reset restores the defaults', () => {
    let s = reduce(initialState(def), { type: 'set-mode', mode: 'clinic' });
    s = reduce(s, { type: 'set-sim', patch: { clinicView: 'devices', implantElectrodes: 30 } });
    expect(s.camera.preset).toBe('inner-ear');
    expect(s.sim.implantElectrodes).toBe(22);
    s = reduce(s, { type: 'reset' });
    expect(s.sim).toEqual(defaultSim());
  });
});

describe('ear pressure', () => {
  it('follows the standard atmosphere and hydrostatics', () => {
    expect(airPressureKPa(0)).toBeCloseTo(101.325, 3);
    expect(airPressureKPa(2438)).toBeCloseTo(75.2, 0); // 8,000 ft cabin
    expect(airPressureKPa(5500)).toBeCloseTo(50.5, 0); // about half an atmosphere
    expect(waterPressureKPa(10)).toBeCloseTo(201.8, 0); // two atmospheres at 10 m
  });
  it('pushes the drum in on descent and out on ascent, with the thresholds in order', () => {
    expect(earPressure(110, 101.325).drum).toBe('pushed-in');
    expect(earPressure(90, 101.325).drum).toBe('bulging-out');
    expect(earPressure(101.4, 101.325).drum).toBe('neutral');
    expect(earPressure(101.325 + DRUM_THRESHOLDS_KPA.lock, 101.325).canEqualise).toBe(false);
    expect(earPressure(101.325 - DRUM_THRESHOLDS_KPA.lock, 101.325).canEqualise).toBe(true);
    expect(earPressure(101.325 + 20, 101.325).severity).toBe(3);
    expect(DRUM_THRESHOLDS_KPA.pain).toBeLessThan(DRUM_THRESHOLDS_KPA.lock);
    expect(earPressure(101.325 + 1, 101.325).differenceMmHg).toBeCloseTo(7.5, 1);
  });
  it('vents middle-ear overpressure passively but keeps underpressure', () => {
    expect(middleEarAfter(101.325, 80)).toBeCloseTo(80 + PASSIVE_VENT_KPA);
    expect(middleEarAfter(80, 101.325)).toBe(80);
    expect(drumDisplacement(5)).toBeGreaterThan(0);
    expect(drumDisplacement(-5)).toBeLessThan(0);
    expect(Math.abs(drumDisplacement(1000))).toBeLessThanOrEqual(1);
  });
});

describe('A-weighting (IEC 61672)', () => {
  it('is zero at 1 kHz and matches the tabulated values', () => {
    expect(aWeightingDb(1000)).toBeCloseTo(0, 1);
    expect(aWeightingDb(100)).toBeCloseTo(-19.1, 1);
    expect(aWeightingDb(2500)).toBeCloseTo(1.3, 1);
    expect(aWeightingDb(10000)).toBeCloseTo(-2.5, 1);
    expect(aWeightingDb(31.5)).toBeCloseTo(-39.4, 0);
  });
});

describe('drawing helpers', () => {
  it('map frequency to the slider and back, and format it', () => {
    for (const f of [20, 250, 1000, 4000, 20000]) expect(freqFromSlider(sliderFromFreq(f))).toBeCloseTo(f, -Math.log10(f) + 2);
    expect(formatHz(250)).toBe('250 Hz');
    expect(formatHz(1000)).toBe('1.0 kHz');
    expect(formatHz(12500)).toBe('12.5 kHz');
    expect(formatMinutes(480)).toBe('8 h');
    expect(formatMinutes(15)).toBe('15 min');
    expect(formatMinutes(0)).toBe('none');
  });
  it('animate higher tones faster, with closer fronts, and louder ones larger', () => {
    expect(logFraction(20)).toBe(0);
    expect(logFraction(20000)).toBe(1);
    expect(visualHz(8000)).toBeGreaterThan(visualHz(250));
    expect(ringSpacingM(8000)).toBeLessThan(ringSpacingM(250));
    expect(visualAmplitude(110)).toBeGreaterThan(visualAmplitude(40));
    expect(visualAmplitude(130)).toBeLessThanOrEqual(1);
  });
  it('cap the optional tone well below full scale', () => {
    expect(toneGain(0)).toBe(0);
    expect(toneGain(60)).toBeGreaterThan(toneGain(40));
    expect(toneGain(130)).toBeLessThanOrEqual(0.12);
  });
});

describe('points in the model for the simulations', () => {
  it('runs the basilar membrane path from base to apex', () => {
    const path = anchors['cochlea-path'];
    expect(dist(cochleaPointAt(0), path[0]!.p)).toBeLessThan(1e-9);
    expect(dist(cochleaPointAt(35), path[path.length - 1]!.p)).toBeLessThan(1e-9);
    expect(dist(cochleaPointAt(17.5), path[Math.round((path.length - 1) / 2)]!.p)).toBeLessThan(0.0008);
    expect(Math.hypot(...SCALA_TYMPANI_OFFSET)).toBeCloseTo(0.00035, 6);
  });
  it('puts each canal’s arc through its ampulla, in its plane', () => {
    for (const name of ['anterior', 'posterior', 'lateral'] as const) {
      const f = canalFrame(name);
      expect(dist(canalPoint(f, 0), f.ampulla)).toBeLessThan(0.0003);
      expect(Math.abs(dot(canalTangent(f, 90), f.normal))).toBeLessThan(1e-9);
      expect(Math.abs(dot(canalPoint(f, 180).map((v, i) => v - f.centre[i]!), f.normal))).toBeLessThan(1e-9);
    }
    expect(CANAL_ARC_DEG).toBeGreaterThan(180);
    expect(dist(posteriorCanalPoint(1), anchors.utricle)).toBeLessThan(1e-9);
    expect(dist(posteriorCanalPoint(0), anchors.ampullae.posterior)).toBeLessThan(0.0003);
    // Half way round the arc the otoconia are high in the canal, above the ampulla.
    expect(posteriorCanalPoint(0.4)[1]).toBeGreaterThan(anchors.ampullae.posterior[1]);
  });
  it('rocks the chain so the umbo moves in with the drum and the stapes pistons medially', () => {
    const s = inwardRotationSign();
    expect(dot(chainDisplacement(anchors.umbo, s * 0.01), DRUM_NORMAL)).toBeLessThan(0);
    expect(PISTON_DIR[0]).toBeLessThan(-0.9); // the footplate moves medially
    // The lenticular process moves medially with the umbo (it drives the stapes in).
    expect(dot(chainDisplacement(anchors['lenticular-process'], s * 0.01), PISTON_DIR)).toBeGreaterThan(0);
    expect(Math.hypot(...OSSICULAR_AXIS.dir)).toBeCloseTo(1, 9);
  });
  it('labels each ossicle’s parts on (or within half a millimetre of) that bone', () => {
    for (const p of OSSICLE_PARTS) {
      if (p.bone === 'joint') continue;
      const [lo, hi] = geometry[p.bone]!.bounds;
      for (let a = 0; a < 3; a++) {
        expect(p.p[a]!, `${p.id}[${a}]`).toBeGreaterThan(lo![a]! - 0.0005);
        expect(p.p[a]!, `${p.id}[${a}]`).toBeLessThan(hi![a]! + 0.0005);
      }
    }
  });
});

describe('the balance simulation in time', () => {
  const run = (b: BalanceLive, s: number) => { for (let t = 0; t < s; t += 1 / 60) b.step(1 / 60); };
  it('a quick turn to the left excites the left lateral canal and inhibits the right, then settles', () => {
    const b = new BalanceLive();
    b.turn('yaw', 35, 0.5);
    run(b, 0.25);
    expect(b.readings['left-lateral'].firingRate).toBeGreaterThan(120);
    expect(b.readings['right-lateral'].firingRate).toBeLessThan(60);
    expect(b.readings['right-lateral'].flow).toBe('ampullofugal');
    expect(b.spv).toBeLessThan(0); // the eyes drift right, against the turn
    run(b, 0.5);
    expect(b.head.yaw).toBeCloseTo(35, 0);
    run(b, 30);
    expect(Math.abs(b.readings['left-lateral'].firingRate - 90)).toBeLessThan(2);
  });
  it('nodding drives the vertical canals, not the lateral ones', () => {
    const b = new BalanceLive();
    b.turn('pitch', 30, 0.5);
    run(b, 0.25);
    expect(Math.abs(b.readings['right-anterior'].stimulation)).toBeGreaterThan(30);
    expect(Math.abs(b.readings['right-lateral'].stimulation)).toBeLessThan(5);
  });
  it('plays spin-and-stop: the cupula reverses after the stop', () => {
    const b = new BalanceLive();
    b.startSpin();
    run(b, 1 / SPIN.speed);
    expect(b.spinSample()!.cupula).toBeGreaterThan(50);
    run(b, (SPIN.spinS + 1) / SPIN.speed);
    expect(b.spinSample()!.phase).toBe('post-rotatory');
    expect(b.spinSample()!.cupula).toBeLessThan(-30);
    expect(b.readings['right-lateral'].firingRate).toBeGreaterThan(90);
    b.reset();
    expect(b.spin).toBeNull();
  });
  it('lets a drag turn the head while it lasts', () => {
    const b = new BalanceLive();
    b.setDrag({ x: 0, y: -120, z: 0 });
    run(b, 0.1);
    expect(b.head.yaw).toBeLessThan(-5);
    expect(b.readings['right-lateral'].firingRate).toBeGreaterThan(90);
  });
  it('keeps settings the tour can set within reach of the default state', () => {
    const s: Sim = defaultSim();
    expect(s.motion).toBe('none');
    expect(s.spin).toBe(0);
  });
});
