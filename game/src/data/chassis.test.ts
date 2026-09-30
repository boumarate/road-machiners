import { describe, expect, it } from 'vitest';
import { CHASSIS, type ChassisDef } from './chassis';
import { PARTS, partDef } from './parts';

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

// Chassis whose cab shares a column with a wheel, with the reason. A stale entry fails the test.
const CAB_BESIDE_WHEELS: Record<string, string> = {
  buggy: 'A small raider runabout. Its open 1x1 seat is not tall, and the grid has only 4 inner columns.',
  convertible: 'A small car with 5 inner columns. Clearing the wheels needs a wider grid with 7 more deck cells.',
};

const columns = (cells: Cell[]) => new Set(cells.map((cell) => cell.x));

describe('chassis grids', () => {
  it('keeps every cab out of the wheel columns', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const wheels = columns(coreCells(c, 'wheel'));
      const shared = [...columns(coreCells(c, 'cab'))].some((x) => wheels.has(x));
      expect(shared, id).toBe(id in CAB_BESIDE_WHEELS);
    }
  });

  it('puts every transmission in or next to a middle column', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const inner = c.layout[0].length - 2;
      const middle = inner % 2 ? [1 + (inner - 1) / 2] : [inner / 2, inner / 2 + 1];
      const near = coreCells(c, 'transmission').some((cell) => middle.some((m) => Math.abs(cell.x - m) <= 1));
      expect(near, id).toBe(true);
    }
  });

  it('keeps the scout worth what it was before its grid gained a column', () => {
    // 800 base plus the old modifier of 6 deck cells and 10 armor cells; the value of the old grid.
    expect(CHASSIS.scout.value).toBe(2444);
  });

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

  it('puts the wheels, two cells long each, one column in from the side armor', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const w = c.layout[0].length;
      const wheels = coreCells(c, 'wheel');
      expect(wheels.map((cell) => cell.x).sort(), id).toEqual([1, 1, 1, 1, w - 2, w - 2, w - 2, w - 2].sort());
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

// True when the layout has a w by h block of cells that carry only the letter D, w across and h along the truck.
function hasDeckBlock(c: ChassisDef, w: number, h: number): boolean {
  for (let y = 0; y + h <= c.layout.length; y++) {
    for (let x = 0; x + w <= c.layout[0].length; x++) {
      const cells = Array.from({ length: w * h }, (_, i) => letterAt(c, x + (i % w), y + Math.floor(i / w)));
      if (cells.every((ch) => ch === 'D')) return true;
    }
  }
  return false;
}

describe('core part sizes', () => {
  const parts = Object.values(PARTS);

  it('gives every transmission 2 by 2 cells', () => {
    for (const p of parts.filter((d) => d.kind === 'core' && d.role === 'transmission')) expect([p.w, p.h], p.id).toEqual([2, 2]);
  });

  it('gives every fuel tank two cells along the truck', () => {
    for (const p of parts.filter((d) => d.kind === 'core' && d.role === 'tank')) expect([p.w, p.h], p.id).toEqual([1, 2]);
  });

  it('gives every engine at least 2 by 2 cells', () => {
    for (const p of parts.filter((d) => d.kind === 'engine')) {
      expect(p.w, p.id).toBeGreaterThanOrEqual(2);
      expect(p.h, p.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every chassis an engine bay that holds the biggest engine', () => {
    const engines = parts.filter((d) => d.kind === 'engine');
    const w = Math.max(...engines.map((d) => d.w));
    const h = Math.max(...engines.map((d) => d.h));
    for (const [id, c] of Object.entries(CHASSIS)) {
      const bay = new Set(engineCells(c).map((cell) => `${cell.x},${cell.y}`));
      const fits = [...bay].some((key) => {
        const [x, y] = key.split(',').map(Number);
        return Array.from({ length: w * h }, (_, i) => `${x + (i % w)},${y + Math.floor(i / w)}`).every((k) => bay.has(k));
      });
      expect(fits, id).toBe(true);
    }
  });
});

describe('deck blocks for the bigger guns', () => {
  it('keeps a free 2 by 2 block of deck cells on every chassis', () => {
    for (const [id, c] of Object.entries(CHASSIS)) expect(hasDeckBlock(c, 2, 2), id).toBe(true);
  });

  it('keeps a free 2 across by 3 along block of deck cells on every tier 2 and 3 chassis', () => {
    for (const [id, c] of Object.entries(CHASSIS).filter(([, ch]) => ch.tier >= 2)) expect(hasDeckBlock(c, 2, 3), id).toBe(true);
  });
});

describe('shown cores', () => {
  it('shows the transmission and the tank on the junk-built trucks and hides them on the others', () => {
    const shown = Object.entries(CHASSIS).filter(([, c]) => c.showsCores).map(([id]) => id).sort();
    expect(shown).toEqual(['courier', 'scout', 'wagon']);
  });
});
