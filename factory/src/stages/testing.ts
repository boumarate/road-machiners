import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildAndDeploy, recordBuild } from '../deploy';
import { stripAnsi } from '../fail';
import { updateState } from '../state';
import { BRANCH, GAME_DIR, OUT_DIR, TASK_FILE, type Ctx } from '../types';
import { BASE_BRANCH, agentHome, agentLog, fillPrompt, guardAndPush, readOutput, resetOutputs, runAgent, throwIfNeedsCommittee, workDir } from './common';

const CHECK_SCRIPT = `set -e
npm ci
npm test
npm run typecheck
mkdir -p tmp
npm run dev -- --port 5173 --strictPort > tmp/dev-server.log 2>&1 &
server=$!
ready=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:5173 > /dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then kill "$server"; exit 1; fi
set +e
npm run playtest -- --cpu
code=$?
kill "$server"
exit $code
`;

export type Approval = { description: string; howToTry: string };

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  await ctx.repo.prepareWorkClone(BRANCH(issue), BASE_BRANCH, workDir(ctx, issue));
  resetOutputs(home);
  await agentRound(ctx, issue, 'test');
  const failure = await runChecks(ctx, issue);
  // The agent gets one round to fix what the factory's own checks found. A second failure stops the card.
  if (failure !== null) {
    writeFileSync(`${home}/${OUT_DIR}/check-failure.md`, failure);
    await agentRound(ctx, issue, 'test-fix');
    const again = await runChecks(ctx, issue);
    if (again !== null) throw new Error(`The factory checks failed twice.\n${again}`);
  }
  const approval = readApproval(home);
  const build = await ctx.repo.headHash(BRANCH(issue));
  const url = await buildAndDeploy(ctx, checkDir(ctx, issue), build, agentLog(ctx, issue, 'checks'));
  recordBuild(ctx.statePath, issue, build);
  await post(ctx, issue, approval, `${home}/${OUT_DIR}/screenshot.png`, url);
  await ctx.github.move(issue, 'Approval');
}

async function agentRound(ctx: Ctx, issue: number, prompt: 'test' | 'test-fix'): Promise<void> {
  await runAgent(ctx, issue, 'testing', ctx.cfg.buildModel, fillPrompt(prompt, { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  throwIfNeedsCommittee(home);
  readApproval(home);
  await guardAndPush(ctx, issue, BASE_BRANCH);
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
// Returns null when they pass, or the tail of the check log when they fail.
async function runChecks(ctx: Ctx, issue: number): Promise<string | null> {
  const dir = checkDir(ctx, issue);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${ctx.cfg.home}/work`, { recursive: true });
  await ctx.repo.prepareWorkClone(BRANCH(issue), BASE_BRANCH, dir);
  const log = agentLog(ctx, issue, 'checks');
  try {
    await ctx.container.shell(dir, CHECK_SCRIPT, log);
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
const CAPTION_LIMIT = 1024;
const TRIM_MARK = '…';

// The approval post is one photo with everything in its caption. The full notes also go on the issue.
export async function post(ctx: Ctx, issue: number, approval: Approval, screenshot: string, url: string): Promise<void> {
  const item = await ctx.github.issue(issue);
  const link = `https://github.com/${ctx.cfg.repo}/issues/${issue}`;
  const pr = await pullRequestUrl(ctx, issue, item.title, approval);
  await ctx.github.comment(issue, `Ready for approval: ${url}\n\n${approval.description}\n\nHow to try: ${approval.howToTry}`);
  const caption = approvalCaption(`#${issue} ${item.title}`, url, link, pr, approval);
  const buttons = [[{ text: 'Approve', data: `factory:approve:${issue}` }, { text: 'Deny', data: `factory:deny:${issue}` }]];
  const photoId = await ctx.telegram.sendPhoto(ctx.cfg.committeeChat, screenshot, caption, buttons);
  updateState(ctx.statePath, (state) => ({ ...state, approvalPosts: { ...state.approvalPosts, [photoId]: issue } }));
}

// A feedback round reuses the pull request of the first round.
async function pullRequestUrl(ctx: Ctx, issue: number, title: string, approval: Approval): Promise<string> {
  const open = await ctx.github.pullRequestFor(BRANCH(issue));
  if (open !== null) return open;
  const body = `Closes #${issue}.\n\n${approval.description}\n\nHow to try: ${approval.howToTry}\n\nThe factory merges it when the committee approves.`;
  return ctx.github.openPullRequest(BRANCH(issue), BASE_BRANCH, `#${issue} ${title}`, body);
}

export function approvalCaption(title: string, url: string, link: string, pr: string, approval: Approval): string {
  const head = `${title}\n\nPlay: ${url}\nIssue: ${link}\nPR: ${pr}`;
  const tail = 'Approve merges into dev. Deny closes the issue. A reply to this post sends feedback to design.';
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

function cut(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, room - TRIM_MARK.length).trimEnd()}${TRIM_MARK}`;
}
