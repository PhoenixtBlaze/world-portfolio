import * as THREE from 'three';
import { TILE_SIZE } from './config';

/**
 * Navigable lattice for traffic in the void corridors between floating tiles.
 *
 * Intersection nodes sit at gap crossings (the corner shared by four tiles).
 * Directed edges connect neighbouring nodes in both directions, so agents can
 * choose to continue straight or turn at each intersection. A constant
 * right-hand lane offset keeps opposing flows on separate sides of a gap.
 */

export interface TrafficNode {
  id: string;
  gx: number;
  gz: number;
  x: number;
  z: number;
}

export interface TrafficEdge {
  id: string;
  fromId: string;
  toId: string;
  axis: 'x' | 'z';
  /** Travel sign along the axis (+1 or -1). */
  sign: 1 | -1;
  start: THREE.Vector3;
  end: THREE.Vector3;
  /** Unit forward direction (model +Z should align to this). */
  forward: THREE.Vector3;
  /** Unit right-hand vector; lane offset is applied along this. */
  right: THREE.Vector3;
}

export interface TrafficGraph {
  nodes: Map<string, TrafficNode>;
  edges: Map<string, TrafficEdge>;
  edgesFrom: Map<string, TrafficEdge[]>;
  edgeLength: number;
}

export interface TurnBias {
  straight: number;
  turn: number;
}

function nodeId(gx: number, gz: number): string {
  return `${gx}:${gz}`;
}

function nodeWorldX(gx: number): number {
  return (gx + 0.5) * TILE_SIZE;
}

function nodeWorldZ(gz: number): number {
  return (gz + 0.5) * TILE_SIZE;
}

/** Build the intersection lattice for a covered tile range at a given altitude. */
export function buildTrafficGraph(
  minTx: number,
  maxTx: number,
  minTz: number,
  maxTz: number,
  cruiseY: number,
): TrafficGraph {
  const nodes = new Map<string, TrafficNode>();
  const edges = new Map<string, TrafficEdge>();
  const edgesFrom = new Map<string, TrafficEdge[]>();

  // Nodes exist at gap indices between tiles: gx in [minTx, maxTx-1].
  const minGx = minTx;
  const maxGx = maxTx - 1;
  const minGz = minTz;
  const maxGz = maxTz - 1;

  for (let gx = minGx; gx <= maxGx; gx++) {
    for (let gz = minGz; gz <= maxGz; gz++) {
      const id = nodeId(gx, gz);
      nodes.set(id, { id, gx, gz, x: nodeWorldX(gx), z: nodeWorldZ(gz) });
      edgesFrom.set(id, []);
    }
  }

  const addEdge = (a: TrafficNode, b: TrafficNode, axis: 'x' | 'z'): void => {
    const start = new THREE.Vector3(a.x, cruiseY, a.z);
    const end = new THREE.Vector3(b.x, cruiseY, b.z);
    const forward = new THREE.Vector3().subVectors(end, start).normalize();
    // Right-hand vector on the XZ plane: right = (forward.z, 0, -forward.x).
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const sign: 1 | -1 = axis === 'x' ? (b.x > a.x ? 1 : -1) : b.z > a.z ? 1 : -1;
    const id = `${a.id}>${b.id}`;
    const edge: TrafficEdge = { id, fromId: a.id, toId: b.id, axis, sign, start, end, forward, right };
    edges.set(id, edge);
    edgesFrom.get(a.id)!.push(edge);
  };

  for (const node of nodes.values()) {
    const east = nodes.get(nodeId(node.gx + 1, node.gz));
    if (east) {
      addEdge(node, east, 'x');
      addEdge(east, node, 'x');
    }
    const south = nodes.get(nodeId(node.gx, node.gz + 1));
    if (south) {
      addEdge(node, south, 'z');
      addEdge(south, node, 'z');
    }
  }

  return { nodes, edges, edgesFrom, edgeLength: TILE_SIZE };
}

/** World position on an edge at parameter t (0..1) including the lane offset. */
export function sampleEdge(
  edge: TrafficEdge,
  t: number,
  laneOffset: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.lerpVectors(edge.start, edge.end, t);
  out.x += edge.right.x * laneOffset;
  out.z += edge.right.z * laneOffset;
  return out;
}

