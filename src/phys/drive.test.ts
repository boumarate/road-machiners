import { beforeAll, describe, expect, it } from 'vitest';
import { emptyWorld } from '../sim/testkit';
import { buildDrive, freeDrive, initPhysics, simulateTurn, truckState, type Drive } from './drive';
import { angleDiff, dist } from '../sim/vec';

beforeAll(async () => {
  await initPhysics();
});

function turns(d: Drive, dest: { x: number; y: number } | null, n: number): Drive {
  let cur = d;
  for (let i = 0; i < n; i++) {
    const { next } = simulateTurn(cur, dest);
    freeDrive(cur);
    cur = next;
  }
  return cur;
}

describe('physics driving', () => {
  it('a new truck sits still on flat ground', () => {
    const d = buildDrive(emptyWorld(), { x: 30, y: 30 }, 0);
    const s = truckState(turns(d, null, 2));
    expect(dist(s.pos, { x: 30, y: 30 })).toBeLessThan(0.1);
    expect(s.speed).toBeLessThan(0.1);
  });

  it('drives to a point ahead and stops there', () => {
    const d = buildDrive(emptyWorld(), { x: 30, y: 30 }, 0);
    const s = truckState(turns(d, { x: 40, y: 30 }, 6));
    expect(dist(s.pos, { x: 40, y: 30 })).toBeLessThan(1.2);
  });

  it('turns toward a point to the side', () => {
    const d = buildDrive(emptyWorld(), { x: 30, y: 30 }, 0);
    const s = truckState(turns(d, { x: 36, y: 38 }, 6));
    expect(dist(s.pos, { x: 36, y: 38 })).toBeLessThan(1.2);
  });

  it('backs up to turn around toward a point behind', () => {
    const d = buildDrive(emptyWorld(), { x: 30, y: 30 }, 0);
    const s = truckState(turns(d, { x: 20, y: 31 }, 10));
    expect(dist(s.pos, { x: 20, y: 31 })).toBeLessThan(1.5);
    expect(Math.abs(angleDiff(s.heading, Math.PI))).toBeLessThan(Math.PI / 4); // it turned around, not backed the whole way
  });

  it('the same state and order give the same turn', () => {
    const d = buildDrive(emptyWorld(), { x: 30, y: 30 }, 0.3);
    const a = simulateTurn(d, { x: 38, y: 33 });
    const b = simulateTurn(d, { x: 38, y: 33 });
    expect(truckState(a.next)).toEqual(truckState(b.next));
    expect(Math.abs(angleDiff(truckState(d).heading, 0.3))).toBeLessThan(0.01);
  });
});
