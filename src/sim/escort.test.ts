import { describe, expect, it } from 'vitest';
import { NPC_BEHAVIOR, NPCS, type TraitId } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { fireWeapons } from './combat';
import { goalHolds, thinkNpc, topGoal } from './npc-activities';
import { optionChances, optionWeights } from './npc-decisions';
import { siteGates, sitePads, type Site } from './sites';
import { spawnNpcs } from './spawn';
import { addState, advanceStates, endState, settleStates, stateOf } from './states';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, testDrive } from './testkit';
import { escortsOf, isOnRope, startEscort, towOf } from './tow';
import type { GameEvent, NpcState, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { refreshVision } from './vision';
import { endTurn } from './world';

const BOWL = REGION.towns.find((t) => t.id === 'bowl')!;

function createNpc(w: World, templateId: string, traits: TraitId[], chassis: string, parts: string[], pos: Vec): Vehicle {
  const npc = addVehicle(w, NPCS[templateId].faction, chassis, parts, pos);
  npc.brain = npcBrain(templateId, pos, traits);
  return npc;
}

const convoyAt = (w: World, pos: Vec) => createNpc(w, 'convoy', ['supplier'], 'hauler', ['mg', 'workhorseDiesel', 'trailerBox'], pos);
const guardAt = (w: World, pos: Vec) => createNpc(w, 'convoyGuard', ['guard'], 'scout', ['mg', 'stockEngine'], pos);
const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;
const escortOf = (w: World, escort: Vehicle, leader: Vehicle) => stateOf(w, 'escort', escort.id, leader.id);

// A point `d` tiles out from the site's first gate, away from the site.
function outFrom(site: Site, d: number): Vec {
  const gate = siteGates(site)[0];
  const len = dist(gate, site.pos);
  return { x: gate.x + ((gate.x - site.pos.x) / len) * d, y: gate.y + ((gate.y - site.pos.y) / len) * d };
}

// The escort state waits for the next turn, as if it were added a turn ago.
function aged(s: NpcState | null): NpcState {
  if (!s) throw new Error('No escort state');
  s.born = -1;
  return s;
}

function runUntil(w: World, max: number, done: (w: World) => boolean): { w: World; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < max; i++) {
    w = endTurn(w, testDrive);
    events.push(...w.events);
    if (done(w)) return { w, events };
  }
  return { w, events };
}

describe('the follow goal', () => {
  it('re-aims behind its leader every turn', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const convoy = convoyAt(w, { x: 60, y: 60 });
    const guard = guardAt(w, { x: 50, y: 60 });
    startEscort(w, guard, convoy, null, 0);
    const gap = vehicleStats(w, convoy).radius + vehicleStats(w, guard).radius + NPC_BEHAVIOR.followGap;

    const first = thinkNpc(w, guard);
    expect(first.kind).toBe('follow');
    expect(first.destination!.x).toBeCloseTo(60 - gap);
    expect(first.destination!.y).toBeCloseTo(60);

    convoy.pos = { x: 70, y: 65 };
    convoy.heading = Math.PI / 2;
    const second = thinkNpc(w, guard);
    expect(second.destination!.x).toBeCloseTo(70);
    expect(second.destination!.y).toBeCloseTo(65 - gap);
  });

  it('stops outside the braking distance of its leader', () => {
    expect(NPC_BEHAVIOR.followGap).toBeGreaterThan(RULES.yieldDistance);
  });

  it('sits at the bottom of the stack, and a fight above it resumes it without a roll', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const convoy = convoyAt(w, { x: 60, y: 60 });
    const guard = guardAt(w, { x: 50, y: 60 });
    guard.brain!.goals = [{ kind: 'fight', targetId: 'gone', destination: null, phase: 'act', reason: 'test fight' }];
    startEscort(w, guard, convoy, null, 0);
    expect(guard.brain!.goals.map((g) => g.kind)).toEqual(['follow', 'fight']);
    forceOption('resume', 'new');
    thinkNpc(w, guard);
    expect(topGoal(guard)?.kind).toBe('follow');
  });

  it('drops the turn its escort state ends', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const convoy = convoyAt(w, { x: 60, y: 60 });
    const guard = guardAt(w, { x: 50, y: 60 });
    startEscort(w, guard, convoy, null, 0);
    const goal = topGoal(guard)!;
    expect(goalHolds(w, guard, goal)).toBe(true);

    endState(w, escortOf(w, guard, convoy)!, 'broken');
    expect(goalHolds(w, guard, goal)).toBe(false);
    forceOption('idle', 'wait');
    thinkNpc(w, guard);
    expect(guard.brain!.goals.some((g) => g.kind === 'follow')).toBe(false);
  });
});

