/** World generation constants for the tile-based procedural city. */

/** Site root from Vite (`/` locally, `/world-portfolio/` on GitHub Pages). */
export const SITE_BASE = import.meta.env.BASE_URL;
/** Runtime GLB and catalog root under `public/assets`. */
export const ASSET_BASE = `${SITE_BASE}assets`;

/** Grid spacing from tile center to tile center. */
export const TILE_SIZE = 22;

/** Visible floor slab size (gap = TILE_SIZE - TILE_FLOOR_SIZE). */
export const TILE_FLOOR_SIZE = 17.5;

/** Gap between floating tile platforms. */
export const TILE_GAP = TILE_SIZE - TILE_FLOOR_SIZE;

/** Inset from slab edge to outermost building facade. */
export const TILE_BUILDING_INSET = 0.65;

/** Usable span for building grids and hero footprints on the slab. */
export const TILE_BUILDING_USABLE = TILE_FLOOR_SIZE - TILE_BUILDING_INSET * 2;

/** Catalog normalize size for pooled / row buildings before per-slot scale. */
export const BUILDING_CATALOG_FOOTPRINT = 2.55;

/** Target world height for houses and shops (after catalog wrap). */
export const BUILDING_CATALOG_HEIGHT = 3.2;

/** Single hero GLB target max XZ footprint on the slab. */
export const BUILDING_HERO_FOOTPRINT = 7.5;

/**
 * Industrial plant footprint. The plant is a wide, sprawling shed rather than a
 * tower, so the generic hero size left a lot of empty slab; this fills more of
 * the usable span (TILE_BUILDING_USABLE ~= 16.2) while keeping a street margin.
 */
export const BUILDING_INDUSTRIAL_FOOTPRINT = 11.5;

/**
 * Park plaza footprint. The park is the sole hero on its tile (no perimeter
 * buildings), so it spans the full visible floor slab edge to edge.
 */
export const BUILDING_PARK_FOOTPRINT = TILE_FLOOR_SIZE;

/**
 * Landmark hero footprint. Portal lab and time machine are the sole centerpiece on
 * their tile; the default hero size left too much empty slab.
 */
export const BUILDING_LANDMARK_FOOTPRINT = 12.5;

/** How much of the slab a building grid spans (centered; leaves a street margin). */
export const TILE_GRID_SPAN = TILE_FLOOR_SIZE * 0.66;

/** Grid slot scale: footprint as a fraction of cell spacing. */
export const GRID_BUILDING_FILL = 0.85;

/** Extra downscale on grid / row slot multipliers. */
export const BUILDING_SLOT_SCALE = 0.76;

/** Max XZ footprint for the shop-tile center parking plaza prop. */
export const SHOP_PARKING_FOOTPRINT = 11.5;

/** Max XZ footprint for the house-tile center fountain garden prop. */
export const FOUNTAIN_GARDEN_FOOTPRINT = 8.0;

/** How many tiles visible in each direction from the camera anchor (minimum). */
export const TILE_RADIUS = 5;
/** Maximum tile ring when zoomed out. Pool is sized for this. */
export const TILE_RADIUS_MAX = 9;

/**
 * Tile ring radius from orbit distance so zoomed-out views still fill the
 * frustum; clamped between TILE_RADIUS and TILE_RADIUS_MAX.
 */
export function computeTileRadius(
  cameraDistance: number,
  fovDeg: number,
  aspect: number,
): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hTan = Math.tan(vFov / 2) * aspect;
  const sinP = Math.sin(CAMERA.polarAngle);
  const span = cameraDistance * sinP * hTan * 2.4;
  const tiles = Math.ceil(span / TILE_SIZE);
  return Math.max(TILE_RADIUS, Math.min(TILE_RADIUS_MAX, tiles + 1));
}

/** Maximum buildings per tile (instanced boxes). */
export const BUILDINGS_PER_TILE = 14;

/** Sky-lane height above each tile's local origin (visible above rooftops from default camera). */
export const SKY_LANE_Y = 8.2;

/** Cruise altitude for ships — above rooftop clusters and apartment grids. */
export const SHIP_CRUISE_Y = 12.8;

/** Hover height for cars in the void corridors between tile slabs. */
export const CAR_CRUISE_Y = 2.4;

/** Default normalized length for vehicle GLBs (meters, longest XZ axis). */
export const VEHICLE_TARGET_LENGTH = 4.8;

/** Max ships visible inside the camera frustum at once. */
export const SHIP_MAX_IN_VIEW = 3;

