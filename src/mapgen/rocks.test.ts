import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { MAPGEN, TERRAIN } from '../data/terrain';
import { ROAD_INDEX } from '../sim/road-index';
import { decodeMap, isCliff, tileAt, type BakedMap, type Rock } from '../sim/terrain';
import { dist, segmentDist } from '../sim/vec';
import { newDraft, rockLayer, type MapDraft } from './bake';

const SIZE = REGION.size;
const O = REGION.obstacles;
const SITES = [...REGION.towns, ...REGION.locations];

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

// A full map draft: a high plateau west of FOOT - FACE, a cliff face falling to x = FOOT, and flat ground east of it.
const FOOT = 300;
const FACE = 10;
const RISE = TERRAIN.drive.maxSlope * 2;

function cliffDraft(): MapDraft {
  const d = newDraft(SIZE);
  const n = SIZE + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) d.heights[j * n + i] = Math.min(FACE, Math.max(0, FOOT - i)) * RISE;
  return d;
}

describe('boulders', () => {
  it('puts boulders along the foot of a cliff', () => {
    const d = rockLayer(1337, cliffDraft());

    const atFoot = d.rocks.filter((rock) => rock.pos.x >= FOOT && rock.pos.x < FOOT + 1);
    expect(atFoot.length).toBeGreaterThan(10);
  });

  it('puts no boulder on the cliff face or on the flat ground away from it', () => {
    const d = rockLayer(1337, cliffDraft());

    const onFace = d.rocks.filter((rock) => rock.pos.x >= FOOT - FACE && rock.pos.x < FOOT);
    const away = d.rocks.filter((rock) => rock.pos.x > FOOT + 1 || rock.pos.x < FOOT - FACE - 1);
    expect(onFace).toEqual([]);
    expect(away).toEqual([]);
  });

  it('puts no boulder on flat ground', () => {
    const d = rockLayer(1337, newDraft(SIZE));

    expect(d.rocks).toEqual([]);
  });

  it('keeps every boulder clear of roads, sites, the bridge, the margin and other rocks', () => {
    const d = rockLayer(1337, cliffDraft());

    expectClear(d.rocks);
  });

  it('places the same boulders for the same seed', () => {
    const a = rockLayer(1337, cliffDraft());
    const b = rockLayer(1337, cliffDraft());

    expect(a.rocks).toEqual(b.rocks);
  });
});

// The committed map file, inlined by Vite as base64 data, since the project carries no Node file typings.
const FILES = import.meta.glob<string>('/public/maps/*.bin', { query: '?url&inline', import: 'default', eager: true });
const DATA_URL = 'data:application/octet-stream;base64,';

function bakedMap(): BakedMap {
  const url = FILES[`/public/${MAPGEN.file}`];
  if (url === undefined || !url.startsWith(DATA_URL)) throw new Error(`Map file public/${MAPGEN.file} is missing or did not inline. Run npm run map:bake.`);
  return decodeMap(Uint8Array.from(atob(url.slice(DATA_URL.length)), (c) => c.charCodeAt(0)));
}

describe('boulders on the baked map', () => {
  const map = bakedMap();

  it('keeps every boulder clear of roads, sites, the bridge, the margin and other rocks', () => {
    expect(map.rocks.length).toBeGreaterThan(0);
    expectClear(map.rocks);
  });

  it('puts no boulder on a cliff tile', () => {
    const onCliff = map.rocks.filter((rock) => isCliff(map.terrain, tileAt(map.terrain, rock.pos)));

    expect(onCliff).toEqual([]);
  });
});
