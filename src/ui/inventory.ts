// Dredge-style inventory grid: drag items to arrange them, R or right click rotates while dragging.
// In a town the garage storage shows beside the grid.

import { GOODS } from "../data/goods";
import { chassisDef } from "../data/chassis";
import { partDef, type PartKind } from "../data/parts";
import { RULES } from "../data/rules";
import { STRIP } from "../data/salvage";
import { isJunk, maxHp } from "../sim/wear";
import { playerVehicle } from "../sim/damage";
import { partRepairCost, repairPart } from "../sim/economy";
import {
  freeCells,
  goodsCount,
  gridOf,
  isMounted,
  itemCells,
  placementError,
  type Cell,
  type Spot,
} from "../sim/grid";
import {
  dumpItem,
  moveItem,
  planItemMove,
  storePart,
  takeFromStorage,
} from "../sim/inventory";
import { startRepair, startStrip, stripYield } from "../sim/jobs";
import { repairPlan, type RepairPlan } from "../sim/repair";
import { townAt } from "../sim/sites";
import { takeAllLoot, takeLoot, takeStores } from "../sim/locations";
import { hasStores } from "../sim/salvage";
import { REGION } from "../data/region";
import type {
  GridItem,
  PartInstance,
  RefitJob,
  RefitMove,
  SalvageStock,
  Vehicle,
  World,
} from "../sim/types";
import { el, panel } from "./dom";
import { wearLabel } from "./format";
import type { UiHost } from "./host";
import { createIcon, type IconName } from "./icons";
import { vehicleMass } from "../sim/mass";
import { fuelLiters, hp, kg, liters } from "./units";

const CELL_PX = 42;

const CELL_TITLE: Record<Cell, string> = {
  W: "weapon mount",
  E: "engine mount",
  C: "cargo mount",
  F: "front armor mount",
  B: "back armor mount",
  L: "left armor mount",
  R: "right armor mount",
  X: "built-in part",
  ".": "",
};
const KIND_CLASS: Record<PartKind, string> = {
  weapon: "k-weapon",
  engine: "k-engine",
  armor: "k-armor",
  cargo: "k-cargo",
  core: "k-core",
  scanner: "k-weapon",
};

type Drag = {
  source: "grid" | "storage" | "loot";
  id: string; // grid item id, storage part id, loot part id, or a loot good id
  item: GridItem; // the item as it would be placed, position updated while dragging
  grab: { x: number; y: number }; // grabbed cell inside the item
  ghost: HTMLElement;
  start: { x: number; y: number };
  moved: boolean;
};

export class InventoryView {
  private drag: Drag | null = null;
  private lastPointer: PointerEvent | null = null;
  private error = "";
  private gridEl: HTMLElement | null = null;
  private root: HTMLElement = el("div");
  private inspection = el("div", { class: "inv-inspection" });
  private selectedItem: string | null = null;
  private loot: string | null = null; // salvage stock shown beside the grid, after a finished search

