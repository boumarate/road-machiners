// A scripted player for the progression recorder. Each turn it picks the player's commands for one archetype and
// applies them through the public command functions, like the UI would. It keeps no state of its own: every choice
// follows from the world, so the same world always gets the same commands. The bot is a policy, not the NPC brain.
// It reuses the NPC upkeep thresholds, so it services when an NPC driver would.

import { chassisDef } from '../../data/chassis';
import { ECONOMY, GOOD_IDS } from '../../data/goods';
import { HUNTING_GROUNDS, NPC_BEHAVIOR, NPC_UPKEEP } from '../../data/npcs';
import { partDef } from '../../data/parts';
import { REGION, type TownDef } from '../../data/region';
import { RULES } from '../../data/rules';
import { ENGINE_HEAT } from '../../data/wear';
import { maxHp } from '../wear';
import { hostileToPlayer, playerCanAct, setAutoFire, setAutoRepair, setMoveOrder } from '../world';
import { playerVehicle, vehicleById } from '../damage';
import { chooseOption, currentOptions } from '../dialogue';
import { affordableBuyCount, buyGood, buyStockPart, buySupply, partTradePrice, getTradePrice, repairAll, repairCost, sellGood, sellPart, supplyRoom } from '../economy';
import { findSpot, freeCells, goodsCount, gridOf, isMounted, MOUNT_CELLS, mountedParts, type Spot } from '../grid';
import { moveItem, storePart, takeFromStorage } from '../inventory';
import { shopAt, shopState } from '../market';
import { canLoot, salvageHere, takeAllLoot } from '../locations';
import { getUpkeepReserve } from '../npc-decisions';
import { canReachSalvage, hasSalvage } from '../salvage';
import { startSearch } from '../search';
import { canUseSite, nearestPad, nearestTown, townAt, type Site } from '../sites';
import { isStranded, vehicleStats } from '../stats';
import { clockOf } from '../sun';
import { inTowReach, setBeacon } from '../tow';
import type { GameEvent, GridItem, NpcState, PartInstance, SalvageStock, Vehicle, World } from '../types';
import { dist, type Vec } from '../vec';
import { playerExplored, playerSees } from '../vision';

export type Archetype = 'trader' | 'scavenger' | 'fighter' | 'mixed';
export const ARCHETYPES: readonly Archetype[] = ['trader', 'scavenger', 'fighter', 'mixed'];
type Goal = Exclude<Archetype, 'mixed'>;
// The mixed bot plays one goal per in-game day, in this order.
const MIXED_ROTATION: readonly Goal[] = ['trader', 'scavenger', 'fighter'];
// The world after the bot's commands, and every event those commands raised.
export type BotTurn = { world: World; events: GameEvent[] };

// Applies commands one after another and keeps the events of each.
class Orders {
  readonly events: GameEvent[] = [];
  constructor(public world: World) {}

  run(command: (w: World) => World): void {
    this.world = command(this.world);
    this.events.push(...this.world.events);
  }

  get me(): Vehicle {
    return playerVehicle(this.world);
  }
}

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPES as readonly string[]).includes(value);
}

// The player's commands for this turn. A knocked-out or towed player gets none, and turns still run.
export function botOrders(world: World, archetype: Archetype): BotTurn {
  const o = new Orders(world);
  answerCall(o);
  if (playerCanAct(o.world)) {
    const goal = goalOf(o.world, archetype);
    keepSwitches(o);
    if (!holds(o) && !serviceTrip(o)) GOALS[goal](o);
  }
  return { world: o.world, events: o.events };
}

// Whether the truck stands still for a reason: a job or a patch deal under way, a stop at a town, or a knockout.
// The recorder does not count these turns as a stall.
export function parkedOnPurpose(world: World): boolean {
  if (world.player.state === 'knockedOut') return true;
  return playerVehicle(world).job !== null || patchDeal(world) !== null || townAt(world) !== null;
}

function goalOf(world: World, archetype: Archetype): Goal {
  if (archetype !== 'mixed') return archetype;
  return MIXED_ROTATION[(clockOf(world.turn).day - 1) % MIXED_ROTATION.length];
}

// ---- Calls and switches.

