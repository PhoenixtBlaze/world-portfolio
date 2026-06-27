import * as THREE from 'three';
import { hashCoords, mulberry32 } from './rng';
import {
  buildTrafficGraph,
  forwardExits,
  pickNextEdge,
  pickNextEdgeAvoidingHeadOn,
  pickEscapeEdge,
  reverseEdgeId,
  sampleEdge,
  type TrafficEdge,
  type TrafficGraph,
  type TurnBias,
} from './trafficGraph';
import { TILE_RADIUS, TILE_FLOOR_SIZE, TILE_SIZE } from './config';

/** A spawn-ready model plus the catalog id it came from. */
export interface ProvidedModel {
  object: THREE.Object3D;
  variantId: string;
}

/** Returns a fresh, fully-scaled model to spawn, or null if none available. */
export type ModelProvider = (
  rand: () => number,
  activeCounts: ReadonlyMap<string, number>,
) => ProvidedModel | null;

export interface TrafficConfig {
  cruiseY: number;
  /** Right-hand lateral offset from gap centre (separates opposing lanes). */
  laneOffset: number;
  maxInView: number;
  /** Max new agents spawned per maintenance tick (avoids frame hitches). */
  spawnPerTick: number;
  spawnInterval: number;
  minLifetimeSec: number;
  despawnOutViewSec: number;
  /** World speed range (units/sec). */
  speedMin: number;
  speedMax: number;
  bobAmp: number;
  bobSpeed: number;
  /** Desired clear distance to the agent ahead before slowing (world units). */
  followGap: number;
  /** Hard minimum gap; inside this the trailing agent stops (world units). */
  minGap: number;
  /** Minimum center-to-center XZ distance between any two agents (hull radius). */
  separationRadius: number;
  /** Reservation ring radius around each intersection (world units). */
  intersectionRadius: number;
  /** Radius around an intersection over which a turn is rounded (world units). */
  turnRadius: number;
  /** Bounding radius used for frustum visibility tests (world units). */
  viewRadius: number;
  /** Hide an agent that comes within this distance of the camera so it cannot
   * fill the lens and block the view (world units). Backstop only. */
  nearHideRadius: number;
  /** XZ radius around the camera within which an agent smoothly sidesteps
   * sideways to skirt the lens (world units). 0 disables it. */
  cameraAvoidRadius: number;
  /** Max lateral sidestep along the corridor (keeps ships over the gap, not roofs). */
  cameraAvoidMaxOffset: number;
  /** Min XZ separation from other agents while sidestepping for the camera. */
  cameraAvoidSeparation: number;
  /** Keep rendering briefly after leaving the frustum (reduces pop/flicker). */
  visibilityGraceSec: number;
  turnBias: TurnBias;
  /** Tiles of inner margin before coverage expands. */
  coverageMargin: number;
  /** Keep a followed agent rendered even off-screen. */
  followable: boolean;
  /** When true, agents on opposing edges yield and prefer turns over head-on corridors. */
  avoidHeadOn: boolean;
  /** Minimum along-corridor clearance before yielding to oncoming traffic (world units). */
  headOnGap: number;
  /** Tighter gap for intersection routing only (avoids unnecessary turns). */
  headOnRouteGap: number;
  /** Reverse and reroute when blocked for too long (ships). */
  jamEscape: boolean;
  /** Seconds at zero speed before reversing out of a jam. */
  jamStuckSec: number;
  /** Reverse speed as a fraction of base speed. */
  jamReverseSpeed: number;
  /** Max seconds to reverse before attempting a reroute. */
  jamReverseMaxSec: number;
  /**
   * Exclusive-path mode for sparse, always-visible agents (ships).
   * Each agent claims edge ownership; no yielding, no stopping — stuck agents
   * are despawned immediately and a fresh one spawns elsewhere.
   */
  smoothFlow: boolean;
}

/** Rounded-corner state while an agent curves through an intersection. */
interface TurnState {
  /** Edge the agent was on before the turn — used for edge-owner cleanup. */
  prevEdgeId: string;
  nextEdgeId: string;
  exitT: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  u: number;
  length: number;
}

interface Agent {
  id: number;
  variantId: string;
  mesh: THREE.Object3D;
  edgeId: string;
  t: number;
  baseSpeed: number;
  speed: number;
  bobPhase: number;
  ageSec: number;
  outOfViewSec: number;
  seenInView: boolean;
  followed: boolean;
  reservedNodeId: string | null;
  pendingNextId: string | null;
  turn: TurnState | null;
  /** Smoothed signed lateral offset along the corridor right vector (camera avoid). */
  avoidLateral: number;
  stuckSec: number;
  reversing: boolean;
  reverseSec: number;
  /** Smooth-flow: seconds without meaningful position change (stuck detection). */
  stuckPosSec: number;
  lastPosX: number;
  lastPosZ: number;
  /** Smooth-flow: small per-ship altitude band so paths never visually stack. */
  pathLift: number;
  /** Latched intersection wait — avoids stop/go flicker at the yield ring. */
  waitingForNode: string | null;
  /** Smoothed XZ heading for stable ship orientation. */
  headingX: number;
  headingZ: number;
}

/**
 * Generic grid-navigating traffic: agents follow a lattice of inter-tile
 * corridors, choose turns at intersections, keep lane spacing, and yield at
 * intersections via single-occupancy reservations. Cars and ships are just
 * different configs over this core.
 */
export class TrafficSystem {
  readonly root = new THREE.Group();

  private readonly _cfg: TrafficConfig;
  private readonly _provideModel: ModelProvider;
  private readonly _seedSalt: number;

  private _graph: TrafficGraph | null = null;
  private _agents: Agent[] = [];
  private readonly _reservations = new Map<string, number>();
  private readonly _activeCounts = new Map<string, number>();

  private _coverMinTx = -TILE_RADIUS;
  private _coverMaxTx = TILE_RADIUS;
  private _coverMinTz = -TILE_RADIUS;
  private _coverMaxTz = TILE_RADIUS;

  private _timeSec = 0;
  private _spawnTimer = 0;
  private _nextId = 1;
  private _prefilled = false;
  private _followedId: number | null = null;
  private _frameDt = 1 / 60;
  /** Exclusive edge ownership for smooth-flow agents: edgeId -> agentId. */
  private _edgeOwner = new Map<string, number>();

  private readonly _frustum = new THREE.Frustum();
  private readonly _projScreen = new THREE.Matrix4();
  private readonly _sphere = new THREE.Sphere();
  private readonly _camPos = new THREE.Vector3();
  private readonly _tmpPos = new THREE.Vector3();
  private readonly _tmpPos2 = new THREE.Vector3();
  private readonly _panRight = new THREE.Vector3();
  private readonly _lookTarget = new THREE.Vector3();
  private readonly _holdQuat = new THREE.Quaternion();
  private readonly _targetQuat = new THREE.Quaternion();

