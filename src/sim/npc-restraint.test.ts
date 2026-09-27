import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { partDef } from '../data/parts';
import { planNpcOrders } from './ai';
import { assignAutoOrders } from './combat';
import { corePart, goodsCount } from './grid';
import { addGoods } from './inventory';
import { advanceJobs } from './jobs';
import { chooseNpcActivity, resolveNpcActivities } from './npc-activities';
import { spawnInitial } from './spawn';
import { inShade, sunAt } from './sun';
import { straightClear } from './path';
import { vehicleStats } from './stats';
import { endTurn } from './world';
import { addVehicle, emptyWorld, testDrive } from './testkit';
import { siteGates } from './sites';

function createNpc(templateId = 'scavenger') {
  const world = emptyWorld({ x: 200, y: 200 });
  const template = NPCS[templateId];
  const npc = addVehicle(world, template.faction, 'scout', ['mg', 'stockEngine'], { x: 30, y: 30 });
  npc.brain = { templateId, activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
  return { world, npc };
}

describe('NPC restraint', () => {
  it('preserves normal raider cargo alongside available repair supplies', () => {
    const world = emptyWorld();
    spawnInitial(world);
    const raiders = world.vehicles.filter((v) => v.faction === 'raiders');
    expect(raiders.some((npc) => Object.entries(goodsCount(npc)).some(([good, count]) => good !== 'parts' && count > 0))).toBe(true);
    expect(raiders.some((npc) => (goodsCount(npc).parts ?? 0) > 0)).toBe(true);
  });

  it('does not abandon civilian work or open fire at an uninvolved hostile', () => {
    const { world, npc } = createNpc();
    planNpcOrders(world);
    addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    planNpcOrders(world);
    assignAutoOrders(world);
    expect(npc.brain!.activity!.kind).toBe('scavenge');
    expect(npc.weaponOrders).toEqual({});
  });

  it('judges the nearby hostile faction group before attacking', () => {
    const { world, npc } = createNpc('buggy');
    addVehicle(world, 'traders', 'scout', ['mg'], { x: 33, y: 30 });
    addVehicle(world, 'traders', 'scout', ['mg'], { x: 33, y: 32 });
    expect(chooseNpcActivity(world, npc).kind).toBe('flee');
  });

  it('still attacks an isolated manageable target', () => {
    const { world, npc } = createNpc('buggy');
    const prey = addVehicle(world, 'traders', 'scout', [], { x: 33, y: 30 });
    addGoods(world, prey, 'scrap', 1);
    planNpcOrders(world);
    assignAutoOrders(world);
    expect(npc.brain!.activity!.kind).toBe('fight');
    expect(Object.keys(npc.weaponOrders)).toHaveLength(1);
  });

  it('does not attack prey at a guarded town gate', () => {
    const { world, npc } = createNpc('buggy');
    const gate = siteGates(REGION.towns[0])[0];
    npc.pos = { x: gate.x + 3, y: gate.y };
    const prey = addVehicle(world, 'traders', 'scout', [], gate);
    addGoods(world, prey, 'scrap', 1);
    planNpcOrders(world);
    assignAutoOrders(world);
    expect(npc.brain!.activity!.kind).not.toBe('fight');
    expect(npc.weaponOrders).toEqual({});
  });
});

describe('NPC field repairs', () => {
  it('parks in nearby reachable shade and spends carried parts to patch damage', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    const cab = corePart(npc, 'cab');
    cab.hp = partDef(cab.defId).hp * 0.2;
    const before = cab.hp;
    const sun = sunAt(world.turn)!;
    world.obstacles.push({ id: 'shade-rock', kind: 'rock', pos: { x: 34, y: 33 }, r: 1 });
    expect(inShade(world, npc.pos, sun)).toBe(false);
    planNpcOrders(world);
    const activity = npc.brain!.activity!;
    expect(activity.kind).toBe('repair');
    expect(inShade(world, activity.destination!, sun)).toBe(true);
    expect(straightClear(world, npc.pos, activity.destination!, vehicleStats(world, npc).radius, [])).toBe(true);
    npc.pos = { ...activity.destination! };
    npc.speed = 0;
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
    const turns = npc.job!.total;
    for (let turn = 0; turn < turns; turn++) {
      planNpcOrders(world);
      expect(npc.order?.kind).toBe('brake');
      advanceJobs(world);
    }
    expect(npc.job).toBeNull();
    expect(cab.hp).toBeGreaterThan(before);
    expect(goodsCount(npc).parts ?? 0).toBeLessThan(2);
  });

  it('parks to repair when no shade is reachable', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    planNpcOrders(world);
    expect(npc.brain!.activity!.kind).toBe('repair');
    expect(npc.order?.kind).toBe('brake');
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
  });

  it.each([false, true])('repairs where it stopped with no fuel, detour already chosen: %s', (started) => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    world.obstacles.push({ id: 'shade-rock', kind: 'rock', pos: { x: 34, y: 33 }, r: 1 });
    if (started) planNpcOrders(world);
    npc.resources!.fuel = 0;
    planNpcOrders(world);
    expect(npc.brain!.activity!.kind).toBe('repair');
    expect(npc.order?.kind).toBe('brake');
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
  });

  it('flees instead of repairing under visible threat', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 1;
    addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });
    planNpcOrders(world);
    resolveNpcActivities(world);
    expect(npc.brain!.activity!.kind).toBe('flee');
    expect(npc.job).toBeNull();
  });

  it.each([false, true])('orders escape during a repair and obeys parked-job rules, pinned: %s', (pinned) => {
    const { world, npc } = createNpc();
    for (const id of Object.keys(NPCS)) world.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    addGoods(world, npc, 'parts', 2);
    corePart(npc, 'cab').hp = 12;
    planNpcOrders(world);
    resolveNpcActivities(world);
    expect(npc.job?.kind).toBe('repair');
    const remaining = npc.job!.turnsLeft;
    addVehicle(world, 'raiders', 'buggy', ['mg'], { x: 33, y: 30 });

    // Exercise both movement outcomes at the public turn boundary, without depending on steering startup.
    const next = endTurn(world, (draft) => {
      const moved = draft.vehicles.find((vehicle) => vehicle.id === npc.id);
      if (!moved) throw new Error('Missing repair NPC');
      const before = { ...moved.pos, heading: moved.heading };
      moved.speed = pinned ? 0 : RULES.parkedSpeed * 2;
      moved.pos = { x: moved.pos.x + moved.speed, y: moved.pos.y };
      moved.trail = [before, { ...moved.pos, heading: moved.heading }];
    });
    const actor = next.vehicles.find((vehicle) => vehicle.id === npc.id)!;
    expect(actor.brain!.activity?.kind).toBe('flee');
    expect(actor.order?.kind).toBe('through');
    expect(goodsCount(actor).parts).toBe(2);
    if (pinned) {
      expect(actor.speed).toBe(0);
      expect(actor.job?.turnsLeft).toBe(remaining - 1);
    } else {
      expect(actor.speed).toBeGreaterThan(0);
      expect(actor.job).toBeNull();
      expect(next.events.some((event) => event.t === 'job' && event.vehicle === actor.id && event.outcome === 'cancelled')).toBe(true);
    }
  });

  it('seeks service for a badly damaged mounted part without repair supplies', () => {
    const { world, npc } = createNpc();
    const engine = npc.items.find((item) => item.kind === 'part' && item.part.defId === 'stockEngine');
    if (!engine || engine.kind !== 'part') throw new Error('Missing test engine');
    engine.part.hp = 1;
    expect(chooseNpcActivity(world, npc).kind).toBe('resupply');
  });

  it('preserves repair supplies during a town service visit', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    npc.resources!.fuel = 0;
    npc.pos = { ...siteGates(REGION.towns[0])[0] };
    planNpcOrders(world);
    expect(npc.brain!.activity!.kind).toBe('resupply');
    resolveNpcActivities(world);
    expect(goodsCount(npc).parts).toBe(2);
    expect(npc.resources!.fuel).toBeGreaterThan(0);
  });

  it('finishes field repairs through the turn pipeline and resumes work', () => {
    let { world, npc } = createNpc();
    for (const id of Object.keys(NPCS)) world.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    addGoods(world, npc, 'parts', 2);
    const cab = corePart(npc, 'cab');
    cab.hp = partDef(cab.defId).hp * 0.2;
    const initialHp = cab.hp;
    const npcId = npc.id;
    let started = false;
    let completed = false;
    for (let turn = 0; turn < 8; turn++) {
      world = endTurn(world, testDrive);
      npc = world.vehicles.find((v) => v.id === npcId)!;
      started ||= world.events.some((e) => e.t === 'job' && e.vehicle === npcId && e.outcome === 'started');
      completed ||= world.events.some((e) => e.t === 'job' && e.vehicle === npcId && e.outcome === 'done');
    }
    expect(started).toBe(true);
    expect(completed).toBe(true);
    expect(corePart(npc, 'cab').hp).toBeGreaterThan(initialHp);
    expect(npc.brain!.activity!.kind).toBe('scavenge');
    expect(goodsCount(npc).parts ?? 0).toBe(0);
  });

  it('does not sell its repair reserve or treat it as trade cargo', () => {
    const { world, npc } = createNpc();
    addGoods(world, npc, 'parts', 2);
    expect(chooseNpcActivity(world, npc).kind).toBe('scavenge');
    addGoods(world, npc, 'scrap', 1);
    npc.pos = { ...siteGates(REGION.towns[0])[0] };
    npc.brain!.activity = { kind: 'sell', targetId: REGION.towns[0].id, destination: REGION.towns[0].pos, phase: 'act', reason: 'sell loot' };
    resolveNpcActivities(world);
    expect(goodsCount(npc).scrap ?? 0).toBe(0);
    expect(goodsCount(npc).parts).toBe(2);
  });
});
