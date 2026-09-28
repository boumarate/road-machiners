// Weighted NPC decisions. A decision point offers options. An option is available when the driver physically can
// take it now. Each available option's final weight is (base + adds) x muls x situation factor. Bases live in
// DECISIONS. Adds and muls come from the NPC's traits, and from the states it holds toward the decision's subject.
// The situation factor reads what the NPC perceives. Every available option gets at least MIN_CHANCE and shares
// the rest by weight. A roll with world RNG picks one. Traits also give the NPC's profile: the sites it knows and
// how bold it is. Danger compares local groups: a truck with its visible faction mates nearby. A driver busy with
// work mostly keeps on around hostiles not aimed at it or its group. Robbery is a fight against a truck the robber
// can rob, mostly a weaker one away from guards.

import { dealAvailable } from './patch';
import { ECONOMY, GOOD_IDS } from '../data/goods';
import { GOOD_SOURCES } from '../data/market';
import {
  DECISIONS, HUNT, MIN_CHANCE, NPC_BEHAVIOR, NPC_UPKEEP, SPAWN, STATE_WEIGHTS, TRAITS,
  type DecisionId, type DecisionOptions, type TraitId, type TraitWeights, type WeightChange,
} from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { isHostile } from './combat';
import { isRamGainful, ramImpact } from './crash-contact';
import { isKnockedOut } from './defeat';
import { vehicleById } from './damage';
import { contactsOf } from './detect';
import { getTradePrice } from './economy';
import { maxHp } from './wear';
import { corePart, freeCells, hasLoot, mountedParts } from './grid';
import { isTownGuarded } from './guards';
import { topGoal } from './npc-activities';
import { sampleWeighted } from './npc-loadout';
import { getResources } from './resources';
import { skillEffect } from './progress';
import { randRange } from './rng';
import { canReachSalvage, canTakeAny, canTakeFromTruck, siteLootTable } from './salvage';
import { canUseSite, siteGates, sitePads, siteUnder, type Site } from './sites';
import { stateOf, statesHeld } from './states';
import { fuelCap, isStranded, suppliesCap, vehicleStats } from './stats';
import { canHire, canTakeEscort, declineFactor, inTowReach, isOnRope, strandedAt, towSite, unguardedLeader } from './tow';
import type { Contact, NpcActivity, SalvageStock, Vehicle, World } from './types';
import { clamp, dist, type Vec } from './vec';
import { canVehicleSee } from './vision';

// ---- Traits and the profile they give.

