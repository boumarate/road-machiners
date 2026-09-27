// NPC field repairs: which part to patch, where to park for it, and the repair jobs. Shared jobs complete repairs
// and spend parts. src/sim/npc-activities.ts decides when a repair goal goes on the stack.

import { NPC_UPKEEP } from '../data/npcs';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { mountedParts } from './grid';
import { startJob } from './jobs';
import { straightClear } from './path';
import { repairPlan } from './repair';
import { getResources } from './resources';
import { vehicleStats } from './stats';
import { inShade, sunAt } from './sun';
import type { NpcActivity, Vehicle, World } from './types';
import { dist, type Vec } from './vec';

function chooseRepairPart(world: World, vehicle: Vehicle) {
  return mountedParts(vehicle)
    .filter((part) => repairPlan(world, vehicle, part.id).parts > 0)
    .sort((a, b) => a.hp / partDef(a.defId).hp - b.hp / partDef(b.defId).hp)[0];
}

function canSearchForShade(world: World, vehicle: Vehicle): boolean {
  const sun = sunAt(world.turn);
  if (!sun) return false;
  if (getResources(world, vehicle).fuel === 0) return false;
  return !inShade(world, vehicle.pos, sun);
}

function isRepairCandidate(world: World, vehicle: Vehicle, point: Vec): boolean {
  if (point.x < 1 || point.y < 1) return false;
  if (point.x >= world.size - 1 || point.y >= world.size - 1) return false;
  return dist(vehicle.pos, point) <= NPC_UPKEEP.shadeSearchRadius;
}

function getRepairCandidates(world: World, vehicle: Vehicle): Vec[] {
  const radius = NPC_UPKEEP.shadeSearchRadius;
  const candidates: Vec[] = [];
  for (let y = Math.floor(vehicle.pos.y - radius); y <= vehicle.pos.y + radius; y++) {
    for (let x = Math.floor(vehicle.pos.x - radius); x <= vehicle.pos.x + radius; x++) {
      const point = { x: x + 0.5, y: y + 0.5 };
      if (isRepairCandidate(world, vehicle, point)) candidates.push(point);
    }
  }
  return candidates.sort((a, b) => dist(vehicle.pos, a) - dist(vehicle.pos, b));
}

function chooseRepairSpot(world: World, vehicle: Vehicle): Vec {
  if (!canSearchForShade(world, vehicle)) return { ...vehicle.pos };
  const sun = sunAt(world.turn);
  if (!sun) throw new Error('Shade search requires sunlight');
  const radius = vehicleStats(world, vehicle).radius;
  const blockers = world.vehicles
    .filter((other) => other.id !== vehicle.id)
    .map((other) => ({ pos: other.pos, r: vehicleStats(world, other).radius }));
  const shaded = getRepairCandidates(world, vehicle)
    .find((point) => inShade(world, point, sun) && straightClear(world, vehicle.pos, point, radius, blockers));
  return shaded ?? { ...vehicle.pos };
}

// A repair goal when the most damaged part carried parts can patch is at or below `condition`. Null otherwise.
export function chooseNpcRepair(world: World, vehicle: Vehicle, condition: number): NpcActivity | null {
  const part = chooseRepairPart(world, vehicle);
  if (!part) return null;
  if (part.hp / partDef(part.defId).hp > condition) return null;
  return {
    kind: 'repair',
    targetId: null,
    destination: chooseRepairSpot(world, vehicle),
    phase: 'travel',
    reason: 'patch damaged parts',
  };
}

// A driver out of fuel repairs where it stopped.
export function continueNpcRepair(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (getResources(world, vehicle).fuel === 0) activity.destination = { ...vehicle.pos };
}

// Starts the next repair job once parked at the spot. True when nothing is left to patch.
export function resolveNpcRepair(world: World, vehicle: Vehicle, activity: NpcActivity): boolean {
  if (!activity.destination) throw new Error('Repair activity needs a destination');
  if (dist(vehicle.pos, activity.destination) > RULES.arriveRadius) return false;
  activity.phase = 'act';
  if (vehicle.job) return false;
  return startNpcRepair(world, vehicle);
}

function startNpcRepair(world: World, vehicle: Vehicle): boolean {
  const part = chooseRepairPart(world, vehicle);
  if (!part) return true;
  const plan = repairPlan(world, vehicle, part.id, 1);
  startJob(world, vehicle, {
    kind: 'repair',
    partId: part.id,
    parts: plan.parts,
    turnsLeft: plan.turns,
    total: plan.turns,
  });
  return false;
}
