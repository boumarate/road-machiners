import { rmSync, writeFileSync } from 'node:fs';
import { readState, updateState } from '../state';
import { GAME_DIR, OUT_DIR, type Ctx } from '../types';
import { agentHome, fillPrompt, readOutput, resetOutputs } from './common';

// Runs one committee request as a read-only investigation. Nothing is pushed. The report goes back to the chat and the issue.
export async function adhoc(ctx: Ctx, issue: number): Promise<void> {
  const reply = readState(ctx.statePath).adhocReplies[String(issue)];
  if (!reply) throw new Error(`No chat message recorded to answer for ad hoc issue #${issue}`);
  const item = await ctx.github.issue(issue);
  await ctx.repo.sync();
  const dir = `${ctx.cfg.home}/work/adhoc-${issue}`;
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('dev', 'dev', dir);
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  writeFileSync(`${home}/${OUT_DIR}/request.md`, `# Committee request\n\n${item.body}\n`);
  const log = `${ctx.cfg.home}/logs/issue-${issue}-adhoc.log`;
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt: fillPrompt('adhoc', { issue: String(issue) }), log });
  const report = readOutput(home, 'report.md')?.trim();
  if (!report) throw new Error(`The agent wrote no ${OUT_DIR}/report.md`);
  await ctx.telegram.sendMessage(reply.chat, report, reply.messageId);
  await ctx.github.comment(issue, report);
  await ctx.github.close(issue, 'completed');
  await ctx.github.move(issue, 'Done');
  updateState(ctx.statePath, (state) => {
    const adhocReplies = { ...state.adhocReplies };
    delete adhocReplies[String(issue)];
    return { ...state, adhocReplies };
  });
  rmSync(dir, { recursive: true, force: true });
  ctx.log('adhoc', issue, 'report posted, issue closed');
}
