import { STUCK_LABEL, type Ctx, type Stage } from './types';

// A failed stage stops its card and tells the committee once. Nothing retries until a human removes the label.
export async function reportFailure(ctx: Ctx, stage: Stage, issue: number | null, error: unknown, log: string | null): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  ctx.log(stage, issue, `failed: ${message}`);
  if (issue !== null) await ctx.github.addLabel(issue, STUCK_LABEL);
  const where = issue === null ? '' : ` on issue #${issue} https://github.com/${ctx.cfg.repo}/issues/${issue}`;
  const logLine = log ? `\nLog: ${log}` : '';
  const unstick = issue === null ? '' : `\nRemove the ${STUCK_LABEL} label to let the factory try again.`;
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Factory stage ${stage} failed${where}.\n${message.slice(0, 3000)}${logLine}${unstick}`);
}
