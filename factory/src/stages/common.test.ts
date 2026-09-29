import { describe, expect, it } from 'vitest';
import type { AgentRun, Ctx } from '../types';
import { agentHome, factoryPaths, fillPrompt, runAgent } from './common';

function agentCtx(labels: string[]): { ctx: Ctx; runs: AgentRun[]; logs: string[] } {
  const runs: AgentRun[] = [];
  const logs: string[] = [];
  const ctx = {
    cfg: { home: 'tmp/factory-common-test' },
    github: { issue: async () => ({ labels }) },
    container: { agent: async (run: AgentRun) => { runs.push(run); } },
    log: (_stage: string, _issue: number | null, msg: string) => { logs.push(msg); },
  } as unknown as Ctx;
  return { ctx, runs, logs };
}

describe('runAgent network', () => {
  it('uses the restricted network without the open-network label', async () => {
    const { ctx, runs, logs } = agentCtx(['bug']);
    await runAgent(ctx, 7, 'design', 'opus', 'p');
    expect(runs[0].openNetwork).toBe(false);
    expect(logs).toEqual(['agent runs on the restricted network']);
  });

  it('uses the open network with the open-network label', async () => {
    const { ctx, runs, logs } = agentCtx(['bug', 'open-network']);
    await runAgent(ctx, 7, 'design', 'opus', 'p');
    expect(runs[0].openNetwork).toBe(true);
    expect(logs[0]).toContain('open network');
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
