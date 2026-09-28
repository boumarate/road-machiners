import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERK_NUMBERS } from '../data/skills';
import { TRAIT_TALK, END, HONK_RANGE, HUB, TOPICS, type Topic } from '../data/dialogue';
import { PARTS } from '../data/parts';
import { REGION } from '../data/region';
import { playerVehicle } from './damage';
import { callVehicle, chooseOption, currentOptions, endCallIfOut, hangUp, honk, placeholders, raiseCalls } from './dialogue';
import { fireBlock, isHostile } from './combat';
import { partTradePrice } from './economy';
import { makePart } from './factory';
import { NPCS } from '../data/npcs';
import { freeCells, goodsCount, isMounted } from './grid';
import { addGoods, spareParts, stowPart } from './inventory';
import { hasCargo } from './salvage';
import { vehicleStats } from './stats';
import { CONDITIONS, EFFECTS, PREPARES } from './dialogue-rules';
import { addState, endState, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, testDrive } from './testkit';
import type { TraitId } from '../data/npcs';
import type { Vehicle, World } from './types';
import { dist } from './vec';
import { refreshVision } from './vision';
import { autoRuns, endTurn, setMoveOrder } from './world';

const TRAITS_OF: Record<string, TraitId[]> = { trader: ['trader'], scavenger: ['scavenger'], buggy: ['raider'] };

function withNpc(templateId: string, faction: Vehicle['faction'], x = 36): { w: World; npc: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  const npc = addVehicle(w, faction, 'scout', [], { x, y: 30 });
  npc.brain = npcBrain(templateId, npc.pos, TRAITS_OF[templateId]);
  refreshVision(w);
  return { w, npc };
}

