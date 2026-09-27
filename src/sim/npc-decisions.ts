// Weighted NPC decisions. A decision point offers options. An option is available when the driver physically can
// take it now. Each available option's final weight is (base + adds) x muls x situation factor. Bases live in
// DECISIONS. Adds and muls come from the NPC's traits, and from the states it holds toward the decision's subject.
// The situation factor reads what the NPC perceives. Every available option gets at least MIN_CHANCE and shares
// the rest by weight. A roll with world RNG picks one. Traits also give the NPC's profile: the sites it knows and
// how bold it is. Danger compares local groups: a truck with its visible faction mates nearby. A driver busy with
// work mostly keeps on around hostiles not aimed at it or its group. Robbery is a fight against a truck the robber
// can rob, mostly a weaker one away from guards.

import { dealAvailable } from './patch';
import { chassisDef } from '../data/chassis';
import { ECONOMY, GOOD_IDS } from '../data/goods';
import {
  DECISIONS, HUNTING_GROUNDS, MIN_CHANCE, NPC_BEHAVIOR, NPC_UPKEEP, SPAWN, STATE_WEIGHTS, TRAITS,
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
import { isTownGuarded } from './guards';
import { topGoal } from './npc-activities';
import { sampleWeighted } from './npc-loadout';
import { getResources } from './resources';
import { randRange } from './rng';
import { canReachSalvage, hasSalvage } from './salvage';
import { canUseSite } from './sites';
import { statesHeld } from './states';
import { vehicleStats } from './stats';
import { strandedPlayerAt } from './tow';
import type { Contact, NpcActivity, SalvageStock, Vehicle, World } from './types';
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

// Damage times rounds summed over working guns.
function firepower(world: World, vehicle: Vehicle): number {
  return vehicleStats(world, vehicle).weapons.filter((weapon) => weapon.part.hp > 0).reduce((sum, weapon) => sum + weapon.def.round.damage * weapon.def.rounds, 0);
}

// How dangerous a truck is as it stands now: firepower times toughness. Toughness is the current HP of the chassis
// core parts and the mounted armor.
export function vehicleDanger(world: World, vehicle: Vehicle): number {
  const toughness = [...mountedParts(vehicle, 'core'), ...mountedParts(vehicle, 'armor')].reduce((sum, part) => sum + part.hp, 0);
  return firepower(world, vehicle) * toughness;
}

// A truck and its faction mates within SPAWN.neighborHelp of it that the observer sees.
function localGroup(world: World, observer: Vehicle, member: Vehicle): Vehicle[] {
  return world.vehicles.filter((v) => v.id === member.id || (v.id !== observer.id && v.faction === member.faction
    && dist(v.pos, member.pos) <= SPAWN.neighborHelp && canVehicleSee(world, observer, v.pos)));
}

// Another truck's local group danger as one sighting judges it: off by a factor rolled with world RNG.
export function perceiveDanger(world: World, observer: Vehicle, other: Vehicle): number {
  const spread = NPC_BEHAVIOR.dangerSpread;
  const danger = localGroup(world, observer, other).reduce((sum, v) => sum + vehicleDanger(world, v), 0);
  return danger * randRange(world, 1 - spread, 1 + spread);
}

// The driver's own danger with its visible faction mates nearby that are not at odds with it.
export function ownDanger(world: World, vehicle: Vehicle): number {
  const group = localGroup(world, vehicle, vehicle).filter((v) => v.id === vehicle.id || !isHostile(world, vehicle, v));
  return group.reduce((sum, v) => sum + vehicleDanger(world, v), 0);
}

// Whether a perceived danger stays within the driver's own group danger times threat ratio and boldness.
function isManageable(world: World, vehicle: Vehicle, danger: number): boolean {
  return danger <= ownDanger(world, vehicle) * NPC_BEHAVIOR.threatRatio * npcProfile(vehicle).boldness;
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

// Vehicles heard, dusted, scanned or on a beacon beyond sight, at any range, while the contact circle is tight
// enough to act on. A vague distant sound stays audible without redirecting the driver. Nearest first.
export function usefulContacts(world: World, vehicle: Vehicle): Contact[] {
  const radius = npcProfile(vehicle).contactReactRadius;
  const useful = contactsOf(world, vehicle, Infinity).filter((contact) => contact.radius <= radius);
  return useful.sort((a, b) => dist(vehicle.pos, a.center) - dist(vehicle.pos, b.center));
}

// Goals that are work a driver would lose by leaving. Raiding, waiting, towing and danger goals are not.
const WORK: readonly NpcActivity['kind'][] = ['scavenge', 'sell', 'trade', 'resupply', 'loot', 'repair'];

function isBusy(vehicle: Vehicle): boolean {
  const kind = topGoal(vehicle)?.kind;
  return kind !== undefined && WORK.includes(kind);
}

// Whether `other` shot at the driver or a nearby visible faction mate, or aims its guns or its fight at one of them.
function threatens(world: World, vehicle: Vehicle, other: Vehicle): boolean {
  if (other.id in vehicle.brain!.attackers) return true;
  return aimsOf(other).some((id) => id === vehicle.id || isNearbyMate(world, vehicle, id));
}

function aimsOf(other: Vehicle): string[] {
  const aims = Object.values(other.weaponOrders).map((order) => order.targetId);
  const fight = other.brain ? topGoal(other) : null;
  return fight?.kind === 'fight' && fight.targetId ? [...aims, fight.targetId] : aims;
}

function isNearbyMate(world: World, vehicle: Vehicle, id: string): boolean {
  const mate = world.vehicles.find((v) => v.id === id);
  if (!mate || mate.faction !== vehicle.faction) return false;
  return dist(mate.pos, vehicle.pos) <= SPAWN.neighborHelp && canVehicleSee(world, vehicle, mate.pos);
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

// ---- Robbery.

// A robber can rob a truck it sees, that is not hostile yet, and that carries loot.
// Cheap checks run before the sight line.
export function canRob(w: World, robber: Vehicle, target: Vehicle): boolean {
  if (robber.id === target.id || !hasLoot(target)) return false;
  if (isHostile(w, robber, target)) return false;
  return canVehicleSee(w, robber, target.pos);
}

// ---- Availability, one check per option. An option is available when the driver physically can take it now.

type Availability = (world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null) => boolean;

const always = (): boolean => true;

function subjectOf(world: World, decision: DecisionId, subject: string | null): Vehicle {
  if (subject === null) throw new Error(`${decision} needs a subject`);
  return vehicleById(world, subject);
}

// A fight needs a working gun and the subject in sight.
function canFight(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return firepower(world, vehicle) > 0 && canVehicleSee(world, vehicle, subjectOf(world, decision, subject).pos);
}

// Driving off and closing in on a contact need fuel.
function canDrive(world: World, vehicle: Vehicle): boolean {
  return getResources(world, vehicle).fuel > 0;
}

function canRobSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return canRob(world, vehicle, subjectOf(world, decision, subject));
}

function canTow(world: World, vehicle: Vehicle): boolean {
  return strandedPlayerAt(world, vehicle) !== null;
}

function canResume(_world: World, vehicle: Vehicle): boolean {
  return topGoal(vehicle) !== null;
}

function canTrade(world: World, vehicle: Vehicle): boolean {
  return bestTrade(world, vehicle) !== null;
}

function canScavenge(world: World, vehicle: Vehicle): boolean {
  if (freeCells(vehicle) === 0) return false;
  return visibleSalvage(world, vehicle).length > 0 || salvageSitesAway(vehicle).length > 0;
}

function canRaid(_world: World, vehicle: Vehicle): boolean {
  return huntingGroundsAway(vehicle).length > 0;
}

type OptionName = DecisionOptions[DecisionId];

const AVAILABLE: Record<OptionName, Availability> = {
  keep: always,
  fight: canFight,
  fightBack: canFight,
  flee: canDrive,
  investigate: canDrive,
  rob: canRobSubject,
  tow: canTow,
  resume: canResume,
  new: always,
  trade: canTrade,
  scavenge: canScavenge,
  raid: canRaid,
  wait: always,
  paid: dealAvailable('paid'),
  ownParts: dealAvailable('ownParts'),
  free: dealAvailable('free'),
};

// ---- Situation factors, one per option. Each returns a number above 0.

// Every factor takes the same arguments. `danger` is the subject's perceived danger, as in optionWeights.
type SituationFactor = (world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null) => number;

const neutral = (): number => 1;

function weakFlee(world: World, vehicle: Vehicle): number {
  return isWeak(world, vehicle) ? NPC_BEHAVIOR.weakFlee : 1;
}

// A seen group is a threat when its perceived danger beats the driver's own group, scaled by threat ratio and
// boldness.
function threatFlee(world: World, vehicle: Vehicle, danger: number | null): number {
  return danger !== null && !isManageable(world, vehicle, danger) ? NPC_BEHAVIOR.threatFlee : 1;
}

function fleeSeenFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  return threatFlee(world, vehicle, danger) * weakFlee(world, vehicle);
}

// A heard enemy is judged only by the driver's own state.
function fleeHeardFactor(world: World, vehicle: Vehicle): number {
  return weakFlee(world, vehicle);
}

// A miss counts a little, and damage taken last turn adds by its share of the cab.
function fleeAttackedFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  const cabMax = partDef(corePart(vehicle, 'cab').defId).hp;
  const hit = NPC_BEHAVIOR.missFlee + vehicle.brain!.hurt / cabMax / NPC_BEHAVIOR.hurtFullFlee;
  return hit * weakFlee(world, vehicle) * threatFlee(world, vehicle, danger);
}

