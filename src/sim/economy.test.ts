import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { ECONOMY, GOOD_IDS, TOWN_PRICES } from '../data/goods';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { checkDefeat } from './defeat';
import { buyChassis, buyGood, buyPart, buyPrice, buySupply, chassisTradeIn, repairAll, sellGood, sellPrice } from './economy';
import { corePart, coreParts, freeCells, goodsCount, mountedParts } from './grid';
import { spareParts } from './inventory';
import { canScavenge, scavenge, useOasis } from './locations';
import { gainXp, spendSkillPoint, xpForLevel } from './progress';
import { vehicleStats } from './stats';
import { consumeSupplies } from './supplies';
import { locationAt, townAt } from './sites';
import { addVehicle, emptyWorld } from './testkit';
import { dist } from './vec';
import { endTurn, newWorld } from './world';

const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const nose = REGION.towns.find((t) => t.id === 'nose')!;
const startAtBowl = () => emptyWorld(bowl.pos);

describe('trade', () => {
  it('buying moves money into cargo', () => {
    const w = buyGood(startAtBowl(), 'scrap', 3);
    expect(goodsCount(w.vehicles[0]).scrap).toBe(2 + 3);
    expect(w.player.money).toBe(1500 - 3 * buyPrice(w, 'bowl', 'scrap'));
  });

  it('enforces cargo capacity and money', () => {
    const w = startAtBowl();
    w.player.money = 10000;
    expect(() => buyGood(w, 'scrap', freeCells(w.vehicles[0]) + 1)).toThrow(/cargo space/);
    w.player.money = 300;
    expect(() => buyGood(w, 'meds', 10)).toThrow(/money/);
  });

  it('the scrap route pays and gives XP', () => {
    let w = buyGood(startAtBowl(), 'scrap', 8);
    w.vehicles[0].pos = { ...nose.pos };
    const money = w.player.money;
    w = sellGood(w, 'scrap', 10);
    expect(w.player.money - money).toBe(10 * sellPrice(w, 'nose', 'scrap'));
    expect(sellPrice(w, 'nose', 'scrap')).toBeGreaterThan(buyPrice(w, 'bowl', 'scrap'));
    expect(w.player.xp).toBeGreaterThan(0);
  });

  it('trade skill narrows the spread', () => {
    const w = startAtBowl();
    const before = buyPrice(w, 'bowl', 'salt') - sellPrice(w, 'bowl', 'salt');
    w.player.skills.trade = 3;
    expect(buyPrice(w, 'bowl', 'salt') - sellPrice(w, 'bowl', 'salt')).toBeLessThan(before);
  });

  it('town services need a town', () => {
    expect(() => buyGood(emptyWorld({ x: 30, y: 30 }), 'scrap', 1)).toThrow(/town/);
  });

  it('prices exist for every good in every town', () => {
    for (const t of REGION.towns) expect(Object.keys(TOWN_PRICES[t.id]).sort()).toEqual([...GOOD_IDS].sort());
  });
});

describe('garage', () => {
  it('buys supplies up to the cap', () => {
    const w = buySupply(startAtBowl(), 'supplies', RULES.suppliesCap - 12);
    expect(w.player.supplies).toBe(RULES.suppliesCap);
    expect(() => buySupply(w, 'supplies', 1)).toThrow();
  });

  it('repairs parts for money', () => {
    const w = startAtBowl();
    corePart(w.vehicles[0], 'cab').hp = 10;
    mountedParts(w.vehicles[0])[0].hp = 0;
    const r = repairAll(w);
    expect(corePart(r.vehicles[0], 'cab').hp).toBe(partDef('cab').hp);
    expect(mountedParts(r.vehicles[0])[0].hp).toBeGreaterThan(0);
    expect(r.player.money).toBeLessThan(1500);
  });

  it('chassis swap keeps fitting parts and stores the rest', () => {
    let w = startAtBowl();
    w.player.money = 2000;
    w = buyChassis(w, 'hauler');
    const me = w.vehicles[0];
    expect(me.chassisId).toBe('hauler');
    expect(mountedParts(me).map((p) => p.defId).filter((id) => partDef(id).kind !== 'core').sort()).toEqual(['cage', 'mg', 'rack', 'stockEngine']);
    expect(goodsCount(me)).toEqual({ scrap: 2 });
    expect(w.player.money).toBe(2000 - (CHASSIS.hauler.price - Math.floor(CHASSIS.scout.price * ECONOMY.chassisSellFactor)));
    w = buyChassis(w, 'scout');
    expect(w.player.storage.length).toBe(0);
  });

  it('trade-in drops with built-in part damage', () => {
    const w = startAtBowl();
    const whole = chassisTradeIn(w);
    coreParts(w.vehicles[0], 'wheel')[0].hp = 0;
    expect(chassisTradeIn(w)).toBeLessThan(whole);
  });
});

describe('supplies', () => {
  it('supplies drain each turn and running out hurts health', () => {
    const w = emptyWorld();
    w.player.supplies = 0.01;
    consumeSupplies(w);
    expect(w.player.supplies).toBe(0);
    expect(w.player.health).toBe(RULES.maxHealth - RULES.starveDamage);
  });

  it('supplies drain a quarter unit over ten turns', () => {
    const w = emptyWorld();
    for (let i = 0; i < 10; i++) consumeSupplies(w);
    expect(w.player.supplies).toBeCloseTo(12 - 0.25);
  });

  it('survival cuts use', () => {
    const w = emptyWorld();
    w.player.skills.survival = 2;
    consumeSupplies(w);
    expect(12 - w.player.supplies).toBeLessThan(RULES.suppliesPerTurn);
  });
});

