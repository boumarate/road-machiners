// Paid services. Goods and part trade happen at any shop (src/sim/market.ts owns shop state). Supplies,
// repairs, mounting and chassis need a town. Raider camps service raiders.
// Invalid requests throw: the UI only offers valid ones.

import { chassisDef, PLAYER_CHASSIS } from "../data/chassis";
import { ECONOMY, GOODS } from "../data/goods";
import { shopDef } from "../data/market";
import { partDef } from "../data/parts";
import { RULES, UPKEEP } from "../data/rules";
import { NPC_UPKEEP } from "../data/npcs";
import { REGION } from "../data/region";
import { fitStores, getResources } from "./resources";
import { isJunk, maxHp, partValue, restorePart, scrapValue, wearFactor } from "./wear";
import { playerVehicle, vehicleById } from "./damage";
import { inFeud } from "./combat";
import { meetGoal } from "./npc-activities";
import { addState, endState, stateOf } from "./states";
import { inTowReach } from "./tow";
import { addCoreParts } from "./factory";
import { practice, skillEffect } from "./progress";
import { addStockPart, goodPrice, lotPrice, recordTrade, shopAt, shopState, siteOf, takeStockPart } from "./market";
import { canUseSite, requireTown } from "./sites";
import { freeCells, goodsCount, mountedParts } from "./grid";
import { addGoods, mountPart, removeGoods, spareParts, stowPart } from "./inventory";
import { clockOf } from "./sun";
import type { NpcState, PartInstance, Vehicle, World } from "./types";
import { playerCommand } from "./world";
import { fuelCap, suppliesCap } from "./stats";

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

// A vehicle trading at a shop must be at its gate, and an NPC must be parked.
export function requireVehicleShop(world: World, vehicle: Vehicle, shopId: string): void {
  if (!canUseSite(vehicle.pos, siteOf(shopId)))
    throw new Error(`Not at a gate of ${shopId}`);
  if (vehicle.id !== world.player.vehicleId && vehicle.speed > RULES.parkedSpeed)
    throw new Error("Stop before trading");
}

export function getTradePrice(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  good: string,
  direction: "buy" | "sell",
): number {
  const margin =
    vehicle.id === world.player.vehicleId ? spread(world) : ECONOMY.spread;
  return goodPrice(shopId, shopState(world, shopId), good, direction, margin);
}

// The total price of a whole lot, each unit priced at the pressure left by the unit before it.
export function getLotTradePrice(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  good: string,
  count: number,
  direction: "buy" | "sell",
): number {
  const margin =
    vehicle.id === world.player.vehicleId ? spread(world) : ECONOMY.spread;
  return lotPrice(shopId, shopState(world, shopId), good, direction, margin, count);
}

export function tradeGoods(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  good: string,
  count: number,
  direction: "buy" | "sell",
): void {
  requireVehicleShop(world, vehicle, shopId);
  if (!GOODS[good] || !Number.isInteger(count) || count <= 0)
    throw new Error(`Bad trade ${count} ${good}`);
  const total = getLotTradePrice(world, vehicle, shopId, good, count, direction);
  if (direction === "buy") buyGoods(world, vehicle, good, count, total);
  else sellGoods(world, vehicle, shopId, good, count, total);
  recordTrade(shopId, shopState(world, shopId), good, count, direction);
}

function buyGoods(world: World, vehicle: Vehicle, good: string, count: number, total: number): void {
  const resources = getResources(world, vehicle);
  if (resources.money < total) throw new Error("Not enough money");
  if (freeCells(vehicle) < count) throw new Error("Not enough cargo space");
  if (vehicle.id === world.player.vehicleId) noteCostBasis(world, good, total / count, count);
  const added = addGoods(world, vehicle, good, count);
  if (added !== count) throw new Error("Cargo capacity invariant failed");
  resources.money -= total;
}