const FLEE_FACTORS: Partial<Record<DecisionId, SituationFactor>> = { hostileSeen: fleeSeenFactor, contactHeard: fleeHeardFactor, attacked: fleeAttackedFactor };

function fleeFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const factor = FLEE_FACTORS[decision];
  if (!factor) throw new Error(`No flee option at ${decision}`);
  return factor(world, vehicle, decision, subject, danger);
}

// A robber mostly picks a target that looks weaker than itself times its boldness, away from town guards. Each
// failed judgment scales rob down. Before the sighting's danger roll, `danger` is null and only guards count.
function robFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const target = subjectOf(world, decision, subject);
  const stronger = danger !== null && danger >= ownDanger(world, vehicle) * npcProfile(vehicle).boldness;
  return (stronger ? NPC_BEHAVIOR.robStronger : 1) * guardFactor(vehicle, target, NPC_BEHAVIOR.robNearGuards);
}

// Guard caution: starting a fight or a robbery near a town gate is rare. It never lowers fighting back.
function guardFactor(vehicle: Vehicle, subject: Vehicle, nearGuards: number): number {
  return isTownGuarded(vehicle.pos) || isTownGuarded(subject.pos) ? nearGuards : 1;
}

// A driver free of work mostly takes on a manageable group it sees, away from guards.
function fightFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const target = subjectOf(world, decision, subject);
  const eager = !isBusy(vehicle) && danger !== null && isManageable(world, vehicle, danger);
  return (eager ? NPC_BEHAVIOR.manageableFight : 1) * guardFactor(vehicle, target, NPC_BEHAVIOR.fightNearGuards);
}

