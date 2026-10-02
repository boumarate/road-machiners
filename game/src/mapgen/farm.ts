// Farm layout of a territory, from its FarmRules in TERRITORIES: an old road along the spine from rim to rim,
// concrete pads, dirt tracks, irrigation ditches, buildings that are loot spots, runs of segment props and blocks of
// dead trees in rows. Everything is authored in the road's frame; only the trees draw their gaps, jitter and turns.
// Authored buildings, pads, run points and block corners fail loudly on bad ground. Trees and run segments that land
// on bad ground are dropped, but a block that keeps too few of its trees fails loudly too.

import { REGION, type TerritoryDef } from '../data/region';
import type { BuildingGroup, FarmRules, GroveBlock, GroveRule, Pad, Run, TerritoryRules, Track } from '../data/territory';
import { TERRAIN } from '../data/terrain';
import { ROAD_INDEX } from '../sim/road-index';
import { chance, randRange, type Rng } from '../sim/rng';
import type { BakedProp } from '../sim/terrain';
import { bearing, dist, segmentDist, type Vec } from '../sim/vec';
import { tileSteepness, type MapDraft } from './bake';
import { BUILT_DIRTY_WATER, BUILT_TRACK } from './newworld';
import { BUILT_FIELD, BUILT_NONE, BUILT_OLD_ROAD, facing, prop, RoadLine, tileCenter, tileOf, tilesWithin } from './oldworld';

const LENGTH_SLACK = 1e-6; // share of a segment a run's length may miss by rounding and still count it whole
const LINE_SAMPLE = 0.25; // tiles between the points of a run segment tested against the old road

// Whether a circle at pos with radius r touches something.
type Touch = (pos: Vec, r: number) => boolean;
// The road's frame: its heading, and the unit vectors along it and across it toward the map's west.
type Frame = { yaw: number; along: Vec; across: Vec };

// Lays out the farm and returns its buildings, the loot spots. Pads, tracks and ditches go down before the
// buildings, runs and trees, so trees keep off them and blocks mark field only on bare ground.
export function fillFarm(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, farm: FarmRules, rng: Rng): BakedProp[] {
  const frame = frameOf(rules.spine);
  const onRoad = markRoad(d, t, rules.spine, farm.road.width);
  markPads(d, t, frame, farm.pads);
  markLines(d, t, farm.tracks, BUILT_TRACK);
  markLines(d, t, farm.ditches, BUILT_DIRTY_WATER);
  const spots = placeBuildings(d, t, frame, farm, onRoad);
  d.props.push(...spots);
  const runs = placeRuns(d, t, farm.runs, onRoad);
  d.props.push(...runs);
  // Trees keep a parking gap round every building, and keep clear of the run segments as the lines they are.
  const keep = (pos: Vec, r: number): boolean =>
    standsOnFarm(d, t, pos, r) && !onRoad(pos, r) && !touchesMarks(d, pos, r) && clearOf(spots, pos, r, rules.debrisGap) && runs.every((seg) => clearOfSegment(seg, pos, r));
  d.props.push(...plantBlocks(d, t, frame, farm.groves, farm.blocks, rng, keep));
  return spots;
}

// Tiles whose square a circle at pos with radius r overlaps.
function touchedTiles(size: number, pos: Vec, r: number): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, Math.floor(pos.y - r)); y <= Math.min(size - 1, Math.floor(pos.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(pos.x - r)); x <= Math.min(size - 1, Math.floor(pos.x + r)); x++) {
      const near = { x: Math.min(Math.max(pos.x, x), x + 1), y: Math.min(Math.max(pos.y, y), y + 1) };
      if (dist(near, pos) < r) out.push(y * size + x);
    }
  }
  return out;
}

// Whether a circle overlaps a tile of old road, a pad or a dirt track, where no prop may stand.
export function touchesMarks(d: MapDraft, pos: Vec, r: number): boolean {
  return touchedTiles(d.size, pos, r).some((tile) => d.built[tile] === BUILT_OLD_ROAD || d.built[tile] === BUILT_TRACK);
}

