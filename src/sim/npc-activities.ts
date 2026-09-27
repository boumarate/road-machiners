// NPC goals: the goal stack, the fixed survival rule, the decision points that push and pop goals, and each goal's
// work. See src/sim/npc-decisions.ts for the weighted rolls.

import { chassisDef } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP, type DecisionOptions } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import type { PartHit } from './armor';
import { isHostile } from './combat';
import { getTradePrice, sellVehicleCargo, serviceAtCamp, serviceVehicle, tradeGoods } from './economy';
import { isJunk, maxHp } from './wear';
import { corePart, freeCells, goodsCount, mountedParts } from './grid';
import { cancelJob } from './jobs';
import {
  bestTrade, canRob, decide, offersChoice, perceiveDanger, getKnownSite, getUpkeepReserve,
  huntingGroundsAway, isHostileContact, isWeak, npcProfile, salvageSitesAway, usefulContacts, visibleHostiles, visibleSalvage, type NpcProfile,
} from './npc-decisions';
import { chooseNpcRepair, continueNpcRepair, repairsHere, resolveNpcRepair } from './npc-repair';
import { getResources } from './resources';
import { hashRandom, randInt } from './rng';
import { canReachSalvage, hasSalvage, knockoutStockId, wreckStockId } from './salvage';
import { beginSearch } from './search';
import { vehicleById } from './damage';
import { addState, endState, stateOf } from './states';
import { vehicleStats } from './stats';
import type { Contact, GameEvent, Job, NpcActivity, NpcBrain, NpcState, SalvageStock, Vehicle, World } from './types';
import { canUseSite, isWalled, siteGates } from './sites';
import { clamp, dist, type Vec } from './vec';
import { canVehicleSee } from './vision';
import { dropTow, playerTow, runTow, strandedPlayerAt, towGoal } from './tow';

// ---- The goal stack. The top goal drives the NPC. A long-term goal sits at the bottom, and interruptions go on top
// of it. A new goal replaces any goal of its kind, so the stack never holds two goals of one kind. Every change logs
// an `activity` event.

// Goals that interrupt a long-term goal. Popping one that uncovers the long-term goal fires the resume decision.
export const INTERRUPTIONS: readonly NpcActivity['kind'][] = ['fight', 'flee', 'investigate', 'resupply', 'tow', 'loot', 'repair', 'patch'];

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
  return searchBelongs(job, topGoal(v));
}