// The player's average price paid per unit of a good, counting units already held. Call it before adding them.
export function noteCostBasis(world: World, good: string, price: number, count: number): void {
  const held = goodsCount(playerVehicle(world))[good] ?? 0;
  world.player.costBasis[good] = ((world.player.costBasis[good] ?? 0) * held + price * count) / (held + count);
}

function sellGoods(world: World, vehicle: Vehicle, shopId: string, good: string, count: number, total: number): void {
  const held = goodsCount(vehicle)[good] ?? 0;
  if (count > held) throw new Error(`Cannot sell ${count} ${good}, holding ${held}`);
  removeGoods(vehicle, good, count);
  getResources(world, vehicle).money += total;
  if (vehicle.id === world.player.vehicleId) practiceSale(world, shopId, good, total / count, count);
}

// The largest lot of `good` a buyer can both fit and afford at `shopId`, since a lot's total price
// rises unit by unit and a single-unit estimate can overshoot the budget.
export function affordableBuyCount(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  good: string,
  cap: number,
  budget: number,
): number {
  const unitPrice = getTradePrice(world, vehicle, shopId, good, "buy");
  let count = Math.max(0, Math.min(cap, Math.floor(budget / unitPrice)));
  while (count > 0 && getLotTradePrice(world, vehicle, shopId, good, count, "buy") > budget) count--;
  return count;
}

// Social grows from profit over the average price paid. A sale at a loss teaches nothing. The target is the buyer, a
// shop or a truck, and the good.
function practiceSale(world: World, buyer: string, good: string, price: number, count: number): void {
  const profit = (price - (world.player.costBasis[good] ?? 0)) * count;
  if (profit > 0) practice(world, "profit", profit, null, `${buyer}:${good}`);
}

// Sells every good the shop trades, keeping `retainedParts` units of the parts good, and every
// loose part, which joins the shop's stock.
export function sellVehicleCargo(
  world: World,
  vehicle: Vehicle,
  shopId: string,
  retainedParts: number,
): void {
  requireVehicleShop(world, vehicle, shopId);
  const traded = shopDef(shopId).goods;
  for (const [good, count] of Object.entries(goodsCount(vehicle))) {
    const sellCount = good === 'parts' ? Math.max(0, count - retainedParts) : count;
    if (sellCount > 0 && traded.includes(good)) tradeGoods(world, vehicle, shopId, good, sellCount, "sell");
  }
  const resources = getResources(world, vehicle);
  const spares = spareParts(vehicle);
  for (const part of spares) {
    resources.money += partTradePrice(world, vehicle, part, "sell");
    addStockPart(shopState(world, shopId), part);
  }
  vehicle.items = vehicle.items.filter((item) => item.kind !== "part" || !spares.includes(item.part));
}

export function serviceVehicle(
  world: World,
  vehicle: Vehicle,
  townId: string,
  retainedParts: number,
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
        ? fuelCap(vehicle)
        : suppliesCap(vehicle);
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
  for (const part of repairableParts(vehicle)) {
    // Same formula as partRepairCost: a share of the part's value per HP share restored.
    const unitCost = (ECONOMY.repairShare * partValue(part) * multiplier) / maxHp(part);
    const hp = Math.min(
      maxHp(part) - part.hp,
      Math.floor(resources.money / unitCost),
    );
    restorePart(part, part.hp + hp);
    resources.money -= Math.ceil(hp * unitCost);
  }
}

// The player's trade margin: the base spread narrowed by the Social skill.
export function spread(world: World): number {
  return Math.max(
    0,
    ECONOMY.spread - skillEffect(world, playerVehicle(world), "social", "priceSpread"),
  );
}

export function buyPrice(world: World, shopId: string, good: string): number {
  return getTradePrice(world, playerVehicle(world), shopId, good, "buy");
}

export function sellPrice(world: World, shopId: string, good: string): number {
  return getTradePrice(world, playerVehicle(world), shopId, good, "sell");
}

