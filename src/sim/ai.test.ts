import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { planNpcOrders } from './ai';
import { resolveMovement } from './movement';
import { resolveNpcActivities } from './npc-activities';
import { addVehicle, emptyWorld } from './testkit';
import { dist } from './vec';
import { newWorld } from './world';
import { steerTo } from './steering';
import { vehicleStats } from './stats';

function buildChase() {
  const w = emptyWorld({ x: 40, y: 30 });
  const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
  npc.brain = { templateId: 'buggy', activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
  return { w, npc };
}

describe('NPC driving', () => {
  it('turns its nose toward a destination behind instead of reversing the whole route', () => {
    const w = emptyWorld({ x: 50, y: 50 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 30, y: 30 });
    const dest = { x: 10, y: 30 };
    const steer = steerTo(w, vehicleStats(w, npc), npc, { kind: 'stopAt', dest }, false);
    expect(Math.abs(steer.turn)).toBeGreaterThan(0);
  });

  it('keeps blockage recovery rear-first', () => {
    const { w, npc } = buildChase();
    npc.brain!.recovery = RULES.npcRecoveryTurns;
    const steer = steerTo(w, vehicleStats(w, npc), npc, { kind: 'stopAt', dest: { x: 27, y: 30 } }, false);
    expect(steer.speed).toBeLessThan(0);
    expect(steer.turn).toBe(0);
  });

  it('uses the obstacle-aware driver on every turn', () => {
    const { w, npc } = buildChase();
    planNpcOrders(w);
    expect(npc.direct).toBe(false);
  });

  it('travels between towns without entering either site', () => {
    const w = newWorld(1337, START_KITS.standard);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    const bowl = REGION.towns[0];
    const nose = REGION.towns[1];
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: bowl.pos.x + bowl.radius + 2, y: bowl.pos.y });
    npc.brain = { templateId: 'trader', activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
    let closest = Infinity;
    for (let i = 0; i < w.size && closest >= nose.radius + 2; i++) {
      planNpcOrders(w);
      resolveMovement(w);
      resolveNpcActivities(w);
      closest = Math.min(closest, dist(npc.pos, nose.pos));
      expect(dist(npc.pos, nose.pos)).toBeGreaterThanOrEqual(nose.radius + 0.8 - 0.02);
    }
    expect(closest).toBeLessThan(nose.radius + 2);
  }, 120_000);

  it('backs out after repeated failed drive attempts', () => {
    const { w, npc } = buildChase();
    w.obstacles = [{ id: 'rock', pos: { x: 31.4, y: 30 }, r: 0.8, kind: 'rock' }];
    for (let i = 0; i <= RULES.npcStuckTurns; i++) planNpcOrders(w);
    expect(npc.brain!.recovery).toBeGreaterThan(0);
    expect(npc.order?.kind).toBe('stopAt');
    if (npc.order?.kind !== 'stopAt') throw new Error('NPC has no recovery destination');
    expect(npc.order.dest.x).toBeLessThan(npc.pos.x);
    resolveMovement(w);
    expect(npc.pos.x).toBeLessThan(30);
  });
});
