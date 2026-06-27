import * as THREE from 'three';
import { SKY_LANE_Y, TILE_FLOOR_SIZE } from './config';
import {
  pickArchetypeForTile,
  buildShopParkingSlot,
  resolveBuildingSlots,
  slotCountForArchetype,
  STREET_LIGHT_SLOTS,
  type BlockArchetype,
  type TileSlot,
} from './BlockArchetypes';
import { rngForTile } from './rng';
import type { PropKind } from './AssetCatalog';
import type { FoliageKind } from './foliagePools';

export interface LaneSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
}

export interface BuildingPlacement {
  archetype: BlockArchetype;
  slot: TileSlot;
}

export interface PropPlacement {
  kind: PropKind;
  slot: TileSlot;
}

/**
 * Per-archetype foliage scatter plan. Foliage is placed on a radial ring (from
 * tile center) chosen to avoid that archetype's building footprint:
 *  - perimeter-building tiles (houses) leave the center free
 *  - center-grid tiles (apartment/office) only have room in the edge margin
 *  - hero tiles scatter around the central model
 *  - shops are skipped (center parking + perimeter ring leave no gap)
 */
interface FoliagePlan {
  trees: number;
  bushes: number;
  /** Min/max radius from tile center for placement. */
  ring: readonly [number, number];
}

const FOLIAGE_PLANS: Record<BlockArchetype, FoliagePlan> = {
  // House tiles get a central fountain garden, so trees/bushes ring around it
  // (between the garden footprint ~3.75 and the perimeter houses ~6.1).
  small_house: { trees: 2, bushes: 2, ring: [4.3, 5.7] },
  apartment: { trees: 1, bushes: 3, ring: [6.9, 7.8] },
  office: { trees: 1, bushes: 2, ring: [6.9, 7.8] },
  shop: { trees: 0, bushes: 0, ring: [0, 0] },
  industrial: { trees: 2, bushes: 3, ring: [5.0, 7.6] },
  // The sci-fi park model carries its own integrated trees/planters/flora, so the
  // tile no longer scatters the natural foliage pool (kept the city theme cohesive).
  park: { trees: 0, bushes: 0, ring: [0, 0] },
  civic: { trees: 2, bushes: 3, ring: [5.0, 7.6] },
  landmark: { trees: 2, bushes: 3, ring: [5.2, 7.6] },
};

const FOLIAGE_SCALE: Record<FoliageKind, readonly [number, number]> = {
  tree: [0.85, 1.15],
  bush: [0.8, 1.2],
};

/** Scatter trees and bushes on safe radial zones for the given archetype. */
function scatterFoliage(archetype: BlockArchetype, rand: () => number): PropPlacement[] {
  const plan = FOLIAGE_PLANS[archetype];
  const out: PropPlacement[] = [];
  const lush = archetype === 'park';

  const place = (kind: FoliageKind, count: number): void => {
    const [smin, smax] = FOLIAGE_SCALE[kind];
    for (let i = 0; i < count; i++) {
      // Parks fill densely; other tiles vary so they are not uniformly packed.
      if (!lush && rand() > 0.7) continue;
      const angle = rand() * Math.PI * 2;
      const radius = plan.ring[0] + rand() * (plan.ring[1] - plan.ring[0]);
      out.push({
        kind,
        slot: {
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
          rotationY: rand() * Math.PI * 2,
          scale: smin + rand() * (smax - smin),
        },
      });
    }
  };

  place('tree', plan.trees);
  place('bush', plan.bushes);
  return out;
}

export interface TileContent {
  archetype: BlockArchetype;
  buildings: BuildingPlacement[];
  props: PropPlacement[];
  lanes: LaneSegment[];
  floorTint: THREE.Color;
}

const half = TILE_FLOOR_SIZE * 0.5;

/** Generate one tile's content from its grid coordinate. */
export function generateTileContent(tx: number, tz: number): TileContent {
  const rand = rngForTile(tx, tz);
  const archetype = pickArchetypeForTile(tx, tz);
  const count = slotCountForArchetype(archetype, rand());
  const slots = resolveBuildingSlots(archetype, count, rand);

  const buildings: BuildingPlacement[] = [];
  for (let i = 0; i < Math.min(count, slots.length); i++) {
    const slot = slots[i]!;
    buildings.push({
      archetype,
      slot: { ...slot },
    });
  }

  const props: PropPlacement[] = [];
  if (archetype === 'shop') {
    props.push({ kind: 'shop_parking_lot', slot: buildShopParkingSlot() });
  } else if (archetype === 'small_house') {
    props.push({
      kind: 'fountain_garden',
      slot: { x: 0, z: 0, rotationY: 0, scale: 1.0 },
    });
  }
  for (const slot of STREET_LIGHT_SLOTS) {
    if (rand() > 0.35) {
      props.push({ kind: 'street_light', slot: { ...slot } });
    }
  }
  props.push(...scatterFoliage(archetype, rand));

  const laneHalf = half - 1.2;
  const lanes: LaneSegment[] = [
    { start: new THREE.Vector3(-laneHalf, SKY_LANE_Y, 0), end: new THREE.Vector3(laneHalf, SKY_LANE_Y, 0) },
    { start: new THREE.Vector3(0, SKY_LANE_Y, -laneHalf), end: new THREE.Vector3(0, SKY_LANE_Y, laneHalf) },
  ];

  const floorTint = new THREE.Color(
    0.09 + rand() * 0.03,
    0.11 + rand() * 0.03,
    0.17 + rand() * 0.04,
  );

  return { archetype, buildings, props, lanes, floorTint };
}

export function createLaneMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.25, 0.5, 0.85),
    emissive: new THREE.Color(0.12, 0.28, 0.55),
    emissiveIntensity: 0.45,
    metalness: 0.15,
    roughness: 0.4,
    transparent: true,
    opacity: 0.38,
  });
}

export function createGroundMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.09, 0.11, 0.16),
    metalness: 0.08,
    roughness: 0.88,
  });
}

export function createFloorEdgeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.2, 0.45, 0.85),
    emissive: new THREE.Color(0.12, 0.28, 0.65),
    emissiveIntensity: 0.55,
    metalness: 0.35,
    roughness: 0.4,
  });
}

export { TILE_FLOOR_SIZE as TILE_SIZE };
