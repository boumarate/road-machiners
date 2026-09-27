// Weighted NPC decisions. A decision point offers options. Each option's final weight is
// (base + adds) x muls x situation factor. Bases live in DECISIONS. Adds and muls come from the NPC's traits, and
// from the states it holds toward the decision's subject. The situation factor reads what the NPC perceives.
// A roll with world RNG picks one option with weight above zero.

import { chassisDef } from '../data/chassis';
import { DETECT } from '../data/detect';
import { ECONOMY, GOOD_IDS } from '../data/goods';
import {
  DECISIONS, HUNTING_GROUNDS, NPC_BEHAVIOR, NPC_UPKEEP, STATE_WEIGHTS, TRAITS,
  type DecisionId, type DecisionOptions, type TraitWeights,
} from '../data/npcs';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { isHostile } from './combat';
import { vehicleById } from './damage';
import { contactsOf } from './detect';
import { getTradePrice } from './economy';
import { corePart, freeCells, mountedParts } from './grid';
import { npcProfile, npcTraits } from './npc-profile';
import { topGoal } from './npc-goals';
import { sampleWeighted } from './npc-loadout';
import { getResources } from './resources';
import { isRobberyTarget } from './robbery';
import { canReachSalvage, hasSalvage } from './salvage';
import { canUseSite } from './sites';
import { statesHeld } from './states';
import { vehicleStats } from './stats';
import type { Contact, SalvageStock, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { canVehicleSee } from './vision';

// ---- What an NPC perceives and can do. Goal builders in src/sim/npc-activities.ts share these.

export function getKnownSite(id: string) {
  const site = [...REGION.towns, ...REGION.locations].find((entry) => entry.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site;
}

export function getCabCondition(vehicle: Vehicle): number {
  const cab = corePart(vehicle, 'cab');
  return cab.hp / partDef(cab.defId).hp;
}

// Weapon definitions are public shapes. Enemy reload and part HP are not observations.
export function computeVisibleStrength(vehicle: Vehicle): number {
  return mountedParts(vehicle, 'weapon').reduce((sum, part) => {
    const def = partDef(part.defId);
    if (def.kind !== 'weapon') throw new Error('Non-weapon in weapon mounts');
    return sum + def.round.damage * def.rounds;
  }, 0);
}

// The NPC's own working guns. It knows its part HP.
export function ownStrength(world: World, vehicle: Vehicle): number {
  return vehicleStats(world, vehicle).weapons.filter((weapon) => weapon.part.hp > 0).reduce((sum, weapon) => sum + weapon.def.round.damage * weapon.def.rounds, 0);
}

// At or below the flee condition, or below the higher recover condition while already fleeing.
export function isWeak(world: World, vehicle: Vehicle): boolean {
  const threshold = topGoal(vehicle)?.kind === 'flee' ? NPC_BEHAVIOR.recoverCondition : NPC_BEHAVIOR.fleeCondition;
  return getCabCondition(vehicle) <= threshold || getResources(world, vehicle).health / RULES.maxHealth <= threshold;
}

// Hostile vehicles in sight, nearest first.
export function visibleHostiles(world: World, vehicle: Vehicle): Vehicle[] {
  const enemies = world.vehicles.filter((other) => other.id !== vehicle.id && isHostile(world, vehicle, other) && canVehicleSee(world, vehicle, other.pos));
  return enemies.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

// Vehicles heard, dusted or scanned beyond sight, while the contact circle stays tight enough to trust. Farther
// circles are too loose to act on. Nearest first.
export function trustedContacts(world: World, vehicle: Vehicle): Contact[] {
  const trusted = (npcProfile(vehicle).contactReactRadius - DETECT.fuzz.base) / DETECT.fuzz.perTile;
  return contactsOf(world, vehicle, trusted).sort((a, b) => dist(vehicle.pos, a.center) - dist(vehicle.pos, b.center));
}

export function isHostileContact(world: World, vehicle: Vehicle, contact: Contact): boolean {
  return world.vehicles.some((other) => other.id === contact.vehicleId && isHostile(world, vehicle, other));
}

export function getUpkeepReserve(vehicle: Vehicle): number {
  return (chassisDef(vehicle.chassisId).fuelCap * ECONOMY.supplyPrice.fuel + RULES.suppliesCap * ECONOMY.supplyPrice.supplies) * NPC_UPKEEP.reserveLoads;
}

function nearestSite(vehicle: Vehicle, ids: string[]) {
  return ids.map(getKnownSite).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos))[0];
}

export type TradePlan = { source: string; good: string; sellTown: string };

// The most profitable affordable good to buy in the nearest known town and sell in another, or null.
export function bestTrade(world: World, vehicle: Vehicle): TradePlan | null {
  const towns = npcProfile(vehicle).towns;
  const source = nearestSite(vehicle, towns);
  if (!source) return null;
  const spend = getResources(world, vehicle).money - getUpkeepReserve(vehicle);
  let best: TradePlan | null = null;
  let bestProfit = 0;
  for (const town of towns) {
    if (town === source.id) continue;
    for (const good of GOOD_IDS) {
      const buy = getTradePrice(world, vehicle, source.id, good, 'buy');
      const profit = getTradePrice(world, vehicle, town, good, 'sell') - buy;
      if (spend < buy || profit <= bestProfit) continue;
      bestProfit = profit;
      best = { source: source.id, good, sellTown: town };
    }
  }
  return best;
}

// Salvage in sight that still holds something, or that is too far to inspect. Nearest first.
export function visibleSalvage(world: World, vehicle: Vehicle): SalvageStock[] {
  const visible = world.salvage.filter((stock) => canVehicleSee(world, vehicle, stock.pos) && (!canReachSalvage(vehicle, stock) || hasSalvage(stock)));
  return visible.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

// Known salvage sites other than the one the NPC stands at.
export function salvageSitesAway(vehicle: Vehicle) {
  return npcProfile(vehicle).salvageSites.map(getKnownSite).filter((site) => !canUseSite(vehicle.pos, site));
}

export function huntingGroundsAway(vehicle: Vehicle): Vec[] {
  return HUNTING_GROUNDS.filter((point) => dist(vehicle.pos, point) > RULES.arriveRadius * 2);
}

// ---- Situation factors, one per option. Each returns a plain number.

function keepFactor(): number {
  return 1;
}

// A driver fights only with a working gun.
function fightFactor(world: World, vehicle: Vehicle): number {
  return ownStrength(world, vehicle) > 0 ? 1 : 0;
}

// A seen enemy is judged by its visible guns. A heard one only by the driver's own state. A hit weighs by its
// damage against the cab, and needs a hostile in sight to run from.
function fleeFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  const weak = isWeak(world, vehicle) ? NPC_BEHAVIOR.weakFlee : 1;
  if (decision === 'hostileSeen') {
    if (subject === null) throw new Error('hostileSeen needs a subject');
    const threat = computeVisibleStrength(vehicleById(world, subject)) > ownStrength(world, vehicle) * NPC_BEHAVIOR.threatRatio;
    return (threat ? NPC_BEHAVIOR.threatFlee : 1) * weak;
  }
  if (decision === 'contactHeard') return weak;
  if (decision === 'hurt') {
    if (visibleHostiles(world, vehicle).length === 0) return 0;
    const cabMax = partDef(corePart(vehicle, 'cab').defId).hp;
    return vehicle.brain!.hurt / cabMax / NPC_BEHAVIOR.hurtFullFlee;
  }
  throw new Error(`No flee option at ${decision}`);
}

function investigateFactor(): number {
  return 1;
}

// Rob carries weight only through a trait, and only against a target that passes every robbery check.
function robFactor(world: World, vehicle: Vehicle, subject: string | null): number {
  if (subject === null) throw new Error('preySeen needs a subject');
  return isRobberyTarget(world, vehicle, vehicleById(world, subject)) ? 1 : 0;
}

// The subject already passed the tow checks: stranded, in sight, not hostile.
function towFactor(): number {
  return 1;
}

function resumeFactor(): number {
  return 1;
}

function newFactor(): number {
  return 1;
}

function tradeFactor(world: World, vehicle: Vehicle): number {
  return bestTrade(world, vehicle) ? 1 : 0;
}

function scavengeFactor(world: World, vehicle: Vehicle): number {
  if (freeCells(vehicle) === 0) return 0;
  if (visibleSalvage(world, vehicle).length > 0) return NPC_BEHAVIOR.visibleSalvage;
  return salvageSitesAway(vehicle).length > 0 ? 1 : 0;
}

function raidFactor(_world: World, vehicle: Vehicle): number {
  return huntingGroundsAway(vehicle).length > 0 ? 1 : 0;
}

function waitFactor(): number {
  return 1;
}

type OptionName = DecisionOptions[DecisionId];

function situation(world: World, vehicle: Vehicle, decision: DecisionId, option: OptionName, subject: string | null): number {
  switch (option) {
    case 'keep': return keepFactor();
    case 'fight': return fightFactor(world, vehicle);
    case 'flee': return fleeFactor(world, vehicle, decision, subject);
    case 'investigate': return investigateFactor();
    case 'rob': return robFactor(world, vehicle, subject);
    case 'tow': return towFactor();
    case 'resume': return resumeFactor();
    case 'new': return newFactor();
    case 'trade': return tradeFactor(world, vehicle);
    case 'scavenge': return scavengeFactor(world, vehicle);
    case 'raid': return raidFactor(world, vehicle);
    case 'wait': return waitFactor();
  }
}

// ---- Weights and the roll.

// Trait weight tables, then the tables of states the NPC holds toward the subject.
function changeTables(world: World, vehicle: Vehicle, subject: string | null): TraitWeights[] {
  const tables = npcTraits(vehicle).map((id) => TRAITS[id].weights);
  if (subject === null) return tables;
  for (const s of statesHeld(world, vehicle.id)) {
    if (s.other !== subject) continue;
    const table = STATE_WEIGHTS[s.kind];
    if (!table) throw new Error(`Unknown state kind ${s.kind}`);
    tables.push(table);
  }
  return tables;
}

export function optionWeights<D extends DecisionId>(world: World, vehicle: Vehicle, decision: D, subject: string | null): Record<DecisionOptions[D], number> {
  const base = DECISIONS[decision] as Record<OptionName, number>;
  const tables = changeTables(world, vehicle, subject);
  const out = {} as Record<OptionName, number>;
  for (const option of Object.keys(base) as OptionName[]) {
    let add = 0;
    let mul = 1;
    for (const table of tables) {
      const change = (table[decision] as Partial<Record<OptionName, { add?: number; mul?: number }>> | undefined)?.[option];
      if (!change) continue;
      if (change.add !== undefined) add += change.add;
      if (change.mul !== undefined) mul *= change.mul;
    }
    out[option] = (base[option] + add) * mul * situation(world, vehicle, decision, option, subject);
  }
  return out as Record<DecisionOptions[D], number>;
}

// A decision with a keep option offers a choice only while another option has weight. Without one, the driver
// keeps what it does with no roll.
export function hasChoice(weights: Partial<Record<OptionName, number>>): boolean {
  return !('keep' in weights) || Object.entries(weights).some(([option, weight]) => option !== 'keep' && weight! > 0);
}

export function decide<D extends DecisionId>(world: World, vehicle: Vehicle, decision: D, subject: string | null): DecisionOptions[D] {
  const weights = optionWeights(world, vehicle, decision, subject);
  const pool: { value: DecisionOptions[D]; weight: number }[] = [];
  for (const [option, weight] of Object.entries(weights) as [DecisionOptions[D], number][]) {
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`${vehicle.id} has weight ${weight} for ${option} at ${decision}`);
    if (weight > 0) pool.push({ value: option, weight });
  }
  if (pool.length === 0) throw new Error(`${vehicle.id} has no option with weight at ${decision}`);
  if (!hasChoice(weights)) return pool[0].value;
  return sampleWeighted(world, pool);
}
