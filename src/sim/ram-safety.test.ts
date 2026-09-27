import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { corePart, mountedParts } from './grid';
import { planNpcOrders } from './ai';
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
