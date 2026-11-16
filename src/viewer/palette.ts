import type { AnatomicalStructure } from '../contract/schema';
import type { ColourBy } from '../app/state';
import type { TissueLook } from './tissue';

/**
 * Real looks of the ear's tissues: ivory bone, skin over the auricle, pale cartilage, a pearly
 * translucent eardrum, ossicles a little warmer than bone, clear perilymph (pale aqua) and
 * endolymph (lavender) spaces, cream-yellow nerves, a red artery and a blue venous sinus.
 */
const REAL: Record<string, TissueLook> = {
  bone: { color: '#f4ecd8', roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5, sheen: 0.25, sheenColor: '#fffaf0', rim: 0.28, rimColor: '#fff4e2', ao: 1, mottle: 0.22, mottleTint: '#d2bf9c' },
  skull: { color: '#e2d6bc', roughness: 0.8, clearcoat: 0, sheen: 0, rim: 0, ao: 0.4, mottle: 0.2 },
  'otic-capsule': { color: '#f6f0e2', roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.2, sheen: 0.2, sheenColor: '#ffffff', rim: 0.1, rimColor: '#fff0d0', ao: 0.5, mottle: 0.15, mottleTint: '#d8c8a0' },
  skin: { color: '#e2a891', roughness: 0.46, clearcoat: 0.3, clearcoatRoughness: 0.35, sheen: 0.55, sheenColor: '#ffe2d4', rim: 0.45, rimColor: '#ff7a5c', ao: 1, mottle: 0.3, mottleTint: '#c27a62' },
  cartilage: { color: '#eadfcf', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.15, sheen: 0.3, sheenColor: '#ffffff', rim: 0.15, rimColor: '#ffd8c0', ao: 0.7, mottle: 0.15, mottleTint: '#d8bfa8' },
  'canal-bone': { color: '#e8dcc0', roughness: 0.55, clearcoat: 0.3, sheen: 0.2, rim: 0.1, ao: 0.8, mottle: 0.25, mottleTint: '#c9b48c' },
  drum: { color: '#d8dde2', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.5, sheenColor: '#ffffff', rim: 0.15, rimColor: '#ffe4d8', ao: 0.2, mottle: 0.08 },
  ossicle: { color: '#f1e2bd', roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.2, sheen: 0.25, sheenColor: '#fffaf0', rim: 0.12, rimColor: '#ffd8a8', ao: 0.75, mottle: 0.2, mottleTint: '#d6bf8e' },
  muscle: { color: '#a63a30', roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: '#ffb0a0', rim: 0.25, rimColor: '#ff6a55', ao: 0.85, mottle: 0.35, mottleTint: '#702018' },
  air: { color: '#cfe8f2', roughness: 0.2, clearcoat: 0.4, sheen: 0, rim: 0, ao: 0, mottle: 0 },
  'air-cells': { color: '#e8e0d4', roughness: 0.4, clearcoat: 0.3, sheen: 0.2, rim: 0.1, ao: 0.6, mottle: 0.2 },
  mucosa: { color: '#e6a39b', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.3, sheenColor: '#ffd0c8', rim: 0.25, rimColor: '#ff8a7a', ao: 0.7, mottle: 0.2, mottleTint: '#b86860' },
  perilymph: { color: '#8fcfe2', roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1, sheen: 0.2, sheenColor: '#e8fbff', rim: 0.15, rimColor: '#c8f4ff', ao: 0.4, mottle: 0.08 },
  endolymph: { color: '#b49ae6', roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1, sheen: 0.2, sheenColor: '#f0e8ff', rim: 0.15, rimColor: '#e0d0ff', ao: 0.4, mottle: 0.08 },
  basilar: { color: '#ff8a72', roughness: 0.3, clearcoat: 0.6, sheen: 0.3, sheenColor: '#ffe0d8', rim: 0.2, rimColor: '#ffb0a0', ao: 0.3, mottle: 0.05 },
  ligament: { color: '#f2e2b8', roughness: 0.4, clearcoat: 0.5, sheen: 0.3, rim: 0.1, ao: 0.5, mottle: 0.1 },
  nerve: { color: '#f0d58a', roughness: 0.45, clearcoat: 0.5, sheen: 0.4, sheenColor: '#fff8e0', rim: 0.15, rimColor: '#ffe4a0', ao: 0.7, mottle: 0.2, mottleTint: '#c8a868' },
  artery: { color: '#b8282a', roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.2, rim: 0.25, rimColor: '#ff5a50', ao: 0.7, mottle: 0.15, mottleTint: '#7a1418' },
  vein: { color: '#3f5aa8', roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.2, rim: 0.2, rimColor: '#7a90e0', ao: 0.7, mottle: 0.15, mottleTint: '#28386a' },
};

