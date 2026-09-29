import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { bodyOf, cellCenter } from './body';

const modelWidth = (id: string) => CHASSIS[id].layout[0].length - 2;

describe('body from the base model', () => {
  it('sizes the scout from the bounds of its model boxes', () => {
    const b = bodyOf('scout');
    expect(b.half.x).toBeCloseTo(2.6);
    expect(b.half.z).toBeCloseTo(1.22);
  });

  it('puts the scout wheel mounts on the edge columns of its wheel rows', () => {
    const b = bodyOf('scout');
    const front = cellCenter('scout', 1, 1);
    const rear = cellCenter('scout', 5, 6);
    expect(b.wheelX).toBeCloseTo(front.x);
    expect(b.wheelZ).toBeCloseTo(-front.z);
    expect(-b.wheelX).toBeCloseTo(rear.x);
    expect(b.wheelZ).toBeCloseTo(rear.z);
  });

  it('maps inner columns onto the model columns and rows onto the model rows', () => {
    const first = cellCenter('scout', 1, 0);
    expect(first.x).toBeCloseTo(2.6 - PHYSICS.cell.along / 2);
    expect(first.z).toBeCloseTo(-2 * PHYSICS.cell.across);
    expect(cellCenter('scout', 5, 0).z).toBeCloseTo(2 * PHYSICS.cell.across);
  });

  it('puts the armor columns on the outer faces of the model', () => {
    for (const id of Object.keys(CHASSIS)) {
      const w = CHASSIS[id].layout[0].length;
      expect(cellCenter(id, 0, 1).z, id).toBeCloseTo(-bodyOf(id).half.z);
      expect(cellCenter(id, w - 1, 1).z, id).toBeCloseTo(bodyOf(id).half.z);
    }
  });

  it('keeps every collider box inside the chassis bottom and the roof limit', () => {
    for (const id of Object.keys(CHASSIS)) {
      const b = bodyOf(id);
      const roof = PHYSICS.truckRoof - (b.wheelRadius + PHYSICS.truck.suspensionRest - b.wheelY);
      expect(b.boxes.length, id).toBeGreaterThan(0);
      for (const box of b.boxes) {
        expect(box.at.y - box.half.y, id).toBeGreaterThanOrEqual(-b.half.y - 1e-9);
        expect(box.at.y + box.half.y, id).toBeLessThanOrEqual(roof + 1e-9);
      }
    }
  });

  it('derives every chassis length from its grid rows and its width from the model', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const b = bodyOf(id);
      expect(b.half.x).toBeGreaterThan(((c.layout.length - 0.5) * PHYSICS.cell.along) / 2);
      expect(b.half.x).toBeLessThanOrEqual((c.layout.length * PHYSICS.cell.along) / 2 + 0.01);
      expect(b.half.z).toBeGreaterThan(((modelWidth(id) - 0.5) * PHYSICS.cell.across) / 2);
      expect(b.half.z).toBeLessThanOrEqual((modelWidth(id) * PHYSICS.cell.across) / 2 + 0.01);
      expect(b.half.y).toBe(PHYSICS.bodies[c.look].halfHeight);
    }
  });
});
