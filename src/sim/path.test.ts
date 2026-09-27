import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { resolveMovement } from './movement';
import { TERRAIN_TYPES } from '../data/terrain';
import { resetPerf, perfSnapshot } from '../perf';
import { isDriveObstacle } from './mapgen';
import { findCells, nearestFreeCell, stampOverlay } from './nav/astar';
import { COARSE, componentOf, dynamicBlockers, navLayer } from './nav/layer';
import { route, routeLength, straightClear, type Blocker } from './path';
import { nextRandom } from './rng';
import { isCliff, tileAt, type Terrain } from './terrain';
import type { World } from './types';
import { locationAt } from './sites';
import { emptyWorld } from './testkit';
import { dist, segmentDist, type Vec } from './vec';
import { endTurn, newWorld, setMoveOrder } from './world';

describe("route", () => {
  it("goes straight when nothing is in the way", () => {
    const w = emptyWorld();
    expect(route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, [])).toEqual([
      { x: 40, y: 30 },
    ]);
  });

  it("bends around a rock in the way, keeping clear of it", () => {
    const w = emptyWorld();
    w.obstacles = [{ id: "r", pos: { x: 35, y: 30 }, r: 1.2, kind: "rock" }];
    const pts = route(w, { x: 30, y: 30 }, { x: 40, y: 30 }, 0.6, []);
    expect(pts.length).toBeGreaterThan(1);
    let prev = { x: 30, y: 30 };
    for (const p of pts) {
      expect(segmentDist(w.obstacles[0].pos, prev, p)).toBeGreaterThanOrEqual(
        1.2 + 0.6,
      );
      prev = p;
    }
  });

  it("a truck drives around a rock wall without crashing", () => {
    const w = emptyWorld();
    w.obstacles = [0, 1, 2, 3].map((i) => ({
      id: `r${i}`,
      pos: { x: 34, y: 28 + i * 1.5 },
      r: 0.8,
      kind: "rock" as const,
    }));
    w.vehicles[0].order = { kind: "stopAt", dest: { x: 40, y: 30 } };
    for (let i = 0; i < 12 && w.vehicles[0].order; i++) {
      w.events = [];
      resolveMovement(w);
      expect(w.events.filter((e) => e.t === "collision")).toEqual([]);
    }
    expect(dist(w.vehicles[0].pos, { x: 40, y: 30 })).toBeLessThan(0.5);
  });

  it('town buildings fit inside the blocked site instead of the road', () => {
    const w = newWorld(1337, START_KITS.standard);
    for (const town of REGION.towns) {
      const buildings = w.obstacles.filter((o) => o.kind === 'building' && o.id.startsWith(`bld-${town.id}-`));
      expect(buildings.length).toBeGreaterThan(0);
      for (const building of buildings) expect(dist(building.pos, town.pos) + building.r).toBeLessThanOrEqual(town.radius);
    }
  });

  it('sites block driving but permit interaction from their edge', () => {
    const w = newWorld(1337, START_KITS.standard);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    const site = REGION.locations.find((l) => l.kind === 'oasis')!;
    const v = w.vehicles[0];
    v.pos = { x: site.pos.x + site.radius + 2, y: site.pos.y };
    v.heading = Math.PI;
    v.speed = 3;
    v.order = { kind: 'through', dest: site.pos };
    v.direct = true;
    resolveMovement(w);
    expect(dist(v.pos, site.pos)).toBeGreaterThanOrEqual(site.radius + 0.6 - 0.02);
    expect(w.events.some((e) => e.t === 'collision' && e.b === `site-${site.id}`)).toBe(true);
    expect(locationAt(w)?.id).toBe(site.id);
  });

  it('the player drives from Bowl to Nose without hitting static obstacles', () => {
    const nose = REGION.towns.find((t) => t.id === 'nose')!;
    let w = setMoveOrder(newWorld(1337, START_KITS.standard), { kind: 'stopAt', dest: nose.pos });
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    w.player.fuel = 100;
    const me = w.player.vehicleId;
    for (let i = 0; i < w.size && dist(w.vehicles[0].pos, nose.pos) > nose.radius + 1.5; i++) {
      w = endTurn(w);
      w.vehicles = w.vehicles.filter((v) => v.faction === "player");
      w.player.engineHeat = 0; // this drive never stops to cool down
      const staticHits = w.events.filter(
        (e) => e.t === "collision" && e.a === me && !e.b.startsWith("v"),
      );
      expect(staticHits).toEqual([]);
    }
    expect(dist(w.vehicles[0].pos, nose.pos)).toBeGreaterThanOrEqual(nose.radius + 0.6 - 0.02);
    expect(dist(w.vehicles[0].pos, nose.pos)).toBeLessThanOrEqual(nose.radius + 1.5);
  }, 120_000);
});

