// Old-world layer: what stood on the map before, placed by rules from terrain, flow and today's sites and
// roads. It reads the draft after geology. It appends props and marks old-road and field tiles in d.built.
// Numbers live in OLD_WORLD in src/data/terrain.ts. Every rule draws from the map seed and its own seed offset.

import { REGION } from '../data/region';
import {
  GEOLOGY,
  OLD_WORLD,
  TERRAIN,
  type BendRules,
  type BillboardRules,
  type FieldRules,
  type OldRoadRules,
  type OverlookRules,
  type PowerLineRules,
  type SettlementRules,
  type TankRules,
} from '../data/terrain';
import { deckAlong } from '../sim/bridge';
import { clearOfSites, onBridge } from '../sim/mapgen';
import { ROAD_INDEX } from '../sim/road-index';
import { chance, hashRandom, randInt, randRange, type Rng } from '../sim/rng';
import type { BakedProp, PropKind } from '../sim/terrain';
import { angleDiff, bearing, clamp, DEG, dist, polylineDist, type Vec } from '../sim/vec';
import { tileSteepness, type MapDraft } from './bake';

// Codes in d.built, per tile.
export const BUILT_NONE = 0;
export const BUILT_OLD_ROAD = 1;
export const BUILT_FIELD = 2;

// An old settlement. ground is the height at its center, so fields can keep to lower land.
export type OldSettlement = { pos: Vec; radius: number; farm: boolean; ground: number };
// An old road, starting at the settlement it leaves.
export type OldRoad = { line: RoadLine; width: number };

export function oldWorldLayer(seed: number, d: MapDraft): MapDraft {
  const W = OLD_WORLD;
  const towns = settlements(seed, d, W.settlements);
  overlooks(seed, d, W.overlooks);
  bendBuildings(seed, d, W.bends);
  const roads = oldRoads(d, towns, W.oldRoads);
  powerLines(seed, d, W.powerLines);
  billboards(seed, d, W.billboards);
  tankHulks(seed, d, roads, W.tanks);
  fields(seed, d, towns, W.fields);
  return d;
}

// A polyline walked by distance along it, in tiles.
export class RoadLine {
  readonly points: Vec[];
  readonly length: number;
  private readonly cum: number[];

  constructor(points: readonly Vec[]) {
    this.points = points.filter((p, k) => k === 0 || dist(points[k - 1], p) > 1e-9);
    if (this.points.length < 2) throw new Error(`A road line needs two distinct points, got ${points.length}`);
    this.cum = [0];
    for (let k = 1; k < this.points.length; k++) this.cum.push(this.cum[k - 1] + dist(this.points[k - 1], this.points[k]));
    this.length = this.cum[this.cum.length - 1];
  }

