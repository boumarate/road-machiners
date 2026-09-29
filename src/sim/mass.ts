// Vehicle mass in kilograms: chassis plus everything on board. Physics, stats, crashes and the UI read it here.

import { chassisDef } from '../data/chassis';
import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import type { GridItem, Vehicle } from './types';

export function vehicleMass(v: Vehicle): number {
  let mass = chassisDef(v.chassisId).mass;
  for (const it of v.items) mass += itemMass(it);
  return mass;
}

// Top speed and turning scale by this. 1 at the chassis handling mass, above 1 when lighter and below 1 when heavier,
// so every kilogram of armor, guns and cargo costs speed. It follows the square root of handling mass over mass.
// Past the rated mass it also takes (rated / mass) to the power RULES.overloadExponent, so an overloaded truck slows hard.
export function loadFactor(v: Vehicle, extraMass = 0): number {
  const ch = chassisDef(v.chassisId);
  const mass = vehicleMass(v) + extraMass;
  const overload = mass > ch.ratedMass ? (ch.ratedMass / mass) ** RULES.overloadExponent : 1;
  return Math.sqrt(ch.handlingMass / mass) * overload;
}

export function itemMass(it: GridItem): number {
  return it.kind === 'part' ? partDef(it.part.defId).mass : goodMass(it.good);
}

function goodMass(id: string): number {
  const def = GOODS[id];
  if (!def) throw new Error(`Unknown good ${id}`);
  return def.mass;
}
