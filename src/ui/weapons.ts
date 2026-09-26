// Weapon panel: per-weapon target, aim point, status and hit chance. Auto fire toggle.

import { partDef } from '../data/parts';
import { fireBlock, hitChance } from '../sim/combat';
import { playerVehicle } from '../sim/damage';
import { mountedParts } from '../sim/grid';
import { vehicleStats, type MountedWeapon } from '../sim/stats';
import type { Vehicle, World } from '../sim/types';
import { setAutoFire, setWeaponOrder } from '../sim/world';
import { el, panel } from './dom';
import type { UiHost } from './host';

const BLOCK_TEXT = { disabled: 'disabled', reloading: 'reloading', range: 'out of range', arc: 'out of arc', noTarget: 'hold', unseen: 'not in sight' };

export class WeaponPanel {
  private root = panel('weapons');

  constructor(private host: UiHost) {}

  render(): void {
    const w = this.host.world();
    const me = playerVehicle(w);
    const weapons = vehicleStats(w, me).weapons;
    const auto = el('button', { class: w.player.autoFire ? 'on' : '', onclick: () => this.toggleAuto() }, `Auto fire: ${w.player.autoFire ? 'on' : 'off'} [A]`);
    const rows = weapons.map((mw, i) => this.row(w, me, mw, i));
    const hint = w.player.autoFire
      ? 'Auto fire picks the nearest hostile for every weapon.'
      : 'Select a weapon, then click a vehicle to target it. No weapon selected: click targets with all.';
    this.root.replaceChildren(
      el('div', { class: 'head' }, el('h3', {}, 'Weapons'), auto),
      ...(rows.length ? rows : [el('div', { class: 'dim' }, 'No weapons installed')]),
      el('div', { class: 'hint' }, hint),
    );
  }

  private row(w: World, me: Vehicle, mw: MountedWeapon, i: number): HTMLElement {
    const order = me.weaponOrders[mw.part.id];
    const target = order ? w.vehicles.find((v) => v.id === order.targetId) ?? null : null;
    const block = fireBlock(w, me, mw, target);
    const status = mw.part.reload > 0 && mw.part.hp > 0 ? `reload ${mw.part.reload}` : block ? BLOCK_TEXT[block] : 'ready';
    const chance = target && order ? `${Math.round(hitChance(w, me, mw, target, order.aim) * 100)}%` : '';
    const sel = this.host.selectedWeapon() === mw.part.id;
    const targetCell = target && order ? this.aimSelect(target, mw.part.id, order.aim) : el('span', { class: 'dim' }, 'no target');
    const clear = el('button', { title: 'Hold fire', onclick: (e: Event) => { e.stopPropagation(); this.hold(mw.part.id); } }, 'x');
    return el(
      'div',
      { class: `row ${sel ? 'sel' : ''}`, onclick: () => this.host.selectWeapon(sel ? null : mw.part.id) },
      el('span', { class: 'dim' }, `${i + 1}`),
      el('span', { class: mw.part.hp > 0 ? '' : 'bad' }, mw.def.name),
      el('span', { class: block && block !== 'reloading' ? 'dim' : 'good' }, status),
      el('span', {}, targetCell, ' ', chance),
      clear,
    );
  }

  private aimSelect(target: Vehicle, weaponId: string, aim: string): HTMLElement {
    const options = [el('option', { value: 'hull', selected: aim === 'hull' }, `${target.name}: hull`)];
    for (const p of mountedParts(target)) {
      const label = `${target.name}: ${partDef(p.defId).name}${p.hp > 0 ? '' : ' (dead)'}`;
      options.push(el('option', { value: p.id, selected: aim === p.id }, label));
    }
    const select = el('select', {}, ...options) as HTMLSelectElement;
    select.addEventListener('click', (e) => e.stopPropagation());
    select.addEventListener('change', () => {
      this.host.apply(setWeaponOrder(this.host.world(), weaponId, { targetId: target.id, aim: select.value }));
    });
    return select;
  }

  private hold(weaponId: string): void {
    this.host.apply(setWeaponOrder(this.host.world(), weaponId, null));
  }

  toggleAuto(): void {
    const w = this.host.world();
    this.host.apply(setAutoFire(w, !w.player.autoFire));
  }
}

// Weapons that a click on `target` should aim at: the selected one, or all of them.
export function weaponsForClick(world: World, selected: string | null): MountedWeapon[] {
  const all = vehicleStats(world, playerVehicle(world)).weapons;
  return selected ? all.filter((m) => m.part.id === selected) : all;
}
