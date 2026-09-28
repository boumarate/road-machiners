// Activity execution uses the same steering and route planner as the player.
import { NPC_BEHAVIOR, NPCS } from "../data/npcs";
import { RULES } from "../data/rules";
import { isKnockedOut } from "./defeat";
import { isNear } from "./far";
import { getActivityDestination, goalHolds, thinkNpc, topGoal } from "./npc-activities";
import { route, routeLength, type Blocker } from "./path";
import { towData } from "./states";
import { parkedVehicles } from "./steering";
import { vehicleStats } from "./stats";
import { escortsOf, followPace, isOnRope, towHeldBy } from "./tow";
import { ramImpact } from "./crash-contact";
import type { MoveOrder, NpcActivity, Vehicle, World } from "./types";
import { angleDiff, bearing, dist, type Vec } from "./vec";
import { canVehicleSee } from "./vision";

// NPC drivers that plan this turn. A truck on a tow rope only trails its tower, so it keeps no order.
// A knocked-out driver keeps its brake order until it wakes.
function planners(world: World): Vehicle[] {
  return world.vehicles.filter((v) => v.brain && !isOnRope(world, v.id) && !isKnockedOut(v));
}

export function planNpcOrders(world: World): void {
  for (const v of planners(world)) {
    const tpl = NPCS[v.brain!.templateId];
    if (!tpl) throw new Error(`Unknown NPC template ${v.brain!.templateId}`);
    const b = v.brain!;
    delete b.ramTarget;
    if (b.recovery) b.recovery--;
    const activity = thinkNpc(world, v);
    const goal = orderPoint(world, v, activity, tpl.preferredRange);
    const stops = goal !== null && trafficStops(world, v, goal);
    noteStall(v, stops && activity.kind !== "fight" && activity.kind !== "flee");
    v.order = nextOrder(world, v, activity, stops ? null : goal);
    v.direct = false;
  }
}

// A driver that barely moved on a move order for RULES.npcStuckTurns turns in a row backs out. Waiting for traffic
// is not being stuck.
function noteStall(v: Vehicle, yielding: boolean): void {
  const b = v.brain!;
  b.stalled = !yielding && barelyMoved(v) ? (b.stalled ?? 0) + 1 : 0;
  b.lastPos = { ...v.pos };
  if (b.stalled >= RULES.npcStuckTurns) startRecovery(v);
}

function barelyMoved(v: Vehicle): boolean {
  const last = v.brain!.lastPos;
  return !!last && !!v.order && v.order.kind !== "brake" && dist(v.pos, last) < RULES.arriveRadius / 2;
}

function startRecovery(v: Vehicle): void {
  const b = v.brain!;
  const back = RULES.reverse.distance + RULES.minAimDistance;
  b.recovery = RULES.npcRecoveryTurns;
  b.recoveryGoal = { x: v.pos.x - Math.cos(v.heading) * back, y: v.pos.y - Math.sin(v.heading) * back };
  b.stalled = 0;
}

// A driver with no point, or one stopped by traffic, brakes, and so does a leader waiting for its escort.
function nextOrder(world: World, v: Vehicle, activity: NpcActivity, goal: Vec | null): MoveOrder {
  if (!goal || waitsForEscort(world, v, activity)) return { kind: "brake" };
  if (v.brain!.recovery) return { kind: "stopAt", dest: v.brain!.recoveryGoal! };
  return driveOrder(world, v, activity, goal);
}

// Where the driver heads. A fighter keeps its range from a target in sight. One that lost sight of its target
// drives to where it last perceived it.
function orderPoint(world: World, v: Vehicle, activity: NpcActivity, templateRange: number): Vec | null {
  if (activity.kind !== "fight") return getActivityDestination(world, v, activity);
  const target = world.vehicles.find((other) => other.id === activity.targetId);
  if (!target) throw new Error("Fight activity missing its target");
  if (!canVehicleSee(world, v, target.pos)) return getActivityDestination(world, v, activity);
  const preferredRange = templateRange > 0 ? templateRange : shortestRange(world, v);
  return computeFightGoal(world, v, preferredRange, target);
}

// A leader out of danger waits while an escort lags more than NPC_BEHAVIOR.escortWaitGap behind, so a slower
// escort keeps up. A fight or a flight does not wait.
function waitsForEscort(world: World, v: Vehicle, activity: NpcActivity): boolean {
  if (activity.kind === "fight" || activity.kind === "flee") return false;
  return escortsOf(world, v.id).some((e) => dist(e.pos, v.pos) > NPC_BEHAVIOR.escortWaitGap);
}

