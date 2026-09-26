// Deterministic elevation noise derived from the world seed, not the seeded rng. It only seeds the
// terrain grid in sim/terrain.ts; everything else reads that grid.
// Flattened near roads, towns and locations so they stay drivable.

import { TERRAIN } from '../data/terrain';
import { REGION } from '../data/region';
import { dist, polylineDist } from './vec';

// Own hash, independent of render/noise.ts (render-only) and sim/rng.ts (consumes world.rngState).
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Fractal sum of a few octaves, in [0, 1].
function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let total = 0;
  for (const o of TERRAIN.octaves) {
    sum += noise2(x * o.freq, y * o.freq, seed + o.seedOffset) * o.amp;
    total += o.amp;
  }
  return sum / total;
}

// Plain value noise in [0, 1] for secondary patterns like scrub patches.
export function noiseAt(seed: number, x: number, y: number): number {
  return noise2(x, y, seed + NOISE_SEED_OFFSET);
}

const NOISE_SEED_OFFSET = 7919; // keeps secondary noise independent of the elevation octaves

function rawElevation(seed: number, x: number, y: number): number {
  return fbm(x, y, seed) * 2 - 1;
}

// 0 = untouched terrain, 1 = fully flattened, based on distance to the nearest road, town or location.
export function flattenFactor(x: number, y: number): number {
  const p = { x, y };
  let best = Infinity;
  for (const road of REGION.roads) best = Math.min(best, polylineDist(p, road) - REGION.roadWidth / 2);
  for (const site of [...REGION.towns, ...REGION.locations]) best = Math.min(best, dist(p, site.pos) - site.radius);
  if (best <= 0) return 1;
  if (best >= TERRAIN.flattenMargin) return 0;
  return 1 - smooth(best / TERRAIN.flattenMargin);
}

export function elevationAt(seed: number, x: number, y: number): number {
  const p = { x, y };
  let height = rawElevation(seed, x, y);
  for (const feature of [TERRAIN.features.canyon, TERRAIN.features.dryRiver]) {
    const gap = polylineDist(p, feature.path) - feature.width;
    if (gap < feature.bank) height -= feature.depth * (gap <= 0 ? 1 : 1 - smooth(gap / feature.bank));
  }
  height *= 1 - flattenFactor(x, y);
  for (const crater of TERRAIN.features.craters) {
    const gap = dist(p, crater.center) - crater.radius;
    if (gap < crater.bank) height -= crater.depth * (gap <= 0 ? 1 : 1 - smooth(gap / crater.bank));
  }
  return height;
}
