// World creation and the turn pipeline. No rendering or physics imports: this runs in Node tests.
// Public functions take a world and return a new one. Inside, a cloned draft is mutated.

import { REGION } from "../data/region";
import { RULES } from "../data/rules";
import type { StartKit } from "../data/start";
import { findPart, playerVehicle } from "./damage";
import { makePart, makeVehicle } from "./factory";
import { generateObstacles } from "./mapgen";
import { buildTerrain } from "./terrain";
import { planNpcOrders } from "./ai";
import {
  assignAutoOrders,
  fireWeapons,
  isHostile,
  resolveDestroyed,
} from "./combat";
import { checkDefeat } from "./defeat";
import { discoverSites, useOasis } from "./locations";
import { resolveMovement } from "./movement";
import { consumeSupplies, leakFuel } from "./supplies";
import { spawnInitial, spawnNpcs } from "./spawn";
import { initializeSalvage } from "./salvage";
import { resolveNpcActivities } from "./npc-activities";
import type { MoveOrder, Vehicle, WeaponOrder, World } from "./types";
import { vehicleStats } from "./stats";
import { playerSees, refreshVision } from "./vision";
import { clamp, dist, type Vec } from "./vec";

export function newWorld(seed: number, kit: StartKit): World {
  if (!Number.isInteger(seed))
    throw new Error(`Seed must be an integer, got ${seed}`);
  const world: World = {
    seed,
    rngState: seed,
    turn: 1,
    size: REGION.size,
    nextId: 0,
    vehicles: [],
    obstacles: [],
    salvage: [],
    terrain: buildTerrain(seed, REGION.size),
    player: {
      vehicleId: "",
      money: kit.money,
      xp: 0,
      level: 1,
      skillPoints: RULES.startSkillPoints,
      skills: { driving: 0, gunnery: 0, mechanics: 0, trade: 0, survival: 0 },
      health: RULES.maxHealth,
      fuel: kit.fuel,
      supplies: kit.supplies,
      autoFire: false,
      discovered: [REGION.playerStart.town],
      scavenged: [],
      storage: [],
      costBasis: { ...kit.costBasis },
      knockouts: 0,
      explored: new Array(REGION.size * REGION.size).fill(false),
      visible: [],
    },
    events: [],
    removed: [],
    spawnTimer: {},
  };
  world.obstacles = generateObstacles(world);
  const town = REGION.towns.find((t) => t.id === REGION.playerStart.town)!;
  const truck = makeVehicle(world, {
    name: kit.name,
    faction: "player",
    chassisId: kit.chassis,
    parts: kit.parts,
    cargo: kit.cargo,
    pos: {
      x: town.pos.x + REGION.playerStart.offset.x,
      y: town.pos.y + REGION.playerStart.offset.y,
    },
    heading: -Math.PI / 4,
    brain: null,
  });
  const blocked = world.obstacles.filter(
    (o) => dist(o.pos, truck.pos) < o.r + vehicleStats(world, truck).radius,
  );
  if (blocked.length > 0)
    throw new Error(
      `Player start overlaps ${blocked.map((o) => o.id).join(", ")}`,
    );
  world.vehicles.push(truck);
  world.player.vehicleId = truck.id;
  initializeSalvage(world);
  world.player.storage = kit.storage.map((defId) => makePart(world, defId));
  spawnInitial(world);
  refreshVision(world);
  world.events = [];
  return world;
}

// Clone, apply, return. Every command and the turn go through this.
export function update(world: World, fn: (draft: World) => void): World {
  const draft = structuredClone(world);
  draft.events = [];
  draft.removed = [];
  fn(draft);
  return draft;
}

export function setMoveOrder(world: World, order: MoveOrder | null): World {
  return update(world, (w) => {
    playerVehicle(w).order =
      order && order.kind !== "brake"
        ? {
            kind: order.kind,
            dest: {
              x: clamp(order.dest.x, 0, w.size),
              y: clamp(order.dest.y, 0, w.size),
            },
          }
        : order;
  });
}

// move resolves this turn's driving on the draft: the 2D rules, or the physics engine.
export function endTurn(
  world: World,
  move: (w: World) => void = resolveMovement,
): World {
  return update(world, (w) => {
    w.turn++;
    planNpcOrders(w);
    move(w);
    refreshVision(w);
    assignAutoOrders(w);
    fireWeapons(w);
    consumeSupplies(w);
    leakFuel(w);
    resolveDestroyed(w);
    resolveNpcActivities(w);
    discoverSites(w);
    useOasis(w);
    checkDefeat(w);
    spawnNpcs(w);
    refreshVision(w);
  });
}

export function setWeaponOrder(
  world: World,
  weaponId: string,
  order: WeaponOrder | null,
): World {
  return update(world, (w) => {
    const me = playerVehicle(w);
    if (!vehicleStats(w, me).weapons.some((m) => m.part.id === weaponId))
      throw new Error(`Player has no weapon ${weaponId}`);
    if (order === null) {
      delete me.weaponOrders[weaponId];
      return;
    }
    const target = w.vehicles.find((v) => v.id === order.targetId);
    if (!target || target.id === me.id)
      throw new Error(`Bad target ${order.targetId}`);
    if (!playerSees(w, target.pos))
      throw new Error("You cannot see that target");
    if (order.aim !== "body" && !findPart(target, order.aim))
      throw new Error(`Target has no part ${order.aim}`);
    me.weaponOrders[weaponId] = order;
  });
}

// Manual mode: the player's truck skips the route planner and drives straight at its order's point.
export function setDirect(world: World, on: boolean): World {
  return update(world, (w) => {
    playerVehicle(w).direct = on;
  });
}

export function setAutoFire(world: World, on: boolean): World {
  return update(world, (w) => {
    w.player.autoFire = on;
  });
}

export function hostileToPlayer(world: World, v: Vehicle): boolean {
  return isHostile(playerVehicle(world), v);
}
