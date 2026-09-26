// Which town or location the player is at.

import { ECONOMY } from '../data/goods';
import { REGION, type LocationDef, type TownDef } from '../data/region';
import { playerVehicle } from './damage';
import type { World } from './types';
import { dist } from './vec';

export function townAt(world: World): TownDef | null {
  const pos = playerVehicle(world).pos;
  return REGION.towns.find((t) => dist(pos, t.pos) <= t.radius + ECONOMY.useRange) ?? null;
}

export function locationAt(world: World): LocationDef | null {
  const pos = playerVehicle(world).pos;
  return REGION.locations.find((l) => dist(pos, l.pos) <= l.radius + ECONOMY.useRange) ?? null;
}

export function requireTown(world: World): TownDef {
  const town = townAt(world);
  if (!town) throw new Error('Not in a town');
  return town;
}

export function nearestTown(world: World): TownDef {
  const pos = playerVehicle(world).pos;
  return [...REGION.towns].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0];
}
