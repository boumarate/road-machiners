import { ECONOMY } from '../data/goods';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { makePart } from './factory';
import { goodsCount, mountedParts } from './grid';
import { addGoods, stowPart } from './inventory';
import { vehicleStats } from './stats';
import type { SalvageStock, Vehicle, World } from './types';
import { dist } from './vec';

export function initializeSalvage(world: World): void {
  world.salvage = REGION.locations.filter((site) => site.kind === 'convoy').map((site) => ({
    id: site.id, pos: { ...site.pos }, radius: site.radius,
    goods: { ...ECONOMY.scavenge.cargo }, parts: [makePart(world, ECONOMY.scavenge.part)],
  }));
}

export function hasSalvage(stock: SalvageStock): boolean {
  return stock.parts.length > 0 || Object.values(stock.goods).some((count) => count > 0);
}

export function canReachSalvage(vehicle: Vehicle, stock: SalvageStock): boolean {
  return vehicle.speed <= RULES.parkedSpeed && dist(vehicle.pos, stock.pos) <= (stock.radius + ECONOMY.useRange) * ECONOMY.interactionScale;
}

export function collectSalvage(world: World, vehicle: Vehicle, stockId: string): boolean {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  if (!canReachSalvage(vehicle, stock)) throw new Error('Stop within salvage reach');
  let moved = false;
  stock.parts = stock.parts.filter((part) => {
    if (!stowPart(world, vehicle, part)) return true;
    moved = true;
    return false;
  });
  for (const [good, count] of Object.entries(stock.goods)) {
    const held = goodsCount(vehicle)[good] ?? 0;
    const took = addGoods(world, vehicle, good, count);
    stock.goods[good] -= took;
    if (took === 0) continue;
    moved = true;
    if (vehicle.id === world.player.vehicleId) world.player.costBasis[good] = ((world.player.costBasis[good] ?? 0) * held) / (held + took);
  }
  return moved;
}

export function createWreckSalvage(world: World, vehicle: Vehicle): void {
  const id = `wreck-${vehicle.id}`;
  if (world.salvage.some((stock) => stock.id === id)) throw new Error(`Duplicate wreck salvage ${id}`);
  const mounted = new Set(mountedParts(vehicle).map((part) => part.id));
  const parts = vehicle.items.flatMap((item) => item.kind === 'part' && !mounted.has(item.part.id) ? [item.part] : []);
  world.salvage.push({ id, pos: { ...vehicle.pos }, radius: vehicleStats(world, vehicle).radius * RULES.wreckRadiusScale, goods: goodsCount(vehicle), parts });
  vehicle.items = vehicle.items.filter((item) => item.kind === 'part' && mounted.has(item.part.id));
}
