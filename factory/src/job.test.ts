import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { progressNote, runJob } from './job';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Ctx, FactoryConfig } from './types';

const ROOT = resolve('tmp/factory-job-test');

describe('runJob', () => {
  it('clears the job and the queued change after a failure, and reports it once', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), jobs: [{ id: 'a', stage: 'design', issue: 4, pid: 1, startedAt: '', log: 'l' }, { id: 'b', stage: 'change', issue: 9, pid: 1, startedAt: '', log: 'l' }], pendingChanges: [{ id: 9, text: 't', by: 'b' }], interrupted: [9] });
    const posts: string[] = [];
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig, statePath, now: () => new Date(), log: () => undefined,
      repo: { fetch: async () => { throw new Error('offline'); } },
      telegram: { sendMessage: async (_c: string, text: string) => { posts.push(text); return 1; } },
      github: {},
    } as unknown as Ctx;
    await runJob(ctx, 'change', 9);
    const state = readState(statePath);
    expect(state.jobs.map((job) => job.id)).toEqual(['a']);
    expect(state.pendingChanges).toEqual([]);
    // Change 9 is no issue 9, so the mark of issue 9 stays.
    expect(state.interrupted).toEqual([9]);
    expect(posts).toEqual([]);
    expect(state.failures).toMatchObject([{ stage: 'change', issue: null, error: 'offline' }]);
  });

  it('clears the queued ship after a failed ship, and reports on the tracking issue', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), jobs: [{ id: 'a', stage: 'ship', issue: 20, pid: 1, startedAt: '', log: 'l' }], pendingShip: 'Ann', release: { issue: 20, branch: 'release/x', day: 'd', postId: 5, removed: [] } });
    const labels: string[] = [];
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c', itchTarget: null, butlerKey: null } as unknown as FactoryConfig, statePath, now: () => new Date(), log: () => undefined,
      telegram: { sendMessage: async () => 1 },
      github: { addLabel: async (n: number, label: string) => { labels.push(`${n}:${label}`); } },
    } as unknown as Ctx;
    await runJob(ctx, 'ship', 20);
    const state = readState(statePath);
    expect(state.pendingShip).toBeNull();
    expect(state.release).not.toBeNull();
    expect(labels).toEqual(['20:factory-stuck']);
  });

  it('comments on the issue when a card stage fails, after the report', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), jobs: [{ id: 'a', stage: 'design', issue: 7, pid: 1, startedAt: '2026-01-10T11:50:00Z', log: 'l' }], interrupted: [3, 7] });
    const events: string[] = [];
    const fail = async () => { throw new Error('offline'); };
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig, statePath, now: () => new Date('2026-01-10T12:00:00Z'), log: () => undefined,
      repo: { fetch: fail },
      telegram: { sendMessage: async () => { events.push('report'); return 1; } },
      github: { issue: fail, cards: fail, addLabel: async () => { events.push('label'); }, comment: async (n: number, body: string) => { events.push(`comment ${n} ${body}`); } },
    } as unknown as Ctx;
    await runJob(ctx, 'design', 7);
    expect(events).toEqual(['label', 'comment 7 Design failed after 10 min. Hermes is looking into it.']);
    expect(readState(statePath).interrupted).toEqual([3]);
  });

  it('writes a finished note with the stage time', () => {
    const ctx = { now: () => new Date('2026-01-10T12:00:00Z') } as unknown as Ctx;
    expect(progressNote(ctx, 'implement', '2026-01-10T11:15:00Z', 'finished')).toBe('Implementation finished after 45 min.');
    expect(progressNote(ctx, 'testing', null, 'finished')).toBe('Testing finished.');
  });

  it('drops only the failed removal from the queue', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    const removals = [{ issue: 5, by: 'a', text: 't' }, { issue: 6, by: 'b', text: 'u' }];
    writeState(statePath, { ...structuredClone(EMPTY_STATE), jobs: [{ id: 'a', stage: 'remove', issue: 5, pid: 1, startedAt: '', log: 'l' }], pendingRemovals: removals });
    const labels: string[] = [];
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig, statePath, now: () => new Date(), log: () => undefined,
      telegram: { sendMessage: async () => 1 },
      github: { addLabel: async (n: number, label: string) => { labels.push(`${n}:${label}`); } },
    } as unknown as Ctx;
    await runJob(ctx, 'remove', 5);
    expect(readState(statePath).pendingRemovals).toEqual([removals[1]]);
    expect(labels).toEqual(['5:factory-stuck']);
  });
});
