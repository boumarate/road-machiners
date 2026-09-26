import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE } from '../data/salvage';
import { addVehicle, emptyWorld } from './testkit';
import { goodsCount } from './grid';
import { scavenge } from './locations';
import { endTurn, setMoveOrder } from './world';

describe('timed scavenging search', () => {
  it('takes several turns to empty a rich stock', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const startingScrap = goodsCount(w.vehicles[0]).scrap ?? 0;
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [] });
    let next = scavenge(w);
    expect(next.vehicles[0].job?.kind).toBe('search');
    let turns = 0;
    while (next.vehicles[0].job) {
      next = endTurn(next);
      if (++turns > 20) throw new Error('search never finished');
    }
    expect(turns).toBeGreaterThan(1);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(startingScrap + SALVAGE.unitsPerTurn * 3);
  });

  it('a move cancels the search and keeps what already moved', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [] });
    let next = scavenge(w);
    next = endTurn(next);
    const partial = goodsCount(next.vehicles[0]).scrap ?? 0;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(SALVAGE.unitsPerTurn * 5);
    next = setMoveOrder(next, { kind: 'through', dest: { x: 60, y: 30 } });
    for (let t = 0; t < 5 && next.vehicles[0].job; t++) next = endTurn(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(goodsCount(next.vehicles[0]).scrap).toBe(partial);
  });

  it('stock never grows past what it started with', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [] });
    let next = scavenge(w);
    let turns = 0;
    while (next.vehicles[0].job) {
      next = endTurn(next);
      if (++turns > 20) throw new Error('search never finished');
    }
    const stock = next.salvage.find((s) => s.id === 'rich')!;
    expect(stock.goods.scrap).toBe(0);
  });

  it('lets an NPC scavenger finish a search job', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    npc.brain = { templateId: 'scavenger', activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0 };
    for (const key of ['buggy', 'gunwagon', 'trader', 'scavenger']) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    npc.pos = { x: convoy.pos.x + convoy.radius + 1, y: convoy.pos.y };
    npc.heading = Math.PI;
    let cur = w;
    let sawJob = false;
    let finished = false;
    for (let t = 0; t < w.size * 5; t++) {
      cur = endTurn(cur);
      const actor = cur.vehicles.find((v) => v.id === npc.id)!;
      if (actor.job?.kind === 'search') sawJob = true;
      if (sawJob && !actor.job) { finished = true; break; }
    }
    expect(sawJob).toBe(true);
    expect(finished).toBe(true);
  });
});
