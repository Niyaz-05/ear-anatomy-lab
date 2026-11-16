import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { anchors } from '../ear/anchors';
import { DRUM_NORMAL, OSSICULAR_AXIS, PISTON_DIR, cochleaPath, cochleaPointAt } from '../ear/parts';
import { placeFromFrequency, travelingWave } from '../ear/hearing';
import { formatHz, ringSpacingM, visualAmplitude, visualHz } from '../app/visual';
import { W, deformer, findMesh, resetMesh, useArrow, useLatest } from './sceneUtil';
import { PointLabels, type PointLabel } from './PointLabels';

export const SOUND = '#2f6fd6';
const WAVE_DIM = new THREE.Color('#4a5a72');
const WAVE_HOT = new THREE.Color('#ff3d6e');
const MAX_RINGS = 14;
/** Drawn eardrum excursion at full level, metres (exaggerated: the real one is nanometres). */
const DRUM_MAX = 0.00045;
const DRUM_R = 0.0044;

/**
 * Hearing in 3D: pressure fronts travelling down the ear canal, the eardrum and ossicular chain
 * vibrating (malleus and incus rocking about the ossicular axis, the stapes as a piston), the oval
 * window pushed in while the round window bulges out, and the travelling wave on the basilar
 * membrane peaking at the tone's place. Slowed down and hugely exaggerated.
 */