// The shop the parked player can use. Throws when there is none.
export function requireShop(world: World): string {
  const shopId = shopAt(world);
  if (!shopId) throw new Error("Not parked at a shop");
  return shopId;
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
    tradeGoods(w, playerVehicle(w), requireShop(w), good, n, "buy");
  });
}

export function sellGood(world: World, good: string, n: number): World {
  return playerCommand(world, (w) => {
    tradeGoods(w, playerVehicle(w), requireShop(w), good, n, "sell");
  });
}

export function supplyRoom(world: World, kind: Supply): number {
  const p = world.player;
  const cap =
    kind === "fuel"
      ? fuelCap(playerVehicle(world))
      : suppliesCap(playerVehicle(world));
  return Math.max(0, Math.floor(cap - p[kind]));
}

export function buySupply(world: World, kind: Supply, n: number): World {
  return playerCommand(world, (w) => {
    const shopId = requireShop(w);
    if (!shopDef(shopId).supplies.includes(kind))
      throw new Error(`${shopId} does not sell ${kind}`);
    if (n <= 0 || n > supplyRoom(w, kind))
      throw new Error(`Cannot buy ${n} ${kind}`);
    pay(w, ECONOMY.supplyPrice[kind] * n, kind);
    w.player[kind] += n;
  });
}

// A share of the part's value per HP share restored, times Machining. A broken part (0 HP) pays
// the same formula for a full rebuild. Throws for a junk part, which no repair rebuilds.
export function partRepairCost(world: World, part: PartInstance): number {
  if (isJunk(part))
    throw new Error(`${partDef(part.defId).name} is junk and cannot be rebuilt`);
  const missingShare = 1 - part.hp / maxHp(part);
  return Math.ceil(
    ECONOMY.repairShare * partValue(part) * missingShare * repairMult(world),
  );
}

export function repairPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    const part = allParts(playerVehicle(w)).find((p) => p.id === partId);
    if (!part) throw new Error(`No truck part ${partId}`);
    pay(w, partRepairCost(w, part), "repairs");
    restorePart(part, maxHp(part));
  });
}

export function repairAll(world: World): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    const me = playerVehicle(w);
    const parts = repairableParts(me);
    const cost = parts.reduce((a, p) => a + partRepairCost(w, p), 0);
    pay(w, cost, "repairs");
    for (const p of parts) restorePart(p, maxHp(p));
  });
}

// Buy or sell price at one place, both scaled by the part's current condition (HP share), not only
// its wear. The spread is added on top for buy and cut for sell, so buy always rounds to strictly
// above sell (IV4), even at the narrowest Social skill spread. Both are floored at the scrap value.
export function partTradePrice(world: World, vehicle: Vehicle, part: PartInstance, direction: 'buy' | 'sell'): number {
  return partPriceAt(part, vehicle.id === world.player.vehicleId ? spread(world) : ECONOMY.spread, direction);
}

// The player's price for a part traded with a truck on the road, at the road spread.
export function truckPartPrice(world: World, part: PartInstance, direction: 'buy' | 'sell'): number {
  return partPriceAt(part, roadSpread(world), direction);
}

function partPriceAt(part: PartInstance, margin: number, direction: 'buy' | 'sell'): number {
  const pressured = partValue(part) * (part.hp / maxHp(part));
  const floor = Math.round(scrapValue(part));
  const buy = Math.max(floor + 1, Math.ceil(pressured * (1 + margin)));
  if (direction === 'buy') return buy;
  return Math.max(floor, Math.min(buy - 1, Math.floor(pressured * (1 - margin))));
}

// A world-free, skill-free sell quote for garage storage listings, which have no vehicle context.
export function partSellPrice(part: PartInstance): number {
  return Math.max(
    Math.round(scrapValue(part)),
    Math.round(partValue(part) * (part.hp / maxHp(part)) * (1 - ECONOMY.spread)),
  );
}

