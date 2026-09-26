import { describe, expect, it } from 'vitest';
import { emptyWorld, addVehicle } from './testkit';
import { planNpcOrders } from './ai';
import { getResources } from './resources';
import { REGION } from '../data/region';
import { NPC_CLASSES } from '../data/npcs';
import { endTurn } from './world';
import { corePart, goodsCount } from './grid';
import { addGoods } from './inventory';
import { resolveNpcActivities, chooseNpcActivity } from './npc-activities';

function createScavenger() {
  const w = emptyWorld({ x: 50, y: 50 });
  const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
  npc.brain = { templateId: 'scavenger', activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0 };
  return { w, npc };
}

describe('NPC activities', () => {
  it('uses Icarus sites for every class destination', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    for (const profile of Object.values(NPC_CLASSES)) {
      for (const id of [...profile.towns, ...profile.salvageSites, ...profile.supplySites]) {
        expect(sites.find((site) => site.id === id), `missing site ${id}`).toBeDefined();
      }
    }
  });

  it.each(['sell', 'resupply', 'raid'] as const)('records completion of %s once', (kind) => {
    const { w, npc } = createScavenger();
    npc.pos = { ...REGION.towns[0].pos };
    npc.brain!.activity = { kind, targetId: REGION.towns[0].id, destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' };
    w.events = [];
    resolveNpcActivities(w);
    resolveNpcActivities(w);
    expect(w.events.filter((event) => event.t === 'activity')).toEqual([
      expect.objectContaining({ previous: kind, activity: null }),
    ]);
  });

  it('records failure when a salvage target disappears', () => {
    const { w, npc } = createScavenger();
    npc.brain!.activity = { kind: 'scavenge', targetId: 'retired-wreck', destination: { ...npc.pos }, phase: 'travel', reason: 'collect visible salvage' };
    w.events = [];
    resolveNpcActivities(w);
    expect(w.events).toEqual([expect.objectContaining({ previous: 'scavenge', activity: null, reason: 'salvage no longer available' })]);
  });

  it('completes a collect-sell-upkeep loop through actual turns', () => {
    let { w, npc } = createScavenger();
    const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    npc.pos = { x: convoy.pos.x + convoy.radius + 1, y: convoy.pos.y };
    npc.heading = Math.PI;
    for (const key of Object.keys(w.spawnTimer)) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    // Spawn timers are initialized lazily, so disable every template explicitly.
    for (const key of ['buggy', 'gunwagon', 'trader', 'scavenger']) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const id = npc.id;
    const initialMoney = npc.resources!.money;
    let collected = false;
    let sold = false;
    let serviced = false;
    for (let turn = 0; turn < w.size * 5; turn++) {
      w = endTurn(w);
      npc = w.vehicles.find((v) => v.id === id)!;
      if ((goodsCount(npc).scrap ?? 0) > 0) collected = true;
      if (collected && npc.resources!.money > initialMoney && !sold) {
        sold = true;
        npc.resources!.fuel = 0;
      } else if (sold && npc.resources!.fuel > 0) { serviced = true; break; }
    }
    expect(collected).toBe(true);
    expect(sold).toBe(true);
    expect(serviced).toBe(true);
  });

  it('cannot inspect distant salvage contents', () => {
    const { w, npc } = createScavenger();
    w.salvage = [{ id: 'wreck-test', pos: { x: 17, y: 10 }, radius: 0.6, goods: { scrap: 0 }, parts: [] }];
    const empty = chooseNpcActivity(w, npc);
    w.salvage[0].goods.scrap = 5;
    expect(chooseNpcActivity(w, npc)).toEqual(empty);
  });

  it('preserves a trip even when another site becomes closer', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    const activity = npc.brain!.activity;
    npc.pos = { x: 25, y: 20 };
    expect(chooseNpcActivity(w, npc)).toBe(activity);
  });

  it('keeps upkeep money when buying trade cargo', () => {
    const { w, npc } = createScavenger();
    npc.brain!.templateId = 'trader';
    npc.pos = { ...REGION.towns[0].pos };
    planNpcOrders(w);
    resolveNpcActivities(w);
    expect(npc.resources!.money).toBeGreaterThan(0);
    expect(Object.values(goodsCount(npc)).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);
    expect(npc.brain!.activity?.kind).toBe('sell');
  });

  it('a raider can destroy an NPC and sell the actual loot', () => {
    const w0 = emptyWorld({ x: 58, y: 58 });
    const raider = addVehicle(w0, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 14, y: 12 });
    raider.brain = { templateId: 'buggy', activity: null, goal: null, home: { ...raider.pos }, stepIndex: 0 };
    const victim = addVehicle(w0, 'scavengers', 'scout', [], { x: 16, y: 12 });
    corePart(victim, 'cab').hp = 1;
    addGoods(w0, victim, 'scrap', 3);
    for (const key of ['buggy', 'gunwagon', 'trader', 'scavenger']) w0.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const money = raider.resources!.money;
    let w = w0;
    let looted = false;
    let sold = false;
    for (let turn = 0; turn < w.size * 5; turn++) {
      w = endTurn(w);
      const actor = w.vehicles.find((v) => v.id === raider.id)!;
      if ((goodsCount(actor).scrap ?? 0) > 0) {
        looted = true;
        const stock = w.salvage.find((entry) => entry.id === `wreck-${victim.id}`)!;
        expect(stock.goods.scrap + goodsCount(actor).scrap).toBe(3);
      }
      if (looted && actor.resources!.money > money) { sold = true; break; }
    }
    expect(w.vehicles.some((v) => v.id === victim.id)).toBe(false);
    expect(looted).toBe(true);
    expect(sold).toBe(true);
  });

  it('selects a known salvage site without needing to see it', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    expect(npc.brain!.activity?.kind).toBe('scavenge');
    expect(NPC_CLASSES.scavenger.salvageSites).toContain(npc.brain!.activity?.targetId);
  });

  it('interrupts work for low fuel', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    getResources(w, npc).fuel = 0;
    planNpcOrders(w);
    expect(npc.brain!.activity?.kind).toBe('resupply');
  });

  it('lets a healthy scavenger fight a nearby raider', () => {
    const { w, npc } = createScavenger();
    addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 13, y: 10 });
    planNpcOrders(w);
    expect(npc.brain!.activity?.kind).toBe('fight');
  });

  it('flees when damaged, and stops tracking a target behind cover', () => {
    const { w, npc } = createScavenger();
    addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    corePart(npc, 'cab').hp = 1;
    planNpcOrders(w);
    expect(npc.brain!.activity?.kind).toBe('flee');
    w.obstacles.push({ id: 'cover', kind: 'rock', pos: { x: 12, y: 10 }, r: 1 });
    planNpcOrders(w);
    expect(npc.brain!.activity?.kind).toBe('resupply');
  });
});
