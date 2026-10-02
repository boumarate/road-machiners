import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readState, updateState } from '../state';
import { GAME_DIR, OUT_DIR, type Ctx } from '../types';
import { agentHome, fillPrompt, readOutput, resetOutputs, useOpenNetwork } from './common';

// The agent reads the factory's own records here, so it can answer questions about the factory too.
export const FACTORY_STATE_MOUNT = '/factory/state';
export const FACTORY_LOGS_MOUNT = '/factory/logs';

// Runs one committee request as a read-only investigation. Nothing is pushed. The report goes back to the chat and the issue.
export async function adhoc(ctx: Ctx, issue: number): Promise<void> {
  const reply = readState(ctx.statePath).adhocReplies[String(issue)];
  if (!reply) throw new Error(`No chat message recorded to answer for ad hoc issue #${issue}`);
  const item = await ctx.github.issue(issue);
  await ctx.repo.fetch();
  const dir = `${ctx.cfg.home}/work/adhoc-${issue}`;
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('dev', 'dev', dir);
  const home = agentHome(dir, GAME_DIR);
  resetOutputs(home);
  writeFileSync(`${home}/${OUT_DIR}/request.md`, `# Committee request\n\n${item.body}\n`);
  const log = `${ctx.cfg.home}/logs/issue-${issue}-adhoc.log`;
  const openNetwork = await useOpenNetwork(ctx, 'adhoc', issue);
  const readOnly = { [dirname(ctx.statePath)]: FACTORY_STATE_MOUNT, [`${ctx.cfg.home}/logs`]: FACTORY_LOGS_MOUNT };
  const prompt = fillPrompt('adhoc', { issue: String(issue), state: FACTORY_STATE_MOUNT, logs: FACTORY_LOGS_MOUNT });
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt, log, openNetwork, readOnly });
  const report = readOutput(home, 'report.md')?.trim();
  if (!report) throw new Error(`The agent wrote no ${OUT_DIR}/report.md`);
  const html = `${home}/${OUT_DIR}/report.html`;
  const hasHtml = existsSync(html);
  const messageId = await ctx.telegram.sendMessage(reply.chat, report, reply.messageId);
  if (hasHtml) await ctx.telegram.sendDocument(reply.chat, html, messageId);
  await ctx.github.comment(issue, report);
  await ctx.github.close(issue, 'completed');
  await ctx.github.move(issue, 'Done');
  updateState(ctx.statePath, (state) => {
    const adhocReplies = { ...state.adhocReplies };
    delete adhocReplies[String(issue)];
    return { ...state, adhocReplies };
  });
  rmSync(dir, { recursive: true, force: true });
  ctx.log('adhoc', issue, hasHtml ? 'report and HTML file posted, issue closed' : 'report posted, issue closed');
}