// A rammer drives through its target. A follower drives through its spot at the follow pace while the leader
// moves, so it rides level with the leader instead of braking for a point that runs ahead of it. Any other goal
// stops on its point.
function driveOrder(world: World, v: Vehicle, activity: NpcActivity, dest: Vec): MoveOrder {
  if (v.brain!.ramTarget) return { kind: "through", dest };
  const leader = activity.kind === "follow" ? world.vehicles.find((x) => x.id === activity.targetId) : undefined;
  if (!leader || leader.speed <= RULES.parkedSpeed) return { kind: "stopAt", dest };
  return { kind: "through", dest, pace: followPace(v, leader, dest) };
}

function computeFightGoal(
  world: World,
  v: Vehicle,
  preferredRange: number,
  target: Vehicle,
): Vec {
  const lead = {
    x: target.pos.x + Math.cos(target.heading) * target.speed,
    y: target.pos.y + Math.sin(target.heading) * target.speed,
  };
  if (v.brain!.ramChoice === target.id && ramImpact(world, v, target) !== null) {
    v.brain!.ramTarget = target.id;
    return lead;
  }
  const clearance = vehicleStats(world, v).radius + vehicleStats(world, target).radius + RULES.yieldDistance;
  const range = Math.max(preferredRange, clearance);
  const a = bearing(target.pos, v.pos);
  return { x: target.pos.x + Math.cos(a) * range, y: target.pos.y + Math.sin(a) * range };
}

// A fighter keeps to its shortest gun range. A fight without a gun is a decision bug, so it throws.
function shortestRange(world: World, v: Vehicle): number {
  const weapons = vehicleStats(world, v).weapons;
  if (weapons.length === 0) throw new Error(`${v.name} is fighting without a gun`);
  return Math.min(...weapons.map((weapon) => weapon.def.range));
}

// ---- Traffic: how NPC drivers treat other vehicles. A driver routes around parked vehicles and around the path
// a moving vehicle on a collision course will cover. It stops only when that path blocks its way, or when it
// faces off with a parked NPC.

// What an NPC routes around: parked vehicles, and the swept path of each moving vehicle on a collision course.
// A swerve takes a turn to show, and orders are set once per turn, so drivers route around a moving vehicle one
// turn of closing before it could make them stop. The player routes around parked vehicles only, since the player
// steers for itself.
export function routeBlockers(world: World, v: Vehicle): Blocker[] {
  const parked = parkedVehicles(world, v.id);
  if (!v.brain) return parked;
  return [...parked, ...conflicts(world, v, 1).flatMap((x) => sweptPath(world, v, x))];
}

// Whether v must stop short of `dest` for another vehicle. A moving vehicle stops v only when the route around
// its swept path no longer reaches where the route past parked vehicles alone reaches, or when it is longer by
// more than v drives within its horizon. The swept path clears within that time, so waiting is shorter then.
// A far driver has no body and stops short of any vehicle in its way, so moving vehicles never stop it here.
export function trafficStops(world: World, v: Vehicle, dest: Vec): boolean {
  if (facesParked(world, v)) return true;
  if (!isNear(world, v)) return false;
  const moving = conflicts(world, v, 0);
  if (moving.length === 0) return false;
  const parked = parkedVehicles(world, v.id);
  const radius = vehicleStats(world, v).radius;
  const open = route(world, v.pos, dest, radius, parked, v);
  const around = route(world, v.pos, dest, radius, [...parked, ...moving.flatMap((x) => sweptPath(world, v, x))], v);
  if (dist(open.at(-1)!, around.at(-1)!) > 0) return true;
  const { vs, t } = horizon(world, v);
  return routeLength(v.pos, around) - routeLength(v.pos, open) > vs * t;
}

// Vehicles v yields to: never the truck it rams, nor the truck on its own rope.
function others(world: World, v: Vehicle): Vehicle[] {
  return world.vehicles.filter((x) => x.id !== v.id && x.id !== v.brain?.ramTarget && !onOwnRope(world, v, x));
}

// Moving vehicles close ahead whose path meets v's. leadTurns adds turns of closing at both current speeds to the
// braking reach.
function conflicts(world: World, v: Vehicle, leadTurns: 0 | 1): Vehicle[] {
  return others(world, v).filter((x) => {
    if (x.speed < RULES.parkedSpeed) return false;
    const gap = gapAhead(world, v, x);
    return gap !== null && gap < brakingReach(world, v, x) + leadTurns * (v.speed + x.speed) && pathsMeet(world, v, x);
  });
}

// A parked NPC close ahead that v faces off with. Other parked vehicles are routed around.
function facesParked(world: World, v: Vehicle): boolean {
  return others(world, v).some((x) => {
    if (x.speed >= RULES.parkedSpeed) return false;
    const gap = gapAhead(world, v, x);
    return gap !== null && v.id < x.id && facesOff(world, v, x, gap);
  });
}

// Seconds v looks ahead: the turn until the next check plus v's stopping time. v may speed up this turn, as in
// brakingReach.
function horizon(world: World, v: Vehicle): { vs: number; t: number } {
  const sv = vehicleStats(world, v);
  const vs = Math.min(sv.maxSpeed, v.speed + sv.accel);
  return { vs, t: 1 + vs / sv.brake };
}

