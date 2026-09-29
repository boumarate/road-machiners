import { describe, expect, it } from 'vitest';
import { failureIssue, reportFailure, summarizeError } from './fail';
import { EMPTY_STATE } from './state';
import type { Ctx, FactoryState } from './types';

describe('summarizeError', () => {
  it('keeps the failure lines of colored test output', () => {
    const output = 'shell failed with exit 1: \u001b[32m✓ a\u001b[39m\n ✓ b\n × local game save > records the saved shape\n FAIL src/three/save.test.ts\n Tests  1 failed | 2175 passed\n';
    expect(summarizeError(output)).toBe('shell failed with exit 1: ✓ a\n× local game save > records the saved shape\nFAIL src/three/save.test.ts\nTests  1 failed | 2175 passed');
  });

  it('falls back to the last lines when nothing looks like a failure', () => {
    expect(summarizeError('one\ntwo\nthree')).toBe('one\ntwo\nthree');
  });
});

describe('reportFailure', () => {
  it('posts to Telegram before labeling, and posts again when the label fails', async () => {
    const posts: string[] = [];
    const ctx = {
      cfg: { repo: 'o/r', committeeChat: 'c' },
      log: () => undefined,
      telegram: { sendMessage: async (_c: string, text: string) => { posts.push(text); return 1; } },
      github: { addLabel: async () => { throw new Error('x509: certificate is not standards compliant'); } },
    } as unknown as Ctx;
    await expect(reportFailure(ctx, 'implement', 4, new Error('agent failed'), 'l')).rejects.toThrow('x509');
    expect(posts[0]).toContain('Factory stage implement failed on issue #4');
    expect(posts[1]).toContain('Could not label issue #4');
  });
});

describe('failureIssue', () => {
  const open: FactoryState = { ...structuredClone(EMPTY_STATE), release: { issue: 20, branch: 'release/x', day: 'd', postId: null, removed: [] } };
  const none = structuredClone(EMPTY_STATE);

  it('names the issue of a card stage, approve, candidate, ship and remove', () => {
    for (const stage of ['design', 'approve', 'candidate', 'ship', 'remove'] as const) expect(failureIssue(stage, 9, open)).toBe(9);
  });

  it('names the tracking issue for a cut once one exists, and no issue before', () => {
    expect(failureIssue('release', null, open)).toBe(20);
    expect(failureIssue('release', null, none)).toBeNull();
  });

  it('names no issue for a change', () => {
    expect(failureIssue('change', 5, open)).toBeNull();
  });
});
