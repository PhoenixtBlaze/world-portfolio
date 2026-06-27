import * as THREE from 'three';

/** How an asset should sit in the world after glTF import. */
export type AssetLayout = 'upright' | 'groundplate' | 'blenderZyFront' | 'blenderZUpZFront';

/** True when world-space +Y is the tallest axis (building height). */
function isYUp(size: THREE.Vector3): boolean {
  return size.y > Math.max(size.x, size.z) * 1.05;
}

/**
 * glTF exported with +Y up and the base on Y=0 (standard Blender export_yup).
 * Wide single-story buildings (shop, pavilion) are still correct even when XZ exceeds Y.
 */
function isGroundedYUpExport(object: THREE.Object3D): boolean {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const height = size.y;
  if (height < 0.12) return false;
  return box.min.y >= -0.06 && box.min.y <= height * 0.1;
}

const FACADE_MARKER = /door|glass|sign|fascia|canopy|awning|dock_door|hall_glass|neon|shutter/i;

/** World-space centers of meshes (or named groups) that mark the street-facing side. */
function collectFacadeMarkers(object: THREE.Object3D): THREE.Vector3[] {
  const markers: THREE.Vector3[] = [];
  object.traverse((child) => {
    if (!FACADE_MARKER.test(child.name)) return;

    const hasMesh =
      child instanceof THREE.Mesh ||
      (() => {
        let found = false;
        child.traverse((desc) => {
          if (desc instanceof THREE.Mesh) found = true;
        });
        return found;
      })();

    if (!hasMesh) return;
    markers.push(new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3()));
  });
  return markers;
}

/**
 * Blender Z-up, -X front (common panel-kit layout). export_yup keeps -X as street face;
 * rotate +90° Y so -X maps to engine +Z (tile edge convention).
 */
export function alignNegativeXFrontToPlusZ(object: THREE.Object3D): void {
  const markers = collectFacadeMarkers(object);
  if (markers.length > 0) {
    const xs = markers.map((m) => m.x);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    const cluster =
      xSpan > 1.5
        ? markers.filter((m) => m.x <= Math.min(...xs) + 0.35)
        : markers;

    const avg = cluster
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .multiplyScalar(1 / cluster.length);

    if (avg.x < -0.15) {
      object.rotateY(Math.PI / 2);
      return;
    }
    if (avg.x > 0.15) {
      object.rotateY(-Math.PI / 2);
      return;
    }
  }

  object.rotateY(Math.PI / 2);
}

/**
 * Rotates so authored facades on -Z face engine +Z (tile edge convention).
 * Most Blender exports in this project put doors and glass on -Z.
 */
export function alignFacadeToPlusZ(object: THREE.Object3D): void {
  const markers = collectFacadeMarkers(object);
  if (markers.length === 0) return;

  const zs = markers.map((m) => m.z);
  const zSpan = Math.max(...zs) - Math.min(...zs);
  const cluster =
    zSpan > 1.5
      ? markers.filter((m) => m.z >= Math.max(...zs) - 0.35)
      : markers;

  const avg = cluster
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / cluster.length);

  if (avg.z < -0.15) {
    object.rotateY(Math.PI);
  } else if (Math.abs(avg.z) <= 0.15 && avg.x > 0.15) {
    object.rotateY(-Math.PI / 2);
  } else if (Math.abs(avg.z) <= 0.15 && avg.x < -0.15) {
    object.rotateY(Math.PI / 2);
  }
}

/** Fold facade Y spin into the oriented mesh so tile rotation only touches the root. */
export function bakeFacadeSpin(upright: THREE.Object3D, facade: THREE.Object3D): void {
  facade.updateMatrixWorld(true);
  const spin = facade.rotation.y;
  if (Math.abs(spin) > 1e-4) {
    upright.rotateY(spin);
    facade.rotation.set(0, 0, 0);
  }
  faceForward(upright);
  faceForward(facade);
}

/** First roof-like mesh in the hierarchy. */
function findRoof(object: THREE.Object3D): THREE.Object3D | null {
  let roof: THREE.Object3D | null = null;
  object.traverse((child) => {
    if (roof) return;
    if (child.name && /roof/i.test(child.name) && (child as THREE.Mesh).isMesh) {
      roof = child;
    }
  });
  return roof;
}

/** Smallest extent axis of an object's world-space bounds. */
function thinAxis(object: THREE.Object3D): 'x' | 'y' | 'z' {
  object.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  if (size.y <= size.x && size.y <= size.z) return 'y';
  if (size.z <= size.x && size.z <= size.y) return 'z';
  return 'x';
}

