import { BRANCH, WONT_DO_LABEL, type Ctx } from '../types';
import { BASE_BRANCH, askAuthor, fillPrompt, readOutput, resetOutputs, runAgent, workDir, writeIssueInput } from './common';

type Verdict = { verdict: 'ready' | 'wont-do'; reason: string } | { verdict: 'unclear'; reason: string; questions: string[] };

// Reads a verdict without pushing anything. Ready cards go on to Design, refused ones close, unclear ones wait for the author.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = workDir(ctx, issue);
  await ctx.repo.sync();
  await ctx.repo.prepareWorkClone(BRANCH(issue), BASE_BRANCH, clone);
  resetOutputs(clone);
  await writeIssueInput(ctx, issue, clone);
  await runAgent(ctx, issue, 'triage', ctx.cfg.buildModel, fillPrompt('triage', { issue: String(issue) }));
  const result = parseVerdict(readOutput(clone, 'triage.json'));
  if (result.verdict === 'unclear') return askAuthor(ctx, issue, result.questions);
  if (result.verdict === 'ready') {
    await ctx.github.comment(issue, `Triage passed: ${result.reason}`);
    return ctx.github.move(issue, 'Design');
  }
  await ctx.github.comment(issue, result.reason);
  await ctx.github.addLabel(issue, WONT_DO_LABEL);
  await ctx.github.close(issue, 'not planned');
  await ctx.github.move(issue, 'Done');
}

function parseVerdict(text: string | null): Verdict {
  if (text === null) throw new Error('The triage stage wrote no .factory/triage.json');
  const data: unknown = JSON.parse(text);
  if (typeof data !== 'object' || data === null) throw new Error('triage.json is not an object');
  const { verdict, reason, questions } = data as Record<string, unknown>;
  const kind = readKind(verdict);
  const why = readReason(reason);
  return kind === 'unclear' ? { verdict: kind, reason: why, questions: readQuestions(questions) } : { verdict: kind, reason: why };
}

function readKind(value: unknown): 'ready' | 'wont-do' | 'unclear' {
  if (value === 'ready' || value === 'wont-do' || value === 'unclear') return value;
  throw new Error(`triage.json has an unknown verdict: ${String(value)}`);
}

function readReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('triage.json needs a non-empty reason');
  return value.trim();
}

function readQuestions(value: unknown): string[] {
  const valid = Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim() !== '');
  if (!valid) throw new Error('triage.json needs at least one non-empty question for an unclear verdict');
  return (value as string[]).map((question) => question.trim());
}
