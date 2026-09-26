import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { resolveMovement } from './movement';
import { addVehicle, emptyWorld } from './testkit';
import { dist } from './vec';
import { endTurn, newWorld, setMoveOrder } from './world';

describe('movement', () => {
  it('substeps are shorter than the smallest collision radius', () => {
    const fastest = Math.max(...Object.values(CHASSIS).map((c) => c.maxSpeed + 1));
    const smallest = Math.min(REGION.obstacles.radius[0], ...Object.values(CHASSIS).map((c) => c.radius));
    expect(fastest / RULES.substeps).toBeLessThan(smallest);
  });

  it('stops on an obstacle and takes damage', () => {
    const w = emptyWorld();
    const v = w.vehicles[0];
    v.speed = 5;
    v.order = { kind: 'through', dest: { x: 40, y: 30 } };
    w.obstacles = [{ id: 'r', pos: { x: 33, y: 30 }, r: 1, kind: 'rock' }];
    const hull = v.hull;
    resolveMovement(w);
    expect(v.speed).toBe(0);
    expect(v.hull).toBeLessThan(hull);
    expect(dist(v.pos, { x: 33, y: 30 })).toBeGreaterThanOrEqual(1 + 0.6);
    expect(w.events.some((e) => e.t === 'collision')).toBe(true);
  });

  it('rams another vehicle: the lighter one takes more damage', () => {
    const w = emptyWorld();
    const p = w.vehicles[0];
    const hauler = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 26, y: 30 });
    hauler.speed = 4;
    hauler.order = { kind: 'through', dest: { x: 40, y: 30 } };
    hauler.direct = true;
    const before = { p: p.hull, h: hauler.hull };
    resolveMovement(w);
    expect(before.p - p.hull).toBeGreaterThan(before.h - hauler.hull);
    expect(dist(p.pos, hauler.pos)).toBeGreaterThanOrEqual(0.6 + 0.8 - 0.01);
  });

  it('cannot move without fuel', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    w.vehicles[0].order = { kind: 'through', dest: { x: 40, y: 30 } };
    resolveMovement(w);
    expect(w.vehicles[0].pos).toEqual({ x: 30, y: 30 });
  });

  it('burns fuel per tile driven', () => {
    const w = emptyWorld();
    w.vehicles[0].order = { kind: 'through', dest: { x: 40, y: 30 } };
    const fuel = w.player.fuel;
    resolveMovement(w);
    expect(w.player.fuel).toBeCloseTo(fuel - 2 * CHASSIS.scout.fuelPerTile, 5);
  });
});

describe('world', () => {
  it('is deterministic for the same seed and orders', () => {
    const run = () => {
      let w = setMoveOrder(newWorld(7), { kind: 'through', dest: { x: 40, y: 20 } });
      for (let i = 0; i < 10; i++) w = endTurn(w);
      return w;
    };
    expect(run()).toEqual(run());
  });

  it('keeps the player out of obstacles on a long drive', () => {
    let w = setMoveOrder(newWorld(3), { kind: 'stopAt', dest: { x: 50, y: 50 } });
    for (let i = 0; i < 30; i++) {
      w = endTurn(w);
      const v = w.vehicles[0];
      for (const o of w.obstacles) expect(dist(v.pos, o.pos)).toBeGreaterThanOrEqual(o.r + 0.6 - 0.01);
    }
  });
});
