// Shop screen: every shop the player can park at, town garage or roadside stall.

import { chassisDef, PLAYER_CHASSIS } from "../data/chassis";
import { ECONOMY, GOODS } from "../data/goods";
import { CONTRACTS, shopDef, type ShopDef } from "../data/market";
import { partDef, type PartKind } from "../data/parts";
import { RULES } from "../data/rules";
import { playerVehicle } from "../sim/damage";
import {
  buyChassis,
  buyGood,
  buyPrice,
  buyStockPart,
  buySupply,
  chassisTradeIn,
  partTradePrice,
  repairAll,
  repairCost,
  sellGood,
  sellPart,
  sellPrice,
  supplyRoom,
  type Supply,
} from "../sim/economy";
import { corePart, freeCells, goodsCount, MOUNT_CELLS, mountedParts } from "../sim/grid";
import { spareParts } from "../sim/inventory";
import { vehicleMass } from "../sim/mass";
import { acceptContract, deliverContract, shopAt, shopState, type Contract, type ShopState } from "../sim/market";
import { REGION } from "../data/region";
import type { PartInstance, World } from "../sim/types";
import { maxHp } from "../sim/wear";
import { baselinePart, chassisMap, chassisStats, createIcon, diffStats, goodIcon, partCard, statGrid, type IconName } from "./cards";
import { el, panel } from "./dom";
import { contractSummary } from "./format";
import { InventoryView } from "./inventory";
import type { UiHost } from "./host";
import { fuelLiters, hp, kg } from "./units";

type Tab = "market" | "parts" | "garage" | "trucks" | "contracts";

// The part stock filter. Core parts are built in, so no shop sells them.
type StockFilter = "all" | Exclude<PartKind, "core">;

const STOCK_FILTERS: StockFilter[] = ["all", "weapon", "engine", "armor", "cargo", "scanner"];

const GARAGE_ONLY: Tab[] = ["garage", "trucks"];

// A price is pushed away from the shop's usual factor once trading has moved it this far, worth
// calling out over the plain make/need read. Scaled against PRESSURE_MAX (0.6) in src/data/market.ts.
const PRESSURE_HINT_AT = 0.2;

export class TownScreen {
  private root = panel("modal");
  private tab: Tab = "market";
  private stockFilter: StockFilter = "all";
  private error = "";

  private inventory: InventoryView;

  constructor(private host: UiHost) {
    this.root.classList.add("town-screen");
    this.root.style.display = "none";
    // The truck grid fits its cells to the window height, so a resize lays the screen out again.
    window.addEventListener("resize", () => this.render());
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
    const shop = [el("div", { class: "tabs" }, ...this.tabButtons(def))];
    if (this.error) shop.push(el("div", { class: "bad" }, this.error));
    shop.push(this.tabBody(w, shopId, def));
    const truck = el("div", { class: "town-truck" }, this.inventory.render());
    this.root.replaceChildren(
      el("button", { class: "close", onclick: () => this.close() }, "Leave [Esc]"),
      el("h3", {}, siteName(shopId), headerChips(w)),
      el("div", { class: "town-split" }, truck, el("div", { class: "town-shop" }, ...shop)),
    );
    this.inventory.fitTo(truck);
  }

  // A garage-only tab left over from a garage falls back to Market at a stall.
  private normalizeTab(def: ShopDef): void {
    if (def.kind !== "garage" && GARAGE_ONLY.includes(this.tab)) this.tab = "market";
  }