function frameOf(spine: TerritoryRules['spine']): Frame {
  const yaw = bearing(spine.from, spine.to);
  return { yaw, along: { x: Math.cos(yaw), y: Math.sin(yaw) }, across: { x: Math.sin(yaw), y: -Math.cos(yaw) } };
}

// Marks old road on every unmarked tile whose centre lies within width / 2 of the spine, which runs rim to rim.
// Returns whether a circle touches the road.
function markRoad(d: MapDraft, t: TerritoryDef, spine: TerritoryRules['spine'], width: number): Touch {
  const [a, b] = [shift(t, spine.from), shift(t, spine.to)];
  for (const tile of tilesWithin(d.size, t.pos, dist(a, b) / 2 + width)) {
    if (segmentDist(tileCenter(d.size, tile), a, b) <= width / 2) mark(d, tile, BUILT_OLD_ROAD);
  }
  return (pos, r) => segmentDist(pos, a, b) < width / 2 + r;
}

// Concrete on every tile of each pad. A pad lies wholly inside the territory on drivable ground off the roads.
function markPads(d: MapDraft, t: TerritoryDef, frame: Frame, pads: readonly Pad[]): void {
  for (const pad of pads) {
    const centre = shift(t, pad.at);
    const yaw = frame.yaw + pad.turn;
    for (const corner of corners(centre, yaw, pad.size)) inside(t, corner, `pad at ${at(centre)}`);
    for (const tile of rectTiles(d, centre, yaw, pad.size)) markPadTile(d, t, tile, centre);
  }
}

function markPadTile(d: MapDraft, t: TerritoryDef, tile: number, centre: Vec): void {
  const c = tileCenter(d.size, tile);
  if (steep(d, tile)) throw new Error(`${t.id} pad at ${at(centre)} lies on a cliff at ${at(c)}`);
  if (onNewRoad(c, 0)) throw new Error(`${t.id} pad at ${at(centre)} lies on a road at ${at(c)}`);
  mark(d, tile, BUILT_OLD_ROAD);
}

// Marks code on every unmarked tile inside the territory whose centre lies within width / 2 of a line.
function markLines(d: MapDraft, t: TerritoryDef, lines: readonly Track[], code: number): void {
  for (const line of lines) {
    const points = line.points.map((p) => inside(t, shift(t, p), 'line point'));
    for (let k = 1; k < points.length; k++) markLeg(d, t, points[k - 1], points[k], line.width, code);
  }
}

function markLeg(d: MapDraft, t: TerritoryDef, a: Vec, b: Vec, width: number, code: number): void {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  for (const tile of tilesWithin(d.size, mid, dist(a, b) / 2 + width)) {
    const c = tileCenter(d.size, tile);
    if (segmentDist(c, a, b) <= width / 2 && dist(c, t.pos) <= t.radius) mark(d, tile, code);
  }
}

// One loot spot at each pose, turned from the road's heading. A pose that falls outside the territory, on a cliff,
// on a road, or on the old road without leave to stand on its shoulder is a data error.
function placeBuildings(d: MapDraft, t: TerritoryDef, frame: Frame, farm: FarmRules, onRoad: Touch): BakedProp[] {
  return farm.buildings.flatMap((group) => group.poses.map((pose) => building(d, t, frame, group, pose, onRoad)));
}

function building(d: MapDraft, t: TerritoryDef, frame: Frame, group: BuildingGroup, pose: BuildingGroup['poses'][number], onRoad: Touch): BakedProp {
  const pos = shift(t, pose.at);
  const where = `${t.id} ${group.look} at ${at(pos)}`;
  if (dist(pos, t.pos) + pose.r > t.radius) throw new Error(`${where} lies outside the territory`);
  if (touchedTiles(d.size, pos, pose.r).some((tile) => steep(d, tile))) throw new Error(`${where} stands on a cliff`);
  if (onNewRoad(pos, pose.r)) throw new Error(`${where} stands on a road`);
  if (!pose.shoulder && onRoad(pos, pose.r)) throw new Error(`${where} stands on the old road`);
  return prop(group.look, pos, pose.r, frame.yaw + pose.turn);
}

