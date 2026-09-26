import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { elevationAt } from './elevation';
import { newWorld } from './world';

describe('elevationAt', () => {
  it('is deterministic for the same seed and coordinates', () => {
    expect(elevationAt(7, 12.3, 40.1)).toBe(elevationAt(7, 12.3, 40.1));
  });

  it('differs between seeds', () => {
    expect(elevationAt(1, 30, 30)).not.toBe(elevationAt(2, 30, 30));
  });

  it('does not touch world.rngState', () => {
    const w = newWorld(3, START_KITS.standard);
    const before = w.rngState;
    elevationAt(w.seed, 20, 20);
    expect(w.rngState).toBe(before);
  });

  it('is flattened at town centers', () => {
    for (const town of REGION.towns) {
      expect(Math.abs(elevationAt(5, town.pos.x, town.pos.y))).toBeLessThan(0.01);
    }
  });

  it('is flattened along road centerlines', () => {
    const road = REGION.roads[0];
    const mid = { x: (road[0].x + road[1].x) / 2, y: (road[0].y + road[1].y) / 2 };
    expect(Math.abs(elevationAt(5, mid.x, mid.y))).toBeLessThan(0.01);
  });
});
