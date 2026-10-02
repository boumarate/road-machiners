// Ground scatter: loose pebbles, olive scrub and short cacti on open ground. Open desert is as dense as the
// reference image of issue 129, cacti gather by rocks and crags, scrub is dense on scrub ground, and road
// shoulders keep stones only. Ground that takes no desert look keeps its sparse scatter. Decoration only, no collision. Placement comes from render noise per tile,
// so it is the same on every load. Each terrain chunk draws its scatter as one instanced model per kind.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import type { TerrainTypeId } from '../../data/terrain';
import { REGION } from '../../data/region';
import { desertWeight } from '../../render/groundPaint';
import { hash2 } from '../../render/noise';
import { ROAD_INDEX } from '../../sim/road-index';
import { groundAt, type Terrain } from '../../sim/terrain';
import type { Obstacle } from '../../sim/types';
import type { Vec } from '../../sim/vec';
import { instancedModel } from './models';
import type { RenderScope } from './scope';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;
export const ROAD_GAP = REGION.roadWidth / 2 + 0.3; // tiles from a road center line kept free of scatter
export const SHOULDER_TILES = 2; // tiles past ROAD_GAP where stones gather along a road
export const OBSTACLE_GAP = 0.5; // tiles past an obstacle's radius kept free of scatter
export const CACTUS_NEAR_ROCK = 2; // tiles past a rock's or crag's radius where cacti gather
const PEBBLE_CHANCE = 0.3; // share of tiles with a pebble cluster
const PEBBLE_ON_DESERT = 0.45; // share of open desert tiles with a pebble cluster, at full desert weight
const PEBBLE_ON_SHOULDER = 0.6; // share of road shoulder tiles with a pebble cluster
// Share of scrub tiles with a scrub tuft. Dense, so scrub ground reads as brush at the default zoom.
const SCRUB_ON_SCRUB = 0.45;
// Share of other open tiles with a scrub tuft. Sparse, so bare ground still shows a stray bush.
const SCRUB_ELSEWHERE = 0.04;
const SCRUB_ON_DESERT = 0.35; // share of open desert tiles with a scrub clump, at full desert weight
// Share of road shoulder tiles with a scrub tuft on ground that takes no desert look, unless scrub ground has more.
// Desert shoulders keep stones only, so the road edge stays clean.
const SCRUB_ON_SHOULDER = 0.1;
const CACTUS_ON_DESERT = 0.02; // share of open desert tiles with a cactus, at full desert weight. Sparse, as trucks pass through.
const CACTUS_BY_ROCK = 0.12; // share of desert tiles by a rock or crag with a cactus, at full desert weight
// Big enough to read at the default zoom, small enough that a truck driving over them does not look like a crash.
const PEBBLE_RADIUS = { min: 0.04, max: 0.09 }; // tiles
const SCRUB_RADIUS = { min: 0.15, max: 0.24 }; // tiles, a clump 1.2-1.9 m across as in the reference
const CACTUS_HEIGHT = { min: 1.1, max: 1.8 }; // meters, under the truck clearance so driving through does not look like a crash
const TINT = { min: 0.85, max: 1.15 };

type Placed = { at: Vec; matrix: THREE.Matrix4; tint: number };
export type ScatterChunk = { center: Vec; pebbles: Placed[]; scrub: Placed[]; cactus: Placed[] };

export function addScatter(t: Terrain, obstacles: Obstacle[], scope: RenderScope): void {
  const reach = (TERRAIN_CHUNK / 2) * Math.SQRT2 + 1;
  for (const chunk of scatterPlacements(t, obstacles)) {
    for (const [name, list] of [['pebbles', chunk.pebbles], ['scrub', chunk.scrub], ['cactus', chunk.cactus]] as const) {
      if (list.length === 0) continue;
      const group = instancedModel(name, list.map((p) => p.matrix), list.map((p) => p.tint));
      // Scrub and cacti cast shadows so they stand on the ground. Pebbles are too small to need it, and many.
      // Scrub stems are too thin to shadow each other without turning the clump into a dark blot.
      for (const mesh of group.children) {
        mesh.castShadow = name !== 'pebbles';
        mesh.receiveShadow = name !== 'scrub';
      }
      scope.add(group, chunk.center, reach);
    }
  }
}

// Scatter per terrain chunk, a pure function of the terrain and obstacles.
export function scatterPlacements(t: Terrain, obstacles: Obstacle[]): ScatterChunk[] {
  const blocked = blockedTiles(t.size, obstacles);
  const rocky = rockyTiles(t.size, obstacles);
  const chunks: ScatterChunk[] = [];
  for (let cy = 0; cy < t.size; cy += TERRAIN_CHUNK) for (let cx = 0; cx < t.size; cx += TERRAIN_CHUNK) chunks.push(chunkScatter(t, blocked, rocky, cx, cy));
  return chunks;
}

function chunkScatter(t: Terrain, blocked: Uint8Array, rocky: Uint8Array, cx: number, cy: number): ScatterChunk {
  const chunk: ScatterChunk = { center: { x: cx + TERRAIN_CHUNK / 2, y: cy + TERRAIN_CHUNK / 2 }, pebbles: [], scrub: [], cactus: [] };
  for (let y = cy; y < Math.min(cy + TERRAIN_CHUNK, t.size); y++) for (let x = cx; x < Math.min(cx + TERRAIN_CHUNK, t.size); x++) {
    const i = y * t.size + x;
    const kind = blocked[i] ? null : tileScatter(t, x, y, rocky[i] === 1);
    if (kind !== null) chunk[kind].push(placed(t, x, y, kind));
  }
  return chunk;
}

