import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readState } from '../state';
import type { AgentRun, Ctx } from '../types';

vi.mock('../deploy', () => ({ buildAndDeploy: async () => 'https://play.test/abc123/' }));
const { runStage, approvalCaption } = await import('./testing');

let home = '';
let calls: string[] = [];
let shellScript = '';
let photoButtons: unknown;
let openPr: string | null = null;

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-testing-');
  calls = [];
  openPr = null;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(agent: (run: AgentRun) => void, shellFailures = 0): Ctx {
  let failuresLeft = shellFailures;
  const fake = {
    cfg: { home, buildModel: 'sonnet', repo: 'o/r', committeeChat: 'chat' },
    statePath: `${home}/state.json`,
    github: {
      issue: async () => ({ number: 7, title: 'Big horn', body: '', labels: [], createdAt: '', state: 'OPEN', thumbsUp: [] }),
      move: async (issue: number, column: string) => { calls.push(`move ${issue} ${column}`); },
      comment: async (issue: number) => { calls.push(`comment ${issue}`); },
      pullRequestFor: async (branch: string) => { calls.push(`pullRequestFor ${branch}`); return openPr; },
      openPullRequest: async (branch: string, base: string, title: string, body: string) => { calls.push(`openPullRequest ${branch} ${base} ${title} | ${body}`); return 'https://github.com/o/r/pull/50'; },
    },
    telegram: {
      sendPhoto: async (chat: string, path: string, caption: string, buttons?: unknown) => { calls.push(`photo ${chat} ${path} ${caption}`); photoButtons = buttons; return 100; },
      sendMessage: async (chat: string, text: string, replyTo?: number) => { calls.push(`message ${replyTo} ${text}`); return 101; },
    },
    container: {
      agent: async (run: AgentRun) => agent(run),
      shell: async (_dir: string, script: string) => {
        shellScript = script;
        calls.push('checks');
        if (failuresLeft-- > 0) throw new Error('npm test failed: 1 failed');
      },
    },
    repo: {
      prepareWorkClone: async (_b: string, _base: string, dir: string) => { mkdirSync(dir, { recursive: true }); },
      fetchFromWork: async () => undefined,
      push: async (branch: string) => { calls.push(`push ${branch}`); },
      diff: async () => '',
      headHash: async () => 'abc123',
    },
  };
  return fake as unknown as Ctx;
}

function writeOutputs(run: AgentRun, approval: string | null): void {
  if (approval !== null) writeFileSync(`${run.clone}/.factory/approval.json`, approval);
  writeFileSync(`${run.clone}/.factory/screenshot.png`, 'png');
}

describe('testing stage', () => {
  it('opens a pull request against dev when none is open', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' })));
    await runStage(ctx, 7);
    const opened = calls.find((call) => call.startsWith('openPullRequest')) ?? '';
    expect(opened).toContain('openPullRequest factory/issue-7 dev #7 Big horn | Closes #7.');
    expect(opened).toContain('A loud horn.');
    expect(opened).toContain('How to try: Press H.');
    expect(opened).toContain('The factory merges it when the committee approves.');
  });

  it('reuses the open pull request of the branch', async () => {
    openPr = 'https://github.com/o/r/pull/12';
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(calls.some((call) => call.startsWith('openPullRequest'))).toBe(false);
    expect(calls.find((call) => call.startsWith('photo'))).toContain('PR: https://github.com/o/r/pull/12');
  });

  it('posts one photo with everything in the caption, records it and moves to Approval', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' })));
    await runStage(ctx, 7);
    expect(shellScript).toContain('npm run playtest -- --cpu');
    expect(shellScript).toContain('seq 1 60');
    const photo = calls.find((call) => call.startsWith('photo')) ?? '';
    expect(photo).toContain('#7 Big horn\n\nPlay: https://play.test/abc123/');
    expect(photo).toContain('How to try: Press H.');
    expect(photo).toContain('Issue: https://github.com/o/r/issues/7\nPR: https://github.com/o/r/pull/50');
    expect(photoButtons).toEqual([[{ text: 'Approve', data: 'factory:approve:7' }, { text: 'Deny', data: 'factory:deny:7' }]]);
    expect(calls.some((call) => call.startsWith('message'))).toBe(false);
    expect(calls).toContain('comment 7');
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 100: 7 });
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('fits long notes into the caption limit', () => {
    const caption = approvalCaption('#7 Big horn', 'https://play.test/x/', 'https://github.com/o/r/issues/7', 'https://github.com/o/r/pull/50', { description: 'd'.repeat(900), howToTry: 'h'.repeat(900) });
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('…');
    expect(caption).toContain('Deny closes the issue');
  });

  it('throws when approval.json lacks howToTry', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'x' })));
    await expect(runStage(ctx, 7)).rejects.toThrow('howToTry');
    expect(calls).toEqual([]);
  });

  it('throws when approval.json is missing', async () => {
    await expect(runStage(fakeCtx((run) => writeOutputs(run, null)), 7)).rejects.toThrow('approval.json');
  });

  it('gives the agent one fix round when the checks fail, then posts', async () => {
    const prompts: string[] = [];
    const ctx = fakeCtx((run) => { prompts.push(run.prompt); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runStage(ctx, 7);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('second round');
    expect(readFileSync(`${home}/work/issue-7/.factory/check-failure.md`, 'utf8')).toContain('npm test failed');
    expect(calls.filter((call) => call === 'checks')).toHaveLength(2);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('stops after the checks fail twice', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })), 2);
    await expect(runStage(ctx, 7)).rejects.toThrow('The factory checks failed twice');
    expect(calls).not.toContain('move 7 Approval');
  });
});
