import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VEHICLE_TARGET_LENGTH } from './config';
import {
  CAR_CATALOG_URL,
  CAR_GLB_BASE,
  catalogCarFilename,
  type CarCatalogEntry,
  type CarCatalogFile,
} from './carPools';
import { applyBlenderAssetLighting } from './blenderAssetLighting';
import {
  faceForward,
  groundAndCenter,
  normalizeFootprint,
  orientUpright,
} from './orientModel';

/** Bump when vehicle GLBs are re-exported to bust browser cache. */
const VEHICLE_ASSET_VERSION = '20260625carv4';

interface CarTemplate {
  id: string;
  label: string;
  targetLength: number;
  template: THREE.Object3D;
}

/**
 * Loads pooled vehicle GLBs for future street traffic.
 * Call `cloneCar(id)` to spawn an oriented, grounded instance.
 */
export class VehicleCatalog {
  private readonly _cars = new Map<string, CarTemplate>();
  private _loaded = false;

  async loadAll(): Promise<void> {
    if (this._loaded) return;

    const catalog = await this._fetchCatalog();
    const loader = new GLTFLoader();

    await Promise.all(
      catalog.vehicles.map(async (entry) => {
        const file = catalogCarFilename(entry);
        const url = `${CAR_GLB_BASE}/${file}?v=${VEHICLE_ASSET_VERSION}`;
        try {
          const gltf = await loader.loadAsync(url);
          const wrapped = this._wrapVehicle(gltf.scene, entry);
          this._cars.set(entry.id, {
            id: entry.id,
            label: entry.label ?? entry.id,
            targetLength: entry.targetLength,
            template: wrapped,
          });
        } catch (err) {
          console.warn(`[VehicleCatalog] failed to load ${entry.id}:`, err);
        }
      }),
    );

    this._loaded = true;
    const ids = this.listIds();
    console.info(`[VehicleCatalog] loaded ${ids.length} vehicle(s):`, ids.join(', '));
  }

  cloneCar(id: string, _seed = 0): THREE.Object3D | null {
    const car = this._cars.get(id);
    if (!car) return null;
    const clone = car.template.clone(true);
    clone.traverse((child) => {
      child.frustumCulled = false;
    });
    return clone;
  }

  listIds(): readonly string[] {
    return [...this._cars.keys()].sort();
  }

  pickRandomId(rand: () => number): string | null {
    const ids = this.listIds();
    if (ids.length === 0) return null;
    return ids[Math.floor(rand() * ids.length)] ?? ids[0]!;
  }

  /**
   * Pick a variant that is under-represented among active traffic and lifetime spawns
   * so all catalog entries appear over time.
   */
  pickVarietyId(
    rand: () => number,
    activeCounts: ReadonlyMap<string, number>,
    lifetimeCounts: ReadonlyMap<string, number>,
  ): string | null {
    const ids = this.listIds();
    if (ids.length === 0) return null;

    let bestIds: string[] = [];
    let bestScore = Infinity;
    for (const id of ids) {
      const score = (activeCounts.get(id) ?? 0) * 3 + (lifetimeCounts.get(id) ?? 0);
      if (score < bestScore) {
        bestScore = score;
        bestIds = [id];
      } else if (score === bestScore) {
        bestIds.push(id);
      }
    }

    return bestIds[Math.floor(rand() * bestIds.length)] ?? ids[0]!;
  }

  getTemplate(id: string): THREE.Object3D | undefined {
    return this._cars.get(id)?.template;
  }

  private async _fetchCatalog(): Promise<CarCatalogFile> {
    const res = await fetch(`${CAR_CATALOG_URL}?v=${VEHICLE_ASSET_VERSION}`);
    if (!res.ok) throw new Error(`Failed to load vehicle catalog: ${res.status}`);
    return res.json() as Promise<CarCatalogFile>;
  }

  private _wrapVehicle(scene: THREE.Object3D, entry: CarCatalogEntry): THREE.Group {
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.add(scene);
    root.add(body);

    orientUpright(body);
    this._alignVehicleForward(body);
    normalizeFootprint(body, entry.targetLength || VEHICLE_TARGET_LENGTH);
    groundAndCenter(body);
    faceForward(body);

    applyBlenderAssetLighting(body, 'shop');
    body.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return root;
  }

  /** Lay length along +Z; Blender export_yup often puts front on -Z. */
  private _alignVehicleForward(object: THREE.Object3D): void {
    object.updateMatrixWorld(true);
    let size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());

    if (size.x > size.z * 1.05) {
      object.rotateY(-Math.PI / 2);
      object.updateMatrixWorld(true);
      size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    }

    if (size.z < size.x * 0.95) {
      object.rotateY(Math.PI / 2);
    }

    object.rotateY(Math.PI);
  }
}
