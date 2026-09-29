import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runStage } from './triage';
import type { AgentRun, Ctx } from '../types';

let home = '';
let calls: string[] = [];
let prompt = '';

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-triage-');
  calls = [];
  prompt = '';
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(verdict: string | null): Ctx {
  const record = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); };
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet', repo: 'o/r' },
    github: {
      issue: async () => ({ number: 7, title: 'Big horn', body: 'Add a horn', labels: [], createdAt: '', state: 'OPEN', author: 'anna', thumbsUp: [] }),
      comments: async () => [],
      comment: record('comment'), addLabel: record('addLabel'), close: record('close'), move: record('move'),
    },
    container: {
      agent: async (run: AgentRun) => {
        calls.push(`agent ${run.model}`);
        prompt = run.prompt;
        if (verdict !== null) writeFileSync(`${run.clone}/${run.dir}/.factory/triage.json`, verdict);
      },
    },
    repo: {
      sync: record('sync'), push: record('push'), fetchFromWork: record('fetch'),
      prepareWorkClone: async (_b: string, _base: string, dir: string) => { mkdirSync(dir, { recursive: true }); },
    },
  };
  return fake as unknown as Ctx;
}

const verdict = (over: Record<string, unknown>): string => JSON.stringify({ verdict: 'ready', reason: 'Clear goal', questions: [], ...over });

describe('triage stage', () => {
  it('comments and moves to Design when ready', async () => {
    await runStage(fakeCtx(verdict({})), 7);
    expect(calls).toContain('agent sonnet');
    expect(calls).toContain('comment 7 Triage passed: Clear goal');
    expect(calls.at(-1)).toBe('move 7 Design');
    expect(prompt).not.toContain('{{');
    expect(calls.filter((call) => call.startsWith('push'))).toEqual([]);
  });

  it('refuses, labels, closes and moves to Done on wont-do', async () => {
    await runStage(fakeCtx(verdict({ verdict: 'wont-do', reason: 'Against the design.' })), 7);
    expect(calls).toContain('comment 7 Against the design.');
    expect(calls).toContain('addLabel 7 wont-do');
    expect(calls).toContain('close 7 not planned');
    expect(calls.at(-1)).toBe('move 7 Done');
  });

  it('asks the author and leaves the card when unclear', async () => {
    await runStage(fakeCtx(verdict({ verdict: 'unclear', reason: 'Vague', questions: ['Which horn?', 'How loud?'] })), 7);
    const post = calls.find((call) => call.startsWith('comment 7 ## Questions from the factory')) ?? '';
    expect(post).toContain('@anna');
    expect(post).toContain('1. Which horn?');
    expect(post).toContain('2. How loud?');
    expect(calls).toContain('addLabel 7 needs-info');
    expect(calls.filter((call) => call.startsWith('move'))).toEqual([]);
  });

  it('throws when triage.json is missing', async () => {
    await expect(runStage(fakeCtx(null), 7)).rejects.toThrow('no .factory/triage.json');
  });

  it.each([
    ['not json', 'Unexpected'],
    ['[]', 'unknown verdict'],
    [verdict({ verdict: 'maybe' }), 'unknown verdict: maybe'],
    [verdict({ reason: '' }), 'reason'],
    [verdict({ verdict: 'unclear', questions: [] }), 'at least one'],
    [verdict({ verdict: 'unclear', questions: [3] }), 'at least one'],
    [JSON.stringify({ verdict: 'unclear', reason: 'x' }), 'at least one'],
  ])('throws on a bad triage.json %#', async (text, message) => {
    await expect(runStage(fakeCtx(text), 7)).rejects.toThrow(message);
    expect(calls.filter((call) => /^(comment|move|close|addLabel)/.test(call))).toEqual([]);
  });
});
