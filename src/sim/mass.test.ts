import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { GOODS } from '../data/goods';
import { PARTS } from '../data/parts';
import { makePart } from './factory';
import { addGoods, stowPart } from './inventory';
import { loadFactor, vehicleMass } from './mass';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';

const coreMass = (id: string) => CHASSIS[id].core.reduce((a, c) => a + PARTS[c.defId].mass, 0);

describe('vehicle mass', () => {
  it('a bare chassis weighs its frame plus its built-in parts', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', [], { x: 40, y: 40 });
    expect(vehicleMass(v)).toBe(CHASSIS.hauler.mass + coreMass('hauler'));
  });

  it('sums mounted parts, spare parts and goods', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['mg', 'stockEngine'], { x: 40, y: 40 });
    expect(vehicleMass(v)).toBe(CHASSIS.hauler.mass + coreMass('hauler') + PARTS.mg.mass + PARTS.stockEngine.mass);
    expect(stowPart(w, v, makePart(w, 'plates', 0))).toBe(true);
    expect(addGoods(w, v, 'scrap', 3)).toBe(3);
    expect(vehicleMass(v)).toBe(CHASSIS.hauler.mass + coreMass('hauler') + PARTS.mg.mass + PARTS.stockEngine.mass + PARTS.plates.mass + 3 * GOODS.scrap.mass);
  });

  it('load factor is 1 up to the rated mass, then sqrt(rated / mass)', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine', 'trailerBox'], { x: 40, y: 40 });
    expect(vehicleMass(v)).toBeLessThan(CHASSIS.hauler.ratedMass);
    expect(loadFactor(v)).toBe(1);
    addGoods(w, v, 'scrap', 999);
    const m = vehicleMass(v);
    expect(m).toBeGreaterThan(CHASSIS.hauler.ratedMass);
    expect(loadFactor(v)).toBeCloseTo(Math.sqrt(CHASSIS.hauler.ratedMass / m), 10);
  });

  it('every chassis, part and good states a positive mass', () => {
    for (const c of Object.values(CHASSIS)) {
      expect(c.mass).toBeGreaterThan(0);
      expect(c.ratedMass).toBeGreaterThan(c.mass);
    }
    for (const p of Object.values(PARTS)) expect(p.mass).toBeGreaterThan(0);
    for (const g of Object.values(GOODS)) expect(g.mass).toBeGreaterThan(0);
  });
});

describe('load in stats', () => {
  it('a heavy load lowers top speed, turning, acceleration and braking', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine', 'trailerBox'], { x: 40, y: 40 });
    const light = vehicleStats(w, v);
    addGoods(w, v, 'scrap', 999);
    const heavy = vehicleStats(w, v);
    expect(heavy.maxSpeed).toBeLessThan(light.maxSpeed);
    expect(heavy.turnSlow).toBeLessThan(light.turnSlow);
    expect(heavy.turnFast).toBeLessThan(light.turnFast);
    expect(heavy.reverseTurn).toBeLessThan(light.reverseTurn);
    expect(heavy.accel).toBeLessThan(light.accel);
    expect(heavy.brake).toBeLessThan(light.brake);
  });

  it('stats mass is the vehicle mass in kg', () => {
    const w = emptyWorld();
    const v = w.vehicles[0];
    expect(vehicleStats(w, v).mass).toBe(vehicleMass(v));
  });

  it('acceleration scales by rated mass over mass', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    const a = vehicleStats(w, v).accel * vehicleMass(v);
    addGoods(w, v, 'scrap', 10);
    expect(vehicleStats(w, v).accel * vehicleMass(v)).toBeCloseTo(a, 6);
  });
});
