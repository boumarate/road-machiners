import { describe, expect, it } from 'vitest';
import { PERK_NUMBERS, SKILL_EFFECTS, XP_TO_REACH } from '../data/skills';
import { partDef } from '../data/parts';
import { REPAIR } from '../data/wear';
import { addVehicle, emptyWorld } from './testkit';
import { corePart, mountedParts } from './grid';
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
    expect(repairPlan(w, me, cage.id)).toEqual({ turns: 0, parts: 0, hp: 0, needed: 0 });
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

  it('costs the same parts for a broken small part and a broken large part', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const wheel = mountedParts(me).find((p) => p.defId === 'wheel')!;
    const cab = corePart(me, 'cab');
    wheel.hp = 0;
    cab.hp = 0;
    expect(repairPlan(w, me, wheel.id).parts).toBe(2);
    expect(repairPlan(w, me, cab.id).parts).toBe(2);
  });

  it('machining shortens the job and cuts parts use for the player', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    cage.hp = 1;
    const base = repairPlan(w, me, cage.id);
    w.player.skills.machining = XP_TO_REACH[3];
    const tuned = repairPlan(w, me, cage.id);
    expect(tuned.parts).toBeLessThanOrEqual(base.parts);
    expect(tuned.turns).toBeLessThanOrEqual(base.turns);
  });
});

describe('field repair cap', () => {
  it('lifts a part past the base field cap for the player at level 5', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    const max = partDef(cage.defId).hp;
    cage.hp = Math.floor(max * REPAIR.fieldCapShare);
    expect(repairPlan(w, me, cage.id).needed).toBe(0);
    w.player.skills.machining = XP_TO_REACH[5];
    const cap = max * (REPAIR.fieldCapShare + 5 * SKILL_EFFECTS.machining.fieldCap);
    expect(repairPlan(w, me, cage.id).hp).toBeCloseTo(cap - cage.hp, 5);
  });

  it('keeps an NPC part at the base field cap', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    const engine = mountedParts(npc, 'engine')[0];
    engine.hp = Math.ceil(partDef(engine.defId).hp * REPAIR.fieldCapShare);
    w.player.skills.machining = XP_TO_REACH[5];
    expect(repairPlan(w, npc, engine.id).needed).toBe(0);
  });
});

describe('jury rig perk', () => {
  it('lifts the field repair cap of the player truck', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cage = armorPart(me);
    const max = partDef(cage.defId).hp;
    cage.hp = Math.floor(max * REPAIR.fieldCapShare);
    w.player.perks.push('juryRig');
    const cap = max * Math.min(1, REPAIR.fieldCapShare + PERK_NUMBERS.juryRig.fieldCap);
    expect(repairPlan(w, me, cage.id).hp).toBeCloseTo(cap - cage.hp, 5);
  });

  it('keeps an NPC part at the base field cap', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    const engine = mountedParts(npc, 'engine')[0];
    engine.hp = Math.ceil(partDef(engine.defId).hp * REPAIR.fieldCapShare);
    w.player.perks.push('juryRig');
    expect(repairPlan(w, npc, engine.id).needed).toBe(0);
  });
});

describe('field repair by armor type', () => {
  it('patches scrap panels to full HP', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['scrapPanels', 'stockEngine'], { x: 40, y: 40 });
    const panels = armorPart(v);
    panels.hp = 1;
    v.items.push({ id: 'i-parts', x: 1, y: 4, rot: 0, kind: 'good', good: 'parts' }, { id: 'i-parts2', x: 3, y: 4, rot: 0, kind: 'good', good: 'parts' }, { id: 'i-parts3', x: 1, y: 3, rot: 0, kind: 'good', good: 'parts' });
    expect(repairPlan(w, v, panels.id).hp).toBeCloseTo(partDef('scrapPanels').hp - 1, 5);
  });

  it('leaves ceramic plates for a town garage', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['ceramicPlates', 'stockEngine'], { x: 40, y: 40 });
    const plates = armorPart(v);
    plates.hp = 1;
    v.items.push({ id: 'i-parts', x: 1, y: 4, rot: 0, kind: 'good', good: 'parts' });
    expect(repairPlan(w, v, plates.id).needed).toBe(0);
  });
});
