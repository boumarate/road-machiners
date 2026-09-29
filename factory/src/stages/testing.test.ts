import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readState } from '../state';
import type { AgentRun, Ctx } from '../types';

vi.mock('../deploy', () => ({ buildAndDeploy: async () => 'https://play.test/abc123/' }));
const { runStage } = await import('./testing');

let home = '';
let calls: string[] = [];
let shellScript = '';

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-testing-');
  calls = [];
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
    },
    telegram: {
      sendPhoto: async (chat: string, path: string, caption: string) => { calls.push(`photo ${chat} ${path} ${caption}`); return 100; },
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
  it('posts the photo and the reply, records both ids and moves to Approval', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' })));
    await runStage(ctx, 7);
    expect(shellScript).toContain('npm run playtest -- --cpu');
    expect(shellScript).toContain('seq 1 60');
    expect(calls.find((call) => call.startsWith('photo'))).toContain('#7 Big horn\nhttps://play.test/abc123/');
    const message = calls.find((call) => call.startsWith('message 100'));
    expect(message).toContain('How to try: Press H.');
    expect(message).toContain('Reply approve to this message to merge into dev.');
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 100: 7, 101: 7 });
    expect(calls.at(-1)).toBe('move 7 Approval');
    expect(readFileSync(`${home}/state.json`, 'utf8')).toContain('101');
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
