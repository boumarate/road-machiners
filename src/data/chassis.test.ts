import { describe, expect, it } from 'vitest';
import { CHASSIS, type ChassisDef } from './chassis';
import { partDef } from './parts';

type Cell = { x: number; y: number };

const ARMOR = 'FBLR';

function letterAt(c: ChassisDef, x: number, y: number): string {
  return c.layout[y]?.[x] ?? ' ';
}

function engineCells(c: ChassisDef): Cell[] {
  return c.layout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === 'E' ? [{ x, y }] : [])));
}

function coreCells(c: ChassisDef, role: string): Cell[] {
  return c.core.flatMap((core) => {
    const def = partDef(core.defId);
    if (def.kind !== 'core' || def.role !== role) return [];
    const w = core.rot === 1 ? def.h : def.w;
    const h = core.rot === 1 ? def.w : def.h;
    return Array.from({ length: w * h }, (_, i) => ({ x: core.x + (i % w), y: core.y + Math.floor(i / w) }));
  });
}

// The armor letters of the cells next to the given cells.
function armorTouched(c: ChassisDef, cells: Cell[]): Set<string> {
  const touched = new Set<string>();
  for (const { x, y } of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const letter = letterAt(c, x + dx, y + dy);
      if (ARMOR.includes(letter)) touched.add(letter);
    }
  }
  return touched;
}

// The hood hole of these engines lies on the row behind the front armor row, so the front gap cannot exist.
const FRONT_ENGINE: readonly string[] = ['longbed', 'tractor'];

describe('chassis grids', () => {
  it('keeps every armor column outside the model and every armor row full width', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const w = c.layout[0].length;
      const last = c.layout.length - 1;
      expect(c.layout[0], id).toBe(` ${'F'.repeat(w - 2)} `);
      expect(c.layout[last], id).toBe(` ${'B'.repeat(w - 2)} `);
      for (const row of c.layout.slice(1, last)) {
        expect(row.length, id).toBe(w);
        expect(row[0] + row[w - 1], id).toBe('LR');
        expect(row.slice(1, -1), id).not.toMatch(/[FBLR ]/);
      }
    }
  });

  it('puts the wheels on the model edge columns, one column in from the side armor', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const w = c.layout[0].length;
      const wheels = coreCells(c, 'wheel');
      expect(wheels.map((cell) => cell.x).sort(), id).toEqual([1, 1, w - 2, w - 2].sort());
    }
  });

  it('marks exactly the cells of the core parts as built-in', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const core = c.core.flatMap((part) => coreCells(c, partDef(part.defId).kind === 'core' ? (partDef(part.defId) as { role: string }).role : ''));
      const marked = c.layout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === 'X' ? [`${x},${y}`] : [])));
      expect(new Set(core.map((cell) => `${cell.x},${cell.y}`)), id).toEqual(new Set(marked));
    }
  });

  it('lets a tier 2 engine touch armor cells on one side at most', () => {
    for (const [id, c] of Object.entries(CHASSIS).filter(([, ch]) => ch.tier === 2)) {
      expect(armorTouched(c, engineCells(c)).size, id).toBeLessThanOrEqual(1);
    }
  });

  it('keeps a cell that is not armor between every tier 3 critical part and the armor', () => {
    for (const [id, c] of Object.entries(CHASSIS).filter(([, ch]) => ch.tier === 3)) {
      const allowed = FRONT_ENGINE.includes(id) ? new Set(['F']) : new Set<string>();
      expect([...armorTouched(c, engineCells(c))].filter((l) => !allowed.has(l)), `${id} engine`).toEqual([]);
      expect([...armorTouched(c, coreCells(c, 'cab'))], `${id} cab`).toEqual([]);
      expect([...armorTouched(c, coreCells(c, 'tank'))], `${id} tank`).toEqual([]);
    }
  });
});
