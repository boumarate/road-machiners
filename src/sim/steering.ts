// Steering controller: picks this turn's speed and turn toward a destination,
// within the vehicle's acceleration, braking and turn limits.

import { RULES } from "../data/rules";
import { TERRAIN } from "../data/terrain";
import { maxTurn, type VehicleStats } from "./stats";
import { chassisDef } from "../data/chassis";
import { route, routeLength, straightClear, type Blocker } from "./path";
import { driveFactor, isCliff, tileAt, type Terrain } from "./terrain";
import type { MoveOrder, Pose, Vehicle, World } from "./types";
import {
  angleDiff,
  bearing,
  clamp,
  DEG,
  dist,
  segmentDist,
  type Vec,
} from "./vec";

export type Steer = { speed: number; turn: number };
export type TurnPlan = { poses: Pose[]; end: Pose; arrives: boolean };

// aim is the next point to drive at. remaining is the route length left to the destination.
// Each turn tries two ways to steer and keeps the arc within maxBulge of the straight line to aim.
// Route lines keep clearance from obstacles, so staying near the line keeps the truck clear.
// 1. Pursuit: the circular arc through aim, as fast as allowed.
// 2. Hard turn: turn toward aim as far as the limit allows, at whatever speed still fits.
// Pursuit wins if it can go at least crawl speed.
export function steerStep(
  s: VehicleStats,
  v: Pick<Vehicle, "pos" | "heading" | "speed">,
  aim: Vec | null,
  remaining: number,
): Steer {
  const lo = Math.max(0, v.speed - s.brake);
  const hi = Math.min(s.maxSpeed, v.speed + s.accel);
  if (!aim) return { speed: Math.min(lo, hi), turn: 0 };

  const top = Math.max(lo, Math.min(hi, stopLimitedSpeed(s, remaining)));
  const pursuit = (speed: number) => pursuitTurn(s, v, aim, speed);
  const hard = (speed: number) => hardTurn(s, v, aim, speed);
  const p = fastestFitting(v, aim, lo, top, pursuit);
  if (p >= Math.min(RULES.crawlSpeed, top))
    return { speed: p, turn: pursuit(p) };
  const h = fastestFitting(v, aim, lo, top, hard);
  return { speed: h, turn: hard(h) };
}

// Binary search for the fastest speed in [lo, top] whose arc fits; lo when none does.
function fastestFitting(
  v: Pick<Vehicle, "pos" | "heading">,
  aim: Vec,
  lo: number,
  top: number,
  turn: (speed: number) => number,
): number {
  const fits = (speed: number) =>
    deviation(v, aim, speed, turn(speed)) <= RULES.maxBulge;
  if (fits(top)) return top;
  if (!fits(lo)) return lo;
  let a = lo;
  let b = top;
  for (let i = 0; i < 20; i++) {
    const mid = (a + b) / 2;
    if (fits(mid)) a = mid;
    else b = mid;
  }
  return a;
}

// The circular arc through aim has curvature 2 sin(a) / d.
function pursuitTurn(
  s: VehicleStats,
  v: Pick<Vehicle, "pos" | "heading">,
  aim: Vec,
  speed: number,
): number {
  const lim = maxTurn(s, speed);
  const ang = angleDiff(v.heading, bearing(v.pos, aim));
  if (Math.abs(ang) >= Math.PI / 2) return clamp(ang, -lim, lim);
  const d = Math.max(dist(v.pos, aim), 1e-6);
  return clamp((2 * Math.sin(ang) * speed) / d, -lim, lim);
}

function hardTurn(
  s: VehicleStats,
  v: Pick<Vehicle, "pos" | "heading">,
  aim: Vec,
  speed: number,
): number {
  const lim = maxTurn(s, speed);
  return clamp(angleDiff(v.heading, bearing(v.pos, aim)), -lim, lim);
}

// Largest distance of this turn's arc from the segment toward aim.
function deviation(
  v: Pick<Vehicle, "pos" | "heading">,
  aim: Vec,
  speed: number,
  turn: number,
): number {
  let pose: Pose = { x: v.pos.x, y: v.pos.y, heading: v.heading };
  let worst = 0;
  for (let i = 0; i < DEVIATION_SAMPLES; i++) {
    pose = advance(pose, { speed, turn }, DEVIATION_SAMPLES);
    worst = Math.max(worst, segmentDist(pose, v.pos, aim));
  }
  return worst;
}