function optionIndex(w: World, text: string): number {
  const i = currentOptions(w).findIndex((o) => o.text === text);
  if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => o.text).join(' | ')}`);
  return i;
}

describe('topic data', () => {
  it('every option leads to a node of its topic, the hub or the end, and every node is reachable', () => {
    for (const topic of Object.values(TOPICS)) {
      expect(topic.nodes[topic.start], `${topic.id} start`).toBeDefined();
      const reached = new Set([topic.start]);
      const queue = [topic.start];
      while (queue.length > 0) {
        for (const option of topic.nodes[queue.pop()!].options) {
          if (option.go === HUB || option.go === END) continue;
          expect(topic.nodes[option.go], `${topic.id} → ${option.go}`).toBeDefined();
          if (!reached.has(option.go)) { reached.add(option.go); queue.push(option.go); }
        }
      }
      expect([...reached].sort()).toEqual(Object.keys(topic.nodes).sort());
    }
  });

  it('every condition, effect and prepare step named in the data exists', () => {
    for (const topic of Object.values(TOPICS)) {
      const conditions = [...(topic.ask?.when ?? []), ...(topic.raise?.when ?? []), ...Object.values(topic.nodes).flatMap((n) => n.options.flatMap((o) => o.when))];
      const effects = [...topic.hangUp, ...Object.values(topic.nodes).flatMap((n) => n.options.flatMap((o) => o.effects))];
      for (const id of conditions) expect(CONDITIONS[id], id).toBeTypeOf('function');
      for (const id of effects) expect(EFFECTS[id], id).toBeTypeOf('function');
      if (topic.prepare) expect(PREPARES[topic.prepare], topic.prepare).toBeTypeOf('function');
    }
  });

  it('class talk lines need no call values', () => {
    for (const { voice } of Object.values(TRAIT_TALK)) {
      for (const line of voice ? [voice.greeting, voice.repeatLine, voice.refusal] : []) expect(placeholders(line)).toEqual([]);
    }
  });
});

describe('calls', () => {
  it('opens on the hub with the greeting when the player sees the truck', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const next = callVehicle(w, npc.id);
    expect(next.player.call).toEqual({ with: npc.id, topic: null, node: HUB, vars: {}, line: { text: TRAIT_TALK.trader.voice!.greeting, vars: {} }, discussed: false });
    expect(next.events).toContainEqual({ t: 'call', with: npc.id, outcome: 'opened' });
    expect(next.events).toContainEqual({ t: 'say', speaker: npc.id, text: TRAIT_TALK.trader.voice!.greeting, vars: {} });
  });

  it('cannot reach a truck out of sight', () => {
    const { w, npc } = withNpc('trader', 'traders', 200);
    expect(() => callVehicle(w, npc.id)).toThrow(/out of sight/);
  });

  it('a truck in a feud with nothing left to talk about answers once and opens no call', () => {
    const { w, npc } = withNpc('trader', 'traders');
    addState(w, 'feud', npc.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    addState(w, 'plea', w.player.vehicleId, npc.id, { kind: 'plea', plea: 'truce', answered: true });
    const next = callVehicle(w, npc.id);
    expect(next.player.call).toBeNull();
    expect(next.events).toContainEqual({ t: 'say', speaker: npc.id, text: TRAIT_TALK.trader.voice!.refusal, vars: {} });
  });

  it('stops turns and other commands until it ends', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    expect(() => endTurn(open, testDrive)).toThrow(/radio call/);
    expect(() => setMoveOrder(open, { kind: 'brake' })).toThrow(/radio call/);
    expect(autoRuns({ ...open, player: { ...open.player, state: 'knockedOut' } })).toBe(false);
    const closed = hangUp(open);
    expect(closed.player.call).toBeNull();
    expect(() => endTurn(closed, testDrive)).not.toThrow();
  });

  it('a hostile raider offers only peace talk', () => {
    const { w, npc } = withNpc('buggy', 'raiders');
    const open = callVehicle(w, npc.id);
    expect(currentOptions(open).map((o) => o.text)).toEqual(['Enough shooting. Can we call a truce?', 'I give up. Let me go.', 'Hang up.']);
    expect(chooseOption(open, 2).player.call).toBeNull();
  });

  it('rejects an option that is not on offer', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    expect(() => chooseOption(open, currentOptions(open).length)).toThrow(/No option/);
  });
});

describe('directions', () => {
  it('names the known town nearest the player and marks it discovered', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.discovered = [];
    const me = playerVehicle(w).pos;
    const nearest = REGION.towns.filter((t) => ['bowl', 'nose'].includes(t.id)).sort((a, b) => dist(me, a.pos) - dist(me, b.pos))[0];
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, TOPICS.directions.ask!.text));
    expect(next.player.call?.vars.town).toEqual({ kind: 'town', id: nearest.id });
    expect(next.player.call?.vars.distance).toEqual({ kind: 'distance', tiles: dist(me, nearest.pos) });
    next = chooseOption(next, optionIndex(next, 'Thanks. Over and out.'));
    expect(next.player.call).toBeNull();
    expect(next.player.discovered).toContain(nearest.id);
    expect(next.events).toContainEqual({ t: 'discover', location: nearest.id });
  });

  it('returns to the hub and can be asked again', () => {
    const { w, npc } = withNpc('scavenger', 'scavengers');
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, TOPICS.directions.ask!.text));
    next = chooseOption(next, optionIndex(next, 'Thanks. Something else.'));
    expect(next.player.call?.topic).toBeNull();
    next = chooseOption(next, optionIndex(next, TOPICS.directions.ask!.text));
    expect(next.player.call?.topic).toBe('directions');
  });
});

describe('NPC calls', () => {
  // Directions stands in for a topic NPCs raise once, so the raise rules run without real raised content.
  const original = { ...TOPICS.directions };
  beforeEach(() => Object.assign(TOPICS.directions, { once: true, raise: { when: ['knowsTown'], priority: 1, duringFeud: false }, hangUp: ['settleRefused'] } satisfies Partial<Topic>));
  afterEach(() => Object.assign(TOPICS.directions, original));

  it('an NPC that sees the player opens one call on the topic it raises', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const other = addVehicle(w, 'traders', 'scout', [], { x: 30, y: 36 });
    other.brain = npcBrain('trader', other.pos, ['trader']);
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'directions', node: 'answer' });
    expect(w.events.filter((e) => e.t === 'call')).toHaveLength(1);
  });

  it('never raises a `once` topic again after it was settled', () => {
    const { w, npc } = withNpc('trader', 'traders');
    raiseCalls(w);
    const closed = hangUp(w);
    expect(closed.player.talked[npc.id]).toEqual({ directions: 'refused' });
    raiseCalls(closed);
    expect(closed.player.call).toBeNull();
  });

  it('an NPC that does not see the player stays quiet', () => {
    const { w } = withNpc('trader', 'traders', 200);
    raiseCalls(w);
    expect(w.player.call).toBeNull();
  });

  it('a settled `once` topic asked from the hub gets the repeat line', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.talked[npc.id] = { directions: 'done' };
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, TOPICS.directions.ask!.text));
    expect(next.player.call?.topic).toBeNull();
    expect(next.events).toContainEqual({ t: 'say', speaker: npc.id, text: TRAIT_TALK.trader.voice!.repeatLine, vars: {} });
    expect(next.player.call?.line).toEqual({ text: TRAIT_TALK.trader.voice!.repeatLine, vars: {} });
  });
});

function npcAt(w: World, templateId: string, faction: Vehicle['faction'], x: number): Vehicle {
  const npc = addVehicle(w, faction, 'scout', [], { x, y: 30 });
  npc.brain = npcBrain(templateId, npc.pos, TRAITS_OF[templateId]);
  return npc;
}

const honkers = (w: World) => w.events.filter((e) => e.t === 'honk').map((e) => e.vehicle);

describe('honk', () => {
  it('the player honks, and friendly trucks in earshot answer nearest first', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const far = npcAt(w, 'scavenger', 'scavengers', 30 + HONK_RANGE);
    const near = npcAt(w, 'trader', 'traders', 36);
    expect(honkers(honk(w))).toEqual([w.player.vehicleId, near.id, far.id]);
  });

  it('trucks out of earshot, raiders and trucks in a feud stay silent', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    npcAt(w, 'trader', 'traders', 30 + HONK_RANGE + 1);
    const feuding = npcAt(w, 'scavenger', 'scavengers', 34);
    addState(w, 'feud', feuding.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    npcAt(w, 'buggy', 'raiders', 36);
    expect(honkers(honk(w))).toEqual([w.player.vehicleId]);
  });

  it('cannot honk during a call', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = npcAt(w, 'trader', 'traders', 36);
    expect(() => honk(callVehicle(w, npc.id))).toThrow(/radio call/);
  });
});

describe('calls during a turn', () => {
  it('neither side of a call can shoot the other', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 36, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const open = callVehicle(w, raider.id);
    const r = open.vehicles.find((v) => v.id === raider.id)!;
    const me = open.vehicles.find((v) => v.id === open.player.vehicleId)!;
    expect(fireBlock(open, r, vehicleStats(open, r).weapons[0], me)).toBe('talking');
    expect(fireBlock(w, raider, vehicleStats(w, raider).weapons[0], w.vehicles[0])).not.toBe('talking');
  });

  it('a call ends when the player is knocked out during the turn', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    open.player.state = 'knockedOut';
    endCallIfOut(open);
    expect(open.player.call).toBeNull();
    expect(open.events).toContainEqual({ t: 'call', with: npc.id, outcome: 'ended' });
  });
});

describe('demand', () => {
  // A raider with a machine gun spots a player who carries goods. It always picks the fight.
  function ambush(): { w: World; raider: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    addGoods(w, playerVehicle(w), 'scrap', 2);
    const raider = addVehicle(w, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('hostileSeen', 'fight');
    return { w, raider };
  }

  const shotsBetween = (w: World, a: string, b: string) =>
    w.events.filter((e) => e.t === 'shot' && ((e.shooter === a && e.target === b) || (e.shooter === b && e.target === a)));

  it('a raider calls with its demand before the first shot', () => {
    const { w: start, raider } = ambush();
    const w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: raider.id, topic: 'demand' });
    expect(shotsBetween(w, raider.id, w.player.vehicleId)).toEqual([]);
  });

  it('handing over drops every goods item and loose part, and buys a truce', () => {
    const { w: start, raider } = ambush();
    let w = endTurn(start, testDrive);
    const me = playerVehicle(w);
    const cargo = me.items.filter((i) => i.kind === 'good' || !isMounted(me.chassisId, i)).length;
    w = chooseOption(w, currentOptions(w).findIndex((o) => o.text === 'Fine. Take it.'));
    const stock = w.salvage.find((s) => s.id.startsWith(`cargo-${me.id}`))!;
    const inStock = Object.values(stock.goods).reduce((a, b) => a + b, 0) + stock.parts.length;
    expect(inStock).toBe(cargo);
    expect(hasCargo(playerVehicle(w))).toBe(false);
    expect(stateOf(w, 'truce', raider.id, me.id)).not.toBeNull();
    const r = w.vehicles.find((v) => v.id === raider.id)!;
    expect(isHostile(w, r, playerVehicle(w))).toBe(false);
    for (let i = 0; i < 5; i++) {
      w = endTurn(w, testDrive);
      expect(shotsBetween(w, raider.id, me.id)).toEqual([]);
    }
  });

  it('handing over pays the player for a closed deal', () => {
    const { w: start } = ambush();
    const w = endTurn(start, testDrive);
    const next = chooseOption(w, optionIndex(w, 'Fine. Take it.'));
    expect(practiceOf(next, 'deal')).toMatchObject([{ amount: 1, difficulty: null }]);
  });

  it('refusing pays nothing for a deal', () => {
    const { w: start } = ambush();
    const w = endTurn(start, testDrive);
    const next = chooseOption(w, optionIndex(w, 'Come and get it.'));
    expect(practiceOf(next, 'deal')).toEqual([]);
  });

  it('refusing keeps the fight, and the demand is not made twice', () => {
    const { w: start, raider } = ambush();
    let w = endTurn(start, testDrive);
    w = chooseOption(w, currentOptions(w).findIndex((o) => o.text === 'Come and get it.'));
    let shots = 0;
    for (let i = 0; i < 8; i++) {
      w = endTurn(w, testDrive);
      expect(w.player.call).toBeNull();
      shots += shotsBetween(w, raider.id, w.player.vehicleId).length;
    }
    expect(shots).toBeGreaterThan(0);
  });

  it('shots end a truce through a feud, and the truce expires on its own', () => {
    const { w: start, raider } = ambush();
    let w = endTurn(start, testDrive);
    w = chooseOption(w, currentOptions(w).findIndex((o) => o.text === 'Fine. Take it.'));
    const me = w.player.vehicleId;
    addState(w, 'feud', raider.id, me, { kind: 'feud', robbery: false });
    const r = w.vehicles.find((v) => v.id === raider.id)!;
    expect(isHostile(w, r, playerVehicle(w))).toBe(true);
    endState(w, stateOf(w, 'feud', raider.id, me)!, 'broken');
    stateOf(w, 'truce', raider.id, me)!.turnsLeft = 1;
    w = endTurn(w, testDrive);
    expect(stateOf(w, 'truce', raider.id, me)).toBeNull();
  });
});

describe('trade', () => {
  const askText = TOPICS.trade.ask!.text;

  function withSpare(templateId: string, faction: Vehicle['faction'], defId: string, wear = 0): { w: World; npc: Vehicle } {
    const { w, npc } = withNpc(templateId, faction);
    if (!stowPart(w, npc, makePart(w, defId, wear))) throw new Error('No room for the test spare');
    return { w, npc };
  }

  // Opens the call and asks the trade topic, landing on its offers.
  function openTrade(w: World, npcId: string): World {
    const open = callVehicle(w, npcId);
    return chooseOption(open, optionIndex(open, askText));
  }

  it('a raider never offers to trade', () => {
    const { w, npc } = withNpc('buggy', 'raiders');
    const open = callVehicle(w, npc.id);
    expect(currentOptions(open).map((o) => o.text)).not.toContain(askText);
  });

  it('an NPC with no spares says so and offers nothing to buy', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const next = openTrade(w, npc.id);
    expect(next.player.call?.line.text).toBe('Nothing spare right now.');
    expect(currentOptions(next).map((o) => o.text)).toEqual(['Hang up.']);
  });

  it('lists a spare part with its buy price, and buying moves it to the player and pays the NPC', () => {
    const { w, npc } = withSpare('trader', 'traders', 'mg', 2);
    const part = spareParts(npc)[0];
    const price = partTradePrice(w, playerVehicle(w), part, 'buy');
    const npcMoneyBefore = npc.resources!.money;
    const playerMoneyBefore = w.player.money;
    const opened = openTrade(w, npc.id);
    const label = `${PARTS.mg.name}, ${price}`;
    expect(currentOptions(opened).map((o) => o.text)).toContain(label);
    const next = chooseOption(opened, optionIndex(opened, label));
    expect(next.player.money).toBe(playerMoneyBefore - price);
    const npcAfter = next.vehicles.find((v) => v.id === npc.id)!;
    expect(npcAfter.resources!.money).toBe(npcMoneyBefore + price);
    expect(spareParts(npcAfter)).toHaveLength(0);
    expect(spareParts(playerVehicle(next)).some((p) => p.defId === 'mg')).toBe(true);
  });

  it('refuses without enough money, and changes nothing but the said line', () => {
    const { w, npc } = withSpare('trader', 'traders', 'mg');
    w.player.money = 0;
    const opened = openTrade(w, npc.id);
    const before = currentOptions(opened);
    const next = chooseOption(opened, before.findIndex((o) => o.partId !== undefined));
    expect(next.player.money).toBe(0);
    expect(next.player.call?.line.text).toBe('You cannot afford that.');
    expect(spareParts(next.vehicles.find((v) => v.id === npc.id)!)).toHaveLength(1);
    expect(currentOptions(next).length).toBe(before.length);
  });

  it('refuses without room on the player grid, and changes nothing but the said line', () => {
    const { w, npc } = withSpare('trader', 'traders', 'mg');
    const me = playerVehicle(w);
    addGoods(w, me, 'scrap', freeCells(me)); // fill every free cell, whatever its shape
    const npcMoneyBefore = npc.resources!.money;
    const opened = openTrade(w, npc.id);
    const next = chooseOption(opened, currentOptions(opened).findIndex((o) => o.partId !== undefined));
    expect(next.player.call?.line.text).toBe('No room for that on your rig.');
    const npcAfter = next.vehicles.find((v) => v.id === npc.id)!;
    expect(npcAfter.resources!.money).toBe(npcMoneyBefore);
    expect(spareParts(npcAfter)).toHaveLength(1);
  });

  it('a scavenger offers a part it happens to carry', () => {
    const { w, npc } = withSpare('scavenger', 'scavengers', 'scrapPanels');
    const next = openTrade(w, npc.id);
    expect(currentOptions(next).some((o) => o.text.startsWith(PARTS.scrapPanels.name))).toBe(true);
  });
});

describe('call practice', () => {
  it('pays the player once when a call that took up a topic ends', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    expect(practiceOf(open, 'call')).toEqual([]);
    const asked = chooseOption(open, optionIndex(open, 'Where is the nearest town?'));
    const closed = chooseOption(asked, optionIndex(asked, 'Thanks. Over and out.'));
    expect(practiceOf(closed, 'call')).toMatchObject([{ amount: 1, difficulty: null }]);
  });

  it('pays nothing for a call hung up without a topic', () => {
    const { w, npc } = withNpc('trader', 'traders');
    expect(practiceOf(hangUp(callVehicle(w, npc.id)), 'call')).toEqual([]);
  });

  it('pays nothing for a refused call', () => {
    const { w, npc } = withNpc('trader', 'traders');
    addState(w, 'feud', npc.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    expect(practiceOf(callVehicle(w, npc.id), 'call')).toEqual([]);
  });

  it('pays nothing for a second call to the same NPC on the same day', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const first = callVehicle(w, npc.id);
    const asked1 = chooseOption(first, optionIndex(first, 'Where is the nearest town?'));
    const closed1 = chooseOption(asked1, optionIndex(asked1, 'Thanks. Over and out.'));
    expect(practiceOf(closed1, 'call')).toMatchObject([{ amount: 1, difficulty: null }]);

    const second = callVehicle(closed1, npc.id);
    const asked2 = chooseOption(second, optionIndex(second, 'Where is the nearest town?'));
    const closed2 = chooseOption(asked2, optionIndex(asked2, 'Thanks. Over and out.'));
    expect(practiceOf(closed2, 'call')).toEqual([]);
  });

  it('pays again for a call to the same NPC on the next day', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const first = callVehicle(w, npc.id);
    const asked1 = chooseOption(first, optionIndex(first, 'Where is the nearest town?'));
    const closed1 = chooseOption(asked1, optionIndex(asked1, 'Thanks. Over and out.'));
    expect(practiceOf(closed1, 'call')).toMatchObject([{ amount: 1, difficulty: null }]);

    const nextDay = { ...closed1, turn: closed1.turn + 200 };
    const second = callVehicle(nextDay, npc.id);
    const asked2 = chooseOption(second, optionIndex(second, 'Where is the nearest town?'));
    const closed2 = chooseOption(asked2, optionIndex(asked2, 'Thanks. Over and out.'));
    expect(practiceOf(closed2, 'call')).toMatchObject([{ amount: 1, difficulty: null }]);
  });
});

describe('smooth talker perk', () => {
  it('hands over half of each good, rounded down, and every loose part', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    w.player.perks.push('smoothTalker');
    const me = playerVehicle(w);
    addGoods(w, me, 'scrap', 3);
    const raider = addVehicle(w, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('hostileSeen', 'fight');
    let next = endTurn(w, testDrive);
    const held = goodsCount(playerVehicle(next));
    const loose = playerVehicle(next).items.filter((i) => i.kind === 'part' && !isMounted(me.chassisId, i)).length;
    next = chooseOption(next, currentOptions(next).findIndex((o) => o.text === 'Fine. Take it.'));
    const stock = next.salvage.find((s) => s.id.startsWith(`cargo-${me.id}`))!;
    for (const [good, count] of Object.entries(held)) {
      const dropped = Math.floor(count * PERK_NUMBERS.smoothTalker.cargo);
      expect(stock.goods[good] ?? 0).toBe(dropped);
      expect(goodsCount(playerVehicle(next))[good] ?? 0).toBe(count - dropped);
    }
    expect(stock.parts).toHaveLength(loose);
  });
});