  private tabButtons(def: ShopDef): HTMLElement[] {
    const tabs: Tab[] = ["market", "parts", ...(def.kind === "garage" ? GARAGE_ONLY : []), "contracts"];
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
        createIcon(TAB_ICON[t]),
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

  private button(label: string, cmd: (w: World) => World, disabled = false, title = ""): HTMLElement {
    return el("button", { disabled, title, onclick: () => this.run(cmd) }, label);
  }

  // Mount cells for a hovered card's part kind light up on the truck grid.
  private hintMounts(kind: PartKind): (on: boolean) => void {
    return (on) => this.inventory.hintMounts(on ? MOUNT_CELLS[kind] : null);
  }

  private market(w: World, shopId: string, def: ShopDef): HTMLElement {
    const state = shopState(w, shopId);
    return el(
      "div",
      { class: "goods" },
      el("div", { class: "goods-head dim" }, el("span", {}, "Good"), el("span", {}, "Buy"), el("span", {}, "Sell"), el("span", {}, "In truck")),
      ...def.goods.map((g) => this.goodRow(w, shopId, def, state, g)),
    );
  }

  private goodRow(w: World, shopId: string, def: ShopDef, state: ShopState, g: string): HTMLElement {
    const held = goodsCount(playerVehicle(w))[g] ?? 0;
    const sell = sellPrice(w, shopId, g);
    const hint = pressureHint(def, state, g);
    return el(
      "div",
      { class: "good-row", title: goodPriceTitle(def, state, g) },
      el(
        "div",
        { class: "good-name" },
        createIcon(goodIcon(g)),
        el("b", {}, GOODS[g].name),
        hint ? el("span", { class: `tag ${hint.cls}` }, hint.text) : null,
      ),
      el(
        "div",
        { class: "trade" },
        priceEl(buyPrice(w, shopId, g)),
        this.button("+1", (x) => buyGood(x, g, 1)),
        this.button("+5", (x) => buyGood(x, g, 5)),
      ),
      el(
        "div",
        { class: "trade" },
        priceEl(sell),
        this.button("−1", (x) => sellGood(x, g, 1), held === 0),
        this.button("All", (x) => sellGood(x, g, held), held === 0),
      ),
      heldEl(held, sell, w.player.costBasis[g]),
    );
  }

  private parts(w: World, shopId: string): HTMLElement {
    const me = playerVehicle(w);
    const stock = shopState(w, shopId).stock;
    const shown = stock.filter((p) => this.stockFilter === "all" || partDef(p.defId).kind === this.stockFilter);
    const cards = shown.map((p) => {
      const kind = partDef(p.defId).kind;
      const price = partTradePrice(w, me, p, "buy");
      return partCard({
        part: p,
        base: baselinePart(me, kind),
        action: this.button(`Buy ${price}`, (x) => buyStockPart(x, p.id), w.player.money < price),
        onHover: this.hintMounts(kind),
      });
    });
    return el(
      "div",
      {},
      el("div", { class: "tabs sub" }, ...this.stockFilterButtons(stock)),
      cards.length
        ? el("div", { class: "cards" }, ...cards)
        : el("div", { class: "dim" }, stock.length ? "No parts of this kind in stock." : "No parts in stock right now."),
    );
  }

  // One button per part kind with its stock count. A kind with nothing in stock is disabled.
  private stockFilterButtons(stock: PartInstance[]): HTMLElement[] {
    return STOCK_FILTERS.map((f) => {
      const count = f === "all" ? stock.length : stock.filter((p) => partDef(p.defId).kind === f).length;
      return el(
        "button",
        {
          class: this.stockFilter === f ? "on" : "",
          disabled: count === 0 && f !== "all",
          title: STOCK_FILTER_LABEL[f],
          onclick: () => {
            this.stockFilter = f;
            this.render();
          },
        },
        f === "all" ? "All" : createIcon(FILTER_ICON[f]),
        el("span", { class: "count" }, `${count}`),
      );
    });
  }

  private garage(w: World): HTMLElement {
    const me = playerVehicle(w);
    const sellable: PartInstance[] = [...w.player.storage, ...spareParts(me)];
    const cards = sellable.map((p) => {
      const kind = partDef(p.defId).kind;
      return partCard({
        part: p,
        base: baselinePart(me, kind),
        action: this.button(`Sell ${partTradePrice(w, me, p, "sell")}`, (x) => sellPart(x, p.id)),
        onHover: this.hintMounts(kind),
      });
    });
    return el(
      "div",
      {},
      el("div", { class: "services" }, this.supplyRow(w, "fuel"), this.supplyRow(w, "supplies"), this.repairRow(w)),
      el("h3", {}, "Sell spare and stored parts"),
      cards.length ? el("div", { class: "cards" }, ...cards) : el("div", { class: "dim" }, "No spare or stored parts."),
    );
  }

  private supplyRow(w: World, k: Supply): HTMLElement {
    const room = supplyRoom(w, k);
    const price = ECONOMY.supplyPrice[k];
    const afford = Math.min(room, Math.floor(w.player.money / price));
    const fuel = k === "fuel";
    const have = w.player[k];
    const cap = fuel ? chassisDef(playerVehicle(w).chassisId).fuelCap : RULES.suppliesCap;
    const amount = (n: number) => (fuel ? `${fuelLiters(n)} L` : `${Math.round(n * 10) / 10}`);
    return el(
      "div",
      { class: "service" },
      createIcon(k),
      el("div", { class: "service-meter" }, el("span", {}, `${amount(have)} / ${amount(cap)}`), bar(have / cap)),
      el("span", { class: "dim" }, fuel ? `${price} per ${amount(1)}` : `${price} each`),
      this.button(`+${amount(1)}`, (x) => buySupply(x, k, 1), afford < 1),
      this.button(`Fill ${amount(afford)}`, (x) => buySupply(x, k, afford), afford < 1),
    );
  }

  private repairRow(w: World): HTMLElement {
    const me = playerVehicle(w);
    const cab = corePart(me, "cab");
    const broken = mountedParts(me).filter((p) => p.hp === 0).length;
    const cost = repairCost(w);
    return el(
      "div",
      { class: "service" },
      createIcon("tools"),
      el("div", { class: "service-meter" }, el("span", {}, `Cab ${hp(cab.hp)} / ${hp(maxHp(cab))}`), bar(cab.hp / maxHp(cab))),
      el("span", { class: broken ? "bad" : "dim" }, broken ? `${broken} broken` : "Nothing broken"),
      el("span"),
      this.button(cost === 0 ? "No repairs" : `Repair all ${cost}`, repairAll, cost === 0),
    );
  }

  private trucks(w: World): HTMLElement {
    const me = playerVehicle(w);
    const tradeIn = chassisTradeIn(w);
    const mine = chassisStats(me.chassisId);
    const cards = PLAYER_CHASSIS.map((id) => {
      const cost = Math.max(0, chassisDef(id).value - tradeIn);
      const own = me.chassisId === id;
      return el(
        "div",
        { class: `card truck-card${own ? " own" : ""}` },
        chassisMap(id),
        el(
          "div",
          { class: "truck-body" },
          el("div", { class: "card-name" }, el("b", {}, chassisDef(id).name)),
          statGrid(diffStats(chassisStats(id), own ? null : mine)),
          el(
            "div",
            { class: "card-foot" },
            el("span", { class: "dim" }, own ? "Your truck" : `vs ${chassisDef(me.chassisId).name}`),
            own ? null : this.button(`Swap ${cost}`, (x) => buyChassis(x, id), w.player.money < cost),
          ),
        ),
      );
    });
    return el(
      "div",
      {},
      el(
        "div",
        { class: "note" },
        createIcon("money"),
        `Your truck trades in for ${tradeIn}. Parts and goods move over. Parts that do not fit go to storage.`,
      ),
      el("div", { class: "cards trucks" }, ...cards),
    );
  }

  private contracts(w: World, shopId: string): HTMLElement {
    const board = shopState(w, shopId).contracts;
    const full = w.player.contracts.length >= CONTRACTS.maxActive;
    const accept = (c: Contract) =>
      this.button("Accept", (x) => acceptContract(x, c.id), full, full ? `You already hold ${CONTRACTS.maxActive} contracts` : "");
    return el(
      "div",
      {},
      el("h3", {}, "Contract board"),
      board.length
        ? el("div", { class: "jobs" }, ...board.map((c) => contractRow(w, c, accept(c))))
        : el("div", { class: "dim" }, "No offers right now."),
      el("h3", {}, `Your contracts ${w.player.contracts.length} / ${CONTRACTS.maxActive}`),
      w.player.contracts.length
        ? el("div", { class: "jobs" }, ...w.player.contracts.map((c) => contractRow(w, c, this.deliverCell(w, shopId, c))))
        : el("div", { class: "dim" }, "You hold no contracts."),
    );
  }

  private deliverCell(w: World, shopId: string, c: Contract): HTMLElement {
    if (c.kind === "bounty") return el("span", { class: "dim" }, "Pays when the target is destroyed");
    const destination = c.kind === "haul" ? c.to : c.shop;
    if (destination !== shopId) return el("span", { class: "dim" }, `Deliver at ${siteName(destination)}`);
    if (!canDeliver(w, c)) return el("span", { class: "dim" }, c.kind === "haul" ? "Not enough cargo yet" : "Needs the part");
    return this.button("Deliver", (x) => deliverContract(x, c.id));
  }
}

const STOCK_FILTER_LABEL: Record<StockFilter, string> = {
  all: "All",
  weapon: "Weapons",
  engine: "Engines",
  armor: "Armor",
  cargo: "Cargo",
  scanner: "Scanners",
};

const FILTER_ICON: Record<Exclude<StockFilter, "all">, IconName> = {
  weapon: "cannon",
  engine: "engine",
  armor: "armor",
  cargo: "cargo",
  scanner: "scanner",
};

const TAB_LABEL: Record<Tab, string> = {
  market: "Market",
  parts: "Parts",
  garage: "Garage",
  trucks: "Trucks",
  contracts: "Contracts",
};

const TAB_ICON: Record<Tab, IconName> = {
  market: "salt",
  parts: "parts",
  garage: "tools",
  trucks: "truck",
  contracts: "clock",
};

const CONTRACT_ICON: Record<Contract["kind"], IconName> = {
  haul: "cargo",
  fetch: "parts",
  bounty: "cannon",
};

function headerChips(w: World): HTMLElement {
  const me = playerVehicle(w);
  const mass = vehicleMass(me);
  const rated = chassisDef(me.chassisId).ratedMass;
  return el(
    "span",
    { class: "chips" },
    el("span", { class: "chip" }, createIcon("truck"), chassisDef(me.chassisId).name),
    el("span", { class: `chip${w.player.money < 0 ? " bad" : ""}`, title: "Money" }, createIcon("money"), `${w.player.money}`),
    el("span", { class: "chip", title: "Free cargo cells" }, createIcon("cells"), `${freeCells(me)} free`),
    el(
      "span",
      { class: `chip${mass > rated ? " bad" : ""}`, title: "Mass against rated load. Over it, the truck slows and turns wider." },
      createIcon("load"),
      `${kg(mass)} / ${kg(rated)}`,
    ),
  );
}

function priceEl(price: number): HTMLElement {
  return el("span", { class: "price" }, createIcon("money"), `${price}`);
}

// The count in the truck and the profit per unit against the price paid, when sold here.
function heldEl(held: number, sell: number, basis: number | undefined): HTMLElement {
  if (held === 0) return el("span", { class: "dim" }, "–");
  if (basis === undefined) return el("span", { class: "held" }, `×${held}`);
  return el("span", { class: "held", title: `Paid about ${Math.round(basis)} each` }, `×${held}`, profitEl(Math.round(sell - basis)));
}

function profitEl(profit: number): HTMLElement {
  const gain = profit >= 0;
  return el("span", { class: `delta ${gain ? "better" : "worse"}` }, `${gain ? "+" : "−"}${Math.abs(profit)} each`);
}

function bar(share: number): HTMLElement {
  return el("div", { class: "meter" }, el("div", { style: `width:${Math.max(0, Math.min(1, share)) * 100}%` }));
}

function contractRow(w: World, c: Contract, action: HTMLElement): HTMLElement {
  return el(
    "div",
    { class: "job" },
    createIcon(CONTRACT_ICON[c.kind]),
    el("span", {}, contractSummary(c)),
    el("span", { class: "price" }, createIcon("money"), `${c.reward}`),
    el("span", { class: "price", title: "Turns left" }, createIcon("clock"), `${c.deadline - w.turn}`),
    action,
  );
}

// "cheap here" / "dear here" read the shop's make/need profile; "flooded" / "short" read standing
// pressure once trading has moved a price far enough to notice. cls says whether it favors buying or selling.
function pressureHint(def: ShopDef, state: ShopState, good: string): { text: string; cls: "buy" | "sell" } | null {
  const pressure = state.pressure[good] ?? 0;
  if (pressure >= PRESSURE_HINT_AT) return { text: "short", cls: "sell" };
  if (pressure <= -PRESSURE_HINT_AT) return { text: "flooded", cls: "buy" };
  if (def.makes.includes(good)) return { text: "cheap here", cls: "buy" };
  if (def.needs.includes(good)) return { text: "dear here", cls: "sell" };
  return null;
}

function goodPriceTitle(def: ShopDef, state: ShopState, good: string): string {
  const factor = def.makes.includes(good) ? "made here" : def.needs.includes(good) ? "needed here" : "traded plainly here";
  const pressure = Math.round((state.pressure[good] ?? 0) * 100);
  return `Base value ${GOODS[good].value}. ${factor}. Local pressure ${pressure >= 0 ? "+" : ""}${pressure}%.`;
}

// True when the player already holds what a haul or fetch contract needs to hand in.
function canDeliver(w: World, c: Contract): boolean {
  const me = playerVehicle(w);
  if (c.kind === "haul") return (goodsCount(me)[c.good] ?? 0) >= c.units;
  if (c.kind === "fetch")
    return spareParts(me).some((p) => p.defId === c.defId) || w.player.storage.some((p) => p.defId === c.defId);
  return false;
}

function siteName(id: string): string {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site.name;
}
