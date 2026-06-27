/** Eight procedural city block archetypes with spawn frequency. */

import {
  BUILDING_CATALOG_FOOTPRINT,
  BUILDING_SLOT_SCALE,
  GRID_BUILDING_FILL,
  TILE_GRID_SPAN,
  TILE_FLOOR_SIZE,
} from './config';

export type BlockArchetype =
  | 'small_house'
  | 'apartment'
  | 'office'
  | 'shop'
  | 'industrial'
  | 'park'
  | 'civic'
  | 'landmark';

/** Which tile edge a row of buildings faces (outward toward the gap between tiles). */
export type TileEdge = 'south' | 'north' | 'east' | 'west';

/** Cumulative frequency thresholds (legacy; procedural tiles use TILE_ARCHETYPE_CYCLE). */
export const ARCHETYPE_TABLE: ReadonlyArray<{ type: BlockArchetype; threshold: number }> = [
  { type: 'landmark', threshold: 0.02 },
  { type: 'civic', threshold: 0.07 },
  { type: 'park', threshold: 0.15 },
  { type: 'industrial', threshold: 0.25 },
  { type: 'shop', threshold: 0.4 },
  { type: 'office', threshold: 0.55 },
  { type: 'apartment', threshold: 0.75 },
  { type: 'small_house', threshold: 1.0 },
];

/** Sentinel for the mid-rise cluster slot in the six-tile cycle. */
const BUILDINGS_CYCLE_SLOT = 'buildings' as const;

type TileCycleEntry = BlockArchetype | typeof BUILDINGS_CYCLE_SLOT;

/**
 * Procedural tiles repeat this six-slot pattern: one house tile, one shop tile,
 * one apartment/office cluster, one park, one industrial plant, one landmark.
 */
export const TILE_ARCHETYPE_CYCLE: readonly TileCycleEntry[] = [
  'small_house',
  'shop',
  BUILDINGS_CYCLE_SLOT,
  'park',
  'industrial',
  'landmark',
];

function positiveMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Apartment vs office for the buildings slot (still deterministic per tile). */
function pickBuildingsArchetype(tx: number, tz: number): BlockArchetype {
  return positiveMod(tx - tz, 2) === 0 ? 'apartment' : 'office';
}

/**
 * Slot index for the six-tile cycle. Uses tx + 2·tz (not tx + tz) so every
 * 8-neighbor — orthogonal and diagonal — gets a different slot; tx + tz repeats
 * on (x+1, z-1) diagonals.
 */
function tileArchetypeSlot(tx: number, tz: number): number {
  return positiveMod(tx + tz * 2, TILE_ARCHETYPE_CYCLE.length);
}

/** Deterministic archetype from tile grid coordinates. */
export function pickArchetypeForTile(tx: number, tz: number): BlockArchetype {
  const slot = tileArchetypeSlot(tx, tz);
  const entry = TILE_ARCHETYPE_CYCLE[slot]!;
  if (entry === BUILDINGS_CYCLE_SLOT) {
    return pickBuildingsArchetype(tx, tz);
  }
  return entry;
}

/** Non-overlapping placement slot on a tile (local XZ). */
export interface TileSlot {
  x: number;
  z: number;
  /** Y rotation so model front faces outward from the tile edge. */
  rotationY: number;
  scale: number;
}

const TILE_HALF = TILE_FLOOR_SIZE * 0.5;
const ROW_SPAN = TILE_GRID_SPAN;
const BUILDING_SCALE = 0.82;

/** Regular tile footprint after catalog normalize and slot scale. */
const REGULAR_FOOTPRINT = BUILDING_CATALOG_FOOTPRINT * BUILDING_SCALE;
/** Half depth along the outward-facing axis (+Z local front). */
const REGULAR_HALF_DEPTH = REGULAR_FOOTPRINT * 0.5;
/** Gap from tile rim to the front facade plane. */
const FRONT_SETBACK = 0.55;
/** Building origin sits this far from tile center toward the chosen edge. */
const EDGE_CENTER = TILE_HALF - FRONT_SETBACK - REGULAR_HALF_DEPTH;

const SHOP_HALF_DEPTH = REGULAR_HALF_DEPTH;
const SHOP_EDGE_OFFSET = TILE_HALF - FRONT_SETBACK - SHOP_HALF_DEPTH;

/**
 * Corner clearance for perimeter shops. Wide height-normalized storefronts need
 * shorter edge rows so south/north rows do not overlap east/west rows at corners.
 */
const SHOP_ROW_HALF_WIDTH = 2.75;
const SHOP_INWARD_HALF_DEPTH = 1.35;
const SHOP_ALONG_HALF = Math.max(
  2.25,
  SHOP_EDGE_OFFSET - SHOP_INWARD_HALF_DEPTH - SHOP_ROW_HALF_WIDTH,
);
const SHOP_ALONG_SPAN = SHOP_ALONG_HALF * 2;

