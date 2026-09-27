// Shop screen: every shop the player can park at, town garage or roadside stall.

import { chassisDef, PLAYER_CHASSIS } from "../data/chassis";
import { ECONOMY, GOODS } from "../data/goods";
import { CONTRACTS, shopDef, type ShopDef } from "../data/market";
import { partDef, type PartDef } from "../data/parts";
import { isJunk, maxHp } from "../sim/wear";
import { playerVehicle } from "../sim/damage";
import {
  buyChassis,
  buyGood,
  buyPrice,
  buyStockPart,
  buySupply,
  chassisTradeIn,
  getLotTradePrice,
  partRepairCost,
  partTradePrice,
  repairAll,
  repairCost,
  sellGood,
  sellPart,
  sellPrice,
  supplyRoom,
  type Supply,
} from "../sim/economy";
import {
  baseGrid,
  cellCount,
  corePart,
  freeCells,
  goodsCount,
  mountedParts,
} from "../sim/grid";
import { spareParts } from "../sim/inventory";
import { acceptContract, deliverContract, shopAt, shopState, type Contract, type ShopState } from "../sim/market";
import { REGION } from "../data/region";
import type { PartInstance, Vehicle, World } from "../sim/types";
import { el, panel } from "./dom";
import { contractDue, contractSummary, wearLabel } from "./format";
import { InventoryView } from "./inventory";
import type { UiHost } from "./host";
import { fuelLiters, hp, kg, kph, liters, meters, mps2 } from "./units";

type Tab = "market" | "parts" | "garage" | "trucks" | "contracts";

const GARAGE_ONLY: Tab[] = ["garage", "trucks"];

// A price is pushed away from the shop's usual factor once trading has moved it this far, worth
// calling out over the plain make/need read. Scaled against PRESSURE_MAX (0.6) in src/data/market.ts.
const PRESSURE_HINT_AT = 0.2;

export class TownScreen {
  private root = panel("modal");
  private tab: Tab = "market";
  private error = "";

  private inventory: InventoryView;

  constructor(private host: UiHost) {
    this.root.style.display = "none";
    this.inventory = new InventoryView(host, () => this.render());
  }

  isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  open(): void {
    this.root.style.display = "";
    this.error = "";
    this.render();
  }

  // Closed windows drop their contents, so hidden copies never answer clicks or drops.
  close(): void {
    this.root.style.display = "none";
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    const w = this.host.world();
    const shopId = shopAt(w);
    if (!shopId) return this.close();
    const def = shopDef(shopId);
    this.normalizeTab(def);
    const me = playerVehicle(w);
    const children = [
      el("button", { class: "close", onclick: () => this.close() }, "Leave [Esc]"),
      el("h3", {}, siteName(shopId)),
      el("div", { class: "dim" }, `${moneyLine(w)}   Free cells ${freeCells(me)}`),
      el("div", { class: "tabs" }, ...this.tabButtons(def)),
    ];
    if (this.error) children.push(el("div", { class: "bad" }, this.error));
    children.push(this.tabBody(w, shopId, def));
    this.root.replaceChildren(...children);
  }

  // A garage-only tab left over from a garage falls back to Market at a stall.
  private normalizeTab(def: ShopDef): void {
    if (def.kind !== "garage" && GARAGE_ONLY.includes(this.tab)) this.tab = "market";
  }

  private tabButtons(def: ShopDef): HTMLElement[] {
    const tabs: Tab[] = [
      "market",
      "parts",
      ...(def.kind === "garage" ? (["garage", "trucks"] as Tab[]) : []),
      "contracts",
    ];
    return tabs.map((t) =>
      el(
        "button",
        {
          class: this.tab === t ? "on" : "",
          onclick: () => {
            this.tab = t;
            this.render();
          },
        },
        TAB_LABEL[t],
      ),
    );
  }

  private tabBody(w: World, shopId: string, def: ShopDef): HTMLElement {
    const body: Record<Tab, () => HTMLElement> = {
      market: () => this.market(w, shopId, def),
      parts: () => this.parts(w, shopId),
      garage: () => this.garage(w),
      trucks: () => this.trucks(w),
      contracts: () => this.contracts(w, shopId),
    };
    return body[this.tab]();
  }

