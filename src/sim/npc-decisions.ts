// Weighted NPC decisions. A decision point offers options. Each option's final weight is
// (base + adds) x muls x situation factor. Bases live in DECISIONS. Adds and muls come from the NPC's traits, and
// from the states it holds toward the decision's subject. The situation factor reads what the NPC perceives.
// A roll with world RNG picks one option with weight above zero. Traits also give the NPC's profile: the sites it
// knows and how bold it is. Robbery is a fight against a target that passes the robbery checks.

import { chassisDef } from '../data/chassis';
import { DETECT } from '../data/detect';
import { ECONOMY, GOOD_IDS } from '../data/goods';
import {
  DECISIONS, HUNTING_GROUNDS, NPC_BEHAVIOR, NPC_UPKEEP, STATE_WEIGHTS, TRAITS,
  type DecisionId, type DecisionOptions, type TraitId, type TraitWeights, type WeightChange,
} from '../data/npcs';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { isHostile } from './combat';
import { vehicleById } from './damage';
import { contactsOf } from './detect';
import { getTradePrice } from './economy';
import { corePart, freeCells, hasLoot, mountedParts } from './grid';
import { topGoal } from './npc-activities';
import { sampleWeighted } from './npc-loadout';
import { getResources } from './resources';
import { randRange } from './rng';
import { canReachSalvage, hasSalvage } from './salvage';
import { canUseSite, siteGates } from './sites';
import { statesHeld } from './states';
import { vehicleStats } from './stats';
import type { Contact, SalvageStock, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { canVehicleSee } from './vision';

// ---- Traits and the profile they give.

export type NpcProfile = {
  towns: string[];
  bases: string[];
  salvageSites: string[];
  supplySites: string[];
  contactReactRadius: number;
  boldness: number;
};

export function npcTraits(v: Vehicle): TraitId[] {
  if (!v.brain) throw new Error(`${v.id} has no NPC brain`);
  const traits = v.brain.traits;
  if (!traits) throw new Error(`${v.id} has no traits`);
  for (const id of traits) if (!Object.hasOwn(TRAITS, id)) throw new Error(`${v.id} has unknown trait ${id}`);
  return traits;
}

export function hasTrait(v: Vehicle, id: TraitId): boolean {
  return npcTraits(v).includes(id);
}

// Known sites are the union over traits, in trait order. The widest contact radius wins. Boldness multiplies.
export function profileOf(traits: TraitId[]): NpcProfile {
  if (traits.length === 0) throw new Error('A profile needs at least one trait');
  const defs = traits.map((id) => {
    if (!Object.hasOwn(TRAITS, id)) throw new Error(`Unknown trait ${id}`);
    return TRAITS[id];
  });
  const union = (key: 'towns' | 'bases' | 'salvageSites' | 'supplySites') => [...new Set(defs.flatMap((t) => t[key]))];
  return {
    towns: union('towns'),
    bases: union('bases'),
    salvageSites: union('salvageSites'),
    supplySites: union('supplySites'),
    contactReactRadius: Math.max(...defs.map((t) => t.contactReactRadius)),
    boldness: defs.reduce((product, t) => product * t.boldness, 1),
  };
}

export function npcProfile(v: Vehicle): NpcProfile {
  return profileOf(npcTraits(v));
}

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

// How dangerous a truck is as it stands now: firepower times toughness. Firepower sums damage times rounds over
// working guns. Toughness is the current HP of the chassis core parts and the mounted armor.
export function vehicleDanger(world: World, vehicle: Vehicle): number {
  const firepower = vehicleStats(world, vehicle).weapons.filter((weapon) => weapon.part.hp > 0).reduce((sum, weapon) => sum + weapon.def.round.damage * weapon.def.rounds, 0);
  const toughness = [...mountedParts(vehicle, 'core'), ...mountedParts(vehicle, 'armor')].reduce((sum, part) => sum + part.hp, 0);
  return firepower * toughness;
}

// Another truck's danger as one sighting judges it: off by a factor rolled with world RNG.
export function perceiveDanger(world: World, other: Vehicle): number {
  const spread = NPC_BEHAVIOR.dangerSpread;
  return vehicleDanger(world, other) * randRange(world, 1 - spread, 1 + spread);
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
type TradeOffer = { plan: TradePlan | null; profit: number };

// The most profitable affordable good to buy in the nearest known town and sell in another, or null.
export function bestTrade(world: World, vehicle: Vehicle): TradePlan | null {
  const towns = npcProfile(vehicle).towns;
  const source = nearestSite(vehicle, towns);
  if (!source) return null;
  const spend = getResources(world, vehicle).money - getUpkeepReserve(vehicle);
  const best: TradeOffer = { plan: null, profit: 0 };
  for (const town of towns) if (town !== source.id) offerGoods(world, vehicle, { source: source.id, sellTown: town, spend }, best);
  return best.plan;
}

// Keeps in `best` any good bought at the source and sold in the town that beats its profit within `spend`.
function offerGoods(world: World, vehicle: Vehicle, route: { source: string; sellTown: string; spend: number }, best: TradeOffer): void {
  for (const good of GOOD_IDS) {
    const buy = getTradePrice(world, vehicle, route.source, good, 'buy');
    const profit = getTradePrice(world, vehicle, route.sellTown, good, 'sell') - buy;
    if (route.spend < buy || profit <= best.profit) continue;
    best.profit = profit;
    best.plan = { source: route.source, good, sellTown: route.sellTown };
  }
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

// ---- Robbery checks.

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

// ---- Situation factors, one per option. Each returns a plain number.

function keepFactor(): number {
  return 1;
}

// A driver fights only with a working gun. A truck without one has no danger.
function fightFactor(world: World, vehicle: Vehicle): number {
  return vehicleDanger(world, vehicle) > 0 ? 1 : 0;
}

// Every factor takes the same arguments. `danger` is the subject's perceived danger, as in optionWeights.
type SituationFactor = (world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null) => number;

function weakFlee(world: World, vehicle: Vehicle): number {
  return isWeak(world, vehicle) ? NPC_BEHAVIOR.weakFlee : 1;
}

// A seen enemy is a threat when its perceived danger beats the driver's own, scaled by threat ratio and boldness.
function fleeSeenFactor(world: World, vehicle: Vehicle, _decision: DecisionId, subject: string | null, danger: number | null): number {
  const weak = weakFlee(world, vehicle);
  if (subject === null) throw new Error('hostileSeen needs a subject');
  if (danger === null) return weak;
  const threat = danger > vehicleDanger(world, vehicle) * NPC_BEHAVIOR.threatRatio * npcProfile(vehicle).boldness;
  return (threat ? NPC_BEHAVIOR.threatFlee : 1) * weak;
}

// A heard enemy is judged only by the driver's own state.
function fleeHeardFactor(world: World, vehicle: Vehicle): number {
  return weakFlee(world, vehicle);
}

// A hit weighs by its damage against the cab, and needs a hostile in sight to run from.
function fleeHurtFactor(world: World, vehicle: Vehicle): number {
  if (visibleHostiles(world, vehicle).length === 0) return 0;
  const cabMax = partDef(corePart(vehicle, 'cab').defId).hp;
  return vehicle.brain!.hurt / cabMax / NPC_BEHAVIOR.hurtFullFlee;
}

const FLEE_FACTORS: Partial<Record<DecisionId, SituationFactor>> = { hostileSeen: fleeSeenFactor, contactHeard: fleeHeardFactor, hurt: fleeHurtFactor };

function fleeFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const factor = FLEE_FACTORS[decision];
  if (!factor) throw new Error(`No flee option at ${decision}`);
  return factor(world, vehicle, decision, subject, danger);
}

function investigateFactor(): number {
  return 1;
}

// Rob carries weight only through a trait, and only against a target that passes every robbery check.
function robFactor(world: World, vehicle: Vehicle, _decision: DecisionId, subject: string | null, danger: number | null): number {
  if (subject === null) throw new Error('preySeen needs a subject');
  const target = vehicleById(world, subject);
  if (danger === null) return isRobberyCandidate(world, vehicle, target) ? 1 : 0;
  return isRobberyTarget(world, vehicle, target, danger) ? 1 : 0;
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

const SITUATION: Record<OptionName, SituationFactor> = {
  keep: keepFactor,
  fight: fightFactor,
  flee: fleeFactor,
  investigate: investigateFactor,
  rob: robFactor,
  tow: towFactor,
  resume: resumeFactor,
  new: newFactor,
  trade: tradeFactor,
  scavenge: scavengeFactor,
  raid: raidFactor,
  wait: waitFactor,
};

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

// `danger` is the subject's danger as this sighting perceived it. It is null for decisions without a seen vehicle,
// and before the sighting's roll. Then the danger checks do not apply, and the weights only tell whether the
// decision offers a choice.
export function optionWeights<D extends DecisionId>(world: World, vehicle: Vehicle, decision: D, subject: string | null, danger: number | null): Record<DecisionOptions[D], number> {
  const base = DECISIONS[decision] as Record<OptionName, number>;
  const tables = changeTables(world, vehicle, subject);
  const out = {} as Record<OptionName, number>;
  for (const option of Object.keys(base) as OptionName[]) {
    const { add, mul } = sumChanges(tables, decision, option);
    out[option] = (base[option] + add) * mul * SITUATION[option](world, vehicle, decision, subject, danger);
  }
  return out as Record<DecisionOptions[D], number>;
}

// The summed adds and the product of muls the tables set for one option.
function sumChanges(tables: TraitWeights[], decision: DecisionId, option: OptionName): Required<WeightChange> {
  let add = 0;
  let mul = 1;
  for (const table of tables) {
    const change = (table[decision] as Partial<Record<OptionName, WeightChange>> | undefined)?.[option];
    if (!change) continue;
    if (change.add !== undefined) add += change.add;
    if (change.mul !== undefined) mul *= change.mul;
  }
  return { add, mul };
}

// A decision with a keep option offers a choice only while another option has weight. Without one, the driver
// keeps what it does with no roll.
export function hasChoice(weights: Partial<Record<OptionName, number>>): boolean {
  return !('keep' in weights) || Object.entries(weights).some(([option, weight]) => option !== 'keep' && weight! > 0);
}

export function decide<D extends DecisionId>(world: World, vehicle: Vehicle, decision: D, subject: string | null, danger: number | null): DecisionOptions[D] {
  const weights = optionWeights(world, vehicle, decision, subject, danger);
  const pool = weightPool(vehicle, decision, weights);
  if (!hasChoice(weights)) return pool[0].value;
  return sampleWeighted(world, pool);
}

// The options with weight above zero. A negative or non-finite weight, or no option with weight, throws.
function weightPool<D extends DecisionId>(vehicle: Vehicle, decision: D, weights: Record<DecisionOptions[D], number>): { value: DecisionOptions[D]; weight: number }[] {
  const pool: { value: DecisionOptions[D]; weight: number }[] = [];
  for (const [option, weight] of Object.entries(weights) as [DecisionOptions[D], number][]) {
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`${vehicle.id} has weight ${weight} for ${option} at ${decision}`);
    if (weight > 0) pool.push({ value: option, weight });
  }
  if (pool.length === 0) throw new Error(`${vehicle.id} has no option with weight at ${decision}`);
  return pool;
}
