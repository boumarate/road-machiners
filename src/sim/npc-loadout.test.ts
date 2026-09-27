import { beforeAll, describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { NPCS, type NpcTemplate } from '../data/npcs';
import { PARTS } from '../data/parts';
import { makeVehicle } from './factory';
import { goodsCount, gridOf, isMounted, mountedParts, placementError } from './grid';
import { vehicleMass } from './mass';
import { generateNpcLoadout, sampleWeighted } from './npc-loadout';
import { spawnInitial, spawnNpcs } from './spawn';
import { emptyWorld } from './testkit';
import type { Vehicle, World } from './types';

let fixture: World;
beforeAll(() => { fixture = emptyWorld(); });

function describeLoadout(v: Vehicle): string {
  return JSON.stringify({ chassis: v.chassisId, parts: mountedParts(v).map((p) => p.defId), goods: v.items.filter((i) => i.kind === 'good').map((i) => i.good) });
}

describe('NPC equipment generation', () => {
  it('spawns at least five equipment combinations for each base trait', () => {
    const seen: Record<string, Set<string>> = { raider: new Set(), trader: new Set(), scavenger: new Set() };
    for (let seed = 1; seed <= 40; seed++) {
      const world = structuredClone(fixture);
      world.rngState = seed;
      spawnInitial(world);
      for (const v of world.vehicles) {
        if (v.brain) seen[NPCS[v.brain.templateId].traits[0]].add(describeLoadout(v));
      }
    }
    for (const [role, variants] of Object.entries(seen)) expect(variants.size, role).toBeGreaterThanOrEqual(5);
  });

  it.each(Object.values(NPCS))('fits $id equipment and cargo within its budget and rated mass', (template) => {
    for (let seed = 1; seed <= 32; seed++) {
      const world = { ...fixture, rngState: seed };
      const beforeId = world.nextId;
      const loadout = generateNpcLoadout(world, template);
      expect(world.nextId).toBe(beforeId);
      const v = makeVehicle(world, { ...loadout, name: template.name, faction: template.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
      expect(mountedParts(v, 'engine')).toHaveLength(1);
      expect(mountedParts(v, 'weapon')).toHaveLength(1);
      for (const item of v.items) {
        expect(placementError(gridOf(v), v.items, item, item.id)).toBeNull();
        if (item.kind === 'part') expect(isMounted(v.chassisId, item)).toBe(true);
      }
      expect(goodsCount(v)).toEqual(loadout.cargo);
      expect(vehicleMass(v)).toBeLessThanOrEqual(CHASSIS[v.chassisId].ratedMass);
      const cost = CHASSIS[v.chassisId].value + loadout.parts.reduce((sum, id) => sum + PARTS[id].value, 0);
      expect(cost).toBeLessThanOrEqual(template.loadout.budget);
      expect(v.resources?.money).toBe(fixture.player.money);
    }
  });

  it('filters an oversized weapon before rolling, even with a high weight', () => {
    const template = structuredClone(NPCS.buggy);
    template.loadout.chassis = [{ value: 'buggy', weight: 1 }];
    template.loadout.engine = [{ value: 'stockEngine', weight: 1 }];
    template.loadout.weapon = [{ value: 'cannon', weight: 1000 }, { value: 'mg', weight: 1 }];
    const loadout = generateNpcLoadout({ ...fixture }, template);
    expect(loadout.parts).toContain('mg');
    expect(loadout.parts).not.toContain('cannon');
  });

  it('reserves the budget for both required parts before choosing an engine', () => {
    const template = structuredClone(NPCS.trader);
    template.loadout.budget = CHASSIS.hauler.value + PARTS.stockEngine.value + PARTS.mg.value;
    template.loadout.chassis = [{ value: 'hauler', weight: 1 }];
    template.loadout.engine = [{ value: 'turbine', weight: 1000 }, { value: 'stockEngine', weight: 1 }];
    template.loadout.weapon = [{ value: 'mg', weight: 1 }];
    const loadout = generateNpcLoadout({ ...fixture }, template);
    expect(loadout.parts).toEqual(['stockEngine', 'mg']);
  });

  it('rejects impossible required equipment without consuming RNG or IDs', () => {
    const template = structuredClone(NPCS.buggy);
    template.loadout.chassis = [{ value: 'buggy', weight: 1 }];
    template.loadout.weapon = [{ value: 'cannon', weight: 1 }];
    const world = { ...fixture };
    expect(() => generateNpcLoadout(world, template)).toThrow(/No valid required/);
    expect(world).toEqual(fixture);
  });

  it.each([
    ['unknown cargo', (t: NpcTemplate) => { t.loadout.goods = [{ value: { good: 'missing', count: 1 }, weight: 1 }]; }],
    ['wrong part kind', (t: NpcTemplate) => { t.loadout.weapon = [{ value: 'stockEngine', weight: 1 }]; }],
    ['negative count', (t: NpcTemplate) => { t.loadout.goods = [{ value: { good: 'scrap', count: -1 }, weight: 1 }]; }],
    ['invalid budget', (t: NpcTemplate) => { t.loadout.budget = Infinity; }],
    ['empty chassis pool', (t: NpcTemplate) => { t.loadout.chassis = []; }],
    ['unknown chassis', (t: NpcTemplate) => { t.loadout.chassis = [{ value: 'missing', weight: 1 }]; }],
    ['invalid optional weight', (t: NpcTemplate) => { t.loadout.armor = [{ value: null, weight: 0 }]; }],
    ['impossible optional part', (t: NpcTemplate) => { t.loadout.chassis = [{ value: 'buggy', weight: 1 }]; t.loadout.cargoPart = [{ value: 'heavyFrame', weight: 1 }]; }],
    ['impossible cargo', (t: NpcTemplate) => { t.loadout.goods = [{ value: { good: 'scrap', count: 1000 }, weight: 1 }]; }],
  ] as const)('fails loudly on %s without changing the input world', (_name, invalidate) => {
    const world = { ...fixture };
    const template = structuredClone(NPCS.buggy);
    invalidate(template);
    expect(() => generateNpcLoadout(world, template)).toThrow();
    expect(world).toEqual(fixture);
  });

  it('uses the same generator for periodic spawns without exceeding existing caps', () => {
    const world = structuredClone(fixture);
    for (let attempt = 0; attempt < Math.max(...Object.values(NPCS).map((t) => t.cap)) + 2; attempt++) {
      for (const template of Object.values(NPCS)) world.spawnTimer[template.id] = 1;
      spawnNpcs(world);
    }
    for (const template of Object.values(NPCS)) {
      const vehicles = world.vehicles.filter((v) => v.brain?.templateId === template.id);
      expect(vehicles).toHaveLength(template.cap);
      expect(new Set(vehicles.map(describeLoadout)).size).toBe(vehicles.length);
    }
  });

  it('repeats the same initial traffic and RNG state for the same seed', () => {
    const a = structuredClone(fixture);
    const b = structuredClone(fixture);
    spawnInitial(a);
    spawnInitial(b);
    expect(a.vehicles).toEqual(b.vehicles);
    expect(a.rngState).toBe(b.rngState);
  });
});

describe('weighted equipment rolls', () => {
  it('draws rare equipment less often than common equipment', () => {
    const rng = { rngState: 42 };
    const pool = [{ value: 'common', weight: 9 }, { value: 'rare', weight: 1 }];
    const rolls = Array.from({ length: 1000 }, () => sampleWeighted(rng, pool));
    const rare = rolls.filter((value) => value === 'rare').length;
    expect(rare).toBeGreaterThan(0);
    expect(rare).toBeLessThan(200);
  });

  it.each([0, -1, NaN, Infinity])('rejects weight %s before consuming randomness', (weight) => {
    const rng = { rngState: 42 };
    expect(() => sampleWeighted(rng, [{ value: 'bad', weight }])).toThrow(/weights/);
    expect(rng.rngState).toBe(42);
  });

  it('rejects an empty pool and overflowing total', () => {
    const rng = { rngState: 42 };
    expect(() => sampleWeighted(rng, [])).toThrow(/Empty/);
    expect(() => sampleWeighted(rng, [{ value: 'a', weight: Number.MAX_VALUE }, { value: 'b', weight: Number.MAX_VALUE }])).toThrow(/total/);
    expect(rng.rngState).toBe(42);
  });
});
