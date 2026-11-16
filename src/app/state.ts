/**
 * UI and simulation state as a pure reducer, so every learner action is unit-testable without
 * rendering. The 3D scene only reads this state; it never owns selection or visibility itself.
 */
import type { Mode, SimulationDefinition, SliceAxis, StepParams } from '../contract/schema';
import { getCase, analyseEar, type Side } from '../ear/audiology';
import { defaultSim, patchSim, setThreshold, type CloseupId, type Sim } from './sim';

export type { Mode } from '../contract/schema';
export type { Sim } from './sim';
export type ColourBy = 'real' | 'layer';

export interface Slice {
  axis: SliceAxis;
  /** Position across the model, -1 … 1. */
  at: number;
  /** Keep the other side of the cut. */
  flip: boolean;
}

export interface LabState {
  mode: Mode;
  selected: string | null;
  hovered: string | null;
  visibleLayers: ReadonlySet<string>;
  isolate: boolean;
  labels: boolean;
  colourBy: ColourBy;
  slice: Slice;
  /** Animations running. */
  playing: boolean;
  tourIndex: number;
  /** A camera move the scene should perform; the nonce makes repeat requests distinct. */
  camera: { preset: string; focus: readonly string[]; nonce: number };
  /** Settings of the simulation modes. */
  sim: Sim;
}

export type LabAction =
  | { type: 'select'; id: string | null }
  | { type: 'hover'; id: string | null }
  | { type: 'toggle-layer'; layer: string }
  | { type: 'set-isolate'; value: boolean }
  | { type: 'set-labels'; value: boolean }
  | { type: 'set-colour-by'; value: ColourBy }
  | { type: 'set-slice'; axis?: SliceAxis; at?: number; flip?: boolean }
  | { type: 'set-mode'; mode: Mode }
  | { type: 'set-playing'; value: boolean }
  | { type: 'tour-go'; index: number }
  | { type: 'camera'; preset: string; focus?: readonly string[] }
  | { type: 'set-sim'; patch: Partial<Sim> }
  | { type: 'set-threshold'; ear: Side; path: 'air' | 'bone'; freq: number; db: number }
  /** Leave the tour for a mode, with the current step's settings, so the learner can play with them. */
  | { type: 'try-step' }
  | { type: 'reset' };

const NO_SLICE: Slice = { axis: 'off', at: 0, flip: false };

/** Which layers each mode shows (the learner's layer toggles apply in Anatomy mode). */
export const MODE_LAYERS: Record<Exclude<Mode, 'explore' | 'tour'>, readonly string[]> = {
  hearing: ['outer', 'middle', 'inner', 'nerves'],
  balance: ['inner', 'nerves'],
  clinic: ['outer', 'middle', 'inner', 'nerves'],
  closeups: ['middle', 'inner', 'nerves'],
};
/** Single structures a mode adds to its layers. */
const MODE_EXTRA: Partial<Record<Mode, readonly string[]>> = {
  balance: ['temporal-bone'],
};
/** Structures a mode hides although their layer is shown. */
const MODE_HIDE: Partial<Record<Mode, readonly string[]>> = {
  // Hearing looks along the path of sound: the auricle and the tensor tympani would hide it.
  hearing: ['auricle', 'tensor-tympani', 'mastoid-air-cells', 'auditory-tube', 'endolymphatic-sac', 'facial-nerve', 'chorda-tympani'],
  balance: ['cochlear-nerve', 'facial-nerve', 'chorda-tympani'],
  closeups: ['mastoid-air-cells', 'auditory-tube', 'tympanic-cavity', 'vestibulocochlear-nerve'],
  // A case is seen from the front, along the canal; the auricle would stand in the way.
  clinic: ['auricle', 'auditory-tube', 'mastoid-air-cells', 'facial-nerve', 'chorda-tympani', 'tensor-tympani', 'stapedius'],
};
/** The camera each mode starts with. */
export const MODE_CAMERA: Partial<Record<Mode, string>> = {
  explore: 'lateral', hearing: 'anterior', balance: 'inner-ear', clinic: 'anterior', closeups: 'middle-ear',
};
/** What a mode's camera frames (default: the preset's own frame). */
export const MODE_FRAME: Partial<Record<Mode, readonly string[]>> = {
  hearing: ['ear-canal-bone', 'tympanic-membrane', 'malleus', 'cochlea'],
};

