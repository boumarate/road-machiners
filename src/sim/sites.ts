// Which town or location the player is at. Walled sites are used only from a gate.

import { ECONOMY } from '../data/goods';
import { REGION, type LocationDef, type TownDef } from '../data/region';
import { playerVehicle } from './damage';
import { roadExits } from './mapgen';
import type { World } from './types';
import { dist, type Vec } from './vec';

export type Site = TownDef | LocationDef;

export function isWalled(site: Site): boolean {
  return !('kind' in site) || site.walled === true;
}

const GATES = new Map<string, Vec[]>();

// Gates lie on the wall line where each road enters the site.
export function siteGates(site: Site): Vec[] {
  let gates = GATES.get(site.id);
  if (!gates) {
    gates = roadExits(site.pos).map((a) => ({ x: site.pos.x + Math.cos(a) * site.radius, y: site.pos.y + Math.sin(a) * site.radius }));
    if (gates.length === 0) throw new Error(`Walled site ${site.id} has no road into it`);
    GATES.set(site.id, gates);
  }
  return gates;
}

export function canUseSite(pos: Vec, site: Site): boolean {
  if (!isWalled(site)) return dist(pos, site.pos) <= (site.radius + ECONOMY.useRange) * ECONOMY.interactionScale;
  return siteGates(site).some((gate) => dist(pos, gate) <= REGION.settlement.gateReach);
}

export function townAt(world: World): TownDef | null {
  const pos = playerVehicle(world).pos;
  return REGION.towns.find((t) => canUseSite(pos, t)) ?? null;
}

export function locationAt(world: World): LocationDef | null {
  const pos = playerVehicle(world).pos;
  return REGION.locations.find((l) => canUseSite(pos, l)) ?? null;
}

export function requireTown(world: World): TownDef {
  const town = townAt(world);
  if (!town) throw new Error('Not at a town gate');
  return town;
}

export function nearestTown(world: World): TownDef {
  const pos = playerVehicle(world).pos;
  return [...REGION.towns].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0];
}