  constructor(config: TrafficConfig, provideModel: ModelProvider, seedSalt = 0x54524146) {
    this._cfg = config;
    this._provideModel = provideModel;
    this._seedSalt = seedSalt;
  }

  get agentCount(): number {
    return this._agents.length;
  }

  ensureCoverage(anchorTx: number, anchorTz: number, tileRadius = TILE_RADIUS): void {
    const needMinTx = anchorTx - tileRadius;
    const needMaxTx = anchorTx + tileRadius;
    const needMinTz = anchorTz - tileRadius;
    const needMaxTz = anchorTz + tileRadius;

    const m = this._cfg.coverageMargin;
    const inside =
      anchorTx >= this._coverMinTx + m &&
      anchorTx <= this._coverMaxTx - m &&
      anchorTz >= this._coverMinTz + m &&
      anchorTz <= this._coverMaxTz - m;

    if (inside) {
      if (!this._graph) this._rebuildGraph();
      return;
    }

    const newMinTx = Math.min(this._coverMinTx, needMinTx);
    const newMaxTx = Math.max(this._coverMaxTx, needMaxTx);
    const newMinTz = Math.min(this._coverMinTz, needMinTz);
    const newMaxTz = Math.max(this._coverMaxTz, needMaxTz);

    if (
      newMinTx === this._coverMinTx &&
      newMaxTx === this._coverMaxTx &&
      newMinTz === this._coverMinTz &&
      newMaxTz === this._coverMaxTz &&
      this._graph
    ) {
      return;
    }

    this._coverMinTx = newMinTx;
    this._coverMaxTx = newMaxTx;
    this._coverMinTz = newMinTz;
    this._coverMaxTz = newMaxTz;
    this._rebuildGraph();
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    if (!this._graph) return;
    this._timeSec += dt;
    this._updateFrustum(camera);

    for (const a of this._agents) a.ageSec += dt;

    this._collectActiveCounts();
    this._stepMovement(dt);
    this._cull(dt);
    this._despawn();

    // Prefill the visible area immediately so the city looks alive on load.
    if (!this._prefilled) {
      this._fillSpawns(camera, focus, this._cfg.maxInView);
      this._prefilled = true;
    }

    this._spawnTimer += dt;
    if (this._spawnTimer >= this._cfg.spawnInterval) {
      this._spawnTimer = 0;
      this._fillSpawns(camera, focus, this._cfg.spawnPerTick);
    }

    this._syncFollowedFlag();
  }

  countInView(camera: THREE.Camera): number {
    this._updateFrustum(camera);
    let n = 0;
    for (const a of this._agents) {
      if (this._inView(a.mesh.position)) n += 1;
    }
    return n;
  }

  dispose(): void {
    for (const a of this._agents) a.mesh.removeFromParent();
    this._agents = [];
    this._reservations.clear();
    this._followedId = null;
  }

  // --- Follow support (used by ships) ---------------------------------------

  cycleFollow(camera: THREE.Camera): THREE.Vector3 | null {
    if (!this._cfg.followable || this._agents.length === 0) return null;
    this._updateFrustum(camera);
    const inView = this._agents.filter((a) => this._inView(a.mesh.position));
    const pool = inView.length > 0 ? inView : [...this._agents];

    if (this._followedId === null) {
      this._followedId = this._nearestId(pool, camera.position);
    } else {
      const idx = pool.findIndex((a) => a.id === this._followedId);
      this._followedId = pool[(idx + 1) % pool.length]?.id ?? null;
    }
    this._syncFollowedFlag();
    return this.getFollowPosition();
  }

  clearFollow(): void {
    this._followedId = null;
    for (const a of this._agents) a.followed = false;
  }

  getFollowPosition(): THREE.Vector3 | null {
    const a = this._agents.find((x) => x.id === this._followedId);
    return a ? a.mesh.position : null;
  }

  isFollowing(): boolean {
    return this._followedId !== null;
  }

  // --- Internals ------------------------------------------------------------

  private _rebuildGraph(): void {
    this._graph = buildTrafficGraph(
      this._coverMinTx,
      this._coverMaxTx,
      this._coverMinTz,
      this._coverMaxTz,
      this._cfg.cruiseY,
    );
    // Drop agents whose edge no longer exists (only at extreme boundary churn).
    const survivors: Agent[] = [];
    for (const a of this._agents) {
      if (this._graph.edges.has(a.edgeId)) survivors.push(a);
      else this._removeAgent(a);
    }
    this._agents = survivors;
    this._edgeOwner.clear();
  }

  private _collectActiveCounts(): void {
    this._activeCounts.clear();
    for (const a of this._agents) {
      this._activeCounts.set(a.variantId, (this._activeCounts.get(a.variantId) ?? 0) + 1);
    }
  }