/** Edges that leave the end of `current` without doubling back (no U-turns). */
export function forwardExits(graph: TrafficGraph, current: TrafficEdge): TrafficEdge[] {
  return (graph.edgesFrom.get(current.toId) ?? []).filter((e) => e.toId !== current.fromId);
}

/**
 * Choose the next edge at the end of `current`. Excludes the reverse edge
 * (no U-turns) and weights continuing straight over turning.
 */
export function pickNextEdge(
  graph: TrafficGraph,
  current: TrafficEdge,
  bias: TurnBias,
  rand: () => number,
): TrafficEdge | null {
  const candidates = forwardExits(graph, current);
  if (candidates.length === 0) return null;

  const options: Array<{ edge: TrafficEdge; weight: number }> = [];
  let total = 0;
  for (const edge of candidates) {
    const straight = edge.axis === current.axis && edge.sign === current.sign;
    const weight = straight ? bias.straight : bias.turn;
    options.push({ edge, weight });
    total += weight;
  }
  if (options.length === 0) return null;

  let roll = rand() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.edge;
  }
  return options[options.length - 1]!.edge;
}

/** Reverse edge id helper (for diagnostics / lane pairing). */
export function reverseEdgeId(edge: TrafficEdge): string {
  return `${edge.toId}>${edge.fromId}`;
}

/** Minimal agent state for head-on checks (avoids a circular import). */
export interface TrafficAgentRef {
  edgeId: string;
  t: number;
  turn: unknown | null;
}

/** True when entering `edge` would meet oncoming traffic on the reverse corridor. */
export function isEdgeBlockedByOncoming(
  edge: TrafficEdge,
  agents: readonly TrafficAgentRef[],
  graph: TrafficGraph,
  headOnGap: number,
): boolean {
  const revId = reverseEdgeId(edge);
  const entryThreshold = 1 - headOnGap / graph.edgeLength;
  for (const o of agents) {
    if (o.edgeId !== revId || o.turn) continue;
    if (o.t > entryThreshold) return true;
  }
  return false;
}

/**
 * Like pickNextEdge, but zeroes weight for straight options that would enter a
 * corridor occupied by oncoming traffic. Falls back to turns when straight is blocked.
 */
export function pickNextEdgeAvoidingHeadOn(
  graph: TrafficGraph,
  current: TrafficEdge,
  bias: TurnBias,
  rand: () => number,
  agents: readonly TrafficAgentRef[],
  headOnGap: number,
): TrafficEdge | null {
  const candidates = graph.edgesFrom.get(current.toId);
  if (!candidates || candidates.length === 0) return null;

  const options: Array<{ edge: TrafficEdge; weight: number }> = [];
  let total = 0;
  for (const edge of candidates) {
    if (edge.toId === current.fromId) continue;
    const straight = edge.axis === current.axis && edge.sign === current.sign;
    let weight = straight ? bias.straight : bias.turn;
    if (isEdgeBlockedByOncoming(edge, agents, graph, headOnGap)) {
      weight = 0;
    }
    if (weight <= 0) continue;
    options.push({ edge, weight });
    total += weight;
  }

  if (options.length === 0) {
    for (const edge of candidates) {
      if (edge.toId === current.fromId) continue;
      if (isEdgeBlockedByOncoming(edge, agents, graph, headOnGap)) continue;
      options.push({ edge, weight: 1 });
      total += 1;
    }
  }
  if (options.length === 0) return null;

  let roll = rand() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.edge;
  }
  return options[options.length - 1]!.edge;
}

/**
 * Pick an alternate corridor when escaping a jam. Prefers turns over staying
 * on the blocked axis and skips edges with oncoming traffic.
 */
export function pickEscapeEdge(
  candidates: TrafficEdge[],
  graph: TrafficGraph,
  blockedEdge: TrafficEdge,
  agents: readonly TrafficAgentRef[],
  headOnGap: number,
  rand: () => number,
): TrafficEdge | null {
  const open = candidates.filter(
    (e) =>
      e.toId !== blockedEdge.fromId &&
      e.id !== blockedEdge.id &&
      !isEdgeBlockedByOncoming(e, agents, graph, headOnGap),
  );
  if (open.length === 0) return null;
  const turns = open.filter((e) => e.axis !== blockedEdge.axis);
  const pool = turns.length > 0 ? turns : open;
  return pool[Math.floor(rand() * pool.length)]!;
}
