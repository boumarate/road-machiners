import { FIELD_SPARE_WEAR, SALVAGE, type LootRange, type LootTable } from '../data/salvage';
import { SHOPS } from '../data/market';
import { ECONOMY, GOODS } from '../data/goods';
import { REGION, type LocationDef } from '../data/region';
import { RULES } from '../data/rules';
import { TIME } from '../data/time';
import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { PERK_NUMBERS } from '../data/skills';
import { makePart, newId } from './factory';
import { findRoadWreckSpot } from './mapgen';
import { playerVehicle, vehicleById } from './damage';
import { isKnockedOut } from './defeat';
import { grayRadius } from './vision';
import { findSpot, goodsCount, gridOf, isLoot, isMounted, MOUNT_CELLS, type Spot } from './grid';
import { addGoods, getLayoutError, refitTurns, requireIdleRefit, stowPart } from './inventory';
import { vehicleHasPerk } from './progress';
import { chance, randInt } from './rng';
import { sampleWeighted } from './npc-loadout';
import { getResources } from './resources';
import { vehicleStats } from './stats';
import { cancelJob, startJob } from './jobs';
import type { GridItem, PartInstance, Pile, RefitPickup, SalvageStock, Vehicle, World } from './types';
import { canUseSite, townAt } from './sites';
import { inTowReach } from './tow';
import { playerCommand } from './world';
import { dist, type Vec } from './vec';
import { isJunk, maxHp, restorePart } from './wear';

// Landmark and convoy sites, and the wrecks placed on roads, get stock at world creation,
// drawn from their loot table. A road wreck's stock shares its obstacle id.
export function initializeSalvage(world: World): void {
  const sites = REGION.locations.flatMap((site) => {
    const table = siteLootTable(site);
    return table ? [rollStock(world, table, site.id, site.pos, site.radius)] : [];
  });
  const wrecks = world.obstacles.filter(isRoadWreck).map((o) => rollStock(world, SALVAGE.roadWreck, o.id, o.pos, o.r * RULES.wreckRadiusScale));
  world.salvage = [...sites, ...wrecks];
}

// The loot table of a site that holds salvage, or null. A site with a shop trades instead.
export function siteLootTable(site: LocationDef): LootTable | null {
  if (site.id in SHOPS) return null;
  if (site.kind === 'convoy') return SALVAGE.convoy;
  return site.kind === 'landmark' ? SALVAGE.landmark : null;
}

// A site's own stock, as opposed to a wreck or a pile.
export function isSiteStock(stock: SalvageStock): boolean {
  return REGION.locations.some((site) => site.id === stock.id);
}

// A wreck placed on a road, not one a destroyed truck left.
export function isRoadWreck(o: { id: string }): boolean {
  return /^wreck\d+$/.test(o.id);
}

// A spare part found in the field. Its wear draws from the market stream, so it leaves world RNG
// draws unchanged.
function fieldSpare(world: World, table: LootTable): PartInstance {
  const defId = table.spareParts[randInt(world, 0, table.spareParts.length - 1)];
  return makePart(world, defId, sampleWeighted(world.marketRng, FIELD_SPARE_WEAR));
}

export function rollStock(world: World, table: LootTable, id: string, pos: Vec, radius: number): SalvageStock {
  const goods: Record<string, number> = {};
  for (const [good, [lo, hi]] of Object.entries(table.goods)) goods[good] = randInt(world, lo, hi);
  goods.parts = randInt(world, table.parts[0], table.parts[1]);
  const parts: PartInstance[] = [];
  if (chance(world, table.sparePartChance)) parts.push(fieldSpare(world, table));
  return { id, pos: { ...pos }, radius, goods, parts, fuel: randInt(world, ...table.fuel), supplies: randInt(world, ...table.supplies) };
}

export function hasSalvage(stock: SalvageStock): boolean {
  return stock.parts.length > 0 || Object.values(stock.goods).some((count) => count > 0) || hasStores(stock);
}