const CANALS = ['anterior-canal', 'posterior-canal', 'lateral-canal', 'anterior-ampulla', 'posterior-ampulla', 'lateral-ampulla'];
const VESTIBULAR = [...CANALS, 'vestibule', 'utricle', 'saccule', 'vestibular-nerve'];
/** The only structures each close-up shows, and how its camera frames them. */
export const CLOSEUP: Record<CloseupId, { show: readonly string[]; preset: string; frame: readonly string[] }> = {
  ossicles: { show: ['malleus', 'incus', 'stapes', 'oval-window'], preset: 'middle-ear', frame: ['malleus', 'incus', 'stapes'] },
  cochlea: {
    show: ['cochlea', 'scala-vestibuli', 'scala-media', 'scala-tympani', 'basilar-membrane', 'vestibule', 'oval-window', 'round-window', 'stapes'],
    preset: 'superior', frame: ['cochlea'],
  },
  crista: { show: VESTIBULAR, preset: 'inner-ear', frame: ['lateral-canal', 'anterior-ampulla', 'posterior-ampulla', 'vestibule'] },
  macula: { show: [...VESTIBULAR, 'cochlea'], preset: 'inner-ear', frame: ['lateral-canal', 'vestibule', 'anterior-ampulla', 'posterior-ampulla'] },
  pressure: {
    show: ['ear-canal-bone', 'tympanic-membrane', 'malleus', 'incus', 'stapes', 'tympanic-cavity', 'auditory-tube'],
    preset: 'superior', frame: ['tympanic-membrane', 'tympanic-cavity', 'ear-canal-bone', 'malleus'],
  },
  bppv: { show: [...VESTIBULAR, 'cochlea'], preset: 'inner-ear', frame: ['anterior-canal', 'posterior-canal', 'lateral-canal', 'vestibule'] },
};
/** The cochlear close-up cuts the cochlea across its turns (seen from above). */
const COCHLEA_SLICE: Slice = { axis: 'axial', at: -0.03, flip: false };

export function initialState(def: SimulationDefinition): LabState {
  return {
    mode: 'explore',
    selected: null,
    hovered: null,
    visibleLayers: new Set(def.layers.filter((l) => l.visibleByDefault).map((l) => l.id)),
    isolate: false,
    labels: false,
    colourBy: 'real',
    slice: NO_SLICE,
    playing: true,
    tourIndex: 0,
    camera: { preset: def.defaultCamera, focus: [], nonce: 0 },
    sim: defaultSim(),
  };
}

/** Ids that a selection or tour step highlights: a group stands for its members. */
export function highlightedIds(def: SimulationDefinition, ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const s = def.structures.find((x) => x.id === id);
    if (!s) continue;
    if (s.kind === 'group') s.members?.forEach((m) => out.add(m));
    else out.add(id);
  }
  return out;
}

const step = (def: SimulationDefinition, state: LabState) => (state.mode === 'tour' ? def.tour[state.tourIndex] : undefined);

/** The mode in effect: in a tour, the step's (Anatomy if it names none). */
export function effectiveMode(def: SimulationDefinition, state: LabState): Exclude<Mode, 'tour'> {
  if (state.mode === 'tour') return step(def, state)?.mode ?? 'explore';
  return state.mode;
}

/** The structures currently in focus: the selection, or the step's focus in a tour. */
export function focusIds(def: SimulationDefinition, state: LabState): string[] {
  if (state.mode === 'tour') return [...(step(def, state)?.focus ?? [])];
  return state.selected ? [state.selected] : [];
}

/** Mode-specific settings of the current tour step (empty outside a tour). */
export function effectiveParams(def: SimulationDefinition, state: LabState): StepParams {
  return step(def, state)?.params ?? {};
}

const stepSims = new WeakMap<object, Sim>();
/** The simulation settings in effect: a tour step's params over the defaults, otherwise the learner's. */
export function effectiveSim(def: SimulationDefinition, state: LabState): Sim {
  const s = step(def, state);
  if (!s) return state.sim;
  let sim = stepSims.get(s);
  if (!sim) { sim = patchSim(defaultSim(), s.params ?? {}); stepSims.set(s, sim); }
  return sim;
}

/** Structures a tour step's focus would highlight in this state, plus the ones the simulation points at. */
const BUILD_STRUCTURES = {
  conductive: ['tympanic-membrane', 'malleus', 'incus', 'stapes'],
  sensorineural: ['cochlea', 'basilar-membrane', 'scala-media', 'cochlear-nerve'],
} as const;
/**
 * Structures the current mode highlights on its own (when nothing is selected): the structures of a
 * clinical case, or those implied by the learner's own audiogram (conductive: the drum and chain;
 * sensorineural: the cochlea and nerve).
 */
