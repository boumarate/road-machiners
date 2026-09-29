import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJob } from './job';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Ctx, FactoryConfig } from './types';

const ROOT = resolve('tmp/factory-job-test');

describe('runJob', () => {
  it('clears the job and the queued change after a failure, and reports it once', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), job: { stage: 'change', issue: 9, pid: 1, startedAt: '', log: 'l' }, pendingChanges: [{ id: 9, text: 't', by: 'b' }] });
    const posts: string[] = [];
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig, statePath, now: () => new Date(), log: () => undefined,
      repo: { sync: async () => { throw new Error('offline'); } },
      telegram: { sendMessage: async (_c: string, text: string) => { posts.push(text); return 1; } },
      github: {},
    } as unknown as Ctx;
    await runJob(ctx, 'change', 9);
    const state = readState(statePath);
    expect(state.job).toBeNull();
    expect(state.pendingChanges).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('offline');
  });

  it('clears the queued ship after a failed ship, and reports on the tracking issue', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), job: { stage: 'ship', issue: 20, pid: 1, startedAt: '', log: 'l' }, pendingShip: 'Ann', release: { issue: 20, branch: 'release/x', day: 'd', postId: 5, removed: [] } });
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

  it('drops only the failed removal from the queue', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    const removals = [{ issue: 5, by: 'a', text: 't' }, { issue: 6, by: 'b', text: 'u' }];
    writeState(statePath, { ...structuredClone(EMPTY_STATE), job: { stage: 'remove', issue: 5, pid: 1, startedAt: '', log: 'l' }, pendingRemovals: removals });
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
