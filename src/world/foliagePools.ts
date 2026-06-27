/**
 * Data-driven registry for procedural foliage (trees and bushes).
 *
 * Each entry maps to a Blender-authored GLB in `public/assets/props/foliage/`
 * (source library: `Blender Files/props/foliage.blend`). Add a variant here and
 * it is automatically loaded, pooled, and scattered in the world; no other code
 * needs to change. `targetHeight` is the runtime height in meters after the
 * model is normalized, so size variety is driven entirely by this data.
 */

import { ASSET_BASE } from './config';

export type FoliageKind = 'tree' | 'bush';

export interface FoliageVariant {
  id: string;
  kind: FoliageKind;
  /** GLB filename relative to {@link FOLIAGE_BASE}. */
  file: string;
  /** Normalized world height in meters (before per-instance scale jitter). */
  targetHeight: number;
}

/** Base path (under /public) for all foliage GLBs. */
export const FOLIAGE_BASE = `${ASSET_BASE}/props/foliage`;

export const FOLIAGE_VARIANTS: readonly FoliageVariant[] = [
  { id: 'tree_round', kind: 'tree', file: 'tree_round.glb', targetHeight: 2.6 },
  { id: 'tree_tall', kind: 'tree', file: 'tree_tall.glb', targetHeight: 3.6 },
  { id: 'tree_broad', kind: 'tree', file: 'tree_broad.glb', targetHeight: 2.3 },
  { id: 'tree_small', kind: 'tree', file: 'tree_small.glb', targetHeight: 1.6 },
  { id: 'bush_round', kind: 'bush', file: 'bush_round.glb', targetHeight: 0.75 },
  { id: 'bush_wide', kind: 'bush', file: 'bush_wide.glb', targetHeight: 0.6 },
  { id: 'bush_tall', kind: 'bush', file: 'bush_tall.glb', targetHeight: 1.0 },
];

/** Variant ids grouped by kind, for seeded selection at clone time. */
export const FOLIAGE_BY_KIND: Record<FoliageKind, readonly string[]> = {
  tree: FOLIAGE_VARIANTS.filter((v) => v.kind === 'tree').map((v) => v.id),
  bush: FOLIAGE_VARIANTS.filter((v) => v.kind === 'bush').map((v) => v.id),
};

export function isFoliageKind(kind: string): kind is FoliageKind {
  return kind === 'tree' || kind === 'bush';
}
