// NPC goals: the goal stack, the fixed survival rule, the decision points that push and pop goals, and each goal's
// work. See src/sim/npc-decisions.ts for the weighted rolls.

import { chassisDef } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP, SPAWN, type DecisionOptions } from '../data/npcs';
import { SHOPS, shopDef } from '../data/market';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { TOW } from '../data/tow';
import type { PartHit } from './armor';
import { callLawmen, isHostile, startFeuds } from './combat';
import { affordableBuyCount, getTradePrice, sellVehicleCargo, serviceAtCamp, serviceAtStall, serviceVehicle, tradeGoods } from './economy';
import { isJunk, maxHp } from './wear';
import { corePart, freeCells, goodsCount, mountedParts } from './grid';
import { addGoods } from './inventory';
import { cancelJob, inCombat } from './jobs';
import { isFree } from './spawn';
import {
  tradeOffers, canRob, decide, keepsWord, offersChoice, perceiveDanger, getKnownSite, getUpkeepReserve, haulGoods, patrolPoints, patrolTown, travelSitesAway,
  huntingGroundsAway, isHostileContact, isWeak, npcProfile, salvageSitesAway, usefulContacts, visibleDowned, visibleHostiles, visibleSalvage, type NpcProfile,
} from './npc-decisions';
import { chooseNpcRepair, continueNpcRepair, repairsHere, resolveNpcRepair } from './npc-repair';
import { getResources } from './resources';
import { hashRandom, randInt, randRange } from './rng';
import { sampleWeighted } from './npc-loadout';
import { canLootTruck, canReachSalvage, canTakeAny, canTakeFromTruck, hasSalvage, isSiteStock, lootTruckTurn, wreckStockId } from './salvage';
import { beginSearch } from './search';
import { vehicleById } from './damage';
import { plead } from './parley';
import { addState, endState, stateOf, statesHeld } from './states';
import { suppliesCap, vehicleStats } from './stats';
import type { Contact, GameEvent, Job, NpcActivity, NpcBrain, NpcState, RefitJob, SalvageStock, Vehicle, World } from './types';
import { canUseSite, nearestPad, type Site } from './sites';
import { clamp, dist, type Vec } from './vec';
import { heatAt } from './sun';
import { canVehicleSee } from './vision';
import { dropTow, follows, inTowReach, isOnRope, joinLeader, mercsInSight, npcHomeSite, offerEscort, runTow, steerFollow, strandedAt, towGoal, towHeldBy } from './tow';
import { isDefeated, isKnockedOut, refitAtHome } from './defeat';

// ---- The goal stack. The top goal drives the NPC. A long-term goal sits at the bottom, and interruptions go on top
// of it. A new goal replaces any goal of its kind, so the stack never holds two goals of one kind. Every change logs
// an `activity` event.

// Goals that interrupt a long-term goal. Popping one that uncovers the long-term goal fires the resume decision.
// A follow is listed too. It resumes after an interruption without the resume roll, and a follower stops for no
// salvage.
export const INTERRUPTIONS: readonly NpcActivity['kind'][] = ['fight', 'flee', 'investigate', 'resupply', 'tow', 'loot', 'repair', 'patch', 'meet', 'retreat', 'follow'];

function goalsOf(v: Vehicle): NpcActivity[] {
  if (!v.brain) throw new Error(`${v.id} has no NPC brain`);
  if (!v.brain.goals) throw new Error(`${v.id} has no goals`);
  return v.brain.goals;
}

export function topGoal(v: Vehicle): NpcActivity | null {
  const goals = goalsOf(v);
  return goals[goals.length - 1] ?? null;
}

// A search belongs to a scavenge or loot goal on its stock on top. A repair belongs to a repair goal anywhere in the
// stack, so a pinned driver keeps patching under a danger goal until it moves.
function jobBelongs(job: Job, v: Vehicle): boolean {
  if (job.kind === 'repair') return goalsOf(v).some((g) => g.kind === 'repair');
  if (job.kind === 'refit') return refitBelongs(job, topGoal(v));
  return searchBelongs(job, topGoal(v));
}

function searchBelongs(job: Job, goal: NpcActivity | null): boolean {
  return job.kind === 'search' && (goal?.kind === 'scavenge' || goal?.kind === 'loot') && goal.targetId === job.stockId;
}

// A refit that takes a part off a knocked-out truck belongs to the loot goal on that truck.
function refitBelongs(job: RefitJob, goal: NpcActivity | null): boolean {
  return goal?.kind === 'loot' && job.pickup?.from === 'truck' && goal.targetId === job.pickup.vehicleId;
}

function goalKind(goal: NpcActivity | null): NpcActivity['kind'] | null {
  return goal?.kind ?? null;
}

// Logs the change. A new top goal cancels a running job that is not its own, since the driver moves off.
function logChange(w: World, v: Vehicle, previous: NpcActivity | null, reason: string): void {
  const top = topGoal(v);
  w.events.push({ t: 'activity', vehicle: v.id, previous: goalKind(previous), activity: goalKind(top), reason });
  if (top !== previous && v.job && !jobBelongs(v.job, v)) cancelJob(w, v);
}

export function pushGoal(w: World, v: Vehicle, goal: NpcActivity): void {
  const previous = topGoal(v);
  v.brain!.goals = [...goalsOf(v).filter((g) => g.kind !== goal.kind), goal];
  logChange(w, v, previous, goal.reason);
}

export function popGoal(w: World, v: Vehicle, reason: string): NpcActivity {
  const goals = goalsOf(v);
  const popped = goals.pop();
  if (!popped) throw new Error(`${v.id} has no goal to pop`);
  logChange(w, v, popped, reason);
  return popped;
}

// Swaps the long-term goal at the bottom, keeping any interruptions above it.
export function replaceBase(w: World, v: Vehicle, goal: NpcActivity): void {
  const goals = goalsOf(v);
  if (goals.length === 0) throw new Error(`${v.id} has no long-term goal to replace`);
  const previous = topGoal(v);
  v.brain!.goals = [goal, ...goals.slice(1).filter((g) => g.kind !== goal.kind)];
  logChange(w, v, previous, goal.reason);
}

// Puts a goal at the bottom of the stack. It replaces the long-term goal there, and goes under interruptions when
// there is none.
export function placeBase(w: World, v: Vehicle, goal: NpcActivity): void {
  const previous = topGoal(v);
  const kept = goalsOf(v).filter((g, i) => g.kind !== goal.kind && (i > 0 || INTERRUPTIONS.includes(g.kind)));
  v.brain!.goals = [goal, ...kept];
  logChange(w, v, previous, goal.reason);
}

// ---- Goal helpers.

function createActivity(kind: NpcActivity['kind'], targetId: string | null, destination: Vec | null, reason: string): NpcActivity {
  return { kind, targetId, destination, reason, phase: destination ? 'travel' : 'act' };
}

function chooseNearestSite(vehicle: Vehicle, ids: string[]) {
  return ids.map(getKnownSite).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos))[0];
}

function createSiteActivity(kind: NpcActivity['kind'], id: string, reason: string): NpcActivity {
  return createActivity(kind, id, { ...getKnownSite(id).pos }, reason);
}

// Goods beyond the repair parts reserve, or a spare part.
function hasSaleCargo(vehicle: Vehicle): boolean {
  const mounted = new Set(mountedParts(vehicle).map((part) => part.id));
  const goods = Object.entries(goodsCount(vehicle)).some(([good, count]) => count > (good === 'parts' ? NPC_UPKEEP.repairParts : 0));
  return goods || vehicle.items.some((item) => item.kind === 'part' && !mounted.has(item.part.id));
}

