// Damage entering a truck. A round enters the grid from the struck side and walks one lane of cells inward.
// Each working part it meets takes damage and stops some of its penetration.

import { partDef } from '../data/parts';
import { damagePart } from './damage';
import { gridOf, itemCells, itemSize, mountedItems, type Grid } from './grid';
import type { PartInstance, Vehicle, World } from './types';
import { angleDiff, bearing, type Vec } from './vec';

export type Side = 'front' | 'rear' | 'left' | 'right';
export type PartHit = { part: string; damage: number };
export type Round = { damage: number; pen: number };

const QUARTER = Math.PI / 4;

// Map heading grows from +x toward +y, which is a right turn. So a point at a positive bearing off the heading lies to the right.
export function sideToward(v: Vehicle, p: Vec): Side {
  const rel = angleDiff(v.heading, bearing(v.pos, p));
  if (Math.abs(rel) <= QUARTER) return 'front';
  if (Math.abs(rel) >= 3 * QUARTER) return 'rear';
  return rel > 0 ? 'right' : 'left';
}

// Front and rear lanes are grid columns. Left and right lanes are grid rows.
export function laneCount(v: Vehicle, side: Side): number {
  const g = gridOf(v);
  return side === 'front' || side === 'rear' ? g.w : g.h;
}

// The lane through the center cell of a mounted part, across the given side.
export function partLane(v: Vehicle, partId: string, side: Side): number {
  const item = mountedItems(v).find((it) => it.part.id === partId);
  if (!item) throw new Error(`${v.id} has no mounted part ${partId}`);
  const size = itemSize(item);
  return side === 'front' || side === 'rear' ? item.x + Math.floor(size.w / 2) : item.y + Math.floor(size.h / 2);
}

// Cells of one lane in the order a round meets them. The nose is row 0, the left edge is column 0.
function laneCells(g: Grid, side: Side, lane: number): { x: number; y: number }[] {
  const across = side === 'front' || side === 'rear' ? g.w : g.h;
  if (!Number.isInteger(lane) || lane < 0 || lane >= across) throw new Error(`Lane ${lane} is outside the ${side} side (${across} lanes)`);
  const depth = side === 'front' || side === 'rear' ? g.h : g.w;
  const steps = Array.from({ length: depth }, (_, i) => i);
  switch (side) {
    case 'front': return steps.map((y) => ({ x: lane, y }));
    case 'rear': return steps.map((i) => ({ x: lane, y: g.h - 1 - i }));
    case 'left': return steps.map((x) => ({ x, y: lane }));
    case 'right': return steps.map((i) => ({ x: g.w - 1 - i, y: lane }));
  }
}

// The only way damage reaches parts. A working mounted part takes damage × min(1, pen / armor), then lowers pen
// by its armor. The walk stops at zero pen. Holes, empty cells, goods, spares and broken parts let the round pass.
// A part covering several cells of the lane is hit once.
export function walkLane(world: World, v: Vehicle, side: Side, lane: number, round: Round): PartHit[] {
  if (!(round.damage >= 0 && round.pen >= 0)) throw new Error(`Bad round ${JSON.stringify(round)}`);
  const g = gridOf(v);
  const owner = new Map<string, PartInstance>();
  for (const it of mountedItems(v)) for (const c of itemCells(it)) owner.set(`${c.x},${c.y}`, it.part);
  const hits: PartHit[] = [];
  const struck = new Set<string>();
  let pen = round.pen;
  for (const c of laneCells(g, side, lane)) {
    if (pen <= 0) break;
    if (g.cells[c.y][c.x] === null) continue;
    const part = owner.get(`${c.x},${c.y}`);
    if (!part || part.hp <= 0 || struck.has(part.id)) continue;
    struck.add(part.id);
    const armor = partDef(part.defId).armor;
    hits.push({ part: part.id, damage: damagePart(world, v, part, round.damage * Math.min(1, pen / armor)) });
    pen -= armor;
  }
  return hits;
}
