// Weighted A* and nearest-free search over a nav layer plus a dynamic overlay. All scratch memory is
// module-level and reused; generation stamps mark which entries belong to the current search, so
// nothing is cleared between calls.

import { REGION } from '../../data/region';
import { count } from '../../perf';
import type { Blocker } from './buckets';
import { CELL, COARSE, componentOf, stampCircles, tasted, type NavLayer, type Taste } from './layer';

// Cells blocked by kill wrecks and parked vehicles: stamp[c] === gen. Valid until the next stampOverlay.
export type Overlay = { stamp: Uint32Array; gen: number };

const overlay: Overlay = { stamp: new Uint32Array(0), gen: 0 };

export function stampOverlay(layer: NavLayer, blockers: Blocker[], radius: number): Overlay {
  const size = layer.n * layer.n;
  if (overlay.stamp.length !== size || overlay.gen === 0xffffffff) {
    overlay.stamp = new Uint32Array(size);
    overlay.gen = 0;
  }
  const gen = ++overlay.gen;
  const stamp = overlay.stamp;
  stampCircles(layer.n, blockers, radius, (c) => (stamp[c] = gen));
  return overlay;
}

// Search scratch, sized to the last grid. seen[c] === gen means cost[c] and from[c] hold this search's values.
let cost = new Float64Array(0);
let from = new Int32Array(0);
let seen = new Uint32Array(0);
let closed = new Uint32Array(0);
let queue = new Int32Array(0);
let gen = 0;

function begin(size: number): number {
  if (seen.length !== size || gen === 0xffffffff) {
    cost = new Float64Array(size);
    from = new Int32Array(size);
    seen = new Uint32Array(size);
    closed = new Uint32Array(size);
    queue = new Int32Array(size);
    gen = 0;
  }
  return ++gen;
}

// Breadth-first search to the closest cell free in both the layer and the overlay.
// With a component, only cells in that connected component count.
export function nearestFreeCell(layer: NavLayer, ov: Overlay, c: number, component: number | null = null): number | null {
  const n = layer.n;
  const g = begin(n * n);
  const blocked = layer.blocked;
  const stamp = ov.stamp;
  const og = ov.gen;
  let tail = 0;
  queue[tail++] = c;
  seen[c] = g;
  for (let i = 0; i < tail; i++) {
    const cur = queue[i];
    if (!blocked[cur] && stamp[cur] !== og && (component === null || componentOf(layer, cur) === component)) return cur;
    const x = cur % n;
    const y = Math.floor(cur / n);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const next = ny * n + nx;
        if (seen[next] === g) continue;
        seen[next] = g;
        queue[tail++] = next;
      }
  }
  return null;
}

// Binary min-heap in typed arrays; grows by doubling and keeps its memory between searches.
let heapItems = new Int32Array(1 << 16);
let heapKeys = new Float64Array(1 << 16);
let heapSize = 0;

function heapPush(item: number, key: number): void {
  if (heapSize === heapItems.length) {
    const items = new Int32Array(heapSize * 2);
    const keys = new Float64Array(heapSize * 2);
    items.set(heapItems);
    keys.set(heapKeys);
    heapItems = items;
    heapKeys = keys;
  }
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapKeys[p] <= key) break;
    heapItems[i] = heapItems[p];
    heapKeys[i] = heapKeys[p];
    i = p;
  }
  heapItems[i] = item;
  heapKeys[i] = key;
}

function heapPop(): number {
  const top = heapItems[0];
  const lastItem = heapItems[--heapSize];
  const lastKey = heapKeys[heapSize];
  if (heapSize > 0) {
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= heapSize) break;
      const right = left + 1;
      const child = right < heapSize && heapKeys[right] < heapKeys[left] ? right : left;
      if (heapKeys[child] >= lastKey) break;
      heapItems[i] = heapItems[child];
      heapKeys[i] = heapKeys[child];
      i = child;
    }
    heapItems[i] = lastItem;
    heapKeys[i] = lastKey;
  }
  return top;
}

// Octile distance in cells from (x, y) to (gx, gy).
function heuristic(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(x - gx);
  const dy = Math.abs(y - gy);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

// Searches whose ends lie farther apart than this many cells first find a coarse corridor. Shorter
// searches keep the exact full search.
const LONG_CELLS = 32;

// Cells from start to goal, both included. The start cell may be blocked when a vehicle hugs an
// obstacle; it is allowed as a start. Long searches stay inside the corridor of a coarse path plus
// one ring of blocks. Kill wrecks and parked vehicles are not in the coarse grid, so when they cut
// the corridor the full search runs. A taste multiplies step costs in both searches.
export function findCells(layer: NavLayer, ov: Overlay, start: number, goal: number, taste: Taste | null): Int32Array | null {
  if (start === goal) return Int32Array.of(start);
  // The overlay only blocks more cells, so separate static components can never join.
  if (!connected(layer, start, goal)) return null;
  const n = layer.n;
  if (heuristic(start % n, Math.floor(start / n), goal % n, Math.floor(goal / n)) > LONG_CELLS) {
    if (markCorridor(layer, start, goal, taste)) {
      const cells = fineSearch(layer, ov, start, goal, true, taste);
      if (cells) return cells;
    }
    count('route-corridor-miss');
  }
  return fineSearch(layer, ov, start, goal, false, taste);
}

// Whether a free goal shares a component with the start.
function connected(layer: NavLayer, start: number, goal: number): boolean {
  const target = componentOf(layer, goal);
  return target !== 0 && target === startComponent(layer, start);
}

// The start's connected component, or a free neighbour's for a blocked start. 0 when none is free.
export function startComponent(layer: NavLayer, start: number): number {
  const own = componentOf(layer, start);
  if (own !== 0) return own;
  const n = layer.n;
  const x = start % n;
  const y = Math.floor(start / n);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const c = componentOf(layer, ny * n + nx);
      if (c !== 0) return c;
    }
  return 0;
}

