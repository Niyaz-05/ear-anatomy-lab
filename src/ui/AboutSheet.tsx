import { useEffect, useRef } from 'react';
import { useLab } from '../app/LabContext';
import { ENDOLYMPH, LAYER_COLOUR, PERILYMPH } from '../viewer/palette';

/**
 * Source, scope and credits, kept off the main screen. The BodyParts3D attribution
 * required by CC BY 4.0 lives here and is reachable from the ⓘ button and the "Source & credits" link.
 */
export function AboutSheet({ onClose }: { onClose: () => void }) {
  const { def } = useLab();
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    title.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="about-sheet glass" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ghost sheet-close" onClick={onClose} aria-label="Close">✕</button>
        <p className="eyebrow">Source &amp; scope</p>
        <h2 id="about-title" className="sheet-title" tabIndex={-1} ref={title}>About this lab</h2>
        <p>{def.summary}</p>

        <h3 className="group-title">You will learn to</h3>
        <ul className="objectives">
          {def.learningObjectives.map((o) => <li key={o.id}>{o.text}</li>)}
        </ul>

        <h3 className="group-title">Colours</h3>
        <p className="small muted">
          “Real” shows the tissues as they look: ivory bone, skin over the auricle, a pearly eardrum, the ossicles, clear
          perilymph (pale aqua) and endolymph (lavender) spaces, cream-yellow nerves, a red artery and a blue venous sinus. The
          bony cochlea, the air spaces and the skull are drawn see-through. “Layers” gives each layer its own colour.
        </p>
        <p className="legend-row">
          {def.layers.map((l) => (
            <span key={l.id}><span className="dot" style={{ background: LAYER_COLOUR[l.id] }} aria-hidden="true" /> {l.label}</span>
          ))}
        </p>
        <p className="legend-row">
          <span><span className="dot" style={{ background: PERILYMPH }} aria-hidden="true" /> Perilymph</span>
          <span><span className="dot" style={{ background: ENDOLYMPH }} aria-hidden="true" /> Endolymph</span>
        </p>

        <h3 className="group-title">Pathways</h3>
        <ul className="small disclaimers">
          {def.routes.flatMap((r) => r.assumptions).map((a) => <li key={a}>{a}</li>)}
        </ul>

        <h3 className="group-title">Please note</h3>
        <ul className="small disclaimers">
          {def.disclaimers.map((d) => <li key={d}>{d}</li>)}
        </ul>

        <h3 className="group-title">Source</h3>
        <p className="small">
          Auricle, right temporal bone and skull: BodyParts3D, © The Database Center for Life Science, licensed under CC
          Attribution 4.0 International. Everything inside the temporal bone (canal, eardrum, ossicles and muscles, middle-ear
          spaces, cochlea, vestibule, canals, nerves and landmark vessels) is modelled for this lab from standard adult
          dimensions (Gray’s Anatomy 42e; Pickles 2012; Della Santina et al. 2005). DBCLS has not reviewed or endorsed this lab.
        </p>
        <div className="link-list small">
          <a href={`${import.meta.env.BASE_URL}ATTRIBUTION.md`} target="_blank" rel="noopener">Attribution and changes made ↗</a>
          <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html" target="_blank" rel="noopener noreferrer">BodyParts3D ↗</a>
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0 licence ↗</a>
        </div>
      </section>
    </div>
  );
}
