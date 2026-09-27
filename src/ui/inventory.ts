// Dredge-style inventory grid: drag items to arrange them, R or right click rotates while dragging.
// In a town the garage storage shows beside the grid.

import { GOODS } from "../data/goods";
import { chassisDef } from "../data/chassis";
import { partDef, type PartKind } from "../data/parts";
import { RULES } from "../data/rules";
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
  dumpGood,
  moveItem,
  planItemMove,
  storePart,
  takeFromStorage,
} from "../sim/inventory";
import { startRepair } from "../sim/jobs";
import { repairPlan } from "../sim/repair";
import { townAt } from "../sim/sites";
import { takeAllLoot, takeLoot } from "../sim/locations";
import { REGION } from "../data/region";
import type { GridItem, PartInstance, Vehicle, World } from "../sim/types";
import { el, panel } from "./dom";
import type { UiHost } from "./host";
import { createIcon, type IconName } from "./icons";
import { vehicleMass } from "../sim/mass";
import { kg, liters } from "./units";

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
    for (const it of me.items) grid.append(this.itemEl(w, it));
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
            "Drop goods here to dump them",
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
        'aria-pressed': String(this.selectedItem === it.id),
        'data-item-id': it.id,
        style: pos(x, y, wd, ht),
        title: itemTitle(it, mounted),
        tabindex: 0,
        role: "button",
        "aria-label": itemTitle(it, mounted),
      },
      createIcon(getItemIcon(it)),
      el("span", { class: "inv-item-name" }, label.short),
    );
    node.classList.toggle('selected', this.selectedItem === it.id);
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
        this.startDrag(e, "grid", it.id, it, {
          x: Math.floor(e.offsetX / CELL_PX),
          y: Math.floor(e.offsetY / CELL_PX),
        });
      });
    return node;
  }

  private activateItem(item: GridItem): void {
    const selected = playerVehicle(this.host.world()).items.find((entry) => entry.id === this.selectedItem);
    if (selected && selected.id !== item.id) {
      this.run((w) => moveItem(w, selected.id, { x: item.x, y: item.y, rot: selected.rot }));
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
      el(
        "p",
        { class: "dim" },
        item.kind === "good"
          ? "Click another item to swap, or drag to move. Dropping in the dump area discards it."
          : townAt(w)
            ? "Garage: drag movable parts onto matching mounts or into storage."
            : "Park to install or remove: 5 turns each, 10 to replace. Equipment changes when work finishes. Driving cancels work.",
      ),
      ...(item.kind === "part" && mounted
        ? [this.patchButton(w, playerVehicle(w), item.part)].filter(
            (b) => b !== null,
          )
        : []),
      ...(item.kind === "part" && townAt(w)
        ? [this.repairButton(w, item.part)].filter((b) => b !== null)
        : []),
    );
  }

  // A damaged mounted part shows a Patch button, hidden once it is already at the field cap.
  private patchButton(
    w: World,
    me: Vehicle,
    part: PartInstance,
  ): HTMLElement | null {
    const plan = repairPlan(w, me, part.id);
    if (plan.needed === 0) return null;
    const moving = me.speed > RULES.parkedSpeed;
    const reason = moving
      ? "Stop to patch"
      : plan.parts === 0
        ? "No parts"
        : null;
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

  private repairButton(w: World, part: PartInstance): HTMLElement | null {
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
            : `Restore to ${partDef(part.defId).hp} HP`,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => repairPart(world, part.id));
        },
      },
      `Repair ${cost}`,
    );
  }

  private storageEl(w: World): HTMLElement {
    const chips = w.player.storage.map((p) => {
      const d = partDef(p.defId);
      const chip = el(
        "div",
        { class: `inv-chip ${KIND_CLASS[d.kind]}`, title: partTitle(p) },
        `${d.name} ${d.w}x${d.h} ${p.hp}/${d.hp}`,
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

  // What a finished search turned up. Drag a chip onto the grid to take it; the rest stays here.
  private lootEl(w: World, stockId: string): HTMLElement {
    const stock = w.salvage.find((s) => s.id === stockId);
    if (!stock) throw new Error(`Unknown salvage ${stockId}`);
    const site = REGION.locations.find((l) => l.id === stockId);
    const chips: HTMLElement[] = [];
    for (const p of stock.parts) {
      const d = partDef(p.defId);
      const chip = el(
        "div",
        { class: `inv-chip ${KIND_CLASS[d.kind]}`, title: partTitle(p) },
        `${d.name} ${d.w}x${d.h} ${p.hp}/${d.hp}`,
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
    this.drag = { source, id, item: { ...item }, grab, ghost, start: { x: e.clientX, y: e.clientY }, moved: false };
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
    if (Math.hypot(e.clientX - this.drag.start.x, e.clientY - this.drag.start.y) >= CELL_PX / 4) this.drag.moved = true;
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
    if (d.source === 'grid') return planItemMove(me, d.id, { x: d.item.x, y: d.item.y, rot: d.item.rot }).error;
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
      if (target === "dump" && d.source === "grid") return dumpGood(w, d.id);
      return w;
    });
  }

  private finishSelection(drag: Drag): boolean {
    if (drag.source !== 'grid' || drag.moved) return false;
    const item = playerVehicle(this.host.world()).items.find((entry) => entry.id === drag.id);
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

// Thin bar along the bottom of a part: its width is hp over max hp. A broken part shows a red bar.
function conditionBar(p: PartInstance): HTMLElement {
  const max = partDef(p.defId).hp;
  return el(
    "div",
    { class: `inv-hp${p.hp > 0 ? "" : " broken"}` },
    el("div", { style: `width:${(p.hp / max) * 100}%` }),
  );
}

function partTitle(p: PartInstance): string {
  const d = partDef(p.defId);
  return `${d.name} (${d.kind}) ${p.hp}/${d.hp} HP, ${d.w}x${d.h}`;
}