const KIND: Record<string, string> = {
  'temporal-bone': 'bone', skull: 'skull', auricle: 'skin', 'ear-canal-cartilage': 'cartilage', 'ear-canal-bone': 'canal-bone',
  'tympanic-membrane': 'drum', 'round-window': 'drum', malleus: 'ossicle', incus: 'ossicle', stapes: 'ossicle',
  'tensor-tympani': 'muscle', stapedius: 'muscle', 'tympanic-cavity': 'air', 'mastoid-air-cells': 'air-cells', 'auditory-tube': 'mucosa',
  cochlea: 'otic-capsule', 'scala-vestibuli': 'perilymph', 'scala-tympani': 'perilymph', vestibule: 'perilymph',
  'anterior-canal': 'perilymph', 'posterior-canal': 'perilymph', 'lateral-canal': 'perilymph',
  'scala-media': 'endolymph', utricle: 'endolymph', saccule: 'endolymph', 'anterior-ampulla': 'endolymph', 'posterior-ampulla': 'endolymph', 'lateral-ampulla': 'endolymph', 'endolymphatic-sac': 'endolymph',
  'basilar-membrane': 'basilar', 'oval-window': 'ligament',
  'internal-carotid-artery': 'artery', 'sigmoid-sinus': 'vein',
};

function kindOf(s: AnatomicalStructure): string {
  return KIND[s.id] ?? (s.layer === 'nerves' ? 'nerve' : s.layer === 'bone' ? 'bone' : 'cartilage');
}

export function realLook(s: AnatomicalStructure): TissueLook {
  return REAL[kindOf(s)] ?? REAL.cartilage!;
}

/** How see-through each part is in its real look (1 = opaque). */
export function realOpacity(s: AnatomicalStructure): number {
  switch (s.id) {
    case 'skull': return 0.1;
    case 'tympanic-cavity': return 0.1;
    case 'tympanic-membrane': return 0.55;
    case 'cochlea': return 0.24;
    case 'vestibule': return 0.45;
    case 'mastoid-air-cells': return 0.55;
    case 'auditory-tube': return 0.75;
    default: return 1;
  }
}

/** One hue per layer (Colour: Layers). */
export const LAYER_COLOUR: Record<string, string> = {
  bone: '#d8c8a0', outer: '#e89a8a', middle: '#f2c14e', inner: '#6ab8e0', nerves: '#f0d060', vessels: '#d0304a',
};
/** Groups get their own colours for the overview tour step. */
const GROUP_COLOUR: Record<string, string> = {
  'outer-ear': '#e89a8a', 'middle-ear': '#f2c14e', ossicles: '#f2c14e', 'inner-ear': '#6ab8e0',
  'cochlear-labyrinth': '#6ab8e0', 'vestibular-labyrinth': '#9a8ae0', 'semicircular-canals': '#9a8ae0',
};

/** The colour a structure shows in the current colour mode. */
export function baseColour(s: AnatomicalStructure, colourBy: ColourBy): string {
  if (s.kind === 'group') return GROUP_COLOUR[s.id] ?? LAYER_COLOUR[s.layer] ?? realLook(s).color;
  if (colourBy === 'layer') return LAYER_COLOUR[s.layer] ?? realLook(s).color;
  return realLook(s).color;
}

/** Fluids, for legends and the simulations. */
export const PERILYMPH = REAL.perilymph!.color;
export const ENDOLYMPH = REAL.endolymph!.color;
export const SIGNAL = '#ffe680';

export const HIGHLIGHT = '#ffc94d';
export const HOVER = '#ffe7a8';

/** Cut-surface colours: what a slice through each tissue shows. */
const CUT: Record<string, string> = {
  bone: '#dccdaa', skull: '#dccdaa', 'otic-capsule': '#efe4c8', skin: '#d99a86', cartilage: '#e2d6c4', 'canal-bone': '#dccdaa', drum: '#d0d4d8',
  ossicle: '#eadbb2', muscle: '#963228', air: '#cfe8f2', 'air-cells': '#ddd2c2', mucosa: '#d8948c', perilymph: '#86c4d8', endolymph: '#a890d8',
  basilar: '#f07a64', ligament: '#e6d6ac', nerve: '#e8d090', artery: '#9a2024', vein: '#344c90',
};
export function cutColour(s: AnatomicalStructure): string {
  return CUT[kindOf(s)] ?? '#c9a090';
}
