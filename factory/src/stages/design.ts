import { BRANCH, GAME_DIR, TASK_FILE, WONT_DO_LABEL, type Ctx } from '../types';
import { BASE_BRANCH, agentHome, askAuthor, fillPrompt, guardAndPush, readOutput, resetOutputs, runAgent, throwIfNeedsCommittee, workDir, writeIssueInput } from './common';
import { existsSync, readFileSync } from 'node:fs';

export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = workDir(ctx, issue);
  await ctx.repo.sync();
  await ctx.repo.prepareWorkClone(BRANCH(issue), BASE_BRANCH, clone);
  const home = agentHome(clone, GAME_DIR);
  resetOutputs(home);
  await writeIssueInput(ctx, issue, home);
  const prompt = fillPrompt('design', { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue) });
  await runAgent(ctx, issue, 'design', ctx.cfg.designModel, prompt);
  throwIfNeedsCommittee(home);
  const questions = readOutput(home, 'questions.md');
  if (questions !== null) return askBack(ctx, issue, questions);
  const reason = readOutput(home, 'wont-do.md');
  if (reason !== null) return refuse(ctx, issue, reason);
  requirePlan(home, TASK_FILE(issue));
  await guardAndPush(ctx, issue, BASE_BRANCH);
  await postDesign(ctx, issue, readFileSync(`${home}/${TASK_FILE(issue)}`, 'utf8'));
  await ctx.github.move(issue, 'Implementation');
}

async function askBack(ctx: Ctx, issue: number, text: string): Promise<void> {
  const questions = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (questions.length === 0) throw new Error('The design stage wrote an empty questions.md');
  await askAuthor(ctx, issue, questions);
  await ctx.github.move(issue, 'Triage');
}

async function refuse(ctx: Ctx, issue: number, reason: string): Promise<void> {
  await ctx.github.comment(issue, reason.trim());
  await ctx.github.addLabel(issue, WONT_DO_LABEL);
  await ctx.github.close(issue, 'not planned');
  await ctx.github.move(issue, 'Done');
}

function requirePlan(home: string, taskFile: string): void {
  const path = `${home}/${taskFile}`;
  if (!existsSync(path)) throw new Error(`The design stage wrote no task file ${taskFile}`);
  if (planText(readFileSync(path, 'utf8')) === '') throw new Error(`Task file ${taskFile} has no non-empty "## Plan" section`);
}

function planText(task: string): string {
  const lines = task.split('\n');
  const start = lines.findIndex((line) => line.trim() === '## Plan');
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

// GitHub caps a comment at 65536 characters. The rest of the room holds the wrapper and the marker.
const DESIGN_COMMENT_LIMIT = 60000;

// The task file never reaches git, so the issue shows the design and plan to anyone who wants to read them.
async function postDesign(ctx: Ctx, issue: number, taskFile: string): Promise<void> {
  const body = taskFile.length > DESIGN_COMMENT_LIMIT ? `${taskFile.slice(0, DESIGN_COMMENT_LIMIT)}\n\n(cut here, the full file is in the factory work clone)` : taskFile;
  await ctx.github.comment(issue, `<details>\n<summary>Design and plan</summary>\n\n${body}\n\n</details>`);
}
