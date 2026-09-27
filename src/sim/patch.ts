// Roadside patches between two trucks. A patch lifts the broken engine and transmission that strand a truck to
// PATCH.share of their max HP, with the repair math of src/sim/repair.ts and the patcher's Mechanics. The terms are
// the NPC's `patchDeal` decision, so traits and states shape them. A deal is a `patch` state held by the patcher
// toward the client. Work runs while both trucks stay parked in reach, and the fulfilled hook pays for it once.

import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { PATCH } from '../data/wear';
import { isJunk, maxHp, restorePart } from './wear';
import { playerVehicle, vehicleById } from './damage';
import { buyPrice } from './economy';
import { corePart, goodsCount, mountedParts } from './grid';
import { removeGoods } from './inventory';
import { decide, optionWeights } from './npc-decisions';
import { mechanicsMult, planPartRepair } from './repair';
import { getResources } from './resources';
import { addState } from './states';
import { inTowReach } from './tow';
import type { CallVar, NpcState, PartInstance, PatchDeal, StateData, Vehicle, World } from './types';
import { dist } from './vec';

export type PatchPlan = { parts: number; turns: number };
type Roles = { patcher: Vehicle; client: Vehicle };

// The broken parts that strand a truck and a patch can fix: the first engine and the transmission, unless junk.
function brokenDriveParts(v: Vehicle): PartInstance[] {
  const engine = mountedParts(v, 'engine')[0];
  return [engine, corePart(v, 'transmission')].filter((p): p is PartInstance => p !== undefined && p.hp === 0 && !isJunk(p));
}

export function needsPatch(v: Vehicle): boolean {
  return brokenDriveParts(v).length > 0;
}

// A driver carrying enough parts fixes its own truck with a field repair and needs no one's help.
export function canFixItself(world: World, v: Vehicle): boolean {
  return partsHeld(v) >= patchPlan(world, { patcher: v, client: v }).parts;
}

export function patchPlan(world: World, { patcher, client }: Roles): PatchPlan {
  const mult = mechanicsMult(world, patcher);
  const plans = brokenDriveParts(client).map((p) => planPartRepair(p, PATCH.share, mult, Infinity, Infinity));
  return { parts: plans.reduce((sum, p) => sum + p.parts, 0), turns: plans.reduce((sum, p) => sum + p.turns, 0) };
}

// Talk is between the player and one NPC. The one with the broken truck is the client.
function rolesWith(world: World, npc: Vehicle): Roles {
  const me = playerVehicle(world);
  return needsPatch(npc) ? { patcher: me, client: npc } : { patcher: npc, client: me };
}

function partsHeld(v: Vehicle): number {
  return goodsCount(v).parts ?? 0;
}

// Parts are priced as the client's nearest town sells them.
function partsValue(world: World, client: Vehicle, parts: number): number {
  const town = REGION.towns.reduce((a, b) => (dist(client.pos, a.pos) <= dist(client.pos, b.pos) ? a : b));
  return parts * buyPrice(world, town.id, 'parts');
}

function priceOf(world: World, deal: PatchDeal, roles: Roles, plan: PatchPlan): number {
  const labor = plan.turns * PATCH.laborPerTurn;
  if (deal === 'free') return 0;
  return deal === 'ownParts' ? labor : labor + partsValue(world, roles.client, plan.parts);
}

// Who spends the parts on a deal.
function partsPayer(deal: PatchDeal, roles: Roles): Vehicle {
  return deal === 'ownParts' ? roles.client : roles.patcher;
}

// The player may pay into debt. An NPC must hold the money.
function canPay(world: World, v: Vehicle, amount: number): boolean {
  return v.id === world.player.vehicleId || getResources(world, v).money >= amount;
}

// A deal is available when its payer holds the parts and the client can pay. `npc` makes the decision about the
// player, `subject`.
export function dealAvailable(deal: PatchDeal): (world: World, npc: Vehicle) => boolean {
  return (world, npc) => {
    const roles = rolesWith(world, npc);
    const plan = patchPlan(world, roles);
    if (plan.parts === 0) return false;
    return partsHeld(partsPayer(deal, roles)) >= plan.parts && canPay(world, roles.client, priceOf(world, deal, roles, plan));
  };
}

