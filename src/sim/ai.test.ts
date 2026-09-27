import { describe, expect, it } from 'vitest';
import { planNpcOrders } from './ai';
import { topGoal } from './npc-activities';
import { addVehicle, emptyWorld, npcBrain } from './testkit';

describe('NPC driving', () => {
  it('uses the obstacle-aware driver on every turn', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    planNpcOrders(w);
    expect(npc.direct).toBe(false);
  });

  // The NPC drives east from (100, 100). Each case puts the player truck somewhere with a heading and a speed.
  it.each([
    ['oncoming in its lane', 118, 100, Math.PI, 7, true],
    ['crossing into its path', 108, 94, Math.PI / 2, 4, true],
    ['oncoming 4 tiles to the side', 118, 104, Math.PI, 7, false],
    ['crossing ahead and driving off to the side', 110, 104, Math.PI / 2, 7, false],
    ['ahead in the next lane, slower', 106, 103, 0, 2, false],
  ])('brakes for a moving truck only when their paths meet: %s', (_name, x, y, heading, speed, brakes) => {
    const w = emptyWorld({ x, y });
    const me = w.vehicles[0];
    me.heading = heading;
    me.speed = speed;
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 100, y: 100 });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    npc.heading = 0;
    npc.speed = 4;
    planNpcOrders(w);
    expect(npc.order?.kind === 'brake').toBe(brakes);
  });

  it('a parked truck ahead whose loot is gone before it thinks gives no face off', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const first = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 100, y: 100 });
    first.brain = npcBrain('trader', first.pos, ['trader']);
    first.heading = 0;
    const second = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 103, y: 100 });
    second.brain = npcBrain('trader', second.pos, ['trader']);
    second.heading = Math.PI;
    second.brain.goals.push({ kind: 'loot', targetId: 'cargo-gone', destination: { x: 130, y: 100 }, phase: 'travel', reason: 'take the handed-over cargo' });
    expect(first.id < second.id).toBe(true);
    planNpcOrders(w);
    expect(topGoal(second)?.kind).not.toBe('loot');
  });
});
