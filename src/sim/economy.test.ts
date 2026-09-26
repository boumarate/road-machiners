import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { ECONOMY, TOWN_PRICES } from '../data/goods';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { checkDefeat } from './defeat';
import { buyChassis, buyGood, buyPart, buyPrice, buySupply, repairAll, sellGood, sellPrice } from './economy';
import { freeCells, goodsCount, mountedParts } from './grid';
import { spareParts } from './inventory';
import { canScavenge, scavenge, useOasis } from './locations';
import { gainXp, spendSkillPoint, xpForLevel } from './progress';
import { vehicleStats } from './stats';
import { consumeSupplies } from './supplies';
import { addVehicle, emptyWorld } from './testkit';
import { dist } from './vec';
import { endTurn, newWorld } from './world';

const tin = REGION.towns.find((t) => t.id === 'tin')!;
const salt = REGION.towns.find((t) => t.id === 'salt')!;
const inTin = () => emptyWorld(tin.pos);

describe('trade', () => {
  it('buying moves money into cargo', () => {
    const w = buyGood(inTin(), 'scrap', 3);
    expect(goodsCount(w.vehicles[0]).scrap).toBe(2 + 3);
    expect(w.player.money).toBe(300 - 3 * buyPrice(w, 'tin', 'scrap'));
  });

  it('enforces cargo capacity and money', () => {
    const w = inTin();
    w.player.money = 10000;
    expect(() => buyGood(w, 'scrap', freeCells(w.vehicles[0]) + 1)).toThrow(/cargo space/);
    w.player.money = 300;
    expect(() => buyGood(w, 'meds', 10)).toThrow(/money/);
  });

  it('the scrap route pays and gives XP', () => {
    let w = buyGood(inTin(), 'scrap', 8);
    w.vehicles[0].pos = { ...salt.pos };
    const money = w.player.money;
    w = sellGood(w, 'scrap', 10);
    expect(w.player.money - money).toBe(10 * sellPrice(w, 'salt', 'scrap'));
    expect(sellPrice(w, 'salt', 'scrap')).toBeGreaterThan(buyPrice(w, 'tin', 'scrap'));
    expect(w.player.xp).toBeGreaterThan(0);
  });

  it('trade skill narrows the spread', () => {
    const w = inTin();
    const before = buyPrice(w, 'tin', 'salt') - sellPrice(w, 'tin', 'salt');
    w.player.skills.trade = 3;
    expect(buyPrice(w, 'tin', 'salt') - sellPrice(w, 'tin', 'salt')).toBeLessThan(before);
  });

  it('town services need a town', () => {
    expect(() => buyGood(emptyWorld({ x: 30, y: 30 }), 'scrap', 1)).toThrow(/town/);
  });

  it('prices exist for every good in every town', () => {
    for (const t of REGION.towns) expect(Object.keys(TOWN_PRICES[t.id]).sort()).toEqual(['meds', 'salt', 'scrap']);
  });
});

describe('garage', () => {
  it('buys supplies up to the cap', () => {
    const w = buySupply(inTin(), 'water', RULES.waterCap - 12);
    expect(w.player.water).toBe(RULES.waterCap);
    expect(() => buySupply(w, 'water', 1)).toThrow();
  });

  it('repairs hull and parts for money', () => {
    const w = inTin();
    w.vehicles[0].hull = 10;
    mountedParts(w.vehicles[0])[0].hp = 0;
    const r = repairAll(w);
    expect(r.vehicles[0].hull).toBe(vehicleStats(r, r.vehicles[0]).hullMax);
    expect(mountedParts(r.vehicles[0])[0].hp).toBeGreaterThan(0);
    expect(r.player.money).toBeLessThan(300);
  });

  it('chassis swap keeps fitting parts and stores the rest', () => {
    let w = inTin();
    w.player.money = 2000;
    w = buyChassis(w, 'hauler');
    const me = w.vehicles[0];
    expect(me.chassisId).toBe('hauler');
    expect(mountedParts(me).map((p) => p.defId).sort()).toEqual(['cage', 'mg', 'rack', 'stockEngine']);
    expect(me.hull).toBe(vehicleStats(w, me).hullMax);
    expect(goodsCount(me)).toEqual({ scrap: 2 });
    expect(w.player.money).toBe(2000 - (CHASSIS.hauler.price - Math.floor(CHASSIS.scout.price * ECONOMY.chassisSellFactor)));
    w = buyChassis(w, 'scout');
    expect(w.player.storage.length).toBe(0);
  });
});