  private _stepMovement(dt: number): void {
    this._frameDt = dt;
    if (this._cfg.smoothFlow) { this._stepMovementSmooth(dt); return; }
    const graph = this._graph!;
    const edgeLen = graph.edgeLength;
    const { intersectionRadius } = this._cfg;
    const turnRadius = Math.min(this._cfg.turnRadius, intersectionRadius);
    const turnStartT = 1 - turnRadius / edgeLen;
    const ringStopT = 1 - intersectionRadius / edgeLen;

    this._pruneStaleReservations();

    // Group agents per edge for lane following (ahead = larger t).
    const byEdge = new Map<string, Agent[]>();
    for (const a of this._agents) {
      if (a.turn) continue; // turning agents are off their edge line
      let list = byEdge.get(a.edgeId);
      if (!list) byEdge.set(a.edgeId, (list = []));
      list.push(a);
    }
    for (const list of byEdge.values()) list.sort((p, q) => p.t - q.t);

    for (const a of this._agents) {
      // Agents mid-turn follow a curved corner instead of an edge line.
      if (a.turn) {
        this._advanceTurn(a, dt);
        continue;
      }

      const edge = graph.edges.get(a.edgeId);
      if (!edge) continue;

      let speed = a.baseSpeed;

      if (this._dualLaneTraffic()) {
        // Dual lanes: follow only same-edge agents via t (stable, no cross-lane braking).
        const list = byEdge.get(a.edgeId);
        if (list) {
          const idx = list.indexOf(a);
          const ahead = list[idx + 1];
          if (ahead) {
            const gap = (ahead.t - a.t) * edgeLen;
            speed = this._speedFromClearance(gap, speed);
          }
        }
      } else {
        // Center-lane: world-space clearance (ships on classic path only).
        sampleEdge(edge, a.t, this._cfg.laneOffset, this._tmpPos2);
        const laneX = this._tmpPos2.x + edge.right.x * a.avoidLateral;
        const laneZ = this._tmpPos2.z + edge.right.z * a.avoidLateral;
        const clearance = this._aheadClearance(a, edge.forward, edge.right, laneX, laneZ);
        speed = this._speedFromClearance(clearance, speed);
      }

      // Intersection reservation: only one agent crosses a node at a time.
      const targetNode = edge.toId;
      const distToNode = (1 - a.t) * edgeLen;
      let stopT = 1;
      let owned = a.reservedNodeId === targetNode;
      if (distToNode <= intersectionRadius && !owned) {
        const owner = this._reservations.get(targetNode);
        if (owner === undefined) {
          this._reservations.set(targetNode, a.id);
          a.reservedNodeId = targetNode;
          owned = true;
        } else if (owner !== a.id) {
          stopT = ringStopT; // yield at the ring until the node frees up
          speed = 0;
        }
      }

      // Head-on yield: opposing flow on the reverse edge of this corridor.
      if (this._cfg.avoidHeadOn) {
        const revId = reverseEdgeId(edge);
        const revList = byEdge.get(revId);
        if (revList) {
          for (const other of revList) {
            if (other.reversing) continue;
            const clearance = (1 - a.t - other.t) * edgeLen;
            if (clearance < this._cfg.headOnGap) {
              speed = 0;
              break;
            }
          }
        }
      }

      // When sidestep is blocked, slow through the camera zone instead of clipping.
      if (this._cfg.cameraAvoidRadius > 0 && !a.followed) {
        sampleEdge(edge, a.t, this._cfg.laneOffset, this._tmpPos2);
        const cdx = this._tmpPos2.x - this._camPos.x;
        const cdz = this._tmpPos2.z - this._camPos.z;
        const cr = this._cfg.cameraAvoidRadius;
        if (cdx * cdx + cdz * cdz < cr * cr && Math.abs(a.avoidLateral) < 0.35) {
          speed *= 0.45;
        }
      }

      if (speed < 0.01) a.stuckSec += dt;
      else a.stuckSec = 0;

      if (this._cfg.jamEscape && !a.followed) {
        if (a.stuckSec >= this._cfg.jamStuckSec) {
          if (a.t <= 0.18) {
            this._rerouteFromJam(a, edge, graph);
            a.stuckSec = 0;
          } else if (a.t >= turnStartT) {
            a.pendingNextId = null;
            if (a.reservedNodeId === targetNode) {
              this._reservations.delete(targetNode);
              a.reservedNodeId = null;
            }
            a.stuckSec = 0;
          } else if (a.stuckSec >= this._cfg.jamStuckSec + 3.5) {
            this._removeAgent(a);
            continue;
          }
        }
      }

      speed = this._smoothSpeed(a, speed, dt);
      let newT = a.t + (speed * dt) / edgeLen;
      if (newT > stopT) newT = Math.max(a.t, stopT);
      if (!this._dualLaneTraffic() && newT > a.t && speed > 0) {
        sampleEdge(edge, newT, this._cfg.laneOffset, this._tmpPos2);
        const px = this._tmpPos2.x + edge.right.x * a.avoidLateral;
        const pz = this._tmpPos2.z + edge.right.z * a.avoidLateral;
        if (this._isBlockedAt(px, pz, a)) {
          newT = a.t;
          a.speed = this._smoothSpeed(a, 0, dt);
        }
      }
      a.t = newT;

      // Release a node once we are clear of it on the far side.
      if (a.reservedNodeId === edge.fromId && a.t * edgeLen > intersectionRadius) {
        this._reservations.delete(a.reservedNodeId);
        a.reservedNodeId = null;
      }

      // Decide the next edge once when entering the turn zone (needs reservation).
      if (owned && a.t >= turnStartT) {
        if (a.pendingNextId === null) {
          const routeGap = this._cfg.headOnRouteGap;
          const next = this._cfg.avoidHeadOn
            ? pickNextEdgeAvoidingHeadOn(
                graph,
                edge,
                this._cfg.turnBias,
                this._rand(a.id),
                this._agents,
                routeGap,
              )
            : pickNextEdge(graph, edge, this._cfg.turnBias, this._rand(a.id));
          a.pendingNextId = next ? next.id : '';
        }
        if (a.pendingNextId === '') {
          this._removeAgent(a);
          continue;
        }
        const next = graph.edges.get(a.pendingNextId);
        if (next) {
          const straight = next.axis === edge.axis && next.sign === edge.sign;
          if (!straight) {
            // Begin a rounded corner that eases from this lane into the next.
            this._beginTurn(a, edge, next, turnStartT, turnRadius, edgeLen);
            this._advanceTurn(a, dt);
            continue;
          }
          if (a.t >= 1) {
            const carry = (a.t - 1) * edgeLen;
            a.edgeId = next.id;
            a.t = Math.min(0.95, carry / edgeLen);
            a.pendingNextId = null;
          }
        }
      }

      this._place(a, dt);
    }

    if (!this._dualLaneTraffic() && !this._cfg.smoothFlow) this._resolveOverlaps();

    // Compact removed agents.
    this._agents = this._agents.filter((a) => a.mesh.parent !== null);
  }

  /** Leave a jammed corridor via a different intersection exit (never U-turn). */
  private _rerouteFromJam(a: Agent, edge: TrafficEdge, graph: TrafficGraph): void {
    const candidates = (graph.edgesFrom.get(edge.fromId) ?? []).filter((e) => e.id !== edge.id);
    const next = this._cfg.avoidHeadOn
      ? pickEscapeEdge(
          candidates,
          graph,
          edge,
          this._agents,
          this._cfg.headOnRouteGap,
          this._rand(a.id),
        )
      : candidates[0] ?? null;

    if (next) {
      a.edgeId = next.id;
      a.t = 0.08;
      a.pendingNextId = null;
      a.avoidLateral *= 0.25;
    }
  }

  /** Build a quadratic-Bezier corner tangent to the current and next lanes. */
  private _beginTurn(
    a: Agent,
    edge: TrafficEdge,
    next: TrafficEdge,
    turnStartT: number,
    turnRadius: number,
    edgeLen: number,
  ): void {
    const lane = this._cfg.laneOffset;
    const p0 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    sampleEdge(edge, turnStartT, lane, p0);
    sampleEdge(next, turnRadius / edgeLen, lane, p2);

    // Control point: intersection of the two lane lines (the corner apex).
    const lc = sampleEdge(edge, 1, lane, this._tmpPos).clone();
    const ln = sampleEdge(next, 0, lane, this._tmpPos2).clone();
    const p1 = intersectXZ(lc, edge.forward, ln, next.forward) ?? lc.lerp(ln, 0.5);

    const length = bezierLength(p0, p1, p2);
    a.turn = { prevEdgeId: edge.id, nextEdgeId: next.id, exitT: turnRadius / edgeLen, p0, p1, p2, u: 0, length };
  }

