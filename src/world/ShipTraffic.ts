import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SHIP_CRUISE_Y, SHIP_TRAFFIC } from './config';
import { TrafficSystem, type TrafficConfig } from './TrafficSystem';

const SHIP_TARGET_LENGTH = 6.2;

/**
 * Flying ships in the upper inter-tile corridors. A config over the shared
 * TrafficSystem with a single model, smoother turns, and follow-camera support.
 * The model's nose (+X long axis) is baked to +Z so the generic navigator,
 * which assumes +Z forward, orients it correctly.
 */
export class ShipTraffic {
  readonly root: THREE.Group;

  private readonly _system: TrafficSystem;
  private _template: THREE.Object3D | null = null;

  constructor() {
    const cfg: TrafficConfig = {
      cruiseY: SHIP_CRUISE_Y,
      laneOffset: SHIP_TRAFFIC.laneOffset,
      maxInView: SHIP_TRAFFIC.maxInView,
      spawnPerTick: SHIP_TRAFFIC.spawnPerTick,
      spawnInterval: SHIP_TRAFFIC.spawnInterval,
      minLifetimeSec: SHIP_TRAFFIC.minLifetimeSec,
      despawnOutViewSec: SHIP_TRAFFIC.despawnOutViewSec,
      speedMin: SHIP_TRAFFIC.speedMin,
      speedMax: SHIP_TRAFFIC.speedMax,
      bobAmp: SHIP_TRAFFIC.bobAmp,
      bobSpeed: SHIP_TRAFFIC.bobSpeed,
      followGap: SHIP_TRAFFIC.followGap,
      minGap: SHIP_TRAFFIC.minGap,
      separationRadius: SHIP_TRAFFIC.separationRadius,
      intersectionRadius: SHIP_TRAFFIC.intersectionRadius,
      turnRadius: SHIP_TRAFFIC.turnRadius,
      viewRadius: SHIP_TRAFFIC.viewRadius,
      nearHideRadius: SHIP_TRAFFIC.nearHideRadius,
      cameraAvoidRadius: SHIP_TRAFFIC.cameraAvoidRadius,
      cameraAvoidMaxOffset: SHIP_TRAFFIC.cameraAvoidMaxOffset,
      cameraAvoidSeparation: SHIP_TRAFFIC.cameraAvoidSeparation,
      visibilityGraceSec: SHIP_TRAFFIC.visibilityGraceSec,
      turnBias: { straight: SHIP_TRAFFIC.turnStraight, turn: SHIP_TRAFFIC.turnTurn },
      coverageMargin: SHIP_TRAFFIC.coverageMargin,
      avoidHeadOn: SHIP_TRAFFIC.avoidHeadOn,
      headOnGap: SHIP_TRAFFIC.headOnGap,
      headOnRouteGap: SHIP_TRAFFIC.headOnRouteGap,
      jamEscape: SHIP_TRAFFIC.jamEscape,
      jamStuckSec: SHIP_TRAFFIC.jamStuckSec,
      jamReverseSpeed: SHIP_TRAFFIC.jamReverseSpeed,
      jamReverseMaxSec: SHIP_TRAFFIC.jamReverseMaxSec,
      smoothFlow: SHIP_TRAFFIC.smoothFlow,
      followable: true,
    };

    this._system = new TrafficSystem(cfg, (rand) => {
      if (!this._template) return null;
      const object = this._template.clone(true);
      const scale = SHIP_TRAFFIC.scaleMin + rand() * (SHIP_TRAFFIC.scaleMax - SHIP_TRAFFIC.scaleMin);
      object.scale.multiplyScalar(scale);
      return { object, variantId: 'ship' };
    }, 0x53484950);

    this.root = this._system.root;
  }

  get shipCount(): number {
    return this._system.agentCount;
  }

  async loadShipModel(url: string): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const len = Math.max(box.max.x - box.min.x, 0.001);

      const inner = new THREE.Group();
      inner.add(gltf.scene);
      inner.scale.setScalar(SHIP_TARGET_LENGTH / len);
      inner.rotation.y = -Math.PI / 2; // nose +X -> +Z for the generic navigator

      const template = new THREE.Group();
      template.add(inner);
      this._prepareShipMeshes(template, gltf.parser);
      this._template = template;
    } catch {
      this._template = createProceduralShipTemplate();
    }
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

  cycleFollow(camera: THREE.Camera): THREE.Vector3 | null {
    return this._system.cycleFollow(camera);
  }

  clearFollow(): void {
    this._system.clearFollow();
  }

  getFollowPosition(): THREE.Vector3 | null {
    return this._system.getFollowPosition();
  }

  isFollowing(): boolean {
    return this._system.isFollowing();
  }

  dispose(): void {
    this._system.dispose();
  }

  private _prepareShipMeshes(
    root: THREE.Object3D,
    parser: {
      json: {
        materials?: Array<{
          name?: string;
          pbrMetallicRoughness?: { metallicFactor?: number; roughnessFactor?: number };
        }>;
      };
    },
  ): void {
    const gltfMaterials = parser.json.materials ?? [];
    const pbrByName = new Map<string, { metallic?: number; roughness?: number }>();
    for (const mat of gltfMaterials) {
      if (!mat.name) continue;
      const pbr = mat.pbrMetallicRoughness;
      if (!pbr) continue;
      pbrByName.set(mat.name, { metallic: pbr.metallicFactor, roughness: pbr.roughnessFactor });
    }

    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        const authored = pbrByName.get(mat.name);
        if (authored?.metallic !== undefined) mat.metalness = authored.metallic;
        if (authored?.roughness !== undefined) mat.roughness = authored.roughness;
        if (mat.map) {
          mat.map.anisotropy = 8;
          mat.map.needsUpdate = true;
        }
        if (mat.emissiveMap) {
          mat.emissiveMap.anisotropy = 8;
          mat.emissiveMap.needsUpdate = true;
        }
      }
    });
  }
}

function createProceduralShipTemplate(): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.4, roughness: 0.5 });
  const ship = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.55, 0.85), mat);
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.55), mat);
  cockpit.position.set(1.0, 0.22, 0);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.4), mat);
  wing.position.set(-0.2, 0, 0);
  ship.add(hull, cockpit, wing);

  const inner = new THREE.Group();
  inner.add(ship);
  inner.rotation.y = -Math.PI / 2; // nose +X -> +Z
  const template = new THREE.Group();
  template.add(inner);
  template.traverse((child) => {
    child.frustumCulled = false;
  });
  return template;
}
