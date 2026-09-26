// Inventory grid queries. The grid comes from the chassis layout plus rows added by mounted cargo parts.

import { chassisDef } from '../data/chassis';
import { partDef, type CoreDef, type PartKind } from '../data/parts';
import type { GridItem, PartInstance, Vehicle } from './types';

export type SideLetter = 'F' | 'B' | 'L' | 'R';
export type Cell = 'W' | 'E' | 'C' | SideLetter | 'X' | '.';
export type Grid = { w: number; h: number; cells: (Cell | null)[][] }; // cells[y][x], null is a hole
export type Spot = { x: number; y: number; rot: 0 | 1 };

// Letters each kind mounts on. Armor lists the front first, so auto-mounting fills the nose before the sides.
export const MOUNT_CELLS: Record<PartKind, Cell[]> = {
  weapon: ['W'],
  engine: ['E'],
  armor: ['F', 'B', 'L', 'R'],
  cargo: ['C'],
  core: ['X'],
  scanner: ['W'],
};
const SIDES: readonly Cell[] = ['F', 'B', 'L', 'R'];
const CELL_CHARS: readonly string[] = ['W', 'E', 'C', 'F', 'B', 'L', 'R', 'X', '.'];

// A chassis's layout is fixed data, so its grid is cached: this runs on every mounted-part lookup,
// for every vehicle, every turn.
const baseGridCache = new Map<string, Grid>();

export function baseGrid(chassisId: string): Grid {
  const cached = baseGridCache.get(chassisId);
  if (cached) return cached;
  const rows = chassisDef(chassisId).layout;
  const w = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: w }, (_, x) => toCell(r[x] ?? ' ')));
  const grid = { w, h: rows.length, cells };
  baseGridCache.set(chassisId, grid);
  return grid;
}

function toCell(ch: string): Cell | null {
  if (ch === ' ') return null;
  if (CELL_CHARS.includes(ch)) return ch as Cell;
  throw new Error(`Bad layout character "${ch}"`);
}

export function itemSize(item: Pick<GridItem, 'rot'> & ({ kind: 'part'; part: PartInstance } | { kind: 'good' })): { w: number; h: number } {
  if (item.kind === 'good') return { w: 1, h: 1 };
  const d = partDef(item.part.defId);
  return item.rot === 1 ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
}

export function itemCells(item: GridItem): { x: number; y: number }[] {
  const { w, h } = itemSize(item);
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: item.x + dx, y: item.y + dy });
  return out;
}

// A part works when every cell it covers carries the same letter, and that letter is a mount of its kind.
export function isMounted(chassisId: string, item: GridItem): boolean {
  return mountLetter(chassisId, item) !== null;
}

function mountLetter(chassisId: string, item: GridItem): Cell | null {
  if (item.kind !== 'part') return null;
  const base = baseGrid(chassisId);
  const letters = itemCells(item).map((c) => base.cells[c.y]?.[c.x] ?? null);
  const first = letters[0];
  if (first === null || !MOUNT_CELLS[partDef(item.part.defId).kind].includes(first)) return null;
  return letters.every((l) => l === first) ? first : null;
}

// The side a mounted armor part covers. Null for any other part or an unmounted one.
export function sideOf(v: Vehicle, part: PartInstance): SideLetter | null {
  const item = v.items.find((it) => it.kind === 'part' && it.part.id === part.id);
  if (!item) throw new Error(`Part ${part.id} is not on ${v.id}`);
  const letter = mountLetter(v.chassisId, item);
  return letter !== null && SIDES.includes(letter) ? (letter as SideLetter) : null;
}

export function gridOf(v: Vehicle): Grid {
  const base = baseGrid(v.chassisId);
  const extra = mountedItems(v, 'cargo').reduce((a, it) => a + (partDef(it.part.defId) as { extraRows: number }).extraRows, 0);
  const rows = Array.from({ length: extra }, () => Array.from({ length: base.w }, () => '.' as Cell));
  return { w: base.w, h: base.h + extra, cells: [...base.cells, ...rows] };
}

type PartItem = Extract<GridItem, { kind: 'part' }>;

// Mounted parts in reading order, so weapon numbering stays stable.
export function mountedItems(v: Vehicle, kind?: PartKind): PartItem[] {
  return v.items
    .filter((it): it is PartItem => it.kind === 'part' && isMounted(v.chassisId, it))
    .filter((it) => !kind || partDef(it.part.defId).kind === kind)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function mountedParts(v: Vehicle, kind?: PartKind): PartInstance[] {
  return mountedItems(v, kind).map((it) => it.part);
}

// Built-in parts of one role, such as the four wheels.
export function coreParts(v: Vehicle, role: CoreDef['role']): PartInstance[] {
  return mountedParts(v, 'core').filter((p) => (partDef(p.defId) as CoreDef).role === role);
}

// The one built-in part of a role, such as the cab. Throws if the truck has none or several.
export function corePart(v: Vehicle, role: CoreDef['role']): PartInstance {
  const parts = coreParts(v, role);
  if (parts.length !== 1) throw new Error(`${v.id} has ${parts.length} mounted ${role} parts, expected 1`);
  return parts[0];
}

export function goodsCount(v: Vehicle): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of v.items) if (it.kind === 'good') out[it.good] = (out[it.good] ?? 0) + 1;
  return out;
}

export function cellCount(g: Grid): number {
  return g.cells.flat().filter((c) => c !== null).length;
}

export function freeCells(v: Vehicle): number {
  const used = v.items.reduce((a, it) => a + itemCells(it).length, 0);
  return cellCount(gridOf(v)) - used;
}

// Why an item cannot sit at (x, y, rot), or null if it can. ignoreId skips the item being moved.
export function placementError(g: Grid, items: GridItem[], item: GridItem, ignoreId: string | null): string | null {
  const taken = new Set<string>();
  for (const it of items) if (it.id !== ignoreId) for (const c of itemCells(it)) taken.add(`${c.x},${c.y}`);
  for (const c of itemCells(item)) {
    if (c.x < 0 || c.y < 0 || c.x >= g.w || c.y >= g.h || g.cells[c.y][c.x] === null) return 'Does not fit there';
    if (taken.has(`${c.x},${c.y}`)) return 'Something is in the way';
  }
  return null;
}

// First free spot in reading order. With mount letters given, only spots fully on one letter count,
// and earlier letters win. Without them, plain cells are tried before mount cells so mounts stay free,
// and spots fully on one avoid letter are skipped, so a stowed spare never mounts by accident.
export function findSpot(g: Grid, items: GridItem[], item: GridItem, mount: Cell[] | null, avoid: Cell[] | null): Spot | null {
  const tries: Spot[] = [];
  for (const rot of [0, 1] as const) for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) tries.push({ x, y, rot });
  const fits = (s: Spot) => placementError(g, items, { ...item, ...s }, item.id) === null;
  const onlyOn = (s: Spot, cell: Cell) => itemCells({ ...item, ...s }).every((c) => g.cells[c.y]?.[c.x] === cell);
  if (mount) {
    for (const letter of mount) {
      const spot = tries.find((s) => fits(s) && onlyOn(s, letter));
      if (spot) return spot;
    }
    return null;
  }
  const allowed = (s: Spot) => fits(s) && !(avoid && avoid.some((a) => onlyOn(s, a)));
  return tries.find((s) => allowed(s) && onlyOn(s, '.')) ?? tries.find(allowed) ?? null;
}
