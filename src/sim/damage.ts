// Applying damage. Hit points clamp at zero. Damage reaches parts only through walkLane in armor.ts.

import { partDef } from "../data/parts";
import { PERK_NUMBERS } from "../data/skills";
import { RULES } from "../data/rules";
import { practice, skillEffect, vehicleHasPerk } from "./progress";
import { mountedParts } from "./grid";
import type { PartInstance, Vehicle, World } from "./types";

// Damage to the player's cab also hurts the character.
export function damagePart(
  world: World,
  v: Vehicle,
  part: PartInstance,
  amount: number,
): number {
  const wasWorking = part.hp > 0;
  const dealt = Math.min(part.hp, Math.max(0, Math.round(amount)));
  part.hp -= dealt;
  if (wasWorking && part.hp === 0)
    world.events.push({ t: "partDisabled", vehicle: v.id, part: part.id });
  const def = partDef(part.defId);
  if (
    v.id === world.player.vehicleId &&
    def.kind === "core" &&
    def.role === "cab"
  ) {
    hurtDriver(world, v, dealt);
  }
  return dealt;
}

// The player's character takes a share of cab damage, cut by toughness and the hard head perk, and the health lost
// practices toughness.
function hurtDriver(world: World, v: Vehicle, dealt: number): void {
  const health = world.player.health;
  const hardHead = vehicleHasPerk(world, v, "hardHead") ? PERK_NUMBERS.hardHead.cabShare : 1;
  const share = RULES.cabHealthShare * (1 - skillEffect(world, v, "toughness", "cabShare")) * hardHead;
  world.player.health = Math.max(0, health - Math.round(dealt * share));
  if (world.player.health < health) practice(world, "damage", health - world.player.health, null);
}

// Mounted parts only: spares in the cargo grid cannot be shot or crashed.
export function findPart(v: Vehicle, partId: string): PartInstance | null {
  return mountedParts(v).find((p) => p.id === partId) ?? null;
}

export function vehicleById(world: World, id: string): Vehicle {
  const v = world.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`No vehicle ${id}`);
  return v;
}

export function playerVehicle(world: World): Vehicle {
  return vehicleById(world, world.player.vehicleId);
}
