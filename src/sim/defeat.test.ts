import { NPCS } from '../data/npcs';
import { describe, expect, it } from 'vitest';
import { PERK_NUMBERS } from '../data/skills';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { CONDITION } from '../data/wear';
import { autoOrders, isHostile } from './combat';
import { buyGood } from './economy';
import { advanceKnockout, checkDeath, checkKnockout } from './defeat';
import { corePart, coreParts, goodsCount, hasLoot, isLoot, mountedParts } from './grid';
import { addGoods, dumpItem, moveItem, spareParts } from './inventory';
import { scavenge } from './locations';
import { startSearch } from './search';
import { addState, endState, stateOf } from './states';
import { startRepair } from './jobs';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, testDrive } from './testkit';
import { refreshVision } from './vision';
import type { SalvageStock, Vehicle, World } from './types';
import { endTurn, setDirect, setMoveOrder, setWeaponOrder } from './world';

// Every goods unit and part id a vehicle and the stocks hold, for checking that nothing is lost or copied.
function inventory(w: World, v: Vehicle): { goods: Record<string, number>; parts: string[] } {
  const goods: Record<string, number> = { ...goodsCount(v) };
  const parts = v.items.flatMap((it) => (it.kind === 'part' ? [it.part.id] : []));
  for (const stock of w.salvage) {
    for (const [good, n] of Object.entries(stock.goods)) goods[good] = (goods[good] ?? 0) + n;
    parts.push(...stock.parts.map((p) => p.id));
  }
  for (const [good, n] of Object.entries(goods)) if (n === 0) delete goods[good];
  return { goods, parts: parts.sort() };
}

function knockedOut(): { w: World; me: Vehicle; stock: SalvageStock } {
  const w = emptyWorld({ x: 30, y: 30 });
  w.salvage = [];
  const me = w.vehicles[0];
  corePart(me, 'cab').hp = 0;
  checkKnockout(w);
  return { w, me, stock: w.salvage[0] };
}

describe('death', () => {
  it('kills the player at 0 health', () => {
    const w = emptyWorld();
    w.player.health = 0;
    checkDeath(w);
    expect(w.player.state).toBe('dead');
    expect(w.events).toEqual([{ t: 'death' }]);
    checkDeath(w);
    expect(w.events).toEqual([{ t: 'death' }]);
  });

  it('keeps a living player alive', () => {
    const w = emptyWorld();
    w.player.health = 1;
    checkDeath(w);
    expect(w.player.state).toBe('active');
  });

  it('dies in a turn that ends at 0 health, and no turn runs after', () => {
    let w = emptyWorld();
    w.player.health = 0;
    w = endTurn(w, testDrive);
    expect(w.player.state).toBe('dead');
    expect(w.events.some((e) => e.t === 'death')).toBe(true);
    expect(w.events.some((e) => e.t === 'knockout')).toBe(false);
    expect(() => endTurn(w, testDrive)).toThrow(/dead/);
  });

  it('does not knock out a dead player with a broken cab', () => {
    const w = emptyWorld();
    Object.assign(w.player, { health: 0, state: 'dead' });
    corePart(w.vehicles[0], 'cab').hp = 0;
    const items = w.vehicles[0].items.length;
    checkKnockout(w);
    expect(w.vehicles[0].items).toHaveLength(items);
    expect(w.events).toEqual([]);
  });

  it('a broke, starving player weakens to the starve floor without a knockout', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    Object.assign(w.player, { fuel: 0, supplies: 0, money: 0 });
    for (let i = 0; i < 20; i++) w = endTurn(w, testDrive);
    expect(w.player.health).toBe(RULES.starveFloor);
    expect(w.player.state).toBe('active');
    expect(w.player.knockouts).toBe(0);
    expect(corePart(w.vehicles[0], 'cab').hp).toBeGreaterThan(0);
  });

  it('starts the player active with a full supply load', () => {
    const w = emptyWorld();
    expect(w.player.state).toBe('active');
    expect(w.player.knockoutTurns).toBe(0);
    expect(w.player.supplies).toBe(RULES.suppliesCap);
  });
});

