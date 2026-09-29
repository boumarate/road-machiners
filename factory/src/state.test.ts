import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readState, updateState } from './state';

describe('state', () => {
  it('reads an old state file without adhocReplies', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: null, pendingApprovals: {}, pendingChanges: [] }));
    expect(readState(path).adhocReplies).toEqual({});
  });

  it('reads an old state file without builds, jobStarts or capNoticed', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: null, pendingApprovals: {}, pendingChanges: [] }));
    const state = readState(path);
    expect([state.builds, state.jobStarts, state.capNoticed]).toEqual([{}, [], false]);
  });

  it('reads an old state file without the release fields, with lastMaintenance left in it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    writeFileSync(path, JSON.stringify({ job: null, approvalPosts: {}, lastRelease: null, lastMaintenance: '2026-01-01T00:00:00Z', pendingApprovals: {}, pendingChanges: [] }));
    const state = readState(path);
    expect([state.release, state.pendingShip, state.pendingRemovals]).toEqual([null, null, []]);
  });

  it('starts empty and keeps updates', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'factory-state-')), 'state.json');
    expect(readState(path).job).toBeNull();
    updateState(path, (s) => ({ ...s, approvalPosts: { '7': 12 } }));
    expect(readState(path).approvalPosts).toEqual({ '7': 12 });
  });
});
