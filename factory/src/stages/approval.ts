import { rmSync } from 'node:fs';
import { deployDev } from '../deploy';
import { updateState } from '../state';
import { BRANCH, FEEDBACK_HEADING, type Ctx } from '../types';
import { BASE_BRANCH, agentLog, workDir } from './common';

async function requireApproval(ctx: Ctx, issue: number): Promise<void> {
  const card = (await ctx.github.cards()).find((item) => item.issue === issue);
  if (card?.column !== 'Approval') throw new Error(`Issue #${issue} is not in Approval, it is in ${card?.column ?? 'no column'}`);
}

function forgetPosts(ctx: Ctx, issue: number, dropPending: boolean): void {
  updateState(ctx.statePath, (state) => {
    const approvalPosts = Object.fromEntries(Object.entries(state.approvalPosts).filter(([, number]) => number !== issue));
    const pendingApprovals = { ...state.pendingApprovals };
    if (dropPending) delete pendingApprovals[String(issue)];
    return { ...state, approvalPosts, pendingApprovals };
  });
}

export async function approve(ctx: Ctx, issue: number, by: string): Promise<void> {
  await requireApproval(ctx, issue);
  await ctx.repo.sync();
  const item = await ctx.github.issue(issue);
  await ctx.repo.merge(BRANCH(issue), BASE_BRANCH, `Merge issue #${issue}: ${item.title}`);
  await ctx.repo.push(BASE_BRANCH);
  await deployDev(ctx, agentLog(ctx, issue, 'approve'));
  await ctx.github.comment(issue, `Approved by ${by} in the committee chat and merged into dev.`);
  await ctx.github.close(issue, 'completed');
  await ctx.github.move(issue, 'Done');
  forgetPosts(ctx, issue, true);
  rmSync(workDir(ctx, issue), { recursive: true, force: true });
  rmSync(`${ctx.cfg.home}/work/check-issue-${issue}`, { recursive: true, force: true });
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Issue #${issue} ${item.title} is merged into dev.\nPlay it: ${ctx.cfg.publicUrl}/dev`);
}

export async function feedback(ctx: Ctx, issue: number, by: string, text: string): Promise<void> {
  await requireApproval(ctx, issue);
  await ctx.github.comment(issue, `${FEEDBACK_HEADING}\n\nFrom ${by}:\n\n${text}`);
  await ctx.github.move(issue, 'Design');
  forgetPosts(ctx, issue, false);
}
