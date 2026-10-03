import { describe, expect, it } from 'vitest';
import { emptyLedger } from './orders';
import { fightTotals, ledgerTotals, tierDays, wageByTier, type DayRow } from './record';

const row = (day: number, netWorth: number, tier: DayRow['tier'], extra: Partial<DayRow> = {}): DayRow => ({
  day, turns: day === 0 ? 0 : 450, money: 0, netWorth, tier, chassis: 'scout', fightsWon: 0, knockouts: 0, gearLost: 0, deaths: 0, ledger: emptyLedger(), ...extra,
});

describe('wageByTier', () => {
  it('splits net worth gains by the tier held at the start of each period', () => {
    const rows = [row(0, 1000, 1), row(1, 1450, 1), row(2, 1900, 2), row(3, 3250, 2)];

    const wage = wageByTier(rows);

    expect(wage[1]).toBeCloseTo((450 + 450) / 900);
    expect(wage[2]).toBeCloseTo(1350 / 450);
  });

  it('has no wage for a tier the run never held', () => {
    expect(wageByTier([row(0, 1000, 1), row(1, 1450, 1)])[3]).toBeNull();
  });

  it('weights a partial last period by its turns', () => {
    const rows = [row(0, 0, 1), row(1, 450, 1), row(2, 480, 1, { turns: 30 })];

    expect(wageByTier(rows)[1]).toBeCloseTo(480 / 480);
  });
});

describe('tierDays', () => {
  it('names the first day each tier is held', () => {
    const rows = [row(0, 0, 1), row(1, 0, 1), row(2, 0, 2), row(3, 0, 2)];

    expect(tierDays(rows)).toEqual({ 1: 0, 2: 2, 3: null });
  });
});

describe('fightTotals', () => {
  it('sums the counts over every row', () => {
    const rows = [row(1, 0, 1, { fightsWon: 2, knockouts: 1 }), row(2, 0, 1, { fightsWon: 1, gearLost: 3, deaths: 1 })];

    expect(fightTotals(rows)).toEqual({ fightsWon: 3, knockouts: 1, gearLost: 3, deaths: 1 });
  });
});

describe('ledgerTotals', () => {
  it('adds each key over the rows', () => {
    const spent = (fuel: number, goodsSold: number) => ({ ...emptyLedger(), fuel, goodsSold });
    const rows = [row(1, 0, 1, { ledger: spent(-30, 100) }), row(2, 0, 1, { ledger: spent(-20, 50) })];

    expect(ledgerTotals(rows)).toMatchObject({ fuel: -50, goodsSold: 150, repairs: 0 });
  });
});
