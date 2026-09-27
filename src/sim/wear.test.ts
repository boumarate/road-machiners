import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { TERRAIN_TYPES, type TerrainTypeId } from '../data/terrain';
import { addVehicle, emptyWorld, editableTerrain, practiceOf } from './testkit';
import { corePart, mountedParts } from './grid';
import { addState } from './states';
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

  it('never wears or breaks the cab below 1 HP', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = emptyWorld();
      w.rngState = seed;
      const me = w.vehicles[0];
      for (const p of mountedParts(me)) p.hp = 1;
      drive(me, 2000); // pushes wear and breakdown odds to their clamp
      applyWear(w);
      expect(corePart(me, 'cab').hp).toBe(1);
    }
  });

  it('costs each part about a third of its max HP over an hour of off-road driving', () => {
    const w = emptyWorld();
    w.rngState = 3;
    const me = w.vehicles[0];
    const tiles = 7.8; // scout top speed in tiles per turn
    setTerrainUnder(w, me, tiles, 'hardpan');
    for (let turn = 0; turn < 2900; turn++) {
      drive(me, tiles);
      applyWear(w);
    }
    const parts = mountedParts(me);
    const lostShare = parts.reduce((a, p) => a + 1 - p.hp / partDef(p.defId).hp, 0) / parts.length;
    const breakdowns = w.events.filter((e) => e.t === 'breakdown').length;
    expect(lostShare).toBeGreaterThan(0.2);
    expect(lostShare).toBeLessThan(0.45);
    expect(breakdowns).toBeGreaterThanOrEqual(1);
    expect(breakdowns).toBeLessThanOrEqual(6);
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

describe('rough ground practice', () => {
  const wears = Object.values(TERRAIN_TYPES).map((t) => t.wear);
  const roughness = (type: TerrainTypeId) => (TERRAIN_TYPES[type].wear - Math.min(...wears)) / (Math.max(...wears) - Math.min(...wears));

  it('pays the player for tiles driven off the road, harder on rougher ground', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    setTerrainUnder(w, me, 6, 'hardpan');
    drive(me, 6);
    applyWear(w);
    const [event] = practiceOf(w, 'roughTiles');
    expect(event.amount).toBeCloseTo(6);
    expect(event.difficulty).toBeCloseTo(roughness('hardpan'));
  });

  it('pays nothing on the road', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    drive(me, 6);
    applyWear(w);
    expect(practiceOf(w, 'roughTiles')).toEqual([]);
  });

  it('pays nothing while the player is towed', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const tower = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 50, y: 50 });
    addState(w, 'tow', tower.id, me.id, { kind: 'tow', town: REGION.towns[0].id, fee: 10, hitched: true });
    setTerrainUnder(w, me, 6, 'hardpan');
    drive(me, 6);
    applyWear(w);
    expect(practiceOf(w, 'roughTiles')).toEqual([]);
  });

  it('pays nothing for an NPC driving rough ground', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 50, y: 50 });
    setTerrainUnder(w, npc, 6, 'scree');
    drive(npc, 6);
    applyWear(w);
    expect(practiceOf(w, 'roughTiles')).toEqual([]);
  });
});
