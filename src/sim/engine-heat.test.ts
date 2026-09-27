import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { TIME } from '../data/time';
import { ENGINE_HEAT } from '../data/wear';
import { advanceEngineHeat } from './engine-heat';
import { mountedParts } from './grid';
import { vehicleStats } from './stats';
import { emptyWorld } from './testkit';

const NOON = 1 + (((TIME.sunrise + TIME.sunset) / 2 - TIME.startHour) * TIME.turnsPerDay) / 24;
const NIGHT = 1 + ((23 - TIME.startHour) * TIME.turnsPerDay) / 24;

function engine(w: ReturnType<typeof emptyWorld>) {
  return mountedParts(w.vehicles[0]).find((p) => partDef(p.defId).kind === 'engine')!;
}

describe('engine heat', () => {
  it('overheats after some turns of top speed in the noon sun, then damages the engine', () => {
    const w = emptyWorld();
    w.turn = NOON;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    const hp = engine(w).hp;
    let turns = 0;
    while (w.player.engineHeat < 1) {
      advanceEngineHeat(w);
      turns++;
      expect(turns).toBeLessThan(60);
    }
    expect(turns).toBeGreaterThan(30);
    expect(w.events.some((e) => e.t === 'info' && e.text.startsWith('Engine running hot'))).toBe(true);
    expect(engine(w).hp).toBe(hp - ENGINE_HEAT.overheatDamage);
    advanceEngineHeat(w);
    expect(engine(w).hp).toBe(hp - 2 * ENGINE_HEAT.overheatDamage);
  });

  it('never warms while driving at night', () => {
    const w = emptyWorld();
    w.turn = NIGHT;
    const me = w.vehicles[0];
    me.speed = vehicleStats(w, me).maxSpeed;
    w.player.engineHeat = 0.5;
    advanceEngineHeat(w);
    expect(w.player.engineHeat).toBeCloseTo(0.5 - ENGINE_HEAT.coolDriving);
  });

  it('cools faster parked in the shade than parked in the sun, and never hurts a parked engine', () => {
    const w = emptyWorld();
    w.turn = NOON;
    w.vehicles[0].speed = 0;
    w.player.engineHeat = 1;
    const hp = engine(w).hp;
    advanceEngineHeat(w);
    const sunCooled = 1 - w.player.engineHeat;
    w.turn = NIGHT; // heat 1, the same as shade
    w.player.engineHeat = 1;
    advanceEngineHeat(w);
    expect(1 - w.player.engineHeat).toBeCloseTo(ENGINE_HEAT.coolParked);
    expect(1 - w.player.engineHeat).toBeGreaterThan(sunCooled);
    expect(engine(w).hp).toBe(hp);
  });
});
