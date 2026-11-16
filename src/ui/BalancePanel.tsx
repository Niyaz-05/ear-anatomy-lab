import { useId, useMemo, useRef } from 'react';
import { useLab } from '../app/LabContext';
import type { HeadMotion, Sim } from '../app/sim';
import { useBalanceLive } from '../app/drivers';
import { SPIN, TRACE_S, balanceLive, type BalanceLive } from '../app/live';
import { AFFERENT, G, accelerationMimickingTilt, gravityInHead, otolith, type CanalId } from '../ear/balance';
import { LineChart, Legend } from './Chart';
import { PanelHead, PlayButton, Radios, Readout, Slider, SourcesLine , RouteSteps } from './widgets';
import { EXCITE, INHIBIT } from '../viewer/BalanceScene';

const PAIRS: { name: string; plane: string; left: CanalId; right: CanalId }[] = [
  { name: 'Lateral', plane: 'yaw (turning)', left: 'left-lateral', right: 'right-lateral' },
  { name: 'LARP', plane: 'left anterior + right posterior', left: 'left-anterior', right: 'right-posterior' },
  { name: 'RALP', plane: 'right anterior + left posterior', left: 'left-posterior', right: 'right-anterior' },
];
const short = (id: CanalId) => `${id.startsWith('left') ? 'L' : 'R'} ${id.split('-')[1]}`;

/**
 * The head seen from above (turning), from the right (nodding) and from the front (tilting). Drag it:
 * sideways turns the head, up and down nods it.
 */
export function HeadIcon({ live, draggable = true }: { live: BalanceLive; draggable?: boolean }) {
  const drag = useRef<{ x: number; y: number; t: number } | null>(null);
  const { yaw, pitch, roll } = live.head;
  const head = (cx: number, rot: number, kind: 'top' | 'side' | 'front') => (
    <g transform={`translate(${cx} 46) rotate(${-rot})`}>
      {kind === 'top' && <>
        <ellipse cx={0} cy={0} rx={21} ry={25} fill="#f1cdb9" stroke="#8a6a5a" strokeWidth={1.2} />
        <path d="M -6 -23 L 0 -32 L 6 -23 Z" fill="#e2b29b" stroke="#8a6a5a" strokeWidth={1} />
        <ellipse cx={-22} cy={0} rx={3.5} ry={7} fill="#e8b9a3" stroke="#8a6a5a" />
        <ellipse cx={22} cy={0} rx={3.5} ry={7} fill="#e8742a" stroke="#8a4a2a" />
      </>}
      {kind === 'side' && <>
        <circle cx={0} cy={0} r={23} fill="#f1cdb9" stroke="#8a6a5a" strokeWidth={1.2} />
        <path d="M 22 -4 L 30 2 L 21 6 Z" fill="#e2b29b" stroke="#8a6a5a" />
        <ellipse cx={-2} cy={0} rx={4} ry={7} fill="#e8742a" stroke="#8a4a2a" />
        <circle cx={12} cy={-6} r={2} fill="#3a2a22" />
      </>}
      {kind === 'front' && <>
        <ellipse cx={0} cy={0} rx={20} ry={24} fill="#f1cdb9" stroke="#8a6a5a" strokeWidth={1.2} />
        <ellipse cx={-21} cy={0} rx={3.5} ry={7} fill="#e8742a" stroke="#8a4a2a" />
        <ellipse cx={21} cy={0} rx={3.5} ry={7} fill="#e8b9a3" stroke="#8a6a5a" />
        <circle cx={-7} cy={-5} r={2} fill="#3a2a22" /><circle cx={7} cy={-5} r={2} fill="#3a2a22" />
        <path d="M -6 10 Q 0 13 6 10" fill="none" stroke="#8a4a3a" strokeWidth={1.2} />
      </>}
    </g>
  );
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now(), dt = Math.max(8, now - d.t) / 1000;
    const vx = (e.clientX - d.x) / dt, vy = (e.clientY - d.y) / dt;
    // Drag right: the nose turns right (yaw −); drag up: nose up (pitch +). About 0.6°/s per px/s.
    balanceLive.setDrag({ x: Math.max(-300, Math.min(300, -vy * 0.6)), y: Math.max(-300, Math.min(300, -vx * 0.6)), z: 0 });
    drag.current = { x: e.clientX, y: e.clientY, t: now };
  };
  const onUp = () => { drag.current = null; balanceLive.setDrag({ x: 0, y: 0, z: 0 }); };
  return (
    <svg className={`head-icon${draggable ? ' draggable' : ''}`} viewBox="0 0 300 104" role="img"
      aria-label={`Head orientation: turned ${Math.abs(Math.round(yaw))}° ${yaw >= 0 ? 'left' : 'right'}, nose ${Math.abs(Math.round(pitch))}° ${pitch >= 0 ? 'up' : 'down'}, tilted ${Math.abs(Math.round(roll))}° towards the ${roll >= 0 ? 'right' : 'left'} ear. The right ear, shown in the model, is orange.`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-yaw={Math.round(yaw)}>
      {head(50, yaw, 'top')}
      {head(150, pitch, 'side')}
      {head(250, roll, 'front')}
      <text x={50} y={100} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.75}>from above</text>
      <text x={150} y={100} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.75}>from the right</text>
      <text x={250} y={100} fontSize="9" textAnchor="middle" fill="currentColor" opacity={0.75}>from the front</text>
    </svg>
  );
}