// Whether a collect would move anything from the stock into the vehicle.
export function canTakeAny(world: World, vehicle: Vehicle, stock: SalvageStock): boolean {
  const room = storesRoom(world, vehicle);
  if ((['fuel', 'supplies'] as const).some((kind) => (stock[kind] ?? 0) > 0 && room[kind] > 0)) return true;
  const grid = gridOf(vehicle);
  const good: GridItem = { id: 'fit-check', x: 0, y: 0, rot: 0, kind: 'good', good: 'scrap' };
  if (Object.values(stock.goods).some((count) => count > 0) && findSpot(grid, vehicle.items, good, null, null)) return true;
  return stock.parts.some((part) => {
    const item: GridItem = { id: 'fit-check', x: 0, y: 0, rot: 0, kind: 'part', part };
    return findSpot(grid, vehicle.items, item, null, MOUNT_CELLS[partDef(part.defId).kind]) !== null;
  });
}

// Fuel or supplies left in the stock.
export function hasStores(stock: SalvageStock): boolean {
  return (stock.fuel ?? 0) > 0 || (stock.supplies ?? 0) > 0;
}

// Total loot units left in a stock, goods and parts alike, for estimating a search's length.
// Fuel and supplies pour out at once, so they add no search time.
export function salvageUnits(stock: SalvageStock): number {
  return stock.parts.length + Object.values(stock.goods).reduce((sum, count) => sum + count, 0);
}

// A parked vehicle in range of the stock.
export function canReachSalvage(vehicle: Vehicle, stock: SalvageStock): boolean {
  return vehicle.speed <= RULES.parkedSpeed && salvageInRange(vehicle, stock);
}

// Site stock follows its site's reach, so a site is searched from a pad. Wreck stock has no site.
export function salvageInRange(vehicle: Vehicle, stock: SalvageStock): boolean {
  const site = REGION.locations.find((l) => l.id === stock.id);
  return site ? canUseSite(vehicle.pos, site) : dist(vehicle.pos, stock.pos) <= (stock.radius + ECONOMY.useRange) * ECONOMY.interactionScale;
}

// Pours out fuel and supplies, then moves at most `units` from the stock into the vehicle's grid. The stock never grows: whatever
// does not fit stays behind for the next turn or another collector.
export function collectSalvage(world: World, vehicle: Vehicle, stockId: string, units: number): number {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  if (!canReachSalvage(vehicle, stock)) throw new Error('Stop within salvage reach');
  pourStores(world, vehicle, stock);
  let moved = 0;
  stock.parts = stock.parts.filter((part) => {
    if (moved >= units || !stowPart(world, vehicle, part)) return true;
    moved++;
    return false;
  });
  return collectGoods(world, vehicle, stock, units - moved) + moved;
}

// Moves up to `units` goods from a stock into the grid and returns how many moved.
function collectGoods(world: World, vehicle: Vehicle, stock: SalvageStock, units: number): number {
  let moved = 0;
  for (const [good, count] of Object.entries(stock.goods)) {
    if (moved >= units || count <= 0) continue;
    const want = Math.min(count, units - moved);
    const held = goodsCount(vehicle)[good] ?? 0;
    const took = addGoods(world, vehicle, good, want);
    stock.goods[good] -= took;
    moved += took;
    if (vehicle.id === world.player.vehicleId) takeBasis(world, stock, good, held, took);
  }
  return moved;
}

// The player's average paid for a good after taking `took` units from a stock while holding `held`.
export function takeBasis(world: World, stock: SalvageStock, good: string, held: number, took: number): void {
  addBasis(world, good, held, took, stockBasis(stock, good));
}

// The player's average paid for a good after gaining `took` units at `unit` each while holding `held`.
export function addBasis(world: World, good: string, held: number, took: number, unit: number): void {
  if (took === 0) return;
  const paid = world.player.costBasis[good] ?? 0;
  world.player.costBasis[good] = (paid * held + unit * took) / (held + took);
}

