import { beforeAll, describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { addVehicle, emptyWorld } from '../sim/testkit';
import type { MoveOrder, World } from '../sim/types';
import { angleDiff, dist } from '../sim/vec';
import { endTurn, setMoveOrder } from '../sim/world';
import { PHYSICS } from '../data/physics';
import { buildDrive, freeDrive, initPhysics, simulateTurn, syncDrive, type Drive, type TurnResult } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

// Plays n turns through the real turn pipeline with physics movement.
function play(w: World, n: number): { w: World; d: Drive } {
  let d = buildDrive(w);
  for (let i = 0; i < n; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
  }
  return { w, d };
}

function ordered(order: MoveOrder, speed = 0, heading = 0): World {
  const w = emptyWorld();
  w.vehicles[0].speed = speed;
  w.vehicles[0].heading = heading;
  return setMoveOrder(w, order);
}

const me = (w: World) => w.vehicles[0];

describe('physics turns', () => {
  it('a new truck sits still on flat ground', () => {
    const { w } = play(emptyWorld(), 2);
    expect(dist(me(w).pos, { x: 30, y: 30 })).toBeLessThan(0.1);
    expect(me(w).speed).toBeLessThan(0.1);
  });

  it('a far click speeds up, a mid click holds speed', () => {
    const far = play(ordered({ kind: 'through', dest: { x: 45, y: 30 } }, 3), 1).w;
    expect(me(far).speed).toBeGreaterThan(3.5);
    const mid = play(ordered({ kind: 'through', dest: { x: 35, y: 30 } }, 3), 1).w;
    expect(Math.abs(me(mid).speed - 3)).toBeLessThan(0.5);
  });

  it('a stop order stops on the point', () => {
    const { w } = play(ordered({ kind: 'stopAt', dest: { x: 38, y: 31 } }), 8);
    expect(dist(me(w).pos, { x: 38, y: 31 })).toBeLessThan(RULES.arriveRadius + 0.3);
    expect(me(w).order).toBeNull();
  });

  it('a click behind backs up and turns the truck around', () => {
    const { w } = play(ordered({ kind: 'through', dest: { x: 21, y: 31 } }), 4);
    expect(Math.abs(angleDiff(me(w).heading, Math.PI))).toBeLessThan(Math.PI / 3);
  });

  it('a brake order stops the truck and clears', () => {
    const { w } = play(ordered({ kind: 'brake' }, 4), 3);
    expect(me(w).speed).toBeLessThan(0.1);
    expect(me(w).order).toBeNull();
  });

  it('a truck at top speed swerving hard stays upright and on the ground', () => {
    let w = ordered({ kind: 'through', dest: { x: 34, y: 40 } }, 6);
    let d = buildDrive(w);
    for (let i = 0; i < 4; i++) {
      let r: TurnResult | null = null;
      w = endTurn(w, physicsMove(d, (x) => (r = x)));
      for (const f of r!.frames[me(w).id]) {
        const q = f.rot;
        expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(Math.cos(Math.PI / 6)); // tilt under 30 degrees
        expect(f.wheels.some((wh) => wh.suspension < PHYSICS.truck.suspensionRest + PHYSICS.truck.suspensionTravel)).toBe(true);
      }
      freeDrive(d);
      d = r!.next;
      w = setMoveOrder(w, { kind: 'through', dest: i % 2 ? { x: me(w).pos.x + 4, y: me(w).pos.y + 10 } : { x: me(w).pos.x - 4, y: me(w).pos.y - 10 } });
    }
  });

  it('the same state and orders give the same turn', () => {
    const w = ordered({ kind: 'through', dest: { x: 38, y: 33 } }, 2, 0.3);
    const d = buildDrive(w);
    const a = simulateTurn(d, w);
    const b = simulateTurn(d, w);
    expect(a.frames[me(w).id].at(-1)).toEqual(b.frames[me(w).id].at(-1));
  });

  it('ramming a rock is a crash that damages the hull', () => {
    let w = emptyWorld();
    w.obstacles = [{ id: 'rock1', pos: { x: 36, y: 30 }, r: 0.8, kind: 'rock' }];
    w.vehicles[0].speed = 5;
    w = setMoveOrder(w, { kind: 'through', dest: { x: 45, y: 30 } });
    const hull = me(w).hull;
    let crashes = 0;
    let d = buildDrive(w);
    for (let i = 0; i < 3; i++) {
      let next: Drive | null = null;
      w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
      crashes += w.events.filter((e) => e.t === 'collision' && e.b === 'rock1').length;
      freeDrive(d);
      d = next!;
    }
    expect(crashes).toBeGreaterThan(0);
    expect(me(w).hull).toBeLessThan(hull);
  });

  it('new vehicles and obstacles join the physics world', () => {
    const w = emptyWorld();
    const d = buildDrive(w);
    addVehicle(w, 'raiders', 'buggy', [], { x: 40, y: 40 });
    w.obstacles.push({ id: 'wreck1', pos: { x: 20, y: 20 }, r: 0.6, kind: 'wreck' });
    syncDrive(d, w);
    expect(Object.keys(d.bodies)).toHaveLength(2);
    expect(d.obstacles.wreck1).toBeDefined();
    w.vehicles.pop();
    syncDrive(d, w);
    expect(Object.keys(d.bodies)).toHaveLength(1);
  });
});
