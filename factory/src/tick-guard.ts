import { summarizeError } from './fail';
import { updateState } from './state';
import type { Ctx } from './types';

// Runs one tick. A crash records its summary for Hermes's incident watch, then crashes on, so the timer sees it too. The factory posts nothing.
export async function guardTick(ctx: Ctx, tickOnce: () => Promise<void>): Promise<void> {
  try {
    await tickOnce();
    updateState(ctx.statePath, (state) => ({ ...state, lastTickError: null }));
  } catch (error) {
    const summary = summarizeError(error instanceof Error ? error.message : String(error));
    updateState(ctx.statePath, (state) => ({ ...state, lastTickError: summary }));
    throw error;
  }
}
