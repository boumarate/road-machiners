// Shops: goods price pressure, finite random part stock and contract boards. Pure functions on an
// explicit ShopState.
// IV1: every price here derives from a good's base value through goodBasePrice/goodPrice.
// IV5: stock is finite; takeStockPart removes, addStockPart adds.
// IV6: stock, restock and contract rolls draw only from world.marketRng, the market's own stream in
// the world, so they replay from the seed without shifting the main stream combat and NPCs use.
// IV7: recordTrade is the one place pressure moves, for player and NPC trades alike.

import { GOODS } from '../data/goods';
import { PARTS } from '../data/parts';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { CONDITION } from '../data/wear';
import { CONTRACTS, EFFORT, PRESSURE_MAX, SHOPS, shopDef, type ShopDef, type Tier } from '../data/market';
import { makePart, newId } from './factory';
import { sampleWeighted } from './npc-loadout';
import { playerVehicle } from './damage';
import { freeCells, goodsCount } from './grid';
import { addGoods, removeGoods, spareParts } from './inventory';
import { practice } from './progress';
import { randInt, type Rng } from './rng';
import { canUseSite, type Site } from './sites';
import { playerCommand } from './world';
import type { GameEvent, PartInstance, Vehicle, World } from './types';
import { dist, type Vec } from './vec';

export type ShopState = {
  contracts: Contract[]; // offers on the board, not yet taken
  pressure: Record<string, number>; // good id -> signed fraction of base price, clamped to PRESSURE_MAX
  stock: PartInstance[];
  restockAt: number; // world.turn at which the shop next restocks
};

// A good's base value before any shop's make/need profile or pressure. GOODS has no `value` field
// yet (PH2 adds one to GoodDef); GOOD_VALUE in src/data/shops.ts stands in until then. This is the
// only function that reads either source, so the switch to a real field touches one place.
export function goodValue(good: string): number {
  const def = GOODS[good];
  if (!def) throw new Error(`Unknown good ${good}`);
  return def.value;
}

function rollStock(world: World, def: ShopDef, count: number): PartInstance[] {
  const stock: PartInstance[] = [];
  for (let i = 0; i < count; i++) {
    const defId = sampleWeighted(world.marketRng, def.partStock.parts);
    const wear = sampleWeighted(world.marketRng, def.partStock.wear);
    if (!Number.isInteger(wear) || wear < 0 || wear > CONDITION.maxWear) {
      throw new Error(`Shop ${def.id} rolled a bad wear step ${wear} for ${defId}`);
    }
    stock.push(makePart(world, defId, wear));
  }
  return stock;
}

// Rolls a shop's opening stock and sets its first restock turn. Called once per shop at world
// creation by the phase that wires World.shops.
export function initShop(world: World, shopId: string): ShopState {
  const def = shopDef(shopId);
  const pressure: Record<string, number> = {};
  for (const good of def.goods) pressure[good] = 0;
  const count = randInt(world.marketRng, def.stockSize[0], def.stockSize[1]);
  return { contracts: [], pressure, stock: rollStock(world, def, count), restockAt: world.turn + def.restockTurns };
}

// Drifts pressure back toward 0 every turn, and replaces the whole stock on restock. Restocking
// keeps nothing of the old stock: the simplest rule, and it matches a shop taking in a fresh haul
// rather than the same shelf slowly refilling.
export function advanceShop(world: World, shopId: string, state: ShopState): void {
  const def = shopDef(shopId);
  for (const good of def.goods) state.pressure[good] = (state.pressure[good] ?? 0) * (1 - def.driftPerTurn);
  if (world.turn >= state.restockAt) {
    const count = randInt(world.marketRng, def.stockSize[0], def.stockSize[1]);
    state.stock = rollStock(world, def, count);
    state.restockAt = world.turn + def.restockTurns;
  }
}

function priceFactorFor(def: ShopDef, good: string): number {
  if (def.makes.includes(good)) return def.priceFactor.make;
  if (def.needs.includes(good)) return def.priceFactor.need;
  return def.priceFactor.neutral;
}

