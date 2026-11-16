import { useEffect, useMemo, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { anchors, type CanalName } from '../ear/anchors';
import { G, gravityInHead, otolith, type CanalId } from '../ear/balance';
import { CANAL_ARC_DEG, canalFrame, canalPoint, canalTangent, posteriorCanalPoint } from '../ear/parts';
import { balanceLive } from '../app/live';
import { epleyManoeuvre } from '../ear/balance';
import { W } from './sceneUtil';
import { PointLabels, type PointLabel } from './PointLabels';

export const EXCITE = '#e8692a';
export const INHIBIT = '#2f6fd6';
const NAMES: CanalName[] = ['anterior', 'posterior', 'lateral'];
const ARROWS = 5;

/** A right-handed world basis (x along the canal away from the ampulla, y outwards, z the plane normal). */
function basis(name: CanalName) {
  const f = canalFrame(name);
  const t = W(canalTangent(f, 0)).normalize();
  const u = W(f.u).normalize();
  const n = new THREE.Vector3().crossVectors(t, u).normalize(); // right-handed by construction
  return { f, t, u, n, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, u, n)) };
}

/** A gelatinous cupula across the ampulla: a flap hinged on the crista, bending with the endolymph. */
function makeCupula() {
  const outer = new THREE.Group();
  const hinge = new THREE.Group();
  // A soft lens-shaped sail (thin across the duct), translucent like the gel it is.
  const mat = new THREE.MeshBasicMaterial({ color: '#fbf6ff', transparent: true, opacity: 0.72, depthTest: false, side: THREE.DoubleSide, toneMapped: false });
  const flap = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
  flap.scale.set(0.00009, 0.00062, 0.00052);
  flap.position.y = 0.00058;
  const crista = new THREE.Mesh(new THREE.SphereGeometry(0.00028, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e38d7d', depthTest: false, transparent: true, toneMapped: false }));
  crista.scale.set(1, 0.9, 1.8);
  flap.renderOrder = crista.renderOrder = 9;
  hinge.add(flap);
  outer.add(hinge, crista);
  return { outer, hinge, mats: [mat, crista.material as THREE.Material], geos: [flap.geometry, crista.geometry] };
}

function makeMacula(colour: string) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.00072, 0.00072, 0.00006, 40), new THREE.MeshBasicMaterial({ color: '#e7a093', depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }));
  const stones = new THREE.Mesh(new THREE.CylinderGeometry(0.00058, 0.00058, 0.0001, 40), new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.75, toneMapped: false }));
  base.renderOrder = 9; stones.renderOrder = 10;
  g.add(base, stones);
  return { g, stones, dispose: () => { [base, stones].forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }); } };
}

/**
 * Balance in 3D (right ear): endolymph flow arrows in each canal (orange where the flow excites the
 * canal's afferents, blue where it inhibits them), the cupula bending in each ampulla, and the
 * otoconial layers of the utricle and saccule shifting with tilt and linear acceleration. Driven by
 * the balance simulation (src/app/live.ts) and the tilt settings.
 */
