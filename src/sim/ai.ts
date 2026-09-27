// Activity execution uses the same steering and route planner as the player.
import { NPCS } from "../data/npcs";
import { RULES } from "../data/rules";
import {
  chooseNpcActivity,
  getActivityDestination,
  setNpcActivity,
} from "./npc-activities";
import { vehicleStats } from "./stats";
import { shouldRam } from './crash-contact';
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
    const activity = chooseNpcActivity(world, v);
    setNpcActivity(world, v, activity, activity.reason);
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
    let goal = getActivityDestination(world, v);
    if (activity.kind === "fight") {
      const target = world.vehicles.find(
        (other) => other.id === activity.targetId,
      );
      if (!target) throw new Error("Fight activity missing visible target");
      const preferredRange =
        tpl.preferredRange > 0
          ? tpl.preferredRange
          : Math.min(
              ...vehicleStats(world, v).weapons.map(
                (weapon) => weapon.def.range,
              ),
            );
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
  if (shouldRam(world, v, target)) {
    v.brain!.ramTarget = target.id;
    return lead;
  }
  const clearance = vehicleStats(world, v).radius + vehicleStats(world, target).radius + RULES.yieldDistance;
  const range = Math.max(preferredRange, clearance);
  const a = bearing(target.pos, v.pos);
  return { x: target.pos.x + Math.cos(a) * range, y: target.pos.y + Math.sin(a) * range };
}

// Two NPCs that give way to each other would both wait forever. Only the one whose id sorts first waits.
// Stopped, it counts as parked, so the other one's route goes around it.
function vehicleAhead(world: World, v: Vehicle): boolean {
  const tow = world.player.tow;
  const others = world.vehicles.filter((x) => x.id !== v.id && x.id !== v.brain?.ramTarget);
  return others.some((x) => {
    // A tower never yields to the truck on its own rope.
    if (tow?.hitched && tow.by === v.id && x.id === world.player.vehicleId)
      return false;
    if (!inTheWay(world, v, x)) return false;
    return !(v.id > x.id && givesWay(x) && inTheWay(world, x, v));
  });
}

// Whether x is close ahead of v, within 45 degrees of its heading.
function inTheWay(world: World, v: Vehicle, x: Vehicle): boolean {
  const gap =
    dist(v.pos, x.pos) -
    vehicleStats(world, v).radius -
    vehicleStats(world, x).radius;
  const off = Math.abs(angleDiff(v.heading, bearing(v.pos, x.pos)));
  return gap < RULES.yieldDistance + v.speed && off < Math.PI / 4;
}

// NPCs give way unless they fight or flee; the player never does.
function givesWay(x: Vehicle): boolean {
  const kind = x.brain?.activity?.kind;
  return Boolean(x.brain) && kind !== "fight" && kind !== "flee";
}
