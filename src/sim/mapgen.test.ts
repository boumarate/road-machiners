import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { isDriveObstacle } from './mapgen';
import { ROAD_INDEX } from './road-index';
import type { Obstacle } from './types';
import { dist } from './vec';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';
import type { BakedMap } from './terrain';

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;
const landmarksOf = (seed: number): Landmark[] => newWorld(seed, START_KITS.standard, TEST_MAP).obstacles.filter((o): o is Landmark => o.kind === 'landmark');

describe('roadside landmarks', () => {
  const landmarks = landmarksOf(1337);

  it('lines the roads of every area with its own landmark', () => {
    for (const def of REGION.landmarks) {
      const own = landmarks.filter((o) => o.look === def.look);
      expect(own.length).toBeGreaterThanOrEqual(3);
      for (const o of own) expect(dist(o.pos, def.center)).toBeLessThan(def.radius + REGION.roadWidth + o.r);
    }
  });

  it('keeps every landmark off every road surface and out of every site', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    for (const o of landmarks) {
      const reach = REGION.roadWidth / 2 + o.r;
      expect(ROAD_INDEX.nearestWithin(o.pos.x, o.pos.y, reach)).toBe(Infinity);
      expect(sites.every((s) => dist(o.pos, s.pos) > s.radius + o.r)).toBe(true);
    }
  });

  it('blocks trucks with every landmark', () => {
    for (const o of landmarks) expect(isDriveObstacle(o)).toBe(true);
  });

  it('overlaps no other obstacle', () => {
    const all = newWorld(1337, START_KITS.standard, TEST_MAP).obstacles.filter((o) => o.kind !== 'site');
    for (const o of landmarks) for (const other of all) if (other.id !== o.id) expect(dist(o.pos, other.pos)).toBeGreaterThan(o.r + other.r);
  });

  it('faces its road', () => {
    for (const o of landmarks) {
      const ahead = { x: o.pos.x + Math.cos(o.yaw) * (o.r + REGION.roadWidth / 2 + 3), y: o.pos.y + Math.sin(o.yaw) * (o.r + REGION.roadWidth / 2 + 3) };
      expect(ROAD_INDEX.nearestWithin(ahead.x, ahead.y, REGION.roadWidth)).toBeLessThan(REGION.roadWidth);
    }
  });

  it('stands in the same places on every map, since roads are the same', () => {
    const other = landmarksOf(7);
    const places = (list: Landmark[]) => new Map(list.map((o) => [o.id, o.pos]));
    const a = places(landmarks);
    const b = places(other);
    const shared = [...a.keys()].filter((id) => b.has(id));
    expect(shared.length).toBeGreaterThan(landmarks.length * 0.8);
    for (const id of shared) expect(b.get(id)).toEqual(a.get(id));
  });
});

describe('world from the baked map', () => {
  it('takes its terrain, hash and rocks from the map', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    expect(w.terrain).toBe(TEST_MAP.terrain);
    expect(w.mapHash).toBe(TEST_MAP.hash);
    const rocks = w.obstacles.filter((o) => o.kind === 'rock');
    expect(rocks).toEqual(TEST_MAP.rocks.map((rock, k) => ({ id: `rock${k}`, pos: rock.pos, r: rock.r, kind: 'rock' })));
  });

  it('places the same rocks for every world seed', () => {
    const rocksOf = (seed: number) => newWorld(seed, START_KITS.standard, TEST_MAP).obstacles.filter((o) => o.kind === 'rock');
    expect(rocksOf(7)).toEqual(rocksOf(1337));
  });

  it('rejects a map of another size than the region', () => {
    const small: BakedMap = { ...TEST_MAP, terrain: { size: 10, heights: [], types: [] } };
    expect(() => newWorld(1337, START_KITS.standard, small)).toThrow(/size/);
  });
});
