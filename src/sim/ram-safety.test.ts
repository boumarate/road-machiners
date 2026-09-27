import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { corePart, mountedParts } from './grid';
import { planNpcOrders } from './ai';
import { NPC_BEHAVIOR } from '../data/npcs';
import { thinkNpc } from './npc-activities';
import { isWeak, optionWeights } from './npc-decisions';
import type { Vehicle, World } from './types';

// A raider already fighting the player, which it has decided on, so no new roll interrupts the fight.
function fighting(world: World, raider: Vehicle): Vehicle {
  const me = world.player.vehicleId;
  raider.brain = npcBrain('buggy', raider.pos, ['raider']);
  raider.brain.noticed[`hostileSeen:${me}`] = world.turn;
  raider.brain.goals.push({ kind: 'fight', targetId: me, destination: { x: 35, y: 30 }, phase: 'travel', reason: 'test' });
  return raider;
}

function createFight() {
  const world = emptyWorld({ x: 35, y: 30 });
  const raider = fighting(world, addVehicle(world, 'raiders', 'hauler', ['mg', 'stockEngine', 'plowRam'], { x: 30, y: 30 }));
  return { world, raider };
}

describe('ram safety', () => {
  it('chooses an armored rear ram against a lighter target', () => {
    const { world, raider } = createFight();
    raider.speed = 5;
    planNpcOrders(world);
    expect(raider.brain?.ramTarget).toBe(world.player.vehicleId);
    expect(raider.order?.kind).toBe('through');
  });

  // A parked target is routed around, not braked for.
  it('holds its range instead of ramming a heavier armored target at close range', () => {
    const world = emptyWorld({ x: 35, y: 30 });
    const raider = fighting(world, addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 }));
    raider.speed = 5;
    planNpcOrders(world);
    expect(raider.brain!.ramTarget).toBeUndefined();
    expect(raider.order?.kind).toBe('stopAt');
  });

  it('does not commit to a ram with a nearly broken engine', () => {
    const { world, raider } = createFight();
    mountedParts(raider, 'engine')[0].hp = 1;
    planNpcOrders(world);
    expect(raider.brain?.ramTarget).toBeUndefined();
    expect(corePart(raider, 'cab').hp).toBeGreaterThan(0);
  });
});

describe('crippled drivers', () => {
  // A raider with no goals and the player far off, heard but not seen.
  function createListener() {
    const world = emptyWorld({ x: 1, y: 1 });
    const raider = addVehicle(world, 'raiders', 'hauler', ['mg', 'stockEngine', 'plowRam'], { x: 30, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    return { world, raider, me: world.player.vehicleId };
  }

  it('counts a dead engine as weak even while its cab and gun work, so fleeing a new hostile rises', () => {
    const { world, raider } = createFight();
    const me = world.player.vehicleId;
    const intact = optionWeights(world, raider, 'hostileSeen', me, 0).flee!;
    mountedParts(raider, 'engine')[0].hp = 0;
    expect(isWeak(world, raider)).toBe(true);
    expect(optionWeights(world, raider, 'hostileSeen', me, 0).flee).toBeCloseTo(intact * NPC_BEHAVIOR.weakFlee);
  });

  it('counts broken wheels as weak', () => {
    const { world, raider } = createFight();
    expect(isWeak(world, raider)).toBe(false);
    const wheel = mountedParts(raider).find((p) => p.defId === 'wheel');
    if (!wheel) throw new Error('Missing wheel');
    wheel.hp = 0;
    expect(isWeak(world, raider)).toBe(true);
  });

  it('rarely closes in on a heard contact when crippled, and heads for repairs', () => {
    const { world, raider, me } = createListener();
    const intact = optionWeights(world, raider, 'contactHeard', me, null).investigate!;
    mountedParts(raider, 'engine')[0].hp = 0;
    expect(optionWeights(world, raider, 'contactHeard', me, null).investigate).toBeCloseTo(intact * NPC_BEHAVIOR.crippledInvestigate);
    thinkNpc(world, raider);
    expect(raider.brain!.goals.some((g) => g.kind === 'resupply')).toBe(true);
  });
});
