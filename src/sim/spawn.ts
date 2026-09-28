// NPC spawning up to per-template caps. Raiders appear at their camp gates, neutrals at the gates of any
// town or other location.

import { NPCS, SPAWN, type NpcTemplate, type TraitId } from "../data/npcs";
import { chassisDef } from "../data/chassis";
import { REGION } from "../data/region";
import { playerVehicle } from "./damage";
import { makeVehicle } from "./factory";
import { isDriveObstacle } from "./mapgen";
import { generateNpcLoadout, type NpcLoadout } from "./npc-loadout";
import { profileOf } from "./npc-decisions";
import { chance, randInt, randRange, type Rng } from "./rng";
import { siteGates, type Site } from "./sites";
import type { Vehicle, World } from "./types";
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
    if (alive < tpl.cap) spawnOne(world, tpl, true);
  }
}

export function spawnInitial(world: World): void {
  for (const id of SPAWN.initial) spawnOne(world, NPCS[id], false);
}

// Returns false when no free spot was found this time; the next interval tries again.
// The template's base traits plus each extra that wins its roll.
export function rollTraits(world: Rng, tpl: NpcTemplate): TraitId[] {
  return [...tpl.traits, ...tpl.extraTraits.filter((extra) => chance(world, extra.chance)).map((extra) => extra.trait)];
}

// A respawn keeps SPAWN.minPlayerDist from the player. Initial spawns do not.
function spawnOne(world: World, tpl: NpcTemplate, respawn: boolean): boolean {
  const loadout = generateNpcLoadout(world, tpl);
  const radius = chassisDef(loadout.chassisId).radius;
  for (let i = 0; i < SPAWN.tries; i++) {
    const site = tpl.spawn === "camp" ? campOf(world, tpl) : NEUTRAL_SITES[randInt(world, 0, NEUTRAL_SITES.length - 1)];
    const pos = gateSpot(world, site, radius);
    if (respawn && dist(pos, playerVehicle(world).pos) < SPAWN.minPlayerDist) continue;
    if (!isFree(world, pos, radius, null)) continue;
    spawnAt(world, tpl, loadout, pos);
    return true;
  }
  world.events.push({ t: "info", text: `No free spot to spawn ${tpl.name}` });
  return false;
}

// Adds a template's vehicle with a sampled loadout at pos. The caller checks that pos is free.
export function spawnAt(world: World, tpl: NpcTemplate, loadout: NpcLoadout, pos: Vec): Vehicle {
  const v = makeVehicle(world, {
    name: tpl.name,
    faction: tpl.faction,
    ...loadout,
    pos,
    heading: randRange(world, -Math.PI, Math.PI),
    brain: {
      templateId: tpl.id,
      traits: rollTraits(world, tpl),
      goals: [],
      noticed: {},
      hurt: 0,
      attackers: {},
      goal: null,
      home: { ...pos },
      stepIndex: 0,
    },
  });
  world.vehicles.push(v);
  world.events.push({ t: "spawn", vehicle: v.id });
  return v;
}

const NEUTRAL_SITES: readonly Site[] = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== "camp")];

// A random camp among the template's bases.
function campOf(world: World, tpl: NpcTemplate): Site {
  const bases = profileOf(tpl.traits).bases;
  if (bases.length === 0) throw new Error(`${tpl.id} spawns at a camp but its traits know none`);
  const id = bases[randInt(world, 0, bases.length - 1)];
  const camp = REGION.locations.find((l) => l.id === id);
  if (!camp) throw new Error(`Unknown camp ${id}`);
  return camp;
}

// A point on the track just outside a random gate of the site.
function gateSpot(world: World, site: Site, radius: number): Vec {
  const gates = siteGates(site);
  const gate = gates[randInt(world, 0, gates.length - 1)];
  const a = Math.atan2(gate.y - site.pos.y, gate.x - site.pos.x) + randRange(world, -SPAWN.gateAngle, SPAWN.gateAngle);
  const d = radius + 0.3 + randRange(world, 0, SPAWN.gateSpread);
  return { x: gate.x + Math.cos(a) * d, y: gate.y + Math.sin(a) * d };
}

// Whether a vehicle of radius fits at pos, on the map and clear of obstacles and other vehicles.
// ignoreId names a vehicle left out of the check, like the one being moved.
export function isFree(world: World, pos: Vec, radius: number, ignoreId: string | null): boolean {
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
    (v) => v.id === ignoreId || dist(v.pos, pos) >= chassisDef(v.chassisId).radius + radius + margin,
  );
}
