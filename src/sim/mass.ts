// Vehicle mass in kilograms: chassis plus everything on board. Physics, stats, crashes and the UI read it here.

import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import type { Vehicle } from './types';

export function vehicleMass(v: Vehicle): number {
  let mass = chassisDef(v.chassisId).mass;
  for (const it of v.items) mass += it.kind === 'part' ? partDef(it.part.defId).mass : goodMass(it.good);
  return mass;
}

// Top speed and turning scale by this. 1 at the chassis rated mass, above 1 when lighter and below 1 when heavier,
// so every kilogram of armor, guns and cargo costs speed. Under the rated mass it follows the square root of the
// share. Over it, the share to the power RULES.overloadExponent, so an overloaded truck slows hard.
export function loadFactor(v: Vehicle): number {
  const share = chassisDef(v.chassisId).ratedMass / vehicleMass(v);
  return share >= 1 ? Math.sqrt(share) : share ** RULES.overloadExponent;
}

function goodMass(id: string): number {
  const def = GOODS[id];
  if (!def) throw new Error(`Unknown good ${id}`);
  return def.mass;
}
