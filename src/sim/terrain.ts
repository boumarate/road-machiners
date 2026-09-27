// The terrain grid. Heights live on tile corners, (size + 1) x (size + 1), so neighboring tiles share
// edges. Each tile reads its four corners for slope, and has a type. Driving, sight, routing and
// drawing all read this grid. On Canyon Bridge, heights and slopes are the deck's (see bridge.ts).

import { REGION } from '../data/region';
import { TERRAIN, type TerrainTypeId } from '../data/terrain';
import { BRIDGE_AXIS, BRIDGE_LENGTH, deckAlong } from './bridge';
import { elevationAt, noiseAt } from './elevation';
import { clamp, type Vec } from './vec';
import { gradeRoads } from './road-grade';
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
  const raw: Terrain = { size, heights: [], types: [] };
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) raw.heights.push(heightFromElevation(elevationAt(seed, i, j)));
  const heights = gradeRoads(raw);
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
  if (deckAlong(c.x, c.y) !== null) return 'road';
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
  const patch = pickSurfacePatch(seed, c);
  if (patch !== null) return patch;
  if (elevationAt(seed, c.x, c.y) < T.types.sandBelow) return 'sand';
  if (noiseAt(seed, c.x * T.types.scrubFreq, c.y * T.types.scrubFreq) > T.types.scrubAbove) return 'scrub';
  return 'hardpan';
}

function pickSurfacePatch(seed: number, p: Vec): TerrainTypeId | null {
  const patches = T.types.patches;
  const x = p.x * patches.frequency;
  const y = p.y * patches.frequency;
  if (noiseAt(seed + patches.coverageSeedOffset, x, y) <= patches.coverageAbove) return null;
  const sample = noiseAt(seed + patches.kindSeedOffset, x, y);
  const band = patches.bands.find((entry) => sample <= entry.through);
  if (!band) throw new Error(`No terrain surface band for ${sample}`);
  return band.kind;
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

// Height at a map point: the deck on Canyon Bridge, else the ground.
export function heightAt(t: Terrain, x: number, y: number): number {
  const a = deckAlong(x, y);
  return a === null ? groundAt(t, x, y) : deckHeight(t, a);
}

// Ground height at a map point: blend of the four corners of its tile. Outside the map, the nearest edge.
export function groundAt(t: Terrain, x: number, y: number): number {
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

// Deck surface height at a distance along it: a straight line between the ground at both ends.
export function deckHeight(t: Terrain, along: number): number {
  const [from, to] = deckEnds(t);
  return from + (to - from) * (along / BRIDGE_LENGTH);
}

// Ground height at the deck's from and to ends.
export function deckEnds(t: Terrain): [number, number] {
  const { from, to } = T.features.bridge;
  return [groundAt(t, from.x, from.y), groundAt(t, to.x, to.y)];
}

// Height change per tile along x and y. A tile centered on the deck takes the deck's grade.
export function tileSlope(t: Terrain, tile: number): Vec {
  const i = tile % t.size;
  const j = Math.floor(tile / t.size);
  if (deckAlong(i + 0.5, j + 0.5) === null) return groundSlope(t, tile);
  const [from, to] = deckEnds(t);
  const grade = (to - from) / BRIDGE_LENGTH;
  return { x: grade * BRIDGE_AXIS.x, y: grade * BRIDGE_AXIS.y };
}

// Ground height change per tile along x and y, averaged over the tile's two edges on each axis.
export function groundSlope(t: Terrain, tile: number): Vec {
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
