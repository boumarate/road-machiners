import { renameSync, statfsSync, writeFileSync } from 'node:fs';

// Every tick, paused or not, writes this file. Hermes's incident watch reads it: an old file means ticks stopped, and low space means the disk fills.
export const healthFile = (home: string): string => `${home}/health`;

export type Health = { at: string; freeGb: number; minFreeGb: number };

// Free space for an unprivileged writer, in GB, of the disk that holds `path`.
export function freeGb(path: string): number {
  const stats = statfsSync(path);
  return Math.round((stats.bavail * stats.bsize) / 1e8) / 10;
}

// The watch reads the file at any moment, so it appears whole by a rename.
export function writeHealth(home: string, minFreeGb: number, now: Date): Health {
  const health: Health = { at: now.toISOString(), freeGb: freeGb(home), minFreeGb };
  const path = healthFile(home);
  writeFileSync(`${path}.new`, `${JSON.stringify(health)}\n`);
  renameSync(`${path}.new`, path);
  return health;
}
