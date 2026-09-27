// Town services: trade, supplies, repairs, parts and chassis. All need the player in a town. Raider camps service raiders.
// Invalid requests throw: the UI only offers valid ones.

import { chassisDef, PLAYER_CHASSIS } from "../data/chassis";
import { ECONOMY, GOODS, TOWN_PRICES } from "../data/goods";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { REGION } from "../data/region";
import { dist } from "./vec";
import { getResources } from "./resources";
import { playerVehicle } from "./damage";
import { addCoreParts, makePart } from "./factory";
import { practice, skillEffect } from "./progress";
import { canUseSite, requireTown } from "./sites";
import { freeCells, goodsCount, mountedParts } from "./grid";
import { addGoods, mountPart, removeGoods, stowPart } from "./inventory";
import type { PartInstance, Vehicle, World } from "./types";
import { playerCommand } from "./world";

export type Supply = "fuel" | "supplies";

export function requireVehicleTown(
  world: World,
  vehicle: Vehicle,
  townId: string,
): void {
  const town = REGION.towns.find((t) => t.id === townId);
  if (!town || !canUseSite(vehicle.pos, town))
    throw new Error("Not at a gate of the requested town");
  if (
    vehicle.id !== world.player.vehicleId &&
    vehicle.speed > RULES.parkedSpeed
  )
    throw new Error("Stop before using town services");
}

export function getTradePrice(
  world: World,
  vehicle: Vehicle,
  townId: string,
  good: string,
  direction: "buy" | "sell",
): number {
  const margin =
    vehicle.id === world.player.vehicleId ? spread(world) : ECONOMY.spread;
  return Math.round(
    basePrice(townId, good) * (1 + (direction === "buy" ? margin : -margin)),
  );
}

export function tradeGoods(
  world: World,
  vehicle: Vehicle,
  townId: string,
  good: string,
  count: number,
  direction: "buy" | "sell",
): void {
  requireVehicleTown(world, vehicle, townId);
  if (!GOODS[good] || !Number.isInteger(count) || count <= 0)
    throw new Error(`Bad trade ${count} ${good}`);
  const resources = getResources(world, vehicle);
  const price = getTradePrice(world, vehicle, townId, good, direction);
  const held = goodsCount(vehicle)[good] ?? 0;
  if (direction === "buy") {
    if (resources.money < price * count) throw new Error("Not enough money");
    if (freeCells(vehicle) < count) throw new Error("Not enough cargo space");
    const added = addGoods(world, vehicle, good, count);
    if (added !== count) throw new Error("Cargo capacity invariant failed");
    resources.money -= price * count;
    if (vehicle.id === world.player.vehicleId)
      world.player.costBasis[good] =
        ((world.player.costBasis[good] ?? 0) * held + price * count) /
        (held + count);
  } else {
    if (count > held)
      throw new Error(`Cannot sell ${count} ${good}, holding ${held}`);
    removeGoods(vehicle, good, count);
    resources.money += price * count;
    if (vehicle.id === world.player.vehicleId) practiceSale(world, townId, good, price, count);
  }
}

// Social grows from profit over the average price paid. A sale at a loss teaches nothing.
function practiceSale(world: World, townId: string, good: string, price: number, count: number): void {
  const profit = (price - (world.player.costBasis[good] ?? 0)) * count;
  if (profit > 0) practice(world, "profit", profit, null, `${townId}:${good}`);
}

export function sellVehicleCargo(
  world: World,
  vehicle: Vehicle,
  townId: string,
  retainedParts = 0,
): void {
  requireVehicleTown(world, vehicle, townId);
  for (const [good, count] of Object.entries(goodsCount(vehicle))) {
    const sellCount = good === 'parts' ? Math.max(0, count - retainedParts) : count;
    if (sellCount > 0) tradeGoods(world, vehicle, townId, good, sellCount, "sell");
  }
  const mounted = new Set(mountedParts(vehicle).map((part) => part.id));
  const resources = getResources(world, vehicle);
  vehicle.items = vehicle.items.filter((item) => {
    if (item.kind !== "part" || mounted.has(item.part.id)) return true;
    resources.money += partSellPrice(item.part);
    return false;
  });
}

