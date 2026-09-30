import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCommittee, telegramIds } from './committee';
import { deny, feedback } from './stages/approval';
import { readState, updateState } from './state';
import { ADHOC_LABEL, RELEASE_TASK_LABEL, type Ctx, type ReleaseState } from './types';

const TITLE_LIMIT = 80;
const KINDS = ['approve', 'deny', 'feedback', 'change', 'adhoc', 'ship', 'remove', 'release-task'];

// One committee command, written by the Hermes plugin into $FACTORY_HOME/inbox.
export type InboxCommand = {
  kind: 'approve' | 'deny' | 'feedback' | 'change' | 'adhoc' | 'ship' | 'remove' | 'release-task';
  issue: number | null;
  text: string | null;
  by: string; // Telegram user id
  byName: string | null;
  chat: string;
  messageId: number;
};

export function inboxDir(home: string): string {
  return join(home, 'inbox');
}

export function parseCommand(raw: string): InboxCommand {
  const data = JSON.parse(raw) as Partial<InboxCommand>;
  if (!KINDS.includes(String(data.kind))) throw new Error(`Unknown inbox command kind ${data.kind}`);
  if (typeof data.by !== 'string' || typeof data.chat !== 'string' || typeof data.messageId !== 'number') throw new Error('Inbox command lacks by, chat or messageId');
  return data as InboxCommand;
}

// Handles every queued command once, oldest first. A bad command is answered and dropped, never retried.
export async function drainInbox(ctx: Ctx): Promise<void> {
  const dir = inboxDir(ctx.cfg.home);
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  for (const name of files) await handleFile(ctx, join(dir, name));
}

async function handleFile(ctx: Ctx, path: string): Promise<void> {
  const raw = readFileSync(path, 'utf8');
  rmSync(path);
  let command: InboxCommand | null = null;
  try {
    command = parseCommand(raw);
    const answer = await handle(ctx, command);
    await ctx.telegram.sendMessage(command.chat, answer, command.messageId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.log('tick', command?.issue ?? null, `inbox command failed: ${message}`);
    if (command) await ctx.telegram.sendMessage(command.chat, `That did not work: ${message}`, command.messageId);
  }
}

async function handle(ctx: Ctx, command: InboxCommand): Promise<string> {
  const { home, committeeBootstrapTelegram: telegram, committeeBootstrapGithub: github } = ctx.cfg;
  if (!telegramIds(readCommittee(home, { telegram, github })).includes(command.by)) throw new Error('Only committee members can do that.');
  const by = command.byName ?? command.by;
  if (command.kind === 'adhoc') return queueAdhoc(ctx, command, by);
  if (command.kind === 'change') return queueChange(ctx, requireText(command), by);
  if (command.kind === 'release-task') return openReleaseTask(ctx, command, by);
  return handleIssueCommand(ctx, command, requireIssue(command), by);
}

async function handleIssueCommand(ctx: Ctx, command: InboxCommand, issue: number, by: string): Promise<string> {
  if (command.kind === 'ship') return queueShip(ctx, issue, by);
  if (command.kind === 'remove') return queueRemoval(ctx, issue, by, requireText(command));
  if (command.kind === 'feedback') {
    const dropped = await feedback(ctx, issue, by, requireText(command));
    const note = dropped ? ' The queued approval is dropped.' : '';
    return `Feedback on #${issue} is on the issue. The task goes back to design.${note}`;
  }
  if (command.kind === 'deny') {
    await deny(ctx, issue, by);
    return `Issue #${issue} is denied and closed.`;
  }
  return queueApproval(ctx, issue, by);
}

async function queueApproval(ctx: Ctx, issue: number, by: string): Promise<string> {
  const card = (await ctx.github.cards()).find((item) => item.issue === issue);
  if (card?.column !== 'Approval') throw new Error(`Issue #${issue} is not waiting for approval.`);
  updateState(ctx.statePath, (state) => ({ ...state, pendingApprovals: { ...state.pendingApprovals, [String(issue)]: by } }));
  return `Approval of #${issue} is queued. The merge into dev starts on a coming tick.`;
}

async function queueAdhoc(ctx: Ctx, command: InboxCommand, by: string): Promise<string> {
  const text = requireText(command).trim();
  const title = text.split('\n')[0].trim().slice(0, TITLE_LIMIT);
  const n = await ctx.github.createIssue(title, `${text}\n\nRequested by ${by} in the committee chat.`, [ADHOC_LABEL]);
  await ctx.github.addCard(n, 'Implementation');
  const reply = { chat: command.chat, messageId: command.messageId };
  updateState(ctx.statePath, (state) => ({ ...state, adhocReplies: { ...state.adhocReplies, [String(n)]: reply } }));
  return `Queued as #${n}. The report comes as a reply here.`;
}

function openRelease(ctx: Ctx): ReleaseState {
  const release = readState(ctx.statePath).release;
  if (release === null) throw new Error('No release is open.');
  return release;
}

// Ship acts on the current candidate post alone (IV1, IV5). The job checks the release tasks (IV3) when it runs.
function queueShip(ctx: Ctx, issue: number, by: string): string {
  const release = openRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the open release, #${release.issue} is.`);
  if (release.postId === null) throw new Error('The release has no current candidate post yet. Wait for the next one.');
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: by }));
  return `Ship of release ${release.day} is queued. The merge into main starts on a coming tick.`;
}

function queueRemoval(ctx: Ctx, issue: number, by: string, text: string): string {
  const release = openRelease(ctx);
  if (release.removed.includes(issue)) throw new Error(`Issue #${issue} is already removed from release ${release.day}.`);
  updateState(ctx.statePath, (state) => ({ ...state, pendingRemovals: [...state.pendingRemovals, { issue, by, text }] }));
  return `Removal of #${issue} from release ${release.day} is queued. The revert starts on a coming tick.`;
}

// A reply to the candidate post that is not a command. The old post cannot ship, since the new task must be played first.
async function openReleaseTask(ctx: Ctx, command: InboxCommand, by: string): Promise<string> {
  const release = openRelease(ctx);
  const text = requireText(command).trim();
  const title = text.split('\n')[0].trim().slice(0, TITLE_LIMIT);
  const n = await ctx.github.createIssue(title, `${text}\n\nRequested by ${by} in the committee chat as a task of release ${release.day}.`, [RELEASE_TASK_LABEL]);
  await ctx.github.addCard(n, 'Design');
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null } }));
  return `Opened #${n} as a task of release ${release.day}. A new candidate follows when it is done.`;
}

function queueChange(ctx: Ctx, text: string, by: string): string {
  const id = ctx.now().getTime();
  updateState(ctx.statePath, (state) => ({ ...state, pendingChanges: [...state.pendingChanges, { id, text, by }] }));
  return `Change request ${id} is queued. The factory answers with a pull request.`;
}

function requireIssue(command: InboxCommand): number {
  if (typeof command.issue !== 'number') throw new Error(`A ${command.kind} command needs an issue number.`);
  return command.issue;
}

function requireText(command: InboxCommand): string {
  if (!command.text?.trim()) throw new Error(`A ${command.kind} command needs text.`);
  return command.text;
}
