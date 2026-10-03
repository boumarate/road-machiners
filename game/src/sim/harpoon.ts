// Harpoon lines. The harpoon fires one light round as a shot, aimed and rolled like a gun's. A round that lands on
// the target walks its lane, and the line holds the first part it touches. The line is a world object that ends
// after its turns (advanceUtilityEffects ages it), when it tears, or when either anchor part leaves its truck or the
// harpoon breaks. Physics reads the holding lines at turn start through lineAnchors() and pulls the two trucks
// together while the line is stretched. A pull above HARPOON.tearForce tears it, and physics reports the tear for
// tearLine().

import { PHYSICS } from '../data/physics';
import type { UtilityDef } from '../data/parts';
import { HARPOON } from '../data/utilities';
import { openSides } from './armor';
import { cellRect } from './body';
import { isHostile, landSingleRound, noteAttack, shotDamage, targetBlock, type FireBlock } from './combat';
import { damagePart } from './damage';
import { newId } from './factory';
import { itemCells, mountedItems } from './grid';
import type { GridItem, HarpoonLine, PartInstance, UtilityOrder, Vehicle, World } from './types';
import { wornDef } from './wear';

const S = PHYSICS.metersPerTile;

// A point on a truck in body meters: +x the nose, +z the truck's right, +y up from the box center.
export type BodyPoint = { x: number; y: number; z: number };

// A holding line as physics needs it: the two trucks, each anchor in its truck's body space, and the length in
// meters past which the line pulls.
export type LineAnchor = { id: string; from: string; to: string; fromAt: BodyPoint; toAt: BodyPoint; length: number };

type PartItem = Extract<GridItem, { kind: 'part' }>;
type TruckOrder = Extract<UtilityOrder, { kind: 'truck' }>;

// Why the harpoon cannot reach the target right now, or null: the gun rules of sight, cover, range and arc.
export function harpoonBlock(world: World, v: Vehicle, part: PartInstance, target: Vehicle): FireBlock | null {
  const item = mountedItem(v, part.id);
  if (!item) throw new Error(`${v.name} has no mounted part ${part.id}`);
  return targetBlock(world, v, { def: wornDef<UtilityDef>(part), sides: openSides(v, item) }, target);
}

// Fires the harpoon at the order's target. Hit or miss, the shot is an attack on the target, and it logs as a shot.
export function fireHarpoon(world: World, v: Vehicle, part: PartInstance, order: TruckOrder): void {
  const target = world.vehicles.find((x) => x.id === order.targetId);
  if (!target) throw new Error(`Harpoon target ${order.targetId} is gone`);
  const def = wornDef<UtilityDef>(part);
  if (def.effect.type !== 'harpoon') throw new Error(`${def.name} is not a harpoon`);
  const { odds, side, round } = landSingleRound(world, v, { def }, target, order.aim);
  noteAttack(world, v, target, !isHostile(world, target, v));
  const event = { t: 'shot' as const, shooter: v.id, weapon: part.id, target: target.id, aim: order.aim, chance: odds.chance, damageChance: odds.damageChance, side, rounds: [round] };
  if (shotDamage(event).has(target.id)) target.lastHitBy = v.id;
  const held = round.hits[0];
  if (held) attach(world, { from: v, fromPart: part.id, to: target, toPart: held.part }, def.effect.turns);
  world.events.push(event);
}

type Ends = { from: Vehicle; fromPart: string; to: Vehicle; toPart: string };

function attach(world: World, ends: Ends, turns: number): void {
  const length = anchorGap(ends);
  world.lines.push({ id: newId(world, 'l'), from: ends.from.id, fromPart: ends.fromPart, to: ends.to.id, toPart: ends.toPart, length, turnsLeft: turns });
}

// Meters between the two anchors on the ground plane, from the trucks' poses.
function anchorGap(ends: Ends): number {
  const a = mapPoint(ends.from, anchorOf(ends.from, ends.fromPart));
  const b = mapPoint(ends.to, anchorOf(ends.to, ends.toPart));
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function mapPoint(v: Vehicle, at: BodyPoint): { x: number; z: number } {
  const cos = Math.cos(v.heading);
  const sin = Math.sin(v.heading);
  return { x: v.pos.x * S + cos * at.x - sin * at.z, z: v.pos.y * S + sin * at.x + cos * at.z };
}

// The anchor of a part: the center of its cells in body meters, at the height of the body's center, so a pull
// does not tip the truck.
function anchorOf(v: Vehicle, partId: string): BodyPoint {
  const item = mountedItem(v, partId);
  if (!item) throw new Error(`${v.name} has no mounted part ${partId}`);
  const r = cellRect(v.chassisId, itemCells(item));
  return { x: (r.x0 + r.x1) / 2, y: 0, z: (r.z0 + r.z1) / 2 };
}

function mountedItem(v: Vehicle, partId: string): PartItem | undefined {
  return mountedItems(v).find((it) => it.part.id === partId);
}

// A line holds while both trucks are in the world, the harpoon is mounted above 0 HP and the held part is mounted.
function holdsEnds(world: World, line: HarpoonLine): Ends | null {
  const from = world.vehicles.find((v) => v.id === line.from);
  const to = world.vehicles.find((v) => v.id === line.to);
  if (!from || !to) return null;
  const harpoon = mountedItem(from, line.fromPart);
  if (!harpoon || harpoon.part.hp <= 0 || !mountedItem(to, line.toPart)) return null;
  return { from, fromPart: line.fromPart, to, toPart: line.toPart };
}

// Drops the lines that no longer hold.
export function endLines(world: World): void {
  world.lines = world.lines.filter((line) => holdsEnds(world, line) !== null);
}

// The holding lines with their anchors in body space, for physics at turn start.
export function lineAnchors(world: World): LineAnchor[] {
  return world.lines.flatMap((line) => {
    const ends = holdsEnds(world, line);
    if (!ends) return [];
    return [{ id: line.id, from: line.from, to: line.to, fromAt: anchorOf(ends.from, ends.fromPart), toAt: anchorOf(ends.to, ends.toPart), length: line.length }];
  });
}

// The line tore under a hard pull: the part it held takes the tear damage, once, and the line is gone.
export function tearLine(world: World, lineId: string): void {
  const line = world.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(`There is no line ${lineId}`);
  world.lines = world.lines.filter((l) => l.id !== lineId);
  const to = world.vehicles.find((v) => v.id === line.to);
  const held = to && mountedItem(to, line.toPart);
  if (!to || !held) throw new Error(`Line ${lineId} tore with no held part ${line.toPart}`);
  const damage = damagePart(world, to, held.part, HARPOON.tearDamage);
  world.events.push({ t: 'lineTorn', line: line.id, vehicle: to.id, part: line.toPart, damage });
}
