// Applying damage. Hit points clamp at zero. Damage reaches parts only through walkLane in armor.ts.

import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
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
    world.player.health = Math.max(
      0,
      world.player.health - Math.round(dealt * RULES.cabHealthShare),
    );
  }
  return dealt;
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
