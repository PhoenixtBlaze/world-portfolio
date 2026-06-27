import * as THREE from 'three';
import {
  TILE_FLOOR_SIZE,
  TILE_RADIUS,
  TILE_RADIUS_MAX,
  TILE_SIZE,
  tileFloatOffset,
  tileFloatTilt,
  tileWorldCenter,
} from './config';
import type { AssetCatalog } from './AssetCatalog';
import { releaseBlenderAssetLighting } from './blenderAssetLighting';
import { updateShopHologram } from './shopHologram';
import { hashCoords } from './rng';
import {
  createFloorEdgeMaterial,
  createGroundMaterial,
  generateTileContent,
  type TileContent,
} from './TileGenerator';

interface PooledTile {
  key: string;
  tx: number;
  tz: number;
  root: THREE.Group;
  content: THREE.Group;
  ground: THREE.Mesh;
  edge: THREE.Mesh;
  lanes: THREE.Group;
  capacity: number;
  /** True when this tile's archetype is 'shop' and its content has hologram meshes. */
  hasHolograms: boolean;
}

/** Bounding-sphere radius used for per-tile frustum tests. Covers the slab
 *  (TILE_FLOOR_SIZE 17.5) plus max building height (~13) with a small buffer. */
const TILE_CULL_RADIUS = 20;

/** Infinite floating tile grid with Blender building models per archetype. */
export class TileWorld {
  readonly root = new THREE.Group();
  readonly groundMaterial = createGroundMaterial();
  readonly edgeMaterial = createFloorEdgeMaterial();

  private readonly _pool: PooledTile[] = [];
  private readonly _poolSize = (TILE_RADIUS_MAX * 2 + 1) ** 2;
  private _anchorTx = Number.NaN;
  private _anchorTz = Number.NaN;
  private _activeRadius = TILE_RADIUS;
  private _catalog: AssetCatalog;
  private _timeSec = 0;

  // Frustum culling helpers — reused each frame to avoid allocations.
  private readonly _frustum = new THREE.Frustum();
  private readonly _projScreenMatrix = new THREE.Matrix4();
  private readonly _cullSphere = new THREE.Sphere();

