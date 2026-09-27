// Which trucks a robber may rob, and what it loots after a win. Robbery itself is a fight: see the preySeen
// decision in src/sim/npc-activities.ts.

import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { isHostile } from './combat';
import { hasLoot } from './grid';
import { vehicleDanger } from './npc-decisions';
import { npcProfile } from './npc-profile';
import { pushGoal } from './npc-goals';
import { knockoutStockId, wreckStockId } from './salvage';
import { siteGates } from './sites';
import type { Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { canVehicleSee } from './vision';

function nearTownGate(pos: Vec): boolean {
  return REGION.towns.some((town) => siteGates(town).some((gate) => dist(pos, gate) <= RULES.guards.range));
}

// The checks that need no judgment of danger: the robber sees the target, they are not hostile yet, the target
// carries loot, and both are out of reach of every town gate gun.
export function isRobberyCandidate(w: World, robber: Vehicle, target: Vehicle): boolean {
  if (robber.id === target.id) return false;
  if (!canVehicleSee(w, robber, target.pos)) return false;
  if (isHostile(w, robber, target)) return false;
  if (!hasLoot(target)) return false;
  return !nearTownGate(robber.pos) && !nearTownGate(target.pos);
}

// A candidate whose perceived danger is below the robber's own danger times its boldness.
export function isRobberyTarget(w: World, robber: Vehicle, target: Vehicle, perceived: number): boolean {
  return isRobberyCandidate(w, robber, target) && perceived < vehicleDanger(w, robber) * npcProfile(robber).boldness;
}

// Sends a robber that won to search the stock its victim left: an NPC's wreck, or the stock a knocked-out player
// dropped this turn. A robber that died in the same fight loots nothing.
export function lootRobbed(w: World, robberId: string, victimId: string): void {
  const robber = w.vehicles.find((v) => v.id === robberId);
  if (!robber) return;
  const ids = [wreckStockId(victimId), knockoutStockId(victimId, w.turn)];
  const stock = w.salvage.find((s) => ids.includes(s.id));
  if (!stock) throw new Error(`${robberId} won a robbery, but ${victimId} left no stock`);
  pushGoal(w, robber, { kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason: 'loot the robbed truck' });
}
