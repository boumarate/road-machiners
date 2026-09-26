// Vehicle mass in kilograms: chassis plus everything on board. Physics, stats, crashes and the UI read it here.

import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import type { Vehicle } from './types';

export function vehicleMass(v: Vehicle): number {
  let mass = chassisDef(v.chassisId).mass;
  for (const it of v.items) mass += it.kind === 'part' ? partDef(it.part.defId).mass : goodMass(it.good);
  return mass;
}

// Top speed and turning scale by this. 1 up to the chassis rated mass, lower above it.
export function loadFactor(v: Vehicle): number {
  return Math.min(1, Math.sqrt(chassisDef(v.chassisId).ratedMass / vehicleMass(v)));
}

function goodMass(id: string): number {
  const def = GOODS[id];
  if (!def) throw new Error(`Unknown good ${id}`);
  return def.mass;
}