describe('locations', () => {
  it('towns and locations use a 1.5x interaction radius', () => {
    const townReach = (bowl.radius + ECONOMY.useRange) * 1.5;
    const oasis = REGION.locations.find((l) => l.kind === 'oasis')!;
    const locationReach = (oasis.radius + ECONOMY.useRange) * 1.5;
    expect(townAt(emptyWorld({ x: bowl.pos.x + townReach - 0.01, y: bowl.pos.y }))?.id).toBe(bowl.id);
    expect(townAt(emptyWorld({ x: bowl.pos.x + townReach + 0.01, y: bowl.pos.y }))).toBeNull();
    expect(locationAt(emptyWorld({ x: oasis.pos.x + locationReach - 0.01, y: oasis.pos.y }))?.id).toBe(oasis.id);
    expect(locationAt(emptyWorld({ x: oasis.pos.x + locationReach + 0.01, y: oasis.pos.y }))).toBeNull();
  });

  it('oasis refills supplies', () => {
    const oasis = REGION.locations.find((l) => l.kind === 'oasis')!;
    const w = emptyWorld({ x: oasis.pos.x + 2, y: oasis.pos.y });
    w.player.supplies = 1;
    useOasis(w);
    expect(w.player.supplies).toBe(RULES.suppliesCap);
  });

  it('convoy starts a timed search, and a second search cannot start while it runs', () => {
    const convoy = REGION.locations.find((l) => l.kind === 'convoy')!;
    const w = emptyWorld({ x: convoy.pos.x + 2, y: convoy.pos.y });
    const after = scavenge(w);
    expect(after.vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', stockId: convoy.id }));
    expect(() => scavenge(after)).toThrow();
  });

  it('driving near a site discovers it once, with XP', () => {
    let w = newWorld(5, START_KITS.standard);
    const convoy = REGION.locations.find((l) => l.kind === 'convoy')!;
    w.vehicles.find((v) => v.faction === 'player')!.pos = { x: convoy.pos.x + 3.5, y: convoy.pos.y + 3.5 };
    w = endTurn(w);
    expect(w.player.discovered).toContain('burnt-convoy');
    expect(w.events.filter((e) => e.t === 'discover' && e.location === convoy.id)).toHaveLength(1);
    w = endTurn(w);
    expect(w.events.filter((e) => e.t === 'discover' && e.location === convoy.id)).toHaveLength(0);
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
  it('robs the player and patches the truck where it fell', () => {
    const w = emptyWorld({ x: 20, y: 40 });
    w.obstacles = newWorld(1, START_KITS.standard).obstacles;
    const me = w.vehicles[0];
    corePart(me, 'cab').hp = 0;
    w.player.skills.gunnery = 2;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: me.pos.x + 4, y: me.pos.y - 4 });
    checkDefeat(w);
    expect(me.pos).toEqual({ x: 20, y: 40 });
    expect(corePart(me, 'cab').hp).toBe(Math.max(1, Math.round(partDef('cab').hp * RULES.defeatPatch)));
    expect(w.player.fuel).toBe(0);
    expect(goodsCount(me)).toEqual({});
    expect(w.player.money).toBe(750);
    expect(w.player.skills.gunnery).toBe(2);
    expect(w.vehicles.find((v) => v.id === raider.id)).toBeUndefined();
    expect(w.events.some((e) => e.t === 'defeat')).toBe(true);
  });

  it('a broke, starving player can recover without fuel', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    Object.assign(w.player, { fuel: 0, supplies: 0, money: 0 });
    for (let i = 0; i < 20; i++) w = endTurn(w);
    expect(w.player.knockouts).toBe(1);
    expect(w.player.fuel).toBe(0);
    expect(corePart(w.vehicles[0], 'cab').hp).toBeGreaterThan(0);
  });

  it('can crawl toward town after losing a battle', () => {
    let w = emptyWorld({ x: 20, y: 40 });
    corePart(w.vehicles[0], 'cab').hp = 0;
    w = endTurn(w);
    const from = { ...w.vehicles[0].pos };
    w.vehicles[0].order = { kind: 'stopAt', dest: { x: 16, y: 43 } };
    w = endTurn(w);
    expect(dist(w.vehicles[0].pos, bowl.pos)).toBeLessThan(dist(from, bowl.pos));
    expect(w.player.fuel).toBe(0);
    expect(corePart(w.vehicles[0], 'cab').hp).toBeGreaterThan(0);
  });

  it('the game keeps running after a defeat', () => {
    let w = emptyWorld({ x: 20, y: 40 });
    corePart(w.vehicles[0], 'cab').hp = 0;
    w = endTurn(w);
    expect(w.events.some((e) => e.t === 'defeat')).toBe(true);
    w.vehicles[0].order = { kind: 'stopAt', dest: { x: 20, y: 40 } };
    for (let i = 0; i < 5; i++) w = endTurn(w);
    expect(corePart(w.vehicles[0], 'cab').hp).toBeGreaterThan(0);
  });
});