// Where an NPC flees to, away from a threat at `threatPos`: its spot at the nearest known town or own camp whose
// direction from the vehicle is more than 90 degrees off the threat's, or straight away from the threat if no such
// site is known. Trucks never enter a site, so the spot lies on a pad.
function fleeDestination(world: World, vehicle: Vehicle, profile: NpcProfile, threatPos: Vec): Vec {
  const safe = [...profile.towns, ...profile.bases].map(getKnownSite).filter((site) => pointsAway(vehicle.pos, site.pos, threatPos));
  safe.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const away = { x: vehicle.pos.x + (vehicle.pos.x - threatPos.x), y: vehicle.pos.y + (vehicle.pos.y - threatPos.y) };
  const destination = safe[0] ? siteSpot(world, vehicle, safe[0], vehicleStats(world, vehicle).radius + RULES.arriveRadius, 0) : away;
  return { x: clamp(destination.x, 1, world.size - 1), y: clamp(destination.y, 1, world.size - 1) };
}

function pointsAway(from: Vec, to: Vec, threat: Vec): boolean {
  return (to.x - from.x) * (threat.x - from.x) + (to.y - from.y) * (threat.y - from.y) < 0;
}

// ---- Goal builders.

// Why an NPC needs service, whether low supplies are its only need, and whether it needs repairs.
type ServiceNeed = { reason: string; suppliesOnly: boolean; damaged: boolean };

// Junk parts do not count, since no service rebuilds them.
function isDamaged(vehicle: Vehicle): boolean {
  return mountedParts(vehicle).some((part) => !isJunk(part) && part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition);
}

function serviceReason(lowFuel: boolean, lowSupplies: boolean): string {
  return lowFuel ? 'low fuel' : lowSupplies ? 'low supplies' : 'needs repairs';
}

// Where a driver buys fuel. A raider fuels at its camps, any other driver in its towns or at a stall that sells fuel.
function pumpsOf(vehicle: Vehicle, profile: NpcProfile): string[] {
  if (profile.bases.length > 0) return profile.bases;
  if (profile.towns.length === 0) throw new Error(`${vehicle.id} knows no pump`);
  return [...profile.towns, ...FUEL_STALLS];
}

const FUEL_STALLS: readonly string[] = Object.values(SHOPS).filter((s) => s.kind === 'stall' && s.supplies.includes('fuel')).map((s) => s.id);

// The fuel a driver thinks the way to its nearest pump takes: the straight line at the heat where it stands.
function fuelToPump(world: World, vehicle: Vehicle, profile: NpcProfile): number {
  const pump = chooseNearestSite(vehicle, pumpsOf(vehicle, profile));
  return dist(vehicle.pos, pump.pos) * vehicleStats(world, vehicle).fuelPerTile * heatAt(world, vehicle.pos);
}

// The driver's own fixed misjudgment of fuel, from 1 - NPC_UPKEEP.fuelSense to 1 + NPC_UPKEEP.fuelSense.
function fuelSense(world: World, vehicle: Vehicle): number {
  const roll = hashRandom(world.seed, ...charCodes(vehicle.id), ...charCodes('fuel'));
  return 1 + NPC_UPKEEP.fuelSense * (2 * roll - 1);
}

function isLowOnFuel(world: World, vehicle: Vehicle, profile: NpcProfile): boolean {
  const reserve = NPC_UPKEEP.fuelReserve * profile.fuelMargin * fuelSense(world, vehicle);
  return getResources(world, vehicle).fuel <= fuelToPump(world, vehicle, profile) * reserve;
}

// Low fuel, low supplies or a damaged cab or part needs service. Null when none is needed.
function serviceNeed(world: World, vehicle: Vehicle, profile: NpcProfile): ServiceNeed | null {
  const resources = getResources(world, vehicle);
  const lowFuel = isLowOnFuel(world, vehicle, profile);
  const lowSupplies = resources.supplies <= suppliesCap(vehicle) * NPC_UPKEEP.lowSupplies;
  const damaged = isDamaged(vehicle);
  if (!lowFuel && !lowSupplies && !damaged) return null;
  return { reason: serviceReason(lowFuel, lowSupplies), suppliesOnly: lowSupplies && !lowFuel && !damaged, damaged };
}

function isBroke(world: World, vehicle: Vehicle): boolean {
  return getResources(world, vehicle).money < Math.min(ECONOMY.supplyPrice.fuel, ECONOMY.supplyPrice.supplies);
}

// The fixed survival rule. Null when no service is needed. A wait means the NPC needs service but cannot get it.
function serviceGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity | null {
  const need = serviceNeed(world, vehicle, profile);
  if (!need) return null;
  const broke = isBroke(world, vehicle);
  if (profile.bases.length > 0) return campServiceGoal(world, vehicle, profile, need, broke);
  return townServiceGoal(vehicle, profile, need, broke);
}

function campServiceGoal(world: World, vehicle: Vehicle, profile: NpcProfile, need: ServiceNeed, broke: boolean): NpcActivity {
  if (!broke) return createSiteActivity('resupply', chooseNearestSite(vehicle, profile.bases).id, need.reason);
  // A camp buys no cargo, so a broke raider sells in town first.
  return hasSaleCargo(vehicle) ? saleGoal(world, vehicle, profile) : createActivity('wait', null, null, 'cannot afford upkeep');
}

function townServiceGoal(vehicle: Vehicle, profile: NpcProfile, need: ServiceNeed, broke: boolean): NpcActivity {
  if (need.suppliesOnly) {
    const oasis = chooseNearestSite(vehicle, profile.supplySites);
    if (oasis) return createSiteActivity('resupply', oasis.id, 'low supplies');
  }
  if (broke && !hasSaleCargo(vehicle)) return createActivity('wait', null, null, 'cannot afford upkeep');
  const stop = chooseNearestSite(vehicle, serviceStops(vehicle, profile, need));
  if (!stop) return createActivity('wait', null, null, 'no known service town');
  return createSiteActivity('resupply', stop.id, need.reason);
}

// Only a town repairs. Fuel alone also comes from a fuel stall.
function serviceStops(vehicle: Vehicle, profile: NpcProfile, need: ServiceNeed): string[] {
  return need.damaged ? profile.towns : pumpsOf(vehicle, profile);
}

// The shop that pays most for the carried cargo, of the driver's towns and every stall. Nearest wins a tie.
function saleGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
  const goods = Object.entries(goodsCount(vehicle));
  const shops = [...new Set([...profile.towns, ...STALLS])].map(getKnownSite);
  const getValue = (id: string) => goods.reduce((sum, [good, count]) => sum + (shopDef(id).goods.includes(good) ? count * getTradePrice(world, vehicle, id, good, 'sell') : 0), 0);
  shops.sort((a, b) => getValue(b.id) - getValue(a.id) || dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  return shops[0] ? createSiteActivity('sell', shops[0].id, 'sell carried cargo') : createActivity('wait', null, null, 'no known buyer');
}

const STALLS: readonly string[] = Object.values(SHOPS).filter((s) => s.kind === 'stall').map((s) => s.id);

function tradeGoal(world: World, vehicle: Vehicle): NpcActivity {
  const offers = tradeOffers(world, vehicle);
  if (offers.length === 0) throw new Error(`${vehicle.id} chose to trade with no affordable profitable trade`);
  const plan = sampleWeighted(world, offers);
  return { ...createSiteActivity('trade', plan.source, 'buy profitable cargo'), purchase: { good: plan.good, sellShop: plan.sellShop } };
}

// Salvage or a knocked-out truck in sight comes first, nearest first.
function scavengeGoal(world: World, vehicle: Vehicle): NpcActivity {
  const stock = visibleSalvage(world, vehicle)[0];
  const truck = visibleDowned(world, vehicle)[0];
  if (truck && (!stock || dist(vehicle.pos, truck.pos) < dist(vehicle.pos, stock.pos))) return createActivity('loot', truck.id, { ...truck.pos }, 'loot a knocked-out truck');
  if (stock) return createActivity('scavenge', stock.id, { ...stock.pos }, 'collect visible salvage');
  const sites = salvageSitesAway(vehicle);
  if (sites.length === 0) throw new Error(`${vehicle.id} chose to scavenge with no salvage known`);
  return createSiteActivity('scavenge', sites[randInt(world, 0, sites.length - 1)].id, 'search a known salvage site');
}

