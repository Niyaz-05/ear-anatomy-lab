import { useId } from 'react';
import { useLab } from '../app/LabContext';
import { CLOSEUPS, ambientKPa, type CloseupId, type Environment, type Sim } from '../app/sim';
import { useBalanceLive } from '../app/drivers';
import { balanceLive } from '../app/live';
import { G, bppvNystagmusIntensity, dixHallpike, epleyManoeuvre, gravityInHead, nystagmusWaveform, otolith } from '../ear/balance';
import { DRUM_THRESHOLDS_KPA, MMHG_PER_KPA, earPressure, middleEarAfter } from '../ear/pressure';
import { OSSICLE_PARTS } from '../ear/parts';
import { CochleaSection, CristaSection, HairBundle, MaculaSection, PostureIcon } from './Schematics';
import { LineChart } from './Chart';
import { PanelHead, PlayButton, Radios, Readout, Slider, SourcesLine } from './widgets';

function Ossicles({ sim, set }: { sim: Sim; set: (p: Partial<Sim>) => void }) {
  const { dispatch } = useLab();
  const bones = ['malleus', 'incus', 'stapes'] as const;
  return (
    <>
      <p className="small">The three smallest bones in the body, turning slowly. The <strong>malleus</strong> handle is fixed in the drum; its head and the <strong>incus</strong> body sit in the attic and rock together about an axis through the malleus’s anterior process and the incus’s short process. The long process of the incus is shorter than the malleus handle, a lever of about 1.3, and its lenticular process drives the <strong>stapes</strong>, whose footplate pistons in the oval window.</p>
      <div className="row"><PlayButton /><label className="check"><input type="checkbox" checked={sim.muscles} onChange={(e) => set({ muscles: e.target.checked })} /> Show the two muscles</label></div>
      {bones.map((b) => (
        <div key={b} className="part-list small">
          <button type="button" className="link" onClick={() => dispatch({ type: 'select', id: b })}><strong>{b[0]!.toUpperCase() + b.slice(1)}</strong></button>:{' '}
          {OSSICLE_PARTS.filter((p) => p.bone === b).map((p) => p.label).join(', ')}.
        </div>
      ))}
      <ul className="facts small">
        <li><strong>Incudomalleolar joint</strong>: a saddle-shaped synovial joint; the malleus head and incus body move almost as one.</li>
        <li><strong>Incudostapedial joint</strong>: a small ball-and-socket synovial joint between the lenticular process and the stapes head.</li>
        <li>Sizes: malleus about 8–9 mm, incus about 7 mm, stapes about 3.3 mm high with a footplate about 3.0 × 1.4 mm.</li>
        {sim.muscles && <li><strong>Tensor tympani</strong> (CN V3) pulls the malleus handle in; <strong>stapedius</strong> (CN VII) tilts the stapes. Both stiffen the chain against loud low-frequency sound (the acoustic reflex).</li>}
      </ul>
      <SourcesLine items={['Gray’s Anatomy 42nd ed. (2020)', 'Pickles 2012']} />
    </>
  );
}

function Cochlea() {
  return (
    <>
      <p className="small">The 3D view is cut across the cochlea and seen from above, showing the scalae in each turn. Below is one turn enlarged: a fluid wave moves the basilar membrane, the organ of Corti rocks against the tectorial membrane, and the hair bundles are sheared.</p>
      <CochleaSection />
      <h3 className="group-title">Stereocilia and tip links</h3>
      <HairBundle />
      <p className="muted small">Each hair cell carries rows of stereocilia of rising height joined by tip links. Bending towards the tallest row stretches the links and opens mechanotransduction channels: K⁺ from the endolymph flows in, the cell depolarises and the inner hair cells release glutamate. Bending the other way closes them.</p>
      <SourcesLine items={['Pickles 2012', 'Purves et al. 2018, ch. 13', 'OpenStax A&P 2e §14.1']} />
    </>
  );
}

