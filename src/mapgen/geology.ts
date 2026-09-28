// The geology layer of the map bake: rain, slump and wind over the draft's corner grid. Each rule is its
// own function over typed arrays, so a test can run it alone on a small grid. Rules never read roads or
// sites; the finish layer grades roads over the result.

import { GEOLOGY } from "../data/terrain";
import type { RainRules, SandStart, SlumpRules, WindRules } from "../data/terrain";
import { chance, nextRandom } from "../sim/rng";
import type { Rng } from "../sim/rng";
import type { MapDraft } from "./bake";

// Fills d.flow, d.slumped and d.sand and changes d.heights. Wind draws from its own rng keyed by the map
// seed, so the same seed and draft always give the same result.
export function geologyLayer(seed: number, d: MapDraft): MapDraft {
  seedSand(d, GEOLOGY.sandStart);
  let t = performance.now();
  const rainOut = rain(d, GEOLOGY.rain);
  t = logRule("rain", t, `${rainOut.toFixed(1)} units of soil off the edge`);
  slump(d, GEOLOGY.slump);
  t = logRule("slump", t, "");
  const windOut = wind(d, GEOLOGY.wind, { rngState: seed });
  logRule("wind", t, `${windOut.toFixed(1)} units of sand off the edge`);
  return d;
}

// Start sand thickens from nothing at `below` to full depth `fade` units lower.
function seedSand(d: MapDraft, start: SandStart): void {
  for (let k = 0; k < d.heights.length; k++) {
    const share = Math.min(1, Math.max(0, (start.below - d.heights[k]) / start.fade));
    d.sand[k] = start.depth * share;
  }
}

function logRule(name: string, since: number, note: string): number {
  const now = performance.now();
  console.log(`geology ${name}: ${((now - since) / 1000).toFixed(2)} s ${note}`.trimEnd());
  return now;
}

// The 8 neighbors of a corner on a grid of n x n corners, as index offsets with the inverse distance in
// tiles. Rules visit only interior corners, so every offset stays inside the grid without bound checks.
type Neighbors = { offsets: Int32Array; invDist: Float64Array };

function cornerNeighbors(n: number): Neighbors {
  const d = Math.SQRT1_2;
  return {
    offsets: Int32Array.of(-1, 1, -n, n, -n - 1, -n + 1, n - 1, n + 1),
    invDist: Float64Array.of(1, 1, 1, 1, d, d, d, d),
  };
}

function isInterior(k: number, n: number): boolean {
  const i = k % n;
  const j = (k - i) / n;
  return i > 0 && j > 0 && i < n - 1 && j < n - 1;
}

// Rain: grid hydraulic erosion. Each step rain falls on every corner, and the water runs downhill in one
// pass from the highest corner to the lowest, so every corner sees all the water from above it. Water
// splits between lower neighbors by a power of their slope, so it gathers into lines. A share of it
// evaporates at each corner it passes. Soil is picked up while the water carries less than its capacity,
// which grows with slope and water, and dropped above it. A corner with no lower neighbor is a pool and
// keeps all soil that reaches it. Edge corners drain off the map, and the soil they receive leaves too.


type RainGrid = {
  n: number;
  nb: Neighbors;
  height: Float64Array;
  water: Float64Array; // water reaching each corner in the current step
  soil: Float64Array; // soil carried by that water
  order: Uint32Array; // corners from highest to lowest
  weights: Float64Array; // scratch: share weight of each neighbor of the current corner
  steepest: number; // scratch: steepest slope down from the current corner, units per tile
  flow: Float32Array;
  outflow: number;
};

// Runs every rain step on the draft and adds the water that passed each corner to d.flow. Returns the
// soil carried off the map edge, in height units summed over corners, so the total height before
// equals the total height after plus this.
export function rain(d: MapDraft, rules: RainRules): number {
  const g = newRainGrid(d);
  for (let s = 0; s < rules.steps; s++) {
    sortByHeight(g);
    g.water.fill(rules.rainPerStep);
    g.soil.fill(0);
    for (const k of g.order) route(g, k, rules);
  }
  for (let k = 0; k < g.height.length; k++) d.heights[k] = g.height[k];
  return g.outflow;
}

function newRainGrid(d: MapDraft): RainGrid {
  const n = d.size + 1;
  const count = n * n;
  const order = new Uint32Array(count);
  for (let k = 0; k < count; k++) order[k] = k;
  return {
    n,
    nb: cornerNeighbors(n),
    height: Float64Array.from(d.heights),
    water: new Float64Array(count),
    soil: new Float64Array(count),
    order,
    weights: new Float64Array(8),
    steepest: 0,
    flow: d.flow,
    outflow: 0,
  };
}

// Ties go to the lower index, so the order and the result depend only on the heights.
function sortByHeight(g: RainGrid): void {
  const h = g.height;
  g.order.sort((a, b) => h[b] - h[a] || a - b);
}

