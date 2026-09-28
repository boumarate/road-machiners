// Vehicle instruments, critical resources, event history and inspection.

import { DialoguePanel, type DialogueHost } from "./dialogue";
import { partDef } from "../data/parts";
import { baseGrid, corePart, coreParts, mountedParts } from "../sim/grid";
import type { Job, Vehicle, World } from "../sim/types";
import { isAutoPatch } from "../sim/jobs";
import { el, panel, topRight } from "./dom";
import {
  contractDue,
  contractSummary,
  eventText,
  formatNpcActivity,
  JOB_LABELS,
  jobProgress,
  formatNpcStates,
  formatNpcTraits,
} from "./format";
import { getHudReadout, getRescueReadout, moneyLabel, TruckConditionReadout } from "./hud-readout";
import { createIcon, createSpeedDial, type IconName } from "./cards";
import { hp, kph } from "./units";
import { maxHp } from "../sim/wear";
import { playerVehicle } from "../sim/damage";
import { pendingPerkPairs } from "../sim/progress";
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
// A hint marks an action that can never run here, and says why.
export type ContextAction = { label: string; ready: boolean; hint?: string };

type HudActions = {
  openInventory: () => void;
  openCharacter: () => void;
  toggleManual: () => void;
  toggleAutoRepair: () => void;
  unhitch: () => void;
  setBeacon: (on: boolean) => void;
  isBusy: () => boolean;
  dialogue: DialogueHost;
  recenter: () => void;
};
const RESOURCE_ICONS: IconName[] = [
  "money",
  "fuel",
  "supplies",
  "cab",
  "driver",
];

