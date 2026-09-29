import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState, readState, EMPTY_STATE } from '../state';
import type { Column, Ctx } from '../types';

vi.mock('../deploy', () => ({ deployDev: async () => 'https://play.test/dev/' }));
const { approve, deny, feedback } = await import('./approval');

let home = '';
let calls: string[] = [];
let column: Column = 'Approval';
let openPr: string | null = null;

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-approval-');
  calls = [];
  column = 'Approval';
  openPr = null;
  writeState(`${home}/state.json`, { ...EMPTY_STATE, approvalPosts: { 100: 7, 101: 7, 200: 8 }, pendingApprovals: { 7: 'bob' }, builds: { 7: 'aaa1111', 8: 'bbb2222' } });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(): Ctx {
  const record = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); };
  const fake = {
    cfg: { home, committeeChat: 'chat', publicUrl: 'https://play.test' },
    statePath: `${home}/state.json`,
    github: {
      cards: async () => [{ itemId: 'x', issue: 7, column, labels: [] }],
      issue: async () => ({ number: 7, title: 'Big horn', body: '', labels: [], createdAt: '', state: 'OPEN', thumbsUp: [] }),
      comment: record('comment'), addLabel: record('addLabel'), pullRequestFor: async () => openPr, closePullRequest: record('closePullRequest'), close: record('close'), move: record('move'),
    },
    telegram: { sendMessage: record('message') },
    repo: { sync: record('sync'), merge: record('merge'), push: record('push') },
  };
  return fake as unknown as Ctx;
}

describe('approve', () => {
  it('merges, pushes, closes, moves to Done and clears state', async () => {
    await approve(fakeCtx(), 7, 'bob');
    expect(calls).toEqual([
      'sync ',
      'merge factory/issue-7 dev Merge issue #7: Big horn',
      'push dev',
      'comment 7 Approved by bob in the committee chat and merged into dev.',
      'close 7 completed',
      'move 7 Done',
      'message chat Issue #7 Big horn is merged into dev.\nPlay it: https://play.test/dev',
    ]);
    const state = readState(`${home}/state.json`);
    expect(state.approvalPosts).toEqual({ 200: 8 });
    expect(state.pendingApprovals).toEqual({});
    expect(state.builds).toEqual({ 8: 'bbb2222' });
  });

  it('throws when the card is not in Approval', async () => {
    column = 'Testing';
    await expect(approve(fakeCtx(), 7, 'bob')).rejects.toThrow('not in Approval');
    expect(calls).toEqual([]);
  });
});

describe('feedback', () => {
  it('comments under the heading, moves to Design and drops the posts', async () => {
    await feedback(fakeCtx(), 7, 'bob', 'Make it louder');
    expect(calls).toEqual(['comment 7 ## Committee feedback\n\nFrom bob:\n\nMake it louder', 'move 7 Design']);
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 200: 8 });
    expect(readState(`${home}/state.json`).builds).toEqual({ 8: 'bbb2222' });
  });
});

describe('deny', () => {
  it('comments, labels wont-do, closes as not planned, moves to Done and clears state', async () => {
    await deny(fakeCtx(), 7, 'bob');
    expect(calls).toEqual([
      'comment 7 Denied by bob in the committee chat.',
      'addLabel 7 wont-do',
      'close 7 not planned',
      'move 7 Done',
    ]);
    const state = readState(`${home}/state.json`);
    expect(state.approvalPosts).toEqual({ 200: 8 });
    expect(state.pendingApprovals).toEqual({});
    expect(state.builds).toEqual({ 8: 'bbb2222' });
  });

  it('closes the open pull request with the same comment', async () => {
    openPr = 'https://github.com/o/r/pull/3';
    await deny(fakeCtx(), 7, 'bob');
    expect(calls).toContain('closePullRequest factory/issue-7 Denied by bob in the committee chat.');
  });

  it('throws when the card is not in Approval', async () => {
    column = 'Testing';
    await expect(deny(fakeCtx(), 7, 'bob')).rejects.toThrow('not in Approval');
    expect(calls).toEqual([]);
  });
});