// A good's price at a shop before pressure and spread: its base value times the shop's make/need/
// neutral factor. Throws if the shop does not trade the good.
export function goodBasePrice(shopId: string, good: string): number {
  const def = shopDef(shopId);
  if (!def.goods.includes(good)) throw new Error(`${shopId} does not trade ${good}`);
  return goodValue(good) * priceFactorFor(def, good);
}

// The buy or sell price of a good at a shop, from its base price, standing pressure and a spread
// fraction applied on top (buy up, sell down). Sell always rounds to strictly below buy (IV4).
export function goodPrice(shopId: string, state: ShopState, good: string, direction: 'buy' | 'sell', spread: number): number {
  if (!(spread >= 0)) throw new Error(`Bad spread ${spread}`);
  const pressured = goodBasePrice(shopId, good) * (1 + (state.pressure[good] ?? 0));
  const buy = Math.max(1, Math.ceil(pressured * (1 + spread)));
  const sell = Math.min(buy - 1, Math.floor(pressured * (1 - spread)));
  return direction === 'buy' ? buy : Math.max(0, sell);
}

// Moves standing pressure by the shop's pressurePerUnit per unit traded, clamped to PRESSURE_MAX
// either side of base price. Buying raises price, selling lowers it. The one function player and
// NPC trades both call, so both move prices the same way (IV7).
export function recordTrade(shopId: string, state: ShopState, good: string, units: number, direction: 'buy' | 'sell'): void {
  const def = shopDef(shopId);
  if (!def.goods.includes(good)) throw new Error(`${shopId} does not trade ${good}`);
  if (!(units >= 0)) throw new Error(`Bad trade unit count ${units}`);
  const delta = def.pressurePerUnit * units * (direction === 'buy' ? 1 : -1);
  const next = (state.pressure[good] ?? 0) + delta;
  state.pressure[good] = Math.max(-PRESSURE_MAX, Math.min(PRESSURE_MAX, next));
}

// Removes and returns a stocked part. Throws if the shop has none with that id (IV5).
export function takeStockPart(state: ShopState, partId: string): PartInstance {
  const index = state.stock.findIndex((part) => part.id === partId);
  if (index < 0) throw new Error(`No part ${partId} in stock`);
  const [part] = state.stock.splice(index, 1);
  return part;
}

// Adds a part to stock, as when a shop buys a spare from a seller (IV5).
export function addStockPart(state: ShopState, part: PartInstance): void {
  state.stock.push(part);
}

// Contracts. Shops post them; rewards follow the effort model.

export type Contract =
  | { id: string; shop: string; kind: 'haul'; good: string; units: number; to: string; reward: number; xp: number; deadline: number; tier: Tier }
  | { id: string; shop: string; kind: 'fetch'; defId: string; reward: number; xp: number; deadline: number; tier: Tier }
  | { id: string; shop: string; kind: 'bounty'; target: string; targetName: string; reward: number; xp: number; deadline: number; tier: Tier };

// Estimated turns to travel between two points: straight distance stretched to a road-like route,
// at cruise speed, plus the turns spent handling the stop.
export function estimateTurns(from: Vec, to: Vec): number {
  return (dist(from, to) * EFFORT.routeFactor) / EFFORT.refSpeed + EFFORT.handlingTurns;
}

// Reward for turns of estimated work at a tier's wage, times the kind's factor. A haul reward also
// carries a small cut of the goods' value (0 for a fetch or bounty, which call with cargoValue 0).
export function contractReward(kind: Contract['kind'], turns: number, tier: Tier, cargoValue: number): number {
  const commission = kind === 'haul' ? cargoValue * CONTRACTS.haul.valueShare : 0;
  return Math.round(turns * EFFORT.wage[tier] * CONTRACTS[kind].rewardFactor + commission);
}