// Centered keeps the truck in the middle of the screen. Auto shifts the view ahead of it.
export type CameraMode = "centered" | "auto";

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
  private contracts = panel("contracts");
  private log = panel("log");
  private info = panel("info");
  private infoBody = el("div");
  private help = panel("help");
  private action = panel("action");
  private toastBox = panel("toast");
  private rescue = panel("rescue");
  // Shows only while a pan has left the truck.
  private recenter = panel("recenter");
  private cameraButton = el("button", { onclick: () => this.toggleCameraMode(), title: "Switch between a centered camera and one that looks ahead of the truck" });
  cameraMode: CameraMode = "auto";
  private toastTimer: number | null = null;
  private lines: { text: string; cls: string }[] = [];

  private readonly dialogue: DialoguePanel;

  constructor(private actions: HudActions) {
    this.dialogue = new DialoguePanel(actions.dialogue);
    this.info.style.display = "none";
    this.info.append(this.infoBody);
    this.contracts.style.display = "none";
    this.toastBox.style.display = "none";
    this.rescue.style.display = "none";
    this.recenter.style.display = "none";
    this.recenter.append(el("button", { onclick: () => actions.recenter(), title: "Center the camera on your truck" }, "Center on truck (F)"));
    panel("camera-mode", topRight()).append(this.cameraButton);
    this.showCameraMode();
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyV" && !document.activeElement?.matches("input, select, textarea")) this.toggleCameraMode();
    });
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
      el("div", {}, "Click the ground: drive there by road. Shift-click: stop there."),
      el("div", {}, "Space: drive on or pause. Hold Space: fast-forward. Click your truck: brake."),
      el("div", {}, "R: manual mode. Drive straight at the point, through anything. Space plays one turn."),
      el("div", {}, "Click a town or site: stop at its pad. E on a pad: trade, repair or loot."),
      el("div", {}, "T: radio the truck under the cursor. Ask drivers the way. 1-9: reply. H: honk."),
      el("div", {}, "Click a truck: target it. 1-4: pick a weapon. 0: all. Q: auto fire. X: show weapons."),
      el("div", {}, "P: auto patch. C: character. I: inventory. Esc: close."),
      el("div", {}, "WASD or right-drag: pan. Wheel: zoom. F: center. V: camera. M: mute."),
    );
  }

  private toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === "auto" ? "centered" : "auto";
    this.showCameraMode();
  }

  private showCameraMode(): void {
    this.cameraButton.textContent = this.cameraMode === "auto" ? "Camera: auto [V]" : "Camera: centered [V]";
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
  // A job shows its progress instead, except an auto patch, which yields to any action.
  renderAction(
    action: ContextAction | null,
    job: Job | null,
    onUse: () => void,
  ): void {
    const shown = shownJob(action, job);
    this.action.style.display = action || shown ? "" : "none";
    if (shown) this.renderJob(shown);
    else if (action) this.renderActionButton(action, onUse);
  }

  private renderJob(job: Job): void {
    const progress = Math.round(jobProgress(job) * 100);
    const label = JOB_LABELS[job.kind];
    this.action.replaceChildren(
      el(
        "span",
        { class: "job-label" },
        `${label} · ${job.turnsLeft} turns left`,
      ),
      el(
        "span",
        {
          class: "job-bar",
          role: "progressbar",
          "aria-label": `${label} progress`,
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-valuenow": String(progress),
        },
        el("span", { style: `width:${progress}%` }),
      ),
    );
  }

  private renderActionButton(action: ContextAction, onUse: () => void): void {
    this.action.replaceChildren(
      el(
        "button",
        {
          onclick: onUse,
          disabled: !action.ready,
          title: action.hint ?? (action.ready ? "" : "Stop to use"),
        },
        action.hint ? action.label : `[E] ${action.label}`,
      ),
    );
  }

  // The prompts in the middle of the screen: an open radio call, and the rescue state. That is the knockout
  // banner, the tow in progress, or the beacon switch of a stranded truck.
  renderRescue(w: World): void {
    this.dialogue.render(w);
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

  // Compact list of held contracts and their due times. Hidden while the player holds none.
  private renderContracts(w: World): void {
    if (w.player.contracts.length === 0) {
      this.contracts.style.display = "none";
      return;
    }
    this.contracts.style.display = "";
    this.contracts.replaceChildren(
      el("h3", {}, "Contracts"),
      ...w.player.contracts.map((c) =>
        el(
          "div",
          { class: "contract-line" },
          `${contractSummary(c)} — ${contractDue(c)}`,
        ),
      ),
    );
  }

  // The character button, marked while a perk pair waits for a pick.
  private characterButton(w: World, busy: boolean): HTMLElement {
    const perkOpen = pendingPerkPairs(w).length > 0;
    return el(
      "button",
      {
        disabled: busy,
        onclick: () => this.actions.openCharacter(),
        title: perkOpen ? "Driver and skills: a perk is ready to pick [C]" : "Driver and skills [C]",
      },
      createIcon("driver"),
      perkOpen ? "! [C]" : "[C]",
    );
  }

  renderTop(w: World): void {
    const readout = getHudReadout(w);
    const busy = this.actions.isBusy();
    this.condition.render(playerVehicle(w));
    this.renderContracts(w);
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
        this.characterButton(w, busy),
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
        (e.t === "knockout" || e.t === "skillUp" || e.t === "discover")
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
    const pct = Math.round((cab.hp / maxHp(cab)) * 100);
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
          `${def.name}: ${hp(p.hp)}/${hp(maxHp(p))}`,
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

// The NPC's traits once the player can read them, top goal and the states it holds toward the player. The player's own truck has none.
function npcLines(w: World, v: Vehicle): HTMLElement[] {
  if (!v.brain) return [];
  const activity = formatNpcActivity(w, v);
  const traits = formatNpcTraits(w, v);
  return [
    ...(traits ? [el("div", { class: "npc-traits" }, traits)] : []),
    ...(activity ? [el("div", { class: "npc-activity" }, activity)] : []),
    ...formatNpcStates(w, v).map((line) =>
      el("div", { class: "npc-state" }, line),
    ),
  ];
}

// A running auto patch gives way to any usable context action, so the player can still act.
function shownJob(action: ContextAction | null, job: Job | null): Job | null {
  return action && !action.hint && isAutoPatch(job) ? null : job;
}