export type NpcProfile = {
  towns: string[];
  bases: string[];
  salvageSites: string[];
  supplySites: string[];
  travelSites: string[];
  haulSites: string[];
  contactReactRadius: number;
  boldness: number;
  fuelMargin: number;
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

// Known sites are the union over traits, in trait order. The widest contact radius wins. Boldness and fuel margin
// multiply.
export function profileOf(traits: TraitId[]): NpcProfile {
  if (traits.length === 0) throw new Error('A profile needs at least one trait');
  const defs = traits.map((id) => {
    if (!Object.hasOwn(TRAITS, id)) throw new Error(`Unknown trait ${id}`);
    return TRAITS[id];
  });
  const union = (key: 'towns' | 'bases' | 'salvageSites' | 'supplySites' | 'travelSites' | 'haulSites') => [...new Set(defs.flatMap((t) => t[key]))];
  return {
    towns: union('towns'),
    bases: union('bases'),
    salvageSites: union('salvageSites'),
    supplySites: union('supplySites'),
    travelSites: union('travelSites'),
    haulSites: union('haulSites'),
    contactReactRadius: Math.max(...defs.map((t) => t.contactReactRadius)),
    boldness: defs.reduce((product, t) => product * t.boldness, 1),
    fuelMargin: defs.reduce((product, t) => product * t.fuelMargin, 1),
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

// The share left of the cab or the average share left over every mounted part, whichever is lower, and 0 for a
// truck that cannot drive. One damaged wheel barely counts, but a truck broken up all around gives up.
function getCombatCondition(world: World, vehicle: Vehicle): number {
  if (isStranded(world, vehicle)) return 0;
  const cab = corePart(vehicle, 'cab');
  const parts = mountedParts(vehicle);
  const overall = parts.reduce((sum, part) => sum + part.hp / maxHp(part), 0) / parts.length;
  return Math.min(cab.hp / maxHp(cab), overall);
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

// Combat condition or driver health at or below the flee condition, or below the higher recover condition while
// already fleeing.
export function isWeak(world: World, vehicle: Vehicle): boolean {
  const threshold = topGoal(vehicle)?.kind === 'flee' ? NPC_BEHAVIOR.recoverCondition : NPC_BEHAVIOR.fleeCondition;
  return getCombatCondition(world, vehicle) <= threshold || getResources(world, vehicle).health / RULES.maxHealth <= threshold;
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
const WORK: readonly NpcActivity['kind'][] = ['scavenge', 'sell', 'trade', 'resupply', 'loot', 'repair', 'travel', 'haul'];

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
  return (fuelCap(vehicle) * ECONOMY.supplyPrice.fuel + suppliesCap(vehicle) * ECONOMY.supplyPrice.supplies) * NPC_UPKEEP.reserveLoads;
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
  const visible = world.salvage.filter((stock) => seesSalvage(world, vehicle, stock));
  return visible.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

// Knocked-out trucks in sight with something left the driver could take, or too far to inspect. Nearest first.
export function visibleDowned(world: World, vehicle: Vehicle): Vehicle[] {
  const visible = world.vehicles.filter((v) => seesDowned(world, vehicle, v));
  return visible.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

function seesDowned(world: World, vehicle: Vehicle, target: Vehicle): boolean {
  if (target.id === vehicle.id || !isKnockedOut(target) || !canVehicleSee(world, vehicle, target.pos)) return false;
  return !inTowReach(vehicle, target) || canTakeFromTruck(vehicle, target);
}

function seesSalvage(world: World, vehicle: Vehicle, stock: SalvageStock): boolean {
  return canVehicleSee(world, vehicle, stock.pos) && (!canReachSalvage(vehicle, stock) || canTakeAny(world, vehicle, stock));
}

// Known salvage sites other than the one the NPC stands at.
export function salvageSitesAway(vehicle: Vehicle) {
  return npcProfile(vehicle).salvageSites.map(getKnownSite).filter((site) => !canUseSite(vehicle.pos, site));
}

let grounds: readonly Vec[] | null = null;

// Where raiders look for prey: points every HUNT.roadSpacing tiles along the roads, kept only far from every
// site, and the pads of every location with salvage. Built once from the region.
export function huntingGrounds(): readonly Vec[] {
  if (grounds) return grounds;
  const sites = [...REGION.towns, ...REGION.locations];
  const lonely = (p: Vec) => sites.every((site) => dist(p, site.pos) - site.radius >= HUNT.siteDistance);
  const roadPoints = REGION.roads.flatMap((road) => pointsAlong(road, HUNT.roadSpacing)).filter(lonely);
  const lootPads = REGION.locations.filter((site) => site.kind !== 'camp' && siteLootTable(site)).flatMap((site) => sitePads(site));
  grounds = [...roadPoints, ...lootPads];
  return grounds;
}

// Points every `spacing` tiles along a polyline, the first half a spacing from its start.
function pointsAlong(line: readonly Vec[], spacing: number): Vec[] {
  const points: Vec[] = [];
  let next = spacing / 2;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = dist(a, b);
    for (; next <= walked + length; next += spacing) {
      const t = (next - walked) / length;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    walked += length;
  }
  return points;
}

export function huntingGroundsAway(vehicle: Vehicle): Vec[] {
  return huntingGrounds().filter((point) => dist(vehicle.pos, point) > RULES.arriveRadius * 2);
}

// ---- Patrols, trips and hauls.

// The known town nearest the driver's home, which its patrols circle.
export function patrolTown(vehicle: Vehicle) {
  const home = vehicle.brain!.home;
  return npcProfile(vehicle).towns.map(getKnownSite).sort((a, b) => dist(home, a.pos) - dist(home, b.pos))[0];
}

const patrolStops = new Map<string, readonly Vec[]>();

// Where a patrol of a town drives: points every NPC_BEHAVIOR.patrolSpacing tiles along the roads, within
// NPC_BEHAVIOR.patrolRadius of a town gate and outside every site. Built once per town from the region.
export function patrolPoints(town: Site): readonly Vec[] {
  const cached = patrolStops.get(town.id);
  if (cached) return cached;
  const gates = siteGates(town);
  const near = (p: Vec) => gates.some((gate) => dist(gate, p) <= NPC_BEHAVIOR.patrolRadius);
  const points = REGION.roads.flatMap((road) => pointsAlong(road, NPC_BEHAVIOR.patrolSpacing)).filter((p) => near(p) && siteUnder(p) === null);
  patrolStops.set(town.id, points);
  return points;
}

// Known trip destinations other than the one the driver stands at.
export function travelSitesAway(vehicle: Vehicle) {
  return npcProfile(vehicle).travelSites.map(getKnownSite).filter((site) => !canUseSite(vehicle.pos, site));
}

// The goods a source site gives for free.
export function haulGoods(siteId: string): string[] {
  const goods = Object.entries(GOOD_SOURCES).flatMap(([good, sites]) => (sites.includes(siteId) ? [good] : []));
  if (goods.length === 0) throw new Error(`${siteId} is no source of any good`);
  return goods;
}

// True while an NPC driver fights or flees a truck other than `otherId`. Such a driver takes no calls or offers
// from that truck, and nobody but its foe starts a robbery, tow or hire with it.
export function busyWithFight(vehicle: Vehicle, otherId: string): boolean {
  const top = vehicle.brain ? topGoal(vehicle) : null;
  return (top?.kind === 'fight' || top?.kind === 'flee') && top.targetId !== otherId;
}

// ---- Robbery.

// A robber can rob a truck it sees, that is not hostile yet, that is not busy fighting another, that is not
// knocked out, since that one is looted instead, that is not on a tow rope, and that carries loot. Cheap checks run before the sight line.
export function canRob(w: World, robber: Vehicle, target: Vehicle): boolean {
  if (robber.id === target.id || !isRobbable(w, target) || busyWithFight(target, robber.id)) return false;
  if (isHostile(w, robber, target)) return false;
  return canVehicleSee(w, robber, target.pos);
}

function isRobbable(w: World, target: Vehicle): boolean {
  return hasLoot(target) && !isKnockedOut(target) && !isOnRope(w, target.id);
}

// ---- Availability, one check per option. An option is available when the driver physically can take it now.

type Availability = (world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null) => boolean;

const always = (): boolean => true;

// A client hires a free merc it sees while on a trip, with the fee above its upkeep reserve.
function canHireSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return canHire(world, vehicle, subjectOf(world, decision, subject));
}

// A merc takes the job while free and at peace with the client.
function canTakeSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return canTakeEscort(world, vehicle, subjectOf(world, decision, subject));
}

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

// A robbery is a fight, so it also needs a working gun.
function canRobSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return firepower(world, vehicle) > 0 && canRob(world, vehicle, subjectOf(world, decision, subject));
}

// A ram needs the subject as the fight target on top of the goals, within reach of a damaging ram.
function canRamSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  const target = subjectOf(world, decision, subject);
  const top = topGoal(vehicle);
  return top?.kind === 'fight' && top.targetId === target.id && ramImpact(world, vehicle, target) !== null;
}

function canTow(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  return strandedAt(world, vehicle, subjectOf(world, decision, subject)) !== null;
}

function canResume(_world: World, vehicle: Vehicle): boolean {
  return topGoal(vehicle) !== null;
}

function canTrade(world: World, vehicle: Vehicle): boolean {
  return bestTrade(world, vehicle) !== null;
}

function canScavenge(world: World, vehicle: Vehicle): boolean {
  if (freeCells(vehicle) === 0) return false;
  return visibleSalvage(world, vehicle).length > 0 || visibleDowned(world, vehicle).length > 0 || salvageSitesAway(vehicle).length > 0;
}

// Looting salvage or a knocked-out truck on the way needs cargo room and the loot in sight.
function canLootSubject(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): boolean {
  if (subject === null) throw new Error(`${decision} needs a subject`);
  if (freeCells(vehicle) === 0) return false;
  const stock = world.salvage.find((entry) => entry.id === subject);
  if (stock) return seesSalvage(world, vehicle, stock);
  const truck = world.vehicles.find((v) => v.id === subject);
  return truck !== undefined && seesDowned(world, vehicle, truck);
}

// Only raiders are hostile to trucks with loot, so only they have prey to hunt.
function canRaid(_world: World, vehicle: Vehicle): boolean {
  return vehicle.faction === 'raiders' && huntingGroundsAway(vehicle).length > 0;
}

function canPatrol(_world: World, vehicle: Vehicle): boolean {
  return hasTrait(vehicle, 'lawman') && patrolPoints(patrolTown(vehicle)).length > 0;
}

function canTravel(_world: World, vehicle: Vehicle): boolean {
  return travelSitesAway(vehicle).length > 0;
}

// A haul needs cargo room and a known source.
function canHaul(_world: World, vehicle: Vehicle): boolean {
  return freeCells(vehicle) > 0 && npcProfile(vehicle).haulSites.length > 0;
}

// An idle guard takes up an escort of a leader no escort guards yet.
function canEscort(world: World, vehicle: Vehicle): boolean {
  return hasTrait(vehicle, 'guard') && unguardedLeader(world, vehicle) !== null;
}

type OptionName = DecisionOptions[DecisionId];

const AVAILABLE: Record<OptionName, Availability> = {
  keep: always,
  fight: canFight,
  fightBack: canFight,
  flee: canDrive,
  investigate: canDrive,
  rob: canRobSubject,
  ram: canRamSubject,
  tow: canTow,
  resume: canResume,
  new: always,
  trade: canTrade,
  scavenge: canScavenge,
  raid: canRaid,
  loot: canLootSubject,
  wait: always,
  patrol: canPatrol,
  travel: canTravel,
  explore: canDrive,
  haul: canHaul,
  escort: canEscort,
  paid: dealAvailable('paid'),
  ownParts: dealAvailable('ownParts'),
  free: dealAvailable('free'),
  forgive: always,
  retaliate: always,
  truce: always,
  beg: always,
  accept: always,
  refuse: always,
  spare: always,
  finish: always,
  comply: always,
  demand: always,
  attack: always,
  hire: canHireSubject,
  take: canTakeSubject,
  decline: always,
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
  const cabMax = maxHp(corePart(vehicle, 'cab'));
  const hit = NPC_BEHAVIOR.missFlee + vehicle.brain!.hurt / cabMax / NPC_BEHAVIOR.hurtFullFlee;
  return hit * weakFlee(world, vehicle) * threatFlee(world, vehicle, danger);
}

const FLEE_FACTORS: Partial<Record<DecisionId, SituationFactor>> = { hostileSeen: fleeSeenFactor, contactHeard: fleeHeardFactor, attacked: fleeAttackedFactor, threatened: fleeSeenFactor };

function fleeFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const factor = FLEE_FACTORS[decision];
  if (!factor) throw new Error(`No flee option at ${decision}`);
  return factor(world, vehicle, decision, subject, danger);
}

// A robber mostly picks a target that looks weaker than itself times its boldness, away from town guards. Each
// failed judgment scales rob down. Before the sighting's danger roll, `danger` is null and only guards count. The
// player's social skill makes the player truck look more dangerous.
function robFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null, danger: number | null): number {
  const target = subjectOf(world, decision, subject);
  const seen = danger === null ? null : danger * (1 + skillEffect(world, target, 'social', 'robberyDanger'));
  const stronger = seen !== null && seen >= ownDanger(world, vehicle) * npcProfile(vehicle).boldness;
  return (stronger ? NPC_BEHAVIOR.robStronger : 1) * guardFactor(vehicle, target, NPC_BEHAVIOR.robNearGuards);
}

