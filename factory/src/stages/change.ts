import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { updateState, readState } from '../state';
import { OUT_DIR, type Ctx } from '../types';
import { agentLog, fillPrompt, readOutput, resetOutputs } from './common';

// Every path a unified diff touches, from its `diff --git a/x b/y` headers.
export function diffPaths(diff: string): string[] {
  const paths: string[] = [];
  for (const match of diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)) paths.push(match[1], match[2]);
  return [...new Set(paths)];
}

// Runs one committee request to change the factory itself and opens a pull request that only a human merges.
export async function change(ctx: Ctx, id: number): Promise<void> {
  const request = readState(ctx.statePath).pendingChanges.find((item) => item.id === id);
  if (!request) throw new Error(`no pending factory change ${id}`);
  const dir = join(ctx.cfg.home, 'work', `change-${id}`);
  const branch = `factory-change/${id}`;
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.sync();
  await ctx.repo.prepareWorkClone(branch, 'dev', dir);
  resetOutputs(dir);
  mkdirSync(join(dir, OUT_DIR), { recursive: true });
  writeFileSync(join(dir, OUT_DIR, 'request.md'), `Committee request from ${request.by}:\n\n${request.text}\n`);
  await ctx.container.agent({ clone: dir, model: ctx.cfg.buildModel, prompt: fillPrompt('change', {}), log: agentLog(ctx, id, 'change') });
  await ctx.repo.fetchFromWork(dir, branch);
  if (!(await ctx.repo.hasNewCommits('dev', branch))) throw new Error(`change ${id} made no commits`);
  const outside = diffPaths(await ctx.repo.diff('dev', branch)).filter((path) => !path.startsWith('factory/'));
  if (outside.length > 0) throw new Error(`change ${id} touches files outside factory/: ${outside.join(', ')}`);
  await ctx.repo.push(branch);
  const title = readOutput(dir, 'pr-title.txt')?.trim().split('\n')[0] || `Factory change ${id}`;
  const body = `Requested by ${request.by}:\n\n${request.text}\n\nThe factory never merges this pull request. A human reviews and merges it.`;
  const url = await ctx.github.openPullRequest(branch, 'dev', title, body);
  updateState(ctx.statePath, (state) => ({ ...state, pendingChanges: state.pendingChanges.filter((item) => item.id !== id) }));
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Factory change ${id} is ready for review: ${url}`);
  ctx.log('change', id, `opened ${url}`);
}
