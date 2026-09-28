import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { autoOrders, isFoe, resolveDestroyed } from './combat';
import { advanceNpcKnockouts } from './defeat';
import { corePart, coreParts } from './grid';
import { addVehicle, emptyWorld, npcBrain, rngStateWhere } from './testkit';
import type { Vehicle, World } from './types';
import { refreshVision } from './vision';
import { setWeaponOrder } from './world';

// The player at 30,30 with a machine gun, and a raider buggy beside it that the player hit last.
function beside(): { w: World; me: Vehicle; buggy: Vehicle } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI);
  buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
  buggy.lastHitBy = me.id;
  buggy.brain.attackers[me.id] = true;
  refreshVision(w);
  return { w, me, buggy };
}

function breakCab(w: World, v: Vehicle, dies: boolean): void {
  corePart(v, 'cab').hp = 0;
  w.rngState = rngStateWhere((roll) => (roll < RULES.npcDeathChance) === dies);
  resolveDestroyed(w);
}

function gunOf(v: Vehicle): string {
  const gun = v.items.find((it) => it.kind === 'part' && it.part.defId === 'mg');
  if (gun?.kind !== 'part') throw new Error('Expected a machine gun');
  return gun.part.id;
}

describe('NPC knockout', () => {
  it('keeps the truck and every item in the world, and brakes it', () => {
    const { w, buggy } = beside();
    const items = buggy.items.map((it) => it.id).sort();
    breakCab(w, buggy, false);
    expect(w.vehicles).toContain(buggy);
    expect(buggy.items.map((it) => it.id).sort()).toEqual(items);
    expect(buggy.defeat).toMatchObject({ phase: 'out', turns: 0 });
    expect(buggy.order).toEqual({ kind: 'brake' });
    expect(w.salvage.some((s) => s.id.includes(buggy.id))).toBe(false);
    expect(w.events).toContainEqual({ t: 'npcKnockout', vehicle: buggy.id, by: w.player.vehicleId });
  });

  it('dies into a wreck when the death roll hits', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, true);
    expect(w.vehicles).not.toContain(buggy);
    expect(w.obstacles.some((o) => o.id === `wreck-${buggy.id}`)).toBe(true);
  });

  it('drops every order aimed at it, so auto fire and NPCs leave it alone', () => {
    const { w, me, buggy } = beside();
    me.weaponOrders[gunOf(me)] = { targetId: buggy.id, aim: 'body' };
    breakCab(w, buggy, false);
    expect(me.weaponOrders).toEqual({});
    autoOrders(w, me);
    expect(me.weaponOrders).toEqual({});
    expect(isFoe(w, me, buggy)).toBe(false);
  });

  it('lets the player aim at it by hand', () => {
    const { w, me, buggy } = beside();
    breakCab(w, buggy, false);
    const next = setWeaponOrder(w, gunOf(me), { targetId: buggy.id, aim: 'body' });
    expect(Object.values(next.vehicles[0].weaponOrders)).toEqual([{ targetId: buggy.id, aim: 'body' }]);
  });
});

describe('finishing off', () => {
  function shotAt(w: World, target: Vehicle, damage: number): void {
    const hits = [{ part: corePart(target, 'cab').id, damage }];
    w.events = [{ t: 'shot', shooter: w.player.vehicleId, weapon: 'mg', target: target.id, aim: 'body', chance: 1, side: 'front', rounds: [{ hit: true, crit: false, offset: 0, hits }] }];
  }

  it('turns a knocked-out truck into a wreck when a shot damages it', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, false);
    shotAt(w, buggy, 5);
    resolveDestroyed(w);
    expect(w.vehicles).not.toContain(buggy);
    expect(w.events).toContainEqual({ t: 'destroyed', vehicle: buggy.id, by: w.player.vehicleId });
  });

  it('leaves it knocked out after a shot that did no damage', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, false);
    shotAt(w, buggy, 0);
    resolveDestroyed(w);
    expect(w.vehicles).toContain(buggy);
  });
});

describe('NPC waking', () => {
  it('stays out while the truck that beat it sees it', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, false);
    advanceNpcKnockouts(w);
    expect(buggy.defeat).toMatchObject({ phase: 'out', turns: 1 });
  });

  it('wakes once its attackers are gone and patches its broken core parts', () => {
    const { w, me, buggy } = beside();
    breakCab(w, buggy, false);
    coreParts(buggy, 'wheel')[0].hp = 0;
    me.pos = { x: 200, y: 200 };
    refreshVision(w);
    advanceNpcKnockouts(w);
    expect(buggy.defeat?.phase).toBe('retreat');
    expect(corePart(buggy, 'cab').hp).toBeGreaterThan(0);
    expect(coreParts(buggy, 'wheel')[0].hp).toBeGreaterThan(0);
    expect(w.events).toContainEqual({ t: 'npcWake', vehicle: buggy.id });
  });

  it('wakes at the turn limit with its attacker still watching', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, false);
    for (let turn = 1; turn < RULES.knockoutMaxTurns; turn++) advanceNpcKnockouts(w);
    expect(buggy.defeat?.phase).toBe('out');
    advanceNpcKnockouts(w);
    expect(buggy.defeat?.phase).toBe('retreat');
  });
});