// Every open call gets the first reply of each topic. On the hub, the bot hangs up, which is the last option.
function answerCall(o: Orders): void {
  const seen = new Set<string>();
  for (let call = o.world.player.call; call; call = o.world.player.call) {
    const at = `${call.with}:${call.topic}:${call.node}`;
    if (seen.has(at)) throw new Error(`Bot call loops back to ${at}`);
    seen.add(at);
    const pick = call.topic ? 0 : currentOptions(o.world).length - 1;
    o.run((w) => chooseOption(w, pick));
  }
}

// Auto patch and auto fire stay on for every bot, so every bot shoots back at hostiles like a player would. Only
// the fighter drives at them.
function keepSwitches(o: Orders): void {
  if (!o.world.player.autoRepair) o.run((w) => setAutoRepair(w, true));
  if (!o.world.player.autoFire) o.run((w) => setAutoFire(w, true));
}

// ---- Holding still: jobs, a hot engine and patch deals.

// True when the truck must not drive this turn, after any command the hold needs.
function holds(o: Orders): boolean {
  if (o.me.job) return true;
  // A hot engine cools while parked. The bot stops at the warning, as the warning tells the player to.
  if (o.world.player.engineHeat >= ENGINE_HEAT.warnAt) {
    if (o.me.order) o.run((w) => setMoveOrder(w, null));
    return true;
  }
  const deal = patchDeal(o.world);
  if (!deal) return false;
  workPatch(o, deal);
  return true;
}

function patchDeal(world: World): NpcState | null {
  const id = world.player.vehicleId;
  return world.states.find((s) => s.kind === 'patch' && (s.holder === id || s.other === id)) ?? null;
}

// The patcher drives up to its stranded client. Then both stay parked while the work runs.
function workPatch(o: Orders, deal: NpcState): void {
  const client = vehicleById(o.world, deal.other);
  if (deal.holder === o.me.id && !inTowReach(o.me, client)) driveTo(o, besideStop(o.world, client.pos, chassisDef(client.chassisId).radius));
  else if (o.me.order) o.run((w) => setMoveOrder(w, null));
}

// ---- Service.

// In town the bot tops up, repairs and buys an engine if a knockout stripped its own. Out of town with low fuel, low
// supplies, a badly damaged part or no engine, and the money to fix it, it drives to the nearest town. A need it
// cannot pay for does not send it to town, so a poor bot drives on to earn, crawling if it must. A stranded truck
// also turns its beacon on and takes the first tow offered on the radio. Returns true when the trip to town is this
// turn's order.
function serviceTrip(o: Orders): boolean {
  if (isStranded(o.world, o.me) && !o.world.player.beacon) o.run((w) => setBeacon(w, true));
  if (townAt(o.world)) {
    serviceInTown(o);
    return false;
  }
  if (!paidFixNeeded(o.world)) return false;
  driveToSite(o, nearestTown(o.world));
  return true;
}

function serviceInTown(o: Orders): void {
  serviceHere(o);
  restoreEngine(o);
  if (paidFixNeeded(o.world)) throw new Error(`Town service left a need the bot can pay for, with ${o.world.player.money} money`);
}

function paidFixNeeded(world: World): boolean {
  return needsService(world) || canRestoreEngine(world);
}

function canRestoreEngine(world: World): boolean {
  return mountedParts(playerVehicle(world), 'engine').length === 0 && stockEngine(world) !== null;
}

// The cheapest engine the parked garage stocks that the bot can afford.
function stockEngine(world: World): PartInstance | null {
  const shopId = shopAt(world);
  if (!shopId) return null;
  const me = playerVehicle(world);
  const engines = shopState(world, shopId).stock.filter((p) => partDef(p.defId).kind === 'engine')
    .map((part) => ({ part, price: partTradePrice(world, me, part, 'buy') }))
    .filter((e) => e.price <= world.player.money)
    .sort((a, b) => a.price - b.price);
  return engines[0]?.part ?? null;
}

// Buys and mounts the start kit's engine when the truck has none and the money covers it. Cargo on the engine mount
// is sold to make room.
function restoreEngine(o: Orders): void {
  const engine = canRestoreEngine(o.world) ? stockEngine(o.world) : null;
  if (!engine) return;
  if (!engineSpot(o.me, engine.defId) && hasCargo(o.me)) sellCargo(o);
  const spot = engineSpot(o.me, engine.defId);
  if (!spot) throw new Error('No free engine mount for a new engine');
  o.run((w) => buyStockPart(w, engine.id));
  mountBought(o, engine.id, spot);
}

