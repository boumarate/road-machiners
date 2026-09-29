import { join } from 'node:path';
import { reportFailure } from './fail';
import { intake } from './intake';
import { isAlive, killJob, spawnJob } from './jobs';
import { readState, updateState } from './state';
import { ADHOC_LABEL, STUCK_LABEL } from './types';
import type { Card, Ctx, FactoryConfig, FactoryState, Job, JobStage, Run } from './types';

export type JobPick = { stage: JobStage; issue: number | null };
type Due = Pick<FactoryConfig, 'releaseDays' | 'maintenanceHours'>;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;
const CARD_ORDER: [Card['column'], JobStage][] = [['Testing', 'testing'], ['Implementation', 'implement'], ['Design', 'design']];

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
  return cards.filter((card) => !card.labels.includes(STUCK_LABEL));
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

// Picks the next job. Queued approvals and changes first, then ad hoc tasks, then due periodic jobs, then the card furthest along.
export function chooseJob(state: FactoryState, cards: Card[], now: Date, cfg: Due): JobPick | null {
  if (state.job) return null;
  const first = queued(state);
  if (first) return first;
  const adhoc = adhocJob(cards);
  if (adhoc) return adhoc;
  if (isDue(state.lastRelease, now, cfg.releaseDays * DAY_MS)) return { stage: 'release', issue: null };
  if (isDue(state.lastMaintenance, now, cfg.maintenanceHours * HOUR_MS)) return { stage: 'maintenance', issue: null };
  return cardJob(cards);
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
  updateState(ctx.statePath, (state) => ({ ...state, job }));
  ctx.log('tick', pick.issue, `started ${pick.stage}, pid ${pid}, log ${log}`);
}

// One tick: check the running job, run intake, start at most one job. `deps` defaults to the real process control.
export async function tick(ctx: Ctx, codeDir: string, deps: TickDeps = REAL_DEPS): Promise<void> {
  const running = readState(ctx.statePath).job;
  if (running && (await checkJob(ctx, running, deps))) return;
  await intake(ctx);
  const pick = chooseJob(readState(ctx.statePath), await ctx.github.cards(), ctx.now(), ctx.cfg);
  if (!pick) return ctx.log('tick', null, 'nothing to do');
  startJob(ctx, codeDir, pick, deps);
}
