import type { BlockArchetype } from './BlockArchetypes';
import { ASSET_BASE } from './config';

/** JSON catalog schema shared by house and apartment-office pools. */
export interface BuildingCatalogFile {
  schema: string;
  pool?: string;
  buildings: BuildingCatalogEntry[];
}

export interface BuildingCatalogEntry {
  id: string;
  glb: string;
  suggestedArchetype?: BlockArchetype | string;
  /** RGB 0–1 for Stripe_Layer1 + Stripe_Layer2 on house variants. */
  stripeColor?: [number, number, number];
  footprintBlender?: number;
  heightBlender?: number;
  footprintTier?: string;
  heightTier?: string;
}

export type BuildingPoolId = 'houses' | 'apartment-office' | 'landmarks';

/** Which variant pool each tile archetype draws from (null = single hero GLB). */
export const ARCHETYPE_POOL: Partial<Record<BlockArchetype, BuildingPoolId>> = {
  small_house: 'houses',
  apartment: 'apartment-office',
  office: 'apartment-office',
  landmark: 'landmarks',
};

export const POOL_CATALOG_URL: Record<BuildingPoolId, string> = {
  houses: `${ASSET_BASE}/buildings/pools/houses/catalog.json`,
  'apartment-office': `${ASSET_BASE}/buildings/pools/apartment-office/catalog.json`,
  landmarks: `${ASSET_BASE}/buildings/pools/landmarks/catalog.json`,
};

export const POOL_GLB_BASE: Record<BuildingPoolId, string> = {
  houses: `${ASSET_BASE}/buildings/pools/houses`,
  'apartment-office': `${ASSET_BASE}/buildings/pools/apartment-office`,
  landmarks: `${ASSET_BASE}/buildings/pools/landmarks`,
};

/** Normalize catalog glb path (may include legacy `glb/` prefix). */
export function catalogGlbFilename(entry: BuildingCatalogEntry): string {
  const raw = entry.glb.replace(/\\/g, '/');
  const slash = raw.lastIndexOf('/');
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}
