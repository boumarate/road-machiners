// Activity execution uses the same steering and route planner as the player.
import { NPCS } from "../data/npcs";
import { RULES } from "../data/rules";
import { getActivityDestination, thinkNpc } from "./npc-activities";
import { topGoal } from "./npc-goals";
import { towData } from "./states";
import { vehicleStats } from "./stats";
import { playerTow } from "./tow";
import type { Vehicle, World } from "./types";
import { angleDiff, bearing, dist, type Vec } from "./vec";

const STRAFE_ANGLE = Math.PI / 3;

export function planNpcOrders(world: World): void {
  for (const v of world.vehicles) {
    if (!v.brain) continue;
    const tpl = NPCS[v.brain.templateId];
    if (!tpl) throw new Error(`Unknown NPC template ${v.brain.templateId}`);
    const b = v.brain;
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
      yielding || !goal
        ? { kind: "brake" }
        : b.recovery
          ? { kind: "stopAt", dest: b.recoveryGoal! }
          : {
              kind:
                activity.kind === "fight" || activity.kind === "flee"
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
  const d = dist(v.pos, target.pos);
  const lead = {
    x: target.pos.x + Math.cos(target.heading) * target.speed,
    y: target.pos.y + Math.sin(target.heading) * target.speed,
  };
  if (d > preferredRange) return lead;
  const hasTurret = vehicleStats(world, v).weapons.some(
    (w) => w.def.arc >= 360,
  );
  if (hasTurret) {
    const a = bearing(target.pos, v.pos) + STRAFE_ANGLE;
    return {
      x: target.pos.x + Math.cos(a) * preferredRange,
      y: target.pos.y + Math.sin(a) * preferredRange,
    };
  }
  const a = bearing(v.pos, target.pos);
  const step = RULES.arriveRadius + 0.2;
  return { x: v.pos.x + Math.cos(a) * step, y: v.pos.y + Math.sin(a) * step };
}

// Two NPCs that give way to each other would both wait forever. Only the one whose id sorts first waits.
// Stopped, it counts as parked, so the other one's route goes around it.
function vehicleAhead(world: World, v: Vehicle): boolean {
  const tow = playerTow(world);
  return world.vehicles.some((x) => {
    if (x.id === v.id) return false;
    // A tower never yields to the truck on its own rope.
    if (tow && towData(tow).hitched && tow.holder === v.id && x.id === world.player.vehicleId) return false;
    if (!inTheWay(world, v, x)) return false;
    return !(v.id > x.id && givesWay(x) && inTheWay(world, x, v));
  });
}

// Whether x is close ahead of v, within 45 degrees of its heading.
function inTheWay(world: World, v: Vehicle, x: Vehicle): boolean {
  const gap = dist(v.pos, x.pos) - vehicleStats(world, v).radius - vehicleStats(world, x).radius;
  const off = Math.abs(angleDiff(v.heading, bearing(v.pos, x.pos)));
  return gap < RULES.yieldDistance + v.speed && off < Math.PI / 4;
}

// NPCs give way unless they fight or flee; the player never does.
function givesWay(x: Vehicle): boolean {
  if (!x.brain) return false;
  const kind = topGoal(x)?.kind;
  return kind !== "fight" && kind !== "flee";
}
