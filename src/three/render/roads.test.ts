import { describe, expect, it } from 'vitest';
import { REGION, scalePoint } from '../../data/region';
import { dist } from '../../sim/vec';
import { junctions } from './roads';

describe('road junctions', () => {
  const found = junctions(REGION.roads);

  it('finds where the Kiln track leaves the South Lock road', () => {
    const fork = scalePoint({ x: 55, y: 80 });
    expect(found.some((p) => dist(p, fork) < REGION.roadWidth)).toBe(true);
  });

  it('puts no crossing patch inside a site, where roads meet under the site itself', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    for (const p of found) expect(sites.some((s) => dist(s.pos, p) < s.radius)).toBe(false);
  });

  it('finds crossings of two lines that cross mid-stretch', () => {
    const crossing = junctions([
      [{ x: 100, y: 100 }, { x: 140, y: 100 }],
      [{ x: 120, y: 80 }, { x: 120, y: 120 }],
    ]);
    expect(crossing).toHaveLength(1);
    expect(dist(crossing[0], { x: 120, y: 100 })).toBeLessThan(1);
  });
});
