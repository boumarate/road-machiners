import { beforeAll, describe, expect, it } from "vitest";
import { RULES } from "../data/rules";
import { buildDrive, freeDrive, initPhysics, type Drive } from "../phys/drive";
import { physicsMove } from "../phys/turn";
import { emptyWorld } from "../sim/testkit";
import { dist } from "../sim/vec";
import { startKit } from "../data/start";
import { playerVehicle } from "../sim/damage";
import type { GameEvent } from "../sim/types";
import { endTurn, newWorld, setMoveOrder } from "../sim/world";
import { canTravel, Travel } from "./travel";

function makeSafeWorld() {
  const world = newWorld(1337, startKit("standard"));
  world.vehicles = [playerVehicle(world)];
  world.events = [];
  return world;
}

describe("turn advancement", () => {
  it("starts paused and runs only after a waypoint click", () => {
    const travel = new Travel(250);
    expect(travel.shouldAdvance(0)).toBe(false);
    travel.start();
    expect(travel.shouldAdvance(0)).toBe(true);
  });

  it("Space pauses travel without scheduling an extra turn", () => {
    const travel = new Travel(250);
    travel.start();
    expect(travel.press(0, true)).toBe(false);
    travel.release();
    expect(travel.shouldAdvance(1000)).toBe(false);
  });

  it("a tap while paused advances exactly one turn", () => {
    const travel = new Travel(250);
    expect(travel.press(0, false)).toBe(true);
    expect(travel.press(10, false)).toBe(false);
    travel.release();
    expect(travel.shouldAdvance(1000)).toBe(false);
  });

  it("holding Space advances faster, even in combat, until release", () => {
    const travel = new Travel(250);
    travel.press(0, false);
    expect(travel.isFast(249)).toBe(false);
    expect(travel.isFast(250)).toBe(true);
    travel.update(false, false);
    expect(travel.shouldAdvance(250)).toBe(true);
    travel.release();
    expect(travel.isFast(251)).toBe(false);
    expect(travel.shouldAdvance(251)).toBe(false);
  });

  it.each(["danger", "arrival"])("%s cancels automatic travel until a new click", (reason) => {
    const travel = new Travel(250);
    travel.start();
    travel.update(reason !== "danger", reason !== "arrival");
    expect(travel.shouldAdvance(0)).toBe(false);
    expect(travel.shouldAdvance(1)).toBe(false);
    travel.start();
    expect(travel.shouldAdvance(2)).toBe(true);
  });

  it("focus loss or a panel clears held input and automatic travel", () => {
    const travel = new Travel(250);
    travel.start();
    travel.press(0, true);
    travel.pause();
    expect(travel.isFast(1000)).toBe(false);
    expect(travel.shouldAdvance(1000)).toBe(false);
  });
});

describe("waypoint travel with physics", () => {
  beforeAll(initPhysics);

  it("advances to the waypoint without Space and stops scheduling on arrival", () => {
    const dest = { x: 38, y: 31 };
    let world = setMoveOrder(emptyWorld(), { kind: "stopAt", dest });
    let drive = buildDrive(world);
    const travel = new Travel(250);
    travel.start();
    let turns = 0;
    try {
      // The existing stop-at physics fixture reaches this destination within eight turns.
      for (; turns < 8; turns++) {
        travel.update(canTravel(world), playerVehicle(world).order !== null);
        if (!travel.shouldAdvance(0)) break;
        let next: Drive | null = null;
        world = endTurn(world, physicsMove(drive, (result) => { next = result.next; }));
        if (!next) throw new Error("Missing physics result");
        freeDrive(drive);
        drive = next;
      }
      expect(turns).toBeGreaterThan(1);
      expect(playerVehicle(world).order).toBeNull();
      expect(dist(playerVehicle(world).pos, dest)).toBeLessThan(RULES.arriveRadius + 0.3);
      expect(travel.shouldAdvance(0)).toBe(false);
    } finally {
      freeDrive(drive);
    }
  });
});

describe("automatic travel safety", () => {
  it("permits safe travel", () => {
    expect(canTravel(makeSafeWorld())).toBe(true);
  });

  it("stops for a visible hostile but not a hidden hostile or a trader", () => {
    const world = makeSafeWorld();
    const enemy = structuredClone(playerVehicle(world));
    enemy.id = "enemy";
    enemy.faction = "raiders";
    world.vehicles.push(enemy);
    expect(canTravel(world)).toBe(false);
    const visible = world.player.visible;
    world.player.visible = [];
    expect(canTravel(world)).toBe(true);
    world.player.visible = visible;
    enemy.faction = "traders";
    expect(canTravel(world)).toBe(true);
  });

  it("keeps direct driving and an empty tank manual", () => {
    const world = makeSafeWorld();
    playerVehicle(world).direct = true;
    expect(canTravel(world)).toBe(false);
    playerVehicle(world).direct = false;
    world.player.fuel = 0;
    expect(canTravel(world)).toBe(false);
  });

  it.each(["collision", "shot", "guardShot", "breakdown", "partDisabled", "defeat"])("stops after player %s", (kind) => {
    const world = makeSafeWorld();
    const id = world.player.vehicleId;
    const events: Record<string, GameEvent> = {
      collision: { t: "collision", a: id, b: "rock", hitsA: [], hitsB: [] },
      shot: { t: "shot", shooter: "enemy", target: id, weapon: "gun", aim: "body", chance: 1, side: "front", rounds: [] },
      guardShot: { t: "guardShot", site: "town", from: { x: 0, y: 0 }, target: id, rounds: [] },
      breakdown: { t: "breakdown", vehicle: id, part: "engine" },
      partDisabled: { t: "partDisabled", vehicle: id, part: "engine" },
      defeat: { t: "defeat" },
    };
    world.events = [events[kind]];
    expect(canTravel(world)).toBe(false);
  });
});