describe('loot', () => {
  it('counts goods, spare parts and mounted non-core parts, never core parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    expect(hasLoot(me)).toBe(true);
    const bare = addVehicle(w, 'traders', 'scout', [], { x: 40, y: 30 });
    expect(hasLoot(bare)).toBe(false);
    const gunned = addVehicle(w, 'traders', 'scout', ['mg'], { x: 44, y: 30 });
    expect(hasLoot(gunned)).toBe(true);
  });
});

describe('knockout', () => {
  it('moves every non-core item into a stock at the truck and loses nothing', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    const me = w.vehicles[0];
    expect(spareParts(me).length + mountedParts(me).filter((p) => partDef(p.defId).kind !== 'core').length).toBeGreaterThan(0);
    const before = inventory(w, me);
    const core = mountedParts(me, 'core').map((p) => p.id).sort();
    const money = w.player.money;
    const fuel = w.player.fuel;
    const supplies = w.player.supplies;
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    expect(inventory(w, me)).toEqual(before);
    expect(me.items.map((it) => (it.kind === 'part' ? it.part.id : it.good)).sort()).toEqual(core);
    expect(hasLoot(me)).toBe(false);
    expect(w.salvage).toHaveLength(1);
    expect(w.salvage[0].pos).toEqual(me.pos);
    expect(w.salvage[0].id.startsWith('wreck-')).toBe(true);
    expect(w.obstacles.some((o) => o.id === w.salvage[0].id)).toBe(false);
    expect(w.player).toMatchObject({ money, fuel, supplies, state: 'knockedOut', knockoutTurns: 0, knockouts: 1 });
    expect(w.events).toContainEqual({ t: 'knockout' });
  });

  it('brakes the truck, clears its orders and its job, and fulfils feuds against it', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    addState(w, 'feud', raider.id, me.id, { kind: 'feud', robbery: false });
    me.order = { kind: 'stopAt', dest: { x: 50, y: 30 } };
    me.speed = 0;
    me.job = { kind: 'repair', partId: corePart(me, 'cab').id, parts: 1, turnsLeft: 3, total: 3 };
    me.weaponOrders = { x: { targetId: raider.id, aim: 'body' } };
    me.trail = [{ x: 29, y: 30, heading: 0 }, { x: 30, y: 30, heading: 0 }];
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    expect(me.order).toEqual({ kind: 'brake' });
    expect(me.speed).toBe(0);
    expect(me.job).toBeNull();
    expect(me.weaponOrders).toEqual({});
    expect(me.trail).toEqual([]);
    expect(stateOf(w, 'feud', raider.id, me.id)).toBeNull();
    expect(w.events).toContainEqual({ t: 'stateEnded', state: expect.objectContaining({ kind: 'feud', holder: raider.id }), ending: 'fulfilled' });
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'job', outcome: 'cancelled' }));
  });

  it('a hurt but working cab is no knockout', () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], 'cab').hp = 1;
    checkKnockout(w);
    expect(w.player.state).toBe('active');
    expect(w.events).toEqual([]);
  });

  it('adds a second knockout in the same place to the first pile', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    corePart(w.vehicles[0], 'cab').hp = 0;
    w = endTurn(w, testDrive);
    w = endTurn(w, testDrive);
    expect(w.player.state).toBe('active');
    const scrap = w.salvage[0].goods.scrap ?? 0;
    expect(addGoods(w, w.vehicles[0], 'scrap', 1)).toBe(1);
    corePart(w.vehicles[0], 'cab').hp = 0;
    w = endTurn(w, testDrive);
    expect(w.player.state).toBe('knockedOut');
    expect(w.salvage).toHaveLength(1);
    expect(w.salvage[0].goods.scrap).toBe(scrap + 1);
  });

  it('keeps the knocked-out truck in place over turns', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 36, y: 30 });
    corePart(w.vehicles[0], 'cab').hp = 0;
    checkKnockout(w);
    addState(w, 'feud', raider.id, w.vehicles[0].id, { kind: 'feud', robbery: false }); // keeps the player knocked out
    const at = { ...w.vehicles[0].pos };
    for (let i = 0; i < 5; i++) {
      w = endTurn(w, testDrive);
      expect(w.player.state).toBe('knockedOut');
      expect(w.vehicles[0].pos).toEqual(at);
    }
  });
});

