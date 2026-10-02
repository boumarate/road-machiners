import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import type { TerrainTypeId } from '../data/terrain';
import { desertWeight, groundDiscs } from './groundPaint';

describe('desertWeight', () => {
  it('keeps farmland, old highways, hull plating, pools and the orchard marks out of the warm patches', () => {
    const kept: TerrainTypeId[] = ['field', 'asphalt', 'ash', 'saltCrust', 'mud', 'dirtyWater', 'toxic', 'hull', 'track', 'canal', 'concrete'];
    for (const type of kept) expect(desertWeight(type), type).toBe(0);
  });

  it('warms open desert ground, hardpan the most', () => {
    expect(desertWeight('hardpan')).toBe(1);
    for (const type of ['sand', 'scrub', 'gravel', 'scree'] as const) {
      expect(desertWeight(type), type).toBeGreaterThan(0);
      expect(desertWeight(type), type).toBeLessThan(1);
    }
  });

  it('weighs road tiles like the hardpan they paint as', () => {
    expect(desertWeight('road')).toBe(desertWeight('hardpan'));
  });
});

describe('ground discs', () => {
  it('paints the Fallen Sun its disc and the outlined Old Orchard none', () => {
    const ids = groundDiscs().map((d) => d.id);
    expect(ids).toContain('fallen-sun');
    expect(ids).not.toContain('orchard');
    const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
    expect(groundDiscs().find((d) => d.id === 'fallen-sun')!.radius).toBe(sun.radius + 0.5);
  });
});
