// NPC driving decisions (src/sim/ai.ts) played through the real physics turn pipeline.

import { beforeAll, describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { RULES } from '../data/rules';
import { NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { canUseSite } from '../sim/sites';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import type { World } from '../sim/types';
import { dist } from '../sim/vec';
import { endTurn, newWorld } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';
import { TEST_MAP } from '../test/map';

beforeAll(async () => {
  await initPhysics();
});

// Runs one turn through the real turn pipeline with physics movement, carrying the same Drive
// forward. physicsMove's own syncDrive keeps it in step with spawns, despawns and repositioning,
// so nothing here needs a fresh physics world per turn.
function turn(w: World, d: Drive): { w: World; d: Drive } {
  let next: Drive | null = null;
  w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
  freeDrive(d);
  return { w, d: next! };
}

describe('NPC driving', () => {
  it('backs out after repeated failed drive attempts', () => {
    let w = emptyWorld({ x: 40, y: 30 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    // A goal east through the rock, so the first turn drives instead of rolling an idle choice.
    npc.brain.goals = [{ kind: 'raid', targetId: null, destination: { x: 300, y: 30 }, reason: 'look for prey at known hunting grounds', phase: 'travel' }];
    w.obstacles = [{ id: 'rock', pos: { x: 31.4, y: 30 }, r: 0.8, kind: 'rock' }];
    const startX = npc.pos.x;
    let d = buildDrive(w);
    for (let i = 0; i < RULES.npcStuckTurns + 1; i++) ({ w, d } = turn(w, d));
    expect(w.vehicles.find((v) => v.id === npc.id)!.brain!.recovery).toBeGreaterThan(0);
    ({ w, d } = turn(w, d));
    expect(w.vehicles.find((v) => v.id === npc.id)!.pos.x).toBeLessThan(startX);
    freeDrive(d);
  });

  it('travels between towns without entering either site', () => {
    let w = newWorld(1337, START_KITS.standard, TEST_MAP);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    // No spawns, so no raider can end the trip before it reaches Nose.
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const bowl = REGION.towns[0];
    const nose = REGION.towns[1];
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: bowl.pos.x + bowl.radius + 2, y: bowl.pos.y });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    // The trader parks on the Nose pad, outside the gate.
    let arrived = false;
    let d = buildDrive(w);
    for (let i = 0; i < w.size && !arrived; i++) {
      ({ w, d } = turn(w, d));
      // NPCs that spawn along the way would pick fights, so only the route is under test.
      w.vehicles = w.vehicles.filter((v) => v.faction === 'player' || v.id === npc.id);
      const actor = w.vehicles.find((v) => v.id === npc.id)!;
      arrived = canUseSite(actor.pos, nose);
      expect(dist(actor.pos, nose.pos)).toBeGreaterThanOrEqual(nose.radius + 0.8 - 0.5);
    }
    freeDrive(d);
    expect(arrived).toBe(true);
  }, 120_000);
});
