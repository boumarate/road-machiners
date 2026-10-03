import { writeFileSync } from 'node:fs';
import { readEvidence } from '../evidence';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, OUT_DIR, TASK_FILE, type Ctx, type TestPhase } from '../types';
import { reviewGate } from './review';
import { agentHome, baseBranchFor, fillPrompt, guardAndPush, prepareOutputs, readOutput, runAgent, throwIfNeedsCommittee, workDir } from './common';

export type Approval = { description: string; howToTry: string };

// The agent half of testing. It runs in the verify queue, so the test slot stays free for the factory's own checks.
// A card with no phase gets the full round: base merge, test agent and review. A card in phase `fix` gets only the fix of a failed check.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  if (readState(ctx.statePath).testPhase[String(issue)] === 'fix') return fixRound(ctx, issue, base);
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  prepareOutputs(ctx, issue, home);
  const merged = await mergeBase(ctx, issue, base, home);
  await agentRound(ctx, issue, 'test', 'test', base);
  await requireBaseMerged(ctx, issue, base, merged);
  if (!(await reviewGate(ctx, issue, base, () => agentRound(ctx, issue, 'test-fix', 'review-fix', base)))) return;
  setPhase(ctx, issue, 'checks');
}

// The checks stage left the end of its log in `.factory/check-failure.md`, next to the approval and evidence of the first round.
async function fixRound(ctx: Ctx, issue: number, base: string): Promise<void> {
  if (readOutput(agentHome(workDir(ctx, issue), GAME_DIR), 'check-failure.md') === null) throw new Error(`Issue #${issue} waits for a check fix, but its work clone has no .factory/check-failure.md`);
  await agentRound(ctx, issue, 'test-fix', 'checks-fix', base);
  setPhase(ctx, issue, 'checks-after-fix');
}

export function setPhase(ctx: Ctx, issue: number, phase: TestPhase): void {
  updateState(ctx.statePath, (state) => ({ ...state, testPhase: { ...state.testPhase, [String(issue)]: phase } }));
  ctx.log('verify', issue, `test phase ${phase}`);
}

// The base moved on since design cut the branch. Testing runs on the branch with the current base merged in,
// so the committee plays what approve will merge, and conflicts reach the agent here instead of failing approve.
// Returns the base commit it merged.
async function mergeBase(ctx: Ctx, issue: number, base: string, home: string): Promise<string> {
  await ctx.repo.fetch();
  const { commit, conflicts } = await ctx.repo.mergeBaseIntoWork(workDir(ctx, issue), base);
  if (conflicts.length > 0) writeFileSync(`${home}/${OUT_DIR}/merge-conflicts.md`, `${conflicts.map((file) => `- ${file}`).join('\n')}\n`);
  return commit;
}

// Checks the commit merged above, not the base branch. A parallel approval may move the base on meanwhile, and approve merges that newer base anyway.
async function requireBaseMerged(ctx: Ctx, issue: number, base: string, commit: string): Promise<void> {
  if (!(await ctx.repo.isMerged(commit, BRANCH(issue)))) throw new Error(`The testing agent left the merge of ${base} at ${commit.slice(0, 7)} into ${BRANCH(issue)} unfinished.`);
}

// `round` names the session, so the review's fix and the checks' fix each resume their own conversation.
// The checks stage reads the approval and the evidence the last round left, and checks the evidence against the branch head.
async function agentRound(ctx: Ctx, issue: number, prompt: 'test' | 'test-fix', round: 'test' | 'review-fix' | 'checks-fix', base: string): Promise<void> {
  await runAgent(ctx, issue, 'verify', round, fillPrompt(prompt, { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  throwIfNeedsCommittee(home);
  readApproval(home);
  await guardAndPush(ctx, issue, base, 'verify');
  readEvidence(home, await ctx.repo.headHash(BRANCH(issue)));
}

export function readApproval(home: string): Approval {
  const raw = readOutput(home, 'approval.json');
  if (raw === null) throw new Error('The testing stage wrote no .factory/approval.json');
  if (readOutput(home, 'screenshot.png') === null) throw new Error('The testing stage wrote no .factory/screenshot.png');
  return parseApproval(JSON.parse(raw));
}

function parseApproval(data: unknown): Approval {
  const { description, howToTry } = (data ?? {}) as Record<string, unknown>;
  if (typeof description !== 'string' || typeof howToTry !== 'string') throw new Error('.factory/approval.json needs string fields description and howToTry');
  return { description, howToTry };
}
