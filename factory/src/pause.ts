import { existsSync, readFileSync } from 'node:fs';

// Hermes pauses the factory with this file while it repairs state by hand. Its text says why.
export const pauseFile = (home: string): string => `${home}/paused`;

// The reason the factory is paused, or null when it runs.
export function pausedReason(home: string): string | null {
  const path = pauseFile(home);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim() || 'no reason given';
}
