import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { updateState } from '../state';
import { BRANCH, GAME_DIR, MAINTENANCE_LABEL, OUT_DIR, TASK_FILE, WORK_DIR, type Ctx } from '../types';
import { agentHome, agentLog, fillPrompt, guardAndPush, readOutput, resetOutputs, useOpenNetwork } from './common';

// The text under `## Plan`, up to the next heading.
function planOf(taskText: string): string {
  const start = taskText.search(/^## Plan\s*$/m);
  if (start < 0) return '';
  const rest = taskText.slice(start).replace(/^## Plan\s*$/m, '');
  return rest.split(/^## /m)[0].trim();
}

function splitIssue(text: string): { title: string; body: string } {
  const [first, ...rest] = text.trim().split('\n');
  return { title: first.trim(), body: rest.join('\n').trim() };
}

// Opens a maintenance issue and lets an agent plan one small fix, or close the issue when nothing is worth fixing.
export async function maintenance(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  updateState(ctx.statePath, (state) => ({ ...state, lastMaintenance: now.toISOString() }));
  const day = now.toISOString().slice(0, 10);
  const n = await ctx.github.createIssue(`Daily maintenance ${day}`, 'The factory opened this for its daily maintenance pass.', [MAINTENANCE_LABEL]);
  await ctx.repo.sync();
  const dir = WORK_DIR(ctx.cfg.home, n);
  await ctx.repo.prepareWorkClone(BRANCH(n), 'dev', dir);
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  const prompt = fillPrompt('maintenance', { issue: String(n), taskFile: TASK_FILE(n), branch: BRANCH(n) });
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt, log: agentLog(ctx, n, 'maintenance'), openNetwork: await useOpenNetwork(ctx, 'maintenance', null) });
  const nothing = readOutput(home, 'nothing.md');
  if (nothing !== null) {
    await ctx.github.comment(n, nothing.trim());
    await ctx.github.close(n, 'not planned');
    ctx.log('maintenance', n, 'nothing worth fixing, issue closed');
    return;
  }
  const issueText = readOutput(home, 'issue.md');
  if (issueText === null || splitIssue(issueText).title === '') throw new Error(`maintenance agent wrote no ${OUT_DIR}/issue.md title`);
  if (planOf(readFileSync(join(home, TASK_FILE(n)), 'utf8')) === '') throw new Error(`${TASK_FILE(n)} has no Plan`);
  const { title, body } = splitIssue(issueText);
  await ctx.github.editIssue(n, title, body);
  await guardAndPush(ctx, n, 'dev');
  await ctx.github.addCard(n, 'Implementation');
  ctx.log('maintenance', n, `planned: ${title}`);
}