function raidGoal(world: World, vehicle: Vehicle): NpcActivity {
  const places = huntingGroundsAway(vehicle);
  if (places.length === 0) throw new Error(`${vehicle.id} chose to raid with no hunting ground away`);
  return createActivity('raid', null, { ...places[randInt(world, 0, places.length - 1)] }, 'look for prey at known hunting grounds');
}

// A patrol drives to a road point near the town it guards.
function patrolGoal(world: World, vehicle: Vehicle): NpcActivity {
  const town = patrolTown(vehicle);
  const points = patrolPoints(town);
  if (points.length === 0) throw new Error(`${vehicle.id} chose to patrol ${town.id} with no road near it`);
  return createActivity('patrol', town.id, { ...points[randInt(world, 0, points.length - 1)] }, 'patrol the roads near town');
}

function travelGoal(world: World, vehicle: Vehicle): NpcActivity {
  const sites = travelSitesAway(vehicle);
  if (sites.length === 0) throw new Error(`${vehicle.id} chose a trip with no known site away`);
  return createSiteActivity('travel', sites[randInt(world, 0, sites.length - 1)].id, 'make a trip to another site');
}

// A random free point anywhere on the map, off road included. Rare bad luck on every try gives a wait this turn.
function exploreGoal(world: World, vehicle: Vehicle): NpcActivity {
  const radius = vehicleStats(world, vehicle).radius;
  for (let i = 0; i < SPAWN.tries; i++) {
    const point = { x: randRange(world, radius, world.size - radius), y: randRange(world, radius, world.size - radius) };
    if (isFree(world, point, radius, vehicle.id)) return createActivity('explore', null, point, 'explore the open map');
  }
  return createActivity('wait', null, null, 'no free point to explore');
}

// A haul loads free cargo at a random known source, then sells it in a town.
function haulGoal(world: World, vehicle: Vehicle): NpcActivity {
  const sites = npcProfile(vehicle).haulSites;
  if (sites.length === 0) throw new Error(`${vehicle.id} chose to haul with no known source`);
  const site = sites[randInt(world, 0, sites.length - 1)];
  const goods = haulGoods(site);
  return { ...createSiteActivity('haul', site, 'load cargo at its source'), load: { good: goods[randInt(world, 0, goods.length - 1)] } };
}

type IdleGoal = (world: World, vehicle: Vehicle) => NpcActivity;

const IDLE_GOALS: Record<Exclude<DecisionOptions['idle'], 'wait'>, IdleGoal> = {
  trade: tradeGoal,
  scavenge: scavengeGoal,
  raid: raidGoal,
  patrol: patrolGoal,
  travel: travelGoal,
  explore: exploreGoal,
  haul: haulGoal,
  escort: joinLeader,
};

function idleGoal(world: World, vehicle: Vehicle): NpcActivity {
  if (keepsWord(world, vehicle, 'idle', null)) return createActivity('wait', null, null, 'keep its word');
  const option = decide(world, vehicle, 'idle', null, null);
  if (option === 'wait') return createActivity('wait', null, null, 'nothing worth doing');
  return IDLE_GOALS[option](world, vehicle);
}

// ---- Popping goals.

// Pops the top goal. An interruption that uncovers the long-term goal fires the resume decision, and `new` drops
// that goal too, so the empty stack rolls idle.
export function finishGoal(world: World, vehicle: Vehicle, reason: string): void {
  const done = popGoal(world, vehicle, reason);
  const goals = vehicle.brain!.goals;
  if (!INTERRUPTIONS.includes(done.kind) || goals.length !== 1 || INTERRUPTIONS.includes(goals[0].kind)) return;
  if (decide(world, vehicle, 'resume', null, null) === 'new') popGoal(world, vehicle, 'chose something new');
}

function heldTow(world: World, vehicle: Vehicle): NpcState | null {
  return towHeldBy(world, vehicle.id);
}

// Why a goal of one kind can no longer run, or null while it can.
type GoalCheck = (world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]) => string | null;

// A fight holds while the driver sees or detects its target, and hunts it for NPC_BEHAVIOR.fightSearchTurns turns
// after it last did.
function fightInvalid(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  if (!target || !isHostile(world, vehicle, target)) return 'lost the target';
  if (fightTargetAt(world, vehicle, target, contacts)) return null;
  if (goal.perceived === undefined) throw new Error(`${vehicle.id} fights ${target.id} with no turn it last perceived it`);
  return world.turn - goal.perceived > NPC_BEHAVIOR.fightSearchTurns ? 'lost the target' : null;
}

// Where the driver perceives its fight target now: the truck in sight, else the center of its contact. Undefined
// when it perceives neither.
function fightTargetAt(world: World, vehicle: Vehicle, target: Vehicle, contacts: Contact[]): Vec | undefined {
  if (canVehicleSee(world, vehicle, target.pos)) return target.pos;
  return contacts.find((c) => c.vehicleId === target.id)?.center;
}

// A fighter re-aims at its target each turn it perceives it. Without sight or contact it drives on to the last point.
function steerFight(world: World, vehicle: Vehicle, goal: NpcActivity, _profile: NpcProfile, contacts: Contact[]): void {
  const at = fightTargetAt(world, vehicle, vehicleById(world, goal.targetId!), contacts);
  if (!at) return;
  goal.destination = { ...at };
  goal.perceived = world.turn;
}

// A fight on the player rolls once whether the driver radios for the cargo first or opens fire unwarned.
function fightGoal(world: World, vehicle: Vehicle, target: Vehicle, reason: string): NpcActivity {
  const goal: NpcActivity = { ...createActivity('fight', target.id, { ...target.pos }, reason), perceived: world.turn };
  if (target.id === world.player.vehicleId) goal.demands = decide(world, vehicle, 'mugging', target.id, null) === 'demand';
  return goal;
}

function fleeInvalid(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  if (visibleHostiles(world, vehicle).length > 0 || contacts.some((c) => c.vehicleId === goal.targetId)) return null;
  return 'no hostile in sight';
}

function investigateInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  return target && isHostile(world, vehicle, target) ? null : 'the contact is gone';
}

// A wreck or a loot pile is an opportunity only while it remains observable. A known site stays one.
function scavengeInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  if (goal.targetId === null || [...REGION.towns, ...REGION.locations].some((site) => site.id === goal.targetId)) return null;
  return world.salvage.some((stock) => stock.id === goal.targetId && canVehicleSee(world, vehicle, stock.pos)) ? null : 'lost sight of the salvage';
}

// A driver learns a stock is empty only once it can reach it.
function lootInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const truck = world.vehicles.find((v) => v.id === goal.targetId);
  return truck ? truckLootInvalid(vehicle, truck) : stockLootInvalid(world, vehicle, goal);
}

function stockLootInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const stock = world.salvage.find((s) => s.id === goal.targetId);
  if (!stock) return 'the loot is gone';
  if (!canReachSalvage(vehicle, stock)) return freeCells(vehicle) === 0 ? 'cargo cannot hold the loot' : null;
  if (!hasSalvage(stock)) return 'nothing left to loot';
  return canTakeAny(world, vehicle, stock) ? null : 'cargo cannot hold the loot';
}

// A knocked-out truck is loot until it wakes. A refit on it keeps going until it ends.
function truckLootInvalid(vehicle: Vehicle, truck: Vehicle): string | null {
  if (!isKnockedOut(truck)) return 'the truck got away';
  if (vehicle.job?.kind === 'refit' || !inTowReach(vehicle, truck)) return null;
  return canTakeFromTruck(vehicle, truck) ? null : 'cargo cannot hold the loot';
}

function towInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  if (heldTow(world, vehicle)) return null;
  const client = world.vehicles.find((v) => v.id === goal.targetId);
  if (!client || stateOf(world, 'turnedDown', vehicle.id, client.id)) return 'the tow is off';
  return strandedAt(world, vehicle, client) ? null : 'the tow is off';
}

