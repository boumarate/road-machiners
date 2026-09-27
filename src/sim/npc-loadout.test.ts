import { beforeAll, describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { NPCS, type NpcTemplate } from '../data/npcs';
import { PARTS } from '../data/parts';
import { CONDITION } from '../data/wear';
import { partValue } from './economy';
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
    ['wear step past the last rebuildable step', (t: NpcTemplate) => { t.loadout.wear = [{ value: CONDITION.maxWear + 1, weight: 1 }]; }],
    ['negative wear step', (t: NpcTemplate) => { t.loadout.wear = [{ value: -1, weight: 1 }]; }],
    ['a core part in the spare pool', (t: NpcTemplate) => { t.loadout.spares = { pool: [{ value: 'cab', weight: 1 }], count: [{ value: 1, weight: 1 }] }; }],
    ['a negative spare count', (t: NpcTemplate) => { t.loadout.spares = { pool: [{ value: null, weight: 1 }], count: [{ value: -1, weight: 1 }] }; }],
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

describe('part wear', () => {
  it.each(Object.values(NPCS))('rolls a wear step within $id\'s table for every mounted, non-core part', (template) => {
    const rolled = new Set<number>();
    const allowed = new Set(template.loadout.wear.map((entry) => entry.value));
    for (let seed = 1; seed <= 40; seed++) {
      const loadout = generateNpcLoadout({ ...fixture, rngState: seed }, template);
      for (const id of loadout.parts) {
        const wear = loadout.partWear[id];
        expect(wear, id).toBeGreaterThanOrEqual(0);
        expect(wear, id).toBeLessThanOrEqual(CONDITION.maxWear);
        expect(allowed, id).toContain(wear);
        rolled.add(wear);
      }
    }
    expect(rolled.size, `${template.id} wear variety`).toBeGreaterThan(1);
  });

  it('rolls the same wear for the same seed', () => {
    const loadoutA = generateNpcLoadout({ ...fixture, rngState: 7 }, NPCS.trader);
    const loadoutB = generateNpcLoadout({ ...fixture, rngState: 7 }, NPCS.trader);
    expect(loadoutA.partWear).toEqual(loadoutB.partWear);
    expect(loadoutA.spares).toEqual(loadoutB.spares);
  });

  it('a wear roll frees enough budget to fit an optional part that would not fit pristine', () => {
    const world = { ...fixture, rngState: 1 };
    const template = structuredClone(NPCS.buggy);
    const wornWear = CONDITION.maxWear - 1;
    template.loadout.chassis = [{ value: 'van', weight: 1 }];
    template.loadout.engine = [{ value: 'stockEngine', weight: 1 }];
    template.loadout.weapon = [{ value: 'mg', weight: 1 }];
    template.loadout.cargoPart = [{ value: null, weight: 1 }];
    template.loadout.armor = [{ value: 'scrapPanels', weight: 1 }];
    template.loadout.wear = [{ value: wornWear, weight: 1 }];
    const armorValue = partValue({ id: 'p', defId: 'scrapPanels', hp: 0, reload: 0, wear: wornWear });
    const requiredCost = CHASSIS.van.value + PARTS.stockEngine.value + PARTS.mg.value;
    template.loadout.budget = requiredCost + armorValue;
    expect(requiredCost + PARTS.scrapPanels.value).toBeGreaterThan(template.loadout.budget);
    const loadout = generateNpcLoadout(world, template);
    expect(loadout.parts).toContain('scrapPanels');
    expect(loadout.partWear.scrapPanels).toBe(wornWear);
  });
});

describe('trader spare parts', () => {
  it('carries rolled spares when it has grid room and rated mass to spare', () => {
    const template = structuredClone(NPCS.trader);
    template.loadout.chassis = [{ value: 'hauler', weight: 1 }];
    template.loadout.cargoPart = [{ value: null, weight: 1 }];
    template.loadout.goods = [{ value: null, weight: 1 }];
    template.loadout.spares = { pool: [{ value: 'mg', weight: 1 }], count: [{ value: 2, weight: 1 }] };
    const loadout = generateNpcLoadout({ ...fixture, rngState: 3 }, template);
    expect(loadout.spares.length).toBeGreaterThan(0);
    for (const spare of loadout.spares) {
      expect(spare.defId).toBe('mg');
      expect(spare.wear).toBeGreaterThanOrEqual(0);
      expect(spare.wear).toBeLessThanOrEqual(CONDITION.maxWear);
    }
  });

  it('carries no spares once cargo and repair parts already fill the grid', () => {
    const template = structuredClone(NPCS.trader);
    template.loadout.chassis = [{ value: 'buggy', weight: 1 }];
    template.loadout.cargoPart = [{ value: null, weight: 1 }];
    template.loadout.goods = [{ value: { good: 'grain', count: 20 }, weight: 4 }, { value: null, weight: 1 }];
    template.loadout.spares = { pool: [{ value: 'mg', weight: 1 }], count: [{ value: 3, weight: 1 }] };
    const loadout = generateNpcLoadout({ ...fixture, rngState: 3 }, template);
    expect(loadout.spares).toEqual([]);
  });

  it('never rolls spares for a template with no spare table', () => {
    const loadout = generateNpcLoadout({ ...fixture, rngState: 3 }, NPCS.buggy);
    expect(loadout.spares).toEqual([]);
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
