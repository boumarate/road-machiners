import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { checkKnockout } from './defeat';
import { soundRange } from './detect';
import { advanceFar, isNear } from './far';
import { corePart, mountedParts } from './grid';
import { isStranded, vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';
import type { Vehicle, World } from './types';
import { dist } from './vec';
import { weatherAt } from './weather';
import { endTurn, setMoveOrder } from './world';

function removeEngines(v: Vehicle): void {
  v.items = v.items.filter((it) => it.kind !== 'part' || partDef(it.part.defId).kind !== 'engine');
}

function engineless(): World {
  const w = emptyWorld();
  removeEngines(w.vehicles[0]);
  expect(mountedParts(w.vehicles[0], 'engine')).toHaveLength(0);
  return w;
}

describe('pushing a truck without a working engine', () => {
  it('gives limp speed, limp accel and no fuel use without an engine', () => {
    const w = engineless();
    const s = vehicleStats(w, w.vehicles[0]);
    expect(s.maxSpeed).toBe(RULES.limpSpeed * weatherAt(w, w.vehicles[0].pos).speed);
    expect(s.accel).toBe(RULES.limpSpeed);
    expect(s.fuelPerTile).toBe(0);
  });

  it('gives the same numbers with a broken engine', () => {
    const w = emptyWorld();
    mountedParts(w.vehicles[0], 'engine')[0].hp = 0;
    const s = vehicleStats(w, w.vehicles[0]);
    expect(s.maxSpeed).toBe(RULES.limpSpeed * weatherAt(w, w.vehicles[0].pos).speed);
    expect(s.accel).toBe(RULES.limpSpeed);
    expect(s.fuelPerTile).toBe(0);
  });

  it('keeps fuel use with a working engine and a broken transmission', () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], 'transmission').hp = 0;
    const s = vehicleStats(w, w.vehicles[0]);
    expect(s.maxSpeed).toBeLessThanOrEqual(RULES.limpSpeed);
    expect(s.fuelPerTile).toBeGreaterThan(0);
  });

  it('pushes toward the click at limp speed, burns no fuel and makes no sound', () => {
    let w = setMoveOrder(engineless(), { kind: 'stopAt', dest: { x: 40, y: 30 } });
    const fuel = w.player.fuel;
    for (let i = 0; i < 3; i++) {
      const before = w.vehicles[0].pos.x;
      w = endTurn(w);
      const v = w.vehicles[0];
      expect(v.pos.x).toBeGreaterThan(before);
      expect(v.speed).toBeGreaterThan(RULES.parkedSpeed);
      expect(v.speed).toBeLessThanOrEqual(RULES.limpSpeed);
      expect(soundRange(w, v)).toBe(0);
    }
    expect(w.vehicles[0].pos.x).toBeGreaterThan(30 + RULES.limpSpeed);
    expect(w.player.fuel).toBe(fuel);
  });

  it('pushes at full limp speed on a low tank', () => {
    const w = engineless();
    w.player.fuel = 0.5;
    const s = vehicleStats(w, w.vehicles[0]);
    let next = setMoveOrder(w, { kind: 'stopAt', dest: { x: 40, y: 30 } });
    next = endTurn(next);
    next = endTurn(next);
    expect(next.vehicles[0].speed).toBeCloseTo(s.maxSpeed);
    expect(next.player.fuel).toBe(0.5);
  });

  it('pushes a far NPC along its route at limp speed without fuel', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 30, y: 150 });
    removeEngines(v);
    v.order = { kind: 'stopAt', dest: { x: 45, y: 150 } };
    expect(isNear(w, v)).toBe(false);
    const fuel = v.resources!.fuel;
    for (let i = 0; i < 3; i++) advanceFar(w, v);
    expect(v.pos.x).toBeGreaterThan(30 + RULES.limpSpeed);
    expect(v.speed).toBeCloseTo(vehicleStats(w, v).maxSpeed);
    expect(v.resources!.fuel).toBe(fuel);
  });

  it('an engine at 0 HP is silent while moving', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = RULES.limpSpeed;
    expect(soundRange(w, v)).toBeGreaterThan(0);
    mountedParts(v, 'engine')[0].hp = 0;
    expect(soundRange(w, v)).toBe(0);
  });

  it('a knocked-out player wakes and pushes the stripped truck toward a point', () => {
    let w = emptyWorld();
    corePart(w.vehicles[0], 'cab').hp = 0;
    checkKnockout(w);
    w = endTurn(w);
    expect(w.player.state).toBe('active');
    expect(mountedParts(w.vehicles[0], 'engine')).toHaveLength(0);
    const dest = { x: 40, y: 30 };
    const start = dist(w.vehicles[0].pos, dest);
    w = setMoveOrder(w, { kind: 'stopAt', dest });
    for (let i = 0; i < 3; i++) w = endTurn(w);
    expect(dist(w.vehicles[0].pos, dest)).toBeLessThan(start - RULES.limpSpeed);
  });
});

describe('isStranded', () => {
  it('is false for a healthy truck with fuel', () => {
    const w = emptyWorld();
    expect(w.player.fuel).toBeGreaterThan(0);
    expect(isStranded(w, w.vehicles[0])).toBe(false);
  });

  it('is true without an engine', () => {
    const w = engineless();
    expect(isStranded(w, w.vehicles[0])).toBe(true);
  });

  it('is true with a broken engine', () => {
    const w = emptyWorld();
    mountedParts(w.vehicles[0], 'engine')[0].hp = 0;
    expect(isStranded(w, w.vehicles[0])).toBe(true);
  });

  it('is true with a broken transmission', () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], 'transmission').hp = 0;
    expect(isStranded(w, w.vehicles[0])).toBe(true);
  });

  it('is true with an empty tank', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    expect(isStranded(w, w.vehicles[0])).toBe(true);
  });

  it('reads NPC fuel from the NPC', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 40, y: 30 });
    expect(isStranded(w, v)).toBe(false);
    v.resources!.fuel = 0;
    expect(isStranded(w, v)).toBe(true);
  });
});