// A bought part lands in garage storage or loose in the grid; either way it moves onto the spot.
function mountBought(o: Orders, partId: string, spot: Spot): void {
  if (o.world.player.storage.some((p) => p.id === partId)) o.run((w) => takeFromStorage(w, partId, spot));
  else o.run((w) => moveItem(w, itemOf(w, partId), spot));
}

function itemOf(world: World, partId: string): string {
  const item = playerVehicle(world).items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item) throw new Error(`Bought part ${partId} is not on the truck`);
  return item.id;
}

function engineSpot(v: Vehicle, defId: string): Spot | null {
  const probe: GridItem = { id: 'engine-probe', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'engine-probe', defId, hp: 0, reload: 0, wear: 0 } };
  return findSpot(gridOf(v), v.items, probe, MOUNT_CELLS.engine, null);
}

function needsService(world: World): boolean {
  const p = world.player;
  const me = playerVehicle(world);
  const lowFuel = p.fuel <= chassisDef(me.chassisId).fuelCap * NPC_UPKEEP.lowFuel && p.money >= ECONOMY.supplyPrice.fuel;
  const lowSupplies = p.supplies <= RULES.suppliesCap * NPC_UPKEEP.lowSupplies && p.money >= ECONOMY.supplyPrice.supplies;
  const damaged = mountedParts(me).some(isBadlyDamaged) && repairCost(world) <= p.money;
  return lowFuel || lowSupplies || damaged;
}

function isBadlyDamaged(part: PartInstance): boolean {
  return part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition;
}

// Fills fuel and supplies as far as the money goes, then repairs everything if the money covers it.
function serviceHere(o: Orders): void {
  for (const kind of ['fuel', 'supplies'] as const) {
    const n = Math.min(supplyRoom(o.world, kind), Math.floor(o.world.player.money / ECONOMY.supplyPrice[kind]));
    if (n > 0) o.run((w) => buySupply(w, kind, n));
  }
  const cost = repairCost(o.world);
  if (cost > 0 && cost <= o.world.player.money) o.run(repairAll);
}

// ---- Goals.

const GOALS: Record<Goal, (o: Orders) => void> = { trader: traderGoal, scavenger: scavengerGoal, fighter: fight };

// A trader with too little money for a load, and every town known, scavenges until it can buy one.
function traderGoal(o: Orders): void {
  if (!trade(o) && !scavenge(o)) throw new Error(`Trader bot can neither trade nor scavenge, with ${o.world.player.money} money`);
}

// A scavenger with no stock left to search and no salvage site left to find trades instead.
function scavengerGoal(o: Orders): void {
  if (!scavenge(o) && !trade(o)) throw new Error(`Scavenger bot can neither scavenge nor trade, with ${o.world.player.money} money`);
}

type Purchase = { town: TownDef; good: string; count: number; profit: number };

// The trader sells what it carries in the known town that pays most for it, then buys the good with the most profit
// between known towns that it can afford above its upkeep reserve. With no such trade it drives to find a new town.
// Returns false when it has nothing to do: no affordable trade and every town known.
function trade(o: Orders): boolean {
  if (hasCargo(o.me) && !sellAtMarket(o)) return true;
  const buy = bestPurchase(o.world);
  if (buy) return buyThere(o, buy);
  const town = nearestUndiscovered(o.world, REGION.towns);
  if (!town) return false;
  driveToSite(o, town);
  return true;
}

function buyThere(o: Orders, buy: Purchase): true {
  if (townAt(o.world)?.id !== buy.town.id) driveToSite(o, buy.town);
  else o.run((w) => buyGood(w, buy.good, buy.count));
  return true;
}

// Sells the cargo in its best market, or drives there. True once the cargo is sold.
function sellAtMarket(o: Orders): boolean {
  const market = bestMarket(o.world);
  if (townAt(o.world)?.id !== market.id) {
    driveToSite(o, market);
    return false;
  }
  sellCargo(o);
  return true;
}

// The known town where the cargo for sale brings the most profit over what it cost. Nearest first on a tie.
function bestMarket(world: World): TownDef {
  const cargo = Object.entries(cargoForSale(playerVehicle(world)));
  const profit = (town: TownDef) => cargo.reduce((sum, [good, n]) => sum + n * (sellAt(world, town, good) - (world.player.costBasis[good] ?? 0)), 0);
  return byDistance(world, knownTowns(world)).reduce((best, town) => (profit(town) > profit(best) ? town : best));
}

