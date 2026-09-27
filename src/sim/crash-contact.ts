import { PHYSICS } from '../data/physics';
import { baseGrid, corePart, mountedParts } from './grid';
import { partDef } from '../data/parts';
import { NPC_BEHAVIOR } from '../data/npcs';
import { noteCollision } from './combat';
import { getMobilityCondition, isStranded, vehicleStats } from './stats';
import { angleDiff, bearing, clamp, type Vec } from './vec';
import { laneCount, ramMult, walkLane, type PartHit, type Side } from './armor';
import { damagePart } from './damage';
import { RULES } from '../data/rules';
import { PERK_NUMBERS } from '../data/skills';
import { practice, skillEffect, vehicleHasPerk } from './progress';
import { vehicleMass } from './mass';
import { bodyOf } from './body';
import type { Vehicle, World } from './types';

export type CrashContact = { side: Side; lanes: number[] };
export type CrashGeometry = { a: CrashContact; b: CrashContact | null };

export function applyContactCrash(world: World, a: Vehicle, b: Vehicle | null, what: string, impact: number, contact: CrashGeometry): void {
  if (!Number.isFinite(impact) || impact < 0) throw new Error(`Bad crash impact ${impact}`);
  if (Boolean(b) !== Boolean(contact.b)) throw new Error('Crash geometry does not match the bodies');
  if (b) {
    const { hitsA, hitsB } = damageVehicleCrash(world, a, b, impact, contact);
    noteCollision(world, a, b, hitsA, hitsB);
    world.events.push({ t: 'collision', a: a.id, b: b.id, hitsA, hitsB });
    practiceRam(world, a, b, hitsA, hitsB);
    return;
  }
  const hitsA = applyContactDamage(world, a, contact.a, impact, 1, 1);
  world.events.push({ t: 'collision', a: a.id, b: what, hitsA, hitsB: [] });
}

// The player practices driving from the damage its truck deals in a crash with another vehicle. A heavier
// vehicle is harder to hurt.
function practiceRam(world: World, a: Vehicle, b: Vehicle, hitsA: PartHit[], hitsB: PartHit[]): void {
  const me = world.player.vehicleId;
  if (a.id !== me && b.id !== me) return;
  const [own, other, dealt] = a.id === me ? [a, b, hitsB] : [b, a, hitsA];
  const damage = dealt.reduce((sum, hit) => sum + hit.damage, 0);
  if (damage === 0) return;
  practice(world, 'ram', damage, vehicleMass(other) / (vehicleMass(other) + vehicleMass(own)));
}

// Damage only. The real crash also notes the attacks, which a ram forecast must not.
function damageVehicleCrash(world: World, a: Vehicle, b: Vehicle, impact: number, contact: CrashGeometry): { hitsA: PartHit[]; hitsB: PartHit[] } {
  if (!contact.b) throw new Error('Vehicle crash has no target contact');
  const share = vehicleMass(b) / (vehicleMass(a) + vehicleMass(b));
  const multA = ramMult(a, contact.a.side);
  const multB = ramMult(b, contact.b.side);
  const hitsA = applyContactDamage(world, a, contact.a, impact, share, multB);
  const hitsB = applyContactDamage(world, b, contact.b, impact, 1 - share, multA);
  return { hitsA, hitsB };
}

function applyContactDamage(world: World, vehicle: Vehicle, contact: CrashContact, impact: number, share: number, mult: number): PartHit[] {
  if (contact.lanes.length === 0) throw new Error('Crash has no touched lanes');
  if (impact < RULES.collisionMinImpact) return [];
  const energy = computeCrashEnergy(world, vehicle, impact, share, mult);
  const hits = new Map<string, number>();
  // A glancing contact transfers only its touched share of the side's damage budget.
  const round = { damage: energy / laneCount(vehicle, contact.side), pen: RULES.crashPen * mult };
  for (const lane of contact.lanes) {
    // All lanes meet the same pre-impact armor, even if this crash breaks it.
    const copy = structuredClone(vehicle);
    const draft = { ...world, player: structuredClone(world.player), events: [] };
    for (const hit of walkLane(draft, copy, contact.side, lane, round)) {
      hits.set(hit.part, (hits.get(hit.part) ?? 0) + hit.damage);
    }
  }
  return applyCrashHits(world, vehicle, hits);
}

// The player's driving and the ram guard perk cut the crash damage the player truck takes.
function computeCrashEnergy(world: World, vehicle: Vehicle, impact: number, share: number, mult: number): number {
  const driving = skillEffect(world, vehicle, 'driving', 'crashDamage');
  const guard = vehicleHasPerk(world, vehicle, 'ramGuard') ? PERK_NUMBERS.ramGuard.crashTaken : 1;
  return RULES.ramDamage * impact * impact * share * mult * Math.max(0, 1 - driving) * guard;
}

function applyCrashHits(world: World, vehicle: Vehicle, hits: Map<string, number>): PartHit[] {
  const parts = new Map(mountedParts(vehicle).map((part) => [part.id, part]));
  return [...hits].map(([id, damage]) => {
    const part = parts.get(id);
    if (!part) throw new Error(`Crash hit unknown part ${id}`);
    return { part: id, damage: damagePart(world, vehicle, part, damage) };
  });
}