describe('waking', () => {
  it('wakes the next turn when no hostile sees the truck, and patches broken core parts', () => {
    const { w, me } = knockedOut();
    const wheel = coreParts(me, 'wheel')[0];
    wheel.hp = 0;
    const next = endTurn(w, testDrive);
    const truck = next.vehicles[0];
    expect(next.player.state).toBe('active');
    expect(next.events).toContainEqual({ t: 'wake' });
    const patched = (defId: string) => Math.max(1, Math.round(partDef(defId).hp * RULES.defeatPatch));
    expect(corePart(truck, 'cab').hp).toBe(patched('cab'));
    expect(coreParts(truck, 'wheel').find((p) => p.id === wheel.id)!.hp).toBe(patched(wheel.defId));
  });

  it('leaves junk core parts broken on waking', () => {
    const { w, me } = knockedOut();
    const wheel = coreParts(me, 'wheel')[0];
    wheel.hp = 0;
    wheel.wear = CONDITION.maxWear + 1;
    const next = endTurn(w, testDrive);
    expect(next.player.state).toBe('active');
    expect(coreParts(next.vehicles[0], 'wheel').find((p) => p.id === wheel.id)!.hp).toBe(0);
  });

  it('stops with the reason when the cab is junk', () => {
    const { w, me } = knockedOut();
    corePart(me, 'cab').wear = CONDITION.maxWear + 1;
    expect(() => advanceKnockout(w)).toThrow(/junk/);
  });

  it('stays knocked out while a raider sees the truck, even one ignoring it', () => {
    const { w, me } = knockedOut();
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    expect(isHostile(w, raider, me)).toBe(false);
    advanceKnockout(w);
    expect(w.player.state).toBe('knockedOut');
    expect(w.player.knockoutTurns).toBe(1);
  });

  it('wakes at the turn limit with a raider idling in sight', () => {
    let { w } = knockedOut();
    addVehicle(w, 'raiders', 'buggy', [], { x: 36, y: 30 });
    let turns = 0;
    while (w.player.state === 'knockedOut') {
      w = endTurn(w, testDrive);
      turns++;
      expect(turns).toBeLessThanOrEqual(RULES.knockoutMaxTurns);
    }
    expect(turns).toBe(RULES.knockoutMaxTurns);
    expect(w.player.state).toBe('active');
  });
});

describe('the loot rule', () => {
  it('a raider ignores a truck without loot but fights on a feud', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    const bare = addVehicle(w, 'traders', 'scout', [], { x: 40, y: 30 });
    expect(isHostile(w, raider, bare)).toBe(false);
    expect(isHostile(w, bare, raider)).toBe(false);
    autoOrders(w, raider);
    expect(Object.values(raider.weaponOrders).map((o) => o.targetId)).not.toContain(bare.id);
    const feud = addState(w, 'feud', bare.id, raider.id, { kind: 'feud', robbery: false });
    expect(isHostile(w, raider, bare)).toBe(true);
    endState(w, feud, 'expired');
    expect(isHostile(w, raider, bare)).toBe(false);
    addState(w, 'feud', raider.id, bare.id, { kind: 'feud', robbery: false });
    expect(isHostile(w, bare, raider)).toBe(true);
  });

  it('a raider is hostile to a truck with loot, and others ignore each other', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 36, y: 30 });
    const trader = addVehicle(w, 'traders', 'scout', ['mg'], { x: 40, y: 30 });
    const bare = addVehicle(w, 'traders', 'scout', [], { x: 44, y: 30 });
    expect(isHostile(w, raider, trader)).toBe(true);
    expect(isHostile(w, trader, raider)).toBe(true);
    expect(isHostile(w, trader, bare)).toBe(false);
  });

  it('a raider with free cargo searches the knocked-out truck', () => {
    const { w: w0, me, stock } = knockedOut();
    const before = inventory(w0, me);
    const raider = addVehicle(w0, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 42, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('idle', 'scavenge');
    for (const key of Object.keys(NPCS)) w0.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const units = (s: SalvageStock) => s.parts.length + Object.values(s.goods).reduce((a, n) => a + n, 0);
    const full = units(stock);
    let w = w0;
    let took = false;
    for (let turn = 0; turn < 60 && !took; turn++) {
      w = endTurn(w, testDrive);
      took = units(w.salvage.find((s) => s.id === stock.id)!) < full;
    }
    expect(took).toBe(true);
    const actor = w.vehicles.find((v) => v.id === raider.id)!;
    const after = inventory(w, w.vehicles[0]);
    const carried = inventory({ ...w, salvage: [] }, actor);
    for (const [good, n] of Object.entries(before.goods)) expect((after.goods[good] ?? 0) + (carried.goods[good] ?? 0)).toBe(n);
  });
});

