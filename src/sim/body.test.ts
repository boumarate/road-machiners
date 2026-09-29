import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { bodyOf, cellCenter } from './body';

describe('body from the chassis grid', () => {
  it('sizes the scout from its 5 by 8 grid', () => {
    const b = bodyOf('scout');
    expect(b.half.x).toBeCloseTo(2.6);
    expect(b.half.z).toBeCloseTo(1.21);
  });

  it('puts the scout wheel mounts on the edge columns of its wheel rows', () => {
    const b = bodyOf('scout');
    const front = cellCenter('scout', 0, 1);
    const rear = cellCenter('scout', 4, 6);
    expect(b.wheelX).toBeCloseTo(front.x);
    expect(b.wheelZ).toBeCloseTo(-front.z);
    expect(-b.wheelX).toBeCloseTo(rear.x);
    expect(b.wheelZ).toBeCloseTo(rear.z);
  });

  it('keeps every wheel core one cell inside the edge column', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const w = Math.max(...c.layout.map((r) => r.length));
      const wheels = c.core.filter((core) => core.defId.startsWith('wheel'));
      expect(wheels.map((core) => core.x).sort(), id).toEqual([1, 1, w - 2, w - 2].sort());
    }
  });

  it('gives the nose-left cell center in body meters', () => {
    const c = cellCenter('scout', 0, 0);
    expect(c.x).toBeCloseTo(2.6 - PHYSICS.cell.along / 2);
    expect(c.z).toBeCloseTo(-1.21 + PHYSICS.cell.across / 2);
  });

  it('derives every chassis from its grid', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const b = bodyOf(id);
      const cols = Math.max(...c.layout.map((r) => r.length));
      expect(b.half.x).toBeCloseTo((c.layout.length * PHYSICS.cell.along) / 2);
      expect(b.half.z).toBeCloseTo((cols * PHYSICS.cell.across) / 2);
      expect(b.half.y).toBe(PHYSICS.bodies[c.look].halfHeight);
    }
  });
});
