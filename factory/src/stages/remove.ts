import { rmSync } from 'node:fs';
import { deployDev } from '../deploy';
import { readState, updateState } from '../state';
import { BRANCH, FEEDBACK_HEADING, type Ctx } from '../types';
import { BASE_BRANCH, agentLog, workDir } from './common';
import { requireRelease } from './release-common';

// Takes a feature out of the release (IV4). The revert leaves the feature on neither the release branch nor dev.
export async function remove(ctx: Ctx, issue: number): Promise<void> {
  const removal = readState(ctx.statePath).pendingRemovals.find((item) => item.issue === issue);
  if (!removal) throw new Error(`No removal of issue #${issue} is queued`);
  const release = requireRelease(ctx);
  await ctx.repo.sync(release.branch);
  // Each branch is pushed right after its revert, so a later failure never leaves a local revert that a later push would carry.
  const onRelease = await revertAndPush(ctx, issue, release.branch);
  // The release branch changed, so the candidate post no longer matches it. Ship must not run on it, even if the dev revert fails.
  if (onRelease) updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null } }));
  const onDev = await revertAndPush(ctx, issue, BASE_BRANCH);
  if (!onRelease && !onDev) throw new Error(`Neither ${release.branch} nor ${BASE_BRANCH} has a merge of issue #${issue}`);
  await deployDev(ctx, agentLog(ctx, issue, 'remove'));
  // The old branch would make git skip its reverted commits on a second merge, so a redo starts fresh from the base branch.
  await ctx.repo.deleteBranch(BRANCH(issue));
  rmSync(workDir(ctx, issue), { recursive: true, force: true });
  rmSync(`${ctx.cfg.home}/work/check-issue-${issue}`, { recursive: true, force: true });
  await ctx.github.reopen(issue);
  await ctx.github.comment(issue, `${FEEDBACK_HEADING}\n\nRemoved from release ${release.day} by ${removal.by}:\n\n${removal.text}`);
  await ctx.github.move(issue, 'Design');
  // Ship reads postId, so the old candidate post can no longer ship this release.
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null, removed: [...state.release.removed, issue] } }));
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Issue #${issue} is out of release ${release.day} and back in design. A new candidate follows when the release tasks are done.`);
}

async function revertAndPush(ctx: Ctx, issue: number, branch: string): Promise<boolean> {
  if (!(await ctx.repo.revertIssueMerge(issue, branch))) return false;
  await ctx.repo.push(branch);
  return true;
}