/** Afferent firing of the six canals in their push–pull pairs (resting rate marked). */
function FiringBars({ live }: { live: BalanceLive }) {
  const max = AFFERENT.maxHz;
  const bar = (id: CanalId) => {
    const r = live.readings[id];
    const rate = r.firingRate;
    const colour = rate > AFFERENT.restingHz + 4 ? EXCITE : rate < AFFERENT.restingHz - 4 ? INHIBIT : '#9aa4ae';
    return (
      <div className="fire-bar" key={id} data-canal={id} data-rate={Math.round(rate)}>
        <span className="fire-name">{short(id)}</span>
        <span className="fire-track" aria-hidden="true">
          <span className="fire-fill" style={{ inlineSize: `${(rate / max) * 100}%`, background: colour }} />
          <span className="fire-rest" style={{ insetInlineStart: `${(AFFERENT.restingHz / max) * 100}%` }} />
        </span>
        <span className="fire-val">{Math.round(rate)}</span>
      </div>
    );
  };
  return (
    <div className="fire-pairs" role="group" aria-label="Firing rate of each canal's afferents, spikes per second">
      {PAIRS.map((p) => (
        <div key={p.name} className="fire-pair">
          <p className="small"><strong>{p.name}</strong> <span className="muted">· {p.plane}</span></p>
          {bar(p.left)}
          {bar(p.right)}
        </div>
      ))}
      <p className="muted small">Spikes/s; the tick marks the resting rate ({AFFERENT.restingHz}/s). Excitation can climb to about {max}/s but inhibition stops at 0, so the excited side carries more of the signal (Ewald’s second law).</p>
    </div>
  );
}

/** The spin-and-stop experiment: head velocity, cupula and perceived rotation against time. */
function SpinCharts({ live }: { live: BalanceLive }) {
  const spin = live.spin!;
  const every = 10;
  const pick = useMemo(() => {
    const s = spin.samples.filter((_, i) => i % every === 0);
    return { head: s.map((x) => x.headVelocity), cupula: s.map((x) => x.cupula), perceived: s.map((x) => x.perceived) };
  }, [spin.samples]);
  const T = SPIN.spinS + SPIN.afterS;
  const phase = spin.t < SPIN.spinS ? 'spinning' : spin.done ? 'done' : 'stopped';
  return (
    <div className="spin-block" data-phase={phase}>
      <LineChart
        label="Spin and stop: chair velocity (grey), cupula signal (orange) and perceived rotation (purple) against time."
        series={[
          { label: 'Chair', colour: '#9aa4ae', values: pick.head, dashed: true },
          { label: 'Cupula', colour: EXCITE, values: pick.cupula },
          { label: 'Perceived', colour: '#7a4fd6', values: pick.perceived },
        ]}
        xMax={T} xTicks={[0, 20, 40, 60, 80].map((x) => ({ at: x, text: `${x} s` }))}
        y={{ min: -100, max: 110, ticks: [-100, -50, 0, 50, 100], unit: 'deg/s (+ = turning left)' }}
        marks={[{ at: SPIN.spinS, text: 'stop' }]} cursor={spin.t} height={130}
      />
      <Legend items={[{ label: 'Chair', colour: '#9aa4ae', dashed: true }, { label: `Cupula (τ ≈ ${spin.tauCupulaS} s)`, colour: EXCITE }, { label: `Perceived (τ ≈ ${spin.tauStorageS} s)`, colour: '#7a4fd6' }]} />
      <p className="small" aria-live="polite">
        {phase === 'spinning' && <>Turning left at {SPIN.omegaDegS}°/s. The endolymph soon catches up, the cupula relaxes back (τ ≈ 6 s) and the feeling of turning fades; central velocity storage stretches it to about {spin.tauStorageS} s.</>}
        {phase !== 'spinning' && <>Stopped. The endolymph keeps going, bending the cupulae the other way: you feel turning <strong>right</strong> and the eyes beat to the right (post-rotatory nystagmus), fading over about half a minute.</>}
      </p>
      <p className="muted small">Played back at {SPIN.speed}× speed.</p>
    </div>
  );
}