// The grid rules before the nav layers, kept as a reference: cliff probes, obstacle stamping,
// weighted A*, nearest free cell and shortcuts. New routes must match them.
namespace Ref {
  export const CELL = 0.5;
  export const CLEARANCE = 0.4;
  export type Grid = { n: number; blocked: Uint8Array; slow: Float32Array };

  function nearCliff(t: Terrain, p: Vec, reach: number): boolean {
    const probes = [p, { x: p.x + reach, y: p.y }, { x: p.x - reach, y: p.y }, { x: p.x, y: p.y + reach }, { x: p.x, y: p.y - reach }];
    return probes.some((q) => isCliff(t, tileAt(t, q)));
  }

  export function terrainLayer(t: Terrain, radius: number): { n: number; cliff: Uint8Array; slow: Float32Array } {
    const n = Math.ceil(t.size / CELL);
    const cliff = new Uint8Array(n * n);
    const slow = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL };
        if (nearCliff(t, c, radius + CLEARANCE)) cliff[y * n + x] = 1;
        slow[y * n + x] = 1 / TERRAIN_TYPES[t.types[tileAt(t, c)]].speed;
      }
    return { n, cliff, slow };
  }

  export function grid(layer: { n: number; cliff: Uint8Array; slow: Float32Array }, blockers: Blocker[], radius: number): Grid {
    const n = layer.n;
    const blocked = layer.cliff.slice();
    for (const o of blockers) {
      const reach = o.r + radius + CLEARANCE;
      const lo = { x: Math.max(0, Math.floor((o.pos.x - reach) / CELL)), y: Math.max(0, Math.floor((o.pos.y - reach) / CELL)) };
      const hi = { x: Math.min(n - 1, Math.floor((o.pos.x + reach) / CELL)), y: Math.min(n - 1, Math.floor((o.pos.y + reach) / CELL)) };
      for (let x = lo.x; x <= hi.x; x++)
        for (let y = lo.y; y <= hi.y; y++) if (dist({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL }, o.pos) < reach) blocked[y * n + x] = 1;
    }
    return { n, blocked, slow: layer.slow };
  }

  export function cellOf(g: Grid, p: Vec): number {
    return Math.min(g.n - 1, Math.max(0, Math.floor(p.y / CELL))) * g.n + Math.min(g.n - 1, Math.max(0, Math.floor(p.x / CELL)));
  }

  export function centerOf(g: Grid, c: number): Vec {
    return { x: ((c % g.n) + 0.5) * CELL, y: (Math.floor(c / g.n) + 0.5) * CELL };
  }

  function neighbors(g: Grid, c: number): number[] {
    const x = c % g.n;
    const y = Math.floor(c / g.n);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx !== 0 || dy !== 0) && nx >= 0 && ny >= 0 && nx < g.n && ny < g.n) out.push(ny * g.n + nx);
      }
    return out;
  }

  export function nearestFree(g: Grid, c: number): number | null {
    const seen = new Uint8Array(g.n * g.n);
    const queue = [c];
    seen[c] = 1;
    for (let i = 0; i < queue.length; i++) {
      if (!g.blocked[queue[i]]) return queue[i];
      for (const nb of neighbors(g, queue[i]))
        if (!seen[nb]) {
          seen[nb] = 1;
          queue.push(nb);
        }
    }
    return null;
  }

  function heuristic(g: Grid, a: number, b: number): number {
    const dx = Math.abs((a % g.n) - (b % g.n));
    const dy = Math.abs(Math.floor(a / g.n) - Math.floor(b / g.n));
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  }

  // A plain binary heap; ties may pop in any order, so only the path cost is compared.
  export function astar(g: Grid, start: number, goal: number): number[] | null {
    const cost = new Float64Array(g.n * g.n).fill(Infinity);
    const from = new Int32Array(g.n * g.n).fill(-1);
    const closed = new Uint8Array(g.n * g.n);
    const heap: [number, number][] = [];
    const push = (item: number, key: number) => {
      heap.push([item, key]);
      for (let i = heap.length - 1; i > 0; ) {
        const p = (i - 1) >> 1;
        if (heap[p][1] <= heap[i][1]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          if (l >= heap.length) break;
          const c = l + 1 < heap.length && heap[l + 1][1] < heap[l][1] ? l + 1 : l;
          if (heap[c][1] >= heap[i][1]) break;
          [heap[c], heap[i]] = [heap[i], heap[c]];
          i = c;
        }
      }
      return top[0];
    };
    cost[start] = 0;
    push(start, heuristic(g, start, goal) * REGION.navigation.heuristicWeight);
    while (heap.length > 0) {
      const cur = pop();
      if (cur === goal) {
        const path = [goal];
        while (from[path[0]] !== -1) path.unshift(from[path[0]]);
        return path;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const next of neighbors(g, cur)) {
        if (g.blocked[next] || closed[next]) continue;
        const diag = next % g.n !== cur % g.n && Math.floor(next / g.n) !== Math.floor(cur / g.n);
        const c = cost[cur] + (diag ? Math.SQRT2 : 1) * g.slow[next];
        if (c >= cost[next]) continue;
        cost[next] = c;
        from[next] = cur;
        push(next, c + heuristic(g, next, goal) * REGION.navigation.heuristicWeight);
      }
    }
    return null;
  }

  export function pathCost(g: Grid, cells: ArrayLike<number>): number {
    let total = 0;
    for (let i = 1; i < cells.length; i++) {
      const diag = cells[i] % g.n !== cells[i - 1] % g.n && Math.floor(cells[i] / g.n) !== Math.floor(cells[i - 1] / g.n);
      total += (diag ? Math.SQRT2 : 1) * g.slow[cells[i]];
    }
    return total;
  }

  export function clearLine(t: Terrain, obstacles: Blocker[], a: Vec, b: Vec, reach: number, minSpeed: number): boolean {
    if (!obstacles.every((o) => segmentDist(o.pos, a, b) >= o.r + reach)) return false;
    const n = Math.ceil(dist(a, b) * 4);
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / Math.max(1, n), y: a.y + ((b.y - a.y) * k) / Math.max(1, n) };
      if (nearCliff(t, p, reach) || TERRAIN_TYPES[t.types[tileAt(t, p)]].speed < minSpeed) return false;
    }
    return true;
  }

  function slowestSpeed(t: Terrain, pts: Vec[]): number {
    return Math.min(...pts.map((p) => TERRAIN_TYPES[t.types[tileAt(t, p)]].speed));
  }

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

  export function route(w: World, layer: ReturnType<typeof terrainLayer>, from: Vec, to: Vec, radius: number, extra: Blocker[]): Vec[] {
    const all = blockers(w, extra);
    if (clearLine(w.terrain, all, from, to, radius + CLEARANCE, 1)) return [to];
    const g = grid(layer, all, radius);
    const start = cellOf(g, from);
    const goal = nearestFree(g, cellOf(g, to));
    if (goal === null) return [to];
    const cells = astar(g, start, goal);
    if (!cells) return [to];
    const end = goal === cellOf(g, to) ? to : centerOf(g, goal);
    return shortcut(w.terrain, all, from, [...cells.slice(1, -1).map((c) => centerOf(g, c)), end], radius + CLEARANCE);
  }

  export function blockers(w: World, extra: Blocker[]): Blocker[] {
    return [...w.obstacles.filter(isDriveObstacle), ...extra];
  }
}