  constructor(
    private host: UiHost,
    private onChange: () => void,
  ) {
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onDrop(e));
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "r" || e.repeat) return;
      if (this.drag) this.rotate();
      else this.rotateSelected();
    });
    window.addEventListener("contextmenu", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      this.rotate();
    });
  }

  // Shows a searched salvage stock beside the grid, or hides it with null.
  setLoot(stockId: string | null): void {
    this.loot = stockId;
  }

  render(): HTMLElement {
    const w = this.host.world();
    const me = playerVehicle(w);
    const g = gridOf(me);
    const selected = me.items.find((item) => item.id === this.selectedItem);
    if (selected)
      this.showItem(
        w,
        selected,
        selected.kind === "part" && isMounted(me.chassisId, selected),
      );
    else
      this.inspection.replaceChildren(
        el("h3", {}, "Equipment"),
        el("p", {}, "Select a part or cargo to inspect it."),
      );
    const grid = el("div", {
      class: "inv-grid",
      style: `width:${g.w * CELL_PX}px;height:${g.h * CELL_PX}px`,
    });
    grid.addEventListener("contextmenu", (e) => e.preventDefault());
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const c = g.cells[y][x];
        if (c === null) continue;
        grid.append(
          el(
            "div",
            {
              class: `inv-cell c-${c === "." ? "plain" : c}`,
              style: pos(x, y, 1, 1),
              title: CELL_TITLE[c],
            },
            c === "." || c === "X" ? "" : c,
          ),
        );
      }
    }
    grid.append(...this.gridItems(w, me));
    this.gridEl = grid;
    const inTown = townAt(w) !== null;
    this.root.replaceChildren(
      el(
        "div",
        { class: "inv-wrap" },
        el(
          "div",
          { class: "inv-truck" },
          el(
            "div",
            { class: "truck-shell" },
            el("div", { class: "truck-nose", "aria-hidden": "true" }),
            grid,
          ),
          this.legend(),
        ),
        el(
          "div",
          { class: "inv-side" },
          this.inspection,
          this.loot
            ? this.lootEl(w, this.loot)
            : inTown
              ? this.storageEl(w)
              : el(
                  "div",
                  { class: "dim" },
                  "Park to install or remove parts: 5 turns each, 10 to replace. Driving cancels the work. Goods and spares move instantly.",
                ),
          el(
            "div",
            { class: "inv-dump", "data-drop": "dump" },
            "Drop goods or loose parts here to dump them",
          ),
        ),
      ),
      this.error ? el("div", { class: "bad" }, this.error) : el("div"),
    );
    return this.root;
  }

  private legend(): HTMLElement {
    return el(
      "details",
      { class: "dim inv-legend" },
      el("summary", {}, "Mounts & controls"),
      el(
        "div",
        {},
        "Top view, nose up. W E C: weapon, engine, cargo mounts. F B L R: armor mounts on the front, back, left and right.",
      ),
      el(
        "div",
        {},
        "A part works only when it lies fully on one of its letters. Built-in parts are fixed and can only be repaired.",
      ),
      el(
        "div",
        {},
        "Select an item, then click another to swap. Drag to move or swap. R turns the selected part, or the dragged item. Right click also turns it while dragging.",
      ),
    );
  }

  private itemEl(w: World, it: GridItem): HTMLElement {
    const me = playerVehicle(w);
    const cells = itemCells(it);
    const x = Math.min(...cells.map((c) => c.x));
    const y = Math.min(...cells.map((c) => c.y));
    const wd = Math.max(...cells.map((c) => c.x)) - x + 1;
    const ht = Math.max(...cells.map((c) => c.y)) - y + 1;
    const label = itemLabel(it);
    const mounted = it.kind === "part" && isMounted(me.chassisId, it);
    const core = it.kind === "part" && partDef(it.part.defId).kind === "core";
    const state = core ? "fixed" : mounted ? "mounted" : "spare";
    const cls =
      it.kind === "part"
        ? `${KIND_CLASS[partDef(it.part.defId).kind]} ${state}`
        : `k-good g-${it.good}`;
    const node = el(
      "div",
      {
        class: `inv-item ${cls}`,
        "aria-pressed": String(this.selectedItem === it.id),
        "data-item-id": it.id,
        style: pos(x, y, wd, ht),
        title: itemTitle(it, mounted),
        tabindex: 0,
        role: "button",
        "aria-label": itemTitle(it, mounted),
      },
      createIcon(getItemIcon(it)),
      el("span", { class: "inv-item-name" }, label.short),
    );
    node.classList.toggle("selected", this.selectedItem === it.id);
    const inspect = () => this.showItem(w, it, mounted);
    node.addEventListener("click", (e) => {
      if (core || e.detail === 0) this.activateItem(it);
    });
    node.addEventListener("focus", inspect);
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.activateItem(it);
    });
    if (it.kind === "part") node.append(conditionBar(it.part));
    if (!core)
      node.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        // The grab uses the same grid math as spotAt, so a drop where the drag began lands on the item's own spot.
        if (!this.gridEl) throw new Error("Grid item pressed without a grid");
        const r = this.gridEl.getBoundingClientRect();
        this.startDrag(e, "grid", it.id, it, {
          x: Math.floor((e.clientX - r.left) / CELL_PX) - it.x,
          y: Math.floor((e.clientY - r.top) / CELL_PX) - it.y,
        });
      });
    return node;
  }

  // Every item on the grid. Parts in a running refit show at the spots they go to.
  private gridItems(w: World, v: Vehicle): HTMLElement[] {
    const moving = refitItems(w, v);
    const staying = v.items.filter((it) => !moving.some((m) => m.id === it.id));
    return [...staying.map((it) => this.itemEl(w, it)), ...moving.map((it) => this.refittingEl(w, v, it))];
  }

  // A part in a running refit, drawn where it goes with a dashed outline. Hover shows the turns left.
  private refittingEl(w: World, v: Vehicle, item: GridItem): HTMLElement {
    const node = this.itemEl(w, item);
    const left = v.job?.kind === "refit" ? v.job.turnsLeft : 0;
    node.classList.add("refitting");
    node.title = `Refit: ${left === 1 ? "1 turn" : `${left} turns`} left. Driving cancels it.`;
    return node;
  }

  private activateItem(item: GridItem): void {
    const selected = playerVehicle(this.host.world()).items.find(
      (entry) => entry.id === this.selectedItem,
    );
    if (selected && selected.id !== item.id) {
      this.run((w) =>
        moveItem(w, selected.id, { x: item.x, y: item.y, rot: selected.rot }),
      );
      return;
    }
    this.selectedItem = selected ? null : item.id;
    this.onChange();
  }

  private showItem(w: World, item: GridItem, mounted: boolean): void {
    this.inspection.replaceChildren(
      createIcon(getItemIcon(item)),
      el("h3", {}, itemLabel(item).short),
      el("p", {}, itemTitle(item, mounted)),
      el("p", { class: "dim" }, inspectionHint(w, item)),
      ...this.itemActions(w, item, mounted),
    );
  }

  // The action buttons an inspected item offers: patch when mounted and damaged, repair in town,
  // and strip when it is a spare. A good offers none.
  private itemActions(w: World, item: GridItem, mounted: boolean): HTMLElement[] {
    if (item.kind !== "part") return [];
    const buttons: (HTMLElement | null)[] = [
      mounted ? this.patchButton(w, playerVehicle(w), item.part) : null,
      townAt(w) ? this.repairButton(w, item.part) : null,
      !mounted && partDef(item.part.defId).kind !== "core"
        ? this.stripButton(playerVehicle(w), item.part)
        : null,
    ];
    return buttons.filter((b): b is HTMLElement => b !== null);
  }

  // A damaged mounted part shows a Patch button, hidden once it is already at the field cap or junk.
  private patchButton(
    w: World,
    me: Vehicle,
    part: PartInstance,
  ): HTMLElement | null {
    if (isJunk(part)) return null;
    const plan = repairPlan(w, me, part.id);
    if (plan.needed === 0) return null;
    const reason = patchBlocker(me, plan);
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: reason !== null,
        title:
          reason ??
          `Patch: ${plan.turns} turns, ${plan.parts} of ${plan.needed} parts, +${Math.round(plan.hp)} HP`,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => startRepair(world, part.id));
        },
      },
      reason ? `Patch (${reason})` : `Patch ${plan.turns}t/${plan.parts}p`,
    );
  }

  // Junk parts get no button, since no repair rebuilds them.
  private repairButton(w: World, part: PartInstance): HTMLElement | null {
    if (isJunk(part)) return null;
    const cost = partRepairCost(w, part);
    if (cost === 0) return null;
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: w.player.money < cost,
        title:
          w.player.money < cost
            ? "Not enough money"
            : `Restore to ${maxHp(part)} HP`,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => repairPart(world, part.id));
        },
      },
      `Repair ${cost}`,
    );
  }

  // Strips a spare part for units of the parts good. Works on broken and junk spares too, which is
  // the point: a part too far gone to sell whole still yields parts.
  private stripButton(
    me: Vehicle,
    part: PartInstance,
  ): HTMLElement {
    const reason = stripBlocker(me);
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: reason !== null,
        title: reason ?? `Strip: ${STRIP.turns} turns for ${stripYield(part)} parts`,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => startStrip(world, part.id));
        },
      },
      reason ? "Strip" : `Strip ${STRIP.turns}t/${stripYield(part)}p`,
    );
  }

  private storageEl(w: World): HTMLElement {
    const chips = w.player.storage.map((p) => {
      const d = partDef(p.defId);
      const chip = el(
        "div",
        { class: `inv-chip ${KIND_CLASS[d.kind]}`, title: partTitle(p) },
        `${d.name} ${d.w}x${d.h} ${wearLabel(p)} ${hp(p.hp)}/${hp(maxHp(p))}`,
      );
      const item: GridItem = {
        id: `store-${p.id}`,
        x: 0,
        y: 0,
        rot: 0,
        kind: "part",
        part: p,
      };
      chip.addEventListener("pointerdown", (e) =>
        this.startDrag(e, "storage", p.id, item, { x: 0, y: 0 }),
      );
      return chip;
    });
    return el(
      "div",
      { class: "inv-storage", "data-drop": "storage" },
      el("h3", {}, "Garage storage"),
      ...(chips.length
        ? chips
        : [el("div", { class: "dim" }, "Drop parts here to store them.")]),
    );
  }

  private lootPartChips(stock: SalvageStock): HTMLElement[] {
    const chips: HTMLElement[] = [];
    for (const p of stock.parts) {
      const d = partDef(p.defId);
      const chip = el(
        "div",
        { class: `inv-chip ${KIND_CLASS[d.kind]}`, title: partTitle(p) },
        `${d.name} ${d.w}x${d.h} ${wearLabel(p)} ${hp(p.hp)}/${hp(maxHp(p))}`,
      );
      const item: GridItem = {
        id: `loot-${p.id}`,
        x: 0,
        y: 0,
        rot: 0,
        kind: "part",
        part: p,
      };
      chip.addEventListener("pointerdown", (e) =>
        this.startDrag(e, "loot", p.id, item, { x: 0, y: 0 }),
      );
      chips.push(chip);
    }
    return chips;
  }

  private lootGoodChips(stock: SalvageStock): HTMLElement[] {
    const chips: HTMLElement[] = [];
    for (const [good, count] of Object.entries(stock.goods)) {
      if (count <= 0) continue;
      const item: GridItem = {
        id: `loot-${good}`,
        x: 0,
        y: 0,
        rot: 0,
        kind: "good",
        good,
      };
      const chip = el(
        "div",
        {
          class: "inv-chip k-good",
          title: `${GOODS[good].name}: drag one unit at a time`,
        },
        createIcon(getItemIcon(item)),
        `${GOODS[good].name} x${count}`,
      );
      chip.addEventListener("pointerdown", (e) =>
        this.startDrag(e, "loot", good, item, { x: 0, y: 0 }),
      );
      chips.push(chip);
    }
    return chips;
  }

  // Fuel and supplies pour into the tank and stores instead of the grid.
  private lootStoresButton(stock: SalvageStock): HTMLElement[] {
    if (!hasStores(stock)) return [];
    return [
      el(
        "button",
        {
          title: "Pour into the tank and stores up to their caps",
          onclick: () => this.run((world) => takeStores(world, stock.id)),
        },
        `Take fuel ${fuelLiters(stock.fuel ?? 0)} L, supplies ${(stock.supplies ?? 0).toFixed(1)}`,
      ),
    ];
  }

  // What a finished search turned up. Drag a chip onto the grid to take it; the rest stays here.
  private lootEl(w: World, stockId: string): HTMLElement {
    const stock = w.salvage.find((s) => s.id === stockId);
    if (!stock) throw new Error(`Unknown salvage ${stockId}`);
    const site = REGION.locations.find((l) => l.id === stockId);
    const chips = [
      ...this.lootPartChips(stock),
      ...this.lootGoodChips(stock),
      ...this.lootStoresButton(stock),
    ];
    return el(
      "div",
      { class: "inv-storage inv-loot" },
      el("h3", {}, `Salvage${site ? `: ${site.name}` : ""}`),
      ...(chips.length
        ? chips
        : [el("div", { class: "dim" }, "Nothing left here.")]),
      ...(chips.length
        ? [
            el(
              "button",
              {
                onclick: () => this.run((world) => takeAllLoot(world, stockId)),
              },
              "Take all that fits",
            ),
          ]
        : []),
      el(
        "div",
        { class: "dim" },
        "Drag items onto the grid. What you leave stays here.",
      ),
    );
  }

  private startDrag(
    e: PointerEvent,
    source: Drag["source"],
    id: string,
    item: GridItem,
    grab: { x: number; y: number },
  ): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const ghost = el("div", { class: "inv-ghost" });
    document.body.append(ghost);
    this.drag = {
      source,
      id,
      item: { ...item },
      grab,
      ghost,
      start: { x: e.clientX, y: e.clientY },
      moved: false,
    };
    this.error = "";
    this.onMove(e);
  }

  private rotate(): void {
    if (!this.drag) return;
    this.drag.moved = true;
    this.drag.item = {
      ...this.drag.item,
      rot: this.drag.item.rot === 0 ? 1 : 0,
    };
    this.drag.grab = { x: 0, y: 0 };
    if (this.lastPointer) this.onMove(this.lastPointer);
  }

  // R on a selected grid item turns it in place, keeping its top left cell.
  private rotateSelected(): void {
    if (!this.gridEl?.isConnected || this.selectedItem === null) return;
    const item = playerVehicle(this.host.world()).items.find(
      (it) => it.id === this.selectedItem,
    );
    if (!item || item.kind !== "part") return;
    const id = item.id;
    this.run((w) =>
      moveItem(w, id, { x: item.x, y: item.y, rot: item.rot === 0 ? 1 : 0 }),
    );
  }

  private onMove(e: PointerEvent): void {
    this.lastPointer = e;
    if (!this.drag) return;
    // A quarter-cell motion separates dragging from pointer jitter during a click.
    if (
      Math.hypot(
        e.clientX - this.drag.start.x,
        e.clientY - this.drag.start.y,
      ) >=
      CELL_PX / 4
    )
      this.drag.moved = true;
    const spot = this.spotAt(e.clientX, e.clientY);
    if (spot) this.drag.item = { ...this.drag.item, x: spot.x, y: spot.y };
    this.paintGhost(e, spot !== null);
  }

  // The ghost shows the item's footprint: green where it fits, red where it does not.
  private paintGhost(e: PointerEvent, onGrid: boolean): void {
    const d = this.drag!;
    const size = footprint(d.item);
    const g = this.gridEl?.getBoundingClientRect();
    const ok = onGrid && this.placementProblem(d) === null;
    d.ghost.className = `inv-ghost ${onGrid ? (ok ? "ok" : "no") : ""}`;
    d.ghost.textContent = itemLabel(d.item).short;
    d.ghost.style.width = `${size.w * CELL_PX}px`;
    d.ghost.style.height = `${size.h * CELL_PX}px`;
    if (onGrid && g) {
      d.ghost.style.left = `${g.left + d.item.x * CELL_PX}px`;
      d.ghost.style.top = `${g.top + d.item.y * CELL_PX}px`;
    } else {
      d.ghost.style.left = `${e.clientX - CELL_PX / 2}px`;
      d.ghost.style.top = `${e.clientY - CELL_PX / 2}px`;
    }
  }

  private placementProblem(d: Drag): string | null {
    const me = playerVehicle(this.host.world());
    if (d.source === "grid")
      return planItemMove(me, d.id, {
        x: d.item.x,
        y: d.item.y,
        rot: d.item.rot,
      }).error;
    const others = me.items.filter((it) => it.id !== d.id);
    return placementError(
      gridOf({ ...me, items: [...others, d.item] }),
      others,
      d.item,
      null,
    );
  }

  private spotAt(cx: number, cy: number): Spot | null {
    if (!this.gridEl || !this.drag) return null;
    const r = this.gridEl.getBoundingClientRect();
    if (cx < r.left || cy < r.top || cx >= r.right || cy >= r.bottom)
      return null;
    const x = Math.floor((cx - r.left) / CELL_PX) - this.drag.grab.x;
    const y = Math.floor((cy - r.top) / CELL_PX) - this.drag.grab.y;
    return { x, y, rot: this.drag.item.rot };
  }

  private onDrop(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost.remove();
    if (this.finishSelection(d)) return;
    const target = (
      document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    )
      ?.closest("[data-drop]")
      ?.getAttribute("data-drop");
    const onGrid = this.gridEl !== null && this.inside(e);
    this.run((w) => {
      if (onGrid) {
        const to = { x: d.item.x, y: d.item.y, rot: d.item.rot };
        if (d.source === "grid") return moveItem(w, d.id, to);
        if (d.source === "storage") return takeFromStorage(w, d.id, to);
        return takeLoot(
          w,
          this.loot!,
          d.item.kind === "part"
            ? { kind: "part", partId: d.id }
            : { kind: "good", good: d.id },
          to,
        );
      }
      if (target === "storage" && d.source === "grid")
        return storePart(w, d.id);
      if (target === "dump" && d.source === "grid") return dumpItem(w, d.id);
      return w;
    });
  }

  private finishSelection(drag: Drag): boolean {
    if (drag.source !== "grid" || drag.moved) return false;
    const item = playerVehicle(this.host.world()).items.find(
      (entry) => entry.id === drag.id,
    );
    if (item) this.activateItem(item);
    return true;
  }

  private inside(e: PointerEvent): boolean {
    const r = this.gridEl!.getBoundingClientRect();
    return (
      e.clientX >= r.left &&
      e.clientY >= r.top &&
      e.clientX < r.right &&
      e.clientY < r.bottom
    );
  }

  private run(cmd: (w: World) => World): void {
    try {
      const next = cmd(this.host.world());
      if (next !== this.host.world()) this.host.apply(next);
      this.error = "";
    } catch (err) {
      this.error = (err as Error).message;
    }
    this.onChange();
  }
}

