import { join } from 'node:path';
import { removeStaleBuilds } from './deploy';
import { failureIssue, pruneFailures, reportFailure } from './fail';
import { intake } from './intake';
import { pruneCaptions } from './post-status';
import { isAlive, killJob, spawnJob } from './jobs';
import { readState, updateState } from './state';
import { isAnswered } from './questions';
import { ADHOC_LABEL, HOTFIX_LABEL, NEEDS_INFO_LABEL, QUEUE_OF, RELEASE_LABEL, RELEASE_TASK_LABEL, STUCK_LABEL } from './types';
import type { Card, Ctx, FactoryConfig, FactoryState, Job, JobStage, Queue, Run } from './types';

export type JobPick = { stage: JobStage; issue: number | null };
// A candidate job and whether it may start at the daily cap.
type Candidate = JobPick & { uncapped: boolean };
type Due = Pick<FactoryConfig, 'releaseDays' | 'maxJobsPerDay' | 'agentWorkers' | 'testWorkers'>;

const DAY_MS = 24 * 3_600_000;
const MINUTE_MS = 60_000;
// Committee-driven jobs never count against the daily cap.
const UNCAPPED_STAGES: JobStage[] = ['approve', 'remove', 'ship', 'change', 'adhoc', 'dev'];
const CARD_ORDER: [Card['column'], JobStage][] = [['Testing', 'testing'], ['Implementation', 'implement'], ['Design', 'design'], ['Triage', 'triage']];

function isDue(last: string | null, now: Date, everyMs: number): boolean {
  return last === null || now.getTime() - new Date(last).getTime() > everyMs;
}

// A removal runs before a ship, so a Ship pressed after a Remove finds the release without a current post and refuses.
function queued(state: FactoryState): JobPick | null {
  const approval = Object.keys(state.pendingApprovals).map(Number).sort((a, b) => a - b)[0];
  if (approval !== undefined) return { stage: 'approve', issue: approval };
  const removal = state.pendingRemovals[0];
  if (removal) return { stage: 'remove', issue: removal.issue };
  if (state.pendingShip !== null && state.release) return { stage: 'ship', issue: state.release.issue };
  const change = state.pendingChanges[0];
  return change ? { stage: 'change', issue: change.id } : null;
}

function openCards(cards: Card[]): Card[] {
  return cards.filter((card) => !card.labels.includes(STUCK_LABEL) && !card.labels.includes(NEEDS_INFO_LABEL));
}

// Furthest along first, lowest issue first.
function byProgress(cards: Card[]): JobPick[] {
  return CARD_ORDER.flatMap(([column, stage]) => cards.filter((card) => card.column === column).sort((a, b) => a.issue - b.issue).map((card) => ({ stage, issue: card.issue })));
}

const has = (label: string) => (card: Card): boolean => card.labels.includes(label);
const lacks = (label: string) => (card: Card): boolean => !card.labels.includes(label);

// Card jobs in order: hotfixes, ad hoc tasks, release tasks, then the rest. The tracking issue card only waits for Ship, so it never gets a card job.
// A shipped bug waits for nothing else, and a hotfix card runs at the cap too, since the committee chose it.
function cardCandidates(cards: Card[]): Candidate[] {
  const open = openCards(cards).filter(lacks(RELEASE_LABEL));
  const hotfix = byProgress(open.filter(has(HOTFIX_LABEL))).map((pick) => ({ ...pick, uncapped: true }));
  const rest = open.filter(lacks(HOTFIX_LABEL));
  const adhoc = rest.filter((card) => card.column === 'Implementation' && has(ADHOC_LABEL)(card)).sort((a, b) => a.issue - b.issue).map((card) => ({ stage: 'adhoc' as const, issue: card.issue }));
  const work = rest.filter(lacks(ADHOC_LABEL));
  const normal = [...adhoc, ...byProgress(work.filter(has(RELEASE_TASK_LABEL))), ...byProgress(work.filter(lacks(RELEASE_TASK_LABEL)))];
  return [...hotfix, ...normal.map((pick) => ({ ...pick, uncapped: !countsAgainstCap(pick.stage) }))];
}

// The candidate waits until the tracking issue is healthy and every release task is done.
function candidateJob(state: FactoryState, cards: Card[]): JobPick | null {
  const release = state.release;
  if (release === null || release.postId !== null) return null;
  const tracking = cards.find((card) => card.issue === release.issue);
  if (!tracking || tracking.labels.includes(STUCK_LABEL)) return null;
  if (cards.some((card) => card.labels.includes(RELEASE_TASK_LABEL) && card.column !== 'Done')) return null;
  return { stage: 'candidate', issue: release.issue };
}

