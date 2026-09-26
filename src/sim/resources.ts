import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import type { DriverResources, Vehicle, World } from './types';

export function getResources(world: World, vehicle: Vehicle): DriverResources {
  if (vehicle.id === world.player.vehicleId) return world.player;
  if (!vehicle.resources) throw new Error(`Missing resources for ${vehicle.id}`);
  return vehicle.resources;
}

export function consumeVehicleSupplies(world: World, vehicle: Vehicle): void {
  const resources = getResources(world, vehicle);
  const use = vehicle.id === world.player.vehicleId ? Math.max(0, 1 - skillBonus('survival', world.player.skills.survival)) : 1;
  resources.supplies = Math.max(0, resources.supplies - RULES.suppliesPerTurn * use);
  if (resources.supplies > 0) return;
  resources.health = Math.max(0, resources.health - RULES.starveDamage);
  if (vehicle.id === world.player.vehicleId) world.events.push({ t: 'supply', what: 'supplies', text: `Out of supplies: health -${RULES.starveDamage}` });
}
