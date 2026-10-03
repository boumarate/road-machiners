import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendLedger, appendUsage, readLedger, takeUsage, usageFromOutput, type LedgerLine } from './ledger';

const HOME = resolve('tmp/factory-ledger-test');

const RESULT = JSON.stringify({ type: 'result', duration_ms: 90_000, total_cost_usd: 1.25, modelUsage: { 'claude-opus-5-5': {} } });

beforeEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
});

describe('usageFromOutput', () => {
  it('reads cost and minutes from the last result event', () => {
    const out = `${JSON.stringify({ type: 'assistant' })}\n${RESULT}\n`;
    expect(usageFromOutput(out, 'opus')).toEqual({ model: 'opus', costUsd: 1.25, minutes: 1.5 });
  });

  it('throws when the output has no result event', () => {
    expect(() => usageFromOutput(`${JSON.stringify({ type: 'assistant' })}\n`, 'opus')).toThrow(/no result event/);
  });

  it('throws when the result event lacks its cost', () => {
    expect(() => usageFromOutput(JSON.stringify({ type: 'result', duration_ms: 5 }), 'opus')).toThrow(/total_cost_usd/);
  });
});

describe('usage files', () => {
  it('collects the runs of one job and removes the file', () => {
    appendUsage(HOME, 'job-1', { model: 'opus', costUsd: 1, minutes: 2 });
    appendUsage(HOME, 'job-1', { model: 'sonnet', costUsd: 0.5, minutes: 3 });
    appendUsage(HOME, 'job-2', { model: 'sonnet', costUsd: 9, minutes: 9 });
    expect(takeUsage(HOME, 'job-1')).toEqual([{ model: 'opus', costUsd: 1, minutes: 2 }, { model: 'sonnet', costUsd: 0.5, minutes: 3 }]);
    expect(existsSync(`${HOME}/usage/job-1.jsonl`)).toBe(false);
    expect(takeUsage(HOME, 'job-1')).toEqual([]);
    expect(takeUsage(HOME, 'job-2')).toHaveLength(1);
  });
});

describe('ledger', () => {
  it('reads back the lines that ended since a time', () => {
    const old: LedgerLine = { kind: 'job', id: 'a', stage: 'design', issue: 1, startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T01:00:00Z', outcome: 'done', agents: [] };
    const recent: LedgerLine = { kind: 'route', issue: 1, route: 'patch', by: 'Ann', at: '2026-10-05T00:00:00Z' };
    appendLedger(HOME, old);
    appendLedger(HOME, recent);
    expect(readLedger(HOME, new Date('2026-10-02T00:00:00Z'))).toEqual([recent]);
    expect(readLedger(HOME, new Date('2026-09-01T00:00:00Z'))).toEqual([old, recent]);
  });

  it('reads an empty ledger when the file is missing', () => {
    expect(readLedger(HOME, new Date(0))).toEqual([]);
  });
});
