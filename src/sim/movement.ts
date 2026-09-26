// Simultaneous movement of all vehicles in substeps, with collisions.

import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import { laneCount, sideToward, walkLane } from './armor';
import { isDriveObstacle } from './mapgen';
import { vehicleStats, type VehicleStats } from './stats';
import { advanceOn, nextOrder, reached, steerTo, steerWithFuel, type Steer } from './steering';
import { isCliff, tileAt } from './terrain';
import type { Pose, Vehicle, World } from './types';
import { clamp, dist, type Vec } from './vec';

const EPS = 0.01;

type Mover = { v: Vehicle; s: VehicleStats; steer: Steer; stopped: boolean; prev: Pose };

export function resolveMovement(world: World): void {
  const movers: Mover[] = world.vehicles.map((v) => {
    const s = vehicleStats(world, v);
    return { v, s, steer: moveSteer(world, v, s), stopped: false, prev: { x: v.pos.x, y: v.pos.y, heading: v.heading } };
  });
  for (const m of movers) m.v.trail = [{ x: m.v.pos.x, y: m.v.pos.y, heading: m.v.heading }];

  for (let i = 0; i < RULES.substeps; i++) {
    for (const m of movers) if (!m.stopped) stepMover(world, m);
    for (const m of movers) collideStatic(world, m);
    collideVehicles(world, movers);
    for (const m of movers) m.v.trail.push({ x: m.v.pos.x, y: m.v.pos.y, heading: m.v.heading });
  }

  separateAll(world, movers);
  for (const m of movers) finishMove(world, m);
}

function moveSteer(world: World, v: Vehicle, s: VehicleStats): Steer {
  return v.faction === 'player' ? steerWithFuel(world, s, v, v.order, v.direct, world.player.fuel) : steerTo(world, s, v, v.order, v.direct);
}

function stepMover(world: World, m: Mover): void {
  m.prev = { x: m.v.pos.x, y: m.v.pos.y, heading: m.v.heading };
  const p = advanceOn(world.terrain, m.prev, m.steer, RULES.substeps);
  m.v.pos = { x: p.x, y: p.y };
  m.v.heading = p.heading;
}

function collideStatic(world: World, m: Mover): void {
  if (m.stopped) return;
  const hitWall = clampToMap(world, m);
  if (hitWall) {
    world.events.push({ t: 'collision', a: m.v.id, b: 'edge', damageA: 0, damageB: 0 });
    stop(m);
    return;
  }
  if (hitsCliff(world, m)) {
    m.v.pos = { x: m.prev.x, y: m.prev.y };
    crash(world, m, 'cliff', ahead(m.v));
    return;
  }
  for (const o of world.obstacles.filter(isDriveObstacle)) {
    const d = dist(m.v.pos, o.pos);
    if (d >= o.r + m.s.radius) continue;
    pushOut(m.v.pos, o.pos, o.r + m.s.radius, m.v.heading);
    crash(world, m, o.id, o.pos);
    return;
  }
}

// Driving from passable ground onto a cliff tile. A vehicle already on a cliff may drive off it.
function hitsCliff(world: World, m: Mover): boolean {
  const t = world.terrain;
  return isCliff(t, tileAt(t, m.v.pos)) && !isCliff(t, tileAt(t, m.prev));
}

// from is the point the blow comes from, which picks the struck side.
function crash(world: World, m: Mover, what: string, from: Vec): void {
  const dealt = crashHits(world, m.v, from, crashDamage(world, m.v, m.steer.speed, 1));
  world.events.push({ t: 'collision', a: m.v.id, b: what, damageA: dealt, damageB: 0 });
  stop(m);
}

function collideVehicles(world: World, movers: Mover[]): void {
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i];
      const b = movers[j];
      if (a.stopped && b.stopped) continue;
      const reach = a.s.radius + b.s.radius;
      const d = dist(a.v.pos, b.v.pos);
      if (d >= reach) continue;
      const rel = relativeSpeed(a, b);
      separatePair(a.v.pos, b.v.pos, reach, a.v.heading);
      const dmgA = crashDamage(world, a.v, rel, b.s.mass / a.s.mass);
      const dmgB = crashDamage(world, b.v, rel, a.s.mass / b.s.mass);
      a.v.lastHitBy = b.v.id;
      b.v.lastHitBy = a.v.id;
      const dealtA = crashHits(world, a.v, b.v.pos, dmgA);
      const dealtB = crashHits(world, b.v, a.v.pos, dmgB);
      world.events.push({ t: 'collision', a: a.v.id, b: b.v.id, damageA: dealtA, damageB: dealtB });
      stop(a);
      stop(b);
    }
  }
}

function relativeSpeed(a: Mover, b: Mover): number {
  const va = a.stopped ? 0 : a.steer.speed;
  const vb = b.stopped ? 0 : b.steer.speed;
  const dx = Math.cos(a.v.heading) * va - Math.cos(b.v.heading) * vb;
  const dy = Math.sin(a.v.heading) * va - Math.sin(b.v.heading) * vb;
  return Math.hypot(dx, dy);
}

// A crash found by the physics engine. b is the other vehicle, or null for obstacles and walls;
// what names the thing hit. impact is the closing speed in tiles per turn.
// Without another vehicle the contact point is unknown, so the blow lands on a's front.
export function applyCrash(world: World, a: Vehicle, b: Vehicle | null, what: string, impact: number): void {
  const massA = vehicleStats(world, a).mass;
  const massB = b ? vehicleStats(world, b).mass : massA;
  const dealtA = crashHits(world, a, b ? b.pos : ahead(a), crashDamage(world, a, impact, massB / massA));
  const dealtB = b ? crashHits(world, b, a.pos, crashDamage(world, b, impact, massA / massB)) : 0;
  if (b) {
    a.lastHitBy = b.id;
    b.lastHitBy = a.id;
  }
  world.events.push({ t: 'collision', a: a.id, b: what, damageA: dealtA, damageB: dealtB });
}

