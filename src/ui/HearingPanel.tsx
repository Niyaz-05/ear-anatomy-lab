import { useEffect, useId, useRef, useState } from 'react';
import { useLab } from '../app/LabContext';
import type { Sim } from '../app/sim';
import { TonePlayer } from '../app/tone';
import { formatHz, formatMinutes, freqFromSlider, sliderFromFreq, visualHz } from '../app/visual';
import {
  COCHLEA_LENGTH_MM, aWeightingDb, earCanalResonance, hearingThresholdDb, isAudible, middleEarGain, noiseRisk, placeFromFrequency, travelingWave,
} from '../ear/hearing';
import { PanelHead, PlayButton, Readout, Slider, SourcesLine , RouteSteps } from './widgets';
import { SOUND } from '../viewer/HearingScene';
import { prefersReducedMotion } from '../viewer/webgl';

const PRESETS: { id: string; label: string; patch: Partial<Sim> }[] = [
  { id: '250', label: '250 Hz', patch: { freqHz: 250, levelDb: 70 } },
  { id: '1k', label: '1 kHz', patch: { freqHz: 1000, levelDb: 70 } },
  { id: '4k', label: '4 kHz', patch: { freqHz: 4000, levelDb: 70 } },
  { id: '8k', label: '8 kHz', patch: { freqHz: 8000, levelDb: 70 } },
  { id: 'concert', label: 'Concert, 110 dB', patch: { freqHz: 2000, levelDb: 110 } },
];
const FREQ_MARKS = [16000, 8000, 4000, 2000, 1000, 500, 250, 125];
/** Compact tick labels for the frequency scale: 16k … 1k, 500, 125. */
const tick = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

/** A time that advances while the animation plays (for the 2D wave). */
function useAnimTime(playing: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!playing || prefersReducedMotion()) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => { setT((x) => x + Math.min(0.1, (now - last) / 1000)); last = now; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return t;
}

/**
 * The basilar membrane unrolled, base (stiff, narrow) on the left to apex (floppy, wide) on the right,
 * with the travelling wave for the tone: envelope dashed, the instantaneous shape solid, and the peak at
 * the Greenwood place.
 */
