// A scripted player for the progression recorder. Each turn it picks the player's commands for one archetype and
// applies them through the public command functions, like the UI would. It keeps no state of its own: every choice
// follows from the world, so the same world always gets the same commands. The bot is a policy, not the NPC brain.
// It reuses the NPC upkeep thresholds, so it services when an NPC driver would.

import { chassisDef } from '../../data/chassis';
import { ECONOMY, GOOD_IDS } from '../../data/goods';
import { NPC_BEHAVIOR, NPC_UPKEEP } from '../../data/npcs';
import { partDef } from '../../data/parts';
import { REGION, type TownDef } from '../../data/region';
import { RULES } from '../../data/rules';
import { ENGINE_HEAT } from '../../data/wear';
import { TOPICS, type TopicId } from '../../data/dialogue';
import { maxHp, partValue } from '../wear';
import { inCombat, isHostile } from '../combat';
import { hostileToPlayer, playerCanAct, setAutoFire, setAutoRepair, setMoveOrder } from '../world';
import { playerVehicle, vehicleById } from '../damage';
import { isKnockedOut } from '../defeat';
import { callVehicle, chooseOption, currentOptions } from '../dialogue';
import { offeredSurrenderBy } from '../parley';
import { hashRandom } from '../rng';
import { affordableBuyCount, buyGood, buyStockPart, buySupply, partTradePrice, getTradePrice, repairAll, repairCost, sellGood, sellPart, supplyRoom } from '../economy';
import { findSpot, freeCells, goodsCount, gridOf, isMounted, itemCells, MOUNT_CELLS, mountedParts, type Spot } from '../grid';
import { stowSpot, storePart } from '../inventory';
import { acceptContract, deliverContract, estimateTurns, shopAt, shopState, siteOf, type Contract } from '../market';
import { SHOPS } from '../../data/market';
import { heatAt } from '../sun';
import { canLoot, downedHere, salvageHere, takeAllLoot } from '../locations';
import { getUpkeepReserve, isWeak, ownDanger, perceiveDanger } from '../npc-decisions';
import { canReachSalvage, hasSalvage, lootBlocker, takeError, takeFromTruck } from '../salvage';
import { startSearch } from '../search';
import { canUseSite, nearestPad, nearestTown, sitePads, townAt, type Site } from '../sites';
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

// Traders and scavengers earn with cargo room, so their gear never takes it.
const CARGO_GEAR: UpgradeStyle = { skip: [], chassis: 'value', keepRoom: true };
const GEAR_STYLES: Record<Goal, UpgradeStyle> = {
  trader: CARGO_GEAR,
  scavenger: CARGO_GEAR,
  hunter: { skip: [], chassis: 'value', keepRoom: false },
  fastTrader: { skip: ['armor'], chassis: 'speed', keepRoom: true },
};

// markovTurns is how many turns the markov bot keeps one goal. It is required for that bot and ignored by the others.
// tolerateStalls is for the recorder: NPC stalls count in the rows instead of failing the run.
export type BotOptions = { markovTurns?: number; tolerateStalls?: boolean };

// The markov draws come from their own hash of the run seed, so they never shift the world's randomness.
const MARKOV_SALT = 0x6d61726b;

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPES as readonly string[]).includes(value);
}

// The player's commands for this turn. A knocked-out or towed player gets none, and turns still run.
export function botOrders(world: World, archetype: Archetype, options: BotOptions = {}): BotTurn {
  const o = new Orders(world);
  const goal = goalOf(world, archetype, options);
  answerCall(o, goal === 'hunter' ? HUNTER_REPLIES : DEFENDER_REPLIES);
  if (playerCanAct(o.world)) {
    keepSwitches(o);
    act(o, goal);
  }
  return { world: o.world, events: o.events, ledger: o.ledger };
}

// A hold, a service stop and a fight each take the turn's command before the goal does.
function act(o: Orders, goal: Goal): void {
  if (holds(o) || serviceTrip(o, GEAR_STYLES[goal]) || defend(o)) return;
  GOALS[goal](o);
}

// Whether the truck stands still for a reason: a job or a patch deal under way, a stop at a town, or a knockout.
// The recorder does not count these turns as a stall.
export function parkedOnPurpose(world: World): boolean {
  if (world.player.state === 'knockedOut') return true;
  return playerVehicle(world).job !== null || patchDeal(world) !== null || shopAt(world) !== null;
}

