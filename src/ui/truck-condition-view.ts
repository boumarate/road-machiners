import { baseGrid } from "../sim/grid";
import type { Vehicle } from "../sim/types";
import { createIcon } from "./cards";
import { el } from "./dom";
import { conditionLabel, TruckConditionReadout } from "./hud-readout";
import "./truck-condition.css";

type ConditionPart = ReturnType<TruckConditionReadout["update"]>[number];
// Gun numbers aiming at each part id, and the click that aims the chosen guns at a part.
export type ConditionAim = { marks: ReadonlyMap<string, number[]>; pick: (partId: string) => void };

export class TruckConditionView {
  readonly root = el("div", {
    class: "truck-condition",
    "aria-label": "Truck part condition, nose up",
  });
  private body = el("div", { class: "condition-chassis" });
  private readout = new TruckConditionReadout();
  private nodes = new Map<string, HTMLElement>();

  constructor() {
    this.root.append(this.body);
  }

  render(vehicle: Vehicle, aim?: ConditionAim): void {
    const grid = baseGrid(vehicle.chassisId);
    this.body.style.width = `${grid.w * 30}px`;
    this.body.style.height = `${grid.h * 30}px`;
    const parts = this.readout.update(vehicle);
    const ids = new Set(parts.map((part) => part.id));
    for (const [id, node] of this.nodes) {
      if (ids.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
    }
    for (const part of parts) this.renderPart(part, aim);
  }

  private renderPart(part: ConditionPart, aim?: ConditionAim): void {
    let node = this.nodes.get(part.id);
    if (!node) {
      node = el(
        "div",
        { class: "condition-part", "data-part-id": part.id },
        createIcon(part.icon),
        el("span", { class: "condition-percent" }),
      );
      this.nodes.set(part.id, node);
      this.body.append(node);
    }
    node.dataset.condition = part.state;
    markAim(node, part.id, aim);
    node.title = conditionLabel(part);
    node.setAttribute("aria-label", node.title);
    node.style.cssText = `left:${part.x * 30}px;top:${part.y * 30}px;width:${part.w * 30}px;height:${part.h * 30}px`;
    const label = node.querySelector(".condition-percent");
    if (!label) throw new Error("Condition percentage missing");
    label.textContent = `${part.percent}%`;
    if (part.hit) this.flashDamage(node);
  }

  private flashDamage(node: HTMLElement): void {
    for (const animation of node.getAnimations()) animation.cancel();
    node.animate(
      [
        { background: "#fa3934", borderColor: "#ffd1bd", offset: 0 },
        { background: "#fa3934", borderColor: "#ffd1bd", offset: 0.65 },
        { background: "#613b35", borderColor: "#de8e7d", offset: 1 },
      ],
      { duration: 300, iterations: 2 },
    );
  }
}


// Makes a tile pick its part on a click, and badges it with the numbers of the guns aimed at it.
function markAim(node: HTMLElement, partId: string, aim?: ConditionAim): void {
  node.classList.toggle("aimable", aim !== undefined);
  node.onclick = aim ? () => aim.pick(partId) : null;
  node.querySelector(".condition-aim")?.remove();
  const guns = aim?.marks.get(partId);
  if (guns) node.append(el("span", { class: "condition-aim", title: `Aimed by gun ${guns.join(", ")}` }, guns.join(" ")));
}
