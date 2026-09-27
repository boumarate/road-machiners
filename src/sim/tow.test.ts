import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { BEACON, TOW } from '../data/tow';
import { partDef } from '../data/parts';
import { playerVehicle } from './damage';
import { route, routeLength } from './path';
import { canUseSite, siteGates, sitePads } from './sites';
import { getResources } from './resources';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, testDrive } from './testkit';
import { hasLoot } from './grid';
import { thinkNpc, topGoal } from './npc-activities';
import { optionChances, optionWeights } from './npc-decisions';
import { addState, stateOf, towData } from './states';
import { callVehicle, chooseOption, currentOptions, hangUp } from './dialogue';
import { dropTow, isTowed, playerTow, setBeacon, unhitch } from './tow';
import { sunAt } from './sun';
import { canVehicleSee } from './vision';
import type { GameEvent, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { autoRuns, endTurn, setDirect, setMoveOrder } from './world';

type Setup = { w: World; trader: Vehicle };

function withTower(w: World, templateId: string, faction: Vehicle['faction'], chassis: string, pos: Vec): Vehicle {
  const v = addVehicle(w, faction, chassis, ['stockEngine'], pos, Math.PI);
  v.brain = npcBrain(templateId, pos, NPCS[templateId].traits);
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
    w = endTurn(w, testDrive);
    events.push(...w.events);
    if (done(w)) return { w, turns: i, events };
  }
  return { w, turns: max, events };
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;
const feeOf = (w: World) => towData(playerTow(w)!).fee;

// Runs turns until the tower makes its offer, which it then calls in by radio.
function offered(s: Setup): World {
  const r = runUntil(s.w, 30, (w) => playerTow(w) !== null);
  expect(playerTow(r.w)).not.toBeNull();
  expect(r.w.player.call).toMatchObject({ with: playerTow(r.w)!.holder, topic: 'tow' });
  return r.w;
}

function answer(w: World, text: string): World {
  const i = currentOptions(w).findIndex((o) => o.text === text);
  if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => o.text).join(' | ')}`);
  return chooseOption(w, i);
}

const acceptTow = (w: World) => answer(w, 'Deal. Hitch me up.');
const refuseTow = (w: World) => answer(w, 'No thanks.');

describe('tow offer', () => {
  it('a trader that sees a stranded player drives over and offers a tow', () => {
    const s = stranded();
    const r = runUntil(s.w, 30, (w) => playerTow(w) !== null);
    expect(playerTow(r.w)).toMatchObject({ kind: 'tow', holder: s.trader.id, other: r.w.player.vehicleId, data: { kind: 'tow', town: 'bowl', fee: expect.any(Number), hitched: false } });
    expect(feeOf(r.w)).toBeGreaterThan(TOW.base);
    expect(r.events.filter((e) => e.t === 'towOffer')).toEqual([{ t: 'towOffer', by: s.trader.id, town: 'bowl', fee: feeOf(r.w) }]);
    const trader = find(r.w, s.trader.id);
    expect(dist(trader.pos, playerVehicle(r.w).pos)).toBeLessThan(10 - 1);
    expect(topGoal(trader)?.kind).toBe('tow');
  });

  it('prices the tow by the route length to the nearest pad of the town', () => {
    const s = stranded();
    const w = offered(s);
    const me = playerVehicle(w);
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const pad = sitePads(town).reduce((a, b) => (dist(me.pos, a) <= dist(me.pos, b) ? a : b));
    const length = routeLength(me.pos, route(w, me.pos, pad, vehicleStats(w, find(w, s.trader.id)).radius, []));
    expect(feeOf(w)).toBe(Math.round(TOW.base + TOW.perTile * length));
  });

  it('refusing stops that NPC from offering again while the player stays in sight', () => {
    const s = stranded();
    let w = refuseTow(offered(s));
    expect(playerTow(w)).toBeNull();
    expect(stateOf(w, 'turnedDown', s.trader.id, w.player.vehicleId)).not.toBeNull();
    const r = runUntil(w, 15, (x) => playerTow(x) !== null);
    w = r.w;
    expect(playerTow(w)).toBeNull();
    expect(r.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  it('hanging up on the offer counts as refusing', () => {
    const s = stranded();
    const w = hangUp(offered(s));
    expect(playerTow(w)).toBeNull();
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, reason: 'refused' });
    expect(stateOf(w, 'turnedDown', s.trader.id, w.player.vehicleId)).not.toBeNull();
    const later = runUntil(w, 15, (x) => playerTow(x) !== null);
    expect(later.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  it('a stranded player can ask a passing trader, which comes over and offers', () => {
    const s = stranded({ x: 30, y: 30 }, { x: 44, y: 30 });
    forceOption('strandedSeen', 'keep');
    let w = endTurn(s.w, testDrive);
    expect(topGoal(find(w, s.trader.id))?.kind).not.toBe('tow');
    w = callVehicle(w, s.trader.id);
    w = answer(w, 'I am stranded. Can you tow me?');
    w = answer(w, 'Thanks. I will wait.');
    expect(topGoal(find(w, s.trader.id))?.kind).toBe('tow');
    const r = runUntil(w, 30, (x) => playerTow(x) !== null);
    expect(r.w.player.call).toMatchObject({ with: s.trader.id, topic: 'tow' });
  });

  it('a driver that cannot tow is not asked', () => {
    const s = stranded();
    s.w.player.fuel = 30;
    const w = callVehicle(s.w, s.trader.id);
    expect(currentOptions(w).map((o) => o.text)).not.toContain('I am stranded. Can you tow me?');
  });

  it('raiders never tow', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    // Nothing to take, so the raider leaves the player alone.
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core');
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 40, y: 30 });
    const r = runUntil(w, 20, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)).toBeNull();
    expect(r.events.some((e) => e.t === 'activity' && e.vehicle === raider.id && e.activity === 'tow')).toBe(false);
  });

  it('a scavenger offers a tow too', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    const scav = withTower(w, 'scavenger', 'scavengers', 'scout', { x: 40, y: 30 });
    const r = runUntil(w, 30, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)?.holder).toBe(scav.id);
  });

  it('a player who can drive gets no offer', () => {
    const s = stranded();
    s.w.player.fuel = 30;
    const r = runUntil(s.w, 15, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)).toBeNull();
  });
});

describe('towing', () => {
  it('accepting hitches the player, and the player follows the tower', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    expect(isTowed(w)).toBe(true);
    expect(playerVehicle(w).order).toBeNull();
    expect(playerVehicle(w).speed).toBe(0);
    expect(autoRuns(w)).toBe(true);
    const start = { ...playerVehicle(w).pos };
    for (let i = 0; i < 12; i++) {
      w = endTurn(w, testDrive);
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
    free.states = [];
    expect(vehicleStats(w, tower).maxSpeed).toBeCloseTo(vehicleStats(free, find(free, s.trader.id)).maxSpeed * TOW.speedShare);
    expect(w.player.fuel).toBe(0);
  });

  it('commands other than unhitch throw while hitched', () => {
    const w = acceptTow(offered(stranded()));
    expect(() => setMoveOrder(w, { kind: 'stopAt', dest: { x: 0, y: 0 } })).toThrow(/towed/);
    expect(() => setDirect(w, true)).toThrow(/towed/);
    expect(() => acceptTow(w)).toThrow(/No call/);
    expect(() => unhitch(w)).not.toThrow();
  });

  it('unhitch needs a hitch', () => {
    expect(() => unhitch(stranded().w)).toThrow(/not towed/);
  });

  it('unhitching is free and ends the tow', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    for (let i = 0; i < 4; i++) w = endTurn(w, testDrive);
    const money = w.player.money;
    w = unhitch(w);
    expect(playerTow(w)).toBeNull();
    expect(w.player.money).toBe(money);
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, reason: 'unhitched' });
    expect(autoRuns(w)).toBe(false);
    expect(() => setMoveOrder(w, { kind: 'stopAt', dest: { x: 0, y: 0 } })).not.toThrow();
    const r = runUntil(w, 10, (x) => playerTow(x) !== null);
    expect(r.w.player.money).toBe(money);
    expect(find(r.w, s.trader.id).brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
    expect(r.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  it('a tower that enters danger drops the tow for free', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    w = endTurn(w, testDrive);
    const money = w.player.money;
    const tower = find(w, s.trader.id);
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: tower.pos.x + 8, y: tower.pos.y });
    forceOption('hostileSeen', 'flee');
    w = endTurn(w, testDrive);
    expect(playerTow(w)).toBeNull();
    expect(w.player.money).toBe(money);
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, reason: 'danger' });
    expect(topGoal(find(w, s.trader.id))?.kind).toBe('flee');
  });

  it('a tower that is destroyed drops the tow', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    w = endTurn(w, testDrive);
    const tower = find(w, s.trader.id);
    tower.resources!.health = 0;
    w = endTurn(w, testDrive);
    expect(playerTow(w)).toBeNull();
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, reason: 'gone' });
  });

  it('arrival in town charges the fee once and allows debt', () => {
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const gate = siteGates(town)[0];
    const out = { x: (gate.x - town.pos.x) / town.radius, y: (gate.y - town.pos.y) / town.radius };
    const at = (d: number) => ({ x: gate.x + out.x * d, y: gate.y + out.y * d });
    const s = stranded(at(20), at(30));
    // A raider spawning near the gate would scare the tower off, and this test is about arrival.
    for (const id of Object.keys(NPCS)) s.w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('idle', 'wait');
    forceOption('strandedSeen', 'tow');
    let w = offered(s);
    const fee = feeOf(w);
    w.player.money = 10;
    const traderMoney = find(w, s.trader.id).resources!.money;
    w = acceptTow(w);
    const r = runUntil(w, 120, (x) => playerTow(x) === null);
    w = r.w;
    expect(r.events.filter((e) => e.t === 'towDone')).toEqual([{ t: 'towDone', by: s.trader.id, fee }]);
    expect(r.events.filter((e) => e.t === 'stateEnded').map((e) => e.t === 'stateEnded' && e.ending)).toEqual(['fulfilled']);
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

describe('answering a stranded truck', () => {
  const answering = (w: World) => w.states.filter((st) => st.kind === 'answering');

  // Five towers around a stranded player far from any town, all in sight of it.
  function crowd(): { w: World; towers: Vehicle[] } {
    const w = emptyWorld({ x: 30, y: 30 });
    w.player.fuel = 0;
    const towers = [0, 1, 2, 3, 4].map((k) => {
      const a = (k / 5) * Math.PI * 2;
      const tpl = k % 2 ? 'trader' : 'scavenger';
      return withTower(w, tpl, tpl === 'trader' ? 'traders' : 'scavengers', 'hauler', { x: 30 + Math.cos(a) * 12, y: 30 + Math.sin(a) * 12 });
    });
    return { w, towers };
  }

  it('only one of five towers in sight takes the tow goal, and the rest keep their work', () => {
    const { w, towers } = crowd();
    forceOption('strandedSeen', 'tow');
    const next = endTurn(w, testDrive);
    const tows = towers.filter((t) => topGoal(find(next, t.id))?.kind === 'tow');
    expect(tows).toHaveLength(1);
    expect(answering(next)).toMatchObject([{ holder: tows[0].id, other: next.player.vehicleId }]);
    for (const t of towers) if (t !== tows[0]) expect(find(next, t.id).brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
  });

  it('a driver with a tow goal drops it once another driver holds the claim', () => {
    const { w, towers } = crowd();
    const [first, second] = towers;
    forceOption('strandedSeen', 'tow');
    thinkNpc(w, find(w, second.id));
    expect(topGoal(find(w, second.id))?.kind).toBe('tow');
    addState(w, 'answering', first.id, w.player.vehicleId, { kind: 'none' });
    w.turn++;
    thinkNpc(w, find(w, second.id));
    expect(find(w, second.id).brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
  });

  it('after the claimed tower gives up, another tower answers on a later decision', () => {
    const { w, towers } = crowd();
    forceOption('strandedSeen', 'tow');
    let next = endTurn(w, testDrive);
    const [claim] = answering(next);
    const holder = find(next, claim.holder);
    holder.brain!.goals = holder.brain!.goals.filter((g) => g.kind !== 'tow');
    next = runUntil(next, 3, (x) => answering(x).some((st) => st.holder !== claim.holder)).w;
    const [again] = answering(next);
    expect(again.holder).not.toBe(claim.holder);
    expect(towers.map((t) => t.id)).toContain(again.holder);
    expect(topGoal(find(next, again.holder))?.kind).toBe('tow');
  });

  it('a truck at a town gate gets the tow chosen far less often than 40 tiles out, and still above 0', () => {
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const gate = siteGates(bowl)[0];
    const out = { x: (gate.x - bowl.pos.x) / bowl.radius, y: (gate.y - bowl.pos.y) / bowl.radius };
    const towChance = (away: number) => {
      const at = { x: gate.x + out.x * away, y: gate.y + out.y * away };
      const s = stranded(at, { x: at.x + out.x * 8, y: at.y + out.y * 8 });
      return optionChances(optionWeights(s.w, s.trader, 'strandedSeen', s.w.player.vehicleId, null)).tow!;
    };
    const atGate = towChance(0);
    const farOut = towChance(40);
    expect(atGate).toBeGreaterThan(0);
    expect(atGate).toBeLessThan(farOut / 3);
  });
});

describe('tow deals', () => {
  it('a trader that is crawling itself does not offer a tow', () => {
    const s = stranded();
    getResources(s.w, s.trader).fuel = 0;
    forceOption('strandedSeen', 'tow');
    const r = runUntil(s.w, 15, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)).toBeNull();
    expect(r.events.some((e) => e.t === 'activity' && e.vehicle === s.trader.id && e.activity === 'tow')).toBe(false);
  });

  it('a tower that dropped the tow for danger offers the same deal again', () => {
    const s = stranded();
    forceOption('strandedSeen', 'tow');
    let w = acceptTow(offered(s));
    const deal = { holder: playerTow(w)!.holder, ...towData(playerTow(w)!) };
    // A few turns of towing shorten the way, so a new price would be lower.
    for (let i = 0; i < 5; i++) w = endTurn(w, testDrive);
    expect(isTowed(w)).toBe(true);
    dropTow(w, playerTow(w)!, 'danger');
    expect(stateOf(w, 'towPromise', deal.holder, w.player.vehicleId)).not.toBeNull();
    const r = runUntil(w, 30, (x) => playerTow(x) !== null);
    const again = playerTow(r.w)!;
    expect(again.holder).toBe(deal.holder);
    expect(towData(again)).toEqual({ kind: 'tow', town: deal.town, fee: deal.fee, hitched: false });
    expect(stateOf(r.w, 'towPromise', deal.holder, r.w.player.vehicleId)).toBeNull();
  });
});

describe('emergency beacon', () => {
  const player = { x: 30, y: 30 };
  const onlyCore = (v: Vehicle) => { v.items = v.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core'); };
  const activitiesOf = (events: GameEvent[], id: string) => events.filter((e) => e.t === 'activity' && e.vehicle === id);

  it('a tower re-aims at a player who crawled off at night, then reaches and offers', () => {
    const s = stranded(player, { x: 90, y: 30 });
    let w = s.w;
    while (sunAt(w.turn + 1)) w.turn++;
    w = runUntil(setBeacon(w, true), 5, (x) => topGoal(find(x, s.trader.id))?.kind === 'tow').w;
    expect(topGoal(find(w, s.trader.id))?.kind).toBe('tow');
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 30, y: 44 } });
    const r = runUntil(w, 60, (x) => playerTow(x) !== null);
    expect(sunAt(r.w.turn)).toBeNull();
    expect(playerVehicle(r.w).pos.y).toBeGreaterThan(40);
    expect(playerTow(r.w)?.holder).toBe(s.trader.id);
  });

  it('a tower beyond sight heads for the newest beacon circle', () => {
    const s = stranded(player, { x: 90, y: 30 });
    let w = runUntil(setBeacon(s.w, true), 5, (x) => topGoal(find(x, s.trader.id))?.kind === 'tow').w;
    playerVehicle(w).pos = { x: 30, y: 60 };
    w = endTurn(w, testDrive);
    const trader = find(w, s.trader.id);
    expect(canVehicleSee(w, trader, playerVehicle(w).pos)).toBe(false);
    expect(dist(topGoal(trader)!.destination!, playerVehicle(w).pos)).toBeLessThanOrEqual(BEACON.radius);
  });

  it('a tower that set out for a beacon does not roll to rob its client on arrival', () => {
    const s = stranded(player, { x: 130, y: 30 });
    const w = setBeacon(s.w, true);
    const trader = find(w, s.trader.id);
    trader.brain!.traits = ['trader', 'scumbag'];
    expect(hasLoot(playerVehicle(w))).toBe(true);
    forceOption('strandedSeen', 'tow');
    // A preySeen roll on the client would almost surely rob.
    forceOption('preySeen', 'rob');
    thinkNpc(w, trader);
    expect(topGoal(trader)?.kind).toBe('tow');
    trader.pos = { x: 40, y: 30 };
    w.turn++;
    thinkNpc(w, trader);
    expect(topGoal(trader)?.kind).toBe('tow');
    expect(stateOf(w, 'feud', trader.id, w.player.vehicleId)).toBeNull();
  });

  it('a trader outside the range ignores it', () => {
    const s = stranded(player, { x: 30 + BEACON.range + 60, y: 30 });
    let w = setBeacon(s.w, true);
    for (let i = 0; i < 10; i++) {
      w = endTurn(w, testDrive);
      const trader = find(w, s.trader.id);
      expect(dist(trader.pos, playerVehicle(w).pos)).toBeGreaterThan(BEACON.range);
      expect(topGoal(trader)?.kind).not.toBe('tow');
    }
  });

  it('only the first tower to hear a beacon answers it, and its claim ends with the offer', () => {
    const s = stranded(player, { x: 100, y: 30 });
    const late = withTower(s.w, 'trader', 'traders', 'hauler', { x: 30, y: 150 });
    // Only the two towers placed here may answer, and both mean to tow.
    for (const id of Object.keys(NPCS)) s.w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('strandedSeen', 'tow');
    const r = runUntil(setBeacon(s.w, true), 150, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)?.holder).toBe(s.trader.id);
    expect(activitiesOf(r.events, late.id).filter((e) => e.t === 'activity' && e.activity === 'tow')).toEqual([]);
    expect(r.w.states.filter((st) => st.kind === 'answering')).toEqual([]);
  });

  it('a raider ignores a stripped beaconing truck', () => {
    const w = emptyWorld(player);
    w.player.fuel = 0;
    onlyCore(w.vehicles[0]);
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 130, y: 30 });
    // Spawned NPCs may draw the raider, so only goals aimed at the player count.
    runUntil(setBeacon(w, true), 30, (x) => {
      const goal = topGoal(find(x, raider.id));
      expect(goal?.targetId === x.player.vehicleId && ['investigate', 'fight'].includes(goal.kind)).toBe(false);
      return false;
    });
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
    w = endTurn(w, testDrive);
    expect(w.player.beacon).toBe(true);
    w.player.fuel = 30;
    w = endTurn(w, testDrive);
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
    addState(w, 'tow', s.trader.id, w.player.vehicleId, { kind: 'tow', town: 'bowl', fee: 10, hitched: false });
    expect(autoRuns(w)).toBe(false);
  });
});
