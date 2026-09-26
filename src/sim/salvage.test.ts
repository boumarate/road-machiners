import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { ECONOMY } from '../data/goods';
import { addVehicle, emptyWorld } from './testkit';
import { resolveDestroyed } from './combat';
import { addGoods } from './inventory';
import { goodsCount } from './grid';
import { canScavenge, scavenge } from './locations';
import { collectSalvage } from './salvage';
import { freeCells } from './grid';

describe('finite salvage', () => {
  it('leaves overflow for another collector and never duplicates it', () => {
    const w = emptyWorld();
    const a = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    const b = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    addGoods(w, a, 'salt', freeCells(a) - 1);
    w.salvage.push({ id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: { scrap: 3 }, parts: [] });
    expect(collectSalvage(w, a, 'test-stock')).toBe(true);
    expect(goodsCount(a).scrap).toBe(1);
    expect(collectSalvage(w, b, 'test-stock')).toBe(true);
    expect(goodsCount(b).scrap).toBe(2);
    expect(collectSalvage(w, b, 'test-stock')).toBe(false);
  });

  it('cannot recreate convoy loot by clearing player discovery state', () => {
    const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    const w = emptyWorld(convoy.pos);
    w.vehicles[0].items = [];
    const next = scavenge(w);
    next.player.scavenged = [];
    expect(canScavenge(next)).toBe(false);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(ECONOMY.scavenge.cargo.scrap);
  });

  it('retains actual cargo in an NPC wreck exactly once', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    addGoods(w, npc, 'scrap', 3);
    npc.hull = 0;
    resolveDestroyed(w);
    expect(w.salvage).toBeDefined();
    const stock = w.salvage.find((s) => s.id === `wreck-${npc.id}`)!;
    expect(stock.goods.scrap).toBe(3);
    expect(stock.parts).toEqual([]);
    resolveDestroyed(w);
    expect(w.salvage.filter((s) => s.id === stock.id)).toHaveLength(1);
  });
});
