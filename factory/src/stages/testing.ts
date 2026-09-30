import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { checkScope, publishBuild, recordBuild } from '../deploy';
import { stripAnsi } from '../fail';
import { updateState } from '../state';
import { BRANCH, GAME_DIR, MAINTENANCE_LABEL, OUT_DIR, RELEASE_TASK_LABEL, TASK_FILE, type Ctx } from '../types';
import { approve } from './approval';
import { agentHome, agentLog, baseBranchFor, fillPrompt, guardAndPush, readOutput, resetOutputs, runAgent, throwIfNeedsCommittee, workDir } from './common';

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
  await agentRound(ctx, issue, 'test', base);
  let build = await ctx.repo.headHash(BRANCH(issue));
  const failure = await runChecks(ctx, issue, base, build);
  // The agent gets one round to fix what the factory's own checks found. A second failure stops the card.
  if (failure !== null) {
    writeFileSync(`${home}/${OUT_DIR}/check-failure.md`, failure);
    await agentRound(ctx, issue, 'test-fix', base);
    build = await ctx.repo.headHash(BRANCH(issue));
    const again = await runChecks(ctx, issue, base, build);
    if (again !== null) throw new Error(`The factory checks failed twice.\n${again}`);
  }
  const approval = readApproval(home);
  const url = publishBuild(ctx, checkDir(ctx, issue), build);
  recordBuild(ctx.statePath, issue, build);
  // Cleanup tasks on the release branch skip the committee post. The committee plays them in the candidate.
  const cleanup = item.labels.includes(RELEASE_TASK_LABEL) && item.labels.includes(MAINTENANCE_LABEL);
  if (!cleanup) await post(ctx, issue, approval, `${home}/${OUT_DIR}/screenshot.png`, url, base);
  await ctx.github.move(issue, 'Approval');
  if (cleanup) await mergeCleanup(ctx, issue);
}

// approve() requires the Approval column. A failed merge puts the card back in Testing, so the stuck label the caller adds can be removed to retry.
async function mergeCleanup(ctx: Ctx, issue: number): Promise<void> {
  try {
    await approve(ctx, issue, 'the factory');
  } catch (error) {
    await ctx.github.move(issue, 'Testing');
    throw error;
  }
}

async function agentRound(ctx: Ctx, issue: number, prompt: 'test' | 'test-fix', base: string): Promise<void> {
  await runAgent(ctx, issue, 'testing', ctx.cfg.buildModel, fillPrompt(prompt, { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  throwIfNeedsCommittee(home);
  readApproval(home);
  await guardAndPush(ctx, issue, base);
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

// The approval post is one photo with everything in its caption. The full notes also go on the issue.
export async function post(ctx: Ctx, issue: number, approval: Approval, screenshot: string, url: string, base: string): Promise<void> {
  const item = await ctx.github.issue(issue);
  const link = `https://github.com/${ctx.cfg.repo}/issues/${issue}`;
  const pr = await pullRequestUrl(ctx, issue, item.title, approval, base);
  await ctx.github.comment(issue, `Ready for approval: ${url}\n\n${approval.description}\n\nHow to try: ${approval.howToTry}`);
  const caption = approvalCaption(`#${issue} ${item.title}`, url, link, pr, approval, base);
  const buttons = [[{ text: 'Approve', data: `factory:approve:${issue}` }, { text: 'Deny', data: `factory:deny:${issue}` }]];
  const photoId = await ctx.telegram.sendPhoto(ctx.cfg.committeeChat, screenshot, caption, buttons);
  updateState(ctx.statePath, (state) => ({ ...state, approvalPosts: { ...state.approvalPosts, [photoId]: issue } }));
}

// A feedback round reuses the pull request of the first round.
async function pullRequestUrl(ctx: Ctx, issue: number, title: string, approval: Approval, base: string): Promise<string> {
  const open = await ctx.github.pullRequestFor(BRANCH(issue));
  if (open !== null) return open;
  const body = `Closes #${issue}.\n\n${approval.description}\n\nHow to try: ${approval.howToTry}\n\nThe factory merges it when the committee approves.`;
  return ctx.github.openPullRequest(BRANCH(issue), base, `#${issue} ${title}`, body);
}

export function approvalCaption(title: string, url: string, link: string, pr: string, approval: Approval, base: string): string {
  const head = `${title}\n\nPlay: ${url}\nIssue: ${link}\nPR: ${pr}`;
  const tail = `Approve merges into ${base}. Deny closes the issue. A reply to this post sends feedback to design.`;
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
