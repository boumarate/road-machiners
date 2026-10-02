import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseJobs, tick, type TickDeps } from './tick';
import { EMPTY_STATE, readState, writeState } from './state';
import { FACTORY_MARK, NEEDS_INFO_LABEL, QUESTIONS_HEADING, STUCK_LABEL, type Card, type ReleaseState, type Ctx, type IssueComment, type FactoryState, type Job } from './types';

const NOW = new Date('2026-01-10T12:00:00Z');
const CFG = { releaseDays: 7, maxJobsPerDay: 3, agentWorkers: 3, testWorkers: 1 };
// One agent worker, so a test sees which card the agent queue prefers.
const ONE = { ...CFG, agentWorkers: 1 };
const DEV = 'dev0001';
const FRESH = { lastRelease: '2026-01-09T12:00:00Z', devBuild: DEV };

const state = (over: Partial<FactoryState> = {}): FactoryState => ({ ...structuredClone(EMPTY_STATE), ...FRESH, ...over });
const card = (issue: number, column: Card['column'], labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });
const running = (stage: Job['stage'], issue: number | null): Job => ({ id: `${stage}-${issue}`, stage, issue, pid: 1, startedAt: '', log: '' });

const starts = (...hoursAgo: number[]): string[] => hoursAgo.map((h) => new Date(NOW.getTime() - h * 3_600_000).toISOString());