// Guard caution: starting a fight or a robbery near a town gate is rare. It never lowers fighting back. Lawmen
// keep the peace at the gates, so they skip it.
function guardFactor(vehicle: Vehicle, subject: Vehicle, nearGuards: number): number {
  if (hasTrait(vehicle, 'lawman')) return 1;
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

// A ram the forecast calls costly is rare.
function ramFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  return isRamGainful(world, vehicle, subjectOf(world, decision, subject)) ? 1 : NPC_BEHAVIOR.riskyRam;
}

// A crash with a faction mate is mostly forgiven.
function retaliateFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  return subjectOf(world, decision, subject).faction === vehicle.faction ? NPC_BEHAVIOR.mateRetaliate : 1;
}

// A driver facing a threat asks for a truce more often. A robber that is not weak rarely asks its prey.
function truceFactor(world: World, vehicle: Vehicle, _decision: DecisionId, subject: string | null, danger: number | null): number {
  if (danger !== null && !isManageable(world, vehicle, danger)) return NPC_BEHAVIOR.threatTruce;
  return robs(world, vehicle, subject) && !isWeak(world, vehicle) ? NPC_BEHAVIOR.robberTruce : 1;
}

// A weak driver begs.
function begFactor(world: World, vehicle: Vehicle): number {
  return isWeak(world, vehicle) ? NPC_BEHAVIOR.weakBeg : 1;
}

