import { BRANCH, TASK_FILE, type Ctx } from '../types';
import { BASE_BRANCH, fillPrompt, guardAndPush, resetOutputs, runAgent, throwIfNeedsCommittee, workDir } from './common';

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = workDir(ctx, issue);
  await ctx.repo.prepareWorkClone(BRANCH(issue), BASE_BRANCH, clone);
  resetOutputs(clone);
  const before = await ctx.repo.headHash(BRANCH(issue));
  await runAgent(ctx, issue, 'implement', ctx.cfg.buildModel, fillPrompt('implement', { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  throwIfNeedsCommittee(clone);
  await ctx.repo.fetchFromWork(clone, BRANCH(issue));
  if ((await ctx.repo.headHash(BRANCH(issue))) === before) throw new Error('The implementation stage made no new commits');
  await guardAndPush(ctx, issue, BASE_BRANCH);
  await ctx.github.move(issue, 'Testing');
}
