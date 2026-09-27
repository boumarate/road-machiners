// Route planning around static obstacles and cliffs: A* on a grid weighted by terrain speed and a
// cost for leaving the road, so routes prefer roads, then shortcut to visible corners. Moving vehicles are not in the
// grid, so ramming and blocking still happen. The grid itself lives in ./nav.

import { count, timed } from '../perf';
import { findCells, nearestFreeCell, stampOverlay, startComponent } from './nav/astar';
import type { Blocker } from './nav/buckets';
import { CELL, CLEARANCE, blockerKey, componentOf, dynamicBlockers, navLayer, nearCliff, staticSet, terrainNav, tileIndex, type NavLayer, type StaticSet, type TerrainNav } from './nav/layer';
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
    // An unobstructed line all on road is already the shortest, cheapest route.
    if (lineCost(nav, statics, dynamic, from, to, reach, 1) < Infinity) return [to];
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

// Builds the nav layers for these vehicle radii now, so the first turn or preview does not pay for them.
export function warmRoutes(world: World, radii: number[]): void {
  timed('warm-routes', () => {
    for (const r of radii) navLayer(world.terrain, world.obstacles, r);
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
  // A truck pushed into an obstacle's clearance past its neighbouring cells first drives out to the
  // nearest free cell. The start cell stays first, since route() drops it.
  const own = startComponent(layer, start);
  const exit = own === 0 ? nearestFreeCell(layer, overlay, start) : start;
  const component = exit === null ? 0 : own === 0 ? componentOf(layer, exit) : own;
  // An unreachable point, such as one beyond a cliff, routes to the closest point the truck can reach.
  const goal = exit === null || component === 0 ? null : nearestFreeCell(layer, overlay, target, component);
  const found = goal === null ? null : findCells(layer, overlay, exit!, goal);
  const result = { goal, cells: found && exit !== start ? Int32Array.of(start, ...found) : found };
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value!);
  routeCache.set(key, result);
  return result;
}

// Whether a vehicle can drive straight from a to b without touching an obstacle or a cliff.
export function straightClear(world: World, a: Vec, b: Vec, radius: number, extra: Blocker[]): boolean {
  const statics = staticSet(world.obstacles, world.terrain.size);
  return lineCost(terrainNav(world.terrain), statics, dynamicBlockers(world.obstacles, extra), a, b, radius + CLEARANCE, Infinity) < Infinity;
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
// Each accepted segment still avoids obstacles, cliffs and costlier ground than its original path, and
// costs no more than the path it replaces, so a shortcut never trades the road for open ground.
function shortcut(nav: TerrainNav, statics: StaticSet, dynamic: Blocker[], from: Vec, points: Vec[], reach: number): Vec[] {
  // along[j] is the route cost from `from` to points[j - 1]; along[0] is `from` itself.
  const along = new Float64Array(points.length + 1);
  for (let j = 0; j < points.length; j++) along[j + 1] = along[j] + groundCost(nav, j === 0 ? from : points[j - 1], points[j], null, Infinity);
  const out: Vec[] = [];
  let cur = from;
  let i = 0;
  const fits = (candidate: number) => lineCost(nav, statics, dynamic, cur, points[candidate], reach, costliestTile(nav, cur, points, i, candidate)) <= (along[candidate + 1] - along[i]) * (1 + COST_ROUNDING);
  while (i < points.length) {
    let best = i;
    let step = 1;
    let failed = points.length;
    while (best < points.length - 1) {
      const candidate = Math.min(i + step, points.length - 1);
      if (!fits(candidate)) {
        failed = candidate;
        break;
      }
      best = candidate;
      step *= 2;
    }
    while (failed - best > 1) {
      const candidate = Math.floor((best + failed) / 2);
      if (fits(candidate)) best = candidate;
      else failed = candidate;
    }
    out.push(points[best]);
    cur = points[best];
    i = best + 1;
  }
  return out;
}

const LINE_SAMPLES_PER_TILE = 4;
// Relative slack when a shortcut's cost is compared with the path it replaces. Summing the same
// segments in another order differs in the last bits, and a straight run must still count as equal.
const COST_ROUNDING = 1e-9;

// Costliest tile under cur and points[i..last].
function costliestTile(nav: TerrainNav, cur: Vec, points: Vec[], i: number, last: number): number {
  let max = nav.tileCost[tileIndex(nav.size, cur.x, cur.y)];
  for (let k = i; k <= last; k++) max = Math.max(max, nav.tileCost[tileIndex(nav.size, points[k].x, points[k].y)]);
  return max;
}

// Route cost of the straight line from a to b, or Infinity when it touches an obstacle or a cliff or
// crosses a tile costlier than maxCost.
function lineCost(nav: TerrainNav, statics: StaticSet, dynamic: Blocker[], a: Vec, b: Vec, reach: number, maxCost: number): number {
  for (const o of dynamic) if (segmentDist(o.pos, a, b) < o.r + reach) return Infinity;
  for (const o of statics.buckets.alongSegment(a, b, reach)) if (segmentDist(o.pos, a, b) < o.r + reach) return Infinity;
  return groundCost(nav, a, b, reach, maxCost);
}

// Length of the line times the mean tile cost of its samples. With a reach, a sample near a cliff
// makes it Infinity; so does a tile costlier than maxCost.
function groundCost(nav: TerrainNav, a: Vec, b: Vec, reach: number | null, maxCost: number): number {
  const length = dist(a, b);
  const n = Math.ceil(length * LINE_SAMPLES_PER_TILE);
  const steps = Math.max(1, n);
  let sum = 0;
  for (let k = 0; k <= n; k++) {
    const x = a.x + ((b.x - a.x) * k) / steps;
    const y = a.y + ((b.y - a.y) * k) / steps;
    if (reach !== null && nearCliff(nav, x, y, reach)) return Infinity;
    const cost = nav.tileCost[tileIndex(nav.size, x, y)];
    if (cost > maxCost) return Infinity;
    sum += cost;
  }
  return (length * sum) / (n + 1);
}
