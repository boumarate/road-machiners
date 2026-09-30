import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseJob, tick, type TickDeps } from './tick';
import { EMPTY_STATE, readState, writeState } from './state';
import { FACTORY_MARK, NEEDS_INFO_LABEL, QUESTIONS_HEADING, STUCK_LABEL, type Card, type ReleaseState, type Ctx, type IssueComment, type FactoryState, type Job } from './types';

const NOW = new Date('2026-01-10T12:00:00Z');
const CFG = { releaseDays: 7, maxJobsPerDay: 3 };
const DEV = 'dev0001';
const FRESH = { lastRelease: '2026-01-09T12:00:00Z', devBuild: DEV };

const state = (over: Partial<FactoryState> = {}): FactoryState => ({ ...structuredClone(EMPTY_STATE), ...FRESH, ...over });
const card = (issue: number, column: Card['column'], labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });

const starts = (...hoursAgo: number[]): string[] => hoursAgo.map((h) => new Date(NOW.getTime() - h * 3_600_000).toISOString());

describe('chooseJob daily cap', () => {
  const capped = state({ jobStarts: starts(23, 5, 1), lastRelease: null });

  it('skips periodic and card jobs at the cap', () => {
    expect(chooseJob(capped, [card(4, 'Design')], NOW, CFG)).toBeNull();
    expect(chooseJob({ ...capped, jobStarts: starts(1, 5) }, [card(4, 'Design')], NOW, CFG)).toEqual({ stage: 'release', issue: null });
  });

  it('still runs committee-driven jobs at the cap', () => {
    expect(chooseJob({ ...capped, pendingApprovals: { '4': 'u' } }, [], NOW, CFG)).toEqual({ stage: 'approve', issue: 4 });
    expect(chooseJob({ ...capped, pendingChanges: [{ id: 2, text: 't', by: 'u' }] }, [], NOW, CFG)).toEqual({ stage: 'change', issue: 2 });
    expect(chooseJob(capped, [card(6, 'Implementation', ['adhoc'])], NOW, CFG)).toEqual({ stage: 'adhoc', issue: 6 });
  });

  it('ignores starts older than 24 hours', () => {
    expect(chooseJob({ ...capped, jobStarts: starts(25, 5, 1) }, [], NOW, CFG)).toEqual({ stage: 'release', issue: null });
  });
});

const RELEASE: ReleaseState = { issue: 20, branch: 'release/2026-01-05', day: '2026-01-05', postId: null, removed: [] };
const tracking = (labels: string[] = ['release']): Card => card(20, 'Approval', labels);

