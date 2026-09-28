import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE } from '../data/salvage';
import { addVehicle, emptyWorld, testDrive } from './testkit';
import { resolveDestroyed } from './combat';
import { addGoods, dumpItem } from './inventory';
import { corePart, goodsCount, isLoot, mountedParts } from './grid';
import { partDef } from '../data/parts';
import { chassisDef } from '../data/chassis';
import { RULES } from '../data/rules';
import { takeAllLoot, takeStores, canScavenge, scavenge } from './locations';
import { clearPiles, collectSalvage, createKnockoutSalvage, hasSalvage, isRoadWreck, renewSalvage, salvageUnits, siteLootTable } from './salvage';
import { SHOPS } from '../data/market';
import { TIME } from '../data/time';
import type { SalvageStock, World } from './types';
import { dist, type Vec } from './vec';
import { grayRadius } from './vision';
import { sitePads } from './sites';
import { freeCells } from './grid';
import { endTurn } from './world';

describe('finite salvage', () => {
  it('gives a site with a shop no salvage stock', () => {
    const shopSites = REGION.locations.filter((site) => site.id in SHOPS);
    expect(shopSites.length).toBeGreaterThan(0);
    for (const site of shopSites) expect(siteLootTable(site), site.id).toBeNull();
    expect(REGION.locations.some((site) => siteLootTable(site) !== null)).toBe(true);
  });

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

const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;

function stockOf(w: World, id: string): SalvageStock {
  return w.salvage.find((stock) => stock.id === id)!;
}

function emptyStock(stock: SalvageStock): void {
  for (const good of Object.keys(stock.goods)) stock.goods[good] = 0;
  stock.parts = [];
  stock.fuel = 0;
  stock.supplies = 0;
}

// A world whose only road wreck is a looted one at `pos`, with the player at `playerPos`.
function worldWithLootedWreck(playerPos: Vec, pos: Vec): World {
  const w = emptyWorld(playerPos);
  w.salvage = w.salvage.filter((stock) => !isRoadWreck(stock));
  w.obstacles = [{ id: 'wreck0', pos, r: 0.6, kind: 'wreck' }];
  w.salvage.push({ id: 'wreck0', pos, radius: 0.6, goods: { scrap: 0 }, parts: [] });
  return w;
}

// Jumps to the last turn of each of the next `days` days and renews there.
function runDays(w: World, days: number): void {
  for (let day = 0; day < days; day++) {
    w.turn = (Math.floor(w.turn / TIME.turnsPerDay) + 1) * TIME.turnsPerDay;
    renewSalvage(w);
  }
}

describe('site restock', () => {
  it('refills an emptied site a share at a time, up to the table highs', () => {
    const w = emptyWorld();
    const stock = stockOf(w, convoy.id);
    emptyStock(stock);
    runDays(w, 1);
    const firstDay = stock.goods.scrap;
    runDays(w, 29);
    expect(firstDay).toBeLessThan(SALVAGE.convoy.goods.scrap[1]);
    expect(stock.goods.scrap).toBe(SALVAGE.convoy.goods.scrap[1]);
    expect(stock.goods.parts).toBe(SALVAGE.convoy.parts[1]);
    expect(stock.fuel).toBe(SALVAGE.convoy.fuel[1]);
    expect(stock.parts).toHaveLength(1);
  });

  it('restocks only on the last turn of a day', () => {
    const w = emptyWorld();
    const stock = stockOf(w, convoy.id);
    emptyStock(stock);
    for (let turn = 1; turn < TIME.turnsPerDay; turn++) {
      w.turn = turn;
      renewSalvage(w);
    }
    expect(stock.goods.scrap).toBe(0);
  });

  it('keeps a count above the table high', () => {
    const w = emptyWorld();
    const stock = stockOf(w, convoy.id);
    stock.goods.parts = SALVAGE.convoy.parts[1] + 5;
    runDays(w, 1);
    expect(stock.goods.parts).toBe(SALVAGE.convoy.parts[1] + 5);
  });
});

describe('road wreck turnover', () => {
  const near = { x: 30, y: 30 };
  const far = { x: REGION.size - 20, y: REGION.size - 20 };

  it('replaces a looted wreck beyond gray vision after its days run out', () => {
    const w = worldWithLootedWreck(near, far);
    runDays(w, SALVAGE.wreckClearDays);
    expect(stockOf(w, 'wreck0')).toBeDefined();
    runDays(w, 1);
    const wrecks = w.obstacles.filter(isRoadWreck);
    expect(wrecks).toHaveLength(1);
    expect(wrecks[0].id).not.toBe('wreck0');
    expect(dist(wrecks[0].pos, near)).toBeGreaterThan(grayRadius(w, wrecks[0].pos));
    expect(stockOf(w, wrecks[0].id).goods.scrap).toBeGreaterThan(0);
  });

  it('keeps a looted wreck the player can see', () => {
    const w = worldWithLootedWreck(near, { x: 40, y: 30 });
    runDays(w, SALVAGE.wreckClearDays + 2);
    expect(w.obstacles.map((o) => o.id)).toEqual(['wreck0']);
  });

  it('keeps a wreck that still holds loot', () => {
    const w = worldWithLootedWreck(near, far);
    stockOf(w, 'wreck0').goods.scrap = 1;
    runDays(w, SALVAGE.wreckClearDays + 2);
    expect(w.obstacles.map((o) => o.id)).toEqual(['wreck0']);
  });

  it('stops a search of the wreck it removes', () => {
    const w = worldWithLootedWreck(near, far);
    const npc = addVehicle(w, 'scavengers', 'scout', [], far);
    npc.job = { kind: 'search', stockId: 'wreck0', turnsLeft: 3, total: 3 };
    runDays(w, SALVAGE.wreckClearDays + 1);
    expect(npc.job).toBeNull();
  });
});
