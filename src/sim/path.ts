// Route planning around static obstacles and cliffs: A* on a grid weighted by terrain speed, so
// routes prefer roads over sand, then shortcut to visible corners. Moving vehicles are not in the
// grid, so ramming and blocking still happen. The grid itself lives in ./nav.

import { count, timed } from '../perf';
import { findCells, nearestFreeCell, stampOverlay } from './nav/astar';
import type { Blocker } from './nav/buckets';
import { CELL, CLEARANCE, blockerKey, dynamicBlockers, navLayer, nearCliff, staticSet, terrainNav, tileIndex, type NavLayer, type StaticSet, type TerrainNav } from './nav/layer';
import type { World } from './types';
import { dist, segmentDist, type Vec } from './vec';

export type { Blocker };

// Recent A* results. 64 covers up to 20 vehicles times 3 preview turns, so a repeated preview or
// the turn after it finds every search done. Keys hold layer identity and exact blocker content.
const ROUTE_CACHE_MAX = 64;
const routeCache = new Map<string, { goal: number | null; cells: Int32Array | null }>();

export function route(world: World, from: Vec, to: Vec, radius: number, extra: Blocker[]): Vec[] {
  return timed('route', () => {
    const nav = terrainNav(world.terrain);
    const statics = staticSet(world.obstacles, world.terrain.size);
    const dynamic = dynamicBlockers(world.obstacles, extra);
    const reach = radius + CLEARANCE;
    // An unobstructed road-speed line is already the shortest, cheapest route.
    if (clearLine(nav, statics, dynamic, from, to, reach, 1)) return [to];
    const layer = navLayer(world.terrain, world.obstacles, radius);
    const start = cellOf(layer, from);
    const target = cellOf(layer, to);
    const { goal, cells } = search(layer, dynamic, radius, start, target);
    if (goal === null || !cells) return [to];
    const end = goal === target ? to : centerOf(layer, goal);
    const points: Vec[] = [];
    for (let i = 1; i < cells.length - 1; i++) points.push(centerOf(layer, cells[i]));
    points.push(end);
    return shortcut(nav, statics, dynamic, from, points, reach);
  });
}

// Cached cells are shared between calls and never handed out, so callers cannot mutate them.
function search(layer: NavLayer, dynamic: Blocker[], radius: number, start: number, target: number): { goal: number | null; cells: Int32Array | null } {
  const key = `${layer.id}:${radius}:${start}:${target}:${blockerKey(dynamic)}`;
  const hit = routeCache.get(key);
  if (hit) {
    count('route-cache-hit');
    routeCache.delete(key);
    routeCache.set(key, hit);
    return hit;
  }
  const overlay = stampOverlay(layer, dynamic, radius);
  const goal = nearestFreeCell(layer, overlay, target);
  const result = { goal, cells: goal === null ? null : findCells(layer, overlay, start, goal) };
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value!);
  routeCache.set(key, result);
  return result;
}

// Whether a vehicle can drive straight from a to b without touching an obstacle or a cliff.
export function straightClear(world: World, a: Vec, b: Vec, radius: number, extra: Blocker[]): boolean {
  const statics = staticSet(world.obstacles, world.terrain.size);
  return clearLine(terrainNav(world.terrain), statics, dynamicBlockers(world.obstacles, extra), a, b, radius + CLEARANCE, 0);
}

export function routeLength(from: Vec, points: Vec[]): number {
  let total = 0;
  let prev = from;
  for (const p of points) {
    total += dist(prev, p);
    prev = p;
  }
  return total;
}

function cellOf(l: NavLayer, p: Vec): number {
  const x = Math.min(l.n - 1, Math.max(0, Math.floor(p.x / CELL)));
  const y = Math.min(l.n - 1, Math.max(0, Math.floor(p.y / CELL)));
  return y * l.n + x;
}

function centerOf(l: NavLayer, c: number): Vec {
  return { x: ((c % l.n) + 0.5) * CELL, y: (Math.floor(c / l.n) + 0.5) * CELL };
}

// Probe progressively longer shortcuts instead of rescanning the entire remaining route at every bend.
// Each accepted segment still avoids obstacles, cliffs, and slower ground than its original path.
function shortcut(nav: TerrainNav, statics: StaticSet, dynamic: Blocker[], from: Vec, points: Vec[], reach: number): Vec[] {
  const out: Vec[] = [];
  let cur = from;
  let i = 0;
  while (i < points.length) {
    let best = i;
    let step = 1;
    let failed = points.length;
    while (best < points.length - 1) {
      const candidate = Math.min(i + step, points.length - 1);
      if (!clearLine(nav, statics, dynamic, cur, points[candidate], reach, slowestSpeed(nav, cur, points, i, candidate))) {
        failed = candidate;
        break;
      }
      best = candidate;
      step *= 2;
    }
    while (failed - best > 1) {
      const candidate = Math.floor((best + failed) / 2);
      if (clearLine(nav, statics, dynamic, cur, points[candidate], reach, slowestSpeed(nav, cur, points, i, candidate))) best = candidate;
      else failed = candidate;
    }
    out.push(points[best]);
    cur = points[best];
    i = best + 1;
  }
  return out;
}

const LINE_SAMPLES_PER_TILE = 4;

// Slowest terrain under cur and points[i..last].
function slowestSpeed(nav: TerrainNav, cur: Vec, points: Vec[], i: number, last: number): number {
  let min = nav.tileSpeed[tileIndex(nav.size, cur.x, cur.y)];
  for (let k = i; k <= last; k++) min = Math.min(min, nav.tileSpeed[tileIndex(nav.size, points[k].x, points[k].y)]);
  return min;
}

function clearLine(nav: TerrainNav, statics: StaticSet, dynamic: Blocker[], a: Vec, b: Vec, reach: number, minSpeed: number): boolean {
  for (const o of dynamic) if (segmentDist(o.pos, a, b) < o.r + reach) return false;
  for (const o of statics.buckets.alongSegment(a, b, reach)) if (segmentDist(o.pos, a, b) < o.r + reach) return false;
  const n = Math.ceil(dist(a, b) * LINE_SAMPLES_PER_TILE);
  const steps = Math.max(1, n);
  for (let k = 0; k <= n; k++) {
    const x = a.x + ((b.x - a.x) * k) / steps;
    const y = a.y + ((b.y - a.y) * k) / steps;
    if (nearCliff(nav, x, y, reach) || nav.tileSpeed[tileIndex(nav.size, x, y)] < minSpeed) return false;
  }
  return true;
}
