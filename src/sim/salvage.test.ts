import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE } from '../data/salvage';
import { addVehicle, emptyWorld, testDrive } from './testkit';
import { resolveDestroyed } from './combat';
import { addGoods, dumpItem } from './inventory';
import { corePart, findSpot, goodsCount, gridOf, isLoot, mountedParts } from './grid';
import { partDef } from '../data/parts';
import { chassisDef } from '../data/chassis';
import { RULES } from '../data/rules';
import { takeAllLoot, takeLoot, takeStores, canScavenge, scavenge } from './locations';
import { clearPiles, collectSalvage, createCargoSalvage, createKnockoutSalvage, hasSalvage, salvageInRange, salvageUnits } from './salvage';
import { sitePads } from './sites';
import { freeCells } from './grid';
import { endTurn } from './world';

describe('player piles', () => {
  it('goods the player dumps and takes back keep their cost basis', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    addGoods(w, me, 'scrap', 2);
    const held = goodsCount(me).scrap;
    w.player.costBasis.scrap = 12;
    let next = w;
    for (const item of me.items.filter((it) => it.kind === 'good' && it.good === 'scrap')) next = dumpItem(next, item.id);
    const pile = next.salvage.find((s) => s.pile)!;
    collectSalvage(next, next.vehicles[0], pile.id, 100);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(held);
    expect(next.player.costBasis.scrap).toBe(12);
  });

  it('goods from a pile another truck dropped count as free', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'scout', [], { x: 31, y: 30 });
    addGoods(w, npc, 'scrap', 2);
    const pile = createCargoSalvage(w, npc, 1);
    const held = goodsCount(w.vehicles[0]).scrap ?? 0;
    w.player.costBasis.scrap = 12;
    collectSalvage(w, w.vehicles[0], pile.id, 100);
    expect(w.player.costBasis.scrap).toBeCloseTo((12 * held) / (held + 2));
    expect(w.player.scavenged).not.toContain(pile.id);
  });

  it('a free unit taken first does not wipe the paid basis of goods taken back from the player pile', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part');
    addGoods(w, me, 'tools', 6);
    w.player.costBasis.tools = 180;
    let next = w;
    for (const item of me.items.filter((it) => it.kind === 'good')) next = dumpItem(next, item.id);
    next.salvage.push({ id: 'free', pos: { x: 30, y: 30 }, radius: 1, goods: { tools: 1 }, parts: [] });
    next.player.scavenged.push('free');
    collectSalvage(next, next.vehicles[0], 'free', 100);
    expect(next.player.costBasis.tools).toBe(0);
    collectSalvage(next, next.vehicles[0], next.salvage.find((s) => s.pile?.fromPlayer)!.id, 100);
    expect(goodsCount(next.vehicles[0]).tools).toBe(7);
    expect(next.player.costBasis.tools).toBeCloseTo((180 * 6) / 7);
  });

  it('one free good taken by hand lowers the basis like taking all', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part');
    addGoods(w, me, 'scrap', 2);
    w.player.costBasis.scrap = 12;
    w.salvage.push({ id: 'free', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    w.player.scavenged.push('free');
    const spot = findSpot(gridOf(me), me.items, { id: 'x', kind: 'good', good: 'scrap', x: 0, y: 0, rot: 0 }, null, null)!;
    expect(takeLoot(w, 'free', { kind: 'good', good: 'scrap' }, spot).player.costBasis.scrap).toBe(8);
  });

  it('the player dumping beside another truck pile starts its own pile and leaves that one unsearched', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'scout', [], { x: 30.5, y: 30 });
    addGoods(w, npc, 'scrap', 2);
    const theirs = createCargoSalvage(w, npc, 1);
    expect(salvageInRange(w.vehicles[0], theirs)).toBe(true);
    const good = w.vehicles[0].items.find((it) => it.kind === 'good')!;
    const next = dumpItem(w, good.id);
    const mine = next.salvage.find((s) => s.pile?.fromPlayer)!;
    expect(mine.id).not.toBe(theirs.id);
    expect(next.player.scavenged).not.toContain(theirs.id);
    expect(next.salvage.find((s) => s.id === theirs.id)!.goods.scrap).toBe(2);
  });

  it('the player knockout pile counts as searched, so it pays no search XP', () => {
    const w = emptyWorld();
    const pile = createKnockoutSalvage(w, w.vehicles[0]);
    expect(w.player.scavenged).toContain(pile.id);
  });
});

