import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { planNpcOrders } from './ai';
import { assignAutoOrders, fireWeapons } from './combat';
import { corePart, mountedParts } from './grid';
import { addGoods } from './inventory';
import { chooseNpcActivity, resolveNpcActivities } from './npc-activities';
import { sitePads } from './sites';
import { addVehicle, emptyWorld } from './testkit';
import type { Vehicle, World } from './types';

function createScenario(templateId = 'scavenger') {
  const world = emptyWorld({ x: 200, y: 200 });
  const npc = addVehicle(world, NPCS[templateId].faction, 'scout', ['mg', 'stockEngine'], { x: 30, y: 30 });
  npc.brain = { templateId, activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
  return { world, npc };
}

function fireAt(world: World, shooter: Vehicle, target: Vehicle) {
  for (const part of mountedParts(shooter, 'weapon')) shooter.weaponOrders[part.id] = { targetId: target.id, aim: 'body' };
  fireWeapons(world);
  expect(world.events.some((event) => event.t === 'shot' && event.shooter === shooter.id && event.target === target.id)).toBe(true);
}

function expectReturnFire(world: World, npc: Vehicle, enemy: Vehicle) {
  assignAutoOrders(world);
  expect(Object.values(npc.weaponOrders).some((order) => order.targetId === enemy.id)).toBe(true);
}

describe('NPC gameplay recovery', () => {
  it('lets an idle healthy scavenger attack a manageable hostile', () => {
    const { world, npc } = createScenario();
    addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    expect(chooseNpcActivity(world, npc).kind).toBe('fight');
  });

  it.each(['scavenger', 'trader'])('keeps a working %s out of an unrelated battle', (template) => {
    const { world, npc } = createScenario(template);
    planNpcOrders(world);
    const work = structuredClone(npc.brain!.activity);
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    const outsider = addVehicle(world, 'player', 'scout', [], { x: 35, y: 30 });
    fireAt(world, enemy, outsider);
    planNpcOrders(world);
    assignAutoOrders(world);
    expect(npc.brain!.activity).toEqual(work);
    expect(npc.weaponOrders).toEqual({});
  });

  it('interrupts work to fight its attacker and resumes the same destination after escape', () => {
    const { world, npc } = createScenario();
    planNpcOrders(world);
    const work = structuredClone(npc.brain!.activity);
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    fireAt(world, enemy, npc);
    planNpcOrders(world);
    expect(npc.brain!.activity?.kind).toBe('fight');
    expectReturnFire(world, npc, enemy);
    enemy.pos = { x: 200, y: 100 };
    enemy.speed = 0;
    planNpcOrders(world);
    expect(npc.brain!.activity).toEqual(work);
  });

  it.each(['scavenger', 'trader'])('allows a retreating %s to return fire', (template) => {
    const { world, npc } = createScenario(template);
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    fireAt(world, enemy, npc);
    corePart(npc, 'cab').hp = 1;
    planNpcOrders(world);
    expect(npc.brain!.activity?.kind).toBe('flee');
    expectReturnFire(world, npc, enemy);
  });

  it('allows a scavenger to help a nearby faction mate under attack', () => {
    const { world, npc } = createScenario();
    planNpcOrders(world);
    const ally = addVehicle(world, 'scavengers', 'scout', [], { x: 32, y: 32 });
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    fireAt(world, enemy, ally);
    planNpcOrders(world);
    expect(npc.brain!.activity?.kind).toBe('fight');
    expectReturnFire(world, npc, enemy);
  });

  it('does not use guard protection to silence a victim defending itself', () => {
    const { world, npc } = createScenario();
    const gate = sitePads(REGION.towns[0])[0];
    npc.pos = { ...gate };
    const enemy = addVehicle(world, 'raiders', 'buggy', ['mg'], { x: gate.x + 3, y: gate.y });
    fireAt(world, enemy, npc);
    planNpcOrders(world);
    expectReturnFire(world, npc, enemy);
  });

  it('does not treat unrelated visible factions as one army', () => {
    const { world, npc } = createScenario('buggy');
    addVehicle(world, 'traders', 'scout', ['mg'], { x: 33, y: 30 });
    addVehicle(world, 'scavengers', 'scout', ['mg'], { x: 30, y: 42 });
    expect(chooseNpcActivity(world, npc).kind).toBe('fight');
  });

  it('withdraws from a locally stronger enemy group', () => {
    const { world, npc } = createScenario('buggy');
    addVehicle(world, 'scavengers', 'scout', ['mg'], { x: 33, y: 30 });
    addVehicle(world, 'scavengers', 'scout', ['mg'], { x: 34, y: 32 });
    expect(chooseNpcActivity(world, npc).kind).toBe('flee');
  });

  it('investigates a useful contact once instead of chasing its moving center forever', () => {
    const { world, npc } = createScenario('buggy');
    const prey = addVehicle(world, 'traders', 'scout', ['stockEngine'], { x: 55, y: 30 });
    prey.speed = 4;
    planNpcOrders(world);
    expect(npc.brain!.activity?.kind).toBe('investigate');
    const destination = { ...npc.brain!.activity!.destination! };
    prey.pos.x += 1;
    planNpcOrders(world);
    expect(npc.brain!.activity?.destination).toEqual(destination);
    npc.pos = destination;
    prey.pos = { x: destination.x + 25, y: destination.y };
    resolveNpcActivities(world);
    planNpcOrders(world);
    expect(npc.brain!.activity?.kind).not.toBe('investigate');
  });

  it('services low fuel instead of pursuing a contact or taking a shade detour', () => {
    const { world, npc } = createScenario('buggy');
    npc.resources!.fuel = 0;
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    const prey = addVehicle(world, 'traders', 'scout', ['stockEngine'], { x: 55, y: 30 });
    prey.speed = 4;
    const activity = chooseNpcActivity(world, npc);
    expect(['resupply', 'repair']).toContain(activity.kind);
    if (activity.kind === 'repair') expect(activity.destination).toEqual(npc.pos);
  });
});
