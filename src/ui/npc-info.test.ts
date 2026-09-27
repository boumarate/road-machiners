import { describe, expect, it } from 'vitest';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import { playerVehicle } from '../sim/damage';
import { corePart } from '../sim/grid';
import type { GameEvent } from '../sim/types';
import { addState } from '../sim/states';
import { refreshVision } from '../sim/vision';
import { eventText, formatNpcActivity, formatNpcStates, formatNpcTraits } from './format';

it('shows a visible NPC reason without naming its unseen target', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const target = addVehicle(w, 'raiders', 'buggy', [], { x: 58, y: 58 });
  target.name = 'Hidden target';
  npc.brain = { ...npcBrain('scavenger', npc.pos, ['scavenger']), goals: [{ kind: 'flee', targetId: target.id, destination: target.pos, phase: 'travel', reason: 'avoid a costly fight' }] };
  refreshVision(w);
  expect(formatNpcActivity(w, npc)).toBe('flee — avoid a costly fight');
  npc.pos = { x: 58, y: 55 };
  expect(formatNpcActivity(w, npc)).toBeNull();
  expect(eventText(w, { t: 'activity', vehicle: npc.id, previous: null, activity: 'flee', reason: 'avoid a costly fight' })).toBeNull();
});

it('shows NPC traits as one line with the read the driver perk', () => {
  const w = emptyWorld();
  w.player.perks.push('readDriver');
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger', 'scumbag']);
  expect(formatNpcTraits(w, npc)).toBe('Traits: scavenger, scumbag');
});

it('hides NPC traits without the read the driver perk', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger', 'scumbag']);
  expect(formatNpcTraits(w, npc)).toBeNull();
});

it('fails loudly for a vehicle with no NPC brain', () => {
  const w = emptyWorld();
  expect(() => formatNpcTraits(w, playerVehicle(w))).toThrow('has no NPC brain');
});

it('lists states toward the player with turns left', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const other = addVehicle(w, 'raiders', 'buggy', [], { x: 40, y: 40 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
  addState(w, 'feud', npc.id, me.id, { kind: 'feud', robbery: true }).turnsLeft = 7;
  addState(w, 'turnedDown', npc.id, me.id, { kind: 'none' });
  addState(w, 'feud', npc.id, other.id, { kind: 'feud', robbery: false });
  expect(formatNpcStates(w, npc)).toEqual(['Feud with you, 7 turns', 'You turned down its tow']);
});

it('tells a tow offer from a running tow', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'traders', 'scout', [], { x: 32, y: 30 });
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  const tow = addState(w, 'tow', npc.id, me.id, { kind: 'tow', town: 'x', fee: 10, hitched: false });
  expect(formatNpcStates(w, npc)).toEqual(['Tow offer to you']);
  tow.data = { kind: 'tow', town: 'x', fee: 10, hitched: true };
  expect(formatNpcStates(w, npc)).toEqual(['Towing you']);
});

it('logs how a feud with the player ends', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  npc.name = 'Scavenger';
  const feud = addState(w, 'feud', npc.id, me.id, { kind: 'feud', robbery: true });
  expect(eventText(w, { t: 'stateEnded', state: feud, ending: 'expired' })).toEqual({ text: 'Scavenger gives up the feud with you.', cls: 'good' });
  expect(eventText(w, { t: 'stateEnded', state: feud, ending: 'fulfilled' })).toEqual({ text: 'Scavenger ends the feud: you are beaten.', cls: 'bad' });
});

it('logs no state ending for tow states or states between NPCs', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const other = addVehicle(w, 'raiders', 'buggy', [], { x: 40, y: 40 });
  const tow = addState(w, 'tow', npc.id, me.id, { kind: 'tow', town: 'x', fee: 10, hitched: true });
  const feud = addState(w, 'feud', npc.id, other.id, { kind: 'feud', robbery: false });
  expect(eventText(w, { t: 'stateEnded', state: tow, ending: 'fulfilled' })).toBeNull();
  expect(eventText(w, { t: 'stateEnded', state: feud, ending: 'expired' })).toBeNull();
});

describe('events far from the player', () => {
  const setup = () => {
    const w = emptyWorld();
    const a = addVehicle(w, 'scavengers', 'scout', [], { x: 58, y: 55 });
    const b = addVehicle(w, 'raiders', 'buggy', [], { x: 58, y: 57 });
    refreshVision(w);
    w.player.contacts = [];
    const cab = corePart(a, 'cab');
    const events: GameEvent[] = [
      { t: 'collision', a: a.id, b: b.id, hitsA: [{ part: cab.id, damage: 5 }], hitsB: [] },
      { t: 'partDisabled', vehicle: a.id, part: cab.id },
      { t: 'destroyed', vehicle: a.id, by: b.id },
    ];
    return { w, a, events };
  };

  it('give no line when the player neither sees nor detects them', () => {
    const { w, events } = setup();
    for (const e of events) expect(eventText(w, e)).toBeNull();
  });

  it('give a line when the player detects a vehicle in them', () => {
    const { w, a, events } = setup();
    w.player.contacts = [{ vehicleId: a.id, center: a.pos, radius: 3, sources: ['sound'], loudness: 10 }];
    for (const e of events) expect(eventText(w, e)).not.toBeNull();
  });

  it('give a line when the player sees a vehicle in them', () => {
    const { w, a, events } = setup();
    a.pos = { x: 32, y: 30 };
    for (const e of events) expect(eventText(w, e)).not.toBeNull();
  });

  it('give a line with the full log on', () => {
    const { w, events } = setup();
    w.player.fullLog = true;
    for (const e of events) expect(eventText(w, e)).not.toBeNull();
  });
});

it('says a perk can be picked when a skill reaches a perk level', () => {
  const w = emptyWorld();
  expect(eventText(w, { t: 'skillUp', skill: 'driving', level: 2 })?.text).toBe('Driving reached level 2. Pick a perk on the character screen [C].');
  expect(eventText(w, { t: 'skillUp', skill: 'driving', level: 3 })?.text).toBe('Driving reached level 3.');
});
