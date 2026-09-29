import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { elevationAt } from './elevation';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';

describe('elevationAt', () => {
  it('is deterministic for the same seed and coordinates', () => {
    expect(elevationAt(7, 12.3, 40.1)).toBe(elevationAt(7, 12.3, 40.1));
  });

  it('differs between seeds', () => {
    expect(elevationAt(1, 30, 30)).not.toBe(elevationAt(2, 30, 30));
  });

  it('does not touch world.rngState', () => {
    const w = newWorld(3, START_KITS.standard, TEST_MAP);
    const before = w.rngState;
    elevationAt(w.seed, 20, 20);
    expect(w.rngState).toBe(before);
  });

  it('levels town floors at their local terrain height', () => {
    for (const town of REGION.towns) {
      const floor = elevationAt(5, town.pos.x, town.pos.y);
      expect(elevationAt(5, town.pos.x + 1, town.pos.y)).toBeCloseTo(floor);
      expect(elevationAt(5, town.pos.x, town.pos.y + 1)).toBeCloseTo(floor);
    }
  });

  it('retains broad rises and falls along roads', () => {
    const samples = REGION.roads[0].map((p) => elevationAt(5, p.x, p.y));
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
  });
});
