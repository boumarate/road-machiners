// Town services: trade, supplies, repairs, parts and chassis. All need the player in a town.
// Invalid requests throw: the UI only offers valid ones.

import { chassisDef, PLAYER_CHASSIS } from '../data/chassis';
import { ECONOMY, GOODS, TOWN_PRICES } from '../data/goods';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import { playerVehicle } from './damage';
import { makePart } from './factory';
import { gainXp } from './progress';
import { requireTown } from './sites';
import { goodsCount, mountedParts } from './grid';
import { addGoods, mountPart, removeGoods, stowPart } from './inventory';
import { vehicleStats } from './stats';
import type { PartInstance, Vehicle, World } from './types';
import { update } from './world';

export type Supply = 'fuel' | 'water' | 'food';

function spread(world: World): number {
  return Math.max(0, ECONOMY.spread - skillBonus('trade', world.player.skills.trade));
}

export function buyPrice(world: World, townId: string, good: string): number {
  return Math.round(basePrice(townId, good) * (1 + spread(world)));
}

export function sellPrice(world: World, townId: string, good: string): number {
  return Math.round(basePrice(townId, good) * (1 - spread(world)));
}

function basePrice(townId: string, good: string): number {
  const p = TOWN_PRICES[townId]?.[good];
  if (p === undefined) throw new Error(`No price for ${good} in ${townId}`);
  return p;
}

function repairMult(world: World): number {
  return Math.max(0, 1 - skillBonus('mechanics', world.player.skills.mechanics));
}

function pay(world: World, amount: number, reason: string): void {
  if (amount > world.player.money) throw new Error(`Not enough money for ${reason}`);
  world.player.money -= amount;
}

export function buyGood(world: World, good: string, n: number): World {
  return update(world, (w) => {
    const town = requireTown(w);
    const me = playerVehicle(w);
    if (!GOODS[good] || n <= 0) throw new Error(`Bad purchase ${n} ${good}`);
    const price = buyPrice(w, town.id, good);
    pay(w, price * n, good);
    const held = goodsCount(me)[good] ?? 0;
    if (addGoods(w, me, good, n) < n) throw new Error('Not enough cargo space');
    w.player.costBasis[good] = ((w.player.costBasis[good] ?? 0) * held + price * n) / (held + n);
  });
}

export function sellGood(world: World, good: string, n: number): World {
  return update(world, (w) => {
    const town = requireTown(w);
    const me = playerVehicle(w);
    const held = goodsCount(me)[good] ?? 0;
    if (n <= 0 || n > held) throw new Error(`Cannot sell ${n} ${good}, holding ${held}`);
    const price = sellPrice(w, town.id, good);
    w.player.money += price * n;
    removeGoods(me, good, n);
    const profit = (price - (w.player.costBasis[good] ?? 0)) * n;
    gainXp(w, profit * RULES.tradeXpPerProfit, `sold ${n} ${GOODS[good].name}`);
  });
}

export function supplyRoom(world: World, kind: Supply): number {
  const p = world.player;
  const cap = kind === 'fuel' ? chassisDef(playerVehicle(world).chassisId).fuelCap : kind === 'water' ? RULES.waterCap : RULES.foodCap;
  return Math.max(0, Math.floor(cap - p[kind]));
}

export function buySupply(world: World, kind: Supply, n: number): World {
  return update(world, (w) => {
    requireTown(w);
    if (n <= 0 || n > supplyRoom(w, kind)) throw new Error(`Cannot buy ${n} ${kind}`);
    pay(w, ECONOMY.supplyPrice[kind] * n, kind);
    w.player[kind] += n;
  });
}

export function hullRepairCost(world: World): number {
  const me = playerVehicle(world);
  return Math.ceil((vehicleStats(world, me).hullMax - me.hull) * ECONOMY.hullRepairPerHp * repairMult(world));
}

export function partRepairCost(world: World, part: PartInstance): number {
  return Math.ceil((partDef(part.defId).hp - part.hp) * ECONOMY.partRepairPerHp * repairMult(world));
}

export function repairAll(world: World): World {
  return update(world, (w) => {
    requireTown(w);
    const me = playerVehicle(w);
    const parts = allParts(me);
    const cost = hullRepairCost(w) + parts.reduce((a, p) => a + partRepairCost(w, p), 0);
    pay(w, cost, 'repairs');
    me.hull = vehicleStats(w, me).hullMax;
    for (const p of parts) p.hp = partDef(p.defId).hp;
  });
}

export function partSellPrice(part: PartInstance): number {
  const def = partDef(part.defId);
  return Math.floor(def.price * ECONOMY.partSellFactor * (part.hp / def.hp));
}

export function buyPart(world: World, defId: string): World {
  return update(world, (w) => {
    requireTown(w);
    pay(w, partDef(defId).price, partDef(defId).name);
    w.player.storage.push(makePart(w, defId));
  });
}

export function sellPart(world: World, partId: string): World {
  return update(world, (w) => {
    requireTown(w);
    const i = w.player.storage.findIndex((p) => p.id === partId);
    if (i < 0) throw new Error(`No stored part ${partId}`);
    w.player.money += partSellPrice(w.player.storage[i]);
    w.player.storage.splice(i, 1);
  });
}

export function chassisTradeIn(world: World): number {
  const me = playerVehicle(world);
  const ch = chassisDef(me.chassisId);
  return Math.floor(ch.price * ECONOMY.chassisSellFactor * (me.hull / vehicleStats(world, me).hullMax));
}

export function repairCost(world: World): number {
  return hullRepairCost(world) + allParts(playerVehicle(world)).reduce((a, p) => a + partRepairCost(world, p), 0);
}

function allParts(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === 'part' ? [it.part] : []));
}

// Swap chassis: mounted parts move to free mounts, spares and goods to free cells, and parts that
// do not fit go to garage storage. Goods that do not fit block the swap. The old chassis is traded in.
export function buyChassis(world: World, chassisId: string): World {
  return update(world, (w) => {
    requireTown(w);
    if (!PLAYER_CHASSIS.includes(chassisId)) throw new Error(`${chassisId} is not for sale`);
    const me = playerVehicle(w);
    if (me.chassisId === chassisId) throw new Error('You already drive this chassis');
    const cost = chassisDef(chassisId).price - chassisTradeIn(w);
    pay(w, Math.max(0, cost), chassisDef(chassisId).name);
    const mounted = new Set(mountedParts(me).map((p) => p.id));
    const goods = goodsCount(me);
    const old = me.items;
    me.chassisId = chassisId;
    me.items = [];
    // Cargo parts first: their extra rows make room for the rest.
    const parts = old.flatMap((it) => (it.kind === 'part' ? [it.part] : []));
    parts.sort((a, b) => Number(partDef(b.defId).kind === 'cargo') - Number(partDef(a.defId).kind === 'cargo'));
    for (const part of parts) {
      const placed = mounted.has(part.id) ? mountPart(w, me, part) || stowPart(w, me, part) : stowPart(w, me, part);
      if (!placed) w.player.storage.push(part);
    }
    for (const [good, n] of Object.entries(goods)) {
      if (addGoods(w, me, good, n) < n) throw new Error('Cargo would not fit the new chassis. Sell some first.');
    }
    me.hull = vehicleStats(w, me).hullMax;
    me.weaponOrders = {};
    w.player.fuel = Math.min(w.player.fuel, chassisDef(chassisId).fuelCap);
  });
}
