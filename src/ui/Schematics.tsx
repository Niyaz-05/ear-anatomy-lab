import { useState } from 'react';

/** Palette of the schematics (matching the 3D fluids and tissues). */
const C = {
  bone: '#efe4cb', boneLine: '#b9a67e', peri: '#d6eef6', endo: '#e6dcfa', bm: '#f08a72', organ: '#f6c6b4', organLine: '#c98a76',
  stria: '#d25a5a', ligament: '#f2c9b8', tm: '#f7f2d6', tmLine: '#c8b46e', nerve: '#e9c75a', ihc: '#e7775f', ohc: '#f09b62', ink: '#24334a',
  cupula: '#fbf8ff', otoconia: '#ffffff',
};

interface Part { id: string; label: string; text: string; x: number; y: number }

/**
 * Numbered markers on the figure and a key below it (legible at any width); tapping either picks
 * the part, which is ringed on the figure and described under the key.
 */
function useLabels(parts: Part[]) {
  const [sel, setSel] = useState<string | null>(null);
  const svg = parts.map((p, i) => (
    <g key={p.id} className={`schematic-marker${sel === p.id ? ' is-on' : ''}`} onClick={() => setSel(sel === p.id ? null : p.id)} aria-hidden="true">
      {sel === p.id && <circle cx={p.x} cy={p.y} r={10} fill="none" stroke="#e8692a" strokeWidth={2} />}
      <circle cx={p.x} cy={p.y} r={6.4} fill={sel === p.id ? '#e8692a' : C.ink} stroke="#fff" strokeWidth={1} />
      <text x={p.x} y={p.y + 3.1} fontSize="9.2" fontWeight={700} textAnchor="middle" fill="#fff">{i + 1}</text>
    </g>
  ));
  const chosen = parts.find((p) => p.id === sel);
  const key = (
    <>
      <ol className="schematic-key">
        {parts.map((p, i) => (
          <li key={p.id}>
            <button type="button" className="link" aria-pressed={sel === p.id} onClick={() => setSel(sel === p.id ? null : p.id)}>
              <span className="num" aria-hidden="true">{i + 1}</span>{p.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="small schematic-note" aria-live="polite">{chosen ? <><strong>{chosen.label}.</strong> {chosen.text}</> : <span className="muted">Pick a part to read about it.</span>}</p>
    </>
  );
  return { svg, note: key };
}

const COCHLEA_PARTS: Part[] = [
  { id: 'sv', label: 'Scala vestibuli', text: 'Perilymph (high Na⁺, like extracellular fluid), continuous with the vestibule; the stapes pushes on it at the oval window.', x: 150, y: 52 },
  { id: 'rm', label: 'Reissner’s membrane', text: 'Two cell layers thick; separates the endolymph of the cochlear duct from the perilymph of the scala vestibuli.', x: 176, y: 86 },
  { id: 'sm', label: 'Scala media: endolymph, +80 mV', text: 'The cochlear duct holds endolymph, rich in K⁺ (≈150 mM) and about +80 mV relative to perilymph (the endocochlear potential), which drives K⁺ into the hair cells.', x: 228, y: 90 },
  { id: 'stria', label: 'Stria vascularis', text: 'A vascular epithelium on the outer wall that secretes K⁺ into the endolymph and generates the endocochlear potential.', x: 252, y: 108 },
  { id: 'lig', label: 'Spiral ligament', text: 'Fibrous thickening of the outer wall that anchors the basilar membrane and recycles K⁺.', x: 266, y: 150 },
  { id: 'tm', label: 'Tectorial membrane', text: 'A gelatinous flap from the spiral limbus; the tallest stereocilia of the outer hair cells are embedded in it, so up-and-down motion of the basilar membrane shears the hair bundles.', x: 198, y: 95 },
  { id: 'ohc', label: 'Outer hair cells (3 rows)', text: 'About 12,000. Prestin in their walls makes them lengthen and shorten with their voltage (electromotility), amplifying the wave about 100-fold and sharpening its tuning: the cochlear amplifier.', x: 228, y: 122 },
  { id: 'ihc', label: 'Inner hair cell (1 row)', text: 'About 3,500. The true sensory cells: they release glutamate onto type I afferents, which make up about 95 % of the cochlear nerve.', x: 139, y: 117 },
  { id: 'tunnel', label: 'Tunnel of Corti', text: 'Triangular space framed by the inner and outer pillar cells; the stiff pillars carry the motion of the basilar membrane to the reticular lamina.', x: 175, y: 126 },
  { id: 'bm', label: 'Basilar membrane', text: 'Stretches from the osseous spiral lamina to the spiral ligament: narrow and stiff at the base, wide and floppy at the apex, so each place resonates with its own frequency.', x: 244, y: 143 },
  { id: 'st', label: 'Scala tympani', text: 'Perilymph; ends at the round window. A cochlear-implant array lies here.', x: 160, y: 196 },
  { id: 'osl', label: 'Osseous spiral lamina', text: 'A shelf of bone winding round the modiolus; the nerve fibres run through it to the hair cells.', x: 92, y: 134 },
  { id: 'sg', label: 'Spiral ganglion', text: 'Cell bodies of the cochlear nerve fibres, in Rosenthal’s canal in the modiolus; their axons form the cochlear nerve.', x: 40, y: 132 },
];

/**
 * One turn of the cochlea cut across: the three scalae, Reissner’s and the basilar membrane, the
 * organ of Corti with one row of inner and three of outer hair cells, the tectorial membrane, the
 * stria vascularis and the spiral ganglion. The organ of Corti rocks against the tectorial membrane,
 * shearing the hair bundles (the animation stops with reduced motion).
 */
export function CochleaSection() {
  const { svg, note } = useLabels(COCHLEA_PARTS);
  const hairs = (x: number, y: number, h: number) => (
    <g className="bundle" style={{ transformOrigin: `${x}px ${y}px` }}>
      {[0, 1, 2].map((i) => <line key={i} x1={x - 2.4 + i * 2.4} y1={y} x2={x - 2.4 + i * 2.4} y2={y - h * (0.55 + 0.22 * i)} stroke={C.ink} strokeWidth={0.9} />)}
    </g>
  );
  return (
    <figure className="schematic">
      <svg viewBox="0 0 300 244" role="img" aria-label="Cross-section of one turn of the cochlea: scala vestibuli above, the cochlear duct (scala media) with endolymph in the middle, scala tympani below; the organ of Corti on the basilar membrane with one row of inner and three rows of outer hair cells under the tectorial membrane; the stria vascularis on the outer wall and the spiral ganglion in the modiolus.">
        {/* bone around the duct, and the modiolus */}
        <rect x={0} y={0} width={300} height={244} fill={C.bone} rx={10} />
        <path d="M 62 40 C 100 14 230 14 270 70 C 296 108 292 168 262 200 C 222 238 120 236 74 214 C 60 206 56 190 60 176 L 60 90 C 58 70 56 50 62 40 Z" fill={C.peri} stroke={C.boneLine} strokeWidth={1.2} />
        {/* scala media: between Reissner's membrane, the stria and the basilar membrane */}
        <path d="M 116 116 L 250 70 C 262 92 264 118 262 140 L 214 140 L 130 134 Z" fill={C.endo} />
        {/* stria vascularis and spiral ligament on the outer wall */}
        <path d="M 250 70 C 262 92 264 118 262 140 L 270 140 C 274 116 272 90 260 64 Z" fill={C.stria} />
        <path d="M 262 140 L 270 140 C 276 118 274 92 262 64 C 284 92 290 150 268 186 C 262 170 262 156 262 140 Z" fill={C.ligament} />
        {/* osseous spiral lamina and spiral limbus */}
        <path d="M 30 126 L 130 130 L 130 138 L 30 140 Z" fill={C.bone} stroke={C.boneLine} strokeWidth={1} />
        <path d="M 96 128 C 100 112 116 108 128 114 L 132 130 Z" fill="#f2c9b6" stroke={C.organLine} strokeWidth={0.8} />
        {/* Reissner's membrane */}
        <line x1={118} y1={112} x2={252} y2={68} stroke="#8a6fbf" strokeWidth={1.3} />
        <g className="corti-rock" style={{ transformOrigin: '130px 134px' }}>
          {/* basilar membrane */}
          <path d="M 130 134 Q 196 140 262 140 L 262 144 Q 196 144 130 138 Z" fill={C.bm} />
          {/* organ of Corti: supporting cells, tunnel, hair cells */}
          <path d="M 136 134 C 140 116 156 108 172 106 C 196 104 222 110 238 138 Z" fill={C.organ} stroke={C.organLine} strokeWidth={0.8} />
          <path d="M 164 134 L 174 108 L 186 134 Z" fill="#fff6f0" stroke={C.organLine} strokeWidth={0.8} />
          <path d="M 148 126 C 146 118 148 112 152 110 C 157 112 158 118 156 126 Z" fill={C.ihc} />
          {[196, 206, 216].map((x, i) => <rect key={x} x={x - 3} y={110 + i} width={6} height={15} rx={3} fill={C.ohc} />)}
          {hairs(152, 110, 9)}
          {[196, 206, 216].map((x, i) => <g key={x}>{hairs(x, 110 + i, 8)}</g>)}
          {/* afferent fibres from the spiral ganglion through the lamina */}
          <path d="M 42 133 C 80 134 120 132 152 126 M 42 135 C 90 138 150 136 206 126 M 42 135 C 90 140 170 138 216 128" fill="none" stroke={C.nerve} strokeWidth={1.2} />
        </g>
        {/* tectorial membrane */}
        <path className="tm-flap" d="M 120 112 C 150 98 196 98 228 104 C 230 108 226 110 220 109 C 190 106 156 106 124 116 Z" fill={C.tm} stroke={C.tmLine} strokeWidth={0.9} style={{ transformOrigin: '122px 114px' }} />
        {/* spiral ganglion */}
        <ellipse cx={40} cy={133} rx={14} ry={10} fill="#f5df9c" stroke="#c9a24a" />
        {[[34, 130], [42, 128], [46, 136], [36, 137]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={2.2} fill="#c99a2a" />)}
        <text x={150} y={36} fontSize="8.8" textAnchor="middle" fill={C.ink} opacity={0.55}>perilymph</text>
        <text x={160} y={176} fontSize="8.8" textAnchor="middle" fill={C.ink} opacity={0.55}>perilymph</text>
        {svg}
      </svg>
      {note}
    </figure>
  );
}

/** A hair bundle at rest and deflected towards its tallest stereocilia: tip links open the channels. */
export function HairBundle() {
  const bundle = (ox: number, tilt: number, open: boolean) => {
    const heights = [26, 38, 50];
    const xs = [0, 12, 24];
    const tip = (i: number) => ({ x: ox + xs[i]! + Math.sin(tilt) * heights[i]!, y: 96 - Math.cos(tilt) * heights[i]! });
    return (
      <g>
        <rect x={ox - 10} y={96} width={48} height={14} rx={4} fill={C.ohc} opacity={0.75} />
        {xs.map((x, i) => { const t = tip(i); return <line key={i} x1={ox + x} y1={96} x2={t.x} y2={t.y} stroke={C.ink} strokeWidth={4} strokeLinecap="round" />; })}
        {[0, 1].map((i) => {
          const a = tip(i), b = { x: ox + xs[i + 1]! + Math.sin(tilt) * (heights[i]! + 7), y: 96 - Math.cos(tilt) * (heights[i]! + 7) };
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={open ? '#d2452f' : '#8a96a8'} strokeWidth={1.3} />;
        })}
        {[0, 1].map((i) => <circle key={i} cx={tip(i).x} cy={tip(i).y} r={2.6} fill={open ? '#3aa76d' : '#b8c0c8'} />)}
        {open && [0, 1].map((i) => <text key={i} x={tip(i).x - 8} y={tip(i).y - 3} fontSize="8.8" fill="#2e8b57" fontWeight={700}>K⁺↓</text>)}
      </g>
    );
  };
  return (
    <svg className="schematic small-schematic" viewBox="0 0 300 124" role="img" aria-label="Stereocilia in rows of rising height joined by tip links. Deflected towards the tallest row the tip links tighten, open mechanotransduction channels and K⁺ flows in.">
      {bundle(50, 0, false)}
      {bundle(190, 0.32, true)}
      <text x={62} y={120} fontSize="9.6" textAnchor="middle" fill={C.ink}>At rest: few channels open</text>
      <text x={210} y={120} fontSize="9.6" textAnchor="middle" fill={C.ink}>Towards the tallest: open, K⁺ in</text>
      <text x={250} y={22} fontSize="9.6" fill={C.ink} textAnchor="middle">tip links</text>
      <path d="M 238 26 L 226 40" stroke={C.ink} strokeOpacity={0.5} />
    </svg>
  );
}

/**
 * A crista ampullaris: the ridge of hair cells across the ampulla, their bundles in the cupula, which
 * spans the ampulla and bends with endolymph flow. `bend` −1…1 (+ = towards the utricle).
 */
export function CristaSection({ bend, excited }: { bend: number; excited: boolean | null }) {
  const d = Math.max(-1, Math.min(1, bend)) * 34;
  const cupula = `M 108 150 C ${108 + d * 0.2} 110 ${100 + d * 0.7} 70 ${96 + d} 34 L ${204 + d} 34 C ${200 + d * 0.7} 70 ${192 + d * 0.2} 110 192 150 Z`;
  return (
    <svg className="schematic" viewBox="0 0 300 200" role="img" aria-label={`Crista ampullaris: hair cells on a ridge with their bundles in the gelatinous cupula, which ${Math.abs(bend) < 0.05 ? 'is upright' : `bends towards the ${bend > 0 ? 'utricle' : 'canal'}`}.`}>
      <rect x={0} y={0} width={300} height={200} rx={10} fill={C.bone} />
      {/* the ampulla: duct from the canal (left) widening and opening into the utricle (right) */}
      <path d="M 0 70 L 60 70 C 80 30 220 22 244 54 L 300 54 L 300 150 L 244 150 C 236 178 66 182 60 134 L 0 134 Z" fill={C.endo} stroke={C.boneLine} />
      <text x={22} y={104} fontSize="9.6" fill={C.ink} opacity={0.7}>canal</text>
      <text x={270} y={104} fontSize="9.6" fill={C.ink} opacity={0.7} textAnchor="middle">utricle</text>
      {/* crista */}
      <path d="M 80 176 C 96 150 116 140 150 138 C 184 140 204 150 220 176 Z" fill="#f2b8a6" stroke={C.organLine} />
      <path className="cupula" d={cupula} fill={C.cupula} stroke="#b9a8de" strokeWidth={1.2} opacity={0.92} />
      {Array.from({ length: 7 }, (_, i) => {
        const x = 116 + i * 11.5, y = 146 - Math.sin((i / 6) * Math.PI) * 6;
        const a = (d / 34) * 0.55;
        return (
          <g key={i}>
            <rect x={x - 3.5} y={y} width={7} height={12} rx={3} fill={C.ihc} />
            {[0, 1, 2].map((k) => <line key={k} x1={x - 2 + k * 2} y1={y} x2={x - 2 + k * 2 + Math.sin(a) * (10 + k * 3)} y2={y - Math.cos(a) * (10 + k * 3)} stroke={C.ink} strokeWidth={0.8} />)}
            <line x1={x + 4} y1={y} x2={x + 4 + Math.sin(a) * 19} y2={y - Math.cos(a) * 19} stroke="#c8443b" strokeWidth={1.3} />
          </g>
        );
      })}
      <text x={150} y={192} fontSize="9.6" textAnchor="middle" fill={C.ink}>crista: hair cells, kinocilium (red) on the utricular side</text>
      <text x={150} y={28} fontSize="9.6" textAnchor="middle" fill={C.ink}>cupula</text>
      {Math.abs(bend) > 0.05 && (
        <g>
          <path d={`M ${bend > 0 ? 8 : 52} 122 L ${bend > 0 ? 52 : 8} 122`} stroke="#7a4fd6" strokeWidth={2} markerEnd="url(#crista-arrow)" />
          <text x={8} y={84} fontSize="9.6" fill="#7a4fd6">{bend > 0 ? 'ampullopetal' : 'ampullofugal'}</text>
        </g>
      )}
      <defs><marker id="crista-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7a4fd6" /></marker></defs>
      <text x={8} y={16} fontSize="9" fontWeight={700} fill={excited === null ? C.ink : excited ? '#c0582a' : '#2f6fd6'}>
        {excited === null ? 'At rest: steady firing' : excited ? 'Excited: firing rises' : 'Inhibited: firing falls'}
      </text>
    </svg>
  );
}

/** The striola: arrows mark each hair cell's kinocilium side, towards the striola in the utricle and away in the saccule. */
function polarityField(shape: (x: number, y: number) => boolean, striola: [number, number][], towards: boolean, step = 13) {
  const out: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let y = 6; y < 120; y += step) for (let x = 6; x < 150; x += step) {
    if (!shape(x, y)) continue;
    let best = striola[0]!, bd = Infinity;
    for (const p of striola) { const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (dd < bd) { bd = dd; best = p; } }
    if (bd < 30) continue;
    const l = Math.sqrt(bd);
    const s = towards ? 1 : -1;
    out.push({ x, y, dx: (s * (best[0] - x)) / l, dy: (s * (best[1] - y)) / l });
  }
  return out;
}

/**
 * The maculae seen face on (hair-cell polarity about the striola) and a section through the utricular
 * macula: otoconia on a gel layer over the hair cells, sliding with tilt or acceleration. `shear`
 * −1…1 is the sideways slide of the otoconial layer.
 */
export function MaculaSection({ shear }: { shear: number }) {
  const ut = { cx: 72, cy: 60, rx: 62, ry: 40 };
  const utShape = (x: number, y: number) => ((x - ut.cx) / ut.rx) ** 2 + ((y - ut.cy) / ut.ry) ** 2 < 1 && !((x - 70) ** 2 / 900 + (y - 110) ** 2 / 300 < 1);
  const utStriola = Array.from({ length: 30 }, (_, i) => { const t = i / 29; return [22 + t * 100, 52 + 18 * Math.sin(t * Math.PI) - 8 * t] as [number, number]; });
  const saShape = (x: number, y: number) => ((x - 75) / 34) ** 2 + ((y - 62) / 54) ** 2 < 1;
  const saStriola = Array.from({ length: 30 }, (_, i) => { const t = i / 29; return [70 + 14 * Math.sin(t * Math.PI * 1.2), 14 + t * 96] as [number, number]; });
  const arrows = (field: ReturnType<typeof polarityField>) => field.map((a, i) => (
    <path key={i} d={`M ${a.x - a.dx * 4} ${a.y - a.dy * 4} L ${a.x + a.dx * 4} ${a.y + a.dy * 4}`} stroke={C.ink} strokeWidth={1} markerEnd="url(#pol)" />
  ));
  const s = Math.max(-1, Math.min(1, shear)) * 18;
  return (
    <>
      <svg className="schematic" viewBox="0 0 300 140" role="img" aria-label="The utricular and saccular maculae face on. Hair cells are polarised towards the striola in the utricle and away from it in the saccule, so every direction of tilt excites some hair cells and inhibits others.">
        <defs><marker id="pol" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={C.ink} /></marker></defs>
        <g>
          <ellipse cx={ut.cx} cy={ut.cy} rx={ut.rx} ry={ut.ry} fill="#f6d2c4" stroke={C.organLine} />
          <polyline points={utStriola.map((p) => p.join(',')).join(' ')} fill="none" stroke="#c8443b" strokeWidth={5} strokeOpacity={0.35} strokeLinecap="round" />
          {arrows(polarityField(utShape, utStriola, true))}
          <text x={ut.cx} y={128} fontSize="9.6" textAnchor="middle" fill={C.ink}>Utricle (horizontal): towards the striola</text>
        </g>
        <g transform="translate(150 0)">
          <ellipse cx={75} cy={62} rx={34} ry={54} fill="#f6d2c4" stroke={C.organLine} />
          <polyline points={saStriola.map((p) => p.join(',')).join(' ')} fill="none" stroke="#c8443b" strokeWidth={5} strokeOpacity={0.35} strokeLinecap="round" />
          {arrows(polarityField(saShape, saStriola, false, 12))}
          <text x={75} y={128} fontSize="9.6" textAnchor="middle" fill={C.ink}>Saccule (vertical): away from it</text>
        </g>
      </svg>
      <svg className="schematic" viewBox="0 0 300 120" role="img" aria-label={`Section through the macula: otoconia on a gel layer over the hair cells, ${Math.abs(shear) < 0.05 ? 'at rest' : `sliding ${shear > 0 ? 'right' : 'left'} and bending the hair bundles`}.`}>
        <rect x={0} y={0} width={300} height={120} rx={10} fill={C.endo} />
        <rect x={20} y={88} width={260} height={22} rx={3} fill={C.organ} stroke={C.organLine} />
        {Array.from({ length: 11 }, (_, i) => {
          const x = 36 + i * 23;
          return (
            <g key={i}>
              <rect x={x - 5} y={78} width={10} height={16} rx={4} fill={C.ihc} />
              {[0, 1, 2].map((k) => <line key={k} x1={x - 3 + k * 2.5} y1={78} x2={x - 3 + k * 2.5 + s * 0.45} y2={64 - k * 2} stroke={C.ink} strokeWidth={0.9} />)}
            </g>
          );
        })}
        <g style={{ transform: `translateX(${s}px)` }} className="otoconia-layer">
          <rect x={22} y={50} width={256} height={16} rx={3} fill="#f7f2d6" stroke={C.tmLine} />
          {Array.from({ length: 34 }, (_, i) => {
            const x = 28 + i * 7.4, y = 30 + ((i * 37) % 13);
            return <path key={i} d={`M ${x} ${y} l 3.5 -4 l 3.5 4 l -3.5 4 z`} fill={C.otoconia} stroke="#b8a878" strokeWidth={0.6} />;
          })}
        </g>
        <text x={150} y={18} fontSize="9.6" textAnchor="middle" fill={C.ink}>otoconia (calcium carbonate) on the otolithic membrane</text>
        <text x={150} y={118} fontSize="9.6" textAnchor="middle" fill={C.ink} opacity={0.8}>hair cells of the macula</text>
      </svg>
    </>
  );
}

export interface Posture { posture: 'sitting' | 'supine' | 'side-lying'; headPitchDeg: number; headYawDeg: number; faceDeg: number | null; lyingOn: 'left' | 'right' | null }

/**
 * The patient's position for a step of the Epley manoeuvre: from the side (sitting, lying back with
 * the head hanging, or lying on one side) and the head seen from its crown (where the nose points;
 * the affected right ear is orange).
 */
export function PostureIcon({ p }: { p: Posture }) {
  const lying = p.posture !== 'sitting';
  const rot = p.faceDeg ?? p.headYawDeg;
  return (
    <svg className="schematic posture" viewBox="0 0 300 116" role="img" aria-label={`${p.posture === 'sitting' ? 'Sitting' : p.posture === 'supine' ? 'Lying back' : `Lying on the ${p.lyingOn} side`}, head ${p.faceDeg !== null ? `turned ${Math.abs(p.faceDeg)}° from facing the ceiling` : `turned ${Math.abs(p.headYawDeg)}°`} towards the ${rot >= 0 ? 'right' : 'left'}.`}>
      <rect x={0} y={0} width={300} height={116} rx={10} fill="#f4f6f8" />
      {/* couch */}
      <rect x={30} y={78} width={140} height={10} rx={3} fill="#c9d2dc" />
      <rect x={40} y={88} width={6} height={18} fill="#c9d2dc" /><rect x={154} y={88} width={6} height={18} fill="#c9d2dc" />
      {!lying ? (
        <g>
          <rect x={64} y={30} width={18} height={48} rx={8} fill="#7d9bc4" />
          <rect x={82} y={66} width={40} height={12} rx={6} fill="#5a7aa8" />
          <circle cx={73} cy={20} r={11} fill="#f1cdb9" stroke="#8a6a5a" transform={`rotate(${-p.headPitchDeg} 73 30)`} />
        </g>
      ) : (
        <g>
          <rect x={60} y={64} width={86} height={15} rx={7} fill={p.posture === 'side-lying' ? '#6a8abb' : '#7d9bc4'} />
          <rect x={146} y={66} width={46} height={11} rx={5} fill="#5a7aa8" />
          <g transform={`rotate(${p.headPitchDeg} 58 71)`}><circle cx={46} cy={71} r={11} fill="#f1cdb9" stroke="#8a6a5a" /></g>
        </g>
      )}
      <text x={100} y={14} fontSize="9.6" textAnchor="middle" fill={C.ink}>{p.posture === 'sitting' ? 'sitting' : p.posture === 'supine' ? `lying back, head ${p.headPitchDeg > 0 ? 'hanging ' + p.headPitchDeg + '°' : 'level'}` : `on the ${p.lyingOn} side`}</text>
      {/* head from the crown: nose = where the face points */}
      <g transform={`translate(240 58) rotate(${rot})`}>
        <ellipse cx={0} cy={0} rx={24} ry={28} fill="#f1cdb9" stroke="#8a6a5a" strokeWidth={1.2} />
        <path d="M -7 -26 L 0 -37 L 7 -26 Z" fill="#e2b29b" stroke="#8a6a5a" />
        <ellipse cx={25} cy={0} rx={4} ry={8} fill="#e8742a" stroke="#8a4a2a" />
        <ellipse cx={-25} cy={0} rx={4} ry={8} fill="#e8b9a3" stroke="#8a6a5a" />
      </g>
      <text x={240} y={110} fontSize="9.6" textAnchor="middle" fill={C.ink}>{lying ? 'from the crown (up = ceiling)' : 'from above (up = forwards)'}</text>
    </svg>
  );
}