function Crista() {
  const live = useBalanceLive(15);
  const r = live.readings['right-lateral'];
  const bend = r.flow === 'ampullopetal' ? Math.min(1, Math.abs(r.stimulation) / 60) : r.flow === 'ampullofugal' ? -Math.min(1, Math.abs(r.stimulation) / 60) : 0;
  return (
    <>
      <p className="small">Each canal swells into an ampulla holding a crista: a ridge of hair cells whose bundles stand in the <strong>cupula</strong>, a gel flap that seals the ampulla. When the head turns, the endolymph lags and pushes the cupula like a sail. Turn the head and watch the right lateral canal’s cupula (and the 3D view).</p>
      <div className="row">
        <button type="button" className="secondary small-button" onClick={() => balanceLive.turn('yaw', 40)}>↶ Turn head left</button>
        <button type="button" className="secondary small-button" onClick={() => balanceLive.turn('yaw', -40)}>Turn head right ↷</button>
      </div>
      <CristaSection bend={bend} excited={Math.abs(r.stimulation) < 2 ? null : r.excitatory} />
      <p className="small" aria-live="polite" data-rate={Math.round(r.firingRate)}>Right lateral canal afferent: <strong>{Math.round(r.firingRate)} spikes/s</strong> (resting 90).</p>
      <ul className="facts small">
        <li>Every hair cell on a crista points the same way: in the <strong>lateral</strong> canal the kinocilium faces the utricle, so flow towards the ampulla (ampullopetal) excites; in the <strong>anterior and posterior</strong> canals it faces the canal, so flow away from the ampulla (ampullofugal) excites (Ewald’s second law follows).</li>
        <li>Turning the head to the right drives endolymph in the right lateral canal towards its ampulla: the right side fires more, the left less.</li>
        <li>The cupula has the same density as endolymph, so gravity does not move it; only rotation does (unless otoconia stick to it, cupulolithiasis).</li>
      </ul>
      <SourcesLine items={['Kandel et al. 2021, ch. 27', 'Purves et al. 2018, ch. 14', 'Goldberg & Fernández 1971']} />
    </>
  );
}

function Macula({ sim, set }: { sim: Sim; set: (p: Partial<Sim>) => void }) {
  const o = otolith(gravityInHead(sim.pitchDeg, sim.rollDeg), { x: 0, y: 0, z: sim.accelMs2 });
  return (
    <>
      <p className="small">The utricle and saccule each have a <strong>macula</strong>: hair cells under a gel carrying <strong>otoconia</strong>, crystals of calcium carbonate about three times as dense as endolymph. Tilt the head and the crystals slide downhill, bending the bundles; a linear acceleration does the same.</p>
      <Slider label="Head roll" min={-60} max={60} step={1} value={sim.rollDeg} onChange={(v) => set({ rollDeg: v })} display={`${sim.rollDeg > 0 ? 'right ear down ' : sim.rollDeg < 0 ? 'left ear down ' : ''}${Math.abs(sim.rollDeg)}°`} />
      <Slider label="Head pitch" min={-60} max={60} step={1} value={sim.pitchDeg} onChange={(v) => set({ pitchDeg: v })} display={`${sim.pitchDeg > 0 ? 'nose up ' : sim.pitchDeg < 0 ? 'nose down ' : ''}${Math.abs(sim.pitchDeg)}°`} />
      <MaculaSection shear={-o.utricle.x / G} />
      <Readout rows={[
        { label: 'Tilt signalled', value: `${o.apparentTiltDeg.toFixed(0)}°` },
        { label: 'Utricle afferents right / left', value: `${Math.round(o.firing.utricleRight)} / ${Math.round(o.firing.utricleLeft)} spikes/s` },
      ]} />
      <ul className="facts small">
        <li>The <strong>striola</strong> is a curved band where the hair-cell polarity reverses: towards it in the utricle, away from it in the saccule, so any tilt excites some cells and inhibits others.</li>
        <li>The utricle lies roughly horizontal (head tilt and side-to-side or fore–aft acceleration); the saccule stands vertical (up–down acceleration).</li>
        <li>Loosened otoconia that drift into a semicircular canal cause BPPV (see the BPPV close-up).</li>
      </ul>
      <SourcesLine items={['Kandel et al. 2021, ch. 27', 'Fernández & Goldberg 1976', 'Purves et al. 2018, ch. 14']} />
    </>
  );
}

