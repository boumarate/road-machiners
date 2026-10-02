import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pauseFile, updateFailedFile } from './pause';
import { pausedTick } from './paused-tick';
import { EMPTY_STATE, readState, writeState } from './state';
import type { TickDeps } from './tick';
import { FACTORY_MARK, NEEDS_INFO_LABEL, QUESTIONS_HEADING, STUCK_LABEL, type Card, type Ctx, type IssueComment, type Job } from './types';

const asked: IssueComment = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n1. What?\n\n${FACTORY_MARK}` };
const image: IssueComment = { login: 'anna', body: '<img width="1" src="https://github.com/user-attachments/assets/882dcec0-4280-4896-9c35-eb126be63a02" />' };
const card = (issue: number, labels: string[] = [NEEDS_INFO_LABEL]): Card => ({ itemId: `i${issue}`, issue, column: 'Triage', labels });

const UPDATE = 'update to 1086eba, waiting for the running jobs';
const NOW = new Date('2026-01-10T12:00:00Z');
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);
const running = (id: string, stage: Job['stage'], issue: number | null, startedAt = NOW): Job => ({ id, stage, issue, pid: 1, startedAt: startedAt.toISOString(), log: `/logs/${id}.log` });

function setup(pause: string | null, comments: IssueComment[], liveJobs = 2, cards: Card[] = [card(81)], jobs: Job[] = Array.from({ length: liveJobs }, (_, i) => running(`j${i}`, 'testing', 100 + i))) {
  const home = mkdtempSync(join(tmpdir(), 'paused-'));
  const statePath = join(home, 'state.json');
  const initial = { ...structuredClone(EMPTY_STATE), jobs, jobStarts: jobs.map((job) => job.startedAt) };
  writeState(statePath, initial);
  if (pause !== null) {
    writeFileSync(pauseFile(home), pause);
    utimesSync(pauseFile(home), NOW, NOW);
  }
  const removed: string[] = [];
  const other: string[] = [];
  const killed: string[] = [];
  const containers = new Set(jobs.map((job) => job.id));
  const github = {
    cards: async () => cards,
    comments: async (_n: number) => comments,
    removeLabel: async (n: number, l: string) => { removed.push(`${n}:${l}`); },
    addLabel: async () => { other.push('addLabel'); },
  };
  const repo = { fetch: async () => { other.push('fetch'); } };
  const cfg = { home, stageTimeoutMinutes: 180, updateGraceMinutes: 10 };
  const ctx = { cfg, github, repo, statePath, now: () => NOW, log: () => undefined } as unknown as Ctx;
  const deps: TickDeps = {
    isAlive: () => true,
    inContainer: async (_run, id) => containers.has(id),
    kill: async (_run, pid, id) => { killed.push(`${pid} ${id}`); },
    spawn: () => { throw new Error('a paused tick spawns nothing'); },
  };
  const age = (minutes: number) => utimesSync(pauseFile(home), minutesAgo(minutes), minutesAgo(minutes));
  return { ctx, home, github, removed, other, initial, deps, killed, containers, age };
}

describe('pausedTick', () => {
  it('releases an issue answered with an HTML image while an update drains jobs, and spawns and writes nothing', async () => {
    const t = setup('update to 1086eba, waiting for the running jobs', [asked, image]);
    await pausedTick(t.ctx, t.deps);
    expect(t.removed).toEqual([`81:${NEEDS_INFO_LABEL}`]);
    expect(t.other).toEqual([]);
    expect(readState(t.ctx.statePath)).toEqual(t.initial);
  });

  it('leaves an unanswered issue and a stuck label alone', async () => {
    const t = setup('update to 1086eba, waiting for the running jobs', [asked], 1, [card(81), card(82, [STUCK_LABEL])]);
    await pausedTick(t.ctx, t.deps);
    expect(t.removed).toEqual([]);
  });

  it('does nothing under a manual pause', async () => {
    for (const reason of ['Hermes repairs #4', '', 'please update to 1086eba']) {
      const t = setup(reason, [asked, image]);
      await pausedTick(t.ctx, t.deps);
      expect(t.removed).toEqual([]);
    }
  });

  it('does nothing when the update has failed or no job runs', async () => {
    const failed = setup('update to 1086eba, waiting for the running jobs', [asked, image]);
    writeFileSync(updateFailedFile(failed.home), 'npm ci failed');
    await pausedTick(failed.ctx, failed.deps);
    expect(failed.removed).toEqual([]);
    const idle = setup('update to 1086eba, waiting for the running jobs', [asked, image], 0);
    await pausedTick(idle.ctx, idle.deps);
    expect(idle.removed).toEqual([]);
  });

  it('does nothing without a pause', async () => {
    const t = setup(null, [asked, image]);
    await pausedTick(t.ctx, t.deps);
    expect(t.removed).toEqual([]);
  });

  it('waits for every job within the grace time', async () => {
    const t = setup(UPDATE, [], 0, [], [running('impl', 'implement', 81)]);
    t.age(9);
    await pausedTick(t.ctx, t.deps);
    expect(t.killed).toEqual([]);
    expect(readState(t.ctx.statePath)).toEqual(t.initial);
  });

  it('after the grace time stops agent and test jobs in a container, keeps their cards and frees their cap slots', async () => {
    const jobs = [running('impl', 'implement', 81, minutesAgo(170)), running('test', 'testing', 82), running('adhoc', 'adhoc', 83), running('ship', 'ship', 7), running('triage', 'triage', 84)];
    const t = setup(UPDATE, [], 0, [], jobs);
    t.containers.delete('ship');
    t.containers.delete('triage');
    t.age(11);
    await pausedTick(t.ctx, t.deps);
    expect(t.killed).toEqual(['1 impl', '1 test', '1 adhoc']);
    const state = readState(t.ctx.statePath);
    expect(state.jobs.map((job) => job.id)).toEqual(['ship', 'triage']);
    expect(state.interrupted).toEqual([81, 82, 83]);
    expect(state.jobStarts).toEqual([NOW.toISOString(), NOW.toISOString()]);
    expect(state.failures).toEqual([]);
    expect(t.other).toEqual([]);
  });

  it('fails a job past the timeout instead of stopping it, so a deploy never restarts its clock', async () => {
    const t = setup(UPDATE, [], 0, [], [running('ship', 'ship', 7, minutesAgo(181)), running('impl', 'implement', 81, minutesAgo(181))]);
    t.age(11);
    await pausedTick(t.ctx, t.deps);
    expect(t.killed).toEqual(['1 ship', '1 impl']);
    const state = readState(t.ctx.statePath);
    expect(state.failures).toMatchObject([{ stage: 'ship', issue: 7, error: 'timed out after 180 minutes' }, { stage: 'implement', issue: 81, error: 'timed out after 180 minutes' }]);
    expect(state.interrupted).toEqual([]);
    expect(t.other).toEqual(['addLabel', 'addLabel']);
  });

  it('stops no job under a failed update or a manual pause', async () => {
    const failed = setup(UPDATE, [], 0, [], [running('impl', 'implement', 81, minutesAgo(200))]);
    failed.age(60);
    writeFileSync(updateFailedFile(failed.home), 'npm ci failed');
    await pausedTick(failed.ctx, failed.deps);
    const manual = setup('Hermes repairs #4', [], 0, [], [running('impl', 'implement', 81, minutesAgo(200))]);
    manual.age(60);
    await pausedTick(manual.ctx, manual.deps);
    expect([...failed.killed, ...manual.killed]).toEqual([]);
  });

  it('stops when the pause turns into a manual one mid-pass', async () => {
    const t = setup('update to 1086eba, waiting for the running jobs', [asked, image], 1, [card(81), card(82)]);
    t.github.comments = async () => { writeFileSync(pauseFile(t.home), 'Hermes repairs state'); return [asked, image]; };
    await pausedTick(t.ctx, t.deps);
    expect(t.removed).toEqual([]);
  });
});