describe('escort protection', () => {
  it('a shot at the leader makes its escort in sight of the shooter feud with it and fight back', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const convoy = convoyAt(w, { x: 60, y: 60 });
    const guard = guardAt(w, { x: 52, y: 60 });
    const shooter = createNpc(w, 'scavenger', ['scavenger', 'scumbag'], 'scout', ['mg', 'stockEngine'], { x: 66, y: 60 });
    shooter.heading = Math.PI;
    startEscort(w, guard, convoy, null, 0);
    refreshVision(w);
    shooter.weaponOrders[vehicleStats(w, shooter).weapons[0].part.id] = { targetId: convoy.id, aim: 'body' };
    fireWeapons(w);

    expect(guard.brain!.attackers[shooter.id]).toBe(false);
    expect(stateOf(w, 'feud', guard.id, shooter.id)).not.toBeNull();
    forceOption('attacked', 'fightBack');
    thinkNpc(w, guard);
    expect(topGoal(guard)).toMatchObject({ kind: 'fight', targetId: shooter.id });
    expect(guard.brain!.goals[0].kind).toBe('follow');
  });

  it('an escort that cannot see the shooter stays out of it', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const convoy = convoyAt(w, { x: 60, y: 60 });
    const guard = guardAt(w, { x: 10, y: 60 });
    const shooter = createNpc(w, 'scavenger', ['scavenger', 'scumbag'], 'scout', ['mg', 'stockEngine'], { x: 66, y: 60 });
    shooter.heading = Math.PI;
    startEscort(w, guard, convoy, null, 0);
    refreshVision(w);
    shooter.weaponOrders[vehicleStats(w, shooter).weapons[0].part.id] = { targetId: convoy.id, aim: 'body' };
    fireWeapons(w);

    expect(shooter.id in guard.brain!.attackers).toBe(false);
    expect(stateOf(w, 'feud', guard.id, shooter.id)).toBeNull();
  });
});

describe('escort tows', () => {
  // A convoy with an empty tank 30 tiles out from the Bowl, and its guard behind it. The player watches from 10
  // tiles closer in. Nobody spawns, and idle drivers wait.
  function strandedConvoy(): { w: World; convoy: Vehicle; guard: Vehicle } {
    const w = emptyWorld(outFrom(BOWL, 20));
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('idle', 'wait');
    const convoy = convoyAt(w, outFrom(BOWL, 30));
    convoy.resources!.fuel = 0;
    convoy.resources!.money = 1000;
    const guard = guardAt(w, outFrom(BOWL, 38));
    startEscort(w, guard, convoy, null, 0);
    refreshVision(w);
    return { w, convoy, guard };
  }

  it('an escort tows its stranded leader nearly always', () => {
    const s = strandedConvoy();
    const chances = optionChances(optionWeights(s.w, s.guard, 'strandedSeen', s.convoy.id, null));
    expect(chances.tow).toBeGreaterThan(0.95);
    endState(s.w, escortOf(s.w, s.guard, s.convoy)!, 'broken');
    expect(optionChances(optionWeights(s.w, s.guard, 'strandedSeen', s.convoy.id, null)).tow).toBeLessThan(0.5);
  });

  it('tows its stranded leader to town, keeps the escort, and follows again after', () => {
    const s = strandedConvoy();
    // Rob stays available at the minimum chance when the guard first sees its convoy. This state keeps that roll off.
    s.w.rngState = 7;
    const hitch = runUntil(s.w, 40, (w) => isOnRope(w, s.convoy.id));
    expect(towOf(hitch.w, s.convoy.id)?.holder).toBe(s.guard.id);
    const done = runUntil(hitch.w, 200, (w) => towOf(w, s.convoy.id) === null);
    expect(done.events.some((e) => e.t === 'towDone' && e.by === s.guard.id)).toBe(true);
    expect(escortOf(done.w, s.guard, s.convoy)).not.toBeNull();
    expect(find(done.w, s.guard.id).brain!.goals[0]).toMatchObject({ kind: 'follow', targetId: s.convoy.id });
  });

  it('tows its leader again when it strands again after a tow', () => {
    const s = strandedConvoy();
    s.w.rngState = 7;
    const first = runUntil(s.w, 240, (w) => w.events.some((e) => e.t === 'towDone'));
    const w = first.w;
    const convoy = find(w, s.convoy.id);
    convoy.pos = outFrom(BOWL, 30);
    convoy.resources!.fuel = 0;
    find(w, s.guard.id).pos = outFrom(BOWL, 38);
    const again = runUntil(w, 40, (x) => isOnRope(x, s.convoy.id));
    expect(towOf(again.w, s.convoy.id)?.holder).toBe(s.guard.id);
  });
});

