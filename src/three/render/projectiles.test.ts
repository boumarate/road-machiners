import { describe, expect, it } from 'vitest';
import { PARTS } from '../../data/parts';
import { planVolley, projectileOf, type RoundAim } from './projectiles';

const A = { x: 0, y: 2, z: 0 };
const B = { x: 40, y: 2, z: 0 };
const round = (struck: boolean, offset: number): RoundAim => ({ b: B, struck, offset });
const WINDOW = 320;

describe('planVolley', () => {
  it('ends hits on the target and sends misses past it to the ground', () => {
    const [hit, miss] = planVolley(projectileOf('mg'), A, [round(true, 0.3), round(false, 3)], WINDOW, () => -1);
    expect(hit.struck).toBe(true);
    expect(hit.land.x).toBeCloseTo(40);
    expect(hit.land.z).toBeCloseTo(0.3);
    expect(miss.struck).toBe(false);
    expect(miss.land.x).toBeGreaterThan(40);
    expect(miss.land.y).toBe(-1);
  });

  it('lands every round within the shot window', () => {
    for (const key of ['mg', 'shotgun', 'cannon', 'rocketRack']) {
      const rounds = Array.from({ length: 6 }, (_, k) => round(k % 2 === 0, k - 3));
      for (const p of planVolley(projectileOf(key), A, rounds, WINDOW, () => 0)) {
        expect(p.flightMs).toBeGreaterThan(0);
        expect(p.delayMs + p.flightMs).toBeLessThanOrEqual(WINDOW);
      }
    }
  });

  it('flies a cannon shell slower than a machine gun round', () => {
    const [mg] = planVolley(projectileOf('mg'), A, [round(true, 0)], WINDOW, () => 0);
    const [shell] = planVolley(projectileOf('cannon'), A, [round(true, 0)], WINDOW, () => 0);
    expect(shell.flightMs).toBeGreaterThan(mg.flightMs);
  });

  it('has a projectile look for every weapon', () => {
    for (const def of Object.values(PARTS)) if (def.kind === 'weapon') expect(() => projectileOf(def.id)).not.toThrow();
  });

  it('fails loud for a weapon with no projectile look', () => {
    expect(() => projectileOf('laser')).toThrow(/No projectile look/);
  });
});