export function HearingScene({ freqHz, levelDb, playing, reducedMotion, labels }: {
  freqHz: number; levelDb: number; playing: boolean; reducedMotion: boolean; labels: RefObject<HTMLDivElement | null>;
}) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const p = useLatest({ freqHz, levelDb, playing, reducedMotion });
  const time = useRef(0);

  // Ear canal centre line, drum → entrance, in world space.
  const canal = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(anchors['ear-canal-path'].map((q) => W(q)), false, 'centripetal');
    return { curve, length: curve.getLength() };
  }, []);
  const rings = useMemo(() => Array.from({ length: MAX_RINGS }, () => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 6, 40), new THREE.MeshBasicMaterial({ color: SOUND, transparent: true, depthWrite: false, toneMapped: false }));
    m.renderOrder = 7;
    m.raycast = () => {};
    return m;
  }), []);
  useEffect(() => () => rings.forEach((r) => { r.geometry.dispose(); (r.material as THREE.Material).dispose(); }), [rings]);

  // The basilar membrane as a glowing tube coloured by the wave.
  const bm = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(cochleaPath().map((q) => W(q)), false, 'centripetal');
    const SEG = 160, RAD = 8;
    const geometry = new THREE.TubeGeometry(curve, SEG, 0.00016, RAD, false);
    const colours = new Float32Array(geometry.getAttribute('position').count * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false }));
    mesh.renderOrder = 8;
    mesh.raycast = () => {};
    return { mesh, SEG, RAD };
  }, []);
  useEffect(() => () => { bm.mesh.geometry.dispose(); (bm.mesh.material as THREE.Material).dispose(); }, [bm]);
  const marker = useMemo(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.00034, 16, 12), new THREE.MeshBasicMaterial({ color: WAVE_HOT, depthTest: false, transparent: true, toneMapped: false }));
    m.renderOrder = 9;
    m.raycast = () => {};
    return m;
  }, []);
  useEffect(() => () => { marker.geometry.dispose(); (marker.material as THREE.Material).dispose(); }, [marker]);

  const ovalArrow = useArrow('#e0662f', 0.00011);
  const roundArrow = useArrow('#7a4fd6', 0.00011);

  // Fixed world-space vectors.
  const geo = useMemo(() => {
    const axisDir = W(OSSICULAR_AXIS.dir).normalize();
    const axisPt = W(OSSICULAR_AXIS.point);
    const normal = W(DRUM_NORMAL).normalize(); // lateral face
    const inward = normal.clone().negate();
    const umbo = W(anchors.umbo);
    // Which way to rock the chain so the umbo moves in with the drum (the mirror flips handedness).
    const test = umbo.clone().sub(axisPt).applyAxisAngle(axisDir, 0.01).add(axisPt).sub(umbo);
    const sign = test.dot(inward) > 0 ? 1 : -1;
    const lever = umbo.clone().sub(axisPt).cross(axisDir).length();
    const rwOut = W(anchors['round-window']).sub(W(anchors['cochlea-base'])).normalize();
    return {
      axisDir, axisPt, inward, sign, lever, rwOut,
      piston: W(PISTON_DIR).normalize(),
      lent: W(anchors['lenticular-process']),
      footplate: W(anchors['stapes-footplate']),
      roundWindow: W(anchors['round-window']),
    };
  }, []);

  const meshes = useRef<Record<string, THREE.Mesh | null>>({});
  const getMeshes = () => {
    const m = meshes.current;
    if (!m.malleus) for (const id of ['tympanic-membrane', 'malleus', 'incus', 'stapes', 'round-window']) m[id] = findMesh(scene, id);
    return m;
  };
  useEffect(() => () => {
    const m = meshes.current;
    ['malleus', 'incus', 'stapes', 'round-window'].forEach((id) => resetMesh(m[id] ?? null));
    if (m['tympanic-membrane']) deformer(m['tympanic-membrane']).restore();
    invalidate();
  }, [invalidate]);

  // Labels: the pressure fronts, the windows and the place of the tone.
  const place = placeFromFrequency(freqHz);
  const labelItems = useMemo<PointLabel[]>(() => [
    { key: 'waves', text: 'Pressure waves', p: canal.curve.getPointAt(0.62).clone() },
    { key: 'oval', text: 'Oval window', p: W(anchors['stapes-footplate']) },
    { key: 'round', text: 'Round window', p: W(anchors['round-window']) },
    { key: 'place', text: `${formatHz(freqHz)} place · ${place.mmFromBase.toFixed(1)} mm`, p: W(cochleaPointAt(place.mmFromBase)) },
  ], [canal, freqHz, place.mmFromBase]);

  const q = useMemo(() => new THREE.Quaternion(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const c = useMemo(() => new THREE.Color(), []);

  useFrame((_, dt) => {
    const { freqHz: f, levelDb: L, playing: run, reducedMotion: still } = p.current;
    if (run && !still) time.current += Math.min(dt, 0.1);
    const fv = visualHz(f);
    // Reduced motion: hold the moment of greatest compression at the drum.
    const t = still ? 0.25 / fv : time.current;
    const amp = visualAmplitude(L);
    const s = Math.sin(2 * Math.PI * fv * t); // pressure at the drum, + = compression (drum pushed in)

    // Pressure fronts: compressions where the phase is π/2, travelling inwards.
    const lambda = ringSpacingM(f);
    const len = canal.length;
    let k = 0;
    const first = Math.ceil(-0.25 + fv * t - 0.2);
    for (let n = first; k < MAX_RINGS; n++) {
      const d = lambda * (0.25 - fv * t + n);
      if (d < 0) continue;
      if (d > len + 0.004) break;
      const ring = rings[k++]!;
      ring.visible = true;
      const u = Math.min(1, d / len);
      canal.curve.getPointAt(u, ring.position);
      if (d > len) ring.position.addScaledVector(canal.curve.getTangentAt(1, tmp), d - len);
      ring.quaternion.setFromUnitVectors(zAxis, canal.curve.getTangentAt(u, tmp));
      ring.scale.setScalar(0.0024 + 0.0012 * u + Math.max(0, d - len) * 0.4);
      const fade = Math.min(1, d / 0.002) * Math.min(1, (len + 0.004 - d) / 0.004);
      (ring.material as THREE.MeshBasicMaterial).opacity = (0.25 + 0.7 * amp) * fade;
    }
    for (; k < MAX_RINGS; k++) rings[k]!.visible = false;

    // Eardrum and chain.
    const m = getMeshes();
    const drum = DRUM_MAX * amp * s;
    const tm = m['tympanic-membrane'];
    if (tm) {
      const n = geo.inward;
      deformer(tm).apply(n, (x, y, z) => {
        const r2 = x * x + y * y + z * z - (x * -n.x + y * -n.y + z * -n.z) ** 2;
        return drum * Math.max(0, 1 - r2 / (DRUM_R * DRUM_R));
      });
    }
    const angle = geo.sign * (drum * 0.9) / geo.lever;
    q.setFromAxisAngle(geo.axisDir, angle);
    for (const id of ['malleus', 'incus']) {
      const mesh = m[id];
      if (!mesh) continue;
      mesh.quaternion.copy(q);
      mesh.position.copy(geo.axisPt).sub(tmp.copy(geo.axisPt).applyQuaternion(q));
    }
    const lentMoved = tmp.copy(geo.lent).sub(geo.axisPt).applyQuaternion(q).add(geo.axisPt).sub(geo.lent);
    const piston = lentMoved.dot(geo.piston) * 1.6; // drawn a little larger so the piston shows
    if (m.stapes) m.stapes.position.copy(geo.piston).multiplyScalar(piston);
    if (m['round-window']) m['round-window'].position.copy(geo.rwOut).multiplyScalar(piston * 1.4);
    ovalArrow.set(geo.footplate.clone().addScaledVector(geo.piston, -0.0016 * Math.sign(s) - 0.0004), geo.piston.clone().multiplyScalar(Math.sign(s)), 0.0014 * Math.abs(s) * amp);
    roundArrow.set(geo.roundWindow.clone().addScaledVector(geo.rwOut, 0.0003), geo.rwOut.clone().multiplyScalar(Math.sign(s)), 0.0014 * Math.abs(s) * amp);

    // Travelling wave on the basilar membrane (slowed so it is in step with the chain).
    const wave = travelingWave(f, (fv * t) / f + 0.25 / f, 97);
    const pos = bm.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i <= bm.SEG; i++) {
      const j = Math.round((i / bm.SEG) * 96);
      const e = wave.envelope[j]!, dsp = still ? e : Math.abs(wave.displacement[j]!);
      const glow = Math.min(1, e * (0.3 + 0.7 * dsp) * (0.4 + 0.6 * amp));
      c.copy(WAVE_DIM).lerp(WAVE_HOT, glow);
      for (let r = 0; r <= bm.RAD; r++) pos.setXYZ(i * (bm.RAD + 1) + r, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    const place = placeFromFrequency(f);
    marker.position.copy(W(cochleaPointAt(place.mmFromBase)));
    marker.scale.setScalar(0.8 + 0.35 * (still ? 1 : Math.abs(wave.displacement[wave.peakIndex]!)));
  });

  return (
    <>
      {rings.map((r, i) => <primitive key={i} object={r} />)}
      <primitive object={bm.mesh} />
      <primitive object={marker} />
      <primitive object={ovalArrow.object} />
      <primitive object={roundArrow.object} />
      <PointLabels container={labels} items={labelItems} />
    </>
  );
}