function bestPurchase(world: World): Purchase | null {
  const spend = world.player.money - getUpkeepReserve(playerVehicle(world));
  const towns = knownTowns(world);
  const options = towns.flatMap((source) => towns.filter((t) => t.id !== source.id).flatMap((market) => GOOD_IDS.map((good) => purchase(world, { source, market, good, spend }))));
  return options.reduce<Purchase | null>((best, p) => (p.count > 0 && p.profit > (best?.profit ?? 0) ? p : best), null);
}

// Buying as much of a good at the source as fits and the money allows, to sell at the market.
function purchase(world: World, { source, market, good, spend }: { source: TownDef; market: TownDef; good: string; spend: number }): Purchase {
  const me = playerVehicle(world);
  const buy = getTradePrice(world, me, source.id, good, 'buy');
  const count = affordableBuyCount(world, me, source.id, good, freeCells(me), spend);
  return { town: source, good, count, profit: (sellAt(world, market, good) - buy) * count };
}

function sellAt(world: World, town: TownDef, good: string): number {
  return getTradePrice(world, playerVehicle(world), town.id, good, 'sell');
}

// The scavenger loots what it searched, searches the nearest known stock it has not searched, and sells in the
// nearest town when its cargo is full or no stock is left. With nothing left to search it drives to find a new
// salvage site. Returns false when it has nothing to do: no stock, no cargo and no site left to find.
function scavenge(o: Orders): boolean {
  if (townAt(o.world) && hasCargo(o.me)) sellCargo(o);
  lootHere(o);
  const stock = freeCells(o.me) > 0 ? nearestStock(o.world, knownStocks(o.world)) : null;
  if (stock) visitStock(o, stock);
  else if (hasCargo(o.me)) driveToSite(o, nearestTown(o.world));
  else return findSalvageSite(o);
  return true;
}

function findSalvageSite(o: Orders): boolean {
  const site = nearestUndiscovered(o.world, REGION.locations.filter((l) => l.kind === 'convoy' || l.kind === 'landmark'));
  if (!site) return false;
  driveToSite(o, site);
  return true;
}

// The fighter drives at the nearest hostile it sees or hears, loots the wrecks it sees, sells in town when full and
// otherwise drives to the nearest raider hunting ground.
function fight(o: Orders): void {
  if (townAt(o.world) && hasCargo(o.me)) sellCargo(o);
  const foe = nearestFoe(o.world);
  if (foe) return driveTo(o, foe);
  lootHere(o);
  collectOrHunt(o);
}

function collectOrHunt(o: Orders): void {
  if (freeCells(o.me) === 0) return driveToSite(o, nearestTown(o.world));
  const wreck = nearestStock(o.world, knownStocks(o.world).filter((s) => s.id.startsWith('wreck-') && playerSees(o.world, s.pos)));
  if (wreck) return visitStock(o, wreck);
  hunt(o);
}

// The fighter keeps driving to the hunting ground it is bound for. Without one, it goes to the ground after the one
// nearest it, in data order. A ground the truck cannot quite reach, like one a parked truck stands on, counts as
// visited once its stop order ends.
function hunt(o: Orders): void {
  const order = o.me.order;
  if (order?.kind === 'stopAt' && HUNTING_GROUNDS.some((g) => g.x === order.dest.x && g.y === order.dest.y)) return;
  const here = HUNTING_GROUNDS.indexOf(nearest(o.me.pos, HUNTING_GROUNDS) ?? HUNTING_GROUNDS[0]);
  driveTo(o, HUNTING_GROUNDS[(here + 1) % HUNTING_GROUNDS.length]);
}

// Where a hostile truck is: in sight, or at the center of its contact circle. Nearest first.
function nearestFoe(world: World): Vec | null {
  const me = playerVehicle(world);
  const hostile = world.vehicles.filter((v) => v.id !== me.id && hostileToPlayer(world, v));
  const seen = hostile.filter((v) => playerSees(world, v.pos)).map((v) => v.pos);
  const heard = world.player.contacts.filter((c) => hostile.some((v) => v.id === c.vehicleId)).map((c) => c.center);
  return nearest(me.pos, seen) ?? nearest(me.pos, heard);
}

// ---- Salvage.

