import { RULES } from '../data/rules';
// Sides and lanes of a truck's grid. A round enters the grid from the struck side and walks one lane of cells inward.
// Each working part it meets takes damage and stops some of its penetration. Fire leaves the other way: a gun fires
// toward a side only when no tall part stands between it and that edge, in the lane through the gun's center cell.
// So a gun behind the cab cannot fire forward, and a cargo box behind a turret blinds its rear.

import { partDef, type PartDef, type WeaponDef } from '../data/parts';
import { wornDef } from './wear';
import { damagePart } from './damage';
import { gridOf, itemCells, itemSize, mountedItems, mountedParts, sideOf, type Grid, type SideLetter } from './grid';
import type { GridItem, PartInstance, Vehicle, World } from './types';
import { angleDiff, bearing, type Vec } from './vec';

export type Side = 'front' | 'rear' | 'left' | 'right';
export type PartHit = { part: string; damage: number };
// A blast round meets an armor part's blastArmor instead of its armor.
export type Round = { damage: number; pen: number; blast: boolean };

const QUARTER = Math.PI / 4;

// Map heading grows from +x toward +y, which is a right turn. So a point at a positive bearing off the heading lies to the right.
export function sideToward(v: Vehicle, p: Vec): Side {
  const rel = angleDiff(v.heading, bearing(v.pos, p));
  if (Math.abs(rel) <= QUARTER) return 'front';
  if (Math.abs(rel) >= 3 * QUARTER) return 'rear';
  return rel > 0 ? 'right' : 'left';
}

const LETTER: Record<Side, SideLetter> = { front: 'F', rear: 'B', left: 'L', right: 'R' };

// The strongest ram multiplier among working armor parts mounted on the side, or 1 without one.
export function ramMult(v: Vehicle, side: Side): number {
  let mult = 1;
  for (const p of mountedParts(v, 'armor')) {
    const def = partDef(p.defId);
    if (def.kind !== 'armor') throw new Error(`${p.id} is mounted as armor but is ${def.kind}`);
    if (p.hp > 0 && sideOf(v, p) === LETTER[side]) mult = Math.max(mult, def.ramMult);
  }
  return mult;
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
// by its armor, and damage drops in the same proportion as pen. The walk stops at zero pen. Holes, empty cells, goods, spares and broken parts let the round pass.
// A part covering several cells of the lane is hit once.
export function walkLane(world: World, v: Vehicle, side: Side, lane: number, round: Round): PartHit[] {
  if (!(round.damage >= 0 && round.pen >= 0)) throw new Error(`Bad round ${JSON.stringify(round)}`);
  const g = gridOf(v);
  const owner = new Map<string, PartInstance>();
  for (const it of mountedItems(v)) for (const c of itemCells(it)) owner.set(`${c.x},${c.y}`, it.part);
  const hits: PartHit[] = [];
  const struck = new Set<string>();
  let pen = round.pen;
  let damage = round.damage;
  for (const c of laneCells(g, side, lane)) {
    if (pen <= 0) break;
    if (g.cells[c.y][c.x] === null) continue;
    pen -= RULES.cellPen;
    const part = owner.get(`${c.x},${c.y}`);
    if (pen <= 0 || !part || part.hp <= 0 || struck.has(part.id)) continue;
    struck.add(part.id);
    const armor = armorAgainst(wornDef(part), round.blast);
    hits.push({ part: part.id, damage: damagePart(world, v, part, damage * Math.min(1, pen / armor)) });
    damage *= Math.max(0, pen - armor) / pen;
    pen -= armor;
  }
  return hits;
}

function armorAgainst(def: PartDef, blast: boolean): number {
  return blast && def.kind === 'armor' ? def.blastArmor : def.armor;
}

export const SIDES: readonly Side[] = ['front', 'rear', 'left', 'right'];

const STEP: Record<Side, { dx: number; dy: number }> = {
  front: { dx: 0, dy: -1 },
  rear: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

// The sides a mounted gun can fire toward past the tall parts on its truck.
export function openSides(v: Vehicle, item: GridItem): Side[] {
  const tall = new Set<string>();
  for (const it of v.items) {
    if (it.id === item.id || it.kind !== 'part' || !partDef(it.part.defId).tall) continue;
    for (const c of itemCells(it)) tall.add(`${c.x},${c.y}`);
  }
  const g = gridOf(v);
  const { w, h } = itemSize(item);
  const center = { x: item.x + Math.floor(w / 2), y: item.y + Math.floor(h / 2) };
  return SIDES.filter((side) => !laneToEdge(g, center, side).some((c) => tall.has(`${c.x},${c.y}`)));
}

// Open sides summed over every mounted weapon, to compare layouts. Only sides the gun's own arc reaches count.
export function openSideCount(v: Vehicle): number {
  return mountedItems(v, 'weapon').reduce((sum, item) => {
    const reach = arcSides(partDef(item.part.defId) as WeaponDef);
    return sum + openSides(v, item).filter((side) => reach.includes(side)).length;
  }, 0);
}

// The sides a centered arc reaches. The front quarter spans 90 degrees, so a wider arc reaches the flanks, and one
// wider than 270 degrees also reaches the rear.
function arcSides(def: WeaponDef): Side[] {
  if (def.arc > 270) return [...SIDES];
  if (def.arc > 90) return ['front', 'left', 'right'];
  return ['front'];
}

// Grid cells from a start cell to the edge of the grid on one side, the start included.
function laneToEdge(g: Grid, start: { x: number; y: number }, side: Side): { x: number; y: number }[] {
  const { dx, dy } = STEP[side];
  const out: { x: number; y: number }[] = [];
  for (let c = start; inGrid(g, c); c = { x: c.x + dx, y: c.y + dy }) out.push(c);
  return out;
}

function inGrid(g: Grid, c: { x: number; y: number }): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h;
}
