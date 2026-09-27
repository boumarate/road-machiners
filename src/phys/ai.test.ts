// NPC driving decisions (src/sim/ai.ts) played through the real physics turn pipeline.

import { beforeAll, describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { addVehicle, emptyWorld } from '../sim/testkit';
import type { World } from '../sim/types';
import { dist } from '../sim/vec';
import { endTurn, newWorld } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

// Plays n turns through the real turn pipeline with physics movement.
function play(w: World, n: number): { w: World } {
  let d = buildDrive(w);
  for (let i = 0; i < n; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
  }
  freeDrive(d);
  return { w };
}

describe('NPC driving', () => {
  it('backs out after repeated failed drive attempts', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = { templateId: 'buggy', activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
    w.obstacles = [{ id: 'rock', pos: { x: 31.4, y: 30 }, r: 0.8, kind: 'rock' }];
    const startX = npc.pos.x;
    let { w: result } = play(w, RULES.npcStuckTurns + 1);
    const actor = result.vehicles.find((v) => v.id === npc.id)!;
    expect(actor.brain!.recovery).toBeGreaterThan(0);
    ({ w: result } = play(result, 1));
    expect(result.vehicles.find((v) => v.id === npc.id)!.pos.x).toBeLessThan(startX);
  });

  it('travels between towns without entering either site', () => {
    let w = newWorld(1337, START_KITS.standard);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    const bowl = REGION.towns[0];
    const nose = REGION.towns[1];
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: bowl.pos.x + bowl.radius + 2, y: bowl.pos.y });
    npc.brain = { templateId: 'trader', activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
    let closest = Infinity;
    for (let i = 0; i < w.size && closest >= nose.radius + 2; i++) {
      ({ w } = play(w, 1));
      // NPCs that spawn along the way would pick fights, so only the route is under test.
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player' || v.id === npc.id);
      const actor = w.vehicles.find((v) => v.id === npc.id)!;
      closest = Math.min(closest, dist(actor.pos, nose.pos));
      expect(dist(actor.pos, nose.pos)).toBeGreaterThanOrEqual(nose.radius + 0.8 - 0.5);
    }
    expect(closest).toBeLessThan(nose.radius + 2);
  }, 120_000);
});
