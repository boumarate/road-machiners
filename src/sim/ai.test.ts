import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { REGION } from '../data/region';
import { planNpcOrders } from './ai';
import { resolveMovement } from './movement';
import { addVehicle, emptyWorld } from './testkit';
import { dist } from './vec';
import { newWorld } from './world';

function buildChase() {
  const w = emptyWorld({ x: 40, y: 30 });
  const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
  npc.brain = { templateId: 'buggy', goal: null, home: { ...npc.pos }, stepIndex: 0 };
  return { w, npc };
}

describe('NPC driving', () => {
  it('uses the obstacle-aware driver on every turn', () => {
    const { w, npc } = buildChase();
    planNpcOrders(w);
    expect(npc.direct).toBe(false);
  });

  it('travels between towns without entering either site', () => {
    const w = newWorld(1337, START_KITS.standard);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    const tin = REGION.towns[0];
    const salt = REGION.towns[1];
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: tin.pos.x + tin.radius + 2, y: tin.pos.y });
    npc.brain = { templateId: 'trader', goal: null, home: { ...npc.pos }, stepIndex: 0 };
    let closest = Infinity;
    for (let i = 0; i < 80; i++) {
      planNpcOrders(w);
      resolveMovement(w);
      closest = Math.min(closest, dist(npc.pos, salt.pos));
      expect(dist(npc.pos, salt.pos)).toBeGreaterThanOrEqual(salt.radius + 0.8 - 0.02);
    }
    expect(closest).toBeLessThan(salt.radius + 2);
  });

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
