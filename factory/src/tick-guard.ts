import { summarizeError } from './fail';
import { readState, updateState } from './state';
import type { Ctx } from './types';

// Runs one tick. A crash posts to the committee once per distinct error, then crashes on, so the timer sees it too.
export async function guardTick(ctx: Ctx, tickOnce: () => Promise<void>): Promise<void> {
  try {
    await tickOnce();
    updateState(ctx.statePath, (state) => ({ ...state, lastTickError: null }));
  } catch (error) {
    const summary = summarizeError(error instanceof Error ? error.message : String(error));
    if (readState(ctx.statePath).lastTickError !== summary) {
      updateState(ctx.statePath, (state) => ({ ...state, lastTickError: summary }));
      await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `The factory tick crashed. Nothing moves until it runs again.\n\n${summary}\n\nThe factory posts again only when the error changes. Hermes is looking into it.`);
    }
    throw error;
  }
}