// What the player paid per unit of a good in a stock: the recorded average on the player's own pile. Loot
// from anywhere else counts at the good's base value, so selling it teaches Social only past that value.
function stockBasis(stock: SalvageStock, good: string): number {
  if (!stock.pile?.fromPlayer) return GOODS[good].value;
  const basis = stock.pile.basis[good];
  if (basis === undefined) throw new Error(`Player pile ${stock.id} has no cost basis for ${good}`);
  return basis;
}

// Pours the stock's fuel and supplies into the driver's tank and stores up to their caps.
// Whatever does not fit stays behind.
export function pourStores(world: World, vehicle: Vehicle, stock: SalvageStock): void {
  const resources = getResources(world, vehicle);
  const room = storesRoom(world, vehicle);
  for (const kind of ['fuel', 'supplies'] as const) {
    const took = Math.min(stock[kind] ?? 0, room[kind]);
    if (took <= 0) continue;
    resources[kind] += took;
    stock[kind] = (stock[kind] ?? 0) - took;
  }
}

function storesRoom(world: World, vehicle: Vehicle): { fuel: number; supplies: number } {
  const resources = getResources(world, vehicle);
  return {
    fuel: Math.max(0, chassisDef(vehicle.chassisId).fuelCap - resources.fuel),
    supplies: Math.max(0, RULES.suppliesCap - resources.supplies),
  };
}

// A wreck keeps its mounted non-core parts at their current HP. Built-in core parts are wrecked
// beyond mounting, so they turn into the parts good instead, at a data rate off their remaining HP.
// The stock a destroyed NPC leaves, and the stock a knocked-out player truck drops on a given turn.
export function wreckStockId(vehicleId: string): string {
  return `wreck-${vehicleId}`;
}

export function knockoutStockId(vehicleId: string, turn: number): string {
  return `wreck-${vehicleId}-${turn}`;
}

// A wreck stock: a road wreck, a destroyed truck or a knocked-out player truck.
function isWreckStock(stock: SalvageStock): boolean {
  return stock.id.startsWith('wreck');
}

// The careful strip perk: a part the player mounts from a wreck stock gains a share of its max HP, up to full. The
// player's own knockout pile is no wreck, or dumping a part back on it would repair it for free.
export function stripPart(world: World, vehicle: Vehicle, stock: SalvageStock, part: PartInstance): void {
  if (isWreckStock(stock) && !stock.pile?.fromPlayer) carefulStrip(world, vehicle, part);
}

// The careful strip perk on a part taken off a wreck or a knocked-out truck.
export function carefulStrip(world: World, vehicle: Vehicle, part: PartInstance): void {
  if (!vehicleHasPerk(world, vehicle, 'carefulStrip') || isJunk(part)) return;
  restorePart(part, part.hp + Math.round(maxHp(part) * PERK_NUMBERS.carefulStrip.hp));
}

export function createWreckSalvage(world: World, vehicle: Vehicle): void {
  const goods = goodsCount(vehicle);
  const parts: PartInstance[] = [];
  const core: PartInstance[] = [];
  for (const item of vehicle.items) {
    if (item.kind !== 'part') continue;
    if (partDef(item.part.defId).kind === 'core') core.push(item.part);
    else parts.push(item.part);
  }
  const coreScrap = coreWreckScrap(vehicle, core);
  if (coreScrap > 0) goods.parts = (goods.parts ?? 0) + coreScrap;
  addVehicleStock(world, vehicle, wreckStockId(vehicle.id), goods, parts);
  vehicle.items = vehicle.items.filter((item) => item.kind === 'part' && partDef(item.part.defId).kind === 'core');
}

