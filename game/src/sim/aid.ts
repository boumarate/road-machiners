// Fuel and supply aid between the player and one NPC. One truck gives the other fuel, supplies or both, paid or
// free. A deal is an `aid` state held by the NPC toward the player. Once agreed, the NPC's meet goal brings the two
// trucks side by side, and the fulfilled hook moves everything once. A truck is low on a supply at or below
// RULES.lowFuelThreshold of its cap, where its speed halves. Numbers live in AID.

import { ECONOMY } from '../data/goods';
import { AID } from '../data/npc-behavior';
import { RULES } from '../data/rules';
import { inFeud, isHostile } from './combat';
import { playerVehicle, vehicleById } from './damage';
import { talkOf } from './dialogue';
import { isMeeting, supplyRoom, transfer, truckSupplyForSale, type Supply } from './economy';
import { inCombat } from './jobs';
import { vehicleValue } from './market';
import { inDanger, meetGoal, react, underAttack } from './npc-activities';
import { bodyCondition } from './npc-decisions';
import { practice } from './progress';
import { getResources } from './resources';
import { addState, aidData, endState, stateOf } from './states';
import { fuelCap, suppliesCap } from './stats';
import type { NpcState, StateData, StateEnding, Vehicle, World } from './types';
import { canVehicleSee } from './vision';

export type AidAmounts = { fuel: number; supplies: number };
type AidTerms = Omit<Extract<StateData, { kind: 'aid' }>, 'kind' | 'agreed'>;

const SUPPLIES: readonly Supply[] = ['fuel', 'supplies'];

function capOf(v: Vehicle, kind: Supply): number {
  return kind === 'fuel' ? fuelCap(v) : suppliesCap(v);
}

export function isLowOn(world: World, v: Vehicle, kind: Supply): boolean {
  return getResources(world, v)[kind] <= capOf(v, kind) * RULES.lowFuelThreshold;
}

function isLow(world: World, v: Vehicle): boolean {
  return SUPPLIES.some((kind) => isLowOn(world, v, kind));
}

// A worn truck worth little, like the start scout after some knocks.
export function looksPoor(v: Vehicle): boolean {
  return bodyCondition(v) < AID.poorCondition && vehicleValue(v) <= AID.poorValue;
}

// Any aid deal toward the player, from any driver. Only one is open at a time.
export function playerAid(world: World): NpcState | null {
  return world.states.find((s) => s.kind === 'aid' && s.other === world.player.vehicleId) ?? null;
}

function amountsBy(pick: (kind: Supply) => number): AidAmounts {
  return { fuel: pick('fuel'), supplies: pick('supplies') };
}

// What a low driver asks the player for: whole units of each low supply up to AID.fillShare of its cap, capped by
// what the player holds.
export function wantedAid(world: World, npc: Vehicle): AidAmounts {
  const held = getResources(world, npc);
  const want = (kind: Supply) => Math.max(0, Math.floor(capOf(npc, kind) * AID.fillShare - held[kind]));
  return amountsBy((kind) => (isLowOn(world, npc, kind) ? Math.min(want(kind), Math.floor(world.player[kind])) : 0));
}

// What a driver can spare the player: AID.giftShare of the player's cap per supply the player is low on, only from
// stock above the driver's trade reserve, and no more than the player has room for.
export function spareAid(world: World, npc: Vehicle): AidAmounts {
  const me = playerVehicle(world);
  const gift = (kind: Supply) => Math.min(Math.floor(capOf(me, kind) * AID.giftShare), truckSupplyForSale(npc, kind), supplyRoom(world, kind));
  return amountsBy((kind) => (isLowOn(world, me, kind) ? gift(kind) : 0));
}

export function hasAid(a: AidAmounts): boolean {
  return a.fuel > 0 || a.supplies > 0;
}

// The town value of the units: what the player gave in money terms.
function aidValue(a: AidAmounts): number {
  return a.fuel * ECONOMY.supplyPrice.fuel + a.supplies * ECONOMY.supplyPrice.supplies;
}

// What the driver pays the player for the units: the town supply price, up to its money.
export function aidPrice(world: World, npc: Vehicle, a: AidAmounts): number {
  return Math.max(0, Math.min(aidValue(a), getResources(world, npc).money));
}

// The driver can give the player something, and no aid deal with the player is open. It serves the give and aid
// options of the aidAsked and needySeen decisions.
export function canSpareFor(world: World, npc: Vehicle): boolean {
  return hasAid(spareAid(world, npc)) && playerAid(world) === null;
}

