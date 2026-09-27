// Vehicle instruments, critical resources, event history and inspection.

import { partDef } from "../data/parts";
import { baseGrid, corePart, coreParts, mountedParts } from "../sim/grid";
import type { Job, Vehicle, World } from "../sim/types";
import { el, panel } from "./dom";
import {
  eventText,
  formatNpcActivity,
  formatNpcStates,
  formatNpcTraits,
} from "./format";
import { getHudReadout, getRescueReadout, moneyLabel, TruckConditionReadout } from "./hud-readout";
import { createIcon, createSpeedDial, type IconName } from "./icons";
import { kph } from "./units";
import { playerVehicle } from "../sim/damage";
import "./truck-condition.css";

type ConditionPart = ReturnType<TruckConditionReadout["update"]>[number];

class TruckConditionView {
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

  render(vehicle: Vehicle): void {
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
    for (const part of parts) this.renderPart(part);
  }

  private renderPart(part: ConditionPart): void {
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
    node.title = `${part.name}: ${part.percent}%${part.percent === 0 ? " (broken)" : ""}`;
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

// The E key action. ready is false while the truck must stop first.
export type ContextAction = { label: string; ready: boolean };

type HudActions = {
  openInventory: () => void;
  openCharacter: () => void;
  toggleManual: () => void;
  toggleAutoRepair: () => void;
  acceptTow: () => void;
  refuseTow: () => void;
  unhitch: () => void;
  setBeacon: (on: boolean) => void;
  isBusy: () => boolean;
  recenter: () => void;
};
const RESOURCE_ICONS: IconName[] = [
  "money",
  "fuel",
  "supplies",
  "cab",
  "driver",
];

const LOG_LINES = 14;
const TOAST_MS = 3500;

const WEATHER_NAMES: Record<World["weather"][number]["kind"], string> = {
  storm: "Storm",
  heatwave: "Heat wave",
  overcast: "Overcast",
};

function weatherLabel(w: World): string {
  if (w.weather.length === 0) return "Clear";
  return [...new Set(w.weather.map((e) => WEATHER_NAMES[e.kind]))].join(", ");
}

export class Hud {
  private top = panel("instruments");
  private condition = new TruckConditionView();
  private log = panel("log");
  private info = panel("info");
  private infoBody = el("div");
  private help = panel("help");
  private action = panel("action");
  private toastBox = panel("toast");
  private rescue = panel("rescue");
  // Shows only while a pan has left the truck.
  private recenter = panel("recenter");
  private toastTimer: number | null = null;
  private lines: { text: string; cls: string }[] = [];

  constructor(private actions: HudActions) {
    this.info.style.display = "none";
    this.info.append(this.infoBody);
    this.toastBox.style.display = "none";
    this.rescue.style.display = "none";
    this.recenter.style.display = "none";
    this.recenter.append(el("button", { onclick: () => actions.recenter(), title: "Center the camera on your truck" }, "Center on truck (F)"));
    this.log.replaceChildren(
      el("h3", {}, "Log"),
      el("div", { class: "dim" }, "Drive out. Watch for raiders."),
    );
    this.log.setAttribute("aria-label", "Event log");
    const guide = el(
      "details",
      {},
      el("summary", { title: "Driving and combat controls" }, "?"),
    );
    this.help.append(guide);
    guide.append(
      el("div", {}, "Click: plan drive-through. Shift-click: plan stop there."),
      el("div", {}, "Click your truck: brake. No order: coast on."),
      el(
        "div",
        {},
        "Click a vehicle: target it. 1-4: weapon. 0: all. W: weapons.",
      ),
      el(
        "div",
        {},
        "Space: start / pause travel. In combat: one turn. Hold: fast-forward. A: auto fire. P: auto patch. C: character. I: inventory.",
      ),
      el("div", {}, "R: manual driving, straight through anything."),
      el("div", {}, "Right-drag: pan. F: center on truck. Wheel: zoom. M: mute."),
    );
  }

  showRecenter(on: boolean): void {
    this.recenter.style.display = on ? "" : "none";
  }

  getInspectionRoot(): HTMLElement {
    return this.info;
  }

  private toast(text: string): void {
    this.toastBox.textContent = text;
    this.toastBox.style.display = "";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(
      () => (this.toastBox.style.display = "none"),
      TOAST_MS,
    );
  }

  // The context action for the E key, or hidden. An action that needs a stop first shows disabled.
  renderAction(
    action: ContextAction | null,
    job: Job | null,
    onUse: () => void,
  ): void {
    this.action.style.display = action || job ? "" : "none";
    if (job) {
      const progress = Math.round((1 - job.turnsLeft / job.total) * 100);
      this.action.replaceChildren(
        el(
          "span",
          { class: "job-label" },
          `${job.kind === "search" ? "Search" : "Repair"} · ${job.turnsLeft} turns left`,
        ),
        el(
          "span",
          {
            class: "job-bar",
            role: "progressbar",
            "aria-label": `${job.kind === "search" ? "Search" : "Repair"} progress`,
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(progress),
          },
          el("span", { style: `width:${progress}%` }),
        ),
      );
    } else if (action) {
      this.action.replaceChildren(
        el(
          "button",
          {
            onclick: onUse,
            disabled: !action.ready,
            title: action.ready ? "" : "Stop to use",
          },
          `[E] ${action.label}`,
        ),
      );
    }
  }

  // The knockout banner, a tow offer, the tow in progress, or the beacon switch of a stranded truck.
  renderRescue(w: World): void {
    const r = getRescueReadout(w);
    this.rescue.style.display = r ? "" : "none";
    if (!r) return this.rescue.replaceChildren();
    const beacon = (on: boolean) =>
      el(
        "button",
        {
          class: on ? "on" : "",
          "aria-pressed": String(on),
          onclick: () => this.actions.setBeacon(!on),
          title: "Call for a tow by radio. Raiders hear it too.",
        },
        on ? "Beacon on" : "Beacon off",
      );
    const buttons = (...children: HTMLElement[]) =>
      el("div", { class: "rescue-buttons" }, ...children);
    if (r.kind === "knockedOut")
      this.rescue.replaceChildren(
        el("h3", { class: "bad" }, "Knocked out"),
        el(
          "div",
          { class: "dim" },
          "Looters strip the truck. You come to when they leave.",
        ),
      );
    if (r.kind === "offer")
      this.rescue.replaceChildren(
        el("h3", {}, "Tow offer"),
        el("div", {}, `${r.tower} tows you to ${r.town}.`),
        el("div", {}, `Fee ${moneyLabel(r.fee)}, paid on arrival.`),
        ...(r.debt ? [el("div", { class: "bad" }, "You go into debt.")] : []),
        buttons(
          el("button", { onclick: () => this.actions.acceptTow() }, "Accept"),
          el("button", { onclick: () => this.actions.refuseTow() }, "Refuse"),
          ...(r.beacon ? [beacon(true)] : []),
        ),
      );
    if (r.kind === "towed")
      this.rescue.replaceChildren(
        el("h3", {}, "Under tow"),
        el("div", {}, `${r.tower} tows you to ${r.town}.`),
        el(
          "div",
          { class: "dim" },
          `Fee ${moneyLabel(r.fee)} on arrival. Unhitching is free.`,
        ),
        buttons(
          el("button", { onclick: () => this.actions.unhitch() }, "Unhitch"),
        ),
      );
    if (r.kind === "stranded")
      this.rescue.replaceChildren(
        el("h3", {}, "Stranded"),
        el(
          "div",
          { class: "dim" },
          r.beacon
            ? "Calling for a tow. Raiders hear it too."
            : "The truck can only crawl.",
        ),
        buttons(beacon(r.beacon)),
      );
  }

  renderTop(w: World): void {
    const readout = getHudReadout(w);
    const busy = this.actions.isBusy();
    this.condition.render(playerVehicle(w));
    this.top.replaceChildren(
      this.condition.root,
      el(
        "button",
        {
          class: "truck-instrument",
          title: "Truck inventory [I]",
          "aria-label": "Open truck inventory",
          disabled: busy,
          onclick: () => this.actions.openInventory(),
        },
        createSpeedDial(Number(readout.speed), Number(readout.maxSpeed)),
        el("span", { class: "speed-value" }, readout.speed),
        el("span", { class: "speed-unit" }, `km/h · max ${readout.maxSpeed}`),
        createIcon("truck"),
      ),
      el(
        "div",
        { class: "resource-bank" },
        ...readout.resources.map((resource, i) =>
          el(
            "span",
            {
              class: `resource ${resource.warning ? "bad" : ""}`,
              title: resource.label,
              "aria-label": `${resource.label}: ${resource.value}${resource.warning ? ", warning" : ""}`,
              "data-resource": resource.label,
            },
            createIcon(RESOURCE_ICONS[i]),
            el(
              "span",
              {},
              el("small", {}, resource.label),
              el(
                "strong",
                {},
                `${resource.warning ? "! " : ""}${resource.value}`,
              ),
            ),
          ),
        ),
      ),
      el(
        "div",
        { class: "instrument-actions" },
        el(
          "button",
          {
            class: readout.manual ? "on" : "",
            disabled: busy,
            "aria-pressed": String(readout.manual),
            onclick: () => this.actions.toggleManual(),
            title: "Toggle manual driving [R]",
          },
          readout.manual ? "Manual [R]" : "Route [R]",
        ),
        el(
          "button",
          {
            class: w.player.autoRepair ? "on" : "",
            disabled: busy,
            "aria-pressed": String(w.player.autoRepair),
            onclick: () => this.actions.toggleAutoRepair(),
            title:
              "Patch the worst part with one unit of parts whenever the truck is parked [P]",
          },
          w.player.autoRepair ? "Auto patch [P]" : "No patch [P]",
        ),
        el(
          "button",
          {
            disabled: busy,
            onclick: () => this.actions.openCharacter(),
            title: "Driver and skills [C]",
          },
          createIcon("driver"),
          w.player.skillPoints > 0 ? `+${w.player.skillPoints} [C]` : "[C]",
        ),
        ...(readout.broken
          ? [
              el(
                "span",
                { class: "bad", role: "status" },
                `! ${readout.broken} broken`,
              ),
            ]
          : []),
      ),
      el(
        "div",
        { class: "resource-bank survival-bank" },
        ...readout.survival.map((entry) =>
          el(
            "span",
            {
              class: `resource ${entry.warning ? "bad" : ""}`,
              title: entry.label,
              "data-resource": entry.label,
            },
            el(
              "span",
              {},
              el("small", {}, entry.label),
              el("strong", {}, entry.value),
              ...("progress" in entry && entry.progress !== undefined
                ? [
                    el(
                      "span",
                      {
                        class: "job-bar",
                        role: "progressbar",
                        "aria-valuenow": String(
                          Math.round(entry.progress * 100),
                        ),
                      },
                      el("span", {
                        style: `width:${Math.round(entry.progress * 100)}%`,
                      }),
                    ),
                  ]
                : []),
            ),
          ),
        ),
      ),
    );
  }

  pushEvents(w: World): void {
    for (const e of w.events) {
      const line = eventText(w, e);
      if (line)
        this.lines.unshift({ text: `T${w.turn} ${line.text}`, cls: line.cls });
      if (
        line &&
        (e.t === "knockout" || e.t === "levelUp" || e.t === "discover")
      )
        this.toast(line.text);
    }
    this.lines = this.lines.slice(0, LOG_LINES);
    if (this.lines.length === 0) return;
    this.log.replaceChildren(
      el("h3", {}, "Log"),
      el(
        "div",
        { class: "log-lines", tabindex: 0 },
        ...this.lines.map((l) => el("div", { class: l.cls }, l.text)),
      ),
    );
  }

  showInfo(w: World, v: Vehicle | null, hostile: boolean): void {
    if (!v) {
      this.info.style.display = "none";
      return;
    }
    const cab = corePart(v, "cab");
    const pct = Math.round((cab.hp / partDef(cab.defId).hp) * 100);
    // The four wheels read as one line.
    const wheels = coreParts(v, "wheel");
    const working = wheels.filter((p) => p.hp > 0).length;
    const parts = mountedParts(v)
      .filter((p) => !wheels.includes(p))
      .map((p) => {
        const def = partDef(p.defId);
        return el(
          "div",
          { class: p.hp > 0 ? "" : "bad" },
          `${def.name}: ${p.hp}/${def.hp}`,
        );
      });
    parts.push(
      el(
        "div",
        { class: working === wheels.length ? "" : "bad" },
        `Wheels ${working}/${wheels.length} working`,
      ),
    );
    const stance =
      v.faction === "player" ? "" : hostile ? "hostile" : "neutral";
    this.info.style.display = "";
    this.infoBody.replaceChildren(
      el("h3", {}, v.name),
      el(
        "div",
        { class: hostile ? "bad" : "dim" },
        `${v.faction} ${stance}`.trim(),
      ),
      el("div", {}, `Cab ${pct}%   Speed ${kph(v.speed)} km/h`),
      el("div", { class: "bar" }, el("div", { style: `width:${pct}%` })),
      ...npcLines(w, v),
      ...parts,
    );
  }
}

// The NPC's traits, top goal and the states it holds toward the player. The player's own truck has none.
function npcLines(w: World, v: Vehicle): HTMLElement[] {
  if (!v.brain) return [];
  const activity = formatNpcActivity(w, v);
  return [
    el("div", { class: "npc-traits" }, formatNpcTraits(v)),
    ...(activity ? [el("div", { class: "npc-activity" }, activity)] : []),
    ...formatNpcStates(w, v).map((line) =>
      el("div", { class: "npc-state" }, line),
    ),
  ];
}
