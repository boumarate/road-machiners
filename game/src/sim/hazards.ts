// Area hazards: world objects that sit still on a circle of ground and end when their turns run out
// (advanceUtilityEffects in src/sim/utility.ts ages them). Smoke clouds spoil aim through them: they block no sight and
// no line of fire, so they are not cover, and combat.ts reads smokeCrosses() for the `smoke` spread cause. Ground
// fields are caltrop fields and oil patches dropped behind a truck. A caltrop field hurts the wheels of each truck that
// drives through it, once per truck. An oil patch cuts wheel grip in physics, which reads the patches at turn start
// through oilPatches(). Route planners steer around the fields a driver has seen.

import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { CALTROPS } from '../data/utilities';
import { bodyOf } from './body';
import { judgeStray } from './combat';
import { damagePart } from './damage';
import { newId } from './factory';
import { coreParts } from './grid';
import type { Blocker } from './path';
import { getResources } from './resources';
import type { GroundField, Vehicle, World } from './types';
import { segmentDist, type Vec } from './vec';
import { canVehicleSee } from './vision';

// ---- Smoke clouds. The Sprout and the Smoke mortar make them.

// Puts a cloud of radius r tiles at pos, made by source, for the given turns.
export function deploySmoke(world: World, source: Vehicle, pos: Vec, r: number, turns: number): void {
  world.smoke.push({ id: newId(world, 's'), source: source.id, pos: { ...pos }, r, turnsLeft: turns });
}

// Whether the segment from a to b touches any live cloud: an end inside a cloud, or the line through it.
export function smokeCrosses(world: World, a: Vec, b: Vec): boolean {
  return world.smoke.some((c) => segmentDist(c.pos, a, b) <= c.r);
}

// ---- Ground fields. The Caltrops and the Oil spiller drop them.

// How a field is dropped: its radius in tiles, its turns, and the gap in tiles from the truck's rear to its near edge.
export type FieldDrop = { radius: number; turns: number; behind: number };

// Puts a field behind v. Its near edge lies `behind` tiles behind the rear, so the dropper starts clear of it.
export function dropField(world: World, v: Vehicle, kind: GroundField['kind'], drop: FieldDrop): void {
  const back = bodyOf(v.chassisId).half.x / PHYSICS.metersPerTile + drop.behind + drop.radius;
  const pos = { x: v.pos.x - Math.cos(v.heading) * back, y: v.pos.y - Math.sin(v.heading) * back };
  world.fields.push({ id: newId(world, 'g'), kind, source: v.id, pos, r: drop.radius, turnsLeft: drop.turns, hit: [] });
}

// Whether v has too little fuel in its tank to spill this many units of oil.
export function oilShort(world: World, v: Vehicle, fuel: number): boolean {
  return getResources(world, v).fuel < fuel;
}

// Spends the fuel and drops an oil patch behind v. Throws when the tank holds too little.
export function spillOil(world: World, v: Vehicle, drop: FieldDrop & { fuel: number }): void {
  if (oilShort(world, v, drop.fuel)) throw new Error(`${v.id} has no ${drop.fuel} fuel units to spill`);
  getResources(world, v).fuel -= drop.fuel;
  dropField(world, v, 'oil', drop);
}

// After movement: every truck whose trail this turn came within a caltrop field's radius plus its own radius takes
// CALTROPS.damage on each wheel, once per field.
export function caltropHits(world: World): void {
  for (const f of world.fields) if (f.kind === 'caltrops') hitCrossers(world, f);
}

function hitCrossers(world: World, f: GroundField): void {
  for (const v of world.vehicles) if (!f.hit.includes(v.id) && crosses(v, f)) hitWheels(world, f, v);
}

// The trail ends at the truck's position, so a truck with no trail this turn stands at its position.
function crosses(v: Vehicle, f: GroundField): boolean {
  const points: Vec[] = [...v.trail, v.pos];
  const reach = f.r + chassisDef(v.chassisId).radius;
  return points.some((p, i) => segmentDist(f.pos, points[Math.max(0, i - 1)], p) <= reach);
}

function hitWheels(world: World, f: GroundField, v: Vehicle): void {
  f.hit.push(v.id);
  const dealt = coreParts(v, 'wheel').reduce((sum, wheel) => sum + damagePart(world, v, wheel, CALTROPS.damage), 0);
  world.events.push({ t: 'caltrops', vehicle: v.id, field: f.id, source: f.source });
  judgeField(world, f, v, dealt);
}

// Judged like stray fire from the dropper. A dropper on its own field, or one no longer in the world, blames nobody.
function judgeField(world: World, f: GroundField, v: Vehicle, dealt: number): void {
  const source = world.vehicles.find((x) => x.id === f.source);
  if (!source || source.id === v.id || dealt === 0) return;
  v.lastHitBy = source.id;
  judgeStray(world, source, v, dealt);
}

// The live oil patches, in tiles. Overlapping patches stay separate; physics counts a wheel in any of them once.
export function oilPatches(world: World): { pos: Vec; r: number }[] {
  return world.fields.filter((f) => f.kind === 'oil').map((f) => ({ pos: { ...f.pos }, r: f.r }));
}

// The fields v's route planner steers around, like parked trucks: those it sees now and those it dropped.
export function fieldBlockers(world: World, v: Vehicle): Blocker[] {
  return world.fields.filter((f) => f.source === v.id || canVehicleSee(world, v, f.pos)).map((f) => ({ pos: f.pos, r: f.r }));
}
