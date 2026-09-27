// NPC spawning up to per-template caps. Raiders appear at their camp gates, neutrals at towns.

import { NPC_CLASSES, NPCS, SPAWN, type NpcTemplate } from "../data/npcs";
import { chassisDef } from "../data/chassis";
import { REGION } from "../data/region";
import { playerVehicle } from "./damage";
import { makeVehicle } from "./factory";
import { isDriveObstacle } from "./mapgen";
import { generateNpcLoadout } from "./npc-loadout";
import { randInt, randRange } from "./rng";
import { siteGates } from "./sites";
import type { World } from "./types";
import { dist, type Vec } from "./vec";

export function spawnNpcs(world: World): void {
  for (const tpl of Object.values(NPCS)) {
    const left = (world.spawnTimer[tpl.id] ?? tpl.interval) - 1;
    world.spawnTimer[tpl.id] = left;
    if (left > 0) continue;
    world.spawnTimer[tpl.id] = tpl.interval;
    const alive = world.vehicles.filter(
      (v) => v.brain?.templateId === tpl.id,
    ).length;
    if (alive < tpl.cap) spawnOne(world, tpl);
  }
}

export function spawnInitial(world: World): void {
  for (const id of SPAWN.initial) spawnOne(world, NPCS[id]);
}

// Returns false when no free spot was found this time; the next interval tries again.
function spawnOne(world: World, tpl: NpcTemplate): boolean {
  const loadout = generateNpcLoadout(world, tpl);
  const radius = chassisDef(loadout.chassisId).radius;
  for (let i = 0; i < SPAWN.tries; i++) {
    const pos =
      tpl.spawn === "camp" ? campSpot(world, tpl, radius) : townSpot(world, radius);
    if (!pos || !isFree(world, pos, radius)) continue;
    const v = makeVehicle(world, {
      name: tpl.name,
      faction: tpl.faction,
      ...loadout,
      pos,
      heading: randRange(world, -Math.PI, Math.PI),
      brain: {
        templateId: tpl.id,
        activity: null,
        goal: null,
        home: { ...pos },
        stepIndex: 0,
        refusedTow: false,
      },
    });
    world.vehicles.push(v);
    world.events.push({ t: "spawn", vehicle: v.id });
    return true;
  }
  world.events.push({ t: "info", text: `No free spot to spawn ${tpl.name}` });
  return false;
}

// A point on the track just outside a random gate of one of the template's camps.
function campSpot(world: World, tpl: NpcTemplate, radius: number): Vec | null {
  const bases = NPC_CLASSES[tpl.brain].bases;
  if (bases.length === 0) throw new Error(`${tpl.id} spawns at a camp but its class has none`);
  const id = bases[randInt(world, 0, bases.length - 1)];
  const camp = REGION.locations.find((l) => l.id === id);
  if (!camp) throw new Error(`Unknown camp ${id}`);
  const gates = siteGates(camp);
  const gate = gates[randInt(world, 0, gates.length - 1)];
  const a = Math.atan2(gate.y - camp.pos.y, gate.x - camp.pos.x) + randRange(world, -SPAWN.campAngle, SPAWN.campAngle);
  const d = radius + 0.3 + randRange(world, 0, SPAWN.campSpread);
  const pos = { x: gate.x + Math.cos(a) * d, y: gate.y + Math.sin(a) * d };
  if (dist(pos, playerVehicle(world).pos) < SPAWN.campMinPlayerDist) return null;
  return pos;
}

function townSpot(world: World, radius: number): Vec {
  const town = REGION.towns[randInt(world, 0, REGION.towns.length - 1)];
  const a = randRange(world, -Math.PI, Math.PI);
  const d = town.radius + radius + 0.3 + randRange(world, 0, SPAWN.townSpread);
  return { x: town.pos.x + Math.cos(a) * d, y: town.pos.y + Math.sin(a) * d };
}

function isFree(world: World, pos: Vec, radius: number): boolean {
  if (
    pos.x < radius ||
    pos.y < radius ||
    pos.x > world.size - radius ||
    pos.y > world.size - radius
  )
    return false;
  const margin = 0.3;
  if (
    world.obstacles
      .filter(isDriveObstacle)
      .some((o) => dist(o.pos, pos) < o.r + radius + margin)
  )
    return false;
  return world.vehicles.every(
    (v) => dist(v.pos, pos) >= chassisDef(v.chassisId).radius + radius + margin,
  );
}
