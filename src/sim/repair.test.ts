import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { REPAIR } from '../data/wear';
import { emptyWorld } from './testkit';
import { mountedParts } from './grid';
import { repairPlan } from './repair';

function armorPart(v: ReturnType<typeof emptyWorld>['vehicles'][0]) {
  return mountedParts(v).find((p) => partDef(p.defId).kind === 'armor')!;
}

describe('repairPlan', () => {
  it('reports no work when the part is already at the field cap', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = Math.floor(partDef(cage.defId).hp * REPAIR.fieldCapShare);
    expect(repairPlan(w, me, cage.id)).toEqual({ turns: 0, parts: 0, hp: 0 });
  });

  it('never plans above the field cap even when the part is undamaged', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = partDef(cage.defId).hp;
    expect(repairPlan(w, me, cage.id).hp).toBe(0);
  });

  it('spends parts and turns proportional to the HP gained', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    const plan = repairPlan(w, me, cage.id);
    const cap = partDef(cage.defId).hp * REPAIR.fieldCapShare;
    expect(plan.hp).toBeCloseTo(cap - 1, 5);
    expect(plan.parts).toBeGreaterThan(0);
    expect(plan.turns).toBeGreaterThan(0);
  });

  it('mechanics shortens the job and cuts parts use for the player', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    const base = repairPlan(w, me, cage.id);
    w.player.skills.mechanics = 3;
    const tuned = repairPlan(w, me, cage.id);
    expect(tuned.parts).toBeLessThanOrEqual(base.parts);
    expect(tuned.turns).toBeLessThanOrEqual(base.turns);
  });
});