  // The point s tiles along the line, with s clamped to the line.
  pointAt(s: number): Vec {
    const k = this.segmentAt(s);
    const a = this.points[k];
    const b = this.points[k + 1];
    const t = clamp((s - this.cum[k]) / (this.cum[k + 1] - this.cum[k]), 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  // The unit direction of the line s tiles along it.
  dirAt(s: number): Vec {
    const k = this.segmentAt(s);
    return unit(this.points[k], this.points[k + 1]);
  }

  private segmentAt(s: number): number {
    let k = 0;
    while (k < this.points.length - 2 && this.cum[k + 1] < s) k++;
    return k;
  }
}

// Shared placement.

const HALF = REGION.roadWidth / 2;
const O = REGION.obstacles;
const SITES = [...REGION.towns, ...REGION.locations];
const CANYON = TERRAIN.features.canyon;
const TURN = Math.PI * 2;

type Scored = { pos: Vec; score: number };

function prop(kind: PropKind, pos: Vec, r: number, yaw: number, group = 0, step = 0): BakedProp {
  return { kind, pos, r, yaw, group, step };
}

function ruleRng(seed: number, offset: number): Rng {
  return { rngState: Math.floor(hashRandom(seed, offset) * 2 ** 32) | 0 };
}

// Inside the map margin, roadGap tiles past every road edge, clear of sites with their pads, and off the
// Canyon Bridge deck and its ramps.
function clearGround(size: number, pos: Vec, r: number, roadGap: number): boolean {
  if (Math.min(pos.x, pos.y, size - pos.x, size - pos.y) < O.edgeMargin + r) return false;
  const reach = HALF + roadGap + r;
  if (ROAD_INDEX.nearestWithin(pos.x, pos.y, reach) < reach) return false;
  return clearOfSites(pos, r) && !onBridge(pos, HALF + r);
}

// Adds the prop where it stands on clear ground, off cliffs and apart from every prop already placed.
// Roadside props pass a road gap of 0: they stand at their own gap from their road, and only the road
// surface must stay clear.
function place(d: MapDraft, p: BakedProp, roadGap: number): boolean {
  if (!clearGround(d.size, p.pos, p.r, roadGap)) return false;
  if (tileSteepness(d.heights, d.size, tileOf(d.size, p.pos)) > TERRAIN.drive.maxSlope) return false;
  if (d.props.some((o) => dist(o.pos, p.pos) < o.r + p.r + O.gap)) return false;
  d.props.push(p);
  return true;
}

// Ground today's world built on: roads, the bridge deck, and sites with their pads.
function builtGround(c: Vec): boolean {
  if (deckAlong(c.x, c.y) !== null) return true;
  return ROAD_INDEX.nearestWithin(c.x, c.y, HALF) < HALF || !clearOfSites(c, 0);
}

// A wash bed or the canyon floor: water cut the ground there, so old roads break and fields stop.
function isCutTile(d: MapDraft, tile: number): boolean {
  const w = d.size + 1;
  const k = Math.floor(tile / d.size) * w + (tile % d.size);
  if (Math.max(d.flow[k], d.flow[k + 1], d.flow[k + w], d.flow[k + w + 1]) >= GEOLOGY.ground.washFlow) return true;
  return polylineDist(tileCenter(d.size, tile), CANYON.path) <= CANYON.width;
}

function tileOf(size: number, p: Vec): number {
  return clamp(Math.floor(p.y), 0, size - 1) * size + clamp(Math.floor(p.x), 0, size - 1);
}

function tileCenter(size: number, tile: number): Vec {
  return { x: (tile % size) + 0.5, y: Math.floor(tile / size) + 0.5 };
}

function tileHeight(d: MapDraft, tile: number): number {
  const w = d.size + 1;
  const k = Math.floor(tile / d.size) * w + (tile % d.size);
  return (d.heights[k] + d.heights[k + 1] + d.heights[k + w] + d.heights[k + w + 1]) / 4;
}

// Tiles whose centers lie within r of c, inside the map.
function tilesWithin(size: number, c: Vec, r: number): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, Math.floor(c.y - r)); y <= Math.min(size - 1, Math.floor(c.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(c.x - r)); x <= Math.min(size - 1, Math.floor(c.x + r)); x++) {
      if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= r) out.push(y * size + x);
    }
  }
  return out;
}

// The best spots first, each at least spacing from every spot kept before it, up to count spots.
function spaced<T extends Scored>(spots: T[], spacing: number, count: number): T[] {
  const out: T[] = [];
  for (const s of [...spots].sort((a, b) => b.score - a.score)) {
    if (out.length >= count) break;
    if (out.every((o) => dist(o.pos, s.pos) >= spacing)) out.push(s);
  }
  return out;
}

// Distances along a line of the given length, step apart, from 0.
function stations(length: number, step: number): number[] {
  const out: number[] = [];
  for (let k = 0; k * step <= length; k++) out.push(k * step);
  return out;
}

