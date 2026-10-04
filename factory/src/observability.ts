import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendLedger } from './ledger';
import { withLockSync } from './lock';
import type { ScheduleReport } from './tick';
import { ADHOC_LABEL, type Card, type Column, type JobStage } from './types';
import type { JobOutcome } from './ledger';

export const ACTIVITIES = ['starting', 'model', 'reading', 'editing', 'command', 'tests', 'typecheck', 'playtest', 'build', 'publish', 'install', 'git', 'lock', 'review', 'design', 'investigate', 'waiting', 'finished'] as const;
export type Activity = typeof ACTIVITIES[number];
export type ActivityData = { type: 'activity'; activity: Activity; phase: 'running' | 'completed' | 'failed'; source: 'runner' | 'agent'; progressAt?: string | null; ownerPid?: number | null };
export type SchedulerData = { type: 'scheduler'; status: 'checking' | 'ready' | 'paused' | 'disk-low' | 'failed'; report: ScheduleReport | null; counts: Partial<Record<Column, number>> };
export type ManagerData = { type: 'manager'; activity: Activity; phase: 'running' | 'completed' | 'failed'; issue: number | null };
export type AttemptData = { type: 'attempt'; jobId: string; stage: JobStage; issue: number | null; startedAt: string; outcome: JobOutcome | 'started'; previousId: string | null };
export type ObservationData = ActivityData | SchedulerData | ManagerData | AttemptData;
export type Observation = { kind: 'observation'; producer: string; at: string; since: string; data: ObservationData };

function resolveObservationPath(home: string, producer: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(producer)) throw new Error('Invalid observation producer');
  return join(home, 'observations', `${producer}.json`);
}
export function readObservation(home: string, producer: string): Observation | null {
  const path = resolveObservationPath(home, producer);
  if (!existsSync(path)) return null;
  const record = JSON.parse(readFileSync(path, 'utf8')) as Observation;
  if (record.producer !== producer || record.kind !== 'observation') throw new Error('Invalid observation identity');
  if (!Number.isFinite(Date.parse(record.at)) || !Number.isFinite(Date.parse(record.since))) throw new Error('Invalid observation time');
  validateObservationData(record.data);
  return record;
}
function validateObservationData(data: ObservationData): void {
  if (data.type === 'scheduler' || data.type === 'attempt') return;
  if (!['activity', 'manager'].includes(data.type)) throw new Error('Invalid observation type');
  if (!ACTIVITIES.includes(data.activity)) throw new Error('Invalid observation activity');
  if (!['running', 'completed', 'failed'].includes(data.phase)) throw new Error('Invalid observation phase');
}
export function recordObservation(home: string, producer: string, data: ObservationData, now = new Date()): void {
  const path = resolveObservationPath(home, producer);
  validateObservationData(data);
  mkdirSync(join(home, 'observations'), { recursive: true });
  // Match the state lock's deadline: observation writes are small local transactions.
  withLockSync(`${path}.lock`, 30_000, () => writeObservation(home, path, producer, data, now));
}
function writeObservation(home: string, path: string, producer: string, data: ObservationData, now: Date): void {
  const previous = readObservation(home, producer);
  const at = now.toISOString();
  if (previous && previous.at > at) throw new Error('Out-of-order observation');
  const changed = JSON.stringify(previous?.data) !== JSON.stringify(data);
  const since = changed ? at : previous!.since;
  const record: Observation = { kind: 'observation', producer, at, since, data };
  if (changed) appendLedger(home, record);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
  renameSync(temporary, path);
}
export function reportObservation(home: string, producer: string, data: ObservationData, now = new Date()): boolean {
  try {
    recordObservation(home, producer, data, now);
    return true;
  } catch (error) {
    console.error('Factory observation failed', producer, error);
    return false;
  }
}
export function recordAttempt(home: string, job: { id: string; stage: JobStage; issue: number | null; startedAt: string }, outcome: AttemptData['outcome'], now: Date): string | null {
  const producer = `attempt-${job.stage}-${job.issue ?? 'none'}`;
  const prior = readLastAttempt(home, producer);
  if (outcome !== 'started' && prior && prior.jobId !== job.id) return null;
  const previousId = findPreviousAttempt(prior, job.id);
  recordObservation(home, producer, { type: 'attempt', jobId: job.id, stage: job.stage, issue: job.issue, startedAt: job.startedAt, outcome, previousId }, now);
  return previousId;
}
function readLastAttempt(home: string, producer: string): AttemptData | null {
  const data = readObservation(home, producer)?.data;
  return data?.type === 'attempt' ? data : null;
}
function findPreviousAttempt(previous: AttemptData | null, jobId: string): string | null {
  if (previous === null) return null;
  if (previous.jobId === jobId) return previous.previousId;
  return previous.outcome === 'done' ? null : previous.jobId;
}
export function reportAttempt(home: string, job: { id: string; stage: JobStage; issue: number | null; startedAt: string }, outcome: AttemptData['outcome'], now: Date): string | null | undefined {
  try { return recordAttempt(home, job, outcome, now); }
  catch (error) { console.error('Factory attempt observation failed', job.id, error); return undefined; }
}
export function createLockWaitReporter(home: string, producer: string | null, heartbeatMs: number): (owner: number | null) => void {
  let lastReport = 0;
  return (ownerPid) => {
    if (producer === null || Date.now() - lastReport < heartbeatMs) return;
    reportObservation(home, producer, { type: 'activity', activity: 'lock', phase: 'running', source: 'runner', ownerPid });
    lastReport = Date.now();
  };
}
export function reportScheduler(home: string, status: SchedulerData['status'], now: Date, report: ScheduleReport | null = null, cards: Card[] = []): void {
  const counts: Partial<Record<Column, number>> = {};
  for (const card of cards.filter((item) => !item.labels.includes(ADHOC_LABEL))) counts[card.column] = (counts[card.column] ?? 0) + 1;
  reportObservation(home, 'scheduler', { type: 'scheduler', status, report, counts }, now);
}
export function parseAgentActivity(line: string): Activity | null {
  let value: { type?: unknown; activity?: unknown };
  try { value = JSON.parse(line); } catch { return null; }
  if (value?.type !== 'factory_status') return null;
  return ACTIVITIES.includes(value.activity as Activity) ? value.activity as Activity : null;
}
