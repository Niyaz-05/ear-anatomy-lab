import { useId, useState } from 'react';
import { useLab } from '../app/LabContext';
import { flatAudiogram, type ClinicView, type Sim } from '../app/sim';
import {
  AUDIOGRAM_FREQUENCIES, CASES, analyseAudiogram, getCase, halfGainRule, implantCoverage, niceImplantCandidacy, tuningForkTests,
  type Audiogram as AudiogramData, type CaseId, type EarAnalysis, type Side, type Tympanogram,
} from '../ear/audiology';
import { formatHz } from '../app/visual';
import { Audiogram, AudiogramKey, LEFT, RIGHT } from './Audiogram';
import { PanelHead, Radios, Readout, Slider, SourcesLine } from './widgets';

const TYPE_TEXT: Record<string, string> = { normal: 'Normal', conductive: 'Conductive', sensorineural: 'Sensorineural', mixed: 'Mixed' };
const TYMP_TEXT: Record<Tympanogram, string> = {
  A: 'Type A: normal middle-ear pressure and mobility',
  As: 'Type As: stiff (shallow peak), as in otosclerosis',
  Ad: 'Type Ad: very mobile (tall peak), as in a disarticulated chain or a flaccid drum',
  B: 'Type B: flat, from fluid, a perforation or an occluded canal (check the canal volume)',
  C: 'Type C: peak at negative pressure, from a poorly ventilating auditory tube',
};

/** Classification of both ears from an audiogram. */
function Classification({ data, extra }: { data: AudiogramData; extra?: { tymp: { left: Tympanogram; right: Tympanogram }; words: { left: number; right: number } } }) {
  const a = analyseAudiogram(data);
  const row = (label: string, f: (e: EarAnalysis, s: Side) => string) => (
    <tr><th scope="row">{label}</th><td>{f(a.right, 'right')}</td><td>{f(a.left, 'left')}</td></tr>
  );
  return (
    <div className="classification" data-right-type={a.right.type} data-left-type={a.left.type} data-right-grade={a.right.degree.grade} data-left-grade={a.left.degree.grade}>
      <table className="aud-table small">
        <thead><tr><th scope="col"><span className="sr-only">Measure</span></th><th scope="col" style={{ color: RIGHT }}>Right</th><th scope="col" style={{ color: LEFT }}>Left</th></tr></thead>
        <tbody>
          {row('Pure-tone average (air)', (e) => `${e.ptaAir.toFixed(0)} dB HL`)}
          {row('Bone average', (e) => `${e.ptaBone.toFixed(0)} dB HL`)}
          {row('Air–bone gap', (e) => `${e.airBoneGap.toFixed(0)} dB`)}
          {row('Degree (WHO)', (e) => e.degree.label.replace(' hearing loss', '').replace('Normal hearing', 'Normal'))}
          {row('Type', (e) => TYPE_TEXT[e.type]!)}
          {extra && row('Tympanogram', (_, s) => `Type ${extra.tymp[s]}`)}
          {extra && row('Word recognition', (_, s) => `${extra.words[s]} %`)}
        </tbody>
      </table>
      <p className="small" aria-live="polite">
        WHO grade (better ear): <strong data-grade={a.betterEarGrade.grade}>{a.betterEarGrade.label}</strong>.
        {a.asymmetry.asymmetric && <> <span className="warn-text">Asymmetric: the {a.asymmetry.worseEar} cochlea is ≥ 15 dB worse at two neighbouring frequencies, a reason for an MRI of the internal acoustic meatus.</span></>}
      </p>
      <p className="muted small">Average of 0.5, 1, 2 and 4 kHz. Conductive: an air–bone gap of 15 dB or more with normal bone conduction; mixed: a gap with raised bone conduction; sensorineural: air and bone together.</p>
    </div>
  );
}

