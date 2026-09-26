// Top bar with resources, event log, hover info card and key help.

import { chassisDef } from "../data/chassis";
import { partDef } from "../data/parts";
import { playerVehicle } from "../sim/damage";
import { xpForLevel } from "../sim/progress";
import { freeCells, mountedParts } from "../sim/grid";
import { vehicleStats } from "../sim/stats";
import type { Vehicle, World } from "../sim/types";
import { el, panel } from "./dom";
import { eventText } from "./format";

const LOG_LINES = 14;
const TOAST_MS = 3500;

export class Hud {
  private top = panel("topbar");
  private log = panel("log");
  private info = panel("info");
  private help = panel("help");
  private action = panel("action");
  private toastBox = panel("toast");
  private toastTimer: number | null = null;
  private lines: { text: string; cls: string }[] = [];

  constructor() {
    this.info.style.display = "none";
    this.toastBox.style.display = "none";
    this.log.replaceChildren(
      el("h3", {}, "Log"),
      el("div", { class: "dim" }, "Drive out. Watch for raiders."),
    );
    this.help.append(
      el("div", {}, "Click: drive through. Shift-click: stop there."),
      el("div", {}, "Click your truck: brake. No order: coast on."),
      el(
        "div",
        {},
        "Click a vehicle: target it. 1-4: weapon. 0: all. W: weapons.",
      ),
      el(
        "div",
        {},
        "Space: end turn. A: auto fire. C: character. I: inventory.",
      ),
      el("div", {}, "Right-drag: pan. F: follow. Wheel: zoom."),
    );
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

  // The context action for the E key, or hidden.
  renderAction(label: string | null, onUse: () => void): void {
    this.action.style.display = label ? "" : "none";
    if (label)
      this.action.replaceChildren(
        el("button", { onclick: onUse }, `[E] ${label}`),
      );
  }

  renderTop(w: World): void {
    const me = playerVehicle(w);
    const s = vehicleStats(w, me);
    const p = w.player;
    const warn = (v: number, low: number) => (v <= low ? "bad" : "");
    const item = (label: string, value: string, cls = "") =>
      el("span", { class: cls }, el("b", {}, label), " ", value);
    this.top.replaceChildren(
      item("Turn", `${w.turn}`),
      item("Money", `${p.money}`),
      item("Hull", `${me.hull}/${s.hullMax}`, warn(me.hull, s.hullMax * 0.3)),
      item("Health", `${p.health}`, warn(p.health, 40)),
      item(
        "Fuel",
        `${p.fuel.toFixed(1)}/${chassisDef(me.chassisId).fuelCap}`,
        warn(p.fuel, 5),
      ),
      item("Water", `${p.water.toFixed(1)}`, warn(p.water, 2)),
      item("Food", `${p.food.toFixed(1)}`, warn(p.food, 2)),
      item("Free cells", `${freeCells(me)}`),
      item("Speed", `${me.speed.toFixed(1)}/${s.maxSpeed}`),
      item("Lvl", `${p.level} (${p.xp}/${xpForLevel(p.level + 1)} XP)`),
    );
    if (p.skillPoints > 0)
      this.top.append(
        el("span", { class: "good" }, `${p.skillPoints} skill pt [C]`),
      );
  }

  pushEvents(w: World): void {
    for (const e of w.events) {
      const line = eventText(w, e);
      if (line)
        this.lines.unshift({ text: `T${w.turn} ${line.text}`, cls: line.cls });
      if (line && (e.t === "defeat" || e.t === "levelUp" || e.t === "discover"))
        this.toast(line.text);
    }
    this.lines = this.lines.slice(0, LOG_LINES);
    if (this.lines.length === 0) return;
    this.log.replaceChildren(
      el("h3", {}, "Log"),
      ...this.lines.map((l) => el("div", { class: l.cls }, l.text)),
    );
  }

  showInfo(w: World, v: Vehicle | null, hostile: boolean): void {
    if (!v) {
      this.info.style.display = "none";
      return;
    }
    const s = vehicleStats(w, v);
    const pct = Math.round((v.hull / s.hullMax) * 100);
    const parts = mountedParts(v).map((p) => {
      const def = partDef(p.defId);
      return el(
        "div",
        { class: p.hp > 0 ? "" : "bad" },
        `${def.name}: ${p.hp}/${def.hp}`,
      );
    });
    const stance =
      v.faction === "player" ? "" : hostile ? "hostile" : "neutral";
    this.info.style.display = "";
    this.info.replaceChildren(
      el("h3", {}, v.name),
      el(
        "div",
        { class: hostile ? "bad" : "dim" },
        `${v.faction} ${stance}`.trim(),
      ),
      el(
        "div",
        {},
        `Hull ${v.hull}/${s.hullMax}   Speed ${v.speed.toFixed(1)}`,
      ),
      el("div", { class: "bar" }, el("div", { style: `width:${pct}%` })),
      ...parts,
    );
  }
}
