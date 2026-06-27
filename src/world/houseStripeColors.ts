import * as THREE from 'three';

/** Matches Blender exports: Stripe_Layer1, Stripe_Layer2, Stripe_Layer1.002, etc. */
const STRIPE_LAYER_PATTERN = /stripe_layer/i;

/** Default stripe RGB per house variant (catalog may override via `stripeColor`). */
export const DEFAULT_HOUSE_STRIPE_COLORS: Readonly<
  Record<string, readonly [number, number, number]>
> = {
  house_1: [0.12, 0.52, 0.92],
  house_2: [0.92, 0.26, 0.2],
  house_3: [0.18, 0.7, 0.36],
  house_4: [0.68, 0.32, 0.88],
};

export function isStripeLayerMaterial(materialName: string): boolean {
  return STRIPE_LAYER_PATTERN.test(materialName);
}

export function resolveHouseStripeColor(
  variantId: string,
  catalogRgb?: readonly [number, number, number],
): THREE.Color {
  if (catalogRgb) {
    return new THREE.Color(catalogRgb[0], catalogRgb[1], catalogRgb[2]);
  }
  const preset = DEFAULT_HOUSE_STRIPE_COLORS[variantId];
  if (preset) {
    return new THREE.Color(preset[0], preset[1], preset[2]);
  }
  let hash = 0;
  for (let i = 0; i < variantId.length; i++) {
    hash = (hash * 31 + variantId.charCodeAt(i)) >>> 0;
  }
  const hue = (hash % 360) / 360;
  return new THREE.Color().setHSL(hue, 0.62, 0.48);
}

/** Set the same stripe color on every Stripe_Layer* material (clones mats per mesh). */
export function applyHouseStripeColor(root: THREE.Object3D, color: THREE.Color): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mapStripe = (mat: THREE.Material): THREE.Material => {
      if (!(mat instanceof THREE.MeshStandardMaterial)) return mat;
      if (!isStripeLayerMaterial(mat.name)) return mat;
      const cloned = mat.clone();
      cloned.color.copy(color);
      cloned.needsUpdate = true;
      return cloned;
    };
    if (Array.isArray(child.material)) {
      child.material = child.material.map(mapStripe);
    } else {
      child.material = mapStripe(child.material);
    }
  });
}
