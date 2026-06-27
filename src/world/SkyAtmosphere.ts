import * as THREE from 'three';
import { hashCoords, mulberry32 } from './rng';

/**
 * Twilight sky dome with stars, moon, and drifting soft clouds.
 */
export class SkyAtmosphere {
  readonly root = new THREE.Group();
  private readonly _clouds: THREE.Mesh[] = [];
  private readonly _stars: THREE.Points;
  private readonly _moon: THREE.Mesh;
  private _timeSec = 0;

  constructor() {
    const skyGeo = new THREE.SphereGeometry(180, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uHorizon: { value: new THREE.Color(0.08, 0.12, 0.22) },
        uZenith: { value: new THREE.Color(0.02, 0.03, 0.09) },
        uGlow: { value: new THREE.Color(0.25, 0.35, 0.65) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uGlow;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld).y * 0.5 + 0.5;
          vec3 col = mix(uHorizon, uZenith, pow(h, 1.4));
          col += uGlow * pow(max(h - 0.55, 0.0), 2.0) * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    this.root.add(sky);

    const starCount = 900;
    const positions = new Float32Array(starCount * 3);
    const rand = mulberry32(0x53544152);
    for (let i = 0; i < starCount; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(rand() * 0.85 + 0.05);
      const r = 160;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xddeeff,
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this._stars = new THREE.Points(starGeo, starMat);
    this.root.add(this._stars);

    const moonMat = new THREE.MeshStandardMaterial({
      color: 0xfff0dd,
      emissive: 0xffeedd,
      emissiveIntensity: 0.55,
      roughness: 0.95,
    });
    this._moon = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 24), moonMat);
    this._moon.position.set(55, 75, -40);
    this.root.add(this._moon);

    for (let c = 0; c < 22; c++) {
      const cr = mulberry32(hashCoords(c, 0, 0x434c4f44));
      const w = 8 + cr() * 18;
      const cloudMat = new THREE.MeshStandardMaterial({
        color: 0x8899bb,
        emissive: 0x334466,
        emissiveIntensity: 0.08,
        transparent: true,
        opacity: 0.22 + cr() * 0.18,
        depthWrite: false,
      });
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(w, 8, 8), cloudMat);
      cloud.position.set((cr() - 0.5) * 120, 28 + cr() * 35, (cr() - 0.5) * 120);
      cloud.scale.set(1.6, 0.45 + cr() * 0.25, 1.1);
      this._clouds.push(cloud);
      this.root.add(cloud);
    }
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this._timeSec += dt;
    this.root.position.copy(cameraPos);

    this._stars.rotation.y = this._timeSec * 0.003;
    this._moon.position.x = 55 + Math.sin(this._timeSec * 0.04) * 4;
    this._moon.position.y = 75 + Math.sin(this._timeSec * 0.06) * 2;

    for (let i = 0; i < this._clouds.length; i++) {
      const cloud = this._clouds[i]!;
      cloud.position.x += dt * (0.6 + (i % 5) * 0.15);
      if (cloud.position.x > 90) cloud.position.x = -90;
      cloud.position.y += Math.sin(this._timeSec * 0.2 + i) * dt * 0.08;
    }
  }

  dispose(): void {
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
      if (obj instanceof THREE.Points) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }
}
