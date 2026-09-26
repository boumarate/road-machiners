// Route planning around static obstacles and cliffs: A* on a grid weighted by terrain speed, so
// routes prefer roads over sand, then shortcut to visible corners. Vehicles are not in the grid,
// so ramming and blocking still happen.

import { TERRAIN_TYPES } from '../data/terrain';
import { REGION } from '../data/region';
import { isCliff, tileAt, type Terrain } from './terrain';
import { isDriveObstacle } from './mapgen';
import type { World } from './types';
import { dist, segmentDist, type Vec } from './vec';

const CELL = 0.5; // tiles per grid cell
const CLEARANCE = 0.4; // extra gap from obstacles on top of the vehicle radius; covers RULES.maxBulge

type Grid = { n: number; blocked: Uint8Array; slow: Float32Array }; // slow: step cost multiplier, 1 / terrain speed

// Grids depend only on the terrain, the obstacle set and the vehicle radius, so they are cached by content.
// A few radii times the current and previous obstacle sets fit well under this bound.
const gridCache = new Map<string, Grid>();
const GRID_CACHE_MAX = 16;

// Circles to route around on top of the map obstacles, such as parked vehicles.
export type Blocker = { pos: Vec; r: number };

export function route(world: World, from: Vec, to: Vec, radius: number, extra: Blocker[]): Vec[] {
  const blockers: Blocker[] = [...world.obstacles.filter(isDriveObstacle), ...extra];
  // An unobstructed road-speed line is already the shortest, cheapest route.
  if (clearLine(world.terrain, blockers, from, to, radius + CLEARANCE, 1)) return [to];
  const grid = gridFor(world.terrain, blockers, radius);
  const start = cellOf(grid, from);
  const goal = nearestFree(grid, cellOf(grid, to));
  if (goal === null) return [to];
  const cells = astar(grid, start, goal);
  if (!cells) return [to];
  const end = goal === cellOf(grid, to) ? to : centerOf(grid, goal);
  const points = [...cells.slice(1, -1).map((c) => centerOf(grid, c)), end];
  const result = shortcut(world.terrain, blockers, from, points, radius + CLEARANCE);
  return result;
}

// Whether a vehicle can drive straight from a to b without touching an obstacle or a cliff.
export function straightClear(world: World, a: Vec, b: Vec, radius: number, extra: Blocker[]): boolean {
  return clearLine(world.terrain, [...world.obstacles.filter(isDriveObstacle), ...extra], a, b, radius + CLEARANCE, 0);
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

// The terrain layer (cliffs and speeds) never changes in play, so it is cached apart from obstacles.
const terrainLayers = new Map<string, { cliff: Uint8Array; slow: Float32Array }>();

function terrainLayer(terrain: Terrain, radius: number, n: number): { cliff: Uint8Array; slow: Float32Array } {
  const key = `${terrainKey(terrain)}:${radius}`;
  const hit = terrainLayers.get(key);
  if (hit) return hit;
  if (terrainLayers.size >= GRID_CACHE_MAX) terrainLayers.clear();
  const cliff = new Uint8Array(n * n);
  const slow = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL };
      if (nearCliff(terrain, c, radius + CLEARANCE)) cliff[y * n + x] = 1;
      slow[y * n + x] = 1 / TERRAIN_TYPES[terrain.types[tileAt(terrain, c)]].speed;
    }
  }
  const layer = { cliff, slow };
  terrainLayers.set(key, layer);
  return layer;
}

function gridFor(terrain: Terrain, blockers: Blocker[], radius: number): Grid {
  const size = terrain.size;
  const key = `${terrainKey(terrain)}:${radius}:` + blockers.map((o) => `${o.pos.x.toFixed(2)},${o.pos.y.toFixed(2)},${o.r.toFixed(2)}`).join('|');
  const hit = gridCache.get(key);
  if (hit) return hit;
  if (gridCache.size >= GRID_CACHE_MAX) gridCache.clear();
  const n = Math.ceil(size / CELL);
  const layer = terrainLayer(terrain, radius, n);
  const blocked = layer.cliff.slice();
  for (const o of blockers) {
    const reach = o.r + radius + CLEARANCE;
    const lo = { x: Math.max(0, Math.floor((o.pos.x - reach) / CELL)), y: Math.max(0, Math.floor((o.pos.y - reach) / CELL)) };
    const hi = { x: Math.min(n - 1, Math.floor((o.pos.x + reach) / CELL)), y: Math.min(n - 1, Math.floor((o.pos.y + reach) / CELL)) };
    for (let x = lo.x; x <= hi.x; x++)
      for (let y = lo.y; y <= hi.y; y++)
        if (dist({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL }, o.pos) < reach) blocked[y * n + x] = 1;
  }
  const grid = { n, blocked, slow: layer.slow };
  gridCache.set(key, grid);
  return grid;
}

// Content signature of a terrain, memoized per object. Worlds are cloned each turn, so this runs
// once per clone, not once per route.
const terrainKeys = new WeakMap<Terrain, string>();

function terrainKey(t: Terrain): string {
  let key = terrainKeys.get(t);
  if (key === undefined) {
    let h = 2166136261;
    const mix = (n: number) => (h = Math.imul(h ^ n, 16777619));
    for (const v of t.heights) mix(Math.round(v * 1000));
    for (const ty of t.types) mix(ty.charCodeAt(0) * 31 + ty.length);
    key = `${t.size}:${h >>> 0}`;
    terrainKeys.set(t, key);
  }
  return key;
}