export function serviceVehicle(
  world: World,
  vehicle: Vehicle,
  townId: string,
  retainedParts = 0,
): void {
  requireVehicleTown(world, vehicle, townId);
  sellVehicleCargo(world, vehicle, townId, retainedParts);
  refuelAndRepair(world, vehicle);
}

// A raider camp sells fuel, supplies and repairs to raiders at the town rates. It buys no cargo.
export function serviceAtCamp(
  world: World,
  vehicle: Vehicle,
  campId: string,
): void {
  const camp = REGION.locations.find((l) => l.id === campId);
  if (camp?.kind !== "camp" || !canUseSite(vehicle.pos, camp))
    throw new Error("Not at a gate of the requested camp");
  if (vehicle.faction !== "raiders")
    throw new Error("Only raiders use camp services");
  if (vehicle.speed > RULES.parkedSpeed)
    throw new Error("Stop before using camp services");
  refuelAndRepair(world, vehicle);
}

// A driver in debt buys nothing.
function refuelAndRepair(world: World, vehicle: Vehicle): void {
  const resources = getResources(world, vehicle);
  if (resources.money < 0) return;
  for (const kind of ["fuel", "supplies"] as const) {
    const cap =
      kind === "fuel"
        ? chassisDef(vehicle.chassisId).fuelCap
        : RULES.suppliesCap;
    const count = Math.max(
      0,
      Math.min(
        Math.floor(cap - resources[kind]),
        Math.floor(resources.money / ECONOMY.supplyPrice[kind]),
      ),
    );
    resources[kind] += count;
    resources.money -= count * ECONOMY.supplyPrice[kind];
  }
  const multiplier =
    vehicle.id === world.player.vehicleId ? repairMult(world) : 1;
  for (const part of allParts(vehicle)) {
    const unitCost = ECONOMY.partRepairPerHp * multiplier;
    const hp = Math.min(
      partDef(part.defId).hp - part.hp,
      Math.floor(resources.money / unitCost),
    );
    part.hp += hp;
    resources.money -= Math.ceil(hp * unitCost);
  }
}

function spread(world: World): number {
  return Math.max(
    0,
    ECONOMY.spread - skillEffect(world, playerVehicle(world), "social", "priceSpread"),
  );
}

export function buyPrice(world: World, townId: string, good: string): number {
  return getTradePrice(world, playerVehicle(world), townId, good, "buy");
}

export function sellPrice(world: World, townId: string, good: string): number {
  return getTradePrice(world, playerVehicle(world), townId, good, "sell");
}

function basePrice(townId: string, good: string): number {
  const p = TOWN_PRICES[townId]?.[good];
  if (p === undefined) throw new Error(`No price for ${good} in ${townId}`);
  return p;
}

function repairMult(world: World): number {
  return Math.max(
    0,
    1 - skillEffect(world, playerVehicle(world), "machining", "repair"),
  );
}

// A player in debt cannot buy anything, even at no cost.
function pay(world: World, amount: number, reason: string): void {
  if (world.player.money < 0 || amount > world.player.money)
    throw new Error(`Not enough money for ${reason}`);
  world.player.money -= amount;
}

export function buyGood(world: World, good: string, n: number): World {
  return playerCommand(world, (w) => {
    const town = requireTown(w);
    const me = playerVehicle(w);
    tradeGoods(w, me, town.id, good, n, "buy");
  });
}

export function sellGood(world: World, good: string, n: number): World {
  return playerCommand(world, (w) => {
    const town = requireTown(w);
    const me = playerVehicle(w);
    tradeGoods(w, me, town.id, good, n, "sell");
  });
}

export function supplyRoom(world: World, kind: Supply): number {
  const p = world.player;
  const cap =
    kind === "fuel"
      ? chassisDef(playerVehicle(world).chassisId).fuelCap
      : RULES.suppliesCap;
  return Math.max(0, Math.floor(cap - p[kind]));
}

export function buySupply(world: World, kind: Supply, n: number): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    if (n <= 0 || n > supplyRoom(w, kind))
      throw new Error(`Cannot buy ${n} ${kind}`);
    pay(w, ECONOMY.supplyPrice[kind] * n, kind);
    w.player[kind] += n;
  });
}