// The parts good a wreck's destroyed built-in parts leave: a data share of the chassis's own value,
// scaled by how much HP those core parts still had, converted to units at the parts good's value.
function coreWreckScrap(vehicle: Vehicle, core: PartInstance[]): number {
  if (core.length === 0) return 0;
  const hpShare = core.reduce((sum, part) => sum + part.hp / maxHp(part), 0) / core.length;
  const value = chassisDef(vehicle.chassisId).value * SALVAGE.coreValueShare * hpShare;
  return Math.round(value / GOODS.parts.value);
}

// A knocked-out truck is stripped where it stands. Every loot item moves to a pile, and the
// built-in core parts stay mounted. The turn keeps a new pile's id unique over repeated knockouts.
export function createKnockoutSalvage(world: World, vehicle: Vehicle): SalvageStock {
  return dropOnPile(world, vehicle, vehicle.items.filter((item) => isLoot(vehicle.chassisId, item)), knockoutStockId(vehicle.id, world.turn));
}

// A truck that hands over its cargo drops `goodsShare` of each good, rounded up, and every loose part where it
// stands. Mounted parts stay. Rounding up means a handover of cargo never drops nothing.
export function createCargoSalvage(world: World, vehicle: Vehicle, goodsShare: number): SalvageStock {
  return dropOnPile(world, vehicle, cargoItems(vehicle, goodsShare), `cargo-${vehicle.id}-${world.turn}`);
}

// Throws one grid item out of the vehicle onto the ground.
export function dumpOnPile(world: World, vehicle: Vehicle, item: GridItem): SalvageStock {
  return dropOnPile(world, vehicle, [item], `dump-${vehicle.id}-${world.turn}`);
}

// The items a handover drops: `goodsShare` of each good, rounded up, and every loose part.
function cargoItems(vehicle: Vehicle, goodsShare: number): GridItem[] {
  if (!(goodsShare >= 0 && goodsShare <= 1)) throw new Error(`Cargo share ${goodsShare} is not in [0, 1]`);
  const quota: Record<string, number> = {};
  for (const [good, count] of Object.entries(goodsCount(vehicle))) quota[good] = Math.ceil(count * goodsShare);
  return vehicle.items.filter((item) => {
    if (item.kind === 'part') return !isMounted(vehicle.chassisId, item);
    if (quota[item.good] <= 0) return false;
    quota[item.good]--;
    return true;
  });
}

// Goods or loose parts a demand can ask for.
export function hasCargo(vehicle: Vehicle): boolean {
  return vehicle.items.some((item) => item.kind === 'good' || !isMounted(vehicle.chassisId, item));
}

function addVehicleStock(world: World, vehicle: Vehicle, id: string, goods: Record<string, number>, parts: PartInstance[]): SalvageStock {
  if (world.salvage.some((stock) => stock.id === id)) throw new Error(`Duplicate wreck salvage ${id}`);
  const stock: SalvageStock = { id, pos: { ...vehicle.pos }, radius: vehicleStats(world, vehicle).radius * RULES.wreckRadiusScale, goods, parts };
  world.salvage.push(stock);
  return stock;
}

// The pile a vehicle can reach, or null.
export function pileInReach(world: World, vehicle: Vehicle): SalvageStock | null {
  return world.salvage.find((stock) => stock.pile && salvageInRange(vehicle, stock)) ?? null;
}

// Moves items from the vehicle onto the pile in its reach, so nearby drops make one heap. Without one, a new
// pile starts where the vehicle stands under the given id. Each drop restarts the pile's clock.
function dropOnPile(world: World, vehicle: Vehicle, items: GridItem[], id: string): SalvageStock {
  const byPlayer = vehicle.id === world.player.vehicleId;
  const pile = world.salvage.find((stock) => stock.pile?.fromPlayer === byPlayer && salvageInRange(vehicle, stock))
    ?? addVehicleStock(world, vehicle, id, {}, []);
  const held = stampPile(world, byPlayer, pile);
  for (const item of items) {
    if (item.kind === 'good') dropGood(world, held, item.good);
    else pile.parts.push(item.part);
  }
  vehicle.items = vehicle.items.filter((item) => !items.includes(item));
  return pile;
}