describe('commands while knocked out', () => {
  it('reject every player command', () => {
    const { w, me } = knockedOut();
    const good = me.items.find((it) => it.kind === 'good');
    expect(good).toBeUndefined();
    const commands: (() => unknown)[] = [
      () => setMoveOrder(w, { kind: 'stopAt', dest: { x: 40, y: 30 } }),
      () => setWeaponOrder(w, 'x', null),
      () => setDirect(w, true),
      () => startRepair(w, corePart(me, 'cab').id),
      () => startSearch(w, w.salvage[0].id),
      () => moveItem(w, me.items[0].id, { x: 0, y: 0, rot: 0 }),
      () => dumpItem(w, me.items[0].id),
      () => buyGood(w, 'scrap', 1),
      () => scavenge(w),
    ];
    for (const command of commands) expect(command).toThrow('Player is knockedOut');
  });

  it('does not start an auto repair', () => {
    let { w } = knockedOut();
    expect(addGoods(w, w.vehicles[0], 'parts', 1)).toBe(1);
    w.player.autoRepair = true;
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 36, y: 30 });
    addState(w, 'feud', raider.id, w.vehicles[0].id, { kind: 'feud', robbery: false });
    w = endTurn(w, testDrive);
    expect(w.vehicles[0].job).toBeNull();
  });
});

describe('knockout practice', () => {
  it('pays the player for a knockout with a foe in sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    refreshVision(w);
    corePart(w.vehicles[0], 'cab').hp = 0;
    checkKnockout(w);
    expect(practiceOf(w, 'knockout')).toMatchObject([{ amount: 1, difficulty: null }]);
  });

  it('pays nothing for a knockout next to a raider that ignores a stripped truck', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => !isLoot(me.chassisId, it));
    addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    refreshVision(w);
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    expect(w.player.state).toBe('knockedOut');
    expect(practiceOf(w, 'knockout')).toEqual([]);
  });

  it('pays nothing for a knockout with nobody around', () => {
    const { w } = knockedOut();
    advanceKnockout(w);
    expect(w.player.state).toBe('active');
    expect(practiceOf(w, 'knockout')).toEqual([]);
  });

  it('pays nothing for an NPC whose cab breaks', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    corePart(npc, 'cab').hp = 0;
    checkKnockout(w);
    advanceKnockout(w);
    expect(practiceOf(w, 'knockout')).toEqual([]);
  });
});

describe('quick wake perk', () => {
  it('wakes the player at a shorter turn limit with a raider idling in sight', () => {
    let { w } = knockedOut();
    w.player.perks.push('quickWake');
    addVehicle(w, 'raiders', 'buggy', [], { x: 36, y: 30 });
    const limit = Math.ceil(RULES.knockoutMaxTurns * PERK_NUMBERS.quickWake.knockoutTurns);
    let turns = 0;
    while (w.player.state === 'knockedOut') {
      w = endTurn(w, testDrive);
      turns++;
      expect(turns).toBeLessThanOrEqual(limit);
    }
    expect(turns).toBe(limit);
  });
});
