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

// The chassis with too little room between the wheels for full size parts. They carry compact ones instead.
const COMPACT_CORE: Record<string, string[]> = { buggy: ['transmissionMini', 'tankMini'] };
const COMPACT_IDS = Object.values(COMPACT_CORE).flat();

// Chassis with no free block of deck cells of the size, since their cores fill the low places of the model. See the
// layout comments in src/data/chassis.ts for where each core lies.
const NO_BLOCK_2X2 = ['scout', 'buggy', 'wagon', 'courier', 'jeep', 'convertible'];
const NO_BLOCK_2X3 = ['wagon', 'convertible'];

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

  it('gives every transmission 2 by 2 cells, except the compact one', () => {
    for (const p of parts.filter((d) => d.kind === 'core' && d.role === 'transmission')) {
      expect([p.w, p.h], p.id).toEqual(COMPACT_IDS.includes(p.id) ? [1, 1] : [2, 2]);
    }
  });

  it('gives every fuel tank two cells along the truck, except the compact one', () => {
    for (const p of parts.filter((d) => d.kind === 'core' && d.role === 'tank')) {
      expect([p.w, p.h], p.id).toEqual(COMPACT_IDS.includes(p.id) ? [1, 1] : [1, 2]);
    }
  });

  it('gives every engine at least 2 by 2 cells', () => {
    for (const p of parts.filter((d) => d.kind === 'engine')) {
      expect(p.w, p.id).toBeGreaterThanOrEqual(2);
      expect(p.h, p.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses the compact parts only on the chassis that list them', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const used = c.core.map((k) => k.defId).filter((d) => COMPACT_IDS.includes(d)).sort();
      expect(used, id).toEqual([...(COMPACT_CORE[id] ?? [])].sort());
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
  it('keeps a free 2 by 2 block of deck cells on every chassis but the listed ones', () => {
    for (const [id, c] of Object.entries(CHASSIS)) expect(hasDeckBlock(c, 2, 2), id).toBe(!NO_BLOCK_2X2.includes(id));
  });

  it('keeps a free 2 across by 3 along block of deck cells on every tier 2 and 3 chassis but the listed ones', () => {
    for (const [id, c] of Object.entries(CHASSIS).filter(([, ch]) => ch.tier >= 2)) expect(hasDeckBlock(c, 2, 3), id).toBe(!NO_BLOCK_2X3.includes(id));
  });
});