const ALL_EDGES: readonly TileEdge[] = ['south', 'north', 'east', 'west'];

/** rotationY so local +Z (model front) points outward for each edge. */
export const EDGE_ROTATION: Record<TileEdge, number> = {
  south: 0,
  north: Math.PI,
  east: -Math.PI / 2,
  west: Math.PI / 2,
};

/** rotationY so shop doors point toward tile center from each edge. */
const SHOP_CENTER_FACING: Record<TileEdge, number> = {
  south: 0,
  north: Math.PI,
  east: Math.PI / 2,
  west: -Math.PI / 2,
};

/** rotationY so house doors (+Z after blenderZyFront) point toward tile center. */
const HOUSE_CENTER_FACING: Record<TileEdge, number> = {
  south: Math.PI,
  north: 0,
  east: -Math.PI / 2,
  west: Math.PI / 2,
};

const PERIMETER_EDGE_OFFSET = SHOP_EDGE_OFFSET;

/** Corner clearance for perimeter houses (narrower footprint than shops). */
const HOUSE_ROW_HALF_WIDTH = 1.25;
const HOUSE_INWARD_HALF_DEPTH = 1.0;
const HOUSE_ALONG_HALF = Math.max(
  2.75,
  PERIMETER_EDGE_OFFSET - HOUSE_INWARD_HALF_DEPTH - HOUSE_ROW_HALF_WIDTH,
);
const HOUSE_ALONG_SPAN = HOUSE_ALONG_HALF * 2;
const HOUSES_PER_EDGE = 4;
const SHOPS_PER_EDGE = 3;

export const HERO_ARCHETYPES: ReadonlySet<BlockArchetype> = new Set([
  'landmark',
  'civic',
  'park',
  'industrial',
]);

/** Pooled mid-rise tiles use a centered grid on the slab. */
export const CENTER_CLUSTER_ARCHETYPES: ReadonlySet<BlockArchetype> = new Set([
  'apartment',
  'office',
]);

/** Hero model centered on tile but rotated to face the procedural street edge. */
export function buildHeroSlot(edge: TileEdge): TileSlot {
  return { x: 0, z: 0, rotationY: EDGE_ROTATION[edge], scale: 1.0 };
}

/** Street-light positions at tile corners. */
export const STREET_LIGHT_SLOTS: readonly TileSlot[] = [
  { x: -7.0, z: -7.0, rotationY: 0, scale: 0.85 },
  { x: 7.0, z: -7.0, rotationY: Math.PI, scale: 0.85 },
  { x: -7.0, z: 7.0, rotationY: Math.PI * 0.5, scale: 0.85 },
  { x: 7.0, z: 7.0, rotationY: -Math.PI * 0.5, scale: 0.85 },
];

export function pickArchetype(rand: number): BlockArchetype {
  const slot = Math.min(Math.floor(rand * TILE_ARCHETYPE_CYCLE.length), TILE_ARCHETYPE_CYCLE.length - 1);
  const entry = TILE_ARCHETYPE_CYCLE[slot]!;
  if (entry === BUILDINGS_CYCLE_SLOT) {
    return slot % 2 === 0 ? 'apartment' : 'office';
  }
  return entry;
}

export function pickTileEdge(rand: number): TileEdge {
  return ALL_EDGES[Math.floor(rand * ALL_EDGES.length)]!;
}

function pushPerimeterSlot(
  slots: TileSlot[],
  edge: TileEdge,
  along: number,
  scale: number,
  edgeOffset: number,
  centerFacing: Record<TileEdge, number>,
): void {
  const rotationY = centerFacing[edge];
  switch (edge) {
    case 'south':
      slots.push({ x: along, z: edgeOffset, rotationY, scale });
      break;
    case 'north':
      slots.push({ x: along, z: -edgeOffset, rotationY, scale });
      break;
    case 'east':
      slots.push({ x: edgeOffset, z: along, rotationY, scale });
      break;
    case 'west':
      slots.push({ x: -edgeOffset, z: along, rotationY, scale });
      break;
  }
}

/**
 * Shops ring the tile: exactly SHOPS_PER_EDGE per side, doors toward center.
 */
export function buildPerimeterShopSlots(): readonly TileSlot[] {
  const scale = BUILDING_SCALE;
  const step = SHOPS_PER_EDGE > 1 ? SHOP_ALONG_SPAN / (SHOPS_PER_EDGE - 1) : 0;
  const start = -SHOP_ALONG_HALF;

  const slots: TileSlot[] = [];
  for (const edge of ALL_EDGES) {
    for (let i = 0; i < SHOPS_PER_EDGE; i++) {
      const along = SHOPS_PER_EDGE > 1 ? start + step * i : 0;
      pushPerimeterSlot(slots, edge, along, scale, PERIMETER_EDGE_OFFSET, SHOP_CENTER_FACING);
    }
  }
  return slots;
}

