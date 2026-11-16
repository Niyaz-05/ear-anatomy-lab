import type { KeyboardEvent, MouseEvent } from 'react';
import { AUDIOGRAM_FREQUENCIES, BONE_FREQUENCIES, type Audiogram as AudiogramData, type Side } from '../ear/audiology';

export const RIGHT = '#d0312d';
export const LEFT = '#1f5fbf';
const W = 300, H = 236, X0 = 34, X1 = 246, Y0 = 18, Y1 = 214;
const DB_MIN = -10, DB_MAX = 120;
const xOf = (f: number) => X0 + 10 + (Math.log2(f / 250) / 5) * (X1 - X0 - 20);
const yOf = (db: number) => Y0 + ((db - DB_MIN) / (DB_MAX - DB_MIN)) * (Y1 - Y0);
const dbOf = (y: number) => DB_MIN + ((y - Y0) / (Y1 - Y0)) * (DB_MAX - DB_MIN);
const BANDS = [
  { from: 20, to: 35, label: 'mild' }, { from: 35, to: 50, label: 'moderate' }, { from: 50, to: 65, label: 'mod.-severe' },
  { from: 65, to: 80, label: 'severe' }, { from: 80, to: 95, label: 'profound' }, { from: 95, to: 120, label: 'complete' },
];
const fLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

export interface Editing { ear: Side; path: 'air' | 'bone'; onSet: (freq: number, db: number) => void }

/**
 * A pure-tone audiogram in the standard form: frequency 250 Hz–8 kHz across, hearing level in dB HL
 * downwards (worse hearing lower), right ear red O and left ear blue X for air conduction, unmasked
 * bone conduction < (right) and > (left), with the WHO grades shaded. When `editing` is given, a click
 * sets that ear's threshold at the nearest frequency, and each symbol can be moved with the arrow keys.
 */
