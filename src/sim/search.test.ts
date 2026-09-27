import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE } from '../data/salvage';
import { addVehicle, emptyWorld, testDrive } from './testkit';
import { goodsCount } from './grid';
import { canLoot, canScavenge, scavenge, takeAllLoot, takeLoot } from './locations';
import { findSpot, gridOf } from './grid';
import { endTurn, setMoveOrder } from './world';

describe('timed scavenging search', () => {
  it('takes turns in proportion to the stock, then opens it for looting', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [] });
    let next = scavenge(w);
    expect(next.vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: 3, total: 3 }));
    let turns = 0;
    while (next.vehicles[0].job) {
      next = endTurn(next, testDrive);
      if (++turns > 20) throw new Error('search never finished');
    }
    expect(turns).toBe(3);
    expect(next.events).toContainEqual({ t: 'searched', stock: 'rich' });
    expect(canLoot(next)).toBe(true);
    expect(canScavenge(next)).toBe(false);
  });

  it('a move cancels the search, and the stock stays closed', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [] });
    let next = endTurn(scavenge(w), testDrive);
    next = setMoveOrder(next, { kind: 'through', dest: { x: 60, y: 30 } });
    for (let t = 0; t < 5 && next.vehicles[0].job; t++) next = endTurn(next, testDrive);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.player.scavenged).not.toContain('rich');
  });

  it('takes one loot item into a chosen cell, and never more than the stock holds', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.vehicles[0].items = w.vehicles[0].items.filter((item) => item.kind === 'part');
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    w.player.scavenged.push('rich');
    const spot = findSpot(gridOf(w.vehicles[0]), w.vehicles[0].items, { id: 'x', kind: 'good', good: 'scrap', x: 0, y: 0, rot: 0 }, null, null)!;
    const next = takeLoot(w, 'rich', { kind: 'good', good: 'scrap' }, spot);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(1);
    expect(next.salvage.find((s) => s.id === 'rich')!.goods.scrap).toBe(0);
    expect(() => takeLoot(next, 'rich', { kind: 'good', good: 'scrap' }, spot)).toThrow();
  });

  it('refuses loot from a stock that was never searched', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 2 }, parts: [] });
    expect(() => takeAllLoot(w, 'rich')).toThrow(/Search/);
  });

  it('lets an NPC scavenger finish a search job', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    npc.brain = { templateId: 'scavenger', activity: null, goal: null, home: { ...npc.pos }, stepIndex: 0, refusedTow: false };
    for (const key of ['buggy', 'gunwagon', 'trader', 'scavenger']) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    npc.pos = { x: convoy.pos.x + convoy.radius + 1, y: convoy.pos.y };
    npc.heading = Math.PI;
    let cur = w;
    let sawJob = false;
    let finished = false;
    for (let t = 0; t < w.size * 5; t++) {
      cur = endTurn(cur, testDrive);
      const actor = cur.vehicles.find((v) => v.id === npc.id)!;
      if (actor.job?.kind === 'search') sawJob = true;
      if (sawJob && !actor.job) { finished = true; break; }
    }
    expect(sawJob).toBe(true);
    expect(finished).toBe(true);
  });
});