// An attacked driver mostly defends against a manageable group, busy or not.
function fightBackFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  return danger !== null && isManageable(world, vehicle, danger) ? NPC_BEHAVIOR.manageableFight : 1;
}

// A driver busy with work, not weak, mostly keeps on around a hostile that is not aimed at it or its group.
function keepFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  if (decision !== 'hostileSeen' && decision !== 'contactHeard') return 1;
  const other = subjectOf(world, decision, subject);
  const restrained = isBusy(vehicle) && !isWeak(world, vehicle) && !threatens(world, vehicle, other);
  return restrained ? NPC_BEHAVIOR.keepWork : 1;
}

function scavengeFactor(world: World, vehicle: Vehicle): number {
  return visibleSalvage(world, vehicle).length > 0 ? NPC_BEHAVIOR.visibleSalvage : 1;
}

const SITUATION: Record<OptionName, SituationFactor> = {
  keep: keepFactor,
  fight: fightFactor,
  fightBack: fightBackFactor,
  flee: fleeFactor,
  investigate: neutral,
  rob: robFactor,
  tow: neutral,
  resume: neutral,
  new: neutral,
  trade: neutral,
  scavenge: scavengeFactor,
  raid: neutral,
  wait: neutral,
  paid: neutral,
  ownParts: neutral,
  free: neutral,
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

// The final weight of each available option. Unavailable options are left out. `danger` is the subject's danger
// as this sighting perceived it. It is null for decisions without a seen vehicle, and before the sighting's roll.
// Then the danger judgments do not apply.
export function optionWeights<D extends DecisionId>(world: World, vehicle: Vehicle, decision: D, subject: string | null, danger: number | null): Partial<Record<DecisionOptions[D], number>> {
  const base = DECISIONS[decision] as Record<OptionName, number>;
  const tables = changeTables(world, vehicle, subject);
  const out: Partial<Record<OptionName, number>> = {};
  for (const option of Object.keys(base) as OptionName[]) {
    if (!AVAILABLE[option](world, vehicle, decision, subject)) continue;
    const { add, mul } = sumChanges(tables, decision, option);
    const factor = SITUATION[option](world, vehicle, decision, subject, danger);
    if (!(factor > 0)) throw new Error(`${vehicle.id} has situation factor ${factor} for ${option} at ${decision}`);
    out[option] = (base[option] + add) * mul * factor;
  }
  return out as Partial<Record<DecisionOptions[D], number>>;
}

// The summed adds and the product of muls the tables set for one option. A mul at or below 0 throws.
function sumChanges(tables: TraitWeights[], decision: DecisionId, option: OptionName): Required<WeightChange> {
  let add = 0;
  let mul = 1;
  for (const table of tables) {
    const change = (table[decision] as Partial<Record<OptionName, WeightChange>> | undefined)?.[option];
    if (!change) continue;
    add += change.add ?? 0;
    mul *= positiveMul(change, decision, option);
  }
  return { add, mul };
}

function positiveMul(change: WeightChange, decision: DecisionId, option: OptionName): number {
  if (change.mul === undefined) return 1;
  if (!(change.mul > 0)) throw new Error(`Multiplier ${change.mul} for ${option} at ${decision} must be above 0`);
  return change.mul;
}

// A decision with a keep option offers a choice only while another option is available. Without one, the driver
// keeps what it does with no roll.
export function hasChoice(weights: Partial<Record<OptionName, number>>): boolean {
  return !('keep' in weights) || Object.keys(weights).some((option) => option !== 'keep');
}

// hasChoice from availability alone, without the situation factors.
export function offersChoice(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  const options = Object.keys(DECISIONS[decision]) as OptionName[];
  if (!options.includes('keep')) return true;
  return options.some((option) => option !== 'keep' && AVAILABLE[option](world, vehicle, decision, subject));
}

// Each option's chance: MIN_CHANCE plus its weighted share of the rest. With no weight at all, equal shares.
export function optionChances<O extends string>(weights: Partial<Record<O, number>>): Partial<Record<O, number>> {
  const entries = Object.entries(weights) as [O, number][];
  const rest = 1 - entries.length * MIN_CHANCE;
  if (entries.length === 0 || rest < 0) throw new Error(`Cannot give ${entries.length} options their chances`);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const out: Partial<Record<O, number>> = {};
  for (const [option, weight] of entries) out[option] = MIN_CHANCE + rest * (total > 0 ? weight / total : 1 / entries.length);
  return out;
}

export function decide<D extends DecisionId>(world: World, vehicle: Vehicle, decision: D, subject: string | null, danger: number | null): DecisionOptions[D] {
  const weights = optionWeights(world, vehicle, decision, subject, danger);
  checkWeights(vehicle, decision, weights);
  if (!hasChoice(weights)) return 'keep' as DecisionOptions[D];
  const chances = Object.entries(optionChances(weights)) as [DecisionOptions[D], number][];
  return sampleWeighted(world, chances.map(([value, weight]) => ({ value, weight })));
}

// A negative or non-finite weight throws.
function checkWeights(vehicle: Vehicle, decision: DecisionId, weights: Partial<Record<OptionName, number>>): void {
  for (const [option, weight] of Object.entries(weights) as [OptionName, number][]) {
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`${vehicle.id} has weight ${weight} for ${option} at ${decision}`);
  }
}
