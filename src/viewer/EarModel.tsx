import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useLab } from '../app/LabContext';
import { effectiveColourBy, effectiveMode, effectiveSim, effectiveSlice, focusIds, highlightedIds, isVisible, simHighlight, type Sim } from '../app/state';
import type { AnatomicalStructure } from '../contract/schema';
import { BONE_WINDOW, CUT_CENTRE, modeBounds, toWorld } from '../ear/anchors';
import { baseColour, cutColour, HIGHLIGHT, HOVER, realLook, realOpacity } from './palette';
import { closeHoles } from './closeHoles';
import { applyQuality, hasTissueData, makeTissueMaterial, quality, type TissueMaterial } from './tissue';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/ear.glb`;

const GREY = new THREE.Color('#a59a96');
const HIGHLIGHT_COLOUR = new THREE.Color(HIGHLIGHT);

/** Pointer travel (px) above which a press is treated as a drag (rotate), not a pick. */
const CLICK_SLOP = 5;

/** The cut shared with the label layer, so hits on the removed side can be ignored. */
export const clip = { plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), active: false };

/** Parts with a window cut into them around the middle and inner ear (done in the shader, so the meshes stay closed). */
const WINDOWED = new Set(['temporal-bone', 'skull']);
/** Parts that stay see-through when selected, so what they contain still shows. */
const SEE_THROUGH = new Set(['skull', 'cochlea', 'vestibule', 'tympanic-cavity']);
/** Camera views that look past the auricle, canal and bone at the middle and inner ear: what fades in each (opacity). */
const OUTER_FADE = { auricle: 0.15, 'ear-canal-cartilage': 0.2, 'ear-canal-bone': 0.25 };
const FADES: Record<string, Record<string, number>> = {
  'middle-ear': { ...OUTER_FADE, 'mastoid-air-cells': 0.25, 'sigmoid-sinus': 0.5 },
  'inner-ear': { ...OUTER_FADE, 'temporal-bone': 0.18, 'mastoid-air-cells': 0.2, 'tympanic-cavity': 0.05, 'sigmoid-sinus': 0.4 },
  medial: { 'temporal-bone': 0.2, 'sigmoid-sinus': 0.4, skull: 0.06 },
};
const SCALAE = { 'scala-vestibuli': 0.32, 'scala-tympani': 0.32, 'scala-media': 0.4, 'basilar-membrane': 0.55 };
const LABYRINTH_GLASS = {
  'anterior-canal': 0.42, 'posterior-canal': 0.42, 'lateral-canal': 0.42, 'anterior-ampulla': 0.45, 'posterior-ampulla': 0.45, 'lateral-ampulla': 0.45,
  utricle: 0.4, saccule: 0.4, vestibule: 0.2, 'endolymphatic-sac': 0.6, cochlea: 0.2, ...SCALAE,
};
/** How see-through parts are in each simulation, so what moves inside them shows (undefined: the usual). */
export function modeOpacity(mode: string, sim: Sim, id: string): number | undefined {
  const table: Record<string, number> | undefined =
    mode === 'hearing' ? { 'ear-canal-bone': 0.26, 'ear-canal-cartilage': 0.26, auricle: 0.22, cochlea: 0.16, vestibule: 0.3, ...SCALAE, 'tympanic-membrane': 0.62 }
      : mode === 'balance' ? LABYRINTH_GLASS
        : mode === 'clinic' && sim.clinicView === 'devices' ? { cochlea: 0.14, ...SCALAE }
          : mode === 'closeups' ? (
            sim.closeup === 'pressure' ? { 'ear-canal-bone': 0.3, 'tympanic-cavity': 0.12, 'mastoid-air-cells': 0.3, 'tympanic-membrane': 0.8 }
              : sim.closeup === 'crista' || sim.closeup === 'macula' || sim.closeup === 'bppv' ? LABYRINTH_GLASS
                : undefined)
            : undefined;
  return table?.[id];
}

const windowUniforms = {
  uWinCentre: { value: new THREE.Vector3(...toWorld(BONE_WINDOW.centre)) },
  uWinRadii: { value: new THREE.Vector3(...BONE_WINDOW.radii) },
  uWinOn: { value: 1 },
};
/** True when a point (world space) lies inside the bone window. */
export function inBoneWindow(p: THREE.Vector3): boolean {
  if (!windowUniforms.uWinOn.value) return false;
  const c = windowUniforms.uWinCentre.value, r = windowUniforms.uWinRadii.value;
  return ((p.x - c.x) / r.x) ** 2 + ((p.y - c.y) / r.y) ** 2 + ((p.z - c.z) / r.z) ** 2 < 1;
}
function addWindow(material: THREE.Material, key: string) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, windowUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWinPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinPos;\nuniform vec3 uWinCentre; uniform vec3 uWinRadii; uniform float uWinOn;')
      .replace('#include <clipping_planes_fragment>', [
        '#include <clipping_planes_fragment>',
        'float winD = length((vWinPos - uWinCentre) / uWinRadii);',
        'if (uWinOn > 0.5 && winD < 1.0) discard;',
        // A thin feathered lip: an ordered-dither fade over the first few percent outside the window
        // reads as the bone thinning to a translucent edge (no sorting needed).
        'if (uWinOn > 0.5 && winD < 1.045) {',
        '  ivec2 bp = ivec2(mod(floor(gl_FragCoord.xy), 4.0));',
        '  int bm[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);',
        '  float th = (float(bm[bp.y * 4 + bp.x]) + 0.5) / 16.0;',
        '  if ((winD - 1.0) / 0.045 < th) discard;',
        '}',
      ].join('\n'))
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        // The cut edge of the bone around the window is a little darker and warmer, so it reads as depth.
        'if (uWinOn > 0.5) diffuseColor.rgb *= mix(vec3(0.74, 0.68, 0.6), vec3(1.0), smoothstep(1.0, 1.12, winD));',
      ].join('\n'));
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${prevKey()}-window-${key}`;
}