// Picks a tier uniformly. The effort model gives every tier a wage; nothing yet biases which tier a
// shop offers, so PH8 can skew this once the harness has real data.
function rollTier(world: World): Tier {
  return randInt(world.marketRng, 1, 3) as Tier;
}

type RollInput = {
  shop: { id: string; pos: Vec };
  places: { id: string; pos: Vec }[];
  goods: string[];
  partDefIds: string[];
  raiders: Vehicle[];
};

function pick<T>(world: World, list: T[]): T {
  return list[randInt(world.marketRng, 0, list.length - 1)];
}

function possibleKinds(input: RollInput): Contract['kind'][] {
  const kinds: Contract['kind'][] = [];
  if (input.places.length > 0 && input.goods.length > 0) kinds.push('haul');
  if (input.partDefIds.length > 0) kinds.push('fetch');
  if (input.raiders.length > 0) kinds.push('bounty');
  return kinds;
}

function rollHaul(world: World, input: RollInput, id: string, tier: Tier): Contract {
  const to = pick(world, input.places);
  const good = pick(world, input.goods);
  const units = randInt(world.marketRng, CONTRACTS.haul.units[0], CONTRACTS.haul.units[1]);
  const turns = estimateTurns(input.shop.pos, to.pos);
  const reward = contractReward('haul', turns, tier, 0);
  const deadline = world.turn + Math.round(turns * CONTRACTS.haul.durationFactor);
  return { id, shop: input.shop.id, kind: 'haul', good, units, to: to.id, reward, xp: Math.round(reward * CONTRACTS.haul.xpPerReward), deadline, tier };
}

function rollFetch(world: World, input: RollInput, id: string, tier: Tier): Contract {
  const defId = pick(world, input.partDefIds);
  const turns = randInt(world.marketRng, CONTRACTS.fetch.durationTurns[0], CONTRACTS.fetch.durationTurns[1]);
  const reward = contractReward('fetch', turns, tier, 0);
  return { id, shop: input.shop.id, kind: 'fetch', defId, reward, xp: Math.round(reward * CONTRACTS.fetch.xpPerReward), deadline: world.turn + turns, tier };
}

function rollBounty(world: World, input: RollInput, id: string, tier: Tier): Contract {
  const target = pick(world, input.raiders);
  const turns = randInt(world.marketRng, CONTRACTS.bounty.durationTurns[0], CONTRACTS.bounty.durationTurns[1]);
  const reward = contractReward('bounty', turns, tier, 0);
  return { id, shop: input.shop.id, kind: 'bounty', target: target.id, targetName: target.name, reward, xp: Math.round(reward * CONTRACTS.bounty.xpPerReward), deadline: world.turn + turns, tier };
}

const ROLLS = { haul: rollHaul, fetch: rollFetch, bounty: rollBounty };

// Draws one contract for a shop, from the kinds it can currently offer. A kind with nothing to draw
// from (no other places for a haul, no part defs for a fetch, no living raiders for a bounty) is
// skipped. Returns null when no kind is possible.
export function rollContract(
  world: World,
  shop: { id: string; pos: Vec },
  places: { id: string; pos: Vec }[],
  goods: string[],
  partDefIds: string[],
  raiders: Vehicle[],
): Contract | null {
  const input = { shop, places, goods, partDefIds, raiders };
  const kinds = possibleKinds(input);
  if (kinds.length === 0) return null;
  const kind = pick(world, kinds);
  const tier = rollTier(world);
  return ROLLS[kind](world, input, newId(world, 'ct'), tier);
}

export function isExpired(world: World, c: Contract): boolean {
  return world.turn > c.deadline;
}

// True when this turn's events show the player's kill of the bounty's target.
export function bountyFulfilled(events: GameEvent[], c: Contract, playerVehicleId: string): boolean {
  if (c.kind !== 'bounty') throw new Error(`${c.kind} contract has no bounty target`);
  return events.some((e) => e.t === 'destroyed' && e.vehicle === c.target && e.by === playerVehicleId);
}