function Pressure({ sim, set }: { sim: Sim; set: (p: Partial<Sim>) => void }) {
  const ambient = ambientKPa(sim);
  const e = earPressure(ambient, sim.middleEarKPa);
  const flight = sim.environment === 'flight';
  // Changing height or depth leaves the middle ear where it was (the tube is shut), except that overpressure vents.
  const move = (patch: Partial<Sim>) => {
    const next = { ...sim, ...patch };
    set({ ...patch, middleEarKPa: middleEarAfter(sim.middleEarKPa, ambientKPa(next)) });
  };
  const pct = Math.max(-1, Math.min(1, e.differenceKPa / 16));
  return (
    <>
      <p className="small">The middle ear is a closed air space, ventilated only when the <strong>auditory (Eustachian) tube</strong> opens, as it does when you swallow or yawn. Change the outside pressure and see the drum bulge, then equalise.</p>
      <Radios label="Where" value={sim.environment} onChange={(v: Environment) => set({ environment: v, heightM: 0, depthM: 0, middleEarKPa: 101.325 })} options={[{ id: 'flight', label: 'Flying (cabin)' }, { id: 'dive', label: 'Diving' }]} />
      {flight
        ? <Slider label="Cabin altitude" min={0} max={3000} step={50} value={sim.heightM} onChange={(v) => move({ heightM: v })} display={`${Math.round(sim.heightM)} m`} />
        : <Slider label="Depth under water" min={0} max={12} step={0.1} value={sim.depthM} onChange={(v) => move({ depthM: v })} display={`${sim.depthM.toFixed(1)} m`} />}
      <div className="row">
        <button type="button" className="primary small-button" disabled={!e.canEqualise} onClick={() => set({ middleEarKPa: ambient })}>Swallow / Valsalva</button>
        <span className="muted small">{e.canEqualise ? 'opens the tube and equalises' : 'the tube is locked shut'}</span>
      </div>
      <svg className="pressure-bar" viewBox="0 0 300 44" role="img" aria-label={`Pressure difference ${e.differenceKPa.toFixed(1)} kilopascals.`}>
        <rect x={10} y={14} width={280} height={10} rx={5} fill="#e9eef3" />
        <rect x={150 - (DRUM_THRESHOLDS_KPA.pain / 16) * 140} y={14} width={(DRUM_THRESHOLDS_KPA.pain / 16) * 280} height={10} fill="#dfe9df" />
        <rect x={Math.min(150, 150 + pct * 140)} y={14} width={Math.abs(pct) * 140} height={10} fill={e.severity >= 2 ? '#d2452f' : e.severity === 1 ? '#e3b23c' : '#3aa76d'} />
        <line x1={150} x2={150} y1={10} y2={28} stroke="#24334a" />
        <text x={12} y={38} fontSize="9.2" fill="currentColor" opacity={0.75}>bulging out</text>
        <text x={150} y={38} fontSize="9.2" textAnchor="middle" fill="currentColor" opacity={0.75}>equal</text>
        <text x={288} y={38} fontSize="9.2" textAnchor="end" fill="currentColor" opacity={0.75}>pushed in</text>
      </svg>
      <Readout rows={[
        { label: 'Outside pressure', value: `${ambient.toFixed(1)} kPa` },
        { label: 'Middle-ear pressure', value: `${sim.middleEarKPa.toFixed(1)} kPa` },
        { label: 'Difference across the drum', value: `${e.differenceKPa >= 0 ? '+' : ''}${e.differenceKPa.toFixed(1)} kPa (${Math.round(e.differenceKPa * MMHG_PER_KPA)} mmHg)`, tone: e.severity >= 2 ? 'bad' : e.severity === 1 ? 'warn' : 'ok', data: { drum: e.drum } },
      ]} />
      <p className="small" aria-live="polite">{e.note}{e.severity === 3 && ' At this difference the drum can rupture (barotrauma).'}</p>
      <p className="muted small">Thresholds are approximate and vary between people: pain from about {DRUM_THRESHOLDS_KPA.pain} kPa (60 mmHg); the tube may lock from about {DRUM_THRESHOLDS_KPA.lock} kPa (90 mmHg); rupture from about {DRUM_THRESHOLDS_KPA.rupture} kPa (100 mmHg). Cabins are pressurised to an altitude of at most about 2,400 m; under water the pressure rises by about 10 kPa per metre.</p>
      <SourcesLine items={['ISO 2533 standard atmosphere', 'Edmonds et al., Diving and Subaquatic Medicine, 5th ed. (2015)', 'Pickles 2012']} />
    </>
  );
}

