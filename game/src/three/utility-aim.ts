// Aiming a utility that waits for a target: the selected truck or point utility, the click that gives its order, and
// the ground marks that show where it can reach. A point utility shows its range ring around the truck and a marker
// of its effect's size under the pointer, red where the point is out of range. Every point order set this turn keeps
// a marker. Rules stay in src/sim/utility.ts; this file only turns clicks into orders.

import * as THREE from 'three';
import { partDef } from '../data/parts';
import { PAL } from '../render/palette';
import { playerVehicle } from '../sim/damage';
import type { Terrain } from '../sim/terrain';
import type { Aim, PartInstance, UtilityOrder, Vehicle, World } from '../sim/types';
import { chargedParts, orderKindOf, pointBlock, pointReach, utilityBlock, utilityOrderError } from '../sim/utility';
import type { Vec } from '../sim/vec';
import { setUtilityOrder } from '../sim/world';
import { BLOCK_TEXT } from '../ui/weapons';
import { GroundBand } from './render/zones';

const LOOK = {
  ring: { width: 0.1, opacity: 0.8 }, // the range edges, in tiles
  reach: 0.08, // opacity of the ground the point may go to
  marker: { width: 0.12, opacity: 0.9, dot: 0.35 }, // the effect's edge and its center dot, in tiles
  renderOrder: 812,
};

export type UtilityAimHost = {
  world(): World;
  apply(next: World): void;
  note(text: string): void; // a refused order, shown to the player
};

export class UtilityAim {
  readonly root = new THREE.Group();
  private selected: string | null = null;
  private readonly reach = band(LOOK.reach);
  private readonly inner = band(LOOK.ring.opacity);
  private readonly outer = band(LOOK.ring.opacity);
  private readonly hover = new Marker(this.root);
  private readonly set: Marker[] = [];

  constructor(private readonly host: UtilityAimHost) {
    for (const b of [this.reach, this.inner, this.outer]) this.root.add(b.mesh);
  }

  get selectedId(): string | null {
    return this.selected;
  }

  select(id: string | null): void {
    this.selected = id;
  }

  // The selected part while it can still act, or null. A part that left the truck, broke or got an order drops it.
  private selectedPart(w: World): PartInstance | null {
    const me = playerVehicle(w);
    const part = chargedParts(me).find((p) => p.id === this.selected);
    const waiting = part && !utilityBlock(w, me, part) && !me.utilityOrders[part.id] ? part : null;
    if (!waiting) this.selected = null;
    return waiting;
  }

  // A left click while a utility waits for its target. picked: the truck under the pointer, other than the player's.
  // Returns false when the click is not for the utility, so it orders the truck as usual.
  click(picked: Vehicle | null, ground: Vec | null): boolean {
    const part = this.selectedPart(this.host.world());
    if (!part) return false;
    const order = orderFor(orderKindOf(part), picked, ground);
    if (!order) return false;
    this.order(part, order);
    return true;
  }

  // A part click in the hover panel aims a selected truck utility at that part. False when none waits.
  aimPart(target: Vehicle, aim: Aim): boolean {
    const part = this.selectedPart(this.host.world());
    if (!part || orderKindOf(part) !== 'truck') return false;
    this.order(part, { kind: 'truck', targetId: target.id, aim });
    return true;
  }

  private order(part: PartInstance, order: UtilityOrder): void {
    const w = this.host.world();
    const me = playerVehicle(w);
    const outOfRange = order.kind === 'point' && pointBlock(me, part, order.pos) !== null;
    const error = outOfRange ? `${partDef(part.defId).name}: ${BLOCK_TEXT.range}` : utilityOrderError(w, me, part.id, order);
    if (error) return this.host.note(error);
    this.selected = null;
    this.host.apply(setUtilityOrder(w, part.id, order));
  }

  // hoverGround: the ground point under the pointer, or null. hide: nothing shows, as while a turn plays.
  draw(w: World, terrain: Terrain, hoverGround: Vec | null, hide: boolean): void {
    this.root.visible = !hide;
    if (hide) return;
    const me = playerVehicle(w);
    const part = this.selectedPart(w);
    if (part && orderKindOf(part) === 'point') this.drawReach(terrain, me, part, hoverGround);
    else for (const b of [this.reach, this.inner, this.outer, this.hover]) b.hide();
    this.drawSet(terrain, me);
  }

  private drawReach(terrain: Terrain, me: Vehicle, part: PartInstance, hoverGround: Vec | null): void {
    const { minRange, maxRange } = pointReach(part);
    this.reach.set(terrain, me.pos, minRange, maxRange);
    this.inner.set(terrain, me.pos, minRange - LOOK.ring.width, minRange);
    this.outer.set(terrain, me.pos, maxRange, maxRange + LOOK.ring.width);
    if (!hoverGround) return this.hover.hide();
    this.hover.place(terrain, hoverGround, effectRadius(part), pointBlock(me, part, hoverGround) ? PAL.dest : PAL.select);
  }

  // A marker on each point order set this turn.
  private drawSet(terrain: Terrain, me: Vehicle): void {
    const points = chargedParts(me).flatMap((part) => {
      const order = me.utilityOrders[part.id];
      return order?.kind === 'point' ? [{ pos: order.pos, r: effectRadius(part) }] : [];
    });
    while (this.set.length < points.length) this.set.push(new Marker(this.root));
    this.set.forEach((m, i) => (points[i] ? m.place(terrain, points[i].pos, points[i].r, PAL.select) : m.hide()));
  }
}

function orderFor(kind: UtilityOrder['kind'] | null, picked: Vehicle | null, ground: Vec | null): UtilityOrder | null {
  if (kind === 'truck' && picked) return { kind: 'truck', targetId: picked.id, aim: 'body' };
  if (kind === 'point' && ground) return { kind: 'point', pos: ground };
  return null;
}

// The radius in tiles the utility's effect covers around its point.
function effectRadius(part: PartInstance): number {
  const def = partDef(part.defId);
  if (def.kind !== 'utility' || !('radius' in def.effect)) throw new Error(`${def.name} covers no radius`);
  return def.effect.radius;
}

function band(opacity: number): GroundBand {
  return new GroundBand({ color: PAL.select, opacity, renderOrder: LOOK.renderOrder, overTrucks: true });
}

// The edge of an effect's circle and a dot at its center.
class Marker {
  private readonly edge = band(LOOK.marker.opacity);
  private readonly dot = band(LOOK.marker.opacity);

  constructor(root: THREE.Group) {
    root.add(this.edge.mesh, this.dot.mesh);
  }

  place(terrain: Terrain, at: Vec, r: number, color: number): void {
    this.edge.set(terrain, at, r - LOOK.marker.width, r);
    this.dot.set(terrain, at, 0, LOOK.marker.dot);
    this.edge.color(color);
    this.dot.color(color);
  }

  hide(): void {
    this.edge.hide();
    this.dot.hide();
  }
}