// massRatio is the other body's mass over this vehicle's mass; 1 for obstacles.
function crashDamage(world: World, v: Vehicle, impact: number, massRatio: number): number {
  const mech = v.faction === 'player' ? skillBonus('mechanics', world.player.skills.mechanics) : 0;
  if (impact < RULES.collisionMinImpact) return 0;
  return impact * massRatio * RULES.collisionDamage * Math.max(0, 1 - mech);
}

// Crash damage spreads evenly over every lane of the side facing from, at crash penetration.
// Returns the total damage dealt to parts.
function crashHits(world: World, v: Vehicle, from: Vec, dmg: number): number {
  if (dmg <= 0) return 0;
  const side = sideToward(v, from);
  const lanes = laneCount(v, side);
  let dealt = 0;
  for (let lane = 0; lane < lanes; lane++) {
    for (const h of walkLane(world, v, side, lane, { damage: dmg / lanes, pen: RULES.crashPen })) dealt += h.damage;
  }
  return dealt;
}

// A point one tile ahead of the vehicle's nose direction.
function ahead(v: Vehicle): Vec {
  return { x: v.pos.x + Math.cos(v.heading), y: v.pos.y + Math.sin(v.heading) };
}

function stop(m: Mover): void {
  m.stopped = true;
}

function clampToMap(world: World, m: { v: Vehicle; s: VehicleStats }): boolean {
  const r = m.s.radius;
  const x = clamp(m.v.pos.x, r, world.size - r);
  const y = clamp(m.v.pos.y, r, world.size - r);
  const hit = x !== m.v.pos.x || y !== m.v.pos.y;
  m.v.pos = { x, y };
  return hit;
}

function pushOut(p: Vec, from: Vec, reach: number, heading: number): void {
  let dx = p.x - from.x;
  let dy = p.y - from.y;
  let d = Math.hypot(dx, dy);
  if (d === 0) {
    dx = -Math.cos(heading);
    dy = -Math.sin(heading);
    d = 1;
  }
  p.x = from.x + (dx / d) * (reach + EPS);
  p.y = from.y + (dy / d) * (reach + EPS);
}

function separatePair(a: Vec, b: Vec, reach: number, heading: number): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  if (d === 0) {
    dx = Math.cos(heading);
    dy = Math.sin(heading);
    d = 1;
  }
  const push = (reach - Math.hypot(b.x - a.x, b.y - a.y)) / 2 + EPS;
  a.x -= (dx / d) * push;
  a.y -= (dy / d) * push;
  b.x += (dx / d) * push;
  b.y += (dy / d) * push;
}

// Pushes can chain into new overlaps. Relax a few rounds, then fail loud if any overlap is left.
const SEPARATE_ROUNDS = 8;

export function separateAll(world: World, movers: { v: Vehicle; s: VehicleStats }[]): void {
  for (let round = 0; round < SEPARATE_ROUNDS; round++) {
    let moved = false;
    for (const m of movers) {
      for (const o of world.obstacles.filter(isDriveObstacle)) {
        if (dist(m.v.pos, o.pos) < o.r + m.s.radius) {
          pushOut(m.v.pos, o.pos, o.r + m.s.radius, m.v.heading);
          moved = true;
        }
      }
    }
    for (let i = 0; i < movers.length; i++) {
      for (let j = i + 1; j < movers.length; j++) {
        const reach = movers[i].s.radius + movers[j].s.radius;
        if (dist(movers[i].v.pos, movers[j].v.pos) < reach) {
          separatePair(movers[i].v.pos, movers[j].v.pos, reach, movers[i].v.heading);
          moved = true;
        }
      }
    }
    for (const m of movers) clampToMap(world, m);
    if (!moved) return;
  }
  const bad = overlaps(world, movers);
  if (bad.length > 0) throw new Error(`Overlap left after separation: ${bad.join(', ')}`);
}

export function overlaps(world: World, movers: { v: Vehicle; s: VehicleStats }[]): string[] {
  const bad: string[] = [];
  for (const m of movers) {
    for (const o of world.obstacles.filter(isDriveObstacle)) if (dist(m.v.pos, o.pos) < o.r + m.s.radius - EPS) bad.push(`${m.v.id}/${o.id}`);
  }
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      if (dist(movers[i].v.pos, movers[j].v.pos) < movers[i].s.radius + movers[j].s.radius - EPS)
        bad.push(`${movers[i].v.id}/${movers[j].v.id}`);
    }
  }
  return bad;
}

function finishMove(world: World, m: Mover): void {
  const moved = pathLength(m.v.trail);
  m.v.speed = m.stopped ? 0 : Math.max(0, m.steer.speed); // backing up ends at rest
  if (m.v.faction === 'player') world.player.fuel = Math.max(0, world.player.fuel - moved * m.s.fuelPerTile);
  if (reached(m.v.order, m.v.trail, m.v.speed)) world.events.push({ t: 'arrived', vehicle: m.v.id });
  m.v.order = nextOrder(m.v.order, m.v.trail, m.v.speed);
}

function pathLength(trail: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < trail.length; i++) total += dist(trail[i - 1], trail[i]);
  return total;
}