function unit(a: Vec, b: Vec): Vec {
  const d = dist(a, b);
  if (d === 0) throw new Error(`No direction between equal points ${a.x}, ${a.y}`);
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

function offset(p: Vec, dir: Vec, by: number): Vec {
  return { x: p.x + dir.x * by, y: p.y + dir.y * by };
}

// The unit normal of dir to one side: +1 turns dir a quarter toward +y, -1 away.
function sideOf(dir: Vec, side: number): Vec {
  return { x: -dir.y * side, y: dir.x * side };
}

function facing(dir: Vec): number {
  return Math.atan2(dir.y, dir.x);
}

function range(rng: Rng, [lo, hi]: readonly [number, number]): number {
  return randRange(rng, lo, hi);
}

// Settlements: flat, dry spots near today's sites and junctions, where people still pass. The spots
// closest to a site or junction score highest, with seeded noise. Each keeps a cluster of houses, most of
// them ruined, and a farm keeps a silo or a water tower.

type Anchor = { pos: Vec; radius: number };

export function settlements(seed: number, d: MapDraft, rules: SettlementRules): OldSettlement[] {
  const rng = ruleRng(seed, rules.seedOffset);
  const spots = spaced(settlementSpots(seed, d, rules), rules.spacing, rules.count);
  return spots.map((s) => settle(d, rng, rules, s.pos));
}

function settlementSpots(seed: number, d: MapDraft, rules: SettlementRules): Scored[] {
  const anchors = siteAnchors();
  const out: Scored[] = [];
  for (let y = rules.candidateStep; y < d.size; y += rules.candidateStep) {
    for (let x = rules.candidateStep; x < d.size; x += rules.candidateStep) {
      const score = settlementScore(seed, d, rules, anchors, { x, y });
      if (score !== null) out.push({ pos: { x, y }, score });
    }
  }
  return out;
}

function settlementScore(seed: number, d: MapDraft, rules: SettlementRules, anchors: Anchor[], pos: Vec): number | null {
  const [near, far] = rules.anchorGap;
  const gap = Math.min(...anchors.map((a) => dist(pos, a.pos) - a.radius));
  if (gap < near || gap > far) return null;
  if (!clearGround(d.size, pos, rules.radius, rules.roadGap) || !flatAndDry(d, pos, rules)) return null;
  const closeness = 1 - (gap - near) / (far - near);
  return closeness * (1 - rules.jitter) + hashRandom(seed, rules.seedOffset, pos.x, pos.y) * rules.jitter;
}

// Today's sites, and the road ends that meet another road.
function siteAnchors(): Anchor[] {
  const junctions = REGION.roads
    .flatMap((road) => [road[0], road[road.length - 1]])
    .filter((p) => REGION.roads.filter((road) => road.some((q) => dist(p, q) < 0.01)).length > 1);
  return [...SITES.map((s) => ({ pos: s.pos, radius: s.radius })), ...junctions.map((pos) => ({ pos, radius: 0 }))];
}

function flatAndDry(d: MapDraft, pos: Vec, rules: SettlementRules): boolean {
  return tilesWithin(d.size, pos, rules.radius).every((tile) => tileSteepness(d.heights, d.size, tile) <= rules.flatSlope && !isCutTile(d, tile));
}

function settle(d: MapDraft, rng: Rng, rules: SettlementRules, pos: Vec): OldSettlement {
  const farm = chance(rng, rules.farmShare);
  // The farm tower goes first, so the houses fit around it.
  if (farm) placeWithin(d, rng, rules, pos, chance(rng, rules.towerShare) ? 'waterTower' : 'silo', rules.towerRadius);
  const houses = randInt(rng, rules.houses[0], rules.houses[1]);
  for (let k = 0; k < houses; k++) {
    const kind = chance(rng, rules.intactShare) ? 'house' : 'ruin';
    placeWithin(d, rng, rules, pos, kind, range(rng, rules.houseRadius));
  }
  return { pos, radius: rules.radius, farm, ground: tileHeight(d, tileOf(d.size, pos)) };
}

// Tries spots inside the settlement until the prop fits, or leaves it out.
function placeWithin(d: MapDraft, rng: Rng, rules: SettlementRules, center: Vec, kind: PropKind, r: number): void {
  for (let t = 0; t < rules.placeTries; t++) {
    const a = randRange(rng, 0, TURN);
    const at = Math.max(0, rules.radius - r) * Math.sqrt(randRange(rng, 0, 1));
    const pos = { x: center.x + Math.cos(a) * at, y: center.y + Math.sin(a) * at };
    if (place(d, prop(kind, pos, r, randRange(rng, 0, TURN)), rules.roadGap)) return;
  }
}

// Overlooks: flat hilltop edges where the ground falls away over a wide arc get a lone building facing
// the view.

type View = Scored & { yaw: number };

const COMPASS: Vec[] = Array.from({ length: 8 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 4), y: Math.sin((k * Math.PI) / 4) }));

export function overlooks(seed: number, d: MapDraft, rules: OverlookRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  for (const view of spaced(overlookSpots(seed, d, rules), rules.spacing, rules.count)) {
    const kind = chance(rng, rules.intactShare) ? 'house' : 'ruin';
    place(d, prop(kind, view.pos, range(rng, rules.radius), view.yaw), rules.roadGap);
  }
}

function overlookSpots(seed: number, d: MapDraft, rules: OverlookRules): View[] {
  const out: View[] = [];
  const from = O.edgeMargin + rules.reach;
  for (let j = from; j <= d.size - from; j += rules.step) {
    for (let i = from; i <= d.size - from; i += rules.step) {
      const view = viewFrom(d, rules, i, j);
      if (view) out.push({ ...view, score: view.score + hashRandom(seed, rules.seedOffset, i, j) });
    }
  }
  return out;
}

