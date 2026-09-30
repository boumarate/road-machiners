import { deployDev } from './deploy';
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
import type { Ctx, JobStage } from './types';

type Handler = (ctx: Ctx, issue: number) => Promise<void>;

// Ship reads who pressed it from the state, so the job cannot run without a queued Ship.
const HANDLERS: Record<Exclude<JobStage, 'release' | 'dev'>, Handler> = {
  triage, design, implement, testing, change, adhoc, candidate, remove,
  ship: (ctx, issue) => ship(ctx, issue, readState(ctx.statePath).pendingShip),
  approve: (ctx, issue) => approve(ctx, issue, readState(ctx.statePath).pendingApprovals[String(issue)] ?? 'the committee'),
};

// Runs one job to its end. Success or failure, the job slot and its queued command are cleared, so nothing retries.
export async function runJob(ctx: Ctx, stage: JobStage, issue: number | null): Promise<void> {
  const log = readState(ctx.statePath).job?.log ?? null;
  try {
    await dispatch(ctx, stage, issue);
    ctx.log(stage, issue, 'done');
  } catch (error) {
    await reportFailure(ctx, stage, failureIssue(stage, issue, readState(ctx.statePath)), error, log);
  } finally {
    clearJob(ctx, stage, issue);
  }
}

async function dispatch(ctx: Ctx, stage: JobStage, issue: number | null): Promise<void> {
  if (stage === 'release') return release(ctx);
  // A dev job run by hand has no job in the state, so its build output goes to a fixed log.
  if (stage === 'dev') return void (await deployDev(ctx, readState(ctx.statePath).job?.log ?? `${ctx.cfg.home}/logs/dev-build.log`));
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
    return { ...state, job: null, pendingApprovals, pendingChanges, pendingShip, pendingRemovals };
  });
}
