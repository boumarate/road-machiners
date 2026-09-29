import { RULES } from '../data/rules';
import { PHYSICS } from '../data/physics';
import { bodyOf } from './body';
// Sides and lanes of a truck's grid. A round enters the grid from the struck side and walks one lane of cells inward.
// Each working part it meets takes damage and stops some of its penetration. Fire leaves the other way: a gun fires
// toward a side only when no tall part stands between it and that edge, in the lane through the gun's center cell.
// So a gun behind the cab cannot fire forward, and a cargo box behind a turret blinds its rear.

import { partDef, type PartDef, type WeaponDef } from '../data/parts';
import { wornDef } from './wear';
import { damagePart } from './damage';
import { cellKey, gridOf, itemCells, itemSize, mountedItems, mountedParts, sideOf, type Grid, type SideLetter } from './grid';
import type { GridItem, PartInstance, Vehicle, World } from './types';
import { angleDiff, bearing, type Vec } from './vec';

export type Side = 'front' | 'rear' | 'left' | 'right';
export type PartHit = { part: string; damage: number };
// A blast round meets an armor part's blastArmor instead of its armor. Armor parts take damage times armorShare.
export type Round = { damage: number; pen: number; blast: boolean; armorShare: number };

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

// How well armor shields the cab, to compare armor layouts. A cab lane is shielded where an armor cell on that
// side's edge lies in a lane that crosses the cab. Front and rear lanes are columns, left and right lanes are rows.
// Each side adds the square root of its shielded lanes, so cover spreads over the sides before it deepens on one.
export function cabShield(v: Vehicle): number {
  const g = gridOf(v);
  const cab = mountedItems(v, 'core').filter((it) => isCab(partDef(it.part.defId))).flatMap(itemCells);
  const cabLanes = new Set(cab.flatMap((c) => [`F${c.x}`, `B${c.x}`, `L${c.y}`, `R${c.y}`]));
  const shielded = new Set(mountedItems(v, 'armor').flatMap(itemCells).map((c) => laneKey(g, c)).filter((key) => cabLanes.has(key)));
  const perSide = new Map<string, number>();
  for (const key of shielded) perSide.set(key[0], (perSide.get(key[0]) ?? 0) + 1);
  return [...perSide.values()].reduce((sum, n) => sum + Math.sqrt(n), 0);
}

// The side and lane an edge cell covers, like "F2" for front column 2. Front and rear lanes are columns, left and
// right lanes are rows. A cell off the edge gives a key no lane has.
function laneKey(g: Grid, c: { x: number; y: number }): string {
  const letter = g.cells[c.y]?.[c.x] ?? '';
  return letter === 'F' || letter === 'B' ? `${letter}${c.x}` : `${letter}${c.y}`;
}

function isCab(def: PartDef): boolean {
  return def.kind === 'core' && def.role === 'cab';
}

// A point in the truck's frame, in meters: forward along the heading and right across it.
type Local = { fwd: number; right: number };

function toLocal(v: Vehicle, p: Vec): Local {
  const dx = (p.x - v.pos.x) * PHYSICS.metersPerTile;
  const dy = (p.y - v.pos.y) * PHYSICS.metersPerTile;
  const c = Math.cos(v.heading);
  const s = Math.sin(v.heading);
  return { fwd: dx * c + dy * s, right: -dx * s + dy * c };
}

function toMap(v: Vehicle, l: Local): Vec {
  const c = Math.cos(v.heading);
  const s = Math.sin(v.heading);
  const m = PHYSICS.metersPerTile;
  return { x: v.pos.x + (l.fwd * c - l.right * s) / m, y: v.pos.y + (l.fwd * s + l.right * c) / m };
}

// Where a lane's center meets the outer face of a side. Column 0 is the truck's left edge, row 0 its nose.
function laneFace(v: Vehicle, side: Side, lane: number): Local {
  const half = bodyOf(v.chassisId).half;
  const n = laneCount(v, side);
  const across = (lane + 0.5) / n;
  switch (side) {
    case 'front': return { fwd: half.x, right: (across * 2 - 1) * half.z };
    case 'rear': return { fwd: -half.x, right: (across * 2 - 1) * half.z };
    case 'left': return { fwd: (1 - across * 2) * half.x, right: -half.z };
    case 'right': return { fwd: (1 - across * 2) * half.x, right: half.z };
  }
}

// The map point where a round entering a lane meets the truck.
export function lanePoint(v: Vehicle, side: Side, lane: number): Vec {
  return toMap(v, laneFace(v, side, lane));
}

// The side of a truck facing a blast, and its lanes whose face centers lie within radius meters of the blast.
export function blastLanes(v: Vehicle, p: Vec, radius: number): { side: Side; lanes: number[] } {
  const side = sideToward(v, p);
  const at = toLocal(v, p);
  const lanes = Array.from({ length: laneCount(v, side) }, (_, i) => i).filter((lane) => {
    const face = laneFace(v, side, lane);
    return Math.hypot(at.fwd - face.fwd, at.right - face.right) <= radius;
  });
  return { side, lanes };
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
  checkRound(round);
  const g = gridOf(v);
  const owner = new Map<number, PartInstance>();
  for (const it of mountedItems(v)) for (const c of itemCells(it)) owner.set(cellKey(c.x, c.y), it.part);
  const hits: PartHit[] = [];
  const struck = new Set<string>();
  let pen = round.pen;
  let damage = round.damage;
  for (const c of laneCells(g, side, lane)) {
    if (pen <= 0) break;
    if (g.cells[c.y][c.x] === null) continue;
    pen -= RULES.cellPen;
    const part = owner.get(cellKey(c.x, c.y));
    if (pen <= 0 || !part || part.hp <= 0 || struck.has(part.id)) continue;
    struck.add(part.id);
    const def = wornDef(part);
    const armor = armorAgainst(def, round.blast);
    hits.push({ part: part.id, damage: damagePart(world, v, part, damage * shareOf(def, round) * Math.min(1, pen / armor)) });
    damage *= Math.max(0, pen - armor) / pen;
    pen -= armor;
  }
  return hits;
}