describe('chooseJob during a release', () => {
  const open = state({ release: RELEASE, lastRelease: null });

  it('cuts a release only when none is open', () => {
    expect(chooseJob(state({ lastRelease: null }), [], NOW, CFG)).toEqual({ stage: 'release', issue: null });
    expect(chooseJob(open, [], NOW, CFG)).toBeNull();
  });

  it('starts the candidate once every release task is Done and the tracking issue is healthy', () => {
    const cards = [tracking(), card(21, 'Done', ['release-task', 'maintenance'])];
    expect(chooseJob(open, cards, NOW, CFG)).toEqual({ stage: 'candidate', issue: 20 });
  });

  it('waits for a release task outside Done, also a stuck one', () => {
    expect(chooseJob(open, [tracking(), card(21, 'Approval', ['release-task'])], NOW, CFG)).toBeNull();
    expect(chooseJob(open, [tracking(), card(21, 'Testing', ['release-task', STUCK_LABEL])], NOW, CFG)).toBeNull();
  });

  it('waits when the tracking issue is stuck, missing, or already has a post', () => {
    expect(chooseJob(open, [tracking(['release', STUCK_LABEL])], NOW, CFG)).toBeNull();
    expect(chooseJob(open, [], NOW, CFG)).toBeNull();
    expect(chooseJob({ ...open, release: { ...RELEASE, postId: 5 } }, [tracking()], NOW, CFG)).toBeNull();
  });

  it('counts the candidate against the daily cap', () => {
    const capped = { ...open, jobStarts: starts(23, 5, 1) };
    expect(chooseJob(capped, [tracking()], NOW, CFG)).toBeNull();
  });

  it('runs release tasks before other cards, furthest along first', () => {
    const cards = [tracking(), card(30, 'Testing'), card(21, 'Design', ['release-task']), card(22, 'Implementation', ['release-task'])];
    expect(chooseJob(open, cards, NOW, CFG)).toEqual({ stage: 'implement', issue: 22 });
  });

  it('never gives the tracking issue card a card job', () => {
    expect(chooseJob(state(), [card(20, 'Design', ['release'])], NOW, CFG)).toBeNull();
  });

  it('runs a removal and then a ship before ad hoc work, at the cap too', () => {
    const queuedState = { ...open, release: { ...RELEASE, postId: 5 }, pendingShip: 'Ann', pendingRemovals: [{ issue: 8, by: 'Ann', text: 't' }], jobStarts: starts(23, 5, 1) };
    const adhoc = [card(6, 'Implementation', ['adhoc'])];
    expect(chooseJob(queuedState, adhoc, NOW, CFG)).toEqual({ stage: 'remove', issue: 8 });
    expect(chooseJob({ ...queuedState, pendingRemovals: [] }, adhoc, NOW, CFG)).toEqual({ stage: 'ship', issue: 20 });
  });

  it('runs an approval before a removal', () => {
    const s = { ...open, pendingApprovals: { '4': 'u' }, pendingRemovals: [{ issue: 8, by: 'Ann', text: 't' }] };
    expect(chooseJob(s, [], NOW, CFG)).toEqual({ stage: 'approve', issue: 4 });
  });

  it('ignores a queued ship when no release is open', () => {
    expect(chooseJob(state({ pendingShip: 'Ann' }), [], NOW, CFG)).toBeNull();
  });
});