export function BalanceScene({ pitchDeg, rollDeg, accelMs2, labels, show = 'all' }: {
  pitchDeg: number; rollDeg: number; accelMs2: number; labels: RefObject<HTMLDivElement | null>;
  /** Everything (Balance), or only the canals and cupulae (crista close-up), or only the maculae. */
  show?: 'all' | 'canals' | 'maculae';
}) {
  const canalsOn = show !== 'maculae', maculaeOn = show !== 'canals';
  const canals = useMemo(() => NAMES.map((name) => {
    const b = basis(name);
    const cup = makeCupula();
    cup.outer.position.copy(W(b.f.ampulla)).addScaledVector(b.u, -0.0004);
    cup.outer.quaternion.copy(b.q);
    const arrows = Array.from({ length: ARROWS }, () => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.00028, 0.0008, 12), new THREE.MeshBasicMaterial({ color: EXCITE, depthTest: false, transparent: true, toneMapped: false }));
      m.renderOrder = 9;
      m.raycast = () => {};
      return m;
    });
    return { name, id: `right-${name}` as CanalId, b, cup, arrows, phase: 0 };
  }), []);
  const utricle = useMemo(() => makeMacula('#ffffff'), []);
  const saccule = useMemo(() => makeMacula('#ffffff'), []);
  useEffect(() => {
    utricle.g.position.copy(W(anchors.utricle));
    saccule.g.position.copy(W(anchors.saccule));
    // The saccular macula stands vertically in a parasagittal plane: its normal is lateral.
    saccule.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), W([1, 0, 0]).normalize());
    return () => {
      utricle.dispose(); saccule.dispose();
      canals.forEach((c) => { c.cup.mats.forEach((m) => m.dispose()); c.cup.geos.forEach((g) => g.dispose()); c.arrows.forEach((a) => { a.geometry.dispose(); (a.material as THREE.Material).dispose(); }); });
    };
  }, [utricle, saccule, canals]);

  // Otolith shear for the tilt and acceleration (static): the otoconia lag opposite the specific force.
  const shear = useMemo(() => {
    const o = otolith(gravityInHead(pitchDeg, rollDeg), { x: 0, y: 0, z: accelMs2 });
    const k = 0.0005 / G;
    return {
      utricle: W([-o.gia.x * k, 0, -o.gia.z * k]),
      saccule: W([0, -(o.gia.y - G) * k, -o.gia.z * k]),
    };
  }, [pitchDeg, rollDeg, accelMs2]);

  const items = useMemo<PointLabel[]>(() => [
    ...(canalsOn ? NAMES.map((n) => ({ key: `cupula-${n}`, text: `Cupula (${n})`, p: W(anchors.ampullae[n]), tone: 'part' as const })) : []),
    ...(maculaeOn ? [
      { key: 'utricle', text: 'Utricular macula', p: W(anchors.utricle), tone: 'part' as const },
      { key: 'saccule', text: 'Saccular macula', p: W(anchors.saccule), tone: 'part' as const },
    ] : []),
  ], [canalsOn, maculaeOn]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  useFrame((_, dt) => {
    const r = balanceLive.readings;
    for (const c of canals) {
      const s = r[c.id];
      const mag = Math.min(1, Math.abs(s.stimulation) / 50);
      // Ampullofugal flow runs away from the ampulla (+ along the canal).
      const dir = s.flow === 'ampullofugal' ? 1 : s.flow === 'ampullopetal' ? -1 : 0;
      c.phase = (c.phase + dir * dt * (0.15 + 0.6 * mag)) % 1;
      c.arrows.forEach((a, i) => {
        a.visible = mag > 0.03;
        if (!a.visible) return;
        const u = (((i / ARROWS + c.phase) % 1) + 1) % 1;
        const deg = 25 + u * (CANAL_ARC_DEG - 45);
        a.position.copy(W(canalPoint(c.b.f, deg)));
        tmp.copy(W(canalTangent(c.b.f, deg))).multiplyScalar(dir || 1).normalize();
        a.quaternion.setFromUnitVectors(up, tmp);
        const mat = a.material as THREE.MeshBasicMaterial;
        mat.color.set(s.excitatory ? EXCITE : INHIBIT);
        mat.opacity = 0.35 + 0.6 * mag;
        a.scale.setScalar(0.7 + 0.5 * mag);
      });
      // The cupula bends the way the endolymph pushes it (exaggerated: really a few micrometres).
      const bend = Math.max(-1, Math.min(1, (dir * Math.abs(s.stimulation)) / 60)) * 0.6;
      c.cup.hinge.rotation.z = -bend;
      (c.cup.mats[0] as THREE.MeshBasicMaterial).color.set(s.excitatory === null || Math.abs(s.stimulation) < 2 ? '#fbf6ff' : s.excitatory ? '#ffd2b8' : '#cfe0ff');
    }
    utricle.stones.position.copy(shear.utricle).applyQuaternion(utricle.g.quaternion.clone().invert()).setY(0.00012);
    saccule.stones.position.copy(shear.saccule).applyQuaternion(saccule.g.quaternion.clone().invert()).setY(0.00012);
  });

  return (
    <>
      {canalsOn && canals.map((c) => <group key={c.name}><primitive object={c.cup.outer} />{c.arrows.map((a, i) => <primitive key={i} object={a} />)}</group>)}
      {maculaeOn && <primitive object={utricle.g} />}
      {maculaeOn && <primitive object={saccule.g} />}
      <PointLabels container={labels} items={items} />
    </>
  );
}

/**
 * Posterior-canal BPPV (right ear): a clump of otoconia in the posterior canal, moving round the
 * canal and through the common crus into the utricle step by step of the Epley manoeuvre, or falling
 * away from the cupula in the Dix–Hallpike position.
 */
export function OtoconiaScene({ epleyStep, hallpike, labels, reducedMotion }: { epleyStep: number; hallpike: 'none' | 'left' | 'right'; labels: RefObject<HTMLDivElement | null>; reducedMotion: boolean }) {
  const steps = useMemo(() => epleyManoeuvre('right'), []);
  const target = epleyStep > 0 ? steps[epleyStep - 1]!.otoconia.fractionAlongCanal : hallpike === 'right' ? 0.4 : 0.05;
  const clump = useMemo(() => {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, toneMapped: false });
    const edge = new THREE.MeshBasicMaterial({ color: '#7a5a20', depthTest: false, transparent: true, opacity: 0.6, toneMapped: false, side: THREE.BackSide });
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.SphereGeometry(0.00011 + Math.abs(rnd()) * 0.00008, 8, 6);
      const m = new THREE.Mesh(geo, mat), o = new THREE.Mesh(geo, edge);
      o.scale.setScalar(1.35);
      const p = new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(0.0006);
      m.position.copy(p); o.position.copy(p);
      m.renderOrder = 11; o.renderOrder = 10;
      g.add(o, m);
    }
    g.userData = { mat, edge };
    return g;
  }, []);
  useEffect(() => () => { clump.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); (clump.userData.mat as THREE.Material).dispose(); (clump.userData.edge as THREE.Material).dispose(); }, [clump]);
  const state = useMemo(() => ({ at: target }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo<PointLabel[]>(() => [{ key: 'otoconia', text: 'Otoconia', p: new THREE.Vector3(), tone: 'warn' }], []);
  useFrame((_, dt) => {
    state.at += (target - state.at) * Math.min(1, dt * 1.6);
    if (reducedMotion || Math.abs(target - state.at) < 0.0005) state.at = target;
    clump.position.copy(W(posteriorCanalPoint(state.at)));
    items[0]!.p.copy(clump.position);
  });
  return (
    <>
      <primitive object={clump} />
      <PointLabels container={labels} items={items} />
    </>
  );
}