// Each drop restarts the pile timer. A player pile holds the player's own items, so it counts as searched and pays
// no search XP.
function stampPile(world: World, byPlayer: boolean, stock: SalvageStock): { stock: SalvageStock; pile: Pile } {
  const pile: Pile = { until: world.turn + SALVAGE.pileTurns, fromPlayer: byPlayer, basis: stock.pile?.basis ?? {} };
  stock.pile = pile;
  if (byPlayer && !world.player.scavenged.includes(stock.id)) world.player.scavenged.push(stock.id);
  return { stock, pile };
}

// One unit of a good onto a pile. On a player pile it carries the player's average paid into the pile's average.
function dropGood(world: World, { stock, pile }: { stock: SalvageStock; pile: Pile }, good: string): void {
  const count = stock.goods[good] ?? 0;
  stock.goods[good] = count + 1;
  if (!pile.fromPlayer) return;
  const paid = world.player.costBasis[good] ?? 0;
  pile.basis[good] = ((pile.basis[good] ?? 0) * count + paid) / (count + 1);
}

// Piles that ran out of time or loot leave the ground.
export function clearPiles(world: World): void {
  removeStocks(world, new Set(world.salvage.filter((stock) => stock.pile && (world.turn >= stock.pile.until || !hasSalvage(stock))).map((stock) => stock.id)));
}

// Stocks that leave the world. Searches of them stop, and the player forgets them.
export function removeStocks(world: World, gone: Set<string>): void {
  if (gone.size === 0) return;
  for (const v of world.vehicles) if (v.job?.kind === 'search' && gone.has(v.job.stockId)) cancelJob(world, v);
  world.salvage = world.salvage.filter((stock) => !gone.has(stock.id));
  world.player.scavenged = world.player.scavenged.filter((id) => !gone.has(id));
}

// ---- Daily renewal. Sites slowly regain loot, and looted road wrecks give way to new ones beyond the player's gray
// vision, so nobody sees a wreck vanish or appear.

// Runs once a day, on the day's last turn.
export function renewSalvage(world: World): void {
  if (world.turn % TIME.turnsPerDay !== 0) return;
  for (const site of REGION.locations) {
    const table = siteLootTable(site);
    if (table) restockSite(world, siteStock(world, site.id), table);
  }
  turnOverRoadWrecks(world);
}

function siteStock(world: World, id: string): SalvageStock {
  const stock = world.salvage.find((entry) => entry.id === id);
  if (!stock) throw new Error(`Site ${id} has no salvage stock`);
  return stock;
}

// Each good, fuel and supplies regain a share of a fresh roll, up to the table's high. A site holds at most one
// spare part, and an empty slot refills at the same share of the table's spare part chance.
function restockSite(world: World, stock: SalvageStock, table: LootTable): void {
  for (const [good, range] of Object.entries({ ...table.goods, parts: table.parts })) stock.goods[good] = refill(world, stock.goods[good], range);
  stock.fuel = refill(world, stock.fuel, table.fuel);
  stock.supplies = refill(world, stock.supplies, table.supplies);
  if (stock.parts.length > 0 || !chance(world, table.sparePartChance * SALVAGE.restockShare)) return;
  stock.parts.push(fieldSpare(world, table));
}

// Each unit of a fresh roll comes back with chance restockShare. The high caps the gain, but a count already
// above it, such as one the scrounger perk raised, stays.
function refill(world: World, count: number | undefined, [lo, hi]: LootRange): number {
  const current = count ?? 0;
  let gain = 0;
  for (let unit = randInt(world, lo, hi); unit > 0; unit--) if (chance(world, SALVAGE.restockShare)) gain++;
  return Math.max(current, Math.min(hi, current + gain));
}