describe('finite salvage', () => {
  it('leaves overflow for another collector and never duplicates it', () => {
    const w = emptyWorld();
    const a = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    const b = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    addGoods(w, a, 'salt', freeCells(a) - 1);
    w.salvage.push({ id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: { scrap: 3 }, parts: [] });
    expect(collectSalvage(w, a, 'test-stock', 100)).toBe(1);
    expect(goodsCount(a).scrap).toBe(1);
    expect(collectSalvage(w, b, 'test-stock', 100)).toBe(2);
    expect(goodsCount(b).scrap).toBe(2);
    expect(collectSalvage(w, b, 'test-stock', 100)).toBe(0);
  });

  it('pours fuel and supplies up to the caps and leaves the rest', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const cap = chassisDef(me.chassisId).fuelCap;
    w.player.fuel = cap - 3;
    w.player.supplies = RULES.suppliesCap - 1;
    w.salvage.push({ id: 'test-stock', pos: { x: 30, y: 30 }, radius: 1, goods: {}, parts: [], fuel: 5, supplies: 4 });
    expect(() => takeStores(w, 'test-stock')).toThrow(/Search/);
    w.player.scavenged.push('test-stock');
    const next = takeStores(w, 'test-stock');
    const stock = next.salvage.find((s) => s.id === 'test-stock')!;
    expect(next.player.fuel).toBe(cap);
    expect(next.player.supplies).toBe(RULES.suppliesCap);
    expect(stock.fuel).toBe(2);
    expect(stock.supplies).toBe(3);
    expect(hasSalvage(stock)).toBe(true);
  });

  it('lets an NPC collector take fuel and supplies', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 10 });
    npc.resources!.fuel = 0;
    npc.resources!.supplies = 0;
    w.salvage.push({ id: 'test-stock', pos: { x: 10, y: 10 }, radius: 1, goods: {}, parts: [], fuel: 5, supplies: 2 });
    collectSalvage(w, npc, 'test-stock', 100);
    expect(npc.resources).toEqual(expect.objectContaining({ fuel: 5, supplies: 2 }));
    expect(hasSalvage(w.salvage.find((s) => s.id === 'test-stock')!)).toBe(false);
  });

  it('never moves more than a stock holds, even asked for more', () => {
    const w = emptyWorld();
    w.salvage.push({ id: 'test-stock', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [] });
    expect(collectSalvage(w, w.vehicles[0], 'test-stock', 100)).toBe(3);
    expect(w.salvage.find((s) => s.id === 'test-stock')!.goods.scrap).toBe(0);
    expect(collectSalvage(w, w.vehicles[0], 'test-stock', 100)).toBe(0);
  });

  it('cannot recreate convoy loot by clearing player discovery state', () => {
    const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    const w = emptyWorld({ ...sitePads(convoy)[0] });
    // Keep the built-ins so the truck still runs, but clear cargo so the search has room to fill.
    w.vehicles[0].items = w.vehicles[0].items.filter((item) => item.kind === 'part' && partDef(item.part.defId).kind === 'core');
    // Empty the tank and stores so the convoy's fuel and supplies fit.
    w.player.fuel = 0;
    w.player.supplies = 0;
    const totalScrap = w.salvage.find((s) => s.id === convoy.id)!.goods.scrap;
    let next = scavenge(w);
    let turns = 0;
    while (next.vehicles[0].job) {
      next = endTurn(next, testDrive);
      if (++turns > 50) throw new Error('search never finished');
    }
    next = takeAllLoot(next, convoy.id);
    next.player.scavenged = [];
    expect(canScavenge(next)).toBe(false);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(totalScrap);
  });

  it('fills a landmark site with loot at world creation', () => {
    const landmark = REGION.locations.find((site) => site.kind === 'landmark')!;
    const w = emptyWorld();
    const stock = w.salvage.find((s) => s.id === landmark.id)!;
    expect(hasSalvage(stock)).toBe(true);
    expect(stock.goods.parts).toBeGreaterThan(0);
    expect(stock.fuel).toBeGreaterThanOrEqual(SALVAGE.landmark.fuel[0]);
    expect(stock.supplies).toBeGreaterThanOrEqual(SALVAGE.landmark.supplies[0]);
  });

  it('gives a wreck its mounted parts at their hp, and turns built-in parts into the parts good', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    addGoods(w, npc, 'scrap', 3);
    const engine = mountedParts(npc, 'engine')[0];
    corePart(npc, 'cab').hp = 0;
    const coreScrap = mountedParts(npc, 'core').reduce((sum, p) => sum + Math.round(p.hp * SALVAGE.coreScrapPerHp), 0);
    resolveDestroyed(w);
    const stock = w.salvage.find((s) => s.id === `wreck-${npc.id}`)!;
    expect(stock.goods.scrap).toBe(3);
    expect(stock.parts).toEqual([engine]);
    expect(stock.goods.parts).toBe(coreScrap);
    resolveDestroyed(w);
    expect(w.salvage.filter((s) => s.id === stock.id)).toHaveLength(1);
  });
});

