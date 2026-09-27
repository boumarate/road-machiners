import { expect, it } from 'vitest';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import { playerVehicle } from '../sim/damage';
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

it('shows NPC traits as one line', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger', 'scumbag']);
  expect(formatNpcTraits(npc)).toBe('Traits: scavenger, scumbag');
});

it('fails loudly for a vehicle with no NPC brain', () => {
  const w = emptyWorld();
  expect(() => formatNpcTraits(playerVehicle(w))).toThrow('has no NPC brain');
});

it('lists states toward the player with turns left', () => {
  const w = emptyWorld();
  const me = playerVehicle(w);
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const other = addVehicle(w, 'raiders', 'buggy', [], { x: 40, y: 40 });
  npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
  addState(w, 'feud', npc.id, me.id, { kind: 'feud', robbery: true }).turnsLeft = 7;
  addState(w, 'spurned', npc.id, me.id, { kind: 'none' });
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
