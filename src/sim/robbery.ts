// Which trucks a robber may rob. Robbery itself is a fight: see the preySeen decision in src/sim/npc-activities.ts.

import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { isHostile } from './combat';
import { hasLoot } from './grid';
import { computeVisibleStrength, ownStrength } from './npc-decisions';
import { siteGates } from './sites';
import type { Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { canVehicleSee } from './vision';

function nearTownGate(pos: Vec): boolean {
  return REGION.towns.some((town) => siteGates(town).some((gate) => dist(pos, gate) <= RULES.guards.range));
}

// The robber sees the target, they are not hostile yet, the target carries loot, its visible guns are weaker than
// the robber's working guns, and both are out of reach of every town gate gun.
export function isRobberyTarget(w: World, robber: Vehicle, target: Vehicle): boolean {
  if (robber.id === target.id) return false;
  if (!canVehicleSee(w, robber, target.pos)) return false;
  if (isHostile(w, robber, target)) return false;
  if (!hasLoot(target)) return false;
  if (computeVisibleStrength(target) >= ownStrength(w, robber)) return false;
  return !nearTownGate(robber.pos) && !nearTownGate(target.pos);
}
