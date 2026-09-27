import { maxHp } from './wear';
import { describe, expect, it } from 'vitest';
import * as economy from './economy';
import { addVehicle, emptyWorld } from './testkit';
import { REGION } from '../data/region';
import { ECONOMY } from '../data/goods';
import { corePart, goodsCount } from './grid';
import { siteGates } from './sites';
import { partDef } from '../data/parts';
import { chassisDef } from '../data/chassis';
import { RULES } from '../data/rules';

describe('NPC transactions', () => {
  it('pays to repair the built-in cab without selling it', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], siteGates(REGION.towns[0])[0]);
    const cab = corePart(npc, 'cab');
    cab.hp -= 2;
    npc.resources!.money = Math.ceil((2 * ECONOMY.repairShare * economy.partValue(cab)) / maxHp(cab));
    npc.resources!.fuel = chassisDef(npc.chassisId).fuelCap;
    npc.resources!.supplies = RULES.suppliesCap;
    economy.serviceVehicle(w, npc, 'bowl', 0);
    expect(corePart(npc, 'cab').id).toBe(cab.id);
    expect(cab.hp).toBe(partDef(cab.defId).hp);
    expect(npc.resources!.money).toBe(0);
  });

  it('rejects an unaffordable purchase without partial effects', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', [], siteGates(REGION.towns[0])[0]);
    npc.resources!.money = 1;
    const before = structuredClone(npc);
    expect(() => economy.tradeGoods(w, npc, 'bowl', 'scrap', 2, 'buy')).toThrow('money');
    expect(npc).toEqual(before);
  });

  it('buys and sells real cargo without spending player money', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], siteGates(REGION.towns[0])[0]);
    const money = npc.resources!.money;
    const playerMoney = w.player.money;
    expect(economy.tradeGoods).toBeTypeOf('function');
    const buy = economy.getTradePrice(w, npc, 'bowl', 'scrap', 'buy');
    economy.tradeGoods(w, npc, 'bowl', 'scrap', 2, 'buy');
    expect(goodsCount(npc).scrap).toBe(2);
    expect(npc.resources!.money).toBe(money - 2 * buy);
    const sell = economy.getTradePrice(w, npc, 'bowl', 'scrap', 'sell');
    economy.tradeGoods(w, npc, 'bowl', 'scrap', 2, 'sell');
    expect(goodsCount(npc).scrap ?? 0).toBe(0);
    expect(npc.resources!.money).toBe(money - 2 * buy + 2 * sell);
    expect(w.player.money).toBe(playerMoney);
  });

  it('rejects remote transactions without changing inventory or money', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', [], { x: 30, y: 30 });
    expect(economy.tradeGoods).toBeTypeOf('function');
    const before = structuredClone(npc);
    expect(() => economy.tradeGoods(w, npc, 'bowl', 'scrap', 1, 'buy')).toThrow('gate');
    expect(npc).toEqual(before);
  });

  it('buys only affordable fuel before other service', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', [], siteGates(REGION.towns[0])[0]);
    npc.resources!.fuel = 0;
    npc.resources!.supplies = 0;
    npc.resources!.money = ECONOMY.supplyPrice.fuel * 2;
    expect(economy.serviceVehicle).toBeTypeOf('function');
    economy.serviceVehicle(w, npc, 'bowl', 0);
    expect(npc.resources!.fuel).toBe(2);
    expect(npc.resources!.money).toBe(0);
    expect(npc.resources!.supplies).toBe(0);
  });
});
