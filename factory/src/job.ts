import { reportFailure } from './fail';
import { adhoc } from './stages/adhoc';
import { approve } from './stages/approval';
import { change } from './stages/change';
import { runStage as design } from './stages/design';
import { runStage as implement } from './stages/implement';
import { maintenance } from './stages/maintenance';
import { release } from './stages/release';
import { runStage as testing } from './stages/testing';
import { runStage as triage } from './stages/triage';
import { readState, updateState } from './state';
import type { Ctx, JobStage } from './types';

const CARD_STAGES = { triage, design, implement, testing } as const;

// Runs one job to its end. Success or failure, the job slot and its queued command are cleared, so nothing retries.
export async function runJob(ctx: Ctx, stage: JobStage, issue: number | null): Promise<void> {
  const log = readState(ctx.statePath).job?.log ?? null;
  try {
    await dispatch(ctx, stage, issue);
    ctx.log(stage, issue, 'done');
  } catch (error) {
    await reportFailure(ctx, stage, stage === 'change' ? null : issue, error, log);
  } finally {
    clearJob(ctx, stage, issue);
  }
}

async function dispatch(ctx: Ctx, stage: JobStage, issue: number | null): Promise<void> {
  if (stage === 'release') return release(ctx);
  if (stage === 'maintenance') return maintenance(ctx);
  if (issue === null) throw new Error(`Job ${stage} needs an issue or change id`);
  return dispatchNumbered(ctx, stage, issue);
}

async function dispatchNumbered(ctx: Ctx, stage: Exclude<JobStage, 'release' | 'maintenance'>, issue: number): Promise<void> {
  if (stage === 'change') return change(ctx, issue);
  if (stage === 'adhoc') return adhoc(ctx, issue);
  if (stage === 'approve') return approve(ctx, issue, readState(ctx.statePath).pendingApprovals[String(issue)] ?? 'the committee');
  return CARD_STAGES[stage](ctx, issue);
}

function clearJob(ctx: Ctx, stage: JobStage, issue: number | null): void {
  updateState(ctx.statePath, (state) => {
    const pendingApprovals = { ...state.pendingApprovals };
    if (stage === 'approve') delete pendingApprovals[String(issue)];
    const pendingChanges = stage === 'change' ? state.pendingChanges.filter((item) => item.id !== issue) : state.pendingChanges;
    return { ...state, job: null, pendingApprovals, pendingChanges };
  });
}
