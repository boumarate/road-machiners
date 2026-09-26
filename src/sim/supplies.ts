import { consumeVehicleSupplies } from './resources';
import type { World } from './types';

export function consumeSupplies(world: World): void {
  for (const vehicle of world.vehicles) consumeVehicleSupplies(world, vehicle);
}
