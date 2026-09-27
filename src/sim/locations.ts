// Discovery, the oasis and scavenging.

import { SALVAGE } from '../data/salvage';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { canReachSalvage, collectSalvage, hasSalvage } from './salvage';
import { newId } from './factory';
import { gridOf, placementError, type Spot } from './grid';
import { beginSearch } from './search';
import { gainXp } from './progress';
import { locationAt } from './sites';
import type { GridItem, PartInstance, SalvageStock, World } from './types';
import { tileCenter } from './vision';
import { dist, type Vec } from './vec';
import { update } from './world';

// A site is discovered once the player sees any tile inside it. Buildings and wrecks can hide the center.
export function discoverSites(world: World): void {
  for (const s of [...REGION.towns, ...REGION.locations]) {
    if (
      world.player.discovered.includes(s.id) ||
      !seesArea(world, s.pos, s.radius)
    )
      continue;
    world.player.discovered.push(s.id);
    world.events.push({ t: "discover", location: s.id });
    gainXp(world, RULES.discoverXp, `found ${s.name}`);
  }
}

// Passive effect: stopping at the oasis refills supplies for free.
export function useOasis(world: World): void {
  const loc = locationAt(world);
  if (loc?.kind !== 'oasis' || world.player.supplies >= RULES.suppliesCap) return;
  if (playerVehicle(world).speed > RULES.parkedSpeed) return;
  world.player.supplies = RULES.suppliesCap;
  world.events.push({ t: "info", text: `Filled supplies at ${loc.name}` });
}

function seesArea(world: World, center: Vec, radius: number): boolean {
  return world.player.visible.some(
    (idx) => dist(tileCenter(world, idx), center) <= radius,
  );
}

// The stock with loot left that the parked player truck can reach, or null.
export function salvageHere(world: World): SalvageStock | null {
  const me = playerVehicle(world);
  return world.salvage.find((stock) => hasSalvage(stock) && canReachSalvage(me, stock)) ?? null;
}

// An unsearched stock is in reach: the player can start a search.
export function canScavenge(world: World): boolean {
  const stock = salvageHere(world);
  return stock !== null && !world.player.scavenged.includes(stock.id);
}

// A searched stock is in reach: the player can take its loot.
export function canLoot(world: World): boolean {
  const stock = salvageHere(world);
  return stock !== null && world.player.scavenged.includes(stock.id);
}

// Starts a timed search of the reachable stock. When it ends, the stock opens for looting.
export function scavenge(world: World): World {
  return update(world, (w) => {
    if (!canScavenge(w)) throw new Error('Nothing unsearched in reach');
    beginSearch(w, playerVehicle(w), salvageHere(w)!.id);
  });
}

export type LootPick = { kind: 'part'; partId: string } | { kind: 'good'; good: string };

// Moves one loot item from a searched stock to a chosen grid spot.
export function takeLoot(world: World, stockId: string, pick: LootPick, to: Spot): World {
  return update(world, (w) => {
    const stock = requireLootable(w, stockId);
    const me = playerVehicle(w);
    const item: GridItem = pick.kind === 'part'
      ? { id: newId(w, 'i'), kind: 'part', part: requireStockPart(stock, pick.partId), ...to }
      : { id: newId(w, 'i'), kind: 'good', good: pick.good, ...to };
    if (pick.kind === 'good' && (stock.goods[pick.good] ?? 0) <= 0) throw new Error(`No ${pick.good} left here`);
    const err = placementError(gridOf(me), me.items, item, null);
    if (err) throw new Error(err);
    me.items.push(item);
    if (pick.kind === 'part') stock.parts = stock.parts.filter((p) => p.id !== pick.partId);
    else stock.goods[pick.good] -= 1;
  });
}

// Moves everything that fits from a searched stock into the grid. The rest stays behind.
export function takeAllLoot(world: World, stockId: string): World {
  return update(world, (w) => {
    requireLootable(w, stockId);
    collectSalvage(w, playerVehicle(w), stockId, Infinity);
  });
}

function requireLootable(world: World, stockId: string): SalvageStock {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  if (!world.player.scavenged.includes(stockId)) throw new Error('Search this site first');
  if (!canReachSalvage(playerVehicle(world), stock)) throw new Error('Stop within reach of the salvage');
  return stock;
}

function requireStockPart(stock: SalvageStock, partId: string): PartInstance {
  const part = stock.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`No part ${partId} here`);
  return part;
}
