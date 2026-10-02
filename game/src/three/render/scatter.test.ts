import { describe, expect, it } from 'vitest';
import { START_KITS } from '../../data/start';
import { ROAD_INDEX } from '../../sim/road-index';
import type { Vec } from '../../sim/vec';
import { newWorld } from '../../sim/world';
import { TEST_MAP } from '../../test/map';
import { OBSTACLE_GAP, ROAD_GAP, SHOULDER_TILES, scatterPlacements } from './scatter';

const world = newWorld(1337, START_KITS.standard, TEST_MAP);
const t = world.terrain;
const chunks = scatterPlacements(t, world.obstacles);
const placed = chunks.flatMap((c) => [...c.pebbles, ...c.scrub]);
const roadDist = (x: number, y: number) => ROAD_INDEX.nearestWithin(x, y, ROAD_GAP + SHOULDER_TILES);

describe('scatterPlacements', () => {
  it('keeps scatter off roads and away from obstacles', () => {
    expect(placed.length).toBeGreaterThan(1000);
    for (const p of placed) expect(roadDist(p.at.x, p.at.y)).toBeGreaterThanOrEqual(ROAD_GAP);
    const byTile = new Map<number, Vec[]>();
    for (const p of placed) {
      const key = Math.floor(p.at.y) * t.size + Math.floor(p.at.x);
      byTile.set(key, [...(byTile.get(key) ?? []), p.at]);
    }
    for (const o of world.obstacles) {
      // Tiles are blocked by their center, and a placement lies within half a tile diagonal of its tile's center.
      const r = o.r + OBSTACLE_GAP - Math.SQRT1_2;
      for (let y = Math.floor(o.pos.y - r); y <= o.pos.y + r; y++) for (let x = Math.floor(o.pos.x - r); x <= o.pos.x + r; x++)
        for (const at of byTile.get(y * t.size + x) ?? []) expect(Math.hypot(at.x - o.pos.x, at.y - o.pos.y)).toBeGreaterThan(r);
    }
  });

  it('gathers more scatter on road shoulders than on open ground', () => {
    let shoulderTiles = 0;
    let openTiles = 0;
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
      const d = roadDist(x + 0.5, y + 0.5);
      if (d < ROAD_GAP) continue;
      if (d < ROAD_GAP + SHOULDER_TILES) shoulderTiles++;
      else openTiles++;
    }
    const onShoulder = placed.filter((p) => roadDist(p.at.x, p.at.y) < ROAD_GAP + SHOULDER_TILES).length;
    const onOpen = placed.length - onShoulder;
    expect(onShoulder / shoulderTiles).toBeGreaterThan(1.5 * (onOpen / openTiles));
  });

  it('keeps hull plating bare, even on a road shoulder', () => {
    const types = t.types.map(() => 'hull' as const);
    const bare = scatterPlacements({ ...t, types }, []).flatMap((c) => [...c.pebbles, ...c.scrub]);
    expect(bare).toEqual([]);
  });

  it('places the same scatter on every load', () => {
    const again = scatterPlacements(t, world.obstacles).flatMap((c) => [...c.pebbles, ...c.scrub]);
    expect(again.map((p) => p.matrix.elements)).toEqual(placed.map((p) => p.matrix.elements));
    expect(again.map((p) => p.tint)).toEqual(placed.map((p) => p.tint));
  });
});
