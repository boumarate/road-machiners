import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE } from '../data/salvage';
import { TERRITORIES } from '../data/territory';
import { PHYSICS } from '../data/physics';
import { boxDistance, propBoxes, segmentCrossesBox, type PosedBox } from './mapgen';
import { ROAD_INDEX } from './road-index';
import { boxesOverlap } from '../test/boxes';
import { hazardZones, isLootSpot, reactorPos, spotTable, territoryAt, territoryCaches, territoryEntries, territoryGrounds, territoryPieces, territoryTracks } from './territory';
import { dist } from './vec';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;

describe('territory queries', () => {
  it('finds the territory under a point, and none outside', () => {
    expect(territoryAt(fallenSun.pos)?.id).toBe('fallen-sun');
    expect(territoryAt({ x: fallenSun.pos.x + fallenSun.radius + 1, y: fallenSun.pos.y })).toBeNull();
  });

  it('puts every entry on the edge', () => {
    const entries = territoryEntries(fallenSun as never);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(dist(e, fallenSun.pos)).toBeCloseTo(fallenSun.radius, 6);
  });

  it("has three roads into the Fallen Sun, where the level concept's tracks leave the crater", () => {
    const entries = territoryEntries(fallenSun as never);
    const bearings = entries.map((e) => (Math.atan2(e.y - fallenSun.pos.y, e.x - fallenSun.pos.x) * 180) / Math.PI).sort((a, b) => a - b);
    expect(bearings).toHaveLength(3);
    [-16, 37, 166].forEach((want, i) => expect(Math.abs(bearings[i] - want)).toBeLessThan(10));
  });

  it('keeps every road out of the hazard', () => {
    for (const zone of hazardZones()) {
      const reach = zone.radius + REGION.roadWidth / 2;
      expect(ROAD_INDEX.nearestWithin(zone.pos.x, zone.pos.y, reach), zone.id).toBe(Infinity);
    }
  });

  it('keeps the hunting grounds out of the hazard', () => {
    const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
    for (const p of territoryGrounds(fallenSun as never)) expect(dist(p, zone.pos)).toBeGreaterThan(zone.radius);
  });

  it('reports the hazard of each territory that has one', () => {
    expect(hazardZones().map((z) => z.id)).toEqual(Object.keys(TERRITORIES).filter((id) => TERRITORIES[id].reactor?.hazard));
  });

  it('knows a loot spot only inside its territory', () => {
    const spot = { id: 'x', pos: fallenSun.pos, r: 1, kind: 'landmark', look: 'shipCache', yaw: 0 } as const;
    expect(isLootSpot(spot)).toBe(true);
    expect(isLootSpot({ ...spot, pos: { x: 1, y: 1 } })).toBe(false);
    expect(isLootSpot({ ...spot, look: 'carWreck' })).toBe(false);
  });

  it('rolls a cache from the cache table and a field spot from the spot table', () => {
    const cache = { id: 'hullCache-1', pos: fallenSun.pos, r: 1, kind: 'landmark', look: 'hullCache', yaw: 0 } as const;
    expect(spotTable(cache)).toBe(SALVAGE[TERRITORIES['fallen-sun'].cacheTable]);
    expect(spotTable({ ...cache, look: 'shipCache' })).toBe(SALVAGE.hullScrap);
    expect(() => spotTable({ ...cache, pos: { x: 1, y: 1 } })).toThrow(/not a loot spot/);
  });
});

describe('the Fallen Sun layout', () => {
  const t = fallenSun as never;
  const rules = TERRITORIES['fallen-sun'];
  const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
  const pieces = territoryPieces(t);
  const lowBoxes = (k: number): PosedBox[] => {
    const p = pieces[k];
    return propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }).filter((b) => b.z0 < PHYSICS.truckClearance);
  };
  // The bow holds the reactor in its breach, so it is the one piece the hazard reaches.
  const housing = pieces.findIndex((p) => p.look === 'shipBow');
  const trackSegments = territoryTracks(t).flatMap((track) => track.slice(1).map((b, i) => [track[i], b] as const));

  it('keeps every piece centre, cache, track point and patch inside the territory', () => {
    const points = [...pieces.map((p) => p.pos), ...territoryCaches(t), ...territoryTracks(t).flat()];
    for (const p of points) expect(dist(p, fallenSun.pos), `${p.x},${p.y}`).toBeLessThan(fallenSun.radius);
    for (const patch of rules.patches) expect(Math.hypot(patch.at.x, patch.at.y)).toBeLessThan(fallenSun.radius);
  });

  it("keeps caches, tracks, patches and every piece but the reactor's housing out of the hazard", () => {
    for (const p of [...territoryCaches(t), ...territoryTracks(t).flat()]) expect(dist(p, zone.pos), `${p.x},${p.y}`).toBeGreaterThan(zone.radius);
    for (const patch of rules.patches) expect(dist({ x: fallenSun.pos.x + patch.at.x, y: fallenSun.pos.y + patch.at.y }, zone.pos) - patch.radius).toBeGreaterThan(zone.radius);
    pieces.forEach((p, k) => {
      if (k === housing) return;
      for (const b of lowBoxes(k)) expect(boxDistance(b, zone.pos), p.look).toBeGreaterThan(zone.radius);
    });
  });

  it("keeps every piece's low boxes off the roads, the tracks and the other pieces", () => {
    pieces.forEach((p, k) => {
      for (const b of lowBoxes(k)) {
        expect(ROAD_INDEX.nearestWithin(b.center.x, b.center.y, Math.hypot(b.half.x, b.half.y) + REGION.roadWidth / 2), p.look).toBe(Infinity);
        for (const [a, c] of trackSegments) expect(segmentCrossesBox(b, a, c), `${p.look} crosses a track at ${a.x},${a.y}`).toBe(false);
        pieces.forEach((_, other) => {
          if (other <= k) return;
          for (const ob of lowBoxes(other)) expect(boxesOverlap(b, ob), `${p.look} and ${pieces[other].look}`).toBe(false);
        });
      }
    });
  });

  it('centres the hazard on the reactor', () => {
    expect(zone.pos).toEqual(reactorPos(t));
  });

  it('has nine caches and fifteen field spots', () => {
    expect(territoryCaches(t)).toHaveLength(9);
    expect(rules.patches.reduce((n, p) => n + p.spots, 0)).toBe(15);
  });

  it('waits for scavengers at the entries and the patch centres', () => {
    const grounds = territoryGrounds(t);
    expect(grounds.slice(0, 3)).toEqual(territoryEntries(t));
    expect(grounds).toHaveLength(3 + rules.patches.length);
  });
});