// Circles along the line x covers on its heading within v's horizon. They are spaced one radius apart, so
// together they close the strip. A circle is left out when v cannot get there before x does, so a truck driving
// away at v's pace blocks only where it is now. x may speed up this turn, as in brakingReach.
function sweptPath(world: World, v: Vehicle, x: Vehicle): Blocker[] {
  const sx = vehicleStats(world, x);
  const r = sx.radius;
  const radii = vehicleStats(world, v).radius + r;
  const { vs, t } = horizon(world, v);
  const xs = Math.min(sx.maxSpeed, x.speed + sx.accel);
  const reach = xs * t;
  const steps = Math.ceil(reach / r);
  const circles: Blocker[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (reach * i) / steps;
    const pos = { x: x.pos.x + Math.cos(x.heading) * d, y: x.pos.y + Math.sin(x.heading) * d };
    if (i === 0 || dist(v.pos, pos) - radii <= (vs * d) / xs) circles.push({ pos, r });
  }
  return circles;
}

// Whether v and x, both holding their headings, pass closer than both radii plus the yield distance within v's
// horizon. So a truck passing in the next lane or driving off to the side does not concern v.
function pathsMeet(world: World, v: Vehicle, x: Vehicle): boolean {
  const sv = vehicleStats(world, v);
  const sx = vehicleStats(world, x);
  const { vs, t: h } = horizon(world, v);
  const px = x.pos.x - v.pos.x;
  const py = x.pos.y - v.pos.y;
  const rx = Math.cos(x.heading) * x.speed - Math.cos(v.heading) * vs;
  const ry = Math.sin(x.heading) * x.speed - Math.sin(v.heading) * vs;
  const rr = rx * rx + ry * ry;
  const t = rr === 0 ? 0 : Math.min(h, Math.max(0, -(px * rx + py * ry) / rr));
  return Math.hypot(px + rx * t, py + ry * t) < sv.radius + sx.radius + RULES.yieldDistance;
}

function onOwnRope(world: World, tower: Vehicle, x: Vehicle): boolean {
  const tow = towHeldBy(world, tower.id);
  return tow !== null && towData(tow).hitched && tow.other === x.id;
}

// The gap between v and x past both radii when x lies within 45 degrees of v's heading, else null.
function gapAhead(world: World, v: Vehicle, x: Vehicle): number | null {
  if (Math.abs(angleDiff(v.heading, bearing(v.pos, x.pos))) >= Math.PI / 4) return null;
  return dist(v.pos, x.pos) - vehicleStats(world, v).radius - vehicleStats(world, x).radius;
}

// The gap within which moving x concerns v. Orders are set once per turn, so v must act now when both could close
// the gap before next turn's check leaves room to stop: v may speed up this turn and then needs its stopping
// distance. An oncoming x may do the same. An x driving away covers at least its own stopping distance.
function brakingReach(world: World, v: Vehicle, x: Vehicle): number {
  const sv = vehicleStats(world, v);
  const sx = vehicleStats(world, x);
  const vs = Math.min(sv.maxSpeed, v.speed + sv.accel);
  const toward = Math.cos(angleDiff(x.heading, bearing(x.pos, v.pos)));
  const xs = toward > 0 ? Math.min(sx.maxSpeed, x.speed + sx.accel) * toward : x.speed * toward;
  const xTravel = Math.max(0, xs) + (Math.sign(xs) * xs ** 2) / (2 * sx.brake);
  return RULES.yieldDistance + vs + vs ** 2 / (2 * sv.brake) + xTravel;
}

// Two drivers stopped nose to nose that both set off would each go around the other and meet again. Within what
// both close in their first turn of driving, the one whose id sorts first waits, and the other goes around it.
function facesOff(world: World, v: Vehicle, x: Vehicle, gap: number): boolean {
  if (!givesWay(x) || !wantsToDrive(world, x) || gapAhead(world, x, v) === null) return false;
  return gap < RULES.yieldDistance + vehicleStats(world, v).accel + vehicleStats(world, x).accel;
}

// An NPC whose goal lies farther than the reach rule, so it sets off again. A driver parked at its work does not.
// x may not have thought yet this turn, so a goal that no longer holds counts as none.
function wantsToDrive(world: World, x: Vehicle): boolean {
  const top = topGoal(x);
  const dest = top && goalHolds(world, x, top) && getActivityDestination(world, x, top);
  return !!dest && dist(x.pos, dest) > RULES.arriveRadius * 2;
}

// NPCs give way unless they fight or flee; the player never does.
function givesWay(x: Vehicle): boolean {
  if (!x.brain) return false;
  const kind = topGoal(x)?.kind;
  return kind !== "fight" && kind !== "flee";
}
