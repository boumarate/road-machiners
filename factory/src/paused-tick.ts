import { isDrainingUpdatePause, pausedSince } from './pause';
import { readState } from './state';
import { REAL_DEPS, drainJobs, releaseAnswered, type TickDeps } from './tick';
import type { Ctx } from './types';

// What a paused tick may still do while the update script waits for running jobs.
// It stops a job past the timeout, and after the grace time it stops agent and test jobs, so the update never waits on a long job. See drainJobs.
// An answered needs-info issue loses its label, a GitHub label edit only.
// It reads no code that the update replaces, spawns nothing and touches no host clone. Every other pause, and an update with no running job or a failed rebuild, does nothing.
// The pass runs inside the tick service, so the update, which waits for an active tick, never checks out under it.
export async function pausedTick(ctx: Ctx, deps: TickDeps = REAL_DEPS): Promise<void> {
  if (!isDrainingUpdatePause(ctx.cfg.home) || readState(ctx.statePath).jobs.length === 0) return;
  await drainJobs(ctx, pausedSince(ctx.cfg.home), deps);
  await releaseAnswered(ctx, await ctx.github.cards(), () => isDrainingUpdatePause(ctx.cfg.home));
}