type ScatterKind = 'pebbles' | 'scrub' | 'cactus';

// What tile x, y holds. Road shoulders take their own chances.
function tileScatter(t: Terrain, x: number, y: number, byRock: boolean): ScatterKind | null {
  const h = hash2(x * 7 + 3, y * 13 + 5);
  const type = t.types[y * t.size + x];
  // Nothing can land here whatever the road distance, so skip the road lookup.
  if (pick(h, chances(type, false, byRock)) === null && pick(h, chances(type, true, byRock)) === null) return null;
  const p = tilePoint(x, y);
  const road = ROAD_INDEX.nearestWithin(p.x, p.y, ROAD_GAP + SHOULDER_TILES);
  return road < ROAD_GAP ? null : pick(h, chances(type, road < ROAD_GAP + SHOULDER_TILES, byRock));
}

type Chances = { pebbles: number; scrub: number; cactus: number };

// Shares of tiles of a ground type with a pebble cluster, a scrub clump and a cactus. Open ground moves from the
// sparse base chances toward the desert ones by its desert weight. Shoulders raise pebbles and keep desert brush
// off. Hull plating lies over the ground, so nothing grows there and pebbles would poke through it.
function chances(type: TerrainTypeId, shoulder: boolean, byRock: boolean): Chances {
  if (type === 'hull') return { pebbles: 0, scrub: 0, cactus: 0 };
  const w = desertWeight(type);
  const scrub = type === 'scrub' ? SCRUB_ON_SCRUB : SCRUB_ELSEWHERE + (SCRUB_ON_DESERT - SCRUB_ELSEWHERE) * w;
  if (shoulder) return { pebbles: PEBBLE_ON_SHOULDER, scrub: w > 0 ? 0 : Math.max(scrub, SCRUB_ON_SHOULDER), cactus: 0 };
  const pebbles = PEBBLE_CHANCE + (PEBBLE_ON_DESERT - PEBBLE_CHANCE) * w;
  return { pebbles, scrub, cactus: (byRock ? CACTUS_BY_ROCK : CACTUS_ON_DESERT) * w };
}

// Pebbles take the low end of the tile hash, cacti the range above them and scrub the high end.
function pick(h: number, c: Chances): ScatterKind | null {
  if (h < c.pebbles) return 'pebbles';
  if (h < c.pebbles + c.cactus) return 'cactus';
  return h > 1 - c.scrub ? 'scrub' : null;
}

function tilePoint(x: number, y: number): Vec {
  return { x: x + hash2(x, y * 3), y: y + hash2(x * 5, y) };
}

const place = new THREE.Object3D();

function placed(t: Terrain, x: number, y: number, kind: ScatterKind): Placed {
  const p = tilePoint(x, y);
  place.position.set(p.x * S, groundAt(t, p.x, p.y) * S, p.y * S);
  place.rotation.y = hash2(x * 19, y * 23 + 1) * Math.PI * 2;
  place.scale.setScalar(size(kind, hash2(x * 11 + 1, y * 17 + 9)));
  place.updateMatrix();
  return { at: p, matrix: place.matrix.clone(), tint: lerp(TINT, hash2(x * 29 + 4, y * 31)) };
}

// The model scale in meters. Pebbles and scrub are modeled at a unit footprint radius, cacti at 1 m tall.
function size(kind: ScatterKind, s: number): number {
  if (kind === 'cactus') return lerp(CACTUS_HEIGHT, s);
  return lerp(kind === 'pebbles' ? PEBBLE_RADIUS : SCRUB_RADIUS, s) * S;
}

function lerp(r: { min: number; max: number }, s: number): number {
  return r.min + (r.max - r.min) * s;
}

// Tiles whose center lies within an obstacle's radius plus the gap.
function blockedTiles(size: number, obstacles: Obstacle[]): Uint8Array {
  const out = new Uint8Array(size * size);
  for (const o of obstacles) markDisc(out, size, o.pos, o.r + OBSTACLE_GAP);
  return out;
}

// Tiles whose center lies within CACTUS_NEAR_ROCK of a rock or a crag, where cacti gather.
function rockyTiles(size: number, obstacles: Obstacle[]): Uint8Array {
  const out = new Uint8Array(size * size);
  for (const o of obstacles) if (o.kind === 'rock' || (o.kind === 'landmark' && o.look === 'crag')) markDisc(out, size, o.pos, o.r + CACTUS_NEAR_ROCK);
  return out;
}

function markDisc(out: Uint8Array, size: number, at: Vec, r: number): void {
  for (let y = Math.max(0, Math.floor(at.y - r)); y <= Math.min(size - 1, Math.ceil(at.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(at.x - r)); x <= Math.min(size - 1, Math.ceil(at.x + r)); x++) {
      if (Math.hypot(x + 0.5 - at.x, y + 0.5 - at.y) <= r) out[y * size + x] = 1;
    }
  }
}