/** Rotate until roof cap is horizontal (thin Y), when a roof mesh exists. */
function alignRoofHorizontal(object: THREE.Object3D): void {
  for (let pass = 0; pass < 6; pass++) {
    const roof = findRoof(object);
    if (!roof) return;
    const axis = thinAxis(roof);
    if (axis === 'y') return;
    if (axis === 'z') object.rotateX(-Math.PI / 2);
    else if (axis === 'x') object.rotateZ(Math.PI / 2);
    else object.rotateX(-Math.PI / 2);
    object.updateMatrixWorld(true);
  }
}

/**
 * Blender-authored houses: Z+ up, Y+ front. glTF import is Y-up with front on -Z.
 * Apply on a parent group so a Y spin never compounds with X/Z upright corrections.
 */
export function alignBlenderYFrontToPlusZ(object: THREE.Object3D): void {
  object.rotateY(Math.PI);
}

/**
 * Blender Z+ up, Y+ front. These house GLBs arrive with the base on the Z=0 plane
 * and height along Z (not Y). Rotate X -90° so Z-up becomes engine Y-up.
 * Y+ front becomes -Z; parent facade group applies rotateY(π) for tile +Z front.
 */
export function orientBlenderZUp(object: THREE.Object3D): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());

  if (isYUp(size) && box.min.y <= Math.max(size.y, 0.001) * 0.08) {
    return;
  }

  const groundedOnZ =
    Math.abs(box.min.z) <= Math.max(size.z, 0.001) * 0.08 &&
    box.min.y > box.min.z + size.y * 0.2;

  if (groundedOnZ || size.z > Math.max(size.x, size.y) * 1.05) {
    object.rotateX(-Math.PI / 2);
    return;
  }

  if (!isYUp(size)) {
    if (size.x > Math.max(size.y, size.z) * 1.05) {
      object.rotateZ(-Math.PI / 2);
    }
  }
}

/**
 * Blender Z+ up, +Z front after export_yup (apartment-office pool convention).
 * Applies Z-up correction first, then only upright heuristics if still not grounded on Y.
 */
export function orientBlenderZUpZFront(object: THREE.Object3D): void {
  orientBlenderZUp(object);
  object.updateMatrixWorld(true);
  if (isGroundedYUpExport(object)) {
    faceForward(object);
    return;
  }
  orientUpright(object, 'upright');
}

/**
 * Rotates imported glTF so +Y is vertical. Uses roof orientation when present,
 * then falls back to bounding-box height detection.
 */
export function orientUpright(object: THREE.Object3D, layout: AssetLayout = 'upright'): void {
  if (layout === 'groundplate') return;

  object.updateMatrixWorld(true);
  if (isGroundedYUpExport(object)) {
    faceForward(object);
    return;
  }

  if (layout !== 'blenderZyFront') {
    alignRoofHorizontal(object);
  }

  object.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  if (!isYUp(size)) {
    for (let pass = 0; pass < 4; pass++) {
      object.updateMatrixWorld(true);
      const passSize = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      if (isYUp(passSize)) break;

      if (passSize.z > Math.max(passSize.x, passSize.y) * 1.05) {
        object.rotateX(-Math.PI / 2);
      } else if (passSize.x > Math.max(passSize.y, passSize.z) * 1.05) {
        object.rotateZ(-Math.PI / 2);
      } else {
        break;
      }

      object.updateMatrixWorld(true);
    }
  }

  faceForward(object);
}

/** Standard rotation order for placed assets. */
export function faceForward(object: THREE.Object3D): void {
  object.rotation.order = 'YXZ';
}

/** Center on XZ and sit base on Y=0. */
export function groundAndCenter(object: THREE.Object3D): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
}

/** Scale to target footprint, then sit on Y=0 and center on XZ. */
export function normalizeGround(object: THREE.Object3D, targetFootprint: number): void {
  normalizeFootprint(object, targetFootprint);
  groundAndCenter(object);
}

/** Uniform scale so max XZ footprint matches target. */
export function normalizeFootprint(object: THREE.Object3D, targetSize: number): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z, 0.001);
  object.scale.multiplyScalar(targetSize / footprint);
}

/** Uniform scale to target height, then ground and center on XZ. */
export function normalizeToHeight(object: THREE.Object3D, targetHeight: number): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const height = Math.max(box.max.y - box.min.y, 0.001);
  object.scale.multiplyScalar(targetHeight / height);
  groundAndCenter(object);
}