const DEVIATION_SAMPLES = 8;

// Largest speed that can still brake to a stop within distance d.
function stopLimitedSpeed(s: VehicleStats, d: number): number {
  let lo = 0;
  let hi = s.maxSpeed;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (stopDistance(mid, s.brake) <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

function stopDistance(v: number, brake: number): number {
  let total = 0;
  for (let x = v; x > 0; x -= brake) total += x;
  return total;
}

// One substep along an arc over terrain: the slice length scales with the ground's drive factor.
// Negative speed backs up; the ground is read in the direction of travel.
export function advanceOn(
  t: Terrain,
  p: Pose,
  steer: Steer,
  steps: number,
): Pose {
  const travel = steer.speed < 0 ? p.heading + Math.PI : p.heading;
  return advance(
    p,
    { speed: steer.speed * driveFactor(t, p, travel), turn: steer.turn },
    steps,
  );
}

// One substep along an arc: turn a slice, then move a slice.
export function advance(p: Pose, steer: Steer, steps: number): Pose {
  const heading = p.heading + steer.turn / steps;
  const mid = p.heading + steer.turn / steps / 2;
  const len = steer.speed / steps;
  return {
    x: p.x + Math.cos(mid) * len,
    y: p.y + Math.sin(mid) * len,
    heading,
  };
}

// Steering for a move order. The driver aims straight at the point when the line there is clear;
// otherwise it follows a route around obstacles and cliffs. Direct drivers always aim straight.
// Parked vehicles count as obstacles; moving ones do not.
// Without an order the vehicle coasts: same speed, same heading, capped by its current max speed.
export function steerTo(
  world: World,
  s: VehicleStats,
  v: Pick<Vehicle, "id" | "pos" | "heading" | "speed">,
  order: MoveOrder | null,
  direct: boolean,
): Steer {
  if (!order)
    return {
      speed: Math.max(Math.min(v.speed, s.maxSpeed), v.speed - s.brake),
      turn: 0,
    };
  if (order.kind === "brake") return steerStep(s, v, null, 0);
  const parked = parkedVehicles(world, v.id);
  const back = reverseStep(world, s, v, order, direct, parked);
  if (back) return back;
  if (order.kind === "through") {
    // Follow the player's curve unless this turn's arc would hit something; only then detour.
    const straight = momentumStep(s, v, order.dest, dist(v.pos, order.dest));
    if (direct || arcClear(world, v, straight, s.radius, parked))
      return straight;
    // A detour drives carefully: it slows as much as needed to hold the route line past the obstacle.
    return steerStep(
      s,
      v,
      aimPoint(v.pos, route(world, v.pos, order.dest, s.radius, parked)),
      Infinity,
    );
  }
  const clear =
    direct || straightClear(world, v.pos, order.dest, s.radius, parked);
  const points = clear
    ? [order.dest]
    : route(world, v.pos, order.dest, s.radius, parked);
  const aim = aimPoint(v.pos, points);
  // Careful driving: slow for corners as if stopping a little past them, so the arc does not swing into the obstacle.
  const total = routeLength(v.pos, points);
  const remaining =
    points.length > 1
      ? Math.min(total, dist(v.pos, aim) + RULES.cornerSlack)
      : total;
  return steerStep(s, v, aim, remaining);
}

// A nearly stopped truck backs toward a point behind it. For a point ahead, it backs on an arc
// that swings its nose toward the route's next point. It only backs when the way back is clear.
function reverseStep(
  world: World,
  s: VehicleStats,
  v: Pick<Vehicle, "pos" | "heading" | "speed">,
  order: Exclude<MoveOrder, { kind: "brake" }>,
  direct: boolean,
  parked: Blocker[],
): Steer | null {
  if (v.speed > RULES.reverse.below) return null;
  const distance = dist(v.pos, order.dest);
  if (
    distance === 0 ||
    (order.kind === "through" && zoneSpeed(s, v.speed, distance) === 0)
  )
    return null;
  const clear =
    direct || straightClear(world, v.pos, order.dest, s.radius, parked);
  const aim = clear
    ? order.dest
    : aimPoint(v.pos, route(world, v.pos, order.dest, s.radius, parked));
  const ang = angleDiff(v.heading, bearing(v.pos, aim));
  if (Math.abs(ang) <= RULES.reverse.angle * DEG) return null;
  const behind =
    Math.abs(angleDiff(v.heading, bearing(v.pos, order.dest))) > Math.PI / 2;
  const turn = behind
    ? angleDiff(v.heading + Math.PI, bearing(v.pos, order.dest))
    : ang;
  const back = {
    speed: -Math.min(
      RULES.reverse.distance,
      distance,
      zoneSpeed(s, 0, distance),
    ),
    turn: clamp(turn, -s.reverseTurn, s.reverseTurn),
  };
  return arcClear(world, v, back, s.radius, parked) ? back : null;
}

// Whether one turn along this steer would really collide: the same contact rules movement uses,
// without the route planner's safety margin.
function arcClear(
  world: World,
  v: Pick<Vehicle, "pos" | "heading">,
  steer: Steer,
  radius: number,
  parked: Blocker[],
): boolean {
  const t = world.terrain;
  const circles = [...world.obstacles, ...parked];
  let pose: Pose = { x: v.pos.x, y: v.pos.y, heading: v.heading };
  for (let i = 0; i < RULES.substeps; i++) {
    const next = advanceOn(t, pose, steer, RULES.substeps);
    if (circles.some((o) => dist(next, o.pos) < o.r + radius)) return false;
    if (isCliff(t, tileAt(t, next)) && !isCliff(t, tileAt(t, pose)))
      return false;
    pose = next;
  }
  return true;
}

// The first route point far enough ahead to steer by. Grid waypoints right beside the truck
// can sit off to the side and would turn it the wrong way.
function aimPoint(from: Vec, points: Vec[]): Vec {
  return (
    points.find((p) => dist(from, p) >= RULES.minAimDistance) ??
    points[points.length - 1]
  );
}

export type Throttle = "brake" | "hold" | "accelerate";
export type ZoneEdges = {
  brakeEnd: number;
  holdEnd: number;
  restBrakeEnd: number;
  reach: number;
}; // distances from the truck, in tiles

export function zoneEdges(): ZoneEdges {
  const Z = RULES.throttleZones;
  if (Math.abs(Z.brake + Z.hold + Z.accelerate - 1) > 1e-9)
    throw new Error("Throttle zone shares must add up to 1");
  const reach = TERRAIN.vision.radius * Z.reach;
  return {
    brakeEnd: reach * Z.brake,
    holdEnd: reach * (Z.brake + Z.hold),
    restBrakeEnd: reach / 3,
    reach,
  };
}

// At rest the red zone covers one third of reach and the green zone covers the rest.
export function throttleFor(d: number, speed: number): Throttle {
  const z = zoneEdges();
  if (speed === 0) return d < z.restBrakeEnd ? "brake" : "accelerate";
  if (d < z.brakeEnd) return "brake";
  if (d < z.holdEnd) return "hold";
  return "accelerate";
}

// Next turn's speed for a drive-through click at distance d. From rest, speed grows with distance.
// In motion, brake eases toward its edge and acceleration builds from the hold zone to full reach.
export function zoneSpeed(s: VehicleStats, speed: number, d: number): number {
  const z = zoneEdges();
  if (speed === 0)
    return Math.min(s.maxSpeed, s.accel * Math.min(1, d / z.reach));
  let next = speed;
  if (d < z.brakeEnd) next = speed - s.brake * (1 - d / z.brakeEnd);
  else if (d >= z.holdEnd)
    next =
      speed + s.accel * Math.min(1, (d - z.holdEnd) / (z.reach - z.holdEnd));
  return clamp(
    next,
    0,
    Math.max(0, Math.min(s.maxSpeed, Math.max(speed, next))),
  );
}

// The order for a map click. Shift stops at the point. Above a small speed, a click in the brake zone
// means stop: the truck brakes hard until it stands.
export function clickOrder(
  v: Pick<Vehicle, "pos" | "speed">,
  dest: Vec,
  shift: boolean,
): MoveOrder {
  if (shift) return { kind: "stopAt", dest };
  if (
    v.speed > RULES.stopClickSpeed &&
    throttleFor(dist(v.pos, dest), v.speed) === "brake"
  )
    return { kind: "brake" };
  return { kind: "through", dest };
}

// Momentum driving. The click's distance picks the throttle zone; see zoneSpeed.
// Turning bends the path as far as the turn limit allows at that speed, without slowing down.
export function momentumStep(
  s: VehicleStats,
  v: Pick<Vehicle, "pos" | "heading" | "speed">,
  aim: Vec,
  clickDist: number,
): Steer {
  const speed = zoneSpeed(s, v.speed, clickDist);
  return { speed, turn: pursuitTurn(s, v, aim, speed) };
}

// Whether this turn's trail reached the order's point. A drive-through point also counts once it is
// behind the truck or nearer than a fraction of a turn's travel, so a near miss never makes the
// truck brake back for it.
export function reached(
  order: MoveOrder | null,
  trail: Pose[],
  speed: number,
): boolean {
  if (!order || order.kind === "brake") return false;
  const end = trail[trail.length - 1];
  if (order.kind === "stopAt")
    return dist(end, order.dest) < RULES.arriveRadius;
  if (trail.some((p) => dist(p, order.dest) < RULES.passRadius)) return true;
  if (speed <= 0) return false; // a truck at rest or backing up has not driven past anything
  const behind =
    Math.abs(angleDiff(end.heading, bearing(end, order.dest))) > Math.PI / 2;
  return behind || dist(end, order.dest) < speed * RULES.passSpeedShare;
}

// The order for next turn. A reached stop point turns into braking, so momentum does not carry
// the truck past it. Braking ends at rest. A passed drive-through point leaves the truck coasting.
export function nextOrder(
  order: MoveOrder | null,
  trail: Pose[],
  speed: number,
): MoveOrder | null {
  if (!order) return null;
  if (order.kind === "brake") return speed === 0 ? null : order;
  // Slopes stretch or shrink the brake plan; stopped close to the point counts as arrived.
  if (
    order.kind === "stopAt" &&
    speed === 0 &&
    dist(trail[trail.length - 1], order.dest) < RULES.passRadius
  )
    return null;
  if (!reached(order, trail, speed)) return order;
  return order.kind === "stopAt" && speed > 0 ? { kind: "brake" } : null;
}

function parkedVehicles(world: World, selfId: string): Blocker[] {
  return world.vehicles
    .filter((x) => x.id !== selfId && x.speed < RULES.parkedSpeed)
    .map((x) => ({ pos: x.pos, r: chassisDef(x.chassisId).radius }));
}

// Ghost run of the controller for the path preview. Ignores vehicles and collisions.
// After a drive-through point the ghost coasts on, so the preview shows where momentum carries the truck.
export function planPath(
  world: World,
  s: VehicleStats,
  v: Pick<Vehicle, "id" | "pos" | "heading" | "speed">,
  order: MoveOrder | null,
  turns: number,
): TurnPlan[] {
  const plans: TurnPlan[] = [];
  let state = {
    id: v.id,
    pos: { ...v.pos },
    heading: v.heading,
    speed: v.speed,
  };
  let current: MoveOrder | null = order;
  for (let t = 0; t < turns; t++) {
    const steer = steerTo(world, s, state, current, false);
    let pose: Pose = { x: state.pos.x, y: state.pos.y, heading: state.heading };
    const poses: Pose[] = [pose];
    for (let i = 0; i < RULES.substeps; i++) {
      pose = advanceOn(world.terrain, pose, steer, RULES.substeps);
      poses.push(pose);
    }
    plans.push({
      poses,
      end: pose,
      arrives: reached(current, poses, steer.speed),
    });
    current = nextOrder(current, poses, steer.speed);
    if (steer.speed === 0 && current === null) break;
    state = {
      id: v.id,
      pos: { x: pose.x, y: pose.y },
      heading: pose.heading,
      speed: Math.max(0, steer.speed),
    };
  }
  return plans;
}