// Standalone inventory window, opened with I.
export class InventoryScreen {
  private root = panel("modal");
  private view: InventoryView;

  constructor(private host: UiHost) {
    this.root.classList.add("inventory-screen");
    this.root.style.display = "none";
    this.view = new InventoryView(host, () => this.render());
  }

  isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  toggle(): void {
    if (this.isOpen()) return this.close();
    this.view.setLoot(null);
    this.root.style.display = "";
    this.render();
  }

  // Opens the inventory with a searched salvage stock beside the grid.
  openLoot(stockId: string): void {
    this.view.setLoot(stockId);
    this.root.style.display = "";
    this.render();
  }

  // Closed windows drop their contents, so hidden copies never answer clicks or drops.
  close(): void {
    this.root.style.display = "none";
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    this.root.replaceChildren(
      el(
        "button",
        { class: "close", onclick: () => this.close() },
        "Close [I]",
      ),
      el("h3", {}, chassisDef(playerVehicle(this.host.world()).chassisId).name),
      el(
        "div",
        { class: "inv-summary" },
        `Equipment & cargo · ${liters(freeCells(playerVehicle(this.host.world())))} L free · Mass ${kg(vehicleMass(playerVehicle(this.host.world())))} of ${kg(chassisDef(playerVehicle(this.host.world()).chassisId).ratedMass)} rated · Money ${this.host.world().player.money}`,
      ),
      this.view.render(),
    );
  }
}

