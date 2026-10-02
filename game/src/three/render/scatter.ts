// Ground scatter: loose pebbles and dry scrub on open ground, with scrub dense on scrub ground and stones
// gathered on road shoulders. Decoration only, no collision. Placement comes from render noise per tile,
// so it is the same on every load. Each terrain chunk draws its scatter as one instanced model per kind.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import type { TerrainTypeId } from '../../data/terrain';
import { REGION } from '../../data/region';
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
export const SHOULDER_TILES = 2; // tiles past ROAD_GAP where stones and scrub gather along a road
export const OBSTACLE_GAP = 0.5; // tiles past an obstacle's radius kept free of scatter
const PEBBLE_CHANCE = 0.3; // share of tiles with a pebble cluster
const PEBBLE_ON_SHOULDER = 0.6; // share of road shoulder tiles with a pebble cluster
// Share of scrub tiles with a scrub tuft. Dense, so scrub ground reads as brush at the default zoom.
const SCRUB_ON_SCRUB = 0.45;
// Share of other open tiles with a scrub tuft. Sparse, so bare ground still shows a stray bush.
const SCRUB_ELSEWHERE = 0.04;
const SCRUB_ON_SHOULDER = 0.1; // share of road shoulder tiles with a scrub tuft, unless scrub ground has more
// Big enough to read at the default zoom, small enough that a truck driving over them does not look like a crash.
const PEBBLE_RADIUS = { min: 0.04, max: 0.09 }; // tiles
const SCRUB_RADIUS = { min: 0.1, max: 0.22 }; // tiles
const TINT = { min: 0.85, max: 1.15 };

type Placed = { at: Vec; matrix: THREE.Matrix4; tint: number };
export type ScatterChunk = { center: Vec; pebbles: Placed[]; scrub: Placed[] };

export function addScatter(t: Terrain, obstacles: Obstacle[], scope: RenderScope): void {
  const reach = (TERRAIN_CHUNK / 2) * Math.SQRT2 + 1;
  for (const chunk of scatterPlacements(t, obstacles)) {
    for (const [name, list] of [['pebbles', chunk.pebbles], ['scrub', chunk.scrub]] as const) {
      if (list.length === 0) continue;
      const group = instancedModel(name, list.map((p) => p.matrix), list.map((p) => p.tint));
      // Scrub casts shadows so tufts stand on the ground. Pebbles are too small to need it, and many.
      for (const mesh of group.children) mesh.castShadow = name === 'scrub';
      scope.add(group, chunk.center, reach);
    }
  }
}

// Scatter per terrain chunk, a pure function of the terrain and obstacles.
export function scatterPlacements(t: Terrain, obstacles: Obstacle[]): ScatterChunk[] {
  const blocked = blockedTiles(t.size, obstacles);
  const chunks: ScatterChunk[] = [];
  for (let cy = 0; cy < t.size; cy += TERRAIN_CHUNK) for (let cx = 0; cx < t.size; cx += TERRAIN_CHUNK) chunks.push(chunkScatter(t, blocked, cx, cy));
  return chunks;
}

function chunkScatter(t: Terrain, blocked: Uint8Array, cx: number, cy: number): ScatterChunk {
  const chunk: ScatterChunk = { center: { x: cx + TERRAIN_CHUNK / 2, y: cy + TERRAIN_CHUNK / 2 }, pebbles: [], scrub: [] };
  for (let y = cy; y < Math.min(cy + TERRAIN_CHUNK, t.size); y++) for (let x = cx; x < Math.min(cx + TERRAIN_CHUNK, t.size); x++) {
    const kind = blocked[y * t.size + x] ? null : tileScatter(t, x, y);
    if (kind !== null) chunk[kind].push(placed(t, x, y, kind));
  }
  return chunk;
}

type ScatterKind = 'pebbles' | 'scrub';

// What tile x, y holds. Road shoulders take their own, higher chances.
function tileScatter(t: Terrain, x: number, y: number): ScatterKind | null {
  const h = hash2(x * 7 + 3, y * 13 + 5);
  const type = t.types[y * t.size + x];
  // Nothing can land here whatever the road distance, so skip the road lookup.
  if (pick(h, chances(type, true)) === null) return null;
  const p = tilePoint(x, y);
  const road = ROAD_INDEX.nearestWithin(p.x, p.y, ROAD_GAP + SHOULDER_TILES);
  return road < ROAD_GAP ? null : pick(h, chances(type, road < ROAD_GAP + SHOULDER_TILES));
}

type Chances = { pebbles: number; scrub: number };

// Shares of tiles of a ground type with a pebble cluster and with a scrub tuft. Shoulders raise both. Hull plating
// lies over the ground, so nothing grows there and pebbles would poke through it.
function chances(type: TerrainTypeId, shoulder: boolean): Chances {
  if (type === 'hull') return { pebbles: 0, scrub: 0 };
  const scrub = type === 'scrub' ? SCRUB_ON_SCRUB : SCRUB_ELSEWHERE;
  return shoulder ? { pebbles: PEBBLE_ON_SHOULDER, scrub: Math.max(scrub, SCRUB_ON_SHOULDER) } : { pebbles: PEBBLE_CHANCE, scrub };
}

// Pebbles take the low end of the tile hash and scrub the high end.
function pick(h: number, c: Chances): ScatterKind | null {
  if (h < c.pebbles) return 'pebbles';
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
  place.scale.setScalar(lerp(kind === 'pebbles' ? PEBBLE_RADIUS : SCRUB_RADIUS, hash2(x * 11 + 1, y * 17 + 9)) * S);
  place.updateMatrix();
  return { at: p, matrix: place.matrix.clone(), tint: lerp(TINT, hash2(x * 29 + 4, y * 31)) };
}

function lerp(r: { min: number; max: number }, s: number): number {
  return r.min + (r.max - r.min) * s;
}

// Tiles whose center lies within an obstacle's radius plus the gap.
function blockedTiles(size: number, obstacles: Obstacle[]): Uint8Array {
  const out = new Uint8Array(size * size);
  for (const o of obstacles) {
    const r = o.r + OBSTACLE_GAP;
    for (let y = Math.max(0, Math.floor(o.pos.y - r)); y <= Math.min(size - 1, Math.ceil(o.pos.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(o.pos.x - r)); x <= Math.min(size - 1, Math.ceil(o.pos.x + r)); x++) {
        if (Math.hypot(x + 0.5 - o.pos.x, y + 0.5 - o.pos.y) <= r) out[y * size + x] = 1;
      }
    }
  }
  return out;
}
