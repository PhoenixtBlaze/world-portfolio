/** Deterministic seeded PRNG (Mulberry32). */

export function hashCoords(x: number, z: number, seed = 0): number {
  let h = seed + x * 374761393 + z * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngForTile(tx: number, tz: number): () => number {
  return mulberry32(hashCoords(tx, tz, 0x574f524c)); // 'WORL'
}
