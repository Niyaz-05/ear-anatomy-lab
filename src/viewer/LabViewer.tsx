import { Component, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { useLab } from '../app/LabContext';
import { isTouch } from '../app/layout';
import { EarModel, MODEL_URL } from './EarModel';
import { CameraRig, type ViewInsets } from './CameraRig';
import { Lighting } from './Lighting';
import { LabelLayer } from './LabelLayer';
import { hasWebGL, prefersReducedMotion } from './webgl';
import { homeBounds } from '../ear/anchors';
import { effectiveMode, effectiveSim, type Sim } from '../app/state';
import { HearingScene } from './HearingScene';
import { BalanceScene, OtoconiaScene } from './BalanceScene';
import { ImplantScene, OssicleLabels, PressureScene } from './CloseupScenes';
import { balanceLive } from '../app/live';
import { ambientKPa } from '../app/sim';

const pressureDifference = (sim: Sim) => ambientKPa(sim) - sim.middleEarKPa;

/** With reduced motion the canvas renders on demand: redraw when the balance simulation changes. */
function InvalidateOnBalance() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => balanceLive.subscribe(() => invalidate()), [invalidate]);
  return null;
}

class SceneBoundary extends Component<{ onError: (e: Error) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function LoadingOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="viewer-status" role="status">
      <div className="spinner" aria-hidden="true" />
      Loading the ear… {Math.round(progress)}%
    </div>
  );
}

