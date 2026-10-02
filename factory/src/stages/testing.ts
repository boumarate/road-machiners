import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readEvidence, type Evidence } from '../evidence';
import { postWithEvidence } from '../evidence-post';
import { checkScope, publishBuild, recordBuild } from '../deploy';
import { stripAnsi } from '../fail';
import { readState, updateState } from '../state';
import { BRANCH, GAME_DIR, MAINTENANCE_LABEL, OUT_DIR, RELEASE_TASK_LABEL, TASK_FILE, type Ctx, type InlineButton } from '../types';
import { HOTFIX_BASE, agentHome, agentLog, baseBranchFor, fillPrompt, guardAndPush, readOutput, resetOutputs, runAgent, throwIfNeedsCommittee, workDir } from './common';

// Each step logs its start time, so the log shows where the time goes.
// The typecheck runs beside the tests. The build ends the script, so a passing check leaves dist/ ready to publish.
// Only the build gets SAVE_SCOPE, since the tests expect the default save key.
const CHECK_SCRIPT = `set -e
step() { echo "[checks] $(date -u +%T) $1"; }
mkdir -p tmp
step "npm ci"
npm ci
step "tests and typecheck"
npm run typecheck > tmp/typecheck.log 2>&1 &
typecheck=$!
npm test
step "tests done"
if ! wait "$typecheck"; then cat tmp/typecheck.log; exit 1; fi
step "dev server"
npm run dev -- --port 5173 --strictPort > tmp/dev-server.log 2>&1 &
server=$!
ready=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:5173 > /dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then kill "$server"; exit 1; fi
step "playtest"
set +e
npm run playtest -- --cpu
code=$?
kill "$server"
if [ "$code" -ne 0 ]; then exit "$code"; fi
set -e
step "build"
SAVE_SCOPE="$BUILD_SCOPE" npm run build
step "done"
`;

export type Approval = { description: string; howToTry: string };

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  const item = await ctx.github.issue(issue);
  const base = baseBranchFor(ctx, item.labels);
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, workDir(ctx, issue));
  resetOutputs(home);
  const merged = await mergeBase(ctx, issue, base, home);
  let evidence = await agentRound(ctx, issue, 'test', base);
  await requireBaseMerged(ctx, issue, base, merged);
  let build = await ctx.repo.headHash(BRANCH(issue));
  const failure = await runChecks(ctx, issue, base, build);
  // The agent gets one round to fix what the factory's own checks found. A second failure stops the card.
  if (failure !== null) {
    writeFileSync(`${home}/${OUT_DIR}/check-failure.md`, failure);
    evidence = await agentRound(ctx, issue, 'test-fix', base);
    build = await ctx.repo.headHash(BRANCH(issue));
    const again = await runChecks(ctx, issue, base, build);
    if (again !== null) throw new Error(`The factory checks failed twice.\n${again}`);
  }
  const approval = readApproval(home);
  const url = publishBuild(ctx, checkDir(ctx, issue), build);
  recordBuild(ctx.statePath, issue, build);
  const approver = approvedAlready(ctx, issue, item.labels);
  if (approver === null) await post(ctx, issue, approval, evidence, url, base);
  await ctx.github.move(issue, 'Approval');
  if (approver !== null) queueMerge(ctx, issue, approver);
}

// Who approved the card before this round, or null when it needs a committee post.
// Cleanup tasks on the release branch skip the post, since the committee plays them in the candidate.
// A card approved before a conflict sent it back here keeps its approval.
function approvedAlready(ctx: Ctx, issue: number, labels: string[]): string | null {
  if (labels.includes(RELEASE_TASK_LABEL) && labels.includes(MAINTENANCE_LABEL)) return 'the factory';
  return readState(ctx.statePath).approvedResolving[String(issue)] ?? null;
}