  // Runs a command; a thrown rule error shows in the screen instead of changing the world.
  private run(cmd: (w: World) => World): void {
    try {
      this.host.apply(cmd(this.host.world()));
      this.error = "";
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.render();
  }

  private market(w: World, shopId: string, def: ShopDef): HTMLElement {
    const me = playerVehicle(w);
    const state = shopState(w, shopId);
    const rows = def.goods.map((g) => {
      const held = goodsCount(me)[g] ?? 0;
      const basis = w.player.costBasis[g];
      const hint = pressureHint(def, state, g);
      return el(
        "tr",
        {},
        el("td", {}, GOODS[g].name),
        el(
          "td",
          { title: goodPriceTitle(def, state, g) },
          `${buyPrice(w, shopId, g)}`,
        ),
        el(
          "td",
          { title: goodPriceTitle(def, state, g) },
          `${sellPrice(w, shopId, g)}`,
        ),
        el("td", { class: "dim" }, hint ?? ""),
        el("td", {}, held ? `${held} (paid ~${Math.round(basis ?? 0)})` : "-"),
        el(
          "td",
          {},
          el(
            "button",
            { onclick: () => this.run((x) => buyGood(x, g, 1)) },
            "Buy 1",
          ),
          " ",
          el(
            "button",
            { onclick: () => this.run((x) => buyGood(x, g, 5)) },
            `Buy 5 for ${getLotTradePrice(w, me, shopId, g, 5, "buy")}`,
          ),
          " ",
          el(
            "button",
            {
              disabled: held === 0,
              onclick: () => this.run((x) => sellGood(x, g, 1)),
            },
            "Sell 1",
          ),
          " ",
          el(
            "button",
            {
              disabled: held === 0,
              onclick: () => this.run((x) => sellGood(x, g, held)),
            },
            held
              ? `Sell all for ${getLotTradePrice(w, me, shopId, g, held, "sell")}`
              : "Sell all",
          ),
        ),
      );
    });
    return el(
      "table",
      {},
      el(
        "tr",
        {},
        el("th", {}, "Good"),
        el("th", {}, "Buy"),
        el("th", {}, "Sell"),
        el("th", {}, "Market"),
        el("th", {}, "Held"),
        el("th", {}),
      ),
      ...rows,
    );
  }

  private parts(w: World, shopId: string): HTMLElement {
    const me = playerVehicle(w);
    const stock = shopState(w, shopId).stock;
    if (stock.length === 0)
      return el("div", { class: "dim" }, "No parts in stock right now.");
    const rows = stock.map((p) => {
      const d = partDef(p.defId);
      const price = partTradePrice(w, me, p, "buy");
      return el(
        "tr",
        {},
        el("td", { class: "dim" }, d.kind),
        el(
          "td",
          { title: partPriceTitle(p) },
          `${d.name} ${d.w}x${d.h}: ${partStats(d)}, ${wearLabel(p)} ${p.hp}/${maxHp(p)} HP`,
        ),
        el(
          "td",
          {},
          el(
            "button",
            {
              disabled: w.player.money < price,
              onclick: () => this.run((x) => buyStockPart(x, p.id)),
            },
            `Buy ${price}`,
          ),
        ),
      );
    });
    return el("table", {}, ...rows);
  }

  // Supplies. Only a garage sells fuel and food; a stall's stock is parts and goods alone.
  private supplies(w: World): HTMLElement {
    const rows = (["fuel", "supplies"] as Supply[]).map((k) => {
      const room = supplyRoom(w, k);
      const price = ECONOMY.supplyPrice[k];
      const afford = Math.min(room, Math.floor(w.player.money / price));
      return el(
        "tr",
        {},
        el("td", {}, k),
        el(
          "td",
          {},
          k === "fuel"
            ? `${fuelLiters(w.player.fuel)} L`
            : w.player.supplies.toFixed(1),
        ),
        el(
          "td",
          {},
          k === "fuel" ? `${price} per ${fuelLiters(1)} L` : `${price} each`,
        ),
        el(
          "td",
          {},
          el(
            "button",
            {
              disabled: afford < 1,
              onclick: () => this.run((x) => buySupply(x, k, 1)),
            },
            k === "fuel" ? `Buy ${fuelLiters(1)} L` : "Buy 1",
          ),
          " ",
          el(
            "button",
            {
              disabled: afford < 1,
              onclick: () => this.run((x) => buySupply(x, k, afford)),
            },
            `Fill (${k === "fuel" ? `${fuelLiters(afford)} L` : afford})`,
          ),
        ),
      );
    });
    return el(
      "table",
      {},
      el(
        "tr",
        {},
        el("th", {}, "Supply"),
        el("th", {}, "Have"),
        el("th", {}, "Price"),
        el("th", {}),
      ),
      ...rows,
    );
  }

  private garage(w: World): HTMLElement {
    const me = playerVehicle(w);
    const cost = repairCost(w);
    const sellable: PartInstance[] = [...w.player.storage, ...spareParts(me)];
    const rows = sellable.map((s) => {
      const price = partTradePrice(w, me, s, "sell");
      const broken = s.hp === 0 && !isJunk(s);
      return el(
        "tr",
        {},
        el("td", { class: "dim" }, partDef(s.defId).kind),
        el("td", {}, partLabel(s)),
        el(
          "td",
          { class: "dim" },
          broken ? `Rebuild ${partRepairCost(w, s)}` : "",
        ),
        el(
          "td",
          {},
          el(
            "button",
            { onclick: () => this.run((x) => sellPart(x, s.id)) },
            `Sell for ${price}`,
          ),
        ),
      );
    });
    return el(
      "div",
      {},
      el("h3", {}, "Fuel & supplies"),
      this.supplies(w),
      el(
        "div",
        {},
        `${cabLine(me)}. `,
        el(
          "button",
          { disabled: cost === 0, onclick: () => this.run(repairAll) },
          `Repair all: ${cost}`,
        ),
      ),
      el("h3", {}, "Truck"),
      this.inventory.render(),
      el("h3", {}, "Sell storage or spare parts"),
      rows.length
        ? el("table", {}, ...rows)
        : el("div", { class: "dim" }, "Nothing to sell."),
    );
  }

  private trucks(w: World): HTMLElement {
    const me = playerVehicle(w);
    const tradeIn = chassisTradeIn(w);
    const rows = PLAYER_CHASSIS.map((id) => {
      const c = chassisDef(id);
      const mine = me.chassisId === id;
      const cost = Math.max(0, c.value - tradeIn);
      return el(
        "tr",
        {},
        el("td", {}, c.name),
        el(
          "td",
          { class: "dim" },
          `${kph(c.maxSpeed)} km/h, turn ${c.turnFast}-${c.turnSlow}°, ${liters(cellCount(baseGrid(id)))} L cargo, ${kg(c.mass)} empty, rated ${kg(c.ratedMass)}, tank ${fuelLiters(c.fuelCap)} L`,
        ),
        el(
          "td",
          {},
          mine
            ? "yours"
            : el(
                "button",
                {
                  disabled: w.player.money < cost,
                  onclick: () => this.run((x) => buyChassis(x, id)),
                },
                `Swap for ${cost}`,
              ),
        ),
      );
    });
    return el(
      "div",
      {},
      el(
        "div",
        { class: "dim" },
        `Your truck trades in for ${tradeIn}. Parts and goods move over. Parts that do not fit go to storage.`,
      ),
      el("table", {}, ...rows),
    );
  }

  private contracts(w: World, shopId: string): HTMLElement {
    const board = shopState(w, shopId).contracts;
    const full = w.player.contracts.length >= CONTRACTS.maxActive;
    const boardRows = board.map((c) =>
      el(
        "tr",
        {},
        el("td", {}, contractSummary(c)),
        el("td", {}, `${c.reward}`),
        el("td", {}, contractDue(c)),
        el(
          "td",
          {},
          el(
            "button",
            {
              disabled: full,
              title: full
                ? `You already hold ${CONTRACTS.maxActive} contracts`
                : "",
              onclick: () => this.run((x) => acceptContract(x, c.id)),
            },
            "Accept",
          ),
        ),
      ),
    );
    const activeRows = w.player.contracts.map((c) =>
      el(
        "tr",
        {},
        el("td", {}, contractSummary(c)),
        el("td", {}, `${c.reward}`),
        el("td", {}, contractDue(c)),
        el("td", {}, this.deliverCell(w, shopId, c)),
      ),
    );
    return el(
      "div",
      {},
      el("h3", {}, "Contract board"),
      board.length
        ? el(
            "table",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Job"),
              el("th", {}, "Pay"),
              el("th", {}, "Deadline"),
              el("th", {}),
            ),
            ...boardRows,
          )
        : el("div", { class: "dim" }, "No offers right now."),
      el("h3", {}, "Your contracts"),
      w.player.contracts.length
        ? el(
            "table",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Job"),
              el("th", {}, "Pay"),
              el("th", {}, "Deadline"),
              el("th", {}),
            ),
            ...activeRows,
          )
        : el("div", { class: "dim" }, "You hold no contracts."),
    );
  }

  private deliverCell(w: World, shopId: string, c: Contract): HTMLElement {
    if (c.kind === "bounty")
      return el("span", { class: "dim" }, "Pays when the target is destroyed");
    const destination = c.kind === "haul" ? c.to : c.shop;
    if (destination !== shopId)
      return el("span", { class: "dim" }, `Deliver at ${siteName(destination)}`);
    if (!canDeliver(w, c))
      return el(
        "span",
        { class: "dim" },
        c.kind === "haul" ? "Not enough cargo yet" : "Needs the part",
      );
    return el(
      "button",
      { onclick: () => this.run((x) => deliverContract(x, c.id)) },
      "Deliver",
    );
  }
}

