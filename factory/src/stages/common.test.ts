import { mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentRun, Ctx } from '../types';
import { EMPTY_STATE, writeState } from '../state';
import { agentHome, baseBranchFor, baseBranchOf, factoryPaths, fillPrompt, modelFor, runAgent } from './common';

function agentCtx(labels: string[]): { ctx: Ctx; runs: AgentRun[]; logs: string[] } {
  const runs: AgentRun[] = [];
  const logs: string[] = [];
  const ctx = {
    cfg: { home: 'tmp/factory-common-test', designModel: 'opus-id', buildModel: 'sonnet-id' },
    github: { issue: async () => ({ labels }) },
    container: { agent: async (run: AgentRun) => { runs.push(run); } },
    log: (_stage: string, _issue: number | null, msg: string) => { logs.push(msg); },
  } as unknown as Ctx;
  return { ctx, runs, logs };
}

describe('runAgent network', () => {
  it('uses the restricted network without the open-network label', async () => {
    const { ctx, runs, logs } = agentCtx(['bug']);
    await runAgent(ctx, 7, 'design', 'p');
    expect(runs[0].openNetwork).toBe(false);
    expect(logs).toEqual(['agent model opus-id', 'agent runs on the restricted network']);
  });

  it('uses the open network with the open-network label', async () => {
    const { ctx, runs, logs } = agentCtx(['bug', 'open-network']);
    await runAgent(ctx, 7, 'design', 'p');
    expect(runs[0].openNetwork).toBe(true);
    expect(logs[1]).toContain('open network');
  });
});

describe('model routing', () => {
  const cfg = { designModel: 'opus-id', buildModel: 'sonnet-id' };
  const stages = ['triage', 'design', 'implement', 'testing'] as const;
  const pick = (labels: string[]) => stages.map((stage) => modelFor(cfg, stage, labels));

  it('keeps the baseline with no label: triage Sonnet, design Opus, implementation and testing Sonnet', () => {
    expect(pick([])).toEqual(['sonnet-id', 'opus-id', 'sonnet-id', 'sonnet-id']);
  });

  it('design-sonnet forces Sonnet for design only', () => {
    expect(pick(['design-sonnet'])).toEqual(['sonnet-id', 'sonnet-id', 'sonnet-id', 'sonnet-id']);
  });

  it('implementation-opus forces Opus for implementation and testing, never triage', () => {
    expect(pick(['implementation-opus'])).toEqual(['sonnet-id', 'opus-id', 'opus-id', 'opus-id']);
  });

  it('both labels apply independently', () => {
    expect(pick(['design-sonnet', 'implementation-opus'])).toEqual(['sonnet-id', 'sonnet-id', 'opus-id', 'opus-id']);
  });

  it('runAgent reads the labels at each run, so a manual change counts on the next one', async () => {
    const labels: string[] = ['implementation-opus'];
    const { ctx, runs } = agentCtx(labels);
    await runAgent(ctx, 7, 'testing', 'p');
    labels.length = 0;
    await runAgent(ctx, 7, 'testing', 'p');
    expect(runs.map((run) => run.model)).toEqual(['opus-id', 'sonnet-id']);
  });
});

describe('fillPrompt', () => {
  it('fills every variable', () => {
    const text = fillPrompt('design', { issue: '7', taskFile: 'docs/tasks/issue-7.md', branch: 'factory/issue-7' });
    expect(text).toContain('docs/tasks/issue-7.md');
    expect(text).not.toContain('{{');
  });

  it('throws on an unfilled variable', () => {
    expect(() => fillPrompt('design', { issue: '7' })).toThrow('unfilled {{');
  });
});

describe('factoryPaths', () => {
  it('finds agent messages and task files in a diff', () => {
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n+x\ndiff --git a/.factory-tasks/issue-8.md b/.factory-tasks/issue-8.md\n+y\ndiff --git a/.factory/approval.json b/.factory/approval.json\n';
    expect(factoryPaths(diff)).toEqual(['.factory-tasks/issue-8.md', '.factory/approval.json']);
  });
});

describe('factoryPaths at any depth', () => {
  it('finds agent folders under game/ and factory/', () => {
    const diff = 'diff --git a/game/.factory/a.json b/game/.factory/a.json\n+x\ndiff --git a/factory/.factory-tasks/issue-1.md b/factory/.factory-tasks/issue-1.md\n+y\ndiff --git a/game/src/.factoryish/a.ts b/game/src/.factoryish/a.ts\n+z\n';
    expect(factoryPaths(diff)).toEqual(['game/.factory/a.json', 'factory/.factory-tasks/issue-1.md']);
  });

  it('refuses .github only at the root', () => {
    expect(factoryPaths('diff --git a/game/.github/x b/game/.github/x\n')).toEqual([]);
  });
});

describe('agentHome', () => {
  it('joins the clone and the agent folder', () => {
    expect(agentHome('/w/c', 'game')).toBe('/w/c/game');
  });
});

describe('factoryPaths and workflows', () => {
  it('refuses GitHub workflow files', () => {
    expect(factoryPaths('diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n+on: push\n')).toEqual(['.github/workflows/x.yml']);
  });
});

describe('base branch', () => {
  const statePath = 'tmp/factory-common-test/state.json';
  const withRelease = () => {
    mkdirSync('tmp/factory-common-test', { recursive: true });
    writeState(statePath, { ...structuredClone(EMPTY_STATE), release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [] } });
  };
  const ctxWith = (labels: string[]) => ({ statePath, github: { issue: async () => ({ labels }) } }) as unknown as Ctx;

  it('is dev for an ordinary card, whatever the state holds', async () => {
    withRelease();
    expect(baseBranchFor(ctxWith([]), ['bug'])).toBe('dev');
    expect(await baseBranchOf(ctxWith(['feature-request']), 7)).toBe('dev');
  });

  it('is the release branch for a release task', async () => {
    withRelease();
    expect(baseBranchFor(ctxWith([]), ['release-task', 'maintenance'])).toBe('release/2026-09-29');
    expect(await baseBranchOf(ctxWith(['release-task']), 7)).toBe('release/2026-09-29');
  });

  it('is main for a hotfix, also with no release open', async () => {
    expect(baseBranchFor(ctxWith([]), ['bug', 'hotfix'])).toBe('main');
    expect(await baseBranchOf(ctxWith(['hotfix', 'release-task']), 7)).toBe('main');
  });

  it('throws for a release task when no release is open', async () => {
    mkdirSync('tmp/factory-common-test', { recursive: true });
    writeState(statePath, structuredClone(EMPTY_STATE));
    expect(() => baseBranchFor(ctxWith([]), ['release-task'])).toThrow('needs an open release');
    await expect(baseBranchOf(ctxWith(['release-task']), 7)).rejects.toThrow('needs an open release');
  });
});