function goalOf(world: World, archetype: Archetype, options: BotOptions): Goal {
  if (archetype !== 'markov') return archetype;
  const { markovTurns } = options;
  if (markovTurns === undefined || !Number.isInteger(markovTurns) || markovTurns <= 0) throw new Error(`The markov bot needs markovTurns as a positive whole number, got ${markovTurns}`);
  const stretch = Math.floor((world.turn - 1) / markovTurns);
  return GOALS_PLAYED[Math.floor(hashRandom(world.seed ^ MARKOV_SALT, stretch) * GOALS_PLAYED.length)];
}

// ---- Calls and switches.

// Replies that differ from the first one of a topic. Every bot defends against a demand for its cargo. The hunter also
// refuses a truce and answers a plea for mercy with a demand to be stripped.
const DEFENDER_REPLIES: Partial<Record<TopicId, string>> = { demand: 'Come and get it.' };
const HUNTER_REPLIES: Partial<Record<TopicId, string>> = { ...DEFENDER_REPLIES, truceOffer: 'No. We finish this.', mercyPlea: 'Stand down and let me strip your truck.' };

// Every open call gets the first reply of each topic, unless the bot's replies name another. On the hub, the bot hangs
// up, which is the last option.
function answerCall(o: Orders, replies: Partial<Record<TopicId, string>> = DEFENDER_REPLIES): void {
  const seen = new Set<string>();
  for (let call = o.world.player.call; call; call = o.world.player.call) {
    const at = `${call.with}:${call.topic}:${call.node}`;
    if (seen.has(at)) throw new Error(`Bot call loops back to ${at}`);
    seen.add(at);
    const pick = call.topic ? Math.max(0, currentOptions(o.world).findIndex((option) => option.text === replies[call.topic!])) : currentOptions(o.world).length - 1;
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
  const shop = shopAt(o.world);
  if (shop) {
    serviceInTown(o, style, shop);
    return false;
  }
  if (!paidFixNeeded(o.world)) return false;
  driveToSite(o, nearestShop(o.world));
  return true;
}

function serviceInTown(o: Orders, style: UpgradeStyle, shop: string): void {
  serviceHere(o);
  restoreEngine(o, shop);
  if (paidFixNeeded(o.world)) throw new Error(`Town service left a need the bot can pay for, with ${o.world.player.money} money: ${needsOf(o.world)}`);
  upgradeGear(o, style);
}

function needsOf(world: World): string {
  const p = world.player;
  const me = playerVehicle(world);
  return `shop ${shopAt(world)}, fuel ${p.fuel}/${fuelCap(me)} for way ${fuelForWayToShop(world).toFixed(1)}, supplies ${p.supplies}/${suppliesCap(me)}, repair ${repairCost(world)}, badly damaged ${mountedParts(me).filter(isBadlyDamaged).map((part) => part.defId).join(' ')}, combat ${inCombat(world, me)}, engine ${mountedParts(me, 'engine').length}`;
}

function paidFixNeeded(world: World): boolean {
  return needsService(world) || canRestoreEngine(world);
}

// The shop it stands at, else the nearest shop, must stock an engine the money covers. A guess from engine prices
// alone sent the bot back to a shop that had none it could afford, again and again.
function canRestoreEngine(world: World): boolean {
  if (mountedParts(playerVehicle(world), 'engine').length > 0) return false;
  return stockEngine(world, shopAt(world) ?? nearestShop(world).id) !== null;
}

// The cheapest engine a shop stocks that the bot can afford.
function stockEngine(world: World, shopId: string): PartInstance | null {
  const me = playerVehicle(world);
  const engines = shopState(world, shopId).stock.filter((p) => partDef(p.defId).kind === 'engine')
    .map((part) => ({ part, price: partTradePrice(world, me, part, 'buy') }))
    .filter((e) => e.price <= world.player.money)
    .sort((a, b) => a.price - b.price);
  return engines[0]?.part ?? null;
}

// Buys and mounts the cheapest engine the shop it stands at stocks, when the truck has none and the money covers it.
// Cargo on the engine mount is sold to make room.
function restoreEngine(o: Orders, shopId: string): void {
  const engine = mountedParts(o.me, 'engine').length === 0 ? stockEngine(o.world, shopId) : null;
  if (!engine) return;
  if (!engineSpot(o.me, engine.defId) && hasCargo(o.world, o.me)) sellCargo(o);
  const spot = engineSpot(o.me, engine.defId);
  if (!spot) throw new Error(`No free engine mount for a new engine. On the engine cells: ${onEngineCells(o.me)}`);
  o.run((w) => buyStockPart(w, engine.id), 'gear');
  mountBought(o, engine.id, spot);
}

function onEngineCells(v: Vehicle): string {
  const g = gridOf(v);
  const onEngine = (it: GridItem) => itemCells(it).some((c) => MOUNT_CELLS.engine.includes(g.cells[c.y]?.[c.x] ?? '.'));
  const names = v.items.filter(onEngine).map((it) => (it.kind === 'part' ? `${it.part.defId} hp ${it.part.hp}${isMounted(v.chassisId, it) ? ' mounted' : ''}` : `good ${it.good}`));
  return names.length > 0 ? names.join(', ') : 'nothing';
}

function engineSpot(v: Vehicle, defId: string): Spot | null {
  const probe: GridItem = { id: 'engine-probe', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'engine-probe', defId, hp: 0, wear: 0 } };
  return findSpot(gridOf(v), v.items, probe, MOUNT_CELLS.engine, null);
}

