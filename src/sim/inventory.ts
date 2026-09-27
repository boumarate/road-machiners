// Inventory grid commands and helpers. Goods move anywhere. Changing which parts are mounted needs a town.

import { partDef } from '../data/parts';
import { playerVehicle } from './damage';
import { newId } from './factory';
import { findSpot, gridOf, isMounted, MOUNT_CELLS, placementError, type Spot } from './grid';
import { requireTown, townAt } from './sites';
import { vehicleStats } from './stats';
import type { GridItem, PartInstance, Vehicle, World } from './types';
import { playerCommand } from './world';

// Mount a part on the first free fitting mount. Returns false when no mount has room.
export function mountPart(world: World, v: Vehicle, part: PartInstance): boolean {
  const item: GridItem = { id: newId(world, 'i'), x: 0, y: 0, rot: 0, kind: 'part', part };
  const spot = findSpot(gridOf(v), v.items, item, MOUNT_CELLS[partDef(part.defId).kind], null);
  if (!spot) return false;
  v.items.push({ ...item, ...spot });
  return true;
}

// Put a spare part anywhere it fits without mounting it. Returns false when there is no room.
export function stowPart(world: World, v: Vehicle, part: PartInstance): boolean {
  const item: GridItem = { id: newId(world, 'i'), x: 0, y: 0, rot: 0, kind: 'part', part };
  const spot = findSpot(gridOf(v), v.items, item, null, MOUNT_CELLS[partDef(part.defId).kind]);
  if (!spot) return false;
  v.items.push({ ...item, ...spot });
  return true;
}

// Adds up to n units, one cell each. Returns how many fit.
export function addGoods(world: World, v: Vehicle, good: string, n: number): number {
  for (let i = 0; i < n; i++) {
    const item: GridItem = { id: newId(world, 'i'), x: 0, y: 0, rot: 0, kind: 'good', good };
    const spot = findSpot(gridOf(v), v.items, item, null, null);
    if (!spot) return i;
    v.items.push({ ...item, ...spot });
  }
  return n;
}

export function removeGoods(v: Vehicle, good: string, n: number): void {
  const held = v.items.filter((it) => it.kind === 'good' && it.good === good);
  if (held.length < n) throw new Error(`Cannot remove ${n} ${good}, holding ${held.length}`);
  const drop = new Set(held.slice(held.length - n).map((it) => it.id));
  v.items = v.items.filter((it) => !drop.has(it.id));
}

export function removeAllGoods(v: Vehicle): void {
  v.items = v.items.filter((it) => it.kind !== 'good');
}

export function removeSpareParts(v: Vehicle): void {
  v.items = v.items.filter((it) => it.kind !== 'part' || isMounted(v.chassisId, it));
}

export function spareParts(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === 'part' && !isMounted(v.chassisId, it) ? [it.part] : []));
}

export function moveItem(world: World, itemId: string, to: Spot): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    const item = findItem(me, itemId);
    requireRemovable(item);
    const moved: GridItem = { ...item, ...to };
    if (item.kind === 'part' && isMounted(me.chassisId, item) !== isMounted(me.chassisId, moved)) requireRefit(w);
    const others = me.items.filter((it) => it.id !== itemId);
    const err = placementError(gridOf({ ...me, items: [...others, moved] }), others, moved, null);
    if (err) throw new Error(err);
    me.items = [...others, moved];
    afterRefit(w);
  });
}

// Town garage storage holds spare parts between trips.
export function storePart(world: World, itemId: string): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    const me = playerVehicle(w);
    const item = findItem(me, itemId);
    if (item.kind !== 'part') throw new Error('Only parts go into garage storage');
    requireRemovable(item);
    me.items = me.items.filter((it) => it.id !== itemId);
    w.player.storage.push(item.part);
    afterRefit(w);
  });
}

export function takeFromStorage(world: World, partId: string, to: Spot): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    const me = playerVehicle(w);
    const i = w.player.storage.findIndex((p) => p.id === partId);
    if (i < 0) throw new Error(`No stored part ${partId}`);
    const item: GridItem = { id: newId(w, 'i'), kind: 'part', part: w.player.storage[i], ...to };
    const err = placementError(gridOf(me), me.items, item, null);
    if (err) throw new Error(err);
    w.player.storage.splice(i, 1);
    me.items.push(item);
    afterRefit(w);
  });
}

// Throw goods out to make room. Parts are never dumped; store or sell them in town.
export function dumpGood(world: World, itemId: string): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    if (findItem(me, itemId).kind !== 'good') throw new Error('Only goods can be dumped');
    me.items = me.items.filter((it) => it.id !== itemId);
  });
}

function findItem(v: Vehicle, itemId: string): GridItem {
  const item = v.items.find((it) => it.id === itemId);
  if (!item) throw new Error(`No item ${itemId}`);
  return item;
}

function requireRemovable(item: GridItem): void {
  if (item.kind === 'part' && partDef(item.part.defId).kind === 'core') throw new Error(`${partDef(item.part.defId).name} is built in. It can only be repaired.`);
}

function requireRefit(w: World): void {
  if (!townAt(w)) throw new Error('Mounting and unmounting parts needs a town garage');
}

// A refit can remove grid rows or drop a weapon. Items left outside the grid block it.
export function afterRefit(w: World): void {
  const me = playerVehicle(w);
  const g = gridOf(me);
  for (const it of me.items) {
    if (placementError(g, me.items, it, it.id)) throw new Error('Items would fall off the grid. Move them off the extra rows first.');
  }
  const s = vehicleStats(w, me);
  for (const id of Object.keys(me.weaponOrders)) if (!s.weapons.some((m) => m.part.id === id)) delete me.weaponOrders[id];
}