  private _advanceTurn(a: Agent, dt: number, advance = true): void {
    const turn = a.turn!;
    const prevU = turn.u;
    let u = turn.u;
    if (advance) {
      u = Math.min(1, turn.u + (a.baseSpeed * dt) / Math.max(turn.length, 0.001));
    }
    const omu = 1 - u;
    const a0 = omu * omu;
    const a1 = 2 * omu * u;
    const a2 = u * u;
    const x = a0 * turn.p0.x + a1 * turn.p1.x + a2 * turn.p2.x;
    const z = a0 * turn.p0.z + a1 * turn.p1.z + a2 * turn.p2.z;
    const tx = 2 * omu * (turn.p1.x - turn.p0.x) + 2 * u * (turn.p2.x - turn.p1.x);
    const tz = 2 * omu * (turn.p1.z - turn.p0.z) + 2 * u * (turn.p2.z - turn.p1.z);
    const right = this._turnRight(tx, tz);
    const side = this._cameraSidestep(a, x, z, right);
    const px = x + side.x;
    const pz = z + side.z;

    if (!this._cfg.smoothFlow && !this._dualLaneTraffic() && advance && u > prevU && this._isBlockedAt(px, pz, a)) {
      a.speed = 0;
      return;
    }

    if (advance) {
      turn.u = u;
    }
    a.speed = a.baseSpeed;

    if (turn.u >= 1) {
      const prevEdge = this._graph!.edges.get(turn.prevEdgeId);
      if (prevEdge && !this._cfg.smoothFlow) this._releaseCorridor(prevEdge, a.id);
      a.edgeId = turn.nextEdgeId;
      a.t = turn.exitT;
      a.turn = null;
      a.pendingNextId = null;
      const nextEdge = this._graph!.edges.get(a.edgeId);
      if (nextEdge && !this._cfg.smoothFlow) this._claimCorridor(nextEdge, a.id);
      if (nextEdge && this._cfg.smoothFlow) {
        a.headingX = nextEdge.forward.x;
        a.headingZ = nextEdge.forward.z;
      }
      this._place(a, dt);
      return;
    }

    let y =
      turn.p0.y + a.pathLift + Math.sin(this._timeSec * this._cfg.bobSpeed + a.bobPhase) * this._cfg.bobAmp;
    a.mesh.position.set(px, y, pz);
    const tLen = Math.hypot(tx, tz);
    if (tLen > 1e-6) {
      this._orientShip(a, px, y, pz, tx / tLen, tz / tLen);
    }
    if (this._cfg.smoothFlow) {
      a.lastPosX = px;
      a.lastPosZ = pz;
    }
  }

  private _place(a: Agent, _dt: number): void {
    const edge = this._graph!.edges.get(a.edgeId);
    if (!edge) return;
    const held = this._cfg.smoothFlow && a.speed < 0.01;
    sampleEdge(edge, a.t, this._cfg.laneOffset, this._tmpPos);
    this._tmpPos.y +=
      a.pathLift + Math.sin(this._timeSec * this._cfg.bobSpeed + a.bobPhase) * this._cfg.bobAmp;
    const side = this._cameraSidestep(a, this._tmpPos.x, this._tmpPos.z, edge.right);
    this._tmpPos.x += side.x;
    this._tmpPos.z += side.z;
    a.mesh.position.copy(this._tmpPos);
    if (!held) {
      this._orientShip(a, this._tmpPos.x, this._tmpPos.y, this._tmpPos.z, edge.forward.x, edge.forward.z);
    }
    if (this._cfg.smoothFlow) {
      a.lastPosX = this._tmpPos.x;
      a.lastPosZ = this._tmpPos.z;
    }
  }

  /**
   * Ships align to actual motion so the hull never steers before the path curves.
   * Cars keep slerp-smoothed lane heading.
   */
  private _orientShip(
    a: Agent,
    x: number,
    y: number,
    z: number,
    fallbackFwdX: number,
    fallbackFwdZ: number,
  ): void {
    if (this._cfg.smoothFlow) {
      const len = Math.hypot(fallbackFwdX, fallbackFwdZ);
      if (len < 1e-8) return;
      const targetX = fallbackFwdX / len;
      const targetZ = fallbackFwdZ / len;
      const blend = 0.22;
      a.headingX += (targetX - a.headingX) * blend;
      a.headingZ += (targetZ - a.headingZ) * blend;
      const hLen = Math.hypot(a.headingX, a.headingZ);
      if (hLen > 1e-8) {
        a.headingX /= hLen;
        a.headingZ /= hLen;
      }
      this._orientAlong(a, x - a.headingX, y, z - a.headingZ, 0);
      return;
    }
    this._orientAlong(a, x - fallbackFwdX, y, z - fallbackFwdZ, this._frameDt);
  }

  /** Smoothly rotate the mesh toward a look target (avoids snap reversals). */
  private _orientAlong(a: Agent, lookX: number, lookY: number, lookZ: number, dt: number): void {
    this._lookTarget.set(lookX, lookY, lookZ);
    this._holdQuat.copy(a.mesh.quaternion);
    a.mesh.lookAt(this._lookTarget);
    this._targetQuat.copy(a.mesh.quaternion);
    a.mesh.quaternion.copy(this._holdQuat);
    const blend = dt <= 0 ? 1 : 1 - Math.exp(-14 * dt);
    a.mesh.quaternion.slerp(this._targetQuat, Math.min(1, blend));
  }

  /**
   * Corridor-aligned sidestep that skirts the camera without crossing over
   * rooftops or other agents. Offset is clamped to the gap between tiles.
   */
  private _cameraSidestep(
    a: Agent,
    x: number,
    z: number,
    corridorRight: THREE.Vector3 | null,
  ): { x: number; z: number } {
    // Ships fly above the city; lane-center movement avoids rooftop sidestep fights.
    if (this._cfg.smoothFlow) {
      return { x: 0, z: 0 };
    }

    const r = this._cfg.cameraAvoidRadius;
    let targetLateral = 0;

    if (r > 0 && !a.followed && corridorRight) {
      const dx = x - this._camPos.x;
      const dz = z - this._camPos.z;
      const h2 = dx * dx + dz * dz;
      if (h2 < r * r) {
        const dist = Math.sqrt(Math.max(h2, 1e-4));
        const push = r - dist;
        const edge = a.turn ? null : this._graph!.edges.get(a.edgeId);
        if (edge) {
          const cross = dx * edge.forward.z - dz * edge.forward.x;
          const sign = cross >= 0 ? 1 : -1;
          targetLateral = push * sign;
        } else {
          const cross = dx * corridorRight.z - dz * corridorRight.x;
          targetLateral = push * (cross >= 0 ? 1 : -1);
        }
      }
    }

    const maxOff = this._cfg.cameraAvoidMaxOffset;
    targetLateral = THREE.MathUtils.clamp(targetLateral, -maxOff, maxOff);
    targetLateral = this._resolveSidestepCollisions(a, x, z, corridorRight, targetLateral);

    const k = Math.min(1, 3 * this._frameDt);
    a.avoidLateral += (targetLateral - a.avoidLateral) * k;

    if (!corridorRight) return { x: 0, z: 0 };
    return {
      x: corridorRight.x * a.avoidLateral,
      z: corridorRight.z * a.avoidLateral,
    };
  }