/**
 * Mirror a loaded mesh in x (model frame → world frame, see toWorld) once: positions, normals and
 * winding. The GLTF loader caches the scene, so the geometry is marked when done.
 */
function mirrorOnce(geometry: THREE.BufferGeometry) {
  if (geometry.userData.mirrored) return;
  geometry.userData.mirrored = true;
  for (const name of ['position', 'normal']) {
    const a = geometry.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i));
    if ('isInterleavedBufferAttribute' in a && a.isInterleavedBufferAttribute) a.data.needsUpdate = true;
    else (a as THREE.BufferAttribute).needsUpdate = true;
  }
  const index = geometry.getIndex();
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let t = 0; t + 2 < arr.length; t += 3) { const b = arr[t + 1]!; arr[t + 1] = arr[t + 2]!; arr[t + 2] = b; }
    index.needsUpdate = true;
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

interface Cap { back: THREE.Mesh; front: THREE.Mesh; face: THREE.Mesh; clear: THREE.Mesh; material: THREE.MeshStandardMaterial; closed: THREE.BufferGeometry }
interface Part {
  id: string;
  mesh: THREE.Mesh;
  material: TissueMaterial;
  structure: AnatomicalStructure;
  box: THREE.Box3;
  cap: Cap;
}

/** Cut-face grain: one tile of the noise texture spans this many metres. */
const GRAIN_TILE = 0.0015;

let grain: THREE.DataTexture | null = null;
/** A soft, tileable value-noise texture (deterministic) that gives cut faces a tissue grain. */
function grainTexture(): THREE.DataTexture {
  if (grain) return grain;
  const n = 128;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const octave = (cells: number) => {
    const lattice = Array.from({ length: cells * cells }, rand);
    const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)]!;
    const step = n / cells;
    return (x: number, y: number) => {
      const gx = Math.floor(x / step), gy = Math.floor(y / step);
      const fx = smooth((x % step) / step), fy = smooth((y % step) / step);
      const top = at(gx, gy) * (1 - fx) + at(gx + 1, gy) * fx;
      const bottom = at(gx, gy + 1) * (1 - fx) + at(gx + 1, gy + 1) * fx;
      return top * (1 - fy) + bottom * fy;
    };
  };
  const coarse = octave(8), medium = octave(16), fine = octave(32);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 0.84 + 0.08 * coarse(x, y) + 0.05 * medium(x, y) + 0.03 * fine(x, y);
    data.set([v * 255, v * 255, v * 255, 255], (y * n + x) * 4);
  }
  grain = new THREE.DataTexture(data, n, n);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.magFilter = THREE.LinearFilter;
  grain.minFilter = THREE.LinearMipmapLinearFilter;
  grain.generateMipmaps = true;
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.needsUpdate = true;
  return grain;
}

