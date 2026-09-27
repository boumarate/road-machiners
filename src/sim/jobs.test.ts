import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { REPAIR } from '../data/wear';
import { addVehicle, emptyWorld } from './testkit';
import { corePart, goodsCount, mountedParts } from './grid';
import { addGoods, removeGoods } from './inventory';
import { advanceJobs, startAutoRepair, startJob, startRepair } from './jobs';
import { repairPlan } from './repair';

function armorPart(v: ReturnType<typeof emptyWorld>['vehicles'][0]) {
  const part = mountedParts(v).find((p) => partDef(p.defId).kind === 'armor')!;
  return part;
}

describe('field repair job', () => {
  it('finishes after its turns and restores HP up to the field cap', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const plan = repairPlan(w, me, cage.id);
    expect(plan.hp).toBeGreaterThan(0);

    const next = startRepair(w, cage.id);
    expect(next.vehicles[0].job).toEqual({ kind: 'repair', partId: cage.id, parts: plan.parts, turnsLeft: plan.turns, total: plan.turns });

    for (let i = 0; i < plan.turns - 1; i++) advanceJobs(next);
    expect(next.vehicles[0].job).not.toBeNull();
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    const fixed = armorPart(next.vehicles[0]);
    expect(fixed.hp).toBe(1 + plan.hp);
    expect(fixed.hp).toBeLessThanOrEqual(partDef(fixed.defId).hp * REPAIR.fieldCapShare + 0.001);
  });

  it('cancels on a turn the truck ends above parked speed, losing the finished turns', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const held = goodsCount(me).parts ?? 0;
    const next = startRepair(w, cage.id);
    advanceJobs(next); // one turn parked, progress made
    next.vehicles[0].speed = 5; // moves before the job finishes
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(armorPart(next.vehicles[0]).hp).toBe(1); // no HP gained, parts untouched
    expect(goodsCount(next.vehicles[0]).parts).toBe(held);
  });

  it('spends parts only when the job finishes', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    const held = goodsCount(me).parts ?? 0;
    const plan = repairPlan(w, me, cage.id);
    expect(plan.turns).toBeGreaterThan(1);
    const next = startRepair(w, cage.id);
    for (let i = 0; i < plan.turns - 1; i++) advanceJobs(next);
    expect(goodsCount(next.vehicles[0]).parts).toBe(held); // not yet spent
    advanceJobs(next);
    expect(goodsCount(next.vehicles[0]).parts).toBe(held - plan.parts);
  });

  it('refuses to start once the part is already at the field cap', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = Math.floor(partDef(cage.defId).hp * REPAIR.fieldCapShare);
    addGoods(w, me, 'parts', 20);
    expect(() => startRepair(w, cage.id)).toThrow();
  });

  it('patches partway with the parts held when the full patch needs more', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 0;
    removeGoods(me, 'parts', goodsCount(me).parts ?? 0);
    addGoods(w, me, 'parts', 1);
    const plan = repairPlan(w, me, cage.id);
    expect(plan.needed).toBeGreaterThan(1);
    expect(plan.parts).toBe(1);
    expect(plan.hp).toBeCloseTo(partDef(cage.defId).hp * REPAIR.sharePerPart, 5);
    let next = startRepair(w, cage.id);
    for (let i = 0; i < plan.turns; i++) advanceJobs(next);
    const after = next.vehicles[0];
    expect(goodsCount(after).parts ?? 0).toBe(0);
    expect(mountedParts(after).find((p) => p.id === cage.id)!.hp).toBeCloseTo(plan.hp, 5);
  });

  it('refuses to start with no parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    removeGoods(me, 'parts', goodsCount(me).parts ?? 0);
    expect(() => startRepair(w, cage.id)).toThrow('No parts');
  });

  it('runs the same repair code for an NPC', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine', 'cage'], { x: 50, y: 50 });
    const cage = armorPart(npc);
    cage.hp = 1;
    addGoods(w, npc, 'parts', 20);
    const plan = repairPlan(w, npc, cage.id);
    startJob(w, npc, { kind: 'repair', partId: cage.id, parts: plan.parts, turnsLeft: plan.turns, total: plan.turns });
    for (let i = 0; i < plan.turns; i++) advanceJobs(w);
    expect(npc.job).toBeNull();
    expect(armorPart(npc).hp).toBe(1 + plan.hp);
  });

  it('needs the truck parked to use the oasis, salvage or start a job', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 5;
    const cage = armorPart(me);
    cage.hp = 1;
    addGoods(w, me, 'parts', 20);
    expect(() => startRepair(w, cage.id)).toThrow('Stop the truck first');
  });
});

describe('repair without parts', () => {
  it('cancels once the parts leave the grid mid-job', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    armorPart(me).hp = 1;
    addGoods(w, me, 'parts', 5);
    const next = startRepair(w, armorPart(me).id);
    const truck = next.vehicles[0];
    removeGoods(truck, 'parts', goodsCount(truck).parts ?? 0);
    advanceJobs(next);
    expect(truck.job).toBeNull();
    expect(next.events.some((e) => e.t === 'job' && e.outcome === 'cancelled')).toBe(true);
  });
});

describe('auto patch', () => {
  it('patches the most damaged part with one unit of parts while parked', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.speed = 0;
    const cage = armorPart(me);
    const engine = mountedParts(me).find((p) => partDef(p.defId).kind === 'engine')!;
    cage.hp = Math.round(partDef(cage.defId).hp * 0.5);
    engine.hp = 1;
    addGoods(w, me, 'parts', 5);
    const held = goodsCount(me).parts!;
    startAutoRepair(w);
    const plan = repairPlan(w, me, engine.id, 1);
    expect(me.job).toEqual({ kind: 'repair', partId: engine.id, parts: 1, turnsLeft: plan.turns, total: plan.turns, auto: true });
    for (let i = 0; i < plan.turns; i++) advanceJobs(w);
    expect(goodsCount(me).parts).toBe(held - 1);
    expect(engine.hp).toBe(1 + plan.hp);
  });

  it('waits while off, moving, busy or out of parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    armorPart(me).hp = 1;
    addGoods(w, me, 'parts', 5);
    w.player.autoRepair = false;
    me.speed = 0;
    startAutoRepair(w);
    expect(me.job).toBeNull();
    w.player.autoRepair = true;
    me.speed = 3;
    startAutoRepair(w);
    expect(me.job).toBeNull();
    me.speed = 0;
    removeGoods(me, 'parts', goodsCount(me).parts ?? 0);
    startAutoRepair(w);
    expect(me.job).toBeNull();
  });
});