// The view from corner (i, j): the directions whose ground at reach lies drop below it, scored by their
// count. Null off flat ground, where ground at reach rises above rise, or where too few directions drop.
function viewFrom(d: MapDraft, rules: OverlookRules, i: number, j: number): View | null {
  const pos = { x: i, y: j };
  if (tileSteepness(d.heights, d.size, j * d.size + i) > rules.flatSlope) return null;
  if (!clearGround(d.size, pos, rules.radius[1], rules.roadGap)) return null;
  const h = d.heights[j * (d.size + 1) + i];
  const around = COMPASS.map((c) => d.heights[Math.round(j + c.y * rules.reach) * (d.size + 1) + Math.round(i + c.x * rules.reach)] - h);
  if (Math.max(...around) > rules.rise) return null;
  const drops = COMPASS.filter((_, k) => around[k] <= -rules.drop);
  if (drops.length < rules.directions) return null;
  const toward = drops.reduce((s, c) => ({ x: s.x + c.x, y: s.y + c.y }), { x: 0, y: 0 });
  return { pos, score: drops.length, yaw: Math.atan2(toward.y, toward.x) };
}

// Bend buildings: on the outer side of a sharp road bend, a building or a gas station faces the road.

type Bend = Scored & { outer: Vec };

export function bendBuildings(seed: number, d: MapDraft, rules: BendRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  const bends = REGION.roads.flatMap((road) => sharpBends(new RoadLine(road), rules));
  for (const bend of spaced(bends, rules.spacing, Infinity)) {
    if (!chance(rng, rules.chance)) continue;
    const kind = chance(rng, rules.gasShare) ? 'gasStation' : 'house';
    const r = range(rng, rules.radius);
    place(d, prop(kind, offset(bend.pos, bend.outer, HALF + rules.gap + r), r, facing({ x: -bend.outer.x, y: -bend.outer.y })), 0);
  }
}

// Road points where the road turns at least the bend angle between reach behind and reach ahead. The
// chord between those two points lies inside the bend, so the outer side points away from its middle.
function sharpBends(line: RoadLine, rules: BendRules): Bend[] {
  const out: Bend[] = [];
  for (let s = rules.reach; s <= line.length - rules.reach; s += rules.sample) {
    const back = line.pointAt(s - rules.reach);
    const p = line.pointAt(s);
    const ahead = line.pointAt(s + rules.reach);
    const turn = Math.abs(angleDiff(bearing(back, p), bearing(p, ahead)));
    if (turn >= rules.angle * DEG) out.push({ pos: p, score: turn, outer: unit({ x: (back.x + ahead.x) / 2, y: (back.y + ahead.y) / 2 }, p) });
  }
  return out;
}

// Old roads: least-cost routes on a coarse corner grid link each settlement to its nearest neighbor and to
// the nearest road of today. Slope and wash beds cost more, so the routes follow gentle ground. The road
// lays cracked asphalt, not graded ground, and breaks where it crosses a wash bed or the canyon: no
// asphalt there, and a broken span on each bank faces across.

type Link = { from: Vec; to: Vec };

export function oldRoads(d: MapDraft, towns: OldSettlement[], rules: OldRoadRules): OldRoad[] {
  const grid = new RouteGrid(d, rules);
  const out: OldRoad[] = [];
  for (const link of [...townLinks(towns, rules), ...roadLinks(d, towns, rules)]) {
    const path = grid.route(link.from, link.to);
    if (!path) continue;
    const road = { line: new RoadLine(path), width: rules.width };
    layOldRoad(d, road, rules);
    out.push(road);
  }
  return out;
}

// Each settlement to its nearest neighbor within reach, each pair once.
function townLinks(towns: OldSettlement[], rules: OldRoadRules): Link[] {
  const pairs = new Set<string>();
  const out: Link[] = [];
  towns.forEach((t, k) => {
    const others = towns.map((o, m) => ({ m, d: m === k ? Infinity : dist(t.pos, o.pos) }));
    const near = others.reduce((a, b) => (b.d < a.d ? b : a));
    const key = `${Math.min(k, near.m)}-${Math.max(k, near.m)}`;
    if (near.d > rules.maxLink || pairs.has(key)) return;
    pairs.add(key);
    out.push({ from: t.pos, to: towns[near.m].pos });
  });
  return out;
}