  constructor(catalog: AssetCatalog) {
    this._catalog = catalog;
    for (let i = 0; i < this._poolSize; i++) {
      const ground = new THREE.Mesh(
        new THREE.BoxGeometry(TILE_FLOOR_SIZE, 0.45, TILE_FLOOR_SIZE),
        this.groundMaterial.clone(),
      );
      ground.receiveShadow = true;
      ground.renderOrder = 0;
      ground.position.y = 0.02;

      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(TILE_FLOOR_SIZE + 0.35, 0.12, TILE_FLOOR_SIZE + 0.35),
        this.edgeMaterial,
      );
      edge.position.y = -0.28;
      edge.renderOrder = 1;

      const content = new THREE.Group();
      const lanes = new THREE.Group();
      const root = new THREE.Group();
      root.add(edge, ground, content, lanes);

      this._pool.push({
        key: '',
        tx: 0,
        tz: 0,
        root,
        content,
        ground,
        edge,
        lanes,
        capacity: 8,
        hasHolograms: false,
      });
      root.visible = false;
      this.root.add(root);
    }
  }

  get anchorTx(): number {
    return this._anchorTx;
  }

  get anchorTz(): number {
    return this._anchorTz;
  }

  get activeRadius(): number {
    return this._activeRadius;
  }

  get timeSec(): number {
    return this._timeSec;
  }

  updateAnimation(dt: number, camera?: THREE.Camera): void {
    this._timeSec += dt;

    // Rebuild the view-projection frustum once per frame when a camera is
    // provided.  Used to skip draw calls and hologram updates for tiles that
    // are completely outside the view volume.
    let hasFrustum = false;
    if (camera) {
      camera.updateMatrixWorld(false);
      this._projScreenMatrix.multiplyMatrices(
        (camera as THREE.PerspectiveCamera).projectionMatrix,
        camera.matrixWorldInverse,
      );
      this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
      hasFrustum = true;
    }

    for (const slot of this._pool) {
      if (!slot.key) continue;

      const center = tileWorldCenter(slot.tx, slot.tz);
      const y = tileFloatOffset(slot.tx, slot.tz, this._timeSec);
      const tilt = tileFloatTilt(slot.tx, slot.tz, this._timeSec);

      // Always update the world position so tiles snap correctly when they
      // come back into the frustum — no pop-in.
      slot.root.position.set(center.x, y, center.z);
      slot.root.rotation.set(tilt.x, 0, tilt.z);

      // Frustum test: cull the entire tile subtree when it is outside the
      // camera view.  Three.js skips all rendering (draw calls + shadow work)
      // for invisible groups.
      if (hasFrustum) {
        // Place the cull sphere at the tile center with a conservative radius
        // that covers the slab and the tallest building on it.
        this._cullSphere.center.set(center.x, y + 6, center.z);
        this._cullSphere.radius = TILE_CULL_RADIUS;
        slot.root.visible = this._frustum.intersectsSphere(this._cullSphere);
      }

      // Skip hologram shader updates for offscreen or non-shop tiles.
      if (!slot.root.visible || !slot.hasHolograms) continue;

      for (const child of slot.content.children) {
        updateShopHologram(child, this._timeSec);
      }
    }
  }

  updateAnchor(worldX: number, worldZ: number, radius = TILE_RADIUS): void {
    const r = Math.min(TILE_RADIUS_MAX, Math.max(TILE_RADIUS, radius));
    const tx = Math.floor(worldX / TILE_SIZE);
    const tz = Math.floor(worldZ / TILE_SIZE);
    if (tx === this._anchorTx && tz === this._anchorTz && r === this._activeRadius) return;
    this._anchorTx = tx;
    this._anchorTz = tz;
    this._activeRadius = r;

    let idx = 0;
    const claimed = new Set<string>();
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tileX = tx + dx;
        const tileZ = tz + dz;
        const key = `${tileX},${tileZ}`;
        const slot = this._pool[idx++]!;
        claimed.add(key);
        if (slot.key === key) {
          slot.root.visible = true;
          continue;
        }
        slot.key = key;
        slot.tx = tileX;
        slot.tz = tileZ;
        slot.root.visible = true;
        this._fillTile(slot);
      }
    }

    // Hide every pooled slot outside the active ring (and purge duplicate keys).
    for (let i = 0; i < this._pool.length; i++) {
      const slot = this._pool[i]!;
      if (i >= idx || !claimed.has(slot.key)) {
        slot.key = '';
        slot.root.visible = false;
      }
    }

    this.updateAnimation(0);
  }

  dispose(): void {
    this.groundMaterial.dispose();
    this.edgeMaterial.dispose();
    for (const slot of this._pool) {
      slot.ground.geometry.dispose();
      (slot.ground.material as THREE.Material).dispose();
      slot.edge.geometry.dispose();
      this._clearGroup(slot.content);
      this._disposeGroup(slot.lanes);
    }
  }

  private _fillTile(slot: PooledTile): void {
    const content = generateTileContent(slot.tx, slot.tz);
    (slot.ground.material as THREE.MeshStandardMaterial).color.copy(content.floorTint);

    slot.hasHolograms = content.archetype === 'shop';

    this._clearGroup(slot.content);
    this._populateContent(slot, content);
    this._disposeGroup(slot.lanes);
  }

  private _populateContent(slot: PooledTile, content: TileContent): void {
    let bi = 0;
    for (const b of content.buildings) {
      const seed = hashCoords(slot.tx, slot.tz, bi + 0x4255494c); // 'BUIL'
      const model = this._catalog.cloneBuilding(b.archetype, seed);
      if (!model) continue;
      // Procedural variation only after catalog orientation/normalize (scale + materials).
      const scaleVar = 0.96 + ((seed >>> 8) % 1000) / 1000 * 0.08;
      model.rotation.order = 'YXZ';
      model.rotation.y = b.slot.rotationY;
      model.scale.multiplyScalar(b.slot.scale * scaleVar);
      model.position.set(b.slot.x, 0.48, b.slot.z);
      slot.content.add(model);
      bi += 1;
    }

    let pi = 0;
    for (const p of content.props) {
      const seed = hashCoords(slot.tx, slot.tz, pi + 0x50524f50); // 'PROP'
      const model = this._catalog.cloneProp(p.kind, seed);
      if (!model) continue;
      model.position.set(p.slot.x, 0.48, p.slot.z);
      model.rotation.y = p.slot.rotationY;
      model.scale.setScalar(p.slot.scale);
      slot.content.add(model);
      pi += 1;
    }
  }

  private _clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0]!;
      releaseBlenderAssetLighting(child);
      group.remove(child);
    }
  }

  private _disposeGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    }
  }
}

export interface AnchoredLane {
  tx: number;
  tz: number;
  localStart: THREE.Vector3;
  localEnd: THREE.Vector3;
}

export function collectAnchoredLanes(anchorTx: number, anchorTz: number): AnchoredLane[] {
  const out: AnchoredLane[] = [];
  for (let dz = -TILE_RADIUS; dz <= TILE_RADIUS; dz++) {
    for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
      const tx = anchorTx + dx;
      const tz = anchorTz + dz;
      const content = generateTileContent(tx, tz);
      for (const lane of content.lanes) {
        out.push({
          tx,
          tz,
          localStart: lane.start.clone(),
          localEnd: lane.end.clone(),
        });
      }
    }
  }
  out.sort((a, b) => {
    const da = (a.tx - anchorTx) ** 2 + (a.tz - anchorTz) ** 2;
    const db = (b.tx - anchorTx) ** 2 + (b.tz - anchorTz) ** 2;
    return da - db;
  });
  return out;
}

export function resolveLaneWorld(
  lane: AnchoredLane,
  timeSec: number,
  outStart: THREE.Vector3,
  outEnd: THREE.Vector3,
): void {
  const y = tileFloatOffset(lane.tx, lane.tz, timeSec);
  const center = tileWorldCenter(lane.tx, lane.tz);
  outStart.set(lane.localStart.x + center.x, lane.localStart.y + y, lane.localStart.z + center.z);
  outEnd.set(lane.localEnd.x + center.x, lane.localEnd.y + y, lane.localEnd.z + center.z);
}