function Bppv({ sim, set }: { sim: Sim; set: (p: Partial<Sim>) => void }) {
  const steps = epleyManoeuvre('right');
  const step = sim.epleyStep > 0 ? steps[sim.epleyStep - 1]! : null;
  const hp = sim.hallpikeSide === 'none' ? null : dixHallpike(sim.hallpikeSide, 'right');
  // Provoked nystagmus: intensity over time and the torsional–upbeating trace it scales.
  const T = 30, n = 601;
  const intensity = Array.from({ length: n }, (_, i) => bppvNystagmusIntensity((i / (n - 1)) * T));
  const trace = Array.from({ length: n }, (_, i) => { const t = (i / (n - 1)) * T; const k = intensity[i]!; return k * nystagmusWaveform(-10 * Math.max(0.05, k), t, { rangeDeg: 4 }).positionDeg; });
  return (
    <>
      <p className="small">In posterior-canal BPPV, otoconia loosened from the utricle lie in the posterior canal, its lowest part when you lie down. Moving the head lets them fall, dragging endolymph and bending the cupula: a burst of vertigo. The model is the right ear, so here the right ear is affected.</p>
      <h3 className="group-title">Dix–Hallpike test</h3>
      <Radios label="Dix–Hallpike side" value={sim.hallpikeSide} onChange={(v) => set({ hallpikeSide: v, epleyStep: 0 })} options={[{ id: 'none', label: 'Sitting' }, { id: 'right', label: 'Head right, lie back' }, { id: 'left', label: 'Head left, lie back' }]} />
      {hp && (
        <div data-provoked={String(hp.provoked)}>
          <p className="small" aria-live="polite"><strong>{hp.provoked ? 'Positive.' : 'Negative.'}</strong> {hp.explanation}</p>
          {hp.provoked && (
            <>
              <LineChart label="Provoked nystagmus: after a latency of a few seconds, a crescendo then decrescendo lasting under a minute." series={[{ label: 'eye', colour: '#24334a', values: trace, width: 1 }, { label: 'intensity', colour: '#c8443b', values: intensity.map((k) => k * 2.4), dashed: true }]}
                xMax={T} xTicks={[0, 5, 10, 15, 20, 25, 30].map((x) => ({ at: x, text: `${x} s` }))} y={{ min: -3, max: 3, ticks: [-2, 0, 2], unit: 'vertical eye position (°), up = upwards' }} marks={[{ at: 3, text: 'latency' }]} height={110} />
              <p className="muted small">Upbeating and torsional (the top of the eye beating towards the lower, right ear), {hp.latencyS!.min}–{hp.latencyS!.max} s latency, under {hp.durationS!.max} s, fading with repetition.</p>
            </>
          )}
        </div>
      )}
      <h3 className="group-title">Epley manoeuvre</h3>
      <PostureIcon p={step ? { posture: step.posture, headPitchDeg: step.headPitchDeg, headYawDeg: step.headYawOnTrunkDeg, faceDeg: step.faceFromCeilingDeg, lyingOn: step.lyingOn } : { posture: sim.hallpikeSide === 'none' ? 'sitting' : 'supine', headPitchDeg: sim.hallpikeSide === 'none' ? 0 : 20, headYawDeg: sim.hallpikeSide === 'left' ? -45 : sim.hallpikeSide === 'right' ? 45 : 0, faceDeg: sim.hallpikeSide === 'none' ? null : sim.hallpikeSide === 'right' ? 45 : -45, lyingOn: null }} />
      <div className="row epley-nav">
        <button type="button" className="secondary small-button" disabled={sim.epleyStep === 0} onClick={() => set({ epleyStep: sim.epleyStep - 1, hallpikeSide: 'none' })}>← Back</button>
        <span className="small" data-epley-step={sim.epleyStep}>{step ? `Step ${step.step} of 5` : 'Before the manoeuvre'}</span>
        <button type="button" className="primary small-button" disabled={sim.epleyStep === 5} onClick={() => set({ epleyStep: sim.epleyStep + 1, hallpikeSide: 'none' })}>{sim.epleyStep === 0 ? 'Start →' : 'Next →'}</button>
      </div>
      {step ? (
        <div className="epley-step" aria-live="polite">
          <p className="small"><strong>{step.name}.</strong> {step.instruction}{step.holdSeconds ? ` Hold about ${step.holdSeconds} s.` : ''}</p>
          <p className="small">Otoconia: <strong>{step.otoconia.region}</strong>.</p>
        </div>
      ) : <p className="small">The otoconia (white, in the 3D view) rest in the ampullary arm of the posterior canal, near the cupula.</p>}
      {sim.epleyStep === 5 && <p className="small note">The otoconia are back in the utricle, where they no longer move the cupula. One manoeuvre clears most cases; it can be repeated.</p>}
      <SourcesLine items={['Bhattacharyya et al. 2017 (BPPV guideline)', 'Epley 1992', 'Fife et al. 2008']} />
    </>
  );
}

/** Close-ups: guided views of parts too small or too fast to see in the whole model. */
export function CloseupsPanel() {
  const { state, dispatch } = useLab();
  const id = useId();
  const sim = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch });
  const titles: Record<CloseupId, string> = {
    ossicles: 'The ossicular chain', cochlea: 'Inside the cochlear duct', crista: 'Crista ampullaris', macula: 'Maculae and otoconia', pressure: 'Ear pressure and the tube', bppv: 'BPPV and the Epley manoeuvre',
  };
  return (
    <section className="sheet mode-panel closeups-panel" aria-labelledby={`${id}-title`}>
      <PanelHead id={`${id}-title`} eyebrow="Close-ups" title={titles[sim.closeup]} />
      <Radios label="Close-up" value={sim.closeup} onChange={(v: CloseupId) => set({ closeup: v })} options={CLOSEUPS.map((c) => ({ id: c.id, label: c.label }))} className="closeup-pick" />
      {sim.closeup === 'ossicles' && <Ossicles sim={sim} set={set} />}
      {sim.closeup === 'cochlea' && <Cochlea />}
      {sim.closeup === 'crista' && <Crista />}
      {sim.closeup === 'macula' && <Macula sim={sim} set={set} />}
      {sim.closeup === 'pressure' && <Pressure sim={sim} set={set} />}
      {sim.closeup === 'bppv' && <Bppv sim={sim} set={set} />}
    </section>
  );
}