function checkRound(round: Round): void {
  if (!(round.damage >= 0 && round.pen >= 0 && round.armorShare >= 0)) throw new Error(`Bad round ${JSON.stringify(round)}`);
}

// Armor parts take a round's armor share of its damage, and every other part the whole of it.
function shareOf(def: PartDef, round: Round): number {
  return def.kind === 'armor' ? round.armorShare : 1;
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
  const blocked = sideBlockers(v, item);
  return SIDES.filter((side) => !blocked[side]);
}

// The nearest tall item in the gun's lane toward each blocked side. An open side has no entry.
export function sideBlockers(v: Vehicle, item: GridItem): Partial<Record<Side, GridItem>> {
  const tall = tallCells(v, item.id);
  const out: Partial<Record<Side, GridItem>> = {};
  if (tall.size === 0) return out;
  const g = gridOf(v);
  const { w, h } = itemSize(item);
  const center = { x: item.x + Math.floor(w / 2), y: item.y + Math.floor(h / 2) };
  for (const side of SIDES) {
    const { dx, dy } = STEP[side];
    for (let x = center.x, y = center.y; inGrid(g, { x, y }); x += dx, y += dy) {
      const blocker = tall.get(cellKey(x, y));
      if (blocker) {
        out[side] = blocker;
        break;
      }
    }
  }
  return out;
}

// The item on each cell covered by a tall part, leaving out one item.
function tallCells(v: Vehicle, exceptId: string): Map<number, GridItem> {
  const tall = new Map<number, GridItem>();
  for (const it of v.items) if (it.id !== exceptId && isTall(it)) paintCells(tall, it);
  return tall;
}

function isTall(it: GridItem): boolean {
  return it.kind === 'part' && Boolean(partDef(it.part.defId).tall);
}

function paintCells(cells: Map<number, GridItem>, it: GridItem): void {
  const { w, h } = itemSize(it);
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.set(cellKey(it.x + dx, it.y + dy), it);
}

// True when every mounted gun has at least one open side inside its own arc.
export function everyGunFires(v: Vehicle): boolean {
  return mountedItems(v, 'weapon').every((item) => {
    const reach = reachedSides(partDef(item.part.defId) as WeaponDef);
    return openSides(v, item).some((side) => reach.includes(side));
  });
}

// Compares gun layouts. The sides any gun covers count first, so a new gun goes where it fires toward a side no
// other gun does. Open sides summed over every gun break ties. Only sides a gun's own arc reaches count.
export function gunLayoutScore(v: Vehicle): number {
  const covered = new Set<Side>();
  let sum = 0;
  for (const item of mountedItems(v, 'weapon')) {
    const reach = reachedSides(partDef(item.part.defId) as WeaponDef);
    const open = openSides(v, item).filter((side) => reach.includes(side));
    for (const side of open) covered.add(side);
    sum += open.length;
  }
  return covered.size * (SIDES.length * mountedItems(v, 'weapon').length + 1) + sum;
}

// The sides a centered arc reaches. The front quarter spans 90 degrees, so a wider arc reaches the flanks, and one
// wider than 270 degrees also reaches the rear.
export function reachedSides(def: WeaponDef): Side[] {
  if (def.arc > 270) return [...SIDES];
  if (def.arc > 90) return ['front', 'left', 'right'];
  return ['front'];
}

function inGrid(g: Grid, c: { x: number; y: number }): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h;
}

// Angle span in degrees off the heading. Positive angles lie to the right, as in sideToward().
export type FireSpan = { from: number; to: number };

const SIDE_CENTER: Record<Side, number> = { front: 0, right: 90, rear: 180, left: -90 };

// Where a gun can fire: its own arc cut to its open sides, merged into spans. One span of 360 degrees is a full circle.
export function fireSpans(arc: number, sides: readonly Side[]): FireSpan[] {
  const half = Math.min(arc, 360) / 2;
  const pieces = sides
    .flatMap((side) => splitAtBack(SIDE_CENTER[side] - 45, SIDE_CENTER[side] + 45))
    .map((p) => ({ from: Math.max(p.from, -half), to: Math.min(p.to, half) }))
    .filter((p) => p.to > p.from)
    .sort((a, b) => a.from - b.from);
  const merged: FireSpan[] = [];
  for (const p of pieces) {
    const last = merged.at(-1);
    if (last && p.from <= last.to) last.to = Math.max(last.to, p.to);
    else merged.push({ ...p });
  }
  return joinAcrossBack(merged);
}

// The rear quarter crosses 180 degrees, so it splits into its right and left halves.
function splitAtBack(from: number, to: number): FireSpan[] {
  return to <= 180 ? [{ from, to }] : [{ from, to: 180 }, { from: -180, to: to - 360 }];
}

// A span ending at 180 and one starting at -180 are one span through the rear.
function joinAcrossBack(spans: FireSpan[]): FireSpan[] {
  const first = spans[0];
  const last = spans.at(-1);
  if (spans.length < 2 || !first || !last || first.from !== -180 || last.to !== 180) return spans;
  return [{ from: last.from, to: first.to + 360 }, ...spans.slice(1, -1)];
}
