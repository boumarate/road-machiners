import { describe, expect, it, onTestFinished } from 'vitest';
import { XP_RULES, XP_SOURCES, XP_TO_REACH } from '../../data/skills';
import { clockOf } from '../sun';
import type { TraceLine } from './record';
import { parseRunEnd, replay } from './replay';

// Sets search XP to one per amount and the daily cap to 100, with half pay past it, until the test ends.
function simpleSearchXp(): void {
  const rules = { ...XP_RULES };
  const search = { ...XP_SOURCES.search };
  Object.assign(XP_RULES, { dailyCap: 100, overCap: 0.5 });
  Object.assign(XP_SOURCES.search, { weight: 1 });
  onTestFinished(() => {
    Object.assign(XP_RULES, rules);
    Object.assign(XP_SOURCES.search, search);
  });
}

const search = (turn: number, amount: number): TraceLine => ({ turn, source: 'search', amount, difficulty: null });

describe('replay', () => {
  it('reaches each level on the turn its running XP crosses the level cost, with the daily cap per day', () => {
    simpleSearchXp();
    const dayTwo = 150;
    expect(clockOf(40).day).toBe(1);
    expect(clockOf(dayTwo).day).toBe(2);
    const trace = [
      search(10, 100), // 100: the cap is used up
      search(40, 400), // half pay past the cap: 300
      search(dayTwo, 50), // a new day pays in full: 350
      search(dayTwo + 10, 150), // 50 in full and 100 at half pay: 450
    ];
    const totals = [100, 300, 350, 450];
    const turns = [10, 40, dayTwo, dayTwo + 10];
    const firstTurn = (level: number) => turns[totals.findIndex((xp) => xp >= XP_TO_REACH[level])] ?? null;

    const curve = replay(trace, 400);

    expect(curve.machining.total).toBe(450);
    expect(curve.machining.levels).toEqual([1, 2, 3, 4, 5].map(firstTurn));
    expect(curve.machining.perDay).toBe(225);
    expect(curve.driving).toEqual({ levels: [null, null, null, null, null], total: 0, perDay: 0 });
  });

  it('scales a scaled source by its difficulty', () => {
    const curve = replay([{ turn: 5, source: 'hit', amount: 1, difficulty: 1 }], 200);

    expect(curve.perception.total).toBe(Math.min(XP_SOURCES.hit.weight * XP_RULES.hard, XP_RULES.dailyCap));
  });

  it('rejects a trace out of turn order', () => {
    expect(() => replay([search(20, 1), search(10, 1)], 200)).toThrow(/turn order/);
  });

  it('rejects a trace line past the recorded turns', () => {
    expect(() => replay([search(202, 1)], 200)).toThrow(/past the end/);
  });

  it('counts XP per day up to the death turn it is given', () => {
    const curve = replay([search(10, 1)], 100);

    expect(curve.machining.perDay).toBe(curve.machining.total * 2);
  });
});

describe('parseRunEnd', () => {
  it('reads a death marker and passes over trace lines', () => {
    expect(parseRunEnd({ end: 'death', turn: 57 })).toEqual({ end: 'death', turn: 57 });
    expect(parseRunEnd(search(10, 1))).toBeNull();
  });

  it('rejects a malformed marker', () => {
    expect(() => parseRunEnd({ end: 'stall', turn: 57 })).toThrow(/Bad run end/);
  });
});
