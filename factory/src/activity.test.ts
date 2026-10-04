import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import * as activity from './activity';
import { readObservation } from './observability';
import type { Run } from './types';
const homes: string[] = [];
function createHome() { mkdirSync('tmp', { recursive: true }); const home = mkdtempSync('tmp/activity-'); homes.push(home); return home; }
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
it('reports structured tool activity across chunk boundaries without publishing arguments', async () => {
  expect(activity).toHaveProperty('createObservedRun');
  const home = createHome();
  const run: Run = async (_cmd, _args, opts) => {
    const event = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test -- PRIVATE_TOKEN' } }] } }) + '\n';
    opts?.onStdout?.(event.slice(0, 25));
    opts?.onStdout?.(event.slice(25));
    const current = readObservation(home, 'job-1');
    expect(current?.data).toMatchObject({ type: 'activity', activity: 'tests', phase: 'running' });
    expect(JSON.stringify(current)).not.toContain('PRIVATE');
    return { code: 0, stdout: 'original output', stderr: '' };
  };
  const observed = activity.createObservedRun(run, home, 'job-1', 10000, 1024 * 1024);
  expect(await observed('docker', ['run', 'factory-agent'])).toEqual({ code: 0, stdout: 'original output', stderr: '' });
  expect(readObservation(home, 'job-1')?.data).toMatchObject({ phase: 'completed' });
});
it('clears the active operation on command failure without replacing its result', async () => {
  expect(activity).toHaveProperty('createObservedRun');
  const home = createHome();
  const observed = activity.createObservedRun(async () => ({ code: 1, stdout: '', stderr: 'PRIVATE error' }), home, 'job-2', 10000, 1024 * 1024);
  expect((await observed('git', ['fetch'])).code).toBe(1);
  expect(readObservation(home, 'job-2')?.data).toMatchObject({ activity: 'git', phase: 'failed' });
  expect(JSON.stringify(readObservation(home, 'job-2'))).not.toContain('PRIVATE');
});
it('recognizes machine check steps and rejects arbitrary status text', () => {
  expect(activity).toHaveProperty('readActivityLine');
  expect(activity.readActivityLine('[checks] 12:10:00 playtest')).toBe('playtest');
  expect(activity.readActivityLine('{"type":"factory_status","activity":"install"}')).toBe('install');
  expect(activity.readActivityLine('PRIVATE prompt and secrets')).toBeNull();
});
