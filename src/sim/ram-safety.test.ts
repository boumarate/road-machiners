import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld } from './testkit';
import { corePart, mountedParts } from './grid';
import { chooseNpcActivity } from './npc-activities';
import { planNpcOrders } from './ai';

function createFight() {
  const world = emptyWorld({ x: 35, y: 30 });
  const raider = addVehicle(world, 'raiders', 'hauler', ['mg', 'stockEngine', 'plowRam'], { x: 30, y: 30 });
  raider.brain = { templateId: 'buggy', activity: null, goal: null, home: { ...raider.pos }, stepIndex: 0, refusedTow: false };
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

  it('brakes instead of ramming a heavier armored target at close range', () => {
    const world = emptyWorld({ x: 35, y: 30 });
    const raider = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    raider.brain = { templateId: 'buggy', activity: null, goal: null, home: { ...raider.pos }, stepIndex: 0, refusedTow: false };
    raider.speed = 5;
    planNpcOrders(world);
    expect(raider.brain.ramTarget).toBeUndefined();
    expect(raider.order?.kind).toBe('brake');
  });

  it('retreats with a dead engine even while its cab and gun work', () => {
    const { world, raider } = createFight();
    mountedParts(raider, 'engine')[0].hp = 0;
    expect(chooseNpcActivity(world, raider).kind).toBe('flee');
  });

  it('retreats with broken wheels rather than continuing to fight', () => {
    const { world, raider } = createFight();
    const wheel = mountedParts(raider).find((p) => p.defId === 'wheel');
    if (!wheel) throw new Error('Missing wheel');
    wheel.hp = 0;
    expect(chooseNpcActivity(world, raider).kind).toBe('flee');
  });

  it('seeks repairs instead of chasing distant hostile sounds when crippled', () => {
    const { world, raider } = createFight();
    mountedParts(raider, 'engine')[0].hp = 0;
    world.vehicles[0].pos = { x: 1, y: 1 };
    world.vehicles[0].speed = 5;
    expect(chooseNpcActivity(world, raider).kind).toBe('resupply');
  });

  it('does not commit to a ram with a nearly broken engine', () => {
    const { world, raider } = createFight();
    mountedParts(raider, 'engine')[0].hp = 1;
    planNpcOrders(world);
    expect(raider.brain?.ramTarget).toBeUndefined();
    expect(corePart(raider, 'cab').hp).toBeGreaterThan(0);
  });
});
