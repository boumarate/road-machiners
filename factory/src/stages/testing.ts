import { mkdirSync, rmSync } from 'node:fs';
import { buildAndDeploy } from '../deploy';
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
  await runAgent(ctx, issue, 'testing', ctx.cfg.buildModel, fillPrompt('test', { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) }));
  throwIfNeedsCommittee(clone);
  const approval = readApproval(clone);
  const screenshot = `${clone}/${OUT_DIR}/screenshot.png`;
  await guardAndPush(ctx, issue, BASE_BRANCH);
  const url = await checkAndDeploy(ctx, issue);
  await post(ctx, issue, approval, screenshot, url);
  await ctx.github.move(issue, 'Approval');
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

// The host runs its own checks in a fresh clone. Agent claims do not count.
async function checkAndDeploy(ctx: Ctx, issue: number): Promise<string> {
  const dir = `${ctx.cfg.home}/work/check-issue-${issue}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${ctx.cfg.home}/work`, { recursive: true });
  await ctx.repo.prepareWorkClone(BRANCH(issue), BASE_BRANCH, dir);
  const log = agentLog(ctx, issue, 'checks');
  await ctx.container.shell(dir, CHECK_SCRIPT, log);
  return buildAndDeploy(ctx, dir, await ctx.repo.headHash(BRANCH(issue)), log);
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
