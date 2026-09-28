// The map bake: a fixed order of layers over one draft, from base relief to rocks. Heights, sand, flow and
// slumped marks live on tile corners, (size + 1) x (size + 1), corner (i, j) at j * (size + 1) + i. Types
// live on tiles, tile (x, y) at y * size + x, as an index into TYPE_IDS.

import { REGION } from '../data/region';
import { TERRAIN, type TerrainTypeId } from '../data/terrain';
import { bridgeCut, deckAlong } from '../sim/bridge';
import { broadAt, elevationAt, flattenFactor, noiseAt, reliefAt } from '../sim/elevation';
import { gradeRoads } from '../sim/road-grade';
import { ROAD_INDEX } from '../sim/road-index';
import { randInt, randRange, type Rng } from '../sim/rng';
import { heightFromElevation, TYPE_IDS, type Rock } from '../sim/terrain';
import { dist, segmentDist, type Vec } from '../sim/vec';

export function bakeMap(seed: number): MapDraft {
  let d = timed('base', () => baseLayer(seed, REGION.size));
  d = timed('finish', () => finishLayer(seed, d));
  d = timed('ground', () => groundLayer(seed, d));
  return timed('rocks', () => rockLayer(seed, d));
}

function timed(layer: string, run: () => MapDraft): MapDraft {
  const start = performance.now();
  const d = run();
  console.log(`${layer}: ${Math.round(performance.now() - start)} ms`);
  return d;
}

// The draft every layer reads and changes.

export type MapDraft = {
  size: number;
  heights: Float32Array;
  types: Uint8Array;
  rocks: Rock[];
  sand: Float32Array;
  flow: Float32Array;
  slumped: Uint8Array;
};

export function newDraft(size: number): MapDraft {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`Map size must be a positive integer, got ${size}`);
  const corners = (size + 1) * (size + 1);
  return {
    size,
    heights: new Float32Array(corners),
    types: new Uint8Array(size * size),
    rocks: [],
    sand: new Float32Array(corners),
    flow: new Float32Array(corners),
    slumped: new Uint8Array(corners),
  };
}

export function typeCode(id: TerrainTypeId): number {
  const code = TYPE_IDS.indexOf(id);
  if (code < 0) throw new Error(`Unknown ground type ${id}`);
  return code;
}

// Steepness of a tile: height change per tile, from its four corners averaged over both edges on each axis.
export function tileSteepness(heights: ArrayLike<number>, size: number, tile: number): number {
  const i = tile % size;
  const j = Math.floor(tile / size);
  const w = size + 1;
  const a = heights[j * w + i];
  const b = heights[j * w + i + 1];
  const c = heights[(j + 1) * w + i];
  const d = heights[(j + 1) * w + i + 1];
  return Math.hypot((b - a + d - c) / 2, (c - a + d - b) / 2);
}

// Base layer: noise relief, ridges and the fixed landforms at full height, before any flattening.

export function baseLayer(seed: number, size: number): MapDraft {
  const d = newDraft(size);
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) d.heights[j * (size + 1) + i] = heightFromElevation(reliefAt(seed, i, j) + broadAt(seed, i, j));
  return d;
}

// Finish layer: ground near roads and sites blends down to the broad rolling height, except in the gap
// under Canyon Bridge, then road grading caps every road and bank grade.

export function finishLayer(seed: number, d: MapDraft): MapDraft {
  const w = d.size + 1;
  for (let j = 0; j <= d.size; j++) for (let i = 0; i <= d.size; i++) {
    const flatten = flattenFactor(i, j) * (1 - bridgeCut(i, j));
    if (flatten === 0) continue;
    const k = j * w + i;
    d.heights[k] += (heightFromElevation(broadAt(seed, i, j)) - d.heights[k]) * flatten;
  }
  d.heights.set(gradeRoads({ size: d.size, heights: Array.from(d.heights), types: [] }));
  return d;
}

// Ground layer. Roads and sites first, then steep ground, broad surface patches, low ground and scrub.

const SITES = [...REGION.towns, ...REGION.locations];
const T = TERRAIN.types;

export function groundLayer(seed: number, d: MapDraft): MapDraft {
  for (let y = 0; y < d.size; y++) for (let x = 0; x < d.size; x++) d.types[y * d.size + x] = typeCode(pickType(seed, d.heights, d.size, x, y));
  return d;
}

// Ground type of tile (x, y) on a map of the given size, from its corner heights.
export function pickType(seed: number, heights: ArrayLike<number>, size: number, x: number, y: number): TerrainTypeId {
  const c = { x: x + 0.5, y: y + 0.5 };
  return builtType(c) ?? naturalType(seed, tileSteepness(heights, size, y * size + x), c);
}