export function getItemIcon(item: GridItem): IconName {
  if (item.kind === "good") {
    if (
      item.good === "scrap" ||
      item.good === "salt" ||
      item.good === "meds" ||
      item.good === "grain" ||
      item.good === "textiles" ||
      item.good === "tools" ||
      item.good === "batteries" ||
      item.good === "electronics"
    )
      return item.good;
    if (item.good === "parts") return item.good;
    throw new Error(`No inventory artwork for good: ${item.good}`);
  }
  const def = partDef(item.part.defId);
  if (def.kind === "weapon") return def.look;
  if (def.kind === "core") return def.role === "tank" ? "fuel" : def.role;
  if (def.kind === "scanner") return "scanner";
  return def.kind;
}

function pos(x: number, y: number, w: number, h: number): string {
  return `left:${x * CELL_PX}px;top:${y * CELL_PX}px;width:${w * CELL_PX}px;height:${h * CELL_PX}px`;
}

// The parts a running refit moves, at the spots they go to.
function refitItems(w: World, v: Vehicle): GridItem[] {
  if (v.job?.kind !== "refit") return [];
  return [...v.job.moves.map((move) => movedItem(v, move)), ...pickupItem(w, v.job)];
}

function movedItem(v: Vehicle, move: RefitMove): GridItem {
  const item = v.items.find((it) => it.id === move.itemId);
  if (!item) throw new Error(`Refit moves missing item ${move.itemId}`);
  return { ...item, ...move.to };
}