function searchBelongs(job: Job, goal: NpcActivity | null): boolean {
  return job.kind === 'search' && (goal?.kind === 'scavenge' || goal?.kind === 'loot') && goal.targetId === job.stockId;
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

// Where an NPC flees to, away from a threat at `threatPos`: the nearest known town or own camp whose direction
// from the vehicle is more than 90 degrees off the threat's, or straight away from the threat if no such site is
// known.
function fleeDestination(world: World, vehicle: Vehicle, profile: NpcProfile, threatPos: Vec): Vec {
  const safe = [...profile.towns, ...profile.bases].map(getKnownSite).filter((site) => pointsAway(vehicle.pos, site.pos, threatPos));
  safe.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const away = { x: vehicle.pos.x + (vehicle.pos.x - threatPos.x), y: vehicle.pos.y + (vehicle.pos.y - threatPos.y) };
  const destination = safe[0]?.pos ?? away;
  return { x: clamp(destination.x, 1, world.size - 1), y: clamp(destination.y, 1, world.size - 1) };
}

function pointsAway(from: Vec, to: Vec, threat: Vec): boolean {
  return (to.x - from.x) * (threat.x - from.x) + (to.y - from.y) * (threat.y - from.y) < 0;
}

// ---- Goal builders.

// Why an NPC needs service, and whether low supplies are its only need.
type ServiceNeed = { reason: string; suppliesOnly: boolean };

// Junk parts do not count, since no service rebuilds them.
function isDamaged(vehicle: Vehicle): boolean {
  return mountedParts(vehicle).some((part) => !isJunk(part) && part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition);
}

function serviceReason(lowFuel: boolean, lowSupplies: boolean): string {
  return lowFuel ? 'low fuel' : lowSupplies ? 'low supplies' : 'needs repairs';
}

// Low fuel, low supplies or a damaged cab or part needs service. Null when none is needed.
function serviceNeed(world: World, vehicle: Vehicle): ServiceNeed | null {
  const resources = getResources(world, vehicle);
  const lowFuel = resources.fuel <= chassisDef(vehicle.chassisId).fuelCap * NPC_UPKEEP.lowFuel;
  const lowSupplies = resources.supplies <= RULES.suppliesCap * NPC_UPKEEP.lowSupplies;
  const damaged = isDamaged(vehicle);
  if (!lowFuel && !lowSupplies && !damaged) return null;
  return { reason: serviceReason(lowFuel, lowSupplies), suppliesOnly: lowSupplies && !lowFuel && !damaged };
}

function isBroke(world: World, vehicle: Vehicle): boolean {
  return getResources(world, vehicle).money < Math.min(ECONOMY.supplyPrice.fuel, ECONOMY.supplyPrice.supplies, ECONOMY.partRepairPerHp);
}

// The fixed survival rule. Null when no service is needed. A wait means the NPC needs service but cannot get it.
function serviceGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity | null {
  const need = serviceNeed(world, vehicle);
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
  const town = chooseNearestSite(vehicle, profile.towns);
  if (!town) return createActivity('wait', null, null, 'no known service town');
  return createSiteActivity('resupply', town.id, need.reason);
}

function saleGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
  const goods = goodsCount(vehicle);
  const towns = profile.towns.map(getKnownSite);
  const getValue = (id: string) => Object.entries(goods).reduce((sum, [good, count]) => sum + count * getTradePrice(world, vehicle, id, good, 'sell'), 0);
  towns.sort((a, b) => getValue(b.id) - getValue(a.id) || dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  return towns[0] ? createSiteActivity('sell', towns[0].id, 'sell carried cargo') : createActivity('wait', null, null, 'no known buyer');
}

function tradeGoal(world: World, vehicle: Vehicle): NpcActivity {
  const plan = bestTrade(world, vehicle);
  if (!plan) throw new Error(`${vehicle.id} chose to trade with no affordable profitable trade`);
  return { ...createSiteActivity('trade', plan.source, 'buy profitable cargo'), purchase: { good: plan.good, sellTown: plan.sellTown } };
}

function scavengeGoal(world: World, vehicle: Vehicle): NpcActivity {
  const visible = visibleSalvage(world, vehicle)[0];
  if (visible) return createActivity('scavenge', visible.id, { ...visible.pos }, 'collect visible salvage');
  const sites = salvageSitesAway(vehicle);
  if (sites.length === 0) throw new Error(`${vehicle.id} chose to scavenge with no salvage known`);
  return createSiteActivity('scavenge', sites[randInt(world, 0, sites.length - 1)].id, 'search a known salvage site');
}

function raidGoal(world: World, vehicle: Vehicle): NpcActivity {
  const places = huntingGroundsAway(vehicle);
  if (places.length === 0) throw new Error(`${vehicle.id} chose to raid with no hunting ground away`);
  return createActivity('raid', null, { ...places[randInt(world, 0, places.length - 1)] }, 'look for prey at known hunting grounds');
}

function idleGoal(world: World, vehicle: Vehicle): NpcActivity {
  const option = decide(world, vehicle, 'idle', null, null);
  if (option === 'trade') return tradeGoal(world, vehicle);
  if (option === 'scavenge') return scavengeGoal(world, vehicle);
  if (option === 'raid') return raidGoal(world, vehicle);
  return createActivity('wait', null, null, 'nothing worth doing');
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
  const tow = playerTow(world);
  return tow?.holder === vehicle.id ? tow : null;
}

// Why a goal of one kind can no longer run, or null while it can.
type GoalCheck = (world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]) => string | null;

function fightInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  return target && canVehicleSee(world, vehicle, target.pos) && isHostile(world, vehicle, target) ? null : 'lost the target';
}

