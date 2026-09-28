import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { ROAD_INDEX } from '../sim/road-index';
import { buildTerrain } from '../sim/terrain';
import { newDraft } from './bake';
import { TYPE_IDS } from '../sim/terrain';
import { groundLayer, pickType } from './bake';

const SEED = 1337;
const SIZE = REGION.size;

// A draft with flat ground, with a slope along x of `slope` height units per tile on every tile.
function tilted(slope: number): Float32Array {
  const heights = new Float32Array((SIZE + 1) * (SIZE + 1));
  for (let j = 0; j <= SIZE; j++) for (let i = 0; i <= SIZE; i++) heights[j * (SIZE + 1) + i] = i * slope;
  return heights;
}

describe('ground types', () => {
  it('gives the same types as the seed-built terrain from the same heights', () => {
    const terrain = buildTerrain(SEED, SIZE);
    const draft = newDraft(SIZE);
    draft.heights.set(terrain.heights);

    groundLayer(SEED, draft);

    const types = Array.from(draft.types, (code) => TYPE_IDS[code]);
    expect(types).toEqual(terrain.types);
  });

  it('makes a road tile road even on steep ground', () => {
    const [x, y] = [Math.floor(REGION.roads[0][1].x), Math.floor(REGION.roads[0][1].y)];

    expect(pickType(SEED, tilted(2), SIZE, x, y)).toBe('road');
  });

  it('makes town ground off its roads hardpan even on steep ground', () => {
    const town = REGION.towns[0];
    const off = [-0.5, 0.5].flatMap((dx) => [-0.5, 0.5].map((dy) => ({ x: Math.floor(town.pos.x + dx * town.radius), y: Math.floor(town.pos.y + dy * town.radius) })));
    const tile = off.find((t) => ROAD_INDEX.nearestWithin(t.x + 0.5, t.y + 0.5, Infinity) > REGION.roadWidth);
    if (!tile) throw new Error('Every probe tile in the town lies on a road');

    expect(pickType(SEED, tilted(2), SIZE, tile.x, tile.y)).toBe('hardpan');
  });

  it('makes steep ground away from roads and sites scree, and flat ground not', () => {
    const spot = { x: 5, y: 300 };

    expect(pickType(SEED, tilted(0.5), SIZE, spot.x, spot.y)).toBe('scree');
    expect(pickType(SEED, tilted(0), SIZE, spot.x, spot.y)).not.toBe('scree');
  });
});
