import { STUCK_LABEL, type Ctx, type Stage } from './types';

const ANSI = new RegExp(String.raw`\u001b\[[0-9;]*[A-Za-z]`, 'g');
const FAILURE_LINE = /FAIL|Error|error:|failed|×/;
const SUMMARY_LINES = 6;
const SUMMARY_CHARS = 800;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

// The few lines of an error that say what broke. Tool output is long and colored, and the full text stays in the log.
export function summarizeError(message: string): string {
  const lines = stripAnsi(message).split('\n').map((line) => line.trim()).filter(Boolean);
  const failures = lines.filter((line) => FAILURE_LINE.test(line));
  const picked = (failures.length ? failures : lines.slice(-SUMMARY_LINES)).slice(0, SUMMARY_LINES);
  return picked.join('\n').slice(0, SUMMARY_CHARS);
}

// A failed stage stops its card and tells the committee once. Nothing retries until a human removes the label.
// Telegram goes first, so a GitHub outage that broke the stage cannot also hide the report.
export async function reportFailure(ctx: Ctx, stage: Stage, issue: number | null, error: unknown, log: string | null): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  ctx.log(stage, issue, `failed: ${message}`);
  const where = issue === null ? '' : ` on issue #${issue} https://github.com/${ctx.cfg.repo}/issues/${issue}`;
  const lines = [`Factory stage ${stage} failed${where}.`, summarizeError(message)];
  if (log) lines.push(`Log: ${log}`);
  if (issue !== null) lines.push(`Remove the ${STUCK_LABEL} label to let the factory try again.`);
  lines.push('Reply here to ask Hermes what went wrong.');
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, lines.join('\n\n'));
  if (issue !== null) await labelStuck(ctx, issue);
}

async function labelStuck(ctx: Ctx, issue: number): Promise<void> {
  try {
    await ctx.github.addLabel(issue, STUCK_LABEL);
  } catch (error) {
    const reason = summarizeError(error instanceof Error ? error.message : String(error));
    await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Could not label issue #${issue} ${STUCK_LABEL}, so the factory may run it again.\n\n${reason}`);
    throw error;
  }
}