function roadLinks(d: MapDraft, towns: OldSettlement[], rules: OldRoadRules): Link[] {
  return towns
    .map((t) => ({ from: t.pos, to: nearestRoadPoint(t.pos) }))
    .filter((l) => dist(l.from, l.to) <= rules.maxLink && Math.min(l.to.x, l.to.y, d.size - l.to.x, d.size - l.to.y) >= 0);
}

function nearestRoadPoint(p: Vec): Vec {
  let best = p;
  let bestDist = Infinity;
  for (const road of REGION.roads) {
    for (let k = 0; k + 1 < road.length; k++) {
      const q = closestOnSegment(p, road[k], road[k + 1]);
      if (dist(p, q) < bestDist) [best, bestDist] = [q, dist(p, q)];
    }
  }
  return best;
}

function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

// Steps to the 8 neighbors: node offsets and length in cells.
const STEPS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Nodes on every cell-th corner. A node inside a site is closed. Costs are in tiles.
class RouteGrid {
  private readonly n: number;
  private readonly heights: Float32Array;
  private readonly cut: Uint8Array;
  private readonly closed: Uint8Array;

  constructor(d: MapDraft, private readonly rules: OldRoadRules) {
    this.n = Math.floor(d.size / rules.cell) + 1;
    const count = this.n * this.n;
    this.heights = new Float32Array(count);
    this.cut = new Uint8Array(count);
    this.closed = new Uint8Array(count);
    for (let node = 0; node < count; node++) {
      const p = this.posOf(node);
      this.heights[node] = d.heights[p.y * (d.size + 1) + p.x];
      this.cut[node] = isCutTile(d, tileOf(d.size, p)) ? 1 : 0;
      this.closed[node] = SITES.some((s) => dist(p, s.pos) < s.radius) ? 1 : 0;
    }
  }

  // Corner points from the node nearest from to the node nearest to, both replaced by the exact ends, with
  // only every smoothEvery-th node kept between them. Null when no route exists.
  route(from: Vec, to: Vec): Vec[] | null {
    const goal = this.nodeNear(to);
    const parent = this.search(this.nodeNear(from), goal);
    if (!parent) return null;
    const nodes: number[] = [goal];
    while (parent[nodes[nodes.length - 1]] >= 0) nodes.push(parent[nodes[nodes.length - 1]]);
    const inner = nodes.reverse().slice(1, -1).filter((_, k) => (k + 1) % this.rules.smoothEvery === 0);
    return [from, ...inner.map((node) => this.posOf(node)), to];
  }

  // A* over the nodes. The parent of each reached node, -1 at the start, or null when goal is out of reach.
  private search(start: number, goal: number): Int32Array | null {
    const cost = new Float64Array(this.n * this.n).fill(Infinity);
    const parent = new Int32Array(this.n * this.n).fill(-1);
    const done = new Uint8Array(this.n * this.n);
    const open = new NodeHeap();
    cost[start] = 0;
    open.push(start, 0);
    while (open.size > 0) {
      const a = open.pop();
      if (a === goal) return parent;
      if (done[a]) continue;
      done[a] = 1;
      this.relax(a, goal, { cost, parent, open });
      this.relaxBridges(a, goal, { cost, parent, open });
    }
    return null;
  }

  // Old roads crossed deep gullies on bridges: a straight jump over sunken nodes to a bank of about the
  // same height, costlier per tile than a road on the ground.
  private relaxBridges(a: number, goal: number, s: { cost: Float64Array; parent: Int32Array; open: NodeHeap }): void {
    for (const [di, dj, len] of STEPS) {
      const b = this.bridgeEnd(a, di, dj);
      if (b < 0) continue;
      const steps = Math.max(Math.abs((b % this.n) - (a % this.n)), Math.abs(Math.floor(b / this.n) - Math.floor(a / this.n)));
      const through = s.cost[a] + steps * len * this.rules.cell * this.rules.bridgeCost;
      if (through >= s.cost[b]) continue;
      s.cost[b] = through;
      s.parent[b] = a;
      s.open.push(b, through + this.guess(b, goal));
    }
  }