// The merge runs as an approve job in the branch queue, like a member's approval, so it never races another branch job.
function queueMerge(ctx: Ctx, issue: number, by: string): void {
  updateState(ctx.statePath, (state) => ({ ...state, pendingApprovals: { ...state.pendingApprovals, [String(issue)]: by } }));
  ctx.log('testing', issue, `approved by ${by} already, merge queued`);
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

// Returns the evidence of the round, checked against the branch head the round left. A round that changed code must capture again.
async function agentRound(ctx: Ctx, issue: number, prompt: 'test' | 'test-fix', base: string): Promise<Evidence> {
  await runAgent(ctx, issue, 'testing', fillPrompt(prompt, { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  throwIfNeedsCommittee(home);
  readApproval(home);
  await guardAndPush(ctx, issue, base, 'testing');
  return readEvidence(home, await ctx.repo.headHash(BRANCH(issue)));
}

function readApproval(home: string): Approval {
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

function checkDir(ctx: Ctx, issue: number): string {
  return `${ctx.cfg.home}/work/check-issue-${issue}`;
}

// The host runs its own checks in a fresh clone of the pushed branch. Agent claims do not count.
// Passing checks leave the build of scope `build` in the clone. Returns null when they pass, or the tail of the check log when they fail.
async function runChecks(ctx: Ctx, issue: number, base: string, build: string): Promise<string | null> {
  checkScope(build);
  const dir = checkDir(ctx, issue);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${ctx.cfg.home}/work`, { recursive: true });
  await ctx.repo.prepareWorkClone(BRANCH(issue), base, dir);
  const log = agentLog(ctx, issue, 'checks');
  try {
    await ctx.container.shell(dir, CHECK_SCRIPT, log, { BUILD_SCOPE: build });
    return null;
  } catch (error) {
    return checkFailure(log, error);
  }
}

const FAILURE_TAIL_LINES = 150;

function checkFailure(log: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const tail = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-FAILURE_TAIL_LINES).join('\n') : message;
  return stripAnsi(tail);
}

// Telegram caps a photo caption at 1024 characters.
export const CAPTION_LIMIT = 1024;
const TRIM_MARK = '…';

// The approval post is the primary photo with everything in its caption, and the only post with buttons. The full notes also go on the issue.
// Further evidence images follow as a reply photo or album, which no command acts on.
export async function post(ctx: Ctx, issue: number, approval: Approval, evidence: Evidence, url: string, base: string): Promise<void> {
  const item = await ctx.github.issue(issue);
  const link = `https://github.com/${ctx.cfg.repo}/issues/${issue}`;
  const pr = await pullRequestUrl(ctx, issue, item.title, approval, base);
  await ctx.github.comment(issue, `Ready for approval: ${url}\n\n${approval.description}\n\nHow to try: ${approval.howToTry}`);
  const caption = approvalCaption(`#${issue} ${item.title}`, url, link, pr, approval, base);
  await postWithEvidence(ctx, evidence, caption, approvalButtons(issue, base), {
    add: (id) => updateState(ctx.statePath, (state) => ({ ...state, approvalPosts: { ...state.approvalPosts, [id]: issue }, postCaptions: { ...state.postCaptions, [id]: caption } })),
    drop: (id) => updateState(ctx.statePath, (state) => ({ ...state, approvalPosts: omit(state.approvalPosts, id), postCaptions: omit(state.postCaptions, id) })),
  });
}

function omit<T>(record: Record<string, T>, key: number): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== String(key)));
}

// A feedback round reuses the pull request of the first round.
async function pullRequestUrl(ctx: Ctx, issue: number, title: string, approval: Approval, base: string): Promise<string> {
  const open = await ctx.github.pullRequestFor(BRANCH(issue));
  if (open !== null) return open;
  const body = `Closes #${issue}.\n\n${approval.description}\n\nHow to try: ${approval.howToTry}\n\nThe factory merges it when the committee approves.`;
  return ctx.github.openPullRequest(BRANCH(issue), base, `#${issue} ${title}`, body);
}

export function approvalButtons(issue: number, base: string): InlineButton[][] {
  const approveText = base === HOTFIX_BASE ? 'Approve and ship to players' : 'Approve';
  return [[{ text: approveText, data: `factory:approve:${issue}` }, { text: 'Deny', data: `factory:deny:${issue}` }]];
}

export function approvalCaption(title: string, url: string, link: string, pr: string, approval: Approval, base: string): string {
  // A hotfix skips dev and the release, so its post opens with a warning the committee cannot miss.
  const warning = base === HOTFIX_BASE ? '⚠️ HOTFIX. Approve merges into main and ships to players at once. Play it with care.\n\n' : '';
  const head = `${warning}${title}\n\nPlay: ${url}\nIssue: ${link}\nPR: ${pr}`;
  const action = base === HOTFIX_BASE ? 'Approve ships this hotfix to main and itch.io at once.' : `Approve merges into ${base}.`;
  const tail = `${action} Deny closes the issue. A reply to this post sends feedback to design.`;
  const room = CAPTION_LIMIT - head.length - tail.length - '\n\n'.repeat(3).length - 'How to try: '.length;
  const [description, howToTry] = fitBoth(approval.description, approval.howToTry, room);
  return [head, description, `How to try: ${howToTry}`, tail].join('\n\n');
}

// Shortens the two texts to fit the room, cutting the longer one first. The full texts are on the issue.
function fitBoth(first: string, second: string, room: number): [string, string] {
  if (first.length + second.length <= room) return [first, second];
  const half = Math.floor(room / 2);
  const firstRoom = Math.max(half, room - second.length);
  const cutFirst = cut(first, firstRoom);
  return [cutFirst, cut(second, room - cutFirst.length)];
}

export function cut(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, room - TRIM_MARK.length).trimEnd()}${TRIM_MARK}`;
}
