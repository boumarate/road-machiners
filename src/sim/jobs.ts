// Parked jobs: work that needs the truck to stay parked for several turns. One rule for every driver.
// A job is cancelled on any turn its truck ends above parked speed, and its finished turns are lost.
// A repair is also cancelled once the grid holds no parts for it.

import { GOODS } from "../data/goods";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { STRIP } from "../data/salvage";
import { playerVehicle } from "./damage";
import { partValue } from "./wear";
import { freeCells, goodsCount, isMounted, itemSize, mountedParts } from "./grid";
import { addGoods, applyRefitLayout, getRefitLayout } from "./inventory";
import { isJunk, maxHp } from "./wear";
import { repairPlan, repairTurn } from "./repair";
import { practice } from "./progress";
import { stripPart } from "./salvage";
import { searchTurn } from "./search";
import type { GridItem, Job, PartInstance, RefitJob, Vehicle, World } from "./types";
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
    auto: true,
  });
}

// The player command that starts stripping a spare, non-core part for units of the parts good.
// Strip works on broken and junk parts too: that is its purpose.
export function startStrip(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const v = playerVehicle(w);
    if (!stripFits(v, findStripItem(v, partId))) throw new Error("No room for the stripped parts");
    startJob(w, v, {
      kind: "strip",
      partId,
      turnsLeft: STRIP.turns,
      total: STRIP.turns,
    });
  });
}

type PartItem = Extract<GridItem, { kind: "part" }>;

// Throws unless the id names a spare, non-core part on the grid.
function findStripItem(v: Vehicle, partId: string): PartItem {
  const item = stripItem(v, partId);
  if (!item) throw new Error(`No spare part ${partId} on ${v.name}`);
  if (isMounted(v.chassisId, item)) throw new Error("Only a spare part can be stripped, not a mounted one");
  if (partDef(item.part.defId).kind === "core") throw new Error("A built-in part cannot be stripped");
  return item;
}

function stripItem(v: Vehicle, partId: string): PartItem | null {
  const item = v.items.find((it) => it.kind === "part" && it.part.id === partId);
  return item?.kind === "part" ? item : null;
}

// Units of the parts good a stripped part yields, from its value.
export function stripYield(part: PartInstance): number {
  return Math.max(1, Math.round((partValue(part) * STRIP.yieldShare) / GOODS.parts.value));
}

// The part's own cells free up first, so they count as room for its yield.
function stripFits(v: Vehicle, item: PartItem): boolean {
  const size = itemSize(item);
  return freeCells(v) + size.w * size.h >= stripYield(item.part);
}

// A strip stops when its part left the grid or got mounted, or its yield no longer fits.
function isStripStalled(v: Vehicle, partId: string): boolean {
  const item = stripItem(v, partId);
  return !item || isMounted(v.chassisId, item) || !stripFits(v, item);
}

export function advanceJobs(world: World): void {
  for (const v of world.vehicles) if (v.job) advanceJob(world, v, v.job);
}

// A turn handler does one turn of work and returns true once the job is finished.
function advanceJob(world: World, v: Vehicle, job: Job): void {
  if (v.speed > RULES.parkedSpeed) return endJob(world, v, job, "cancelled");
  if (job.kind === "refit") return advanceRefit(world, v, job);
  if (isStalled(world, v, job)) return endJob(world, v, job, "cancelled");
  if (jobTurn(world, v, job)) endJob(world, v, job, "done");
}

function isStalled(world: World, v: Vehicle, job: Job): boolean {
  if (job.kind === "repair") return isRepairStalled(world, v, job.partId, job.parts);
  return job.kind === "strip" && isStripStalled(v, job.partId);
}

function jobTurn(world: World, v: Vehicle, job: Job): boolean {
  if (job.kind === "repair") return repairTurn(world, v, job);
  if (job.kind === "search") return searchTurn(world, v, job);
  if (job.kind === "strip") return stripTurn(world, v, job);
  throw new Error(`Unhandled job kind ${job.kind}`);
}

function stripTurn(world: World, v: Vehicle, job: Extract<Job, { kind: "strip" }>): boolean {
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  if (job.turnsLeft > 0) return false;
  finishStrip(world, v, job.partId);
  return true;
}

// isStripStalled ran this turn, so the part is still a spare and its yield fits once it is gone.
function finishStrip(world: World, v: Vehicle, partId: string): void {
  const part = findStripItem(v, partId).part;
  const units = stripYield(part);
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
