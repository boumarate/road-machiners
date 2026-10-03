import { rmSync } from 'node:fs';
import { deployDev } from '../deploy';
import { readState, updateState } from '../state';
import { BRANCH, FEEDBACK_HEADING, MergeConflictError, RELEASE_CANDIDATE_LABEL, WONT_DO_LABEL, type Ctx } from '../types';
import { BASE_BRANCH, HOTFIX_BASE, agentLog, baseBranchFor, workDir } from './common';
import { releaseBundle } from './bundle';
import { shipHotfix } from './hotfix';

async function requireApproval(ctx: Ctx, issue: number): Promise<void> {
  const card = (await ctx.github.cards()).find((item) => item.issue === issue);
  if (card?.column !== 'Approval') throw new Error(`Issue #${issue} is not in Approval, it is in ${card?.column ?? 'no column'}`);
}

function forgetPosts(ctx: Ctx, issue: number, dropPending: boolean): void {
  updateState(ctx.statePath, (state) => {
    const approvalPosts = Object.fromEntries(Object.entries(state.approvalPosts).filter(([, number]) => number !== issue));
    const pendingApprovals = { ...state.pendingApprovals };
    if (dropPending) delete pendingApprovals[String(issue)];
    const builds = { ...state.builds };
    delete builds[String(issue)];
    const approvedResolving = { ...state.approvedResolving };
    delete approvedResolving[String(issue)];
    const testPhase = { ...state.testPhase };
    delete testPhase[String(issue)];
    return { ...state, approvalPosts, pendingApprovals, builds, approvedResolving, testPhase };
  });
}

export async function approve(ctx: Ctx, issue: number, by: string): Promise<void> {
  await requireApproval(ctx, issue);
  const item = await ctx.github.issue(issue);
  const message = await mergeOrResolve(ctx, issue, item.title, by, baseBranchFor(ctx, item.labels));
  if (message === null) return;
  await ctx.github.move(issue, 'Done');
  forgetPosts(ctx, issue, true);
  rmSync(workDir(ctx, issue), { recursive: true, force: true });
  rmSync(`${ctx.cfg.home}/work/check-issue-${issue}`, { recursive: true, force: true });
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, message);
}

// Parallel work moves the base on after testing, so the branch may conflict with it. That is routine work, not an incident.
// The card goes back to Testing, which merges the base, lets the agent resolve the conflict and runs the checks again.
// Testing then queues the merge under the same approver, with no new post. Returns null in that case.
async function mergeOrResolve(ctx: Ctx, issue: number, title: string, by: string, base: string): Promise<string | null> {
  try {
    return await mergeApproved(ctx, issue, title, by, base);
  } catch (error) {
    if (!(error instanceof MergeConflictError) || error.branch !== BRANCH(issue)) throw error;
    forgetPosts(ctx, issue, true);
    updateState(ctx.statePath, (state) => ({ ...state, approvedResolving: { ...state.approvedResolving, [String(issue)]: by } }));
    await ctx.github.comment(issue, `${base} moved on since testing, and the branch conflicts with it in ${error.files.join(', ')}. Testing merges ${base} again and resolves the conflict. Then the approval by ${by} merges it, with no new post.`);
    await ctx.github.move(issue, 'Testing');
    ctx.log('approve', issue, `conflict with ${base}, back to Testing to resolve`);
    return null;
  }
}

// A hotfix ships at once. Other work stays open with the label until its release ships to main. Ship closes it and drops the label.
async function mergeApproved(ctx: Ctx, issue: number, title: string, by: string, base: string): Promise<string> {
  if (base === HOTFIX_BASE) return shipHotfix(ctx, issue, title, by);
  await ctx.repo.fetch();
  await ctx.repo.merge([{ branch: BRANCH(issue), into: base, message: `Merge issue #${issue}: ${title}` }]);
  const message = base === BASE_BRANCH ? await mergedIntoDev(ctx, issue, title, by) : await mergedIntoRelease(ctx, issue, title, by, base);
  await ctx.github.addLabel(issue, RELEASE_CANDIDATE_LABEL);
  return message;
}

// The pushed dev holds the branch head, so GitHub marks the pull request merged by itself.
async function mergedIntoDev(ctx: Ctx, issue: number, title: string, by: string): Promise<string> {
  await deployDev(ctx, agentLog(ctx, issue, 'approve'));
  await ctx.github.comment(issue, `Approved by ${by} in the committee chat and merged into dev. It closes when its release ships.`);
  return `Issue #${issue} ${title} is merged into dev.\nPlay it: ${ctx.cfg.publicUrl}/dev`;
}

// Release work never reaches dev by itself, so dev stays as it is until Ship. A feature back after a removal is in the release again.
// The played candidate lacks this work, so its post can no longer ship. The tick builds a new one.
async function mergedIntoRelease(ctx: Ctx, issue: number, title: string, by: string, branch: string): Promise<string> {
  updateState(ctx.statePath, (state) => (state.release ? { ...state, pendingShip: null, release: { ...state.release, postId: null, removed: state.release.removed.filter((n) => n !== issue) } } : state));
  await ctx.github.comment(issue, `Approved by ${by} and merged into the release branch ${branch}. It closes when the release ships.`);
  return `Issue #${issue} ${title} is merged into the release ${branch}.`;
}

// Feedback wins over an approval queued for the same issue, since the card leaves Approval. Returns whether it dropped one.
export async function feedback(ctx: Ctx, issue: number, by: string, text: string): Promise<boolean> {
  await requireApproval(ctx, issue);
  await ctx.github.comment(issue, `${FEEDBACK_HEADING}\n\nFrom ${by}:\n\n${text}`);
  await ctx.github.move(issue, 'Design');
  const dropped = String(issue) in readState(ctx.statePath).pendingApprovals;
  forgetPosts(ctx, issue, true);
  return dropped;
}

export async function deny(ctx: Ctx, issue: number, by: string): Promise<void> {
  await requireApproval(ctx, issue);
  const comment = `Denied by ${by} in the committee chat.`;
  await ctx.github.comment(issue, comment);
  if ((await ctx.github.pullRequestFor(BRANCH(issue))) !== null) await ctx.github.closePullRequest(BRANCH(issue), comment);
  await ctx.github.addLabel(issue, WONT_DO_LABEL);
  await ctx.github.close(issue, 'not planned');
  await ctx.github.move(issue, 'Done');
  forgetPosts(ctx, issue, true);
  await releaseBundle(ctx, issue, 'was denied');
}