// Buys a part from the stock of the shop the player is parked at. It goes into the truck grid, or
// into garage storage at a garage when the grid has no room.
export function buyStockPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const shopId = requireShop(w);
    const part = takeStockPart(shopState(w, shopId), partId);
    pay(w, partTradePrice(w, playerVehicle(w), part, "buy"), partDef(part.defId).name);
    if (stowPart(w, playerVehicle(w), part)) return;
    if (shopDef(shopId).kind !== "garage") throw new Error("No room in the truck for this part");
    w.player.storage.push(part);
  });
}

// Sells a spare part from the truck grid, or from garage storage at a garage. It joins the shop's stock.
export function sellPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const shopId = requireShop(w);
    const part = takeSellablePart(w, shopId, partId);
    w.player.money += partTradePrice(w, playerVehicle(w), part, "sell");
    addStockPart(shopState(w, shopId), part);
  });
}

function takeSellablePart(world: World, shopId: string, partId: string): PartInstance {
  const me = playerVehicle(world);
  const spare = spareParts(me).find((p) => p.id === partId);
  if (spare) {
    me.items = me.items.filter((it) => it.kind !== "part" || it.part.id !== partId);
    return spare;
  }
  const i = world.player.storage.findIndex((p) => p.id === partId);
  if (i < 0 || shopDef(shopId).kind !== "garage") throw new Error(`No sellable part ${partId} here`);
  return world.player.storage.splice(i, 1)[0];
}

// The trade-in is the chassis sell price: value less the sell spread, scaled by the mean health and
// the mean wear of the built-in parts.
export function chassisTradeIn(world: World): number {
  const me = playerVehicle(world);
  const core = mountedParts(me, "core");
  const health =
    core.reduce((a, p) => a + p.hp / maxHp(p), 0) / core.length;
  const meanWear = core.reduce((a, p) => a + p.wear, 0) / core.length;
  return Math.floor(
    chassisDef(me.chassisId).value *
      (1 - spread(world)) *
      health *
      wearFactor(meanWear),
  );
}

export function repairCost(world: World): number {
  return repairableParts(playerVehicle(world)).reduce(
    (a, p) => a + partRepairCost(world, p),
    0,
  );
}

function allParts(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === "part" ? [it.part] : []));
}

// Town repairs skip junk parts, which no repair rebuilds.
function repairableParts(v: Vehicle): PartInstance[] {
  return allParts(v).filter((p) => !isJunk(p));
}

// Swap chassis: the old built-in parts go with the old chassis and the new one brings its own.
// Mounted parts move to free mounts, spares and goods to free cells, and parts that do not fit go to
// garage storage. Goods that do not fit block the swap. The old chassis is traded in.
// Pays the new chassis's price less the trade-in. A trade-in that beats the price refunds the
// difference instead of charging nothing.
function payChassisCost(world: World, chassisId: string): void {
  const cost = chassisDef(chassisId).value - chassisTradeIn(world);
  if (cost >= 0) pay(world, cost, chassisDef(chassisId).name);
  else world.player.money -= cost;
}

export function buyChassis(world: World, chassisId: string): World {
  return playerCommand(world, (w) => {
    requireTown(w);
    if (!PLAYER_CHASSIS.includes(chassisId))
      throw new Error(`${chassisId} is not for sale`);
    const me = playerVehicle(w);
    if (me.chassisId === chassisId)
      throw new Error("You already drive this chassis");
    payChassisCost(w, chassisId);
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
    fitStores(w, me);
  });
}

// The truck's value: the chassis plus every mounted part but the built-in core ones.
function truckValue(vehicle: Vehicle): number {
  const parts = mountedParts(vehicle).filter((p) => partDef(p.defId).kind !== "core");
  return chassisDef(vehicle.chassisId).value + parts.reduce((sum, p) => sum + partValue(p), 0);
}

