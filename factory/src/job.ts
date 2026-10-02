import { rebuildDev } from './deploy';
import { failureIssue, reportFailure } from './fail';
import { adhoc } from './stages/adhoc';
import { approve } from './stages/approval';
import { change } from './stages/change';
import { runStage as design } from './stages/design';
import { runStage as implement } from './stages/implement';
import { candidate } from './stages/candidate';
import { release } from './stages/release';
import { remove } from './stages/remove';
import { ship } from './stages/ship';
import { runStage as testing } from './stages/testing';
import { runStage as triage } from './stages/triage';
import { readState, updateState } from './state';
import { QUEUE_OF, type Ctx, type Job, type JobStage } from './types';

type Handler = (ctx: Ctx, issue: number) => Promise<void>;

// Ship reads who pressed it from the state, so the job cannot run without a queued Ship.
const HANDLERS: Record<Exclude<JobStage, 'release' | 'dev'>, Handler> = {
  triage, design, implement, testing, change, adhoc, candidate, remove,
  ship: (ctx, issue) => ship(ctx, issue, readState(ctx.statePath).pendingShip),
  approve: (ctx, issue) => approve(ctx, issue, readState(ctx.statePath).pendingApprovals[String(issue)] ?? 'the committee'),
};

// Card stages leave a progress comment on their issue, so the issue shows where its work stands.
const CARD_STAGE_NAMES: Partial<Record<JobStage, string>> = { triage: 'Triage', design: 'Design', implement: 'Implementation', testing: 'Testing' };

export function progressNote(ctx: Ctx, stage: JobStage, startedAt: string | null, outcome: 'finished' | 'failed'): string {
  const minutes = startedAt ? Math.round((ctx.now().getTime() - new Date(startedAt).getTime()) / 60_000) : null;
  const took = minutes === null ? '' : ` after ${minutes} min`;
  const next = outcome === 'failed' ? ' Hermes is looking into it.' : '';
  return `${CARD_STAGE_NAMES[stage]} ${outcome}${took}.${next}`;
}

async function noteProgress(ctx: Ctx, stage: JobStage, issue: number | null, job: Job | null, outcome: 'finished' | 'failed'): Promise<void> {
  if (issue === null || !(stage in CARD_STAGE_NAMES)) return;
  await ctx.github.comment(issue, progressNote(ctx, stage, job?.startedAt ?? null, outcome));
}

// The tick records a job before it starts it. A job run by hand has no record.
function ownJob(ctx: Ctx, stage: JobStage, issue: number | null): Job | null {
  return readState(ctx.statePath).jobs.find((job) => job.stage === stage && job.issue === issue) ?? null;
}

// Runs one job to its end. Success or failure, the job's record, its queued command and its issue's interrupted mark are cleared, so nothing retries.
export async function runJob(ctx: Ctx, stage: JobStage, issue: number | null): Promise<void> {
  const job = ownJob(ctx, stage, issue);
  try {
    await dispatch(ctx, stage, issue, job);
    ctx.log(stage, issue, 'done');
    await noteProgress(ctx, stage, issue, job, 'finished');
  } catch (error) {
    await reportFailure(ctx, stage, failureIssue(stage, issue, readState(ctx.statePath)), error, job?.log ?? null);
    await noteProgress(ctx, stage, issue, job, 'failed');
  } finally {
    clearJob(ctx, stage, issue);
  }
}

async function dispatch(ctx: Ctx, stage: JobStage, issue: number | null, job: Job | null): Promise<void> {
  if (stage === 'release') return release(ctx);
  // A dev job run by hand has no job in the state, so its build output goes to a fixed log.
  if (stage === 'dev') return rebuildDev(ctx, job?.log ?? `${ctx.cfg.home}/logs/dev-build.log`);
  if (issue === null) throw new Error(`Job ${stage} needs an issue or change id`);
  return HANDLERS[stage](ctx, issue);
}

function clearJob(ctx: Ctx, stage: JobStage, issue: number | null): void {
  updateState(ctx.statePath, (state) => {
    const pendingApprovals = { ...state.pendingApprovals };
    if (stage === 'approve') delete pendingApprovals[String(issue)];
    const pendingChanges = stage === 'change' ? state.pendingChanges.filter((item) => item.id !== issue) : state.pendingChanges;
    const pendingShip = stage === 'ship' ? null : state.pendingShip;
    const first = stage === 'remove' ? state.pendingRemovals.findIndex((item) => item.issue === issue) : -1;
    const pendingRemovals = state.pendingRemovals.filter((_, index) => index !== first);
    const jobs = state.jobs.filter((job) => job.stage !== stage || job.issue !== issue);
    // Only agent and test jobs get stopped. A change job's id is no issue number, so it never clears a mark.
    const interrupted = QUEUE_OF[stage] === 'branch' ? state.interrupted : state.interrupted.filter((item) => item !== issue);
    return { ...state, jobs, pendingApprovals, pendingChanges, pendingShip, pendingRemovals, interrupted };
  });
}
