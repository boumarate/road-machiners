// The logic behind dialogue topics: named conditions, effects and prepare steps that src/data/dialogue.ts
// refers to. The records are typed complete, so a name in the data without a function fails typecheck.

import type { ConditionId, EffectId, PrepareId } from '../data/dialogue';
import { REGION, type TownDef } from '../data/region';
import { partTradePrice } from './economy';
import { playerVehicle } from './damage';
import { stowPart } from './inventory';
import { discoverSite } from './locations';
import { SPAWN } from '../data/npcs';
import { patchGoal, pushGoal, startTow, topGoal } from './npc-activities';
import { createCargoSalvage, hasCargo } from './salvage';
import { agreePatch, canFixItself, needsPatch, patchTerms } from './patch';
import { npcProfile } from './npc-decisions';
import { getResources } from './resources';
import { addState, endState, stateOf, towData } from './states';
import { acceptOffer, playerTow, refuseOffer, strandedPlayerAt } from './tow';
import type { Call, CallVars, TopicOutcome, Vehicle, World } from './types';
import { bearing, dist } from './vec';

// `vars` are the call values, empty on the hub and before a topic's prepare step.
export type Condition = (world: World, npc: Vehicle, vars: CallVars) => boolean;
export type Effect = (world: World, npc: Vehicle, call: Call) => void;
export type Prepare = (world: World, npc: Vehicle) => CallVars;

function knownTowns(npc: Vehicle): TownDef[] {
  return npcProfile(npc).towns.map((id) => {
    const town = REGION.towns.find((t) => t.id === id);
    if (!town) throw new Error(`Unknown town ${id}`);
    return town;
  });
}

// The known town nearest the player, not the NPC: directions are for the one asking.
function nearestKnownTown(world: World, npc: Vehicle): TownDef {
  const me = playerVehicle(world).pos;
  const towns = knownTowns(npc);
  if (towns.length === 0) throw new Error(`${npc.id} knows no town`);
  return towns.reduce((a, b) => (dist(me, a.pos) <= dist(me, b.pos) ? a : b));
}

function settle(world: World, npc: Vehicle, call: Call, outcome: TopicOutcome): void {
  if (!call.topic) throw new Error('Only a topic can be settled');
  world.player.talked[npc.id] = { ...world.player.talked[npc.id], [call.topic]: outcome };
}

// The player drops the cargo. The demander and its faction mates nearby end any feud with the player and hold a
// truce instead, and the demander goes to search the stock.
function handOverCargo(world: World, npc: Vehicle): void {
  const me = playerVehicle(world);
  const stock = createCargoSalvage(world, me);
  const party = world.vehicles.filter((v) => v.brain && v.faction === npc.faction && dist(v.pos, npc.pos) <= SPAWN.neighborHelp);
  for (const v of party) {
    for (const s of [stateOf(world, 'feud', v.id, me.id), stateOf(world, 'feud', me.id, v.id)]) if (s) endState(world, s, 'broken');
    addState(world, 'truce', v.id, me.id, { kind: 'none' });
  }
  pushGoal(world, npc, { kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason: 'take the handed-over cargo' });
}

// A truck already in a patch deal, as patcher or client.
function inPatch(world: World, id: string): boolean {
  return world.states.some((s) => s.kind === 'patch' && (s.holder === id || s.other === id));
}

// The open offer this driver made to the player, or null.
function offerBy(world: World, npc: Vehicle) {
  const tow = playerTow(world);
  return tow?.holder === npc.id && !towData(tow).hitched ? tow : null;
}

// The radio trade topic buys a live NPC spare, not a static option, so it calls this directly from
// src/sim/dialogue.ts instead of going through EFFECTS. The price uses the player's own trade spread,
// the same one town buys use, since it is the player's Trade skill narrowing it, not the NPC's.
export type SpareOutcome = 'bought' | 'noRoom' | 'noMoney';

export function buySpare(world: World, npc: Vehicle, partId: string): SpareOutcome {
  const item = npc.items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item || item.kind !== 'part') throw new Error(`${npc.id} has no spare part ${partId}`);
  const price = partTradePrice(world, playerVehicle(world), item.part, 'buy');
  if (world.player.money < price) return 'noMoney';
  if (!stowPart(world, playerVehicle(world), item.part)) return 'noRoom';
  npc.items = npc.items.filter((it) => it.id !== item.id);
  world.player.money -= price;
  getResources(world, npc).money += price;
  return 'bought';
}

export const CONDITIONS: Record<ConditionId, Condition> = {
  knowsTown: (_world, npc) => knownTowns(npc).length > 0,
  offersTow: (world, npc) => offerBy(world, npc) !== null,
  // A driver already on its way does not need asking.
  canTowPlayer: (world, npc) => strandedPlayerAt(world, npc) !== null && topGoal(npc)?.kind !== 'tow',
  playerNeedsPatch: (world) => needsPatch(playerVehicle(world)) && !inPatch(world, world.player.vehicleId),
  npcNeedsPatch: (world, npc) => needsPatch(npc) && !canFixItself(world, npc) && !inPatch(world, npc.id),
  hasDeal: (_world, _npc, vars) => vars.deal !== undefined,
  noDeal: (_world, _npc, vars) => vars.deal === undefined,
  // About to attack the player, who carries something worth taking.
  demandsCargo: (world, npc) => {
    const top = topGoal(npc);
    return top?.kind === 'fight' && top.targetId === world.player.vehicleId && hasCargo(playerVehicle(world));
  },
};

export const EFFECTS: Record<EffectId, Effect> = {
  revealTown: (world, _npc, call) => {
    const v = call.vars.town;
    if (v?.kind !== 'town') throw new Error('revealTown needs a town value');
    const town = REGION.towns.find((t) => t.id === v.id)!;
    if (!world.player.discovered.includes(town.id)) discoverSite(world, town);
  },
  acceptTow: (world) => acceptOffer(world),
  refuseTow: (world) => refuseOffer(world),
  askTow: (world, npc) => startTow(world, npc, strandedPlayerAt(world, npc)!),
  agreePatch: (world, npc, call) => {
    const terms = call.vars.deal;
    if (terms?.kind !== 'deal') throw new Error('agreePatch needs deal terms');
    const deal = agreePatch(world, npc, terms);
    patchGoal(world, npc, playerVehicle(world), deal.holder === npc.id);
    settle(world, npc, call, 'agreed');
  },
  handOver: (world, npc, call) => {
    handOverCargo(world, npc);
    settle(world, npc, call, 'agreed');
  },
  settleDone: (world, npc, call) => settle(world, npc, call, 'done'),
  settleRefused: (world, npc, call) => settle(world, npc, call, 'refused'),
};

export const PREPARES: Record<PrepareId, Prepare> = {
  // No `deal` value means the driver cannot offer a patch.
  patchTerms: (world, npc): CallVars => {
    const deal = patchTerms(world, npc);
    return deal ? { deal } : {};
  },
  towOffer: (world, npc) => {
    const tow = offerBy(world, npc);
    if (!tow) throw new Error(`${npc.id} made no tow offer`);
    const { town, fee } = towData(tow);
    return { town: { kind: 'town', id: town }, fee: { kind: 'money', amount: fee } };
  },
  nearestTown: (world, npc) => {
    const me = playerVehicle(world).pos;
    const town = nearestKnownTown(world, npc);
    return {
      town: { kind: 'town', id: town.id },
      bearing: { kind: 'bearing', rad: bearing(me, town.pos) },
      distance: { kind: 'distance', tiles: dist(me, town.pos) },
    };
  },
};