/** World-units margin beyond the frustum before a ship may despawn. */
export const SHIP_KEEP_ALIVE_MARGIN = 110;

/** Minimum spacing between ships (world units). */
export const SHIP_MIN_SEPARATION = 72;

/** Seconds between spawn attempts when under the in-view cap. */
export const SHIP_SPAWN_INTERVAL = 6;

/** Minimum seconds a ship must exist before it can despawn off-screen. */
export const SHIP_MIN_LIFETIME = 14;

/** Seconds continuously out of view before despawn is allowed. */
export const SHIP_DESPAWN_OUTVIEW_SEC = 2.5;

/** Do not spawn ships within this XZ radius of the orbit target (spawn point only). */
export const SHIP_SPAWN_EXCLUDE_RADIUS = 38;

/**
 * When the orbit target is within this XZ distance of world origin, skip the four gap
 * corridors that border tile (0,0) — they caused center-tile flicker, not outer routes.
 */
export const SHIP_ORIGIN_GAP_GUARD_RADIUS = TILE_SIZE * 1.5;

/** Tiles of inner margin before route coverage expands (prevents edge rebuild churn). */
export const SHIP_ROUTE_COVERAGE_MARGIN = 3;

/** Closest approach before ships slow down (world units). */
export const SHIP_AVOID_RADIUS = 38;

/** Route extent beyond TILE_RADIUS (tiles) — routes use full TILE_RADIUS grid. */
export const SHIP_ROUTE_TILE_PAD = 0;

/** @deprecated Gap routes replace lateral offset — kept for manifest compatibility. */
export const SHIP_ROUTE_LATERAL = TILE_FLOOR_SIZE * 0.38;

/** Only spawn ships on lanes within this tile radius of the camera anchor. */
export const SHIP_LANE_RADIUS = 3;

/** @deprecated Use SHIP_MAX_IN_VIEW — kept for HUD compatibility during migration. */
export const SHIP_COUNT = SHIP_MAX_IN_VIEW;

/** Max cars visible in the camera frustum at once. */
export const CAR_MAX_IN_VIEW = 10;

/** World-units margin for car frustum tests. */
export const CAR_VIEW_RADIUS = 12;

/** Minimum spacing between cars (world units). */
export const CAR_MIN_SEPARATION = 9;

/** Seconds between car spawn attempts when under the in-view cap. */
export const CAR_SPAWN_INTERVAL = 1.8;

/** Minimum seconds a car must exist before it can despawn off-screen. */
export const CAR_MIN_LIFETIME = 8;

/** Seconds continuously out of view before a car may despawn. */
export const CAR_DESPAWN_OUTVIEW_SEC = 2;

/** Do not spawn cars within this XZ radius of the orbit target. */
export const CAR_SPAWN_EXCLUDE_RADIUS = 24;

/** Tiles of inner margin before car route coverage expands. */
export const CAR_ROUTE_COVERAGE_MARGIN = 3;

/** Closest approach before cars slow down (world units). */
export const CAR_AVOID_RADIUS = 14;

/** Gentle hover bob for cars in gap corridors. */
export const CAR_BOB_AMP = 0.08;
export const CAR_BOB_SPEED = 3.1;

/** Lateral offset from corridor center — opposite travel directions use opposite sides. */
export const CAR_LANE_OFFSET = TILE_GAP * 0.24;

/**
 * Graph-traffic tuning for cars. Cars navigate the inter-tile lattice, take
 * turns at intersections, keep lane spacing, and yield via node reservations.
 */
export const CAR_TRAFFIC = {
  laneOffset: TILE_GAP * 0.26,
  maxInView: 14,
  spawnPerTick: 3,
  spawnInterval: 0.5,
  minLifetimeSec: 6,
  despawnOutViewSec: 1.5,
  speedMin: 7,
  speedMax: 12,
  bobAmp: 0.07,
  bobSpeed: 3.1,
  followGap: 9,
  minGap: 6,
  separationRadius: 4.6,
  intersectionRadius: 5.5,
  turnRadius: 5,
  viewRadius: 11,
  nearHideRadius: 4,
  visibilityGraceSec: 0,
  cameraAvoidRadius: 0,
  cameraAvoidMaxOffset: 0,
  cameraAvoidSeparation: 0,
  turnStraight: 3,
  turnTurn: 1,
  coverageMargin: 3,
  avoidHeadOn: false,
  headOnGap: 0,
  headOnRouteGap: 0,
  jamEscape: true,
  jamStuckSec: 2,
  jamReverseSpeed: 0.45,
  jamReverseMaxSec: 2.5,
  /** Lane-based following; opposing lanes are separate edges. */
  smoothFlow: false,
  scaleMin: 0.82,
  scaleMax: 0.92,
} as const;