// True once the bounty's target is gone from the world. Check bountyFulfilled for the same turn
// first: once a bounty is fulfilled, the completed contract is removed, so this never runs on it.
export function bountyLapsed(world: World, c: Contract): boolean {
  if (c.kind !== 'bounty') throw new Error(`${c.kind} contract has no bounty target`);
  return !world.vehicles.some((v) => v.id === c.target);
}

// Owed share of the haul's goods value if its deadline passes.
export function haulPenalty(c: Extract<Contract, { kind: 'haul' }>, goodValue: number): number {
  return Math.round(c.units * goodValue * CONTRACTS.haul.penaltyShare);
}

// World wiring: every shop's state lives in world.shops, keyed by shop id.

function shopPos(shopId: string): Vec {
  return siteOf(shopId).pos;
}

export function shopState(world: World, shopId: string): ShopState {
  const state = world.shops[shopId];
  if (!state) throw new Error(`Unknown shop ${shopId}`);
  return state;
}

// Tops a shop's board up to its contract slots. Haul targets are the other shops that trade the good.
function fillBoard(world: World, shopId: string, state: ShopState): void {
  const def = shopDef(shopId);
  const places = Object.keys(SHOPS).filter((id) => id !== shopId).map((id) => ({ id, pos: shopPos(id) }));
  const partDefIds = Object.keys(PARTS).filter((id) => PARTS[id].kind !== 'core');
  const raiders = world.vehicles.filter((v) => v.faction === 'raiders');
  while (state.contracts.length < def.contractSlots) {
    const contract = rollContract(world, { id: shopId, pos: shopPos(shopId) }, places, def.goods, partDefIds, raiders);
    if (!contract) return;
    state.contracts.push(contract);
  }
}

// The market stream starts from the world seed mixed with a fixed salt, so it differs from the main stream.
const MARKET_SALT = 0x6d61726b;

export function marketStream(seed: number): Rng {
  return { rngState: seed ^ MARKET_SALT };
}

export function initializeShops(world: World): void {
  world.shops = {};
  for (const shopId of Object.keys(SHOPS)) {
    const state = initShop(world, shopId);
    world.shops[shopId] = state;
    fillBoard(world, shopId, state);
  }
}

// Drift and restock every shop. A restock also drops stale offers and refills the board.
export function advanceShops(world: World): void {
  for (const [shopId, state] of Object.entries(world.shops)) {
    const restockAt = state.restockAt;
    advanceShop(world, shopId, state);
    if (state.restockAt === restockAt) continue;
    state.contracts = state.contracts.filter((c) => !isExpired(world, c) && offerStillValid(world, c));
    fillBoard(world, shopId, state);
  }
}

function offerStillValid(world: World, c: Contract): boolean {
  return c.kind !== 'bounty' || !bountyLapsed(world, c);
}

// The shop the parked player truck can use, or null.
export function shopAt(world: World): string | null {
  const v = playerVehicle(world);
  if (v.speed > RULES.parkedSpeed) return null;
  return Object.keys(SHOPS).find((id) => canUseSite(v.pos, siteOf(id))) ?? null;
}

export function siteOf(shopId: string): Site {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === shopId);
  if (!site) throw new Error(`Shop ${shopId} has no site in the region`);
  return site;
}

function requireShop(world: World, shopId: string): void {
  if (shopAt(world) !== shopId) throw new Error(`Not parked at ${shopId}`);
}

// Takes an offer from the board of the shop the player is parked at. A haul loads its goods now.
export function acceptContract(world: World, contractId: string): World {
  return playerCommand(world, (w) => {
    const shopId = shopAt(w);
    if (!shopId) throw new Error('Not parked at a shop');
    const board = shopState(w, shopId).contracts;
    const contract = board.find((c) => c.id === contractId);
    if (!contract) throw new Error(`No contract ${contractId} at ${shopId}`);
    if (w.player.contracts.length >= CONTRACTS.maxActive) throw new Error(`You already hold ${CONTRACTS.maxActive} contracts`);
    if (contract.kind === 'haul') loadHaul(w, contract);
    board.splice(board.indexOf(contract), 1);
    w.player.contracts.push(contract);
    w.events.push({ t: 'contract', contract: { ...contract }, outcome: 'accepted' });
  });
}