export function partRepairCost(world: World, part: PartInstance): number {
  return Math.ceil(
    (partDef(part.defId).hp - part.hp) *
      ECONOMY.partRepairPerHp *
      repairMult(world),
  );
}

export function repairPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    const part = allParts(playerVehicle(w)).find((p) => p.id === partId);
    if (!part) throw new Error(`No truck part ${partId}`);
    pay(w, partRepairCost(w, part), "repairs");
    part.hp = partDef(part.defId).hp;
  });
}

export function repairAll(world: World): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    const me = playerVehicle(w);
    const parts = allParts(me);
    const cost = parts.reduce((a, p) => a + partRepairCost(w, p), 0);
    pay(w, cost, "repairs");
    for (const p of parts) p.hp = partDef(p.defId).hp;
  });
}

export function partSellPrice(part: PartInstance): number {
  const def = partDef(part.defId);
  return Math.floor(def.price * ECONOMY.partSellFactor * (part.hp / def.hp));
}

export function buyPart(world: World, defId: string): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    if (partDef(defId).kind === "core")
      throw new Error(
        `${partDef(defId).name} is built in. It is not for sale.`,
      );
    pay(w, partDef(defId).price, partDef(defId).name);
    w.player.storage.push(makePart(w, defId));
  });
}

export function sellPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    const i = w.player.storage.findIndex((p) => p.id === partId);
    if (i < 0) throw new Error(`No stored part ${partId}`);
    w.player.money += partSellPrice(w.player.storage[i]);
    w.player.storage.splice(i, 1);
  });
}

// The trade-in scales by the mean health of the built-in parts.
export function chassisTradeIn(world: World): number {
  const me = playerVehicle(world);
  const core = mountedParts(me, "core");
  const health =
    core.reduce((a, p) => a + p.hp / partDef(p.defId).hp, 0) / core.length;
  return Math.floor(
    chassisDef(me.chassisId).price * ECONOMY.chassisSellFactor * health,
  );
}

export function repairCost(world: World): number {
  return allParts(playerVehicle(world)).reduce(
    (a, p) => a + partRepairCost(world, p),
    0,
  );
}

function allParts(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === "part" ? [it.part] : []));
}

// Swap chassis: the old built-in parts go with the old chassis and the new one brings its own.
// Mounted parts move to free mounts, spares and goods to free cells, and parts that do not fit go to
// garage storage. Goods that do not fit block the swap. The old chassis is traded in.
export function buyChassis(world: World, chassisId: string): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    if (!PLAYER_CHASSIS.includes(chassisId))
      throw new Error(`${chassisId} is not for sale`);
    const me = playerVehicle(w);
    if (me.chassisId === chassisId)
      throw new Error("You already drive this chassis");
    const cost = chassisDef(chassisId).price - chassisTradeIn(w);
    pay(w, Math.max(0, cost), chassisDef(chassisId).name);
    const mounted = new Set(mountedParts(me).map((p) => p.id));
    const goods = goodsCount(me);
    const old = me.items;
    me.chassisId = chassisId;
    me.items = [];
    addCoreParts(w, me);
    // Cargo parts first: their extra rows make room for the rest.
    const parts = old.flatMap((it) =>
      it.kind === "part" && partDef(it.part.defId).kind !== "core"
        ? [it.part]
        : [],
    );
    parts.sort(
      (a, b) =>
        Number(partDef(b.defId).kind === "cargo") -
        Number(partDef(a.defId).kind === "cargo"),
    );
    for (const part of parts) {
      const placed = mounted.has(part.id)
        ? mountPart(w, me, part) || stowPart(w, me, part)
        : stowPart(w, me, part);
      if (!placed) w.player.storage.push(part);
    }
    for (const [good, n] of Object.entries(goods)) {
      if (addGoods(w, me, good, n) < n)
        throw new Error(
          "Cargo would not fit the new chassis. Sell some first.",
        );
    }
    me.weaponOrders = {};
    w.player.fuel = Math.min(w.player.fuel, chassisDef(chassisId).fuelCap);
  });
}
