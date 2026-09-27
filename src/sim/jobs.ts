// Parked jobs: work that needs the truck to stay parked for several turns. One rule for every driver.
// A job is cancelled on any turn its truck ends above parked speed, and its finished turns are lost.
// A repair is also cancelled once the grid holds no parts for it.

import { GOODS } from "../data/goods";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { STRIP } from "../data/salvage";
import { playerVehicle } from "./damage";
import { partValue } from "./economy";
import { goodsCount, isMounted, mountedParts } from "./grid";
import { addGoods } from "./inventory";
import { isJunk, maxHp } from "./wear";
import { repairPlan, repairTurn } from "./repair";
import { searchTurn } from "./search";
import type { Job, PartInstance, Vehicle, World } from "./types";
import { playerCommand } from "./world";

export { repairPlan };

export function startJob(world: World, v: Vehicle, job: Job): void {
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
    .filter((p) => !isJunk(p) && repairPlan(world, v, p.id).needed > 0)
    .sort((a, b) => a.hp / maxHp(a) - b.hp / maxHp(b))[0];
  if (!worst) return;
  const plan = repairPlan(world, v, worst.id, 1);
  startJob(world, v, {
    kind: "repair",
    partId: worst.id,
    parts: plan.parts,
    turnsLeft: plan.turns,
    total: plan.turns,
  });
}

// The player command that starts stripping a spare, non-core part for units of the parts good.
// Strip works on broken and junk parts too: that is its purpose.
export function startStrip(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const v = playerVehicle(w);
    findStripPart(v, partId);
    startJob(w, v, {
      kind: "strip",
      partId,
      turnsLeft: STRIP.turns,
      total: STRIP.turns,
    });
  });
}

// Throws unless the id names a spare, non-core part on the grid.
function findStripPart(v: Vehicle, partId: string): PartInstance {
  const item = v.items.find((it) => it.kind === "part" && it.part.id === partId);
  if (!item || item.kind !== "part") throw new Error(`No spare part ${partId} on ${v.name}`);
  if (isMounted(v.chassisId, item)) throw new Error("Only a spare part can be stripped, not a mounted one");
  if (partDef(item.part.defId).kind === "core") throw new Error("A built-in part cannot be stripped");
  return item.part;
}

export function advanceJobs(world: World): void {
  for (const v of world.vehicles) if (v.job) advanceJob(world, v, v.job);
}

// A turn handler does one turn of work and returns true once the job is finished.
function advanceJob(world: World, v: Vehicle, job: Job): void {
  if (v.speed > RULES.parkedSpeed) return endJob(world, v, job, "cancelled");
  if (job.kind === "repair" && isRepairStalled(world, v, job.partId, job.parts))
    return endJob(world, v, job, "cancelled");
  if (jobTurn(world, v, job)) endJob(world, v, job, "done");
}

function jobTurn(world: World, v: Vehicle, job: Job): boolean {
  if (job.kind === "repair") return repairTurn(world, v, job);
  if (job.kind === "search") return searchTurn(world, v, job);
  return stripTurn(world, v, job);
}

function stripTurn(world: World, v: Vehicle, job: Extract<Job, { kind: "strip" }>): boolean {
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  if (job.turnsLeft > 0) return false;
  finishStrip(world, v, job.partId);
  return true;
}

// The part's own cells free up first, so the parts good gets first claim on the room it made.
// Only if the grid filled up elsewhere during the job does the yield still not fit, which throws.
function finishStrip(world: World, v: Vehicle, partId: string): void {
  const part = findStripPart(v, partId);
  const units = Math.max(1, Math.round((partValue(part) * STRIP.yieldShare) / GOODS.parts.value));
  v.items = v.items.filter((it) => !(it.kind === "part" && it.part.id === partId));
  const added = addGoods(world, v, "parts", units);
  if (added < units) throw new Error(`Stripped parts would not fit on ${v.name}`);
}

// Parts can leave the grid mid-job, by a sale, a knockout or a destroyed cargo part.
// The part can also break into junk while the truck stands.
function isRepairStalled(world: World, v: Vehicle, partId: string, parts: number): boolean {
  const part = mountedParts(v).find((p) => p.id === partId);
  if (!part) throw new Error(`${partId} is not a mounted part on ${v.name}`);
  return isJunk(part) || repairPlan(world, v, partId, parts).parts === 0;
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
}
