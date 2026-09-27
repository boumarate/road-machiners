import { describe, expect, it } from 'vitest';
import { PRESSURE_MAX, SHOPS } from '../data/market';
import { emptyWorld } from './testkit';
import {
  addStockPart,
  advanceShop,
  goodBasePrice,
  goodPrice,
  initShop,
  recordTrade,
  takeStockPart,
  type ShopState,
} from './market';

describe('market', () => {
  it('raises pressure on buying and lowers it on selling', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    expect(state.pressure.scrap).toBe(0);
    recordTrade('bowl', state, 'scrap', 10, 'buy');
    expect(state.pressure.scrap).toBeGreaterThan(0);
    const afterBuy = state.pressure.scrap;
    recordTrade('bowl', state, 'scrap', 10, 'sell');
    expect(state.pressure.scrap).toBeLessThan(afterBuy);
  });

  it('clamps pressure to PRESSURE_MAX', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    recordTrade('bowl', state, 'scrap', 100000, 'buy');
    expect(state.pressure.scrap).toBe(PRESSURE_MAX);
    recordTrade('bowl', state, 'scrap', 100000, 'sell');
    expect(state.pressure.scrap).toBe(-PRESSURE_MAX);
  });

  it('drifts pressure back toward 0 over turns without crossing it', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    recordTrade('bowl', state, 'scrap', 10, 'buy');
    let last = state.pressure.scrap;
    expect(last).toBeGreaterThan(0);
    for (let i = 0; i < 500; i++) {
      w.turn++;
      // Stay well before the next restock so only drift, not a fresh roll, moves pressure.
      state.restockAt = w.turn + SHOPS.bowl.restockTurns;
      advanceShop(w, 'bowl', state);
      expect(state.pressure.scrap).toBeLessThanOrEqual(last);
      expect(state.pressure.scrap).toBeGreaterThanOrEqual(0);
      last = state.pressure.scrap;
    }
    expect(state.pressure.scrap).toBeLessThan(0.05);
  });

  it('rolls a finite stock that restocking replaces deterministically for a given rng state', () => {
    const w1 = emptyWorld();
    const w2 = emptyWorld();
    const s1 = initShop(w1, 'salvage-yard');
    const s2 = initShop(w2, 'salvage-yard');
    expect(s1.stock.map((p) => [p.defId, p.wear])).toEqual(s2.stock.map((p) => [p.defId, p.wear]));
    expect(s1.stock.length).toBeGreaterThanOrEqual(SHOPS['salvage-yard'].stockSize[0]);
    expect(s1.stock.length).toBeLessThanOrEqual(SHOPS['salvage-yard'].stockSize[1]);

    // Force a restock and check the same rng state gives the same fresh stock again.
    s1.restockAt = w1.turn;
    s2.restockAt = w2.turn;
    advanceShop(w1, 'salvage-yard', s1);
    advanceShop(w2, 'salvage-yard', s2);
    expect(s1.stock.map((p) => [p.defId, p.wear])).toEqual(s2.stock.map((p) => [p.defId, p.wear]));
  });

  it('takeStockPart removes a part and addStockPart inserts one', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    const before = state.stock.length;
    const target = state.stock[0];
    const taken = takeStockPart(state, target.id);
    expect(taken).toBe(target);
    expect(state.stock.length).toBe(before - 1);
    expect(state.stock.find((p) => p.id === target.id)).toBeUndefined();
    addStockPart(state, taken);
    expect(state.stock.length).toBe(before);
    expect(state.stock.find((p) => p.id === target.id)).toBe(taken);
  });

  it('throws taking a part id that is not in stock', () => {
    const w = emptyWorld();
    const state = initShop(w, 'bowl');
    expect(() => takeStockPart(state, 'no-such-part')).toThrow();
  });

  it('throws pricing a good a shop does not trade', () => {
    const w = emptyWorld();
    const state = initShop(w, 'granary');
    expect(() => goodBasePrice('granary', 'electronics')).toThrow();
    expect(() => goodPrice('granary', state, 'electronics', 'buy', 0.2)).toThrow();
    expect(() => recordTrade('granary', state, 'electronics', 1, 'buy')).toThrow();
  });

  it('throws for an unknown shop', () => {
    expect(() => goodBasePrice('no-such-shop', 'scrap')).toThrow();
  });

  it('always prices a sell strictly below the buy at the same shop', () => {
    const w = emptyWorld();
    const state: ShopState = initShop(w, 'nose');
    for (const good of SHOPS.nose.goods) {
      const buy = goodPrice('nose', state, good, 'buy', 0.2);
      const sell = goodPrice('nose', state, good, 'sell', 0.2);
      expect(sell).toBeLessThan(buy);
    }
  });

  it('prices a good made locally below a good needed locally, before pressure', () => {
    // Bowl makes scrap and needs salt, so at rest scrap should price under salt's mirrored profile.
    expect(goodBasePrice('bowl', 'scrap')).toBeLessThan(goodBasePrice('nose', 'scrap'));
    expect(goodBasePrice('nose', 'salt')).toBeLessThan(goodBasePrice('bowl', 'salt'));
  });
});
