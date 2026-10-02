import { rmSync, writeFileSync } from 'node:fs';
import { BRANCH, GAME_DIR, OUT_DIR, REVIEW_HEADING, TASK_FILE, type Ctx } from '../types';
import { agentHome, fillPrompt, readOutput, runAgent, workDir } from './common';

type Class = 'P1' | 'P2' | 'P3';
export type Finding = { class: Class; introduced: boolean; incidents: string[]; file: string; line: number; text: string };

const CLASSES: Class[] = ['P1', 'P2', 'P3'];
const INCIDENT_ID = /^R\d+$/;
// One P1 or this many P2 block the change.
const BLOCKING_P2 = 2;

// A cited incident makes an introduced finding P2 at least. The prompt says so too, and the host does not rely on the agent.
function effectiveClass(finding: Finding): Class {
  return finding.class === 'P3' && finding.incidents.length > 0 ? 'P2' : finding.class;
}

function introduced(findings: Finding[], wanted: Class): Finding[] {
  return findings.filter((finding) => finding.introduced && effectiveClass(finding) === wanted);
}

// The review blocks on any introduced P1 or on two or more introduced P2. Debt and P3 never count.
export function isBlocked(findings: Finding[]): boolean {
  return introduced(findings, 'P1').length > 0 || introduced(findings, 'P2').length >= BLOCKING_P2;
}

// The introduced findings, worst first, for the agent that fixes them.
export function findingsMarkdown(findings: Finding[]): string {
  const lines = CLASSES.flatMap((wanted) => introduced(findings, wanted)).map((finding) => {
    const cited = finding.incidents.length > 0 ? ` Incident: ${finding.incidents.join(', ')}.` : '';
    return `- ${effectiveClass(finding)} ${finding.file}:${finding.line} ${finding.text}${cited}`;
  });
  return `${lines.join('\n')}\n`;
}

export function parseReview(text: string | null): Finding[] {
  if (text === null) throw new Error('The review stage wrote no .factory/review.json');
  const data: unknown = JSON.parse(text);
  const list = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).findings : undefined;
  if (!Array.isArray(list)) throw new Error('review.json needs a findings list');
  return list.map(readFinding);
}

function readFinding(raw: unknown, index: number): Finding {
  const where = `review.json finding ${index + 1}`;
  const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    class: readClass(item.class, where),
    introduced: readIntroduced(item.introduced, where),
    incidents: readIncidents(item.incidents, where),
    file: readText(item.file, `${where} needs a file`),
    line: readLine(item.line, where),
    text: readText(item.text, `${where} needs text`),
  };
}

function readText(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
  return value.trim();
}

function readLine(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`${where} needs a line of 1 or more`);
  return value;
}

function readClass(value: unknown, where: string): Class {
  const found = CLASSES.find((name) => name === value);
  if (found === undefined) throw new Error(`${where} has an unknown class: ${String(value)}`);
  return found;
}

function readIntroduced(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${where} needs introduced as true or false`);
  return value;
}

function readIncidents(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && INCIDENT_ID.test(id))) throw new Error(`${where} needs incidents as a list of ids like R1`);
  return value as string[];
}

async function reviewRound(ctx: Ctx, issue: number, base: string): Promise<Finding[]> {
  const home = agentHome(workDir(ctx, issue), GAME_DIR);
  rmSync(`${home}/${OUT_DIR}/review.json`, { force: true });
  await runAgent(ctx, issue, 'testing', 'review', fillPrompt('review', { issue: String(issue), taskFile: TASK_FILE(issue), branch: BRANCH(issue), base }), { model: ctx.cfg.designModel });
  return parseReview(readOutput(home, 'review.json'));
}

// One adversarial review of the whole branch. A block gets one fix round and one more review. Returns whether the
// change passed. A second block sends the card back to Design, since two blocks in a row point at the design, not
// at the code.
export async function reviewGate(ctx: Ctx, issue: number, base: string, fixRound: () => Promise<void>): Promise<boolean> {
  const first = await reviewRound(ctx, issue, base);
  if (!isBlocked(first)) return true;
  const findingsFile = `${agentHome(workDir(ctx, issue), GAME_DIR)}/${OUT_DIR}/review-findings.md`;
  writeFileSync(findingsFile, findingsMarkdown(first));
  await fixRound();
  const again = await reviewRound(ctx, issue, base);
  rmSync(findingsFile);
  if (!isBlocked(again)) return true;
  await ctx.github.comment(issue, `${REVIEW_HEADING}\n\nThe review blocked this change twice. A fix round did not clear it, so the flaw is in the design. Revise the design to remove the root cause behind these findings, not to patch each one.\n\n${findingsMarkdown(again)}`);
  await ctx.github.move(issue, 'Design');
  return false;
}