  /** Right-hand vector on XZ from a turn tangent. */
  private _turnRight(tx: number, tz: number): THREE.Vector3 {
    const len = Math.hypot(tx, tz);
    if (len < 1e-5) return this._panRight.set(1, 0, 0);
    return this._panRight.set(tz / len, 0, -tx / len);
  }

  /**
   * Shrink sidestep until the offset position clears other agents and does not
   * sit over a building footprint on a tile slab.
   */
  private _resolveSidestepCollisions(
    a: Agent,
    x: number,
    z: number,
    right: THREE.Vector3 | null,
    targetLateral: number,
  ): number {
    if (!right || targetLateral === 0) return 0;

    const sep = Math.max(this._cfg.cameraAvoidSeparation, this._cfg.separationRadius);
    const sepSq = sep * sep;
    let lat = targetLateral;

    for (let i = 0; i < 8; i++) {
      const px = x + right.x * lat;
      const pz = z + right.z * lat;
      const clearRoof = !isOverRoofFootprint(px, pz);
      // Smooth-flow ships route on exclusive edges; never sidestep away from each other.
      const clearAgents =
        this._cfg.smoothFlow || !this._sidestepHitsAgent(a, px, pz, sepSq);
      if (clearRoof && clearAgents) {
        return lat;
      }
      lat *= 0.6;
    }
    return 0;
  }

  private _sidestepHitsAgent(
    self: Agent,
    px: number,
    pz: number,
    sepSq: number,
  ): boolean {
    for (const other of this._agents) {
      if (other.id === self.id) continue;
      const dx = px - other.mesh.position.x;
      const dz = pz - other.mesh.position.z;
      if (dx * dx + dz * dz < sepSq) return true;
    }
    return false;
  }

  private _cull(dt: number): void {
    const nearSq = this._cfg.nearHideRadius * this._cfg.nearHideRadius;
    const grace = this._cfg.visibilityGraceSec;
    for (const a of this._agents) {
      const inView = this._inView(a.mesh.position);
      const tooClose =
        nearSq > 0 && !a.followed && a.mesh.position.distanceToSquared(this._camPos) < nearSq;
      const inGrace = a.seenInView && a.outOfViewSec < grace;
      const keepShipVisible = this._cfg.smoothFlow && a.seenInView;
      a.mesh.visible = (inView || a.followed || inGrace || keepShipVisible) && !tooClose;
      if (inView) {
        a.seenInView = true;
        a.outOfViewSec = 0;
      } else {
        a.outOfViewSec += dt;
      }
    }
  }

  private _despawn(): void {
    const survivors: Agent[] = [];
    for (const a of this._agents) {
      if (a.followed) {
        survivors.push(a);
        continue;
      }
      if (
        a.ageSec > this._cfg.minLifetimeSec &&
        a.outOfViewSec >= this._cfg.despawnOutViewSec
      ) {
        this._removeAgent(a);
        continue;
      }
      survivors.push(a);
    }
    this._agents = survivors;
  }

  private _removeAgent(a: Agent): void {
    if (a.reservedNodeId !== null) {
      if (this._reservations.get(a.reservedNodeId) === a.id) {
        this._reservations.delete(a.reservedNodeId);
      }
      a.reservedNodeId = null;
    }
    // Release smooth-flow corridor ownership when used by classic traffic only.
    if (!this._cfg.smoothFlow) {
      const edge = this._graph?.edges.get(a.edgeId);
      if (edge) this._releaseCorridor(edge, a.id);
      this._clearPendingCorridor(a);
      if (a.turn) {
        const prev = this._graph?.edges.get(a.turn.prevEdgeId);
        if (prev) this._releaseCorridor(prev, a.id);
      }
    }
    a.mesh.removeFromParent();
    if (this._followedId === a.id) this._followedId = null;
  }

  private _fillSpawns(camera: THREE.Camera, focus: THREE.Vector3, maxNew: number): void {
    const graph = this._graph!;
    this._updateFrustum(camera);

    // Count agents visible OR still streaming in (incoming feeders), so we
    // throttle spawns without waiting for them to reach the frame.
    let effective = 0;
    for (const a of this._agents) {
      if (!a.seenInView || this._inView(a.mesh.position)) effective += 1;
    }
    if (effective >= this._cfg.maxInView) return;

    // Feeder edges: their downstream end is in view, so an agent spawned just
    // outside the frame drives into view and then out the far side.
    const candidates: Array<{ edge: TrafficEdge; dist: number }> = [];
    for (const edge of graph.edges.values()) {
      sampleEdge(edge, 0.9, this._cfg.laneOffset, this._tmpPos);
      if (!this._inView(this._tmpPos)) continue;
      const dx = this._tmpPos.x - focus.x;
      const dz = this._tmpPos.z - focus.z;
      candidates.push({ edge, dist: dx * dx + dz * dz });
    }
    candidates.sort((p, q) => p.dist - q.dist);

    let spawned = 0;
    const rand = this._rand(this._nextId * 131 + this._agents.length);
    for (const { edge } of candidates) {
      if (spawned >= maxNew || effective >= this._cfg.maxInView) break;
      if (this._trySpawnFeeder(edge, rand)) {
        spawned += 1;
        effective += 1;
      }
    }
  }

