// Utility parts: their charge, the orders that use them and the activation step of the turn. Each effect's world
// object has its own owner file; this file only checks orders and hands each use to its effect.

import { partDef, type PartDef, type UtilityDef, type UtilityEffect, type UtilityEffectType } from '../data/parts';
import type { FireBlock } from './combat';
import { findPart } from './damage';
import { isKnockedOut } from './defeat';
import { isMounted, mountedParts } from './grid';
import { deploySmoke, dropField, oilShort, spillOil } from './hazards';
import type { ChargeState, PartInstance, UtilityOrder, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { canVehicleSee } from './vision';
import { wornDef, wornTurns } from './wear';

// What a part does when used: a utility effect, or arming a claymore ram.
type UseKind = UtilityEffectType | 'claymore';

// The order each use takes. A passive utility takes none.
const ORDER_KIND: Record<UseKind, UtilityOrder['kind'] | null> = {
  sprout: 'self',
  caltrops: 'self',
  oil: 'self',
  emitter: 'self',
  claymore: 'self',
  harpoon: 'truck',
  mortar: 'point',
  flare: 'point',
  crane: null,
  scraper: null,
};

// The order in which this turn's uses resolve: smoke and flares first, so they already cover this turn's shots, then
// the harpoon, the ground drops and arming, and the emitter pulse last.
const USE_ORDER: Record<UseKind, number> = {
  sprout: 0,
  mortar: 0,
  flare: 0,
  harpoon: 1,
  caltrops: 2,
  oil: 2,
  claymore: 2,
  emitter: 3,
  crane: 4,
  scraper: 4,
};

type Use = { vehicle: Vehicle; part: PartInstance; order: UtilityOrder; kind: UseKind };

// Each effect's arm. The effect files fill these in.
const notBuilt = (kind: UseKind) => (): void => {
  throw new Error(`not built: ${kind}`);
};
const passive = (kind: UseKind) => (): void => {
  throw new Error(`${kind} is passive and is never used`);
};
const ARMS: Record<UseKind, (world: World, use: Use) => void> = {
  sprout: (world, { vehicle, part }) => {
    const e = effectOf(part, 'sprout');
    deploySmoke(world, vehicle, vehicle.pos, e.radius, e.turns);
  },
  mortar: (world, { vehicle, part, order }) => {
    const e = effectOf(part, 'mortar');
    deploySmoke(world, vehicle, pointOf(order), e.radius, e.turns);
  },
  flare: notBuilt('flare'),
  harpoon: notBuilt('harpoon'),
  caltrops: (world, { vehicle, part }) => dropField(world, vehicle, 'caltrops', effectOf(part, 'caltrops')),
  oil: (world, { vehicle, part }) => spillOil(world, vehicle, effectOf(part, 'oil')),
  claymore: notBuilt('claymore'),
  emitter: notBuilt('emitter'),
  crane: passive('crane'),
  scraper: passive('scraper'),
};

function effectOf<T extends UtilityEffectType>(part: PartInstance, type: T): Extract<UtilityEffect, { type: T }> {
  const def = partDef(part.defId);
  if (def.kind !== 'utility' || def.effect.type !== type) throw new Error(`${def.name} is not a ${type}`);
  return def.effect as Extract<UtilityEffect, { type: T }>;
}

function pointOf(order: UtilityOrder): Vec {
  if (order.kind !== 'point') throw new Error(`A ${order.kind} order has no point`);
  return order.pos;
}

// The use of a part that has a charge: its utility effect, or arming for a claymore ram. Throws for any other part.
function useKindOf(def: PartDef): UseKind {
  if (def.kind === 'utility') return def.effect.type;
  if (def.kind === 'armor' && def.claymore) return 'claymore';
  throw new Error(`${def.name} is not a utility`);
}

// The kind of order the part takes: self, truck or point, or null for a passive utility. Throws for a part that is
// not a utility or a claymore ram.
export function orderKindOf(part: PartInstance): UtilityOrder['kind'] | null {
  return ORDER_KIND[useKindOf(partDef(part.defId))];
}

// The mounted parts that act on an order, working or not, in the truck's item order: active utilities and claymore
// rams.
export function chargedParts(v: Vehicle): PartInstance[] {
  return mountedParts(v).filter((p) => p.charge !== undefined);
}

export function chargeOf(part: PartInstance): ChargeState {
  if (!part.charge) throw new Error(`Part ${part.id} has no charge`);
  return part.charge;
}

// Turns from one use of the part to the next, longer for a worn part. Throws for a part without a reload.
export function wornReload(part: PartInstance): number {
  const def = partDef(part.defId);
  if (def.kind === 'armor' && def.claymore) return wornTurns(def.claymore.reload, part.wear);
  const reload = def.kind === 'utility' ? wornDef<UtilityDef>(part).reload : null;
  if (reload === null) throw new Error(`${def.name} has no reload`);
  return reload;
}

function partOn(v: Vehicle, partId: string): { part: PartInstance; mounted: boolean } {
  for (const it of v.items)
    if (it.kind === 'part' && it.part.id === partId) return { part: it.part, mounted: isMounted(v.chassisId, it) };
  throw new Error(`${v.name} has no part ${partId}`);
}

// Why the part cannot act this turn, or null when it can. It acts only fully mounted, above 0 HP and recharged.
export function utilityBlock(world: World, v: Vehicle, part: PartInstance): FireBlock | null {
  if (isKnockedOut(v)) return 'out';
  if (!partOn(v, part.id).mounted) return 'unmounted';
  if (part.hp <= 0) return 'disabled';
  return chargeOf(part).reload > 0 ? 'cooldown' : null;
}

// Why the vehicle cannot give this order to the part, or null when it can. Throws when the truck has no such part
// or the part is not a utility.
export function utilityOrderError(world: World, v: Vehicle, partId: string, order: UtilityOrder): string | null {
  const { part } = partOn(v, partId);
  const def = partDef(part.defId);
  const wanted = ORDER_KIND[useKindOf(def)];
  if (wanted === null) return `${def.name} is passive and takes no order`;
  if (order.kind !== wanted) return `${def.name} takes a ${wanted} order`;
  const block = utilityBlock(world, v, part);
  if (block) return `${def.name}: ${block}`;
  return costError(world, v, def) ?? targetError(world, v, part, order);
}

// The oil spiller needs its fuel in the tank.
function costError(world: World, v: Vehicle, def: PartDef): string | null {
  if (def.kind !== 'utility' || def.effect.type !== 'oil') return null;
  return oilShort(world, v, def.effect.fuel) ? `${def.name}: fuel` : null;
}

function targetError(world: World, v: Vehicle, part: PartInstance, order: UtilityOrder): string | null {
  if (order.kind === 'truck') return truckOrderError(world, v, order);
  if (order.kind === 'point' && pointBlock(v, part, order.pos)) return `${partDef(part.defId).name}: range`;
  return null;
}

// How near and how far from the truck the part may send its point, in tiles. Throws for a part that takes no point.
export function pointReach(part: PartInstance): { minRange: number; maxRange: number } {
  const def = partDef(part.defId);
  const e = def.kind === 'utility' ? def.effect : null;
  if (!e || !('maxRange' in e)) throw new Error(`${def.name} takes no point`);
  return { minRange: e.minRange, maxRange: e.maxRange };
}

// 'range' when the point lies nearer or farther than the part reaches from the truck, else null. No sight is needed.
export function pointBlock(v: Vehicle, part: PartInstance, pos: Vec): FireBlock | null {
  const { minRange, maxRange } = pointReach(part);
  const d = dist(v.pos, pos);
  return d < minRange || d > maxRange ? 'range' : null;
}

function truckOrderError(world: World, v: Vehicle, order: Extract<UtilityOrder, { kind: 'truck' }>): string | null {
  const target = world.vehicles.find((x) => x.id === order.targetId);
  if (!target || target.id === v.id) return `Bad target ${order.targetId}`;
  if (!canVehicleSee(world, v, target.pos)) return 'Target is not in sight';
  if (order.aim !== 'body' && !findPart(target, order.aim)) return `Target has no part ${order.aim}`;
  return null;
}

// The activation step, after movement and vision and before the guns fire. Every order acts once and is cleared.
// An order the part refuses by now does nothing. A part that left the truck since the order was given drops it.
export function activateUtilities(world: World): void {
  const uses: Use[] = [];
  for (const vehicle of world.vehicles) {
    for (const [partId, order] of Object.entries(vehicle.utilityOrders)) {
      const held = vehicle.items.some((it) => it.kind === 'part' && it.part.id === partId);
      if (held && utilityOrderError(world, vehicle, partId, order) === null) uses.push(useOf(vehicle, partId, order));
    }
    vehicle.utilityOrders = {};
  }
  uses.sort((a, b) => USE_ORDER[a.kind] - USE_ORDER[b.kind]);
  for (const use of uses) act(world, use);
}

function useOf(vehicle: Vehicle, partId: string, order: UtilityOrder): Use {
  const { part } = partOn(vehicle, partId);
  return { vehicle, part, order, kind: useKindOf(partDef(part.defId)) };
}

// Runs the effect. A utility then recharges, hit or miss. A claymore ram's arm handles its own charge.
function act(world: World, use: Use): void {
  ARMS[use.kind](world, use);
  if (use.kind !== 'claymore') chargeOf(use.part).reload = wornReload(use.part);
  world.events.push({
    t: 'utility',
    vehicle: use.vehicle.id,
    part: use.part.id,
    effect: use.kind,
    target: use.order.kind === 'truck' ? use.order.targetId : null,
    point: use.order.kind === 'point' ? { ...use.order.pos } : null,
  });
}

// Once per turn after the activation step, every mounted charge comes one turn closer to ready.
export function tickCharges(world: World): void {
  for (const v of world.vehicles)
    for (const part of mountedParts(v)) if (part.charge && part.charge.reload > 0) part.charge.reload--;
}

// Whether the vehicle has a mounted utility of this effect above 0 HP. Several count as one.
export function hasWorkingUtility(v: Vehicle, effect: UtilityEffectType): boolean {
  return mountedParts(v, 'utility').some((p) => p.hp > 0 && (partDef(p.defId) as UtilityDef).effect.type === effect);
}

// Ages smoke, fields, flares and lines by a turn and removes those whose turns ran out.
export function advanceUtilityEffects(world: World): void {
  world.smoke = aged(world.smoke);
  world.fields = aged(world.fields);
  world.flares = aged(world.flares);
  world.lines = aged(world.lines);
}

function aged<T extends { turnsLeft: number }>(effects: T[]): T[] {
  for (const e of effects) e.turnsLeft--;
  return effects.filter((e) => e.turnsLeft > 0);
}
