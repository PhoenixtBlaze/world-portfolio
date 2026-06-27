import * as THREE from 'three';
import { CAMERA } from './config';

/**
 * Orbit camera for the tile world: drag pans across the grid (XZ), scroll zooms.
 * View angle is fixed; optional ship follow (F key) lerps the pan target toward a ship.
 */
export class OrbitCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3(...CAMERA.target);

  private _distance = CAMERA.distance;
  private readonly _polar = CAMERA.polarAngle;
  private readonly _azimuth = CAMERA.azimuth;
  private _dragging = false;
  private _lastX = 0;
  private _lastY = 0;
  private _followWorld: THREE.Vector3 | null = null;
  private readonly _followScratch = new THREE.Vector3();
  private readonly _panRight = new THREE.Vector3();
  private readonly _panForward = new THREE.Vector3();
  private readonly _lookDir = new THREE.Vector3();
  /** Fired when the user drags/zooms and follow mode is cancelled. */
  onFollowCleared: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
    this._bind(canvas);
    this._apply();
  }

  get distance(): number {
    return this._distance;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  setFollowWorld(position: THREE.Vector3 | null): void {
    this._followWorld = position;
  }

  clearFollow(): void {
    this._followWorld = null;
  }

  isFollowing(): boolean {
    return this._followWorld !== null;
  }

  update(dt: number): void {
    if (this._followWorld) {
      this._followScratch.set(this._followWorld.x, CAMERA.target[1], this._followWorld.z);
      const blend = 1 - Math.exp(-4.5 * dt);
      this.target.lerp(this._followScratch, blend);
    }
    this._apply();
  }

  /** World XZ point the camera looks at (tile anchor). */
  getAnchorXZ(): { x: number; z: number } {
    return { x: this.target.x, z: this.target.z };
  }

  private _apply(): void {
    const sinP = Math.sin(this._polar);
    const cosP = Math.cos(this._polar);
    const sinA = Math.sin(this._azimuth);
    const cosA = Math.cos(this._azimuth);
    this.camera.position.set(
      this.target.x + this._distance * sinP * sinA,
      this.target.y + this._distance * cosP,
      this.target.z + this._distance * sinP * cosA,
    );
    this.camera.lookAt(this.target);
  }

  /** Pan the look target on the XZ plane (screen drag moves the grid). */
  private _panTarget(dx: number, dy: number): void {
    const scale = this._distance * CAMERA.panScale;
    this.camera.getWorldDirection(this._lookDir);

    // Horizontal basis on the ground plane, aligned with the view.
    this._panRight.set(this._lookDir.z, 0, -this._lookDir.x).normalize();
    this._panForward.set(this._lookDir.x, 0, this._lookDir.z).normalize();

    this.target.x += (this._panRight.x * dx + this._panForward.x * dy) * scale;
    this.target.z += (this._panRight.z * dx + this._panForward.z * dy) * scale;
  }

  private _bind(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      if (this._followWorld) {
        this._followWorld = null;
        this.onFollowCleared?.();
      }
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', () => {
      this._dragging = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._panTarget(dx, dy);
      this._apply();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this._distance = THREE.MathUtils.clamp(
          this._distance + e.deltaY * 0.04,
          CAMERA.minDistance,
          CAMERA.maxDistance,
        );
        this._apply();
      },
      { passive: false },
    );
  }
}
