import { describe, expect, it } from 'vitest';
import { exploratoryRatio, runMany, runPolicy, type PolicyName } from './harness';

const POLICIES: PolicyName[] = ['idle', 'haulOnly', 'salvageOnly', 'contractsOnly', 'greedy'];

describe('runPolicy', () => {
  it('gives the same report for the same seed and policy (IV6: world RNG only)', () => {
    const a = runPolicy(3, 'greedy', 1);
    const b = runPolicy(3, 'greedy', 1);
    expect(a).toEqual(b);
  });

  it('gives a different report for a different seed', () => {
    const a = runPolicy(3, 'greedy', 1);
    const b = runPolicy(4, 'greedy', 1);
    expect(a).not.toEqual(b);
  });

  for (const policy of POLICIES) {
    it(`${policy} never lets money go negative without a recorded debt event`, () => {
      const r = runPolicy(1, policy, 1);
      const wentNegative = r.perDay.some((d) => d.money < 0);
      expect(!wentNegative || r.telemetry.debtEvents > 0).toBe(true);
    });
  }

  it('haulOnly trades goods over a day', () => {
    const r = runPolicy(1, 'haulOnly', 1);
    expect(r.telemetry.trades).toBeGreaterThan(0);
  });

  it('salvageOnly searches and sells over a day', () => {
    const r = runPolicy(1, 'salvageOnly', 1);
    expect(r.telemetry.trades).toBeGreaterThan(0);
  });

  it('contractsOnly accepts at least one contract over a few days', () => {
    const r = runPolicy(1, 'contractsOnly', 3);
    expect(r.telemetry.contractsAccepted).toBeGreaterThan(0);
  });

  it('greedy performs a core action (trading, contracting or fighting) over a day', () => {
    const r = runPolicy(1, 'greedy', 1);
    const acted = r.telemetry.trades + r.telemetry.contractsAccepted + r.telemetry.fights;
    expect(acted).toBeGreaterThan(0);
  });

  it('reports one day per requested day, in order', () => {
    const r = runPolicy(1, 'haulOnly', 3);
    expect(r.perDay.map((d) => d.day)).toEqual([1, 2, 3]);
  });

  it('greedy buys at least one upgrade within a few days on seed 1', () => {
    const r = runPolicy(1, 'greedy', 3);
    expect(r.telemetry.upgradesBought).toBeGreaterThan(0);
  });

  it('idle never trades, fights or accepts a contract', () => {
    const r = runPolicy(1, 'idle', 1);
    expect(r.telemetry.trades + r.telemetry.fights + r.telemetry.contractsAccepted).toBe(0);
  });

  it('computes an exploratory_ratio from greedy and monotonous runs', () => {
    const reports = runMany([1, 2, 3], ['idle', 'haulOnly', 'greedy'], 1);
    expect(exploratoryRatio(reports)).not.toBeNull();
  });
});
