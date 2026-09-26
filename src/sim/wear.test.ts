import { describe, expect, it } from 'vitest';
import type { TerrainTypeId } from '../data/terrain';
import { addVehicle, emptyWorld, editableTerrain } from './testkit';
import { mountedParts } from './grid';
import { tileAt } from './terrain';
import type { Vehicle, World } from './types';
import { applyWear } from './wear';

// Sets a vehicle's trail to a single straight segment of the given length, and its end-of-turn speed.
function drive(v: Vehicle, len: number): void {
  v.trail = [
    { x: v.pos.x, y: v.pos.y, heading: 0 },
    { x: v.pos.x + len, y: v.pos.y, heading: 0 },
  ];
  v.speed = len;
}

function totalHp(v: Vehicle): number {
  return mountedParts(v).reduce((a, p) => a + p.hp, 0);
}

function setTerrainUnder(w: World, v: Vehicle, len: number, type: TerrainTypeId): void {
  const tile = tileAt(w.terrain, { x: v.pos.x + len / 2, y: v.pos.y });
  editableTerrain(w).types[tile] = type;
}

describe('wear', () => {
  it('takes no wear while parked', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.trail = [{ x: me.pos.x, y: me.pos.y, heading: 0 }];
    me.speed = 0;
    const before = totalHp(me);
    applyWear(w);
    expect(totalHp(me)).toBe(before);
  });

  it('wears parts over a long drive', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    drive(me, 1000); // pushes the odds to their clamp, so the hit is certain
    const before = totalHp(me);
    applyWear(w);
    expect(totalHp(me)).toBeLessThan(before);
  });

  it('wears scree more than road over many seeds', () => {
    let roadLoss = 0;
    let screeLoss = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const road = emptyWorld();
      road.rngState = seed;
      drive(road.vehicles[0], 5);
      setTerrainUnder(road, road.vehicles[0], 5, 'road');
      const before = totalHp(road.vehicles[0]);
      applyWear(road);
      roadLoss += before - totalHp(road.vehicles[0]);

      const scree = emptyWorld();
      scree.rngState = seed;
      drive(scree.vehicles[0], 5);
      setTerrainUnder(scree, scree.vehicles[0], 5, 'scree');
      const before2 = totalHp(scree.vehicles[0]);
      applyWear(scree);
      screeLoss += before2 - totalHp(scree.vehicles[0]);
    }
    expect(screeLoss).toBeGreaterThan(roadLoss);
  });

  it('replays the same breakdown from the same seed', () => {
    const a = emptyWorld();
    a.rngState = 7;
    drive(a.vehicles[0], 2000);
    applyWear(a);

    const b = emptyWorld();
    b.rngState = 7;
    drive(b.vehicles[0], 2000);
    applyWear(b);

    expect(a.events).toEqual(b.events);
    expect(mountedParts(a.vehicles[0])).toEqual(mountedParts(b.vehicles[0]));
    expect(a.events.some((e) => e.t === 'breakdown')).toBe(true);
  });

  it('wears NPCs too', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 50, y: 50 });
    drive(npc, 1000);
    const before = totalHp(npc);
    applyWear(w);
    expect(totalHp(npc)).toBeLessThan(before);
  });
});
