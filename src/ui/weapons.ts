import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { fireBlock, gunOf, hitOdds, type FireBlock } from "../sim/combat";
import { isKnockedOut } from "../sim/defeat";
import { playerVehicle } from "../sim/damage";
import { mountedParts } from "../sim/grid";
import { vehicleStats, type MountedWeapon } from "../sim/stats";
import type { Vehicle, World } from "../sim/types";
import { playerSees } from "../sim/vision";
import { workOf } from "../sim/states";
import { playerCanAct, reloadWeapon, setAutoFire, setWeaponOrder } from "../sim/world";
import { el, panel } from "./dom";
import { meters } from "./units";
import type { UiHost } from "./host";
import { createIcon } from './cards';
import { createSwitch } from "./switch";
import { canCall } from "./dialogue";
import { workLabel, workProgress } from "./format";

export const BLOCK_TEXT: Record<FireBlock, string> = {
  disabled: "disabled",
  cooldown: "cooling down",
  empty: "reloading",
  range: "out of range",
  arc: "out of arc",
  blocked: "view blocked on truck",
  noTarget: "hold fire",
  unseen: "not in sight",
  covered: "behind cover",
  talking: "on the radio",
  out: "driver knocked out",
};

// One weapon aimed at a vehicle, as its marker shows it.
export type WeaponMark = { slot: number; look: "mg" | "cannon"; status: string; ready: boolean };
// Timed work a seen NPC does, with its progress from 0 to 1.
export type JobMark = { label: string; progress: number };
export type VehicleMark = { weapons: WeaponMark[]; radio: boolean; job: JobMark | null; out: boolean };

// Markers above vehicles, by vehicle id: each player weapon aimed at the vehicle with its status, the
// radio key on the hovered truck when it can take a call, the job of each seen NPC, and each seen knocked-out NPC.
export function vehicleMarks(w: World, hovered: string | null): Map<string, VehicleMark> {
  const marks = new Map<string, VehicleMark>();
  const markOf = (id: string) => {
    const found = marks.get(id);
    if (found) return found;
    const made: VehicleMark = { weapons: [], radio: false, job: null, out: false };
    marks.set(id, made);
    return made;
  };
  vehicleStats(w, playerVehicle(w)).weapons.forEach((mw, i) => {
    const readout = getWeaponReadout(w, mw);
    if (readout.target)
      markOf(readout.target.id).weapons.push({ slot: i + 1, look: mw.def.look, status: readout.status, ready: readout.canFire });
  });
  if (hovered && canCall(w, hovered)) markOf(hovered).radio = true;
  for (const v of w.vehicles.filter((x) => x.brain && playerSees(w, x.pos))) {
    const job = seenNpcJob(w, v);
    if (job) markOf(v.id).job = job;
    if (isKnockedOut(v)) markOf(v.id).out = true;
  }
  return marks;
}

