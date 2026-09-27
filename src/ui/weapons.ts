import { partDef } from "../data/parts";
import { fireBlock, hitOdds, type FireBlock } from "../sim/combat";
import { playerVehicle } from "../sim/damage";
import { mountedParts } from "../sim/grid";
import { vehicleStats, type MountedWeapon } from "../sim/stats";
import type { Job, Vehicle, World } from "../sim/types";
import { playerSees } from "../sim/vision";
import { playerCanAct, setAutoFire, setWeaponOrder } from "../sim/world";
import { el, panel } from "./dom";
import { meters } from "./units";
import type { UiHost } from "./host";
import { createIcon } from './icons';
import { canCall } from "./dialogue";
import { JOB_LABELS, jobProgress } from "./format";

export const BLOCK_TEXT: Record<FireBlock, string> = {
  disabled: "disabled",
  reloading: "reloading",
  range: "out of range",
  arc: "out of arc",
  noTarget: "hold fire",
  unseen: "not in sight",
  covered: "behind cover",
  talking: "on the radio",
};

// One weapon aimed at a vehicle, as its marker shows it.
export type WeaponMark = { slot: number; look: "mg" | "cannon"; status: string; ready: boolean };
// A job a seen NPC works on, with its progress from 0 to 1.
export type JobMark = { label: string; progress: number };
export type VehicleMark = { weapons: WeaponMark[]; radio: boolean; job: JobMark | null };

// Markers above vehicles, by vehicle id: each player weapon aimed at the vehicle with its status, the
// radio key on the hovered truck when it can take a call, and the job of each seen NPC.
export function vehicleMarks(w: World, hovered: string | null): Map<string, VehicleMark> {
  const marks = new Map<string, VehicleMark>();
  const markOf = (id: string) => {
    const found = marks.get(id);
    if (found) return found;
    const made: VehicleMark = { weapons: [], radio: false, job: null };
    marks.set(id, made);
    return made;
  };
  vehicleStats(w, playerVehicle(w)).weapons.forEach((mw, i) => {
    const readout = getWeaponReadout(w, mw);
    if (readout.target)
      markOf(readout.target.id).weapons.push({ slot: i + 1, look: mw.def.look, status: readout.status, ready: readout.canFire });
  });
  if (hovered && canCall(w, hovered)) markOf(hovered).radio = true;
  for (const v of w.vehicles) {
    const job = seenNpcJob(w, v);
    if (job) markOf(v.id).job = { label: JOB_LABELS[job.kind], progress: jobProgress(job) };
  }
  return marks;
}

function seenNpcJob(w: World, v: Vehicle): Job | null {
  return v.brain && playerSees(w, v.pos) ? v.job : null;
}

// A click on a vehicle aims the weapons at it. When all of them already aim at it, the click clears them.
export function toggleTarget(w: World, weapons: MountedWeapon[], target: Vehicle): World {
  const orders = playerVehicle(w).weaponOrders;
  const aimed = weapons.length > 0 && weapons.every((mw) => orders[mw.part.id]?.targetId === target.id);
  if (w.player.autoFire) w = setAutoFire(w, false);
  for (const mw of weapons)
    w = setWeaponOrder(w, mw.part.id, aimed ? null : { targetId: target.id, aim: "body" });
  return w;
}

// Current-position feedback shared by the weapon buttons and map markers.
export function getWeaponReadout(w: World, mw: MountedWeapon) {
  const me = playerVehicle(w);
  const order = me.weaponOrders[mw.part.id];
  const assigned = order
    ? (w.vehicles.find((v) => v.id === order.targetId) ?? null)
    : null;
  const target = assigned && playerSees(w, assigned.pos) ? assigned : null;
  const block = fireBlock(w, me, mw, assigned);
  const status =
    block === "reloading"
      ? `reload ${mw.part.reload} ${mw.part.reload === 1 ? "turn" : "turns"}`
      : block
        ? BLOCK_TEXT[block]
        : "ready";
  return {
    target,
    status,
    chance:
      block === null && target && order
        ? hitOdds(w, me, mw, target, order.aim).chance
        : null,
    canFire: block === null,
  };
}

export class WeaponPanel {
  private root = panel("weapons");
  private turn = panel('turn-control');
  private expanded = true;

  constructor(private host: UiHost) {}

