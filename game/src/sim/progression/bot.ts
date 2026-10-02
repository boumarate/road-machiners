// A scripted player for the progression recorder. Each turn it picks the player's commands for one archetype and
// applies them through the public command functions, like the UI would. It keeps no state of its own: every choice
// follows from the world, so the same world always gets the same commands. The bot is a policy, not the NPC brain.
// It reuses the NPC upkeep thresholds, so it services when an NPC driver would.

import { chassisDef } from '../../data/chassis';
import { ECONOMY, GOOD_IDS } from '../../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP } from '../../data/npcs';
import { PARTS, partDef } from '../../data/parts';
import { REGION, type TownDef } from '../../data/region';
import { RULES } from '../../data/rules';
import { CONDITION, ENGINE_HEAT } from '../../data/wear';
import { TOPICS } from '../../data/dialogue';
import { maxHp, partValue } from '../wear';
import { inCombat, isHostile } from '../combat';
import { hostileToPlayer, playerCanAct, setAutoFire, setAutoRepair, setMoveOrder } from '../world';
import { playerVehicle, vehicleById } from '../damage';
import { isKnockedOut } from '../defeat';
import { callVehicle, chooseOption, currentOptions } from '../dialogue';
import { offeredSurrenderBy } from '../parley';
import { hashRandom } from '../rng';
import { affordableBuyCount, buyGood, buyStockPart, buySupply, partTradePrice, getTradePrice, repairAll, repairCost, sellGood, sellPart, supplyRoom } from '../economy';
import { findSpot, freeCells, goodsCount, gridOf, isMounted, MOUNT_CELLS, mountedParts, type Spot } from '../grid';
import { stowSpot, storePart } from '../inventory';
import { shopAt, shopState } from '../market';
import { canLoot, downedHere, salvageHere, takeAllLoot } from '../locations';
import { getUpkeepReserve, isWeak, perceiveDanger, raiderGrounds } from '../npc-decisions';
import { canReachSalvage, hasSalvage, lootBlocker, takeError, takeFromTruck } from '../salvage';
import { startSearch } from '../search';
import { canUseSite, nearestPad, nearestTown, townAt, type Site } from '../sites';
import { fuelCap, isStranded, suppliesCap, vehicleStats } from '../stats';
import { inTowReach, setBeacon } from '../tow';
import type { GridItem, NpcState, PartInstance, SalvageStock, Vehicle, World } from '../types';
import { dist, type Vec } from '../vec';
import { playerExplored, playerSees } from '../vision';
import { mountBought, Orders, upgradeGear, type BotTurn, type UpgradeStyle } from './orders';

// Every bot plays the base loop: earn money, pay upkeep, buy upgrades, and shoot back when attacked. Only the hunter
// goes looking for fights. The fast trader wants speed and mounts no armor. The markov bot plays a random one of the
// others for a stretch of turns, then draws again.
export type Archetype = 'trader' | 'scavenger' | 'hunter' | 'fastTrader' | 'markov';
export const ARCHETYPES: readonly Archetype[] = ['trader', 'scavenger', 'hunter', 'fastTrader', 'markov'];
type Goal = Exclude<Archetype, 'markov'>;
const GOALS_PLAYED: readonly Goal[] = ['trader', 'scavenger', 'hunter', 'fastTrader'];

const VALUE_GEAR: UpgradeStyle = { skip: [], chassis: 'value' };
const GEAR_STYLES: Record<Goal, UpgradeStyle> = {
  trader: VALUE_GEAR,
  scavenger: VALUE_GEAR,
  hunter: VALUE_GEAR,
  fastTrader: { skip: ['armor'], chassis: 'speed' },
};

// markovTurns is how many turns the markov bot keeps one goal. It is required for that bot and ignored by the others.
export type BotOptions = { markovTurns?: number };

// The markov draws come from their own hash of the run seed, so they never shift the world's randomness.
const MARKOV_SALT = 0x6d61726b;

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPES as readonly string[]).includes(value);
}

// The player's commands for this turn. A knocked-out or towed player gets none, and turns still run.
export function botOrders(world: World, archetype: Archetype, options: BotOptions = {}): BotTurn {
  const o = new Orders(world);
  answerCall(o);
  if (playerCanAct(o.world)) {
    const goal = goalOf(o.world, archetype, options);
    keepSwitches(o);
    if (!holds(o) && !serviceTrip(o, GEAR_STYLES[goal])) GOALS[goal](o);
  }
  return { world: o.world, events: o.events };
}

// Whether the truck stands still for a reason: a job or a patch deal under way, a stop at a town, or a knockout.
// The recorder does not count these turns as a stall.
export function parkedOnPurpose(world: World): boolean {
  if (world.player.state === 'knockedOut') return true;
  return playerVehicle(world).job !== null || patchDeal(world) !== null || townAt(world) !== null;
}

