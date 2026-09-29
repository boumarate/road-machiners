import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { FactoryState } from './types';

export const EMPTY_STATE: FactoryState = { job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: null, pendingApprovals: {}, pendingChanges: [], adhocReplies: {}, lastTickError: null };

export function readState(path: string): FactoryState {
  if (!existsSync(path)) return structuredClone(EMPTY_STATE);
  const saved = JSON.parse(readFileSync(path, 'utf8')) as Partial<FactoryState>;
  return { ...saved, adhocReplies: saved.adhocReplies ?? {}, lastTickError: saved.lastTickError ?? null } as FactoryState;
}

// Writes a temp file and renames it, so a crash never leaves half a state file.
export function writeState(path: string, state: FactoryState): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2));
  renameSync(temp, path);
}

export function updateState(path: string, change: (state: FactoryState) => FactoryState): FactoryState {
  const next = change(readState(path));
  writeState(path, next);
  return next;
}
