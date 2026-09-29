import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseJob, tick, type TickDeps } from './tick';
import { EMPTY_STATE, readState, writeState } from './state';
import { STUCK_LABEL, type Card, type Ctx, type FactoryState, type Job } from './types';

const NOW = new Date('2026-01-10T12:00:00Z');
const CFG = { releaseDays: 7, maintenanceHours: 24 };
const FRESH = { lastRelease: '2026-01-09T12:00:00Z', lastMaintenance: '2026-01-10T06:00:00Z' };

const state = (over: Partial<FactoryState> = {}): FactoryState => ({ ...structuredClone(EMPTY_STATE), ...FRESH, ...over });
const card = (issue: number, column: Card['column'], labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });

describe('chooseJob', () => {
  it('picks the lowest ad hoc card after queued work and before due periodic jobs', () => {
    const cards = [card(8, 'Implementation', ['adhoc']), card(6, 'Implementation', ['adhoc']), card(5, 'Implementation'), card(7, 'Implementation', ['adhoc', 'factory-stuck'])];
    expect(chooseJob(state({ lastRelease: null }), cards, NOW, CFG)).toEqual({ stage: 'adhoc', issue: 6 });
    const queuedChange = state({ pendingChanges: [{ id: 3, text: 'x', by: 'a' }] });
    expect(chooseJob(queuedChange, cards, NOW, CFG)).toEqual({ stage: 'change', issue: 3 });
  });

  it('skips ad hoc cards in the normal implement pick', () => {
    const cards = [card(2, 'Implementation', ['adhoc']), card(3, 'Implementation')];
    expect(chooseJob(state(), cards, NOW, CFG)).toEqual({ stage: 'adhoc', issue: 2 });
    expect(chooseJob(state(), [card(2, 'Implementation', ['adhoc', 'factory-stuck']), card(3, 'Implementation')], NOW, CFG)).toEqual({ stage: 'implement', issue: 3 });
  });

  it('returns null while a job runs', () => {
    const job: Job = { stage: 'design', issue: 1, pid: 1, startedAt: '', log: '' };
    expect(chooseJob(state({ job }), [card(2, 'Design')], NOW, CFG)).toBeNull();
  });

  it('runs the lowest pending approval before a change', () => {
    const s = state({ pendingApprovals: { '9': 'u', '4': 'u' }, pendingChanges: [{ id: 3, text: 't', by: 'u' }] });
    expect(chooseJob(s, [], NOW, CFG)).toEqual({ stage: 'approve', issue: 4 });
  });

  it('runs a pending change before periodic jobs', () => {
    const s = state({ pendingChanges: [{ id: 3, text: 't', by: 'u' }], lastRelease: null });
    expect(chooseJob(s, [], NOW, CFG)).toEqual({ stage: 'change', issue: 3 });
  });

  it('runs release when never released or older than the interval', () => {
    expect(chooseJob(state({ lastRelease: null }), [], NOW, CFG)).toEqual({ stage: 'release', issue: null });
    expect(chooseJob(state({ lastRelease: '2026-01-03T11:00:00Z' }), [], NOW, CFG)).toEqual({ stage: 'release', issue: null });
  });

  it('skips release inside the interval', () => {
    expect(chooseJob(state({ lastRelease: '2026-01-03T13:00:00Z' }), [], NOW, CFG)).toBeNull();
  });

  it('runs maintenance after release, when due', () => {
    expect(chooseJob(state({ lastMaintenance: null }), [], NOW, CFG)).toEqual({ stage: 'maintenance', issue: null });
    expect(chooseJob(state({ lastMaintenance: '2026-01-09T11:00:00Z' }), [], NOW, CFG)).toEqual({ stage: 'maintenance', issue: null });
  });

  it('picks the card furthest along, lowest issue first', () => {
    const cards = [card(1, 'Design'), card(5, 'Implementation'), card(7, 'Testing'), card(6, 'Testing')];
    expect(chooseJob(state(), cards, NOW, CFG)).toEqual({ stage: 'testing', issue: 6 });
    expect(chooseJob(state(), cards.slice(0, 2), NOW, CFG)).toEqual({ stage: 'implement', issue: 5 });
    expect(chooseJob(state(), cards.slice(0, 1), NOW, CFG)).toEqual({ stage: 'design', issue: 1 });
  });

  it('skips stuck cards, Approval and Done', () => {
    const cards = [card(1, 'Testing', [STUCK_LABEL]), card(2, 'Approval'), card(3, 'Done'), card(4, 'Design')];
    expect(chooseJob(state(), cards, NOW, CFG)).toEqual({ stage: 'design', issue: 4 });
    expect(chooseJob(state(), cards.slice(0, 3), NOW, CFG)).toBeNull();
  });
});

type Harness = { ctx: Ctx; sent: string[]; labels: string[]; deps: TickDeps; killed: number[]; spawned: string[][] };

function harness(job: Job | null, alive: boolean, cards: Card[] = []): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'tick-'));
  const statePath = join(dir, 'state.json');
  writeState(statePath, state({ job }));
  const sent: string[] = [];
  const labels: string[] = [];
  const killed: number[] = [];
  const spawned: string[][] = [];
  const github = { cards: async () => cards, candidates: async () => [], addLabel: async (n: number, l: string) => { labels.push(`${n}:${l}`); } };
  const telegram = { sendMessage: async (_chat: string, text: string) => { sent.push(text); return 1; } };
  const cfg = { home: dir, repo: 'o/r', committeeChat: 'c', stageTimeoutMinutes: 30, ...CFG };
  const ctx = { cfg, github, telegram, statePath, now: () => NOW, log: () => undefined } as unknown as Ctx;
  const deps: TickDeps = { isAlive: () => alive, kill: async (_run, pid) => { killed.push(pid); }, spawn: (args) => { spawned.push(args); return 77; } };
  return { ctx, sent, labels, deps, killed, spawned };
}

const job = (startedAt: string, stage: Job['stage'] = 'design', issue: number | null = 5): Job => ({ stage, issue, pid: 42, startedAt, log: '/l.log' });

describe('tick', () => {
  it('kills a job past the timeout, clears it and reports', async () => {
    const h = harness(job('2026-01-10T11:00:00Z'), true);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual([42]);
    expect(h.labels).toEqual([`5:${STUCK_LABEL}`]);
    expect(h.sent[0]).toContain('timed out after 30 minutes');
    expect(readState(h.ctx.statePath).job).toBeNull();
  });

  it('leaves a job in time alone', async () => {
    const h = harness(job('2026-01-10T11:50:00Z'), true, [card(8, 'Design')]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual([]);
    expect(h.spawned).toEqual([]);
    expect(readState(h.ctx.statePath).job?.pid).toBe(42);
  });

  it('reports a dead job that stayed in state, without an issue for a change', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'change', 3), false);
    await tick(h.ctx, '/code', h.deps);
    expect(h.labels).toEqual([]);
    expect(h.sent[0]).toContain('job process died without finishing');
    expect(readState(h.ctx.statePath).job).toBeNull();
  });

  it('starts the chosen job and records it', async () => {
    const h = harness(null, false, [card(8, 'Implementation')]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([['implement', '8']]);
    const started = readState(h.ctx.statePath).job;
    expect(started).toMatchObject({ stage: 'implement', issue: 8, pid: 77 });
    expect(started?.log).toMatch(/logs\/implement-8-2026-01-10T120000\.000Z\.log$/);
  });
});