// Every shop is a place to fuel, the two towns and the stalls between them: a tank holds only about 160 tiles, and the
// towns lie further apart than that.
const SHOP_SITES: readonly Site[] = Object.keys(SHOPS).map(siteOf);

function nearestShop(world: World): Site {
  const pos = playerVehicle(world).pos;
  return [...SHOP_SITES].sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0];
}

// The fuel the straight way to the nearest shop takes at the heat where the truck stands, times the reserve an NPC
// driver keeps for it. The bot heads for a shop once its tank holds no more.
function fuelForWayToShop(world: World): number {
  const me = playerVehicle(world);
  return dist(me.pos, nearestShop(world).pos) * vehicleStats(world, me).fuelPerTile * heatAt(world, me.pos) * NPC_UPKEEP.fuelReserve;
}

function needsService(world: World): boolean {
  const p = world.player;
  const me = playerVehicle(world);
  const lowFuel = p.fuel <= Math.max(fuelCap(me) * RULES.lowFuelThreshold, fuelForWayToShop(world)) && p.money >= ECONOMY.supplyPrice.fuel;
  const lowSupplies = p.supplies <= suppliesCap(me) * NPC_UPKEEP.lowSupplies && p.money >= ECONOMY.supplyPrice.supplies;
  return lowFuel || lowSupplies || needsRepair(world);
}

// A badly damaged part the money covers, once the fight is over: repairing under fire pays for the next hit. A junk
// part no garage can rebuild has no repair, so it adds nothing to the cost.
function needsRepair(world: World): boolean {
  const me = playerVehicle(world);
  const cost = repairCost(world);
  return mountedParts(me).some(isBadlyDamaged) && cost > 0 && cost <= world.player.money && !inCombat(world, me);
}

function isBadlyDamaged(part: PartInstance): boolean {
  return part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition;
}

// Fills fuel and supplies as far as the money goes, then repairs everything if the money covers it and no fight is on.
function serviceHere(o: Orders): void {
  for (const kind of ['fuel', 'supplies'] as const) {
    const n = Math.min(supplyRoom(o.world, kind), Math.floor(o.world.player.money / ECONOMY.supplyPrice[kind]));
    if (n > 0) o.run((w) => buySupply(w, kind, n), kind);
  }
  const cost = repairCost(o.world);
  if (cost > 0 && cost <= o.world.player.money && !inCombat(o.world, o.me)) o.run(repairAll, 'repairs');
}

// ---- Goals.

const GOALS: Record<Goal, (o: Orders) => void> = { trader: traderGoal, scavenger: scavengerGoal, hunter: hunterGoal, fastTrader: traderGoal };

// A trader with too little money for a load, and every town known, scavenges until it can buy one. Salvage never
// grows back, so a bot with neither left waits in the nearest town.
function traderGoal(o: Orders): void {
  const held = heldHaul(o.world);
  if (held) return carryHaul(o, held);
  if (!trade(o) && !takeHaul(o) && !scavenge(o)) checkNextBoard(o);
}

