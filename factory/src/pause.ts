import { existsSync, readFileSync, statSync } from 'node:fs';

// Hermes pauses the factory with this file while it repairs state by hand. Its text says why.
export const pauseFile = (home: string): string => `${home}/paused`;

// The reason the factory is paused, or null when it runs.
export function pausedReason(home: string): string | null {
  const path = pauseFile(home);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trim() || 'no reason given';
}

// The update script writes this prefix into its own pause, and Hermes's pauses never start with it.
const UPDATE_PAUSE_PREFIX = 'update to';
export const updateFailedFile = (home: string): string => `${home}/update-failed`;

// A pause owned by the update script that only waits for running jobs to end. It is not a pause while the update has failed.
export function isDrainingUpdatePause(home: string): boolean {
  const reason = pausedReason(home);
  return reason !== null && reason.startsWith(UPDATE_PAUSE_PREFIX) && !existsSync(updateFailedFile(home));
}

// When the pause began. The update script keeps the file's time when it rewrites the reason.
export function pausedSince(home: string): Date {
  return statSync(pauseFile(home)).mtime;
}
