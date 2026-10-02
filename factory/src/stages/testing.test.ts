import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { AgentRun, Ctx } from '../types';

vi.mock('../deploy', () => ({ checkScope: () => undefined, publishBuild: (_ctx: unknown, _clone: string, scope: string) => `https://play.test/${scope}/`, recordBuild: () => undefined }));
const { runStage, approvalCaption, approvalButtons } = await import('./testing');

let home = '';
let calls: string[] = [];
let shellScript = '';
let shellEnv: Record<string, string> | undefined;
let photoButtons: unknown;
let openPr: string | null = null;
let labels: string[] = [];
let bases: string[] = [];
// The merges testing queued for the approve job.
const queued = (): Record<string, string> => readState(`${home}/state.json`).pendingApprovals;
let conflicts: string[] = [];
let merged = true;

beforeEach(() => {
  conflicts = [];
  merged = true;
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-testing-');
  calls = [];
  openPr = null;
  labels = [];
  bases = [];
  writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [] } });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(agent: (run: AgentRun) => void, shellFailures = 0): Ctx {
  let failuresLeft = shellFailures;
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet', repo: 'o/r', committeeChat: 'chat' },
    log: () => undefined,
    statePath: `${home}/state.json`,
    github: {
      issue: async () => ({ number: 7, title: 'Big horn', body: '', labels, createdAt: '', state: 'OPEN', thumbsUp: [] }),
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
      shell: async (_dir: string, script: string, _log: string, env?: Record<string, string>) => {
        shellScript = script;
        shellEnv = env;
        calls.push('checks');
        if (failuresLeft-- > 0) throw new Error('npm test failed: 1 failed');
      },
    },
    repo: {
      prepareWorkClone: async (_b: string, base: string, dir: string) => { bases.push(`prepare ${base}`); mkdirSync(dir, { recursive: true }); },
      fetchFromWork: async () => 'w1',
      untrackFactoryFiles: async () => [],
      push: async (commit: string, branch: string) => { calls.push(`push ${commit} ${branch}`); },
      diff: async (base: string) => { bases.push(`diff ${base}`); return ''; },
      headHash: async () => 'abc123',
      fetch: async () => { bases.push('fetch'); },
      mergeBaseIntoWork: async (_dir: string, base: string) => { bases.push(`merge ${base}`); return { commit: 'base0001', conflicts }; },
      isMerged: async (base: string) => { bases.push(`isMerged ${base}`); return merged; },
    },
  };
  return fake as unknown as Ctx;
}

