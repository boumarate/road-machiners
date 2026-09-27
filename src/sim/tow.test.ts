import { describe, expect, it } from 'vitest';
import { NPC_CLASSES } from '../data/npcs';
import { REGION } from '../data/region';
import { BEACON, TOW } from '../data/tow';
import { partDef } from '../data/parts';
import { playerVehicle } from './damage';
import { route, routeLength } from './path';
import { canUseSite, siteGates } from './sites';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';
import { acceptTow, refuseTow, setBeacon, unhitch } from './tow';
import { canVehicleSee } from './vision';
import type { GameEvent, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { autoRuns, endTurn, setDirect, setMoveOrder } from './world';

type Setup = { w: World; trader: Vehicle };

function withTower(w: World, templateId: string, faction: Vehicle['faction'], chassis: string, pos: Vec): Vehicle {
  const v = addVehicle(w, faction, chassis, ['stockEngine'], pos, Math.PI);
  v.brain = { templateId, activity: null, goal: null, home: { ...pos }, stepIndex: 0, refusedTow: false };
  return v;
}

// A player with an empty tank and a trader in sight.
function stranded(playerPos: Vec = { x: 30, y: 30 }, traderPos: Vec = { x: 40, y: 30 }): Setup {
  const w = emptyWorld(playerPos);
  w.player.fuel = 0;
  const trader = withTower(w, 'trader', 'traders', 'hauler', traderPos);
  return { w, trader };
}

// Runs turns until the check passes, and returns the world with the turn's events.
function runUntil(w: World, max: number, done: (w: World) => boolean): { w: World; turns: number; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 1; i <= max; i++) {
    w = endTurn(w);
    events.push(...w.events);
    if (done(w)) return { w, turns: i, events };
  }
  return { w, turns: max, events };
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

function offered(s: Setup): World {
  const r = runUntil(s.w, 30, (w) => w.player.tow !== null);
  expect(r.w.player.tow).not.toBeNull();
  return r.w;
}

describe('tow offer', () => {
  it('a trader that sees a stranded player drives over and offers a tow', () => {
    const s = stranded();
    const r = runUntil(s.w, 30, (w) => w.player.tow !== null);
    expect(r.w.player.tow).toEqual({ by: s.trader.id, town: 'bowl', fee: expect.any(Number), hitched: false });
    expect(r.w.player.tow!.fee).toBeGreaterThan(TOW.base);
    expect(r.events.filter((e) => e.t === 'towOffer')).toEqual([{ t: 'towOffer', by: s.trader.id, town: 'bowl', fee: r.w.player.tow!.fee }]);
    const trader = find(r.w, s.trader.id);
    expect(dist(trader.pos, playerVehicle(r.w).pos)).toBeLessThan(10 - 1);
    expect(trader.brain!.activity?.kind).toBe('tow');
  });

  it('prices the tow by the route length to the nearest gate of the town', () => {
    const s = stranded();
    const w = offered(s);
    const me = playerVehicle(w);
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const gate = siteGates(town).reduce((a, b) => (dist(me.pos, a) <= dist(me.pos, b) ? a : b));
    const length = routeLength(me.pos, route(w, me.pos, gate, vehicleStats(w, find(w, s.trader.id)).radius, []));
    expect(w.player.tow!.fee).toBe(Math.round(TOW.base + TOW.perTile * length));
  });

  it('refusing stops that NPC from offering again', () => {
    const s = stranded();
    let w = refuseTow(offered(s));
    expect(w.player.tow).toBeNull();
    expect(find(w, s.trader.id).brain!.refusedTow).toBe(true);
    const r = runUntil(w, 15, (x) => x.player.tow !== null);
    w = r.w;
    expect(w.player.tow).toBeNull();
    expect(r.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  it('driving away from an open offer counts as refusing', () => {
    const s = stranded();
    let w = offered(s);
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 30, y: 60 } });
    const r = runUntil(w, 15, (x) => x.player.tow === null);
    expect(r.w.player.tow).toBeNull();
    expect(r.events).toContainEqual({ t: 'towDropped', by: s.trader.id, reason: 'refused' });
    expect(find(r.w, s.trader.id).brain!.refusedTow).toBe(true);
    const later = runUntil(r.w, 15, (x) => x.player.tow !== null);
    expect(later.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  it('raiders never tow', () => {
    expect(NPC_CLASSES.raider.tows).toBe(false);
    expect(NPC_CLASSES.trader.tows).toBe(true);
    expect(NPC_CLASSES.scavenger.tows).toBe(true);
    const w = emptyWorld();
    w.player.fuel = 0;
    // Nothing to take, so the raider leaves the player alone.
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core');
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 40, y: 30 });
    const r = runUntil(w, 20, (x) => x.player.tow !== null);
    expect(r.w.player.tow).toBeNull();
    expect(r.events.some((e) => e.t === 'activity' && e.vehicle === raider.id && e.activity === 'tow')).toBe(false);
  });

  it('a scavenger offers a tow too', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    const scav = withTower(w, 'scavenger', 'scavengers', 'scout', { x: 40, y: 30 });
    const r = runUntil(w, 30, (x) => x.player.tow !== null);
    expect(r.w.player.tow?.by).toBe(scav.id);
  });

  it('a player who can drive gets no offer', () => {
    const s = stranded();
    s.w.player.fuel = 30;
    const r = runUntil(s.w, 15, (x) => x.player.tow !== null);
    expect(r.w.player.tow).toBeNull();
  });
});

describe('towing', () => {
  it('accepting hitches the player, and the player follows the tower', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    expect(w.player.tow!.hitched).toBe(true);
    expect(playerVehicle(w).order).toBeNull();
    expect(playerVehicle(w).speed).toBe(0);
    expect(autoRuns(w)).toBe(true);
    const start = { ...playerVehicle(w).pos };
    for (let i = 0; i < 12; i++) {
      w = endTurn(w);
      const me = playerVehicle(w);
      const tower = find(w, s.trader.id);
      expect(dist(me.pos, tower.pos)).toBeLessThanOrEqual(TOW.gap + 1e-6);
      expect(me.speed).toBe(tower.speed);
      expect(me.trail).toHaveLength(tower.trail.length);
      expect(me.trail[me.trail.length - 1]).toEqual({ x: me.pos.x, y: me.pos.y, heading: me.heading });
    }
    const me = playerVehicle(w);
    const tower = find(w, s.trader.id);
    expect(dist(me.pos, start)).toBeGreaterThan(10);
    expect(dist(me.pos, tower.pos)).toBeGreaterThan(TOW.gap * 0.9);
    // The tower drives slower while towing, and the towed player burns no fuel.
    const free = structuredClone(w);
    free.player.tow = null;
    expect(vehicleStats(w, tower).maxSpeed).toBeCloseTo(vehicleStats(free, find(free, s.trader.id)).maxSpeed * TOW.speedShare);
    expect(w.player.fuel).toBe(0);
  });

  it('commands other than unhitch throw while hitched', () => {
    const w = acceptTow(offered(stranded()));
    expect(() => setMoveOrder(w, { kind: 'stopAt', dest: { x: 0, y: 0 } })).toThrow(/towed/);
    expect(() => setDirect(w, true)).toThrow(/towed/);
    expect(() => acceptTow(w)).toThrow(/towed/);
    expect(() => refuseTow(w)).toThrow(/towed/);
    expect(() => unhitch(w)).not.toThrow();
  });

  it('accept and refuse need an open offer, and unhitch needs a hitch', () => {
    const w = stranded().w;
    expect(() => acceptTow(w)).toThrow(/offer/);
    expect(() => refuseTow(w)).toThrow(/offer/);
    expect(() => unhitch(w)).toThrow(/not towed/);
  });

  it('unhitching is free and ends the tow', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    for (let i = 0; i < 4; i++) w = endTurn(w);
    const money = w.player.money;
    w = unhitch(w);
    expect(w.player.tow).toBeNull();
    expect(w.player.money).toBe(money);
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, reason: 'unhitched' });
    expect(find(w, s.trader.id).brain!.activity).toBeNull();
    expect(autoRuns(w)).toBe(false);
    expect(() => setMoveOrder(w, { kind: 'stopAt', dest: { x: 0, y: 0 } })).not.toThrow();
    const r = runUntil(w, 10, (x) => x.player.tow !== null);
    expect(r.w.player.money).toBe(money);
    expect(r.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  it('a tower that enters danger drops the tow for free', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    w = endTurn(w);
    const money = w.player.money;
    const tower = find(w, s.trader.id);
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: tower.pos.x + 8, y: tower.pos.y });
    w = endTurn(w);
    expect(w.player.tow).toBeNull();
    expect(w.player.money).toBe(money);
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, reason: 'danger' });
    expect(find(w, s.trader.id).brain!.activity?.kind).toBe('flee');
  });

  it('a tower that is destroyed drops the tow', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    w = endTurn(w);
    const tower = find(w, s.trader.id);
    tower.resources!.health = 0;
    w = endTurn(w);
    expect(w.player.tow).toBeNull();
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, reason: 'gone' });
  });

  it('arrival in town charges the fee once and allows debt', () => {
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const gate = siteGates(town)[0];
    const out = { x: (gate.x - town.pos.x) / town.radius, y: (gate.y - town.pos.y) / town.radius };
    const at = (d: number) => ({ x: gate.x + out.x * d, y: gate.y + out.y * d });
    const s = stranded(at(20), at(30));
    let w = offered(s);
    const fee = w.player.tow!.fee;
    w.player.money = 10;
    const traderMoney = find(w, s.trader.id).resources!.money;
    w = acceptTow(w);
    const r = runUntil(w, 120, (x) => x.player.tow === null);
    w = r.w;
    expect(r.events.filter((e) => e.t === 'towDone')).toEqual([{ t: 'towDone', by: s.trader.id, fee }]);
    expect(w.player.money).toBe(10 - fee);
    expect(w.player.money).toBeLessThan(0);
    expect(find(w, s.trader.id).resources!.money).toBe(traderMoney + fee);
    expect(canUseSite(find(w, s.trader.id).pos, town)).toBe(true);
    const me = playerVehicle(w);
    expect(me.speed).toBe(0);
    expect(dist(me.pos, find(w, s.trader.id).pos)).toBeLessThanOrEqual(TOW.gap + 1e-6);
    expect(autoRuns(w)).toBe(false);
    const after = runUntil(w, 5, () => false);
    expect(after.events.some((e) => e.t === 'towDone')).toBe(false);
    expect(after.w.player.money).toBe(10 - fee);
  });
});