// Segment props, segment tiles long, centred along each run's polyline. Gaps and segments on bad ground are left
// out. A run's points lie inside the territory.
function placeRuns(d: MapDraft, t: TerritoryDef, runs: readonly Run[], onRoad: Touch): BakedProp[] {
  return runs.flatMap((run) => runSegments(t, run).filter((p) => standsOnFarm(d, t, p.pos, p.r) && !crossesRoad(p, onRoad)));
}

// Every segment of a run but its gaps, wherever it lands.
function runSegments(t: TerritoryDef, run: Run): BakedProp[] {
  const line = new RoadLine(run.points.map((p) => inside(t, shift(t, p), `${run.look} run point`)));
  const count = Math.floor(line.length / run.segment + LENGTH_SLACK);
  const lead = (line.length - count * run.segment) / 2;
  const steps = Array.from({ length: count }, (_, step) => step).filter((step) => !run.gaps.includes(step));
  return steps.map((step) => {
    const s = lead + (step + 0.5) * run.segment;
    return prop(run.look, line.pointAt(s), run.segment / 2, facing(line.dirAt(s)));
  });
}

// Each block's tiles become field, then trees stand on its grid. A share of grid points stays empty, trees that keep
// rejects are dropped, and planting stops at maxTrees.
function plantBlocks(d: MapDraft, t: TerritoryDef, frame: Frame, groves: GroveRule, blocks: readonly GroveBlock[], rng: Rng, keep: Touch): BakedProp[] {
  const trees: BakedProp[] = [];
  for (const block of blocks) {
    const centre = shift(t, block.at);
    checkBlock(d, t, frame, block, centre);
    markField(d, t, frame, block, centre);
    const grid = blockGrid(frame, groves, block, centre, rng);
    const standing = grid.filter((p) => !p.gone && keep(p.pos, groves.radius));
    const kept = standing.slice(0, groves.maxTrees - trees.length).map((p) => prop(groves.look, p.pos, groves.radius, p.turn));
    if (kept.length < groves.keep * grid.length) throw new Error(`${t.id} grove block at ${at(centre)} keeps ${kept.length} of ${grid.length} trees, under ${groves.keep}`);
    trees.push(...kept);
  }
  return trees;
}

function markField(d: MapDraft, t: TerritoryDef, frame: Frame, block: GroveBlock, centre: Vec): void {
  for (const tile of rectTiles(d, centre, frame.yaw, block.size)) if (dist(tileCenter(d.size, tile), t.pos) <= t.radius) mark(d, tile, BUILT_FIELD);
}

// The block's planned trees: rows rowGap apart, trees treeGap apart along each row with a little jitter along it, so
// lanes between rows stay rowGap - 2 radius wide. Each point draws whether it stays empty and its turn.
function blockGrid(frame: Frame, groves: GroveRule, block: GroveBlock, centre: Vec, rng: Rng): { pos: Vec; gone: boolean; turn: number }[] {
  const [row, lane] = block.rows === 'along' ? [frame.along, frame.across] : [frame.across, frame.along];
  const [rowLength, rowSpan] = block.rows === 'along' ? [block.size.x, block.size.y] : [block.size.y, block.size.x];
  const perRow = Math.floor(rowLength / groves.treeGap) + 1;
  const rows = Math.floor(rowSpan / groves.rowGap) + 1;
  return Array.from({ length: rows * perRow }, (_, k) => {
    const a = ((k % perRow) - (perRow - 1) / 2) * groves.treeGap + randRange(rng, -groves.jitter, groves.jitter);
    const c = (Math.floor(k / perRow) - (rows - 1) / 2) * groves.rowGap;
    const gone = chance(rng, groves.missing);
    const turn = randRange(rng, 0, Math.PI * 2);
    return { pos: { x: centre.x + row.x * a + lane.x * c, y: centre.y + row.y * a + lane.y * c }, gone, turn };
  });
}

