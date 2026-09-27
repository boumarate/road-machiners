import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { partDef } from '../data/parts';
import { PATCH } from '../data/wear';
import { SKILL_EFFECTS, XP_TO_REACH } from '../data/skills';
import { playerVehicle } from './damage';
import { callVehicle, chooseOption, currentOptions } from './dialogue';
import { goodsCount, mountedParts } from './grid';
import { addGoods, removeGoods } from './inventory';
import { topGoal } from './npc-activities';
import { patchData, patchTerms, settlePatch } from './patch';
import { addState, stateOf } from './states';
import { isStranded } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, testDrive } from './testkit';
import type { GameEvent, PatchDeal, Vehicle, World } from './types';
import { cloneWorld, endTurn, setMoveOrder } from './world';

function answer(w: World, text: string): World {
  const i = currentOptions(w).findIndex((o) => o.text === text);
  if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => o.text).join(' | ')}`);
  return chooseOption(w, i);
}

function breakEngine(v: Vehicle): void {
  mountedParts(v, 'engine')[0].hp = 0;
}

const parts = (v: Vehicle) => goodsCount(v).parts ?? 0;

// Start kits carry spare parts. Tests set the count they need.
function setParts(w: World, v: Vehicle, n: number): void {
  removeGoods(v, 'parts', parts(v));
  addGoods(w, v, 'parts', n);
}
const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

// A player with a dead engine and a parked trader in sight. No spawns, so nothing interrupts the work.
function brokenPlayer(traderParts: number): { w: World; trader: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  w.player.autoRepair = false; // the player's own field repair would spend the same parts
  breakEngine(playerVehicle(w));
  setParts(w, playerVehicle(w), 0);
  const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 38, y: 30 }, Math.PI);
  trader.brain = npcBrain('trader', trader.pos, ['trader']);
  addGoods(w, trader, 'parts', traderParts);
  return { w, trader };
}

function askPatch(w: World, traderId: string): World {
  w = callVehicle(w, traderId);
  return answer(w, 'My truck is broken down. Can you patch it?');
}

function runUntil(w: World, max: number, done: (w: World) => boolean): { w: World; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < max && !done(w); i++) {
    w = endTurn(w, testDrive);
    events.push(...w.events);
  }
  return { w, events };
}

// The deal is rolled when the topic opens, so force it before asking.
function agreedTerms(start: World, traderId: string, deal: PatchDeal): World {
  forceOption('patchDeal', deal);
  let w = askPatch(start, traderId);
  w = answer(w, 'Engine or gearbox. What would it take?');
  expect(w.player.call?.vars.deal).toMatchObject({ kind: 'deal', deal, patcher: 'npc' });
  return answer(w, 'Deal. I will stay put.');
}

describe('asking a driver for a patch', () => {
  it('a driver without parts cannot help', () => {
    const { w, trader } = brokenPlayer(0);
    const asked = askPatch(w, trader.id);
    expect(currentOptions(asked).map((o) => o.text)).toContain('Engine or gearbox. Can you do anything?');
  });

  it('a truck that is not broken cannot ask', () => {
    const { w, trader } = brokenPlayer(4);
    mountedParts(playerVehicle(w), 'engine')[0].hp = 10;
    const open = callVehicle(w, trader.id);
    expect(currentOptions(open).map((o) => o.text)).not.toContain('My truck is broken down. Can you patch it?');
  });

  it('a free patch spends the patcher parts, costs nothing and gets the truck going', () => {
    const { w: start, trader } = brokenPlayer(4);
    const money = start.player.money;
    let w = agreedTerms(start, trader.id, 'free');
    const needed = patchData(stateOf(w, 'patch', trader.id, w.player.vehicleId)!).parts;
    expect(topGoal(find(w, trader.id))?.kind).toBe('patch');
    const r = runUntil(w, 40, (x) => stateOf(x, 'patch', trader.id, x.player.vehicleId) === null);
    w = r.w;
    expect(r.events.filter((e) => e.t === 'patch').map((e) => e.t === 'patch' && e.outcome)).toEqual(['started', 'done']);
    expect(parts(find(w, trader.id))).toBe(4 - needed);
    expect(w.player.money).toBe(money);
    const engine = mountedParts(playerVehicle(w), 'engine')[0];
    expect(engine.hp).toBe(Math.max(1, Math.round(partDef(engine.defId).hp * PATCH.share)));
    expect(isStranded(w, playerVehicle(w))).toBe(false);
  });

  it('a paid patch charges the client once, into debt if need be', () => {
    const { w: start, trader } = brokenPlayer(4);
    start.player.money = 0;
    const traderMoney = trader.resources!.money;
    let w = agreedTerms(start, trader.id, 'paid');
    const price = patchData(stateOf(w, 'patch', trader.id, w.player.vehicleId)!).price;
    expect(price).toBeGreaterThan(0);
    w = runUntil(w, 40, (x) => stateOf(x, 'patch', trader.id, x.player.vehicleId) === null).w;
    expect(w.player.money).toBe(-price);
    expect(find(w, trader.id).resources!.money).toBe(traderMoney + price);
  });

  it('an own-parts patch spends the client parts', () => {
    const { w: start, trader } = brokenPlayer(0);
    setParts(start, playerVehicle(start), 3);
    let w = agreedTerms(start, trader.id, 'ownParts');
    const needed = patchData(stateOf(w, 'patch', trader.id, w.player.vehicleId)!).parts;
    w = runUntil(w, 40, (x) => stateOf(x, 'patch', trader.id, x.player.vehicleId) === null).w;
    expect(parts(playerVehicle(w))).toBe(3 - needed);
    expect(isStranded(w, playerVehicle(w))).toBe(false);
  });

  it('never rolls a deal its payer cannot cover', () => {
    const { w, trader } = brokenPlayer(0);
    setParts(w, playerVehicle(w), 3);
    forceOption('patchDeal', 'free');
    const asked = answer(askPatch(w, trader.id), 'Engine or gearbox. What would it take?');
    expect(asked.player.call?.vars.deal).toMatchObject({ deal: 'ownParts' });
  });
});

describe('a stranded driver asking the player', () => {
  // A scavenger with a dead engine parks in sight of a player who carries parts.
  function brokenNpc(): { w: World; npc: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    w.player.autoRepair = false;
    setParts(w, playerVehicle(w), 4);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    breakEngine(npc);
    return { w, npc };
  }

  it('calls once, and the player patches it for pay by parking beside it', () => {
    const { w: start, npc } = brokenNpc();
    forceOption('patchDeal', 'paid');
    let w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'patchRequest' });
    w = answer(w, 'What are you offering?');
    w = answer(w, 'Deal. Stay where you are.');
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    expect(topGoal(find(w, npc.id))?.reason).toBe('wait for a patch');
    const playerMoney = w.player.money;
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 38, y: 30 } });
    const r = runUntil(w, 60, (x) => stateOf(x, 'patch', x.player.vehicleId, npc.id) === null);
    w = r.w;
    expect(isStranded(w, find(w, npc.id))).toBe(false);
    expect(w.player.money).toBe(playerMoney + deal.price);
    expect(parts(playerVehicle(w))).toBe(4 - deal.parts);
    expect(w.player.talked[npc.id]).toEqual({ patchRequest: 'agreed' });
  });

  it('the player can offer the patch over the radio before the driver asks', () => {
    const { w: start, npc } = brokenNpc();
    forceOption('patchDeal', 'paid');
    let w = callVehicle(start, npc.id);
    w = answer(w, 'Your truck looks dead. Want me to patch it?');
    w = answer(w, 'What can you offer?');
    w = answer(w, 'Deal. Stay where you are.');
    expect(stateOf(w, 'patch', w.player.vehicleId, npc.id)).not.toBeNull();
    expect(topGoal(find(w, npc.id))?.reason).toBe('wait for a patch');
  });

  it('a driver with a sound truck gets no patch offer', () => {
    const { w: start, npc } = brokenNpc();
    mountedParts(npc, 'engine')[0].hp = partDef('stockEngine').hp;
    const w = callVehicle(start, npc.id);
    expect(currentOptions(w).map((o) => o.text)).not.toContain('Your truck looks dead. Want me to patch it?');
  });

  it('a driver carrying the parts fixes its own truck instead of asking', () => {
    const { w: start, npc } = brokenNpc();
    addGoods(start, npc, 'parts', 2);
    const w = endTurn(start, testDrive);
    expect(w.player.call).toBeNull();
  });

  it('a refused request is not raised again', () => {
    const { w: start, npc } = brokenNpc();
    let w = endTurn(start, testDrive);
    w = answer(w, 'What are you offering?');
    w = answer(w, 'Not today.');
    w = runUntil(w, 5, (x) => x.player.call !== null).w;
    expect(w.player.call).toBeNull();
    expect(w.player.talked[npc.id]).toEqual({ patchRequest: 'refused' });
  });

  it('a client that can no longer pay breaks the deal for free', () => {
    const { w: start, npc } = brokenNpc();
    forceOption('patchDeal', 'paid');
    let w = endTurn(start, testDrive);
    w = answer(answer(w, 'What are you offering?'), 'Deal. Stay where you are.');
    // The forced roll is only likely, so the deal is set to a paid one here.
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    Object.assign(deal, { deal: 'paid', price: Math.max(deal.price, 1) });
    find(w, npc.id).resources!.money = 0;
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 38, y: 30 } });
    w = runUntil(w, 40, (x) => stateOf(x, 'patch', x.player.vehicleId, npc.id) === null).w;
    expect(find(w, npc.id).resources!.money).toBe(0);
    expect(isStranded(w, find(w, npc.id))).toBe(true);
    expect(parts(playerVehicle(w))).toBe(4);
  });

  it('a deal nobody works on lapses for free', () => {
    const { w: start, npc } = brokenNpc();
    let w = endTurn(start, testDrive);
    w = answer(w, 'What are you offering?');
    w = answer(w, 'Deal. Stay where you are.');
    const money = w.player.money;
    const r = runUntil(w, 60, (x) => stateOf(x, 'patch', x.player.vehicleId, npc.id) === null);
    expect(r.events.some((e) => e.t === 'patch' && e.outcome === 'lapsed')).toBe(true);
    expect(r.w.player.money).toBe(money);
    expect(parts(playerVehicle(r.w))).toBe(4);
    // The driver notices the deal is off when it next thinks.
    expect(topGoal(find(endTurn(r.w, testDrive), npc.id))?.kind).not.toBe('patch');
  });
});

describe('patch practice', () => {
  // A finished free patch that spends one of the patcher's parts on the client's dead engine.
  function settle(w: World, patcher: Vehicle, client: Vehicle): void {
    setParts(w, patcher, 1);
    breakEngine(client);
    settlePatch(w, addState(w, 'patch', patcher.id, client.id, { kind: 'patch', deal: 'free', parts: 1, price: 0, work: 1, workLeft: 0 }));
  }

  it('pays the player for patching another truck', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 32, y: 30 });
    settle(w, playerVehicle(w), npc);
    expect(practiceOf(w, 'patch')).toMatchObject([{ amount: 1, difficulty: null }]);
  });

  it('pays nothing when an NPC patches the player', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    settle(w, npc, playerVehicle(w));
    expect(practiceOf(w, 'patch')).toEqual([]);
  });

  it('pays nothing when an NPC patches another NPC', () => {
    const w = emptyWorld();
    const patcher = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 50, y: 30 });
    const client = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 52, y: 30 });
    settle(w, patcher, client);
    expect(practiceOf(w, 'patch')).toEqual([]);
  });
});

describe('social on patch prices', () => {
  // The own-parts terms an NPC names, rolled on a copy so both sides of a test see the same rolls. Own-parts terms
  // charge labor only, so the trade price spread of the same skill stays out of the price.
  function laborPrice(w: World, npcId: string, social: number): number {
    const copy = cloneWorld(w);
    copy.player.skills.social = social;
    forceOption('patchDeal', 'ownParts');
    const terms = patchTerms(copy, find(copy, npcId));
    if (terms?.kind !== 'deal' || terms.deal !== 'ownParts') throw new Error(`Expected own-parts terms, got ${JSON.stringify(terms)}`);
    return terms.price;
  }

  it('the player pays less for a patch at level 5', () => {
    const { w, trader } = brokenPlayer(0);
    setParts(w, playerVehicle(w), 3);
    const base = laborPrice(w, trader.id, 0);
    const cut = 1 - 5 * SKILL_EFFECTS.social.patchPrice;
    expect(laborPrice(w, trader.id, XP_TO_REACH[5])).toBe(Math.round(base * cut));
    expect(Math.round(base * cut)).toBeLessThan(base);
  });

  it('an NPC client pays the full price to a level 5 player', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.resources!.money = 10000;
    addGoods(w, npc, 'parts', 3);
    breakEngine(npc);
    expect(laborPrice(w, npc.id, XP_TO_REACH[5])).toBe(laborPrice(w, npc.id, 0));
  });

  it("an NPC client pays for the player's parts at the base price", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.resources!.money = 10000;
    breakEngine(npc);
    setParts(w, playerVehicle(w), 3);
    const paidPrice = (social: number): number => {
      const copy = cloneWorld(w);
      copy.player.skills.social = social;
      forceOption('patchDeal', 'paid');
      const terms = patchTerms(copy, find(copy, npc.id));
      if (terms?.kind !== 'deal' || terms.deal !== 'paid') throw new Error(`Expected paid terms, got ${JSON.stringify(terms)}`);
      return terms.price;
    };
    expect(paidPrice(XP_TO_REACH[5])).toBe(paidPrice(0));
  });
});

describe('goodwill perk', () => {
  it('a driver with parts patches the player for free', () => {
    const { w, trader } = brokenPlayer(10);
    w.player.perks.push('goodwill');
    forceOption('patchDeal', 'paid');
    const terms = patchTerms(w, find(w, trader.id));
    expect(terms).toMatchObject({ kind: 'deal', deal: 'free', price: 0 });
  });

  it('own-parts terms charge the player nothing', () => {
    const { w, trader } = brokenPlayer(0);
    setParts(w, playerVehicle(w), 3);
    w.player.perks.push('goodwill');
    forceOption('patchDeal', 'ownParts');
    expect(patchTerms(w, find(w, trader.id))).toMatchObject({ kind: 'deal', deal: 'ownParts', price: 0 });
  });

  it('an NPC client still pays the player', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.player.perks.push('goodwill');
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.resources!.money = 10000;
    addGoods(w, npc, 'parts', 3);
    breakEngine(npc);
    forceOption('patchDeal', 'ownParts');
    const terms = patchTerms(w, find(w, npc.id));
    expect(terms).toMatchObject({ kind: 'deal', deal: 'ownParts' });
    expect(terms?.kind === 'deal' && terms.price).toBeGreaterThan(0);
  });
});