function releaseCut(state: FactoryState, now: Date, cfg: Due): JobPick | null {
  return state.release === null && isDue(state.lastRelease, now, cfg.releaseDays * DAY_MS) ? { stage: 'release', issue: null } : null;
}

// /dev/ is stale when dev moved past its build, by a factory merge or any other push. A failed commit waits for the next push or for Hermes.
function devJob(state: FactoryState, devHead: string | null): JobPick | null {
  if (devHead === null || devHead === state.devBuild || devHead === state.devFailed) return null;
  return { stage: 'dev', issue: null };
}

// Branch jobs in order: queued approvals, removals, ships and changes, then a stale /dev/, then a due release cut, then the candidate.
function branchCandidates(state: FactoryState, cards: Card[], now: Date, cfg: Due, devHead: string | null): Candidate[] {
  const picks = [queued(state), devJob(state, devHead), releaseCut(state, now, cfg), candidateJob(state, cards)];
  return picks.filter((pick) => pick !== null).map((pick) => ({ ...pick, uncapped: !countsAgainstCap(pick.stage) }));
}

export function countsAgainstCap(stage: JobStage): boolean {
  return !UNCAPPED_STAGES.includes(stage);
}

export function recentStarts(state: FactoryState, now: Date): string[] {
  return state.jobStarts.filter((start) => now.getTime() - new Date(start).getTime() < DAY_MS);
}

export function atCap(state: FactoryState, now: Date, cfg: Pick<FactoryConfig, 'maxJobsPerDay'>): boolean {
  return recentStarts(state, now).length >= cfg.maxJobsPerDay;
}

function limits(cfg: Due): Record<Queue, number> {
  return { branch: 1, agent: cfg.agentWorkers, test: cfg.testWorkers };
}

// A job fits when its queue has a free worker and no other job works on its issue.
function fits(pick: JobPick, running: JobPick[], cfg: Due): boolean {
  const queue = QUEUE_OF[pick.stage];
  const busy = running.filter((job) => QUEUE_OF[job.stage] === queue).length >= limits(cfg)[queue];
  return !busy && (pick.issue === null || !running.some((job) => job.issue === pick.issue));
}

// Picks the jobs to start now, in priority order within each queue, next to the jobs that already run.
// At the daily cap only the uncapped jobs start. `devHead` is the short hash of dev on origin, or null to skip the /dev/ check.
export function chooseJobs(state: FactoryState, cards: Card[], now: Date, cfg: Due, devHead: string | null = null): JobPick[] {
  let capLeft = cfg.maxJobsPerDay - recentStarts(state, now).length;
  const chosen: JobPick[] = [];
  for (const candidate of [...branchCandidates(state, cards, now, cfg, devHead), ...cardCandidates(cards)]) {
    const pick = { stage: candidate.stage, issue: candidate.issue };
    const capped = candidate.uncapped ? 0 : 1;
    if (capped > capLeft || !fits(pick, [...state.jobs, ...chosen], cfg)) continue;
    capLeft -= capped;
    chosen.push(pick);
  }
  return chosen;
}

// Process control the tick uses. The CLI uses the real ones, and tests pass fakes.
export type TickDeps = {
  isAlive: (pid: number) => boolean;
  kill: (run: Run, pid: number, id: string) => Promise<void>;
  spawn: (args: string[], cwd: string, log: string, id: string) => number;
};
export const REAL_DEPS: TickDeps = { isAlive, kill: killJob, spawn: spawnJob };

function dropJob(ctx: Ctx, id: string): void {
  updateState(ctx.statePath, (state) => ({ ...state, jobs: state.jobs.filter((job) => job.id !== id) }));
}

// A dead or timed-out job leaves the list and reports. A job in time stays.
async function checkJob(ctx: Ctx, job: Job, deps: TickDeps): Promise<void> {
  const minutes = (ctx.now().getTime() - new Date(job.startedAt).getTime()) / MINUTE_MS;
  const alive = deps.isAlive(job.pid);
  if (alive && minutes <= ctx.cfg.stageTimeoutMinutes) return ctx.log('tick', job.issue, `${job.stage} still running`);
  if (alive) await deps.kill(ctx.run, job.pid, job.id);
  dropJob(ctx, job.id);
  const reason = alive ? `timed out after ${ctx.cfg.stageTimeoutMinutes} minutes` : 'job process died without finishing';
  await reportFailure(ctx, job.stage, failureIssue(job.stage, job.issue, readState(ctx.statePath)), reason, job.log);
}