/** Graph-traffic tuning for ships (higher altitude, fewer, smoother turns). */
export const SHIP_TRAFFIC = {
  // Ships use a single centered lane (no opposing-direction split like cars).
  laneOffset: 0,
  maxInView: 3,
  spawnPerTick: 2,
  spawnInterval: 1.2,
  minLifetimeSec: 8,
  despawnOutViewSec: 2.5,
  speedMin: 6,
  speedMax: 10,
  bobAmp: 0,
  bobSpeed: 2.2,
  followGap: 28,
  minGap: 14,
  /** ~max scaled ship hull length (6.2 * 2.05); keeps hulls from interpenetrating. */
  separationRadius: 13,
  intersectionRadius: 8,
  turnRadius: 9,
  viewRadius: 14,
  /** 0 = never hide ships near the lens (sidestep handles camera clearance). */
  nearHideRadius: 0,
  /** Brief visibility hold after leaving frustum to prevent edge flicker. */
  visibilityGraceSec: 0.35,
  /** XZ sidestep radius around the camera lens (ships skirt sideways, no climb). */
  cameraAvoidRadius: 14,
  /** Max lateral sidestep so ships stay over the gap, not rooftops. */
  cameraAvoidMaxOffset: TILE_GAP * 0.32,
  /** Min clearance from rooftops while sidestepping (not from other ships). */
  cameraAvoidSeparation: 0,
  turnStraight: 4,
  turnTurn: 2,
  coverageMargin: 3,
  avoidHeadOn: false,
  headOnGap: 0,
  headOnRouteGap: 0,
  jamEscape: false,
  jamStuckSec: 0,
  jamReverseSpeed: 0,
  jamReverseMaxSec: 0,
  /** Each ship gets exclusive edge ownership; never stops, stuck ships despawn. */
  smoothFlow: true,
  scaleMin: 1.55,
  scaleMax: 2.05,
} as const;

/** Gentle bob amplitude / speed for floating tiles. */
export const TILE_FLOAT_AMP = 0.42;
export const TILE_FLOAT_SPEED = 0.55;
export const TILE_TILT_AMP = 0.018;

/** Camera orbit defaults. */
export const CAMERA = {
  target: [0, 3, 0] as const,
  distance: 28,
  minDistance: 18,
  maxDistance: 85,
  polarAngle: 0.92,
  azimuth: 0.65,
  /** Screen drag to world-units scale (multiplied by orbit distance). */
  panScale: 0.0018,
};

/** Pastel neon palette inspired by Infinitown. */
export const PALETTE: ReadonlyArray<[number, number, number]> = [
  [0.95, 0.45, 0.55],
  [0.45, 0.75, 0.95],
  [0.55, 0.9, 0.65],
  [0.95, 0.75, 0.35],
  [0.7, 0.5, 0.95],
  [0.35, 0.85, 0.85],
  [0.95, 0.55, 0.35],
  [0.4, 0.55, 0.95],
];

/** Compute Y offset for a tile's floating wave motion. */
export function tileFloatOffset(tx: number, tz: number, timeSec: number): number {
  const phase = tx * 0.72 + tz * 0.53;
  const primary = Math.sin(timeSec * TILE_FLOAT_SPEED + phase) * TILE_FLOAT_AMP;
  const secondary = Math.sin(timeSec * TILE_FLOAT_SPEED * 0.62 + phase * 1.37) * TILE_FLOAT_AMP * 0.38;
  return primary + secondary;
}

/** Subtle tilt for floating tiles. */
export function tileFloatTilt(tx: number, tz: number, timeSec: number): { x: number; z: number } {
  const phase = tx * 0.41 + tz * 0.67;
  return {
    x: Math.sin(timeSec * 0.31 + phase) * TILE_TILT_AMP,
    z: Math.cos(timeSec * 0.27 + phase * 1.1) * TILE_TILT_AMP,
  };
}

/** World-space center of a grid tile. */
export function tileWorldCenter(tx: number, tz: number): { x: number; y: number; z: number } {
  return { x: tx * TILE_SIZE, y: 0, z: tz * TILE_SIZE };
}
