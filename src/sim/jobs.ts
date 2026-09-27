// Parked jobs: work that needs the truck to stay parked for several turns. One rule for every driver.
// A job is cancelled on any turn its truck ends above parked speed, and its finished turns are lost.

import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { goodsCount } from './grid';
import { repairPlan, repairTurn } from './repair';
import { searchTurn } from './search';
import type { Job, Vehicle, World } from './types';
import { update } from './world';

export { repairPlan };

export function startJob(world: World, v: Vehicle, job: Job): void {
  if (v.job) throw new Error(`${v.name} is already busy with a ${v.job.kind} job`);
  if (v.speed > RULES.parkedSpeed) throw new Error('Stop the truck first');
  v.job = job;
  world.events.push({ t: 'job', vehicle: v.id, job: { ...job }, outcome: 'started' });
}

// The player command that starts a field repair. Throws when the truck is not parked, the part is
// already at the field cap, or the grid holds no parts.
export function startRepair(world: World, partId: string): World {
  return update(world, (w) => {
    const v = playerVehicle(w);
    const plan = repairPlan(w, v, partId);
    if (plan.needed === 0) throw new Error('Already at the field repair cap');
    if (plan.parts === 0) throw new Error('No parts to patch with');
    startJob(w, v, { kind: 'repair', partId, turnsLeft: plan.turns, total: plan.turns });
  });
}

export function advanceJobs(world: World): void {
  for (const v of world.vehicles) if (v.job) advanceJob(world, v, v.job);
}

// A turn handler does one turn of work and returns true once the job is finished.
function advanceJob(world: World, v: Vehicle, job: Job): void {
  if (v.speed > RULES.parkedSpeed) return endJob(world, v, job, 'cancelled');
  const done = job.kind === 'repair' ? repairTurn(world, v, job) : searchTurn(world, v, job);
  if (done) endJob(world, v, job, 'done');
}

function endJob(world: World, v: Vehicle, job: Job, outcome: 'done' | 'cancelled'): void {
  v.job = null;
  world.events.push({ t: 'job', vehicle: v.id, job: { ...job }, outcome });
}
