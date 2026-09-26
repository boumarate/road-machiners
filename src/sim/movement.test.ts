import { START_KITS } from '../data/start';
import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { REGION } from '../data/region';
import { PARTS } from '../data/parts';
import { RULES } from '../data/rules';
import { resolveMovement } from './movement';
import { heatAt } from './sun';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, partHp } from './testkit';
import { dist } from './vec';
import { endTurn, newWorld, setMoveOrder } from './world';

describe('movement', () => {
  it('substeps are shorter than the smallest collision radius', () => {
    const engineBonus = Math.max(...Object.values(PARTS).flatMap((p) => p.kind === 'engine' ? [p.speedBonus] : []));
    const fastest = Math.max(...Object.values(CHASSIS).map((c) => c.maxSpeed + engineBonus));
    const smallest = Math.min(REGION.obstacles.radius[0], ...Object.values(CHASSIS).map((c) => c.radius));
    expect(fastest / RULES.substeps).toBeLessThan(smallest);
  });

  it('stops on an obstacle and takes damage', () => {
    const w = emptyWorld();
    const v = w.vehicles[0];
    v.speed = 5;
    v.direct = true; // drive straight at the rock instead of routing around it
    v.order = { kind: 'through', dest: { x: 40, y: 30 } };
    w.obstacles = [{ id: 'r', pos: { x: 33, y: 30 }, r: 1, kind: 'rock' }];
    const hp = partHp(v);
    resolveMovement(w);
    expect(v.speed).toBe(0);
    expect(partHp(v)).toBeLessThan(hp);
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
    const before = { p: partHp(p), h: partHp(hauler) };
    resolveMovement(w);
    expect(before.p - partHp(p)).toBeGreaterThan(before.h - partHp(hauler));
    expect(dist(p.pos, hauler.pos)).toBeGreaterThanOrEqual(0.6 + 0.8 - 0.01);
  });

  it('crawls without fuel, including after stopping', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    w.vehicles[0].order = { kind: 'stopAt', dest: { x: 40, y: 30 } };
    resolveMovement(w);
    expect(w.vehicles[0].pos.x).toBeGreaterThan(30);
    expect(w.vehicles[0].pos.x).toBeLessThanOrEqual(30 + RULES.crawlSpeed);
    expect(w.player.fuel).toBe(0);
  });

  it('never burns more fuel than available on a short tank', () => {
    const w = emptyWorld();
    w.player.fuel = 0.01;
    w.vehicles[0].order = { kind: 'through', dest: { x: 40, y: 30 } };
    resolveMovement(w);
    expect(w.player.fuel).toBe(0);
    expect(w.vehicles[0].pos.x).toBeGreaterThan(30);
  });

  it('limits speed below 20% fuel but keeps driving', () => {
    const full = emptyWorld();
    const low = emptyWorld();
    const edge = emptyWorld();
    low.player.fuel = CHASSIS.scout.fuelCap * 0.19;
    edge.player.fuel = CHASSIS.scout.fuelCap * 0.2;
    for (const w of [full, low]) {
      w.vehicles[0].order = { kind: 'stopAt', dest: { x: 55, y: 30 } };
      for (let i = 0; i < 4; i++) resolveMovement(w);
    }
    expect(low.vehicles[0].speed).toBeLessThanOrEqual(vehicleStats(low, low.vehicles[0]).maxSpeed / 2);
    expect(full.vehicles[0].speed).toBeGreaterThan(low.vehicles[0].speed);
    expect(low.player.fuel).toBeGreaterThan(0);
    edge.vehicles[0].speed = 4;
    edge.vehicles[0].order = { kind: 'stopAt', dest: { x: 55, y: 30 } };
    resolveMovement(edge);
    expect(edge.vehicles[0].speed).toBeGreaterThan(vehicleStats(edge, edge.vehicles[0]).maxSpeed / 2);
  });

  it('burns fuel per tile driven', () => {
    const w = emptyWorld();
    w.vehicles[0].order = { kind: 'through', dest: { x: 40, y: 30 } };
    const fuel = w.player.fuel;
    const s = vehicleStats(w, w.vehicles[0]); // from rest, one turn covers accel tiles
    const heat = heatAt(w, w.vehicles[0].pos);
    resolveMovement(w);
    expect(w.player.fuel).toBeCloseTo(fuel - s.accel * s.fuelPerTile * heat, 5);
  });
});

describe('world', () => {
  it('starts the player with 1500 money', () => {
    expect(newWorld(1, START_KITS.standard).player.money).toBe(1500);
  });

  it('is deterministic for the same seed and orders', () => {
    const run = () => {
      let w = setMoveOrder(newWorld(7, START_KITS.standard), { kind: 'through', dest: { x: 40, y: 20 } });
      for (let i = 0; i < 10; i++) w = endTurn(w);
      return w;
    };
    expect(run()).toEqual(run());
  }, 10_000); // two 120-tile worlds run side by side; about 3 seconds alone

  it('keeps the player out of obstacles on a long drive', () => {
    let w = setMoveOrder(newWorld(3, START_KITS.standard), { kind: 'stopAt', dest: { x: 50, y: 50 } });
    for (let i = 0; i < 30; i++) {
      w = endTurn(w);
      const v = w.vehicles[0];
      for (const o of w.obstacles) expect(dist(v.pos, o.pos)).toBeGreaterThanOrEqual(o.r + 0.6 - 0.01);
    }
  }, 10_000); // 30 turns of route planning on the 120-tile map take about 3 seconds alone.
});
