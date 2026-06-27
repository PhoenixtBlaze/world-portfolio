import * as THREE from 'three';

const HOLO_MESH = /holo/i;

/** Matches panel_004 stripe green (pink_light.001). */
const HOLO_GREEN = new THREE.Color(0.04, 0.92, 0.12);
const HOLO_CYAN = new THREE.Color(0.1, 0.78, 0.68);

type HoloKind = 'sign' | 'beam' | 'accent' | 'frame';

function holoKindFromName(name: string): HoloKind {
  if (/sign|glow/i.test(name)) return 'sign';
  if (/beam/i.test(name)) return 'beam';
  if (/bracket|tick|underline|ring|projector/i.test(name)) return 'frame';
  return 'accent';
}

const holoVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const holoFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uColorSecondary;
  uniform float uKind;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float scan = sin((vUv.y * 110.0) - uTime * 2.8) * 0.5 + 0.5;
    float fine = sin((vUv.x * 220.0) + uTime * 1.4) * 0.5 + 0.5;
    float flicker = 0.94 + 0.06 * sin(uTime * 11.0 + vWorldPos.z * 3.0);
    float noise = hash(floor(vUv * vec2(90.0, 40.0) + uTime * 0.5)) * 0.08;

    vec3 col = mix(uColor, uColorSecondary, fine * 0.22);
    float alpha = 0.0;

    if (uKind < 0.5) {
      // sign + glow
      float edge = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
      alpha = (0.55 + scan * 0.35) * edge * flicker;
      col *= 1.15 + scan * 0.45;
    } else if (uKind < 1.5) {
      // beam cone
      float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
      alpha = pow(max(radial, 0.0), 2.4) * (0.06 + scan * 0.1) * flicker;
      col = mix(uColor * 0.35, uColorSecondary, radial * 0.5);
    } else if (uKind < 2.5) {
      // frame ticks / brackets
      alpha = 0.75 * flicker;
      col = uColorSecondary;
    } else {
      // emitter caps / ring
      alpha = 0.65 + scan * 0.25;
      col = uColor * (1.1 + fine * 0.2);
    }

    alpha = clamp(alpha + noise, 0.0, 1.0);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

function createHoloShaderMaterial(kind: HoloKind): THREE.ShaderMaterial {
  const isBeam = kind === 'beam';
  const isFrame = kind === 'frame';
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: HOLO_GREEN.clone() },
      uColorSecondary: { value: HOLO_CYAN.clone() },
      uKind: { value: isBeam ? 1 : isFrame ? 2 : kind === 'sign' ? 0 : 3 },
    },
    vertexShader: holoVertexShader,
    fragmentShader: holoFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function isShopHologramMesh(name: string): boolean {
  return HOLO_MESH.test(name);
}

/** Replace exported holo materials with themed additive shader instances. */
export function installShopHologram(root: THREE.Object3D): void {
  // Collect uniform refs as we install materials so updateShopHologram can
  // skip all traversal on subsequent frames.
  const holoUniforms: THREE.ShaderMaterial['uniforms'][] = [];

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!isShopHologramMesh(child.name)) return;

    child.renderOrder = 14;
    child.frustumCulled = false;

    const kind = holoKindFromName(child.name);
    const mat = createHoloShaderMaterial(kind);
    mat.userData.holoShader = true;

    const old = child.material;
    if (Array.isArray(old)) old.forEach((m) => m.dispose());
    else old.dispose();

    child.material = mat;
    holoUniforms.push(mat.uniforms);
  });

  root.userData.holoUniforms = holoUniforms;
}

/** Gentle scanline pulse synced to world time. */
export function updateShopHologram(root: THREE.Object3D, timeSec: number): void {
  // Fast path: installShopHologram caches uniform refs on userData.holoUniforms,
  // so we never need to traverse the scene graph again after install.
  const cached = root.userData.holoUniforms as THREE.ShaderMaterial['uniforms'][] | undefined;
  if (cached !== undefined) {
    for (const uniforms of cached) {
      uniforms['uTime'].value = timeSec;
    }
    return;
  }

  // Fallback traverse for objects that bypassed installShopHologram (should not
  // occur in normal flow, but kept for safety).
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!isShopHologramMesh(child.name)) return;

    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.ShaderMaterial)) continue;
      if (!mat.userData.holoShader) continue;
      mat.uniforms['uTime'].value = timeSec;
    }
  });
}
