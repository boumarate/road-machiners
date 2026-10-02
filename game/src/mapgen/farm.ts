// Farm layout of a territory: an Old World access road through its centre and blocks of dead trees in rows that
// follow the road. The rules are in TERRITORIES. Trees are optional, so a tree that does not fit is left out.

import type { TerritoryDef } from '../data/region';
import type { GroveRule } from '../data/territory';
import { randRange, type Rng } from '../sim/rng';
import { territoryEntries } from '../sim/territory';
import type { BakedProp } from '../sim/terrain';
import { bearing, dist, segmentDist, type Vec } from '../sim/vec';
import type { MapDraft } from './bake';
import { BUILT_FIELD, BUILT_NONE, BUILT_OLD_ROAD, isCutTile, prop, tileCenter, tilesWithin } from './oldworld';

export type Line = { a: Vec; b: Vec };
type Keep = (pos: Vec, r: number) => boolean;

const TRIES = 200; // draws for one block's centre before the block is left out
const NEAR_EDGE = 0.8; // share of the territory radius within which a block's nearest point to the centre lies
const BLOCK_MARGIN = 1; // tiles of field marked around a block's outer trees
const ROAD_MARGIN = 1; // tiles of open ground between a block's edge and the access road

// From the first road entry through the centre to the opposite edge.
export function accessRoadLine(t: TerritoryDef): Line {
  const a = territoryEntries(t)[0];
  if (!a) throw new Error(`Territory ${t.id} has no road entry for an access road`);
  return { a, b: { x: 2 * t.pos.x - a.x, y: 2 * t.pos.y - a.y } };
}

// Marks the tiles within width / 2 of the line as Old World road and returns whether a circle touches the road.
export function markAccessRoad(d: MapDraft, line: Line, width: number): Keep {
  const length = dist(line.a, line.b);
  for (let s = 0; s <= length; s += 0.5) {
    const p = { x: line.a.x + ((line.b.x - line.a.x) * s) / length, y: line.a.y + ((line.b.y - line.a.y) * s) / length };
    for (const tile of tilesWithin(d.size, p, width / 2)) if (unmarked(d, tile)) d.built[tile] = BUILT_OLD_ROAD;
  }
  return (pos, r) => segmentDist(pos, line.a, line.b) < width / 2 + r;
}

type Block = { c: Vec; rows: number; trees: number; half: Vec }; // half: half extents along the road, and across it
type Grove = { t: TerritoryDef; rule: GroveRule; u: Vec; v: Vec; rng: Rng; keepOut: Keep };

// Blocks of rows aligned to the access road, with a share of trees missing and every tree kept off bad ground by
// keepOut. Stops at the rule's tree cap.
export function plantGroves(d: MapDraft, t: TerritoryDef, rule: GroveRule, line: Line, width: number, rng: Rng, keepOut: Keep): BakedProp[] {
  const yaw = bearing(line.a, line.b);
  const u = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const grove: Grove = { t, rule, u, v: { x: -u.y, y: u.x }, rng, keepOut };
  const trees: BakedProp[] = [];
  const blocks: Block[] = [];
  for (let k = 0; k < rule.blocks; k++) {
    const block = drawBlock(grove, line, width, blocks);
    if (!block) continue;
    blocks.push(block);
    markField(d, grove, block);
    plantBlock(grove, block, trees);
  }
  return trees;
}

function plantBlock(g: Grove, b: Block, trees: BakedProp[]): void {
  for (let i = 0; i < b.rows; i++) {
    for (let j = 0; j < b.trees; j++) {
      const pos = at(b.c, g.u, g.v, (j - (b.trees - 1) / 2) * g.rule.treeGap, (i - (b.rows - 1) / 2) * g.rule.rowGap);
      const gone = randRange(g.rng, 0, 1) < g.rule.missing;
      const turn = randRange(g.rng, 0, Math.PI * 2);
      if (!gone && trees.length < g.rule.maxTrees && fits(g, pos)) trees.push(prop(g.rule.look, pos, g.rule.radius, turn));
    }
  }
}

function fits({ t, rule, keepOut }: Grove, pos: Vec): boolean {
  return dist(pos, t.pos) <= t.radius - rule.radius && keepOut(pos, rule.radius);
}

function at(c: Vec, u: Vec, v: Vec, along: number, across: number): Vec {
  return { x: c.x + u.x * along + v.x * across, y: c.y + u.y * along + v.y * across };
}

// A block centre in the ring whose rectangle reaches into the territory, off the road and apart from other blocks.
// Blocks share the road's frame, so two blocks overlap exactly when their extents overlap on both axes.
function drawBlock({ t, rule, u, v, rng }: Grove, line: Line, width: number, blocks: Block[]): Block | null {
  const rows = Math.round(randRange(rng, rule.rows[0], rule.rows[1]));
  const trees = Math.round(randRange(rng, rule.trees[0], rule.trees[1]));
  const half = { x: ((trees - 1) * rule.treeGap) / 2 + BLOCK_MARGIN, y: ((rows - 1) * rule.rowGap) / 2 + BLOCK_MARGIN };
  for (let k = 0; k < TRIES; k++) {
    const a = randRange(rng, 0, Math.PI * 2);
    const from = t.radius * randRange(rng, rule.ring[0], rule.ring[1]);
    const c = { x: t.pos.x + Math.cos(a) * from, y: t.pos.y + Math.sin(a) * from };
    const along = Math.abs((c.x - t.pos.x) * u.x + (c.y - t.pos.y) * u.y);
    const across = Math.abs((c.x - t.pos.x) * v.x + (c.y - t.pos.y) * v.y);
    const inside = Math.hypot(Math.max(0, along - half.x), Math.max(0, across - half.y)) <= t.radius * NEAR_EDGE; // the block's nearest point is inside; trees past the edge are dropped
    const offRoad = segmentDist(c, line.a, line.b) >= half.y + width / 2 + ROAD_MARGIN;
    const free = blocks.every((o) => Math.abs((o.c.x - c.x) * u.x + (o.c.y - c.y) * u.y) >= o.half.x + half.x || Math.abs((o.c.x - c.x) * v.x + (o.c.y - c.y) * v.y) >= o.half.y + half.y);
    if (inside && offRoad && free) return { c, rows, trees, half };
  }
  return null;
}

// The ground under a block is a field, so the lanes between rows read as dirt tracks.
function markField(d: MapDraft, { t, u, v }: Grove, b: Block): void {
  for (const tile of tilesWithin(d.size, b.c, Math.hypot(b.half.x, b.half.y))) {
    const centre = tileCenter(d.size, tile);
    const p = { x: centre.x - b.c.x, y: centre.y - b.c.y };
    const inside = Math.abs(p.x * u.x + p.y * u.y) <= b.half.x && Math.abs(p.x * v.x + p.y * v.y) <= b.half.y;
    if (inside && dist(centre, t.pos) <= t.radius && unmarked(d, tile)) d.built[tile] = BUILT_FIELD;
  }
}

// Ground the access road and fields may take: no mark yet, and not cut by water.
function unmarked(d: MapDraft, tile: number): boolean {
  return d.built[tile] === BUILT_NONE && !isCutTile(d, tile);
}
