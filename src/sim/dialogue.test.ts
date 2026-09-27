import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLASS_TALK, END, HUB, TOPICS, type Topic } from '../data/dialogue';
import { REGION } from '../data/region';
import { playerVehicle } from './damage';
import { callVehicle, chooseOption, currentOptions, hangUp, placeholders, raiseCalls } from './dialogue';
import { CONDITIONS, EFFECTS, PREPARES } from './dialogue-rules';
import { addVehicle, emptyWorld } from './testkit';
import type { Vehicle, World } from './types';
import { dist } from './vec';
import { refreshVision } from './vision';
import { autoRuns, endTurn, setMoveOrder } from './world';

function withNpc(templateId: string, faction: Vehicle['faction'], x = 36): { w: World; npc: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  const npc = addVehicle(w, faction, 'scout', [], { x, y: 30 });
  npc.brain = { templateId, activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
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
    for (const talk of Object.values(CLASS_TALK)) {
      for (const line of [talk.greeting, talk.repeatLine, talk.refusal]) expect(placeholders(line)).toEqual([]);
    }
  });
});

describe('calls', () => {
  it('opens on the hub with the greeting when the player sees the truck', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const next = callVehicle(w, npc.id);
    expect(next.player.call).toEqual({ with: npc.id, topic: null, node: HUB, vars: {}, line: { text: CLASS_TALK.trader.greeting, vars: {} } });
    expect(next.events).toContainEqual({ t: 'call', with: npc.id, outcome: 'opened' });
    expect(next.events).toContainEqual({ t: 'say', speaker: npc.id, text: CLASS_TALK.trader.greeting, vars: {} });
  });

  it('cannot reach a truck out of sight', () => {
    const { w, npc } = withNpc('trader', 'traders', 200);
    expect(() => callVehicle(w, npc.id)).toThrow(/out of sight/);
  });

  it('a truck with a grudge answers once and opens no call', () => {
    const { w, npc } = withNpc('trader', 'traders');
    npc.grudges.push(w.player.vehicleId);
    const next = callVehicle(w, npc.id);
    expect(next.player.call).toBeNull();
    expect(next.events).toContainEqual({ t: 'say', speaker: npc.id, text: CLASS_TALK.trader.refusal, vars: {} });
  });

  it('stops turns and other commands until it ends', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    expect(() => endTurn(open)).toThrow(/radio call/);
    expect(() => setMoveOrder(open, { kind: 'brake' })).toThrow(/radio call/);
    expect(autoRuns({ ...open, player: { ...open.player, state: 'knockedOut' } })).toBe(false);
    const closed = hangUp(open);
    expect(closed.player.call).toBeNull();
    expect(() => endTurn(closed)).not.toThrow();
  });

  it('a raider offers only hanging up', () => {
    const { w, npc } = withNpc('buggy', 'raiders');
    const open = callVehicle(w, npc.id);
    expect(currentOptions(open).map((o) => o.text)).toEqual(['Hang up.']);
    expect(chooseOption(open, 0).player.call).toBeNull();
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
  beforeEach(() => Object.assign(TOPICS.directions, { once: true, raise: { when: ['knowsTown'], priority: 1 }, hangUp: ['settleRefused'] } satisfies Partial<Topic>));
  afterEach(() => Object.assign(TOPICS.directions, original));

  it('an NPC that sees the player opens one call on the topic it raises', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const other = addVehicle(w, 'traders', 'scout', [], { x: 30, y: 36 });
    other.brain = { ...npc.brain!, home: { ...other.pos } };
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
    expect(next.events).toContainEqual({ t: 'say', speaker: npc.id, text: CLASS_TALK.trader.repeatLine, vars: {} });
    expect(next.player.call?.line).toEqual({ text: CLASS_TALK.trader.repeatLine, vars: {} });
  });
});
