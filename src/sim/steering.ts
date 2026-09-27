// Shared driving helpers used by the physics engine, far-away NPC travel and the UI: parked-vehicle
// blockers, the throttle-zone speed curve for drive-through orders, and click orders.

import { RULES } from "../data/rules";
import { chassisDef } from "../data/chassis";
import type { VehicleStats } from "./stats";
import type { Blocker } from "./path";
import { nearestPad, siteUnder } from "./sites";
import type { MoveOrder, Vehicle, World } from "./types";
import { clamp, DEG, dist, type Vec } from "./vec";

// Whether a slow truck backs up to its destination instead of turning around nose first.
// rearAngle is the angle between straight behind and the destination, in radians.
// The player backs only to a click inside a tight cone behind and within throttle reach.
// NPCs back up only to recover from a blockage.
export function backsToDestination(
  vehicle: Pick<Vehicle, "faction" | "brain">,
  distance: number,
  rearAngle: number,
): boolean {
  if ((vehicle.brain?.recovery ?? 0) > 0) return true;
  return vehicle.faction === "player" && distance < RULES.throttleZones.reach && Math.abs(rearAngle) < RULES.reverse.cone * DEG;
}

export type Throttle = "brake" | "hold" | "accelerate";
export type ZoneEdges = {
  brakeEnd: number;
  holdEnd: number;
  restBrakeEnd: number;
  reach: number;
}; // distances from the truck, in tiles

export function zoneEdges(): ZoneEdges {
  const Z = RULES.throttleZones;
  if (Math.abs(Z.brake + Z.hold + Z.accelerate - 1) > 1e-9)
    throw new Error("Throttle zone shares must add up to 1");
  const reach = Z.reach;
  return {
    brakeEnd: reach * Z.brake,
    holdEnd: reach * (Z.brake + Z.hold),
    restBrakeEnd: reach / 3,
    reach,
  };
}

// At rest the red zone covers one third of reach and the green zone covers the rest.
export function throttleFor(d: number, speed: number): Throttle {
  const z = zoneEdges();
  if (speed === 0) return d < z.restBrakeEnd ? "brake" : "accelerate";
  if (d < z.brakeEnd) return "brake";
  if (d < z.holdEnd) return "hold";
  return "accelerate";
}

// Next turn's speed for a drive-through click at distance d. From rest, speed grows with distance.
// In motion, brake eases toward its edge and acceleration builds from the hold zone to full reach.
// Braking stops at the speed from rest, so the truck creeps onto a close point instead of stopping short.
export function zoneSpeed(s: VehicleStats, speed: number, d: number): number {
  const z = zoneEdges();
  const creep = Math.min(s.maxSpeed, s.accel * Math.min(1, d / z.reach));
  if (speed === 0) return creep;
  let next = speed;
  if (d < z.brakeEnd) next = Math.max(creep, speed - s.brake * (1 - d / z.brakeEnd));
  else if (d >= z.holdEnd)
    next =
      speed + s.accel * Math.min(1, (d - z.holdEnd) / (z.reach - z.holdEnd));
  return clamp(
    next,
    0,
    Math.max(0, Math.min(s.maxSpeed, Math.max(speed, next))),
  );
}

// A click inside a site stops at the site's pad nearest the truck, since trucks never enter sites.
// Elsewhere a ground click always orders a course, and Shift stops at the point.
// A plain click on the current point switches it between driving through and stopping.
export function clickOrder(dest: Vec, shift: boolean, me: Pick<Vehicle, "pos" | "order">): MoveOrder {
  const site = siteUnder(dest);
  return site ? { kind: "stopAt", dest: nearestPad(site, me.pos) } : groundOrder(dest, shift, me.order);
}

function groundOrder(dest: Vec, shift: boolean, current: MoveOrder | null): MoveOrder {
  if (shift) return { kind: "stopAt", dest };
  if (current && current.kind !== "brake" && dist(dest, current.dest) < RULES.reclickRadius)
    return { kind: current.kind === "through" ? "stopAt" : "through", dest: current.dest };
  return { kind: "through", dest };
}

export function parkedVehicles(world: World, selfId: string): Blocker[] {
  const target = world.vehicles.find((v) => v.id === selfId)?.brain?.ramTarget;
  return world.vehicles
    .filter((x) => x.id !== selfId && x.id !== target && x.speed < RULES.parkedSpeed)
    .map((x) => ({ pos: x.pos, r: chassisDef(x.chassisId).radius }));
}