function route(g: RainGrid, k: number, rules: RainRules): void {
  g.flow[k] += g.water[k];
  if (!isInterior(k, g.n)) {
    g.outflow += g.soil[k];
    return;
  }
  const total = weighLowerNeighbors(g, k, rules.focusSquarings);
  if (total === 0) {
    g.height[k] += g.soil[k];
    return;
  }
  const water = g.water[k] * (1 - rules.evaporation);
  const soil = erode(g, k, water, rules);
  const { offsets } = g.nb;
  for (let q = 0; q < 8; q++) {
    const share = g.weights[q] / total;
    g.water[k + offsets[q]] += water * share;
    g.soil[k + offsets[q]] += soil * share;
  }
}

// Fills g.weights with the slope to each lower neighbor squared `squarings` times and returns their sum.
function weighLowerNeighbors(g: RainGrid, k: number, squarings: number): number {
  const { offsets, invDist } = g.nb;
  const h = g.height[k];
  let total = 0;
  let steepest = 0;
  for (let q = 0; q < 8; q++) {
    const slope = Math.max(0, (h - g.height[k + offsets[q]]) * invDist[q]);
    let weight = slope;
    for (let s = 0; s < squarings; s++) weight *= weight;
    g.weights[q] = weight;
    total += g.weights[q];
    steepest = Math.max(steepest, slope);
  }
  g.steepest = steepest;
  return total;
}

// Picks up or drops soil at corner k and returns the soil the water carries on. A pickup never takes
// more than a share of the drop to the steepest neighbor, so water cannot dig a pit.
function erode(g: RainGrid, k: number, water: number, rules: RainRules): number {
  const slope = g.steepest;
  const free = rules.capacity * Math.max(slope, rules.minSlope) * water - g.soil[k];
  const moved = free > 0 ? Math.min(rules.pickupRate * free, rules.maxDig * slope) : rules.dropRate * free;
  g.height[k] -= moved;
  return g.soil[k] + moved;
}

// Slump: thermal erosion. Soil on a corner steeper than the rest slope toward its steepest lower neighbor
// slides down to that neighbor, a share of the excess per pass. Both corners are marked in d.slumped, so
// the ground layer can lay scree on them. Only interior corners shed soil, and every neighbor lies on
// the map, so no soil is lost.


export function slump(d: MapDraft, rules: SlumpRules): void {
  const n = d.size + 1;
  const nb = cornerNeighbors(n);
  const height = Float64Array.from(d.heights);
  for (let s = 0; s < rules.steps; s++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) slide(height, d.slumped, nb, j * n + i, rules);
    }
  }
  for (let k = 0; k < height.length; k++) d.heights[k] = height[k];
}

function slide(height: Float64Array, slumped: Uint8Array, nb: Neighbors, k: number, rules: SlumpRules): void {
  const { offsets, invDist } = nb;
  let steepest = rules.restSlope;
  let target = -1;
  for (let q = 0; q < 8; q++) {
    const slope = (height[k] - height[k + offsets[q]]) * invDist[q];
    if (slope > steepest) {
      steepest = slope;
      target = q;
    }
  }
  if (target < 0) return;
  const m = k + offsets[target];
  // Moving x closes the drop by 2x, so half the excess drop brings the pair to the rest slope.
  const moved = (rules.slideShare * (steepest - rules.restSlope)) / invDist[target] / 2;
  height[k] -= moved;
  height[m] += moved;
  slumped[k] = 1;
  slumped[m] = 1;
}

// Wind: the Werner dune model over d.sand. Each event lifts one slab of sand from a random sandy corner
// that is not in wind shadow, and carries it downwind in hops until it lands. A slab always lands in wind
// shadow, and elsewhere lands by chance, more often on sand. Sand steeper than the sand slope avalanches
// to its lowest neighbor. Slabs carried past the map edge leave the map. At the end, the sand depth adds
// to the corner heights.


type WindGrid = {
  n: number;
  nb: Neighbors;
  ground: Float32Array;
  sand: Float64Array;
  sandy: Int32Array; // corners that have held sand, the only ones an event may pick
  sandyCount: number;
  listed: Uint8Array;
  hopX: number; // tiles one hop moves along x
  hopY: number;
  upwind: Int32Array; // shadow checks: x offset, y offset per upwind step
  upwindDrop: Float64Array; // height a crest at each upwind step must rise above a corner to shade it
  outflow: number;
};

// Runs the wind events on the draft and returns the sand blown off the map, in height units summed over
// corners, so the total sand before equals the total sand after plus this.
export function wind(d: MapDraft, rules: WindRules, rng: Rng): number {
  const g = newWindGrid(d, rules);
  const events = rules.stepsPerCell * g.sandyCount;
  for (let e = 0; e < events; e++) {
    const k = g.sandy[Math.floor(nextRandom(rng) * g.sandyCount)];
    if (g.sand[k] > 0 && !inShadow(g, k)) lift(g, k, rules, rng);
  }
  for (let k = 0; k < g.sand.length; k++) {
    d.sand[k] = g.sand[k];
    d.heights[k] += d.sand[k];
  }
  return g.outflow;
}

