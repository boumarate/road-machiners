import { describe, expect, it } from 'vitest';
import { factoryPaths, fillPrompt } from './common';

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
