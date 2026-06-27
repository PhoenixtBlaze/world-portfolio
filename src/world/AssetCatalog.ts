import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BlockArchetype } from './BlockArchetypes';
import {
  BUILDING_CATALOG_FOOTPRINT,
  BUILDING_CATALOG_HEIGHT,
  BUILDING_HERO_FOOTPRINT,
  BUILDING_INDUSTRIAL_FOOTPRINT,
  BUILDING_LANDMARK_FOOTPRINT,
  BUILDING_PARK_FOOTPRINT,
  ASSET_BASE,
  FOUNTAIN_GARDEN_FOOTPRINT,
  SHOP_PARKING_FOOTPRINT,
} from './config';
import {
  ARCHETYPE_POOL,
  catalogGlbFilename,
  POOL_CATALOG_URL,
  POOL_GLB_BASE,
  type BuildingCatalogEntry,
  type BuildingCatalogFile,
  type BuildingPoolId,
} from './buildingPools';
import {
  applyBuildingMaterialVariant,
  applyPropMaterialVariant,
  applyRenderOrder,
} from './materialVariants';
import {
  applyBlenderAssetLighting,
  preservesAuthoredMaterials,
  usesAuthoredHeroMaterials,
  usesAuthoredPoolMaterials,
} from './blenderAssetLighting';
import { applyHouseStripeColor, resolveHouseStripeColor } from './houseStripeColors';
import {
  FOLIAGE_BASE,
  FOLIAGE_BY_KIND,
  FOLIAGE_VARIANTS,
  isFoliageKind,
  type FoliageKind,
} from './foliagePools';
import { installShopHologram } from './shopHologram';
import {
  alignBlenderYFrontToPlusZ,
  alignFacadeToPlusZ,
  alignNegativeXFrontToPlusZ,
  bakeFacadeSpin,
  faceForward,
  groundAndCenter,
  normalizeGround,
  normalizeToHeight,
  orientBlenderZUp,
  orientBlenderZUpZFront,
  orientUpright,
  type AssetLayout,
} from './orientModel';

/** Props loaded as a single GLB template (one mesh per kind). */
export type SinglePropKind =
  | 'street_light'
  | 'bench'
  | 'shop_parking_lot'
  | 'fountain_garden';

/** Single props that are centered ground plates (footprint-normalized, not height). */
const GROUNDPLATE_PROPS: Record<'shop_parking_lot' | 'fountain_garden', number> = {
  shop_parking_lot: SHOP_PARKING_FOOTPRINT,
  fountain_garden: FOUNTAIN_GARDEN_FOOTPRINT,
};
/** All prop kinds: single templates plus pooled foliage (tree, bush). */
export type PropKind = SinglePropKind | FoliageKind;

/** Bump when Blender assets are re-exported to bust browser GLB cache. */
const ASSET_VERSION = '20260625perfopt1';

const BUILDING_PATHS: Record<BlockArchetype, string> = {
  small_house: `${ASSET_BASE}/buildings/small_house.glb?v=${ASSET_VERSION}`,
  apartment: `${ASSET_BASE}/buildings/apartment.glb?v=${ASSET_VERSION}`,
  office: `${ASSET_BASE}/buildings/office.glb?v=${ASSET_VERSION}`,
  shop: `${ASSET_BASE}/buildings/shop.glb?v=${ASSET_VERSION}`,
  industrial: `${ASSET_BASE}/buildings/industrial.glb?v=${ASSET_VERSION}`,
  park: `${ASSET_BASE}/buildings/park.glb?v=${ASSET_VERSION}`,
  civic: `${ASSET_BASE}/buildings/civic.glb?v=${ASSET_VERSION}`,
  landmark: `${ASSET_BASE}/buildings/landmark.glb?v=${ASSET_VERSION}`,
};

const PROP_PATHS: Record<SinglePropKind, string> = {
  street_light: `${ASSET_BASE}/props/street_light.glb?v=${ASSET_VERSION}`,
  bench: `${ASSET_BASE}/props/bench.glb?v=${ASSET_VERSION}`,
  shop_parking_lot: `${ASSET_BASE}/props/shop_parking_lot.glb?v=${ASSET_VERSION}`,
  fountain_garden: `${ASSET_BASE}/props/fountain_garden.glb?v=${ASSET_VERSION}`,
};

/** Max XZ footprint after normalize — regular tiles use grid scale; heroes fill the slab. */
const TARGET_FOOTPRINT: Record<BlockArchetype, number> = {
  small_house: BUILDING_CATALOG_FOOTPRINT,
  apartment: BUILDING_CATALOG_FOOTPRINT,
  office: BUILDING_CATALOG_FOOTPRINT,
  shop: BUILDING_CATALOG_FOOTPRINT,
  industrial: BUILDING_INDUSTRIAL_FOOTPRINT,
  park: BUILDING_PARK_FOOTPRINT,
  civic: BUILDING_HERO_FOOTPRINT,
  landmark: BUILDING_LANDMARK_FOOTPRINT,
};

