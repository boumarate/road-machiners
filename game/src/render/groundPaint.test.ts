import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { groundDiscs } from './groundPaint';

describe('ground discs', () => {
  it('paints the Fallen Sun its disc and the outlined Old Orchard none', () => {
    const ids = groundDiscs().map((d) => d.id);
    expect(ids).toContain('fallen-sun');
    expect(ids).not.toContain('orchard');
    const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
    expect(groundDiscs().find((d) => d.id === 'fallen-sun')!.radius).toBe(sun.radius + 0.5);
  });
});
