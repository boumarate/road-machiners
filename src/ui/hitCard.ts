// Hover card: my weapons' hit odds on the hovered truck and its weapons' odds on me, with the causes of scatter.
// Every number comes from hitOdds, the same function the fire phase rolls against.

import { fireBlock, hitOdds, type HitOdds } from '../sim/combat';
import { playerVehicle } from '../sim/damage';
import { vehicleStats, type MountedWeapon } from '../sim/stats';
import type { Aim, Vehicle, World } from '../sim/types';
import { DEG } from '../sim/vec';
import { el } from './dom';
import { BLOCK_TEXT } from './weapons';

export type HitRow = { label: string; odds: HitOdds | null; text: string; cause: string | null };
export type HitCardData = { name: string; mine: HitRow[]; theirs: HitRow[] };

function deg(r: number): string {
  return (Math.abs(r) / DEG).toFixed(1);
}

// "18 m · shows 4.1 m wide · scatter 2.0° weapon +1.1° crossing +0.4° own speed −0.3° gunnery".
// Extra causes that round to zero are left out.
function causeLine(o: HitOdds): string {
  const extra = ([[o.causes.range, 'range'], [o.causes.crossing, 'crossing'], [o.causes.own, 'own speed'], [o.causes.recoil, 'recoil'], [o.causes.skill, 'perception'], [o.causes.weather, 'weather'], [o.causes.calledShot, 'called shot']] as const)
    .filter(([r]) => deg(r) !== '0.0')
    .map(([r, name]) => ` ${r < 0 ? '−' : '+'}${deg(r)}° ${name}`)
    .join('');
  return `${Math.round(o.distance)} m · shows ${o.width.toFixed(1)} m wide · scatter ${deg(o.causes.weapon)}° weapon${extra}`;
}

function row(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle, aim: Aim, label: string): HitRow {
  const block = fireBlock(world, shooter, mw, target);
  if (block !== null) return { label, odds: null, text: BLOCK_TEXT[block], cause: null };
  const odds = hitOdds(world, shooter, mw, target, aim);
  return { label, odds, text: `${Math.round(odds.chance * 100)}%`, cause: causeLine(odds) };
}

// A weapon's aim at a target: its order's aim when the order is at that target, else a body shot.
function aimAt(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): Aim {
  const order = shooter.weaponOrders[mw.part.id];
  return order && order.targetId === target.id ? order.aim : 'body';
}

// The card for the hovered truck, or null for my own truck.
export function hitCardRows(world: World, hoveredId: string): HitCardData | null {
  const me = playerVehicle(world);
  if (hoveredId === me.id) return null;
  const it = world.vehicles.find((v) => v.id === hoveredId);
  if (!it) throw new Error(`No vehicle ${hoveredId} to hover`);
  return {
    name: it.name,
    mine: vehicleStats(world, me).weapons.map((mw, i) => row(world, me, mw, it, aimAt(me, mw, it), `[${i + 1}] ${mw.def.name}`)),
    theirs: vehicleStats(world, it).weapons.map((mw) => row(world, it, mw, me, aimAt(it, mw, me), mw.def.name)),
  };
}

export class HitCard {
  private root = el('div', { class: 'hitcard' });

  constructor(container: HTMLElement) {
    this.root.style.display = 'none';
    container.append(this.root);
  }

  // Combat details share the fixed vehicle inspection panel.
  render(world: World, hoveredId: string | null): void {
    const card = hoveredId === null ? null : hitCardRows(world, hoveredId);
    if (!card) {
      this.root.replaceChildren();
      return this.hide();
    }
    const section = (title: string, rows: HitRow[]) => [
      el('div', { class: 'hc-head' }, title),
      ...(rows.length === 0 ? [el('div', { class: 'dim' }, 'No weapons')] : rows.flatMap((r) => [
        el('div', { class: 'hc-row' }, el('span', {}, r.label), el('span', { class: r.odds ? 'good' : 'dim' }, r.text)),
        ...(r.cause ? [el('div', { class: 'hc-cause dim' }, r.cause)] : []),
      ])),
    ];
    this.root.replaceChildren(...section('You → it', card.mine), ...section('It → you', card.theirs));
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(): void {
    if (this.root.childElementCount === 0) return this.hide();
    this.root.style.display = '';
  }
}