describe('chooseJob', () => {
  it('picks the lowest ad hoc card after queued work and before due periodic jobs', () => {
    const cards = [card(8, 'Implementation', ['adhoc']), card(6, 'Implementation', ['adhoc']), card(5, 'Implementation'), card(7, 'Implementation', ['adhoc', 'factory-stuck'])];
    expect(chooseJob(state({ lastRelease: null }), cards, NOW, CFG)).toEqual({ stage: 'adhoc', issue: 6 });
    const queuedChange = state({ pendingChanges: [{ id: 3, text: 'x', by: 'a' }] });
    expect(chooseJob(queuedChange, cards, NOW, CFG)).toEqual({ stage: 'change', issue: 3 });
  });

  it('skips ad hoc cards in the normal implement pick', () => {
    const cards = [card(2, 'Implementation', ['adhoc']), card(3, 'Implementation')];
    expect(chooseJob(state(), cards, NOW, CFG)).toEqual({ stage: 'adhoc', issue: 2 });
    expect(chooseJob(state(), [card(2, 'Implementation', ['adhoc', 'factory-stuck']), card(3, 'Implementation')], NOW, CFG)).toEqual({ stage: 'implement', issue: 3 });
  });

  it('returns null while a job runs', () => {
    const job: Job = { stage: 'design', issue: 1, pid: 1, startedAt: '', log: '' };
    expect(chooseJob(state({ job }), [card(2, 'Design')], NOW, CFG)).toBeNull();
  });

  it('runs the lowest pending approval before a change', () => {
    const s = state({ pendingApprovals: { '9': 'u', '4': 'u' }, pendingChanges: [{ id: 3, text: 't', by: 'u' }] });
    expect(chooseJob(s, [], NOW, CFG)).toEqual({ stage: 'approve', issue: 4 });
  });

  it('runs a pending change before periodic jobs', () => {
    const s = state({ pendingChanges: [{ id: 3, text: 't', by: 'u' }], lastRelease: null });
    expect(chooseJob(s, [], NOW, CFG)).toEqual({ stage: 'change', issue: 3 });
  });

  it('runs release when never released or older than the interval', () => {
    expect(chooseJob(state({ lastRelease: null }), [], NOW, CFG)).toEqual({ stage: 'release', issue: null });
    expect(chooseJob(state({ lastRelease: '2026-01-03T11:00:00Z' }), [], NOW, CFG)).toEqual({ stage: 'release', issue: null });
  });

  it('skips release inside the interval', () => {
    expect(chooseJob(state({ lastRelease: '2026-01-03T13:00:00Z' }), [], NOW, CFG)).toBeNull();
  });

  it('picks the card furthest along, lowest issue first', () => {
    const cards = [card(1, 'Design'), card(5, 'Implementation'), card(7, 'Testing'), card(6, 'Testing')];
    expect(chooseJob(state(), cards, NOW, CFG)).toEqual({ stage: 'testing', issue: 6 });
    expect(chooseJob(state(), cards.slice(0, 2), NOW, CFG)).toEqual({ stage: 'implement', issue: 5 });
    expect(chooseJob(state(), cards.slice(0, 1), NOW, CFG)).toEqual({ stage: 'design', issue: 1 });
  });

  it('runs Triage cards last and skips needs-info and stuck ones', () => {
    const cards = [card(1, 'Triage'), card(2, 'Triage', [NEEDS_INFO_LABEL]), card(3, 'Design')];
    expect(chooseJob(state(), cards, NOW, CFG)).toEqual({ stage: 'design', issue: 3 });
    expect(chooseJob(state(), cards.slice(0, 2), NOW, CFG)).toEqual({ stage: 'triage', issue: 1 });
    expect(chooseJob(state(), [card(2, 'Triage', [NEEDS_INFO_LABEL]), card(4, 'Triage', [STUCK_LABEL])], NOW, CFG)).toBeNull();
  });

  it('rebuilds /dev/ when dev moved, after queued work and before cards, at the cap too', () => {
    const cards = [card(6, 'Implementation', ['adhoc']), card(4, 'Design')];
    expect(chooseJob(state(), cards, NOW, CFG, 'dev0002')).toEqual({ stage: 'dev', issue: null });
    expect(chooseJob(state({ jobStarts: starts(23, 5, 1) }), [], NOW, CFG, 'dev0002')).toEqual({ stage: 'dev', issue: null });
    expect(chooseJob(state({ pendingApprovals: { '4': 'u' } }), [], NOW, CFG, 'dev0002')).toEqual({ stage: 'approve', issue: 4 });
  });

  it('leaves /dev/ alone when it serves dev or dev failed to build', () => {
    expect(chooseJob(state(), [], NOW, CFG, DEV)).toBeNull();
    expect(chooseJob(state({ devFailed: 'dev0002' }), [], NOW, CFG, 'dev0002')).toBeNull();
    expect(chooseJob(state({ devFailed: 'dev0002' }), [], NOW, CFG, 'dev0003')).toEqual({ stage: 'dev', issue: null });
  });

  it('skips stuck cards, Approval and Done', () => {
    const cards = [card(1, 'Testing', [STUCK_LABEL]), card(2, 'Approval'), card(3, 'Done'), card(4, 'Design')];
    expect(chooseJob(state(), cards, NOW, CFG)).toEqual({ stage: 'design', issue: 4 });
    expect(chooseJob(state(), cards.slice(0, 3), NOW, CFG)).toBeNull();
  });
});

type Harness = { ctx: Ctx; sent: string[]; labels: string[]; removed: string[]; deps: TickDeps; killed: number[]; spawned: string[][] };

