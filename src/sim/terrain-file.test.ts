import { describe, expect, it } from 'vitest';
import { MAPGEN } from '../data/terrain';
import { newDraft, typeCode, type MapDraft } from '../mapgen/bake';
import { decodeMap, encodeMap } from './terrain';

// A 3 x 3 tile draft with distinct heights, types and two rocks.
function smallDraft(): MapDraft {
  const d = newDraft(3);
  d.heights.forEach((_, k) => (d.heights[k] = k * 0.25 - 2));
  d.types.set([typeCode('road'), typeCode('sand'), typeCode('ash'), typeCode('scree'), typeCode('mud'), typeCode('hardpan'), typeCode('gravel'), typeCode('scrub'), typeCode('asphalt')]);
  d.rocks = [{ pos: { x: 1.5, y: 2.25 }, r: 0.75 }, { pos: { x: 0.5, y: 0.5 }, r: 1.25 }];
  return d;
}

describe('map file', () => {
  it('round-trips heights, types, rocks and the map seed', () => {
    const map = decodeMap(encodeMap(smallDraft(), 42));

    expect(map.seed).toBe(42);
    expect(map.terrain.size).toBe(3);
    expect(map.terrain.heights).toEqual(Array.from(smallDraft().heights));
    expect(map.terrain.types).toEqual(['road', 'sand', 'ash', 'scree', 'mud', 'hardpan', 'gravel', 'scrub', 'asphalt']);
    expect(map.rocks).toEqual(smallDraft().rocks);
  });

  it('rounds heights to the stored step', () => {
    const d = smallDraft();
    d.heights[0] = 1.23456;

    expect(decodeMap(encodeMap(d, 1)).terrain.heights[0]).toBe(Math.round(1.23456 * MAPGEN.heightScale) / MAPGEN.heightScale);
  });

  it('gives the same bytes and hash for the same draft', () => {
    const a = encodeMap(smallDraft(), 1);
    const b = encodeMap(smallDraft(), 1);

    expect(a).toEqual(b);
    expect(decodeMap(a).hash).toBe(decodeMap(b).hash);
  });

  it('changes the hash when one byte changes', () => {
    const bytes = encodeMap(smallDraft(), 1);
    const changed = bytes.slice();
    changed[changed.length - 1] ^= 1;

    expect(decodeMap(changed).hash).not.toBe(decodeMap(bytes).hash);
  });

  it('refuses a height the file cannot store', () => {
    const d = smallDraft();
    d.heights[4] = 40000 / MAPGEN.heightScale;

    expect(() => encodeMap(d, 1)).toThrow(/height/i);
  });

  it('refuses a file with a bad magic, version or length', () => {
    const bytes = encodeMap(smallDraft(), 1);
    const badMagic = bytes.slice();
    badMagic[0] = 0;
    const badVersion = bytes.slice();
    badVersion[4] += 1;

    expect(() => decodeMap(badMagic)).toThrow(/magic/i);
    expect(() => decodeMap(badVersion)).toThrow(/version/i);
    expect(() => decodeMap(bytes.slice(0, bytes.length - 1))).toThrow(/length/i);
    expect(() => decodeMap(new Uint8Array([...bytes, 0]))).toThrow(/length/i);
    expect(() => decodeMap(bytes.slice(0, 6))).toThrow(/length/i);
  });

  it('refuses a file with an unknown ground type', () => {
    const d = smallDraft();
    const bytes = encodeMap(d, 1);
    const heightsEnd = bytes.length - 4 - d.rocks.length * 12;
    bytes[heightsEnd - 1] = 250;

    expect(() => decodeMap(bytes)).toThrow(/ground type/i);
  });
});
