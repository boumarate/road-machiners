import { describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { REGION } from '../data/region';
import type { TerrainTypeId } from '../data/terrain';
import type { Terrain } from '../sim/terrain';
import { newWorld } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { desertWeight, groundDiscs, lookTypes, type LookType } from './groundPaint';

describe('desertWeight', () => {
  it('keeps farmland, old highways, hull plating, pools and the orchard marks out of the warm sand and its patches', () => {
    const kept: LookType[] = ['field', 'asphalt', 'ash', 'saltCrust', 'mud', 'dirtyWater', 'toxic', 'hull', 'track', 'canal', 'concrete'];
    for (const type of kept) expect(desertWeight(type), type).toBe(0);
  });
});

// A 12x12 map with a road band six tiles wide down the middle, hardpan on its left and salt crust on its right.
function bandMap(): Terrain {
  const size = 12;
  const types: TerrainTypeId[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) types.push(x < 3 ? 'hardpan' : x < 9 ? 'road' : 'saltCrust');
  return { size, heights: new Array<number>((size + 1) ** 2).fill(0), types };
}

describe('lookTypes', () => {
  it('gives each half of a road the look of the ground on its side', () => {
    const t = bandMap();
    const look = lookTypes(t);
    expect(look).not.toContain('road');
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
      const i = y * t.size + x;
      const want = x < 6 ? 'hardpan' : 'saltCrust';
      expect(look[i], `${x},${y}`).toBe(t.types[i] === 'road' ? want : t.types[i]);
    }
  });

  it('gives a map that is all road the hardpan look road tiles paint as', () => {
    const t: Terrain = { ...bandMap(), types: new Array<TerrainTypeId>(144).fill('road') };
    expect(new Set(lookTypes(t))).toEqual(new Set(['hardpan']));
  });

  it('gives the same look on every call', () => {
    const t = bandMap();
    expect([...lookTypes({ ...t })]).toEqual([...lookTypes(t)]);
  });

  it('gives road tiles beside ground without a desert look no desert look', () => {
    const t = newWorld(1337, START_KITS.standard, TEST_MAP).terrain;
    const look = lookTypes(t);
    let checked = 0;
    for (let y = 1; y < t.size - 1; y++) for (let x = 1; x < t.size - 1; x++) {
      const i = y * t.size + x;
      if (t.types[i] !== 'road') continue;
      const off = [i - 1, i + 1, i - t.size, i + t.size].filter((n) => t.types[n] !== 'road');
      if (off.length === 0 || off.some((n) => desertWeight(look[n]) > 0)) continue;
      checked++;
      expect(desertWeight(look[i]), `${x},${y}`).toBe(0);
    }
    expect(checked).toBeGreaterThan(50);
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
