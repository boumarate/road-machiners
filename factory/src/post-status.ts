import type { InboxCommand } from './inbox';
import { CAPTION_LIMIT, cut } from './stages/checks';
import { readState, updateState } from './state';
import type { Ctx, FactoryState } from './types';

type PostKind = Exclude<InboxCommand['kind'], 'change' | 'adhoc'>;

// The line a committee action adds under the post it acted on.
const STATUS: Record<PostKind, (by: string, issue: number | null) => string> = {
  approve: (by) => `✅ Approved by ${by}`,
  deny: (by) => `❌ Denied by ${by}`,
  feedback: (by) => `💬 Feedback from ${by}. Back to design.`,
  ship: (by) => `🚀 Ship by ${by}`,
  remove: (by, issue) => `➖ #${issue} removed by ${by}`,
  'release-task': (by) => `📝 Release task from ${by}`,
};

// Adds the status under the caption. A caption near Telegram's limit loses the end of its body, never the status.
export function withStatus(caption: string, status: string): string {
  const joined = `${caption}\n\n${status}`;
  if (joined.length <= CAPTION_LIMIT) return joined;
  return `${cut(caption, CAPTION_LIMIT - status.length - 2)}\n\n${status}`;
}

// Edits the post a command acted on, adding its status line. The edit also drops the post's buttons.
export async function markPost(ctx: Ctx, command: InboxCommand, by: string): Promise<void> {
  if (command.kind === 'change' || command.kind === 'adhoc') return;
  if (command.postId === null) throw new Error(`A ${command.kind} command names no post`);
  const key = String(command.postId);
  const caption = readState(ctx.statePath).postCaptions[key];
  if (caption === undefined) throw new Error(`No caption is recorded for post ${key}`);
  const next = withStatus(caption, STATUS[command.kind](by, command.issue));
  await ctx.telegram.editCaption(ctx.cfg.committeeChat, command.postId, next);
  updateState(ctx.statePath, (state) => ({ ...state, postCaptions: { ...state.postCaptions, [key]: next } }));
}

// Keeps the captions of posts a command can still act on: open approval posts and the current candidate.
export function pruneCaptions(state: FactoryState): FactoryState {
  const open = new Set([...Object.keys(state.approvalPosts), ...(state.release?.postId ? [String(state.release.postId)] : [])]);
  const postCaptions = Object.fromEntries(Object.entries(state.postCaptions).filter(([id]) => open.has(id)));
  return { ...state, postCaptions };
}
