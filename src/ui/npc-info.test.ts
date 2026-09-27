import { expect, it } from 'vitest';
import { addVehicle, emptyWorld } from '../sim/testkit';
import { refreshVision } from '../sim/vision';
import { eventText, formatNpcActivity } from './format';

it('shows a visible NPC reason without naming its unseen target', () => {
  const w = emptyWorld();
  const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 32, y: 30 });
  const target = addVehicle(w, 'raiders', 'buggy', [], { x: 58, y: 58 });
  target.name = 'Hidden target';
  npc.brain = { templateId: 'scavenger', activity: { kind: 'flee', targetId: target.id, destination: target.pos, phase: 'travel', reason: 'avoid a costly fight' }, home: npc.pos, goal: null, stepIndex: 0, refusedTow: false };
  refreshVision(w);
  expect(formatNpcActivity(w, npc)).toBe('flee — avoid a costly fight');
  npc.pos = { x: 58, y: 55 };
  expect(formatNpcActivity(w, npc)).toBeNull();
  expect(eventText(w, { t: 'activity', vehicle: npc.id, previous: null, activity: 'flee', reason: 'avoid a costly fight' })).toBeNull();
});