// Once per game day, the player pays upkeep: a share of their truck's current value. It can push
// money into debt, like any other cost. Called once from the turn pipeline at the day boundary.
export function chargeUpkeep(world: World): void {
  if (clockOf(world.turn).day === clockOf(world.turn - 1).day) return;
  const amount = Math.round(truckValue(playerVehicle(world)) * UPKEEP.dailyShare);
  world.player.money -= amount;
  world.events.push({ t: "money", amount: -amount, reason: "upkeep" });
}

// Trade with an NPC truck. A radio call starts a `trade` state held by the NPC toward the player, and the NPC's
// meet goal brings it alongside. Trades run only while both trucks are parked in reach.

function isParked(v: Vehicle): boolean {
  return v.speed <= RULES.parkedSpeed;
}

// The trade meeting this driver holds with the player, or null.
export function tradeWith(world: World, npc: Vehicle): NpcState | null {
  return stateOf(world, "trade", npc.id, world.player.vehicleId);
}

export function startTrade(world: World, npc: Vehicle): void {
  addState(world, "trade", npc.id, world.player.vehicleId, { kind: "none" });
  meetGoal(world, npc, playerVehicle(world));
}

// Both trucks of the meeting are parked in reach. It keeps the meeting from lapsing.
export function isMeeting(world: World, s: NpcState): boolean {
  const npc = vehicleById(world, s.holder);
  const me = vehicleById(world, s.other);
  return isParked(npc) && isParked(me) && inTowReach(npc, me);
}

// A feud between the two calls the meeting off. A missing party is left to the missing-party rule.
export function checkTrade(world: World, s: NpcState): "broken" | null {
  const npc = world.vehicles.find((v) => v.id === s.holder);
  const me = world.vehicles.find((v) => v.id === s.other);
  return npc && me && inFeud(world, npc, me) ? "broken" : null;
}

// The NPC with an agreed trade, met or still on its way, or null.
export function tradePartner(world: World): Vehicle | null {
  const s = world.states.find((x) => x.kind === "trade" && x.other === world.player.vehicleId);
  return s ? vehicleById(world, s.holder) : null;
}

// The NPC the player can trade with now, or null.
export function tradeReady(world: World): Vehicle | null {
  const s = world.states.find((x) => x.kind === "trade" && x.other === world.player.vehicleId && isMeeting(world, x));
  return s ? vehicleById(world, s.holder) : null;
}

// The meeting with this NPC, which must be under way now. Every trade command checks it first.
function requireMeeting(world: World, npcId: string): { npc: Vehicle; state: NpcState } {
  const npc = vehicleById(world, npcId);
  const state = tradeWith(world, npc);
  if (!state) throw new Error(`No trade agreed with ${npc.name}`);
  if (!isMeeting(world, state)) throw new Error("Both trucks must be parked side by side");
  return { npc, state };
}

// The player is done trading. The NPC drops its meet goal on its next think.
export function endTrade(world: World, npcId: string): World {
  return playerCommand(world, (w) => endState(w, requireMeeting(w, npcId).state, "fulfilled"));
}

// A truck on the road trades at the player's spread plus the road spread. Social skill narrows it as in town.
function roadSpread(world: World): number {
  return spread(world) + ECONOMY.roadSpread;
}

// Trucks keep no price pressure, so a good trades at its base value with the road spread either way.
export function truckGoodPrice(world: World, good: string, direction: "buy" | "sell"): number {
  const def = GOODS[good];
  if (!def) throw new Error(`Unknown good ${good}`);
  const margin = roadSpread(world);
  const buy = Math.max(1, Math.ceil(def.value * (1 + margin)));
  return direction === "buy" ? buy : Math.max(0, Math.min(buy - 1, Math.floor(def.value * (1 - margin))));
}

// A truck charges the town price plus the road spread, since it sells from its own tank.
export function truckSupplyPrice(world: World, kind: Supply): number {
  return Math.ceil(ECONOMY.supplyPrice[kind] * (1 + roadSpread(world)));
}