/** Horizontal eye position over the last few seconds: slow drifts and quick resets. */
function NystagmusTrace({ live }: { live: BalanceLive }) {
  const values = Array.from(live.trace);
  const beat = Math.abs(live.spv) < 3 ? null : live.spv < 0 ? 'left' : 'right';
  return (
    <>
      <LineChart
        label={`Horizontal eye position over the last ${TRACE_S} seconds. ${beat ? `Nystagmus beating to the ${beat}.` : 'Eyes steady.'}`}
        series={[{ label: 'Eye', colour: '#24334a', values }]}
        xMax={TRACE_S} xTicks={[{ at: 0, text: `−${TRACE_S} s` }, { at: TRACE_S, text: 'now' }]}
        y={{ min: -8, max: 8, ticks: [-5, 0, 5], unit: 'eye position, ° (+ = right)' }} height={96} className="nyst-trace"
      />
      <p className="small" data-beat={beat ?? 'none'}>
        {beat ? <>Nystagmus beating to the <strong>{beat}</strong>: slow drift {beat === 'left' ? 'right' : 'left'} (the vestibulo-ocular reflex), quick reset {beat}. Named by the quick phase.</> : 'Eyes steady: no vestibular drive.'}
      </p>
    </>
  );
}

/** Balance: head movements, canal pairs and afferents, spin-and-stop, nystagmus and the otoliths. */
export function BalancePanel() {
  const { def, state, dispatch } = useLab();
  const id = useId();
  const live = useBalanceLive(12);
  const sim = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch });
  const o = otolith(gravityInHead(sim.pitchDeg, sim.rollDeg), { x: 0, y: 0, z: sim.accelMs2 });
  const mimic = sim.accelMs2 !== 0 ? (Math.asin(Math.max(-1, Math.min(1, sim.accelMs2 / G))) * 180) / Math.PI : null;
  const route = def.routes.find((r) => r.id === 'balance-route');
  const turn = (axis: 'yaw' | 'pitch' | 'roll', deg: number) => { if (sim.motion !== 'none') set({ motion: 'none' }); balanceLive.turn(axis, deg); };
  return (
    <section className="sheet mode-panel balance-panel" aria-labelledby={`${id}-title`}>
      <PanelHead id={`${id}-title`} eyebrow="Balance" title="Canals and otoliths"><PlayButton /></PanelHead>
      <p className="small">Move the head. Endolymph lags in the canals in the plane of the turn and bends their cupulae: <span style={{ color: EXCITE }}>orange</span> flow excites a canal’s nerve, <span style={{ color: INHIBIT }}>blue</span> inhibits it. The model is the right ear; the bars show both ears.</p>

      <HeadIcon live={live} />
      <div className="turn-grid" role="group" aria-label="Turn the head">
        <button type="button" onClick={() => turn('yaw', 35)}>↶ Turn left</button>
        <button type="button" onClick={() => turn('yaw', -35)}>Turn right ↷</button>
        <button type="button" onClick={() => turn('pitch', 30)}>Nose up</button>
        <button type="button" onClick={() => turn('pitch', -30)}>Nose down</button>
        <button type="button" onClick={() => turn('roll', -30)}>Left ear down</button>
        <button type="button" onClick={() => turn('roll', 30)}>Right ear down</button>
      </div>
      <div className="row">
        <Radios label="Keep moving" value={sim.motion} onChange={(m: HeadMotion) => set({ motion: m })} options={[{ id: 'none', label: 'Still' }, { id: 'yaw', label: 'Shake' }, { id: 'pitch', label: 'Nod' }, { id: 'roll', label: 'Tilt' }]} />
        <button type="button" className="secondary small-button" onClick={() => { set({ motion: 'none' }); balanceLive.centre(); }}>Straight ahead</button>
      </div>
      <p className="muted small">Or drag the heads: sideways to turn, up and down to nod.</p>

      <h3 className="group-title">Canal afferents (push–pull)</h3>
      <FiringBars live={live} />

      <h3 className="group-title">Spin, then stop</h3>
      <div className="row">
        <button type="button" className="primary small-button" onClick={() => set({ spin: sim.spin + 1, motion: 'none' })}>{live.spin ? 'Spin again' : 'Spin, then stop'}</button>
        {live.spin && <span className="muted small" data-spin-t={live.spin.t.toFixed(1)}>t = {Math.round(live.spin.t)} s</span>}
      </div>
      {live.spin ? <SpinCharts live={live} /> : <p className="muted small">A Bárány chair turns you at {SPIN.omegaDegS}°/s for {SPIN.spinS} s, then stops suddenly.</p>}

      <h3 className="group-title">The eyes (vestibulo-ocular reflex)</h3>
      <NystagmusTrace live={live} />

      <h3 className="group-title">Otoliths: tilt and acceleration</h3>
      <Slider label="Head pitch" min={-60} max={60} step={1} value={sim.pitchDeg} onChange={(v) => set({ pitchDeg: v })} display={`${sim.pitchDeg > 0 ? 'nose up ' : sim.pitchDeg < 0 ? 'nose down ' : ''}${Math.abs(sim.pitchDeg)}°`} />
      <Slider label="Head roll" min={-60} max={60} step={1} value={sim.rollDeg} onChange={(v) => set({ rollDeg: v })} display={`${sim.rollDeg > 0 ? 'right ear down ' : sim.rollDeg < 0 ? 'left ear down ' : ''}${Math.abs(sim.rollDeg)}°`} />
      <Slider label="Accelerating forwards" min={0} max={5} step={0.1} value={sim.accelMs2} onChange={(v) => set({ accelMs2: v })} display={`${sim.accelMs2.toFixed(1)} m/s²`} />
      <Readout rows={[
        { label: 'Tilt the otoliths signal', value: `${o.apparentTiltDeg.toFixed(0)}°`, data: { tilt: o.apparentTiltDeg.toFixed(0) } },
        { label: 'Utricle shear (sideways, fore–aft)', value: `${o.utricle.x.toFixed(1)}, ${o.utricle.z.toFixed(1)} m/s²` },
        { label: 'Saccule shear (vertical, fore–aft)', value: `${(o.saccule.y - G).toFixed(1)}, ${o.saccule.z.toFixed(1)} m/s²` },
        { label: 'Utricle afferents (right / left / forward)', value: `${Math.round(o.firing.utricleRight)} / ${Math.round(o.firing.utricleLeft)} / ${Math.round(o.firing.utricleForward)} /s` },
      ]} />
      <p className="note small" data-ambiguity="true">
        <strong>Tilt or acceleration?</strong> {mimic !== null
          ? <>Accelerating forwards at {sim.accelMs2.toFixed(1)} m/s² shears the utricle exactly like tilting the head {mimic.toFixed(0)}° nose-up. </>
          : sim.pitchDeg !== 0 ? <>A {Math.abs(sim.pitchDeg)}° nose-{sim.pitchDeg > 0 ? 'up' : 'down'} tilt shears the utricle exactly like accelerating {sim.pitchDeg > 0 ? 'forwards' : 'backwards'} at {Math.abs(accelerationMimickingTilt(sim.pitchDeg)).toFixed(1)} m/s². </> : null}
        The otoliths sense only the sum of gravity and acceleration, so the brain uses the canals (did the head rotate?) and vision to tell them apart. When it cannot, as in a fast take-off at night, pilots feel the nose pitching up: the somatogravic illusion.
      </p>

      <p className="legend-row small"><span><span className="dot" style={{ background: EXCITE }} aria-hidden="true" /> Exciting flow</span><span><span className="dot" style={{ background: INHIBIT }} aria-hidden="true" /> Inhibiting flow</span><span><span className="dot" style={{ background: '#ffffff', border: '1px solid #999' }} aria-hidden="true" /> Cupula, otoconia</span></p>
      <p className="muted small"><strong>Ewald’s laws.</strong> The head and eyes move in the plane of the stimulated canal. In the lateral canal flow towards the ampulla (ampullopetal) excites; in the vertical canals flow away from it (ampullofugal) excites.</p>
      {route && (
        <details className="more">
          <summary>{route.label}: step by step</summary>
          <RouteSteps route={route} colour={EXCITE} />
        </details>
      )}
      <SourcesLine items={['Goldberg & Fernández 1971 (afferents)', 'Raphan, Matsuo & Cohen 1979 (velocity storage)', 'Della Santina et al. 2005 (canal planes)', 'Angelaki et al. 1999 (tilt and translation)', 'Kandel et al. 2021, ch. 27']} />
    </section>
  );
}
