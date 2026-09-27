import { RULES } from '../data/rules';
import { skillEffect, vehicleHasPerk } from './progress';
import { heatAt } from './sun';
import { vehicleStats } from './stats';
import type { DriverResources, Vehicle, World } from './types';

export function getResources(world: World, vehicle: Vehicle): DriverResources {
  if (vehicle.id === world.player.vehicleId) return world.player;
  if (!vehicle.resources) throw new Error(`Missing resources for ${vehicle.id}`);
  return vehicle.resources;
}

// Fuel burned for tiles driven this turn, at the chassis rate times the heat at the vehicle's spot.
export function burnFuel(world: World, vehicle: Vehicle, tiles: number): void {
  const resources = getResources(world, vehicle);
  const heat = heatAt(world, vehicle.pos);
  resources.fuel = Math.max(0, resources.fuel - tiles * vehicleStats(world, vehicle).fuelPerTile * heat);
}

// Supply use multiplier from heat at the vehicle's spot. Toughness cuts only the extra use above 1, and the desert
// born perk removes it.
function heatDrain(world: World, vehicle: Vehicle): number {
  const heat = heatAt(world, vehicle.pos);
  const cut = vehicleHasPerk(world, vehicle, 'desertBorn') ? 1 : skillEffect(world, vehicle, 'toughness', 'heatDrain');
  return heat - Math.max(0, heat - 1) * cut;
}

export function consumeVehicleSupplies(world: World, vehicle: Vehicle): void {
  const resources = getResources(world, vehicle);
  const use = Math.max(0, 1 - skillEffect(world, vehicle, 'toughness', 'supplies'));
  resources.supplies = Math.max(0, resources.supplies - RULES.suppliesPerTurn * use * heatDrain(world, vehicle));
  if (resources.supplies > 0 || vehicleHasPerk(world, vehicle, 'ironGut')) return;
  // Starving only weakens a driver down to the floor. Health already below it stays as it is.
  const lost = Math.max(0, Math.min(RULES.starveDamage, resources.health - RULES.starveFloor));
  if (lost === 0) return;
  resources.health -= lost;
  if (vehicle.id === world.player.vehicleId) world.events.push({ t: 'supply', what: 'supplies', text: `Out of supplies: health -${lost}` });
}