// Searches whose ends lie farther apart than this many cells go through the coarse corridor.
const LONG_CELLS = 32;

function cellSpan(n: number, a: number, b: number): number {
  const dx = Math.abs((a % n) - (b % n));
  const dy = Math.abs(Math.floor(a / n) - Math.floor(b / n));
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function mulberry(seed: number): () => number {
  const r = { rngState: seed };
  return () => nextRandom(r);
}

describe('nav layers match the old grid rules', () => {
  const w = newWorld(1, START_KITS.standard);
  const rand = mulberry(7);
  const at = (lo: number, hi: number) => lo + (hi - lo) * rand();
  // Kill wrecks come and go in play; they must block like any other obstacle.
  for (let i = 0; i < 4; i++) w.obstacles.push({ id: `wreck-t${i}`, pos: { x: at(40, w.size - 40), y: at(40, w.size - 40) }, r: 1, kind: 'wreck' });
  const pairs = Array.from({ length: 30 }, (_, i) => {
    const from = { x: at(5, w.size - 5), y: at(5, w.size - 5) };
    // Half the pairs are short, so straight lines are often clear; the rest cross the map.
    const reach = i % 2 === 0 ? 30 : w.size;
    const to = { x: Math.min(w.size - 5, Math.max(5, from.x + at(-reach, reach))), y: Math.min(w.size - 5, Math.max(5, from.y + at(-reach, reach))) };
    // A parked vehicle halfway along forces a detour around a blocker outside the map obstacles.
    const extra: Blocker[] = [{ pos: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, r: 0.9 }];
    return { from, to, extra, radius: i % 3 === 0 ? 0.8 : 0.6 };
  });
  const refLayers = new Map<number, ReturnType<typeof Ref.terrainLayer>>();
  const refLayer = (radius: number) => {
    if (!refLayers.has(radius)) refLayers.set(radius, Ref.terrainLayer(w.terrain, radius));
    return refLayers.get(radius)!;
  };

  it('A* cells avoid every blocked cell and cost within 1% of the reference', () => {
    let searched = 0;
    for (const { from, to, extra, radius } of pairs) {
      const g = Ref.grid(refLayer(radius), Ref.blockers(w, extra), radius);
      const start = Ref.cellOf(g, from);
      const goal = Ref.nearestFree(g, Ref.cellOf(g, to));
      const layer = navLayer(w.terrain, w.obstacles, radius);
      expect(layer.n).toBe(g.n);
      const overlay = stampOverlay(layer, dynamicBlockers(w.obstacles, extra), radius);
      expect(nearestFreeCell(layer, overlay, Ref.cellOf(g, to))).toBe(goal);
      if (goal === null) continue;
      const ref = Ref.astar(g, start, goal);
      const got = findCells(layer, overlay, start, goal);
      expect(got === null).toBe(ref === null);
      if (!ref || !got) continue;
      searched++;
      expect(got[0]).toBe(start);
      expect(got[got.length - 1]).toBe(goal);
      for (let i = 1; i < got.length; i++) expect(g.blocked[got[i]]).toBe(0);
      // Long searches run inside a coarse corridor and may cost up to 5% more; short ones stay within 1%.
      const tolerance = cellSpan(g.n, start, goal) > LONG_CELLS ? 0.05 : 0.01;
      expect(Ref.pathCost(g, got) - Ref.pathCost(g, ref)).toBeLessThanOrEqual(tolerance * Ref.pathCost(g, ref));
      if (tolerance === 0.01) expect(Ref.pathCost(g, ref) - Ref.pathCost(g, got)).toBeLessThanOrEqual(0.01 * Ref.pathCost(g, ref));
    }
    // Random points often land in closed cliff basins; half the pairs still need a real search.
    expect(searched).toBeGreaterThanOrEqual(12);
  }, 60_000);

  it('straightClear equals the reference line check', () => {
    let clear = 0;
    for (const { from, to, extra, radius } of pairs) {
      const expected = Ref.clearLine(w.terrain, Ref.blockers(w, extra), from, to, radius + Ref.CLEARANCE, 0);
      expect(straightClear(w, from, to, radius, extra)).toBe(expected);
      // Without the parked vehicle in the middle, short lines are often clear.
      const open = Ref.clearLine(w.terrain, Ref.blockers(w, []), from, to, radius + Ref.CLEARANCE, 0);
      expect(straightClear(w, from, to, radius, [])).toBe(open);
      if (open) clear++;
    }
    expect(clear).toBeGreaterThan(0);
  });

  it('routes equal the reference and repeat routes come from the cache', () => {
    resetPerf();
    for (const { from, to, extra, radius } of pairs) {
      const first = route(w, from, to, radius, extra);
      const again = route(w, from, to, radius, extra);
      expect(again).toEqual(first);
      first[0] = { x: -1, y: -1 };
      expect(route(w, from, to, radius, extra)).toEqual(again);
      const ref = Ref.route(w, refLayer(radius), from, to, radius, extra);
      const n = refLayer(radius).n;
      const cell = (p: Vec) => Math.min(n - 1, Math.floor(p.y / Ref.CELL)) * n + Math.min(n - 1, Math.floor(p.x / Ref.CELL));
      if (cellSpan(n, cell(from), cell(to)) <= LONG_CELLS) {
        expect(again).toEqual(ref);
        continue;
      }
      // Corridor routes may take other bends; they end at the same point and stay near the reference length.
      expect(again[again.length - 1]).toEqual(ref[ref.length - 1]);
      expect(routeLength(from, again)).toBeLessThanOrEqual(1.05 * routeLength(from, ref));
    }
    expect(perfSnapshot()['route-cache-hit'].calls).toBeGreaterThan(0);
  }, 60_000);

  it('a new kill wreck changes the route without rebuilding the static layer', () => {
    const a = { x: 30, y: 30 };
    const b = { x: 50, y: 30 };
    const flat = emptyWorld(a);
    const layer = navLayer(flat.terrain, flat.obstacles, 0.6);
    expect(route(flat, a, b, 0.6, [])).toEqual([b]);
    flat.obstacles = [...flat.obstacles, { id: 'wreck-x', pos: { x: 40, y: 30 }, r: 1.2, kind: 'wreck' }];
    const around = route(flat, a, b, 0.6, []);
    expect(around.length).toBeGreaterThan(1);
    expect(navLayer(flat.terrain, flat.obstacles, 0.6)).toBe(layer);
  });
});

describe('long routes search a coarse corridor', () => {
  it('coarse regions are the connected pieces of each block, linked where their cells touch', () => {
    const w = newWorld(1, START_KITS.standard);
    const layer = navLayer(w.terrain, w.obstacles, 0.6);
    const n = layer.n;
    const { n: bn, region, block, slow, edgeStart, edges } = layer.coarse;
    expect(bn).toBe(Math.ceil(n / COARSE));
    const blockOfCell = (x: number, y: number) => Math.floor(y / COARSE) * bn + Math.floor(x / COARSE);
    const linked = (a: number, b: number) => edges.subarray(edgeStart[a], edgeStart[a + 1]).includes(b);
    const slowSum = new Float64Array(block.length);
    const size = new Uint32Array(block.length);
    // Counted, not asserted per cell: a million expect calls take half a minute.
    let wrong = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = y * n + x;
        const r = region[c];
        if ((r === 0) !== (layer.blocked[c] === 1)) wrong++;
        if (r === 0) continue;
        if (block[r] !== blockOfCell(x, y)) wrong++;
        slowSum[r] += layer.slow[c];
        size[r]++;
        for (const [dx, dy] of [[1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= n || ny >= n) continue;
          const o = region[ny * n + nx];
          if (o === 0) continue;
          // Touching free cells share a region inside a block and are linked across block edges.
          if (blockOfCell(nx, ny) === blockOfCell(x, y)) {
            if (o !== r) wrong++;
          } else if (o !== r && !(linked(r, o) && linked(o, r))) wrong++;
        }
      }
    expect(wrong).toBe(0);
    for (let r = 1; r < block.length; r++) expect(slow[r]).toBeCloseTo(slowSum[r] / size[r], 5);
    // Cliff ridges split some blocks into several regions.
    expect(block.length - 1).toBeGreaterThan(new Set(block.subarray(1)).size);
  });

  it('free cells share a component exactly when a step path joins them', () => {
    const w = emptyWorld();
    // A closed ring of rocks splits the flat map into inside and outside.
    const center = { x: 100, y: 100 };
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      w.obstacles.push({ id: `ring-${i}`, pos: { x: center.x + 10 * Math.cos(a), y: center.y + 10 * Math.sin(a) }, r: 1, kind: 'rock' });
    }
    const layer = navLayer(w.terrain, w.obstacles, 0.6);
    const n = layer.n;
    const cell = (p: Vec) => Math.floor(p.y / 0.5) * n + Math.floor(p.x / 0.5);
    const inside = cell(center);
    const outside = cell({ x: 30, y: 30 });
    const far = cell({ x: 500, y: 400 });
    expect(layer.blocked[inside]).toBe(0);
    expect(componentOf(layer, inside)).not.toBe(componentOf(layer, outside));
    expect(componentOf(layer, outside)).toBe(componentOf(layer, far));
    let blockedWithComponent = 0;
    for (let c = 0; c < n * n; c++) if (layer.blocked[c] && componentOf(layer, c) !== 0) blockedWithComponent++;
    expect(blockedWithComponent).toBe(0);
  });

  it('unreachable goals return null in under 5 ms, like the full search', () => {
    const w = newWorld(1, START_KITS.standard);
    // A spot with no cliff tile near it, so the ring alone decides reachability.
    const flatAround = (p: Vec) => {
      for (let y = p.y - 14; y <= p.y + 14; y++) for (let x = p.x - 14; x <= p.x + 14; x++) if (isCliff(w.terrain, tileAt(w.terrain, { x, y }))) return false;
      return true;
    };
    const center = Array.from({ length: 25 * 25 }, (_, i) => ({ x: 60 + (i % 25) * 20, y: 60 + Math.floor(i / 25) * 20 })).find(flatAround)!;
    expect(center).toBeDefined();
    const obstacles = w.obstacles.filter((o) => dist(o.pos, center) > 14);
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      obstacles.push({ id: `ring-${i}`, pos: { x: center.x + 10 * Math.cos(a), y: center.y + 10 * Math.sin(a) }, r: 1, kind: 'rock' });
    }
    w.obstacles = obstacles;
    const radius = 0.6;
    const layer = navLayer(w.terrain, w.obstacles, radius);
    const overlay = stampOverlay(layer, dynamicBlockers(w.obstacles, []), radius);
    const g = Ref.grid(Ref.terrainLayer(w.terrain, radius), Ref.blockers(w, []), radius);
    const goal = Ref.cellOf(g, center);
    const from = { x: 40, y: 40 };
    const start = nearestFreeCell(layer, overlay, Ref.cellOf(g, from))!;
    expect(g.blocked[goal]).toBe(0);
    expect(Ref.astar(g, start, goal)).toBeNull();
    const t = performance.now();
    const got = findCells(layer, overlay, start, goal);
    const ms = performance.now() - t;
    expect(got).toBeNull();
    expect(ms).toBeLessThan(5);
  }, 60_000);

  it('a corridor cut by a kill wreck wall falls back to the full search', () => {
    const w = emptyWorld();
    // Wrecks are not in the static layer, so the coarse path runs straight through the wall.
    for (let y = 16; y < w.size; y += 1.5) w.obstacles.push({ id: `wreck-w${y}`, pos: { x: 80, y }, r: 1, kind: 'wreck' });
    const radius = 0.6;
    const layer = navLayer(w.terrain, w.obstacles, radius);
    const overlay = stampOverlay(layer, dynamicBlockers(w.obstacles, []), radius);
    const n = layer.n;
    const start = 200 * n + 60;
    const goal = 200 * n + 260;
    resetPerf();
    const got = findCells(layer, overlay, start, goal);
    expect(perfSnapshot()['route-corridor-miss']?.calls).toBe(1);
    expect(got).not.toBeNull();
    expect(got![got!.length - 1]).toBe(goal);
    for (const c of got!) expect(layer.blocked[c] === 0 && overlay.stamp[c] !== overlay.gen).toBe(true);
    // The only way round is the gap under the wall.
    expect(Math.min(...Array.from(got!, (c) => Math.floor(c / n)))).toBeLessThan(32);
  });

  it('long routes with no dynamic blockers never miss the corridor', () => {
    const w = newWorld(1, START_KITS.standard);
    const rand = mulberry(11);
    const radius = 0.8;
    const layer = navLayer(w.terrain, w.obstacles, radius);
    const overlay = stampOverlay(layer, [], radius);
    const n = layer.n;
    resetPerf();
    let found = 0;
    for (let i = 0; i < 20; i++) {
      const a = nearestFreeCell(layer, overlay, Math.floor(rand() * n * n))!;
      const b = nearestFreeCell(layer, overlay, Math.floor(rand() * n * n))!;
      if (componentOf(layer, a) !== componentOf(layer, b) || cellSpan(n, a, b) <= LONG_CELLS) continue;
      expect(findCells(layer, overlay, a, b)).not.toBeNull();
      found++;
    }
    expect(found).toBeGreaterThanOrEqual(5);
    // Without kill wrecks or parked vehicles a chain of linked regions always holds a fine path.
    expect(perfSnapshot()['route-corridor-miss']).toBeUndefined();
  }, 60_000);
});
