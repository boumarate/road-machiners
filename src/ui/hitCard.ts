// Hover card: my weapons' hit odds on the hovered truck and its weapons' odds on me, with the causes of scatter.
// Every number comes from hitOdds, the same function the fire phase rolls against.

import { fireBlock, hitOdds, type HitOdds } from '../sim/combat';
import { playerVehicle } from '../sim/damage';
import { vehicleStats, type MountedWeapon } from '../sim/stats';
import type { Aim, Vehicle, World } from '../sim/types';
import { DEG } from '../sim/vec';
import { el, panel } from './dom';
import { BLOCK_TEXT } from './weapons';

export type HitRow = { label: string; odds: HitOdds | null; text: string; cause: string | null };
export type HitCardData = { name: string; mine: HitRow[]; theirs: HitRow[] };

const GAP_PX = 12; // space between the truck and the card
const EDGE_PX = 8; // space between the card and the window edge

function deg(r: number): string {
  return (Math.abs(r) / DEG).toFixed(1);
}

// "18 m · shows 4.1 m wide · scatter 2.0° weapon +1.1° crossing +0.4° own speed −0.3° gunnery".
// Extra causes that round to zero are left out.
function causeLine(o: HitOdds): string {
  const extra = ([[o.causes.crossing, 'crossing'], [o.causes.own, 'own speed'], [o.causes.skill, 'gunnery']] as const)
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
  private root = panel('hitcard');

  constructor() {
    this.root.style.display = 'none';
  }

  // Fills the card for the hovered truck. It stays hidden until place() shows it.
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
    this.root.replaceChildren(el('h3', {}, card.name), ...section('You → it', card.mine), ...section('It → you', card.theirs));
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  // Shows the card beside the truck at screen point p. clearX is how far the truck reaches sideways on screen,
  // so the card sits past it: on the right, or on the left when the right has no room.
  place(p: { x: number; y: number }, clearX: number): void {
    if (this.root.childElementCount === 0) return this.hide();
    this.root.style.display = '';
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const right = p.x + clearX + GAP_PX;
    const left = right + w <= window.innerWidth - EDGE_PX ? right : p.x - clearX - GAP_PX - w;
    const top = Math.min(Math.max(EDGE_PX, p.y - h / 2), window.innerHeight - h - EDGE_PX);
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }
}
