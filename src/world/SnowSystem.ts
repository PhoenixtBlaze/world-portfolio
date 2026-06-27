import * as THREE from 'three';
import { hashCoords, mulberry32 } from './rng';

interface Snowflake {
  x: number;
  y: number;
  z: number;
  vy: number;
  vx: number;
  vz: number;
  wobble: number;
  phase: number;
}

/**
 * Smooth falling snow with continuous velocity (no teleporting).
 */
export class SnowSystem {
  readonly root: THREE.Points;
  private readonly _flakes: Snowflake[] = [];
  private readonly _count: number;
  private readonly _spread = 95;
  private readonly _height = 55;
  private _positions: Float32Array;

  constructor(count = 350) {
    this._count = count;
    this._positions = new Float32Array(count * 3);
    const rand = mulberry32(0x534e4f57);

    for (let i = 0; i < count; i++) {
      const flake: Snowflake = {
        x: (rand() - 0.5) * this._spread,
        y: rand() * this._height,
        z: (rand() - 0.5) * this._spread,
        vy: 1.2 + rand() * 2.8,
        vx: (rand() - 0.5) * 0.35,
        vz: (rand() - 0.5) * 0.35,
        wobble: rand() * Math.PI * 2,
        phase: rand() * Math.PI * 2,
      };
      this._flakes.push(flake);
      this._write(i, flake);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    this.root = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xeef4ff,
        size: 0.22,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
  }

  update(dt: number, centerX: number, centerZ: number, timeSec: number): void {
    this.root.position.set(centerX, 0, centerZ);
    const attr = this.root.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < this._count; i++) {
      const f = this._flakes[i]!;
      const drift = Math.sin(timeSec * 0.9 + f.phase) * 0.45;
      f.x += (f.vx + drift) * dt;
      f.y -= f.vy * dt;
      f.z += (f.vz + Math.cos(timeSec * 0.7 + f.wobble) * 0.25) * dt;

      if (f.y < -2) {
        const r = mulberry32(hashCoords(i, Math.floor(timeSec * 10), 0x52455345));
        f.y = this._height + r() * 8;
        f.x = (r() - 0.5) * this._spread;
        f.z = (r() - 0.5) * this._spread;
      }

      const half = this._spread * 0.55;
      if (f.x > half) f.x = -half;
      if (f.x < -half) f.x = half;
      if (f.z > half) f.z = -half;
      if (f.z < -half) f.z = half;

      this._write(i, f);
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.root.geometry.dispose();
    (this.root.material as THREE.Material).dispose();
  }

  private _write(i: number, f: Snowflake): void {
    this._positions[i * 3] = f.x;
    this._positions[i * 3 + 1] = f.y;
    this._positions[i * 3 + 2] = f.z;
  }
}
