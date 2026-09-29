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
    await runJob(ctx, 'change', 9, ROOT);
    const state = readState(statePath);
    expect(state.job).toBeNull();
    expect(state.pendingChanges).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('offline');
  });
});