function fleeInvalid(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  if (visibleHostiles(world, vehicle).length > 0 || contacts.some((c) => c.vehicleId === goal.targetId)) return null;
  return 'no hostile in sight';
}

function investigateInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const target = world.vehicles.find((v) => v.id === goal.targetId);
  return target && isHostile(world, vehicle, target) ? null : 'the contact is gone';
}

// A wreck is an opportunity only while it remains observable.
function scavengeInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  if (!goal.targetId?.startsWith('wreck-')) return null;
  return world.salvage.some((stock) => stock.id === goal.targetId && canVehicleSee(world, vehicle, stock.pos)) ? null : 'lost sight of the wreck';
}

function lootInvalid(world: World, vehicle: Vehicle, goal: NpcActivity): string | null {
  const stock = world.salvage.find((s) => s.id === goal.targetId);
  if (!stock) return 'the loot is gone';
  if (!hasSalvage(stock)) return 'nothing left to loot';
  return freeCells(vehicle) === 0 ? 'cargo cannot hold the loot' : null;
}

function towInvalid(world: World, vehicle: Vehicle): string | null {
  if (heldTow(world, vehicle)) return null;
  return strandedPlayerAt(world, vehicle) && !stateOf(world, 'turnedDown', vehicle.id, world.player.vehicleId) ? null : 'the tow is off';
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

const GOAL_CHECKS: Partial<Record<NpcActivity['kind'], GoalCheck>> = {
  fight: fightInvalid,
  flee: fleeInvalid,
  investigate: investigateInvalid,
  scavenge: scavengeInvalid,
  loot: lootInvalid,
  tow: towInvalid,
  patch: patchInvalid,
};

function invalidReason(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
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

type NoticedDecision = 'hostileSeen' | 'contactHeard' | 'preySeen' | 'strandedSeen' | 'ramChance';

type Perception = (world: World, vehicle: Vehicle, id: string, contacts: Contact[]) => boolean;

function seesVehicle(world: World, vehicle: Vehicle, id: string): boolean {
  const other = world.vehicles.find((v) => v.id === id);
  return other !== undefined && canVehicleSee(world, vehicle, other.pos);
}

function hearsVehicle(_world: World, _vehicle: Vehicle, id: string, contacts: Contact[]): boolean {
  return contacts.some((c) => c.vehicleId === id);
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
  ramChance: hasRamChance,
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
    if (option === 'fight') interrupt(world, vehicle, createActivity('fight', enemy.id, { ...enemy.pos }, 'fight a hostile in sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, enemy.id, enemy.pos, isWeak(world, vehicle) ? 'damaged and threatened' : 'avoid a costly fight'));
    return;
  }
}

function onContactsHeard(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): void {
  for (const contact of contacts) {
    if (!isHostileContact(world, vehicle, contact)) continue;
    const option = react(world, vehicle, 'contactHeard', contact.vehicleId);
    if (option === null || option === 'keep') continue;
    if (option === 'investigate') interrupt(world, vehicle, createActivity('investigate', contact.vehicleId, { ...contact.center }, 'heard a hostile beyond sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, contact.vehicleId, contact.center, 'heard a hostile beyond sight'));
    return;
  }
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
    if (option === 'fightBack') interrupt(world, vehicle, createActivity('fight', shooter.id, { ...shooter.pos }, 'fight back'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, shooter.id, shooter.pos, 'escape an attacker'));
    return;
  }
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
    interrupt(world, vehicle, createActivity('fight', target.id, { ...target.pos }, 'rob cargo'));
    return;
  }
}

// A driver in a fight or on the run never starts a tow. It decides once the danger goal pops.
function onStrandedSeen(world: World, vehicle: Vehicle): void {
  const top = topGoal(vehicle)?.kind;
  if (top === 'fight' || top === 'flee') return;
  const at = strandedPlayerAt(world, vehicle);
  if (at && react(world, vehicle, 'strandedSeen', world.player.vehicleId) === 'tow') startTow(world, vehicle, at);
}

// One roll per ram chance on the fight target on top. The choice holds while the chance lasts, and the fight
// planner rams only while the target stays within reach. A driver that keeps fights from its range.
function onRamChance(world: World, vehicle: Vehicle): void {
  const brain = vehicle.brain!;
  const target = fightTarget(vehicle);
  if (brain.ramChoice !== target) delete brain.ramChoice;
  if (target !== null && react(world, vehicle, 'ramChance', target) === 'ram') brain.ramChoice = target;
}

function fightTarget(vehicle: Vehicle): string | null {
  const top = topGoal(vehicle);
  return top?.kind === 'fight' ? top.targetId : null;
}

// A driver the player turned down that picks tow again is over it: its turnedDown state ends, so the tow goal holds.
// The client counts as noticed prey, so a tower that set out for a beacon does not roll to rob it on arrival.
// The driver claims the job, so no other driver answers while it is on its way.
export function startTow(world: World, vehicle: Vehicle, at: Vec): void {
  const me = world.player.vehicleId;
  const turnedDown = stateOf(world, 'turnedDown', vehicle.id, me);
  if (turnedDown) endState(world, turnedDown, 'fulfilled');
  vehicle.brain!.noticed[`preySeen:${me}`] = world.turn;
  addState(world, 'answering', vehicle.id, me, { kind: 'none' });
  pushGoal(world, vehicle, createActivity('tow', me, { ...at }, 'help a stranded truck'));
}

// A flee keeps running from where its threat is now. An investigation keeps the destination it started with.
function steer(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): void {
  const top = topGoal(vehicle);
  if (top?.kind === 'flee') steerFlee(world, vehicle, profile, contacts, top);
  else if (top?.kind === 'tow' && !heldTow(world, vehicle)) steerToStranded(world, vehicle, top);
}

// A tower on its way re-aims every turn: at the truck once it sees it, else at the newest beacon circle. A stale
// point can leave it parked out of tow reach, since the player may crawl and a beacon circle is off by its radius.
function steerToStranded(world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const at = strandedPlayerAt(world, vehicle);
  if (!at) throw new Error(`${vehicle.id} heads for a tow with no stranded player perceived`);
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
  dropInvalidGoals(world, vehicle, contacts);
  const hold = applyFixedRules(world, vehicle, profile);
  onAttacked(world, vehicle, profile);
  onHostilesSeen(world, vehicle, profile);
  onContactsHeard(world, vehicle, profile, contacts);
  onPreySeen(world, vehicle);
  onStrandedSeen(world, vehicle);
  onRamChance(world, vehicle);
  steer(world, vehicle, profile, contacts);
  return currentActivity(world, vehicle, profile, hold);
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
  if (top === 'tow' || top === 'patch') return null;
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
  const urgent = service !== null && needsUrgentSupplies(world, vehicle);
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
function needsUrgentSupplies(world: World, vehicle: Vehicle): boolean {
  const resources = getResources(world, vehicle);
  if (resources.supplies <= RULES.suppliesCap * NPC_UPKEEP.lowSupplies) return true;
  return resources.fuel > 0 && resources.fuel <= chassisDef(vehicle.chassisId).fuelCap * NPC_UPKEEP.lowFuel;
}

// A repair goal in the stack holds, in place once the tank is empty. A new one starts at the recover condition,
// but not while a danger goal is on top. True while the driver repairs.
function keepRepairing(world: World, vehicle: Vehicle): boolean {
  const current = goalsOf(vehicle).find((g) => g.kind === 'repair');
  if (current) {
    continueNpcRepair(world, vehicle, current);
    return true;
  }
  const top = topGoal(vehicle)?.kind;
  if (top === 'fight' || top === 'flee') return false;
  const repair = chooseNpcRepair(world, vehicle, NPC_BEHAVIOR.recoverCondition);
  if (repair) pushGoal(world, vehicle, repair);
  return repair !== null;
}

// A held wait wins unless an interruption is on top. Then the top goal runs, or the empty stack sells or rolls idle.
function currentActivity(world: World, vehicle: Vehicle, profile: NpcProfile, hold: NpcActivity | null): NpcActivity {
  const top = topGoal(vehicle);
  if (hold && (!top || !INTERRUPTIONS.includes(top.kind))) return hold;
  return top ?? nextGoal(world, vehicle, profile);
}

function nextGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity {
  const next = hasSaleCargo(vehicle) ? saleGoal(world, vehicle, profile) : idleGoal(world, vehicle);
  if (next.kind !== 'wait') pushGoal(world, vehicle, next);
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
  if (['fight', 'flee', 'raid', 'investigate'].includes(activity.kind)) return activity.destination;
  return siteStop(world, vehicle, activity, activity.destination);
}

// Where a driver stops for a site, a stock or a truck it tows: just outside its radius.
function siteStop(world: World, vehicle: Vehicle, activity: NpcActivity, destination: Vec): Vec {
  const out = vehicleStats(world, vehicle).radius + RULES.arriveRadius;
  const site = [...REGION.towns, ...REGION.locations].find((entry) => entry.id === activity.targetId);
  if (site) return siteSpot(world, vehicle, site, out);
  const radius = stockRadius(world, activity) ?? towedRadius(world, activity);
  if (radius === undefined) throw new Error(`Missing activity destination ${activity.targetId}`);
  // A stock or a towed truck is met on the side the vehicle comes from.
  const angle = Math.atan2(vehicle.pos.y - destination.y, vehicle.pos.x - destination.x);
  return { x: destination.x + Math.cos(angle) * (radius + out), y: destination.y + Math.sin(angle) * (radius + out) };
}

// Each driver keeps its own spot at each site, so drivers bound for one site do not all stop on one point and
// queue for it. `out` is how far outside the site edge the vehicle stops.
function siteSpot(world: World, vehicle: Vehicle, site: ReturnType<typeof getKnownSite>, out: number): Vec {
  const spot = hashRandom(world.seed, ...charCodes(vehicle.id), ...charCodes(site.id));
  if (!isWalled(site)) {
    // An open site is used from any side, so the spot lies anywhere on its edge.
    const angle = 2 * Math.PI * spot;
    return { x: site.pos.x + Math.cos(angle) * (site.radius + out), y: site.pos.y + Math.sin(angle) * (site.radius + out) };
  }
  // A walled site is used from its gate nearest the vehicle, so the stop lies just outside that gate, shifted
  // along the wall as far as the gate's reach allows.
  const gate = siteGates(site).reduce((a, b) => (dist(vehicle.pos, a) <= dist(vehicle.pos, b) ? a : b));
  const angle = Math.atan2(gate.y - site.pos.y, gate.x - site.pos.x);
  const side = Math.sqrt((REGION.settlement.gateReach - RULES.arriveRadius) ** 2 - out ** 2) * (2 * spot - 1);
  return { x: gate.x + Math.cos(angle) * out - Math.sin(angle) * side, y: gate.y + Math.sin(angle) * out + Math.cos(angle) * side };
}

function charCodes(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

function stockRadius(world: World, activity: NpcActivity): number | undefined {
  if (activity.kind !== 'scavenge' && activity.kind !== 'loot') return undefined;
  return world.salvage.find((entry) => entry.id === activity.targetId)?.radius;
}

// A tower or a patcher drives up to its client, and parks beside it like beside a stock.
function towedRadius(world: World, activity: NpcActivity): number | undefined {
  if (activity.kind !== 'tow' && activity.kind !== 'patch') return undefined;
  const towed = world.vehicles.find((entry) => entry.id === activity.targetId);
  return towed && chassisDef(towed.chassisId).radius;
}

// Each goal kind's work once the NPC is parked. Kinds without work only drive.
type Resolver = (world: World, vehicle: Vehicle, activity: NpcActivity) => void;

function resolveTow(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const ended = runTow(world, vehicle, activity);
  if (ended) finishGoal(world, vehicle, ended);
}

// Looting searches the robbed stock like any salvage.
function resolveSearch(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const stock = world.salvage.find((entry) => entry.id === activity.targetId);
  if (!stock) { finishGoal(world, vehicle, 'salvage no longer available'); return; }
  // A search already runs at this stock: keep parked and wait for it to finish.
  if (isSearching(vehicle, stock)) { activity.phase = 'act'; return; }
  if (!canReachSalvage(vehicle, stock)) return;
  activity.phase = 'act';
  searchStock(world, vehicle, stock);
}

function isSearching(vehicle: Vehicle, stock: SalvageStock): boolean {
  return vehicle.job?.kind === 'search' && vehicle.job.stockId === stock.id;
}

function searchStock(world: World, vehicle: Vehicle, stock: SalvageStock): void {
  if (!hasSalvage(stock) || freeCells(vehicle) === 0) {
    finishGoal(world, vehicle, !hasSalvage(stock) ? 'salvage exhausted' : 'cargo cannot hold salvage');
    return;
  }
  if (!vehicle.job) beginSearch(world, vehicle, stock.id);
}

// The goal reach rule: within twice the stop radius of the destination.
export function reachedDestination(vehicle: Vehicle, activity: NpcActivity): boolean {
  return activity.destination !== null && dist(vehicle.pos, activity.destination) <= RULES.arriveRadius * 2;
}

function resolveRaid(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(vehicle, activity)) finishGoal(world, vehicle, 'reached hunting ground');
}

function resolveInvestigate(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (reachedDestination(vehicle, activity)) finishGoal(world, vehicle, 'found nothing at the contact');
}

// The site of a site goal once the NPC can use it, which starts the act phase. Null while it cannot.
function reachSite(vehicle: Vehicle, activity: NpcActivity): ReturnType<typeof getKnownSite> | null {
  const site = getKnownSite(activity.targetId!);
  if (!canUseSite(vehicle.pos, site)) return null;
  activity.phase = 'act';
  return site;
}

function resolveResupply(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  if ('kind' in site && site.kind === 'oasis') getResources(world, vehicle).supplies = RULES.suppliesCap;
  else if ('kind' in site && site.kind === 'camp') serviceAtCamp(world, vehicle, site.id);
  else serviceVehicle(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  finishGoal(world, vehicle, 'finished service');
}

function resolveSell(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  sellVehicleCargo(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  finishGoal(world, vehicle, 'sold cargo');
}

// Buys what the wallet above the upkeep reserve and the free cells allow, then delivers it as the long-term goal.
function resolveTrade(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  if (!activity.purchase) throw new Error('Trade activity missing purchase');
  const price = getTradePrice(world, vehicle, site.id, activity.purchase.good, 'buy');
  const count = Math.min(freeCells(vehicle), Math.floor((getResources(world, vehicle).money - getUpkeepReserve(vehicle)) / price));
  if (count > 0) {
    tradeGoods(world, vehicle, site.id, activity.purchase.good, count, 'buy');
    if (vehicle.brain!.goals[0] !== activity) throw new Error(`${vehicle.id} trades above its long-term goal`);
    replaceBase(world, vehicle, createSiteActivity('sell', activity.purchase.sellTown, 'deliver purchased cargo'));
    return;
  }
  finishGoal(world, vehicle, 'cannot afford trade cargo');
}

function resolveRepair(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (resolveNpcRepair(world, vehicle, activity)) finishGoal(world, vehicle, 'finished field repairs');
}

const RESOLVERS: Partial<Record<NpcActivity['kind'], Resolver>> = {
  tow: resolveTow,
  repair: resolveRepair,
  scavenge: resolveSearch,
  loot: resolveSearch,
  raid: resolveRaid,
  investigate: resolveInvestigate,
  resupply: resolveResupply,
  sell: resolveSell,
  trade: resolveTrade,
};

function resolveActivity(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  RESOLVERS[activity.kind]?.(world, vehicle, activity);
}

export function resolveNpcActivities(world: World): void {
  for (const vehicle of world.vehicles) {
    if (!vehicle.brain || corePart(vehicle, 'cab').hp <= 0 || getResources(world, vehicle).health <= 0 || vehicle.speed > RULES.parkedSpeed) continue;
    const top = topGoal(vehicle);
    if (top) resolveActivity(world, vehicle, top);
  }
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
