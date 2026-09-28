import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { isBakedObstacle, isDriveObstacle, mapObstacles } from './mapgen';
import { ROAD_INDEX } from './road-index';
import type { Obstacle } from './types';
import { dist } from './vec';
import { newWorld } from './world';
import { TEST_MAP } from '../test/map';
import type { BakedMap, BakedProp } from './terrain';

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;

const prop = (kind: BakedProp['kind'], x: number, extra: Partial<BakedProp> = {}): BakedProp => ({ kind, pos: { x, y: 50 }, r: 1, yaw: 0.5, group: 0, step: 0, ...extra });

// A map with the test terrain and a short list of props of several kinds.
function mapWith(props: BakedProp[]): BakedMap {
  return { ...TEST_MAP, props };
}

describe('baked map obstacles', () => {
  it('turns rocks into rock obstacles and other props into landmarks, with ids by prop order', () => {
    const map = mapWith([prop('rock', 10), prop('crag', 20, { yaw: 1.25 }), prop('rock', 30), prop('ruin', 40, { yaw: -2 })]);

    expect(mapObstacles(map)).toEqual([
      { id: 'rock0', pos: { x: 10, y: 50 }, r: 1, kind: 'rock' },
      { id: 'crag-1', pos: { x: 20, y: 50 }, r: 1, kind: 'landmark', look: 'crag', yaw: 1.25 },
      { id: 'rock2', pos: { x: 30, y: 50 }, r: 1, kind: 'rock' },
      { id: 'ruin-3', pos: { x: 40, y: 50 }, r: 1, kind: 'landmark', look: 'ruin', yaw: -2 },
    ]);
  });

  it('names a pole by its power line and its step along it', () => {
    const map = mapWith([prop('rock', 10), prop('pole', 20, { group: 2, step: 0 }), prop('pole', 30, { group: 2, step: 1 })]);

    expect(mapObstacles(map).map((o) => o.id)).toEqual(['rock0', 'pole-2-0', 'pole-2-1']);
  });

  it('refuses two poles with the same line and step', () => {
    const map = mapWith([prop('pole', 20, { group: 2, step: 1 }), prop('pole', 30, { group: 2, step: 1 })]);

    expect(() => mapObstacles(map)).toThrow(/pole-2-1/);
  });

  it('gives the same obstacles for the same map', () => {
    expect(mapObstacles(TEST_MAP)).toEqual(mapObstacles(TEST_MAP));
  });

  it('knows every obstacle it makes as baked, and no other', () => {
    const baked = mapObstacles(mapWith([prop('rock', 10), prop('pole', 20, { group: 4, step: 7 }), prop('tank', 30), prop('roadBridgeBroken', 40)]));
    const world = newWorld(1337, START_KITS.standard, TEST_MAP);
    const others = world.obstacles.filter((o) => !mapObstacles(TEST_MAP).some((b) => b.id === o.id));
    const runtimeWrecks: Obstacle[] = [{ id: 'wreck-v12', pos: { x: 1, y: 1 }, r: 1, kind: 'wreck' }, { id: 'wreck31', pos: { x: 1, y: 1 }, r: 1, kind: 'wreck' }];

    expect(baked.every(isBakedObstacle)).toBe(true);
    expect(others.length).toBeGreaterThan(0);
    expect([...others, ...runtimeWrecks].some(isBakedObstacle)).toBe(false);
  });

  it('blocks trucks with every landmark but a road bridge, which trucks drive over', () => {
    const kinds = ['crag', 'ruin', 'house', 'silo', 'waterTower', 'gasStation', 'bridgeSpan', 'roadBridgeBroken', 'pole', 'billboard', 'tank'] as const;
    const blocking = mapObstacles(mapWith(kinds.map((kind, k) => prop(kind, k * 10))));
    const [bridge] = mapObstacles(mapWith([prop('roadBridge', 10)]));

    for (const o of blocking) expect(isDriveObstacle(o)).toBe(true);
    expect(isDriveObstacle(bridge)).toBe(false);
  });
});

describe('world from the baked map', () => {
  const world = newWorld(1337, START_KITS.standard, TEST_MAP);
  const baked = world.obstacles.filter(isBakedObstacle);

  it('takes its terrain, hash and baked props from the map', () => {
    expect(world.terrain).toBe(TEST_MAP.terrain);
    expect(world.mapHash).toBe(TEST_MAP.hash);
    expect(baked).toEqual(mapObstacles(TEST_MAP));
    expect(baked.length).toBe(TEST_MAP.props.length);
  });

  it('places the same baked props for every world seed', () => {
    const bakedOf = (seed: number) => newWorld(seed, START_KITS.standard, TEST_MAP).obstacles.filter(isBakedObstacle);
    expect(bakedOf(7)).toEqual(bakedOf(1337));
  });

  it('keeps every baked landmark but road bridges off every road surface and out of every site', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    const landmarks = baked.filter((o): o is Landmark => o.kind === 'landmark' && o.look !== 'roadBridge');
    expect(landmarks.length).toBeGreaterThan(0);
    for (const o of landmarks) {
      const reach = REGION.roadWidth / 2 + o.r;
      expect(ROAD_INDEX.nearestWithin(o.pos.x, o.pos.y, reach)).toBe(Infinity);
      expect(sites.every((s) => dist(o.pos, s.pos) > s.radius + o.r)).toBe(true);
    }
  });

  it('overlaps no baked prop with any other obstacle', () => {
    const all = world.obstacles.filter((o) => o.kind !== 'site');
    const overlaps = baked.flatMap((o) => all.filter((other) => other.id !== o.id && dist(o.pos, other.pos) <= o.r + other.r).map((other) => `${o.id} ${other.id}`));
    expect(overlaps).toEqual([]);
  });

  it('rejects a map of another size than the region', () => {
    const small: BakedMap = { ...TEST_MAP, terrain: { size: 10, heights: [], types: [] } };
    expect(() => newWorld(1337, START_KITS.standard, small)).toThrow(/size/);
  });
});