describe('chooseJobs daily cap', () => {
  const capped = state({ jobStarts: starts(23, 5, 1), lastRelease: null });

  it('skips periodic and card jobs at the cap, and fills only the slots left', () => {
    expect(chooseJobs(capped, [card(4, 'Design')], NOW, CFG)).toEqual([]);
    expect(chooseJobs({ ...capped, jobStarts: starts(1, 5) }, [card(4, 'Design')], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
  });

  it('still runs committee-driven jobs at the cap', () => {
    expect(chooseJobs({ ...capped, pendingApprovals: { '4': 'u' } }, [], NOW, CFG)).toEqual([{ stage: 'approve', issue: 4 }]);
    expect(chooseJobs({ ...capped, pendingChanges: [{ id: 2, text: 't', by: 'u' }] }, [], NOW, CFG)).toEqual([{ stage: 'change', issue: 2 }]);
    expect(chooseJobs(capped, [card(6, 'Implementation', ['adhoc'])], NOW, CFG)).toEqual([{ stage: 'adhoc', issue: 6 }]);
  });

  it('ignores starts older than 24 hours', () => {
    expect(chooseJobs({ ...capped, jobStarts: starts(25, 5, 1) }, [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
  });
});

const RELEASE: ReleaseState = { issue: 20, branch: 'release/2026-01-05', day: '2026-01-05', postId: null, removed: [] };
const tracking = (labels: string[] = ['release']): Card => card(20, 'Approval', labels);

describe('chooseJobs during a release', () => {
  const open = state({ release: RELEASE, lastRelease: null });

  it('cuts a release only when none is open', () => {
    expect(chooseJobs(state({ lastRelease: null }), [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
    expect(chooseJobs(open, [], NOW, CFG)).toEqual([]);
  });

  it('starts the candidate once every release task is Done and the tracking issue is healthy', () => {
    const cards = [tracking(), card(21, 'Done', ['release-task', 'maintenance'])];
    expect(chooseJobs(open, cards, NOW, CFG)).toEqual([{ stage: 'candidate', issue: 20 }]);
  });

  it('waits for a release task outside Done, also a stuck one', () => {
    expect(chooseJobs(open, [tracking(), card(21, 'Approval', ['release-task'])], NOW, CFG)).toEqual([]);
    expect(chooseJobs(open, [tracking(), card(21, 'Testing', ['release-task', STUCK_LABEL])], NOW, CFG)).toEqual([]);
  });

  it('waits when the tracking issue is stuck, missing, or already has a post', () => {
    expect(chooseJobs(open, [tracking(['release', STUCK_LABEL])], NOW, CFG)).toEqual([]);
    expect(chooseJobs(open, [], NOW, CFG)).toEqual([]);
    expect(chooseJobs({ ...open, release: { ...RELEASE, postId: 5 } }, [tracking()], NOW, CFG)).toEqual([]);
  });

  it('counts the candidate against the daily cap', () => {
    expect(chooseJobs({ ...open, jobStarts: starts(23, 5, 1) }, [tracking()], NOW, CFG)).toEqual([]);
  });

  it('runs release tasks before other cards, furthest along first', () => {
    const cards = [tracking(), card(30, 'Implementation'), card(21, 'Design', ['release-task']), card(22, 'Implementation', ['release-task'])];
    expect(chooseJobs(open, cards, NOW, ONE)).toEqual([{ stage: 'implement', issue: 22 }]);
    expect(chooseJobs(open, cards, NOW, CFG)).toEqual([{ stage: 'implement', issue: 22 }, { stage: 'design', issue: 21 }, { stage: 'implement', issue: 30 }]);
  });

  it('never gives the tracking issue card a card job', () => {
    expect(chooseJobs(state(), [card(20, 'Design', ['release'])], NOW, CFG)).toEqual([]);
  });

  it('runs one branch job at a time, a removal before a ship, beside ad hoc work, at the cap too', () => {
    const queuedState = { ...open, release: { ...RELEASE, postId: 5 }, pendingShip: 'Ann', pendingRemovals: [{ issue: 8, by: 'Ann', text: 't' }], jobStarts: starts(23, 5, 1) };
    const adhoc = [card(6, 'Implementation', ['adhoc'])];
    expect(chooseJobs(queuedState, adhoc, NOW, CFG)).toEqual([{ stage: 'remove', issue: 8 }, { stage: 'adhoc', issue: 6 }]);
    expect(chooseJobs({ ...queuedState, pendingRemovals: [] }, adhoc, NOW, CFG)).toEqual([{ stage: 'ship', issue: 20 }, { stage: 'adhoc', issue: 6 }]);
  });

  it('runs an approval before a removal', () => {
    const s = { ...open, pendingApprovals: { '4': 'u' }, pendingRemovals: [{ issue: 8, by: 'Ann', text: 't' }] };
    expect(chooseJobs(s, [], NOW, CFG)).toEqual([{ stage: 'approve', issue: 4 }]);
  });

  it('ignores a queued ship when no release is open', () => {
    expect(chooseJobs(state({ pendingShip: 'Ann' }), [], NOW, CFG)).toEqual([]);
  });
});

describe('chooseJobs', () => {
  it('picks the lowest ad hoc card before other agent work, beside a branch job', () => {
    const cards = [card(8, 'Implementation', ['adhoc']), card(6, 'Implementation', ['adhoc']), card(5, 'Implementation'), card(7, 'Implementation', ['adhoc', 'factory-stuck'])];
    expect(chooseJobs(state({ lastRelease: null }), cards, NOW, ONE)).toEqual([{ stage: 'release', issue: null }, { stage: 'adhoc', issue: 6 }]);
    expect(chooseJobs(state(), cards, NOW, CFG)).toEqual([{ stage: 'adhoc', issue: 6 }, { stage: 'adhoc', issue: 8 }, { stage: 'implement', issue: 5 }]);
  });

  it('runs a hotfix card before ad hoc work and other cards, at the cap too', () => {
    const cards = [card(2, 'Implementation', ['adhoc']), card(3, 'Testing'), card(9, 'Design', ['bug', 'hotfix']), card(8, 'Design', ['hotfix', 'factory-stuck'])];
    expect(chooseJobs(state(), cards, NOW, ONE)).toEqual([{ stage: 'design', issue: 9 }, { stage: 'testing', issue: 3 }]);
    expect(chooseJobs(state({ jobStarts: starts(23, 5, 1) }), cards, NOW, CFG)).toEqual([{ stage: 'design', issue: 9 }, { stage: 'adhoc', issue: 2 }]);
  });

  it('skips ad hoc cards in the normal implement pick', () => {
    expect(chooseJobs(state(), [card(2, 'Implementation', ['adhoc', 'factory-stuck']), card(3, 'Implementation')], NOW, CFG)).toEqual([{ stage: 'implement', issue: 3 }]);
  });

  it('fills each queue up to its limit beside running jobs, never twice on one issue', () => {
    const s = state({ jobs: [running('design', 1), running('testing', 7), running('approve', 9)], pendingChanges: [{ id: 3, text: 't', by: 'u' }] });
    const cards = [card(1, 'Design'), card(2, 'Design'), card(8, 'Testing'), card(4, 'Triage'), card(5, 'Triage')];
    expect(chooseJobs(s, cards, NOW, { ...CFG, maxJobsPerDay: 10 })).toEqual([{ stage: 'design', issue: 2 }, { stage: 'triage', issue: 4 }]);
    const idle = state({ jobs: [running('design', 1)] });
    expect(chooseJobs(idle, cards, NOW, { ...CFG, maxJobsPerDay: 10, testWorkers: 2 })).toEqual([{ stage: 'testing', issue: 8 }, { stage: 'design', issue: 2 }, { stage: 'triage', issue: 4 }]);
  });

  it('counts each counted pick against the cap slots left', () => {
    const cards = [card(1, 'Design'), card(2, 'Design'), card(3, 'Design')];
    expect(chooseJobs(state({ jobStarts: starts(2) }), cards, NOW, CFG)).toEqual([{ stage: 'design', issue: 1 }, { stage: 'design', issue: 2 }]);
  });

  it('runs the lowest pending approval before a change', () => {
    const s = state({ pendingApprovals: { '9': 'u', '4': 'u' }, pendingChanges: [{ id: 3, text: 't', by: 'u' }] });
    expect(chooseJobs(s, [], NOW, CFG)).toEqual([{ stage: 'approve', issue: 4 }]);
  });

  it('runs a pending change before periodic jobs', () => {
    const s = state({ pendingChanges: [{ id: 3, text: 't', by: 'u' }], lastRelease: null });
    expect(chooseJobs(s, [], NOW, CFG)).toEqual([{ stage: 'change', issue: 3 }]);
  });

  it('runs release when never released or older than the interval', () => {
    expect(chooseJobs(state({ lastRelease: null }), [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
    expect(chooseJobs(state({ lastRelease: '2026-01-03T11:00:00Z' }), [], NOW, CFG)).toEqual([{ stage: 'release', issue: null }]);
  });

  it('skips release inside the interval', () => {
    expect(chooseJobs(state({ lastRelease: '2026-01-03T13:00:00Z' }), [], NOW, CFG)).toEqual([]);
  });

  it('picks the card furthest along, lowest issue first, per queue', () => {
    const cards = [card(1, 'Design'), card(5, 'Implementation'), card(7, 'Testing'), card(6, 'Testing')];
    expect(chooseJobs(state(), cards, NOW, ONE)).toEqual([{ stage: 'testing', issue: 6 }, { stage: 'implement', issue: 5 }]);
    expect(chooseJobs(state(), cards.slice(0, 1), NOW, ONE)).toEqual([{ stage: 'design', issue: 1 }]);
  });

  it('runs Triage cards last and skips needs-info and stuck ones', () => {
    const cards = [card(1, 'Triage'), card(2, 'Triage', [NEEDS_INFO_LABEL]), card(3, 'Design')];
    expect(chooseJobs(state(), cards, NOW, ONE)).toEqual([{ stage: 'design', issue: 3 }]);
    expect(chooseJobs(state(), cards.slice(0, 2), NOW, ONE)).toEqual([{ stage: 'triage', issue: 1 }]);
    expect(chooseJobs(state(), [card(2, 'Triage', [NEEDS_INFO_LABEL]), card(4, 'Triage', [STUCK_LABEL])], NOW, CFG)).toEqual([]);
  });

  it('rebuilds /dev/ when dev moved, after queued work, beside cards, at the cap too', () => {
    const cards = [card(6, 'Implementation', ['adhoc']), card(4, 'Design')];
    expect(chooseJobs(state(), cards, NOW, CFG, 'dev0002')).toEqual([{ stage: 'dev', issue: null }, { stage: 'adhoc', issue: 6 }, { stage: 'design', issue: 4 }]);
    expect(chooseJobs(state({ jobStarts: starts(23, 5, 1) }), [], NOW, CFG, 'dev0002')).toEqual([{ stage: 'dev', issue: null }]);
    expect(chooseJobs(state({ pendingApprovals: { '4': 'u' } }), [], NOW, CFG, 'dev0002')).toEqual([{ stage: 'approve', issue: 4 }]);
    expect(chooseJobs(state({ jobs: [running('approve', 4)] }), [], NOW, CFG, 'dev0002')).toEqual([]);
  });

  it('leaves /dev/ alone when it serves dev or dev failed to build', () => {
    expect(chooseJobs(state(), [], NOW, CFG, DEV)).toEqual([]);
    expect(chooseJobs(state({ devFailed: 'dev0002' }), [], NOW, CFG, 'dev0002')).toEqual([]);
    expect(chooseJobs(state({ devFailed: 'dev0002' }), [], NOW, CFG, 'dev0003')).toEqual([{ stage: 'dev', issue: null }]);
  });

  it('skips stuck cards, Approval and Done', () => {
    const cards = [card(1, 'Testing', [STUCK_LABEL]), card(2, 'Approval'), card(3, 'Done'), card(4, 'Design')];
    expect(chooseJobs(state(), cards, NOW, CFG)).toEqual([{ stage: 'design', issue: 4 }]);
    expect(chooseJobs(state(), cards.slice(0, 3), NOW, CFG)).toEqual([]);
  });
});

type Harness = { ctx: Ctx; sent: string[]; labels: string[]; removed: string[]; deps: TickDeps; killed: string[]; spawned: string[][] };

function harness(job: Job | null, alive: boolean, cards: Card[] = [], comments: IssueComment[] = [], devHead = DEV): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'tick-'));
  const statePath = join(dir, 'state.json');
  writeState(statePath, state({ jobs: job ? [job] : [] }));
  const sent: string[] = [];
  const labels: string[] = [];
  const removed: string[] = [];
  const killed: string[] = [];
  const spawned: string[][] = [];
  const github = { cards: async () => cards, candidates: async () => [], addLabel: async (n: number, l: string) => { labels.push(`${n}:${l}`); }, comments: async () => comments, removeLabel: async (n: number, l: string) => { removed.push(`${n}:${l}`); } };
  const telegram = { sendMessage: async (_chat: string, text: string) => { sent.push(text); return 1; } };
  const cfg = { home: dir, webRoot: join(dir, 'web'), repo: 'o/r', committeeChat: 'c', stageTimeoutMinutes: 30, ...CFG };
  const repo = { fetch: async () => {},headHash: async (branch: string) => { if (branch !== 'dev') throw new Error(`unexpected branch ${branch}`); return devHead; } };
  const ctx = { cfg, github, telegram, repo, statePath, now: () => NOW, log: () => undefined } as unknown as Ctx;
  const deps: TickDeps = { isAlive: () => alive, kill: async (_run, pid, id) => { killed.push(`${pid} ${id}`); }, removeContainers: async (_run, id) => { killed.push(`containers ${id}`); }, spawn: (args, _cwd, _log, id) => { spawned.push([...args, id]); return 77; } };
  return { ctx, sent, labels, removed, deps, killed, spawned };
}

const job = (startedAt: string, stage: Job['stage'] = 'design', issue: number | null = 5): Job => ({ id: `${stage}-job`, stage, issue, pid: 42, startedAt, log: '/l.log' });
// The spawned args without the job id at the end.
const args = (h: Harness): string[][] => h.spawned.map((call) => call.slice(0, 2));

describe('tick', () => {
  it('kills a job past the timeout by its id, clears it and reports', async () => {
    const h = harness(job('2026-01-10T11:00:00Z'), true);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual(['42 design-job']);
    expect(h.labels).toEqual([`5:${STUCK_LABEL}`]);
    expect(readState(h.ctx.statePath).failures[0].error).toBe('timed out after 30 minutes');
    expect(h.sent).toEqual([]);
    expect(readState(h.ctx.statePath).jobs).toEqual([]);
  });

  it('leaves a job in time alone and starts another beside it', async () => {
    const h = harness(job('2026-01-10T11:50:00Z'), true, [card(5, 'Design'), card(8, 'Design')]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual([]);
    expect(args(h)).toEqual([['design', '8']]);
    expect(readState(h.ctx.statePath).jobs.map((j) => [j.issue, j.pid])).toEqual([[5, 42], [8, 77]]);
  });

  it('reports a dead job that stayed in state, without an issue for a change', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'change', 3), false);
    await tick(h.ctx, '/code', h.deps);
    expect(h.labels).toEqual([]);
    expect(readState(h.ctx.statePath).failures).toMatchObject([{ stage: 'change', issue: null, error: 'job process died without finishing' }]);
    expect(readState(h.ctx.statePath).jobs).toEqual([]);
  });

  it('starts the chosen jobs and records each with its id', async () => {
    const h = harness(null, false, [card(8, 'Implementation'), card(9, 'Testing')]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([['testing', '9', 'testing-9-2026-01-10T120000.000Z'], ['implement', '8', 'implement-8-2026-01-10T120000.000Z']]);
    const started = readState(h.ctx.statePath).jobs;
    expect(started[1]).toMatchObject({ id: 'implement-8-2026-01-10T120000.000Z', stage: 'implement', issue: 8, pid: 77 });
    expect(started[1].log).toMatch(/logs\/implement-8-2026-01-10T120000\.000Z\.log$/);
  });

  it('skips build cleanup while a testing or branch job runs', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'testing', 9), true, []);
    mkdirSync(join(h.ctx.cfg.webRoot, 'fresh01'), { recursive: true });
    await tick(h.ctx, '/code', h.deps);
    expect(existsSync(join(h.ctx.cfg.webRoot, 'fresh01'))).toBe(true);
  });

  it('starts a /dev/ rebuild when origin dev moved past the build', async () => {
    const h = harness(null, false, [card(8, 'Implementation')], [], 'dev0002');
    await tick(h.ctx, '/code', h.deps);
    expect(args(h)).toEqual([['dev', '-'], ['implement', '8']]);
    expect(readState(h.ctx.statePath).jobStarts).toEqual([NOW.toISOString()]);
  });

  it('removes needs-info from an answered Triage card and starts its triage', async () => {
    const asked = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n1. What?\n\n${FACTORY_MARK}` };
    const h = harness(null, false, [card(8, 'Triage', [NEEDS_INFO_LABEL])], [asked, { login: 'anna', body: 'This' }]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.removed).toEqual([`8:${NEEDS_INFO_LABEL}`]);
    expect(args(h)).toEqual([['triage', '8']]);
  });

  it('keeps needs-info while nobody answered and starts nothing', async () => {
    const asked = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n1. What?\n\n${FACTORY_MARK}` };
    const h = harness(null, false, [card(8, 'Triage', [NEEDS_INFO_LABEL])], [asked]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.removed).toEqual([]);
    expect(h.spawned).toEqual([]);
  });

  it('counts and prunes public-driven starts, not committee-driven ones', async () => {
    const h = harness(null, false, [card(8, 'Implementation')]);
    writeState(h.ctx.statePath, state({ jobStarts: starts(30, 2) }));
    await tick(h.ctx, '/code', h.deps);
    expect(readState(h.ctx.statePath).jobStarts).toEqual([...starts(2), NOW.toISOString()]);
    const c = harness(null, false, []);
    writeState(c.ctx.statePath, state({ jobStarts: starts(2), pendingApprovals: { '3': 'u' } }));
    await tick(c.ctx, '/code', c.deps);
    expect(args(c)).toEqual([['approve', '3']]);
    expect(readState(c.ctx.statePath).jobStarts).toEqual(starts(2));
  });

  it('posts the cap notice once, then again after the cap frees', async () => {
    const h = harness(null, false, [card(8, 'Design')]);
    writeState(h.ctx.statePath, state({ jobStarts: starts(23, 5, 1) }));
    await tick(h.ctx, '/code', h.deps);
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('3 of 3');
    expect(h.sent[0]).toContain('2026-01-10T13:00:00.000Z');
    expect(readState(h.ctx.statePath).capNoticed).toBe(true);
    writeState(h.ctx.statePath, state({ jobStarts: starts(1, 5), capNoticed: true }));
    await tick(h.ctx, '/code', h.deps);
    expect(readState(h.ctx.statePath).capNoticed).toBe(false);
    writeState(h.ctx.statePath, state({ jobStarts: starts(23, 5, 1) }));
    await tick(h.ctx, '/code', h.deps);
    expect(h.sent).toHaveLength(2);
  });

  it('posts no cap notice when nothing waits', async () => {
    const h = harness(null, false, []);
    writeState(h.ctx.statePath, state({ jobStarts: starts(23, 5, 1) }));
    await tick(h.ctx, '/code', h.deps);
    expect(h.sent).toEqual([]);
  });

  it('deletes builds outside Approval after intake, keeping dev', async () => {
    const h = harness(null, false, [card(8, 'Approval'), card(9, 'Done')]);
    const web = h.ctx.cfg.webRoot;
    for (const name of ['dev', 'aaa1111', 'bbb2222', 'ccc3333']) mkdirSync(join(web, name), { recursive: true });
    writeState(h.ctx.statePath, state({ builds: { '8': 'aaa1111', '9': 'bbb2222' } }));
    await tick(h.ctx, '/code', h.deps);
    expect(['dev', 'aaa1111', 'bbb2222', 'ccc3333'].filter((name) => existsSync(join(web, name)))).toEqual(['dev', 'aaa1111']);
  });

  it('keeps the rc build while the tracking card waits in Approval', async () => {
    const h = harness(null, false, [card(20, 'Approval', ['release']), card(9, 'Done')]);
    const web = h.ctx.cfg.webRoot;
    for (const name of ['dev', 'rc', 'bbb2222']) mkdirSync(join(web, name), { recursive: true });
    writeState(h.ctx.statePath, state({ release: { ...RELEASE, postId: 7 }, builds: { '20': 'rc', '9': 'bbb2222' } }));
    await tick(h.ctx, '/code', h.deps);
    expect(['dev', 'rc', 'bbb2222'].filter((name) => existsSync(join(web, name)))).toEqual(['dev', 'rc']);
  });

  it('labels the tracking issue when a candidate job dies', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'candidate', 20), false);
    await tick(h.ctx, '/code', h.deps);
    expect(h.labels).toEqual([`20:${STUCK_LABEL}`]);
  });

  it('labels the tracking issue when a release cut dies after it opened one, and no issue before', async () => {
    const after = harness(job('2026-01-10T11:50:00Z', 'release', null), false);
    writeState(after.ctx.statePath, state({ jobs: [job('2026-01-10T11:50:00Z', 'release', null)], release: RELEASE }));
    await tick(after.ctx, '/code', after.deps);
    expect(after.labels).toEqual([`20:${STUCK_LABEL}`]);
    const before = harness(job('2026-01-10T11:50:00Z', 'release', null), false);
    await tick(before.ctx, '/code', before.deps);
    expect(before.labels).toEqual([]);
  });

  it('labels the removed feature when a removal dies', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'remove', 8), false);
    await tick(h.ctx, '/code', h.deps);
    expect(h.labels).toEqual([`8:${STUCK_LABEL}`]);
  });

  describe('a job whose process died', () => {
    const IN_TIME = '2026-01-10T11:50:00Z';
    const sessions = (h: Harness): string => join(h.ctx.cfg.home, 'sessions', 'issue-5');

    it('resumes an agent job once: removes its containers, marks the issue, reports nothing and starts it again', async () => {
      const h = harness(job(IN_TIME), false, [card(5, 'Design')]);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME)], jobStarts: [IN_TIME] }));
      await tick(h.ctx, '/code', h.deps);
      expect(h.killed).toEqual(['containers design-job']);
      expect(args(h)).toEqual([['design', '5']]);
      const after = readState(h.ctx.statePath);
      expect(after.interrupted).toEqual([5]);
      expect(after.failures).toEqual([]);
      expect(h.labels).toEqual([]);
      expect(after.jobs.map((j) => j.pid)).toEqual([77]);
    });

    it('resumes a test job too', async () => {
      const h = harness(job(IN_TIME, 'testing', 5), false);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME, 'testing', 5)] }));
      await tick(h.ctx, '/code', h.deps);
      expect(readState(h.ctx.statePath)).toMatchObject({ interrupted: [5], failures: [], jobs: [] });
    });

    it('frees the cap slot of the dead job, so the restart does not count twice', async () => {
      const h = harness(job(IN_TIME), false, [card(5, 'Design')]);
      const other = starts(20, 1);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME)], jobStarts: [other[0], IN_TIME, other[1]] }));
      await tick(h.ctx, '/code', h.deps);
      expect(readState(h.ctx.statePath).jobStarts).toEqual([other[0], other[1], NOW.toISOString()]);
    });

    it('takes no cap slot from an uncapped job that resumes', async () => {
      const h = harness(job(IN_TIME, 'adhoc', 5), false);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME, 'adhoc', 5)], jobStarts: [IN_TIME] }));
      await tick(h.ctx, '/code', h.deps);
      expect(readState(h.ctx.statePath).jobStarts).toEqual([IN_TIME]);
      expect(readState(h.ctx.statePath).interrupted).toEqual([5]);
    });

    it('fails a second death, clears the mark and the sessions, and reports', async () => {
      const h = harness(job(IN_TIME), false);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME)], interrupted: [5, 6] }));
      mkdirSync(sessions(h), { recursive: true });
      await tick(h.ctx, '/code', h.deps);
      expect(h.killed).toEqual([]);
      expect(h.labels).toEqual([`5:${STUCK_LABEL}`]);
      const after = readState(h.ctx.statePath);
      expect(after.failures).toMatchObject([{ stage: 'design', issue: 5, error: 'job process died without finishing' }]);
      expect(after.interrupted).toEqual([6]);
      expect(after.jobs).toEqual([]);
      expect(existsSync(sessions(h))).toBe(false);
    });

    it('fails a job past the timeout and never resumes it, dead or alive', async () => {
      const late = '2026-01-10T11:00:00Z';
      const alive = harness(job(late), true);
      await tick(alive.ctx, '/code', alive.deps);
      expect(readState(alive.ctx.statePath)).toMatchObject({ interrupted: [], failures: [{ error: 'timed out after 30 minutes' }] });
      const dead = harness(job(late), false);
      await tick(dead.ctx, '/code', dead.deps);
      expect(readState(dead.ctx.statePath)).toMatchObject({ interrupted: [], failures: [{ error: 'job process died without finishing' }] });
    });

    it('clears a lingering mark and the sessions of a timed out job', async () => {
      const h = harness(job('2026-01-10T11:00:00Z'), true);
      writeState(h.ctx.statePath, state({ jobs: [job('2026-01-10T11:00:00Z')], interrupted: [5] }));
      mkdirSync(sessions(h), { recursive: true });
      await tick(h.ctx, '/code', h.deps);
      expect(readState(h.ctx.statePath).interrupted).toEqual([]);
      expect(existsSync(sessions(h))).toBe(false);
    });

    it('fails a dead branch job, and touches no mark or sessions of the issue that shares its number', async () => {
      const h = harness(job(IN_TIME, 'change', 5), false);
      writeState(h.ctx.statePath, state({ jobs: [job(IN_TIME, 'change', 5)], interrupted: [5] }));
      mkdirSync(sessions(h), { recursive: true });
      await tick(h.ctx, '/code', h.deps);
      expect(h.killed).toEqual([]);
      expect(readState(h.ctx.statePath)).toMatchObject({ interrupted: [5], failures: [{ stage: 'change' }], jobs: [] });
      expect(existsSync(sessions(h))).toBe(true);
    });
  });

  it('starts a queued ship without counting it against the cap', async () => {
    const h = harness(null, false, []);
    writeState(h.ctx.statePath, state({ release: { ...RELEASE, postId: 7 }, pendingShip: 'Ann', jobStarts: starts(2) }));
    await tick(h.ctx, '/code', h.deps);
    expect(args(h)).toEqual([['ship', '20']]);
    expect(readState(h.ctx.statePath).jobStarts).toEqual(starts(2));
  });
});
