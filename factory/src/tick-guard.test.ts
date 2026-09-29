import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, writeState } from './state';
import { guardTick } from './tick-guard';
import type { Ctx } from './types';

const ROOT = resolve('tmp/factory-tick-guard-test');
const statePath = join(ROOT, 'state.json');

function fakeCtx(posts: string[]): Ctx {
  return {
    cfg: { committeeChat: 'c' }, statePath,
    telegram: { sendMessage: async (_c: string, text: string) => { posts.push(text); return 1; } },
  } as unknown as Ctx;
}

describe('guardTick', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    writeState(statePath, structuredClone(EMPTY_STATE));
  });

  it('posts a crash once while the error stays the same, and again after a change', async () => {
    const posts: string[] = [];
    const crash = (text: string) => guardTick(fakeCtx(posts), async () => { throw new Error(text); });
    await expect(crash('GitHub is down')).rejects.toThrow();
    await expect(crash('GitHub is down')).rejects.toThrow();
    await expect(crash('Telegram is down')).rejects.toThrow();
    expect(posts).toHaveLength(2);
    expect(posts[0]).toContain('GitHub is down');
  });

  it('clears the last error after a good tick', async () => {
    const posts: string[] = [];
    await expect(guardTick(fakeCtx(posts), async () => { throw new Error('x'); })).rejects.toThrow();
    await guardTick(fakeCtx(posts), async () => undefined);
    expect(readState(statePath).lastTickError).toBeNull();
  });
});