// A driver facing a threat, or weak itself, wants the fight to end.
function wantsPeace(world: World, vehicle: Vehicle, danger: number | null): boolean {
  return (danger !== null && !isManageable(world, vehicle, danger)) || isWeak(world, vehicle);
}

// A driver takes a truce more often from a threat, or when it is weak itself.
function acceptFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  return wantsPeace(world, vehicle, danger) ? NPC_BEHAVIOR.threatAccept : 1;
}

// A robber that still expects to win refuses its prey's truce.
function refuseFactor(world: World, vehicle: Vehicle, _decision: DecisionId, subject: string | null, danger: number | null): number {
  return robs(world, vehicle, subject) && !wantsPeace(world, vehicle, danger) ? NPC_BEHAVIOR.robberRefuse : 1;
}

// Whether the driver is after the subject's cargo: it started a robbery feud, or it is a raider and the subject a
// non-raider with loot, which is what makes raiders hostile.
function robs(world: World, vehicle: Vehicle, subject: string | null): boolean {
  if (subject === null) return false;
  const target = vehicleById(world, subject);
  return robbingFeud(world, vehicle, target) || (vehicle.faction === 'raiders' && target.faction !== 'raiders' && hasLoot(target));
}

function robbingFeud(world: World, vehicle: Vehicle, target: Vehicle): boolean {
  const feud = stateOf(world, 'feud', vehicle.id, target.id);
  return feud?.data.kind === 'feud' && feud.data.robbery;
}

