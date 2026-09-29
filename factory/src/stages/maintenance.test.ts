import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentRun } from '../types';
import { fake, reset } from './test-fakes';
import { maintenance } from './maintenance';

beforeEach(reset);

describe('maintenance', () => {
  it('closes the issue when the agent finds nothing', async () => {
    const f = fake();
    f.agentWrites = { 'nothing.md': 'All clean.' };
    await maintenance(f.ctx);
    expect(f.calls).toContain('comment All clean.');
    expect(f.calls).toContain('close not planned');
    expect(f.calls.some((call) => call.startsWith('push') || call === 'addCard Implementation')).toBe(false);
  });

  it('throws when the task file has no plan', async () => {
    const f = fake();
    f.agentWrites = { 'issue.md': 'Title\nBody' };
    await expect(maintenance(f.ctx)).rejects.toThrow();
  });

  it('retitles, pushes and adds the card when a plan exists', async () => {
    const f = fake();
    f.agentWrites = { 'issue.md': 'Speed up path\nSlow spot.' };
    const agent = f.ctx.container.agent;
    f.ctx.container.agent = async (run: AgentRun) => {
      await agent(run);
      mkdirSync(join(run.clone, '.factory-tasks'), { recursive: true });
      writeFileSync(join(run.clone, '.factory-tasks/issue-7.md'), '# T\n\n## Plan\n\n- do it\n\n## Other\n');
    };
    await maintenance(f.ctx);
    expect(f.calls.at(-1)).toBe('addCard Implementation');
    expect(f.calls).toContain('editIssue');
  });
});

