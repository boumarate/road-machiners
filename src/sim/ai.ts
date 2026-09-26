// NPC destinations. NPCs obey the same steering limits and route planner as the player.
// Route planning is a per-turn roll, so a chased raider can be led into rocks.

import { NPCS, SPAWN, type NpcTemplate } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { isHostile } from './combat';
import { chance, randRange } from './rng';
import { vehicleStats } from './stats';
import type { Vehicle, World } from './types';
import { angleDiff, bearing, dist, type Vec } from './vec';

const STRAFE_ANGLE = Math.PI / 3;

export function planNpcOrders(world: World): void {
  for (const v of world.vehicles) {
    if (!v.brain) continue;
    const tpl = NPCS[v.brain.templateId];
    if (!tpl) throw new Error(`Unknown NPC template ${v.brain.templateId}`);
    const chasing = tpl.brain === 'raider' ? nearestHostile(world, v, tpl.aggroRange) : null;
    const goal = chasing ? fightGoal(world, v, tpl, chasing) : tpl.brain === 'raider' ? patrolGoal(world, v) : travelGoal(world, v, tpl);
    v.order = tpl.brain !== 'raider' && vehicleAhead(world, v) ? { kind: 'brake' } : { kind: 'through', dest: goal };
    // A careless driver skips route planning this turn and drives straight, maybe into a rock.
    v.direct = !chance(world, tpl.avoidChance);
  }
}

function fightGoal(world: World, v: Vehicle, tpl: NpcTemplate, target: Vehicle): Vec {
  const d = dist(v.pos, target.pos);
  const lead = { x: target.pos.x + Math.cos(target.heading) * target.speed, y: target.pos.y + Math.sin(target.heading) * target.speed };
  if (d > tpl.preferredRange) return lead;
  // Inside preferred range: a turret circles the target, a forward gun turns to face it.
  const hasTurret = vehicleStats(world, v).weapons.some((w) => w.def.arc >= 360);
  if (hasTurret) {
    const a = bearing(target.pos, v.pos) + STRAFE_ANGLE;
    return { x: target.pos.x + Math.cos(a) * tpl.preferredRange, y: target.pos.y + Math.sin(a) * tpl.preferredRange };
  }
  const a = bearing(v.pos, target.pos);
  const step = RULES.arriveRadius + 0.2;
  return { x: v.pos.x + Math.cos(a) * step, y: v.pos.y + Math.sin(a) * step };
}

function nearestHostile(world: World, v: Vehicle, range: number): Vehicle | null {
  let best: Vehicle | null = null;
  for (const x of world.vehicles) {
    if (!isHostile(v, x)) continue;
    const grudge = v.grudges.includes(x.id);
    if (!grudge && dist(v.pos, x.pos) > range) continue;
    if (!best || dist(v.pos, x.pos) < dist(v.pos, best.pos)) best = x;
  }
  return best;
}

function patrolGoal(world: World, v: Vehicle): Vec {
  const b = v.brain!;
  if (!b.goal || dist(v.pos, b.goal) < RULES.arriveRadius * 2) {
    const r = SPAWN.wanderRadius;
    b.goal = { x: b.home.x + randRange(world, -r, r), y: b.home.y + randRange(world, -r, r) };
    b.goal.x = Math.min(world.size - 2, Math.max(2, b.goal.x));
    b.goal.y = Math.min(world.size - 2, Math.max(2, b.goal.y));
  }
  return b.goal;
}

// Traders shuttle between towns along the main road. Scavengers tour towns and locations.
// A neutral with a grudge fights back with auto fire but keeps driving its route.
function travelGoal(world: World, v: Vehicle, tpl: NpcTemplate): Vec {
  const route = tpl.brain === 'trader' ? traderRoute() : scavengerRoute();
  const b = v.brain!;
  const wp = route[b.stepIndex % route.length];
  if (dist(v.pos, wp) < RULES.arriveRadius * 4) b.stepIndex = (b.stepIndex + 1) % route.length;
  return route[b.stepIndex % route.length];
}

function traderRoute(): Vec[] {
  const road = REGION.roads[0];
  return [...road, ...road.slice(1, -1).reverse()];
}

function scavengerRoute(): Vec[] {
  const at = (id: string) => [...REGION.towns, ...REGION.locations].find((s) => s.id === id)!.pos;
  return [at('tin'), at('convoy'), at('salt'), at('oasis')];
}

// Neutral drivers brake for a vehicle close in front of them instead of pushing into it.
function vehicleAhead(world: World, v: Vehicle): boolean {
  const r = vehicleStats(world, v).radius;
  return world.vehicles.some((x) => {
    if (x.id === v.id) return false;
    const gap = dist(v.pos, x.pos) - r - vehicleStats(world, x).radius;
    const off = Math.abs(angleDiff(v.heading, bearing(v.pos, x.pos)));
    return gap < RULES.yieldDistance + v.speed && off < Math.PI / 4;
  });
}