const PROP_TARGET_HEIGHT: Record<
  Exclude<SinglePropKind, 'shop_parking_lot' | 'fountain_garden'>,
  number
> = {
  street_light: 3.8,
  bench: 0.55,
};

const BUILDING_LAYOUT: Record<BlockArchetype, AssetLayout> = {
  small_house: 'blenderZyFront',
  apartment: 'blenderZUpZFront',
  office: 'blenderZUpZFront',
  shop: 'upright',
  industrial: 'upright',
  park: 'groundplate',
  civic: 'upright',
  landmark: 'upright',
};

interface VariantTemplate {
  id: string;
  pool: BuildingPoolId;
  template: THREE.Object3D;
  /** Stripe_Layer1/2 tint for house pool variants. */
  stripeColor?: THREE.Color;
}

/** Loads hero GLBs plus procedural variant pools (houses, apartment-office). */
export class AssetCatalog {
  private readonly _buildings = new Map<BlockArchetype, THREE.Object3D>();
  private readonly _variants = new Map<string, VariantTemplate>();
  private readonly _archetypeVariants = new Map<BlockArchetype, string[]>();
  private readonly _props = new Map<SinglePropKind, THREE.Object3D>();
  /** Pooled foliage templates keyed by variant id (see foliagePools.ts). */
  private readonly _foliage = new Map<string, THREE.Object3D>();
  private _loaded = false;