export function simHighlight(def: SimulationDefinition, state: LabState): string[] {
  if (state.selected) return [];
  const mode = effectiveMode(def, state);
  const sim = effectiveSim(def, state);
  if (mode !== 'clinic') return [];
  if (sim.clinicView === 'cases') return [...getCase(sim.caseId).structures];
  if (sim.clinicView === 'build') {
    const types = new Set([analyseEar(sim.custom.left).type, analyseEar(sim.custom.right).type]);
    const out = new Set<string>();
    if (types.has('conductive') || types.has('mixed')) BUILD_STRUCTURES.conductive.forEach((x) => out.add(x));
    if (types.has('sensorineural') || types.has('mixed')) BUILD_STRUCTURES.sensorineural.forEach((x) => out.add(x));
    return [...out];
  }
  return [];
}

/** The colour mode in effect: a tour step can set its own. */
export function effectiveColourBy(def: SimulationDefinition, state: LabState): ColourBy {
  if (state.mode === 'tour') return step(def, state)?.colourBy ?? 'real';
  return state.colourBy;
}

/** The cut in effect: a tour step's, otherwise the learner's. */
export function effectiveSlice(def: SimulationDefinition, state: LabState): Slice {
  if (state.mode === 'tour') {
    const s = step(def, state);
    if (s?.slice) return { axis: s.slice.axis, at: s.slice.at, flip: false };
    return s?.mode === 'closeups' && effectiveSim(def, state).closeup === 'cochlea' ? COCHLEA_SLICE : NO_SLICE;
  }
  if (state.mode === 'closeups' && state.sim.closeup === 'cochlea' && state.slice.axis === 'off') return COCHLEA_SLICE;
  return state.slice;
}

/**
 * Whether a mesh structure is drawn. In Anatomy mode the learner's layers decide; the other modes
 * show their own layers. A highlighted structure is always shown; with isolate on, only those.
 */
export function isVisible(def: SimulationDefinition, state: LabState, id: string): boolean {
  const s = def.structures.find((x) => x.id === id);
  if (!s) return false;
  const lit = highlightedIds(def, focusIds(def, state));
  if (lit.has(id)) return true;
  if (state.isolate && lit.size > 0) return false;
  const mode = effectiveMode(def, state);
  if (mode === 'explore') return state.visibleLayers.has(s.layer);
  if (mode === 'closeups') {
    const sim = effectiveSim(def, state);
    if (sim.closeup === 'ossicles' && sim.muscles && (id === 'tensor-tympani' || id === 'stapedius')) return true;
    return CLOSEUP[sim.closeup].show.includes(id);
  }
  if (simHighlight(def, state).includes(id)) return true;
  if ((MODE_HIDE[mode] ?? []).includes(id)) return false;
  return MODE_LAYERS[mode].includes(s.layer) || (MODE_EXTRA[mode] ?? []).includes(id);
}

/**
 * The camera preset that looks at the cut face. The cut keeps the side below the plane on its axis
 * (x: the eye's outer half, z: the back, y: the lower part), or the side above it when flipped, so
 * the camera looks from the removed side.
 */
export function facingPreset(slice: Slice): string | null {
  switch (slice.axis) {
    case 'sagittal': return slice.flip ? 'medial' : 'lateral';
    case 'coronal': return slice.flip ? 'posterior' : 'anterior';
    case 'axial': return slice.flip ? 'inferior' : 'superior';
    default: return null;
  }
}

/** What the cut leaves in view, for the panel's hint (+x is lateral). */
export function keptHalf(slice: Slice): string | null {
  switch (slice.axis) {
    case 'sagittal': return slice.flip ? 'the outer (lateral) part' : 'the inner (medial) part';
    case 'coronal': return slice.flip ? 'the front part' : 'the back part';
    case 'axial': return slice.flip ? 'the upper part' : 'the lower part';
    default: return null;
  }
}

