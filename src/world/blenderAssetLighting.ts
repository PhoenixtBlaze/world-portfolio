import * as THREE from 'three';
import {
  APARTMENT_LOCAL_LIGHT,
  createLightingProbe,
  HOUSE_LOCAL_LIGHT,
  type LocalLightProfile,
} from '@runtime/lighting';
import type { BlockArchetype } from './BlockArchetypes';
import { ARCHETYPE_POOL } from './buildingPools';

const POOL_PROFILE: Record<string, LocalLightProfile> = {
  houses: HOUSE_LOCAL_LIGHT,
  'apartment-office': APARTMENT_LOCAL_LIGHT,
  landmarks: APARTMENT_LOCAL_LIGHT,
};

let houseProbe: THREE.Texture | null = null;
let apartmentProbe: THREE.Texture | null = null;

/** Shared PMREM probes for pooled Blender buildings (one texture per profile). */
export function initBlenderAssetLighting(renderer: THREE.WebGLRenderer): void {
  if (!houseProbe) {
    houseProbe = createLightingProbe(renderer, HOUSE_LOCAL_LIGHT);
  }
  if (!apartmentProbe) {
    apartmentProbe = createLightingProbe(renderer, APARTMENT_LOCAL_LIGHT);
  }
}

export function usesAuthoredPoolMaterials(archetype: BlockArchetype): boolean {
  return ARCHETYPE_POOL[archetype] !== undefined;
}

/** Hero GLBs with fully authored sci-fi / panel materials (skip procedural tints). */
export function usesAuthoredHeroMaterials(archetype: BlockArchetype): boolean {
  return archetype === 'shop' || archetype === 'industrial' || archetype === 'park' || archetype === 'landmark';
}

export function preservesAuthoredMaterials(archetype: BlockArchetype): boolean {
  return usesAuthoredPoolMaterials(archetype) || usesAuthoredHeroMaterials(archetype);
}

function probeForArchetype(archetype: BlockArchetype): THREE.Texture | null {
  const pool = ARCHETYPE_POOL[archetype];
  if (!pool) return null;
  return pool === 'houses' ? houseProbe : apartmentProbe;
}

function profileForArchetype(archetype: BlockArchetype): LocalLightProfile {
  const pool = ARCHETYPE_POOL[archetype];
  return (pool && POOL_PROFILE[pool]) ?? HOUSE_LOCAL_LIGHT;
}

/**
 * Keeps Blender-authored albedo and gives each pooled building its own reflection
 * probe so global night IBL does not wash materials out. No shader patches.
 */
export function applyBlenderAssetLighting(root: THREE.Object3D, archetype: BlockArchetype): void {
  if (!usesAuthoredPoolMaterials(archetype) && !usesAuthoredHeroMaterials(archetype)) return;

  const envMap = usesAuthoredHeroMaterials(archetype)
    ? apartmentProbe
    : probeForArchetype(archetype);
  if (!envMap) return;

  const profile = usesAuthoredHeroMaterials(archetype)
    ? APARTMENT_LOCAL_LIGHT
    : profileForArchetype(archetype);

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      mat.envMap = envMap;
      mat.envMapIntensity = profile.envMapIntensity;
      mat.needsUpdate = true;
    }
  });
}

/** No-op — pooled clones own their material instances and are discarded with the tile. */
export function releaseBlenderAssetLighting(_root: THREE.Object3D): void {}