  /** Spawn an agent just outside the frame on a feeder edge heading into view. */
  private _trySpawnFeeder(edge: TrafficEdge, rand: () => number): boolean {
    const { laneOffset, intersectionRadius } = this._cfg;
    const edgeLen = this._graph!.edgeLength;

    // Walk the edge and find the last point still outside view before entering.
    let spawnT: number | null = null;
    let lastOutside: number | null = null;
    for (let t = 0; t <= 0.96; t += 0.06) {
      sampleEdge(edge, t, laneOffset, this._tmpPos);
      if (!this._inView(this._tmpPos)) {
        lastOutside = t;
      } else if (lastOutside !== null) {
        spawnT = lastOutside;
        break;
      }
    }
    if (spawnT === null) return false; // edge already starts in view: not a feeder

    const t = spawnT;
    sampleEdge(edge, t, laneOffset, this._tmpPos);

    if (this._cfg.avoidHeadOn) {
      const revId = reverseEdgeId(edge);
      for (const other of this._agents) {
        if (other.edgeId !== revId || other.turn) continue;
        const clearance = (1 - t - other.t) * edgeLen;
        if (clearance < this._cfg.headOnGap) return false;
      }
    }

    // Keep clear of the destination intersection unless it is free.
    const distToNode = (1 - t) * edgeLen;
    if (distToNode <= intersectionRadius && this._reservations.get(edge.toId) !== undefined) {
      return false;
    }

    if (this._cfg.smoothFlow) {
      if (this._opposingTrafficOn(edge, -1)) return false;
      const spawnSepSq = this._cfg.minGap * this._cfg.minGap;
      for (const other of this._agents) {
        const dx = this._tmpPos.x - other.mesh.position.x;
        const dz = this._tmpPos.z - other.mesh.position.z;
        if (dx * dx + dz * dz < spawnSepSq) return false;
      }
    } else {
      // Do not spawn on top of any existing agent.
      const spawnSep = this._cfg.separationRadius;
      const spawnSepSq = spawnSep * spawnSep;
      for (const other of this._agents) {
        const dx = this._tmpPos.x - other.mesh.position.x;
        const dz = this._tmpPos.z - other.mesh.position.z;
        if (dx * dx + dz * dz < spawnSepSq) return false;
      }
    }

    const provided = this._provideModel(rand, this._activeCounts);
    if (!provided) return false;

    const body = provided.object;
    body.traverse((child) => {
      child.frustumCulled = false;
    });
    sampleEdge(edge, t, laneOffset, this._tmpPos2);
    body.position.copy(this._tmpPos2);
    body.lookAt(
      this._tmpPos2.x - edge.forward.x,
      this._tmpPos2.y,
      this._tmpPos2.z - edge.forward.z,
    );
    body.visible = true;
    this.root.add(body);

    const baseSpeed = this._cfg.speedMin + rand() * (this._cfg.speedMax - this._cfg.speedMin);
    const newId = this._nextId++;
    this._agents.push({
      id: newId,
      variantId: provided.variantId,
      mesh: body,
      edgeId: edge.id,
      t,
      baseSpeed,
      speed: baseSpeed,
      bobPhase: rand() * Math.PI * 2,
      ageSec: 0,
      outOfViewSec: 0,
      seenInView: false,
      followed: false,
      reservedNodeId: null,
      pendingNextId: null,
      turn: null,
      avoidLateral: 0,
      stuckSec: 0,
      reversing: false,
      reverseSec: 0,
      stuckPosSec: 0,
      lastPosX: body.position.x,
      lastPosZ: body.position.z,
      pathLift: this._cfg.smoothFlow ? ((newId % 3) - 1) * 1.15 : 0,
      waitingForNode: null,
      headingX: edge.forward.x,
      headingZ: edge.forward.z,
    });
    this._activeCounts.set(provided.variantId, (this._activeCounts.get(provided.variantId) ?? 0) + 1);
    return true;
  }

  private _rand(extra: number): () => number {
    return mulberry32(hashCoords(extra, Math.floor(this._timeSec * 1000) & 0xffff, this._seedSalt));
  }

  /** Stable per-ship route dice so a corridor choice does not change every frame. */
  private _routeRand(agentId: number, edgeId: string): () => number {
    let edgeHash = 0;
    for (let i = 0; i < edgeId.length; i++) {
      edgeHash = (edgeHash * 31 + edgeId.charCodeAt(i)) | 0;
    }
    return mulberry32(hashCoords(agentId, edgeHash, this._seedSalt));
  }

