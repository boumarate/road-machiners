// Applying damage. Hit points clamp at zero.

import { mountedParts } from './grid';
import type { PartInstance, Vehicle, World } from './types';

export function damageHull(v: Vehicle, amount: number): number {
  const dealt = Math.min(v.hull, Math.max(0, Math.round(amount)));
  v.hull -= dealt;
  return dealt;
}

export function damagePart(world: World, v: Vehicle, part: PartInstance, amount: number): number {
  const wasWorking = part.hp > 0;
  const dealt = Math.min(part.hp, Math.max(0, Math.round(amount)));
  part.hp -= dealt;
  if (wasWorking && part.hp === 0) world.events.push({ t: 'partDisabled', vehicle: v.id, part: part.id });
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
