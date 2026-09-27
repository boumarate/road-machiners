import { describe, expect, it } from 'vitest';
import { mountedParts } from './grid';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';

describe('worn parts in vehicle stats', () => {
  it('a worn engine gives a lower top speed and acceleration', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 });
    const fresh = vehicleStats(w, v);
    mountedParts(v, 'engine')[0].wear = 2;
    const worn = vehicleStats(w, v);
    expect(worn.maxSpeed).toBeLessThan(fresh.maxSpeed);
    expect(worn.accel).toBeLessThan(fresh.accel);
  });

  it('a worn gun scatters more', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 40, y: 40 });
    const fresh = vehicleStats(w, v).weapons[0].def.spread;
    mountedParts(v, 'weapon')[0].wear = 2;
    expect(vehicleStats(w, v).weapons[0].def.spread).toBeGreaterThan(fresh);
  });
});
