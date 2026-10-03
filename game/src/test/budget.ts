import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    hostSlowdown: number;
  }
}

// A test's time budget on a free machine, scaled by the host load that vitest.config.ts measured, as the default test timeout is.
export function budget(ms: number): number {
  return ms * inject('hostSlowdown');
}