  render(): void {
    const w = this.host.world();
    const weapons = vehicleStats(w, playerVehicle(w)).weapons;
    const phase = this.host.getTurnPhase();
    const selected = this.host.selectedWeapon();
    const controls = el(
      "fieldset",
      { disabled: phase !== null || !playerCanAct(w) },
      el(
        "div",
        { class: "weapon-tools" },
        el(
          "button",
          {
            class: selected === null ? "on" : "",
            "aria-pressed": String(selected === null),
            onclick: () => this.selectWeapon(null),
          },
          "All [0]",
        ),
        el(
          "button",
          {
            class: w.player.autoFire ? "on" : "",
            "aria-pressed": String(w.player.autoFire),
            onclick: () => this.toggleAuto(),
          },
          `Auto: ${w.player.autoFire ? "on" : "off"} [Q]`,
        ),
      ),
      el(
        "div",
        { class: "weapon-slots" },
        ...weapons.map((mw, i) => this.renderSlot(w, mw, i)),
      ),
    );
    const chosen = weapons.find((mw) => mw.part.id === selected);
    if (weapons.length === 0)
      controls.append(el("div", { class: "dim" }, "No weapons installed"));
    if (chosen) {
      const readout = getWeaponReadout(w, chosen);
      const order = playerVehicle(w).weaponOrders[chosen.part.id];
      controls.append(el('div', { class: 'weapon-detail' },
        el('strong', {}, chosen.def.name),
        el('span', {}, readout.target?.name ?? 'No visible target'),
        el('span', {}, readout.status),
        readout.target && order ? this.createAimSelect(readout.target, chosen.part.id, order.aim) : null,
        el('small', {}, 'Estimates use current positions. Movement happens first.'),
        el('button', { class: 'weapon-hold', onclick: () => this.holdWeapon(chosen.part.id) }, 'Hold fire'),
      ));
    }
    this.root.replaceChildren(
      el('button', { class: 'weapon-toggle', 'aria-expanded': String(this.expanded), onclick: () => this.toggleVisible(), title: 'Show or hide weapons [X]' }, this.expanded ? '− [X]' : 'Weapons [X]'),
      ...(this.expanded ? [controls] : []),
    );
    this.turn.replaceChildren(el('button', {
      class: 'end-turn', disabled: phase !== null, title: 'End turn [Space]',
      'aria-label': phase ? `${phase} in progress` : 'End turn', onclick: () => this.host.endTurn(),
    }, createIcon('turn'), el('span', {}, phase ? `${phase}…` : 'Space')));
  }

  private renderSlot(w: World, mw: MountedWeapon, i: number): HTMLElement {
    const readout = getWeaponReadout(w, mw);
    const selected = this.host.selectedWeapon() === mw.part.id;
    const chance =
      readout.chance === null ? "" : ` · ${Math.round(readout.chance * 100)}%`;
    const target =
      readout.target?.name ??
      (playerVehicle(w).weaponOrders[mw.part.id]
        ? "target unavailable"
        : "no target");
    return el(
      "div",
      { class: "weapon-slot", "data-weapon": mw.part.id },
      el(
        "button",
        {
          class: `weapon-pick ${selected ? "on" : ""}`,
          "aria-pressed": String(selected),
          'aria-label': `${mw.def.name}: ${readout.status}, ${target}`,
          title: `${mw.def.name}: ${mw.def.rounds} × ${mw.def.round.damage} damage, pen ${mw.def.round.pen}, range ${meters(mw.def.range)} m, arc ${mw.def.arc}°, fires every ${mw.def.reload} turn(s)`,
          onclick: () => this.selectWeapon(selected ? null : mw.part.id),
        },
        el('span', { class: 'weapon-number' }, `${i + 1}`),
        createIcon(mw.def.look === 'cannon' ? 'cannon' : 'mg'),
        el("span", { class: "sr-only weapon-name" }, mw.def.name),
        el(
          "span",
          { class: readout.canFire ? "good" : "dim", "data-status": "" },
          readout.status + chance,
        ),
        el("span", { class: "weapon-target" }, target),
      ),

    );
  }

  private createAimSelect(
    target: Vehicle,
    weaponId: string,
    aim: string,
  ): HTMLElement {
    const options = [
      el("option", { value: "body", selected: aim === "body" }, "Body"),
    ];
    for (const p of mountedParts(target)) {
      options.push(
        el(
          "option",
          { value: p.id, selected: aim === p.id },
          `${partDef(p.defId).name}${p.hp > 0 ? "" : " (disabled)"}`,
        ),
      );
    }
    const select = el(
      "select",
      { "aria-label": "Aim point" },
      ...options,
    ) as HTMLSelectElement;
    select.addEventListener("change", () => {
      if (this.host.getTurnPhase() !== null) return;
      const w = setAutoFire(this.host.world(), false);
      this.host.apply(
        setWeaponOrder(w, weaponId, { targetId: target.id, aim: select.value }),
      );
    });
    return el("label", { class: "weapon-aim" }, "Aim at ", select);
  }

  private holdWeapon(weaponId: string): void {
    if (this.host.getTurnPhase() !== null) return;
    this.host.apply(
      setWeaponOrder(setAutoFire(this.host.world(), false), weaponId, null),
    );
  }

  selectWeapon(id: string | null): void {
    if (this.host.getTurnPhase() !== null) return;
    this.host.selectWeapon(id);
  }

  toggleVisible(): void {
    this.expanded = !this.expanded;
    this.render();
  }

  toggleAuto(): void {
    if (this.host.getTurnPhase() !== null) return;
    const w = this.host.world();
    this.host.apply(setAutoFire(w, !w.player.autoFire));
  }
}

export function weaponsForClick(
  world: World,
  selected: string | null,
): MountedWeapon[] {
  const all = vehicleStats(world, playerVehicle(world)).weapons;
  return selected ? all.filter((m) => m.part.id === selected) : all;
}