function newWindGrid(d: MapDraft, rules: WindRules): WindGrid {
  if (!(rules.hop >= 1)) throw new Error(`Wind hop must be at least 1 tile, got ${rules.hop}`);
  const n = d.size + 1;
  const angle = (rules.direction * Math.PI) / 180;
  const g: WindGrid = {
    n,
    nb: cornerNeighbors(n),
    ground: d.heights,
    sand: Float64Array.from(d.sand),
    sandy: new Int32Array(n * n),
    sandyCount: 0,
    listed: new Uint8Array(n * n),
    hopX: rules.hop * Math.cos(angle),
    hopY: rules.hop * Math.sin(angle),
    upwind: new Int32Array(rules.shadowReach * 2),
    upwindDrop: new Float64Array(rules.shadowReach),
    outflow: 0,
  };
  for (let s = 0; s < rules.shadowReach; s++) {
    const x = Math.round(-(s + 1) * Math.cos(angle));
    const y = Math.round(-(s + 1) * Math.sin(angle));
    g.upwind[2 * s] = x;
    g.upwind[2 * s + 1] = y;
    g.upwindDrop[s] = rules.shadowSlope * Math.hypot(x, y);
  }
  for (let k = 0; k < g.sand.length; k++) {
    if (g.sand[k] > 0) markSandy(g, k);
  }
  return g;
}

function markSandy(g: WindGrid, k: number): void {
  if (g.listed[k]) return;
  g.listed[k] = 1;
  g.sandy[g.sandyCount++] = k;
}

function surface(g: WindGrid, k: number): number {
  return g.ground[k] + g.sand[k];
}

function onMap(g: WindGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.n && y < g.n;
}

// A corner is in wind shadow when an upwind crest rises above the shadow line drawn down from it.
function inShadow(g: WindGrid, k: number): boolean {
  const x = k % g.n;
  const y = (k - x) / g.n;
  const here = surface(g, k);
  for (let s = 0; s < g.upwindDrop.length; s++) {
    const ux = x + g.upwind[2 * s];
    const uy = y + g.upwind[2 * s + 1];
    if (!onMap(g, ux, uy)) return false;
    if (surface(g, uy * g.n + ux) - here > g.upwindDrop[s]) return true;
  }
  return false;
}

function lift(g: WindGrid, k: number, rules: WindRules, rng: Rng): void {
  const slab = Math.min(rules.slab, g.sand[k]);
  g.sand[k] -= slab;
  if (isInterior(k, g.n)) {
    for (const offset of g.nb.offsets) avalanche(g, k + offset, rules.sandSlope);
  }
  carry(g, k, slab, rules, rng);
}

// Hops the slab downwind from corner k until it lands or leaves the map.
function carry(g: WindGrid, k: number, slab: number, rules: WindRules, rng: Rng): void {
  const x0 = k % g.n;
  const y0 = (k - x0) / g.n;
  for (let hop = 1; ; hop++) {
    const x = Math.round(x0 + hop * g.hopX);
    const y = Math.round(y0 + hop * g.hopY);
    if (!onMap(g, x, y)) {
      g.outflow += slab;
      return;
    }
    const at = y * g.n + x;
    if (lands(g, at, rules, rng)) {
      g.sand[at] += slab;
      markSandy(g, at);
      avalanche(g, at, rules.sandSlope);
      return;
    }
  }
}

function lands(g: WindGrid, k: number, rules: WindRules, rng: Rng): boolean {
  if (inShadow(g, k)) return true;
  return chance(rng, g.sand[k] > 0 ? rules.depositOnSand : rules.depositOnBare);
}

// Slides sand from corner k down its steepest sand face until every face on the path rests at the sand
// slope. Each move leaves the path strictly lower, so it never returns to a corner and always ends.
function avalanche(g: WindGrid, k: number, sandSlope: number): void {
  let at = k;
  while (isInterior(at, g.n) && g.sand[at] > 0) {
    const q = steepestFace(g, at, sandSlope);
    if (q < 0) return;
    const to = at + g.nb.offsets[q];
    const excess = (surface(g, at) - surface(g, to)) * g.nb.invDist[q] - sandSlope;
    // Moving x closes the drop by 2x, so half the excess drop brings the face to the sand slope.
    const moved = Math.min(g.sand[at], excess / g.nb.invDist[q] / 2);
    g.sand[at] -= moved;
    g.sand[to] += moved;
    markSandy(g, to);
    at = to;
  }
}

// Returns the neighbor slot with the steepest face down from corner k past the sand slope, or -1.
function steepestFace(g: WindGrid, k: number, sandSlope: number): number {
  const { offsets, invDist } = g.nb;
  const here = surface(g, k);
  let steepest = sandSlope;
  let best = -1;
  for (let q = 0; q < 8; q++) {
    const slope = (here - surface(g, k + offsets[q])) * invDist[q];
    if (slope > steepest) {
      steepest = slope;
      best = q;
    }
  }
  return best;
}