describe('road wreck salvage', () => {
  it('gives every wreck placed on a road its own stock to search', async () => {
    const { newWorld } = await import('./world');
    const { startKit } = await import('../data/start');
    const w = newWorld(1337, startKit('standard'));
    const wrecks = w.obstacles.filter((o) => /^wreck\d+$/.test(o.id));
    expect(wrecks.length).toBeGreaterThan(0);
    for (const o of wrecks) {
      const stock = w.salvage.find((s) => s.id === o.id);
      expect(stock).toBeDefined();
      expect(hasSalvage(stock!)).toBe(true);
    }
  }, 30_000);
});

describe('loot piles', () => {
  const goodItem = (w: ReturnType<typeof emptyWorld>) => w.vehicles[0].items.find((it) => it.kind === 'good')!;
  const piles = (w: ReturnType<typeof emptyWorld>) => w.salvage.filter((stock) => stock.pile);

  it('merges drops in reach into one pile and starts a new one out of reach', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    w = dumpItem(w, goodItem(w).id);
    w.turn += 5;
    w = dumpItem(w, goodItem(w).id);
    expect(piles(w)).toHaveLength(1);
    expect(salvageUnits(piles(w)[0])).toBe(2);
    expect(piles(w)[0].pile!.until).toBe(w.turn + SALVAGE.pileTurns);
    expect(w.player.scavenged).toContain(piles(w)[0].id);
    w.vehicles[0].pos = { x: 60, y: 30 };
    w = dumpItem(w, goodItem(w).id);
    expect(piles(w)).toHaveLength(2);
  });

  it('adds a knockout drop to the pile already in reach', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    w = dumpItem(w, goodItem(w).id);
    const loot = w.vehicles[0].items.filter((it) => isLoot(w.vehicles[0].chassisId, it)).length;
    createKnockoutSalvage(w, w.vehicles[0]);
    expect(piles(w)).toHaveLength(1);
    expect(salvageUnits(piles(w)[0])).toBe(loot + 1);
  });

  it('clears a pile when it expires and stops searches of it', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    w = dumpItem(w, goodItem(w).id);
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 30, y: 31 });
    const id = piles(w)[0].id;
    npc.job = { kind: 'search', stockId: id, turnsLeft: 3, total: 3 };
    w.turn = piles(w)[0].pile!.until - 1;
    clearPiles(w);
    expect(piles(w)).toHaveLength(1);
    w.turn += 1;
    clearPiles(w);
    expect(piles(w)).toHaveLength(0);
    expect(npc.job).toBeNull();
    expect(w.player.scavenged).not.toContain(id);
  });

  it('clears a pile once it is empty', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    w = dumpItem(w, goodItem(w).id);
    const pile = piles(w)[0];
    pile.goods = {};
    clearPiles(w);
    expect(piles(w)).toHaveLength(0);
  });
});