// A cliff tile within reach of the point, checked at the point and four compass offsets.
function nearCliff(t: Terrain, p: Vec, reach: number): boolean {
  const probes = [p, { x: p.x + reach, y: p.y }, { x: p.x - reach, y: p.y }, { x: p.x, y: p.y + reach }, { x: p.x, y: p.y - reach }];
  return probes.some((q) => isCliff(t, tileAt(t, q)));
}

function cellOf(g: Grid, p: Vec): number {
  const x = Math.min(g.n - 1, Math.max(0, Math.floor(p.x / CELL)));
  const y = Math.min(g.n - 1, Math.max(0, Math.floor(p.y / CELL)));
  return y * g.n + x;
}

function centerOf(g: Grid, c: number): Vec {
  return { x: ((c % g.n) + 0.5) * CELL, y: (Math.floor(c / g.n) + 0.5) * CELL };
}

// Breadth-first search to the closest unblocked cell.
function nearestFree(g: Grid, c: number): number | null {
  if (!g.blocked[c]) return c;
  const seen = new Uint8Array(g.n * g.n);
  const queue = [c];
  seen[c] = 1;
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (!g.blocked[cur]) return cur;
    for (const nb of neighbors(g, cur)) {
      if (!seen[nb.c]) {
        seen[nb.c] = 1;
        queue.push(nb.c);
      }
    }
  }
  return null;
}

function neighbors(g: Grid, c: number): { c: number; cost: number }[] {
  const x = c % g.n;
  const y = Math.floor(c / g.n);
  const out: { c: number; cost: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.n || ny >= g.n) continue;
      out.push({ c: ny * g.n + nx, cost: dx !== 0 && dy !== 0 ? Math.SQRT2 : 1 });
    }
  }
  return out;
}

// The start cell may be blocked when a vehicle hugs an obstacle; it is allowed as a start.
function astar(g: Grid, start: number, goal: number): number[] | null {
  const size = g.n * g.n;
  const cost = new Float64Array(size).fill(Infinity);
  const from = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();
  cost[start] = 0;
  open.push(start, heuristic(g, start, goal) * REGION.navigation.heuristicWeight);
  while (open.size() > 0) {
    const cur = open.pop();
    if (cur === goal) return unwind(from, goal);
    if (closed[cur]) continue;
    closed[cur] = 1;
    for (const nb of neighbors(g, cur)) {
      if (g.blocked[nb.c] || closed[nb.c]) continue;
      const c = cost[cur] + nb.cost * g.slow[nb.c];
      if (c >= cost[nb.c]) continue;
      cost[nb.c] = c;
      from[nb.c] = cur;
      open.push(nb.c, c + heuristic(g, nb.c, goal) * REGION.navigation.heuristicWeight);
    }
  }
  return null;
}

function heuristic(g: Grid, a: number, b: number): number {
  const dx = Math.abs((a % g.n) - (b % g.n));
  const dy = Math.abs(Math.floor(a / g.n) - Math.floor(b / g.n));
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function unwind(from: Int32Array, goal: number): number[] {
  const path = [goal];
  while (from[path[0]] !== -1) path.unshift(from[path[0]]);
  return path;
}

// Probe progressively longer shortcuts instead of rescanning the entire remaining route at every bend.
// Each accepted segment still avoids obstacles, cliffs, and slower ground than its original path.
function shortcut(t: Terrain, obstacles: Blocker[], from: Vec, points: Vec[], reach: number): Vec[] {
  const out: Vec[] = [];
  let cur = from;
  let i = 0;
  while (i < points.length) {
    let best = i;
    let step = 1;
    let failed = points.length;
    while (best < points.length - 1) {
      const candidate = Math.min(i + step, points.length - 1);
      if (!clearLine(t, obstacles, cur, points[candidate], reach, slowestSpeed(t, [cur, ...points.slice(i, candidate + 1)]))) {
        failed = candidate;
        break;
      }
      best = candidate;
      step *= 2;
    }
    while (failed - best > 1) {
      const candidate = Math.floor((best + failed) / 2);
      if (clearLine(t, obstacles, cur, points[candidate], reach, slowestSpeed(t, [cur, ...points.slice(i, candidate + 1)]))) best = candidate;
      else failed = candidate;
    }
    out.push(points[best]);
    cur = points[best];
    i = best + 1;
  }
  return out;
}

const LINE_SAMPLES_PER_TILE = 4;

function slowestSpeed(t: Terrain, pts: Vec[]): number {
  return Math.min(...pts.map((p) => TERRAIN_TYPES[t.types[tileAt(t, p)]].speed));
}

function clearLine(t: Terrain, obstacles: Blocker[], a: Vec, b: Vec, reach: number, minSpeed: number): boolean {
  if (!obstacles.every((o) => segmentDist(o.pos, a, b) >= o.r + reach)) return false;
  const n = Math.ceil(dist(a, b) * LINE_SAMPLES_PER_TILE);
  for (let k = 0; k <= n; k++) {
    const p = { x: a.x + ((b.x - a.x) * k) / Math.max(1, n), y: a.y + ((b.y - a.y) * k) / Math.max(1, n) };
    if (nearCliff(t, p, reach) || TERRAIN_TYPES[t.types[tileAt(t, p)]].speed < minSpeed) return false;
  }
  return true;
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.items.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