describe('supplies', () => {
  it('water and food drain each turn, empty hurts health', () => {
    const w = emptyWorld();
    w.player.water = 0.1;
    consumeSupplies(w);
    expect(w.player.water).toBe(0);
    expect(w.player.food).toBeCloseTo(12 - RULES.foodPerTurn);
    expect(w.player.health).toBe(RULES.maxHealth - RULES.starveDamage);
  });

  it('survival cuts use', () => {
    const w = emptyWorld();
    w.player.skills.survival = 2;
    consumeSupplies(w);
    expect(12 - w.player.water).toBeLessThan(RULES.waterPerTurn);
  });
});

describe('locations', () => {
  it('oasis refills water', () => {
    const oasis = REGION.locations.find((l) => l.kind === 'oasis')!;
    const w = emptyWorld({ x: oasis.pos.x + 2, y: oasis.pos.y });
    w.player.water = 1;
    useOasis(w);
    expect(w.player.water).toBe(RULES.waterCap);
  });

  it('convoy can be scavenged once', () => {
    const convoy = REGION.locations.find((l) => l.kind === 'convoy')!;
    const w = emptyWorld({ x: convoy.pos.x + 2, y: convoy.pos.y });
    const after = scavenge(w);
    expect(spareParts(after.vehicles[0]).map((p) => p.defId)).toEqual([ECONOMY.scavenge.part]);
    expect(freeCells(after.vehicles[0])).toBeLessThan(freeCells(w.vehicles[0]));
    expect(canScavenge(after)).toBe(false);
    expect(() => scavenge(after)).toThrow();
  });

  it('driving near a site discovers it once, with XP', () => {
    let w = newWorld(5);
    const convoy = REGION.locations.find((l) => l.kind === 'convoy')!;
    w.vehicles.find((v) => v.faction === 'player')!.pos = { x: convoy.pos.x + 3.5, y: convoy.pos.y + 3.5 };
    w = endTurn(w);
    expect(w.player.discovered).toContain('convoy');
    expect(w.events.filter((e) => e.t === 'discover')).toHaveLength(1);
    w = endTurn(w);
    expect(w.events.filter((e) => e.t === 'discover')).toHaveLength(0);
  });
});

describe('progress', () => {
  it('levels grant skill points', () => {
    const w = emptyWorld();
    const points = w.player.skillPoints;
    gainXp(w, xpForLevel(3), 'test');
    expect(w.player.level).toBe(3);
    expect(w.player.skillPoints).toBe(points + 2);
  });

  it('spending a point raises the skill and each skill changes its number', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const turn = vehicleStats(w, me).turnSlow;
    spendSkillPoint(w, 'driving');
    expect(vehicleStats(w, me).turnSlow).toBeGreaterThan(turn);
    w.player.skillPoints = 0;
    expect(() => spendSkillPoint(w, 'gunnery')).toThrow();
  });
});

describe('defeat', () => {
  it('knocks out, robs, and wakes the player in the nearest town', () => {
    const w = emptyWorld({ x: 20, y: 40 });
    w.obstacles = newWorld(1).obstacles;
    const me = w.vehicles[0];
    me.hull = 0;
    w.player.skills.gunnery = 2;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: tin.pos.x + 4, y: tin.pos.y - 4 });
    checkDefeat(w);
    expect(dist(me.pos, tin.pos)).toBeLessThan(tin.radius);
    expect(me.hull).toBeGreaterThan(0);
    expect(goodsCount(me)).toEqual({});
    expect(w.player.money).toBe(150);
    expect(w.player.skills.gunnery).toBe(2);
    expect(w.vehicles.find((v) => v.id === raider.id)).toBeUndefined();
    expect(w.events.some((e) => e.t === 'defeat')).toBe(true);
  });

  it('a broke, starving player wakes with enough supplies to move on', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    Object.assign(w.player, { fuel: 0, water: 0, food: 0, money: 0 });
    for (let i = 0; i < 20; i++) w = endTurn(w);
    expect(w.player.knockouts).toBe(1);
    expect(w.player.fuel).toBeGreaterThan(0);
  });

  it('the game keeps running after a defeat', () => {
    let w = emptyWorld({ x: 20, y: 40 });
    w.vehicles[0].hull = 0;
    w = endTurn(w);
    expect(w.events.some((e) => e.t === 'defeat')).toBe(true);
    w.vehicles[0].order = { kind: 'stopAt', dest: { x: 20, y: 40 } };
    for (let i = 0; i < 5; i++) w = endTurn(w);
    expect(w.vehicles[0].hull).toBeGreaterThan(0);
  });
});
