import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import BASELINE from './body-baseline.json';
import { bodyOf, cellCenter, cellRect, engineAnchor, lanesAt, surfaceAt } from './body';
import { baseGrid } from './grid';

const ids = Object.keys(CHASSIS);
const cellsOf = (id: string, letter: string) => CHASSIS[id].layout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === letter ? [{ x, y }] : [])));

describe('body from the base model', () => {
  it('sizes the scout from the bounds of its model boxes', () => {
    const b = bodyOf('scout');
    expect(b.half.x).toBeCloseTo(2.6);
    expect(b.half.z).toBeCloseTo(1.22);
  });

  it('keeps half extents, boxes and wheel mounts of every chassis at the values recorded before the grid split', () => {
    expect(Object.keys(BASELINE).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const was = BASELINE[id as keyof typeof BASELINE];
      const b = bodyOf(id);
      expect(b.half.x, id).toBeCloseTo(was.half.x, 6);
      expect(b.half.y, id).toBeCloseTo(was.half.y, 6);
      expect(b.half.z, id).toBeCloseTo(was.half.z, 6);
      expect(b.wheelX, id).toBeCloseTo(was.wheelX, 6);
      expect(b.wheelZ, id).toBeCloseTo(was.wheelZ, 6);
      expect(b.boxes.length, id).toBe(was.boxes.length);
      b.boxes.forEach((box, i) => {
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(box.at[axis], `${id} box ${i}`).toBeCloseTo(was.boxes[i].at[axis], 6);
          expect(box.half[axis], `${id} box ${i}`).toBeCloseTo(was.boxes[i].half[axis], 6);
        }
      });
    }
  });

  it('keeps every collider box inside the chassis bottom and the roof limit', () => {
    for (const id of ids) {
      const b = bodyOf(id);
      const roof = PHYSICS.truckRoof - (b.wheelRadius + PHYSICS.truck.suspensionRest - b.wheelY);
      expect(b.boxes.length, id).toBeGreaterThan(0);
      for (const box of b.boxes) {
        expect(box.at.y - box.half.y, id).toBeGreaterThanOrEqual(-b.half.y - 1e-9);
        expect(box.at.y + box.half.y, id).toBeLessThanOrEqual(roof + 1e-9);
      }
    }
  });
});

