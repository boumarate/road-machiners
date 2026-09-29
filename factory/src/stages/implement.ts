import { BRANCH, GAME_DIR, TASK_FILE, type Ctx } from '../types';
import { agentHome, baseBranchOf, fillPrompt, guardAndPush, resetOutputs, runAgent, throwIfNeedsCommittee, workDir } from './common';

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = workDir(ctx, issue);
  const base = await baseBranchOf(ctx, issue);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, clone);
  const home = agentHome(clone, GAME_DIR);
  resetOutputs(home);
  const before = await ctx.repo.headHash(BRANCH(issue));
  await runAgent(ctx, issue, 'implement', ctx.cfg.buildModel, fillPrompt('implement', { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  throwIfNeedsCommittee(home);
  await ctx.repo.fetchFromWork(clone, BRANCH(issue));
  if ((await ctx.repo.headHash(BRANCH(issue))) === before) throw new Error('The implementation stage made no new commits');
  await guardAndPush(ctx, issue, base);
  await ctx.github.move(issue, 'Testing');
}