// A road wreck found looted starts its clock. Once it ran out, and the wreck lies beyond the player's gray vision,
// a new road wreck replaces it.
function turnOverRoadWrecks(world: World): void {
  for (const stock of world.salvage.filter(isRoadWreck)) {
    if (hasSalvage(stock)) continue;
    stock.emptySince ??= world.turn;
    if (world.turn - stock.emptySince < SALVAGE.wreckClearDays * TIME.turnsPerDay || inPlayerView(world, stock.pos)) continue;
    replaceRoadWreck(world, stock);
  }
}

function replaceRoadWreck(world: World, old: SalvageStock): void {
  removeStocks(world, new Set([old.id]));
  world.obstacles = world.obstacles.filter((o) => o.id !== old.id);
  const spot = findRoadWreckSpot(world, world.obstacles, (pos, r) => !inPlayerView(world, pos) && clearOfVehicles(world, pos, r));
  const id = newId(world, 'wreck');
  if (world.obstacles.some((o) => o.id === id)) throw new Error(`Duplicate road wreck ${id}`);
  world.obstacles.push({ id, ...spot, kind: 'wreck' });
  world.salvage.push(rollStock(world, SALVAGE.roadWreck, id, spot.pos, spot.r * RULES.wreckRadiusScale));
}

function inPlayerView(world: World, pos: Vec): boolean {
  return dist(playerVehicle(world).pos, pos) <= grayRadius(world, pos);
}

function clearOfVehicles(world: World, pos: Vec, r: number): boolean {
  return world.vehicles.every((v) => dist(v.pos, pos) > chassisDef(v.chassisId).radius + r);
}

// ---- Knocked-out NPC trucks. A truck parked in reach takes their goods and spare parts at once. An installed part
// comes off in a field refit: a refit job whose pickup names the truck. Built-in core parts stay on it. The player
// and NPC looters follow the same rules.

type TruckPickup = Extract<RefitPickup, { from: 'truck' }>;

// The looter is parked beside a knocked-out truck.
export function canLootTruck(looter: Vehicle, target: Vehicle): boolean {
  return looter.id !== target.id && isKnockedOut(target) && looter.speed <= RULES.parkedSpeed && inTowReach(looter, target);
}

// Why this item cannot leave the truck, or null. A built-in part stays, and a rack must be empty before it comes off.
export function takeError(target: Vehicle, item: GridItem): string | null {
  if (item.kind === 'part' && partDef(item.part.defId).kind === 'core' && isMounted(target.chassisId, item)) return 'Built-in parts stay on the truck';
  const left = getLayoutError(target, target.items.filter((it) => it.id !== item.id));
  return left ? 'Empty that rack first' : null;
}

// Refit turns to move an item off the truck onto a spot: one part-worth to unmount it and one to mount it.
function takeTurns(world: World, looter: Vehicle, target: Vehicle, item: GridItem, placed: GridItem): number {
  const planned = RULES.refitTurnsPerPart * (Number(isMounted(target.chassisId, item)) + Number(isMounted(looter.chassisId, placed)));
  const garage = looter.id === world.player.vehicleId && townAt(world) !== null;
  return planned > 0 && !garage ? refitTurns(world, looter, planned) : 0;
}

// Moves one item off the truck onto the looter's grid at `to`. Loose items move at once. An installed part, or a
// part placed on a mount, starts a field refit.
export function takeItem(world: World, looter: Vehicle, target: Vehicle, item: GridItem, to: Spot): void {
  const placed: GridItem = { ...item, id: newId(world, 'i'), ...to };
  const error = takeError(target, item) ?? getLayoutError(looter, [...looter.items, placed]);
  if (error) throw new Error(error);
  const work = takeTurns(world, looter, target, item, placed);
  if (work === 0) return moveNow(world, looter, target, item, placed);
  if (item.kind !== 'part') throw new Error('Only parts take a refit');
  const pickup: TruckPickup = { from: 'truck', vehicleId: target.id, partId: item.part.id, itemId: placed.id, to };
  startJob(world, looter, { kind: 'refit', moves: [], pickup, turnsLeft: work, total: work });
}

