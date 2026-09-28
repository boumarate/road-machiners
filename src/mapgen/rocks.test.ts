import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { ROAD_INDEX } from '../sim/road-index';
import { dist, segmentDist } from '../sim/vec';
import { newDraft } from './bake';
import type { Rock } from '../sim/terrain';
import { rockLayer, scatterRocks } from './bake';

const SIZE = REGION.size;
const O = REGION.obstacles;
const SITES = [...REGION.towns, ...REGION.locations];

function flatHeights(): Float32Array {
  return new Float32Array((SIZE + 1) * (SIZE + 1));
}

// Every rock off roads, sites, the bridge deck and the map margin, and apart from every other rock.
function expectClear(rocks: Rock[]): void {
  const bridge = TERRAIN.features.bridge;
  for (const rock of rocks) {
    const { x, y } = rock.pos;
    expect(Math.min(x, y, SIZE - x, SIZE - y)).toBeGreaterThanOrEqual(O.edgeMargin);
    expect(ROAD_INDEX.nearestWithin(x, y, Infinity)).toBeGreaterThanOrEqual(REGION.roadWidth / 2 + O.roadClearance + rock.r);
    for (const site of SITES) expect(dist(rock.pos, site.pos)).toBeGreaterThan(site.radius + O.siteClearance + rock.r);
    expect(segmentDist(rock.pos, bridge.from, bridge.to)).toBeGreaterThanOrEqual(bridge.width / 2 + rock.r);
  }
  for (let a = 0; a < rocks.length; a++) for (let b = a + 1; b < rocks.length; b++) {
    expect(dist(rocks[a].pos, rocks[b].pos)).toBeGreaterThanOrEqual(rocks[a].r + rocks[b].r + O.gap);
  }
}

describe('rock clusters', () => {
  it('keeps every rock clear of roads, sites, the bridge, the margin and other rocks', () => {
    const rocks = scatterRocks({ rngState: 1337 }, SIZE, flatHeights());

    expect(rocks.length).toBeGreaterThan(O.clusters);
    expectClear(rocks);
  });

  it('puts no rock on a cliff', () => {
    // Cliffs west of the middle, flat ground east of it.
    const heights = flatHeights();
    const half = SIZE / 2;
    for (let j = 0; j <= SIZE; j++) for (let i = 0; i <= half; i++) heights[j * (SIZE + 1) + i] = (half - i) * TERRAIN.drive.maxSlope * 2;

    const rocks = scatterRocks({ rngState: 1337 }, SIZE, heights);

    expect(rocks.some((rock) => rock.pos.x > half)).toBe(true);
    expect(rocks.filter((rock) => rock.pos.x < half)).toEqual([]);
  });

  it('places the same rocks for the same seed', () => {
    const a = rockLayer(1337, newDraft(SIZE));
    const b = rockLayer(1337, newDraft(SIZE));

    expect(a.rocks).toEqual(b.rocks);
  });
});