// Whole units the driver will sell: what it holds above its reserve share of its cap.
export function truckSupplyForSale(npc: Vehicle, kind: Supply): number {
  const cap = kind === "fuel" ? fuelCap(npc) : suppliesCap(npc);
  const held = npc.resources![kind];
  return Math.max(0, Math.floor(held - cap * NPC_UPKEEP.tradeReserve));
}

// Units of a good the driver will sell. It keeps its field repair parts.
export function truckGoodsForSale(npc: Vehicle, good: string): number {
  const held = goodsCount(npc)[good] ?? 0;
  return good === "parts" ? Math.max(0, held - NPC_UPKEEP.repairParts) : held;
}

function requireCount(n: number): void {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Bad trade count ${n}`);
}

// Moves money from payer to payee. A payer in debt or short of the amount throws.
function transfer(world: World, payer: Vehicle, payee: Vehicle, amount: number): void {
  const from = getResources(world, payer);
  if (from.money < 0 || from.money < amount) throw new Error(payer.id === world.player.vehicleId ? 'Not enough money' : `${payer.name} cannot pay that much`);
  from.money -= amount;
  getResources(world, payee).money += amount;
}

export function buyTruckGood(world: World, npcId: string, good: string, n: number): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    requireCount(n);
    if (truckGoodsForSale(npc, good) < n) throw new Error(`${npc.name} will not sell ${n} ${GOODS[good].name}`);
    if (freeCells(me) < n) throw new Error("Not enough cargo space");
    const price = truckGoodPrice(w, good, "buy");
    transfer(w, me, npc, price * n);
    noteCostBasis(w, good, price, n);
    removeGoods(npc, good, n);
    if (addGoods(w, me, good, n) !== n) throw new Error("Cargo capacity invariant failed");
  });
}

export function sellTruckGood(world: World, npcId: string, good: string, n: number): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    requireCount(n);
    if ((goodsCount(me)[good] ?? 0) < n) throw new Error(`Cannot sell ${n} ${GOODS[good].name}`);
    if (freeCells(npc) < n) throw new Error(`No room on ${npc.name}'s truck`);
    const price = truckGoodPrice(w, good, "sell");
    transfer(w, npc, me, price * n);
    removeGoods(me, good, n);
    if (addGoods(w, npc, good, n) !== n) throw new Error("Cargo capacity invariant failed");
    practiceSale(w, npc.id, good, price, n);
  });
}

function takeSpare(v: Vehicle, partId: string): PartInstance {
  const part = spareParts(v).find((p) => p.id === partId);
  if (!part) throw new Error(`${v.name} has no spare part ${partId}`);
  v.items = v.items.filter((it) => it.kind !== "part" || it.part.id !== partId);
  return part;
}

export function buyTruckPart(world: World, npcId: string, partId: string): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    const part = takeSpare(npc, partId);
    transfer(w, me, npc, truckPartPrice(w, part, "buy"));
    if (!stowPart(w, me, part)) throw new Error(`No room in the truck for ${partDef(part.defId).name}`);
  });
}

export function sellTruckPart(world: World, npcId: string, partId: string): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    const me = playerVehicle(w);
    const part = takeSpare(me, partId);
    transfer(w, npc, me, truckPartPrice(w, part, "sell"));
    if (!stowPart(w, npc, part)) throw new Error(`No room on ${npc.name}'s truck for ${partDef(part.defId).name}`);
  });
}

export function buyTruckSupply(world: World, npcId: string, kind: Supply, n: number): World {
  return playerCommand(world, (w) => {
    const { npc } = requireMeeting(w, npcId);
    requireCount(n);
    if (n > truckSupplyForSale(npc, kind)) throw new Error(`${npc.name} will not sell that much ${kind}`);
    if (n > supplyRoom(w, kind)) throw new Error(`No room for ${n} ${kind}`);
    transfer(w, playerVehicle(w), npc, truckSupplyPrice(w, kind) * n);
    npc.resources![kind] -= n;
    w.player[kind] += n;
  });
}