  // The first node past a run of nodes at least minDrop below node a along a direction, when it is open and
  // within the slope limit of a, or -1. The run must start next to a and stay within the longest bridge.
  private bridgeEnd(a: number, di: number, dj: number): number {
    const floor = this.heights[a] - this.rules.minDrop;
    for (let k = 1; k * this.rules.cell <= this.rules.maxBridge; k++) {
      const b = this.openNode((a % this.n) + di * k, Math.floor(a / this.n) + dj * k);
      if (b < 0) return -1;
      if (this.heights[b] > floor) return k > 1 && this.reachable(a, b, k * Math.hypot(di, dj)) ? b : -1;
    }
    return -1;
  }

  // The node at (i, j) when it is on the grid and open, or -1.
  private openNode(i: number, j: number): number {
    const node = this.nodeAt(i, j);
    return node >= 0 && !this.closed[node] ? node : -1;
  }

  // Whether a bridge of the given length in cells may join nodes a and b.
  private reachable(a: number, b: number, cells: number): boolean {
    return this.stepCost(a, b, cells * this.rules.cell) < Infinity;
  }

  private relax(a: number, goal: number, s: { cost: Float64Array; parent: Int32Array; open: NodeHeap }): void {
    const ai = a % this.n;
    const aj = Math.floor(a / this.n);
    for (const [di, dj, len] of STEPS) {
      const b = this.nodeAt(ai + di, aj + dj);
      if (b < 0) continue;
      const through = s.cost[a] + this.stepCost(a, b, len * this.rules.cell);
      if (through >= s.cost[b]) continue;
      s.cost[b] = through;
      s.parent[b] = a;
      s.open.push(b, through + this.guess(b, goal));
    }
  }

  private stepCost(a: number, b: number, len: number): number {
    if (this.closed[b]) return Infinity;
    const slope = Math.abs(this.heights[b] - this.heights[a]) / len;
    if (slope > this.rules.maxSlope) return Infinity;
    const wash = this.cut[b] ? this.rules.washCost * len : 0;
    return len * (1 + this.rules.slopeCost * (slope / this.rules.maxSlope) ** 2) + wash;
  }

  private guess(a: number, b: number): number {
    return dist(this.posOf(a), this.posOf(b));
  }

  private nodeAt(i: number, j: number): number {
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }

  private nodeNear(p: Vec): number {
    const i = clamp(Math.round(p.x / this.rules.cell), 0, this.n - 1);
    return clamp(Math.round(p.y / this.rules.cell), 0, this.n - 1) * this.n + i;
  }

  private posOf(node: number): Vec {
    return { x: (node % this.n) * this.rules.cell, y: Math.floor(node / this.n) * this.rules.cell };
  }
}