// The closing speed of a ram if the attacker drove at the target now, in tiles per turn. Null when it cannot ram: it
// cannot drive, the target lies more than 45 degrees off its nose, or the blow would be too slow to hurt.
export function ramImpact(world: World, attacker: Vehicle, target: Vehicle): number | null {
  if (isStranded(world, attacker)) return null;
  const heading = bearing(attacker.pos, target.pos);
  if (Math.abs(angleDiff(attacker.heading, heading)) > Math.PI / 4) return null;
  const stats = vehicleStats(world, attacker);
  const speed = Math.min(stats.maxSpeed, attacker.speed + stats.accel);
  const along = target.speed * Math.cos(target.heading - heading);
  const impact = Math.max(0, speed - along);
  return impact < RULES.collisionMinImpact ? null : impact;
}

// Whether a ram now looks worth it: the attacker drives well enough, the forecast target loses more than the
// attacker, and the attacker keeps its working parts, its cab and its driving parts above the flee condition.
export function isRamGainful(world: World, attacker: Vehicle, target: Vehicle): boolean {
  const impact = ramImpact(world, attacker, target);
  if (impact === null) throw new Error(`${attacker.id} weighs a ram on ${target.id} it cannot make`);
  if (getMobilityCondition(attacker) <= NPC_BEHAVIOR.recoverCondition) return false;
  return canSurviveRam(world, attacker, target, impact, bearing(attacker.pos, target.pos), NPC_BEHAVIOR.fleeCondition);
}

function canSurviveRam(world: World, attacker: Vehicle, target: Vehicle, impact: number, heading: number, minimum: number): boolean {
  const own = structuredClone(attacker);
  const other = structuredClone(target);
  // Enemy part health is not observable. Assume intact protection for the risk estimate.
  for (const part of mountedParts(other)) part.hp = partDef(part.defId).hp;
  const draft = { ...world, player: structuredClone(world.player), events: [] };
  own.heading = heading;
  const contact = estimateCrashGeometry(own, other, other.pos);
  damageVehicleCrash(draft, own, other, impact, contact);
  const ownLoss = computePartLoss(attacker, own);
  const otherLoss = mountedParts(other).reduce((sum, part) => sum + partDef(part.defId).hp - part.hp, 0);
  return otherLoss > ownLoss && retainsCombatParts(attacker, own, minimum);
}

function computePartLoss(before: Vehicle, after: Vehicle): number {
  const hp = new Map(mountedParts(before).map((part) => [part.id, part.hp]));
  return mountedParts(after).reduce((sum, part) => {
    const previous = hp.get(part.id);
    if (previous === undefined) throw new Error(`Ram forecast introduced part ${part.id}`);
    return sum + previous - part.hp;
  }, 0);
}

function retainsCombatParts(before: Vehicle, after: Vehicle, minimum: number): boolean {
  const working = new Set(mountedParts(before).filter((part) => part.hp > 0).map((part) => part.id));
  const disabled = mountedParts(after).some((part) => working.has(part.id) && part.hp === 0);
  return !disabled && getMobilityCondition(after) > minimum && corePart(after, 'cab').hp > partDef('cab').hp * minimum;
}

export function estimateCrashGeometry(a: Vehicle, b: Vehicle | null, from: Vec): CrashGeometry {
  return { a: estimateBodyContact(a, b, from), b: b ? estimateBodyContact(b, a, a.pos) : null };
}

function estimateBodyContact(vehicle: Vehicle, other: Vehicle | null, from: Vec): CrashContact {
  const angle = bearing(vehicle.pos, from) - vehicle.heading;
  const normal = { x: Math.cos(angle), y: Math.sin(angle) };
  const side = selectContactSide(normal);
  const front = side === 'front' || side === 'rear';
  const extent = other ? computeProjectedExtent(other, vehicle.heading, front) : 0;
  const distance = Math.hypot(from.x - vehicle.pos.x, from.y - vehicle.pos.y) * PHYSICS.metersPerTile;
  const across = front ? Math.sin(angle) * distance : Math.cos(angle) * distance;
  const points = front
    ? [{ x: 0, y: across - extent }, { x: 0, y: across + extent }]
    : [{ x: across - extent, y: 0 }, { x: across + extent, y: 0 }];
  return locateCrashContact(vehicle.chassisId, points, normal);
}

function computeProjectedExtent(vehicle: Vehicle, heading: number, front: boolean): number {
  const body = bodyOf(vehicle.chassisId);
  const relative = vehicle.heading - heading;
  const c = Math.abs(Math.cos(relative));
  const s = Math.abs(Math.sin(relative));
  return front ? body.half.x * s + body.half.z * c : body.half.x * c + body.half.z * s;
}

function selectContactSide(normal: Vec): Side {
  if (Math.abs(normal.x) >= Math.abs(normal.y)) return normal.x >= 0 ? 'front' : 'rear';
  return normal.y >= 0 ? 'right' : 'left';
}

export function locateCrashContact(chassisId: string, points: Vec[], normal: Vec): CrashContact {
  if (points.length === 0) throw new Error('Crash has no contact points');
  const side = selectContactSide(normal);
  const grid = baseGrid(chassisId);
  const front = side === 'front' || side === 'rear';
  const count = front ? grid.w : grid.h;
  const indices = points.map((point) => front
    ? point.y / PHYSICS.cell.across + grid.w / 2
    : grid.h / 2 - point.x / PHYSICS.cell.along);
  const first = clamp(Math.floor(Math.min(...indices)), 0, count - 1);
  const last = clamp(Math.floor(Math.max(...indices)), 0, count - 1);
  return { side, lanes: Array.from({ length: last - first + 1 }, (_, i) => first + i) };
}

export function computeClosingSpeed(relative: Vec, normal: Vec): number {
  const length = Math.hypot(normal.x, normal.y);
  if (!(length > 0)) throw new Error('Crash normal has no horizontal direction');
  return Math.max(0, (relative.x * normal.x + relative.y * normal.y) / length);
}