// The salvage part a refit mounts, at its target. A part gone from the stock is not drawn.
function pickupItem(w: World, job: RefitJob): GridItem[] {
  const pickup = job.pickup;
  if (!pickup) return [];
  const part = w.salvage.find((stock) => stock.id === pickup.stockId)?.parts.find((p) => p.id === pickup.partId);
  return part ? [{ kind: "part", id: pickup.itemId, part, ...pickup.to }] : [];
}

function footprint(it: GridItem): { w: number; h: number } {
  const cells = itemCells({ ...it, x: 0, y: 0 });
  return {
    w: Math.max(...cells.map((c) => c.x)) + 1,
    h: Math.max(...cells.map((c) => c.y)) + 1,
  };
}

function itemLabel(it: GridItem): { short: string } {
  if (it.kind === "good") return { short: GOODS[it.good].name.slice(0, 5) };
  return { short: partDef(it.part.defId).name };
}

function itemTitle(it: GridItem, mounted: boolean): string {
  if (it.kind === "good") return GOODS[it.good].name;
  if (partDef(it.part.defId).kind === "core")
    return `${partTitle(it.part)}\nBuilt in: cannot be moved, only repaired`;
  return `${partTitle(it.part)}\n${mounted ? "Mounted and working" : "Spare: not on a matching mount"}`;
}

