import { describe, expect, it } from 'vitest';
import { PERF } from '../data/perf';
import { TERRAIN } from '../data/terrain';
import { planNpcOrders, routeBlockers, trafficStops } from './ai';
import { topGoal } from './npc-activities';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { Vehicle, World } from './types';

describe('NPC driving', () => {
  it('uses the obstacle-aware driver on every turn', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    planNpcOrders(w);
    expect(npc.direct).toBe(false);
  });

  it('a parked truck ahead whose loot is gone before it thinks gives no face off', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const first = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 100, y: 100 });
    first.brain = npcBrain('trader', first.pos, ['trader']);
    first.heading = 0;
    const second = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 103, y: 100 });
    second.brain = npcBrain('trader', second.pos, ['trader']);
    second.heading = Math.PI;
    second.brain.goals.push({ kind: 'loot', targetId: 'cargo-gone', destination: { x: 130, y: 100 }, phase: 'travel', reason: 'take the handed-over cargo' });
    expect(first.id < second.id).toBe(true);
    planNpcOrders(w);
    expect(topGoal(second)?.kind).not.toBe('loot');
  });
});

// The NPC drives east from (100, 100) toward (130, 100). The player truck is placed with a heading and a speed.
function scene(x: number, y: number, heading: number, speed: number): { w: World; npc: Vehicle } {
  const w = emptyWorld({ x, y });
  const me = w.vehicles[0];
  me.heading = heading;
  me.speed = speed;
  const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 100, y: 100 });
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  npc.heading = 0;
  npc.speed = 4;
  return { w, npc };
}

const DEST = { x: 130, y: 100 };

// Rocks lining both sides of the NPC's way, from x 90 to 140, leave a lane just wide enough for one truck.
function corridor(w: World): void {
  for (let x = 90; x <= 140; x++) {
    w.obstacles.push({ id: `n${x}`, kind: 'rock', pos: { x, y: 97 }, r: 1 });
    w.obstacles.push({ id: `s${x}`, kind: 'rock', pos: { x, y: 103 }, r: 1 });
  }
}

describe('NPC traffic', () => {
  it.each([
    ['oncoming in its lane', 118, 100, Math.PI, 7, true],
    ['crossing into its path', 108, 94, Math.PI / 2, 4, true],
    ['oncoming 4 tiles to the side', 118, 104, Math.PI, 7, false],
    ['crossing ahead and driving off to the side', 110, 104, Math.PI / 2, 7, false],
    ['ahead in the next lane, slower', 106, 103, 0, 2, false],
  ])('routes around a moving truck only when their paths meet: %s', (_name, x, y, heading, speed, avoids) => {
    const { w, npc } = scene(x, y, heading, speed);
    expect(routeBlockers(w, npc).length > 0).toBe(avoids);
  });

  it.each([
    ['oncoming in its lane', 118, 100, Math.PI, 7],
    ['crossing into its path', 108, 94, Math.PI / 2, 4],
  ])('keeps driving on open ground: %s', (_name, x, y, heading, speed) => {
    const { w, npc } = scene(x, y, heading, speed);
    expect(trafficStops(w, npc, DEST)).toBe(false);
  });

  it('stops when an oncoming truck fills its only lane', () => {
    const { w, npc } = scene(112, 100, Math.PI, 5);
    corridor(w);
    expect(trafficStops(w, npc, DEST)).toBe(true);
  });

  it('stops behind a slower truck in its only lane', () => {
    const { w, npc } = scene(106, 100, 0, 2);
    corridor(w);
    expect(trafficStops(w, npc, DEST)).toBe(true);
  });

  it('overtakes a slower truck ahead on open ground', () => {
    const { w, npc } = scene(106, 100, 0, 2);
    expect(routeBlockers(w, npc).length).toBeGreaterThan(0);
    expect(trafficStops(w, npc, DEST)).toBe(false);
  });

  it('a far driver does not stop for a moving truck, since far travel stops short of any truck in its way', () => {
    const oncoming = (playerAt: { x: number; y: number }) => {
      const { w, npc } = scene(playerAt.x, playerAt.y, 0, 0);
      corridor(w);
      const other = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 112, y: 100 }, Math.PI);
      other.brain = npcBrain('trader', other.pos, ['trader']);
      other.speed = 5;
      return trafficStops(w, npc, DEST);
    };
    expect(oncoming({ x: 100, y: 110 })).toBe(true);
    expect(oncoming({ x: 100, y: 100 + TERRAIN.vision.radius + PERF.liveMargin + 10 })).toBe(false);
  });

  it('the player routes around parked vehicles only', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    const me = w.vehicles[0];
    me.speed = 4;
    const npc = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 118, y: 100 }, Math.PI);
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    npc.speed = 7;
    expect(routeBlockers(w, me)).toEqual([]);
  });
});
