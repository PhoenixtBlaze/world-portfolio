import * as THREE from 'three';
import type { BlockArchetype } from './BlockArchetypes';
import type { PropKind } from './AssetCatalog';
import { mulberry32 } from './rng';

/** Semantic material slot for palette randomization. */
export type MaterialRole =
  | 'wall'
  | 'roof'
  | 'trim'
  | 'glass'
  | 'metal'
  | 'door'
  | 'accent'
  | 'ground'
  | 'foliage'
  | 'wood';

const ROLE_HINTS: ReadonlyArray<{ role: MaterialRole; patterns: readonly string[] }> = [
  { role: 'glass', patterns: ['glass', 'window', 'emiss', 'neon', 'sign', 'lamp', 'beacon', 'led', 'water'] },
  { role: 'roof', patterns: ['roof', 'awning'] },
  { role: 'trim', patterns: ['trim', 'frame', 'sill', 'parapet', 'column', 'stone', 'foundation', 'path'] },
  { role: 'metal', patterns: ['metal', 'iron', 'steel', 'pipe', 'hvac', 'ant', 'dish', 'pole', 'rail'] },
  { role: 'door', patterns: ['door', 'entry', 'shutter'] },
  { role: 'accent', patterns: ['accent', 'flag', 'sign', 'menu', 'crate', 'rust', 'chim'] },
  { role: 'ground', patterns: ['grass', 'ground', 'planter'] },
  { role: 'foliage', patterns: ['leaf', 'tree', 'shrub', 'flower'] },
  { role: 'wood', patterns: ['wood', 'bench', 'trunk', 'mail'] },
  { role: 'wall', patterns: ['wall', 'body', 'base', 'tower', 'hall', 'shop', 'civic', 'body'] },
];

/** Pastel wall palettes per archetype (Infinitown-inspired). */
const WALL_PALETTES: Record<BlockArchetype, readonly (readonly [number, number, number])[]> = {
  small_house: [
    [0.78, 0.62, 0.72],
    [0.72, 0.68, 0.82],
    [0.82, 0.7, 0.62],
    [0.65, 0.78, 0.72],
    [0.88, 0.72, 0.78],
  ],
  apartment: [
    [0.52, 0.66, 0.82],
    [0.48, 0.58, 0.75],
    [0.55, 0.72, 0.78],
    [0.62, 0.65, 0.88],
  ],
  office: [
    [0.58, 0.62, 0.72],
    [0.52, 0.58, 0.68],
    [0.65, 0.68, 0.78],
    [0.48, 0.55, 0.65],
  ],
  shop: [
    [0.92, 0.55, 0.45],
    [0.88, 0.62, 0.42],
    [0.95, 0.48, 0.52],
    [0.85, 0.58, 0.38],
  ],
  industrial: [
    [0.52, 0.56, 0.62],
    [0.48, 0.52, 0.58],
    [0.58, 0.54, 0.5],
    [0.45, 0.5, 0.55],
  ],
  park: [
    [0.28, 0.62, 0.35],
    [0.32, 0.58, 0.38],
    [0.25, 0.65, 0.32],
  ],
  civic: [
    [0.82, 0.72, 0.55],
    [0.78, 0.68, 0.52],
    [0.88, 0.75, 0.58],
    [0.75, 0.65, 0.48],
  ],
  landmark: [
    [0.38, 0.48, 0.72],
    [0.42, 0.52, 0.78],
    [0.35, 0.45, 0.68],
    [0.48, 0.55, 0.82],
  ],
};

/** Palettes for single-template props only; foliage keeps authored materials. */
const PROP_WALL_PALETTES: Record<'street_light' | 'bench', readonly (readonly [number, number, number])[]> = {
  street_light: [[0.32, 0.34, 0.38]],
  bench: [[0.48, 0.3, 0.16]],
};

/** Detect material role from mesh or material name set in Blender exports. */
export function detectMaterialRole(meshName: string, materialName: string): MaterialRole {
  const key = `${meshName}_${materialName}`.toLowerCase();
  for (const { role, patterns } of ROLE_HINTS) {
    if (patterns.some((p) => key.includes(p))) return role;
  }
  return 'wall';
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function wallColorFromPalette(
  palette: readonly (readonly [number, number, number])[],
  rand: () => number,
): THREE.Color {
  const [r, g, b] = pick(palette, rand);
  const c = new THREE.Color(r, g, b);
  c.offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.06);
  return c;
}

