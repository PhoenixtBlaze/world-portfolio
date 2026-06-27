import * as THREE from 'three';
import { CAR_CRUISE_Y, CAR_TRAFFIC } from './config';
import { TrafficSystem, type TrafficConfig } from './TrafficSystem';
import type { VehicleCatalog } from './VehicleCatalog';

/**
 * Street-level hover cars. A thin config over the shared TrafficSystem: cars
 * pick random models from the vehicle pool and navigate the inter-tile lattice
 * with turns, lane spacing, and intersection yielding.
 */
export class CarTraffic {
  readonly root: THREE.Group;

  private readonly _system: TrafficSystem;
  private readonly _lifetimeCounts = new Map<string, number>();

  constructor(catalog: VehicleCatalog) {
    const cfg: TrafficConfig = {
      cruiseY: CAR_CRUISE_Y,
      laneOffset: CAR_TRAFFIC.laneOffset,
      maxInView: CAR_TRAFFIC.maxInView,
      spawnPerTick: CAR_TRAFFIC.spawnPerTick,
      spawnInterval: CAR_TRAFFIC.spawnInterval,
      minLifetimeSec: CAR_TRAFFIC.minLifetimeSec,
      despawnOutViewSec: CAR_TRAFFIC.despawnOutViewSec,
      speedMin: CAR_TRAFFIC.speedMin,
      speedMax: CAR_TRAFFIC.speedMax,
      bobAmp: CAR_TRAFFIC.bobAmp,
      bobSpeed: CAR_TRAFFIC.bobSpeed,
      followGap: CAR_TRAFFIC.followGap,
      minGap: CAR_TRAFFIC.minGap,
      separationRadius: CAR_TRAFFIC.separationRadius,
      intersectionRadius: CAR_TRAFFIC.intersectionRadius,
      turnRadius: CAR_TRAFFIC.turnRadius,
      viewRadius: CAR_TRAFFIC.viewRadius,
      nearHideRadius: CAR_TRAFFIC.nearHideRadius,
      cameraAvoidRadius: CAR_TRAFFIC.cameraAvoidRadius,
      cameraAvoidMaxOffset: CAR_TRAFFIC.cameraAvoidMaxOffset,
      cameraAvoidSeparation: CAR_TRAFFIC.cameraAvoidSeparation,
      visibilityGraceSec: CAR_TRAFFIC.visibilityGraceSec,
      turnBias: { straight: CAR_TRAFFIC.turnStraight, turn: CAR_TRAFFIC.turnTurn },
      coverageMargin: CAR_TRAFFIC.coverageMargin,
      avoidHeadOn: CAR_TRAFFIC.avoidHeadOn,
      headOnGap: CAR_TRAFFIC.headOnGap,
      headOnRouteGap: CAR_TRAFFIC.headOnRouteGap,
      jamEscape: CAR_TRAFFIC.jamEscape,
      jamStuckSec: CAR_TRAFFIC.jamStuckSec,
      jamReverseSpeed: CAR_TRAFFIC.jamReverseSpeed,
      jamReverseMaxSec: CAR_TRAFFIC.jamReverseMaxSec,
      smoothFlow: CAR_TRAFFIC.smoothFlow,
      followable: false,
    };

    this._system = new TrafficSystem(cfg, (rand, activeCounts) => {
      const id = catalog.pickVarietyId(rand, activeCounts, this._lifetimeCounts);
      if (!id) return null;
      const object = catalog.cloneCar(id, Math.floor(rand() * 1e6));
      if (!object) return null;
      const scale = CAR_TRAFFIC.scaleMin + rand() * (CAR_TRAFFIC.scaleMax - CAR_TRAFFIC.scaleMin);
      object.scale.multiplyScalar(scale);
      this._lifetimeCounts.set(id, (this._lifetimeCounts.get(id) ?? 0) + 1);
      return { object, variantId: id };
    }, 0x43415254);

    this.root = this._system.root;
  }

  get carCount(): number {
    return this._system.agentCount;
  }

  ensureCoverage(anchorTx: number, anchorTz: number, tileRadius?: number): void {
    this._system.ensureCoverage(anchorTx, anchorTz, tileRadius);
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    this._system.update(dt, camera, focus);
  }

  countInView(camera: THREE.Camera): number {
    return this._system.countInView(camera);
  }

  dispose(): void {
    this._system.dispose();
  }
}
