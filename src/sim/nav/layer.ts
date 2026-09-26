// Static navigation layers: per-tile cliff flags and speeds, and per-cell blocked flags and step
// costs for one vehicle radius. Kill wrecks and parked vehicles are not in here; the A* overlay
// stamps them per query.

import { TERRAIN_TYPES } from '../../data/terrain';
import { isDriveObstacle } from '../mapgen';
import { isCliff, type Terrain } from '../terrain';
import type { Obstacle } from '../types';
import { dist } from '../vec';
import { ObstacleBuckets, type Blocker } from './buckets';

export const CELL = 0.5; // tiles per grid cell
export const CLEARANCE = 0.4; // extra gap from obstacles on top of the vehicle radius; covers RULES.maxBulge

// Per-terrain data every radius shares.
export type TerrainNav = {
  size: number;
  n: number; // grid cells per side
  cliffTile: Uint8Array; // 1 where the tile is too steep to drive
  tileSpeed: Float64Array; // terrain speed per tile
  slow: Float32Array; // step cost multiplier per cell, 1 / terrain speed
};

export type NavLayer = TerrainNav & {
  id: number; // identity for route cache keys
  radius: number;
  blocked: Uint8Array; // cliffs within reach and static drive obstacles, per cell
};

// The static drive obstacles of one obstacles array and a bucket index over them.
export type StaticSet = { key: string; buckets: ObstacleBuckets };

// Kill wrecks come and go in play; every other drive obstacle is fixed at map generation.
export function isKillWreck(o: Obstacle): boolean {
  return o.id.startsWith('wreck-');
}

// Terrains are frozen and shared by world clones, so identity is the key. Dropped terrains free their layers.
const terrains = new WeakMap<Terrain, { nav: TerrainNav; cellCliff: Map<number, Uint8Array>; layers: Map<string, NavLayer> }>();
// Per terrain: a few chassis radii times the current static obstacle set. Tests build more sets, so clear when full.
const LAYERS_MAX = 16;
let nextLayerId = 1;

function terrainEntry(t: Terrain) {
  let e = terrains.get(t);
  if (!e) {
    const n = Math.ceil(t.size / CELL);
    const cliffTile = new Uint8Array(t.size * t.size);
    const tileSpeed = new Float64Array(t.size * t.size);
    for (let i = 0; i < t.size * t.size; i++) {
      cliffTile[i] = isCliff(t, i) ? 1 : 0;
      tileSpeed[i] = TERRAIN_TYPES[t.types[i]].speed;
    }
    const slow = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) slow[y * n + x] = 1 / tileSpeed[tileIndex(t.size, (x + 0.5) * CELL, (y + 0.5) * CELL)];
    e = { nav: { size: t.size, n, cliffTile, tileSpeed, slow }, cellCliff: new Map(), layers: new Map() };
    terrains.set(t, e);
  }
  return e;
}

export function terrainNav(t: Terrain): TerrainNav {
  return terrainEntry(t).nav;
}

// Same clamping as tileAt.
export function tileIndex(size: number, x: number, y: number): number {
  const tx = Math.min(size - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(size - 1, Math.max(0, Math.floor(y)));
  return ty * size + tx;
}

// A cliff tile within reach of the point, checked at the point and four compass offsets.
export function nearCliff(nav: TerrainNav, x: number, y: number, reach: number): boolean {
  const c = nav.cliffTile;
  const s = nav.size;
  return c[tileIndex(s, x, y)] === 1 || c[tileIndex(s, x + reach, y)] === 1 || c[tileIndex(s, x - reach, y)] === 1 || c[tileIndex(s, x, y + reach)] === 1 || c[tileIndex(s, x, y - reach)] === 1;
}

// Built once per obstacles array. The length check catches obstacles pushed into the same array.
const staticSets = new WeakMap<Obstacle[], { length: number; set: StaticSet }>();

export function staticSet(obstacles: Obstacle[], size: number): StaticSet {
  const hit = staticSets.get(obstacles);
  if (hit && hit.length === obstacles.length) return hit.set;
  const statics = obstacles.filter((o) => isDriveObstacle(o) && !isKillWreck(o));
  const set = { key: blockerKey(statics), buckets: new ObstacleBuckets(statics, size) };
  staticSets.set(obstacles, { length: obstacles.length, set });
  return set;
}

// Blockers that change during play: kill wrecks and the caller's extra circles.
export function dynamicBlockers(obstacles: Obstacle[], extra: Blocker[]): Blocker[] {
  return [...obstacles.filter((o) => isDriveObstacle(o) && isKillWreck(o)), ...extra];
}

// Exact content key: number-to-string round-trips, so equal keys mean equal circles.
export function blockerKey(blockers: Blocker[]): string {
  return blockers.map((o) => `${o.pos.x},${o.pos.y},${o.r}`).join('|');
}

export function navLayer(terrain: Terrain, obstacles: Obstacle[], radius: number): NavLayer {
  const e = terrainEntry(terrain);
  const statics = staticSet(obstacles, terrain.size);
  const key = `${radius}:${statics.key}`;
  const hit = e.layers.get(key);
  if (hit) return hit;
  if (e.layers.size >= LAYERS_MAX) e.layers.clear();
  const nav = e.nav;
  const n = nav.n;
  let cliff = e.cellCliff.get(radius);
  if (!cliff) {
    if (e.cellCliff.size >= LAYERS_MAX) e.cellCliff.clear();
    cliff = new Uint8Array(n * n);
    const reach = radius + CLEARANCE;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (nearCliff(nav, (x + 0.5) * CELL, (y + 0.5) * CELL, reach)) cliff[y * n + x] = 1;
    e.cellCliff.set(radius, cliff);
  }
  const blocked = cliff.slice();
  stampCircles(n, obstacles.filter((o) => isDriveObstacle(o) && !isKillWreck(o)), radius, (c) => (blocked[c] = 1));
  const layer: NavLayer = { ...nav, id: nextLayerId++, radius, blocked };
  e.layers.set(key, layer);
  return layer;
}

// Calls mark for every cell whose center lies within the blocker radius plus vehicle radius plus clearance.
export function stampCircles(n: number, blockers: Blocker[], radius: number, mark: (cell: number) => void): void {
  for (const o of blockers) {
    const reach = o.r + radius + CLEARANCE;
    const x0 = Math.max(0, Math.floor((o.pos.x - reach) / CELL));
    const y0 = Math.max(0, Math.floor((o.pos.y - reach) / CELL));
    const x1 = Math.min(n - 1, Math.floor((o.pos.x + reach) / CELL));
    const y1 = Math.min(n - 1, Math.floor((o.pos.y + reach) / CELL));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (dist({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL }, o.pos) < reach) mark(y * n + x);
  }
}
