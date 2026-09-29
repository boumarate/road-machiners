import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runStage } from './design';
import type { AgentRun, Ctx } from '../types';

let home = '';
let calls: string[] = [];
let diff = '';

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-design-');
  calls = [];
  diff = '';
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(agent: (run: AgentRun) => void): Ctx {
  const record = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); };
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet', repo: 'o/r' },
    github: {
      issue: async () => ({ number: 7, title: 'Big horn', body: 'Add a horn', labels: [], createdAt: '', state: 'OPEN', author: 'anna', thumbsUp: [] }),
      comments: async () => [{ login: 'a', body: 'yes please' }],
      comment: record('comment'), addLabel: record('addLabel'), close: record('close'), move: record('move'),
    },
    container: { agent: async (run: AgentRun) => { calls.push('agent'); agent(run); } },
    repo: {
      sync: record('sync'), push: record('push'), fetchFromWork: record('fetch'),
      prepareWorkClone: async (_b: string, _base: string, dir: string) => { mkdirSync(dir, { recursive: true }); },
      diff: async () => diff,
    },
  };
  return fake as unknown as Ctx;
}

const PLAN = '# Task\n\n## Plan\n- step one\n\n## Verify\n';

describe('design stage', () => {
  it('comments, labels, closes and moves to Done on won\'t do', async () => {
    await runStage(fakeCtx((run) => writeFileSync(`${run.clone}/.factory/wont-do.md`, 'Against the design.\n')), 7);
    expect(calls).toContain('comment 7 Against the design.');
    expect(calls).toContain('addLabel 7 wont-do');
    expect(calls).toContain('close 7 not planned');
    expect(calls).toContain('move 7 Done');
    expect(calls).not.toContain('push factory/issue-7');
  });

  it('asks the author, moves back to Triage and pushes nothing on questions', async () => {
    const ctx = fakeCtx((run) => writeFileSync(`${run.clone}/.factory/questions.md`, 'Which horn?\n\n  How loud?\n'));
    await runStage(ctx, 7);
    const post = calls.find((call) => call.startsWith('comment 7 ## Questions from the factory')) ?? '';
    expect(post).toContain('@anna');
    expect(post).toContain('1. Which horn?\n2. How loud?');
    expect(calls).toContain('addLabel 7 needs-info');
    expect(calls.at(-1)).toBe('move 7 Triage');
    expect(calls.filter((call) => call.startsWith('push'))).toEqual([]);
  });

  it('checks questions before wont-do and the plan', async () => {
    const ctx = fakeCtx((run) => {
      writeFileSync(`${run.clone}/.factory/questions.md`, 'Which horn?');
      writeFileSync(`${run.clone}/.factory/wont-do.md`, 'No.');
    });
    await runStage(ctx, 7);
    expect(calls).not.toContain('close 7 not planned');
    expect(calls.at(-1)).toBe('move 7 Triage');
  });

  it('throws on an empty questions file', async () => {
    await expect(runStage(fakeCtx((run) => writeFileSync(`${run.clone}/.factory/questions.md`, '\n')), 7)).rejects.toThrow('empty questions.md');
  });

  it('pushes and moves to Implementation on a plan', async () => {
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/docs/tasks`, { recursive: true });
      writeFileSync(`${run.clone}/docs/tasks/issue-7.md`, PLAN);
    });
    await runStage(ctx, 7);
    expect(calls).toContain('push factory/issue-7');
    expect(calls.at(-1)).toBe('move 7 Implementation');
  });

  it('writes the issue input as untrusted text', async () => {
    let seen = '';
    await runStage(fakeCtx((run) => {
      seen = run.prompt;
      mkdirSync(`${run.clone}/docs/tasks`, { recursive: true });
      writeFileSync(`${run.clone}/docs/tasks/issue-7.md`, PLAN);
    }), 7);
    expect(seen).toContain('docs/tasks/issue-7.md');
    expect(seen).toContain('factory/issue-7');
  });

  it('throws when the plan is empty', async () => {
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/docs/tasks`, { recursive: true });
      writeFileSync(`${run.clone}/docs/tasks/issue-7.md`, '# Task\n\n## Plan\n\n## Verify\n');
    });
    await expect(runStage(ctx, 7)).rejects.toThrow('Plan');
  });

  it('throws the committee text', async () => {
    const ctx = fakeCtx((run) => writeFileSync(`${run.clone}/.factory/needs-committee.md`, 'Bump the save?'));
    await expect(runStage(ctx, 7)).rejects.toThrow('Bump the save?');
  });

  it('does not push when the diff bumps SAVE_MAJOR', async () => {
    diff = 'diff --git a/src/three/save-migrations.ts b/src/three/save-migrations.ts\n@@ -1 +1 @@\n-const SAVE_MAJOR = 1;\n+const SAVE_MAJOR = 2;\n';
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/docs/tasks`, { recursive: true });
      writeFileSync(`${run.clone}/docs/tasks/issue-7.md`, PLAN);
    });
    await expect(runStage(ctx, 7)).rejects.toThrow('SAVE_MAJOR');
    expect(calls.filter((call) => call.startsWith('push'))).toEqual([]);
    expect(calls.filter((call) => call.startsWith('move'))).toEqual([]);
  });
});