// Hauled goods count as paid at the value a missed deadline charges, so selling them teaches no trade.
function loadHaul(world: World, c: Extract<Contract, { kind: 'haul' }>): void {
  const v = playerVehicle(world);
  if (freeCells(v) < c.units) throw new Error(`Needs ${c.units} free cells for the cargo`);
  const held = goodsCount(v)[c.good] ?? 0;
  if (addGoods(world, v, c.good, c.units) !== c.units) throw new Error('Cargo capacity invariant failed');
  const paid = world.player.costBasis[c.good] ?? 0;
  world.player.costBasis[c.good] = (paid * held + goodValue(c.good) * c.units) / (held + c.units);
}

// Hands in a haul at its destination or a fetch at the shop that posted it. Bounties pay on the kill.
export function deliverContract(world: World, contractId: string): World {
  return playerCommand(world, (w) => {
    const contract = w.player.contracts.find((c) => c.id === contractId);
    if (!contract) throw new Error(`No active contract ${contractId}`);
    if (contract.kind === 'bounty') throw new Error('A bounty pays when the target is destroyed');
    if (contract.kind === 'haul') handInHaul(w, contract);
    else handInFetch(w, contract);
    finishContract(w, contract, 'done');
  });
}

function handInHaul(world: World, c: Extract<Contract, { kind: 'haul' }>): void {
  requireShop(world, c.to);
  const v = playerVehicle(world);
  if ((goodsCount(v)[c.good] ?? 0) < c.units) throw new Error(`Needs ${c.units} ${GOODS[c.good].name}`);
  removeGoods(v, c.good, c.units);
}

function handInFetch(world: World, c: Extract<Contract, { kind: 'fetch' }>): void {
  requireShop(world, c.shop);
  const v = playerVehicle(world);
  const spare = spareParts(v).find((p) => p.defId === c.defId);
  if (spare) {
    v.items = v.items.filter((it) => it.kind !== 'part' || it.part.id !== spare.id);
    return;
  }
  const stored = world.player.storage.findIndex((p) => p.defId === c.defId);
  if (stored < 0) throw new Error(`Needs a spare ${PARTS[c.defId].name}`);
  world.player.storage.splice(stored, 1);
}

// Ends an active contract. Done pays the reward and the contract's XP to Social; failed charges the haul penalty, debt allowed.
function finishContract(world: World, c: Contract, outcome: 'done' | 'failed' | 'lapsed'): void {
  world.player.contracts = world.player.contracts.filter((x) => x.id !== c.id);
  world.events.push({ t: 'contract', contract: { ...c }, outcome });
  if (outcome === 'done') {
    world.player.money += c.reward;
    world.events.push({ t: 'money', amount: c.reward, reason: 'contract' });
    practice(world, 'contract', c.xp, null, c.shop);
  }
  if (outcome === 'failed' && c.kind === 'haul') {
    const penalty = haulPenalty(c, goodValue(c.good));
    world.player.money -= penalty;
    world.events.push({ t: 'money', amount: -penalty, reason: 'failed haul contract' });
  }
}

// Settles bounties from this turn's kills and ends contracts past their deadline or target.
export function advanceContracts(world: World): void {
  for (const c of [...world.player.contracts]) {
    const outcome = contractOutcome(world, c);
    if (outcome) finishContract(world, c, outcome);
  }
}

function contractOutcome(world: World, c: Contract): 'done' | 'failed' | 'lapsed' | null {
  if (c.kind === 'bounty' && bountyFulfilled(world.events, c, world.player.vehicleId)) return 'done';
  if (c.kind === 'bounty' && bountyLapsed(world, c)) return 'lapsed';
  return isExpired(world, c) ? 'failed' : null;
}
