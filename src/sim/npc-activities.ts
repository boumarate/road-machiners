// NPC goals: the fixed survival rule, the decision points that push and pop goals, and each goal's work.
// A stack of goals lives in brain.goals. See src/sim/npc-goals.ts for the stack and src/sim/npc-decisions.ts
// for the weighted rolls.

import { chassisDef } from '../data/chassis';
import { ECONOMY } from '../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP, type DecisionOptions } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import type { PartHit } from './armor';
import { isHostile } from './combat';
import { getTradePrice, sellVehicleCargo, serviceAtCamp, serviceVehicle, tradeGoods } from './economy';
import { corePart, freeCells, goodsCount, mountedParts } from './grid';
import {
  bestTrade, decide, getCabCondition, hasChoice, optionWeights, perceiveDanger, getKnownSite, getUpkeepReserve, huntingGroundsAway, isHostileContact, isWeak,
  salvageSitesAway, trustedContacts, visibleHostiles, visibleSalvage,
} from './npc-decisions';
import { INTERRUPTIONS, popGoal, pushGoal, replaceBase, topGoal } from './npc-goals';
import { npcProfile, type NpcProfile } from './npc-profile';
import { getResources } from './resources';
import { randInt } from './rng';
import { canReachSalvage, hasSalvage } from './salvage';
import { beginSearch } from './search';
import { isRobberyCandidate } from './robbery';
import { vehicleById } from './damage';
import { addState, stateOf } from './states';
import { vehicleStats } from './stats';
import type { Contact, NpcActivity, NpcState, Vehicle, World } from './types';
import { canUseSite, isWalled, siteGates } from './sites';
import { clamp, dist, type Vec } from './vec';
import { canVehicleSee } from './vision';
import { dropTow, playerTow, runTow, strandedPlayerAt, towGoal } from './tow';

function createActivity(kind: NpcActivity['kind'], targetId: string | null, destination: Vec | null, reason: string): NpcActivity {
  return { kind, targetId, destination, reason, phase: destination ? 'travel' : 'act' };
}

function chooseNearestSite(vehicle: Vehicle, ids: string[]) {
  return ids.map(getKnownSite).sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos))[0];
}

function createSiteActivity(kind: NpcActivity['kind'], id: string, reason: string): NpcActivity {
  return createActivity(kind, id, { ...getKnownSite(id).pos }, reason);
}

function hasSaleCargo(vehicle: Vehicle): boolean {
  const mounted = new Set(mountedParts(vehicle).map((part) => part.id));
  return vehicle.items.some((item) => item.kind === 'good' || !mounted.has(item.part.id));
}

// Where an NPC flees to, away from a threat at `threatPos`: the nearest known town or own camp further from the
// threat than the vehicle already is, or straight away from it if no such site is known.
function fleeDestination(world: World, vehicle: Vehicle, profile: NpcProfile, threatPos: Vec): Vec {
  const safe = [...profile.towns, ...profile.bases].map(getKnownSite).filter((site) => dist(site.pos, threatPos) > dist(vehicle.pos, threatPos));
  safe.sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  const away = { x: vehicle.pos.x + (vehicle.pos.x - threatPos.x), y: vehicle.pos.y + (vehicle.pos.y - threatPos.y) };
  const destination = safe[0]?.pos ?? away;
  return { x: clamp(destination.x, 1, world.size - 1), y: clamp(destination.y, 1, world.size - 1) };
}

// ---- Goal builders.

