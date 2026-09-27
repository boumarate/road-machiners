// Long NPC approaches toward a beaconing player (src/sim/tow.ts), played through real physics.
// These race a driving approach against the NPC's own threat and detection checks, so they need the
// game's real acceleration and speed, not the generic test stand-in in src/sim/testkit.ts.

import { beforeAll, describe, expect, it } from 'vitest';
import { canVehicleSee } from '../sim/vision';
import { playerVehicle } from '../sim/damage';
import { partDef } from '../data/parts';
import { addVehicle, emptyWorld } from '../sim/testkit';
import { setBeacon } from '../sim/tow';
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
  v.brain = { templateId, activity: null, goal: null, home: { ...pos }, stepIndex: 0, refusedTow: false };
  return v;
}

const onlyCore = (v: Vehicle) => { v.items = v.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core'); };

// A stranded, unarmed player with an empty tank and a trader in sight: unarmed, so a towing class
// never flees it as a threat before it can offer to help.
function stranded(playerPos: Vec, traderPos: Vec) {
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

describe('emergency beacon', () => {
  const player = { x: 30, y: 30 };
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

  it('a raider comes to a beaconing truck with cargo', () => {
    const w = emptyWorld(player);
    w.player.fuel = 0;
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 130, y: 30 });
    const r = runUntil(setBeacon(w, true), 60, (x) => dist(find(x, raider.id).pos, playerVehicle(x).pos) < 15);
    expect(dist(find(r.w, raider.id).pos, playerVehicle(r.w).pos)).toBeLessThan(15);
    expect(activitiesOf(r.events, raider.id)[0]).toMatchObject({ activity: 'investigate' });
  });
});
