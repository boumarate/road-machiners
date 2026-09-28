import { beforeAll, describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { initPhysics } from '../phys/drive';
import { runFight, setNumber, type Fight } from './combat-harness';

beforeAll(async () => {
  await initPhysics();
});

const FIGHT: Fight = { kit: 'standard', enemies: ['buggy'], policy: 'stand', seed: 3, gap: 8, orbit: 6, maxTurns: 4 };

describe('combat harness', () => {
  it('gives the same report for the same fight', () => {
    expect(runFight(FIGHT)).toEqual(runFight(FIGHT));
  });

  it('counts the rounds both sides fire', () => {
    const r = runFight(FIGHT);
    expect(r.me.rounds).toBeGreaterThan(0);
    expect(r.them.rounds).toBeGreaterThan(0);
    expect(r.me.hits).toBeLessThanOrEqual(r.me.rounds);
  });

  it('a standing player never moves', () => {
    expect(runFight(FIGHT).speed).toBe(0);
  });

  it('sets an existing balance number', () => {
    const old = RULES.leadError;
    setNumber(`RULES.leadError=${old + 1}`);
    expect(RULES.leadError).toBe(old + 1);
    setNumber(`RULES.leadError=${old}`);
  });

  it('refuses a path that names no number', () => {
    expect(() => setNumber('RULES.noSuchRule=1')).toThrow('not a number');
    expect(() => setNumber('NOPE.x=1')).toThrow('Unknown table');
    expect(() => setNumber('RULES.leadError=abc')).toThrow('path=number');
  });
});