describe('escort pay', () => {
  function hired(fee: number, money: number): { w: World; trader: Vehicle; merc: Vehicle } {
    const w = emptyWorld({ x: 200, y: 200 });
    const trader = createNpc(w, 'trader', ['trader'], 'hauler', ['stockEngine'], { x: 60, y: 60 });
    trader.resources!.money = money;
    const merc = createNpc(w, 'merc', ['merc'], 'scout', ['mg', 'stockEngine'], { x: 50, y: 60 });
    merc.resources!.money = 100;
    startEscort(w, merc, trader, 'bowl', fee);
    aged(escortOf(w, merc, trader));
    return { w, trader, merc };
  }

  const paid = (w: World) => w.events.filter((e) => e.t === 'escortPaid');

  it('pays the fee once when the leader can use its destination site', () => {
    const { w, trader, merc } = hired(50, 1000);
    advanceStates(w);
    expect(paid(w)).toEqual([]);

    trader.pos = { ...sitePads(BOWL)[0] };
    advanceStates(w);
    expect(paid(w)).toEqual([{ t: 'escortPaid', by: merc.id, client: trader.id, fee: 50 }]);
    expect(trader.resources!.money).toBe(950);
    expect(merc.resources!.money).toBe(150);
    expect(escortOf(w, merc, trader)).toBeNull();

    advanceStates(w);
    expect(paid(w)).toHaveLength(1);
    expect(merc.resources!.money).toBe(150);
  });

  it('pays no more than the leader holds', () => {
    const { w, trader, merc } = hired(50, 30);
    trader.pos = { ...sitePads(BOWL)[0] };
    advanceStates(w);
    expect(trader.resources!.money).toBe(0);
    expect(merc.resources!.money).toBe(130);
  });

  it('a broken escort pays nothing', () => {
    const { w, trader, merc } = hired(50, 1000);
    addState(w, 'feud', merc.id, trader.id, { kind: 'feud', robbery: false });
    advanceStates(w);
    expect(escortOf(w, merc, trader)).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'broken' }));
    trader.pos = { ...sitePads(BOWL)[0] };
    advanceStates(w);
    expect(paid(w)).toEqual([]);
    expect(trader.resources!.money).toBe(1000);
    expect(merc.resources!.money).toBe(100);
  });

  it('breaks when the leader is knocked out', () => {
    const { w, trader, merc } = hired(50, 1000);
    trader.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [] };
    advanceStates(w);
    expect(escortOf(w, merc, trader)).toBeNull();
    expect(paid(w)).toEqual([]);
  });

  it('an escort with no destination never fulfils', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const convoy = convoyAt(w, { ...sitePads(BOWL)[0] });
    const guard = guardAt(w, outFrom(BOWL, 8));
    startEscort(w, guard, convoy, null, 0);
    aged(escortOf(w, guard, convoy));
    advanceStates(w);
    expect(escortOf(w, guard, convoy)).not.toBeNull();
  });
});

describe('convoy guards', () => {
  it('a new convoy spawns with its guard escorting and following it', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = id === 'convoy' ? 1 : Number.MAX_SAFE_INTEGER;
    spawnNpcs(w);
    const convoy = w.vehicles.find((v) => v.brain?.templateId === 'convoy')!;
    const guard = w.vehicles.find((v) => v.brain?.templateId === 'convoyGuard')!;
    expect(escortOf(w, guard, convoy)?.data).toEqual({ kind: 'escort', site: null, fee: 0 });
    expect(guard.brain!.goals).toEqual([expect.objectContaining({ kind: 'follow', targetId: convoy.id })]);
    expect(escortsOf(w, convoy.id).map((v) => v.id)).toEqual([guard.id]);
  });

  it('joins the nearest unguarded convoy of its faction after its own is gone', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const lost = convoyAt(w, { x: 60, y: 60 });
    const guarded = convoyAt(w, { x: 70, y: 60 });
    const free = convoyAt(w, { x: 100, y: 60 });
    const guard = guardAt(w, { x: 52, y: 60 });
    startEscort(w, guard, lost, null, 0);
    startEscort(w, guardAt(w, { x: 70, y: 52 }), guarded, null, 0);

    w.vehicles = w.vehicles.filter((v) => v.id !== lost.id);
    settleStates(w);
    forceOption('idle', 'escort');
    const goal = thinkNpc(w, guard);

    expect(goal).toMatchObject({ kind: 'follow', targetId: free.id });
    expect(guard.brain!.goals).toHaveLength(1);
    expect(escortOf(w, guard, free)?.data).toEqual({ kind: 'escort', site: null, fee: 0 });
  });

  it('cannot take up an escort with every convoy guarded', () => {
    const w = emptyWorld({ x: 300, y: 300 });
    const convoy = convoyAt(w, { x: 70, y: 60 });
    startEscort(w, guardAt(w, { x: 70, y: 52 }), convoy, null, 0);
    const orphan = guardAt(w, { x: 52, y: 60 });
    expect(optionWeights(w, orphan, 'idle', null, null)).not.toHaveProperty('escort');
  });
});