// ---- Haul contracts: paid work for a trader too poor for a load. The contract loads its goods free.

type Haul = Extract<Contract, { kind: 'haul' }>;

function heldHaul(world: World): Haul | null {
  return world.player.contracts.find((c): c is Haul => c.kind === 'haul') ?? null;
}

// Drives the goods to the contract's shop and hands them in.
function carryHaul(o: Orders, haul: Haul): void {
  if (shopAt(o.world) === haul.to) o.run((w) => deliverContract(w, haul.id), 'contracts');
  else driveToSite(o, siteOf(haul.to));
}

// Takes the haul on the board here that pays most per estimated turn of the trip, if one fits the truck.
function takeHaul(o: Orders): boolean {
  const shop = shopAt(o.world);
  if (!shop || o.world.player.money < 0) return false;
  const here = siteOf(shop).pos;
  const pay = (c: Haul) => c.reward / estimateTurns(here, siteOf(c.to).pos);
  const offers = shopState(o.world, shop).contracts.filter((c): c is Haul => c.kind === 'haul' && c.deadline > o.world.turn && c.units <= freeCells(o.me));
  const best = offers.reduce<Haul | null>((top, c) => (!top || pay(c) > pay(top) ? c : top), null);
  if (best) o.run((w) => acceptContract(w, best.id));
  return best !== null;
}

// With nothing it can do here, a bot looks at the board of the nearest other shop.
function checkNextBoard(o: Orders): void {
  const here = shopAt(o.world);
  const others = SHOP_SITES.filter((s) => s.id !== here);
  const pos = o.me.pos;
  const next = others.reduce((best, s) => (dist(pos, s.pos) < dist(pos, best.pos) ? s : best));
  driveToSite(o, next);
}

// A scavenger with no stock left to search and no salvage site left to find trades instead, or waits in town.
function scavengerGoal(o: Orders): void {
  if (!scavenge(o) && !trade(o)) driveToSite(o, nearestTown(o.world));
}

type Purchase = { town: TownDef; good: string; count: number; profit: number };

// The trader sells what it carries in the known town that pays most for it, then buys the good with the most profit
// between known towns that it can afford above its upkeep reserve and repair bill. With no such trade it drives to find a new town.
// Returns false when it has nothing to do: no affordable trade and every town known.
function trade(o: Orders): boolean {
  if (hasCargo(o.world, o.me) && !sellAtMarket(o)) return true;
  const buy = bestPurchase(o.world);
  if (buy) return buyThere(o, buy);
  const town = nearestUndiscovered(o.world, REGION.towns);
  if (!town) return false;
  driveToSite(o, town);
  return true;
}

function buyThere(o: Orders, buy: Purchase): true {
  if (townAt(o.world)?.id !== buy.town.id) driveToSite(o, buy.town);
  else o.run((w) => buyGood(w, buy.good, buy.count), 'goodsBought');
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
  const cargo = Object.entries(cargoForSale(world, playerVehicle(world)));
  const profit = (town: TownDef) => cargo.reduce((sum, [good, n]) => sum + n * (sellAt(world, town, good) - (world.player.costBasis[good] ?? 0)), 0);
  return byDistance(world, knownTowns(world)).reduce((best, town) => (profit(town) > profit(best) ? town : best));
}