/**
 * Stencil capping (as in three.js' clipping-stencil example): back faces behind the cut add 1 and
 * front faces subtract 1, so the stencil is non-zero exactly where the cut passes through the
 * inside of a closed mesh. The face drawn there is the filled cut surface, in the tissue's colour.
 */
function makeCap(geometry: THREE.BufferGeometry, plane: THREE.Plane, order: number, colour: string, size: number, windowed: boolean): Cap {
  const stencilMat = (side: THREE.Side, op: THREE.StencilOp) => new THREE.MeshBasicMaterial({
    side, colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: op, stencilZFail: op, stencilZPass: op,
    clippingPlanes: [plane],
  });
  const closed = closeHoles(geometry);
  const back = new THREE.Mesh(closed, stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp));
  const front = new THREE.Mesh(closed, stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp));
  back.renderOrder = front.renderOrder = order;
  const map = grainTexture().clone();
  map.repeat.setScalar(Math.max(1, size / GRAIN_TILE));
  const material = new THREE.MeshStandardMaterial({
    color: colour, map, roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  });
  // A windowed part counts its whole closed surface (so the stencil is right everywhere) but draws
  // no cut face inside the window; a clearing pass then resets the stencil the face left behind there.
  if (windowed) addWindow(material, 'cap');
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  face.renderOrder = order + 0.1;
  const clear = new THREE.Mesh(face.geometry, new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  }));
  clear.renderOrder = order + 0.15;
  clear.visible = false;
  clear.raycast = () => {};
  clear.matrixAutoUpdate = false;
  if (!windowed) clear.userData.unused = true;
  for (const m of [back, front, face]) {
    m.visible = false;
    m.raycast = () => {}; // never pickable
    m.matrixAutoUpdate = false;
  }
  return { back, front, face, clear, material, closed };
}