function seenNpcJob(w: World, v: Vehicle): JobMark | null {
  const work = workOf(w, v);
  return work && { label: workLabel(w, v, work), progress: workProgress(work) };
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

function turns(n: number): string {
  return `${n} ${n === 1 ? "turn" : "turns"}`;
}

// Why a gun cannot fire, with the turns left for a cooldown or a reload.
export function blockText(mw: MountedWeapon, block: FireBlock): string {
  const gun = gunOf(mw.part);
  if (block === "cooldown") return `ready in ${turns(gun.cooldown)}`;
  if (block === "empty") return `reloading ${turns(mw.def.reload - gun.reloadWork)}`;
  return BLOCK_TEXT[block];
}

// Rounds left in the magazine, like "3/5".
export function ammoText(mw: MountedWeapon): string {
  return `${gunOf(mw.part).ammo}/${mw.def.magazine}`;
}

// A forced reload helps only a gun with a partly spent magazine.
export function canForceReload(mw: MountedWeapon): boolean {
  const ammo = gunOf(mw.part).ammo;
  return mw.part.hp > 0 && ammo > 0 && ammo < mw.def.magazine;
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
  const status = block ? blockText(mw, block) : "ready";
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
    const phase = this.host.getTurnPhase();
    const locked = phase !== null || !playerCanAct(w);
    const head = el(
      "div",
      { class: "weapon-head" },
      el("h3", {}, "Weapons"),
      this.expanded ? this.renderAllButton(locked) : null,
      el("button", { class: "weapon-toggle", "aria-expanded": String(this.expanded), onclick: () => this.toggleVisible(), title: "Show or hide weapons [X]" }, this.expanded ? "Hide [X]" : "Show [X]"),
    );
    this.root.replaceChildren(head, ...(this.expanded ? [this.renderControls(w, locked)] : []));
    this.turn.replaceChildren(this.renderTurnButton(phase));
  }

  // While turns run on their own, the button shows it and stops them.
  private renderTurnButton(phase: ReturnType<UiHost["getTurnPhase"]>): HTMLElement {
    if (this.host.autoTravel())
      return el('button', {
        class: 'end-turn auto', title: 'Automatic travel. Space to stop.',
        'aria-label': 'Stop automatic travel', onclick: () => this.host.endTurn(),
      }, createIcon('turn'), el('span', {}, 'Auto'));
    return el('button', {
      class: 'end-turn', disabled: phase !== null, title: 'End turn [Space]',
      'aria-label': phase ? `${phase} in progress` : 'End turn', onclick: () => this.host.endTurn(),
    }, createIcon('turn'), el('span', {}, phase ? `${phase}…` : 'Space'));
  }

  private renderAllButton(locked: boolean): HTMLElement {
    const all = this.host.selectedWeapon() === null;
    return el(
      "button",
      {
        class: all ? "on" : "",
        "aria-pressed": String(all),
        disabled: locked,
        title: "Aim all weapons with the next click [0]",
        onclick: () => this.selectWeapon(null),
      },
      "All [0]",
    );
  }

  private renderControls(w: World, locked: boolean): HTMLElement {
    const weapons = vehicleStats(w, playerVehicle(w)).weapons;
    const chosen = weapons.find((mw) => mw.part.id === this.host.selectedWeapon());
    return el(
      "fieldset",
      { disabled: locked },
      createSwitch({
        on: "Auto fire",
        off: "Auto fire off",
        checked: w.player.autoFire,
        key: "Q",
        title: "Auto fire: guns shoot at hostiles on their own [Q]",
        onclick: () => this.toggleAuto(),
      }),
      el(
        "div",
        { class: "weapon-slots" },
        ...weapons.map((mw, i) => this.renderSlot(w, mw, i, locked)),
      ),
      weapons.length === 0 ? el("div", { class: "dim" }, "No weapons installed") : null,
      chosen ? this.renderDetail(w, chosen) : null,
    );
  }

  private renderDetail(w: World, chosen: MountedWeapon): HTMLElement {
    const readout = getWeaponReadout(w, chosen);
    const order = playerVehicle(w).weaponOrders[chosen.part.id];
    return el('div', { class: 'weapon-detail' },
      el('strong', {}, chosen.def.name),
      el('span', {}, readout.target?.name ?? 'No visible target'),
      el('span', {}, readout.status),
      readout.target && order ? this.createAimSelect(readout.target, chosen.part.id, order.aim) : null,
      el('button', { class: 'weapon-hold', onclick: () => this.holdWeapon(chosen.part.id) }, 'Hold fire'),
    );
  }

  private renderSlot(w: World, mw: MountedWeapon, i: number, locked: boolean): HTMLElement {
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
          title: `${mw.def.name}: ${mw.def.rounds} × ${Number((mw.def.round.damage * RULES.weaponDamage).toFixed(1))} damage, pen ${mw.def.round.pen}, range ${meters(mw.def.range)} m, arc ${mw.def.arc}°, fires every ${mw.def.cooldown} turn(s), ${mw.def.magazine} shots, reloads in ${mw.def.reload} turn(s)`,
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
      this.renderAmmo(mw, locked),
    );
  }

  // Rounds left and the button that forces a reload.
  private renderAmmo(mw: MountedWeapon, locked: boolean): HTMLElement {
    return el(
      "div",
      { class: "weapon-ammo-row" },
      el("span", { class: "weapon-ammo", title: "Rounds in the magazine" }, ammoText(mw)),
      el(
        "button",
        {
          class: "weapon-reload",
          disabled: locked || !canForceReload(mw),
          title: `Reload: drop the magazine and refill it in ${turns(mw.def.reload)}`,
          "aria-label": `Reload ${mw.def.name}`,
          onclick: () => this.forceReload(mw.part.id),
        },
        createIcon("reload"),
      ),
    );
  }

  private forceReload(weaponId: string): void {
    if (this.host.getTurnPhase() !== null) return;
    this.host.apply(reloadWeapon(this.host.world(), weaponId));
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