// The money for a full repair stays out of the load, so a trader leaves town with a sound truck.
function bestPurchase(world: World): Purchase | null {
  const spend = world.player.money - getUpkeepReserve(playerVehicle(world)) - repairCost(world);
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
  if (townAt(o.world) && hasCargo(o.world, o.me)) sellCargo(o);
  lootHere(o);
  const stock = freeCells(o.me) > 0 ? nearestStock(o.world, knownStocks(o.world)) : null;
  if (stock) visitStock(o, stock);
  else if (hasCargo(o.world, o.me)) driveToSite(o, nearestTown(o.world));
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
// it sees, sells in town when full and otherwise patrols the roads between the shops.
function hunterGoal(o: Orders): void {
  if (townAt(o.world) && hasCargo(o.world, o.me)) sellCargo(o);
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

// A refit job cannot start in combat, and one truck loots a wreck at a time.
function canStripNow(o: Orders, target: Vehicle): boolean {
  return !inCombat(o.world, o.me) && !lootBlocker(o.world, o.me, target.id);
}

// Takes one item from the knocked-out truck beside it, or drives beside the nearest one in sight that has loot to take.
// True when this turn's command went to the strip.
function stripDowned(o: Orders): boolean {
  const here = downedHere(o.world);
  const pick = here && canStripNow(o, here) ? nextLoot(o.me, here) : null;
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
  const danger = new Map(seen.map((v) => [v.id, dangerOf(world, v)]));
  return seen.reduce<Vehicle | null>((best, v) => (!best || (danger.get(v.id) ?? 0) < (danger.get(best.id) ?? 0) ? v : best), null);
}

function dangerOf(world: World, foe: Vehicle): number {
  const rng = world.rngState;
  const danger = perceiveDanger(world, playerVehicle(world), foe);
  world.rngState = rng;
  return danger;
}

// A bot under fire turns on a foe it judges no more dangerous than itself, as an NPC does, so its guns bear. Against a
// stronger foe it keeps driving its goal at full speed toward a shop. True when the turn's command went to the fight.
function defend(o: Orders): boolean {
  if (!inCombat(o.world, o.me)) return false;
  const foe = weakestFoe(o.world);
  if (!foe || dangerOf(o.world, foe) > ownDanger(o.world, o.me)) return false;
  driveTo(o, foe.pos);
  return true;
}

// Calls a badly broken foe in sight and demands it stand down, once. A foe that agrees is knocked out where it stands
// and stripped like any knocked-out truck. True when the call was made.
function demandYield(o: Orders, foe: Vehicle): boolean {
  const asks = foe.brain !== null && isHostile(o.world, foe, o.me) && isWeak(o.world, foe) && !offeredSurrenderBy(o.world, foe, o.me);
  if (!asks) return false;
  o.run((w) => callVehicle(w, foe.id));
  const ask = currentOptions(o.world).findIndex((option) => option.text === TOPICS.yieldDemand.ask?.text);
  if (ask >= 0) o.run((w) => chooseOption(w, ask));
  answerCall(o, HUNTER_REPLIES);
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

// The hunter patrols the roads between the shops, where lone raiders prey on traders, and stays out of the camps, whose
// guard guns shoot it. It keeps driving to the shop it is bound for. Without one, it goes to the shop after the one
// nearest it, in data order.
function hunt(o: Orders): void {
  const order = o.me.order;
  if (order?.kind === 'stopAt' && SHOP_SITES.some((s) => sitePads(s).some((p) => p.x === order.dest.x && p.y === order.dest.y))) return;
  const here = SHOP_SITES.indexOf(nearestShop(o.world));
  driveTo(o, nearestPad(SHOP_SITES[(here + 1) % SHOP_SITES.length], o.me.pos));
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

// Goods to sell: all but the parts kept for field repairs, as an NPC keeps them, and the goods of a haul contract.
function cargoForSale(world: World, v: Vehicle): Record<string, number> {
  const goods = { ...goodsCount(v) };
  for (const c of world.player.contracts) if (c.kind === 'haul') goods[c.good] = (goods[c.good] ?? 0) - c.units;
  const parts = Math.max(0, (goods.parts ?? 0) - NPC_UPKEEP.repairParts);
  const forSale = { ...goods, parts };
  return Object.fromEntries(Object.entries(forSale).filter(([, n]) => n > 0));
}

function spareItems(v: Vehicle): { itemId: string; partId: string }[] {
  return v.items.flatMap((it) => (it.kind === 'part' && !isMounted(v.chassisId, it) ? [{ itemId: it.id, partId: it.part.id }] : []));
}

function hasCargo(world: World, v: Vehicle): boolean {
  return Object.keys(cargoForSale(world, v)).length > 0 || spareItems(v).length > 0;
}

// Sells the goods for sale, and sells spare parts through garage storage.
function sellCargo(o: Orders): void {
  for (const [good, n] of Object.entries(cargoForSale(o.world, o.me))) o.run((w) => sellGood(w, good, n), 'goodsSold');
  for (const { itemId, partId } of spareItems(o.me)) {
    o.run((w) => storePart(w, itemId));
    o.run((w) => sellPart(w, partId), 'lootSales');
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