// A binary min-heap of nodes by key.
class NodeHeap {
  private readonly nodes: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number): void {
    this.nodes.push(node);
    this.keys.push(key);
    let k = this.nodes.length - 1;
    while (k > 0 && this.keys[(k - 1) >> 1] > this.keys[k]) {
      this.swap(k, (k - 1) >> 1);
      k = (k - 1) >> 1;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const lastNode = this.nodes.pop();
    const lastKey = this.keys.pop();
    if (lastNode === undefined || lastKey === undefined) throw new Error('Pop from an empty node heap');
    if (this.nodes.length === 0) return top;
    this.nodes[0] = lastNode;
    this.keys[0] = lastKey;
    this.sink(0);
    return top;
  }

  private sink(from: number): void {
    let k = from;
    for (;;) {
      const l = 2 * k + 1;
      const least = [l, l + 1].filter((c) => c < this.keys.length).reduce((a, c) => (this.keys[c] < this.keys[a] ? c : a), k);
      if (least === k) return;
      this.swap(k, least);
      k = least;
    }
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

function layOldRoad(d: MapDraft, road: OldRoad, rules: OldRoadRules): void {
  const along = stations(road.line.length, rules.sample);
  const points = along.map((s) => road.line.pointAt(s));
  const cut = points.map((p) => isCutTile(d, tileOf(d.size, p)));
  points.forEach((p, k) => {
    if (!cut[k]) markTiles(d, tilesWithin(d.size, p, road.width / 2), BUILT_OLD_ROAD);
  });
  for (const [a, b] of crossings(cut)) {
    // A narrow or shallow gully only cuts the asphalt. A wide, deep wash took a bridge, whose broken ends
    // stand on the banks over the drop.
    if ((b - a) * rules.sample < rules.minBridge || washDrop(d, points, a, b, Math.round(rules.bankBack / rules.sample)) < rules.minDrop) continue;
    place(d, prop('bridgeSpan', points[a], rules.spanRadius, bearing(points[a], points[b])), rules.spanRoadGap);
    place(d, prop('bridgeSpan', points[b], rules.spanRadius, bearing(points[b], points[a])), rules.spanRoadGap);
  }
}

function markTiles(d: MapDraft, tiles: number[], code: number): void {
  for (const tile of tiles) if (markable(d, tile)) d.built[tile] = code;
}

// Old-world ground marks go only on unmarked tiles off built ground and off wash beds.
function markable(d: MapDraft, tile: number): boolean {
  return d.built[tile] === BUILT_NONE && !isCutTile(d, tile) && !builtGround(tileCenter(d.size, tile));
}

// How far the lowest ground between two banks lies below the lower bank, in height units. Each bank is read
// a few tiles back from the cut edge, since the cut edge often lies part way down the gully side.
function washDrop(d: MapDraft, points: Vec[], a: number, b: number, back: number): number {
  const at = (p: Vec) => groundOf(d, p);
  let low = Infinity;
  for (let k = a + 1; k < b; k++) low = Math.min(low, at(points[k]));
  const banks = [points[Math.max(0, a - back)], points[Math.min(points.length - 1, b + back)]];
  return Math.min(...banks.map(at)) - low;
}

// Ground height of the draft at a map point, from its nearest corner.
function groundOf(d: MapDraft, p: Vec): number {
  const n = d.size + 1;
  return d.heights[Math.round(p.y) * n + Math.round(p.x)];
}

// Each run of cut points with an uncut bank on both sides, as the indexes of those two banks.
function crossings(cut: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let bank = -1;
  cut.forEach((isCut, k) => {
    if (isCut) return;
    if (bank >= 0 && k > bank + 1) out.push([bank, k]);
    bank = k;
  });
  return out;
}

// Power lines: poles at even steps along one side of a share of the long roads. Each line is its own
// group, the road index plus 1, and steps count every spot, so a missing pole leaves a gap in the steps.

export function powerLines(seed: number, d: MapDraft, rules: PowerLineRules): void {
  REGION.roads.forEach((road, r) => {
    const line = new RoadLine(road);
    if (line.length < rules.minLength || hashRandom(seed, rules.seedOffset, r) >= rules.roadShare) return;
    const side = hashRandom(seed, rules.seedOffset, r, 1) < 0.5 ? 1 : -1;
    for (let step = 0; rules.spacing / 2 + step * rules.spacing <= line.length; step++) {
      if (hashRandom(seed, rules.seedOffset, r, step, 2) < rules.missingShare) continue;
      const s = rules.spacing / 2 + step * rules.spacing;
      const dir = line.dirAt(s);
      const pos = offset(line.pointAt(s), sideOf(dir, side), HALF + rules.gap + rules.radius);
      place(d, prop('pole', pos, rules.radius, facing(dir), r + 1, step), 0);
    }
  });
}

// Billboards: on the approaches to towns, and on long straights by chance, spaced apart, each on a
// seeded side of its road and facing it.

type RoadSpot = Scored & { dir: Vec };

export function billboards(seed: number, d: MapDraft, rules: BillboardRules): void {
  const spots = spaced([...approachSpots(rules), ...straightSpots(seed, rules)], rules.spacing, Infinity);
  spots.forEach((spot, k) => {
    const out = sideOf(spot.dir, hashRandom(seed, rules.seedOffset, k) < 0.5 ? 1 : -1);
    const pos = offset(spot.pos, out, HALF + rules.gap + rules.radius);
    place(d, prop('billboard', pos, rules.radius, facing({ x: -out.x, y: -out.y })), 0);
  });
}

// Points approach tiles past a town's edge along each road leaving it. They score above every straight.
function approachSpots(rules: BillboardRules): RoadSpot[] {
  const out: RoadSpot[] = [];
  for (const town of REGION.towns) {
    for (const road of REGION.roads) {
      const line = new RoadLine(dist(road[0], town.pos) < 0.01 ? road : [...road].reverse());
      if (dist(line.points[0], town.pos) >= 0.01) continue;
      for (const a of rules.approach) out.push({ pos: line.pointAt(town.radius + a), dir: line.dirAt(town.radius + a), score: 2 });
    }
  }
  return out;
}

// Road points where the chord over reach behind and ahead keeps the straightness share of the road length.
function straightSpots(seed: number, rules: BillboardRules): RoadSpot[] {
  const out: RoadSpot[] = [];
  REGION.roads.forEach((road, r) => {
    const line = new RoadLine(road);
    for (let s = rules.straightReach, k = 0; s <= line.length - rules.straightReach; s += rules.straightStep, k++) {
      const chord = dist(line.pointAt(s - rules.straightReach), line.pointAt(s + rules.straightReach)) / (2 * rules.straightReach);
      if (chord >= rules.straightness && hashRandom(seed, rules.seedOffset, r, k, 1) < rules.straightChance) out.push({ pos: line.pointAt(s), dir: line.dirAt(s), score: chord });
    }
  });
  return out;
}

// Tank hulks: by chance, a small group lies beside an old road a little way out from the settlement it
// leaves.

export function tankHulks(seed: number, d: MapDraft, roads: OldRoad[], rules: TankRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  for (const road of roads) {
    if (!chance(rng, rules.chance)) continue;
    const s = Math.min(road.line.length, range(rng, rules.along));
    const count = randInt(rng, rules.group[0], rules.group[1]);
    for (let k = 0; k < count; k++) placeHulk(d, rng, rules, road, s);
  }
}

function placeHulk(d: MapDraft, rng: Rng, rules: TankRules, road: OldRoad, s: number): void {
  for (let t = 0; t < rules.placeTries; t++) {
    const at = s + randRange(rng, -rules.spread, rules.spread);
    const out = sideOf(road.line.dirAt(at), chance(rng, 0.5) ? 1 : -1);
    const pos = offset(road.line.pointAt(at), out, road.width / 2 + rules.gap + rules.radius + randRange(rng, 0, rules.spread));
    if (place(d, prop('tank', pos, rules.radius, randRange(rng, 0, TURN)), rules.gap)) return;
  }
}

// Fields: rectangles of flat low ground beside each farm, all turned to one angle per farm. A field is
// kept where enough of its tiles are good ground, and only those tiles are marked.

type Rect = { center: Vec; angle: number; w: number; h: number };

export function fields(seed: number, d: MapDraft, towns: OldSettlement[], rules: FieldRules): void {
  const rng = ruleRng(seed, rules.seedOffset);
  for (const town of towns.filter((t) => t.farm)) {
    // A rectangle looks the same turned a quarter, so a quarter turn covers every angle.
    const angle = randRange(rng, 0, Math.PI / 2);
    const count = randInt(rng, rules.perFarm[0], rules.perFarm[1]);
    for (let f = 0; f < count; f++) layField(d, rng, rules, town, angle);
  }
}

function layField(d: MapDraft, rng: Rng, rules: FieldRules, town: OldSettlement, angle: number): void {
  for (let t = 0; t < rules.tries; t++) {
    const all = rectTiles(d.size, fieldRect(rng, rules, town, angle));
    const good = all.filter((tile) => fieldTile(d, rules, town, tile));
    if (all.length === 0 || good.length < rules.minShare * all.length) continue;
    markTiles(d, good, BUILT_FIELD);
    return;
  }
}

// A rectangle whose far corner stays gap tiles out from the settlement edge, turned to the farm angle.
function fieldRect(rng: Rng, rules: FieldRules, town: OldSettlement, angle: number): Rect {
  const w = range(rng, rules.side);
  const h = range(rng, rules.side);
  const a = randRange(rng, 0, TURN);
  const out = town.radius + rules.gap + Math.hypot(w, h) / 2 + randRange(rng, 0, rules.reach);
  return { center: { x: town.pos.x + Math.cos(a) * out, y: town.pos.y + Math.sin(a) * out }, angle, w, h };
}

function rectTiles(size: number, rect: Rect): number[] {
  const cos = Math.cos(rect.angle);
  const sin = Math.sin(rect.angle);
  return tilesWithin(size, rect.center, Math.hypot(rect.w, rect.h) / 2).filter((tile) => {
    const c = tileCenter(size, tile);
    const dx = c.x - rect.center.x;
    const dy = c.y - rect.center.y;
    return Math.abs(dx * cos + dy * sin) <= rect.w / 2 && Math.abs(dy * cos - dx * sin) <= rect.h / 2;
  });
}

function fieldTile(d: MapDraft, rules: FieldRules, town: OldSettlement, tile: number): boolean {
  if (!markable(d, tile) || tileSteepness(d.heights, d.size, tile) > rules.flatSlope) return false;
  const c = tileCenter(d.size, tile);
  if (Math.min(c.x, c.y, d.size - c.x, d.size - c.y) < O.edgeMargin) return false;
  return tileHeight(d, tile) <= town.ground + rules.lowRise;
}