// The NPC names its terms for a patch with the player: a `deal` call value, or null when no deal is available.
export function patchTerms(world: World, npc: Vehicle): CallVar | null {
  const subject = world.player.vehicleId;
  if (Object.keys(optionWeights(world, npc, 'patchDeal', subject, null)).length === 0) return null;
  const deal = decide(world, npc, 'patchDeal', subject, null);
  const roles = rolesWith(world, npc);
  const plan = patchPlan(world, roles);
  const patcher = roles.patcher.id === subject ? 'player' : 'npc';
  return { kind: 'deal', deal, patcher, price: priceOf(world, deal, roles, plan), parts: plan.parts, turns: plan.turns };
}

// Both sides agreed on the terms over the radio.
export function agreePatch(world: World, npc: Vehicle, terms: Extract<CallVar, { kind: 'deal' }>): NpcState {
  const { patcher, client } = rolesWith(world, npc);
  const data: StateData = { kind: 'patch', deal: terms.deal, parts: terms.parts, price: terms.price, work: terms.turns, workLeft: terms.turns };
  return addState(world, 'patch', patcher.id, client.id, data);
}

export function patchData(s: NpcState): Extract<StateData, { kind: 'patch' }> {
  if (s.data.kind !== 'patch') throw new Error(`State ${s.id} holds no patch`);
  return s.data;
}

function isParked(v: Vehicle): boolean {
  return v.speed <= RULES.parkedSpeed;
}

// Work happens this turn: both trucks are parked within reach of each other.
export function isPatching(world: World, s: NpcState): boolean {
  const patcher = vehicleById(world, s.holder);
  const client = vehicleById(world, s.other);
  return isParked(patcher) && isParked(client) && inTowReach(patcher, client);
}

// The turn step: each patch with work under way loses a turn of work left. It runs before advanceStates, which
// fulfils a finished patch.
export function advancePatches(world: World): void {
  for (const s of world.states) {
    if (s.kind !== 'patch' || !partiesPresent(world, s) || !isPatching(world, s)) continue;
    const data = patchData(s);
    if (data.workLeft === data.work) world.events.push({ t: 'patch', patcher: s.holder, client: s.other, outcome: 'started' });
    data.workLeft--;
  }
}

function partiesPresent(world: World, s: NpcState): boolean {
  return world.vehicles.some((v) => v.id === s.holder) && world.vehicles.some((v) => v.id === s.other);
}

// The patch ends as fulfilled when its work is done. It breaks when the payer no longer holds the parts or an NPC
// client no longer holds the price.
export function checkPatch(world: World, s: NpcState): 'fulfilled' | 'broken' | null {
  if (!partiesPresent(world, s)) return null;
  const data = patchData(s);
  const roles = { patcher: vehicleById(world, s.holder), client: vehicleById(world, s.other) };
  if (!canStillPay(world, data, roles)) return 'broken';
  return data.workLeft <= 0 ? 'fulfilled' : null;
}

function canStillPay(world: World, data: Extract<StateData, { kind: 'patch' }>, roles: Roles): boolean {
  return partsHeld(partsPayer(data.deal, roles)) >= data.parts && canPay(world, roles.client, data.price);
}

// The one place a patch pays: parts leave the payer, money moves from client to patcher, and the parts work again.
export function settlePatch(world: World, s: NpcState): void {
  const data = patchData(s);
  const roles = { patcher: vehicleById(world, s.holder), client: vehicleById(world, s.other) };
  removeGoods(partsPayer(data.deal, roles), 'parts', data.parts);
  getResources(world, roles.client).money -= data.price;
  getResources(world, roles.patcher).money += data.price;
  for (const part of brokenDriveParts(roles.client)) restorePart(part, Math.max(1, Math.round(maxHp(part) * PATCH.share)));
  world.events.push({ t: 'patch', patcher: s.holder, client: s.other, outcome: 'done' });
}

// A patch nobody worked on for its whole timer lapses for free.
export function lapsePatch(world: World, s: NpcState): void {
  world.events.push({ t: 'patch', patcher: s.holder, client: s.other, outcome: 'lapsed' });
}