// A patch goal holds while its patch state does: the patcher drives over, and the client waits.
function patchInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const other = goal.targetId;
  const held = world.states.some((s) => s.kind === 'patch' && ((s.holder === vehicle.id && s.other === other) || (s.holder === other && s.other === vehicle.id)));
  return held ? null : 'the patch is off';
}

// The goal a patch deal gives an NPC party: the patcher drives to the client, and the client waits parked.
export function patchGoal(world: World, npc: Vehicle, other: Vehicle, patcher: boolean): void {
  const goal = patcher
    ? createActivity('patch', other.id, { ...other.pos }, 'patch a stranded truck')
    : createActivity('patch', other.id, null, 'wait for a patch');
  pushGoal(world, npc, goal);
}

// A meet goal holds while the driver's trade meeting with its target does.
function meetInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  return goal.targetId && stateOf(world, 'trade', vehicle.id, goal.targetId) ? null : 'the trade is off';
}

// The goal a trade meeting gives the driver: it drives up to the other truck and parks beside it.
export function meetGoal(world: World, npc: Vehicle, other: Vehicle): void {
  pushGoal(world, npc, createActivity('meet', other.id, { ...other.pos }, 'pull over to trade'));
}

const GOAL_CHECKS: Partial<Record<NpcActivity['kind'], GoalCheck>> = {
  fight: fightInvalid,
  flee: fleeInvalid,
  investigate: investigateInvalid,
  scavenge: scavengeInvalid,
  loot: lootInvalid,
  tow: towInvalid,
  patch: patchInvalid,
  meet: meetInvalid,
  follow: (world, vehicle, goal) => (follows(world, vehicle, goal.targetId!) ? null : 'no longer follows its leader'),
};

// Goals that park the truck or tie it to another truck. A driver under attack never holds one.
const EXPOSED: readonly NpcActivity['kind'][] = ['repair', 'patch', 'meet', 'tow', 'loot'];

// A hostile in sight shot at the driver, a nearby faction mate or the truck it escorts.
export function underAttack(vehicle: Vehicle): boolean {
  return Object.keys(vehicle.brain!.attackers).length > 0;
}

// A driver under attack drops a held tow and calls off its patch and trade deals. Its exposed goals then pop.
function breakOffDeals(world: World, vehicle: Vehicle): void {
  if (!underAttack(vehicle)) return;
  const tow = heldTow(world, vehicle);
  if (tow) dropTow(world, tow, 'danger');
  const party = (s: NpcState) => s.holder === vehicle.id || s.other === vehicle.id;
  for (const s of world.states.filter((x) => (x.kind === 'patch' || x.kind === 'trade') && party(x))) endState(world, s, 'broken');
}

// Whether a goal still holds, for a driver that has not thought yet this turn. Its stock, tow or target may be
// gone since it last did.
export function goalHolds(world: World, vehicle: Vehicle, goal: NpcActivity): boolean {
  return invalidReason(world, vehicle, goal, usefulContacts(world, vehicle)) === null;
}

function invalidReason(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  if (EXPOSED.includes(goal.kind) && underAttack(vehicle)) return 'under attack';
  const check = GOAL_CHECKS[goal.kind];
  return check ? check(world, vehicle, goal, contacts) : null;
}

// ---- Decision points.

// Refreshes noticed subjects the NPC perceives now. A subject a goal still targets stays noticed. Any other one is
// forgotten NPC_BEHAVIOR.noticeMemory turns after it was last perceived, so it fires again when perceived again.
// A ram chance is noticed only while it lasts, and forgetting it drops the ram choice.
function forget(world: World, vehicle: Vehicle, contacts: Contact[]): void {
  const brain = vehicle.brain!;
  for (const [key, last] of Object.entries(brain.noticed)) {
    const [decision, id] = key.split(':');
    if (perceives(world, vehicle, decision, id, contacts)) brain.noticed[key] = world.turn;
    else if (!heldByGoal(brain, decision, id) && world.turn - last > NPC_BEHAVIOR.noticeMemory) unnotice(brain, key, id);
  }
}

function heldByGoal(brain: NpcBrain, decision: string, id: string): boolean {
  return decision !== 'ramChance' && brain.goals.some((g) => g.targetId === id);
}

function unnotice(brain: NpcBrain, key: string, id: string): void {
  delete brain.noticed[key];
  if (key.startsWith('ramChance:') && brain.ramChoice === id) delete brain.ramChoice;
}

function perceives(world: World, vehicle: Vehicle, decision: string, id: string, contacts: Contact[]): boolean {
  if (!Object.hasOwn(PERCEIVES, decision)) throw new Error(`Unknown noticed decision ${decision}`);
  return PERCEIVES[decision as NoticedDecision](world, vehicle, id, contacts);
}

type NoticedDecision = 'hostileSeen' | 'contactHeard' | 'preySeen' | 'strandedSeen' | 'salvageSeen' | 'ramChance' | 'escortSeen';

type Perception = (world: World, vehicle: Vehicle, id: string, contacts: Contact[]) => boolean;

function seesVehicle(world: World, vehicle: Vehicle, id: string): boolean {
  const other = world.vehicles.find((v) => v.id === id);
  return other !== undefined && canVehicleSee(world, vehicle, other.pos);
}

function hearsVehicle(_world: World, _vehicle: Vehicle, id: string, contacts: Contact[]): boolean {
  return contacts.some((c) => c.vehicleId === id);
}

// A stock, or a knocked-out truck, still in sight.
function seesStock(world: World, vehicle: Vehicle, id: string): boolean {
  const stock = world.salvage.find((s) => s.id === id) ?? world.vehicles.find((v) => v.id === id && isKnockedOut(v));
  return stock !== undefined && canVehicleSee(world, vehicle, stock.pos);
}

function hasRamChance(world: World, vehicle: Vehicle, id: string): boolean {
  return world.vehicles.some((v) => v.id === id) && offersChoice(world, vehicle, 'ramChance', id);
}

// How a driver still perceives the subject of each noticed decision.
const PERCEIVES: Record<NoticedDecision, Perception> = {
  hostileSeen: seesVehicle,
  contactHeard: hearsVehicle,
  preySeen: seesVehicle,
  strandedSeen: seesVehicle,
  salvageSeen: seesStock,
  ramChance: hasRamChance,
  escortSeen: seesVehicle,
};

// Rolls a decision about a subject once while the subject stays noticed. Null when it already is. When only keep
// has weight, the driver keeps without a roll and without noticing, so the decision fires once a choice appears.
// Otherwise it notices the subject, judges a seen truck's danger once for this sighting, then rolls.
function react<D extends NoticedDecision>(world: World, vehicle: Vehicle, decision: D, id: string): DecisionOptions[D] | null {
  const key = `${decision}:${id}`;
  if (key in vehicle.brain!.noticed) return null;
  if (!offersChoice(world, vehicle, decision, id)) return 'keep' as DecisionOptions[D];
  vehicle.brain!.noticed[key] = world.turn;
  const seen = decision === 'hostileSeen' || decision === 'preySeen';
  return decide(world, vehicle, decision, id, seen ? perceiveDanger(world, vehicle, vehicleById(world, id)) : null);
}

// Pushes a danger goal. A tower in danger drops its tow for free.
function interrupt(world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const tow = heldTow(world, vehicle);
  if (tow) {
    dropTow(world, tow, 'danger');
    if (popGoal(world, vehicle, 'dropped the tow').kind !== 'tow') throw new Error(`${vehicle.id} held a tow without a tow goal on top`);
  }
  pushGoal(world, vehicle, goal);
}

function fleeFrom(world: World, vehicle: Vehicle, profile: NpcProfile, threatId: string, threatPos: Vec, reason: string): NpcActivity {
  return createActivity('flee', threatId, fleeDestination(world, vehicle, profile, threatPos), reason);
}