  async loadAll(): Promise<void> {
    if (this._loaded) return;
    const loader = new GLTFLoader();

    await this._loadVariantPools(loader);

    const heroTypes = (Object.keys(BUILDING_PATHS) as BlockArchetype[]).filter(
      (type) => !ARCHETYPE_POOL[type],
    );

    const results = await Promise.allSettled([
      ...heroTypes.map(async (type) => {
        const gltf = await loader.loadAsync(BUILDING_PATHS[type]);
        const wrapped = this._wrapBuilding(gltf.scene, type);
        this._buildings.set(type, wrapped);
      }),
      ...Object.entries(PROP_PATHS).map(async ([kind, url]) => {
        const gltf = await loader.loadAsync(url);
        const wrapped = this._wrapProp(gltf.scene, kind as SinglePropKind);
        this._props.set(kind as SinglePropKind, wrapped);
      }),
      ...FOLIAGE_VARIANTS.map(async (variant) => {
        const url = `${FOLIAGE_BASE}/${variant.file}?v=${ASSET_VERSION}`;
        const gltf = await loader.loadAsync(url);
        const wrapped = this._wrapFoliage(gltf.scene, variant.targetHeight);
        this._foliage.set(variant.id, wrapped);
      }),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') console.warn('[AssetCatalog] load failed:', r.reason);
    }

    this._loaded = true;
    const variantCount = this._variants.size;
    const poolSummary = [...this._archetypeVariants.entries()]
      .map(([k, v]) => `${k}:${v.length}`)
      .join(', ');
    console.info(
      `[AssetCatalog] loaded ${this._buildings.size} hero buildings, ${variantCount} variants (${poolSummary}), ${this._props.size} props`,
    );
  }

  /** Clone with seed-driven variant pick for pooled archetypes. */
  cloneBuilding(type: BlockArchetype, seed = 0): THREE.Object3D {
    const variantIds = this._archetypeVariants.get(type);
    if (variantIds && variantIds.length > 0) {
      const idx = (seed >>> 0) % variantIds.length;
      const variantId = variantIds[idx]!;
      const clone = this._cloneVariantTemplate(variantId, type, seed);
      if (clone) return clone;
    }

    const template = this._buildings.get(type);
    if (!template) return this._fallbackBuilding(type);
    const clone = template.clone(true);
    if (seed !== 0 && !preservesAuthoredMaterials(type)) {
      applyBuildingMaterialVariant(clone, type, seed);
      applyRenderOrder(clone, 2);
    }
    if (usesAuthoredHeroMaterials(type)) {
      applyBlenderAssetLighting(clone, type);
    }
    if (type === 'shop') {
      installShopHologram(clone);
    }
    return clone;
  }

  cloneProp(kind: PropKind, seed = 0): THREE.Object3D | null {
    if (isFoliageKind(kind)) {
      return this._cloneFoliage(kind, seed);
    }
    const template = this._props.get(kind);
    if (!template) return null;
    const clone = template.clone(true);
    if (kind === 'shop_parking_lot') {
      applyBlenderAssetLighting(clone, 'shop');
    } else if (kind === 'fountain_garden') {
      // Centerpiece for house tiles; keep authored stone/water/plant materials.
      applyBlenderAssetLighting(clone, 'small_house');
    } else if (seed !== 0) {
      applyPropMaterialVariant(clone, kind, seed);
      applyRenderOrder(clone, 3);
    }
    return clone;
  }

  /** Pick a seeded foliage variant and keep its authored bark/leaf materials. */
  private _cloneFoliage(kind: FoliageKind, seed: number): THREE.Object3D | null {
    const ids = FOLIAGE_BY_KIND[kind];
    if (ids.length === 0) return null;
    const id = ids[(seed >>> 0) % ids.length]!;
    const template = this._foliage.get(id);
    if (!template) return null;
    const clone = template.clone(true);
    // Borrow the house night-lighting probe so leaves/bark are not flat; the
    // procedural prop wash is skipped to preserve authored greens and bark.
    applyBlenderAssetLighting(clone, 'small_house');
    return clone;
  }

  getTemplate(type: BlockArchetype): THREE.Object3D | undefined {
    return this._buildings.get(type);
  }

  getVariantCount(type: BlockArchetype): number {
    return this._archetypeVariants.get(type)?.length ?? 0;
  }

  /** Sorted pool variant ids for an archetype (e.g. all landmark GLBs). */
  listVariantIds(type: BlockArchetype): readonly string[] {
    return this._archetypeVariants.get(type) ?? [];
  }

  /** Clone one pooled variant by catalog id (showcase / tile-layout QA). */
  cloneVariantById(variantId: string, seed = 0): THREE.Object3D | null {
    const variant = this._variants.get(variantId);
    if (!variant) return null;
    const type = this._archetypeForPool(variant.pool);
    return this._cloneVariantTemplate(variantId, type, seed);
  }

  /** Resolved stripe color for a house pool variant (from catalog or defaults). */
  getHouseStripeColor(variantId: string): THREE.Color | undefined {
    return this._variants.get(variantId)?.stripeColor;
  }

  private _archetypeForPool(poolId: BuildingPoolId): BlockArchetype {
    for (const [archetype, pool] of Object.entries(ARCHETYPE_POOL) as [BlockArchetype, BuildingPoolId][]) {
      if (pool === poolId) return archetype;
    }
    return 'apartment';
  }

  private _cloneVariantTemplate(
    variantId: string,
    type: BlockArchetype,
    seed: number,
  ): THREE.Object3D | null {
    const variant = this._variants.get(variantId);
    if (!variant) return null;

    const clone = variant.template.clone(true);
    if (usesAuthoredPoolMaterials(type)) {
      if (variant.stripeColor) {
        applyHouseStripeColor(clone, variant.stripeColor);
      }
      applyBlenderAssetLighting(clone, type);
    } else if (usesAuthoredHeroMaterials(type)) {
      applyBlenderAssetLighting(clone, type);
    } else if (seed !== 0) {
      applyBuildingMaterialVariant(clone, type, seed);
      applyRenderOrder(clone, 2);
    }
    return clone;
  }

  private async _loadVariantPools(loader: GLTFLoader): Promise<void> {
    const poolIds = [...new Set(Object.values(ARCHETYPE_POOL))] as BuildingPoolId[];

    for (const poolId of poolIds) {
      const catalog = await this._fetchCatalog(poolId);
      const base = POOL_GLB_BASE[poolId];

      await Promise.all(
        catalog.buildings.map(async (entry) => {
          const file = catalogGlbFilename(entry);
          const url = `${base}/${file}?v=${ASSET_VERSION}`;
          try {
            const gltf = await loader.loadAsync(url);
            const archetype = this._archetypeForEntry(entry, poolId);
            const wrapped = this._wrapBuilding(gltf.scene, archetype);
            const stripeColor =
              poolId === 'houses'
                ? resolveHouseStripeColor(entry.id, entry.stripeColor)
                : undefined;
            this._variants.set(entry.id, {
              id: entry.id,
              pool: poolId,
              template: wrapped,
              stripeColor,
            });
          } catch (err) {
            console.warn(`[AssetCatalog] variant load failed ${entry.id}:`, err);
          }
        }),
      );
    }

    for (const [archetype, poolId] of Object.entries(ARCHETYPE_POOL) as [BlockArchetype, BuildingPoolId][]) {
      const ids = [...this._variants.values()]
        .filter((v) => v.pool === poolId)
        .map((v) => v.id)
        .sort();
      if (ids.length > 0) {
        this._archetypeVariants.set(archetype, ids);
      } else if (poolId === 'houses') {
        console.warn('[AssetCatalog] No house variants loaded — check public/assets/buildings/pools/houses/*.glb');
      }
    }
  }

  private async _fetchCatalog(poolId: BuildingPoolId): Promise<BuildingCatalogFile> {
    const res = await fetch(`${POOL_CATALOG_URL[poolId]}?v=${ASSET_VERSION}`);
    if (!res.ok) throw new Error(`Failed to load catalog ${poolId}: ${res.status}`);
    return res.json() as Promise<BuildingCatalogFile>;
  }

  private _archetypeForEntry(entry: BuildingCatalogEntry, poolId: BuildingPoolId): BlockArchetype {
    if (entry.suggestedArchetype === 'office') return 'office';
    if (entry.suggestedArchetype === 'apartment') return 'apartment';
    if (entry.suggestedArchetype === 'landmark' || poolId === 'landmarks') return 'landmark';
    if (poolId === 'houses') return 'small_house';
    return 'apartment';
  }

  private _wrapBuilding(scene: THREE.Object3D, type: BlockArchetype): THREE.Group {
    const root = new THREE.Group();
    const facade = new THREE.Group();
    const upright = new THREE.Group();
    upright.add(scene);
    facade.add(upright);
    root.add(facade);

    const layout = BUILDING_LAYOUT[type];
    // Upright and facade spins stay on separate nodes so Y-front alignment cannot tip Z-up fixes.
    if (layout === 'blenderZyFront') {
      orientBlenderZUp(upright);
    } else if (layout === 'blenderZUpZFront') {
      orientBlenderZUpZFront(upright);
    } else {
      orientUpright(upright, layout);
    }
    if (layout === 'blenderZyFront') {
      alignBlenderYFrontToPlusZ(facade);
    } else if (type === 'shop') {
      alignNegativeXFrontToPlusZ(facade);
    } else {
      alignFacadeToPlusZ(facade);
    }
    bakeFacadeSpin(upright, facade);
    faceForward(facade);
    if (type === 'shop') {
      normalizeToHeight(facade, BUILDING_CATALOG_HEIGHT);
    } else {
      normalizeGround(facade, TARGET_FOOTPRINT[type]);
    }
    this._tagMaterials(scene);
    applyRenderOrder(root, 2);

    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    if (type === 'shop') {
      installShopHologram(root);
    }

    return root;
  }

  private _wrapProp(scene: THREE.Object3D, kind: SinglePropKind): THREE.Group {
    const root = new THREE.Group();
    root.add(scene);

    const groundplateFootprint = (GROUNDPLATE_PROPS as Record<string, number>)[kind];
    if (groundplateFootprint !== undefined) {
      orientUpright(scene, 'groundplate');
      faceForward(scene);
      normalizeGround(scene, groundplateFootprint);
    } else {
      orientUpright(scene);
      faceForward(scene);
      const box = new THREE.Box3().setFromObject(scene);
      const height = Math.max(box.max.y - box.min.y, 0.001);
      scene.scale.multiplyScalar(
        PROP_TARGET_HEIGHT[kind as keyof typeof PROP_TARGET_HEIGHT] / height,
      );
      groundAndCenter(scene);
    }

    this._tagMaterials(scene);
    applyRenderOrder(root, 3);

    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
      }
    });
    return root;
  }

  /** Normalize a pooled foliage GLB to a target height, base on the ground. */
  private _wrapFoliage(scene: THREE.Object3D, targetHeight: number): THREE.Group {
    const root = new THREE.Group();
    root.add(scene);

    orientUpright(scene);
    const box = new THREE.Box3().setFromObject(scene);
    const height = Math.max(box.max.y - box.min.y, 0.001);
    scene.scale.multiplyScalar(targetHeight / height);
    groundAndCenter(scene);

    this._tagMaterials(scene);
    applyRenderOrder(root, 3);

    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
      }
    });
    return root;
  }

  private _tagMaterials(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial && !m.name) {
          m.name = child.name || 'Mat_Wall';
        }
      }
    });
  }

  private _fallbackBuilding(type: BlockArchetype): THREE.Group {
    const g = new THREE.Group();
    const colors: Record<BlockArchetype, number> = {
      small_house: 0xc88ec8,
      apartment: 0x6eb8e0,
      office: 0x8899bb,
      shop: 0xf08870,
      industrial: 0x667788,
      park: 0x44aa66,
      civic: 0xe0b860,
      landmark: 0x5588dd,
    };
    const mat = new THREE.MeshStandardMaterial({
      name: 'Mat_Wall',
      color: colors[type],
      roughness: 0.55,
      metalness: 0.15,
    });
    const h = type === 'landmark' ? 8 : type === 'park' ? 0.3 : 3;
    const footprint =
      type === 'landmark' || type === 'industrial' || type === 'civic' || type === 'park'
        ? BUILDING_HERO_FOOTPRINT * 0.35
        : BUILDING_CATALOG_FOOTPRINT * 0.5;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(footprint, h, footprint), mat);
    mesh.name = 'Body_Wall';
    mesh.position.y = h * 0.5;
    g.add(mesh);
    return g;
  }
}