export function Audiogram({ data, editing, label }: { data: AudiogramData; editing?: Editing; label: string }) {
  const airPath = (ear: Side) => AUDIOGRAM_FREQUENCIES.map((f, i) => `${i ? 'L' : 'M'} ${xOf(f).toFixed(1)} ${yOf(data[ear].air[f]).toFixed(1)}`).join(' ');
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!editing) return;
    const svg = e.currentTarget, pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    if (p.y < Y0 - 6 || p.y > Y1 + 6) return;
    const freqs = editing.path === 'air' ? AUDIOGRAM_FREQUENCIES : BONE_FREQUENCIES;
    const f = freqs.reduce((a, b) => (Math.abs(xOf(b) - p.x) < Math.abs(xOf(a) - p.x) ? b : a));
    editing.onSet(f, dbOf(p.y));
  };
  const key = (ear: Side, path: 'air' | 'bone', f: number, db: number) => (e: KeyboardEvent) => {
    if (!editing || editing.ear !== ear || editing.path !== path) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); editing.onSet(f, db - 5); }
    if (e.key === 'ArrowDown') { e.preventDefault(); editing.onSet(f, db + 5); }
  };
  const symbol = (ear: Side, path: 'air' | 'bone', f: number) => {
    const db = path === 'air' ? data[ear].air[f as keyof AudiogramData['right']['air']] : data[ear].bone[f as keyof AudiogramData['right']['bone']];
    const x = xOf(f) + (path === 'bone' ? (ear === 'right' ? -8 : 8) : 0), y = yOf(db);
    const c = ear === 'right' ? RIGHT : LEFT;
    const active = editing && editing.ear === ear && editing.path === path;
    const shape = path === 'air'
      ? ear === 'right' ? <circle cx={x} cy={y} r={4.6} fill="#fff" stroke={c} strokeWidth={1.7} /> : <path d={`M ${x - 4} ${y - 4} L ${x + 4} ${y + 4} M ${x + 4} ${y - 4} L ${x - 4} ${y + 4}`} stroke={c} strokeWidth={1.9} />
      : ear === 'right' ? <path d={`M ${x + 3} ${y - 5} L ${x - 3} ${y} L ${x + 3} ${y + 5}`} fill="none" stroke={c} strokeWidth={1.7} /> : <path d={`M ${x - 3} ${y - 5} L ${x + 3} ${y} L ${x - 3} ${y + 5}`} fill="none" stroke={c} strokeWidth={1.7} />;
    return (
      <g key={`${ear}-${path}-${f}`} className={active ? 'aud-point active' : 'aud-point'} data-ear={ear} data-path={path} data-freq={f} data-db={db}
        {...(active ? { tabIndex: 0, role: 'slider', 'aria-label': `${ear} ear, ${path} conduction, ${f} Hz`, 'aria-valuemin': -10, 'aria-valuemax': 120, 'aria-valuenow': db, 'aria-valuetext': `${db} dB HL`, onKeyDown: key(ear, path, f, db) } : {})}>
        {active && <circle cx={x} cy={y} r={8} fill={c} opacity={0.12} />}
        {shape}
      </g>
    );
  };
  return (
    <svg className={`audiogram${editing ? ' editable' : ''}`} viewBox={`0 0 ${W} ${H}`} role={editing ? 'group' : 'img'} aria-label={label} onClick={onClick}>
      <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill="#fff" stroke="currentColor" strokeOpacity={0.25} />
      {BANDS.map((b, i) => (
        <g key={b.label}>
          <rect x={X0} y={yOf(b.from)} width={X1 - X0} height={yOf(b.to) - yOf(b.from)} fill={i % 2 ? '#f3f6f9' : '#e9eef3'} />
          <text x={X1 + 4} y={(yOf(b.from) + yOf(b.to)) / 2 + 3} fontSize="8.8" fill="currentColor" opacity={0.65}>{b.label}</text>
        </g>
      ))}
      <text x={X1 + 4} y={(yOf(-10) + yOf(20)) / 2 + 3} fontSize="8.8" fill="currentColor" opacity={0.65}>normal</text>
      {Array.from({ length: 14 }, (_, i) => DB_MIN + i * 10).map((db) => (
        <g key={db}>
          <line x1={X0} x2={X1} y1={yOf(db)} y2={yOf(db)} stroke="currentColor" strokeOpacity={db === 0 ? 0.35 : 0.1} />
          {db % 20 === 0 && <text x={X0 - 4} y={yOf(db) + 3} fontSize="9.2" textAnchor="end" fill="currentColor" opacity={0.8}>{db}</text>}
        </g>
      ))}
      {AUDIOGRAM_FREQUENCIES.map((f) => (
        <g key={f}>
          <line x1={xOf(f)} x2={xOf(f)} y1={Y0} y2={Y1} stroke="currentColor" strokeOpacity={f === 3000 || f === 6000 ? 0.06 : 0.12} strokeDasharray={f === 3000 || f === 6000 ? '2 2' : undefined} />
          <text x={xOf(f)} y={Y0 - 5} fontSize="9.2" textAnchor="middle" fill="currentColor" opacity={0.85}>{fLabel(f)}</text>
        </g>
      ))}
      <text x={X0 - 4} y={9} fontSize="8.8" textAnchor="end" fill="currentColor" opacity={0.7}>dB HL</text>
      <text x={(X0 + X1) / 2} y={H - 6} fontSize="9.2" textAnchor="middle" fill="currentColor" opacity={0.7}>Frequency (Hz) · worse hearing is lower</text>
      <path d={airPath('right')} fill="none" stroke={RIGHT} strokeWidth={1.4} />
      <path d={airPath('left')} fill="none" stroke={LEFT} strokeWidth={1.4} strokeDasharray="4 2.5" />
      {(['right', 'left'] as const).flatMap((ear) => [
        ...BONE_FREQUENCIES.map((f) => symbol(ear, 'bone', f)),
        ...AUDIOGRAM_FREQUENCIES.map((f) => symbol(ear, 'air', f)),
      ])}
    </svg>
  );
}

export function AudiogramKey() {
  return (
    <p className="legend-row small audiogram-key">
      <span><span style={{ color: RIGHT }} aria-hidden="true">○</span> right air</span>
      <span><span style={{ color: LEFT }} aria-hidden="true">✕</span> left air</span>
      <span><span style={{ color: RIGHT }} aria-hidden="true">&lt;</span> right bone</span>
      <span><span style={{ color: LEFT }} aria-hidden="true">&gt;</span> left bone</span>
    </p>
  );
}