const TAB_LABEL: Record<Tab, string> = {
  market: "Market",
  parts: "Parts",
  garage: "Garage",
  trucks: "Trucks",
  contracts: "Contracts",
};

// "cheap here" / "dear here" read the shop's make/need profile; "flooded" / "short" read standing
// pressure once trading has moved a price far enough to notice.
function pressureHint(def: ShopDef, state: ShopState, good: string): string | null {
  const pressure = state.pressure[good] ?? 0;
  if (pressure >= PRESSURE_HINT_AT) return "short";
  if (pressure <= -PRESSURE_HINT_AT) return "flooded";
  if (def.makes.includes(good)) return "cheap here";
  if (def.needs.includes(good)) return "dear here";
  return null;
}

function goodPriceTitle(def: ShopDef, state: ShopState, good: string): string {
  const factor = def.makes.includes(good)
    ? "made here"
    : def.needs.includes(good)
      ? "needed here"
      : "traded plainly here";
  const pressure = Math.round((state.pressure[good] ?? 0) * 100);
  return `Base value ${GOODS[good].value}. ${factor}. Local pressure ${pressure >= 0 ? "+" : ""}${pressure}%.`;
}

function partPriceTitle(p: PartInstance): string {
  const d = partDef(p.defId);
  const condition = Math.round((p.hp / maxHp(p)) * 100);
  return `Base value ${d.value}. Wear: ${wearLabel(p)}. Condition ${condition}%.`;
}