/**
 * Houses ring the tile: four per edge, front doors facing the tile center.
 */
export function buildPerimeterHouseSlots(): readonly TileSlot[] {
  const scale = BUILDING_SCALE;
  const step = HOUSE_ALONG_SPAN / (HOUSES_PER_EDGE - 1);
  const start = -HOUSE_ALONG_HALF;

  const slots: TileSlot[] = [];
  for (const edge of ALL_EDGES) {
    for (let i = 0; i < HOUSES_PER_EDGE; i++) {
      const along = start + step * i;
      pushPerimeterSlot(slots, edge, along, scale, PERIMETER_EDGE_OFFSET, HOUSE_CENTER_FACING);
    }
  }
  return slots;
}

/**
 * Place 4–5 models in a single row along one tile edge, side by side, facing outward.
 */
export function buildMultiModelSlots(count: number, edge: TileEdge): readonly TileSlot[] {
  const n = Math.min(Math.max(count, 4), 5);
  const rotationY = EDGE_ROTATION[edge];
  const step = n > 1 ? ROW_SPAN / (n - 1) : 0;
  const start = -ROW_SPAN / 2;
  const scale = BUILDING_SCALE;

  const slots: TileSlot[] = [];
  for (let i = 0; i < n; i++) {
    const along = start + step * i;
    switch (edge) {
      case 'south':
        slots.push({ x: along, z: EDGE_CENTER, rotationY, scale });
        break;
      case 'north':
        slots.push({ x: along, z: -EDGE_CENTER, rotationY, scale });
        break;
      case 'east':
        slots.push({ x: EDGE_CENTER, z: along, rotationY, scale });
        break;
      case 'west':
        slots.push({ x: -EDGE_CENTER, z: along, rotationY, scale });
        break;
    }
  }
  return slots;
}

function slotScaleForGridSpacing(spacing: number): number {
  const cell = spacing > 0 ? spacing : TILE_GRID_SPAN;
  return ((cell * GRID_BUILDING_FILL) / BUILDING_CATALOG_FOOTPRINT) * BUILDING_SLOT_SCALE;
}

export function buildCenterGridSlots(count: number, edge: TileEdge): readonly TileSlot[] {
  const n = Math.min(Math.max(count, 6), 16);
  const rotationY = EDGE_ROTATION[edge];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const spacingX = cols > 1 ? TILE_GRID_SPAN / (cols - 1) : 0;
  const spacingZ = rows > 1 ? TILE_GRID_SPAN / (rows - 1) : 0;
  const spacing =
    cols > 1 && rows > 1
      ? Math.min(spacingX, spacingZ)
      : cols > 1
        ? spacingX
        : rows > 1
          ? spacingZ
          : 0;
  const spanX = cols > 1 ? spacingX * (cols - 1) : 0;
  const spanZ = rows > 1 ? spacingZ * (rows - 1) : 0;
  const startX = -spanX / 2;
  const startZ = -spanZ / 2;
  const scale = slotScaleForGridSpacing(spacing);

  const slots: TileSlot[] = [];
  let i = 0;
  for (let row = 0; row < rows && i < n; row++) {
    for (let col = 0; col < cols && i < n; col++) {
      slots.push({
        x: startX + col * spacingX,
        z: startZ + row * spacingZ,
        rotationY,
        scale,
      });
      i += 1;
    }
  }
  return slots;
}

/** Centered parking plaza for shop tiles (among perimeter storefronts). */
export function buildShopParkingSlot(): TileSlot {
  return { x: 0, z: 0, rotationY: 0, scale: 1.0 };
}
export function resolveBuildingSlots(
  archetype: BlockArchetype,
  count: number,
  rand: () => number,
  edgeOverride?: TileEdge,
): readonly TileSlot[] {
  if (archetype === 'shop') {
    return buildPerimeterShopSlots();
  }
  if (archetype === 'small_house') {
    return buildPerimeterHouseSlots();
  }
  const edge = edgeOverride ?? pickTileEdge(rand());
  if (HERO_ARCHETYPES.has(archetype)) {
    return [buildHeroSlot(edge)];
  }
  if (CENTER_CLUSTER_ARCHETYPES.has(archetype)) {
    return buildCenterGridSlots(count, edge);
  }
  return buildMultiModelSlots(count, edge);
}

/** Hero tiles get one model; perimeter shops/houses ring the tile; grid tiles get 9–16. */
export function slotCountForArchetype(type: BlockArchetype, rand: number): number {
  if (HERO_ARCHETYPES.has(type)) return 1;
  if (type === 'shop') {
    return SHOPS_PER_EDGE * 4;
  }
  if (type === 'small_house') {
    return HOUSES_PER_EDGE * 4;
  }
  if (CENTER_CLUSTER_ARCHETYPES.has(type)) {
    if (rand > 0.55) return 16;
    if (rand > 0.3) return 12;
    return 9;
  }
  return rand > 0.35 ? 5 : 4;
}
