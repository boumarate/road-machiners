import { join } from 'node:path';
import { removeStaleBuilds } from './deploy';
import { reportFailure } from './fail';
import { intake } from './intake';
import { isAlive, killJob, spawnJob } from './jobs';
import { readState, updateState } from './state';
import { isAnswered } from './questions';
import { ADHOC_LABEL, NEEDS_INFO_LABEL, STUCK_LABEL } from './types';
import type { Card, Ctx, FactoryConfig, FactoryState, Job, JobStage, Run } from './types';

export type JobPick = { stage: JobStage; issue: number | null };
type Due = Pick<FactoryConfig, 'releaseDays' | 'maintenanceHours' | 'maxJobsPerDay'>;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;
// Committee-driven jobs never count against the daily cap.
const UNCAPPED_STAGES: JobStage[] = ['approve', 'change', 'adhoc'];
const CARD_ORDER: [Card['column'], JobStage][] = [['Testing', 'testing'], ['Implementation', 'implement'], ['Design', 'design'], ['Triage', 'triage']];

function isDue(last: string | null, now: Date, everyMs: number): boolean {
  return last === null || now.getTime() - new Date(last).getTime() > everyMs;
}

function queued(state: FactoryState): JobPick | null {
  const approval = Object.keys(state.pendingApprovals).map(Number).sort((a, b) => a - b)[0];
  if (approval !== undefined) return { stage: 'approve', issue: approval };
  const change = state.pendingChanges[0];
  return change ? { stage: 'change', issue: change.id } : null;
}

function openCards(cards: Card[]): Card[] {
  return cards.filter((card) => !card.labels.includes(STUCK_LABEL) && !card.labels.includes(NEEDS_INFO_LABEL));
}

function adhocJob(cards: Card[]): JobPick | null {
  const first = openCards(cards).filter((card) => card.column === 'Implementation' && card.labels.includes(ADHOC_LABEL)).sort((a, b) => a.issue - b.issue)[0];
  return first ? { stage: 'adhoc', issue: first.issue } : null;
}

function cardJob(cards: Card[]): JobPick | null {
  const open = openCards(cards).filter((card) => !card.labels.includes(ADHOC_LABEL));
  for (const [column, stage] of CARD_ORDER) {
    const first = open.filter((card) => card.column === column).sort((a, b) => a.issue - b.issue)[0];
    if (first) return { stage, issue: first.issue };
  }
  return null;
}

export function countsAgainstCap(stage: JobStage): boolean {
  return !UNCAPPED_STAGES.includes(stage);
}

export function recentStarts(state: FactoryState, now: Date): string[] {
  return state.jobStarts.filter((start) => now.getTime() - new Date(start).getTime() < DAY_MS);
}

export function atCap(state: FactoryState, now: Date, cfg: Pick<FactoryConfig, 'maxJobsPerDay'>): boolean {
  return recentStarts(state, now).length >= cfg.maxJobsPerDay;
}

function pickJob(state: FactoryState, cards: Card[], now: Date, cfg: Due, allowCounted: boolean): JobPick | null {
  if (state.job) return null;
  const first = queued(state);
  if (first) return first;
  const adhoc = adhocJob(cards);
  if (adhoc) return adhoc;
  return allowCounted ? countedJob(state, cards, now, cfg) : null;
}

function countedJob(state: FactoryState, cards: Card[], now: Date, cfg: Due): JobPick | null {
  if (isDue(state.lastRelease, now, cfg.releaseDays * DAY_MS)) return { stage: 'release', issue: null };
  if (isDue(state.lastMaintenance, now, cfg.maintenanceHours * HOUR_MS)) return { stage: 'maintenance', issue: null };
  return cardJob(cards);
}

// Picks the next job. Queued approvals and changes first, then ad hoc tasks, then due periodic jobs, then the card furthest along.
// At the daily cap only the committee-driven jobs are left.
export function chooseJob(state: FactoryState, cards: Card[], now: Date, cfg: Due): JobPick | null {
  return pickJob(state, cards, now, cfg, !atCap(state, now, cfg));
}

// Process control the tick uses. The CLI uses the real ones, and tests pass fakes.
export type TickDeps = {
  isAlive: (pid: number) => boolean;
  kill: (run: Run, pid: number) => Promise<void>;
  spawn: (args: string[], cwd: string, log: string) => number;
};
export const REAL_DEPS: TickDeps = { isAlive, kill: killJob, spawn: spawnJob };

function clearJob(ctx: Ctx): void {
  updateState(ctx.statePath, (state) => ({ ...state, job: null }));
}

// Card stages and approve report on their issue. Change and periodic jobs report on none.
function failureIssue(job: Job): number | null {
  return job.stage === 'change' ? null : job.issue;
}