// Stocks the player knows of that hold loot and that it has not searched: at a discovered site, or a wreck on
// explored ground.
function knownStocks(world: World): SalvageStock[] {
  return world.salvage.filter((stock) => {
    if (!hasSalvage(stock) || world.player.scavenged.includes(stock.id)) return false;
    const site = REGION.locations.find((l) => l.id === stock.id);
    return site ? world.player.discovered.includes(site.id) : playerExplored(world, stock.pos);
  });
}

function nearestStock(world: World, stocks: SalvageStock[]): SalvageStock | null {
  const pos = playerVehicle(world).pos;
  return stocks.reduce<SalvageStock | null>((best, s) => (!best || dist(pos, s.pos) < dist(pos, best.pos) ? s : best), null);
}

// Takes all that fits from a searched stock in reach.
function lootHere(o: Orders): void {
  if (!canLoot(o.world) || freeCells(o.me) === 0) return;
  const stock = salvageHere(o.world);
  if (!stock) throw new Error('A lootable stock is in reach but salvageHere found none');
  o.run((w) => takeAllLoot(w, stock.id));
}

function visitStock(o: Orders, stock: SalvageStock): void {
  if (canReachSalvage(o.me, stock)) return o.run((w) => startSearch(w, stock.id));
  const site = REGION.locations.find((l) => l.id === stock.id);
  driveTo(o, site ? nearestPad(site, o.me.pos) : besideStop(o.world, stock.pos, stock.radius));
}

// ---- Cargo.

// Goods to sell: all but the parts kept for field repairs, as an NPC keeps them.
function cargoForSale(v: Vehicle): Record<string, number> {
  const goods = goodsCount(v);
  const parts = Math.max(0, (goods.parts ?? 0) - NPC_UPKEEP.repairParts);
  const forSale = { ...goods, parts };
  return Object.fromEntries(Object.entries(forSale).filter(([, n]) => n > 0));
}

function spareItems(v: Vehicle): { itemId: string; partId: string }[] {
  return v.items.flatMap((it) => (it.kind === 'part' && !isMounted(v.chassisId, it) ? [{ itemId: it.id, partId: it.part.id }] : []));
}

function hasCargo(v: Vehicle): boolean {
  return Object.keys(cargoForSale(v)).length > 0 || spareItems(v).length > 0;
}

// Sells the goods for sale, and sells spare parts through garage storage.
function sellCargo(o: Orders): void {
  for (const [good, n] of Object.entries(cargoForSale(o.me))) o.run((w) => sellGood(w, good, n));
  for (const { itemId, partId } of spareItems(o.me)) {
    o.run((w) => storePart(w, itemId));
    o.run((w) => sellPart(w, partId));
  }
}

// ---- Driving.

function knownTowns(world: World): TownDef[] {
  return REGION.towns.filter((t) => world.player.discovered.includes(t.id));
}

function byDistance<T extends Site>(world: World, sites: T[]): T[] {
  const pos = playerVehicle(world).pos;
  return [...sites].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos));
}

function nearest(from: Vec, points: Vec[]): Vec | null {
  return points.reduce<Vec | null>((best, p) => (!best || dist(from, p) < dist(from, best) ? p : best), null);
}

function nearestUndiscovered<T extends Site>(world: World, sites: readonly T[]): T | null {
  return byDistance(world, sites.filter((s) => !world.player.discovered.includes(s.id)))[0] ?? null;
}

function driveToSite(o: Orders, site: Site): void {
  if (canUseSite(o.me.pos, site)) return;
  driveTo(o, nearestPad(site, o.me.pos));
}

// A stop just outside something round, on the side the truck comes from, like an NPC parks beside a stock.
function besideStop(world: World, center: Vec, radius: number): Vec {
  const me = playerVehicle(world);
  const out = radius + vehicleStats(world, me).radius + RULES.arriveRadius;
  const angle = Math.atan2(me.pos.y - center.y, me.pos.x - center.x);
  return { x: center.x + Math.cos(angle) * out, y: center.y + Math.sin(angle) * out };
}

// Gives a stop order unless the truck already has this one.
function driveTo(o: Orders, dest: Vec): void {
  const order = o.me.order;
  if (order?.kind === 'stopAt' && order.dest.x === dest.x && order.dest.y === dest.y) return;
  o.run((w) => setMoveOrder(w, { kind: 'stopAt', dest }));
}