function harness(job: Job | null, alive: boolean, cards: Card[] = [], comments: IssueComment[] = [], devHead = DEV): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'tick-'));
  const statePath = join(dir, 'state.json');
  writeState(statePath, state({ job }));
  const sent: string[] = [];
  const labels: string[] = [];
  const removed: string[] = [];
  const killed: number[] = [];
  const spawned: string[][] = [];
  const github = { cards: async () => cards, candidates: async () => [], addLabel: async (n: number, l: string) => { labels.push(`${n}:${l}`); }, comments: async () => comments, removeLabel: async (n: number, l: string) => { removed.push(`${n}:${l}`); } };
  const telegram = { sendMessage: async (_chat: string, text: string) => { sent.push(text); return 1; } };
  const cfg = { home: dir, webRoot: join(dir, 'web'), repo: 'o/r', committeeChat: 'c', stageTimeoutMinutes: 30, ...CFG };
  const repo = { sync: async () => {}, headHash: async (branch: string) => { if (branch !== 'dev') throw new Error(`unexpected branch ${branch}`); return devHead; } };
  const ctx = { cfg, github, telegram, repo, statePath, now: () => NOW, log: () => undefined } as unknown as Ctx;
  const deps: TickDeps = { isAlive: () => alive, kill: async (_run, pid) => { killed.push(pid); }, spawn: (args) => { spawned.push(args); return 77; } };
  return { ctx, sent, labels, removed, deps, killed, spawned };
}

const job = (startedAt: string, stage: Job['stage'] = 'design', issue: number | null = 5): Job => ({ stage, issue, pid: 42, startedAt, log: '/l.log' });

describe('tick', () => {
  it('kills a job past the timeout, clears it and reports', async () => {
    const h = harness(job('2026-01-10T11:00:00Z'), true);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual([42]);
    expect(h.labels).toEqual([`5:${STUCK_LABEL}`]);
    expect(h.sent[0]).toContain('timed out after 30 minutes');
    expect(readState(h.ctx.statePath).job).toBeNull();
  });

  it('leaves a job in time alone', async () => {
    const h = harness(job('2026-01-10T11:50:00Z'), true, [card(8, 'Design')]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.killed).toEqual([]);
    expect(h.spawned).toEqual([]);
    expect(readState(h.ctx.statePath).job?.pid).toBe(42);
  });

  it('reports a dead job that stayed in state, without an issue for a change', async () => {
    const h = harness(job('2026-01-10T11:50:00Z', 'change', 3), false);
    await tick(h.ctx, '/code', h.deps);
    expect(h.labels).toEqual([]);
    expect(h.sent[0]).toContain('job process died without finishing');
    expect(readState(h.ctx.statePath).job).toBeNull();
  });

  it('starts the chosen job and records it', async () => {
    const h = harness(null, false, [card(8, 'Implementation')]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([['implement', '8']]);
    const started = readState(h.ctx.statePath).job;
    expect(started).toMatchObject({ stage: 'implement', issue: 8, pid: 77 });
    expect(started?.log).toMatch(/logs\/implement-8-2026-01-10T120000\.000Z\.log$/);
  });

  it('starts a /dev/ rebuild when origin dev moved past the build', async () => {
    const h = harness(null, false, [card(8, 'Implementation')], [], 'dev0002');
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([['dev', '-']]);
    expect(readState(h.ctx.statePath).jobStarts).toEqual([]);
  });

  it('removes needs-info from an answered Triage card and starts its triage', async () => {
    const asked = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n1. What?\n\n${FACTORY_MARK}` };
    const h = harness(null, false, [card(8, 'Triage', [NEEDS_INFO_LABEL])], [asked, { login: 'anna', body: 'This' }]);
    await tick(h.ctx, '/code', h.deps);
    expect(h.removed).toEqual([`8:${NEEDS_INFO_LABEL}`]);
    expect(h.spawned).toEqual([['triage', '8']]);
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
    expect(c.spawned).toEqual([['approve', '3']]);
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
    writeState(after.ctx.statePath, state({ job: job('2026-01-10T11:50:00Z', 'release', null), release: RELEASE }));
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

  it('starts a queued ship without counting it against the cap', async () => {
    const h = harness(null, false, []);
    writeState(h.ctx.statePath, state({ release: { ...RELEASE, postId: 7 }, pendingShip: 'Ann', jobStarts: starts(2) }));
    await tick(h.ctx, '/code', h.deps);
    expect(h.spawned).toEqual([['ship', '20']]);
    expect(readState(h.ctx.statePath).jobStarts).toEqual(starts(2));
  });
});
