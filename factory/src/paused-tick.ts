import { isDrainingUpdatePause } from './pause';
import { readState } from './state';
import { releaseAnswered } from './tick';
import type { Ctx } from './types';

// What a paused tick may still do. While the update script drains running jobs, an answered needs-info issue loses its label.
// That is a GitHub label edit only. It reads no code that the update replaces and writes no state, spawns nothing and touches no host clone.
// Every other pause, and an update with no running job or a failed rebuild, does nothing. The pass runs inside the tick service, so the update, which waits for an active tick, never checks out under it.
export async function pausedTick(ctx: Ctx): Promise<void> {
  if (!isDrainingUpdatePause(ctx.cfg.home) || readState(ctx.statePath).jobs.length === 0) return;
  await releaseAnswered(ctx, await ctx.github.cards(), () => isDrainingUpdatePause(ctx.cfg.home));
}
