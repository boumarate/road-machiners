import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildAndDeploy } from '../deploy';
import { stripAnsi } from '../fail';
import { updateState } from '../state';
import { BRANCH, OUT_DIR, TASK_FILE, type Ctx } from '../types';
import { BASE_BRANCH, agentLog, fillPrompt, guardAndPush, readOutput, resetOutputs, runAgent, throwIfNeedsCommittee, workDir } from './common';

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

type Approval = { description: string; howToTry: string };

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = workDir(ctx, issue);
  await ctx.repo.prepareWorkClone(BRANCH(issue), BASE_BRANCH, clone);
  resetOutputs(clone);
  await agentRound(ctx, issue, 'test');
  const failure = await runChecks(ctx, issue);
  // The agent gets one round to fix what the factory's own checks found. A second failure stops the card.
  if (failure !== null) {
    writeFileSync(`${clone}/${OUT_DIR}/check-failure.md`, failure);
    await agentRound(ctx, issue, 'test-fix');
    const again = await runChecks(ctx, issue);
    if (again !== null) throw new Error(`The factory checks failed twice.\n${again}`);
  }
  const approval = readApproval(clone);
  const url = await buildAndDeploy(ctx, checkDir(ctx, issue), await ctx.repo.headHash(BRANCH(issue)), agentLog(ctx, issue, 'checks'));
  await post(ctx, issue, approval, `${clone}/${OUT_DIR}/screenshot.png`, url);
  await ctx.github.move(issue, 'Approval');
}

async function agentRound(ctx: Ctx, issue: number, prompt: 'test' | 'test-fix'): Promise<void> {
  await runAgent(ctx, issue, 'testing', ctx.cfg.buildModel, fillPrompt(prompt, { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  throwIfNeedsCommittee(workDir(ctx, issue));
  readApproval(workDir(ctx, issue));
  await guardAndPush(ctx, issue, BASE_BRANCH);
}

function readApproval(clone: string): Approval {
  const raw = readOutput(clone, 'approval.json');
  if (raw === null) throw new Error('The testing stage wrote no .factory/approval.json');
  if (readOutput(clone, 'screenshot.png') === null) throw new Error('The testing stage wrote no .factory/screenshot.png');
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

async function post(ctx: Ctx, issue: number, approval: Approval, screenshot: string, url: string): Promise<void> {
  const item = await ctx.github.issue(issue);
  const chat = ctx.cfg.committeeChat;
  const caption = `#${issue} ${item.title}\n${url}`.slice(0, 1024);
  const photoId = await ctx.telegram.sendPhoto(chat, screenshot, caption);
  const text = [
    item.title,
    `Play: ${url}`,
    `Issue: https://github.com/${ctx.cfg.repo}/issues/${issue}`,
    approval.description,
    `How to try: ${approval.howToTry}`,
    'Reply approve to this message to merge into dev. Any other reply sends feedback to design.',
  ].join('\n\n');
  const textId = await ctx.telegram.sendMessage(chat, text, photoId);
  updateState(ctx.statePath, (state) => ({ ...state, approvalPosts: { ...state.approvalPosts, [photoId]: issue, [textId]: issue } }));
}
