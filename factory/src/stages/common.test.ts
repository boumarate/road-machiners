import { describe, expect, it } from 'vitest';
import { agentHome, factoryPaths, fillPrompt } from './common';

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