describe('grid projection', () => {
  it('spreads inner cells evenly over the model, close to a 0.484 by 0.65 m cell', () => {
    for (const id of ids) {
      const { w, h } = baseGrid(id);
      const { half } = bodyOf(id);
      const first = cellCenter(id, 1, 1);
      const next = cellCenter(id, 2, 2);
      expect(first.x - next.x, id).toBeCloseTo((2 * half.x) / h, 9);
      expect(next.z - first.z, id).toBeCloseTo((2 * half.z) / (w - 2), 9);
      expect(Math.abs((2 * half.x) / h - PHYSICS.cell.along), id).toBeLessThan(0.02);
      expect(Math.abs((2 * half.z) / (w - 2) - PHYSICS.cell.across), id).toBeLessThan(0.02);
    }
  });

  it('puts the side armor columns on the side faces and the first and last rows on the nose and tail faces', () => {
    for (const id of ids) {
      const { w, h } = baseGrid(id);
      const { half } = bodyOf(id);
      const left = cellRect(id, [{ x: 0, y: 2 }]);
      expect(left.z0, id).toBeCloseTo(-half.z);
      expect(left.z1, id).toBeCloseTo(-half.z);
      expect(left.x1 - left.x0, id).toBeGreaterThan(0);
      const right = cellRect(id, [{ x: w - 1, y: 2 }]);
      expect(right.z0, id).toBeCloseTo(half.z);
      expect(right.z1, id).toBeCloseTo(half.z);
      const nose = cellRect(id, [{ x: 2, y: 0 }]);
      expect(nose.x0, id).toBeCloseTo(half.x);
      expect(nose.x1, id).toBeCloseTo(half.x);
      expect(nose.z1 - nose.z0, id).toBeGreaterThan(0);
      const tail = cellRect(id, [{ x: 2, y: h - 1 }]);
      expect(tail.x0, id).toBeCloseTo(-half.x);
      expect(tail.x1, id).toBeCloseTo(-half.x);
    }
  });

  it('projects the union of several cells', () => {
    const one = cellRect('scout', [{ x: 2, y: 2 }]);
    const two = cellRect('scout', [{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(two.x1).toBeCloseTo(one.x1);
    expect(two.z0).toBeCloseTo(one.z0);
    expect(two.x0).toBeLessThan(one.x0);
    expect(two.z1).toBeGreaterThan(one.z1);
  });

  it('rejects a cell outside the grid', () => {
    expect(() => cellCenter('scout', 7, 0)).toThrow(/outside/);
  });

  it('finds the lanes a stretch of the edge crosses, clamped to the grid', () => {
    const { half } = bodyOf('scout');
    expect(lanesAt('scout', 'column', -0.1, 0.1)).toEqual([3]);
    expect(lanesAt('scout', 'column', -half.z - 1, half.z + 1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(lanesAt('scout', 'row', half.x - 0.01, half.x - 0.02)).toEqual([0]);
    expect(lanesAt('scout', 'row', 100, -100)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('model surface', () => {
  it('takes the highest point under the whole rect', () => {
    const rect = cellRect('scout', [{ x: 3, y: 1 }, { x: 3, y: 4 }]);
    const parts = [1, 2, 3, 4].map((y) => surfaceAt('scout', cellRect('scout', [{ x: 3, y }])));
    expect(surfaceAt('scout', rect)).toBeCloseTo(Math.max(...parts));
  });

  it('throws when the model has nothing under the rect', () => {
    expect(() => surfaceAt('scout', { x0: 50, x1: 51, z0: 0, z1: 1 })).toThrow(/no surface/);
  });

  it('gives an engine anchor inside the model outline', () => {
    for (const id of ids) {
      const a = engineAnchor(id);
      const { half } = bodyOf(id);
      expect(Math.abs(a.x), id).toBeLessThan(half.x);
      expect(Math.abs(a.z), id).toBeLessThan(half.z);
    }
  });
});

describe('grid and model correspondence', () => {
  it('projects the engine cells into the half of the truck that holds the engine anchor', () => {
    for (const id of ids) {
      const anchor = engineAnchor(id);
      for (const c of cellsOf(id, 'E')) {
        const at = cellCenter(id, c.x, c.y);
        expect(Math.sign(at.x) * Math.sign(anchor.x) >= 0, `${id} engine cell ${c.x},${c.y} is in the wrong half along the truck`).toBe(true);
      }
    }
  });

  it('projects each wheel core into its corner of the truck', () => {
    for (const id of ids) {
            const wheels = CHASSIS[id].core.filter((c) => c.defId.includes('wheel'));
      expect(wheels.length, id).toBe(4);
      const corners = new Set<string>();
      for (const c of wheels) {
        const at = cellCenter(id, c.x, c.y);
        const corner = `${Math.sign(at.x)},${Math.sign(at.z)}`;
        expect(Math.abs(at.x), `${id} wheel cell ${c.x},${c.y} is at the middle of the truck`).toBeGreaterThan(0.05);
        expect(Math.abs(at.z), `${id} wheel cell ${c.x},${c.y} is at the middle of the truck`).toBeGreaterThan(0.05);
        corners.add(corner);
      }
      expect(corners.size, `${id} wheel cells do not fill four corners`).toBe(4);
    }
  });

  it('projects every inner cell inside the model outline', () => {
    for (const id of ids) {
      const { w, h } = baseGrid(id);
      const { half } = bodyOf(id);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (CHASSIS[id].layout[y][x] === ' ') continue;
          const rect = cellRect(id, [{ x, y }]);
          const inside = rect.x0 >= -half.x - 1e-9 && rect.x1 <= half.x + 1e-9 && rect.z0 >= -half.z - 1e-9 && rect.z1 <= half.z + 1e-9;
          expect(inside, `${id} cell ${x},${y} projects outside the model outline`).toBe(true);
          expect(() => surfaceAt(id, rect), `${id} cell ${x},${y} has no model surface under it`).not.toThrow();
        }
      }
    }
  });
});