export function EarModel({ onReady }: { onReady?: () => void }) {
  const { def, state, dispatch } = useLab();
  const gltf = useGLTF(MODEL_URL);
  const invalidate = useThree((s) => s.invalidate);
  const mode = effectiveMode(def, state);
  const [lo, hi] = useMemo(() => modeBounds(def, mode), [def, mode]);

  const parts = useMemo(() => {
    const out = new Map<string, Part>();
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const id = o.name || o.parent?.name || '';
      const s = def.structures.find((x) => x.id === id);
      if (!s) return;
      mirrorOnce(o.geometry);
      const material = makeTissueMaterial(realLook(s), hasTissueData(o));
      material.clippingPlanes = [clip.plane];
      const windowed = WINDOWED.has(id);
      if (windowed) addWindow(material, 'tissue');
      o.geometry.computeBoundingBox();
      const box = o.geometry.boundingBox!.clone();
      const capSize = box.getSize(new THREE.Vector3()).length() * 1.05;
      out.set(id, { id, mesh: o, material, structure: s, box, cap: makeCap(o.geometry, clip.plane, 10, cutColour(s), capSize, windowed) });
    });
    // Large structures first, so smaller ones inside them draw their caps last.
    const sorted = [...out.values()].sort((a, b) => b.box.getSize(new THREE.Vector3()).lengthSq() - a.box.getSize(new THREE.Vector3()).lengthSq());
    sorted.forEach((p, i) => {
      p.cap.back.renderOrder = p.cap.front.renderOrder = 10 + i * 3;
      p.cap.face.renderOrder = 10 + i * 3 + 1;
      p.cap.clear.renderOrder = 10 + i * 3 + 2;
    });
    return out;
  }, [gltf, def]);

  // Attach materials in an effect, not in useMemo: StrictMode may run the memo twice, and the
  // meshes must carry the materials this component actually updates. Dispose them on unmount.
  useLayoutEffect(() => {
    for (const p of parts.values()) {
      p.mesh.material = p.material;
      p.mesh.userData.structureId = p.id;
      gltf.scene.add(p.cap.back, p.cap.front, p.cap.face, p.cap.clear);
    }
    onReady?.();
    if (import.meta.env.DEV) (window as unknown as { __earParts?: unknown }).__earParts = parts; // for debugging looks in the dev server
    return () => parts.forEach((p) => {
      p.material.dispose();
      p.cap.material.map?.dispose();
      p.cap.material.dispose();
      if (p.cap.closed !== p.mesh.geometry) p.cap.closed.dispose();
      (p.cap.back.material as THREE.Material).dispose();
      (p.cap.front.material as THREE.Material).dispose();
      (p.cap.clear.material as THREE.Material).dispose();
      p.cap.face.geometry.dispose();
      gltf.scene.remove(p.cap.back, p.cap.front, p.cap.face, p.cap.clear);
    });
  }, [parts, onReady, gltf]);

  // Follow quality changes (a slow device drops the costly coat and sheen).
  useEffect(() => quality.subscribe((level) => {
    for (const p of parts.values()) { applyQuality(p.material, level); p.material.needsUpdate = true; }
    invalidate();
  }), [parts, invalidate]);

  const focus = focusIds(def, state);
  const sim = effectiveSim(def, state);
  const extra = simHighlight(def, state);
  const lit = highlightedIds(def, [...focus, ...extra]);
  const colourBy = effectiveColourBy(def, state);
  const slice = effectiveSlice(def, state);

  // The cut plane: keeps the side where n·p + c ≥ 0. The plane stays attached to every material
  // (parked far outside the model when there is no cut), so turning a cut on or off never
  // recompiles the tissue shaders. Cuts are centred between the eardrum and the cochlea.
  useEffect(() => {
    const a = slice.axis;
    clip.active = a !== 'off';
    if (clip.active) {
      const ax = a === 'sagittal' ? 0 : a === 'axial' ? 1 : 2;
      const c = CUT_CENTRE[ax]!;
      const half = Math.max(Math.abs(lo[ax]! - c), Math.abs(hi[ax]! - c));
      const at = c + slice.at * half;
      // The plane in the model frame, then mirrored into the world frame (n·p is unchanged).
      const n = new THREE.Vector3();
      n.setComponent(ax, slice.flip ? 1 : -1);
      n.x = -n.x;
      clip.plane.set(n, slice.flip ? -at : at);
    } else {
      clip.plane.set(new THREE.Vector3(-1, 0, 0), 100);
    }
    invalidate();
  }, [slice.axis, slice.at, slice.flip, lo, hi, invalidate]);

  useEffect(() => {
    for (const p of parts.values()) {
      const s = p.structure;
      p.mesh.visible = isVisible(def, state, p.id);
      const isLit = lit.has(p.id);
      const isHover = state.hovered === p.id && !isLit;
      const dim = lit.size > 0 && !isLit;
      const painted = colourBy !== 'real';
      p.material.color.set(baseColour(s, colourBy));
      if (isLit && !painted) p.material.color.lerp(HIGHLIGHT_COLOUR, 0.35);
      else if (dim) p.material.color.lerp(GREY, 0.45);
      if (isLit) p.material.emissive.copy(painted ? p.material.color : HIGHLIGHT_COLOUR);
      else p.material.emissive.set(isHover ? HOVER : '#000000');
      p.material.emissiveIntensity = isLit ? (painted ? 0.22 : 0.3) : isHover ? 0.3 : 0;

      // See-through parts (air spaces, the drum, the bony cochlea) keep their transparency;
      // a selected see-through part becomes clearer. Bones ghost while something inside is in focus.
      let opacity = realOpacity(s);
      if (painted && opacity < 1) opacity = Math.max(opacity, 0.5);
      if (isLit && opacity < 1 && !SEE_THROUGH.has(s.id)) opacity = Math.max(opacity, 0.7);
      if (dim && s.layer === 'bone') opacity = Math.min(opacity, 0.25);
      else if (dim && opacity < 1) opacity *= 0.6;
      if (mode === 'balance' && s.id === 'temporal-bone') opacity = 0.2;
      // The simulations look inside parts (sound in the canal, flow in the canals, the wave in the cochlea).
      const see = modeOpacity(mode, sim, s.id);
      if (see !== undefined) opacity = Math.min(opacity, see);
      // Close views look past the auricle: it fades so the middle and inner ear show.
      const fade = FADES[state.camera.preset]?.[s.id];
      if (fade !== undefined && !isLit) opacity = Math.min(opacity, fade);
      const transparent = opacity < 1;
      // Changing `transparent` changes the shader program; only flag an update when it flips.
      if (p.material.transparent !== transparent) p.material.needsUpdate = true;
      p.material.transparent = transparent;
      p.material.opacity = opacity;
      p.material.depthWrite = !transparent;
      p.mesh.renderOrder = transparent ? (s.id === 'skull' ? 3 : 2) : 0;

      p.cap.material.color.set(colourBy !== 'real' ? baseColour(s, colourBy) : cutColour(s));
      if (isLit) p.cap.material.color.lerp(HIGHLIGHT_COLOUR, 0.3);
      else if (dim) p.cap.material.color.lerp(GREY, 0.35);
    }
    invalidate();
  }, [parts, def, state, lit, colourBy, mode, sim, invalidate]);

  // Keep each cap on the plane, just large enough to cover the part's footprint, and show it only
  // where the plane crosses a solid part.
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const size = useMemo(() => new THREE.Vector3(), []);
  const worldBox = useMemo(() => new THREE.Box3(), []);
  useFrame(() => {
    for (const p of parts.values()) {
      const solid = p.mesh.visible && !p.material.transparent;
      p.mesh.updateMatrix();
      worldBox.copy(p.box).applyMatrix4(p.mesh.matrix);
      const show = clip.active && solid && clip.plane.intersectsBox(worldBox);
      p.cap.back.visible = p.cap.front.visible = p.cap.face.visible = show;
      p.cap.clear.visible = show && !p.cap.clear.userData.unused;
      if (show) {
        p.cap.back.matrix.copy(p.mesh.matrix);
        p.cap.front.matrix.copy(p.mesh.matrix);
        clip.plane.projectPoint(worldBox.getCenter(tmp), tmp);
        p.cap.face.position.copy(tmp);
        p.cap.face.lookAt(tmp.x - clip.plane.normal.x, tmp.y - clip.plane.normal.y, tmp.z - clip.plane.normal.z);
        p.cap.face.scale.setScalar(worldBox.getSize(size).length() * 1.05);
        p.cap.face.updateMatrix();
        p.cap.clear.matrix.copy(p.cap.face.matrix);
      }
    }
  });

  /** Ignore hits on the part of the model the cut or the bone window has removed. */
  const removed = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    (clip.active && clip.plane.distanceToPoint(e.point) < 0) || (WINDOWED.has(e.object.userData.structureId as string) && inBoneWindow(e.point));
  const pickable = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const id = e.object.userData.structureId as string | undefined;
    if (!id || !e.object.visible || removed(e)) return null; // let the event reach the next hit
    const m = (e.object as THREE.Mesh).material as THREE.Material;
    if (m.transparent && m.opacity < 0.3) return null; // ghosted parts are see-through to clicks
    return id;
  };
  const pick = (e: ThreeEvent<MouseEvent>) => {
    const id = pickable(e);
    if (!id) return;
    e.stopPropagation();
    if (e.delta > CLICK_SLOP) return;
    dispatch({ type: 'select', id });
  };
  const over = (e: ThreeEvent<PointerEvent>) => {
    const id = pickable(e);
    if (!id) return;
    e.stopPropagation();
    dispatch({ type: 'hover', id });
    document.body.style.cursor = 'pointer';
  };
  const out = (e: ThreeEvent<PointerEvent>) => {
    if (e.object.userData.structureId === state.hovered) dispatch({ type: 'hover', id: null });
    document.body.style.cursor = '';
  };

  return <primitive object={gltf.scene} onClick={pick} onPointerOver={over} onPointerOut={out} />;
}
