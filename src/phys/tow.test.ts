// Tow approaches and hitched towers (src/sim/tow.ts), played through real physics.
// These race a driving approach against the NPC's own threat and detection checks, or check that trucks get
// past each other without a crash, so they need the game's real driving, not the generic test stand-in in
// src/sim/testkit.ts.

import { beforeAll, describe, expect, it } from 'vitest';
import { canVehicleSee } from '../sim/vision';
import { playerVehicle } from '../sim/damage';
import { NPCS } from '../data/npcs';
import { partDef } from '../data/parts';
import { topGoal } from '../sim/npc-activities';
import { addVehicle, emptyWorld, forceOption, npcBrain } from '../sim/testkit';
import { acceptTow, playerTow, setBeacon } from '../sim/tow';
import type { GameEvent, Vehicle, World } from '../sim/types';
import { dist, type Vec } from '../sim/vec';
import { endTurn } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

// Plays n turns through the real turn pipeline with physics movement.
function play(w: World, n: number): { w: World } {
  let d = buildDrive(w);
  for (let i = 0; i < n; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
  }
  freeDrive(d);
  return { w };
}

function withTower(w: World, templateId: string, faction: Vehicle['faction'], chassis: string, pos: Vec): Vehicle {
  const v = addVehicle(w, faction, chassis, ['stockEngine'], pos, Math.PI);
  v.brain = npcBrain(templateId, pos, NPCS[templateId].traits);
  return v;
}

const onlyCore = (v: Vehicle) => { v.items = v.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core'); };

// A stranded, unarmed player with an empty tank and a trader in sight: unarmed, so a towing trait
// never flees it as a threat before it can offer to help.
function stranded(playerPos: Vec = { x: 30, y: 30 }, traderPos: Vec = { x: 40, y: 30 }) {
  const w = emptyWorld(playerPos);
  w.player.fuel = 0;
  onlyCore(w.vehicles[0]);
  const trader = withTower(w, 'trader', 'traders', 'hauler', traderPos);
  return { w, trader };
}

function runUntil(w: World, max: number, done: (w: World) => boolean): { w: World; turns: number; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 1; i <= max; i++) {
    ({ w } = play(w, 1));
    events.push(...w.events);
    if (done(w)) return { w, turns: i, events };
  }
  return { w, turns: max, events };
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

describe('hitched tower traffic', () => {
  // A hitched tower on its way to town, a point `ahead` tiles along its way and `side` tiles to its left, and how
  // far along its way a point lies.
  function underWay(): { w: World; tower: Vehicle; along: (ahead: number, side: number) => Vec; progress: (p: Vec) => number } {
    const s = stranded();
    forceOption('strandedSeen', 'tow');
    const offer = runUntil(s.w, 30, (x) => playerTow(x) !== null);
    expect(playerTow(offer.w)).not.toBeNull();
    const w = play(acceptTow(offer.w), 2).w;
    const tower = find(w, s.trader.id);
    const goal = topGoal(tower)!.destination!;
    const a = Math.atan2(goal.y - tower.pos.y, goal.x - tower.pos.x);
    const along = (ahead: number, side: number) => ({
      x: tower.pos.x + Math.cos(a) * ahead - Math.sin(a) * side,
      y: tower.pos.y + Math.sin(a) * ahead + Math.cos(a) * side,
    });
    const origin = { ...tower.pos };
    const progress = (p: Vec) => (p.x - origin.x) * Math.cos(a) + (p.y - origin.y) * Math.sin(a);
    return { w, tower, along, progress };
  }

  const crashes = (events: GameEvent[], id: string) => events.filter((e) => e.t === 'collision' && (e.a === id || e.b === id));

  it('a hitched tower gets past a parked truck in its path without a collision', () => {
    const { w, tower, along } = underWay();
    const parked = addVehicle(w, 'scavengers', 'hauler', ['stockEngine'], along(14, 0.5), 0);
    const r = runUntil(w, 20, () => false);
    expect(crashes(r.events, tower.id)).toEqual([]);
    expect(dist(find(r.w, tower.id).pos, parked.pos)).toBeGreaterThan(10);
  });

  it('a hitched tower and a truck meeting it head-on both get past without a collision', () => {
    const { w, tower, along, progress } = underWay();
    const start = along(25, 0);
    const behind = along(-30, 0);
    const other = withTower(w, 'scavenger', 'scavengers', 'hauler', start);
    other.heading = Math.atan2(behind.y - start.y, behind.x - start.x);
    other.brain!.goals = [{ kind: 'raid', targetId: null, destination: behind, phase: 'travel', reason: 'drive past the tower' }];
    const r = runUntil(w, 20, () => false);
    expect(crashes(r.events, tower.id)).toEqual([]);
    expect(progress(find(r.w, other.id).pos)).toBeLessThan(0);
    expect(progress(find(r.w, tower.id).pos)).toBeGreaterThan(10);
  });
});

describe('emergency beacon', () => {
  const player = { x: 30, y: 30 };
  const activitiesOf = (events: GameEvent[], id: string) => events.filter((e) => e.t === 'activity' && e.vehicle === id);

  it('a trader out of sight but in range drives over and offers', () => {
    const s = stranded(player, { x: 130, y: 30 });
    const w = setBeacon(s.w, true);
    expect(w.player.beacon).toBe(true);
    expect(canVehicleSee(w, find(w, s.trader.id), playerVehicle(w).pos)).toBe(false);
    const r = runUntil(w, 150, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)?.holder).toBe(s.trader.id);
    expect(activitiesOf(r.events, s.trader.id)[0]).toMatchObject({ activity: 'tow', reason: 'help a stranded truck' });
  });

  it('a raider comes to a beaconing truck with cargo', () => {
    const w = emptyWorld(player);
    w.player.fuel = 0;
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 130, y: 30 });
    forceOption('contactHeard', 'investigate');
    const r = runUntil(setBeacon(w, true), 60, (x) => dist(find(x, raider.id).pos, playerVehicle(x).pos) < 15);
    expect(dist(find(r.w, raider.id).pos, playerVehicle(r.w).pos)).toBeLessThan(15);
    expect(activitiesOf(r.events, raider.id)[0]).toMatchObject({ activity: 'investigate' });
  });
});