// What the inspection panel says under an item's title: how to move it.
function inspectionHint(w: World, item: GridItem): string {
  if (item.kind === "good")
    return "Drag to rearrange cargo. Dropping in the dump area discards it.";
  if (townAt(w)) return "Garage: drag movable parts onto matching mounts or into storage.";
  return "Move or remove equipment at a town garage.";
}

// Why a Patch button is disabled, or null when the patch can start.
function patchBlocker(me: Vehicle, plan: RepairPlan): string | null {
  if (me.speed > RULES.parkedSpeed) return "Stop to patch";
  return plan.parts === 0 ? "No parts" : null;
}

// Why a Strip button is disabled, or null when stripping can start.
function stripBlocker(me: Vehicle): string | null {
  if (me.speed > RULES.parkedSpeed) return "Stop to strip";
  if (me.job) return "Busy";
  return null;
}

// Thin bar along the bottom of a part: its width is hp over max hp. A broken part shows a red bar.
function conditionBar(p: PartInstance): HTMLElement {
  const max = maxHp(p);
  return el(
    "div",
    { class: `inv-hp${p.hp > 0 ? "" : " broken"}` },
    el("div", { style: `width:${(p.hp / max) * 100}%` }),
  );
}

function partTitle(p: PartInstance): string {
  const d = partDef(p.defId);
  return `${d.name} (${d.kind}) ${wearLabel(p)}, ${hp(p.hp)}/${hp(maxHp(p))} HP, ${d.w}x${d.h}`;
}