async function checkJob(ctx: Ctx, job: Job, deps: TickDeps): Promise<boolean> {
  const minutes = (ctx.now().getTime() - new Date(job.startedAt).getTime()) / MINUTE_MS;
  if (!deps.isAlive(job.pid)) {
    clearJob(ctx);
    await reportFailure(ctx, job.stage, failureIssue(job), 'job process died without finishing', job.log);
    return false;
  }
  if (minutes <= ctx.cfg.stageTimeoutMinutes) {
    ctx.log('tick', job.issue, `${job.stage} still running`);
    return true;
  }
  await deps.kill(ctx.run, job.pid);
  clearJob(ctx);
  await reportFailure(ctx, job.stage, failureIssue(job), `timed out after ${ctx.cfg.stageTimeoutMinutes} minutes`, job.log);
  return false;
}

function startJob(ctx: Ctx, codeDir: string, pick: JobPick, deps: TickDeps): void {
  const stamp = ctx.now().toISOString().replaceAll(':', '');
  const log = join(ctx.cfg.home, 'logs', `${pick.stage}-${pick.issue ?? '-'}-${stamp}.log`);
  const pid = deps.spawn([pick.stage, String(pick.issue ?? '-')], codeDir, log);
  const job: Job = { ...pick, pid, startedAt: ctx.now().toISOString(), log };
  updateState(ctx.statePath, (state) => ({ ...state, job, jobStarts: countsAgainstCap(pick.stage) ? [...recentStarts(state, ctx.now()), job.startedAt] : state.jobStarts }));
  ctx.log('tick', pick.issue, `started ${pick.stage}, pid ${pid}, log ${log}`);
}

// A Triage card that waits for answers gets its label back off once someone replies. Returns the cards as they stand after that.
async function releaseAnswered(ctx: Ctx, cards: Card[]): Promise<Card[]> {
  const released: Card[] = [];
  for (const card of cards) {
    const waiting = card.column === 'Triage' && card.labels.includes(NEEDS_INFO_LABEL);
    if (!waiting || !isAnswered(await ctx.github.comments(card.issue))) {
      released.push(card);
      continue;
    }
    await ctx.github.removeLabel(card.issue, NEEDS_INFO_LABEL);
    ctx.log('tick', card.issue, `answered, removed ${NEEDS_INFO_LABEL}`);
    released.push({ ...card, labels: card.labels.filter((label) => label !== NEEDS_INFO_LABEL) });
  }
  return released;
}

// Removes builds no card in Approval still needs.
function cleanBuilds(ctx: Ctx, cards: Card[]): void {
  const builds = readState(ctx.statePath).builds;
  const keep = cards.filter((card) => card.column === 'Approval').map((card) => builds[String(card.issue)]).filter((name) => name !== undefined);
  removeStaleBuilds(ctx.cfg.webRoot, new Set(keep), (msg) => ctx.log('tick', null, msg));
}

// Tells the committee once per cap window that the cap holds work back. The flag clears when the cap frees.
async function noteCap(ctx: Ctx, cards: Card[]): Promise<void> {
  const state = readState(ctx.statePath);
  const now = ctx.now();
  if (!atCap(state, now, ctx.cfg)) {
    if (state.capNoticed) updateState(ctx.statePath, (s) => ({ ...s, capNoticed: false }));
    return;
  }
  const waiting = pickJob(state, cards, now, ctx.cfg, true);
  if (state.capNoticed || waiting === null || !countsAgainstCap(waiting.stage)) return;
  const starts = recentStarts(state, now);
  const free = new Date(new Date(starts[0]).getTime() + DAY_MS).toISOString();
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Daily job cap reached: ${starts.length} of ${ctx.cfg.maxJobsPerDay} agent jobs ran in the last 24 hours. Public work waits. The next slot frees at ${free}.`);
  updateState(ctx.statePath, (s) => ({ ...s, capNoticed: true }));
}

// One tick: check the running job, run intake, clean old builds, start at most one job. `deps` defaults to the real process control.
export async function tick(ctx: Ctx, codeDir: string, deps: TickDeps = REAL_DEPS): Promise<void> {
  const running = readState(ctx.statePath).job;
  if (running && (await checkJob(ctx, running, deps))) return;
  await intake(ctx);
  const cards = await releaseAnswered(ctx, await ctx.github.cards());
  cleanBuilds(ctx, cards);
  await noteCap(ctx, cards);
  const pick = chooseJob(readState(ctx.statePath), cards, ctx.now(), ctx.cfg);
  if (!pick) return ctx.log('tick', null, 'nothing to do');
  startJob(ctx, codeDir, pick, deps);
}