function startJob(ctx: Ctx, codeDir: string, pick: JobPick, deps: TickDeps): void {
  const stamp = ctx.now().toISOString().replaceAll(':', '');
  const id = `${pick.stage}-${pick.issue ?? '-'}-${stamp}`;
  const log = join(ctx.cfg.home, 'logs', `${id}.log`);
  const pid = deps.spawn([pick.stage, String(pick.issue ?? '-')], codeDir, log, id);
  const job: Job = { ...pick, id, pid, startedAt: ctx.now().toISOString(), log };
  updateState(ctx.statePath, (state) => ({ ...state, jobs: [...state.jobs, job], jobStarts: countsAgainstCap(pick.stage) ? [...recentStarts(state, ctx.now()), job.startedAt] : state.jobStarts }));
  ctx.log('tick', pick.issue, `started ${pick.stage}, pid ${pid}, log ${log}`);
}

async function answeredWaiting(ctx: Ctx, card: Card): Promise<boolean> {
  const waiting = card.column === 'Triage' && card.labels.includes(NEEDS_INFO_LABEL);
  return waiting && isAnswered(await ctx.github.comments(card.issue));
}

// A Triage card that waits for answers gets its label back off once someone replies. Returns the cards as they stand after that.
// `mayRelease` runs before each label removal, so a caller can stop the pass when its permission lapses.
export async function releaseAnswered(ctx: Ctx, cards: Card[], mayRelease: () => boolean = () => true): Promise<Card[]> {
  const released: Card[] = [];
  for (const card of cards) {
    if (!(await answeredWaiting(ctx, card)) || !mayRelease()) {
      released.push(card);
      continue;
    }
    await ctx.github.removeLabel(card.issue, NEEDS_INFO_LABEL);
    ctx.log('tick', card.issue, `answered, removed ${NEEDS_INFO_LABEL}`);
    released.push({ ...card, labels: card.labels.filter((label) => label !== NEEDS_INFO_LABEL) });
  }
  return released;
}

// Removes builds no card in Approval still needs.
// Testing and branch jobs deploy builds before they record them, so cleanup waits while one of them runs.
function cleanBuilds(ctx: Ctx, cards: Card[]): void {
  const state = readState(ctx.statePath);
  if (state.jobs.some((job) => QUEUE_OF[job.stage] !== 'agent')) return;
  // The candidate's card is the tracking issue, so its 'rc' build stays while the card waits in Approval.
  const keep = cards.filter((card) => card.column === 'Approval').map((card) => state.builds[String(card.issue)]).filter((name) => name !== undefined);
  removeStaleBuilds(ctx.cfg.webRoot, new Set(keep), (msg) => ctx.log('tick', null, msg));
}

// Tells the committee once per cap window that the cap holds work back. The flag clears when the cap frees.
async function noteCap(ctx: Ctx, cards: Card[], devHead: string | null): Promise<void> {
  const state = readState(ctx.statePath);
  const now = ctx.now();
  if (!atCap(state, now, ctx.cfg)) {
    if (state.capNoticed) updateState(ctx.statePath, (s) => ({ ...s, capNoticed: false }));
    return;
  }
  // Work waits when more jobs would start without the cap.
  const waiting = chooseJobs(state, cards, now, { ...ctx.cfg, maxJobsPerDay: Infinity }, devHead).length > chooseJobs(state, cards, now, ctx.cfg, devHead).length;
  if (state.capNoticed || !waiting) return;
  const starts = recentStarts(state, now);
  const free = new Date(new Date(starts[0]).getTime() + DAY_MS).toISOString();
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Daily job cap reached: ${starts.length} of ${ctx.cfg.maxJobsPerDay} agent jobs ran in the last 24 hours. Public work waits. The next slot frees at ${free}.`);
  updateState(ctx.statePath, (s) => ({ ...s, capNoticed: true }));
}

// One tick: check the running jobs, run intake, clean old builds, then start every job that fits. `deps` defaults to the real process control.
export async function tick(ctx: Ctx, codeDir: string, deps: TickDeps = REAL_DEPS): Promise<void> {
  for (const job of readState(ctx.statePath).jobs) await checkJob(ctx, job, deps);
  await intake(ctx);
  const cards = await releaseAnswered(ctx, await ctx.github.cards());
  cleanBuilds(ctx, cards);
  updateState(ctx.statePath, pruneCaptions);
  updateState(ctx.statePath, pruneFailures(ctx.now()));
  await ctx.repo.fetch();
  const devHead = await ctx.repo.headHash('dev');
  await noteCap(ctx, cards, devHead);
  const picks = chooseJobs(readState(ctx.statePath), cards, ctx.now(), ctx.cfg, devHead);
  if (picks.length === 0) return ctx.log('tick', null, 'nothing to start');
  for (const pick of picks) startJob(ctx, codeDir, pick, deps);
}
