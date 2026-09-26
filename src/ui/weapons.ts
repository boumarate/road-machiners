import { partDef } from "../data/parts";
import { fireBlock, hitChance } from "../sim/combat";
import { playerVehicle } from "../sim/damage";
import { mountedParts } from "../sim/grid";
import { vehicleStats, type MountedWeapon } from "../sim/stats";
import type { Vehicle, World } from "../sim/types";
import { playerSees } from "../sim/vision";
import { setAutoFire, setWeaponOrder } from "../sim/world";
import { el, panel } from "./dom";
import type { UiHost } from "./host";

const BLOCK_TEXT = {
  disabled: "disabled",
  reloading: "reloading",
  range: "out of range",
  arc: "out of arc",
  noTarget: "hold fire",
  unseen: "not in sight",
};

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
        ? hitChance(w, me, mw, target, order.aim)
        : null,
    canFire: block === null,
  };
}

export class WeaponPanel {
  private root = panel("weapons");
  private expanded = true;

  constructor(private host: UiHost) {}

  render(): void {
    const w = this.host.world();
    const weapons = vehicleStats(w, playerVehicle(w)).weapons;
    const phase = this.host.getTurnPhase();
    const selected = this.host.selectedWeapon();
    const controls = el(
      "fieldset",
      { disabled: phase !== null },
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
          `Auto: ${w.player.autoFire ? "on" : "off"} [A]`,
        ),
      ),
      el(
        "div",
        { class: "weapon-slots" },
        ...weapons.map((mw, i) => this.renderSlot(w, mw, i)),
      ),
    );
    const chosen = weapons.find((mw) => mw.part.id === selected);
    if (chosen) {
      const readout = getWeaponReadout(w, chosen);
      const order = playerVehicle(w).weaponOrders[chosen.part.id];
      if (readout.target && order)
        controls.append(
          this.createAimSelect(readout.target, chosen.part.id, order.aim),
        );
    }
    if (weapons.length === 0)
      controls.append(el("div", { class: "dim" }, "No weapons installed"));
    const hint = w.player.autoFire
      ? "Auto picks after movement. Markers show last assignments."
      : "Click a vehicle to assign. Ground clicks still drive.";
    this.root.replaceChildren(
      el(
        "div",
        { class: "head" },
        el("h3", {}, "Weapons"),
        el(
          "button",
          {
            "aria-expanded": String(this.expanded),
            onclick: () => this.toggleVisible(),
          },
          `${this.expanded ? "Hide" : "Show"} [W]`,
        ),
      ),
      ...(this.expanded
        ? [
            controls,
            el("div", { class: "hint" }, hint),
            el(
              "div",
              { class: "hint" },
              "Range, arc and hit chance use current positions.",
            ),
          ]
        : []),
      el(
        "button",
        {
          class: "end-turn",
          disabled: phase !== null,
          onclick: () => this.host.endTurn(),
        },
        phase ? `${phase}…` : "End turn [Space]",
      ),
    );
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
          title: `${mw.def.name}: damage ${mw.def.damage}, range ${mw.def.range}, arc ${mw.def.arc}°, fires every ${mw.def.reload} turn(s)`,
          onclick: () => this.selectWeapon(selected ? null : mw.part.id),
        },
        el("span", { class: "weapon-name" }, `[${i + 1}] ${mw.def.name}`),
        el(
          "span",
          { class: readout.canFire ? "good" : "dim", "data-status": "" },
          readout.status + chance,
        ),
        el("span", { class: "weapon-target" }, target),
      ),
      el(
        "button",
        {
          class: "weapon-hold",
          title: `Hold fire: ${mw.def.name}`,
          onclick: () => this.holdWeapon(mw.part.id),
        },
        "Hold",
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