// Coarse search scratch, sized to the last region count. inCorridor[b] === corridorGen marks the
// blocks the fine search may enter.
let coarseCost = new Float64Array(0);
let coarseFrom = new Int32Array(0);
let coarseSeen = new Uint32Array(0);
let coarseClosed = new Uint32Array(0);
let coarseGen = 0;
let inCorridor = new Uint32Array(0);
let corridorGen = 0;

// A* over coarse regions from the start's region to the goal's. Marks the blocks of the path's
// regions and one ring of blocks around them. False when no coarse path exists.
function markCorridor(layer: NavLayer, start: number, goal: number, taste: Taste | null): boolean {
  const { n: bn, region, block, x: rx, y: ry, slow, edgeStart, edges } = layer.coarse;
  const regions = block.length;
  if (coarseSeen.length !== regions || coarseGen === 0xffffffff) {
    coarseCost = new Float64Array(regions);
    coarseFrom = new Int32Array(regions);
    coarseSeen = new Uint32Array(regions);
    coarseClosed = new Uint32Array(regions);
    coarseGen = 0;
  }
  if (inCorridor.length !== bn * bn || corridorGen === 0xffffffff) {
    inCorridor = new Uint32Array(bn * bn);
    corridorGen = 0;
  }
  const g = ++coarseGen;
  const from = startRegion(layer, start, goal);
  const to = region[goal];
  const w = REGION.navigation.heuristicWeight;
  const gx = rx[to];
  const gy = ry[to];
  heapSize = 0;
  coarseCost[from] = 0;
  coarseFrom[from] = -1;
  coarseSeen[from] = g;
  heapPush(from, heuristic(rx[from], ry[from], gx, gy) * w);
  while (heapSize > 0) {
    const cur = heapPop();
    if (cur === to) {
      const cg = ++corridorGen;
      for (let r = to; r !== -1; r = coarseFrom[r]) {
        const x = block[r] % bn;
        const y = Math.floor(block[r] / bn);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < bn && ny < bn) inCorridor[ny * bn + nx] = cg;
          }
      }
      return true;
    }
    if (coarseClosed[cur] === g) continue;
    coarseClosed[cur] = g;
    const base = coarseCost[cur];
    for (let e = edgeStart[cur]; e < edgeStart[cur + 1]; e++) {
      const next = edges[e];
      if (coarseClosed[next] === g) continue;
      const step = Math.hypot(rx[next] - rx[cur], ry[next] - ry[cur]) * ((slow[cur] + slow[next]) / 2);
      const c = base + tasted(taste, step, ((rx[cur] + rx[next]) / 2) * CELL, ((ry[cur] + ry[next]) / 2) * CELL);
      if (coarseSeen[next] === g && c >= coarseCost[next]) continue;
      coarseSeen[next] = g;
      coarseCost[next] = c;
      coarseFrom[next] = cur;
      heapPush(next, c + heuristic(rx[next], ry[next], gx, gy) * w);
    }
  }
  return false;
}

// The start's region, or for a blocked start the region of a free neighbour in the goal's component.
function startRegion(layer: NavLayer, start: number, goal: number): number {
  const region = layer.coarse.region;
  if (region[start] !== 0) return region[start];
  const n = layer.n;
  const x = start % n;
  const y = Math.floor(start / n);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const c = ny * n + nx;
      if (componentOf(layer, c) === componentOf(layer, goal)) return region[c];
    }
  throw new Error(`start cell ${start} has no free neighbour joined to goal ${goal}`);
}

// Weighted A* over the fine cells. With `corridor` set it enters only blocks the last markCorridor marked.
function fineSearch(layer: NavLayer, ov: Overlay, start: number, goal: number, corridor: boolean, taste: Taste | null): Int32Array | null {
  const n = layer.n;
  const g = begin(n * n);
  const blocked = layer.blocked;
  const slow = layer.slow;
  const stamp = ov.stamp;
  const og = ov.gen;
  const bn = layer.coarse.n;
  const cg = corridorGen;
  const w = REGION.navigation.heuristicWeight;
  const gx = goal % n;
  const gy = Math.floor(goal / n);
  heapSize = 0;
  cost[start] = 0;
  from[start] = -1;
  seen[start] = g;
  heapPush(start, heuristic(start % n, Math.floor(start / n), gx, gy) * w);
  while (heapSize > 0) {
    const cur = heapPop();
    if (cur === goal) return unwind(goal);
    if (closed[cur] === g) continue;
    closed[cur] = g;
    const x = cur % n;
    const y = Math.floor(cur / n);
    const base = cost[cur];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const next = ny * n + nx;
        if (blocked[next] || stamp[next] === og || closed[next] === g) continue;
        if (corridor && inCorridor[Math.floor(ny / COARSE) * bn + Math.floor(nx / COARSE)] !== cg) continue;
        const step = (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * slow[next];
        const c = base + tasted(taste, step, (nx + 0.5) * CELL, (ny + 0.5) * CELL);
        if (seen[next] === g && c >= cost[next]) continue;
        seen[next] = g;
        cost[next] = c;
        from[next] = cur;
        heapPush(next, c + heuristic(nx, ny, gx, gy) * w);
      }
  }
  return null;
}

function unwind(goal: number): Int32Array {
  let len = 1;
  for (let c = goal; from[c] !== -1; c = from[c]) len++;
  const out = new Int32Array(len);
  for (let c = goal, i = len - 1; i >= 0; c = from[c], i--) out[i] = c;
  return out;
}