// One roll per new hostile in sight, nearest first. A reaction ends the turn's rolls. Later hostiles fire next turn.
function onHostilesSeen(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  for (const enemy of visibleHostiles(world, vehicle)) {
    const option = react(world, vehicle, 'hostileSeen', enemy.id);
    if (option === null || option === 'keep') continue;
    if (option === 'fight') interrupt(world, vehicle, fightGoal(world, vehicle, enemy, 'fight a hostile in sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, enemy.id, enemy.pos, isWeak(world, vehicle) ? 'damaged and threatened' : 'avoid a costly fight'));
    return;
  }
}

function onContactsHeard(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): void {
  for (const contact of hostileContacts(world, vehicle, contacts)) {
    const option = react(world, vehicle, 'contactHeard', contact.vehicleId);
    if (option === null || option === 'keep') continue;
    if (option === 'investigate') interrupt(world, vehicle, createActivity('investigate', contact.vehicleId, { ...contact.center }, 'heard a hostile beyond sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, contact.vehicleId, contact.center, 'heard a hostile beyond sight'));
    return;
  }
}

// A driver in a fight or on the run ignores contacts beyond sight. It decides on them once the danger goal pops.
function hostileContacts(world: World, vehicle: Vehicle, contacts: Contact[]): Contact[] {
  return inDanger(vehicle) ? [] : contacts.filter((contact) => isHostileContact(world, vehicle, contact));
}

// An attacker stays remembered while it is a hostile in sight.
function pruneAttackers(world: World, vehicle: Vehicle): void {
  const attackers = vehicle.brain!.attackers;
  if (!attackers) throw new Error(`${vehicle.id} has no attackers`);
  for (const id of Object.keys(attackers)) {
    const other = world.vehicles.find((v) => v.id === id);
    if (!other || !isHostile(world, vehicle, other) || !canVehicleSee(world, vehicle, other.pos)) delete attackers[id];
  }
}

// Attackers with shots the driver has not decided on yet, nearest first.
function newAttackers(world: World, vehicle: Vehicle): Vehicle[] {
  const ids = Object.entries(vehicle.brain!.attackers).flatMap(([id, answered]) => (answered ? [] : [id]));
  return ids.map((id) => vehicleById(world, id)).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
}

function isFighting(vehicle: Vehicle, id: string): boolean {
  const top = topGoal(vehicle);
  return top?.kind === 'fight' && top.targetId === id;
}

// One roll per attacker with new shots, hit or miss, nearest first. The attacker also counts as a noticed hostile
// in sight, so it fires no second roll as one. A driver already fighting it keeps on. A reaction ends the turn's
// rolls. Flee runs from the attacker, and fight back turns on it.
function onAttacked(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  const brain = vehicle.brain!;
  for (const shooter of newAttackers(world, vehicle)) {
    brain.attackers[shooter.id] = true;
    brain.noticed[`hostileSeen:${shooter.id}`] = world.turn;
    if (isFighting(vehicle, shooter.id)) continue;
    const option = decide(world, vehicle, 'attacked', shooter.id, perceiveDanger(world, vehicle, shooter));
    if (option === 'keep') continue;
    if (option === 'fightBack') interrupt(world, vehicle, fightGoal(world, vehicle, shooter, 'fight back'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, shooter.id, shooter.pos, 'escape an attacker'));
    return;
  }
}

// One roll per crash grievance whose other truck the driver sees. Retaliating starts a feud with that truck and
// counts it as an attacker, so the attacked roll picks fight back or flight this turn. A grievance against a truck
// already hostile leaves nothing to decide.
function onGrievances(world: World, vehicle: Vehicle): void {
  for (const s of statesHeld(world, vehicle.id).filter((x) => x.kind === 'grievance')) {
    const other = world.vehicles.find((v) => v.id === s.other);
    if (!other) continue;
    if (isHostile(world, vehicle, other)) {
      endState(world, s, 'broken');
      continue;
    }
    if (!canVehicleSee(world, vehicle, other.pos)) continue;
    endState(world, s, 'fulfilled');
    if (decide(world, vehicle, 'crashed', other.id, null) !== 'retaliate') continue;
    startFeuds(world, other, vehicle);
    vehicle.brain!.attackers[other.id] = false;
  }
}

// One roll per turn the driver was hurt, about the hostile that hit it last, while it sees that hostile. A truce
// or a beg pleads with it.
function onParley(world: World, vehicle: Vehicle): void {
  const foe = hurtingFoe(world, vehicle);
  if (!foe) return;
  const option = decide(world, vehicle, 'parley', foe.id, perceiveDanger(world, vehicle, foe));
  if (option !== 'keep') plead(world, vehicle, foe, option === 'truce' ? 'truce' : 'mercy');
}

// The hostile in sight that hit the driver last, when the driver took damage last turn.
function hurtingFoe(world: World, vehicle: Vehicle): Vehicle | null {
  if (vehicle.brain!.hurt <= 0) return null;
  const foe = world.vehicles.find((v) => v.id === vehicle.lastHitBy);
  return foe && isHostile(world, vehicle, foe) && canVehicleSee(world, vehicle, foe.pos) ? foe : null;
}

// A driver that refuses a threat starts a feud with the one who made it, then fights it or runs from it.
export function defyThreat(world: World, vehicle: Vehicle, threatener: Vehicle, answer: Exclude<DecisionOptions['threatened'], 'comply'>): void {
  startFeuds(world, threatener, vehicle);
  vehicle.brain!.noticed[`hostileSeen:${threatener.id}`] = world.turn;
  if (answer === 'fightBack') interrupt(world, vehicle, fightGoal(world, vehicle, threatener, 'refuse a threat'));
  else interrupt(world, vehicle, fleeFrom(world, vehicle, npcProfile(vehicle), threatener.id, threatener.pos, 'escape a threat'));
}

// One roll per new truck in sight the NPC can rob, nearest first. The sighting's perceived danger weighs the roll.
// Rob starts a feud with the target and fights it. The feud makes the target a hostile in sight, so it is noticed
// as one and fires no second roll.
function onPreySeen(world: World, vehicle: Vehicle): void {
  const prey = world.vehicles
    .filter((other) => !(`preySeen:${other.id}` in vehicle.brain!.noticed) && canRob(world, vehicle, other))
    .sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  for (const target of prey) {
    if (react(world, vehicle, 'preySeen', target.id) !== 'rob') continue;
    addState(world, 'feud', vehicle.id, target.id, { kind: 'feud', robbery: true });
    vehicle.brain!.noticed[`hostileSeen:${target.id}`] = world.turn;
    world.events.push({ t: 'hostile', vehicle: vehicle.id, against: target.id });
    callLawmen(world, vehicle, target);
    interrupt(world, vehicle, fightGoal(world, vehicle, target, 'rob cargo'));
    return;
  }
}

// One roll per stranded truck the driver could tow, nearest first. A driver in a fight or on the run never starts
// a tow. It decides once the danger goal pops. A driver under attack starts none either. A player in combat gets
// no new tow until the fight ends.
function onStrandedSeen(world: World, vehicle: Vehicle): void {
  if (inDanger(vehicle) || underAttack(vehicle)) return;
  const clients = world.vehicles
    .filter((client) => client.id !== world.player.vehicleId || !inCombat(world, client))
    .map((client) => ({ client, at: strandedAt(world, vehicle, client) }))
    .filter((c): c is { client: Vehicle; at: Vec } => c.at !== null)
    .sort((a, b) => dist(vehicle.pos, a.at) - dist(vehicle.pos, b.at));
  const chosen = clients.find((c) => react(world, vehicle, 'strandedSeen', c.client.id) === 'tow');
  if (chosen) startTow(world, vehicle, chosen.client, chosen.at);
}

// One roll per wreck or pile in sight while the driver travels to a long-term goal, nearest first. Sites are goals
// of their own. Loot pushes a loot goal, and popping it fires the resume roll. A driver under attack loots nothing.
function onSalvageSeen(world: World, vehicle: Vehicle): void {
  const top = topGoal(vehicle);
  if (underAttack(vehicle) || !top || top.phase !== 'travel' || INTERRUPTIONS.includes(top.kind)) return;
  const stocks = visibleSalvage(world, vehicle).filter((stock) => !isSiteStock(stock));
  const passed = [...stocks, ...visibleDowned(world, vehicle)].filter((s) => s.id !== top.targetId).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const loot = passed.find((s) => react(world, vehicle, 'salvageSeen', s.id) === 'loot');
  if (loot) pushGoal(world, vehicle, createActivity('loot', loot.id, { ...loot.pos }, 'loot salvage on the way'));
}

// One roll per free merc in sight, nearest first, while the driver is out of danger. Hire asks the merc, who takes
// the job or declines. Either way the driver has decided on that merc while it stays in sight.
function onEscortSeen(world: World, vehicle: Vehicle): void {
  if (inDanger(vehicle)) return;
  const merc = mercsInSight(world, vehicle).find((m) => react(world, vehicle, 'escortSeen', m.id) === 'hire');
  if (merc) offerEscort(world, vehicle, merc);
}

// One roll per ram chance on the fight target on top. The choice holds while the chance lasts, and the fight
// planner rams only while the target stays within reach. A driver that keeps fights from its range.
function onRamChance(world: World, vehicle: Vehicle): void {
  const brain = vehicle.brain!;
  const target = fightTarget(vehicle);
  if (brain.ramChoice !== target) delete brain.ramChoice;
  if (target !== null && react(world, vehicle, 'ramChance', target) === 'ram') brain.ramChoice = target;
}

function inDanger(vehicle: Vehicle): boolean {
  const top = topGoal(vehicle)?.kind;
  return top === 'fight' || top === 'flee';
}

function fightTarget(vehicle: Vehicle): string | null {
  const top = topGoal(vehicle);
  return top?.kind === 'fight' ? top.targetId : null;
}

// A driver the player turned down that picks tow again is over it: its turnedDown state ends, so the tow goal holds.
// The client counts as noticed prey, so a tower that set out for a beacon does not roll to rob it on arrival.
// The driver claims the job, so no other driver answers while it is on its way.
export function startTow(world: World, vehicle: Vehicle, client: Vehicle, at: Vec): void {
  const turnedDown = stateOf(world, 'turnedDown', vehicle.id, client.id);
  if (turnedDown) endState(world, turnedDown, 'fulfilled');
  vehicle.brain!.noticed[`preySeen:${client.id}`] = world.turn;
  addState(world, 'answering', vehicle.id, client.id, { kind: 'none' });
  pushGoal(world, vehicle, createActivity('tow', client.id, { ...at }, 'help a stranded truck'));
}

// A flee keeps running from where its threat is now. An investigation keeps the destination it started with.
function steer(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): void {
  const top = topGoal(vehicle);
  if (top) STEERS[top.kind]?.(world, vehicle, top, profile, contacts);
}

type Steer = (world: World, vehicle: Vehicle, goal: NpcActivity, profile: NpcProfile, contacts: Contact[]) => void;

const STEERS: Partial<Record<NpcActivity['kind'], Steer>> = {
  fight: steerFight,
  flee: (world, vehicle, goal, profile, contacts) => steerFlee(world, vehicle, profile, contacts, goal),
  tow: (world, vehicle, goal) => { if (!heldTow(world, vehicle)) steerToStranded(world, vehicle, goal); },
  meet: (world, _vehicle, goal) => steerToMeet(world, goal),
  follow: steerFollow,
};

// A driver on its way to trade re-aims at the other truck every turn. The two keep in touch on the radio, so it
// knows where the other truck is without sight.
function steerToMeet(world: World, goal: NpcActivity): void {
  goal.destination = { ...vehicleById(world, goal.targetId!).pos };
}

// A tower on its way re-aims every turn: at the truck once it sees it, else at the newest beacon circle. A stale
// point can leave it parked out of tow reach, since the player may crawl and a beacon circle is off by its radius.
function steerToStranded(world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const at = strandedAt(world, vehicle, vehicleById(world, goal.targetId!));
  if (!at) throw new Error(`${vehicle.id} heads for a tow with no stranded client perceived`);
  goal.destination = { ...at };
}

function steerFlee(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[], goal: NpcActivity): void {
  const threat = fleeThreat(world, vehicle, contacts, goal);
  if (!threat) throw new Error(`${vehicle.id} flees with no threat perceived`);
  goal.destination = fleeDestination(world, vehicle, profile, threat);
}

// The fled target where the NPC sees it, else the nearest hostile in sight, else the target's contact circle.
function fleeThreat(world: World, vehicle: Vehicle, contacts: Contact[], goal: NpcActivity): Vec | undefined {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  if (target && canVehicleSee(world, vehicle, target.pos)) return target.pos;
  return visibleHostiles(world, vehicle)[0]?.pos ?? contacts.find((c) => c.vehicleId === goal.targetId)?.center;
}

// The NPC's activity this turn. Invalid goals pop, the survival rule and the decision points push, and an empty
// stack sells or rolls idle. A wait is returned for this turn without entering the stack.
export function thinkNpc(world: World, vehicle: Vehicle): NpcActivity {
  const brain = vehicle.brain;
  if (!brain) throw new Error(`${vehicle.id} has no NPC brain`);
  if (!brain.noticed) throw new Error(`${vehicle.id} has no noticed list`);
  const profile = npcProfile(vehicle);
  const contacts = usefulContacts(world, vehicle);
  forget(world, vehicle, contacts);
  pruneAttackers(world, vehicle);
  breakOffDeals(world, vehicle);
  dropInvalidGoals(world, vehicle, contacts);
  if (isDefeated(vehicle)) return retreatHome(world, vehicle);
  const hold = applyFixedRules(world, vehicle, profile);
  onGrievances(world, vehicle);
  onParley(world, vehicle);
  // A truce ends hostility, so goals that held only against the truce partner end here.
  dropInvalidGoals(world, vehicle, contacts);
  onAttacked(world, vehicle, profile);
  onHostilesSeen(world, vehicle, profile);
  onContactsHeard(world, vehicle, profile, contacts);
  onPreySeen(world, vehicle);
  onStrandedSeen(world, vehicle);
  onSalvageSeen(world, vehicle);
  onEscortSeen(world, vehicle);
  onRamChance(world, vehicle);
  steer(world, vehicle, profile, contacts);
  return currentActivity(world, vehicle, profile, hold);
}

// A defeated driver makes no decisions. It heads home, or waits for a tower on its way.
function retreatHome(world: World, vehicle: Vehicle): NpcActivity {
  if (topGoal(vehicle)?.kind !== 'retreat') {
    const home = npcHomeSite(vehicle);
    if (!home) throw new Error(`${vehicle.id} knows no home to retreat to`);
    pushGoal(world, vehicle, createSiteActivity('retreat', home.id, 'retreat home after a defeat'));
  }
  if (awaitsTower(world, vehicle)) return createActivity('wait', null, null, 'wait for a tow');
  return topGoal(vehicle)!;
}

function dropInvalidGoals(world: World, vehicle: Vehicle, contacts: Contact[]): void {
  for (let top = topGoal(vehicle); top; top = topGoal(vehicle)) {
    const reason = invalidReason(world, vehicle, top, contacts);
    if (!reason) break;
    finishGoal(world, vehicle, reason);
  }
}

// A held tow keeps its goal on top. Otherwise, unless a tow goal is on top, the survival rule pushes a repair or
// service. A service wait is returned to hold for this turn.
function applyFixedRules(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity | null {
  if (heldTow(world, vehicle)) {
    keepTowGoal(world, vehicle);
    return null;
  }
  const top = topGoal(vehicle)?.kind;
  if (top === 'tow' || top === 'patch' || top === 'meet') return null;
  return pushService(world, vehicle, profile);
}

function keepTowGoal(world: World, vehicle: Vehicle): void {
  const goal = towGoal(world, vehicle);
  const top = topGoal(vehicle);
  if (top?.kind !== 'tow' || top.targetId !== goal.targetId || top.reason !== goal.reason) pushGoal(world, vehicle, goal);
}

// Urgent supplies come first. Otherwise a field repair with carried parts comes before a service trip.
function pushService(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity | null {
  const service = serviceGoal(world, vehicle, profile);
  const urgent = service !== null && needsUrgentSupplies(world, vehicle, profile);
  if (!urgent && keepRepairing(world, vehicle)) return null;
  return holdOrPush(world, vehicle, service);
}

// A service wait holds for this turn. Any other service goal goes on the stack unless one of its kind is there.
function holdOrPush(world: World, vehicle: Vehicle, service: NpcActivity | null): NpcActivity | null {
  if (service?.kind === 'wait') return service;
  if (service && !vehicle.brain!.goals.some((g) => g.kind === service.kind)) pushGoal(world, vehicle, service);
  return null;
}

// Low supplies, or a low tank that still has fuel to reach service.
function needsUrgentSupplies(world: World, vehicle: Vehicle, profile: NpcProfile): boolean {
  const resources = getResources(world, vehicle);
  if (resources.supplies <= suppliesCap(vehicle) * NPC_UPKEEP.lowSupplies) return true;
  return resources.fuel > 0 && isLowOnFuel(world, vehicle, profile);
}

// A repair goal in the stack holds, in place once the tank is empty. A new one starts at the recover condition,
// but not under attack or while a danger goal is on top. True while the driver repairs.
function keepRepairing(world: World, vehicle: Vehicle): boolean {
  const current = goalsOf(vehicle).find((g) => g.kind === 'repair');
  if (current) {
    continueNpcRepair(world, vehicle, current);
    return true;
  }
  if (inDanger(vehicle) || underAttack(vehicle)) return false;
  const repair = chooseNpcRepair(world, vehicle, NPC_BEHAVIOR.recoverCondition);
  if (repair) pushGoal(world, vehicle, repair);
  return repair !== null;
}

// A held wait wins unless an interruption is on top. Then the top goal runs, or the empty stack sells or rolls idle.
// A stranded driver with a tower on its way waits for it outside danger, since crawling off would leave the tower
// chasing it.
function currentActivity(world: World, vehicle: Vehicle, profile: NpcProfile, hold: NpcActivity | null): NpcActivity {
  const top = topGoal(vehicle);
  if (awaitsTower(world, vehicle)) return createActivity('wait', null, null, 'wait for a tow');
  if (hold && (!top || !INTERRUPTIONS.includes(top.kind))) return hold;
  return top ?? nextGoal(world, vehicle, profile);
}

function awaitsTower(world: World, vehicle: Vehicle): boolean {
  return !inDanger(vehicle) && world.states.some((s) => s.kind === 'answering' && s.other === vehicle.id);
}

function nextGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
  const next = hasSaleCargo(vehicle) ? saleGoal(world, vehicle, profile) : idleGoal(world, vehicle);
  // An escort places its own follow goal.
  if (next.kind !== 'wait' && topGoal(vehicle) !== next) pushGoal(world, vehicle, next);
  return next;
}

// Sums the part damage each NPC took this turn from shots, guard shots and collisions into brain.hurt. It runs
// last in the turn, before events clear.
export function noteHurt(world: World): void {
  const hurt = new Map<string, number>();
  for (const e of world.events) addEventHurt(hurt, e);
  for (const v of world.vehicles) if (v.brain) v.brain.hurt = hurt.get(v.id) ?? 0;
}

function addEventHurt(hurt: Map<string, number>, e: GameEvent): void {
  if (e.t === 'shot' || e.t === 'guardShot') for (const round of e.rounds) addHurt(hurt, e.target, round.hits);
  else if (e.t === 'collision') {
    addHurt(hurt, e.a, e.hitsA);
    addHurt(hurt, e.b, e.hitsB);
  }
}

function addHurt(hurt: Map<string, number>, id: string, hits: PartHit[]): void {
  hurt.set(id, (hurt.get(id) ?? 0) + hits.reduce((sum, hit) => sum + hit.damage, 0));
}

// A repair spot is driven to directly. Once there, the driver brakes.
export function getActivityDestination(world: World, vehicle: Vehicle, activity: NpcActivity): Vec | null {
  if (!activity.destination) return null;
  if (activity.kind === 'repair') return repairsHere(vehicle, activity) ? null : activity.destination;
  if (['fight', 'flee', 'raid', 'investigate', 'patrol', 'explore', 'follow'].includes(activity.kind)) return activity.destination;
  return siteStop(world, vehicle, activity, activity.destination);
}

// Where a driver stops for a site, a stock or a truck it tows: on a site pad, or just outside the radius.
function siteStop(world: World, vehicle: Vehicle, activity: NpcActivity, destination: Vec): Vec {
  const out = vehicleStats(world, vehicle).radius + RULES.arriveRadius;
  const site = [...REGION.towns, ...REGION.locations].find((entry) => entry.id === activity.targetId);
  if (site) return parkedOn(vehicle, site) ? { ...vehicle.pos } : siteSpot(world, vehicle, site, out, activity.kind === 'tow' ? TOW.gap / 2 : 0);
  const radius = stockRadius(world, activity) ?? towedRadius(world, activity);
  if (radius === undefined) throw new Error(`Missing activity destination ${activity.targetId}`);
  // A stock or a towed truck is met on the side the vehicle comes from.
  const angle = Math.atan2(vehicle.pos.y - destination.y, vehicle.pos.x - destination.x);
  return { x: destination.x + Math.cos(angle) * (radius + out), y: destination.y + Math.sin(angle) * (radius + out) };
}

// A driver parked on a pad of the site already uses it. Its own spot may lie under a truck parked there since,
// like the truck it just towed in.
function parkedOn(vehicle: Vehicle, site: Site): boolean {
  return vehicle.speed <= RULES.parkedSpeed && canUseSite(vehicle.pos, site);
}

// Each driver keeps its own spot across the pad nearest it, so drivers bound for one site do not all stop on one
// point and queue for it. `out` keeps the vehicle clear of the pad's side edges. `inward` moves the spot toward
// the gate, so a tower stops far enough in for the truck it trails to stand on the pad too.
function siteSpot(world: World, vehicle: Vehicle, site: ReturnType<typeof getKnownSite>, out: number, inward: number): Vec {
  const spot = hashRandom(world.seed, ...charCodes(vehicle.id), ...charCodes(site.id));
  const pad = nearestPad(site, vehicle.pos);
  const angle = Math.atan2(pad.y - site.pos.y, pad.x - site.pos.x);
  const side = (REGION.sites.pad.width / 2 - out) * (2 * spot - 1);
  return { x: pad.x - Math.sin(angle) * side - Math.cos(angle) * inward, y: pad.y + Math.cos(angle) * side - Math.sin(angle) * inward };
}

function charCodes(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

function stockRadius(world: World, activity: NpcActivity): number | undefined {
  if (activity.kind !== 'scavenge' && activity.kind !== 'loot') return undefined;
  return world.salvage.find((entry) => entry.id === activity.targetId)?.radius;
}

// A tower, a patcher, a trader or a looter drives up to the other truck, and parks beside it like beside a stock.
function towedRadius(world: World, activity: NpcActivity): number | undefined {
  if (!['tow', 'patch', 'meet', 'loot'].includes(activity.kind)) return undefined;
  const towed = world.vehicles.find((entry) => entry.id === activity.targetId);
  return towed && chassisDef(towed.chassisId).radius;
}

// Each goal kind's work once the NPC is parked. Kinds without work only drive.
type Resolver = (world: World, vehicle: Vehicle, activity: NpcActivity) => void;

function resolveTow(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const ended = runTow(world, vehicle, activity);
  if (ended) finishGoal(world, vehicle, ended);
}

// Looting searches the robbed stock like any salvage, or strips a knocked-out truck.
function resolveSearch(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const truck = world.vehicles.find((v) => v.id === activity.targetId);
  if (truck) { resolveTruckLoot(world, vehicle, activity, truck); return; }
  const stock = world.salvage.find((entry) => entry.id === activity.targetId);
  if (!stock) { finishGoal(world, vehicle, 'salvage no longer available'); return; }
  // A search already runs at this stock: keep parked and wait for it to finish.
  if (isSearching(vehicle, stock)) { activity.phase = 'act'; return; }
  if (!canReachSalvage(vehicle, stock)) return;
  activity.phase = 'act';
  searchStock(world, vehicle, stock);
}

function resolveTruckLoot(world: World, vehicle: Vehicle, activity: NpcActivity, truck: Vehicle): void {
  if (!canLootTruck(vehicle, truck)) return;
  activity.phase = 'act';
  const ended = lootTruckTurn(world, vehicle, truck);
  if (ended) finishGoal(world, vehicle, ended);
}

function isSearching(vehicle: Vehicle, stock: SalvageStock): boolean {
  return vehicle.job?.kind === 'search' && vehicle.job.stockId === stock.id;
}

function searchStock(world: World, vehicle: Vehicle, stock: SalvageStock): void {
  if (!canTakeAny(world, vehicle, stock)) {
    finishGoal(world, vehicle, !hasSalvage(stock) ? 'salvage exhausted' : 'cargo cannot hold salvage');
    return;
  }
  if (!vehicle.job && !inCombat(world, vehicle)) beginSearch(world, vehicle, stock.id);
}

// The goal reach rule: within twice the stop radius of the destination.
export function withinReach(vehicle: Vehicle, activity: NpcActivity): boolean {
  return activity.destination !== null && dist(vehicle.pos, activity.destination) <= RULES.arriveRadius * 2;
}

// A point goal ends within reach, or when its move order arrived this turn. A move arrives at the closest point the
// route reaches, so a point no truck can reach, like one another truck covers, still ends the goal.
function reachedDestination(world: World, vehicle: Vehicle, activity: NpcActivity): boolean {
  return withinReach(vehicle, activity) || world.events.some((e) => e.t === 'arrived' && e.vehicle === vehicle.id);
}

function resolveRaid(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, 'reached hunting ground');
}

// A flee ends parked on its point: a safe spot, or the map edge. The driver keeps the threat noticed while it
// still perceives it, so it does not flee again from the same truck.
function resolveFlee(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, 'nowhere farther to run');
}

function resolveInvestigate(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, 'found nothing at the contact');
}

// The site of a site goal once the NPC can use it, which starts the act phase. Null while it cannot.
function reachSite(vehicle: Vehicle, activity: NpcActivity): ReturnType<typeof getKnownSite> | null {
  const site = getKnownSite(activity.targetId!);
  if (!canUseSite(vehicle.pos, site)) return null;
  activity.phase = 'act';
  return site;
}

// A driver remembers the last town it did business in, and tells its prices on the radio.
function noteTown(vehicle: Vehicle, siteId: string): void {
  if (REGION.towns.some((t) => t.id === siteId)) vehicle.brain!.lastTown = siteId;
}

function resolveResupply(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  noteTown(vehicle, site.id);
  serviceAt(world, vehicle, site);
  finishGoal(world, vehicle, 'finished service');
}

// An oasis fills supplies, a camp serves raiders, a stall sells what it stocks and a town garage serves in full.
function serviceAt(world: World, vehicle: Vehicle, site: Site): void {
  const kind = 'kind' in site ? site.kind : null;
  if (kind === 'oasis') getResources(world, vehicle).supplies = suppliesCap(vehicle);
  else if (kind === 'camp') serviceAtCamp(world, vehicle, site.id);
  else if (shopDef(site.id).kind === 'stall') serviceAtStall(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  else serviceVehicle(world, vehicle, site.id, NPC_UPKEEP.repairParts);
}

function resolveSell(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  sellVehicleCargo(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  noteTown(vehicle, site.id);
  finishGoal(world, vehicle, 'sold cargo');
}

// Buys what the wallet above the upkeep reserve and the free cells allow, then delivers it as the long-term goal.
function resolveTrade(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  if (!activity.purchase) throw new Error('Trade activity missing purchase');
  noteTown(vehicle, site.id);
  const budget = getResources(world, vehicle).money - getUpkeepReserve(vehicle);
  const count = affordableBuyCount(world, vehicle, site.id, activity.purchase.good, freeCells(vehicle), budget);
  if (count > 0) {
    tradeGoods(world, vehicle, site.id, activity.purchase.good, count, 'buy');
    if (vehicle.brain!.goals[0] !== activity) throw new Error(`${vehicle.id} trades above its long-term goal`);
    replaceBase(world, vehicle, createSiteActivity('sell', activity.purchase.sellShop, 'deliver purchased cargo'));
    return;
  }
  finishGoal(world, vehicle, 'cannot afford trade cargo');
}

// Loads free cargo up to the free cells, then delivers it as the long-term goal.
function resolveHaul(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  if (!activity.load) throw new Error('Haul activity missing load');
  if (addGoods(world, vehicle, activity.load.good, freeCells(vehicle)) === 0) {
    finishGoal(world, vehicle, 'cargo cannot hold the load');
    return;
  }
  if (vehicle.brain!.goals[0] !== activity) throw new Error(`${vehicle.id} hauls above its long-term goal`);
  replaceBase(world, vehicle, saleGoal(world, vehicle, npcProfile(vehicle)));
}

function resolveTravel(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachSite(vehicle, activity)) finishGoal(world, vehicle, 'arrived');
}

// A goal that only drives to a point ends parked on it.
function arrivalResolver(reason: string): Resolver {
  return (world, vehicle, activity) => {
    if (reachedDestination(world, vehicle, activity)) finishGoal(world, vehicle, reason);
  };
}

function resolveRetreat(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (!reachSite(vehicle, activity)) return;
  refitAtHome(world, vehicle);
  finishGoal(world, vehicle, 'refitted at home');
}

function resolveRepair(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (resolveNpcRepair(world, vehicle, activity)) finishGoal(world, vehicle, 'finished field repairs');
}

const RESOLVERS: Partial<Record<NpcActivity['kind'], Resolver>> = {
  tow: resolveTow,
  repair: resolveRepair,
  retreat: resolveRetreat,
  scavenge: resolveSearch,
  loot: resolveSearch,
  raid: resolveRaid,
  investigate: resolveInvestigate,
  flee: resolveFlee,
  resupply: resolveResupply,
  sell: resolveSell,
  trade: resolveTrade,
  haul: resolveHaul,
  travel: resolveTravel,
  patrol: arrivalResolver('patrolled the road'),
  explore: arrivalResolver('explored the spot'),
};

function resolveActivity(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  RESOLVERS[activity.kind]?.(world, vehicle, activity);
}

// A driver works on its goal when alive, parked and off any tow rope.
function canAct(world: World, vehicle: Vehicle): boolean {
  if (corePart(vehicle, 'cab').hp <= 0 || getResources(world, vehicle).health <= 0) return false;
  return vehicle.speed <= RULES.parkedSpeed && !isOnRope(world, vehicle.id);
}

export function resolveNpcActivities(world: World): void {
  for (const vehicle of world.vehicles) {
    if (!vehicle.brain || !canAct(world, vehicle)) continue;
    const top = topGoal(vehicle);
    if (top) resolveActivity(world, vehicle, top);
  }
}

// The victim's truck while it lies knocked out, else its wreck.
function robbedLoot(w: World, victimId: string): Vehicle | SalvageStock | undefined {
  const victim = w.vehicles.find((v) => v.id === victimId);
  if (victim && isKnockedOut(victim)) return victim;
  return w.salvage.find((s) => s.id === wreckStockId(victimId));
}

// Sends a robber that won to loot its victim: a knocked-out truck or an NPC's wreck. A robber that died in the same
// fight loots nothing.
export function lootRobbed(w: World, robberId: string, victimId: string): void {
  const robber = w.vehicles.find((v) => v.id === robberId);
  if (!robber) return;
  const stock = robbedLoot(w, victimId);
  if (!stock) throw new Error(`${robberId} won a robbery, but ${victimId} left no stock`);
  pushGoal(w, robber, { kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason: 'loot the robbed truck' });
}