/** Keyboard camera control: arrows orbit, +/- zoom. Esc and 0 are handled by the lab shell. */
function KeyboardOrbit({ host }: { host: React.RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const el = host.current;
    if (!el || !controls) return;
    const onKey = (e: KeyboardEvent) => {
      const step = Math.PI / 18;
      const offset = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      if (e.key === 'ArrowLeft') sph.theta -= step;
      else if (e.key === 'ArrowRight') sph.theta += step;
      else if (e.key === 'ArrowUp') sph.phi = Math.max(0.05, sph.phi - step);
      else if (e.key === 'ArrowDown') sph.phi = Math.min(Math.PI - 0.05, sph.phi + step);
      else if (e.key === '+' || e.key === '=') sph.radius *= 0.85;
      else if (e.key === '-' || e.key === '_') sph.radius /= 0.85;
      else return;
      e.preventDefault();
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [host, camera, controls, invalidate]);
  return null;
}

const NO_INSETS: ViewInsets = { left: 0, right: 0, top: 0, bottom: 0 };

export function LabViewer({ insets = NO_INSETS }: { insets?: ViewInsets }) {
  const { def, state, dispatch } = useLab();
  const [webgl] = useState(hasWebGL);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const mode = effectiveMode(def, state);
  const sim = effectiveSim(def, state);
  const closeup = mode === 'closeups' ? sim.closeup : null;
  const usesBalance = mode === 'balance' || closeup === 'crista' || closeup === 'macula';
  const rotating = closeup === 'ossicles' && state.playing && !reducedMotion;
  // Hearing vibrates continuously; balance, the close-ups and the implant move while they change.
  const animating = !reducedMotion && state.playing && (mode === 'hearing' || usesBalance || mode === 'closeups');

  if (!webgl) {
    return (
      <div className="viewer viewer-fallback" role="note">
        <h2>3D view unavailable</h2>
        <p>This browser or device could not start WebGL, which the 3D model needs. You can still use the structure list, search and explanations, and the hearing and balance panels.</p>
        <p className="muted">To get the 3D view, turn on hardware acceleration in your browser settings or try another browser.</p>
      </div>
    );
  }

  const [lo, hi] = homeBounds(def, mode);
  const radius = new THREE.Vector3(...lo).distanceTo(new THREE.Vector3(...hi)) / 2;
  const modelRadius = Math.max(radius, 0.03);

  return (
    <div
      className="viewer"
      ref={host}
      tabIndex={0}
      data-ready={ready && !error ? 'true' : 'false'}
      aria-label="3D model of the right ear in the temporal bone. Drag to rotate, scroll or pinch to zoom, right-drag to pan. Arrow keys rotate, plus and minus zoom."
    >
      {error ? (
        <div className="viewer-status is-error" role="alert">
          <strong>The 3D model could not be loaded.</strong>
          <span className="muted">{error}</span>
          <button
            type="button"
            onClick={() => {
              // The loader caches a failed request; drop it so the retry really fetches again.
              useGLTF.clear(MODEL_URL);
              setError(null);
              setReady(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <SceneBoundary key={attempt} onError={(e) => setError(e.message || 'Unknown error')}>
          <Canvas
            frameloop={animating ? 'always' : 'demand'}
            // Phones and tablets: a lower pixel ratio keeps the frame rate up on small GPUs.
            dpr={isTouch() ? [1, 1.5] : [1, 2]}
            camera={{ fov: 32, near: 0.0003, far: 3, position: [radius * 4, 0, 0] }}
            gl={{ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' }}
            onPointerMissed={(e) => {
              if (e.type !== 'click') return;
              dispatch({ type: 'hover', id: null });
              // On a touch screen there is no Esc key: a tap on empty space closes the details.
              if (isTouch() && state.selected && state.mode !== 'tour') dispatch({ type: 'select', id: state.selected });
            }}
            onCreated={({ gl }) => {
              gl.localClippingEnabled = true;
              gl.domElement.addEventListener('webglcontextlost', (ev) => {
                ev.preventDefault();
                setError('The graphics context was lost (the GPU may have been reset).');
              });
            }}
            aria-hidden="true"
          >
            <Lighting />
            <Suspense fallback={null}>
              <EarModel onReady={onReady} />
              {mode === 'hearing' && <HearingScene freqHz={sim.freqHz} levelDb={sim.levelDb} playing={state.playing} reducedMotion={reducedMotion} labels={labels} />}
              {usesBalance && <BalanceScene pitchDeg={sim.pitchDeg} rollDeg={sim.rollDeg} accelMs2={sim.accelMs2} labels={labels} show={closeup === 'crista' ? 'canals' : closeup === 'macula' ? 'maculae' : 'all'} />}
              {usesBalance && reducedMotion && <InvalidateOnBalance />}
              {closeup === 'ossicles' && <OssicleLabels labels={labels} />}
              {closeup === 'pressure' && <PressureScene differenceKPa={pressureDifference(sim)} reducedMotion={reducedMotion} labels={labels} />}
              {closeup === 'bppv' && <OtoconiaScene epleyStep={sim.epleyStep} hallpike={sim.hallpikeSide} labels={labels} reducedMotion={reducedMotion} />}
              {mode === 'clinic' && sim.clinicView === 'devices' && <ImplantScene electrodes={sim.implantElectrodes} depthMm={sim.implantDepthMm} labels={labels} />}
            </Suspense>
            <OrbitControls
              makeDefault
              enableDamping={!reducedMotion}
              dampingFactor={0.12}
              minDistance={0.004}
              maxDistance={modelRadius * 8}
              zoomToCursor
              rotateSpeed={0.8}
              autoRotate={rotating}
              autoRotateSpeed={1.2}
            />
            <CameraRig reducedMotion={reducedMotion} insets={insets} />
            <KeyboardOrbit host={host} />
            <LabelLayer container={labels} />
          </Canvas>
          <LoadingOverlay />
        </SceneBoundary>
      )}
      <div className="label-layer" ref={labels} />
      {!error && (mode === 'hearing' || usesBalance || closeup === 'pressure') && (
        <p className="viewer-badge" aria-hidden="true">{mode === 'hearing' ? 'Slowed down · movement exaggerated' : closeup === 'pressure' ? 'Eardrum movement exaggerated' : 'Cupula and otoconia movement exaggerated'}</p>
      )}
    </div>
  );
}