// The driver offers the player what it can spare, free. It waits for the player's answer.
export function offerAid(world: World, npc: Vehicle): void {
  const data: StateData = { kind: 'aid', giver: 'npc', ...spareAid(world, npc), price: 0, free: true, agreed: false };
  addState(world, 'aid', npc.id, world.player.vehicleId, data);
}

// Both sides agreed. The agreed terms replace a pending offer from the driver, and the driver comes over, or waits
// for the player when it cannot drive.
export function agreeAid(world: World, npc: Vehicle, terms: AidTerms): NpcState {
  const s = addState(world, 'aid', npc.id, world.player.vehicleId, { kind: 'aid', ...terms, agreed: true });
  meetGoal(world, npc, playerVehicle(world), terms.giver === 'npc' ? 'bring fuel and supplies' : 'pick up fuel and supplies');
  return s;
}

// The player turned the driver's offer down.
export function refuseAid(world: World, npc: Vehicle): void {
  const s = stateOf(world, 'aid', npc.id, world.player.vehicleId);
  if (!s || aidData(s).agreed) throw new Error(`${npc.name} has no aid offer pending`);
  endState(world, s, 'broken');
}

// A feud between the two breaks the deal. An agreed deal is fulfilled once both trucks are parked in reach. A missing
// party is left to the missing-party rule.
export function checkAid(world: World, s: NpcState): StateEnding | null {
  const npc = world.vehicles.find((v) => v.id === s.holder);
  const me = world.vehicles.find((v) => v.id === s.other);
  if (!npc || !me) return null;
  if (inFeud(world, npc, me)) return 'broken';
  return aidData(s).agreed && isMeeting(world, s) ? 'fulfilled' : null;
}

// The one place aid moves: the units, clamped to what the giver can still give and the receiver has room for, then
// the price of what moved, up to the driver's money. A free gift from the player trains Social.
export function settleAid(world: World, s: NpcState): void {
  const data = aidData(s);
  const npc = vehicleById(world, s.holder);
  const me = vehicleById(world, s.other);
  const [giver, receiver] = data.giver === 'player' ? [me, npc] : [npc, me];
  const moved = amountsBy((kind) => moveSupply(world, giver, receiver, kind, data[kind]));
  const paid = Math.min(data.price, aidPrice(world, npc, moved));
  if (paid > 0) transfer(world, npc, me, paid);
  world.events.push({ t: 'aid', giver: giver.id, receiver: receiver.id, ...moved, paid });
  if (data.free && data.giver === 'player' && hasAid(moved)) practice(world, 'aid', aidValue(moved), null, npc.id);
}

// Whole units the giver can still give: all a player holds, and what a driver holds above its trade reserve.
function givable(world: World, giver: Vehicle, kind: Supply): number {
  return giver.brain ? truckSupplyForSale(giver, kind) : Math.floor(getResources(world, giver)[kind]);
}

function moveSupply(world: World, giver: Vehicle, receiver: Vehicle, kind: Supply, units: number): number {
  const to = getResources(world, receiver);
  const n = Math.max(0, Math.min(units, givable(world, giver, kind), Math.floor(capOf(receiver, kind) - to[kind])));
  getResources(world, giver)[kind] -= n;
  to[kind] += n;
  return n;
}

// ---- The unprompted offer.

// A driver that answers tow requests, out of danger and not under attack, may help.
function mayHelp(npc: Vehicle): boolean {
  return !inDanger(npc) && !underAttack(npc) && talkOf(npc).topics.includes('askTow');
}

// A poor player low on fuel or supplies, out of combat.
function looksNeedy(world: World, me: Vehicle): boolean {
  return isLow(world, me) && looksPoor(me) && !inCombat(world, me);
}

function mayOfferAid(world: World, npc: Vehicle): boolean {
  const me = playerVehicle(world);
  if (playerAid(world) !== null || !mayHelp(npc)) return false;
  return canVehicleSee(world, npc, me.pos) && !isHostile(world, npc, me) && looksNeedy(world, me);
}

// The needySeen decision point: once per sighting of a poor, low player, a helper may offer what it can spare. Only
// one driver offers at a time.
export function onNeedySeen(world: World, npc: Vehicle): void {
  if (mayOfferAid(world, npc) && react(world, npc, 'needySeen', world.player.vehicleId) === 'aid') offerAid(world, npc);
}
