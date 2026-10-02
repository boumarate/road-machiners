import { BRANCH, DESIGN_SONNET_LABEL, GAME_DIR, HOTFIX_LABEL, IMPLEMENTATION_OPUS_LABEL, ROUTING_MARK, WONT_DO_LABEL, type Ctx } from '../types';
import { BASE_BRANCH, agentHome, askAuthor, fillPrompt, readOutput, resetOutputs, runAgent, workDir, writeIssueInput } from './common';

type Complexity = 'trivial' | 'intermediate' | 'hard';
type Routing = { complexity: Complexity; why: string };
type Verdict = { verdict: 'ready'; reason: string; hotfix: boolean; routing: Routing } | { verdict: 'wont-do'; reason: string } | { verdict: 'unclear'; reason: string; questions: string[] };

// Reads a verdict without pushing anything. Ready cards go on to Design, refused ones close, unclear ones wait for the author.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = workDir(ctx, issue);
  await ctx.repo.fetch();
  await ctx.repo.prepareWorkClone(BRANCH(issue), BASE_BRANCH, clone);
  const home = agentHome(clone, GAME_DIR);
  resetOutputs(home);
  await writeIssueInput(ctx, issue, home);
  await runAgent(ctx, issue, 'triage', fillPrompt('triage', { issue: String(issue) }));
  const result = parseVerdict(readOutput(home, 'triage.json'));
  if (result.verdict === 'unclear') return askAuthor(ctx, issue, result.questions, 'triage');
  if (result.verdict === 'ready') return pass(ctx, issue, result.reason, result.hotfix, result.routing);
  await ctx.github.comment(issue, result.reason);
  await ctx.github.addLabel(issue, WONT_DO_LABEL);
  await ctx.github.close(issue, 'not planned');
  await ctx.github.move(issue, 'Done');
}

// A hotfix ships to main on approval and skips dev, so the committee hears about it now, not only at the approval post.
async function pass(ctx: Ctx, issue: number, reason: string, hotfix: boolean, routing: Routing): Promise<void> {
  const note = await routeModels(ctx, issue, routing);
  if (hotfix) {
    await ctx.github.addLabel(issue, HOTFIX_LABEL);
    await ctx.github.comment(issue, `Triage passed as a hotfix: ${reason}\n\nIt branches from main, and its approval ships it to main and itch.io at once.\n\n${note}`);
    const { title } = await ctx.github.issue(issue);
    await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `⚠️ Triage marked #${issue} ${title} as a hotfix.\n${reason}\nIt skips dev. Its approval will merge into main and ship to itch.io at once. Remove the label hotfix on GitHub if it can wait for a release.`);
  } else {
    await ctx.github.comment(issue, `Triage passed: ${reason}\n\n${note}`);
  }
  await ctx.github.move(issue, 'Design');
}

// Triage picks models by task complexity: trivial gets Sonnet at design (label design-sonnet), hard gets Opus at implementation and testing (label implementation-opus), anything between keeps the default.
// It decides once. Labels already on the issue are the committee's and stay as they are, and an earlier routing comment means a label removed since was removed on purpose.
// The comment is the audit trail and the marker of that decision.
async function routeModels(ctx: Ctx, issue: number, { complexity, why }: Routing): Promise<string> {
  const [{ labels }, comments] = await Promise.all([ctx.github.issue(issue), ctx.github.comments(issue)]);
  const set = [DESIGN_SONNET_LABEL, IMPLEMENTATION_OPUS_LABEL].filter((label) => labels.includes(label));
  const rated = `Triage rated it ${complexity}: ${why}`;
  if (set.length > 0) return `${ROUTING_MARK} left as set on the issue (${set.join(', ')}). ${rated}`;
  if (comments.some((comment) => comment.body.includes(ROUTING_MARK))) return `${ROUTING_MARK} kept as the committee left the labels. ${rated}`;
  const label = routingLabel(complexity);
  if (label === null) return `${ROUTING_MARK} ${complexity}, default models (Opus design, Sonnet implementation and testing). ${why}`;
  await ctx.github.addLabel(issue, label);
  return `${ROUTING_MARK} ${complexity}, label ${label}. ${why}`;
}

function routingLabel(complexity: Complexity): string | null {
  if (complexity === 'trivial') return DESIGN_SONNET_LABEL;
  return complexity === 'hard' ? IMPLEMENTATION_OPUS_LABEL : null;
}

function parseVerdict(text: string | null): Verdict {
  if (text === null) throw new Error('The triage stage wrote no .factory/triage.json');
  const data: unknown = JSON.parse(text);
  if (typeof data !== 'object' || data === null) throw new Error('triage.json is not an object');
  const { verdict, reason, questions, hotfix, complexity, complexityReason } = data as Record<string, unknown>;
  const kind = readKind(verdict);
  const why = readReason(reason);
  if (kind === 'ready') return { verdict: kind, reason: why, hotfix: readHotfix(hotfix), routing: readRouting(complexity, complexityReason) };
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

function readHotfix(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('triage.json needs hotfix as true or false for a ready verdict');
  return value;
}

function readRouting(complexity: unknown, why: unknown): Routing {
  if (complexity !== 'trivial' && complexity !== 'intermediate' && complexity !== 'hard') throw new Error('triage.json needs complexity as trivial, intermediate or hard for a ready verdict');
  if (typeof why !== 'string' || why.trim() === '') throw new Error('triage.json needs a non-empty complexityReason for a ready verdict');
  return { complexity, why: why.trim() };
}

function readQuestions(value: unknown): string[] {
  const valid = Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim() !== '');
  if (!valid) throw new Error('triage.json needs at least one non-empty question for an unclear verdict');
  return (value as string[]).map((question) => question.trim());
}