// Road on roads and the bridge deck, hardpan on and around sites, null elsewhere.
function builtType(c: Vec): TerrainTypeId | null {
  if (deckAlong(c.x, c.y) !== null) return 'road';
  if (ROAD_INDEX.nearestWithin(c.x, c.y, REGION.roadWidth / 2) < REGION.roadWidth / 2) return 'road';
  return SITES.some((s) => nearSite(s.pos, s.radius, c)) ? 'hardpan' : null;
}

function nearSite(pos: Vec, radius: number, c: Vec): boolean {
  const dx = pos.x - c.x;
  const dy = pos.y - c.y;
  // One tile past the margin keeps this cheap skip clear of rounding.
  if (dx * dx + dy * dy > (radius + T.siteMargin + 1) ** 2) return false;
  return Math.hypot(dx, dy) < radius + T.siteMargin;
}

function naturalType(seed: number, steepness: number, c: Vec): TerrainTypeId {
  if (steepness >= T.screeSlope) return 'scree';
  return pickSurfacePatch(seed, c) ?? plainType(seed, c);
}

function plainType(seed: number, c: Vec): TerrainTypeId {
  if (elevationAt(seed, c.x, c.y) < T.sandBelow) return 'sand';
  return noiseAt(seed, c.x * T.scrubFreq, c.y * T.scrubFreq) > T.scrubAbove ? 'scrub' : 'hardpan';
}

function pickSurfacePatch(seed: number, p: Vec): TerrainTypeId | null {
  const patches = T.patches;
  const x = p.x * patches.frequency;
  const y = p.y * patches.frequency;
  if (noiseAt(seed + patches.coverageSeedOffset, x, y) <= patches.coverageAbove) return null;
  const sample = noiseAt(seed + patches.kindSeedOffset, x, y);
  const band = patches.bands.find((entry) => sample <= entry.through);
  if (!band) throw new Error(`No terrain surface band for ${sample}`);
  return band.kind;
}

// Rock layer: clusters of boulders off the roads, sites, the bridge deck, cliffs and the map margin.

const O = REGION.obstacles;

export function rockLayer(seed: number, d: MapDraft): MapDraft {
  d.rocks = scatterRocks({ rngState: seed }, d.size, d.heights);
  return d;
}

// Rock clusters on a map of the given size with the given corner heights, drawn from rng.
export function scatterRocks(rng: Rng, size: number, heights: ArrayLike<number>): Rock[] {
  const out: Rock[] = [];
  let tries = 0;
  for (let c = 0; c < O.clusters; c++) {
    const center = { x: randRange(rng, O.edgeMargin, size - O.edgeMargin), y: randRange(rng, O.edgeMargin, size - O.edgeMargin) };
    const count = randInt(rng, O.rocksPerCluster[0], O.rocksPerCluster[1]);
    for (let i = 0; i < count; i++) {
      tries++;
      if (tries > O.maxTries) throw new Error('Rock placement ran out of tries');
      const pos = { x: center.x + randRange(rng, -O.clusterSpread, O.clusterSpread), y: center.y + randRange(rng, -O.clusterSpread, O.clusterSpread) };
      const r = randRange(rng, O.radius[0], O.radius[1]);
      if (fitsOffRoad(size, heights, out, { pos, r })) out.push({ pos, r });
    }
  }
  return out;
}

function fitsOffRoad(size: number, heights: ArrayLike<number>, placed: Rock[], rock: Rock): boolean {
  const { pos, r } = rock;
  if (Math.min(pos.x, pos.y, size - pos.x, size - pos.y) < O.edgeMargin) return false;
  const roadGap = REGION.roadWidth / 2 + O.roadClearance + r;
  if (ROAD_INDEX.nearestWithin(pos.x, pos.y, roadGap) < roadGap) return false;
  const tile = Math.floor(pos.y) * size + Math.floor(pos.x);
  if (tileSteepness(heights, size, tile) > TERRAIN.drive.maxSlope) return false;
  return !onBridge(pos, r) && clearOfSites(pos, r) && placed.every((o) => dist(pos, o.pos) >= o.r + r + O.gap);
}

// A prop on the narrow bridge deck would close the crossing.
export function onBridge(pos: Vec, r: number): boolean {
  const bridge = TERRAIN.features.bridge;
  return segmentDist(pos, bridge.from, bridge.to) < bridge.width / 2 + r;
}

export function clearOfSites(pos: Vec, r: number): boolean {
  return SITES.every((s) => dist(pos, s.pos) > s.radius + O.siteClearance + r);
}
