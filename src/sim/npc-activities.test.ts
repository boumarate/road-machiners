import { TERRAIN } from '../data/terrain';
import { describe, expect, it } from 'vitest';
import { contactsOf } from './detect';
import { emptyWorld, addVehicle, editableTerrain, forceOption, npcBrain } from './testkit';
import { planNpcOrders } from './ai';
import { getResources } from './resources';
import { REGION } from '../data/region';
import { TRAITS } from '../data/npcs';
import { endTurn } from './world';
import { corePart, goodsCount } from './grid';
import { addGoods } from './inventory';
import { getActivityDestination, resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { cloneWorld } from './world';
import { canUseSite, siteGates } from './sites';

function createScavenger() {
  const w = emptyWorld({ x: 50, y: 50 });
  const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
  return { w, npc };
}

describe('NPC activities', () => {
  it('uses Icarus sites for every trait destination', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    for (const profile of Object.values(TRAITS)) {
      for (const id of [...profile.towns, ...profile.bases, ...profile.salvageSites, ...profile.supplySites]) {
        expect(sites.find((site) => site.id === id), `missing site ${id}`).toBeDefined();
      }
    }
  });

  it('stops at the town gate nearest to it, even from the far side of the wall', () => {
    const { w, npc } = createScavenger();
    const town = REGION.towns[0];
    const gate = siteGates(town)[0];
    npc.pos = { x: town.pos.x - (gate.x - town.pos.x) * 1.3, y: town.pos.y - (gate.y - town.pos.y) * 1.3 };
    const stop = getActivityDestination(w, npc, { kind: 'sell', targetId: town.id, destination: { ...town.pos }, phase: 'travel', reason: 'test activity' })!;
    expect(canUseSite(stop, town)).toBe(true);
    expect(Math.hypot(stop.x - town.pos.x, stop.y - town.pos.y)).toBeGreaterThan(town.radius);
  });

  it.each(['sell', 'resupply', 'raid'] as const)('records completion of %s once', (kind) => {
    const { w, npc } = createScavenger();
    npc.pos = { ...siteGates(REGION.towns[0])[0] };
    npc.brain!.goals = [{ kind, targetId: REGION.towns[0].id, destination: { ...npc.pos }, phase: 'travel', reason: 'test activity' }];
    w.events = [];
    resolveNpcActivities(w);
    resolveNpcActivities(w);
    expect(w.events.filter((event) => event.t === 'activity')).toEqual([
      expect.objectContaining({ previous: kind, activity: null }),
    ]);
  });

  it('records failure when a salvage target disappears', () => {
    const { w, npc } = createScavenger();
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'retired-wreck', destination: { ...npc.pos }, phase: 'travel', reason: 'collect visible salvage' }];
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
    const full = cloneWorld(w);
    full.salvage[0].goods.scrap = 5;
    expect(thinkNpc(full, full.vehicles.find((v) => v.id === npc.id)!)).toEqual(thinkNpc(w, npc));
  });

  it('preserves a trip even when another site becomes closer', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    const activity = topGoal(npc);
    npc.pos = { x: 25, y: 20 };
    expect(thinkNpc(w, npc)).toBe(activity);
  });

  it('keeps upkeep money when buying trade cargo', () => {
    const { w, npc } = createScavenger();
    npc.brain!.templateId = 'trader';
    npc.brain!.traits = ['trader'];
    npc.pos = { ...siteGates(REGION.towns[0])[0] };
    forceOption('idle', 'trade');
    planNpcOrders(w);
    resolveNpcActivities(w);
    expect(npc.resources!.money).toBeGreaterThan(0);
    expect(Object.values(goodsCount(npc)).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);
    expect(topGoal(npc)?.kind).toBe('sell');
  });

  it('a raider can destroy an NPC and sell the actual loot', () => {
    const w0 = emptyWorld({ x: 58, y: 58 });
    const raider = addVehicle(w0, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 14, y: 12 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('hostileSeen', 'fight');
    forceOption('idle', 'scavenge');
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
    expect(topGoal(npc)?.kind).toBe('scavenge');
    expect(TRAITS.scavenger.salvageSites).toContain(topGoal(npc)?.targetId);
  });

  it('interrupts work for low fuel', () => {
    const { w, npc } = createScavenger();
    planNpcOrders(w);
    getResources(w, npc).fuel = 0;
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('resupply');
  });

  it('lets an idle healthy scavenger fight a nearby raider', () => {
    const { w, npc } = createScavenger();
    addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 13, y: 10 });
    forceOption('hostileSeen', 'fight');
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('fight');
  });

  it('flees when damaged, and stops tracking a target behind cover', () => {
    const { w, npc } = createScavenger();
    addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    corePart(npc, 'cab').hp = 1;
    forceOption('hostileSeen', 'flee');
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('flee');
    w.obstacles.push({ id: 'cover', kind: 'rock', pos: { x: 12, y: 10 }, r: 1 });
    planNpcOrders(w);
    expect(topGoal(npc)?.kind).toBe('resupply');
  });

  it('flees away from an attacker that stands between it and a known town', () => {
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const w = emptyWorld({ x: bowl.pos.x + 150, y: bowl.pos.y + 150 });
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: bowl.pos.x + bowl.radius + 20, y: bowl.pos.y });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: trader.pos.x - 5, y: trader.pos.y });
    forceOption('hostileSeen', 'flee');
    planNpcOrders(w);
    const flee = topGoal(trader)!;
    expect(flee.kind).toBe('flee');
    const away = { x: flee.destination!.x - trader.pos.x, y: flee.destination!.y - trader.pos.y };
    const toThreat = { x: raider.pos.x - trader.pos.x, y: raider.pos.y - trader.pos.y };
    expect(away.x * toThreat.x + away.y * toThreat.y).toBeLessThan(0);
  });

  it('a raider investigates a nearby heard player', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    player.speed = 4; // loud enough to be heard far past sight range
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 }); // just past sight
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).toBe('investigate');
    expect(topGoal(raider)?.targetId).toBe(player.id);
  });

  it('a distant contact remains audible without redirecting a raider', () => {
    const w = emptyWorld({ x: 100, y: 300 });
    const player = w.vehicles[0];
    player.speed = 4;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 220, y: 300 }); // 120 tiles, far past the old 34-tile limit
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('contactHeard', 'investigate');
    planNpcOrders(w);
    expect(contactsOf(w, raider, Infinity).some((c) => c.vehicleId === player.id)).toBe(true);
    expect(topGoal(raider)?.kind).toBe('raid');
    expect(topGoal(raider)?.targetId).toBeNull();
  });

  it('a trader turns away from a heard raider', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 30, y: 30 });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + TERRAIN.vision.radius + 5, y: 30 }); // just past sight
    raider.speed = 4;
    forceOption('contactHeard', 'flee');
    planNpcOrders(w);
    expect(topGoal(trader)?.kind).toBe('flee');
    expect(topGoal(trader)?.targetId).toBe(raider.id);
  });

  it('a parked player behind a hill goes unnoticed', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const player = w.vehicles[0];
    player.speed = 0; // parked: no sound, no dust
    editableTerrain(w);
    const size = w.terrain.size;
    for (let i = 33; i <= 37; i++) for (let j = 28; j <= 32; j++) w.terrain.heights[j * (size + 1) + i] = 3;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 }); // beyond the hill
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    planNpcOrders(w);
    expect(topGoal(raider)?.kind).not.toBe('investigate');
    expect(topGoal(raider)?.kind).not.toBe('fight');
    expect(topGoal(raider)?.kind).not.toBe('flee');
  });
});