/** Schematic tympanograms (compliance against canal pressure) for both ears. */
function Tympanograms({ t }: { t: { left: Tympanogram; right: Tympanogram } }) {
  const curve = (type: Tympanogram) => {
    const peak = type === 'C' ? -200 : 0, h = { A: 0.9, As: 0.32, Ad: 1.9, B: 0.12, C: 0.75 }[type];
    const w = type === 'B' ? 900 : 70;
    return Array.from({ length: 61 }, (_, i) => -400 + i * 10).map((p, i) => {
      const v = 0.12 + h * Math.exp(-(((p - peak) / w) ** 2));
      return `${i ? 'L' : 'M'} ${(10 + ((p + 400) / 600) * 120).toFixed(1)} ${(66 - Math.min(2.1, v) * 24).toFixed(1)}`;
    }).join(' ');
  };
  const plot = (side: Side, x: number) => (
    <g transform={`translate(${x} 0)`}>
      <rect x={10} y={10} width={120} height={56} fill="#fff" stroke="currentColor" strokeOpacity={0.2} />
      <line x1={10 + (400 / 600) * 120} x2={10 + (400 / 600) * 120} y1={10} y2={66} stroke="currentColor" strokeOpacity={0.15} />
      <path d={curve(t[side])} fill="none" stroke={side === 'right' ? RIGHT : LEFT} strokeWidth={1.8} />
      <text x={70} y={80} fontSize="9" textAnchor="middle" fill="currentColor">{side === 'right' ? 'Right' : 'Left'}: type {t[side]}</text>
      <text x={10} y={90} fontSize="8.4" fill="currentColor" opacity={0.6}>−400</text>
      <text x={130} y={90} fontSize="8.4" textAnchor="end" fill="currentColor" opacity={0.6}>+200 daPa</text>
    </g>
  );
  return (
    <>
      <svg className="tympanograms" viewBox="0 0 300 94" role="img" aria-label={`Tympanograms: right type ${t.right}, left type ${t.left}.`}>
        {plot('right', 6)}
        {plot('left', 152)}
      </svg>
      <ul className="facts small">{[...new Set([t.right, t.left])].map((x) => <li key={x}>{TYMP_TEXT[x]}</li>)}</ul>
    </>
  );
}

