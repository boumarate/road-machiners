// Activity execution uses the same steering and route planner as the player.
import { NPCS } from "../data/npcs";
import { RULES } from "../data/rules";
import { getActivityDestination, thinkNpc, topGoal } from "./npc-activities";
import { towData } from "./states";
import { vehicleStats } from "./stats";
import { playerTow } from "./tow";
import { ramImpact } from "./crash-contact";
import type { Vehicle, World } from "./types";
import { angleDiff, bearing, dist, type Vec } from "./vec";

export function planNpcOrders(world: World): void {
  for (const v of world.vehicles) {
    if (!v.brain) continue;
    const tpl = NPCS[v.brain.templateId];
    if (!tpl) throw new Error(`Unknown NPC template ${v.brain.templateId}`);
    const b = v.brain;
    delete b.ramTarget;
    if (b.recovery) b.recovery--;
    const activity = thinkNpc(world, v);
    const yielding =
      activity.kind !== "fight" &&
      activity.kind !== "flee" &&
      vehicleAhead(world, v);
    if (
      b.lastPos &&
      !yielding &&
      dist(v.pos, b.lastPos) < RULES.arriveRadius / 2 &&
      v.order &&
      v.order.kind !== "brake"
    )
      b.stalled = (b.stalled ?? 0) + 1;
    else b.stalled = 0;
    b.lastPos = { ...v.pos };
    if (b.stalled >= RULES.npcStuckTurns) {
      b.recovery = RULES.npcRecoveryTurns;
      b.recoveryGoal = {
        x:
          v.pos.x -
          Math.cos(v.heading) * (RULES.reverse.distance + RULES.minAimDistance),
        y:
          v.pos.y -
          Math.sin(v.heading) * (RULES.reverse.distance + RULES.minAimDistance),
      };
      b.stalled = 0;
    }
    let goal = getActivityDestination(world, v, activity);
    if (activity.kind === "fight") {
      const target = world.vehicles.find(
        (other) => other.id === activity.targetId,
      );
      if (!target) throw new Error("Fight activity missing visible target");
      const preferredRange =
        tpl.preferredRange > 0 ? tpl.preferredRange : shortestRange(world, v);
      goal = computeFightGoal(world, v, preferredRange, target);
    }
    v.order =
      vehicleAhead(world, v) || !goal
        ? { kind: "brake" }
        : b.recovery
          ? { kind: "stopAt", dest: b.recoveryGoal! }
          : {
              kind:
                b.ramTarget || activity.kind === "flee"
                  ? "through"
                  : "stopAt",
              dest: goal,
            };
    v.direct = false;
  }
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

// A driver brakes for any moving vehicle close ahead, so two trucks meeting head-on both brake. A parked vehicle
// is routed around instead, unless the two face off. A driver never brakes for the truck it rams.
function vehicleAhead(world: World, v: Vehicle): boolean {
  const others = world.vehicles.filter((x) => x.id !== v.id && x.id !== v.brain?.ramTarget);
  return others.some((x) => {
    if (onOwnRope(world, v, x)) return false;
    const gap = gapAhead(world, v, x);
    if (gap === null) return false;
    if (x.speed >= RULES.parkedSpeed) return gap < brakingReach(world, v, x);
    return v.id < x.id && facesOff(world, v, x, gap);
  });
}

// A tower never yields to the truck on its own rope.
function onOwnRope(world: World, tower: Vehicle, x: Vehicle): boolean {
  const tow = playerTow(world);
  return tow !== null && towData(tow).hitched && tow.holder === tower.id && x.id === world.player.vehicleId;
}

// The gap between v and x past both radii when x lies within 45 degrees of v's heading, else null.
function gapAhead(world: World, v: Vehicle, x: Vehicle): number | null {
  if (Math.abs(angleDiff(v.heading, bearing(v.pos, x.pos))) >= Math.PI / 4) return null;
  return dist(v.pos, x.pos) - vehicleStats(world, v).radius - vehicleStats(world, x).radius;
}

// The gap within which v must brake for moving x. Orders are set once per turn, so v must brake now when both
// could close the gap before next turn's check leaves room to stop: v may speed up this turn and then needs its
// stopping distance. An oncoming x may do the same. An x driving away covers at least its own stopping distance.
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
function wantsToDrive(world: World, x: Vehicle): boolean {
  const top = topGoal(x);
  const dest = top && getActivityDestination(world, x, top);
  return !!dest && dist(x.pos, dest) > RULES.arriveRadius * 2;
}

// NPCs give way unless they fight or flee; the player never does.
function givesWay(x: Vehicle): boolean {
  if (!x.brain) return false;
  const kind = topGoal(x)?.kind;
  return kind !== "fight" && kind !== "flee";
}

// A fighter keeps to its shortest gun range. A fight without a gun is a decision bug, so it throws.
function shortestRange(world: World, v: Vehicle): number {
  const weapons = vehicleStats(world, v).weapons;
  if (weapons.length === 0) throw new Error(`${v.name} is fighting without a gun`);
  return Math.min(...weapons.map((weapon) => weapon.def.range));
}