function applyRoleTint(
  mat: THREE.MeshStandardMaterial,
  role: MaterialRole,
  wallBase: THREE.Color,
  rand: () => number,
): void {
  const hsl = { h: 0, s: 0, l: 0 };
  wallBase.getHSL(hsl);

  switch (role) {
    case 'wall':
      mat.color.copy(wallBase);
      break;
    case 'roof':
      mat.color.setHSL(hsl.h, hsl.s * 0.85, hsl.l * 0.72);
      break;
    case 'trim':
      mat.color.setHSL(hsl.h, hsl.s * 0.35, Math.min(0.92, hsl.l + 0.28));
      break;
    case 'door':
      mat.color.setHSL(hsl.h, Math.min(0.75, hsl.s + 0.15), hsl.l * 0.45);
      break;
    case 'metal':
      mat.color.setHSL(hsl.h, 0.12, 0.42 + rand() * 0.12);
      mat.metalness = 0.55;
      mat.roughness = 0.38;
      break;
    case 'accent':
      mat.color.setHSL((hsl.h + 0.08 + rand() * 0.06) % 1, 0.65, 0.52);
      break;
    case 'glass':
      mat.color.setHSL((hsl.h + 0.45) % 1, 0.55, 0.55 + rand() * 0.1);
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity = 1.2 + rand() * 0.8;
      mat.transparent = true;
      mat.opacity = 0.92;
      break;
    case 'ground':
      mat.color.setHSL(0.32 + rand() * 0.06, 0.55, 0.38);
      break;
    case 'foliage':
      mat.color.setHSL(0.28 + rand() * 0.08, 0.58, 0.32 + rand() * 0.08);
      break;
    case 'wood':
      mat.color.setHSL(0.08, 0.45, 0.28 + rand() * 0.08);
      break;
  }
}

/** Clone materials and apply a seeded palette variant for one building instance. */
export function applyBuildingMaterialVariant(
  object: THREE.Object3D,
  archetype: BlockArchetype,
  seed: number,
): void {
  const rand = mulberry32(seed);
  const wallBase = wallColorFromPalette(WALL_PALETTES[archetype], rand);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    assignMeshMaterials(child, (mat, meshName) => {
      const cloned = mat.clone();
      if (cloned instanceof THREE.MeshStandardMaterial) {
        const role = detectMaterialRole(meshName, cloned.name);
        applyRoleTint(cloned, role, wallBase, rand);
        fixClipping(cloned, role);
      }
      return cloned;
    });
  });
}

/** Clone materials and apply a seeded variant for props. */
export function applyPropMaterialVariant(object: THREE.Object3D, kind: PropKind, seed: number): void {
  if (kind !== 'street_light' && kind !== 'bench') return;
  const rand = mulberry32(seed);
  const wallBase = wallColorFromPalette(PROP_WALL_PALETTES[kind], rand);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    assignMeshMaterials(child, (mat, meshName) => {
      const cloned = mat.clone();
      if (cloned instanceof THREE.MeshStandardMaterial) {
        const role = detectMaterialRole(meshName, cloned.name);
        applyRoleTint(cloned, role, wallBase, rand);
        fixClipping(cloned, role);
      }
      return cloned;
    });
  });
}

function assignMeshMaterials(
  mesh: THREE.Mesh,
  mapFn: (mat: THREE.Material, meshName: string) => THREE.Material,
): void {
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((m) => mapFn(m, mesh.name));
  } else {
    mesh.material = mapFn(mesh.material, mesh.name);
  }
}

/** Reduce z-fighting on emissive inset geometry. */
function fixClipping(mat: THREE.MeshStandardMaterial, role: MaterialRole): void {
  if (role === 'glass') {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    mat.depthWrite = false;
  } else if (role === 'trim' || role === 'door') {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 1;
  }
}

/** Render order to keep glass above frames without z-fighting. */
export function applyRenderOrder(object: THREE.Object3D, baseOrder = 2): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mat = child.material;
    const name = (Array.isArray(mat) ? mat[0] : mat)?.name?.toLowerCase() ?? '';
    const meshKey = child.name.toLowerCase();
    const isGlass = name.includes('glass') || meshKey.includes('glass');
    child.renderOrder = isGlass ? baseOrder + 2 : baseOrder;
  });
}