/** Rinne and Weber at 512 Hz, drawn on a head seen from the front (the patient's right on the left). */
function TuningForks({ data }: { data: AudiogramData }) {
  const r = tuningForkTests(data);
  const to = r.weber.lateralisesTo;
  // Patient's right ear is on the viewer's left.
  const earX = (s: Side) => (s === 'right' ? 58 : 162);
  const bars = (s: Side) => {
    const res = r.rinne[s];
    const ac = res.result === 'positive' ? 1 : 0.45, bc = res.result === 'positive' ? 0.5 : 1;
    return (
      <g transform={`translate(${s === 'right' ? 6 : 214} 18)`}>
        <text x={0} y={0} fontSize="9" fontWeight={600} fill={s === 'right' ? RIGHT : LEFT}>Rinne {s === 'right' ? 'R' : 'L'}: {res.result === 'positive' ? '+' : '−'}{res.falseNegative ? ' (false)' : ''}</text>
        <text x={0} y={16} fontSize="8.8" fill="currentColor" opacity={0.8}>air</text>
        <rect x={26} y={9} width={52 * ac} height={8} rx={2} fill="#4a8fd8" />
        <text x={0} y={30} fontSize="8.8" fill="currentColor" opacity={0.8}>bone</text>
        <rect x={26} y={23} width={52 * bc} height={8} rx={2} fill="#c9a24a" />
      </g>
    );
  };
  return (
    <div className="forks" data-weber={to} data-rinne-right={r.rinne.right.result} data-rinne-left={r.rinne.left.result}>
      <svg viewBox="0 0 300 150" role="img" aria-label={`Weber lateralises to ${to === 'midline' ? 'the midline' : `the ${to} ear`}. Rinne right ${r.rinne.right.result}, left ${r.rinne.left.result}.`}>
        <g transform="translate(40 0)">
          <ellipse cx={110} cy={92} rx={46} ry={54} fill="#f3d6c6" stroke="#8a6a5a" strokeWidth={1.2} />
          <ellipse cx={earX('right')} cy={96} rx={8} ry={15} fill="#e8b9a3" stroke="#8a6a5a" />
          <ellipse cx={earX('left')} cy={96} rx={8} ry={15} fill="#e8b9a3" stroke="#8a6a5a" />
          <circle cx={96} cy={86} r={3} fill="#3a2a22" /><circle cx={124} cy={86} r={3} fill="#3a2a22" />
          <path d="M 100 118 Q 110 124 120 118" fill="none" stroke="#8a4a3a" strokeWidth={1.4} />
          {/* tuning fork on the forehead */}
          <path d="M 104 20 L 104 44 Q 110 50 116 44 L 116 20 M 110 49 L 110 60" fill="none" stroke="#6b7684" strokeWidth={2.6} strokeLinecap="round" />
          {to === 'midline'
            ? [0, 1, 2].map((i) => <circle key={i} className="weber-wave" cx={110} cy={64} r={8 + i * 8} fill="none" stroke="#7a4fd6" strokeWidth={1.5} style={{ animationDelay: `${i * 0.35}s` }} />)
            : [0, 1, 2].map((i) => {
              const x2 = earX(to) + (to === 'right' ? 12 : -12);
              return <path key={i} className="weber-wave" d={`M 110 66 Q ${(110 + x2) / 2} ${70 + i * 2} ${x2} 92`} fill="none" stroke="#7a4fd6" strokeWidth={2} strokeDasharray="4 4" style={{ animationDelay: `${i * 0.35}s` }} />;
            })}
          <text x={110} y={12} fontSize="9" textAnchor="middle" fill="currentColor">Weber: {to === 'midline' ? 'central' : `heard in the ${to} ear`}</text>
        </g>
        {bars('right')}
        {bars('left')}
      </svg>
      <p className="small"><strong>Weber</strong> (fork on the forehead): {r.weber.interpretation}</p>
      <p className="small"><strong>Rinne</strong> (fork on the mastoid, then beside the canal): right {r.rinne.right.interpretation.charAt(0).toLowerCase() + r.rinne.right.interpretation.slice(1)} Left: {r.rinne.left.interpretation.charAt(0).toLowerCase() + r.rinne.left.interpretation.slice(1)}</p>
    </div>
  );
}