// A driver hands its cargo to a threat.
function complyFactor(world: World, vehicle: Vehicle, _decision: DecisionId, _subject: string | null, danger: number | null): number {
  return danger !== null && !isManageable(world, vehicle, danger) ? NPC_BEHAVIOR.threatComply : 1;
}

// A stranded truck that can crawl to a gate mostly gets no tow. The factor rises from NPC_BEHAVIOR.towNearTown at a
// short crawl to 1 far out, measured from where the driver perceives the truck. The player crawls to any town. An
// NPC crawls to the site it would be towed to. The known face perk raises it for the player.
function towFactor(world: World, vehicle: Vehicle, decision: DecisionId, subject: string | null): number {
  const client = subjectOf(world, decision, subject);
  const at = strandedAt(world, vehicle, client);
  if (!at) throw new Error(`${vehicle.id} weighs a tow with no stranded ${client.id} perceived`);
  const player = client.id === world.player.vehicleId;
  const sites = player ? REGION.towns : [towSite(world, vehicle, client)];
  const { factor, crawl, far } = NPC_BEHAVIOR.towNearTown;
  const gate = Math.min(...sites.flatMap((site) => siteGates(site).map((g) => dist(at, g))));
  return factor + (1 - factor) * clamp((gate - crawl) / (far - crawl), 0, 1);
}

// A driver below the recover condition rarely closes in on a contact. It needs repairs first.
function investigateFactor(world: World, vehicle: Vehicle): number {
  return getCombatCondition(world, vehicle) <= NPC_BEHAVIOR.recoverCondition ? NPC_BEHAVIOR.crippledInvestigate : 1;
}

function scavengeFactor(world: World, vehicle: Vehicle): number {
  return visibleSalvage(world, vehicle).length > 0 ? NPC_BEHAVIOR.visibleSalvage : 1;
}

const SITUATION: Record<OptionName, SituationFactor> = {
  keep: keepFactor,
  fight: fightFactor,
  fightBack: fightBackFactor,
  flee: fleeFactor,
  investigate: investigateFactor,
  rob: robFactor,
  ram: ramFactor,
  tow: towFactor,
  demand: neutral,
  attack: neutral,
  resume: neutral,
  new: neutral,
  trade: neutral,
  scavenge: scavengeFactor,
  raid: neutral,
  loot: neutral,
  wait: neutral,
  patrol: neutral,
  travel: neutral,
  explore: neutral,
  haul: neutral,
  escort: neutral,
  paid: neutral,
  ownParts: neutral,
  free: neutral,
  forgive: neutral,
  retaliate: retaliateFactor,
  truce: truceFactor,
  beg: begFactor,
  accept: acceptFactor,
  refuse: refuseFactor,
  spare: neutral,
  finish: neutral,
  comply: complyFactor,
  hire: neutral,
  take: neutral,
  decline: (world, vehicle) => declineFactor(world, vehicle),
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