// True when the player already holds what a haul or fetch contract needs to hand in.
function canDeliver(w: World, c: Contract): boolean {
  const me = playerVehicle(w);
  if (c.kind === "haul") return (goodsCount(me)[c.good] ?? 0) >= c.units;
  if (c.kind === "fetch")
    return (
      spareParts(me).some((p) => p.defId === c.defId) ||
      w.player.storage.some((p) => p.defId === c.defId)
    );
  return false;
}

function moneyLine(w: World): string {
  return w.player.money < 0 ? `Debt ${-w.player.money}` : `Money ${w.player.money}`;
}

function siteName(id: string): string {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site.name;
}

function cabLine(v: Vehicle): string {
  const cab = corePart(v, "cab");
  const broken = mountedParts(v).filter((p) => p.hp === 0).length;
  return `Cab ${hp(cab.hp)}/${hp(maxHp(cab))}, ${broken} broken ${broken === 1 ? "part" : "parts"}`;
}

function partLabel(p: PartInstance): string {
  const d = partDef(p.defId);
  return `${d.name} ${wearLabel(p)} ${hp(p.hp)}/${hp(maxHp(p))}${p.hp === 0 ? " BROKEN" : ""}`;
}

function partStats(d: PartDef): string {
  return `${kindStats(d)}, armor ${d.armor}, ${d.mass} kg`;
}

function kindStats(d: PartDef): string {
  switch (d.kind) {
    case "weapon":
      return `${d.rounds} × dmg ${d.round.damage}, pen ${d.round.pen}, spread ${d.spread}°, range ${meters(d.range)} m, reload ${d.reload}, arc ${d.arc}°`;
    case "engine":
      return `speed ${d.speedBonus >= 0 ? "+" : ""}${kph(d.speedBonus)} km/h, accel ${d.accelBonus >= 0 ? "+" : ""}${mps2(d.accelBonus)} m/s², fuel x${d.fuelMult}`;
    case "armor":
      return d.ramMult > 1 ? `ram x${d.ramMult}` : "side armor";
    case "cargo":
      return `+${d.extraRows} grid rows`;
    case "core":
      return `built-in ${d.role}`;
    case "scanner":
      return `radio range ${meters(d.range)} m`;
  }
}
