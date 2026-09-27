// Parked jobs: work that needs the truck to stay parked for several turns. One rule for every driver.
// A job is cancelled on any turn its truck ends above parked speed, and its finished turns are lost.
// A repair is also cancelled once the grid holds no parts for it.

import { RULES } from "../data/rules";
import { playerVehicle } from "./damage";
import { goodsCount, mountedParts } from "./grid";
import { partDef } from "../data/parts";
import { repairPlan, repairTurn } from "./repair";
import { practice } from "./progress";
import { stripPart } from "./salvage";
import { searchTurn } from "./search";
import { applyRefitLayout, getRefitLayout } from './inventory';
import type { Job, RefitJob, Vehicle, World } from "./types";
import { playerCommand } from "./world";

export { repairPlan };

// An auto patch job yields to any job the player starts.
export function isAutoPatch(job: Job | null): boolean {
  return job?.kind === "repair" && job.auto === true;
}

// The truck runs a job that blocks other jobs.
export function isBusy(v: Vehicle): boolean {
  return v.job !== null && !isAutoPatch(v.job);
}

export function startJob(world: World, v: Vehicle, job: Job): void {
  if (isAutoPatch(v.job)) cancelJob(world, v);
  if (v.job)
    throw new Error(`${v.name} is already busy with a ${v.job.kind} job`);
  if (v.speed > RULES.parkedSpeed) throw new Error("Stop the truck first");
  v.job = job;
  world.events.push({
    t: "job",
    vehicle: v.id,
    job: { ...job },
    outcome: "started",
  });
}

// The player command that starts a field repair. Throws when the truck is not parked, the part is
// already at the field cap, or the grid holds no parts.
export function startRepair(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const v = playerVehicle(w);
    const plan = repairPlan(w, v, partId);
    if (plan.needed === 0) throw new Error("Already at the field repair cap");
    if (plan.parts === 0) throw new Error("No parts to patch with");
    startJob(w, v, {
      kind: "repair",
      partId,
      parts: plan.parts,
      turnsLeft: plan.turns,
      total: plan.turns,
    });
  });
}

// Auto patch: a parked, idle player truck patches its most damaged part with one unit of parts at a
// time, so driving off loses at most one short job.
export function startAutoRepair(world: World): void {
  if (!world.player.autoRepair || world.player.state !== "active") return;
  const v = playerVehicle(world);
  if (v.job || v.speed > RULES.parkedSpeed || (goodsCount(v).parts ?? 0) === 0)
    return;
  const worst = mountedParts(v)
    .filter((p) => repairPlan(world, v, p.id).needed > 0)
    .sort((a, b) => a.hp / partDef(a.defId).hp - b.hp / partDef(b.defId).hp)[0];
  if (!worst) return;
  const plan = repairPlan(world, v, worst.id, 1);
  startJob(world, v, {
    kind: "repair",
    partId: worst.id,
    parts: plan.parts,
    turnsLeft: plan.turns,
    total: plan.turns,
    auto: true,
  });
}

export function advanceJobs(world: World): void {
  for (const v of world.vehicles) if (v.job) advanceJob(world, v, v.job);
}

// A turn handler does one turn of work and returns true once the job is finished.
function advanceJob(world: World, v: Vehicle, job: Job): void {
  if (v.speed > RULES.parkedSpeed) return endJob(world, v, job, "cancelled");
  switch (job.kind) {
    case 'refit': return advanceRefit(world, v, job);
    case 'repair': return advanceRepair(world, v, job);
    case 'search':
      if (searchTurn(world, v, job)) endJob(world, v, job, 'done');
  }
}

function advanceRepair(world: World, v: Vehicle, job: Extract<Job, { kind: 'repair' }>): void {
  // Parts can leave the grid mid-job through damage, trade or a knockout.
  if (repairPlan(world, v, job.partId, job.parts).parts === 0) return endJob(world, v, job, 'cancelled');
  if (repairTurn(world, v, job)) endJob(world, v, job, 'done');
}

function advanceRefit(world: World, v: Vehicle, job: RefitJob): void {
  const result = getRefitLayout(world, v, job);
  if (result.error !== null) return endJob(world, v, job, 'cancelled');
  job.turnsLeft -= 1;
  if (job.turnsLeft > 0) return;
  applyRefitLayout(world, v, result.items);
  if (job.pickup) takePickup(world, v, job.pickup);
  endJob(world, v, job, 'done');
}

// The part a finished refit mounted leaves its stock. A part from a wreck gets careful stripping.
function takePickup(world: World, v: Vehicle, pickup: NonNullable<RefitJob['pickup']>): void {
  const stock = world.salvage.find((entry) => entry.id === pickup.stockId);
  const part = stock?.parts.find((entry) => entry.id === pickup.partId);
  if (!stock || !part) throw new Error('Refit stock part disappeared after validation');
  stripPart(world, v, stock, part);
  stock.parts = stock.parts.filter((entry) => entry.id !== pickup.partId);
}

export function cancelJob(world: World, v: Vehicle): void {
  if (v.job) endJob(world, v, v.job, "cancelled");
}

function endJob(
  world: World,
  v: Vehicle,
  job: Job,
  outcome: "done" | "cancelled",
): void {
  v.job = null;
  world.events.push({ t: "job", vehicle: v.id, job: { ...job }, outcome });
  if (outcome === "done") practiceFieldJob(world, v, job);
}

// The player practices machining from each finished repair, by its total turns. A repair uses up parts. A refit
// only moves parts, and a part can move back and forth forever, so it teaches nothing.
function practiceFieldJob(world: World, v: Vehicle, job: Job): void {
  if (v.id !== world.player.vehicleId || job.kind !== "repair") return;
  practice(world, "fieldJob", job.total, null, job.partId);
}