function moveNow(world: World, looter: Vehicle, target: Vehicle, item: GridItem, placed: GridItem): void {
  target.items = target.items.filter((it) => it.id !== item.id);
  if (placed.kind === 'good' && looter.id === world.player.vehicleId) addBasis(world, placed.good, goodsCount(looter)[placed.good] ?? 0, 1, GOODS[placed.good].value);
  looter.items.push(placed);
}

// The player command behind a drag from a knocked-out truck's grid.
export function takeFromTruck(world: World, targetId: string, itemId: string, to: Spot): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    const target = vehicleById(w, targetId);
    requireIdleRefit(me);
    if (!canLootTruck(me, target)) throw new Error('Park beside a knocked-out truck to loot it');
    const item = target.items.find((it) => it.id === itemId);
    if (!item) throw new Error(`No item ${itemId} on ${target.name}`);
    takeItem(w, me, target, item, to);
  });
}

// The part a running refit takes off the truck, at its new spot, or why the refit cannot go on.
export function truckPickupItem(world: World, looter: Vehicle, pickup: TruckPickup): GridItem | string {
  const target = world.vehicles.find((v) => v.id === pickup.vehicleId);
  if (!target || !canLootTruck(looter, target)) return 'The truck is no longer knocked out in reach';
  const item = target.items.find((it) => it.kind === 'part' && it.part.id === pickup.partId);
  if (item?.kind !== 'part') return 'The part is no longer on the truck';
  return { kind: 'part', id: pickup.itemId, part: item.part, ...pickup.to };
}

// A finished refit takes the part off the truck.
export function finishTruckPickup(world: World, looter: Vehicle, pickup: TruckPickup): void {
  const target = vehicleById(world, pickup.vehicleId);
  const item = target.items.find((it) => it.kind === 'part' && it.part.id === pickup.partId);
  if (item?.kind !== 'part') throw new Error('Truck part disappeared after validation');
  target.items = target.items.filter((it) => it.id !== item.id);
  if (isMounted(looter.chassisId, { ...item, ...pickup.to })) carefulStrip(world, looter, item.part);
}

// ---- NPC looters

// One turn of an NPC looting a parked-beside truck. Every loose item that fits comes over at once, then one
// installed part per refit, stowed as a spare. Returns why the loot ends, or null while work remains.
export function lootTruckTurn(world: World, looter: Vehicle, target: Vehicle): string | null {
  if (looter.job?.kind === 'refit') return null;
  takeLooseItems(world, looter, target);
  const next = nextInstalled(looter, target);
  if (!next) return target.items.some((it) => takeError(target, it) === null) ? 'cargo cannot hold the loot' : 'nothing left to loot';
  takeItem(world, looter, target, next.item, next.spot);
  return null;
}

function takeLooseItems(world: World, looter: Vehicle, target: Vehicle): void {
  for (const item of target.items.filter((it) => !isMounted(target.chassisId, it))) {
    const spot = spareSpot(looter, item);
    if (spot) takeItem(world, looter, target, item, spot);
  }
}

// The looter can take at least one more item from the truck.
export function canTakeFromTruck(looter: Vehicle, target: Vehicle): boolean {
  return target.items.some((it) => takeError(target, it) === null && spareSpot(looter, it) !== null);
}

function nextInstalled(looter: Vehicle, target: Vehicle): { item: GridItem; spot: Spot } | null {
  for (const item of target.items) {
    if (!isMounted(target.chassisId, item) || takeError(target, item)) continue;
    const spot = spareSpot(looter, item);
    if (spot) return { item, spot };
  }
  return null;
}

// A spot off the mounts, where a looted item rides as cargo.
function spareSpot(looter: Vehicle, item: GridItem): Spot | null {
  const avoid = item.kind === 'part' ? MOUNT_CELLS[partDef(item.part.defId).kind] : null;
  return findSpot(gridOf(looter), looter.items, { ...item, id: 'probe' }, null, avoid);
}
