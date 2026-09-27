// The NPC goal stack. The top goal drives the NPC. A long-term goal sits at the bottom, and interruptions go on
// top of it. A new goal replaces any goal of its kind, so the stack never holds two goals of one kind. Every change
// logs an `activity` event.

import { cancelJob } from './jobs';
import type { Job, NpcActivity, Vehicle, World } from './types';

// Goals that interrupt a long-term goal. Popping one that uncovers the long-term goal fires the resume decision.
export const INTERRUPTIONS: readonly NpcActivity['kind'][] = ['fight', 'flee', 'investigate', 'resupply', 'tow', 'loot'];

function goalsOf(v: Vehicle): NpcActivity[] {
  if (!v.brain) throw new Error(`${v.id} has no NPC brain`);
  if (!v.brain.goals) throw new Error(`${v.id} has no goals`);
  return v.brain.goals;
}

export function topGoal(v: Vehicle): NpcActivity | null {
  const goals = goalsOf(v);
  return goals[goals.length - 1] ?? null;
}

// A search belongs to a scavenge or loot goal on its stock.
function jobBelongs(job: Job, goal: NpcActivity | null): boolean {
  return job.kind === 'search' && (goal?.kind === 'scavenge' || goal?.kind === 'loot') && goal.targetId === job.stockId;
}

// Logs the change. A new top goal cancels a running job that is not its own, since the driver moves off.
function logChange(w: World, v: Vehicle, previous: NpcActivity | null, reason: string): void {
  const top = topGoal(v);
  w.events.push({ t: 'activity', vehicle: v.id, previous: previous?.kind ?? null, activity: top?.kind ?? null, reason });
  if (top !== previous && v.job && !jobBelongs(v.job, top)) cancelJob(w, v);
}

export function pushGoal(w: World, v: Vehicle, goal: NpcActivity): void {
  const previous = topGoal(v);
  v.brain!.goals = [...goalsOf(v).filter((g) => g.kind !== goal.kind), goal];
  logChange(w, v, previous, goal.reason);
}

export function popGoal(w: World, v: Vehicle, reason: string): NpcActivity {
  const goals = goalsOf(v);
  const popped = goals.pop();
  if (!popped) throw new Error(`${v.id} has no goal to pop`);
  logChange(w, v, popped, reason);
  return popped;
}

// Swaps the long-term goal at the bottom, keeping any interruptions above it.
export function replaceBase(w: World, v: Vehicle, goal: NpcActivity): void {
  const goals = goalsOf(v);
  if (goals.length === 0) throw new Error(`${v.id} has no long-term goal to replace`);
  const previous = topGoal(v);
  v.brain!.goals = [goal, ...goals.slice(1).filter((g) => g.kind !== goal.kind)];
  logChange(w, v, previous, goal.reason);
}