  private _updateFrustum(camera: THREE.Camera): void {
    camera.updateMatrixWorld(false);
    this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);
    camera.getWorldPosition(this._camPos);
  }

  private _inView(pos: THREE.Vector3): boolean {
    this._sphere.center.copy(pos);
    this._sphere.radius = this._cfg.viewRadius;
    return this._frustum.intersectsSphere(this._sphere);
  }

  private _nearestId(agents: Agent[], from: THREE.Vector3): number | null {
    let best: Agent | null = null;
    let bestDist = Infinity;
    for (const a of agents) {
      const d = a.mesh.position.distanceToSquared(from);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return best?.id ?? null;
  }

  private _syncFollowedFlag(): void {
    for (const a of this._agents) a.followed = a.id === this._followedId;
  }

  // ---------------------------------------------------------------------------
  // Smooth-flow path: exclusive edge ownership, no yielding, instant reroute.
  // ---------------------------------------------------------------------------

  private _stepMovementSmooth(dt: number): void {
    const graph = this._graph!;
    const edgeLen = graph.edgeLength;
    const { intersectionRadius } = this._cfg;
    const turnRadius = Math.min(this._cfg.turnRadius, intersectionRadius);
    const turnStartT = 1 - turnRadius / edgeLen;
    const ringT = 1 - intersectionRadius / edgeLen;
    const planT = Math.max(0.22, turnStartT - (turnRadius * 1.4) / edgeLen);

    const order = this._agents
      .map((_, index) => index)
      .sort((ia, ib) => this._agents[ia].id - this._agents[ib].id);

    for (const index of order) {
      const a = this._agents[index];
      if (a.turn) {
        a.stuckPosSec = 0;
        this._advanceTurn(a, dt);
        continue;
      }

      const edge = graph.edges.get(a.edgeId);
      if (!edge) {
        this._removeAgent(a);
        continue;
      }

      const targetNode = edge.toId;
      const distToNode = (1 - a.t) * edgeLen;
      const nearIntersection = distToNode <= intersectionRadius;
      const nodeBusy = nearIntersection && this._nodeOccupied(targetNode, a.id);

      if (nodeBusy && a.reservedNodeId !== targetNode) {
        a.waitingForNode = targetNode;
      } else if (a.reservedNodeId === targetNode || !nodeBusy) {
        a.waitingForNode = null;
      }

      const waitingAtIntersection = a.waitingForNode === targetNode && nearIntersection;

      if (this._opposingTrafficOn(edge, a.id)) {
        a.t = Math.min(a.t, ringT - 0.01);
        a.speed = this._smoothSpeed(a, 0, dt);
        this._place(a, dt);
        continue;
      }

      if (a.reservedNodeId === edge.fromId && a.t * edgeLen > intersectionRadius) {
        if (this._reservations.get(edge.fromId) === a.id) {
          this._reservations.delete(edge.fromId);
        }
        a.reservedNodeId = null;
        if (a.waitingForNode === edge.fromId) a.waitingForNode = null;
      }

      let cruiseSpeed = a.baseSpeed;
      const aheadT = this._shipAheadT(a, edge.id);
      if (aheadT !== null) {
        const gap = (aheadT - a.t) * edgeLen;
        cruiseSpeed = this._speedFromClearance(gap, cruiseSpeed);
      }

      let moveT = a.t + (cruiseSpeed * dt) / edgeLen;

      if (waitingAtIntersection) {
        moveT = Math.min(moveT, Math.max(a.t, ringT - 0.01));
      } else if (nearIntersection && !nodeBusy) {
        this._reservations.set(targetNode, a.id);
        a.reservedNodeId = targetNode;
      }

      if (a.pendingNextId === null && moveT >= planT) {
        const next = this._pickFreeEdge(edge, a.id, this._routeRand(a.id, edge.id));
        if (next) {
          a.pendingNextId = next.id;
        }
      }

      if (a.pendingNextId) {
        const next = graph.edges.get(a.pendingNextId);
        if (next) {
          const isStraight = next.axis === edge.axis && next.sign === edge.sign;

          if (!isStraight && !waitingAtIntersection) {
            const frameDist = cruiseSpeed * dt;
            const straightRemain = Math.max(0, (turnStartT - a.t) * edgeLen);
            const straightStep = Math.min(frameDist, straightRemain);
            a.t += straightStep / edgeLen;
            const arcDist = frameDist - straightStep;

            if (a.t >= turnStartT - 1e-5) {
              a.t = turnStartT;
              this._beginTurn(a, edge, next, turnStartT, turnRadius, edgeLen);
              if (arcDist > 0) {
                a.turn!.u = Math.min(1, arcDist / Math.max(a.turn!.length, 0.001));
              }
              this._reservations.set(targetNode, a.id);
              a.reservedNodeId = targetNode;
              a.speed = cruiseSpeed;
              this._advanceTurn(a, dt, false);
              continue;
            }

            a.speed = this._smoothSpeed(a, cruiseSpeed, dt);
            this._place(a, dt);
            continue;
          }

          if (isStraight && moveT >= 1) {
            a.edgeId = next.id;
            a.t = Math.min(0.95, moveT - 1);
            a.pendingNextId = null;
            a.headingX = next.forward.x;
            a.headingZ = next.forward.z;
            a.speed = waitingAtIntersection ? 0 : a.baseSpeed;
            this._place(a, dt);
            continue;
          }

          a.t = isStraight ? moveT : Math.min(moveT, turnStartT);
        } else {
          a.pendingNextId = null;
        }
      } else if (moveT >= 1) {
        moveT = Math.min(moveT, ringT - 0.01);
        if (!nodeBusy) {
          const next = this._pickFreeEdge(edge, a.id, this._routeRand(a.id, edge.id));
          if (next) {
            a.pendingNextId = next.id;
          }
        }
        a.t = moveT;
      } else {
        a.t = moveT;
      }

      const targetSpeed = waitingAtIntersection ? 0 : cruiseSpeed;
      a.speed = this._smoothSpeed(a, targetSpeed, dt);
      this._place(a, dt);
    }

    this._agents = this._agents.filter((ag) => ag.mesh.parent !== null);
  }

  /**
   * Pick the next edge for a smooth-flow agent. Only returns exits whose corridor
   * is unclaimed and whose intersection is not occupied by another ship.
   */
  private _pickFreeEdge(edge: TrafficEdge, agentId: number, rand: () => number): TrafficEdge | null {
    const graph = this._graph!;
    const candidates = forwardExits(graph, edge).filter((e) => !this._opposingTrafficOn(e, agentId));
    if (candidates.length === 0) return null;

    const straight = candidates.filter((e) => e.axis === edge.axis && e.sign === edge.sign);
    const turns = candidates.filter((e) => !(e.axis === edge.axis && e.sign === edge.sign));
    const sBias = this._cfg.turnBias.straight;
    const tBias = this._cfg.turnBias.turn;
    const sWeight = straight.length > 0 ? sBias : 0;
    const tWeight = turns.length > 0 ? tBias : 0;
    const total = sWeight + tWeight;
    if (total === 0) return candidates[0] ?? null;

    const r1 = rand();
    const r2 = rand();
    if (r1 * total < sWeight && straight.length > 0) {
      return straight[Math.floor(r2 * straight.length)];
    }
    return turns.length > 0 ? turns[Math.floor(r2 * turns.length)] : straight[0] ?? null;
  }

  /** Nearest agent ahead in the same corridor band (world units). */
  private _aheadClearance(
    self: Agent,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    fromX: number,
    fromZ: number,
  ): number {
    const band =
      this._cfg.laneOffset > 0
        ? this._cfg.laneOffset * 0.75
        : this._cfg.separationRadius * 1.2;
    let best = this._cfg.followGap * 2;

    for (const other of this._agents) {
      if (other.id === self.id) continue;
      if (this._areOpposingLanePair(self, other)) continue;
      const ox = other.mesh.position.x;
      const oz = other.mesh.position.z;
      const dx = ox - fromX;
      const dz = oz - fromZ;
      const along = dx * forward.x + dz * forward.z;
      if (along <= 0.15) continue;
      const lateral = Math.abs(dx * right.x + dz * right.z);
      if (lateral > band) continue;
      const dist = Math.hypot(dx, dz);
      if (dist < best) best = dist;
    }
    return best;
  }

  private _speedFromClearance(clearance: number, baseSpeed: number): number {
    const { minGap, followGap } = this._cfg;
    if (clearance <= minGap) return 0;
    if (clearance < followGap) {
      return baseSpeed * Math.max(0, (clearance - minGap) / (followGap - minGap));
    }
    return baseSpeed;
  }

  /** True when another agent sits within the hull separation radius. */
  private _isBlockedAt(x: number, z: number, self: Agent): boolean {
    const r = this._cfg.separationRadius;
    const rSq = r * r;
    for (const other of this._agents) {
      if (other.id === self.id) continue;
      if (this._areOpposingLanePair(self, other)) continue;
      const dx = x - other.mesh.position.x;
      const dz = z - other.mesh.position.z;
      if (dx * dx + dz * dz < rSq) return true;
    }
    return false;
  }

  /** Edge an agent is travelling on (accounts for mid-turn state). */
  private _agentTravelEdge(a: Agent, graph: TrafficGraph): TrafficEdge | null {
    const id = a.turn ? a.turn.prevEdgeId : a.edgeId;
    return graph.edges.get(id) ?? null;
  }

  /** True when two agents use opposing lanes of the same corridor. */
  private _areOpposingLanePair(a: Agent, b: Agent): boolean {
    if (this._cfg.laneOffset <= 0) return false;
    const graph = this._graph;
    if (!graph) return false;
    const edgeA = this._agentTravelEdge(a, graph);
    const edgeB = this._agentTravelEdge(b, graph);
    if (!edgeA || !edgeB) return false;
    return reverseEdgeId(edgeA) === edgeB.id;
  }

  /** Cars use split opposing lanes; ships use a single centre lane. */
  private _dualLaneTraffic(): boolean {
    return this._cfg.laneOffset > 0;
  }

  /** True when oncoming traffic occupies the reverse lane of this corridor. */
  private _opposingTrafficOn(edge: TrafficEdge, selfId: number): boolean {
    const revId = reverseEdgeId(edge);
    for (const other of this._agents) {
      if (other.id === selfId) continue;
      if (other.turn) {
        if (other.turn.nextEdgeId === revId) return true;
        continue;
      }
      if (other.edgeId === revId) return true;
      if (other.pendingNextId === revId) return true;
    }
    return false;
  }

  /** Farthest-ahead t on this edge, including a ship mid-turn leaving it. */
  private _shipAheadT(self: Agent, edgeId: string): number | null {
    let best: number | null = null;
    for (const other of this._agents) {
      if (other.id === self.id) continue;
      let otherT: number | null = null;
      if (other.turn) {
        if (other.turn.prevEdgeId === edgeId) {
          otherT = 1;
        } else {
          continue;
        }
      } else if (other.edgeId === edgeId) {
        otherT = other.t;
      }
      if (otherT === null || otherT <= self.t + 0.02) continue;
      if (best === null || otherT < best) best = otherT;
    }
    return best;
  }

  private _claimCorridor(edge: TrafficEdge, agentId: number): void {
    this._edgeOwner.set(edge.id, agentId);
    this._edgeOwner.set(reverseEdgeId(edge), agentId);
  }

  private _releaseCorridor(edge: TrafficEdge, agentId: number): void {
    if (this._edgeOwner.get(edge.id) === agentId) this._edgeOwner.delete(edge.id);
    const rev = reverseEdgeId(edge);
    if (this._edgeOwner.get(rev) === agentId) this._edgeOwner.delete(rev);
  }

  /** Drop a pre-claimed next edge without releasing corridor claims (ships use gap following). */
  private _clearPendingCorridor(a: Agent): void {
    a.pendingNextId = null;
  }

  /** True when another ship holds or is actively crossing an intersection node. */
  private _nodeOccupied(nodeId: string, exceptId: number): boolean {
    const holder = this._reservations.get(nodeId);
    if (holder !== undefined && holder !== exceptId) return true;

    for (const other of this._agents) {
      if (other.id === exceptId) continue;
      if (other.reservedNodeId === nodeId) return true;
      if (other.turn && this._turnUsesNode(other, nodeId)) return true;
    }
    return false;
  }

  /** Whether a ship mid-corner is cutting through an intersection node. */
  private _turnUsesNode(a: Agent, nodeId: string): boolean {
    const turn = a.turn;
    if (!turn) return false;
    const graph = this._graph;
    if (!graph) return false;
    const prev = graph.edges.get(turn.prevEdgeId);
    if (prev && (prev.fromId === nodeId || prev.toId === nodeId)) return true;
    const next = graph.edges.get(turn.nextEdgeId);
    if (next && (next.fromId === nodeId || next.toId === nodeId)) return true;
    return false;
  }

  /** Ease speed changes so agents do not snap between halt and cruise. */
  private _smoothSpeed(a: Agent, target: number, dt: number): number {
    const rate = target >= a.speed ? 18 : 12;
    const blend = 1 - Math.exp(-rate * dt);
    a.speed += (target - a.speed) * blend;
    return a.speed;
  }

  /** Drop intersection locks held by agents that have been stopped too long. */
  private _pruneStaleReservations(): void {
    for (const [nodeId, agentId] of [...this._reservations.entries()]) {
      const owner = this._agents.find((a) => a.id === agentId);
      if (!owner) {
        this._reservations.delete(nodeId);
        continue;
      }
      if (owner.stuckSec > 2.2) {
        this._reservations.delete(nodeId);
        if (owner.reservedNodeId === nodeId) owner.reservedNodeId = null;
      }
    }
  }

  /** Last-resort push for centre-lane classic traffic only (never ships or dual-lane cars). */
  private _resolveOverlaps(): void {
    if (this._dualLaneTraffic() || this._cfg.smoothFlow) return;
    const r = this._cfg.separationRadius;
    const rSq = r * r;
    for (let i = 0; i < this._agents.length; i++) {
      const a = this._agents[i];
      for (let j = i + 1; j < this._agents.length; j++) {
        const b = this._agents[j];
        if (this._areOpposingLanePair(a, b)) continue;
        let dx = b.mesh.position.x - a.mesh.position.x;
        let dz = b.mesh.position.z - a.mesh.position.z;
        let d2 = dx * dx + dz * dz;
        if (d2 >= rSq) continue;
        if (d2 < 1e-8) {
          dx = 1;
          dz = 0;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const push = (r - d) * 0.51;
        const nx = dx / d;
        const nz = dz / d;
        a.mesh.position.x -= nx * push;
        a.mesh.position.z -= nz * push;
        b.mesh.position.x += nx * push;
        b.mesh.position.z += nz * push;
      }
    }
  }
}

/**
 * Intersection of two lines in the XZ plane, each given as a point and a
 * direction. Returns null when the lines are (near) parallel. The result keeps
 * the y of the first point, which is constant across the traffic plane.
 */
function intersectXZ(
  p: THREE.Vector3,
  dp: THREE.Vector3,
  q: THREE.Vector3,
  dq: THREE.Vector3,
): THREE.Vector3 | null {
  const det = dq.x * dp.z - dp.x * dq.z;
  if (Math.abs(det) < 1e-6) return null;
  const rx = q.x - p.x;
  const rz = q.z - p.z;
  const aParam = (dq.x * rz - dq.z * rx) / det;
  return new THREE.Vector3(p.x + dp.x * aParam, p.y, p.z + dp.z * aParam);
}

/** Approximate arc length of a quadratic Bezier in the XZ plane. */
function bezierLength(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): number {
  const samples = 6;
  let len = 0;
  let px = p0.x;
  let pz = p0.z;
  for (let i = 1; i <= samples; i++) {
    const u = i / samples;
    const omu = 1 - u;
    const x = omu * omu * p0.x + 2 * omu * u * p1.x + u * u * p2.x;
    const z = omu * omu * p0.z + 2 * omu * u * p1.z + u * u * p2.z;
    const dx = x - px;
    const dz = z - pz;
    len += Math.sqrt(dx * dx + dz * dz);
    px = x;
    pz = z;
  }
  return len;
}

/**
 * Conservative XZ test: true when a point sits over built-up slab area
 * (not the open gap between tiles). Used to keep camera-avoid sidesteps in the corridor.
 */
function isOverRoofFootprint(wx: number, wz: number): boolean {
  const tx = Math.round(wx / TILE_SIZE);
  const tz = Math.round(wz / TILE_SIZE);
  const lx = wx - tx * TILE_SIZE;
  const lz = wz - tz * TILE_SIZE;
  const half = TILE_FLOOR_SIZE * 0.5;
  if (Math.abs(lx) > half || Math.abs(lz) > half) return false;
  const inner = TILE_FLOOR_SIZE * 0.2;
  if (Math.abs(lx) < inner && Math.abs(lz) < inner) return false;
  return true;
}