function goalOf(world: World, archetype: Archetype, options: BotOptions): Goal {
  if (archetype !== 'markov') return archetype;
  const { markovTurns } = options;
  if (markovTurns === undefined || !Number.isInteger(markovTurns) || markovTurns <= 0) throw new Error(`The markov bot needs markovTurns as a positive whole number, got ${markovTurns}`);
  const stretch = Math.floor((world.turn - 1) / markovTurns);
  return GOALS_PLAYED[Math.floor(hashRandom(world.seed ^ MARKOV_SALT, stretch) * GOALS_PLAYED.length)];
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
function serviceTrip(o: Orders, style: UpgradeStyle): boolean {
  if (isStranded(o.world, o.me) && !o.world.player.beacon) o.run((w) => setBeacon(w, true));
  if (townAt(o.world)) {
    serviceInTown(o, style);
    return false;
  }
  if (!paidFixNeeded(o.world)) return false;
  driveToSite(o, nearestTown(o.world));
  return true;
}

function serviceInTown(o: Orders, style: UpgradeStyle): void {
  serviceHere(o);
  restoreEngine(o);
  if (paidFixNeeded(o.world)) throw new Error(`Town service left a need the bot can pay for, with ${o.world.player.money} money`);
  upgradeGear(o, style);
}

function paidFixNeeded(world: World): boolean {
  return needsService(world) || canRestoreEngine(world);
}

// In a shop, an engine it stocks must be affordable. Out of town, the bot knows no stock, so the money must cover
// the cheapest engine's price at its most worn.
function canRestoreEngine(world: World): boolean {
  if (mountedParts(playerVehicle(world), 'engine').length > 0) return false;
  return shopAt(world) ? stockEngine(world) !== null : world.player.money >= cheapestEngineValue();
}

function cheapestEngineValue(): number {
  return Math.min(...Object.values(PARTS).filter((d) => d.kind === 'engine').map((d) => d.value * CONDITION.valueFactor[CONDITION.maxWear]));
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

function engineSpot(v: Vehicle, defId: string): Spot | null {
  const probe: GridItem = { id: 'engine-probe', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'engine-probe', defId, hp: 0, wear: 0 } };
  return findSpot(gridOf(v), v.items, probe, MOUNT_CELLS.engine, null);
}

function needsService(world: World): boolean {
  const p = world.player;
  const me = playerVehicle(world);
  const lowFuel = p.fuel <= fuelCap(me) * RULES.lowFuelThreshold && p.money >= ECONOMY.supplyPrice.fuel;
  const lowSupplies = p.supplies <= suppliesCap(me) * NPC_UPKEEP.lowSupplies && p.money >= ECONOMY.supplyPrice.supplies;
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

const GOALS: Record<Goal, (o: Orders) => void> = { trader: traderGoal, scavenger: scavengerGoal, hunter: hunterGoal, fastTrader: traderGoal };

// A trader with too little money for a load, and every town known, scavenges until it can buy one. Salvage never
// grows back, so a bot with neither left waits in the nearest town.
function traderGoal(o: Orders): void {
  if (!trade(o) && !scavenge(o)) driveToSite(o, nearestTown(o.world));
}

// A scavenger with no stock left to search and no salvage site left to find trades instead, or waits in town.
function scavengerGoal(o: Orders): void {
  if (!scavenge(o) && !trade(o)) driveToSite(o, nearestTown(o.world));
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
  // The player starts knowing no town, so the first market is the nearest town it finds.
  const market = knownTowns(o.world).length > 0 ? bestMarket(o.world) : nearestUndiscovered(o.world, REGION.towns)!;
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

// The hunter strips a knocked-out truck it sees of its parts and goods. It drives at the weakest hostile it sees and
// demands it stand down once it is badly broken. With no foe in sight it follows the nearest it hears, loots the wrecks
// it sees, sells in town when full and otherwise drives to the nearest raider hunting ground.
function hunterGoal(o: Orders): void {
  if (townAt(o.world) && hasCargo(o.me)) sellCargo(o);
  if (stripDowned(o) || engageFoe(o)) return;
  lootHere(o);
  collectOrHunt(o);
}

// Demands the weakest foe in sight stand down when it is broken, or else drives at it, or at the nearest one heard.
// True when this turn's command went to a foe.
function engageFoe(o: Orders): boolean {
  const foe = weakestFoe(o.world);
  if (foe && demandYield(o, foe)) return true;
  const spot = foe?.pos ?? heardFoe(o.world);
  if (spot) driveTo(o, spot);
  return spot !== null;
}

// ---- Stripping knocked-out trucks.

// The best thing on a knocked-out truck that the bot can take and has room for: parts first by value, then goods.
function nextLoot(me: Vehicle, target: Vehicle): { item: GridItem; spot: Spot } | null {
  const worth = (it: GridItem) => (it.kind === 'part' ? partValue(it.part) : 0);
  for (const item of [...target.items].sort((a, b) => worth(b) - worth(a))) {
    const spot = takeError(target, item) === null ? stowSpot(me, item) : null;
    if (spot) return { item, spot };
  }
  return null;
}

// Takes one item from the knocked-out truck beside it, or drives beside the nearest one in sight that has loot to take.
// True when this turn's command went to the strip.
function stripDowned(o: Orders): boolean {
  const here = downedHere(o.world);
  const pick = here && !lootBlocker(o.world, o.me, here.id) ? nextLoot(o.me, here) : null;
  if (here && pick) {
    o.run((w) => takeFromTruck(w, here.id, pick.item.id, pick.spot));
    return true;
  }
  const seen = o.world.vehicles.filter((v) => v.id !== o.me.id && isKnockedOut(v) && playerSees(o.world, v.pos) && nextLoot(o.me, v) !== null);
  const target = nearestVehicle(o.me.pos, seen);
  if (target) driveTo(o, besideStop(o.world, target.pos, chassisDef(target.chassisId).radius));
  return target !== null;
}

// ---- Foes.

// The hostile truck it sees with the least danger, as the bot reads it. Reading danger rolls world randomness, so the
// roll is put back and the bot never shifts the NPCs' draws.
function weakestFoe(world: World): Vehicle | null {
  const me = playerVehicle(world);
  const seen = world.vehicles.filter((v) => v.id !== me.id && hostileToPlayer(world, v) && !isKnockedOut(v) && playerSees(world, v.pos));
  const rng = world.rngState;
  const danger = new Map(seen.map((v) => [v.id, perceiveDanger(world, me, v)]));
  world.rngState = rng;
  return seen.reduce<Vehicle | null>((best, v) => (!best || (danger.get(v.id) ?? 0) < (danger.get(best.id) ?? 0) ? v : best), null);
}

// Calls a badly broken foe in sight and demands it stand down, once. A foe that agrees is knocked out where it stands
// and stripped like any knocked-out truck. True when the call was made.
function demandYield(o: Orders, foe: Vehicle): boolean {
  const asks = foe.brain !== undefined && isHostile(o.world, foe, o.me) && isWeak(o.world, foe) && !offeredSurrenderBy(o.world, foe, o.me);
  if (!asks) return false;
  o.run((w) => callVehicle(w, foe.id));
  const ask = currentOptions(o.world).findIndex((option) => option.text === TOPICS.yieldDemand.ask?.text);
  if (ask >= 0) o.run((w) => chooseOption(w, ask));
  answerCall(o);
  return true;
}

// Where an unseen hostile is: the center of its contact circle. Nearest first.
function heardFoe(world: World): Vec | null {
  const me = playerVehicle(world);
  const hostile = world.vehicles.filter((v) => v.id !== me.id && hostileToPlayer(world, v));
  return nearest(me.pos, world.player.contacts.filter((c) => hostile.some((v) => v.id === c.vehicleId)).map((c) => c.center));
}

function nearestVehicle(from: Vec, vehicles: readonly Vehicle[]): Vehicle | null {
  return vehicles.reduce<Vehicle | null>((best, v) => (!best || dist(from, v.pos) < dist(from, best.pos) ? v : best), null);
}

function collectOrHunt(o: Orders): void {
  if (freeCells(o.me) === 0) return driveToSite(o, nearestTown(o.world));
  const wreck = nearestStock(o.world, knownStocks(o.world).filter((s) => s.id.startsWith('wreck-') && playerSees(o.world, s.pos)));
  if (wreck) return visitStock(o, wreck);
  hunt(o);
}

// Where raiders hunt: the grounds of every camp, in data order.
export function raiderHuntGrounds(): Vec[] {
  return REGION.locations.filter((site) => site.kind === 'camp').flatMap((camp) => raiderGrounds(camp));
}

// The fighter keeps driving to the hunting ground it is bound for. Without one, it goes to the ground after the one
// nearest it, in data order. A ground the truck cannot quite reach, like one a parked truck stands on, counts as
// visited once its stop order ends.
function hunt(o: Orders): void {
  const order = o.me.order;
  const grounds = raiderHuntGrounds();
  if (grounds.length === 0) throw new Error('no raider hunting ground to hunt on');
  if (order?.kind === 'stopAt' && grounds.some((g) => g.x === order.dest.x && g.y === order.dest.y)) return;
  const here = grounds.indexOf(nearest(o.me.pos, grounds) ?? grounds[0]);
  driveTo(o, grounds[(here + 1) % grounds.length]);
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
  const stock = salvageHere(o.world);
  if (!stock || !canLoot(o.world, stock.id) || freeCells(o.me) === 0) return;
  if (lootBlocker(o.world, o.me, stock.id)) return;
  o.run((w) => takeAllLoot(w, stock.id));
}

// A player cannot start a search with a hostile in sight or while another truck loots the stock, so the bot waits
// beside the stock and lets auto fire or the other looter finish.
function visitStock(o: Orders, stock: SalvageStock): void {
  if (canReachSalvage(o.me, stock)) {
    if (!inCombat(o.world, o.me) && !lootBlocker(o.world, o.me, stock.id)) o.run((w) => startSearch(w, stock.id));
    return;
  }
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

function nearest(from: Vec, points: readonly Vec[]): Vec | null {
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
