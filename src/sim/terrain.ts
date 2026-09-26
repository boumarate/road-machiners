// The terrain grid. Heights live on tile corners, (size + 1) x (size + 1), so neighboring tiles share
// edges. Each tile reads its four corners for slope, and has a type. Driving, sight, routing and
// drawing all read this grid.

import { REGION } from '../data/region';
import { TERRAIN, TERRAIN_TYPES, type TerrainTypeId } from '../data/terrain';
import { elevationAt, noiseAt } from './elevation';
import { clamp, type Vec } from './vec';
import { ROAD_INDEX } from './road-index';

const SITES = [...REGION.towns, ...REGION.locations];

export type Terrain = {
  size: number;
  heights: number[]; // corner (i, j) at j * (size + 1) + i
  types: TerrainTypeId[]; // tile (x, y) at y * size + x
};

const T = TERRAIN;

export function heightFromElevation(e: number): number {
  return e * T.height.hill + Math.max(0, e - T.height.mountainFrom) * T.height.mountain;
}

let lastTerrain: { seed: number; size: number; terrain: Terrain } | undefined;

export function buildTerrain(seed: number, size: number): Terrain {
  if (lastTerrain?.seed === seed && lastTerrain.size === size) return lastTerrain.terrain;
  const heights: number[] = [];
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) heights.push(heightFromElevation(elevationAt(seed, i, j)));
  const t: Terrain = { size, heights, types: [] };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) t.types.push(pickType(seed, t, x, y));
  Object.freeze(t.heights);
  Object.freeze(t.types);
  Object.freeze(t);
  lastTerrain = { seed, size, terrain: t };
  return t;
}

function pickType(seed: number, t: Terrain, x: number, y: number): TerrainTypeId {
  const c = { x: x + 0.5, y: y + 0.5 };
  if (ROAD_INDEX.nearestWithin(c.x, c.y, REGION.roadWidth / 2) < REGION.roadWidth / 2) return 'road';
  for (const s of SITES) {
    const dx = s.pos.x - c.x;
    const dy = s.pos.y - c.y;
    // One tile past the margin keeps this cheap skip clear of rounding.
    if (dx * dx + dy * dy > (s.radius + T.types.siteMargin + 1) ** 2) continue;
    if (Math.hypot(dx, dy) < s.radius + T.types.siteMargin) return 'hardpan';
  }
  const s = tileSlope(t, y * t.size + x);
  if (Math.hypot(s.x, s.y) >= T.types.screeSlope) return 'scree';
  if (elevationAt(seed, c.x, c.y) < T.types.sandBelow) return 'sand';
  if (noiseAt(seed, c.x * T.types.scrubFreq, c.y * T.types.scrubFreq) > T.types.scrubAbove) return 'scrub';
  return 'hardpan';
}

function corner(t: Terrain, i: number, j: number): number {
  return t.heights[clamp(j, 0, t.size) * (t.size + 1) + clamp(i, 0, t.size)];
}

// Tile index under a map point, clamped to the map.
export function tileAt(t: Terrain, p: Vec): number {
  const x = clamp(Math.floor(p.x), 0, t.size - 1);
  const y = clamp(Math.floor(p.y), 0, t.size - 1);
  return y * t.size + x;
}

// Ground height at a map point: blend of the four corners of its tile. Outside the map, the nearest edge.
export function heightAt(t: Terrain, x: number, y: number): number {
  const cx = clamp(x, 0, t.size);
  const cy = clamp(y, 0, t.size);
  const i = Math.min(Math.floor(cx), t.size - 1);
  const j = Math.min(Math.floor(cy), t.size - 1);
  const fx = cx - i;
  const fy = cy - j;
  const a = corner(t, i, j);
  const b = corner(t, i + 1, j);
  const c = corner(t, i, j + 1);
  const d = corner(t, i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Height change per tile along x and y, averaged over the tile's two edges on each axis.
export function tileSlope(t: Terrain, tile: number): Vec {
  const i = tile % t.size;
  const j = Math.floor(tile / t.size);
  const a = corner(t, i, j);
  const b = corner(t, i + 1, j);
  const c = corner(t, i, j + 1);
  const d = corner(t, i + 1, j + 1);
  return { x: (b - a + d - c) / 2, y: (c - a + d - b) / 2 };
}

export function isCliff(t: Terrain, tile: number): boolean {
  const s = tileSlope(t, tile);
  return Math.hypot(s.x, s.y) > T.drive.maxSlope;
}

// Distance multiplier for driving across a map point in a direction: terrain type times slope.
export function driveFactor(t: Terrain, p: Vec, heading: number): number {
  const tile = tileAt(t, p);
  const s = tileSlope(t, tile);
  const grade = s.x * Math.cos(heading) + s.y * Math.sin(heading);
  const slope = grade > 0 ? 1 / (1 + T.drive.uphill * grade) : 1 + Math.min(T.drive.downhillCap, T.drive.downhill * -grade);
  return TERRAIN_TYPES[t.types[tile]].speed * slope;
}