// The fixed survival rule: low fuel, low supplies or a damaged cab or part needs service. Null when none is needed.
// A wait means the NPC needs service but cannot get it.
function serviceGoal(world: World, vehicle: Vehicle, profile: NpcProfile): NpcActivity | null {
  const resources = getResources(world, vehicle);
  const lowFuel = resources.fuel <= chassisDef(vehicle.chassisId).fuelCap * NPC_UPKEEP.lowFuel;
  const lowSupplies = resources.supplies <= RULES.suppliesCap * NPC_UPKEEP.lowSupplies;
  const damaged = getCabCondition(vehicle) <= NPC_BEHAVIOR.fleeCondition || mountedParts(vehicle).some((part) => part.hp === 0);
  if (!lowFuel && !lowSupplies && !damaged) return null;
  const reason = lowFuel ? 'low fuel' : lowSupplies ? 'low supplies' : 'needs repairs';
  const broke = resources.money < Math.min(ECONOMY.supplyPrice.fuel, ECONOMY.supplyPrice.supplies, ECONOMY.partRepairPerHp);
  if (profile.bases.length > 0) {
    if (!broke) return createSiteActivity('resupply', chooseNearestSite(vehicle, profile.bases).id, reason);
    // A camp buys no cargo, so a broke raider sells in town first.
    return hasSaleCargo(vehicle) ? saleGoal(world, vehicle, profile) : createActivity('wait', null, null, 'cannot afford upkeep');
  }
  if (lowSupplies && !lowFuel && !damaged) {
    const oasis = chooseNearestSite(vehicle, profile.supplySites);
    if (oasis) return createSiteActivity('resupply', oasis.id, 'low supplies');
  }
  if (broke && !hasSaleCargo(vehicle)) return createActivity('wait', null, null, 'cannot afford upkeep');
  const town = chooseNearestSite(vehicle, profile.towns);
  if (!town) return createActivity('wait', null, null, 'no known service town');
  return createSiteActivity('resupply', town.id, reason);
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

// Why a goal can no longer run, or null while it can.
function invalidReason(world: World, vehicle: Vehicle, goal: NpcActivity, contacts: Contact[]): string | null {
  if (goal.kind === 'fight') {
    const target = world.vehicles.find((v) => v.id === goal.targetId);
    return target && canVehicleSee(world, vehicle, target.pos) && isHostile(world, vehicle, target) ? null : 'lost the target';
  }
  if (goal.kind === 'flee') {
    if (visibleHostiles(world, vehicle).length > 0 || contacts.some((c) => c.vehicleId === goal.targetId)) return null;
    return 'no hostile in sight';
  }
  if (goal.kind === 'investigate') {
    const target = world.vehicles.find((v) => v.id === goal.targetId);
    return target && isHostile(world, vehicle, target) ? null : 'the contact is gone';
  }
  if (goal.kind === 'scavenge' && goal.targetId?.startsWith('wreck-')) {
    // A wreck is an opportunity only while it remains observable.
    return world.salvage.some((stock) => stock.id === goal.targetId && canVehicleSee(world, vehicle, stock.pos)) ? null : 'lost sight of the wreck';
  }
  if (goal.kind === 'loot') {
    const stock = world.salvage.find((s) => s.id === goal.targetId);
    if (!stock) return 'the loot is gone';
    if (!hasSalvage(stock)) return 'nothing left to loot';
    return freeCells(vehicle) === 0 ? 'cargo cannot hold the loot' : null;
  }
  if (goal.kind === 'tow') {
    if (heldTow(world, vehicle)) return null;
    return strandedPlayerAt(world, vehicle) && !stateOf(world, 'spurned', vehicle.id, world.player.vehicleId) ? null : 'the tow is off';
  }
  return null;
}

// ---- Decision points.

// Refreshes noticed subjects the NPC perceives now. A subject a goal still targets stays noticed. Any other one is
// forgotten NPC_BEHAVIOR.noticeMemory turns after it was last perceived, so it fires again when perceived again.
function forget(world: World, vehicle: Vehicle, contacts: Contact[]): void {
  const brain = vehicle.brain!;
  for (const [key, last] of Object.entries(brain.noticed)) {
    const [decision, id] = key.split(':');
    if (perceives(world, vehicle, decision, id, contacts)) brain.noticed[key] = world.turn;
    else if (!brain.goals.some((g) => g.targetId === id) && world.turn - last > NPC_BEHAVIOR.noticeMemory) delete brain.noticed[key];
  }
}

function perceives(world: World, vehicle: Vehicle, decision: string, id: string, contacts: Contact[]): boolean {
  if (decision === 'contactHeard') return contacts.some((c) => c.vehicleId === id);
  if (decision !== 'hostileSeen' && decision !== 'preySeen' && decision !== 'strandedSeen') throw new Error(`Unknown noticed decision ${decision}`);
  const other = world.vehicles.find((v) => v.id === id);
  return other !== undefined && canVehicleSee(world, vehicle, other.pos);
}

type NoticedDecision = 'hostileSeen' | 'contactHeard' | 'preySeen' | 'strandedSeen';

// Rolls a decision about a subject once while the subject stays noticed. Null when it already is. When only keep
// has weight, the driver keeps without a roll and without noticing, so the decision fires once a choice appears.
// Otherwise it notices the subject, judges a seen truck's danger once for this sighting, then rolls.
function react<D extends NoticedDecision>(world: World, vehicle: Vehicle, decision: D, id: string): DecisionOptions[D] | null {
  const key = `${decision}:${id}`;
  if (key in vehicle.brain!.noticed) return null;
  if (!hasChoice(optionWeights(world, vehicle, decision, id, null))) return 'keep' as DecisionOptions[D];
  vehicle.brain!.noticed[key] = world.turn;
  const seen = decision === 'hostileSeen' || decision === 'preySeen';
  return decide(world, vehicle, decision, id, seen ? perceiveDanger(world, vehicleById(world, id)) : null);
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
    const weak = isWeak(world, vehicle);
    const option = react(world, vehicle, 'hostileSeen', enemy.id);
    if (option === null || option === 'keep') continue;
    if (option === 'fight') interrupt(world, vehicle, createActivity('fight', enemy.id, { ...enemy.pos }, 'fight a hostile in sight'));
    else interrupt(world, vehicle, fleeFrom(world, vehicle, profile, enemy.id, enemy.pos, weak ? 'damaged and threatened' : 'avoid a costly fight'));
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

// Fires every turn after damage. Flee runs from the nearest hostile in sight.
function onHurt(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  if (vehicle.brain!.hurt <= 0 || decide(world, vehicle, 'hurt', null, null) === 'keep') return;
  const enemy = visibleHostiles(world, vehicle)[0];
  if (!enemy) throw new Error(`${vehicle.id} chose to flee a hit with no hostile in sight`);
  interrupt(world, vehicle, fleeFrom(world, vehicle, profile, enemy.id, enemy.pos, 'hurt and threatened'));
}

// One roll per new robbery candidate in sight, nearest first. The sighting's perceived danger decides whether it is
// a target. Rob starts a feud with the target and fights it.
function onPreySeen(world: World, vehicle: Vehicle): void {
  const prey = world.vehicles
    .filter((other) => isRobberyCandidate(world, vehicle, other))
    .sort((a, b) => dist(vehicle.pos, a.pos) - dist(vehicle.pos, b.pos));
  for (const target of prey) {
    if (react(world, vehicle, 'preySeen', target.id) !== 'rob') continue;
    addState(world, 'feud', vehicle.id, target.id, { kind: 'feud', robbery: true });
    world.events.push({ t: 'hostile', vehicle: vehicle.id, against: target.id });
    interrupt(world, vehicle, createActivity('fight', target.id, { ...target.pos }, 'rob cargo'));
    return;
  }
}

function onStrandedSeen(world: World, vehicle: Vehicle): void {
  const at = strandedPlayerAt(world, vehicle);
  const me = world.player.vehicleId;
  if (at && react(world, vehicle, 'strandedSeen', me) === 'tow') pushGoal(world, vehicle, createActivity('tow', me, { ...at }, 'help a stranded truck'));
}

// A flee keeps running from where its threat is now, and an investigation heads for the contact's newest circle.
function steer(world: World, vehicle: Vehicle, profile: NpcProfile, contacts: Contact[]): void {
  const top = topGoal(vehicle);
  if (top?.kind === 'flee') {
    const target = world.vehicles.find((v) => v.id === top.targetId);
    const threat = target && canVehicleSee(world, vehicle, target.pos) ? target.pos : visibleHostiles(world, vehicle)[0]?.pos ?? contacts.find((c) => c.vehicleId === top.targetId)?.center;
    if (!threat) throw new Error(`${vehicle.id} flees with no threat perceived`);
    top.destination = fleeDestination(world, vehicle, profile, threat);
  }
  if (top?.kind === 'investigate') {
    const contact = contacts.find((c) => c.vehicleId === top.targetId);
    if (contact) top.destination = { ...contact.center };
  }
}

// The NPC's activity this turn. Invalid goals pop, the survival rule and the decision points push, and an empty
// stack sells or rolls idle. A wait is returned for this turn without entering the stack.
export function thinkNpc(world: World, vehicle: Vehicle): NpcActivity {
  const brain = vehicle.brain;
  if (!brain) throw new Error(`${vehicle.id} has no NPC brain`);
  if (!brain.noticed) throw new Error(`${vehicle.id} has no noticed list`);
  const profile = npcProfile(vehicle);
  const contacts = trustedContacts(world, vehicle);
  forget(world, vehicle, contacts);
  for (let top = topGoal(vehicle); top; top = topGoal(vehicle)) {
    const reason = invalidReason(world, vehicle, top, contacts);
    if (!reason) break;
    finishGoal(world, vehicle, reason);
  }
  let hold: NpcActivity | null = null;
  if (heldTow(world, vehicle)) {
    const goal = towGoal(world, vehicle);
    const top = topGoal(vehicle);
    if (top?.kind !== 'tow' || top.targetId !== goal.targetId || top.reason !== goal.reason) pushGoal(world, vehicle, goal);
  } else if (topGoal(vehicle)?.kind !== 'tow') {
    const service = serviceGoal(world, vehicle, profile);
    if (service?.kind === 'wait') hold = service;
    else if (service && !brain.goals.some((g) => g.kind === service.kind)) pushGoal(world, vehicle, service);
  }
  onHostilesSeen(world, vehicle, profile);
  onContactsHeard(world, vehicle, profile, contacts);
  onHurt(world, vehicle, profile);
  onPreySeen(world, vehicle);
  onStrandedSeen(world, vehicle);
  steer(world, vehicle, profile, contacts);
  const top = topGoal(vehicle);
  if (hold && (!top || !INTERRUPTIONS.includes(top.kind))) return hold;
  if (top) return top;
  const next = hasSaleCargo(vehicle) ? saleGoal(world, vehicle, profile) : idleGoal(world, vehicle);
  if (next.kind !== 'wait') pushGoal(world, vehicle, next);
  return next;
}

// Sums the part damage each NPC took this turn into brain.hurt. It runs last in the turn, before events clear.
export function noteHurt(world: World): void {
  const hurt = new Map<string, number>();
  const add = (id: string, hits: PartHit[]) => hurt.set(id, (hurt.get(id) ?? 0) + hits.reduce((sum, hit) => sum + hit.damage, 0));
  for (const e of world.events) {
    if (e.t === 'shot' || e.t === 'guardShot') for (const round of e.rounds) add(e.target, round.hits);
    else if (e.t === 'collision') {
      add(e.a, e.hitsA);
      add(e.b, e.hitsB);
    }
  }
  for (const v of world.vehicles) if (v.brain) v.brain.hurt = hurt.get(v.id) ?? 0;
}

export function getActivityDestination(world: World, vehicle: Vehicle, activity: NpcActivity): Vec | null {
  if (!activity.destination) return null;
  if (['fight', 'flee', 'raid', 'investigate'].includes(activity.kind)) return activity.destination;
  const site = [...REGION.towns, ...REGION.locations].find((entry) => entry.id === activity.targetId);
  const stock = activity.kind === 'scavenge' || activity.kind === 'loot' ? world.salvage.find((entry) => entry.id === activity.targetId) : undefined;
  // A tower drives up to the truck it tows, and parks beside it like beside a stock.
  const towed = activity.kind === 'tow' ? world.vehicles.find((entry) => entry.id === activity.targetId) : undefined;
  const radius = site?.radius ?? stock?.radius ?? (towed && chassisDef(towed.chassisId).radius);
  if (radius === undefined) throw new Error(`Missing activity destination ${activity.targetId}`);
  const stopRadius = radius + vehicleStats(world, vehicle).radius + RULES.arriveRadius;
  // A walled site is used from its gate nearest the vehicle, so the stop lies just outside that gate.
  const gate = site && isWalled(site) ? siteGates(site).reduce((a, b) => (dist(vehicle.pos, a) <= dist(vehicle.pos, b) ? a : b)) : null;
  const angle = gate ? Math.atan2(gate.y - site!.pos.y, gate.x - site!.pos.x) : Math.atan2(vehicle.pos.y - activity.destination.y, vehicle.pos.x - activity.destination.x);
  return { x: activity.destination.x + Math.cos(angle) * stopRadius, y: activity.destination.y + Math.sin(angle) * stopRadius };
}

function resolveActivity(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (activity.kind === 'tow') {
    const ended = runTow(world, vehicle, activity);
    if (ended) finishGoal(world, vehicle, ended);
    return;
  }
  // Looting searches the robbed stock like any salvage.
  if (activity.kind === 'scavenge' || activity.kind === 'loot') {
    const stock = world.salvage.find((entry) => entry.id === activity.targetId);
    if (!stock) { finishGoal(world, vehicle, 'salvage no longer available'); return; }
    // A search already runs at this stock: keep parked and wait for it to finish.
    if (vehicle.job?.kind === 'search' && vehicle.job.stockId === stock.id) { activity.phase = 'act'; return; }
    if (!canReachSalvage(vehicle, stock)) return;
    activity.phase = 'act';
    if (!hasSalvage(stock) || freeCells(vehicle) === 0) {
      finishGoal(world, vehicle, !hasSalvage(stock) ? 'salvage exhausted' : 'cargo cannot hold salvage');
      return;
    }
    if (!vehicle.job) beginSearch(world, vehicle, stock.id);
    return;
  }
  if (activity.kind === 'raid') {
    if (activity.destination && dist(vehicle.pos, activity.destination) <= RULES.arriveRadius * 2) finishGoal(world, vehicle, 'reached hunting ground');
    return;
  }
  if (activity.kind === 'investigate') {
    if (activity.destination && dist(vehicle.pos, activity.destination) <= RULES.arriveRadius * 2) finishGoal(world, vehicle, 'found nothing at the contact');
    return;
  }
  if (!['sell', 'trade', 'resupply'].includes(activity.kind)) return;
  const site = getKnownSite(activity.targetId!);
  if (!canUseSite(vehicle.pos, site)) return;
  activity.phase = 'act';
  if (activity.kind === 'resupply') {
    if ('kind' in site && site.kind === 'oasis') getResources(world, vehicle).supplies = RULES.suppliesCap;
    else if ('kind' in site && site.kind === 'camp') serviceAtCamp(world, vehicle, site.id);
    else serviceVehicle(world, vehicle, site.id);
  } else if (activity.kind === 'sell') sellVehicleCargo(world, vehicle, site.id);
  else {
    if (!activity.purchase) throw new Error('Trade activity missing purchase');
    const price = getTradePrice(world, vehicle, site.id, activity.purchase.good, 'buy');
    const count = Math.min(freeCells(vehicle), Math.floor((getResources(world, vehicle).money - getUpkeepReserve(vehicle)) / price));
    if (count > 0) {
      tradeGoods(world, vehicle, site.id, activity.purchase.good, count, 'buy');
      if (vehicle.brain!.goals[0] !== activity) throw new Error(`${vehicle.id} trades above its long-term goal`);
      replaceBase(world, vehicle, createSiteActivity('sell', activity.purchase.sellTown, 'deliver purchased cargo'));
      return;
    }
  }
  finishGoal(world, vehicle, activity.kind === 'trade' ? 'cannot afford trade cargo' : activity.kind === 'sell' ? 'sold cargo' : 'finished service');
}

export function resolveNpcActivities(world: World): void {
  for (const vehicle of world.vehicles) {
    if (!vehicle.brain || corePart(vehicle, 'cab').hp <= 0 || getResources(world, vehicle).health <= 0 || vehicle.speed > RULES.parkedSpeed) continue;
    const top = topGoal(vehicle);
    if (top) resolveActivity(world, vehicle, top);
  }
}