function writeOutputs(run: AgentRun, approval: string | null): void {
  if (approval !== null) writeFileSync(`${run.clone}/${run.dir}/.factory/approval.json`, approval);
  writeFileSync(`${run.clone}/${run.dir}/.factory/screenshot.png`, 'png');
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
    expect(shellScript).toContain('SAVE_SCOPE="$BUILD_SCOPE" npm run build');
    expect(shellEnv).toEqual({ BUILD_SCOPE: 'abc123' });
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
    const caption = approvalCaption('#7 Big horn', 'https://play.test/x/', 'https://github.com/o/r/issues/7', 'https://github.com/o/r/pull/50', { description: 'd'.repeat(900), howToTry: 'h'.repeat(900) }, 'dev');
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('…');
    expect(caption).toContain('Deny closes the issue');
  });

  it('says a hotfix approval ships to main and itch.io', () => {
    const caption = approvalCaption('#7 Big horn', 'u', 'l', 'p', { description: 'd', howToTry: 'h' }, 'main');
    expect(caption.startsWith('⚠️ HOTFIX. Approve merges into main and ships to players at once.')).toBe(true);
    expect(caption).toContain('Approve ships this hotfix to main and itch.io at once.');
    expect(approvalCaption('#7 Big horn', 'u', 'l', 'p', { description: 'd', howToTry: 'h' }, 'dev')).not.toContain('HOTFIX');
    expect(approvalButtons(7, 'main')[0][0]).toEqual({ text: 'Approve and ship to players', data: 'factory:approve:7' });
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
    expect(readFileSync(`${home}/work/issue-7/game/.factory/check-failure.md`, 'utf8')).toContain('npm test failed');
    expect(calls.filter((call) => call === 'checks')).toHaveLength(2);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('runs every testing round on the build model by default', async () => {
    const models: string[] = [];
    const ctx = fakeCtx((run) => { models.push(run.model); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runStage(ctx, 7);
    expect(models).toEqual(['sonnet', 'sonnet']);
  });

  it('runs the test round and the check-fix retry on Opus with implementation-opus', async () => {
    labels = ['implementation-opus'];
    const models: string[] = [];
    const ctx = fakeCtx((run) => { models.push(run.model); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runStage(ctx, 7);
    expect(models).toEqual(['opus', 'opus']);
  });

  it('honors a label removed between the test round and the fix round', async () => {
    labels = ['implementation-opus'];
    const models: string[] = [];
    const ctx = fakeCtx((run) => { models.push(run.model); labels = []; writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runStage(ctx, 7);
    expect(models).toEqual(['opus', 'sonnet']);
  });

  it('keeps the selection when a conflict sends the card back to testing in a new job', async () => {
    labels = ['implementation-opus'];
    conflicts = ['game/src/a.ts'];
    const models: string[] = [];
    const ctx = fakeCtx((run) => { models.push(run.model); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); });
    await runStage(ctx, 7);
    await runStage(fakeCtx((run) => { models.push(run.model); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }), 7);
    expect(models).toEqual(['opus', 'opus']);
  });

  it('stops after the checks fail twice', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })), 2);
    await expect(runStage(ctx, 7)).rejects.toThrow('The factory checks failed twice');
    expect(calls).not.toContain('move 7 Approval');
  });

  it('works on the release branch for a release task and merges there', async () => {
    labels = ['release-task'];
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(new Set(bases)).toEqual(new Set(['prepare release/2026-09-29', 'fetch','merge release/2026-09-29', 'isMerged base0001', 'diff release/2026-09-29']));
    expect(calls.find((call) => call.startsWith('openPullRequest'))).toContain('openPullRequest factory/issue-7 release/2026-09-29 #7 Big horn');
    expect(calls.find((call) => call.startsWith('photo'))).toContain('Approve merges into release/2026-09-29.');
    expect(queued()).toEqual({});
  });

  it('works on dev for an ordinary card even while a release is open', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(new Set(bases)).toEqual(new Set(['prepare dev', 'fetch','merge dev', 'isMerged base0001', 'diff dev']));
  });

  it('merges dev into the branch before the agent runs, and lists conflicts for it', async () => {
    conflicts = ['game/src/a.ts', 'game/src/b.ts'];
    let seen = '';
    const ctx = fakeCtx((run) => {
      seen = readFileSync(`${run.clone}/${run.dir}/.factory/merge-conflicts.md`, 'utf8');
      writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' }));
    });
    await runStage(ctx, 7);
    expect(bases.indexOf('merge dev')).toBeLessThan(bases.indexOf('diff dev'));
    expect(seen).toBe('- game/src/a.ts\n- game/src/b.ts\n');
  });

  it('fails the stage when the agent leaves the merge of dev unfinished', async () => {
    merged = false;
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await expect(runStage(ctx, 7)).rejects.toThrow('left the merge of dev at base000 into factory/issue-7 unfinished');
    expect(calls).not.toContain('checks');
  });

  it('merges a cleanup task into the release itself, with no committee post', async () => {
    labels = ['release-task', 'maintenance'];
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(calls.some((call) => call.startsWith('photo') || call.startsWith('openPullRequest') || call === 'comment 7')).toBe(false);
    expect(calls.filter((call) => call === 'checks')).toHaveLength(1);
    expect(calls.at(-1)).toBe('move 7 Approval');
    expect(queued()).toEqual({ 7: 'the factory' });
  });

  it('queues the merge of a card approved before a conflict sent it back, with no new post', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' } });
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(calls.some((call) => call.startsWith('photo'))).toBe(false);
    expect(calls.at(-1)).toBe('move 7 Approval');
    expect(queued()).toEqual({ 7: 'Ann' });
  });

  it('posts a maintenance task on dev for approval as usual', async () => {
    labels = ['maintenance'];
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(calls.some((call) => call.startsWith('photo'))).toBe(true);
    expect(queued()).toEqual({});
  });

  it('does not merge a cleanup task when the checks fail twice', async () => {
    labels = ['release-task', 'maintenance'];
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })), 2);
    await expect(runStage(ctx, 7)).rejects.toThrow('checks failed twice');
    expect(queued()).toEqual({});
  });
});
