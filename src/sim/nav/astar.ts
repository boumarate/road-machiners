// Weighted A* and nearest-free search over a nav layer plus a dynamic overlay. All scratch memory is
// module-level and reused; generation stamps mark which entries belong to the current search, so
// nothing is cleared between calls.

import { REGION } from '../../data/region';
import type { Blocker } from './buckets';
import { stampCircles, type NavLayer } from './layer';

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
export function nearestFreeCell(layer: NavLayer, ov: Overlay, c: number): number | null {
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
    if (!blocked[cur] && stamp[cur] !== og) return cur;
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

// Cells from start to goal, both included. The start cell may be blocked when a vehicle hugs an
// obstacle; it is allowed as a start.
export function findCells(layer: NavLayer, ov: Overlay, start: number, goal: number): Int32Array | null {
  const n = layer.n;
  const g = begin(n * n);
  const blocked = layer.blocked;
  const slow = layer.slow;
  const stamp = ov.stamp;
  const og = ov.gen;
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
        const c = base + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * slow[next];
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