describe('emergency beacon', () => {
  const player = { x: 30, y: 30 };
  const onlyCore = (v: Vehicle) => { v.items = v.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core'); };
  const activitiesOf = (events: GameEvent[], id: string) => events.filter((e) => e.t === 'activity' && e.vehicle === id);

  it('a trader out of sight but in range drives over and offers', () => {
    const s = stranded(player, { x: 130, y: 30 });
    const w = setBeacon(s.w, true);
    expect(w.player.beacon).toBe(true);
    expect(canVehicleSee(w, find(w, s.trader.id), playerVehicle(w).pos)).toBe(false);
    const r = runUntil(w, 150, (x) => x.player.tow !== null);
    expect(r.w.player.tow?.by).toBe(s.trader.id);
    expect(activitiesOf(r.events, s.trader.id)[0]).toMatchObject({ activity: 'tow', reason: 'help a stranded truck' });
  });

  it('a trader outside the range ignores it', () => {
    const s = stranded(player, { x: 30 + BEACON.range + 60, y: 30 });
    let w = setBeacon(s.w, true);
    for (let i = 0; i < 10; i++) {
      w = endTurn(w);
      const trader = find(w, s.trader.id);
      expect(dist(trader.pos, playerVehicle(w).pos)).toBeGreaterThan(BEACON.range);
      expect(trader.brain!.activity?.kind).not.toBe('tow');
    }
  });

  it('the first tower to arrive makes the offer, and the others drop the tow', () => {
    const s = stranded(player, { x: 100, y: 30 });
    const late = withTower(s.w, 'trader', 'traders', 'hauler', { x: 30, y: 150 });
    const r = runUntil(setBeacon(s.w, true), 150, (x) => x.player.tow !== null);
    expect(r.w.player.tow?.by).toBe(s.trader.id);
    expect(activitiesOf(r.events, late.id)[0]).toMatchObject({ activity: 'tow' });
    const next = endTurn(r.w);
    expect(find(next, late.id).brain!.activity?.kind).not.toBe('tow');
  });

  it('a raider comes to a beaconing truck with cargo', () => {
    const w = emptyWorld(player);
    w.player.fuel = 0;
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 130, y: 30 });
    const r = runUntil(setBeacon(w, true), 60, (x) => dist(find(x, raider.id).pos, playerVehicle(x).pos) < 15);
    expect(dist(find(r.w, raider.id).pos, playerVehicle(r.w).pos)).toBeLessThan(15);
    expect(activitiesOf(r.events, raider.id)[0]).toMatchObject({ activity: 'investigate' });
  });

  it('a raider ignores a stripped beaconing truck', () => {
    const w = emptyWorld(player);
    w.player.fuel = 0;
    onlyCore(w.vehicles[0]);
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 130, y: 30 });
    const r = runUntil(setBeacon(w, true), 30, () => false);
    expect(r.events.some((e) => e.t === 'activity' && e.vehicle === raider.id && ['investigate', 'fight'].includes(e.activity!))).toBe(false);
  });

  it('needs a stranded, active and unhitched truck', () => {
    const s = stranded();
    s.w.player.fuel = 30;
    expect(() => setBeacon(s.w, true)).toThrow(/stranded/);
    s.w.player.fuel = 0;
    s.w.player.state = 'knockedOut';
    expect(() => setBeacon(s.w, true)).toThrow(/knockedOut/);
    s.w.player.state = 'active';
    const on = setBeacon(s.w, true);
    expect(setBeacon(on, false).player.beacon).toBe(false);
    expect(() => setBeacon(acceptTow(offered({ w: on, trader: s.trader })), true)).toThrow(/towed/);
  });

  it('switches off on hitching', () => {
    const s = stranded();
    const w = acceptTow(offered({ w: setBeacon(s.w, true), trader: s.trader }));
    expect(w.player.beacon).toBe(false);
  });

  it('switches off when the truck can drive again', () => {
    const s = stranded();
    let w = setBeacon(s.w, true);
    w = endTurn(w);
    expect(w.player.beacon).toBe(true);
    w.player.fuel = 30;
    w = endTurn(w);
    expect(w.player.beacon).toBe(false);
  });

  it('starts off in a new world', () => {
    expect(emptyWorld().player.beacon).toBe(false);
  });

  it('runs turns on its own while the beacon is on, the truck is parked and no offer is open', () => {
    const s = stranded();
    expect(autoRuns(s.w)).toBe(false);
    const w = setBeacon(s.w, true);
    playerVehicle(w).speed = 0;
    expect(autoRuns(w)).toBe(true);
    playerVehicle(w).speed = 1;
    expect(autoRuns(w)).toBe(false);
    playerVehicle(w).speed = 0;
    expect(autoRuns(setMoveOrder(w, { kind: 'stopAt', dest: { x: 40, y: 40 } }))).toBe(false);
    w.player.tow = { by: s.trader.id, town: 'bowl', fee: 10, hitched: false };
    expect(autoRuns(w)).toBe(false);
  });
});
