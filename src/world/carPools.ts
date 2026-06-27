/**
 * Data-driven registry for drivable vehicle GLBs.
 *
 * Each entry maps to a Blender-authored GLB in `public/assets/vehicles/`.
 * Add a vehicle to `catalog.json` and it is loaded automatically; no other
 * code needs to change until traffic spawning is wired up.
 */

import { ASSET_BASE } from './config';

export interface CarCatalogFile {
  schema: string;
  vehicles: CarCatalogEntry[];
}

export interface CarCatalogEntry {
  id: string;
  glb: string;
  label?: string;
  /** Normalized world length in meters (longest XZ axis after import). */
  targetLength: number;
}

/** Base path (under /public) for all vehicle GLBs. */
export const CAR_GLB_BASE = `${ASSET_BASE}/vehicles`;

export const CAR_CATALOG_URL = `${CAR_GLB_BASE}/catalog.json`;

export function catalogCarFilename(entry: CarCatalogEntry): string {
  const raw = entry.glb.replace(/\\/g, '/');
  const slash = raw.lastIndexOf('/');
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}
