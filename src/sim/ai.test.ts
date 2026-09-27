import { describe, expect, it } from 'vitest';
import { planNpcOrders } from './ai';
import { addVehicle, emptyWorld } from './testkit';

describe('NPC driving', () => {
  it('uses the obstacle-aware driver on every turn', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = { templateId: 'buggy', activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
    planNpcOrders(w);
    expect(npc.direct).toBe(false);
  });
});