export function makeReducer(def: SimulationDefinition) {
  const known = new Set(def.structures.map((s) => s.id));
  const layers = new Set(def.layers.map((l) => l.id));
  const presets = new Set(def.cameraPresets.map((c) => c.id));
  const cam = (state: LabState, preset: string | undefined, focus: readonly string[] = []) =>
    preset && presets.has(preset) ? { preset, focus, nonce: state.camera.nonce + 1 } : state.camera;
  /** The camera a mode opens with: its preset, framing what the mode is about. */
  const modeCam = (state: LabState, mode: Exclude<Mode, 'tour'>, sim: Sim) => {
    if (mode === 'closeups') return cam(state, CLOSEUP[sim.closeup].preset, CLOSEUP[sim.closeup].frame);
    if (mode === 'clinic' && sim.clinicView === 'devices') return cam(state, 'inner-ear', ['cochlea']);
    // A case frames the structures it involves, between the drum and the cochlea.
    if (mode === 'clinic') return cam(state, 'anterior', [...new Set([...getCase(sim.caseId).structures, 'tympanic-membrane', 'cochlea', 'ear-canal-bone'])]);
    return cam(state, MODE_CAMERA[mode], MODE_FRAME[mode] ?? []);
  };
  const stepCam = (state: LabState, index: number) => {
    const s = def.tour[index]!;
    if (s.camera) return cam(state, s.camera, s.focus);
    return modeCam(state, s.mode ?? 'explore', patchSim(defaultSim(), s.params ?? {}));
  };

  return function reduce(state: LabState, action: LabAction): LabState {
    switch (action.type) {
      case 'select': {
        if (action.id !== null && !known.has(action.id)) return state;
        const selected = action.id === state.selected ? null : action.id;
        return { ...state, selected, isolate: selected ? state.isolate : false };
      }
      case 'hover':
        return action.id === state.hovered || (action.id !== null && !known.has(action.id)) ? state : { ...state, hovered: action.id };
      case 'toggle-layer': {
        if (!layers.has(action.layer)) return state;
        const next = new Set(state.visibleLayers);
        if (next.has(action.layer)) next.delete(action.layer);
        else next.add(action.layer);
        return { ...state, visibleLayers: next };
      }
      case 'set-isolate':
        return { ...state, isolate: action.value };
      case 'set-labels':
        return { ...state, labels: action.value };
      case 'set-colour-by':
        return action.value === state.colourBy ? state : { ...state, colourBy: action.value };
      case 'set-slice': {
        const at = action.at === undefined || !Number.isFinite(action.at) ? state.slice.at : Math.max(-1, Math.min(1, action.at));
        const axis = action.axis ?? state.slice.axis;
        // Choosing a new axis starts the cut in the middle.
        const fresh = action.axis !== undefined && action.axis !== state.slice.axis && action.at === undefined;
        const slice = { axis, at: fresh ? 0 : at, flip: action.flip ?? state.slice.flip };
        // A new axis or a flip turns the camera to face the cut, from the side the cut removed.
        const turned = axis !== 'off' && (axis !== state.slice.axis || slice.flip !== state.slice.flip);
        if (!turned) return { ...state, slice };
        return { ...state, slice, camera: cam(state, facingPreset(slice) ?? undefined) };
      }
      case 'set-mode': {
        if (action.mode === state.mode) return state;
        if (action.mode === 'tour') {
          if (!def.tour.length) return state;
          return { ...state, mode: 'tour', tourIndex: 0, selected: null, isolate: false, playing: true, camera: stepCam(state, 0) };
        }
        return { ...state, mode: action.mode, playing: true, camera: modeCam(state, action.mode, state.sim) };
      }
      case 'set-sim': {
        const sim = patchSim(state.sim, action.patch);
        const mode = effectiveMode(def, state);
        // A new close-up or the implant view moves the camera to what it is about.
        const moved = (mode === 'closeups' && sim.closeup !== state.sim.closeup)
          || (mode === 'clinic' && sim.clinicView !== state.sim.clinicView && (sim.clinicView === 'devices' || state.sim.clinicView === 'devices'))
          || (mode === 'clinic' && sim.clinicView === 'cases' && sim.caseId !== state.sim.caseId);
        return { ...state, sim, selected: moved ? null : state.selected, camera: moved && state.mode !== 'tour' ? modeCam(state, mode, sim) : state.camera };
      }
      case 'set-threshold':
        return { ...state, sim: { ...state.sim, custom: setThreshold(state.sim.custom, action.ear, action.path, action.freq, action.db) } };
      case 'try-step': {
        const s = step(def, state);
        if (!s) return state;
        const mode = s.mode ?? 'explore';
        return { ...state, mode, selected: null, playing: true, sim: patchSim(state.sim, s.params ?? {}), slice: s.slice ? { ...s.slice, flip: false } : state.slice };
      }
      case 'set-playing':
        return { ...state, playing: action.value };
      case 'tour-go': {
        const index = Math.max(0, Math.min(def.tour.length - 1, action.index));
        const s = def.tour[index];
        if (!s) return state;
        return { ...state, mode: 'tour', tourIndex: index, camera: stepCam(state, index) };
      }
      case 'camera':
        if (!presets.has(action.preset)) return state;
        return { ...state, camera: { preset: action.preset, focus: action.focus ?? [], nonce: state.camera.nonce + 1 } };
      case 'reset': {
        const fresh = initialState(def);
        return { ...fresh, camera: { ...fresh.camera, nonce: state.camera.nonce + 1 } };
      }
    }
  };
}
