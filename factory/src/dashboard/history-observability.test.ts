import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { DashboardHistory } from './history';
import { appendLedger, type AgentUsage } from '../ledger';
import { recordObservation } from '../observability';
const homes: string[] = [];
function createHome() { mkdirSync('tmp', { recursive: true }); const home = mkdtempSync('tmp/analytics-'); homes.push(home); return home; }
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function createUsage(cost: number, tokens: number, resumed: boolean): AgentUsage { return { model: 'model', sessionId: 'session', resumed, minutes: 1, costUsd: cost, modelUsage: [{ model: 'model', input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cost }] }; }
it('counts resumed cumulative usage once and links retry spend to the repeat attempt', async () => {
  const home = createHome();
  appendLedger(home, { kind: 'job', id: 'first', issue: 1, stage: 'design', startedAt: '2026-10-04T10:00:00Z', endedAt: '2026-10-04T10:01:00Z', outcome: 'died', agents: [createUsage(2, 200, false)], retryOf: null });
  appendLedger(home, { kind: 'job', id: 'second', issue: 1, stage: 'design', startedAt: '2026-10-04T10:02:00Z', endedAt: '2026-10-04T10:03:00Z', outcome: 'done', agents: [createUsage(3, 300, true)], retryOf: 'first' });
  const history = new DashboardHistory(home, 60000);
  await history.refresh(new Date('2026-10-04T10:04:00Z'));
  const summary = history.summarize(new Date('2026-10-04T10:04:00Z'), 1);
  expect(summary.cost).toBe(3);
  expect(summary.tokens?.input).toBe(300);
  expect(summary.retries).toEqual([{ outcome: 'died', runs: 1, workerMs: 60000, cost: 1 }]);
});
it('measures observed waits once per issue, not once per blocking reason', async () => {
  const home = createHome();
  const report = { picks: [], decisions: [{ stage: 'design' as const, issue: 1, reasons: ['queue-full' as const, 'daily-cap' as const] }], nextCapAt: null, release: { reason: 'uncut' as const, issues: [] } };
  recordObservation(home, 'scheduler', { type: 'scheduler', status: 'ready', report, counts: { Design: 1 } }, new Date('2026-10-04T10:00:00Z'));
  recordObservation(home, 'scheduler', { type: 'scheduler', status: 'ready', report: { ...report, decisions: [] }, counts: {} }, new Date('2026-10-04T10:01:00Z'));
  const history = new DashboardHistory(home, 60000);
  const now = new Date('2026-10-04T10:02:00Z');
  await history.refresh(now);
  const summary = history.summarize(now, 1);
  expect(summary.waitingMs).toBe(60000);
  expect(summary.waitingStages).toEqual([{ stage: 'design', workerMs: 60000 }]);
});
it('keeps unrecorded waiting time unavailable', async () => {
  const home = createHome();
  const history = new DashboardHistory(home, 60000);
  await history.refresh(new Date());
  expect(history.summarize(new Date(), 7).waitingMs).toBeNull();
});