// A block's corners lie inside the territory on drivable ground off the roads.
function checkBlock(d: MapDraft, t: TerritoryDef, frame: Frame, block: GroveBlock, centre: Vec): void {
  for (const corner of corners(centre, frame.yaw, block.size)) {
    const where = `${t.id} grove block at ${at(centre)} has its corner ${at(corner)}`;
    inside(t, corner, `grove block at ${at(centre)} corner`);
    if (steep(d, tileOf(d.size, corner))) throw new Error(`${where} on a cliff`);
    if (onNewRoad(corner, 0)) throw new Error(`${where} on a road`);
  }
}

// Inside the territory, off cliffs and off every road of today's world.
function standsOnFarm(d: MapDraft, t: TerritoryDef, pos: Vec, r: number): boolean {
  return dist(pos, t.pos) + r <= t.radius && !steep(d, tileOf(d.size, pos)) && !onNewRoad(pos, r);
}

function onNewRoad(pos: Vec, r: number): boolean {
  const reach = REGION.roadWidth / 2 + r;
  return ROAD_INDEX.nearestWithin(pos.x, pos.y, reach) < reach;
}

function steep(d: MapDraft, tile: number): boolean {
  return tileSteepness(d.heights, d.size, tile) > TERRAIN.drive.maxSlope;
}

// Whether no prop of the list stands within gap tiles of a circle at pos with radius r.
function clearOf(props: readonly BakedProp[], pos: Vec, r: number, gap: number): boolean {
  return props.every((o) => dist(o.pos, pos) >= o.r + r + REGION.obstacles.gap + gap);
}

// Whether a run segment, a line seg.r tiles to each side of its centre, reaches onto the old road. A barrier lies
// along the road's edge, so the circle round it would touch the road where the line does not.
function crossesRoad(seg: BakedProp, onRoad: Touch): boolean {
  const steps = Math.ceil((2 * seg.r) / LINE_SAMPLE);
  return Array.from({ length: steps + 1 }, (_, k) => -seg.r + (2 * seg.r * k) / steps).some((o) => onRoad({ x: seg.pos.x + Math.cos(seg.yaw) * o, y: seg.pos.y + Math.sin(seg.yaw) * o }, 0));
}

// Whether a circle keeps the obstacle gap from a run segment, a line seg.r tiles to each side of its centre.
function clearOfSegment(seg: BakedProp, pos: Vec, r: number): boolean {
  const half = { x: Math.cos(seg.yaw) * seg.r, y: Math.sin(seg.yaw) * seg.r };
  const [a, b] = [{ x: seg.pos.x - half.x, y: seg.pos.y - half.y }, { x: seg.pos.x + half.x, y: seg.pos.y + half.y }];
  return segmentDist(pos, a, b) >= r + REGION.obstacles.gap;
}

// A mark goes only on a tile no earlier mark took, so the road wins over pads, pads over tracks and so on.
function mark(d: MapDraft, tile: number, code: number): void {
  if (d.built[tile] === BUILT_NONE) d.built[tile] = code;
}

// Tiles whose centre lies in a rectangle of size (along yaw, across it) around centre.
function rectTiles(d: MapDraft, centre: Vec, yaw: number, size: Vec): number[] {
  const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)];
  return tilesWithin(d.size, centre, Math.hypot(size.x, size.y) / 2).filter((tile) => {
    const c = tileCenter(d.size, tile);
    const [x, y] = [c.x - centre.x, c.y - centre.y];
    return Math.abs(x * cos + y * sin) <= size.x / 2 && Math.abs(x * sin - y * cos) <= size.y / 2;
  });
}

function corners(centre: Vec, yaw: number, size: Vec): Vec[] {
  const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)];
  return [-1, 1].flatMap((a) => [-1, 1].map((c) => ({ x: centre.x + (a * size.x * cos + c * size.y * sin) / 2, y: centre.y + (a * size.x * sin - c * size.y * cos) / 2 })));
}

// The point, which must lie inside the territory, or the farm's data is wrong.
function inside(t: TerritoryDef, p: Vec, what: string): Vec {
  if (dist(p, t.pos) > t.radius) throw new Error(`${t.id} ${what} at ${at(p)} lies outside the territory`);
  return p;
}

function shift(t: TerritoryDef, offset: Vec): Vec {
  return { x: t.pos.x + offset.x, y: t.pos.y + offset.y };
}

function at(p: Vec): string {
  return `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
}
