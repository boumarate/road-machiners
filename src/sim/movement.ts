// Simultaneous movement of all vehicles in substeps, with collisions.

import { RULES } from '../data/rules';
import { skillBonus } from '../data/skills';
import { burnFuel, getResources } from './resources';
import { laneCount, ramMult, sideToward, walkLane, type PartHit } from './armor';
import { vehicleMass } from './mass';
import { isDriveObstacle } from './mapgen';
import { vehicleStats, type VehicleStats } from './stats';
import { advanceOn, nextOrder, reached, steerWithFuel, type Steer } from './steering';
import { isCliff, tileAt } from './terrain';
import { isTowed } from './tow';
import type { Pose, Vehicle, World } from './types';
import { clamp, dist, type Vec } from './vec';

const EPS = 0.01;

type Mover = { v: Vehicle; s: VehicleStats; steer: Steer; stopped: boolean; prev: Pose };

// The towed player does not drive: its tower places it after this step.
export function resolveMovement(world: World): void {
  const drivers = world.vehicles.filter((v) => !(v.id === world.player.vehicleId && isTowed(world)));
  const movers: Mover[] = drivers.map((v) => {
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
  return steerWithFuel(world, s, v, v.order, v.direct, getResources(world, v).fuel);
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
    applyCrash(world, m.v, null, 'edge', nearestEdge(world, m.v.pos), Math.abs(m.steer.speed));
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
  applyCrash(world, m.v, null, what, from, Math.abs(m.steer.speed));
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
      applyCrash(world, a.v, b.v, b.v.id, b.v.pos, rel);
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

// F4. Every crash, from the physics engine or the 2D rules, lands here. b is the other vehicle, or null for
// obstacles, cliffs and the map edge; what names the thing hit. from is the other body's center, or the
// point of the obstacle or edge, and picks a's struck side. impact is the closing speed in tiles per turn.
export function applyCrash(world: World, a: Vehicle, b: Vehicle | null, what: string, from: Vec, impact: number): void {
  if (!(impact >= 0)) throw new Error(`Bad crash impact ${impact}`);
  // An obstacle counts as infinite mass, so a takes the whole energy.
  const shareA = b ? vehicleMass(b) / (vehicleMass(a) + vehicleMass(b)) : 1;
  const hitsA = crashHits(world, a, from, impact, shareA, b);
  const hitsB = b ? crashHits(world, b, a.pos, impact, 1 - shareA, a) : [];
  if (b) {
    a.lastHitBy = b.id;
    b.lastHitBy = a.id;
  }
  world.events.push({ t: 'collision', a: a.id, b: what, hitsA, hitsB });
}

// The energy spreads evenly over every lane of v's side facing from. A ram on the striker's side facing v
// multiplies both the energy and its penetration. share is the other body's share of both masses.
function crashHits(world: World, v: Vehicle, from: Vec, impact: number, share: number, striker: Vehicle | null): PartHit[] {
  if (impact < RULES.collisionMinImpact) return [];
  const mech = v.faction === 'player' ? skillBonus('mechanics', world.player.skills.mechanics) : 0;
  const mult = striker ? ramMult(striker, sideToward(striker, v.pos)) : 1;
  const energy = RULES.ramDamage * impact * impact * share * mult * Math.max(0, 1 - mech);
  const side = sideToward(v, from);
  const lanes = laneCount(v, side);
  const hits: PartHit[] = [];
  for (let lane = 0; lane < lanes; lane++) hits.push(...walkLane(world, v, side, lane, { damage: energy / lanes, pen: RULES.crashPen * mult }));
  return hits;
}

// The point on the map border closest to p.
export function nearestEdge(world: World, p: Vec): Vec {
  const gaps = [p.x, world.size - p.x, p.y, world.size - p.y];
  const i = gaps.indexOf(Math.min(...gaps));
  return [{ x: 0, y: p.y }, { x: world.size, y: p.y }, { x: p.x, y: 0 }, { x: p.x, y: world.size }][i];
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
  burnFuel(world, m.v, moved);
  if (reached(m.v.order, m.v.trail, m.v.speed)) world.events.push({ t: 'arrived', vehicle: m.v.id });
  m.v.order = nextOrder(m.v.order, m.v.trail, m.v.speed);
}

function pathLength(trail: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < trail.length; i++) total += dist(trail[i - 1], trail[i]);
  return total;
}

