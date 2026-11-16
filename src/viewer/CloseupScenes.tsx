import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { anchors } from '../ear/anchors';
import { DRUM_NORMAL, OSSICLE_PARTS, OSSICULAR_AXIS, SCALA_TYMPANI_OFFSET, cochleaPointAt } from '../ear/parts';
import { implantCoverage } from '../ear/audiology';
import { drumDisplacement } from '../ear/pressure';
import { formatHz, logFraction } from '../app/visual';
import { W, deformer, findMesh, resetMesh, useArrow } from './sceneUtil';
import { PointLabels, type PointLabel } from './PointLabels';

/** Labels on the parts of the ossicles and their joints (the ossicle close-up). */
export function OssicleLabels({ labels }: { labels: RefObject<HTMLDivElement | null> }) {
  const items = useMemo<PointLabel[]>(() => OSSICLE_PARTS.map((p) => ({ key: p.id, text: p.label, p: W(p.p), tone: p.bone === 'joint' ? 'warn' : 'part' })), []);
  return <PointLabels container={labels} items={items} />;
}

const DRUM_R = 0.0044;
/** Drawn displacement of the drum's centre at the largest pressure difference, metres (exaggerated). */
const BULGE = 0.0011;

/**
 * The eardrum bulging with the pressure difference across it (ambient − middle ear; + pushes it in),
 * with the handle of the malleus following it, and an arrow for the net push.
 */
export function PressureScene({ differenceKPa, reducedMotion, labels }: { differenceKPa: number; reducedMotion: boolean; labels: RefObject<HTMLDivElement | null> }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const target = drumDisplacement(differenceKPa);
  const now = useRef(target);
  const arrow = useArrow('#c8443b', 0.00016);
  const geo = useMemo(() => {
    const inward = W(DRUM_NORMAL).normalize().negate();
    const axisDir = W(OSSICULAR_AXIS.dir).normalize(), axisPt = W(OSSICULAR_AXIS.point), umbo = W(anchors.umbo);
    const test = umbo.clone().sub(axisPt).applyAxisAngle(axisDir, 0.01).add(axisPt).sub(umbo);
    return { inward, axisDir, axisPt, sign: test.dot(inward) > 0 ? 1 : -1, lever: umbo.clone().sub(axisPt).cross(axisDir).length() };
  }, []);
  const meshes = useRef<Record<string, THREE.Mesh | null>>({});
  useEffect(() => () => {
    const m = meshes.current;
    if (m.tm) deformer(m.tm).restore();
    resetMesh(m.malleus ?? null); resetMesh(m.incus ?? null);
    invalidate();
  }, [invalidate]);
  const items = useMemo<PointLabel[]>(() => [{ key: 'drum', text: '', p: new THREE.Vector3(), tone: 'warn' }], []);
  const text = Math.abs(target) < 0.04 ? 'Eardrum at rest' : target > 0 ? 'Eardrum pushed in' : 'Eardrum bulging out';
  const shown = useMemo<PointLabel[]>(() => [{ ...items[0]!, text }], [items, text]);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const m = meshes.current;
    if (!m.tm) { m.tm = findMesh(scene, 'tympanic-membrane'); m.malleus = findMesh(scene, 'malleus'); m.incus = findMesh(scene, 'incus'); }
    now.current = reducedMotion ? target : now.current + (target - now.current) * Math.min(1, dt * 4);
    const d = now.current * BULGE;
    const n = geo.inward;
    if (m.tm) deformer(m.tm).apply(n, (x, y, z) => {
      const r2 = x * x + y * y + z * z - (x * n.x + y * n.y + z * n.z) ** 2;
      return d * Math.max(0, 1 - r2 / (DRUM_R * DRUM_R));
    });
    q.setFromAxisAngle(geo.axisDir, (geo.sign * d * 0.8) / geo.lever);
    for (const mesh of [m.malleus, m.incus]) {
      if (!mesh) continue;
      mesh.quaternion.copy(q);
      mesh.position.copy(geo.axisPt).sub(tmp.copy(geo.axisPt).applyQuaternion(q));
    }
    const len = Math.abs(now.current) * 0.0035;
    const dir = n.clone().multiplyScalar(Math.sign(now.current) || 1);
    arrow.set(new THREE.Vector3().addScaledVector(dir, -len - 0.0012), dir, len);
    items[0]!.p.copy(n).multiplyScalar(-0.0045);
    shown[0]!.p.copy(items[0]!.p);
  });
  return (
    <>
      <primitive object={arrow.object} />
      <PointLabels container={labels} items={shown} />
    </>
  );
}

/**
 * A cochlear-implant electrode array in the scala tympani: contacts at their places along the
 * cochlea (coloured by the channel frequency they are given, red low → blue high) and the lead
 * entering through the round window.
 */
export function ImplantScene({ electrodes, depthMm, labels }: { electrodes: number; depthMm: number; labels: RefObject<HTMLDivElement | null> }) {
  const cov = useMemo(() => implantCoverage({ electrodeCount: electrodes, insertionDepthMm: depthMm }), [electrodes, depthMm]);
  const off = SCALA_TYMPANI_OFFSET;
  const at = (mm: number) => {
    const p = cochleaPointAt(mm);
    return W([p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
  };
  const group = useMemo(() => {
    const g = new THREE.Group();
    const pts: THREE.Vector3[] = [W(anchors['round-window']).addScaledVector(W(anchors['round-window']).sub(W(anchors['cochlea-base'])).normalize(), 0.0025), W(anchors['round-window'])];
    for (let mm = 0.5; mm <= depthMm; mm += 0.5) pts.push(at(mm));
    pts.push(at(depthMm));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const lead = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(40, pts.length * 3), 0.0001, 8, false), new THREE.MeshBasicMaterial({ color: '#8a96a8', depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }));
    lead.renderOrder = 8;
    g.add(lead);
    const c = new THREE.Color();
    for (const e of cov.electrodes) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.00017, 12, 8), new THREE.MeshBasicMaterial({ color: c.setHSL(0.66 * logFraction(e.assignedHz), 0.85, 0.5).getHex(), depthTest: false, transparent: true, toneMapped: false }));
      m.position.copy(at(e.mmFromBase));
      m.renderOrder = 9;
      g.add(m);
    }
    return g;
    // `at` only reads anchors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cov, depthMm]);
  useEffect(() => () => group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }), [group]);
  const items = useMemo<PointLabel[]>(() => [
    { key: 'tip', text: `Tip: ${formatHz(cov.lowestPlaceHz)} place`, p: at(cov.electrodes[0]!.mmFromBase) },
    { key: 'base', text: `Basal contact: ${formatHz(cov.highestPlaceHz)}`, p: at(cov.electrodes[cov.electrodes.length - 1]!.mmFromBase) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cov]);
  return (
    <>
      <primitive object={group} />
      <PointLabels container={labels} items={items} />
    </>
  );
}