export function BasilarWave({ freqHz, levelDb, t, still }: { freqHz: number; levelDb: number; t: number; still: boolean }) {
  const W = 300, H = 150, x0 = 18, x1 = 290, yc = 58;
  const L = COCHLEA_LENGTH_MM;
  const sx = (mm: number) => x0 + (mm / L) * (x1 - x0);
  const fv = visualHz(freqHz);
  const wave = travelingWave(freqHz, (fv * t) / freqHz + 0.25 / freqHz, 140);
  const a = 26 * (0.35 + 0.65 * Math.min(1, levelDb / 100));
  const half = (mm: number) => 3 + 11 * (mm / L); // the membrane widens from base to apex (≈ 0.1 → 0.5 mm)
  const band = `M ${sx(0)} ${yc - half(0)} L ${sx(L)} ${yc - half(L)} L ${sx(L)} ${yc + half(L)} L ${sx(0)} ${yc + half(0)} Z`;
  const line = (vals: number[], k: number) => wave.mmFromBase.map((mm, i) => `${i ? 'L' : 'M'} ${sx(mm).toFixed(1)} ${(yc - k * a * vals[i]!).toFixed(1)}`).join(' ');
  const peak = wave.peakMmFromBase;
  return (
    <svg className="bm-wave" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The basilar membrane unrolled from base to apex. The travelling wave for ${formatHz(freqHz)} peaks ${peak.toFixed(1)} millimetres from the base.`} data-peak-mm={peak.toFixed(1)}>
      <defs>
        <linearGradient id="bm-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#f6c8bc" />
          <stop offset="1" stopColor="#fbe6df" />
        </linearGradient>
      </defs>
      <path d={band} fill="url(#bm-grad)" stroke="#e2a596" strokeWidth={0.8} />
      <path d={line(wave.envelope, 1)} fill="none" stroke="#e0485f" strokeWidth={1} strokeDasharray="3 3" opacity={0.75} />
      <path d={line(wave.envelope, -1)} fill="none" stroke="#e0485f" strokeWidth={1} strokeDasharray="3 3" opacity={0.75} />
      {!still && <path d={line(wave.displacement, 1)} fill="none" stroke="#24334a" strokeWidth={1.8} strokeLinejoin="round" />}
      <line x1={sx(peak)} x2={sx(peak)} y1={14} y2={yc + 30} stroke="#e0485f" strokeWidth={1.2} />
      <text x={Math.min(Math.max(sx(peak), 40), 260)} y={10} fontSize="10" fontWeight={600} textAnchor="middle" fill="#c22c45">{peak.toFixed(1)} mm · {formatHz(freqHz)}</text>
      {/* frequency scale (Greenwood) */}
      <line x1={x0} x2={x1} y1={yc + 36} y2={yc + 36} stroke="currentColor" strokeOpacity={0.3} />
      {FREQ_MARKS.map((f) => {
        const x = sx(placeFromFrequency(f).mmFromBase);
        return <g key={f}><line x1={x} x2={x} y1={yc + 33} y2={yc + 39} stroke="currentColor" strokeOpacity={0.5} /><text x={x} y={yc + 50} fontSize="9.2" textAnchor="middle" fill="currentColor" opacity={0.85}>{tick(f)}</text></g>;
      })}
      {[0, 5, 10, 15, 20, 25, 30, 35].map((mm) => <text key={mm} x={sx(mm)} y={yc + 64} fontSize="8.8" textAnchor="middle" fill="currentColor" opacity={0.6}>{mm}</text>)}
      <text x={x0} y={yc + 78} fontSize="9.2" fill="currentColor" opacity={0.75}>Base · stapes</text>
      <text x={W / 2} y={yc + 78} fontSize="9.2" textAnchor="middle" fill="currentColor" opacity={0.6}>Hz · mm from base</text>
      <text x={x1} y={yc + 78} fontSize="9.2" textAnchor="end" fill="currentColor" opacity={0.75}>Apex · helicotrema</text>
    </svg>
  );
}

/** The wave, animated on its own so the rest of the panel does not re-render every frame. */
function LiveWave({ freqHz, levelDb, playing }: { freqHz: number; levelDb: number; playing: boolean }) {
  const t = useAnimTime(playing);
  return <BasilarWave freqHz={freqHz} levelDb={levelDb} t={t} still={prefersReducedMotion() || !playing} />;
}

const BANDS = [
  { to: 70, colour: '#3aa76d', label: 'safe' }, { to: 85, colour: '#e3b23c', label: 'caution' }, { to: 100, colour: '#e8742a', label: 'hazardous' },
  { to: 120, colour: '#d2452f', label: 'dangerous' }, { to: 140, colour: '#8e1b2a', label: 'immediate harm' },
];
/** A coloured scale of noise risk (40–140 dBA) with a pointer at the level. */
function NoiseMeter({ dBA }: { dBA: number }) {
  const lo = 40, hi = 140, W = 300, x = (v: number) => 6 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (W - 12);
  let from = lo;
  return (
    <svg className="noise-meter" viewBox={`0 0 ${W} 40`} role="img" aria-label={`Noise level ${Math.round(dBA)} dBA on a scale from safe (green) to immediate harm (dark red).`}>
      {BANDS.map((b) => { const r = <rect key={b.to} x={x(from)} y={12} width={x(b.to) - x(from)} height={10} fill={b.colour} rx={1.5} />; from = b.to; return r; })}
      {[40, 70, 85, 100, 120, 140].map((v) => <text key={v} x={x(v)} y={34} fontSize="9.2" textAnchor="middle" fill="currentColor" opacity={0.75}>{v}</text>)}
      <path d={`M ${x(dBA)} 11 l -5 -8 h 10 z`} fill="#18232c" />
    </svg>
  );
}

/** Hearing: a tone's journey, the middle-ear gain, the place map, audibility and noise exposure. */
export function HearingPanel() {
  const { def, state, dispatch } = useLab();
  const id = useId();
  const sim = state.sim;
  const set = (patch: Partial<Sim>) => dispatch({ type: 'set-sim', patch });
  const f = sim.freqHz, L = sim.levelDb;
  const place = placeFromFrequency(f);
  const gain = middleEarGain();
  const resonance = earCanalResonance(25);
  const threshold = hearingThresholdDb(f);
  const audible = isAudible(f, L);
  const dBA = L + aWeightingDb(f);
  const risk = noiseRisk(dBA);
  const near = Math.abs(Math.log2(f / resonance)) < 0.6;
  const route = def.routes.find((r) => r.id === 'sound-route');

  // Optional tone, from a button press only; stops when the panel closes (mode change).
  const player = useRef<TonePlayer | null>(null);
  const [tone, setTone] = useState(false);
  useEffect(() => () => player.current?.stop(), []);
  useEffect(() => { if (tone) player.current?.update(f, L); }, [tone, f, L]);
  const toggleTone = () => {
    player.current ??= new TonePlayer();
    if (tone) { player.current.stop(); setTone(false); }
    else setTone(player.current.start(f, L));
  };
  const preset = PRESETS.find((p) => p.patch.freqHz === f && p.patch.levelDb === L)?.id;

  return (
    <section className="sheet mode-panel hearing-panel" aria-labelledby={`${id}-title`}>
      <PanelHead id={`${id}-title`} eyebrow="Hearing" title="From sound to signal"><PlayButton /></PanelHead>
      <p className="small">Pick a tone. Blue pressure fronts run down the canal, the drum and ossicles rock, the stapes pushes the oval window in while the round window bulges out, and a travelling wave peaks at the tone’s own place on the basilar membrane.</p>

      <div className="seg-toggle wrap presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => set(p.patch)}>{p.label}</button>)}
      </div>
      <Slider label="Frequency" min={0} max={1000} step={1} value={sliderFromFreq(f)} onChange={(v) => set({ freqHz: Math.round(freqFromSlider(v)) })} display={<span data-freq={Math.round(f)}>{formatHz(f)}</span>} valueText={formatHz(f)} />
      <Slider label="Level" min={0} max={130} step={1} value={L} onChange={(v) => set({ levelDb: v })} display={`${Math.round(L)} dB SPL`} valueText={`${Math.round(L)} decibels SPL`} />
      <div className="row tone-row">
        <button type="button" className={tone ? 'primary small-button' : 'secondary small-button'} aria-pressed={tone} onClick={toggleTone}>{tone ? '■ Stop tone' : '▶ Play tone'}</button>
        <span className="muted small">Optional. Volume is capped; start with your device quiet.</span>
      </div>

      <h3 className="group-title">The travelling wave</h3>
      <LiveWave freqHz={f} levelDb={L} playing={state.playing} />
      <p className="muted small">High notes peak near the stiff, narrow base; low notes travel on to the wide, floppy apex (Greenwood’s map). The shape is qualitative; the wave is slowed about a thousandfold.</p>

      <Readout rows={[
        { label: 'Place of the peak', value: `${place.mmFromBase.toFixed(1)} mm from the base (of ${COCHLEA_LENGTH_MM})`, data: { place: place.mmFromBase.toFixed(1) } },
        { label: 'Middle-ear gain', value: `×${gain.pressureGain.toFixed(0)} pressure, +${gain.gainDb.toFixed(0)} dB` },
        { label: '', value: <span className="muted">area ratio {gain.areaRatio.toFixed(0)} × lever {gain.leverRatio}</span> },
        { label: 'Ear-canal resonance', value: `≈ ${formatHz(resonance)}${near ? ' · boosts this tone' : ''}` },
        {
          label: 'Audible?',
          value: audible ? `Yes, ${Math.round(L - threshold)} dB above threshold` : `No: threshold here is ${Math.round(threshold)} dB SPL`,
          tone: audible ? 'ok' : 'warn', data: { audible: String(audible) },
        },
      ]} />

      <h3 className="group-title">Noise exposure</h3>
      <NoiseMeter dBA={dBA} />
      <p className={`small risk risk-${risk.risk}`} data-risk={risk.risk} aria-live="polite">
        <strong>{Math.round(dBA)} dBA</strong> · {risk.label}. Safe daily exposure: <strong>{formatMinutes(risk.safeMinutes)}</strong>.
      </p>
      <p className="muted small">NIOSH limit: 85 dBA for 8 hours, halving for every 3 dB more (100 dBA: 15 minutes). The tone is A-weighted ({aWeightingDb(f) >= 0 ? '+' : ''}{aWeightingDb(f).toFixed(1)} dB at {formatHz(f)}) because the ear is less sensitive to low and very high frequencies.</p>

      <p className="legend-row small"><span><span className="dot" style={{ background: SOUND }} aria-hidden="true" /> Pressure fronts (spacing not to scale)</span><span><span className="dot" style={{ background: '#ff3d6e' }} aria-hidden="true" /> Wave on the basilar membrane</span></p>
      <p className="muted small">At the threshold of hearing the eardrum moves less than the width of an atom; here everything is slowed down and enlarged many thousands of times so it can be seen.</p>

      {route && (
        <details className="more">
          <summary>{route.label}: step by step</summary>
          <RouteSteps route={route} colour={SOUND} />
        </details>
      )}
      <SourcesLine items={['Greenwood 1990 (place map)', 'Pickles 2012 (middle ear, travelling wave)', 'ISO 226:2003 (threshold)', 'NIOSH 1998 (exposure limits)', 'IEC 61672-1 (A-weighting)']} />
    </section>
  );
}