function CasesView({ sim, set }: { sim: Sim; set: (p: Partial<Sim>) => void }) {
  const { def, dispatch } = useLab();
  const c = getCase(sim.caseId);
  const label = (id: string) => def.structures.find((s) => s.id === id)?.label ?? id;
  return (
    <>
      <label className="field select-field">
        <span>Case</span>
        <select value={sim.caseId} onChange={(e) => set({ caseId: e.target.value as CaseId })} aria-label="Case">
          {CASES.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </label>
      <p className="small">{c.description}</p>
      {c.structures.length > 0 && (
        <p className="small">Highlighted: {c.structures.map((s, i) => <span key={s}>{i ? ', ' : ''}<button type="button" className="link" onClick={() => dispatch({ type: 'select', id: s })}>{label(s)}</button></span>)}</p>
      )}
      <h3 className="group-title">Audiogram</h3>
      <Audiogram data={c.audiogram} label={`Audiogram for ${c.name}.`} />
      <AudiogramKey />
      <Classification data={c.audiogram} extra={{ tymp: c.tympanogram, words: c.wordRecognitionPct }} />
      <h3 className="group-title">Tuning forks (512 Hz)</h3>
      <TuningForks data={c.audiogram} />
      <h3 className="group-title">Tympanometry</h3>
      <Tympanograms t={c.tympanogram} />
      <h3 className="group-title">Signs</h3>
      <ul className="facts small">{c.signs.map((s) => <li key={s}>{s}</li>)}</ul>
      {c.vestibular && <p className="small note">Vertigo or imbalance is part of this condition.</p>}
      <h3 className="group-title">Management</h3>
      <p className="small">{c.management}</p>
      <SourcesLine items={c.sources} />
    </>
  );
}

/** Which symbol the learner is placing; remembered while the lab is open. */
let lastEarPath = 'right-air';

function BuildView({ sim, set }: { sim: Sim; set: (p: Partial<Sim>) => void }) {
  const { dispatch } = useLab();
  const id = useId();
  const [earPath, setEP] = useState(lastEarPath);
  const setEarPath = (x: string) => { lastEarPath = x; setEP(x); };
  const [ear, path] = earPath.split('-') as [Side, 'air' | 'bone'];
  return (
    <>
      <p className="small">Click on the chart to set thresholds for the chosen ear and conduction (or focus a symbol and use the arrow keys). The classification updates as you go, and the 3D view highlights where the problem lies.</p>
      <Radios label="Ear and conduction" value={earPath} onChange={setEarPath} options={[
        { id: 'right-air', label: 'Right air ○' }, { id: 'right-bone', label: 'Right bone <' }, { id: 'left-air', label: 'Left air ✕' }, { id: 'left-bone', label: 'Left bone >' },
      ]} />
      <div id={id}>
        <Audiogram data={sim.custom} label="Your audiogram. Click to set a threshold." editing={{ ear, path, onSet: (freq, db) => dispatch({ type: 'set-threshold', ear, path, freq, db }) }} />
      </div>
      <AudiogramKey />
      <div className="row">
        <button type="button" className="secondary small-button" onClick={() => set({ custom: flatAudiogram() })}>Start again (normal)</button>
        <button type="button" className="secondary small-button" onClick={() => set({ custom: getCase(sim.caseId).audiogram })}>Copy the current case</button>
      </div>
      <Classification data={sim.custom} />
      <h3 className="group-title">Tuning forks (512 Hz)</h3>
      <TuningForks data={sim.custom} />
    </>
  );
}

function DevicesView({ sim, set }: { sim: Sim; set: (p: Partial<Sim>) => void }) {
  const c = getCase(sim.caseId);
  const a = analyseAudiogram(c.audiogram);
  const worse: Side = a.right.ptaAir >= a.left.ptaAir ? 'right' : 'left';
  const gain = halfGainRule(c.audiogram[worse]);
  const cov = implantCoverage({ electrodeCount: sim.implantElectrodes, insertionDepthMm: sim.implantDepthMm });
  const nice = niceImplantCandidacy(c.audiogram, Math.min(c.wordRecognitionPct.left, c.wordRecognitionPct.right));
  const apical = cov.electrodes[0]!;
  const maxGain = 60;
  return (
    <>
      <label className="field select-field">
        <span>Case</span>
        <select value={sim.caseId} onChange={(e) => set({ caseId: e.target.value as CaseId })} aria-label="Case">
          {CASES.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </label>
      <h3 className="group-title">Hearing aid: how much gain?</h3>
      <svg className="gain-bars" viewBox="0 0 300 96" role="img" aria-label={`Half-gain rule for the ${worse} ear: ${AUDIOGRAM_FREQUENCIES.map((f) => `${f} Hz ${gain[f]} dB`).join(', ')}.`}>
        {AUDIOGRAM_FREQUENCIES.map((f, i) => {
          const x = 22 + i * 35, h = (Math.min(maxGain, gain[f]) / maxGain) * 52;
          return (
            <g key={f}>
              <rect x={x} y={70 - h} width={22} height={h} rx={2} fill={worse === 'right' ? RIGHT : LEFT} opacity={0.75} />
              <text x={x + 11} y={66 - h} fontSize="9.2" textAnchor="middle" fill="currentColor">{Math.round(gain[f])}</text>
              <text x={x + 11} y={84} fontSize="9.2" textAnchor="middle" fill="currentColor" opacity={0.8}>{f >= 1000 ? `${f / 1000}k` : f}</text>
            </g>
          );
        })}
        <text x={4} y={10} fontSize="8.8" fill="currentColor" opacity={0.7}>Gain (dB) for the {worse} ear, by frequency (Hz)</text>
      </svg>
      <p className="muted small">Lybarger’s half-gain rule: about half the hearing loss at each frequency. Modern prescriptions (NAL-NL2, DSL) refine it, and a hearing aid cannot help when the inner hair cells or nerve fibres themselves are lost.</p>

      <h3 className="group-title">Cochlear implant</h3>
      <p className="small">The electrode array lies in the scala tympani (shown in the 3D view) and stimulates the spiral ganglion directly. Each contact is given a frequency band, high at the base and low towards the apex.</p>
      <Slider label="Electrode contacts" min={12} max={22} step={1} value={sim.implantElectrodes} onChange={(v) => set({ implantElectrodes: v })} display={`${sim.implantElectrodes}`} />
      <Slider label="Insertion depth" min={12} max={32} step={0.5} value={sim.implantDepthMm} onChange={(v) => set({ implantDepthMm: v })} display={`${sim.implantDepthMm.toFixed(1)} mm`} />
      <Readout rows={[
        { label: 'Places covered', value: `${formatHz(cov.lowestPlaceHz)} – ${formatHz(cov.highestPlaceHz)}`, data: { lowest: Math.round(cov.lowestPlaceHz).toString() } },
        { label: 'Length of the cochlea reached', value: `${Math.round(cov.fractionOfCochlea * 100)} %` },
        { label: 'Apical contact: given / place', value: `${formatHz(apical.assignedHz)} / ${formatHz(apical.placeHz)}` },
        { label: 'Mismatch at the apex', value: `${apical.mismatchOctaves > 0 ? '+' : ''}${apical.mismatchOctaves.toFixed(1)} octaves`, tone: Math.abs(apical.mismatchOctaves) > 1 ? 'warn' : 'ok' },
      ]} />
      <p className="muted small">A shallow insertion feeds low speech frequencies to places tuned higher, so voices first sound high-pitched; the brain adapts over months. (Greenwood’s map is for the organ of Corti; the spiral ganglion’s is compressed towards the apex.)</p>
      <p className="small note" data-eligible={String(nice.eligible)}>
        <strong>NICE criteria</strong> for this case: {nice.eligible ? 'met.' : 'not met: '}{!nice.eligible && nice.reasons.map((r, i) => (i ? r : r.charAt(0).toLowerCase() + r.slice(1))).join('; ')}{!nice.eligible && '.'}
        <span className="muted"> (Using the case’s word score as a stand-in for the aided sentence score.)</span>
      </p>
      <SourcesLine items={['NICE TA566 (2019)', 'Greenwood 1990', 'Stakhovskaya et al. 2007, JARO', 'Dillon, Hearing Aids (2012)']} />
    </>
  );
}

/** Clinic: hearing loss and its tests, your own audiogram, hearing aids and implants. */
export function ClinicPanel() {
  const { state, dispatch } = useLab();
  const id = useId();
  const sim = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch });
  return (
    <section className="sheet mode-panel clinic-panel" aria-labelledby={`${id}-title`}>
      <PanelHead id={`${id}-title`} eyebrow="Clinic" title="Hearing loss and its tests" />
      <Radios label="Clinic view" value={sim.clinicView} onChange={(v: ClinicView) => set({ clinicView: v })} options={[
        { id: 'cases', label: 'Cases' }, { id: 'build', label: 'Your audiogram' }, { id: 'devices', label: 'Aids & implants' },
      ]} />
      {sim.clinicView === 'cases' && <CasesView sim={sim} set={set} />}
      {sim.clinicView === 'build' && <BuildView sim={sim} set={set} />}
      {sim.clinicView === 'devices' && <DevicesView sim={sim} set={set} />}
      <p className="muted small">For learning only: the cases are typical teaching examples, not diagnoses.</p>
    </section>
  );
}
