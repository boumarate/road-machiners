import { SALVAGE, type LootTable } from '../data/salvage';
import { ECONOMY } from '../data/goods';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { partDef } from '../data/parts';
import { PERK_NUMBERS } from '../data/skills';
import { makePart } from './factory';
import { goodsCount, isLoot, isMounted } from './grid';
import { addGoods, stowPart } from './inventory';
import { vehicleHasPerk } from './progress';
import { chance, randInt } from './rng';
import { vehicleStats } from './stats';
import type { GridItem, PartInstance, SalvageStock, Vehicle, World } from './types';
import { canUseSite } from './sites';
import { dist, type Vec } from './vec';

// Landmark and convoy sites, and the wrecks placed on roads, get finite stock at world creation,
// drawn from their loot table. A road wreck's stock shares its obstacle id.
export function initializeSalvage(world: World): void {
  const sites = REGION.locations
    .filter((site) => site.kind === 'convoy' || site.kind === 'landmark')
    .map((site) => rollStock(world, site.kind === 'convoy' ? SALVAGE.convoy : SALVAGE.landmark, site.id, site.pos, site.radius));
  const wrecks = world.obstacles
    .filter((o) => o.kind === 'wreck' && /^wreck\d+$/.test(o.id))
    .map((o) => rollStock(world, SALVAGE.roadWreck, o.id, o.pos, o.r * RULES.wreckRadiusScale));
  world.salvage = [...sites, ...wrecks];
}

function rollStock(world: World, table: LootTable, id: string, pos: Vec, radius: number): SalvageStock {
  const goods: Record<string, number> = {};
  for (const [good, [lo, hi]] of Object.entries(table.goods)) goods[good] = randInt(world, lo, hi);
  goods.parts = randInt(world, table.parts[0], table.parts[1]);
  const parts: PartInstance[] = [];
  if (chance(world, table.sparePartChance)) parts.push(makePart(world, table.spareParts[randInt(world, 0, table.spareParts.length - 1)]));
  return { id, pos: { ...pos }, radius, goods, parts };
}

export function hasSalvage(stock: SalvageStock): boolean {
  return stock.parts.length > 0 || Object.values(stock.goods).some((count) => count > 0);
}

// Total loot units left in a stock, goods and parts alike, for estimating a search's length.
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

// Moves at most `units` from the stock into the vehicle's grid. The stock never grows: whatever
// does not fit stays behind for the next turn or another collector.
export function collectSalvage(world: World, vehicle: Vehicle, stockId: string, units: number): number {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  if (!canReachSalvage(vehicle, stock)) throw new Error('Stop within salvage reach');
  let moved = 0;
  stock.parts = stock.parts.filter((part) => {
    if (moved >= units || !stowPart(world, vehicle, part)) return true;
    moved++;
    return false;
  });
  for (const [good, count] of Object.entries(stock.goods)) {
    if (moved >= units || count <= 0) continue;
    const want = Math.min(count, units - moved);
    const held = goodsCount(vehicle)[good] ?? 0;
    const took = addGoods(world, vehicle, good, want);
    stock.goods[good] -= took;
    if (took === 0) continue;
    moved += took;
    if (vehicle.id === world.player.vehicleId) world.player.costBasis[good] = ((world.player.costBasis[good] ?? 0) * held) / (held + took);
  }
  return moved;
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

// The careful strip perk: a part the player mounts from a wreck stock gains a share of its max HP, up to full.
export function stripPart(world: World, vehicle: Vehicle, stock: SalvageStock, part: PartInstance): void {
  if (!isWreckStock(stock) || !vehicleHasPerk(world, vehicle, 'carefulStrip')) return;
  const max = partDef(part.defId).hp;
  part.hp = Math.min(max, part.hp + Math.round(max * PERK_NUMBERS.carefulStrip.hp));
}

export function createWreckSalvage(world: World, vehicle: Vehicle): void {
  const goods = goodsCount(vehicle);
  const parts: PartInstance[] = [];
  let coreScrap = 0;
  for (const item of vehicle.items) {
    if (item.kind !== 'part') continue;
    if (partDef(item.part.defId).kind === 'core') coreScrap += Math.round(item.part.hp * SALVAGE.coreScrapPerHp);
    else parts.push(item.part);
  }
  if (coreScrap > 0) goods.parts = (goods.parts ?? 0) + coreScrap;
  addVehicleStock(world, vehicle, wreckStockId(vehicle.id), goods, parts);
  vehicle.items = vehicle.items.filter((item) => item.kind === 'part' && partDef(item.part.defId).kind === 'core');
}

// A knocked-out truck is stripped where it stands. Every loot item moves to a stock, and the
// built-in core parts stay mounted. The turn keeps the id unique over repeated knockouts.
export function createKnockoutSalvage(world: World, vehicle: Vehicle): void {
  const loot = vehicle.items.filter((item) => isLoot(vehicle.chassisId, item));
  const goods: Record<string, number> = {};
  const parts: PartInstance[] = [];
  for (const item of loot) {
    if (item.kind === 'good') goods[item.good] = (goods[item.good] ?? 0) + 1;
    else parts.push(item.part);
  }
  addVehicleStock(world, vehicle, knockoutStockId(vehicle.id, world.turn), goods, parts);
  vehicle.items = vehicle.items.filter((item) => !loot.includes(item));
}

// A truck that hands over its cargo drops `goodsShare` of each good, rounded down, and every loose part where it
// stands. Mounted parts stay.
export function createCargoSalvage(world: World, vehicle: Vehicle, goodsShare: number): SalvageStock {
  const cargo = cargoItems(vehicle, goodsShare);
  const goods: Record<string, number> = {};
  const parts: PartInstance[] = [];
  for (const item of cargo) {
    if (item.kind === 'good') goods[item.good] = (goods[item.good] ?? 0) + 1;
    else parts.push(item.part);
  }
  addVehicleStock(world, vehicle, `cargo-${vehicle.id}-${world.turn}`, goods, parts);
  vehicle.items = vehicle.items.filter((item) => !cargo.includes(item));
  return world.salvage[world.salvage.length - 1];
}

// The items a handover drops: `goodsShare` of each good, rounded down, and every loose part.
function cargoItems(vehicle: Vehicle, goodsShare: number): GridItem[] {
  if (!(goodsShare >= 0 && goodsShare <= 1)) throw new Error(`Cargo share ${goodsShare} is not in [0, 1]`);
  const quota: Record<string, number> = {};
  for (const [good, count] of Object.entries(goodsCount(vehicle))) quota[good] = Math.floor(count * goodsShare);
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

function addVehicleStock(world: World, vehicle: Vehicle, id: string, goods: Record<string, number>, parts: PartInstance[]): void {
  if (world.salvage.some((stock) => stock.id === id)) throw new Error(`Duplicate wreck salvage ${id}`);
  world.salvage.push({ id, pos: { ...vehicle.pos }, radius: vehicleStats(world, vehicle).radius * RULES.wreckRadiusScale, goods, parts });
}
